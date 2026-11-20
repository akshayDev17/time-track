import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateLabel, displayPieces, dur, median, timeParts, untilLabel } from './format.ts';
import { clockTime, dayStamp, localDate, momentLabel, zoneLabel, zoneMidnight } from './zones.ts';
import { cardClock, cardMode, dayPanel, listPill, settled, trackerView } from './views.ts';
import { charts, medianNote, rangeDays } from './charts.ts';
import { freshDemo, parseDemo } from './demo.ts';
import { applyTimers } from './timers.ts';
import { SAMPLE_DAYS } from './sample.ts';
import { slugOf } from './paths.ts';
import { better, sampleOf } from './clock.ts';
import { ApiError } from './api.ts';
import { LOADING, changeFailed, changed, dismissed, pollFailed, polled, pressed, reachedEnd } from './load.ts';
import type { HistoryResponse, Timer, Tracker } from './types.ts';

const PUNE = 'Asia/Kolkata';
/** Wording with its no-break spaces read as plain ones. */
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\u00a0/g, ' '));
const dayPanelPlain: typeof dayPanel = (...a) => plain(dayPanel(...a));
const listPillPlain: typeof listPill = (...a) => plain(listPill(...a));
const at = (iso: string, offset = '+05:30') => Date.parse(`${iso}${offset}`);
const H = 3600000;
const M = 60000;

// ── format ───────────────────────────────────────────────────────────────────

test('display keeps tenths and dims leading zeros like the reference card', () => {
  assert.deepEqual(timeParts(((1 * 60 + 48) * 60 + 12) * 1000 + 300), { main: '01:48:12', tenths: 3 });
  assert.deepEqual(displayPieces(0), { dim: '00:00:00', rest: '', tenths: '.0', zero: true });
  assert.deepEqual(displayPieces(38 * M + 5100), { dim: '00:', rest: '38:05', tenths: '.1', zero: false });
  assert.deepEqual(displayPieces(4200), { dim: '00:00:0', rest: '4', tenths: '.2', zero: false });
  assert.deepEqual(displayPieces(41 * H + 46 * M + 44600), { dim: '', rest: '41:46:44', tenths: '.6', zero: false });
});

