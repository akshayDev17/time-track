/**
 * The public page's ten timers: browser-only, kept in this browser across reloads and shared
 * by its tabs (open point C10), like the reference. Pure transitions over a plain list, plus
 * the storage read and write.
 */
import type { Timer } from './types.ts';

export const DEMO_KEY = 'time-track:demo';
export const DEMO_COUNT = 10;

export function freshDemo(): Timer[] {
  return Array.from({ length: DEMO_COUNT }, (_, i) => ({ id: i + 1, name: '', acc_ms: 0, running_since_ms: null }));
}

const running = (t: Timer) => t.running_since_ms !== null;
const elapsed = (t: Timer, now: number) => t.acc_ms + (running(t) ? Math.max(0, now - t.running_since_ms!) : 0);
const start = (t: Timer, now: number): Timer => (running(t) ? t : { ...t, running_since_ms: now });
const stop = (t: Timer, now: number): Timer => (running(t) ? { ...t, acc_ms: elapsed(t, now), running_since_ms: null } : t);

export type DemoAction =
  | { kind: 'start' | 'stop' | 'clear'; id: number }
  | { kind: 'start-all' | 'stop-all' | 'relaunch' | 'clear-all' | 'delete-names' }
  | { kind: 'rename'; id: number; name: string };

export function applyDemo(ts: Timer[], a: DemoAction, now: number): Timer[] {
  switch (a.kind) {
    case 'start': return ts.map((t) => (t.id === a.id ? start(t, now) : t));
    case 'stop': return ts.map((t) => (t.id === a.id ? stop(t, now) : t));
    case 'clear': return ts.map((t) => (t.id === a.id && !running(t) ? { ...t, acc_ms: 0 } : t));
    case 'start-all': return ts.map((t) => (!running(t) && t.acc_ms === 0 ? start(t, now) : t));
    case 'stop-all': return ts.map((t) => stop(t, now));
    case 'relaunch': return ts.map((t) => (!running(t) && t.acc_ms > 0 ? start(t, now) : t));
    case 'clear-all': return ts.some(running) ? ts : ts.map((t) => ({ ...t, acc_ms: 0 }));
    case 'delete-names': return ts.map((t) => ({ ...t, name: '' }));
    case 'rename': return ts.map((t) => (t.id === a.id ? { ...t, name: a.name.slice(0, 60) } : t));
  }
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
