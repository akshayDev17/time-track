# Deploying Time Track

A checklist, in order. Both deploy jobs refuse to run unless §A is in place, so nothing under
`/time-track` is ever exposed without its sign-in.

**Status (2026-11-15): §A, §B and §C are done.** With the owner's approval they were applied
with `portfolio-app`: the Access apps `time-track (/time-track)` (Allow on `time-track/*`) and
`time-track (public)` (Bypass on exactly `time-track` and `time-track/_next/*`), the D1
database `time-track` (its id is committed in `backend/wrangler.jsonc`), and the GitHub
`production` environment with its two secrets. The steps below stay as the reference for
what each one is and how to redo it.

```
akshayprabhakant.com/time-track/api/*         → backend Worker  (Python + D1)    backend/wrangler.jsonc
akshayprabhakant.com/time-track, /time-track/* → frontend Worker (static export)  frontend/wrangler.jsonc
everything else                                → unchanged
```

The routes come from the two `wrangler.jsonc` files. No site-wide path (`/api/*`, `/_next/*`,
`/vendors/*`) is claimed: the export's code lives under `/time-track/_next/`.

Cost: Workers Free and D1's free tier. No Durable Objects or other paid feature. A visible
tracker page asks the API every 3 s (only while the tab is visible), so one tab left open and
visible all day is about 29,000 requests, against the free plan's 100,000 a day.

## A. Cloudflare Access (done; the repo itself never changes Access)

The public page must stay reachable signed out, while every signed-in surface (the trackers
pages and the API) sits behind the same allowed-email list as the other apps. One Access app
over the whole prefix (what `portfolio-app bootstrap` makes) would hide the public page, so
the split is two applications. Cloudflare One → Access → Applications:

1. **`time-track (/time-track)`** — Add an application → Self-hosted.
   - Destination: domain `akshayprabhakant.com`, path `time-track/*`. Only this one: the bare
     `/time-track` goes to the public app below. `time-track/*` covers `/time-track/api/*`.
   - Session duration: 24 hours.
   - Login methods: One-time PIN (already enabled account-wide).
   - Policy: Action **Allow**, the same allowed-email list as the other apps. Attach the
     reusable policy that list lives in (`portfolio-app sign-in`), or Include → Emails with
     the same addresses as the Quiz Room's `Invited solvers`. Never Include "Login Methods:
     One-time PIN" alone: that lets any email in.
2. **`time-track (public)`** — Add an application → Self-hosted.
   - Destinations, both with domain `akshayprabhakant.com`: path `time-track`, and path
     `time-track/_next/*`. Nothing else.
   - One policy, `Time Track public page`: Action **Bypass**, Include → **Everyone**.
   - Leave everything else at its defaults.

Each public destination is more specific than `time-track/*`, so it wins; everything else
under `/time-track` stays signed in only. Then check (the Worker is not deployed yet, so the
public page itself is still a 404; what matters is that it is not the Access login):

```sh
curl -sI https://akshayprabhakant.com/time-track            # not a 302 to cloudflareaccess.com
curl -sI https://akshayprabhakant.com/time-track/workday    # 302 to <team>.cloudflareaccess.com
curl -sI https://akshayprabhakant.com/time-track/api/me     # 302 to <team>.cloudflareaccess.com
```

The deploy guard (`.github/scripts/access_check.py`) refuses any Bypass application that
reaches `/time-track` and holds anything beyond those two destinations, and any signed-in
path that is not behind an Allow-only application. Adding a public page means editing the
Access app and `PUBLIC_DESTINATIONS` there.

How a request is decided: the public page is static and identical for everyone; it asks
`/time-track/api/me` (signed in only), and shows the Trackers list when that answers, the demo
when Access redirects it to the login. The Worker reads identity from `ctx.access` only and
answers 401 to every API route without it.

## B. D1 (done)

```sh
cd frontend && npm ci && cd ../backend
../frontend/node_modules/.bin/wrangler d1 create time-track
```

Put the printed `database_id` into `backend/wrangler.jsonc` in place of
`REPLACE_AFTER_d1_create` and commit it (it is not a secret). The deploy job applies
`backend/migrations/` itself.

## C. GitHub `production` environment (done)

Settings → Environments → New environment `production`, with two environment secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`: the narrow deploy token. It needs Account · Workers Scripts · Edit,
  Zone · Workers Routes · Edit (on akshayprabhakant.com), Account · D1 · Edit, and Account ·
  Access: Apps and Policies · Read (the deploy guard reads the Access apps; it never edits
  them).

## D. site-shell

The frontend binds the `site-shell` Worker (akshayDev17/site-themes) for the theme and the
site row; it is already deployed. Until Time Track is added to site-themes' app list (a
separate follow-up there), site-shell leaves the row as this app draws it, which already
shows "Time Track" last and current.

## E. Deploy

Push to `main` (or re-run the workflow). Test, then Deploy API (Access guard, D1 checks,
migrations, Worker), then Deploy Frontend (Access guard, build, Worker).

## Local development

```sh
cd backend && uv sync && uv run python local_server.py      # API on 127.0.0.1:8787
cd frontend && npm ci && npm run dev                         # http://localhost:3000/time-track
```

`next dev` has no `worker.js`, so tracker URLs (`/time-track/<slug>`) do not resolve there and
the page has no theme or site row. For the real thing, build against the local API and run
the Worker with site-shell (`SITE_THEMES_DIR` is a checkout of akshayDev17/site-themes):

```sh
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8787 npm run build
npx wrangler dev -c wrangler.jsonc -c "$SITE_THEMES_DIR/shell/wrangler.jsonc" --port 8788
ALLOWED_ORIGIN=http://127.0.0.1:8788 uv run python local_server.py   # in backend/
```

`local_server.py` documents its dev-only switches (signed out, moving its clock past midnight).
`npm run test:views` does all of this itself and clicks through every view.