test('durations, countdown and median', () => {
  assert.equal(dur(65), '1 h 05 m');
  assert.equal(dur(38), '38 m');
  assert.equal(untilLabel(at('2026-11-16T00:00'), at('2026-11-15T14:14')), '9 h 46 m');
  assert.equal(untilLabel(1000, 999), '1 m');
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('date labels read like the board', () => {
  assert.equal(dateLabel('2026-11-15'), 'Sun 15 Nov');
  assert.equal(dateLabel('2026-11-13', true), 'Fri 13 Nov 2026');
});

// ── zones: the Start today stamp ─────────────────────────────────────────────

test('day stamp: Pune date, its midnights and label', () => {
  const s = dayStamp(at('2026-11-15T14:14'), PUNE);
  assert.equal(s.date, '2026-11-15');
  assert.equal(s.day_start_ms, at('2026-11-15T00:00'));
  assert.equal(s.day_end_ms, at('2026-11-16T00:00'));
  assert.equal(s.tz_label, 'Kolkata (IST)');
  assert.equal(zoneLabel('Asia/Calcutta', at('2026-11-15T14:14')), 'Kolkata (IST)');
  assert.equal(clockTime(at('2026-11-15T09:02'), PUNE), '9:02 am');
  assert.equal(momentLabel(at('2026-11-16T23:59'), PUNE), '11:59 pm Mon 16 Nov');
});

test('day stamp: the date is local, Auckland is a day ahead of San Francisco', () => {
  const now = Date.parse('2026-11-15T20:00:00Z');
  assert.equal(localDate(now, 'Pacific/Auckland'), '2026-11-16');
  assert.equal(localDate(now, 'America/Los_Angeles'), '2026-11-15');
  assert.match(zoneLabel('America/Los_Angeles', now), /^Los Angeles \(PST\)$/);
  assert.match(zoneLabel('Pacific/Auckland', now), /^Auckland \(NZDT\)$/);
});

test('day stamp across DST: 23 h and 25 h days, and a skipped midnight', () => {
  const spring = dayStamp(Date.parse('2027-03-28T12:00:00Z'), 'Europe/London');
  assert.equal(spring.day_end_ms - spring.day_start_ms, 23 * H);
  const fall = dayStamp(Date.parse('2026-10-25T12:00:00Z'), 'Europe/London');
  assert.equal(fall.day_end_ms - fall.day_start_ms, 25 * H);
  // Santiago skips 00:00 on 2026-09-06: the day starts when the clock jumps to 01:00
  const start = zoneMidnight('2026-09-06', 'America/Santiago');
  assert.equal(localDate(start, 'America/Santiago'), '2026-09-06');
  assert.equal(localDate(start - 1, 'America/Santiago'), '2026-09-05');
});

// ── views: the board's states and wording ────────────────────────────────────

const timer = (id: number, name: string, acc = 0, since: number | null = null): Timer => ({ id, name, acc_ms: acc, running_since_ms: since });
/** An open day as the server answers it: 24 hours from its start. */
const day = (date: string, started: string) => {
  const start = at(`${date}T${started}`);
  return { date, tz: PUNE, tz_label: 'Pune (IST)', day_start_ms: start, day_end_ms: start + 24 * H, started_at_ms: start };
};
const tracker = (over: Partial<Tracker>): Tracker => ({
  slug: 'x', name: 'X', last_outcome: null, phase: null, open_day: null, saved_day: null, timers: [timer(1, 'Writing')], ...over,
});
const NOW = at('2026-11-15T14:14');

test('view 4: brand-new and after discard', () => {
  const fresh = tracker({});
  assert.equal(trackerView(fresh, NOW), 'v4');
  assert.equal(cardMode('v4'), 'grey');
  const p = dayPanelPlain(fresh, NOW);
  assert.equal(p.pill.text, 'New tracker · not started yet');
  assert.equal(p.start.why, 'Opens a day of 24 hours from now, every timer at zero.');
  assert.deepEqual([p.start.on, p.save.on, p.discard.on], [true, false, false]);
  assert.equal(dayPanelPlain(tracker({ last_outcome: 'discarded' }), NOW).explain, 'The last day was discarded. Press Start today to begin a new day.');
});

test('view 7: the open day shows its end, 24 hours after its start, and saves itself then', () => {
  const t = tracker({ phase: 'live', open_day: day('2026-11-15', '09:02'), timers: [timer(1, 'Deep work', 0, NOW - M), timer(2, 'Email')] });
  assert.equal(trackerView(t, NOW), 'v7');
  assert.equal(cardMode('v7'), 'live');
  const p = dayPanelPlain(t, NOW);
  assert.equal(p.pill.tone, 'live');
  assert.equal(p.pill.text, 'Open day · Sun 15 Nov 2026 · 9:02 am to 9:02 am Mon 16 Nov · Pune (IST) · 1 running');
  assert.equal(p.explain, 'Times are kept on the server as they run, so every device shows the same. At 9:02 am Mon 16 Nov, 24 hours after it started, every timer stops, the day saves itself to History and the Charts page, and the timers go back to zero.');
  assert.equal(p.start.why, 'Opens the next day once this one ends, in 18 h 48 m.');
  assert.equal(p.save.why, 'Saves itself at 9:02 am Mon 16 Nov, in 18 h 48 m.');
  assert.equal(p.discard.why, 'Deletes this day for good.');
  assert.deepEqual([p.start.on, p.save.on, p.discard.on], [false, false, true]);
});

test('view 7: a day opened at 11:59 pm is still open after midnight, until 11:59 pm the next day', () => {
  const t = tracker({ phase: 'live', open_day: day('2026-11-15', '23:59') });
  const p = dayPanelPlain(t, at('2026-11-16T00:30'));
  assert.equal(p.pill.text, 'Open day · Sun 15 Nov 2026 · 11:59 pm to 11:59 pm Mon 16 Nov · Pune (IST)');
  assert.equal(p.save.why, 'Saves itself at 11:59 pm Mon 16 Nov, in 23 h 29 m.');
  assert.equal(trackerView(t, at('2026-11-16T23:58')), 'v7');
});

test('at the end: the day shows saved, every timer at zero, without waiting for the server', () => {
  const open = day('2026-11-15', '23:59');
  const t = tracker({ phase: 'live', open_day: open, timers: [timer(1, 'Deep work', 0, open.day_end_ms - H), timer(2, 'Email', 20 * M)] });
  assert.equal(settled(t, open.day_end_ms - 1), t);
  const s = settled(t, open.day_end_ms);
  assert.deepEqual(s, {
    ...t, phase: null, open_day: null, last_outcome: 'saved', saved_day: { ...open, saved_at_ms: open.day_end_ms },
    timers: [timer(1, 'Deep work'), timer(2, 'Email')],
  });
  assert.equal(trackerView(t, open.day_end_ms), 'v10');
  const p = dayPanelPlain(t, open.day_end_ms + 5 * H);
  assert.equal(p.pill.text, 'Saved · Sun 15 Nov 2026');
  assert.equal(p.explain, 'Ended at 11:59 pm Mon 16 Nov and saved to History and the Charts page. Every timer is back at zero: press Start today to begin the next day.');
  assert.deepEqual([p.start.on, p.save.on, p.discard.on], [true, false, false]);
  // a card never reads past the end, even before the page re-renders
  let now = open.day_end_ms + 700;
  assert.equal(cardClock(t, () => now)(), open.day_end_ms);
  now = open.day_end_ms - 700;
  assert.equal(cardClock(t, () => now)(), now);
  assert.equal(cardClock(s, () => now)(), now);
});

test('view 10: a day the server already saved', () => {
  const t = tracker({ last_outcome: 'saved', saved_day: { ...day('2026-11-14', '18:30'), saved_at_ms: NOW } });
  assert.equal(trackerView(t, NOW), 'v10');
  assert.equal(dayPanelPlain(t, NOW).pill.text, 'Saved · Sat 14 Nov 2026');
});

test('Trackers list pills', () => {
  const base = { slug: 'x', name: 'X', timer_count: 3, last_outcome: null, saved_date: null, open_day: null } as const;
  const open = { date: '2026-11-15', tz: PUNE, day_end_ms: at('2026-11-16T09:02'), running: 2 };
  assert.deepEqual(listPillPlain({ ...base, open_day: open }, NOW), { tone: 'live', text: 'Open day · until 9:02 am Mon 16 Nov · 2 running' });
  assert.deepEqual(listPillPlain({ ...base, open_day: { ...open, running: 0 } }, NOW), { tone: 'ok', text: 'Open day · until 9:02 am Mon 16 Nov' });
  assert.deepEqual(listPillPlain({ ...base, open_day: open }, open.day_end_ms), { tone: 'ok', text: 'Saved · Sun 15 Nov' });
  assert.deepEqual(listPillPlain({ ...base, last_outcome: 'saved', saved_date: '2026-11-14' }, NOW), { tone: 'ok', text: 'Saved · Sat 14 Nov' });
  assert.deepEqual(listPillPlain(base, NOW), { tone: '', text: 'New · not started yet' });
  assert.deepEqual(listPillPlain({ ...base, last_outcome: 'discarded' }, NOW), { tone: '', text: 'No open day' });
});

// ── charts ───────────────────────────────────────────────────────────────────

const history: HistoryResponse = {
  now_ms: NOW, name: 'Workday', slug: 'workday',
  timers: [{ id: 1, name: 'Deep work', number: 1, removed_on: null }, { id: 2, name: '', number: 2, removed_on: null }, { id: 9, name: 'Standups', number: null, removed_on: '2026-11-03' }],
  days: [
    { date: '2026-11-10', tz_label: 'Pune (IST)', values: { '1': 120 * M, '2': 0, '9': 15 * M } },
    { date: '2026-11-14', tz_label: 'Pune (IST)', values: { '1': 60 * M, '2': 30 * M } },
  ],
};

test('charts: the axis runs from the first saved day to the last; 30 / 90 never start before it', () => {
  const all = rangeDays(history, 'all');
  assert.equal(all.end - all.start + 1, 5); // 10 Nov .. 14 Nov
  assert.deepEqual(rangeDays(history, 30), all);
  const c = charts(history, 30)!;
  assert.equal(c.from, 'Tue 10 Nov');
  assert.equal(c.to, 'Sat 14 Nov');
  // every graph has one point per axis date, so they line up
  for (const g of [c.total, ...c.timers]) assert.equal(g.points.length, 5);
  assert.equal(charts({ ...history, days: [] }, 30), null);
});

test('charts: a saved zero is drawn as 0 and counts; a date with no saved day draws nothing', () => {
  const [deep, two] = charts(history, 'all')!.timers;
  assert.deepEqual(deep.points, [120, null, null, null, 60]);
  assert.equal(deep.median, 90);
  assert.equal(two.title, 'Timer 2');
  assert.deepEqual(two.points, [0, null, null, null, 30]);
  assert.equal(two.median, 15); // the saved zero counts
  assert.equal(two.tips[0], 'Tue 10 Nov · 0 m');
  assert.equal(two.tips[1], 'Wed 11 Nov · not saved');
});

test('charts: a timer added later is drawn as 0 before it existed, and its median counts only its own days', () => {
  // four timers since 1 Nov, the fifth added 10 Nov (the owner's example)
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = `2026-11-${String(i + 1).padStart(2, '0')}`;
    const values: Record<string, number> = { '1': 60 * M, '2': 30 * M, '3': 0, '4': 10 * M };
    if (i + 1 >= 10) values['5'] = 45 * M;
    return { date, tz_label: 'Pune (IST)', values };
  });
  const timers = [1, 2, 3, 4, 5].map((id) => ({ id, name: `T${id}`, number: id, removed_on: null }));
  const c = charts({ now_ms: NOW, name: 'Day', slug: 'day', timers, days }, 'all')!;
  const fifth = c.timers[4];
  assert.equal(c.from, 'Sun 1 Nov');
  assert.deepEqual(fifth.points, [0, 0, 0, 0, 0, 0, 0, 0, 0, 45, 45, 45, 45, 45]);
  assert.equal(fifth.tips[0], 'Sun 1 Nov · 0 m');
  assert.equal(fifth.median, 45);
  assert.equal(fifth.saved, 5);
});

