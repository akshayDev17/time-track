// The signed-off board's views and transitions, clicked through in headless Chrome against the
// real app: the static export behind worker.js and the real site-shell (one `wrangler dev`
// session, no Cloudflare account), and the Python API over SQLite (backend/local_server.py).
//
// Each step asserts the board's wording and state; at each view the page is checked at desktop
// (1280) and phone (390) widths in light and dark: no horizontal page scroll, and, with
// SHOTS_DIR set, a screenshot. Any console error or page error fails the run.
//
// Needs: SITE_THEMES_DIR (a checkout of akshayDev17/site-themes), `uv` for the backend, and
// Chrome (CHROME_PATH, or the usual install path). It rebuilds out/ against the local API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const frontend = dirname(fileURLToPath(import.meta.url));
const backend = join(frontend, '..', 'backend');
const siteThemes = process.env.SITE_THEMES_DIR && resolve(process.env.SITE_THEMES_DIR);
const shots = process.env.SHOTS_DIR && resolve(process.env.SHOTS_DIR);
const CHROME = process.env.CHROME_PATH || [
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));

const scratch = mkdtempSync(join(tmpdir(), 'time-track-views-'));
const children = [];
let api, app, browser;
/** Every console error and page error, from every page. */
const errors = [];

function freePort() {
  return new Promise((ok, no) => {
    const s = createServer();
    s.once('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

async function startProcess(cmd, args, opts, ready) {
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 240 && !ready(log); i++) await new Promise((r) => setTimeout(r, 500));
  if (!ready(log)) throw new Error(`${cmd} did not start:\n${log}`);
  return child;
}

before(async () => {
  assert.ok(siteThemes && existsSync(join(siteThemes, 'shell/wrangler.jsonc')), 'set SITE_THEMES_DIR to a checkout of akshayDev17/site-themes');
  assert.ok(CHROME, 'no Chrome found: set CHROME_PATH');
  if (shots) mkdirSync(shots, { recursive: true });
  const apiPort = await freePort();
  const appPort = await freePort();
  api = `http://127.0.0.1:${apiPort}`;
  app = `http://127.0.0.1:${appPort}`;
  const built = spawnSync('npx', ['next', 'build'], { cwd: frontend, env: { ...process.env, NEXT_PUBLIC_API_BASE: api }, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  await startProcess('uv', ['run', 'python', 'local_server.py'], {
    cwd: backend,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PORT: String(apiPort), DB_PATH: join(scratch, 'views.db'), DEV_EMAIL: 'owner@example.com', SIGNED_OUT: '1', ALLOWED_ORIGIN: app },
  }, (log) => log.includes('time-track backend on'));
  await startProcess(join(frontend, 'node_modules/.bin/wrangler'), [
    'dev', '-c', join(frontend, 'wrangler.jsonc'), '-c', join(siteThemes, 'shell/wrangler.jsonc'),
    '--ip', '127.0.0.1', '--port', String(appPort), '--inspector-port', String(await freePort()),
    '--persist-to', join(scratch, 'state'), '--log-level', 'info',
  ], { cwd: frontend, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_REGISTRY_PATH: join(scratch, 'registry') } }, (log) => /Ready on/.test(log));
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
});

after(async () => {
  await browser?.close();
  for (const c of children) c.kill('SIGTERM');
  rmSync(scratch, { recursive: true, force: true });
});

const dev = (path, body) => fetch(`${api}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const DAY = 86400000;

const VARIANTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

async function newPage() {
  const context = await browser.newContext({ timezoneId: 'Asia/Kolkata', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${page.url()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
  return page;
}

/** The view at both widths in both themes: no sideways scroll, and a screenshot if asked. */
async function look(page, view) {
  for (const v of VARIANTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      const want = `classic-${scheme}`;
      await page.waitForFunction((t) => document.documentElement.dataset.theme === t, want, { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(150);
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      assert.equal(theme, `classic-${scheme}`, `${view}: site-shell's theme follows the system`);
      const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
      assert.ok(sw <= w, `${view} ${v.name} ${scheme}: page is ${sw}px wide in a ${w}px window`);
      if (shots) await page.screenshot({ path: join(shots, `${view}-${v.name}-${scheme}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

const btn = (page, name) => page.getByRole('button', { name, exact: true });
async function text(page, t) {
  try {
    await page.getByText(t, { exact: false }).first().waitFor({ timeout: 15000 });
  } catch (err) {
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    throw new Error(`waiting for "${t}" at ${page.url()}:\n${body.slice(0, 1500)}\nconsole errors: ${errors.join('\n')}\n${err.message}`);
  }
}
const enabled = async (page, name) => btn(page, name).isEnabled();
/** A locator's text with its no-break spaces (kept-together times and durations) read as spaces. */
const content = async (locator) => (await locator.textContent()).replace(/\u00a0/g, ' ');
const why = (page, label) => content(page.locator('.dbtn', { has: page.getByRole('button', { name: label, exact: true }) }).locator('.why'));

test('every view and transition on the board', async () => {
  const page = await newPage();

  // ── 1 · public page, signed out ────────────────────────────────────────────
  await page.goto(`${app}/time-track`);
  await text(page, 'Ten stopwatches you can use right now.');
  assert.equal(await content(page.locator('.demo-day .pill')), 'No day open');
  assert.equal(await page.locator('.tc').count(), 10);
  assert.equal(await page.locator('.grow').count(), 10);
  assert.equal(await page.locator('.tag.sample').count(), 11);
  assert.equal(await page.locator('.sp-app[aria-current="page"] .sp-label').textContent(), 'Time Track');
  await btn(page, 'Start timer 1').click();
  await page.locator('.tc.run').first().waitFor();
  assert.match(await content(page.locator('.demo-day .pill')), /^Day open · \d{1,2}:\d{2} [ap]m to \d{1,2}:\d{2} [ap]m \w{3} \d{1,2} \w{3} · 1 running$/);
  assert.equal(await enabled(page, 'Clear all'), false);
  await text(page, 'Clear all waits until every timer is stopped.');
  await page.waitForTimeout(1200);
  await btn(page, 'Stop timer 1').click();
  await btn(page, 'Resume timer 1').waitFor();
  await page.getByLabel('Name for timer 1', { exact: true }).fill('Deep work');
  assert.equal(await page.locator('.tc-name').first().textContent(), 'Deep work');
  assert.equal(await page.locator('.gt').first().textContent(), 'Deep work');
  await look(page, 'v1-public');
  await page.getByRole('button', { name: 'Clear Deep work' }).click();
  await text(page, 'Deep work goes back to 00:00:00.0.');
  await look(page, 'v9-dialog-clear');
  await btn(page, 'Clear').click();
  await btn(page, 'Start Deep work').waitFor();
  await btn(page, 'Start all').click();
  assert.equal(await page.locator('.tc.run').count(), 10);
  await page.waitForTimeout(300);
  await btn(page, 'Stop all').click();
  await btn(page, 'Relaunch').click();
  assert.equal(await page.locator('.tc.run').count(), 10);
  await btn(page, 'Stop all').click();
  await btn(page, 'Clear all').click();
  await text(page, 'Every timer goes back to 00:00:00.0.');
  await look(page, 'v9-dialog-clear-all');
  await page.locator('.dlg').getByRole('button', { name: 'Clear all' }).click();
  assert.equal(await page.locator('.tc-clear').count(), 0);
  await page.reload();
  await text(page, 'Ten stopwatches');
  assert.equal(await page.getByLabel('Name for timer 1', { exact: true }).inputValue(), 'Deep work', 'kept in this browser (C10)');
  await btn(page, 'Delete names').click();
  assert.equal(await page.getByLabel('Name for timer 1', { exact: true }).inputValue(), '');

  // ── sign in → 2 · Trackers (C8) ───────────────────────────────────────────
  await dev('/__dev/session', { signed_in: true });
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await text(page, 'Your trackers');
  await text(page, 'No trackers yet. Make one with New tracker.');
  await text(page, 'owner@example.com');

  // ── 3 · New tracker ────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'New tracker' }).click();
  await page.waitForURL(/\/time-track\/new$/);
  await text(page, '1 to 15. You can add, remove and rename them later.');
  assert.equal(await page.locator('output').textContent(), '10');
  await page.getByRole('link', { name: 'Cancel' }).click();
  await text(page, 'Your trackers');
  await page.getByRole('link', { name: 'New tracker' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Workday');
  await page.getByLabel('One fewer timer', { exact: true }).click();
  await page.getByLabel('One fewer timer', { exact: true }).click();
  assert.equal(await page.locator('output').textContent(), '8');
  await look(page, 'v3-new-tracker');
  await btn(page, 'Create tracker').click();

  // ── 4 · before Start today ────────────────────────────────────────────────
  await page.waitForURL(/\/time-track\/workday$/);
  await text(page, 'New tracker · not started yet');
  assert.equal(await page.locator('.sp-trail').textContent(), 'TrackersWorkday', 'trail: Trackers › Workday');
  assert.equal(await page.locator('.tc.grey').count(), 8);
  assert.deepEqual([await enabled(page, 'Start today'), await enabled(page, 'Save last day'), await enabled(page, 'Discard last day')], [true, false, false]);
  assert.equal(await page.getByLabel('Name for timer 1', { exact: true }).isDisabled(), true, 'rename greyed before Start today (C4)');
  await text(page, 'Greyed out until Start today.');
  await page.locator('.tc.grey').first().click({ force: true });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.tc.grey').count(), 8, 'a greyed card is look, not click');
  assert.equal(await page.locator('.tc[tabindex]').count(), 0, 'and it takes no focus');
  await look(page, 'v4-before-start-today');

  // ── 7 · today's open day ──────────────────────────────────────────────────
  await btn(page, 'Start today').click();
  await text(page, 'Open day · ');
  // the day ends 24 hours after it started: the same clock time, the next date
  assert.match(await content(page.locator('.dayp .pill')), /^Open day · \w{3} \d{1,2} \w{3} \d{4} · (\d{1,2}:\d{2} [ap]m) to \1 \w{3} \d{1,2} \w{3} · Kolkata \(IST\)$/);
  assert.match(await why(page, 'Save last day'), /^Saves itself at \d{1,2}:\d{2} [ap]m \w{3} \d{1,2} \w{3}, in (24 h 00 m|23 h \d{2} m)\.$/);
  assert.match(await why(page, 'Start today'), /^Opens the next day once this one ends, in (24 h 00 m|23 h \d{2} m)\.$/);
  assert.deepEqual([await enabled(page, 'Start today'), await enabled(page, 'Save last day'), await enabled(page, 'Discard last day')], [false, false, true]);
  for (const [i, name] of ['Deep work', 'Meetings', 'Email', 'Code review'].entries()) {
    await page.getByLabel(`Name for timer ${i + 1}`, { exact: true }).fill(name);
  }
  await page.getByLabel('Name for timer 1', { exact: true }).blur();
  await page.getByLabel('Name for timer 4', { exact: true }).press('Tab');
  await btn(page, 'Start Deep work').click();
  await page.locator('.tc.run').first().waitFor();
  await text(page, '1 running');

  // a press shows at once: clicking the card (not its button) stops it while the answer is held
  const card = (name) => page.locator('.tc', { has: page.locator('.tc-name', { hasText: name }) });
  const stopUrl = /\/time-track\/api\/trackers\/workday\/timers\/\d+\/stop$/;
  let releaseStop;
  const heldStop = new Promise((r) => (releaseStop = r));
  await page.route(stopUrl, async (route) => {
    await heldStop;
    await route.continue();
  });
  await card('Deep work').locator('.tc-disp').click();
  await btn(page, 'Resume Deep work').waitFor({ timeout: 500 });
  releaseStop();
  await page.waitForResponse(stopUrl);
  await page.unroute(stopUrl);
  // Enter on the focused card starts it again, at once
  await card('Deep work').focus();
  await page.keyboard.press('Enter');
  await btn(page, 'Stop Deep work').waitFor({ timeout: 500 });
  // a press the server refuses snaps back, with the reason
  const startUrl = /\/time-track\/api\/trackers\/workday\/timers\/\d+\/start$/;
  await page.route(startUrl, async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({
      status: 409,
      headers: { 'access-control-allow-origin': app, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'This day has ended and saved itself. Press Start today for the next one.', code: 'day_ended' }),
    });
  });
  await card('Meetings').click({ position: { x: 20, y: 60 } });
  await btn(page, 'Stop Meetings').waitFor({ timeout: 300 });
  await btn(page, 'Start Meetings').waitFor();
  await text(page, 'This day has ended and saved itself. Press Start today for the next one.');
  await page.unroute(startUrl);
  // the browser logs that refused answer as a console error: the one this step asked for
  const refusedLog = errors.findIndex((e) => e.endsWith('the server responded with a status of 409 (Conflict)'));
  assert.ok(refusedLog >= 0);
  errors.splice(refusedLog, 1);
  await btn(page, 'Dismiss').click();
  assert.equal(await page.locator('.tc.run').count(), 1, 'only Deep work runs');
  // Stop one timer, then start another at once while the stop's answer is slow: the start is
  // sent after that answer, stamped with its own click time, so its time never jumps back
  const shown = async (name) => {
    const [h, m, s] = (await card(name).locator('.tc-disp').textContent()).split(':').map(Number);
    return ((h * 60 + m) * 60 + s) * 1000;
  };
  let releaseSlow;
  const slowStop = new Promise((r) => (releaseSlow = r));
  await page.route(stopUrl, async (route) => {
    await slowStop;
    await route.continue();
  });
  const startSent = page.waitForRequest(startUrl);
  await btn(page, 'Stop Deep work').click();
  await btn(page, 'Start Meetings').click();
  await btn(page, 'Stop Meetings').waitFor({ timeout: 300 });
  await page.waitForTimeout(1500);
  const beforeAnswers = await shown('Meetings');
  releaseSlow();
  const startRequest = await startSent;
  const startAnswer = await (await startRequest.response()).json();
  await page.unroute(stopUrl);
  const meetingsId = Number(startRequest.url().match(/timers\/(\d+)\/start$/)[1]);
  const pressedAt = startRequest.postDataJSON().pressed_at_ms;
  assert.equal(startAnswer.tracker.timers.find((t) => t.id === meetingsId).running_since_ms, pressedAt, 'stamped at the click, not on arrival');
  const afterAnswers = await shown('Meetings');
  assert.ok(beforeAnswers >= 1400 && afterAnswers >= beforeAnswers, `Meetings never jumps back: ${beforeAnswers} ms, then ${afterAnswers} ms`);
  await btn(page, 'Stop Meetings').click();
  await btn(page, 'Clear Meetings').click();
  await btn(page, 'Clear').click();
  await btn(page, 'Start Meetings').waitFor();
  await btn(page, 'Resume Deep work').click();
  assert.equal(await page.locator('.tc.run').count(), 1, 'only Deep work runs');
  await btn(page, '+ Add timer').click();
  await text(page, '9 of 15 timers');
  await look(page, 'v7-open-day');

  // view 12: the same open day on a second device follows within a poll
  const phone = await newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  // while its first answer is on its way the page says Loading, never "No such tracker"
  const firstAnswer = `${api}/time-track/api/trackers/workday`;
  let release;
  const held = new Promise((r) => (release = r));
  await phone.route(firstAnswer, async (route) => {
    await held;
    await route.continue();
  });
  const asked = phone.waitForRequest(firstAnswer);
  await phone.goto(`${app}/time-track/workday`);
  await asked;
  assert.equal(await phone.getByText('Loading…').count(), 1, 'the tracker page waits for its first answer');
  assert.equal(await phone.getByText('No such tracker').count(), 0, 'a tracker still loading is not a missing one');
  release();
  await phone.locator('.tc.run').first().waitFor();
  await phone.unroute(firstAnswer);
  // "HH:MM:SS.t" in ms. Each page repaints every 100 ms and the two reads are not one instant,
  // so the same server state shows within a few tenths, never a second boundary apart.
  const read = async (p) => {
    const [h, m, s] = (await p.locator('.tc.run .tc-disp').first().textContent()).split(':').map(Number);
    return ((h * 60 + m) * 60 + s) * 1000;
  };
  const [a, b] = await Promise.all([read(page), read(phone)]);
  assert.ok(a > 0 && Math.abs(a - b) <= 400, `laptop and phone show the same time: ${a} ms vs ${b} ms`);
  await btn(phone, 'Stop Deep work').click();
  await page.locator('.tc.run').waitFor({ state: 'detached', timeout: 8000 });
  await btn(phone, 'Resume Deep work').click();
  await page.locator('.tc.run').first().waitFor({ timeout: 8000 });
  if (shots) {
    await phone.screenshot({ path: join(shots, 'v12-phone.png'), fullPage: true });
    await page.screenshot({ path: join(shots, 'v12-laptop.png') });
  }
  await phone.context().close();

  // remove a timer that was never saved: gone (C5), after "Are you sure?"
  await page.locator('.rn-f', { has: page.getByLabel('Name for timer 9', { exact: true }) }).getByRole('button', { name: 'Remove' }).click();
  await text(page, 'Timer 9 leaves this tracker.');
  await look(page, 'v9-dialog-remove');
  await page.locator('.dlg').getByRole('button', { name: 'Remove timer' }).click();
  await text(page, '8 of 15 timers');
  await page.waitForTimeout(400);
  await btn(page, 'Stop Deep work').click();
  await btn(page, 'Resume Deep work').waitFor();
  await btn(page, 'Start Meetings').click();
  await page.waitForTimeout(1100);
  await btn(page, 'Stop Meetings').click();
  await page.getByRole('button', { name: 'Clear Meetings' }).click();
  assert.equal(await page.locator('.tc.run', { hasText: 'Meetings' }).count(), 0, 'the trash icon only clears');
  await btn(page, 'Clear').click();
  await btn(page, 'Start Meetings').waitFor();
  await btn(page, 'Start Email').click();

  // ── its 24 hours are up → 10: Email (running) stopped at the end, saved, every timer zero ──
  await dev('/__dev/clock', { offset_ms: DAY });
  await text(page, 'and saved to History and the Charts page. Every timer is back at zero: press Start today to begin the next day.');
  assert.match(await content(page.locator('.dayp .pill')), /^Saved · \w{3} \d{1,2} \w{3} \d{4}$/);
  assert.equal(await page.locator('.tc.run').count(), 0);
  assert.equal(await page.locator('.tc-clear').count(), 0, 'every timer back at zero');
  assert.equal(await page.locator('.tc.grey').count(), 8);
  assert.deepEqual([await enabled(page, 'Start today'), await enabled(page, 'Save last day'), await enabled(page, 'Discard last day')], [true, false, false]);
  assert.equal(await why(page, 'Save last day'), 'Already saved.');
  await look(page, 'v10-saved-day');

  // ── 11 · Charts page ──────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Charts' }).click();
  await page.waitForURL(/\/time-track\/workday\/charts$/);
  await text(page, 'Workday · charts');
  assert.equal(await page.locator('.grow').count(), 9, 'the Total graph, then one per timer');
  assert.equal(await page.locator('.grow').first().getAttribute('class'), 'grow total');
  assert.equal(await page.locator('.grow.total .gt').textContent(), 'Total · every timer');
  assert.equal(await page.locator('.rseg [aria-pressed="true"]').textContent(), '30 days');
  // one saved day: a circle on it, and hovering shows its date and value
  assert.equal(await page.locator('.grow.total .gdot').count(), 1);
  await page.locator('.grow.total .plot').hover();
  assert.match(await page.locator('.grow.total .gtip').textContent(), /^\w{3} \d{1,2} \w{3} · (\d+ h \d{2} m|\d+ m)$/);
  await text(page, 'a day, over 1 saved day in the last 30 days');
  await btn(page, 'All').click();
  await text(page, 'in all saved days');
  await page.getByRole('link', { name: 'Back to tracker' }).click();

  // ── Start today from a saved day → 7 at zero; remove a saved timer (A3) ───
  await btn(page, 'Start today').click();
  await text(page, 'Open day · ');
  assert.equal(await page.locator('.tc-clear').count(), 0, 'every timer back to zero');
  await page.locator('.rn-f', { has: page.getByLabel('Name for timer 4', { exact: true }) }).getByRole('button', { name: 'Remove' }).click();
  await text(page, 'Code review leaves this tracker.');
  await page.locator('.dlg').getByRole('button', { name: 'Remove timer' }).click();
  await text(page, '7 of 15 timers');

  // ── Discard last day, before the day ends → 4 (C1) ───────────────────────
  await btn(page, 'Discard last day').click();
  await text(page, 'is deleted for good. It never reaches History or the Charts page.');
  await look(page, 'v9-dialog-discard');
  await page.locator('.dlg').getByRole('button', { name: 'Discard last day' }).click();
  await text(page, 'The last day was discarded. Press Start today to begin a new day.');
  await text(page, 'No open day');

  // ── a discarded date was never saved: Start today opens it again; its 24 hours end → 10 ──
  await btn(page, 'Start today').click();
  await text(page, 'Open day · ');
  await btn(page, 'Start Deep work').click();
  await page.locator('.tc.run').first().waitFor();
  await dev('/__dev/clock', { offset_ms: 3 * DAY });
  await text(page, 'Every timer is back at zero: press Start today to begin the next day.');
  assert.equal(await page.locator('.tc.run').count(), 0);

  // charts: two saved days, the removed timer kept and marked
  await page.getByRole('link', { name: 'Charts' }).click();
  await text(page, 'Workday · charts');
  await text(page, 'Its saved days stay.');
  assert.equal(await page.locator('.tag.removed').count(), 1);
  await text(page, 'a day, over 2 saved days in the last 30 days');
  assert.equal(await page.locator('.grow.total .gdot').count(), 2);
  await look(page, 'v11-charts');

  // ── 2 · Trackers list states, chart icon, Delete (after "Are you sure?") ──
  await page.locator('.sp-trail').getByRole('link', { name: 'Trackers' }).click();
  await text(page, 'Your trackers');
  assert.match(await content(page.locator('.trk', { hasText: 'Workday' }).locator('.pill')), /^Saved · \w{3} \d{1,2} \w{3}$/);
  await page.getByRole('link', { name: 'New tracker' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Reading');
  await btn(page, 'Create tracker').click();
  await page.waitForURL(/\/time-track\/reading$/);
  await page.getByRole('link', { name: 'Trackers' }).first().click();
  await text(page, 'New · not started yet');
  await look(page, 'v2-trackers');
  await page.getByRole('link', { name: 'Charts for Workday' }).click();
  await text(page, 'Workday · charts');
  await page.goBack();
  await text(page, 'Your trackers');
  await page.locator('.trk', { hasText: 'Reading' }).getByRole('button', { name: 'Delete' }).click();
  await text(page, 'Reading and every day in it are deleted for good.');
  await look(page, 'v9-dialog-delete');
  await page.locator('.dlg').getByRole('button', { name: 'Delete tracker' }).click();
  await page.locator('.trk', { hasText: 'Reading' }).waitFor({ state: 'detached' });

  // ── Sign out → 1 ──────────────────────────────────────────────────────────
  await btn(page, 'Sign out').click();
  await text(page, 'Ten stopwatches you can use right now.');

  await page.context().close();
  assert.deepEqual(errors, []);
});

/** Move the API's clock so that it reads `ms` (the page syncs to it from every answer). */
async function serverAt(ms) {
  const { now_ms: real } = await dev('/__dev/clock', { offset_ms: 0 });
  await dev('/__dev/clock', { offset_ms: ms - real });
}

test('a day lasts 24 hours from its start, whatever the clock read, then closes and saves itself', async () => {
  // Start today at 11:59 pm: the day used to end at midnight, a minute later, and stay open
  // with its timers counting until someone saved it by hand.
  const START = Date.parse('2026-11-20T23:59:00+05:30');
  await dev('/__dev/session', { signed_in: true });
  await serverAt(START);
  const page = await newPage();
  await page.goto(`${app}/time-track/new`);
  await page.getByLabel('Name', { exact: true }).fill('Late night');
  await btn(page, 'Create tracker').click();
  await page.waitForURL(/\/time-track\/late-night$/);
  await btn(page, 'Start today').click();
  await text(page, 'Open day · ');
  await page.getByLabel('Name for timer 1', { exact: true }).fill('Deep work');
  await page.getByLabel('Name for timer 1', { exact: true }).blur();
  await btn(page, 'Start Deep work').click();
  const pill = 'Open day · Fri 20 Nov 2026 · 11:59 pm to 11:59 pm Sat 21 Nov · Kolkata (IST) · 1 running';
  await text(page, pill);
  await look(page, 'v7-open-day-from-2359');

  // past midnight: the same day, still open, Deep work still running
  const answered = () => page.waitForResponse((r) => r.url() === `${api}/time-track/api/trackers/late-night` && r.request().method() === 'GET');
  await serverAt(START + 2 * 60000);
  await answered();
  await page.waitForTimeout(200);
  assert.equal(await content(page.locator('.dayp .pill')), pill);
  assert.equal(await page.locator('.tc.run').count(), 1);

  // four seconds before the end: the page has the server's clock, then hears nothing more, so
  // what follows is the open tab's own doing, at the end moment, without a reload
  await serverAt(START + 24 * 3600000 - 4000);
  await answered();
  let release;
  const held = new Promise((r) => (release = r));
  await page.route(`${api}/time-track/api/trackers/late-night`, async (route) => {
    await held;
    await route.continue();
  });
  await text(page, 'Ended at 11:59 pm Sat 21 Nov and saved to History and the Charts page.');
  assert.equal(await content(page.locator('.dayp .pill')), 'Saved · Fri 20 Nov 2026');
  assert.equal(await page.locator('.tc.run').count(), 0);
  assert.equal(await page.locator('.tc-clear').count(), 0, 'every timer back at zero');
  assert.equal(await page.locator('.tc.grey').count(), 10);
  await look(page, 'v10-saved-at-24h');
  const heard = answered();
  release();
  await heard;
  await page.unroute(`${api}/time-track/api/trackers/late-night`);

  // the server agrees: on its next request it closed the day at its end
  await page.reload();
  await text(page, 'Ended at 11:59 pm Sat 21 Nov and saved to History and the Charts page.');
  assert.equal(await page.locator('.tc-clear').count(), 0);
  await page.getByRole('link', { name: 'Charts' }).click();
  await text(page, 'Late night · charts');
  await page.locator('.grow.total .plot').hover();
  assert.equal(await page.locator('.grow.total .gtip').textContent(), 'Fri 20 Nov · 24 h 00 m', 'Deep work counted up to the end, not past it');
  await page.context().close();
  await dev('/__dev/session', { signed_in: false });
  assert.deepEqual(errors, []);
});

test('the public demo keeps the same rule: 24 hours from its first start, then saved here and back to zero', async () => {
  const page = await newPage();
  await page.clock.install({ time: new Date('2026-11-20T23:59:00+05:30') });
  await page.goto(`${app}/time-track`);
  await text(page, 'Ten stopwatches you can use right now.');
  await btn(page, 'Start timer 1').click();
  await page.locator('.tc.run').first().waitFor();
  assert.equal(await content(page.locator('.demo-day .pill')), 'Day open · 11:59 pm to 11:59 pm Sat 21 Nov · 1 running');
  await page.clock.fastForward(2 * 60000);
  assert.equal(await page.locator('.tc.run').count(), 1, 'still running past midnight');
  await page.clock.fastForward(24 * 3600000 - 2 * 60000);
  await text(page, 'Saved · Fri 20 Nov · 24 h 00 m in all');
  await text(page, 'That day ran from 11:59 pm Fri 20 Nov to 11:59 pm Sat 21 Nov. Every timer is back at zero: your next Start opens a new day.');
  assert.equal(await page.locator('.tc.run').count(), 0);
  assert.equal(await page.locator('.tc-clear').count(), 0, 'every timer back at zero');
  await look(page, 'v1-public-day-saved');
  // a tab opened hours later sees the same
  await page.clock.fastForward(5 * 3600000);
  await page.reload();
  await text(page, 'Saved · Fri 20 Nov · 24 h 00 m in all');
  assert.equal(await page.locator('.tc-clear').count(), 0);
  await page.context().close();
  assert.deepEqual(errors, []);
});
