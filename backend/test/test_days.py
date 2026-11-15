"""Days: Start today, one day per date, Save last day, Discard last day (answers 1-6, B, C, E)."""

from helpers import HOUR, MINUTE, PUNE, Client, at, elapsed, stamp

AUCKLAND = "Pacific/Auckland"
SF = "America/Los_Angeles"


def started(timers=3, name="Workday", now=None):
    c = Client(now_ms=now)
    slug = c.new_tracker(name, timers)
    status, body = c.start_today(slug)
    assert status == 200, body
    return c, slug


# ── Start today ──────────────────────────────────────────────────────────────

def test_brand_new_tracker_has_no_day_and_zero_timers():
    c = Client()
    t = c.tracker(c.new_tracker("Reading", 3))
    assert t["phase"] is None and t["open_day"] is None and t["last_outcome"] is None
    assert [x["acc_ms"] for x in t["timers"]] == [0, 0, 0]


def test_start_today_opens_a_day_stamped_with_date_zone_and_server_start():
    c, slug = started()
    t = c.tracker(slug)
    assert t["phase"] == "live"
    day = t["open_day"]
    assert (day["date"], day["tz"], day["tz_label"]) == ("2026-11-15", PUNE, "Pune (IST)")
    assert day["started_at_ms"] == c.now
    assert day["day_end_ms"] == at(PUNE, "2026-11-16T00:00")
    assert all(x["acc_ms"] == 0 and x["running_since_ms"] is None for x in t["timers"])


def test_one_day_per_date_start_today_refused_while_todays_day_is_open():
    c, slug = started()
    status, body = c.start_today(slug)
    assert status == 409 and body["code"] == "day_open"
    assert body["error"] == "Today already has its day. One day per date."


def test_start_today_refused_for_a_date_already_saved_even_after_travelling():
    # Started in Auckland on Mon 16 Nov, saved after it ended there; it is still Mon 16 Nov
    # in San Francisco, so Start today there would make a second day for the same date.
    c = Client(now_ms=at(AUCKLAND, "2026-11-16T09:00"))
    slug = c.new_tracker()
    assert c.start_today(slug, "2026-11-16", AUCKLAND)[0] == 200
    c.now = at(AUCKLAND, "2026-11-17T00:05")
    c.ok("POST", f"/trackers/{slug}/save-day")
    assert c.now < at(SF, "2026-11-17T00:00")
    status, body = c.start_today(slug, "2026-11-16", SF)
    assert status == 409 and body["code"] == "date_taken"


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


def test_dst_day_of_23_hours_is_accepted():
    c = Client(now_ms=at("Europe/London", "2027-03-28T10:00"))
    slug = c.new_tracker()
    s = stamp("Europe/London", "2027-03-28")
    assert s["day_end_ms"] - s["day_start_ms"] == 23 * HOUR
    assert c.call("POST", f"/trackers/{slug}/start-today", s)[0] == 200


def test_start_today_zeroes_every_timer():
    c, slug = started()
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(30 * MINUTE)
    c.ok("POST", f"/trackers/{slug}/stop-all")
    c.now = at(PUNE, "2026-11-16T08:00")
    c.ok("POST", f"/trackers/{slug}/save-day")
    c.start_today(slug, "2026-11-16")
    assert all(x["acc_ms"] == 0 and x["running_since_ms"] is None for x in c.tracker(slug)["timers"])


# ── the Start today prompt (answer 2) ────────────────────────────────────────

def unsaved_earlier_day():
    """Thesis: a day on Fri 13 Nov, never saved; it is now Sun 15 Nov."""
    c = Client(now_ms=at(PUNE, "2026-11-13T08:47"))
    slug = c.new_tracker("Thesis", 2)
    c.start_today(slug, "2026-11-13")
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(3 * HOUR)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/stop")
    c.now = at(PUNE, "2026-11-15T14:14")
    return c, slug, ids


def test_prompt_start_today_with_an_unsaved_earlier_day_asks_first():
    c, slug, _ = unsaved_earlier_day()
    status, body = c.start_today(slug)
    assert status == 409 and body["code"] == "last_day_unsaved"
    assert c.tracker(slug)["open_day"]["date"] == "2026-11-13"