test('charts: the Total graph leads with the sum of every saved value, median over saved days', () => {
  const c = charts(history, 'all')!;
  assert.equal(c.total.timer, null);
  assert.equal(c.total.title, 'Total · every timer');
  assert.deepEqual(c.total.points, [135, null, null, null, 90]); // 120 + 0 + 15 (a removed timer's saved day counts), 60 + 30
  assert.equal(c.total.median, 112.5);
  assert.equal(c.total.saved, 2);
  assert.equal(c.total.tips[0], 'Tue 10 Nov · 2 h 15 m');
});

test('charts: a removed timer draws nothing after its last saved day', () => {
  const removed = charts(history, 'all')!.timers[2];
  assert.deepEqual(removed.points, [15, null, null, null, null]);
  assert.equal(removed.tips[4], 'Sat 14 Nov · removed');
  assert.equal(removed.saved, 1);
  assert.equal(medianNote(2, 30), 'a day, over 2 saved days in the last 30 days');
  assert.equal(medianNote(0, 'all'), 'No saved days in all saved days');
});

// ── the public demo ──────────────────────────────────────────────────────────

test('demo: Start all only zeros, Relaunch only stopped with time, Clear all waits', () => {
  let ts = freshDemo();
  ts = applyTimers(ts, { kind: 'start', id: 1 }, 0);
  ts = applyTimers(ts, { kind: 'stop', id: 1 }, 5000);
  ts = applyTimers(ts, { kind: 'start-all' }, 6000);
  assert.equal(ts[0].running_since_ms, null);
  assert.equal(ts[0].acc_ms, 5000);
  assert.ok(ts.slice(1).every((t) => t.running_since_ms === 6000));
  assert.deepEqual(applyTimers(ts, { kind: 'clear-all' }, 7000), ts);
  ts = applyTimers(ts, { kind: 'stop-all' }, 7000);
  ts = applyTimers(ts, { kind: 'clear', id: 2 }, 7000);
  ts = applyTimers(ts, { kind: 'relaunch' }, 8000);
  assert.equal(ts[0].running_since_ms, 8000);
  assert.equal(ts[1].running_since_ms, null);
  ts = applyTimers(ts, { kind: 'rename', id: 3, name: 'Reading' }, 0);
  assert.equal(ts[2].name, 'Reading');
  assert.ok(applyTimers(ts, { kind: 'delete-names' }, 0).every((t) => t.name === ''));
  assert.deepEqual(parseDemo(JSON.stringify(ts)), ts);
  assert.deepEqual(parseDemo('nope'), freshDemo());
});

