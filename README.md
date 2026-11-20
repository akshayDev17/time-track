# time-track

Time Track: multi-timer day tracker at akshayprabhakant.com/time-track (Cloudflare Worker + D1, Access sign-in).

- A **Tracker** holds 1 to 15 **Timers**. **Start today** opens a **Day** for today's date,
  stamped with the date and time zone where it was pressed; one day per date.
- That **Open day** lasts exactly 24 hours from the moment it started, whatever the clock
  read then (start at 11:59 pm, and it ends at 11:59 pm the next day). At its end it closes
  itself: every running timer stops at the end, the day is saved into **History** and onto
  the **Charts page**, and the timers go back to zero until the next Start today (which is
  never pressed for you). Before its end, **Discard last day** deletes it for good.
- The close happens on the server, on the first request for that tracker after the end, so
  it holds with no tab open and the laptop shut, and counts no time past the end.
- Signed in, times live on the server as start and stop timestamps, so every tab, browser
  and device shows the same values, and they keep running with the laptop shut.
- Visitors who never signed in get ten browser-only timers and sample graphs.

## Layout

- `backend/` — Python Worker (`time_track/`), D1 migrations, pytest via uv,
  `local_server.py` for development.
- `frontend/` — Next.js static export (basePath `/time-track`) served by `worker.js`,
  composed with the site's theme and site row by site-shell.
- `.github/workflows/ci.yml` — tests, then Deploy API, then Deploy Frontend; both deploys
  refuse unless Cloudflare Access guards the app (`.github/scripts/access_check.py`).

Setup, the Access split and local development: [docs/deploy.md](docs/deploy.md).

## Tests

```sh
python3 -B .github/scripts/test_access_check.py
cd backend && uv run pytest -q
cd frontend && npm run test:lib && npm run test:worker && npm run build && npm run test:export
cd frontend && SITE_THEMES_DIR=/path/to/site-themes npm run test:views
```
