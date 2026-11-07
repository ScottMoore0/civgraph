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
"""
import os
import runpy
import sys
from urllib.parse import unquote
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

_RECORDS = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'records', 'paths.py'))
local_path_for_url = _RECORDS['local_path_for_url']


class Server(ThreadingHTTPServer):
    # 5 -> 128. The kernel caps this at somaxconn; asking for more is harmless.
    request_queue_size = 128
    daemon_threads = True


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # the suite's own reporter is the signal; per-request lines drown it

    def translate_path(self, path):
        built = local_path_for_url(unquote(path.split('?', 1)[0].split('#', 1)[0]))
        if built and os.path.exists(built):
            return built
        return super().translate_path(path)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5050
    ThreadingHTTPServer.allow_reuse_address = True
    Server(('127.0.0.1', port), Handler).serve_forever()