test('sample data is fixed: ten timers, thirty days', () => {
  assert.equal(SAMPLE_DAYS.length, 10);
  assert.ok(SAMPLE_DAYS.every((row) => row.length === 30));
  // the board's seeded generator: the same numbers on every load
  assert.deepEqual(SAMPLE_DAYS[0].slice(0, 6), [81, 149, 92, 141, 90, 120]);
  assert.equal(SAMPLE_DAYS.flat().filter((v) => v === null).length, 51);
});

// ── what a tracker page knows, answer by answer ──────────────────────────────

const OFFLINE = new TypeError('Failed to fetch');
const GONE = new ApiError(404, 'No such tracker.');
const SIGNED_OUT = new ApiError(401, 'Not signed in.', '', true);

test('load: the first answer ends loading; a 404 is a missing tracker', () => {
  const t = tracker({});
  assert.deepEqual(LOADING, { tracker: null, base: null, pending: [], missing: false, expired: false, error: null, pollError: null });
  assert.deepEqual(polled(LOADING, t), { ...LOADING, tracker: t, base: t });
  assert.deepEqual(pollFailed(LOADING, GONE), { ...LOADING, missing: true });
});

test('load: a failed poll keeps the tracker and its message goes with the next good poll', () => {
  const t = tracker({});
  const asleep = pollFailed(polled(LOADING, t), OFFLINE);
  assert.deepEqual(asleep, { ...LOADING, tracker: t, base: t, pollError: 'Failed to fetch' });
  const later = tracker({ name: 'Renamed elsewhere' });
  assert.deepEqual(polled(asleep, later), { ...LOADING, tracker: later, base: later });
  // a first load that failed recovers the same way
  assert.deepEqual(polled(pollFailed(LOADING, OFFLINE), t), { ...LOADING, tracker: t, base: t });
  assert.deepEqual(dismissed(asleep), { ...LOADING, tracker: t, base: t });
});

