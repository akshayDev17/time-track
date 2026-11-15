"""The deploy's Access check against fixture app lists.

Run: python3 -B .github/scripts/test_access_check.py
The fixtures are flat records as access_check.main() builds them from the Cloudflare API:
today (nothing covers /time-track, so every deploy is refused), the planned split of
docs/deploy.md §A (passes), and the ways it can go wrong.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from access_check import PROTECTED_PATHS, PUBLIC_PATHS, can_reach_app, find_problems, resolve  # noqa: E402

H = "akshayprabhakant.com"
PUBLIC = [f"{H}/time-track", f"{H}/time-track/_next/*"]


def app(name, uris, decisions, type="self_hosted"):
    return {"name": name, "type": type, "uris": uris, "decisions": decisions}


QUIZ = app("Quiz Room", [f"{H}/quiz/*"], ["allow"])
QUIZ_PUBLIC = app("Quiz Room (public)", [f"{H}/quiz", f"{H}/quiz/_next/*"], ["bypass"])
GRAPH = app("graph-notes (/graph)", [f"{H}/graph", f"{H}/graph/*"], ["allow"])
ELSEWHERE = app("status page", ["status.example.org/*"], ["bypass"])
OTHERS = [QUIZ, QUIZ_PUBLIC, GRAPH, ELSEWHERE]

SIGNED_IN = app("Time Track", [f"{H}/time-track/*"], ["allow"])
PUBLIC_APP = app("Time Track (public)", PUBLIC, ["bypass"])
PLANNED = OTHERS + [SIGNED_IN, PUBLIC_APP]


def refusals(apps):
    return find_problems(apps)[0]


class Passes(unittest.TestCase):
    def test_planned_split(self):
        problems, notes = find_problems(PLANNED)
        self.assertEqual(problems, [])
        for path in PROTECTED_PATHS:
            self.assertIn(f"{H}{path}: signed in only, by 'Time Track'.", notes)
        for path in PUBLIC_PATHS:
            self.assertIn(f"{H}{path}: public, by the Bypass on 'Time Track (public)'.", notes)

    def test_destination_spelling_is_normalized(self):
        apps = [app("Time Track", [f"https://{H.upper()}/time-track/*"], ["allow"]),
                app("Time Track (public)", [f"{H}/time-track/", f"https://{H}/time-track/_next/*"], ["bypass"])]
        self.assertEqual(refusals(apps), [])


class Refuses(unittest.TestCase):
    def assertRefused(self, apps, *fragments):
        problems = refusals(apps)
        self.assertTrue(problems, "expected the deploy to be refused")
        for fragment in fragments:
            self.assertTrue(any(fragment in p for p in problems), f"{fragment!r} not in {problems}")

    def test_today_nothing_covers_time_track(self):
        self.assertRefused(OTHERS, *(f"No Cloudflare Access self-hosted application covers {H}{p}" for p in PROTECTED_PATHS))

    def test_bootstrap_default_hides_the_public_page(self):
        # portfolio-app bootstrap makes one Allow app over /time-track and /time-track/*.
        apps = OTHERS + [app("Time Track", [f"{H}/time-track", f"{H}/time-track/*"], ["allow"])]
        self.assertRefused(apps, f"covering {H}/time-track, has no Bypass policy", f"covering {H}/time-track/_next/static/probe.js, has no Bypass policy")

    def test_signed_in_app_alone(self):
        self.assertRefused(OTHERS + [SIGNED_IN], f"No Bypass application covers {H}/time-track,")

    def test_bypass_on_the_whole_prefix(self):
        apps = OTHERS + [SIGNED_IN, app("Time Track (public)", PUBLIC + [f"{H}/time-track/*"], ["bypass"])]
        self.assertRefused(apps, f"outside the public list: {H}/time-track/*", f"covering {H}/time-track/api/me, has a Bypass policy")

    def test_bypass_reaching_a_tracker_page_or_the_api(self):
        for extra in (f"{H}/time-track/new", f"{H}/time-track/api/*", f"{H}/time-track/index.txt"):
            apps = OTHERS + [SIGNED_IN, app("Time Track (public)", PUBLIC + [extra], ["bypass"])]
            self.assertRefused(apps, f"outside the public list: {extra}")

    def test_bypass_over_the_whole_host(self):
        self.assertRefused(PLANNED + [app("site", [H], ["bypass"])], f"outside the public list: {H}/*")

    def test_bypass_on_a_glob_reaching_in(self):
        self.assertRefused(PLANNED + [app("glob", [f"{H}/time-*"], ["bypass"])], f"{H}/time-*")

    def test_allow_and_bypass_on_the_signed_in_app(self):
        apps = OTHERS + [app("Time Track", [f"{H}/time-track/*"], ["allow", "bypass"]), PUBLIC_APP]
        self.assertRefused(apps, f"covering {H}/time-track/api/trackers, has a Bypass policy")

    def test_protected_path_whose_app_has_no_allow(self):
        apps = PLANNED + [app("api lockout", [f"{H}/time-track/api/*"], ["deny"])]
        self.assertRefused(apps, f"'api lockout', the most specific one covering {H}/time-track/api/me, has no Allow policy")

    def test_only_self_hosted_apps_protect(self):
        apps = OTHERS + [app("bookmark", [f"{H}/time-track/*"], ["allow"], type="bookmark"), PUBLIC_APP]
        self.assertRefused(apps, f"covers {H}/time-track/new")


class Matching(unittest.TestCase):
    def test_exact_beats_wildcard_and_wildcard_skips_its_parent(self):
        self.assertEqual([a["name"] for a in resolve(PLANNED, "/time-track")], ["Time Track (public)"])
        self.assertEqual([a["name"] for a in resolve(PLANNED, "/time-track/_next/static/x.js")], ["Time Track (public)"])
        self.assertEqual([a["name"] for a in resolve(PLANNED, "/time-track/workday")], ["Time Track"])
        self.assertEqual(resolve([SIGNED_IN], "/time-track"), [])

    def test_what_reaches_time_track(self):
        for uri in [f"{H}/time-track", f"{H}/time-track/*", f"{H}/*", H, f"{H}/time*", f"{H}/time-track/"]:
            self.assertTrue(can_reach_app(uri), uri)
        for uri in [f"{H}/time-tracker", f"{H}/quiz/*", f"{H}/time", f"www.{H}/time-track", "status.example.org/*"]:
            self.assertFalse(can_reach_app(uri), uri)


if __name__ == "__main__":
    unittest.main()
