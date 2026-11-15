"""Changes are accepted only from the app's own pages: a request that is not a GET must carry
the app's own origin in its ``Origin`` header, which another site cannot forge."""

from types import SimpleNamespace

from helpers import SITE, Client

from time_track.auth import origin_header, request_origin

REFUSED = (403, {"error": "cross-site request refused"})


def started_tracker(c: Client) -> tuple[str, list[int]]:
    slug = c.new_tracker("Workday", 3)
    c.start_today(slug)
    ids = c.timer_ids(slug)
    c.ok("POST", f"/trackers/{slug}/timers/{ids[0]}/start")
    return slug, ids


def test_a_change_from_another_site_is_refused_and_changes_nothing():
    c = Client()
    slug, ids = started_tracker(c)
    before = c.tracker(slug)
    for origin in ("https://evil.example", "https://akshayprabhakant.com.evil.example",
                   "http://akshayprabhakant.com", "null", "", None):
        c.origin = origin
        for method, path, body in (
            ("POST", "/trackers", {"name": "Planted", "timers": 1}),
            ("DELETE", f"/trackers/{slug}", None),
            ("POST", f"/trackers/{slug}/start-today", {"last_day": "discard"}),
            ("POST", f"/trackers/{slug}/save-day", None),
            ("POST", f"/trackers/{slug}/discard-day", None),
            ("POST", f"/trackers/{slug}/start-all", None),
            ("POST", f"/trackers/{slug}/stop-all", None),
            ("POST", f"/trackers/{slug}/relaunch", None),
            ("POST", f"/trackers/{slug}/clear-all", None),
            ("POST", f"/trackers/{slug}/timers", None),
            ("PATCH", f"/trackers/{slug}/timers/{ids[0]}", {"name": "x"}),
            ("DELETE", f"/trackers/{slug}/timers/{ids[0]}", None),
            ("POST", f"/trackers/{slug}/timers/{ids[0]}/stop", None),
            ("POST", f"/trackers/{slug}/timers/{ids[0]}/clear", None),
        ):
            assert c.call(method, path, body) == REFUSED, (origin, method, path)
    c.origin = SITE
    assert c.tracker(slug) == before
    assert [t["slug"] for t in c.ok("GET", "/trackers")["trackers"]] == [slug]


def test_reads_need_no_origin():
    c = Client()
    slug, _ = started_tracker(c)
    for origin in (None, "https://evil.example"):
        c.origin = origin
        for path in ("/me", "/trackers", f"/trackers/{slug}", f"/trackers/{slug}/history"):
            assert c.call("GET", path)[0] == 200, (origin, path)


def test_the_apps_own_pages_can_change_things():
    c = Client()
    slug, ids = started_tracker(c)
    assert c.call("POST", f"/trackers/{slug}/stop-all")[0] == 200
    assert c.call("PATCH", f"/trackers/{slug}/timers/{ids[0]}", {"name": "Deep work"})[0] == 200
    assert c.call("DELETE", f"/trackers/{slug}/timers/{ids[1]}")[0] == 200
    assert c.call("DELETE", f"/trackers/{slug}") == (204, None)


def test_signed_out_is_answered_before_the_origin_is_looked_at():
    c = Client(email=None)
    c.origin = "https://evil.example"
    assert c.call("POST", "/trackers", {"name": "x", "timers": 1}) == (401, {"error": "not signed in"})


def test_the_worker_reads_both_origins_from_the_request():
    request = SimpleNamespace(url="https://akshayprabhakant.com/time-track/api/trackers/workday/clear-all?x=1",
                              headers={"origin": "https://akshayprabhakant.com"})
    assert request_origin(request) == SITE == origin_header(request)
    assert request_origin(SimpleNamespace(url="http://127.0.0.1:8787/time-track/api/me")) == "http://127.0.0.1:8787"
    assert origin_header(SimpleNamespace(headers={})) is None
    # unreadable is no origin at all, never a match
    assert request_origin(SimpleNamespace(url="not a url")) == ""
    assert request_origin(object()) == ""
    assert origin_header(object()) is None
