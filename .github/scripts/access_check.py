"""Refuse a deploy unless Cloudflare Access guards Time Track the way it should.

Both deploy jobs in .github/workflows/ci.yml run this before they deploy anything: the
login check that comes before any exposure. Until the owner has applied the Access split in
docs/deploy.md §A it refuses, so nothing deploys.

It asks the Cloudflare API rather than requesting pages: Cloudflare answers GitHub's runners
with a bare 403 and no redirect to the Access login, so a curl check (or
`portfolio-app verify`, which is that curl) cannot pass in CI; the quiz app and the archive
found this and check the API the same way. The deploy token needs the account permission
"Access: Apps and Policies Read" (docs/deploy.md §C).

The rules (docs/deploy.md §A):

1. Every PROTECTED path (the trackers pages and the API) resolves to an Access application
   with an Allow policy and no Bypass policy: signed in only.
2. Every PUBLIC path (the public page and its code) resolves to an application with a
   Bypass policy: the demo is reachable signed out.
3. Any application with a Bypass policy whose destinations touch /time-track or anything
   below it holds only PUBLIC_DESTINATIONS, so a Bypass can never widen past them.

A path resolves to the most specific self-hosted application covering it, because that is
the one Cloudflare enforces: "When multiple rules are set for a common root path, the more
specific rule takes precedence."
https://developers.cloudflare.com/cloudflare-one/policies/access/app-paths/
An exact destination beats any wildcard, and a longer pattern beats a shorter one; a
`<prefix>/*` wildcard does not cover its own parent path. A Bypass wins over an Allow on the
same application, because "Bypass and Service Auth policies are evaluated first".
https://developers.cloudflare.com/cloudflare-one/policies/access/#order-of-execution

Response shapes, from Cloudflare's API reference:
  apps:     GET /accounts/{id}/access/apps (page/per_page); each app has `type`,
            `destinations[]` ({type, uri}) or the legacy `domain`/`self_hosted_domains`, and
            `policies[]` whose items carry `decision` (allow|deny|non_identity|bypass).
            https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/list/
  policies: GET /accounts/{id}/access/policies/{policy_id}, for a reusable policy listed
            without its `decision`.
            https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/policies/methods/get/

`find_problems` is the whole judgement; test_access_check.py runs it against fixtures.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

HOST = "akshayprabhakant.com"
APP = "/time-track"
PERMISSION = "Access: Apps and Policies Read"

# Signed-in only: the trackers pages (a sample of each route family worker.js serves) and
# the API. A Bypass reaching any of them fails.
PROTECTED_PATHS = [
    "/time-track/new",
    "/time-track/signin",
    "/time-track/tracker",
    "/time-track/workday",
    "/time-track/workday/charts",
    "/time-track/index.html",
    "/time-track/api/me",
    "/time-track/api/trackers",
    "/time-track/api/trackers/workday/history",
]

# The only destinations a Bypass application may hold, and all it must hold: the public page
# (which shows the demo signed out, and asks the API, signed in only, whether to show the
# Trackers list instead) and its static code. The page's favicon is inline, so nothing else
# under /time-track is fetched signed out.
PUBLIC_DESTINATIONS = [
    "/time-track",
    "/time-track/_next/*",
]

# One concrete path per public destination, to resolve like a request would.
PUBLIC_PATHS = [d[:-2] + "/static/probe.js" if d.endswith("/*") else d for d in PUBLIC_DESTINATIONS]


def normalize(uri):
    """`https://Host/a/` -> `host/a`; a bare host covers all of it, `host/*`."""
    uri = uri.strip().split("://", 1)[-1]
    host, slash, rest = uri.partition("/")
    if not slash or not rest:
        return host.lower() + "/*"
    uri = host.lower() + "/" + rest
    return uri if uri.endswith("/*") else uri.rstrip("/")


def glob(pattern):
    """Cloudflare's `*` matches any run of characters, slashes included."""
    return re.compile("".join(".*" if c == "*" else re.escape(c) for c in pattern))


def specificity(uri, path):
    """How specifically destination `uri` covers HOST+path, or None if it does not."""
    pattern = normalize(uri)
    if not glob(pattern).fullmatch(HOST + path):
        return None
    return ("*" not in pattern, len(pattern))


def can_match_below(pattern, prefix):
    """Whether glob `pattern` matches at least one string starting with `prefix`."""
    for i, c in enumerate(pattern):
        if c == "*" or i == len(prefix):
            return True
        if c != prefix[i]:
            return False
    return len(pattern) >= len(prefix)


def can_reach_app(uri):
    """Whether a destination matches /time-track or any path below it."""
    host, _, path = normalize(uri).partition("/")
    path = "/" + path
    if not glob(host).fullmatch(HOST):
        return False
    return bool(glob(path).fullmatch(APP)) or can_match_below(path, APP + "/")


def resolve(apps, path):
    """The self-hosted applications Cloudflare enforces on HOST+path."""
    ranked = []
    for app in apps:
        ranks = [r for r in (specificity(u, path) for u in app["uris"]) if r]
        if app["type"] == "self_hosted" and ranks:
            ranked.append((max(ranks), app))
    if not ranked:
        return []
    best = max(rank for rank, _ in ranked)
    return [app for rank, app in ranked if rank == best]


