"""Days: Start today opens a window of exactly 24 hours from its start; at its end the day closes
itself (every running timer stops at the end, the day is saved, the timers show zero), on
whichever request comes next; Discard last day before then; one day per date."""

import sqlite3
from pathlib import Path

from helpers import HOUR, MIGRATIONS, MINUTE, PUNE, Client, at, elapsed, stamp

from time_track.sqlite_binding import SqliteD1

AUCKLAND = "Pacific/Auckland"
SF = "America/Los_Angeles"
LONDON = "Europe/London"
DAY = 24 * HOUR


def started(timers=3, name="Workday", now=None, day="2026-11-15", tz=PUNE):
    c = Client(now_ms=now)
    slug = c.new_tracker(name, timers)
    status, body = c.start_today(slug, day, tz)
    assert status == 200, body
    return c, slug


def rows(c, table):
    return c.db.prepare(f"SELECT COUNT(*) AS n FROM {table}").bind()._execute()[0]["n"]


# ── Start today: a 24-hour window from its start ─────────────────────────────

def test_brand_new_tracker_has_no_day_and_zero_timers():
    c = Client()
    t = c.tracker(c.new_tracker("Reading", 3))
    assert t["phase"] is None and t["open_day"] is None and t["last_outcome"] is None
    assert [x["acc_ms"] for x in t["timers"]] == [0, 0, 0]


def test_start_today_opens_a_day_stamped_with_date_and_zone_ending_24_hours_after_it_started():
    c, slug = started()
    t = c.tracker(slug)
    assert t["phase"] == "live"
    day = t["open_day"]
    assert (day["date"], day["tz"], day["tz_label"]) == ("2026-11-15", PUNE, "Pune (IST)")
    assert day["started_at_ms"] == day["day_start_ms"] == c.now
    assert day["day_end_ms"] == c.now + DAY == at(PUNE, "2026-11-16T09:02")
    assert all(x["acc_ms"] == 0 and x["running_since_ms"] is None for x in t["timers"])


def test_a_day_started_at_2359_ends_at_2359_the_next_day_not_at_midnight():
    c, slug = started(now=at(PUNE, "2026-11-15T23:59"))
    assert c.tracker(slug)["open_day"]["day_end_ms"] == at(PUNE, "2026-11-16T23:59")
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.now = at(PUNE, "2026-11-16T00:01")  # past the date's midnight: still the same, live day
    t = c.tracker(slug)
    assert t["phase"] == "live" and t["open_day"]["date"] == "2026-11-15"
    c.ok("POST", f"/trackers/{slug}/timers/{ids[1]}/start")
    c.now = at(PUNE, "2026-11-16T23:58")
    assert c.tracker(slug)["phase"] == "live"


def test_a_day_started_at_midnight_ends_at_the_next_midnight():
    c, slug = started(now=at(PUNE, "2026-11-15T00:00"))
    assert c.tracker(slug)["open_day"]["day_end_ms"] == at(PUNE, "2026-11-16T00:00")
    c.now = at(PUNE, "2026-11-16T00:00") - 1
    assert c.tracker(slug)["phase"] == "live"
    c.now = at(PUNE, "2026-11-16T00:00")
    t = c.tracker(slug)
    assert t["open_day"] is None and t["last_outcome"] == "saved"


def test_the_window_is_24_real_hours_across_a_dst_change():
    # London springs forward at 01:00 on Sun 28 Mar 2027: a day started at 09:00 GMT on the
    # Saturday ends 24 hours later, which the clock there reads as 10:00 BST.
    c, slug = started(now=at(LONDON, "2027-03-27T09:00"), day="2027-03-27", tz=LONDON)
    end = c.tracker(slug)["open_day"]["day_end_ms"]
    assert end - at(LONDON, "2027-03-27T09:00") == DAY
    assert end == at(LONDON, "2027-03-28T10:00")


def test_start_today_is_refused_while_the_day_is_open():
    c, slug = started(now=at(PUNE, "2026-11-15T23:59"))
    c.now = at(PUNE, "2026-11-16T09:00")
    status, body = c.start_today(slug, "2026-11-16")
    assert status == 409 and body["code"] == "day_open"
    assert body["error"] == "This day is still open. The next one starts once it ends, 24 hours after it began."


def test_start_today_right_after_the_end_saves_the_old_day_and_opens_the_next_at_zero():
    c, slug = started(now=at(PUNE, "2026-11-15T23:59"))
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.now = at(PUNE, "2026-11-16T23:59")
    status, body = c.start_today(slug, "2026-11-16")
    assert status == 200, body
    t = body["tracker"]
    assert t["open_day"]["date"] == "2026-11-16" and t["open_day"]["day_end_ms"] == at(PUNE, "2026-11-17T23:59")
    assert all(x["acc_ms"] == 0 and x["running_since_ms"] is None for x in t["timers"])
    assert c.history(slug)["days"] == [{"date": "2026-11-15", "tz_label": "Pune (IST)",
                                        "values": {str(ids[0]): DAY, str(ids[1]): 0, str(ids[2]): 0}}]


