"""Timers on today's open day: the card buttons, Start all / Stop all / Relaunch / Clear all,
and add, remove, rename up to 15 (answers 7, 8, 10, 11, 12, F, B1, B2, C5)."""

from helpers import MINUTE, PUNE, Client, at, elapsed


def live(timers=3):
    c = Client()
    slug = c.new_tracker("Workday", timers)
    assert c.start_today(slug)[0] == 200
    return c, slug, c.timer_ids(slug)


def times(c, slug):
    return [elapsed(t, c.now) for t in c.tracker(slug)["timers"]]


def test_times_are_start_stop_timestamps_not_counters():
    c, slug, ids = live()
    t = c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    assert t["now_ms"] == c.now and t["tracker"]["timers"][0]["running_since_ms"] == c.now
    c.advance(65_432)
    # nothing was written while it ran; the time comes from the server clock
    t = c.tracker(slug)["timers"][0]
    assert t["acc_ms"] == 0 and elapsed(t, c.now) == 65_432
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/stop")
    assert c.tracker(slug)["timers"][0] == {"id": ids[0], "name": "", "acc_ms": 65_432, "running_since_ms": None}


def test_every_device_reads_the_same_tenths():
    c, slug, ids = live()
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(12_345)
    laptop = c.ok("GET", f"/trackers/{slug}")
    phone = c.as_user(c.email).ok("GET", f"/trackers/{slug}")
    assert laptop == phone
    assert (laptop["now_ms"] - laptop["tracker"]["timers"][0]["running_since_ms"]) // 100 == 123


def test_start_twice_and_stop_twice_change_nothing():
    c, slug, ids = live()
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    since = c.tracker(slug)["timers"][0]["running_since_ms"]
    c.advance(MINUTE)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    assert c.tracker(slug)["timers"][0]["running_since_ms"] == since
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/stop")
    c.advance(MINUTE)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/stop")
    assert times(c, slug)[0] == MINUTE


def test_resume_adds_to_the_time_and_clear_resets_a_stopped_timer():
    c, slug, ids = live()
    for _ in range(2):
        c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
        c.advance(MINUTE)
        c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/stop")
        c.advance(MINUTE)
    assert times(c, slug)[0] == 2 * MINUTE
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/clear")
    assert times(c, slug)[0] == 0


def test_clear_refuses_a_running_timer():
    c, slug, ids = live()
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    assert c.call("POST", f"/trackers/{slug}/timers/{ids[0]}/clear")[1]["code"] == "timer_running"


def test_start_all_starts_only_timers_at_zero_and_relaunch_resumes_only_stopped_ones_with_time():
    c, slug, ids = live(4)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(MINUTE)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/stop")  # 0: stopped with time
    c.ok("POST", f"/trackers/{slug}/timers/{ids[1]}/start")  # 1: running
    c.ok("POST", f"/trackers/{slug}/start-all")
    running = [t["running_since_ms"] is not None for t in c.tracker(slug)["timers"]]
    assert running == [False, True, True, True]
    assert times(c, slug)[0] == MINUTE  # Start all reset nothing
    c.advance(MINUTE)
    c.ok("POST", f"/trackers/{slug}/stop-all")
    assert not any(t["running_since_ms"] for t in c.tracker(slug)["timers"])
    c.ok("POST", f"/trackers/{slug}/timers/{ids[3]}/clear")  # 3: back to zero
    c.ok("POST", f"/trackers/{slug}/relaunch")
    running = [t["running_since_ms"] is not None for t in c.tracker(slug)["timers"]]
    assert running == [True, True, True, False]


def test_clear_all_is_refused_while_any_timer_runs_then_zeroes_everything():
    c, slug, ids = live()
    c.ok("POST", f"/trackers/{slug}/start-all")
    c.advance(MINUTE)
    status, body = c.call("POST", f"/trackers/{slug}/clear-all")
    assert status == 409 and body["error"] == "Clear all waits until every timer is stopped."
    c.ok("POST", f"/trackers/{slug}/stop-all")
    c.ok("POST", f"/trackers/{slug}/clear-all")
    assert times(c, slug) == [0, 0, 0]


