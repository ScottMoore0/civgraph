"""Static file server for the Playwright suite.

`python -m http.server` is threaded, but socketserver's default listen backlog is 5.
Playwright runs several workers in parallel and each test opens a burst of requests for
the app bundle, tiles and browse shards; once the accept queue is full the OS REFUSES
further connections, and a test fails with ECONNREFUSED while every test around it
passes. That reads as a product failure and is not one -- it is the server's backlog.

Observed 2026-08-23: the redirect spec's page.request.get('/test2/sw.js') failed in the
full suite and passed on its own, reproducibly, once the suite grew to 90 tests.

The record documents (the election manifest, bundles, summaries and provenance shards, the
Browse and graph trees) are not files in the tree since the records cutover: production
answers them from D1 through the compatibility Functions, byte for byte the records build's
output. So, as tools/dev-site/server.mjs does, they are read from that output (tmp/records,
scripts/records/paths.py local_path_for_url) when it holds them. Without a records build they answer 404,
as on a fresh checkout. Nothing is proxied: the suite never reaches the deployed site.

The map documents moved into D1 in data design phase 3 (PHASE3.md): the app reads its startup
index from /_api/layers?view=index and the catalogue pane from /_api/catalogue?view=pane. The
Functions answer those from rows loaded out of the tracked files, so here the same URLs answer
with those files (_api_file): the generated copies the Functions' rows are built from.

The records API (/_api/parties, /_api/persons, /_api/elections and the other routes whose
Functions read only the records database) is answered by those same Functions, run in a
Node process against the records build's database (packages/loader/src/local-api.mjs, through
the D1 shim the records tests use). This server starts it on a free local port and passes
those requests to it; it exits when this server does. Without a records build, or without
node, those URLs answer 404 as before. Any other /_api/ route answers 404.
"""
import http.client
import json
import os
import re
import runpy
import subprocess
import sys
from urllib.parse import parse_qs, unquote
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

_RECORDS = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'records', 'paths.py'))
local_path_for_url = _RECORDS['local_path_for_url']
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
# Package files served at another path (packages/served.json, PKG-9): /assets/ui/ is packages/ui/assets/.
with open(os.path.join(REPO, 'packages', 'served.json'), encoding='utf-8') as _f:
    SERVED_FROM = {k: v for k, v in json.load(_f).items() if k != '//'}
CATALOGUE_VIEWS = {'pane': 'catalogue.json', 'places': 'places.json', 'people': 'people.json'}


def _rewrites():
    """The 200 rewrites of site/_redirects (from -> to), as Pages applies them: an exact path, or
    a prefix ending in /* whose target names no :splat (the Elections app shell, 11 Nov 2026)."""
    out = []
    try:
        with open(os.path.join(REPO, 'site', '_redirects'), encoding='utf-8') as f:
            for line in f:
                parts = line.split('#', 1)[0].split()
                if len(parts) == 3 and parts[2] == '200' and ':splat' not in parts[1] and parts[0] != '/test/sw.js':
                    out.append((parts[0], parts[1]))
    except OSError:
        pass
    return out


REWRITES = _rewrites()


def rewrite(bare):
    """The path a 200 rewrite serves for a request path, or the path itself."""
    for frm, to in REWRITES:
        if bare == frm or (frm.endswith('/*') and bare.startswith(frm[:-1])):
            return to + 'index.html' if to.endswith('/') else to  # the file, not a directory redirect
    return bare


def _api_file(path, query):
    """The file a phase-3 maps API URL answers with, or None (functions/_api/layers,
    functions/_api/catalogue): the tracked sources, and the per-layer sidecars that
    npm run build (build-test2-metadata-shards.mjs) writes to tmp/layer-metadata/.
    Other /_api/ URLs are left to 404, as before."""
    view = (parse_qs(query).get('view') or [''])[0]
    parts = [p for p in path.split('/') if p]
    if parts[:2] == ['_api', 'layers']:
        rest = parts[2:]
        if not rest:
            return os.path.join(REPO, 'render', 'metadata', 'maps-test-index.json' if view == 'index' else 'maps-test.json')
        if '..' in rest:
            return None
        if len(rest) == 1:
            return os.path.join(REPO, 'tmp', 'layer-metadata', 'layer-details-test2', rest[0] + '.json')
        if len(rest) == 2 and rest[1] == 'duplicates':
            return os.path.join(REPO, 'tmp', 'layer-metadata', 'duplicate-feature-ids', rest[0] + '.json')
        return None
    if parts == ['_api', 'catalogue']:
        if view in CATALOGUE_VIEWS:
            return os.path.join(REPO, 'data', 'catalogue', CATALOGUE_VIEWS[view])
        if not query:
            return os.path.join(REPO, 'data', 'database', 'maps.json')
    return None