def test_one_day_per_date_a_saved_date_is_not_started_again_even_after_travelling():
    # Started in Auckland on Mon 16 Nov and saved at its end; it is still Mon 16 Nov in San
    # Francisco, so Start today there would make a second day for the same date.
    c, slug = started(now=at(AUCKLAND, "2026-11-16T09:00"), day="2026-11-16", tz=AUCKLAND)
    c.now = at(AUCKLAND, "2026-11-17T09:00")
    assert c.now < at(SF, "2026-11-17T00:00")
    status, body = c.start_today(slug, "2026-11-16", SF)
    assert status == 409 and body["code"] == "date_taken"
    assert body["error"] == "One day per date: 2026-11-16 is already saved."
    assert c.tracker(slug)["last_outcome"] == "saved"


def test_one_day_per_date_holds_on_a_25_hour_dst_day():
    # London falls back at 02:00 on Sun 25 Oct 2026, so that date lasts 25 hours: a day
    # started at 00:30 ends at 23:30 the same date, and that date cannot start again.
    c, slug = started(now=at(LONDON, "2026-10-25T00:30"), day="2026-10-25", tz=LONDON)
    end = c.tracker(slug)["open_day"]["day_end_ms"]
    assert end == at(LONDON, "2026-10-25T23:30")
    c.now = at(LONDON, "2026-10-25T23:45")
    assert c.start_today(slug, "2026-10-25", LONDON)[1]["code"] == "date_taken"
    c.now = at(LONDON, "2026-10-26T00:00")
    assert c.start_today(slug, "2026-10-26", LONDON)[0] == 200


def test_start_today_refuses_a_date_that_is_not_today_on_the_server_clock():
    c = Client()
    slug = c.new_tracker()
    status, body = c.start_today(slug, "2026-11-14")
    assert status == 422 and body["code"] == "date_not_today"
    status, _ = c.start_today(slug, "2026-11-16")
    assert status == 422


def test_start_today_rejects_a_stamp_that_is_not_one_calendar_day():
    c = Client()
    slug = c.new_tracker()
    s = stamp(PUNE, "2026-11-15")
    s["day_end_ms"] = s["day_start_ms"] + 30 * HOUR
    assert c.call("POST", f"/trackers/{slug}/start-today", s)[0] == 422
    for bad in ({"date": "2026-02-30"}, {"tz": ""}, {"tz_label": "x" * 81}, {"day_start_ms": "0"}):
        assert c.call("POST", f"/trackers/{slug}/start-today", {**stamp(PUNE, "2026-11-15"), **bad})[0] == 422


def test_dst_calendar_day_of_23_hours_is_accepted_and_still_gets_a_24_hour_window():
    c = Client(now_ms=at(LONDON, "2027-03-28T10:00"))
    slug = c.new_tracker()
    s = stamp(LONDON, "2027-03-28")
    assert s["day_end_ms"] - s["day_start_ms"] == 23 * HOUR
    body = c.call("POST", f"/trackers/{slug}/start-today", s)[1]
    assert body["tracker"]["open_day"]["day_end_ms"] == c.now + DAY


# ── at the end: every timer stops at the end, the day saves itself, zero ─────

def ran_through_the_end():
    """Workday, opened 23:59 on Sun 15 Nov: Deep work ran 1 h and stopped; Email started at
    23:00 on the 16th and is still running when the day ends at 23:59."""
    c, slug = started(now=at(PUNE, "2026-11-15T23:59"))
    ids = c.timer_ids(slug)
    c.now = at(PUNE, "2026-11-16T08:00")
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(HOUR)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/stop")
    c.now = at(PUNE, "2026-11-16T23:00")
    c.ok("POST", f"/trackers/{slug}/timers/{ids[2]}/start")
    return c, slug, ids


def test_at_the_end_running_timers_stop_at_the_end_and_the_day_is_saved_then_zero():
    c, slug, ids = ran_through_the_end()
    c.now = at(PUNE, "2026-11-16T23:59")
    t = c.tracker(slug)
    assert t["open_day"] is None and t["phase"] is None and t["last_outcome"] == "saved"
    assert all(x["acc_ms"] == 0 and x["running_since_ms"] is None for x in t["timers"])
    saved = t["saved_day"]
    assert saved["date"] == "2026-11-15"
    assert saved["started_at_ms"] == at(PUNE, "2026-11-15T23:59")
    assert saved["day_end_ms"] == saved["saved_at_ms"] == at(PUNE, "2026-11-16T23:59")
    assert c.history(slug)["days"][0]["values"] == {str(ids[0]): HOUR, str(ids[1]): 0, str(ids[2]): 59 * MINUTE}
    assert rows(c, "open_days") == rows(c, "open_day_timers") == 0