test('load: a tracker deleted on another device is dropped by the poll that finds it gone', () => {
  const shown = changeFailed(polled(LOADING, tracker({})), 1, new ApiError(409, '15 of 15: the most a tracker holds.', 'timer_cap'));
  assert.deepEqual(pollFailed(shown, GONE), { ...LOADING, missing: true });
});

test('load: an expired sign-in keeps the tracker and ends with the next answer', () => {
  const t = tracker({});
  const expired = pollFailed(polled(LOADING, t), SIGNED_OUT);
  assert.deepEqual(expired, { ...LOADING, tracker: t, base: t, expired: true });
  assert.deepEqual(polled(expired, t), { ...LOADING, tracker: t, base: t });
  assert.deepEqual(changeFailed(polled(LOADING, t), 1, new ApiError(401, 'not signed in')), expired);
  assert.deepEqual(changed(polled(LOADING, t), 1, t), { ...LOADING, tracker: t, base: t });
});

test('load: a refused change stays through polls until dismissed or a change goes through', () => {
  const t = tracker({});
  const refused = changeFailed(polled(LOADING, t), 1, new ApiError(409, '15 of 15: the most a tracker holds.', 'timer_cap'));
  assert.equal(refused.error, '15 of 15: the most a tracker holds.');
  assert.equal(refused.tracker, t);
  assert.equal(polled(refused, t).error, '15 of 15: the most a tracker holds.');
  assert.equal(pollFailed(refused, OFFLINE).error, '15 of 15: the most a tracker holds.');
  assert.equal(dismissed(refused).error, null);
  assert.equal(changed(refused, 2, t).error, null);
  assert.equal(changeFailed(polled(LOADING, t), 1, OFFLINE).error, 'Could not reach Time Track, so that change did not go through. Try again.');
});

