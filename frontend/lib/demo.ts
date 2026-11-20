/**
 * The public page's ten timers: browser-only, kept in this browser across reloads and shared
 * by its tabs (open point C10), like the reference: a fresh set, and the storage read and
 * write. Its buttons move the timers with `applyTimers` (timers.ts).
 */
import type { Timer } from './types.ts';

export const DEMO_KEY = 'time-track:demo';
export const DEMO_COUNT = 10;

export function freshDemo(): Timer[] {
  return Array.from({ length: DEMO_COUNT }, (_, i) => ({ id: i + 1, name: '', acc_ms: 0, running_since_ms: null }));
}

/** The stored timers, or a fresh set when there are none or they do not parse. */
export function parseDemo(raw: string | null): Timer[] {
  if (!raw) return freshDemo();
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v) || v.length !== DEMO_COUNT) return freshDemo();
    return v.map((t, i) => ({
      id: i + 1,
      name: typeof t?.name === 'string' ? t.name.slice(0, 60) : '',
      acc_ms: Number.isFinite(t?.acc_ms) && t.acc_ms > 0 ? t.acc_ms : 0,
      running_since_ms: Number.isFinite(t?.running_since_ms) ? t.running_since_ms : null,
    }));
  } catch {
    return freshDemo();
  }
}

export function loadDemo(): Timer[] {
  try {
    return parseDemo(window.localStorage.getItem(DEMO_KEY));
  } catch {
    return freshDemo();
  }
}

export function saveDemo(ts: Timer[]): void {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(ts));
  } catch {
    // storage blocked: the timers still run, they just do not survive a reload
  }
}
