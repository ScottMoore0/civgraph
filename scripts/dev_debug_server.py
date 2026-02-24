#!/usr/bin/env python3
"""
Static dev server with browser debug-log ingestion.

Usage:
  python scripts/dev_debug_server.py --port 5050
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DebugHandler(SimpleHTTPRequestHandler):
    log_dir: Path = Path("logs")
    runtime_log_path: Path = Path("logs/runtime-debug.ndjson")
    server_log_path: Path = Path("logs/server.log")

    def _append_server_log(self, message: str) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        with self.server_log_path.open("a", encoding="utf-8") as f:
            f.write(f"{utc_now_iso()} {message}\n")

    def log_message(self, fmt: str, *args) -> None:
        self._append_server_log(fmt % args)

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/__debug/log":
            self.send_error(404, "Not Found")
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception as exc:  # noqa: BLE001
            self._append_server_log(f"invalid-debug-payload error={exc}")
            self.send_error(400, "Invalid JSON")
            return

        if not isinstance(payload, dict):
            payload = {"raw": payload}
        payload.setdefault("received_at_utc", utc_now_iso())

        self.log_dir.mkdir(parents=True, exist_ok=True)
        with self.runtime_log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")

        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5050)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--log-dir", default="logs")
    args = parser.parse_args()

    log_dir = Path(args.log_dir)
    DebugHandler.log_dir = log_dir
    DebugHandler.runtime_log_path = log_dir / "runtime-debug.ndjson"
    DebugHandler.server_log_path = log_dir / "server.log"

    server = ThreadingHTTPServer((args.host, args.port), DebugHandler)
    print(f"[dev-debug-server] serving http://{args.host}:{args.port}")
    print(f"[dev-debug-server] runtime logs -> {DebugHandler.runtime_log_path}")
    print(f"[dev-debug-server] server logs  -> {DebugHandler.server_log_path}")
    server.serve_forever()


if __name__ == "__main__":
    main()