const idle = (): Tracker =>
  tracker({ timers: [{ id: 1, name: 'A', acc_ms: 5000, running_since_ms: null }, { id: 2, name: 'B', acc_ms: 0, running_since_ms: 1000 }] });

test('load: a press shows at once from the server clock, and the answer replaces it', () => {
  const t = idle();
  // stop timer 2 and start timer 1: both show before any answer
  let s = pressed(polled(LOADING, t), { id: 1, action: { kind: 'stop', id: 2 }, at: 4000 });
  s = pressed(s, { id: 2, action: { kind: 'start', id: 1 }, at: 4100 });
  assert.deepEqual(s.tracker!.timers, [
    { id: 1, name: 'A', acc_ms: 5000, running_since_ms: 4100 },
    { id: 2, name: 'B', acc_ms: 3000, running_since_ms: null },
  ]);
  assert.equal(s.base, t, 'nothing confirmed yet');
  // the first answer (the server's own clock) arrives: the second press stays on top of it
  const afterStop = tracker({ timers: [{ id: 1, name: 'A', acc_ms: 5000, running_since_ms: null }, { id: 2, name: 'B', acc_ms: 3200, running_since_ms: null }] });
  s = changed(s, 1, afterStop);
  assert.deepEqual(s.tracker!.timers.map((x) => [x.acc_ms, x.running_since_ms]), [[5000, 4100], [3200, null]]);
  assert.equal(s.pending.length, 1);
  // the second answer: nothing pending, the server's state as it is
  const afterStart = tracker({ timers: [{ id: 1, name: 'A', acc_ms: 5000, running_since_ms: 4300 }, afterStop.timers[1]] });
  s = changed(s, 2, afterStart);
  assert.deepEqual(s, { ...LOADING, tracker: afterStart, base: afterStart });
});

test('load: stop one timer then start another, the first answer slow: the start stays at its click time', () => {
  const t = tracker({ timers: [{ id: 1, name: 'A', acc_ms: 0, running_since_ms: 1000 }, { id: 2, name: 'B', acc_ms: 0, running_since_ms: null }] });
  let s = pressed(polled(LOADING, t), { id: 1, action: { kind: 'stop', id: 1 }, at: 61000 });
  s = pressed(s, { id: 2, action: { kind: 'start', id: 2 }, at: 61100 });
  const shown = (x: typeof s) => x.tracker!.timers.map((y) => [y.acc_ms, y.running_since_ms]);
  assert.deepEqual(shown(s), [[60000, null], [0, 61100]]);
  // 1.5 s later the stop's answer, stamped at its press: the start, still waiting, stays on top
  s = changed(s, 1, tracker({ timers: [{ ...t.timers[0], acc_ms: 60000, running_since_ms: null }, t.timers[1]] }));
  assert.deepEqual(shown(s), [[60000, null], [0, 61100]]);
  // then the start's answer, stamped at its click: nothing moves
  s = changed(s, 2, tracker({ timers: [{ ...t.timers[0], acc_ms: 60000, running_since_ms: null }, { ...t.timers[1], running_since_ms: 61100 }] }));
  assert.deepEqual(shown(s), [[60000, null], [0, 61100]]);
  assert.deepEqual(s.pending, []);
});