def test_a_request_long_after_the_end_saves_exactly_what_the_day_held_at_its_end():
    # No tab open, the laptop shut: the first request comes three days later.
    c, slug, ids = ran_through_the_end()
    c.now = at(PUNE, "2026-11-19T15:00")
    t = c.tracker(slug)
    assert t["last_outcome"] == "saved" and t["saved_day"]["saved_at_ms"] == at(PUNE, "2026-11-16T23:59")
    assert c.history(slug)["days"][0]["values"][str(ids[2])] == 59 * MINUTE


def test_nothing_closes_before_the_end():
    c, slug, ids = ran_through_the_end()
    c.now = at(PUNE, "2026-11-16T23:59") - 1
    t = c.tracker(slug)
    assert t["phase"] == "live" and elapsed(t["timers"][2], c.now) == 59 * MINUTE - 1
    assert c.history(slug)["days"] == []


def test_every_route_closes_an_ended_day_first():
    for read in (
        lambda c, slug, ids: c.ok("GET", "/trackers"),
        lambda c, slug, ids: c.ok("GET", f"/trackers/{slug}/history"),
        lambda c, slug, ids: c.ok("POST", f"/trackers/{slug}/stop-all"),
        lambda c, slug, ids: c.call("POST", f"/trackers/{slug}/timers/{ids[1]}/start"),
        lambda c, slug, ids: c.call("PATCH", f"/trackers/{slug}/timers/{ids[1]}", {"name": "x"}),
        lambda c, slug, ids: c.call("POST", f"/trackers/{slug}/timers"),
        lambda c, slug, ids: c.call("POST", f"/trackers/{slug}/discard-day"),
    ):
        c, slug, ids = ran_through_the_end()
        c.now = at(PUNE, "2026-11-17T10:00")
        read(c, slug, ids)
        saved = c.db.prepare("SELECT date, saved_at_ms FROM history_days").bind()._execute()
        assert saved == [{"date": "2026-11-15", "saved_at_ms": at(PUNE, "2026-11-16T23:59")}]
        assert rows(c, "open_days") == 0
        assert rows(c, "history_values") == 3


def test_after_the_end_starts_are_refused_and_stop_finds_nothing_left_to_stop():
    c, slug, ids = ran_through_the_end()
    c.now = at(PUNE, "2026-11-17T00:30")
    status, body = c.call("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    assert (status, body["code"]) == (409, "day_ended")
    assert body["error"] == "This day has ended and saved itself. Press Start today for the next one."
    for path in ("/start-all", "/relaunch", "/clear-all", "/timers"):
        assert c.call("POST", f"/trackers/{slug}{path}")[1]["code"] == "day_ended", path
    # a Stop sent from a tab that had not yet seen the end: the timer already stopped at it
    t = c.ok("POST", f"/trackers/{slug}/timers/{ids[2]}/stop")["tracker"]
    assert t["last_outcome"] == "saved" and all(x["running_since_ms"] is None for x in t["timers"])
    assert c.history(slug)["days"][0]["values"][str(ids[2])] == 59 * MINUTE


def test_a_stop_pressed_at_the_end_never_counts_past_it():
    c, slug, ids = ran_through_the_end()
    end = at(PUNE, "2026-11-16T23:59")
    c.now = end - 200
    c.ok("POST", f"/trackers/{slug}/timers/{ids[2]}/stop", {"pressed_at_ms": end + 700})
    c.now = end
    assert c.history(slug)["days"][0]["values"][str(ids[2])] == 59 * MINUTE


def test_closing_twice_saves_once():
    c, slug, ids = ran_through_the_end()
    c.now = at(PUNE, "2026-11-17T00:00")
    first = c.tracker(slug)
    c.advance(HOUR)
    assert c.tracker(slug)["saved_day"] == first["saved_day"]
    assert rows(c, "history_days") == 1 and rows(c, "history_values") == 3


def test_a_removed_timer_is_not_saved_with_the_day():
    c, slug = started()
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[1]}/start")
    c.advance(MINUTE)
    c.ok("DELETE", f"/trackers/{slug}/timers/{ids[1]}")
    c.advance(DAY)
    assert c.history(slug)["days"][0]["values"] == {str(ids[0]): 0, str(ids[2]): 0}


def test_list_rows_show_the_open_days_end_and_a_closed_day_as_saved():
    c, slug = started(now=at(PUNE, "2026-11-15T23:59"))
    row = c.ok("GET", "/trackers")["trackers"][0]
    assert row["open_day"] == {"date": "2026-11-15", "tz": PUNE, "day_end_ms": at(PUNE, "2026-11-16T23:59"), "running": 0}
    c.now = at(PUNE, "2026-11-16T23:59")
    row = c.ok("GET", "/trackers")["trackers"][0]
    assert row["open_day"] is None and row["last_outcome"] == "saved" and row["saved_date"] == "2026-11-15"


