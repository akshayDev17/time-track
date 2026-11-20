"""Two devices on one tracker at once: both pass the checks, then the other one writes first.

``Racing`` runs the other device's requests just before this request's first batch that
writes (batches of reads only pass straight through, and so do the statements that close a
day past its end, which every read carries), which is the worst interleaving the Worker
allows. The tracker stays as the winner left it. A loser that would break a rule gets the
same answer the checks give one request later; a Discard last day that lost its day does
nothing and answers with the current state, which the page then shows.

``Racing(closing=True)`` instead lets the others land just before this request's own close
of an ended day: two tabs or devices asking after the end at once.
"""

import asyncio
from types import SimpleNamespace

from helpers import API, HOUR, MINUTE, OWNER, PUNE, SITE, Client, at, stamp

from time_track import store
from time_track.api import handle


class _SqlOnly:
    def prepare(self, sql: str):
        return SimpleNamespace(bind=lambda *params: sql)


#: The SQL of the statements that close an ended day, for one tracker or all of a user's.
CLOSING = {sql for scope in (store._ID, store._USER_TRACKERS) for sql in store.close_ended_days(_SqlOnly(), scope, (), 0)}


def _closes(statements) -> bool:
    return any(s._sql in CLOSING for s in statements)


def _writes(statements) -> bool:
    return any(s._sql not in CLOSING and not s._sql.lstrip().upper().startswith("SELECT") for s in statements)


class Racing:
    """A database whose first ``batch`` that writes (or, ``closing``, that closes an ended
    day) lets ``other`` requests land first."""

    def __init__(self, db, now_ms: int, other: list[tuple[str, str, dict | None]], closing: bool = False):
        self._db = db
        self._now = now_ms
        self._other = other
        self._trigger = _closes if closing else _writes

    def prepare(self, sql: str):
        return self._db.prepare(sql)

    async def batch(self, statements):
        if not self._trigger(statements):
            return await self._db.batch(statements)
        other, self._other = self._other, []
        for method, path, body in other:
            status, payload = await handle(self._db, method, API + path, body, OWNER, self._now, SITE, SITE)
            assert status == 200, (status, payload)
        return await self._db.batch(statements)


def race(c: Client, method: str, path: str, body, *other: tuple[str, str, dict | None], closing: bool = False):
    db = Racing(c.db, c.now, list(other), closing)
    answer = asyncio.run(handle(db, method, API + path, body, OWNER, c.now, SITE, SITE))
    assert db._other == [], "the other requests never got their turn"
    return answer


def test_start_today_on_two_devices_opens_one_day_and_the_other_hears_one_day_per_date():
    c = Client()
    slug = c.new_tracker("Workday", 2)
    today = stamp(PUNE, "2026-11-15")
    status, body = race(c, "POST", f"/trackers/{slug}/start-today", today,
                        ("POST", f"/trackers/{slug}/start-today", today))
    assert (status, body) == (409, {"error": "This day is still open. The next one starts once it ends, 24 hours after it began.", "code": "day_open"})
    assert c.tracker(slug)["open_day"]["date"] == "2026-11-15"


def ended_day_with_a_timer_running():
    """A day opened 23:59 on Sun 15 Nov with Deep work running since 22:00 on the 16th; it is
    now past the day's end (23:59 on the 16th)."""
    c = Client(now_ms=at(PUNE, "2026-11-15T23:59"))
    slug = c.new_tracker("Workday", 2)
    c.start_today(slug)
    c.now = at(PUNE, "2026-11-16T22:00")
    c.ok("POST", f"/trackers/{slug}/timers/{c.timer_ids(slug)[0]}/start")
    c.now = at(PUNE, "2026-11-17T08:00")
    return c, slug


def assert_saved_once(c: Client, slug: str) -> None:
    saved = c.db.prepare("SELECT date, saved_at_ms FROM history_days").bind()._execute()
    assert saved == [{"date": "2026-11-15", "saved_at_ms": at(PUNE, "2026-11-16T23:59")}]
    first = c.timer_ids(slug)[0]
    assert c.history(slug)["days"][0]["values"][str(first)] == HOUR + 59 * MINUTE
    assert c.db.prepare("SELECT COUNT(*) AS n FROM history_values").bind()._execute()[0]["n"] == 2


def test_two_tabs_reading_after_the_end_close_and_save_the_day_once():
    c, slug = ended_day_with_a_timer_running()
    status, body = race(c, "GET", f"/trackers/{slug}", None, ("GET", f"/trackers/{slug}", None), closing=True)
    assert status == 200 and body["tracker"]["last_outcome"] == "saved" and body["tracker"]["open_day"] is None
    assert_saved_once(c, slug)


def test_the_list_and_a_tracker_page_after_the_end_save_the_day_once():
    c, slug = ended_day_with_a_timer_running()
    status, body = race(c, "GET", "/trackers", None, ("GET", f"/trackers/{slug}", None), closing=True)
    assert status == 200 and body["trackers"][0]["last_outcome"] == "saved"
    assert_saved_once(c, slug)


def test_a_stop_and_a_start_today_after_the_end_save_the_day_once_and_open_the_next():
    c, slug = ended_day_with_a_timer_running()
    first = c.timer_ids(slug)[0]
    status, body = race(c, "POST", f"/trackers/{slug}/timers/{first}/stop", None,
                        ("POST", f"/trackers/{slug}/start-today", stamp(PUNE, "2026-11-17")), closing=True)
    assert status == 200 and body["tracker"]["open_day"]["date"] == "2026-11-17"
    assert all(t["running_since_ms"] is None and t["acc_ms"] == 0 for t in body["tracker"]["timers"])
    assert_saved_once(c, slug)


def test_discard_last_day_that_lost_its_day_never_wipes_the_next_one():
    # Two devices on the same open day: one discards it and starts today again; the other's
    # Discard, checked against the first day, then finds that day gone and changes nothing.
    c = Client(now_ms=at(PUNE, "2026-11-15T08:00"))
    slug = c.new_tracker("Workday", 1)
    c.start_today(slug)
    c.now = at(PUNE, "2026-11-15T09:00")
    status, body = race(c, "POST", f"/trackers/{slug}/discard-day", None,
                        ("POST", f"/trackers/{slug}/discard-day", None),
                        ("POST", f"/trackers/{slug}/start-today", stamp(PUNE, "2026-11-15")))
    assert status == 200 and body == c.ok("GET", f"/trackers/{slug}")
    t = body["tracker"]
    assert t["open_day"]["started_at_ms"] == c.now and t["last_outcome"] is None
    assert c.history(slug)["days"] == []


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
