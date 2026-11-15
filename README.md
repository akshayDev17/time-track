# time-track

Time Track: multi-timer day tracker at akshayprabhakant.com/time-track (Cloudflare Worker + D1, Access sign-in).

- A **Tracker** holds 1 to 15 **Timers**. **Start today** opens a **Day** for today's date,
  stamped with the date and time zone where it was pressed; one day per date.
- That **Open day** stays until **Save last day** (into **History** and onto the **Charts
  page**) or **Discard last day** (gone for good). Save unlocks once its date has ended in
  its own time zone, with every timer stopped.
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