def test_prompt_save_it_first_saves_then_today_starts_at_zero():
    c, slug, ids = unsaved_earlier_day()
    status, body = c.start_today(slug, last_day="save")
    assert status == 200, body
    t = body["tracker"]
    assert t["open_day"]["date"] == "2026-11-15" and t["phase"] == "live"
    assert all(x["acc_ms"] == 0 for x in t["timers"])
    days = c.history(slug)["days"]
    assert [d["date"] for d in days] == ["2026-11-13"]
    assert days[0]["values"][str(ids[0])] == 3 * HOUR


def test_prompt_save_it_first_is_refused_while_a_timer_runs_on_that_day():
    c2, slug2, ids2 = unsaved_earlier_day()
    # leave a timer running past midnight on the 13th
    c2.now = at(PUNE, "2026-11-13T22:00")
    c2.ok("POST", f"/trackers/{slug2}/timers/{ids2[1]}/start")
    c2.now = at(PUNE, "2026-11-15T14:14")
    status, body = c2.start_today(slug2, last_day="save")
    assert status == 409 and body["code"] == "timers_running"
    assert c2.tracker(slug2)["open_day"]["date"] == "2026-11-13"
    assert c2.history(slug2)["days"] == []


def test_prompt_discard_it_deletes_the_day_then_today_starts():
    c, slug, _ = unsaved_earlier_day()
    status, body = c.start_today(slug, last_day="discard")
    assert status == 200
    assert body["tracker"]["open_day"]["date"] == "2026-11-15"
    assert c.history(slug)["days"] == []


def test_prompt_choice_without_an_unsaved_day_is_invalid():
    c = Client()
    slug = c.new_tracker()
    assert c.start_today(slug, last_day="save")[0] == 422
    assert c.start_today(slug, last_day="later")[0] == 422


# ── Save last day: unlocks when the date ends in the day's own zone (B, C) ───

def test_save_is_locked_until_the_date_ends_in_its_zone():
    c, slug = started()
    c.now = at(PUNE, "2026-11-15T23:59")
    status, body = c.call("POST", f"/trackers/{slug}/save-day")
    assert status == 409 and body["code"] == "day_not_ended"
    c.now = at(PUNE, "2026-11-16T00:00")
    assert c.tracker(slug)["phase"] == "ended"
    assert c.call("POST", f"/trackers/{slug}/save-day")[0] == 200


def test_save_unlock_follows_the_starting_zone_not_the_viewers():
    # Started in Auckland: it unlocks at Auckland's midnight, which is still the
    # afternoon of the same date in San Francisco.
    c = Client(now_ms=at(AUCKLAND, "2026-11-16T08:00"))
    slug = c.new_tracker()
    c.start_today(slug, "2026-11-16", AUCKLAND)
    c.now = at(AUCKLAND, "2026-11-17T00:00") - 1
    assert c.call("POST", f"/trackers/{slug}/save-day")[1]["code"] == "day_not_ended"
    c.now = at(AUCKLAND, "2026-11-17T00:00")
    assert c.now < at(SF, "2026-11-16T12:00")  # SF has not reached midnight
    assert c.call("POST", f"/trackers/{slug}/save-day")[0] == 200


def test_save_is_greyed_while_any_timer_runs():
    c, slug = started()
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[2]}/start")
    c.now = at(PUNE, "2026-11-16T01:00")
    status, body = c.call("POST", f"/trackers/{slug}/save-day")
    assert status == 409 and body["code"] == "timers_running"
    c.ok("POST", f"/trackers/{slug}/stop-all")
    assert c.call("POST", f"/trackers/{slug}/save-day")[0] == 200


