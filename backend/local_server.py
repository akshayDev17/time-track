"""Local development server: the real ``api.handle`` over SQLite, on 127.0.0.1.

The Worker runs in Cloudflare's runtime with D1 and Access in front of it. This swaps in
``SqliteD1`` (the same SQL), a fixed email and the stdlib HTTP server. Nothing here ships.

Run:  uv run python local_server.py     (then GET http://127.0.0.1:8787/time-track/api/me)

Environment:
  PORT            listen port (default 8787)
  DB_PATH         SQLite file (default backend/time-track.db, created from the migrations)
  DEV_EMAIL       the signed-in user (default dev@example.com)
  SIGNED_OUT=1    start signed out: every request is answered the way Access answers a
                  visitor with no session, a 302 to the Access login (the public page then
                  shows the demo)
  ALLOWED_ORIGIN  the frontend's origin, echoed for CORS (default http://localhost:3000)

Dev only, to click every transition through locally:
  POST /__dev/clock {"offset_ms": N}      moves this server's clock N ms ahead (the date
                                          rollover: Save last day unlocking at midnight)
  POST /__dev/session {"signed_in": bool} signs the dev user in or out (Access's sign-in page)
  GET  /cdn-cgi/access/logout             signs out, as Access's logout endpoint does
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from time_track.api import HEADERS, decode_body, handle
from time_track.auth import normalize_email
from time_track.sqlite_binding import SqliteD1

HERE = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DB_PATH", HERE / "time-track.db"))
DEV_EMAIL = normalize_email(os.environ.get("DEV_EMAIL", "dev@example.com"))
SIGNED_OUT = os.environ.get("SIGNED_OUT") == "1"
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "http://localhost:3000")
ACCESS_LOGIN = "https://example.cloudflareaccess.com/cdn-cgi/access/login/akshayprabhakant.com"

CLOCK = {"offset_ms": 0}
SESSION = {"signed_in": not SIGNED_OUT}
LOCK = threading.Lock()


def open_db(path: Path) -> SqliteD1:
    fresh = not path.exists()
    db = SqliteD1(sqlite3.connect(str(path), check_same_thread=False))
    if fresh:
        for migration in sorted((HERE / "migrations").glob("*.sql")):
            db.executescript(migration.read_text())
    return db


DB = open_db(DB_PATH)


def now_ms() -> int:
    return time.time_ns() // 1_000_000 + CLOCK["offset_ms"]


class Handler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        if self.headers.get("Origin") == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")

    def _send(self, status: int, body: dict | None, extra: dict | None = None) -> None:
        payload = b"" if status == 204 or body is None else json.dumps(body).encode("utf-8")
        self.send_response(status)
        if payload:
            self.send_header("Content-Type", "application/json")
        for name, value in {**HEADERS, **(extra or {})}.items():
            self.send_header(name, value)
        self._cors()
        if status != 204:
            self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _handle(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace") if length else None
        path = urlsplit(self.path).path
        if path == "/__dev/clock" and self.command == "POST":
            CLOCK["offset_ms"] = int((json.loads(raw or "{}")).get("offset_ms", 0))
            return self._send(200, {"offset_ms": CLOCK["offset_ms"], "now_ms": now_ms()})
        if path == "/__dev/session" and self.command == "POST":
            SESSION["signed_in"] = bool((json.loads(raw or "{}")).get("signed_in"))
            return self._send(200, SESSION)
        if path == "/cdn-cgi/access/logout":
            SESSION["signed_in"] = False
            return self._send(200, {"signed_out": True})
        if not SESSION["signed_in"]:
            return self._send(302, None, {"Location": ACCESS_LOGIN})
        body = decode_body(raw) if self.command in ("POST", "PUT", "PATCH") else None
        try:
            with LOCK:
                status, payload = asyncio.run(handle(DB, self.command, path, body, DEV_EMAIL, now_ms()))
        except Exception:  # noqa: BLE001 - a bug is a 500, not a dropped connection
            traceback.print_exc()
            status, payload = 500, {"error": "internal error"}
        self._send(status, payload)

    do_GET = do_POST = do_PATCH = do_DELETE = _handle

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()

    def log_message(self, *_args) -> None:
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    print(f"time-track backend on http://127.0.0.1:{port}/time-track/api")
    print(f"  db       : {DB_PATH}")
    print(f"  identity : {DEV_EMAIL}{' (signed out: 302 to Access)' if SIGNED_OUT else ''}")
    print(f"  origin   : {ALLOWED_ORIGIN}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
