/**
 * What each timer button does to a list of timers at time `now`: the same rules the server
 * applies (backend/time_track/store.py). The public demo runs on these alone; a signed-in
 * tracker page uses them to show a press at once, before the server's answer arrives.
 */
import type { Timer } from './types.ts';

const running = (t: Timer) => t.running_since_ms !== null;
const elapsed = (t: Timer, now: number) => t.acc_ms + (running(t) ? Math.max(0, now - t.running_since_ms!) : 0);
const start = (t: Timer, now: number): Timer => (running(t) ? t : { ...t, running_since_ms: now });
const stop = (t: Timer, now: number): Timer => (running(t) ? { ...t, acc_ms: elapsed(t, now), running_since_ms: null } : t);

export type TimerAction =
  | { kind: 'start' | 'stop' | 'clear'; id: number }
  | { kind: 'start-all' | 'stop-all' | 'relaunch' | 'clear-all' | 'delete-names' }
  | { kind: 'rename'; id: number; name: string };

export function applyTimers(ts: Timer[], a: TimerAction, now: number): Timer[] {
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
