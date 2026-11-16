/**
 * What a tracker page knows about its tracker, and how each server answer moves it.
 *
 * Two kinds of answers arrive: a poll (the page asking for changes made elsewhere) and a
 * change (one button press). `error` is a change the server refused and stays until it is
 * dismissed or a change succeeds; `pollError` is a poll that failed and goes with the next
 * poll that succeeds, so a laptop waking before its network is back clears itself.
 *
 * A timer press shows at once: it is kept as `pending` (its action and the server time it was
 * pressed at) and `tracker` is the last server answer (`base`) with every pending press applied.
 * The page sends changes one at a time, in order, so each answer already holds every earlier
 * press: it becomes the new base and the presses still waiting are applied over it again. A
 * press the server refuses, or that never arrives, is dropped, so the card snaps back.
 */
import { ApiError, isSignedOut } from './api.ts';
import { applyTimers, type TimerAction } from './timers.ts';
import type { Tracker } from './types.ts';

export type Press = { id: number; action: TimerAction; at: number };

export type Load = {
  tracker: Tracker | null;
  base: Tracker | null;
  pending: Press[];
  missing: boolean;
  expired: boolean;
  error: string | null;
  pollError: string | null;
};

/** Nothing known yet: the first answer is still on its way. */
export const LOADING: Load = { tracker: null, base: null, pending: [], missing: false, expired: false, error: null, pollError: null };

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Could not reach Time Track, so that change did not go through. Try again.';

/** `base` with every press in `pending` applied, in order. */
export function withPresses(base: Tracker | null, pending: Press[]): Tracker | null {
  if (!base) return null;
  return pending.reduce((t, p) => ({ ...t, timers: applyTimers(t.timers, p.action, p.at) }), base);
}

/** A poll answered: the server is reachable, signed in and has the tracker. */
export const polled = (s: Load, tracker: Tracker): Load => ({ ...LOADING, tracker, base: tracker, error: s.error });

/** A poll failed. A 404 means the tracker is gone (deleted on another device): drop it. */
export function pollFailed(s: Load, e: unknown): Load {
  if (isSignedOut(e)) return { ...s, expired: true };
  if (e instanceof ApiError && e.status === 404) return { ...LOADING, missing: true };
  return { ...s, pollError: e instanceof Error ? e.message : 'Something went wrong.' };
}

/** A press, shown at once, before its answer. */
export function pressed(s: Load, press: Press): Load {
  const pending = [...s.pending, press];
  return { ...s, pending, tracker: withPresses(s.base, pending) };
}

/** Change `id` went through: its answer is the whole state, with the presses still waiting on top. */
export function changed(s: Load, id: number, tracker: Tracker): Load {
  const pending = s.pending.filter((p) => p.id !== id);
  return { ...LOADING, base: tracker, pending, tracker: withPresses(tracker, pending) };
}

/** Change `id` was refused or never arrived: its press is undone, with the reason. */
export function changeFailed(s: Load, id: number, e: unknown): Load {
  const pending = s.pending.filter((p) => p.id !== id);
  const back = { ...s, pending, tracker: withPresses(s.base, pending) };
  if (isSignedOut(e)) return { ...back, expired: true };
  return { ...back, error: message(e) };
}

export const dismissed = (s: Load): Load => ({ ...s, error: null, pollError: null });
