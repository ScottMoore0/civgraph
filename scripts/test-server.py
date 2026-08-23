"""Static file server for the Playwright suite.

`python -m http.server` is threaded, but socketserver's default listen backlog is 5.
Playwright runs several workers in parallel and each test opens a burst of requests for
the app bundle, tiles and browse shards; once the accept queue is full the OS REFUSES
further connections, and a test fails with ECONNREFUSED while every test around it
passes. That reads as a product failure and is not one -- it is the server's backlog.

Observed 2026-08-23: the redirect spec's page.request.get('/test2/sw.js') failed in the
full suite and passed on its own, reproducibly, once the suite grew to 90 tests.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Server(ThreadingHTTPServer):
    # 5 -> 128. The kernel caps this at somaxconn; asking for more is harmless.
    request_queue_size = 128
    daemon_threads = True


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # the suite's own reporter is the signal; per-request lines drown it


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5050
    ThreadingHTTPServer.allow_reuse_address = True
    Server(('127.0.0.1', port), Handler).serve_forever()
