"""The HTTP API as one function of (db, method, path, body, email, now_ms).

No framework and no I/O of its own: the Worker and the local server each turn a real
request into these arguments and the returned ``(status, body)`` into a response. Every
route needs an identity: without one the answer is 401 before any route runs.
"""

from __future__ import annotations

import json
import re

from . import trackers as T
from .errors import Invalid, TrackError
from .store import upsert_user

PREFIX = "/time-track/api"

#: Every answer is per-user and changes as timers run, so nothing may cache it.
HEADERS = {"cache-control": "no-store"}


class _Malformed:
    def __repr__(self) -> str:
        return "MALFORMED"


MALFORMED = _Malformed()


def decode_body(raw: str | bytes | None) -> object:
    """A request body as JSON: ``None`` when empty, :data:`MALFORMED` when it does not parse."""
    if raw is None or not raw.strip():
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return MALFORMED


def _object(body: object) -> dict:
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise Invalid("request body must be a JSON object")
    return body


SLUG = r"(?P<slug>[a-z0-9-]{1,48})"
TIMER = r"(?P<timer>[0-9]{1,12})"

# (method, path pattern, handler(db, user_id, match, body, now_ms)); the first match wins.
ROUTES = [
    ("GET", r"/trackers", lambda db, u, m, b, n: T.list_trackers(db, u, n)),
    ("POST", r"/trackers", lambda db, u, m, b, n: T.create_tracker(db, u, _object(b), n)),
    ("GET", rf"/trackers/{SLUG}", lambda db, u, m, b, n: T.get_tracker(db, u, m["slug"], n)),
    ("DELETE", rf"/trackers/{SLUG}", lambda db, u, m, b, n: T.delete_tracker(db, u, m["slug"])),
    ("GET", rf"/trackers/{SLUG}/history", lambda db, u, m, b, n: T.get_history(db, u, m["slug"], n)),
    ("POST", rf"/trackers/{SLUG}/start-today", lambda db, u, m, b, n: T.start_today(db, u, m["slug"], _object(b), n)),
    ("POST", rf"/trackers/{SLUG}/save-day", lambda db, u, m, b, n: T.save_day(db, u, m["slug"], n)),
    ("POST", rf"/trackers/{SLUG}/discard-day", lambda db, u, m, b, n: T.discard_day(db, u, m["slug"], n)),
    ("POST", rf"/trackers/{SLUG}/(?P<action>start-all|stop-all|relaunch|clear-all)",
     lambda db, u, m, b, n: T.tracker_action(db, u, m["slug"], m["action"], n)),
    ("POST", rf"/trackers/{SLUG}/timers", lambda db, u, m, b, n: T.add_timer(db, u, m["slug"], n)),
    ("PATCH", rf"/trackers/{SLUG}/timers/{TIMER}",
     lambda db, u, m, b, n: T.rename_timer(db, u, m["slug"], int(m["timer"]), _object(b), n)),
    ("DELETE", rf"/trackers/{SLUG}/timers/{TIMER}",
     lambda db, u, m, b, n: T.remove_timer(db, u, m["slug"], int(m["timer"]), n)),
    ("POST", rf"/trackers/{SLUG}/timers/{TIMER}/(?P<action>start|stop|clear)",
     lambda db, u, m, b, n: T.timer_action(db, u, m["slug"], int(m["timer"]), m["action"], n)),
]
COMPILED = [(method, re.compile(pattern + r"/?"), handler) for method, pattern, handler in ROUTES]


async def handle(db, method: str, path: str, body: object, email: str | None, now_ms: int) -> tuple[int, dict | None]:
    if path != PREFIX and not path.startswith(PREFIX + "/"):
        return 404, {"error": "not found"}
    if email is None:
        return 401, {"error": "not signed in"}
    local = path[len(PREFIX):] or "/"
    if body is MALFORMED:
        return 400, {"error": "request body is not valid JSON"}
    if method == "GET" and local.rstrip("/") == "/me":
        return 200, {"email": email, "now_ms": now_ms}
    allowed = []
    for route_method, pattern, handler in COMPILED:
        match = pattern.fullmatch(local)
        if not match:
            continue
        if route_method != method:
            allowed.append(route_method)
            continue
        try:
            user_id = await upsert_user(db, email, now_ms)
            result = await handler(db, user_id, match, body, now_ms)
        except TrackError as error:
            return error.status, {"error": error.message, **({"code": error.code} if error.code else {})}
        return (204, None) if result is None else (200, result)
    if allowed:
        return 405, {"error": f"use {', '.join(sorted(set(allowed)))}"}
    return 404, {"error": "not found"}
