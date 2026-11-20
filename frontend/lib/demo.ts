/**
 * The public page's ten timers: browser-only, kept in this browser across reloads and shared
 * by its tabs (open point C10). They follow a signed-in tracker's day rule: the first Start
 * opens a day of exactly 24 hours, and when it ends every timer stops at the end, the day is
 * saved here (its span and total), and the timers go back to zero until the next Start.
 * Every function is pure: each tab works out the same close from the same stored state.
 */
import { applyTimers, type TimerAction } from './timers.ts';
import type { Timer } from './types.ts';

export const DEMO_KEY = 'time-track:demo';
export const DEMO_COUNT = 10;
/** A day ends exactly this long after it opened, as on the server (backend rules.DAY_MS). */
export const DAY_MS = 24 * 3_600_000;

export type DemoDay = { start_ms: number; end_ms: number };
export type DemoSaved = DemoDay & { total_ms: number };
export type Demo = { day: DemoDay | null; timers: Timer[]; saved: DemoSaved | null };

const zeroTimers = (): Timer[] => Array.from({ length: DEMO_COUNT }, (_, i) => ({ id: i + 1, name: '', acc_ms: 0, running_since_ms: null }));
const elapsedAt = (t: Timer, now: number) => t.acc_ms + (t.running_since_ms !== null ? Math.max(0, now - t.running_since_ms) : 0);
const dayFrom = (start: number): DemoDay => ({ start_ms: start, end_ms: start + DAY_MS });

export function freshDemo(): Demo {
  return { day: null, timers: zeroTimers(), saved: null };
}

/** `d` at `now`: a day whose end has come is closed at that end (saved), timers at zero. */
export function settleDemo(d: Demo, now: number): Demo {
  if (!d.day || now < d.day.end_ms) return d;
  const end = d.day.end_ms;
  const total = d.timers.reduce((sum, t) => sum + elapsedAt(t, end), 0);
  return {
    day: null,
    saved: { ...d.day, total_ms: total },
    timers: d.timers.map((t) => ({ ...t, acc_ms: 0, running_since_ms: null })),
  };
}

/** A button press at `now`: the day closes first if it has ended, and a press that starts a
 * timer with no day open opens one. */
export function actDemo(d: Demo, a: TimerAction, now: number): Demo {
  const s = settleDemo(d, now);
  const timers = applyTimers(s.timers, a, now);
  const day = s.day ?? (timers.some((t) => t.running_since_ms !== null) ? dayFrom(now) : null);
  return { ...s, day, timers };
}

function parseTimers(v: unknown): Timer[] | null {
  if (!Array.isArray(v) || v.length !== DEMO_COUNT) return null;
  return v.map((t, i) => ({
    id: i + 1,
    name: typeof t?.name === 'string' ? t.name.slice(0, 60) : '',
    acc_ms: Number.isFinite(t?.acc_ms) && t.acc_ms > 0 ? t.acc_ms : 0,
    running_since_ms: Number.isFinite(t?.running_since_ms) ? t.running_since_ms : null,
  }));
}

function parseDay(v: unknown): DemoDay | null {
  const d = v as { start_ms?: unknown; end_ms?: unknown } | null;
  return d && Number.isFinite(d.start_ms) && d.end_ms === (d.start_ms as number) + DAY_MS ? dayFrom(d.start_ms as number) : null;
}

/**
 * The stored demo, or a fresh one when there is none or it does not parse. Timers stored
 * before days existed (a bare list) get a day from their earliest run still going, or from
 * `now` when they only hold time, so they too close 24 hours later.
 */
export function parseDemo(raw: string | null, now: number): Demo {
  if (!raw) return freshDemo();
  try {
    const v = JSON.parse(raw);
    const legacy = parseTimers(v);
    if (legacy) {
      const since = legacy.map((t) => t.running_since_ms).filter((x): x is number => x !== null);
      const used = since.length > 0 || legacy.some((t) => t.acc_ms > 0);
      return { day: used ? dayFrom(since.length ? Math.min(...since) : now) : null, timers: legacy, saved: null };
    }
    const timers = parseTimers(v?.timers);
    if (!timers) return freshDemo();
    const saved = parseDay(v.saved);
    return {
      day: parseDay(v.day),
      timers,
      saved: saved && Number.isFinite(v.saved.total_ms) && v.saved.total_ms >= 0 ? { ...saved, total_ms: v.saved.total_ms } : null,
    };
  } catch {
    return freshDemo();
  }
}

export function loadDemo(now: number): Demo {
  try {
    return parseDemo(window.localStorage.getItem(DEMO_KEY), now);
  } catch {
    return freshDemo();
  }
}

export function saveDemo(d: Demo): void {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(d));
  } catch {
    // storage blocked: the timers still run, they just do not survive a reload
  }
}
