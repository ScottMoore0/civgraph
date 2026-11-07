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
scripts/records/paths.py local_path_for_url) when it holds them, and from the tree otherwise
(data/browse/proni-roots.json is still committed). Without a records build they answer 404,
as on a fresh checkout. Nothing is proxied: the suite never reaches the deployed site.

The map documents moved into D1 in data design phase 3 (PHASE3.md): the app reads its startup
index from /_api/layers?view=index and the catalogue pane from /_api/catalogue?view=pane. The
Functions answer those from rows loaded out of the tracked files, so here the same URLs answer
with those files (_api_file): the generated copies the Functions' rows are built from.
"""
import os
import runpy
import sys
from urllib.parse import parse_qs, unquote
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

_RECORDS = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'records', 'paths.py'))
local_path_for_url = _RECORDS['local_path_for_url']
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
CATALOGUE_VIEWS = {'pane': 'catalogue.json', 'places': 'places.json', 'people': 'people.json'}


def _api_file(path, query):
    """The tracked file a phase-3 maps API URL answers with, or None (functions/_api/layers,
    functions/_api/catalogue). Other /_api/ URLs are left to 404, as before."""
    view = (parse_qs(query).get('view') or [''])[0]
    parts = [p for p in path.split('/') if p]
    if parts[:2] == ['_api', 'layers']:
        rest = parts[2:]
        if not rest:
            return os.path.join(REPO, 'render', 'metadata', 'maps-test-index.json' if view == 'index' else 'maps-test.json')
        if '..' in rest:
            return None
        if len(rest) == 1:
            return os.path.join(REPO, 'render', 'metadata', 'layer-details-test2', rest[0] + '.json')
        if len(rest) == 2 and rest[1] == 'duplicates':
            return os.path.join(REPO, 'render', 'metadata', 'duplicate-feature-ids', rest[0] + '.json')
        return None
    if parts == ['_api', 'catalogue']:
        if view in CATALOGUE_VIEWS:
            return os.path.join(REPO, 'data', 'catalogue', CATALOGUE_VIEWS[view])
        if not query:
            return os.path.join(REPO, 'data', 'database', 'maps.json')
    return None


class Server(ThreadingHTTPServer):
    # 5 -> 128. The kernel caps this at somaxconn; asking for more is harmless.
    request_queue_size = 128
    daemon_threads = True


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # the suite's own reporter is the signal; per-request lines drown it

    def translate_path(self, path):
        bare, _, query = path.split('#', 1)[0].partition('?')
        api = _api_file(unquote(bare), query) if bare.startswith('/_api/') else None
        if api:
            return api
        built = local_path_for_url(unquote(bare))
        if built and os.path.exists(built):
            return built
        return super().translate_path(path)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5050
    ThreadingHTTPServer.allow_reuse_address = True
    Server(('127.0.0.1', port), Handler).serve_forever()