_LOCAL_API = os.path.join(REPO, 'packages', 'loader', 'src', 'local-api.mjs')
_RECORDS_DB = os.path.join(REPO, 'tmp', 'records', 'civgraph-records.sqlite')
# The same routes as RECORD_API_ROUTES in packages/loader/src/local-api.mjs.
_API_ROUTE = re.compile(r'^/_api/(elections|graph|parties|persons|register-interests|sources|stats|votes)/?$')
_api_port = None


def start_records_api():
    """Start packages/loader/src/local-api.mjs; return its port, or None without a records build."""
    if not os.path.exists(_RECORDS_DB):
        return None
    try:
        proc = subprocess.Popen(['node', '--no-warnings', _LOCAL_API, '--port', '0', '--exit-with-stdin'],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, cwd=REPO)
    except OSError:
        return None
    line = proc.stdout.readline().decode('utf-8', 'replace').strip()
    if not line.startswith('ready '):
        proc.kill()
        return None
    start_records_api.proc = proc  # its stdin stays open while this process lives
    return int(line.split()[1])


class Server(ThreadingHTTPServer):
    # 5 -> 128. The kernel caps this at somaxconn; asking for more is harmless.
    request_queue_size = 128
    daemon_threads = True

    def handle_error(self, request, client_address):
        # The browser drops connections it no longer needs (a cancelled fetch, a closed page);
        # the traceback that follows is noise in the suite's output, not a failure.
        if isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # the suite's own reporter is the signal; per-request lines drown it

    def _records_api(self, head):
        path = self.path.split('?', 1)[0]
        if not _API_ROUTE.match(path):
            return False
        if not _api_port:
            self.send_error(404)
            return True
        headers = {h: self.headers[h] for h in ('Accept', 'If-None-Match') if self.headers.get(h)}
        conn = http.client.HTTPConnection('127.0.0.1', _api_port, timeout=60)
        try:
            conn.request('GET', self.path, headers=headers)
            upstream = conn.getresponse()
            body = upstream.read()
            self.send_response(upstream.status)
            for name, value in upstream.getheaders():
                if name.lower() not in ('content-length', 'connection', 'transfer-encoding', 'date', 'keep-alive'):
                    self.send_header(name, value)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if not head:
                self.wfile.write(body)
        finally:
            conn.close()
        return True

    def do_GET(self):
        if not self._records_api(False):
            super().do_GET()

    def do_HEAD(self):
        if not self._records_api(True):
            super().do_HEAD()

    def translate_path(self, path):
        bare, _, query = path.split('#', 1)[0].partition('?')
        bare = rewrite(bare)
        if bare != path.split('#', 1)[0].partition('?')[0]:
            path = bare
        api = _api_file(unquote(bare), query) if bare.startswith('/_api/') else None
        if api:
            return api
        for served, source in SERVED_FROM.items():
            # A key ending in / is a directory; any other key is one file (the /pkg/ allowlist).
            if unquote(bare).startswith('/' + served) if served.endswith('/') else unquote(bare) == '/' + served:
                return os.path.join(REPO, *(source + unquote(bare)[len(served) + 1:]).split('/'))
        built = local_path_for_url(unquote(bare))
        if built and os.path.exists(built):
            return built
        # The site's own files are in site/ (root tidy, 8 Nov 2026): /X is site/X when site/ has X.
        top = unquote(bare).lstrip('/').split('/', 1)[0]
        if top == '' or os.path.exists(os.path.join(REPO, 'site', top)):
            return super().translate_path('/site/' + path.lstrip('/'))
        return super().translate_path(path)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5050
    ThreadingHTTPServer.allow_reuse_address = True
    _api_port = start_records_api()
    Server(('127.0.0.1', port), Handler).serve_forever()