def test_saved_day_moves_from_open_day_into_history_and_shows_read_only():
    c, slug = started()
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(90 * MINUTE)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/stop")
    c.now = at(PUNE, "2026-11-16T07:00")
    t = c.ok("POST", f"/trackers/{slug}/save-day")["tracker"]
    assert t["open_day"] is None and t["phase"] is None and t["last_outcome"] == "saved"
    assert t["saved_day"]["date"] == "2026-11-15"
    assert t["timers"][0]["acc_ms"] == 90 * MINUTE and t["timers"][0]["running_since_ms"] is None
    rows = c.db.prepare("SELECT COUNT(*) AS n FROM open_days").bind()._execute()
    assert rows[0]["n"] == 0
    assert c.history(slug)["days"][0]["values"] == {str(ids[0]): 90 * MINUTE, str(ids[1]): 0, str(ids[2]): 0}
    # read-only: timer actions are refused until the next Start today
    assert c.call("POST", f"/trackers/{slug}/timers/{ids[0]}/start")[1]["code"] == "no_day"
    assert c.call("POST", f"/trackers/{slug}/save-day")[1]["code"] == "no_day"


def test_save_after_save_is_refused_and_next_start_today_opens_a_new_date():
    c, slug = started()
    c.now = at(PUNE, "2026-11-16T07:00")
    c.ok("POST", f"/trackers/{slug}/save-day")
    status, body = c.start_today(slug, "2026-11-16")
    assert status == 200 and body["tracker"]["open_day"]["date"] == "2026-11-16"


# ── an ended day: only Stop and Stop all (view 5b, C2) ──────────────────────

def test_ended_day_with_a_timer_running_keeps_counting_and_only_stop_works():
    c, slug = started()
    ids = c.timer_ids(slug)
    c.now = at(PUNE, "2026-11-15T23:00")
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.now = at(PUNE, "2026-11-16T09:00")
    t = c.tracker(slug)
    assert t["phase"] == "ended"
    assert elapsed(t["timers"][0], c.now) == 10 * HOUR  # counted into that day past midnight
    for path in (f"/timers/{ids[1]}/start", f"/timers/{ids[0]}/clear", "/start-all", "/relaunch", "/clear-all", "/timers"):
        status, body = c.call("POST", f"/trackers/{slug}{path}")
        assert status == 409 and body["code"] == "day_ended", path
    assert c.call("PATCH", f"/trackers/{slug}/timers/{ids[0]}", {"name": "x"})[1]["code"] == "day_ended"
    assert c.call("DELETE", f"/trackers/{slug}/timers/{ids[0]}")[1]["code"] == "day_ended"
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/stop")
    assert c.tracker(slug)["timers"][0]["acc_ms"] == 10 * HOUR
    c.ok("POST", f"/trackers/{slug}/timers/{ids[1]}/stop")  # a stopped timer: nothing changes
    c.ok("POST", f"/trackers/{slug}/save-day")


def test_stop_all_works_on_an_ended_day():
    c, slug = started()
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/start-all")
    c.now = at(PUNE, "2026-11-16T01:00")
    c.ok("POST", f"/trackers/{slug}/stop-all")
    assert all(x["running_since_ms"] is None for x in c.tracker(slug)["timers"])
    assert len(ids) == 3


# ── Discard last day (E, C1) ─────────────────────────────────────────────────

def test_discard_is_locked_until_the_date_ends():
    c, slug = started()
    status, body = c.call("POST", f"/trackers/{slug}/discard-day")
    assert status == 409 and body["code"] == "day_not_ended"


def test_discard_wipes_the_day_and_it_never_reaches_history_or_charts():
    c, slug = started()
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(2 * HOUR)
    c.now = at(PUNE, "2026-11-16T10:00")
    t = c.ok("POST", f"/trackers/{slug}/discard-day")["tracker"]  # allowed with a timer running
    assert t["open_day"] is None and t["last_outcome"] == "discarded" and t["saved_day"] is None
    assert all(x["acc_ms"] == 0 for x in t["timers"])
    assert c.history(slug)["days"] == []
    for table in ("open_days", "open_day_timers", "history_days", "history_values"):
        assert c.db.prepare(f"SELECT COUNT(*) AS n FROM {table}").bind()._execute()[0]["n"] == 0, table
    # and the date is free again only in the sense that it has ended: a new date starts fine
    assert c.start_today(slug, "2026-11-16")[0] == 200


def test_nothing_to_save_or_discard_without_a_day():
    c = Client()
    slug = c.new_tracker()
    assert c.call("POST", f"/trackers/{slug}/save-day")[1]["code"] == "no_day"
    assert c.call("POST", f"/trackers/{slug}/discard-day")[1]["code"] == "no_day"
