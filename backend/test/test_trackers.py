"""Trackers: create, list, Delete tracker, the Charts page's history, per-user isolation and
the router's edges (answers 12, 13, 14, 19, C7, C8)."""

from helpers import API, MINUTE, OTHER, PUNE, SITE, Client, at

from time_track import rules


def test_create_tracker_with_1_to_15_timers_and_a_default_name():
    c = Client()
    t = c.ok("POST", "/trackers", {"name": "  Side project ", "timers": 10})["tracker"]
    assert (t["slug"], t["name"], len(t["timers"])) == ("side-project", "Side project", 10)
    assert all(x["name"] == "" for x in t["timers"])
    assert c.ok("POST", "/trackers", {"name": "", "timers": 1})["tracker"]["name"] == "Untitled tracker"
    for bad in (0, 16, "3", True, None):
        assert c.call("POST", "/trackers", {"name": "x", "timers": bad})[0] == 422
    assert c.call("POST", "/trackers", {"name": "x" * 61, "timers": 3})[0] == 422


def test_slugs_are_unique_per_user_and_never_reserved():
    c = Client()
    assert [c.new_tracker("Workday") for _ in range(3)] == ["workday", "workday-2", "workday-3"]
    assert c.new_tracker("New") == "new-2"
    assert c.new_tracker("Charts") == "charts-2"
    assert c.new_tracker("!!!") == "untitled"
    assert c.as_user(OTHER).new_tracker("Workday") == "workday"
    assert rules.slugify("Guitar practice") == "guitar-practice"


def test_list_shows_each_trackers_day_state_in_creation_order():
    c = Client(now_ms=at(PUNE, "2026-11-13T09:00"))
    thesis = c.new_tracker("Thesis", 4)
    c.start_today(thesis, "2026-11-13")
    c.ok("POST", f"/trackers/{thesis}/discard-day")
    c.now = at(PUNE, "2026-11-14T08:30")
    guitar = c.new_tracker("Guitar practice", 3)
    c.start_today(guitar, "2026-11-14")
    c.now = at(PUNE, "2026-11-15T09:02")  # Guitar practice's day ended at 08:30 and saved itself
    work = c.new_tracker("Workday", 6)
    c.start_today(work)
    c.ok("POST", f"/trackers/{work}/timers/{c.timer_ids(work)[0]}/start")
    c.new_tracker("Reading", 3)
    rows = c.ok("GET", "/trackers")["trackers"]
    assert [r["name"] for r in rows] == ["Thesis", "Guitar practice", "Workday", "Reading"]
    thesis_row, guitar_row, work_row, reading_row = rows
    assert thesis_row["open_day"] is None and thesis_row["last_outcome"] == "discarded" and thesis_row["saved_date"] is None
    assert guitar_row["open_day"] is None and guitar_row["last_outcome"] == "saved" and guitar_row["saved_date"] == "2026-11-14"
    assert work_row["open_day"] == {"date": "2026-11-15", "tz": PUNE, "day_end_ms": at(PUNE, "2026-11-16T09:02"), "running": 1}
    assert work_row["timer_count"] == 6
    assert reading_row["open_day"] is None and reading_row["last_outcome"] is None and reading_row["saved_date"] is None


def test_delete_tracker_wipes_every_row_of_it():
    c = Client()
    slug = c.new_tracker("Workday", 3)
    keep = c.new_tracker("Keep", 2)
    c.start_today(slug)
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.now = at(PUNE, "2026-11-16T09:30")  # the day ended at 09:02 and saved itself
    c.start_today(slug, "2026-11-16")
    assert c.ok("DELETE", f"/trackers/{slug}") is None
    assert c.call("GET", f"/trackers/{slug}")[0] == 404
    assert [r["slug"] for r in c.ok("GET", "/trackers")["trackers"]] == [keep]
    counts = {
        table: c.db.prepare(f"SELECT COUNT(*) AS n FROM {table}").bind()._execute()[0]["n"]
        for table in ("timers", "open_days", "open_day_timers", "history_days", "history_values")
    }
    assert counts == {"timers": 2, "open_days": 0, "open_day_timers": 0, "history_days": 0, "history_values": 0}


def test_history_lists_saved_days_with_values_per_timer():
    c = Client(now_ms=at(PUNE, "2026-11-14T09:00"))
    slug = c.new_tracker("Workday", 2)
    c.start_today(slug, "2026-11-14")
    ids = c.timer_ids(slug)
    c.ok("PATCH", f"/trackers/{slug}/timers/{ids[0]}", {"name": "Deep work"})
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    c.advance(45 * MINUTE)
    c.ok("POST", f"/trackers/{slug}/stop-all")
    c.now = at(PUNE, "2026-11-15T09:00")  # its end: the Charts page's read saves it
    h = c.history(slug)
    assert h["name"] == "Workday"
    assert h["timers"] == [
        {"id": ids[0], "name": "Deep work", "number": 1, "removed_on": None},
        {"id": ids[1], "name": "", "number": 2, "removed_on": None},
    ]
    assert h["days"] == [{"date": "2026-11-14", "tz_label": "Pune (IST)", "values": {str(ids[0]): 45 * MINUTE, str(ids[1]): 0}}]


def test_per_user_isolation():
    c = Client()
    slug = c.new_tracker("Workday", 3)
    c.start_today(slug)
    ids = c.timer_ids(slug)
    other = c.as_user(OTHER)
    assert other.ok("GET", "/trackers")["trackers"] == []
    for method, path in (("GET", ""), ("GET", "/history"), ("DELETE", ""), ("POST", "/start-today"),
                         ("POST", "/discard-day"), ("POST", "/start-all"),
                         ("POST", "/timers"), ("POST", f"/timers/{ids[0]}/start"),
                         ("PATCH", f"/timers/{ids[0]}"), ("DELETE", f"/timers/{ids[0]}")):
        status, _ = other.call(method, f"/trackers/{slug}{path}", {"name": "x"} if method == "PATCH" else None)
        assert status == 404, (method, path)
    # the other user's tracker of the same name is theirs alone
    mine = other.new_tracker("Workday", 2)
    assert mine == "workday"
    assert len(c.tracker(slug)["timers"]) == 3 and len(other.tracker(mine)["timers"]) == 2
    # another user's timer id under my own tracker is not found either
    other_ids = other.timer_ids(mine)
    assert c.call("POST", f"/trackers/{slug}/timers/{other_ids[0]}/start")[0] == 404


def test_every_route_needs_an_identity():
    c = Client(email=None)
    for method, path in (("GET", "/me"), ("GET", "/trackers"), ("POST", "/trackers"), ("GET", "/trackers/x")):
        assert c.call(method, path) == (401, {"error": "not signed in"})


def test_me_answers_the_email_and_server_time():
    c = Client(email="Owner@Example.com ".strip().lower())
    assert c.ok("GET", "/me") == {"email": "owner@example.com", "now_ms": c.now}


def test_router_edges():
    import asyncio

    from time_track.api import MALFORMED, handle

    c = Client()
    assert c.call("GET", "/nope")[0] == 404
    assert c.call("PUT", "/trackers")[0] == 405
    assert c.call("POST", "/trackers", ["not", "an", "object"])[0] == 422
    assert asyncio.run(handle(c.db, "POST", API + "/trackers", MALFORMED, c.email, c.now, SITE, SITE))[0] == 400
    assert asyncio.run(handle(c.db, "GET", "/quiz/api/me", None, c.email, c.now, SITE, SITE))[0] == 404
    assert c.call("GET", "/trackers/")[0] == 200
