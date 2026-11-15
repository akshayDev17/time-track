"""Two devices on one tracker at once: both pass the checks, then the other one writes first.

``Racing`` runs the other device's requests just before this request's first write batch,
which is the worst interleaving the Worker allows. The loser gets the same answer the
checks give one request later, and the tracker stays as the winner left it.
"""

import asyncio

from helpers import API, MINUTE, OWNER, PUNE, Client, at, stamp

from time_track.api import handle


class Racing:
    """A database whose first ``batch`` lets ``other`` requests land first."""

    def __init__(self, db, now_ms: int, other: list[tuple[str, str, dict | None]]):
        self._db = db
        self._now = now_ms
        self._other = other

    def prepare(self, sql: str):
        return self._db.prepare(sql)

    async def batch(self, statements):
        other, self._other = self._other, []
        for method, path, body in other:
            status, payload = await handle(self._db, method, API + path, body, OWNER, self._now)
            assert status == 200, (status, payload)
        return await self._db.batch(statements)


def race(c: Client, method: str, path: str, body, *other: tuple[str, str, dict | None]):
    db = Racing(c.db, c.now, list(other))
    return asyncio.run(handle(db, method, API + path, body, OWNER, c.now))


def test_start_today_on_two_devices_opens_one_day_and_the_other_hears_one_day_per_date():
    c = Client()
    slug = c.new_tracker("Workday", 2)
    today = stamp(PUNE, "2026-11-15")
    status, body = race(c, "POST", f"/trackers/{slug}/start-today", today,
                        ("POST", f"/trackers/{slug}/start-today", today))
    assert (status, body) == (409, {"error": "Today already has its day. One day per date.", "code": "day_open"})
    assert c.tracker(slug)["open_day"]["date"] == "2026-11-15"


def test_discard_it_on_two_devices_never_wipes_the_day_the_other_started():
    c = Client(now_ms=at(PUNE, "2026-11-14T09:00"))
    slug = c.new_tracker("Workday", 2)
    c.start_today(slug, "2026-11-14")
    c.now = at(PUNE, "2026-11-15T09:00")
    first = c.timer_ids(slug)[0]
    today = {**stamp(PUNE, "2026-11-15"), "last_day": "discard"}
    status, body = race(c, "POST", f"/trackers/{slug}/start-today", today,
                        ("POST", f"/trackers/{slug}/start-today", today),
                        ("POST", f"/trackers/{slug}/timers/{first}/start", None))
    assert (status, body["code"]) == (409, "day_open")
    t = c.tracker(slug)
    assert t["open_day"]["date"] == "2026-11-15" and t["last_outcome"] is None
    assert t["timers"][0]["running_since_ms"] == c.now


def test_save_it_first_on_two_devices_saves_the_last_day_once_and_never_saves_today():
    c = Client(now_ms=at(PUNE, "2026-11-14T09:00"))
    slug = c.new_tracker("Workday", 1)
    c.start_today(slug, "2026-11-14")
    c.now = at(PUNE, "2026-11-15T09:00")
    today = {**stamp(PUNE, "2026-11-15"), "last_day": "save"}
    status, body = race(c, "POST", f"/trackers/{slug}/start-today", today,
                        ("POST", f"/trackers/{slug}/start-today", today))
    assert (status, body["code"]) == (409, "day_open")
    assert [d["date"] for d in c.history(slug)["days"]] == ["2026-11-14"]
    assert c.tracker(slug)["open_day"]["date"] == "2026-11-15"


def test_save_last_day_racing_start_today_leaves_the_new_day_open_and_unsaved():
    c = Client(now_ms=at(PUNE, "2026-11-14T09:00"))
    slug = c.new_tracker("Workday", 1)
    c.start_today(slug, "2026-11-14")
    c.now = at(PUNE, "2026-11-15T09:00")
    status, body = race(c, "POST", f"/trackers/{slug}/save-day", None,
                        ("POST", f"/trackers/{slug}/start-today", {**stamp(PUNE, "2026-11-15"), "last_day": "discard"}))
    assert (status, body) == (409, {"error": "Unlocks when 2026-11-15 ends in Pune (IST).", "code": "day_not_ended"})
    t = c.tracker(slug)
    assert t["open_day"]["date"] == "2026-11-15" and t["last_outcome"] is None
    assert c.history(slug)["days"] == []


def test_discard_last_day_racing_start_today_leaves_the_new_day_open():
    c = Client(now_ms=at(PUNE, "2026-11-14T09:00"))
    slug = c.new_tracker("Workday", 1)
    c.start_today(slug, "2026-11-14")
    c.now = at(PUNE, "2026-11-15T09:00")
    status, body = race(c, "POST", f"/trackers/{slug}/discard-day", None,
                        ("POST", f"/trackers/{slug}/start-today", {**stamp(PUNE, "2026-11-15"), "last_day": "save"}))
    assert (status, body["code"]) == (409, "day_not_ended")
    t = c.tracker(slug)
    assert t["open_day"]["date"] == "2026-11-15" and t["last_outcome"] is None
    assert [d["date"] for d in c.history(slug)["days"]] == ["2026-11-14"]


def test_new_tracker_with_one_name_from_two_tabs_numbers_the_second():
    c = Client()
    status, body = race(c, "POST", "/trackers", {"name": "Workday", "timers": 3},
                        ("POST", "/trackers", {"name": "Workday", "timers": 3}))
    assert status == 200 and body["tracker"]["slug"] == "workday-2"
    assert [r["slug"] for r in c.ok("GET", "/trackers")["trackers"]] == ["workday", "workday-2"]


def test_add_timer_on_two_devices_at_fourteen_stops_at_fifteen():
    c = Client()
    slug = c.new_tracker("Workday", 14)
    c.start_today(slug)
    status, body = race(c, "POST", f"/trackers/{slug}/timers", None, ("POST", f"/trackers/{slug}/timers", None))
    assert (status, body) == (409, {"error": "15 of 15: the most a tracker holds.", "code": "timer_cap"})
    t = c.tracker(slug)
    assert len(t["timers"]) == 15 and all(x["acc_ms"] == 0 for x in t["timers"])
    c.ok("POST", f"/trackers/{slug}/timers/{t['timers'][-1]['id']}/start")


def test_remove_timer_on_two_devices_at_two_keeps_the_last_timer():
    c = Client()
    slug = c.new_tracker("Workday", 2)
    c.start_today(slug)
    a, b = c.timer_ids(slug)
    c.advance(MINUTE)
    status, body = race(c, "DELETE", f"/trackers/{slug}/timers/{a}", None, ("DELETE", f"/trackers/{slug}/timers/{b}", None))
    assert (status, body) == (409, {"error": "A tracker keeps at least one timer.", "code": "last_timer"})
    assert c.timer_ids(slug) == [a]
    c.ok("POST", f"/trackers/{slug}/timers/{a}/start")