test('load: a refused press snaps back with the reason; a later press stays', () => {
  const t = idle();
  let s = pressed(polled(LOADING, t), { id: 1, action: { kind: 'start', id: 1 }, at: 4000 });
  s = pressed(s, { id: 2, action: { kind: 'stop', id: 2 }, at: 4100 });
  s = changeFailed(s, 1, new ApiError(409, 'This day has ended and saved itself. Press Start today for the next one.', 'day_ended'));
  assert.equal(s.error, 'This day has ended and saved itself. Press Start today for the next one.');
  assert.deepEqual(s.tracker!.timers.map((x) => [x.acc_ms, x.running_since_ms]), [[5000, null], [3100, null]]);
  // a press that never arrived snaps back too
  s = changeFailed(s, 2, OFFLINE);
  assert.deepEqual(s.tracker, t);
  assert.equal(s.error, 'Could not reach Time Track, so that change did not go through. Try again.');
});

// ── paths and the clock ──────────────────────────────────────────────────────

test('load: at the open day\'s end the page shows it saved at once and drops presses still on their way', () => {
  const open = day('2026-11-15', '09:02');
  const t = tracker({ phase: 'live', open_day: open, timers: [timer(1, 'Writing', 0, open.day_end_ms - H)] });
  const s = pressed(polled(LOADING, t), { id: 1, action: { kind: 'stop', id: 1 }, at: open.day_end_ms - 10 });
  assert.equal(reachedEnd(s, open.day_end_ms - 1), s);
  const e = reachedEnd(s, open.day_end_ms);
  assert.deepEqual(e.pending, []);
  assert.equal(e.tracker!.open_day, null);
  assert.equal(e.tracker!.last_outcome, 'saved');
  assert.deepEqual(e.tracker!.timers, [timer(1, 'Writing')]);
  assert.equal(reachedEnd(LOADING, open.day_end_ms), LOADING);
});

test('tracker slugs from URLs', () => {
  assert.equal(slugOf('/time-track/workday'), 'workday');
  assert.equal(slugOf('/time-track/workday/charts'), 'workday');
  assert.equal(slugOf('/time-track/new'), null);
  assert.equal(slugOf('/time-track'), null);
  assert.equal(slugOf('/time-track/Bad_Slug'), null);
});

test('server clock offset keeps the sample with the shortest round trip', () => {
  const a = sampleOf(10_000, 1_000, 1_200);
  assert.deepEqual(a, { offset: 8_900, rtt: 200 });
  const worse = sampleOf(11_400, 2_000, 3_000);
  assert.deepEqual(better(a, worse), { offset: 8_900, rtt: 210 });
  const closer = sampleOf(11_960, 3_000, 3_020);
  assert.deepEqual(better(a, closer), closer);
  // this device's clock jumped an hour: the new offset wins at once, round trip or not
  const jumped = sampleOf(40_000 + 3_600_000, 4_000, 4_900);
  assert.deepEqual(better(a, jumped), jumped);
  // an odd sent + received sum still gives whole milliseconds: the server takes only an
  // integer pressed_at_ms, so a .5 offset would make every press stamped on arrival
  assert.ok(Number.isInteger(sampleOf(10_000, 1_000, 1_201).offset));
});