def find_problems(apps):
    """Every reason to refuse the deploy, for flat app records.

    Each app is {"name", "type", "uris": [destination], "decisions": [str]}.
    Returns (problems, notes); an empty `problems` means deploy.
    """
    problems, notes = [], []
    allowed = {HOST + d for d in PUBLIC_DESTINATIONS}
    public_list = ", ".join(HOST + d for d in PUBLIC_DESTINATIONS)

    for app in apps:
        if "bypass" not in app["decisions"] or not any(can_reach_app(u) for u in app["uris"]):
            continue
        extra = [u for u in map(normalize, app["uris"]) if u not in allowed]
        if extra:
            problems.append(
                f"The Access application '{app['name']}' has a Bypass policy, reaches {HOST}{APP}, and holds destinations outside the public list: {', '.join(extra)}. "
                f"Cloudflare evaluates Bypass before Allow, so anyone can reach them. A Bypass application touching Time Track may hold only {public_list} (docs/deploy.md §A)."
            )

    for path in PROTECTED_PATHS:
        enforced = resolve(apps, path)
        if not enforced:
            problems.append(f"No Cloudflare Access self-hosted application covers {HOST}{path}, so it would be public. Apply docs/deploy.md §A before deploying.")
        for app in enforced:
            if "bypass" in app["decisions"]:
                problems.append(f"The Access application '{app['name']}', the most specific one covering {HOST}{path}, has a Bypass policy, so anyone can reach a signed-in-only path. Remove {path} from it, or its Bypass policy, before deploying.")
            elif "allow" not in app["decisions"]:
                problems.append(f"The Access application '{app['name']}', the most specific one covering {HOST}{path}, has no Allow policy, so nobody can sign in. Add an Allow policy before deploying.")
            else:
                notes.append(f"{HOST}{path}: signed in only, by '{app['name']}'.")

    for path in PUBLIC_PATHS:
        enforced = resolve(apps, path)
        if not enforced:
            problems.append(f"No Bypass application covers {HOST}{path}, so the public page cannot load signed out. Apply docs/deploy.md §A before deploying.")
        for app in enforced:
            if "bypass" in app["decisions"]:
                notes.append(f"{HOST}{path}: public, by the Bypass on '{app['name']}'.")
            else:
                problems.append(f"The Access application '{app['name']}', the most specific one covering {HOST}{path}, has no Bypass policy, so the public page is behind sign-in. Add {public_list} to the Bypass application of docs/deploy.md §A before deploying.")

    return problems, notes


def fail(message):
    print(f"::error::{message}")
    sys.exit(1)


def main():
    # A stored secret can end in a newline, which http.client rejects in a header.
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    if not token or not account:
        fail("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must both be set under Settings → Environments → production → Environment secrets (docs/deploy.md §C). Refusing to deploy.")

    def call(endpoint):
        req = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/accounts/{account}{endpoint}",
            headers={"Authorization": f"Bearer {token}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = json.load(resp)
        except urllib.error.HTTPError as err:
            try:
                body = json.load(err)
            except ValueError:
                body = {}
            codes = {e.get("code") for e in body.get("errors", [])}
            if err.code in (401, 403) or 10000 in codes:
                fail(f"The deploy token cannot read Cloudflare Access (HTTP {err.code}). Add the account permission '{PERMISSION}' to it, then re-run. The token value and the GitHub secret do not change.")
            fail(f"Cloudflare API {endpoint} returned HTTP {err.code}: {[e.get('message') for e in body.get('errors', [])]}")
        except (urllib.error.URLError, TimeoutError, ValueError) as err:
            fail(f"Could not ask the Cloudflare API whether {HOST}{APP} is behind Access: {err}")
        if not body.get("success"):
            fail(f"Cloudflare API {endpoint} did not succeed: {[e.get('message') for e in body.get('errors', [])]}")
        return body

    def list_apps():
        apps, page = [], 1
        while True:
            body = call(f"/access/apps?page={page}&per_page=100")
            batch = body.get("result") or []
            apps.extend(batch)
            total = (body.get("result_info") or {}).get("total_pages")
            if not batch or (total is not None and page >= total) or (total is None and len(batch) < 100):
                return apps
            page += 1

    def app_uris(app):
        dests = app.get("destinations") or []
        if dests:
            return [d.get("uri", "") for d in dests if d.get("type", "public") == "public"]
        return [u for u in [app.get("domain") or ""] + list(app.get("self_hosted_domains") or []) if u]

    fetched = {}

    def decision(policy):
        if isinstance(policy, dict) and policy.get("decision"):
            return policy["decision"]
        policy_id = policy if isinstance(policy, str) else (policy or {}).get("id")
        if not policy_id:
            return None
        if policy_id not in fetched:
            fetched[policy_id] = (call(f"/access/policies/{policy_id}").get("result") or {}).get("decision")
        return fetched[policy_id]

    apps = [
        {"name": app.get("name"), "type": app.get("type"), "uris": uris,
         "decisions": [decision(p) for p in app.get("policies") or []]}
        for app in list_apps()
        for uris in [app_uris(app)]
        if any(can_reach_app(u) for u in uris)
    ]
    problems, notes = find_problems(apps)
    for message in problems:
        print(f"::error::{message}")
    if problems:
        sys.exit(1)
    print("\n".join(notes))


if __name__ == "__main__":
    main()
