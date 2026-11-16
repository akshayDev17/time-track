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


class Counting:
    """A database that counts round trips: each awaited statement, and each whole batch."""

    def __init__(self, db):
        self._db = db
        self.trips = 0

    def prepare(self, sql: str):
        counter = self
        statement = self._db.prepare(sql)

        class Counted:
            _sql = sql

            def __init__(self, inner):
                self._inner = inner

            def bind(self, *params):
                return Counted(self._inner.bind(*params))

            async def first(self):
                counter.trips += 1
                return await self._inner.first()

            async def all(self):
                counter.trips += 1
                return await self._inner.all()

            async def run(self):
                counter.trips += 1
                return await self._inner.run()

        return Counted(statement)

    async def batch(self, statements):
        self.trips += 1
        return await self._db.batch([s._inner for s in statements])


def test_start_and_stop_are_two_round_trips_each_and_answer_the_state_they_wrote():
    import asyncio

    from helpers import API, OWNER, SITE
    from time_track.api import handle

    c, slug, ids = live()
    c.advance(MINUTE)
    db = Counting(c.db)
    for action in ("start", "stop"):
        db.trips = 0
        press = {"pressed_at_ms": c.now - 200}
        status, body = asyncio.run(handle(db, "POST", f"{API}/trackers/{slug}/timers/{ids[1]}/{action}", press, OWNER, c.now, SITE, SITE))
        # the user's id, then one batch: the guarded write and every read of the reply
        assert (status, db.trips) == (200, 2), (action, db.trips)
        assert body == c.ok("GET", f"/trackers/{slug}")
        c.advance(MINUTE)
    assert times(c, slug)[1] == MINUTE


def test_a_refused_start_writes_nothing():
    c = Client(now_ms=at(PUNE, "2026-11-15T23:59"))
    slug = c.new_tracker("Workday", 2)
    c.start_today(slug)
    ids = c.timer_ids(slug)
    c.advance(2 * MINUTE)  # the date has ended where the day began
    status, body = c.call("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    assert (status, body["code"]) == (409, "day_ended")
    assert c.call("POST", f"/trackers/{slug}/start-all")[1]["code"] == "day_ended"
    assert all(t["running_since_ms"] is None for t in c.tracker(slug)["timers"])


# ── press times: a press is stamped when it was pressed, within a short window ──

def pressed(c, slug, path, ms):
    return c.ok("POST", f"/trackers/{slug}/{path}", {"pressed_at_ms": ms})["tracker"]["timers"]


def test_stop_one_then_start_another_is_stamped_at_each_press_not_when_it_arrives():
    c, slug, ids = live(2)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(MINUTE)
    stop_press = c.now
    c.advance(1_500)  # the stop's answer is slow; the start, pressed 100 ms after it, waited for it
    pressed(c, slug, f"timers/{ids[0]}/stop", stop_press)
    c.advance(1_500)
    timers = pressed(c, slug, f"timers/{ids[1]}/start", stop_press + 100)
    assert timers[0]["acc_ms"] == MINUTE
    assert timers[1]["running_since_ms"] == stop_press + 100


def test_a_press_time_inside_the_window_stamps_every_timer_action():
    c, slug, ids = live(2)
    c.advance(MINUTE)
    since = c.now - 10_000
    assert pressed(c, slug, "start-all", since)[0]["running_since_ms"] == since  # as old as allowed
    c.advance(MINUTE)
    assert pressed(c, slug, "stop-all", c.now - 4_000)[0]["acc_ms"] == MINUTE + 6_000
    assert pressed(c, slug, "relaunch", c.now + 1_000)[1]["running_since_ms"] == c.now + 1_000  # within the skew
    c.advance(MINUTE)
    assert pressed(c, slug, f"timers/{ids[1]}/stop", c.now - 1_000)[1]["acc_ms"] == MINUTE + 6_000 + MINUTE - 2_000
    assert pressed(c, slug, f"timers/{ids[1]}/start", c.now - 500)[1]["running_since_ms"] == c.now - 500


def test_a_press_time_ahead_beyond_the_skew_or_older_than_ten_seconds_uses_the_server_clock():
    c, slug, ids = live(2)
    assert pressed(c, slug, f"timers/{ids[0]}/start", c.now + 1_001)[0]["running_since_ms"] == c.now
    c.advance(MINUTE)
    assert pressed(c, slug, f"timers/{ids[0]}/stop", c.now - 10_001)[0]["acc_ms"] == MINUTE
    for junk in ("123", True, 1.5, None):
        c.ok("POST", f"/trackers/{slug}/timers/{ids[1]}/start", {"pressed_at_ms": junk})
        assert c.tracker(slug)["timers"][1]["running_since_ms"] == c.now
        c.ok("POST", f"/trackers/{slug}/timers/{ids[1]}/stop")
        c.advance(MINUTE)


def test_a_press_time_earlier_than_the_timers_last_change_uses_the_server_clock():
    c, slug, ids = live(2)
    c.advance(MINUTE)
    started = c.now
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(5_000)
    # a stop never before the run began
    assert pressed(c, slug, f"timers/{ids[0]}/stop", started - 1)[0]["acc_ms"] == 5_000
    stopped = c.now
    c.advance(5_000)
    # a start never before the last stop, so no time is counted twice
    assert pressed(c, slug, f"timers/{ids[0]}/start", stopped - 1)[0]["running_since_ms"] == c.now
    # nor before a Clear
    c.ok("POST", f"/trackers/{slug}/stop-all")
    c.advance(5_000)
    cleared = c.now
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/clear")
    c.advance(1_000)
    assert pressed(c, slug, f"timers/{ids[0]}/start", cleared - 1)[0]["running_since_ms"] == c.now
    # each timer is judged by its own last change: a press is used on one and not another
    c.advance(1_000)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/stop")
    c.advance(1_000)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[1]}/start")
    second_start = c.now
    c.advance(1_000)
    c.ok("POST", f"/trackers/{slug}/stop-all")  # stops only ids[1]
    c.advance(2_000)
    timers = pressed(c, slug, "relaunch", second_start + 500)
    assert [t["running_since_ms"] for t in timers] == [second_start + 500, c.now]


def test_a_press_time_before_the_day_began_or_the_timer_was_added_uses_the_server_clock():
    c, slug, ids = live(2)
    # 1 ms old, inside the window, but before Start today
    assert pressed(c, slug, f"timers/{ids[0]}/start", c.now - 1)[0]["running_since_ms"] == c.now
    c.advance(5_000)
    # the same press on a timer that was there all along is used
    assert pressed(c, slug, f"timers/{ids[1]}/start", c.now - 1)[1]["running_since_ms"] == c.now - 1
    added = c.ok("POST", f"/trackers/{slug}/timers")["tracker"]["timers"][-1]["id"]
    assert pressed(c, slug, f"timers/{added}/start", c.now - 1)[-1]["running_since_ms"] == c.now
    c.advance(5_000)
    later = c.ok("POST", f"/trackers/{slug}/timers")["tracker"]["timers"][-1]["id"]
    c.advance(2_000)
    # pressed after it was added: used
    assert pressed(c, slug, f"timers/{later}/start", c.now - 1_000)[-1]["running_since_ms"] == c.now - 1_000
