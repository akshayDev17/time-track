/**
 * What a tracker page knows about its tracker, and how each server answer moves it.
 *
 * Two kinds of answers arrive: a poll (the page asking for changes made elsewhere) and a
 * change (one button press). `error` is a change the server refused and stays until it is
 * dismissed or a change succeeds; `pollError` is a poll that failed and goes with the next
 * poll that succeeds, so a laptop waking before its network is back clears itself.
 */
import { ApiError, isSignedOut } from './api.ts';
import type { Tracker } from './types.ts';

export type Load = {
  tracker: Tracker | null;
  missing: boolean;
  expired: boolean;
  error: string | null;
  pollError: string | null;
};

/** Nothing known yet: the first answer is still on its way. */
export const LOADING: Load = { tracker: null, missing: false, expired: false, error: null, pollError: null };

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

/** A poll answered: the server is reachable, signed in and has the tracker. */
export const polled = (s: Load, tracker: Tracker): Load => ({ ...LOADING, tracker, error: s.error });

/** A poll failed. A 404 means the tracker is gone (deleted on another device): drop it. */
export function pollFailed(s: Load, e: unknown): Load {
  if (isSignedOut(e)) return { ...s, expired: true };
  if (e instanceof ApiError && e.status === 404) return { ...LOADING, missing: true };
  return { ...s, pollError: message(e) };
}

/** A change went through: its answer is the whole state. */
export const changed = (tracker: Tracker): Load => ({ ...LOADING, tracker });

/** A change was refused or never arrived: the tracker stays as it was, with the reason. */
export function changeFailed(s: Load, e: unknown): Load {
  if (isSignedOut(e)) return { ...s, expired: true };
  return { ...s, error: message(e) };
}

export const dismissed = (s: Load): Load => ({ ...s, error: null, pollError: null });