def test_rename_trims_and_caps_the_name():
    c, slug, ids = live()
    c.ok("PATCH", f"/trackers/{slug}/timers/{ids[1]}", {"name": "  Meetings "})
    assert c.tracker(slug)["timers"][1]["name"] == "Meetings"
    assert c.call("PATCH", f"/trackers/{slug}/timers/{ids[1]}", {"name": "x" * 61})[0] == 422
    assert c.call("PATCH", f"/trackers/{slug}/timers/{ids[1]}", {"name": 3})[0] == 422


def test_rename_add_remove_are_refused_before_start_today():
    c = Client()
    slug = c.new_tracker("Reading", 3)
    ids = c.timer_ids(slug)
    assert c.call("PATCH", f"/trackers/{slug}/timers/{ids[0]}", {"name": "Fiction"})[1]["code"] == "no_day"
    assert c.call("POST", f"/trackers/{slug}/timers")[1]["code"] == "no_day"
    assert c.call("DELETE", f"/trackers/{slug}/timers/{ids[0]}")[1]["code"] == "no_day"
    assert c.call("POST", f"/trackers/{slug}/timers/{ids[0]}/start")[1]["code"] == "no_day"
    assert c.call("POST", f"/trackers/{slug}/start-all")[1]["code"] == "no_day"


def test_fifteen_timer_cap():
    c, slug, ids = live(14)
    t = c.ok("POST", f"/trackers/{slug}/timers")["tracker"]
    assert len(t["timers"]) == 15 and t["timers"][-1]["acc_ms"] == 0
    c.ok("POST", f"/trackers/{slug}/timers/{t['timers'][-1]['id']}/start")  # the new one works today
    status, body = c.call("POST", f"/trackers/{slug}/timers")
    assert status == 409 and body["code"] == "timer_cap"
    assert len(c.tracker(slug)["timers"]) == 15


def test_remove_drops_todays_time_and_keeps_numbering_compact():
    c, slug, ids = live(3)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[1]}/start")
    c.advance(MINUTE)
    t = c.ok("DELETE", f"/trackers/{slug}/timers/{ids[1]}")["tracker"]
    assert [x["id"] for x in t["timers"]] == [ids[0], ids[2]]
    # never saved: gone completely, not even on the Charts page
    assert [x["id"] for x in c.history(slug)["timers"]] == [ids[0], ids[2]]


def test_a_tracker_keeps_at_least_one_timer():
    c, slug, ids = live(1)
    assert c.call("DELETE", f"/trackers/{slug}/timers/{ids[0]}")[1]["code"] == "last_timer"


def test_removed_timer_keeps_its_saved_days_and_is_marked_removed():
    c, slug, ids = live(2)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[1]}/start")
    c.advance(20 * MINUTE)
    c.ok("POST", f"/trackers/{slug}/stop-all")
    c.now = at(PUNE, "2026-11-16T08:00")
    c.ok("POST", f"/trackers/{slug}/save-day")
    c.start_today(slug, "2026-11-16")
    c.ok("POST", f"/trackers/{slug}/timers/{ids[1]}/start")
    c.advance(5 * MINUTE)
    c.ok("DELETE", f"/trackers/{slug}/timers/{ids[1]}")
    assert c.timer_ids(slug) == [ids[0]]
    h = c.history(slug)
    assert h["timers"][1] == {"id": ids[1], "name": "", "number": None, "removed_on": "2026-11-16"}
    assert h["days"][0]["values"][str(ids[1])] == 20 * MINUTE
    # the next save no longer includes it, and its time today was not kept
    c.now = at(PUNE, "2026-11-17T08:00")
    c.ok("POST", f"/trackers/{slug}/save-day")
    assert str(ids[1]) not in c.history(slug)["days"][1]["values"]


def test_add_rename_and_timer_actions_404_for_an_unknown_timer():
    c, slug, ids = live()
    assert c.call("POST", f"/trackers/{slug}/timers/999999/start")[0] == 404
    assert c.call("PATCH", f"/trackers/{slug}/timers/999999", {"name": "x"})[0] == 404
