"""A fresh database from the migrations, a clock the test moves, and one call per request."""

from __future__ import annotations

import asyncio
from datetime import date as Date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from time_track.api import handle
from time_track.sqlite_binding import SqliteD1

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
API = "/time-track/api"
OWNER = "owner@example.com"
OTHER = "someone-else@example.com"

PUNE = "Asia/Kolkata"
MINUTE = 60_000
HOUR = 60 * MINUTE


def fresh_db() -> SqliteD1:
    db = SqliteD1(":memory:")
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        db.executescript(migration.read_text())
    return db


def at(tz: str, iso: str) -> int:
    """Epoch ms of local wall time ``iso`` ("2026-11-15T14:14") in ``tz``."""
    return int(datetime.fromisoformat(iso).replace(tzinfo=ZoneInfo(tz)).timestamp() * 1000)


def stamp(tz: str, day: str, label: str = "Pune (IST)") -> dict:
    """What a browser in ``tz`` sends with Start today on local date ``day``."""
    zone = ZoneInfo(tz)
    d = Date.fromisoformat(day)
    start = datetime.combine(d, time(0), zone)
    end = datetime.combine(d + timedelta(days=1), time(0), zone)
    return {"date": day, "tz": tz, "tz_label": label,
            "day_start_ms": int(start.timestamp() * 1000), "day_end_ms": int(end.timestamp() * 1000)}


class Client:
    """Calls ``api.handle`` as one signed-in user, at the test's clock."""

    def __init__(self, db=None, email: str | None = OWNER, now_ms: int | None = None):
        self.db = db or fresh_db()
        self.email = email
        self.now = now_ms if now_ms is not None else at(PUNE, "2026-11-15T09:02")

    def as_user(self, email: str | None) -> "Client":
        other = Client(self.db, email, self.now)
        return other

    def advance(self, ms: int) -> None:
        self.now += ms

    def call(self, method: str, path: str, body=None) -> tuple[int, dict | None]:
        return asyncio.run(handle(self.db, method, API + path, body, self.email, self.now))

    def ok(self, method: str, path: str, body=None) -> dict | None:
        status, payload = self.call(method, path, body)
        assert status in (200, 204), (status, payload)
        return payload

    # ── shorthands ──
    def new_tracker(self, name: str = "Workday", timers: int = 3) -> str:
        return self.ok("POST", "/trackers", {"name": name, "timers": timers})["tracker"]["slug"]

    def start_today(self, slug: str, day: str = "2026-11-15", tz: str = PUNE, **extra) -> tuple[int, dict]:
        return self.call("POST", f"/trackers/{slug}/start-today", {**stamp(tz, day), **extra})

    def tracker(self, slug: str) -> dict:
        return self.ok("GET", f"/trackers/{slug}")["tracker"]

    def timer_ids(self, slug: str) -> list[int]:
        return [t["id"] for t in self.tracker(slug)["timers"]]

    def history(self, slug: str) -> dict:
        return self.ok("GET", f"/trackers/{slug}/history")


def elapsed(timer: dict, now_ms: int) -> int:
    since = timer["running_since_ms"]
    return timer["acc_ms"] + (now_ms - since if since is not None else 0)