# ── Discard last day: the open day, before its end ───────────────────────────

def test_discard_deletes_the_open_day_before_its_end_and_it_never_reaches_history():
    c, slug = started()
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(2 * HOUR)
    t = c.ok("POST", f"/trackers/{slug}/discard-day")["tracker"]  # allowed with a timer running
    assert t["open_day"] is None and t["last_outcome"] == "discarded" and t["saved_day"] is None
    assert all(x["acc_ms"] == 0 for x in t["timers"])
    assert c.history(slug)["days"] == []
    for table in ("open_days", "open_day_timers", "history_days", "history_values"):
        assert rows(c, table) == 0, table
    # a discarded date was never saved, so it can start again
    assert c.start_today(slug)[0] == 200


def test_nothing_to_discard_without_a_day_or_once_it_saved_itself():
    c = Client()
    slug = c.new_tracker()
    assert c.call("POST", f"/trackers/{slug}/discard-day")[1]["code"] == "no_day"
    c.start_today(slug)
    c.advance(DAY)
    assert c.call("POST", f"/trackers/{slug}/discard-day")[1]["code"] == "no_day"
    assert [d["date"] for d in c.history(slug)["days"]] == ["2026-11-15"]


def test_save_last_day_is_no_longer_a_request():
    c, slug = started()
    assert c.call("POST", f"/trackers/{slug}/save-day")[0] == 404


# ── a day open when this rule shipped (migration 0003) ───────────────────────

def _db_before_0003() -> SqliteD1:
    db = SqliteD1(sqlite3.connect(":memory:"))
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        if migration.name < "0003":
            db.executescript(migration.read_text())
    return db


def _open_old_day(db, slug: str, started_at: int, running_since: int | None) -> None:
    """A day as the calendar rule left it: its date's midnight-to-midnight bounds."""
    day = stamp(PUNE, "2026-11-15")
    db.executescript(f"""
        INSERT INTO users (id, email, created_at_ms) VALUES (1, 'owner@example.com', 0) ON CONFLICT DO NOTHING;
        INSERT INTO trackers (user_id, slug, name, created_at_ms) VALUES (1, '{slug}', '{slug}', 0);
        INSERT INTO timers (tracker_id, position, name) SELECT id, 1, '' FROM trackers WHERE slug = '{slug}';
        INSERT INTO open_days (tracker_id, date, tz, tz_label, day_start_ms, day_end_ms, started_at_ms)
          SELECT id, '2026-11-15', '{PUNE}', 'Pune (IST)', {day['day_start_ms']}, {day['day_end_ms']}, {started_at}
            FROM trackers WHERE slug = '{slug}';
        INSERT INTO open_day_timers (timer_id, tracker_id, acc_ms, running_since_ms, changed_at_ms)
          SELECT t.id, t.tracker_id, 0, {'NULL' if running_since is None else running_since}, {started_at}
            FROM timers t JOIN trackers tr ON tr.id = t.tracker_id WHERE tr.slug = '{slug}';
    """)


def test_migration_gives_a_day_already_open_the_window_from_its_own_start():
    db = _db_before_0003()
    started_at = at(PUNE, "2026-11-15T20:00")
    _open_old_day(db, "fresh", started_at, None)
    _open_old_day(db, "stale", at(PUNE, "2026-11-15T07:00"), at(PUNE, "2026-11-15T09:00"))
    db.executescript((MIGRATIONS / "0003_day_window.sql").read_text())
    c = Client(db, now_ms=at(PUNE, "2026-11-16T08:00"))
    # opened 20:00 on the 15th: open until 20:00 on the 16th, not midnight
    fresh = c.tracker("fresh")
    assert fresh["phase"] == "live"
    assert (fresh["open_day"]["day_start_ms"], fresh["open_day"]["day_end_ms"]) == (started_at, started_at + DAY)
    # opened 07:00 on the 15th with a timer running since 09:00: its end (07:00 on the 16th)
    # has passed, so the first request closes it there and the timer stops at that end
    stale = c.tracker("stale")
    assert stale["open_day"] is None and stale["last_outcome"] == "saved"
    assert stale["saved_day"]["saved_at_ms"] == at(PUNE, "2026-11-16T07:00")
    assert list(c.history("stale")["days"][0]["values"].values()) == [22 * HOUR]


def test_migrations_dir_still_numbers_every_file():
    names = sorted(p.name for p in Path(MIGRATIONS).glob("*.sql"))
    assert [n[:4] for n in names] == [f"{i:04d}" for i in range(1, len(names) + 1)]
