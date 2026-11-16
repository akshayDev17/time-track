'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getTracker, ApiError } from '../../lib/api';
import { serverNow } from '../../lib/clock';
import { LOADING, changed, changeFailed, dismissed, pollFailed, polled, pressed, type Load } from '../../lib/load';
import type { TimerAction } from '../../lib/timers';
import type { TrackerResponse } from '../../lib/types';

/** How often a visible tracker page asks the server for changes made on other devices. */
export const POLL_MS = 3000;
const CHANNEL = 'time-track';

/**
 * One tracker's server state, kept fresh: polled while the tab is visible, reloaded when it
 * comes back, and announced to this browser's other tabs (BroadcastChannel) after each change
 * so they follow at once. `run` sends one change and takes the server's answer as the state;
 * `call` gets the press time on the server's clock, for the server to stamp the change with.
 * Given the timer action it makes, the press shows at once at that time (lib/load.ts), and
 * snaps back if the server refuses it. Changes go one at a time, in the order pressed, so
 * each answer holds every earlier press.
 *
 * `slug` is undefined until the page has read its URL (nothing is known yet, nothing is
 * asked) and null when the URL names no tracker (missing, without asking).
 */
export function useTracker(slug: string | null | undefined) {
  const [state, setState] = useState<Load>(LOADING);
  const busy = useRef(0);
  const changes = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);

  const load = useCallback(() => {
    if (!slug || busy.current) return;
    const sent = changes.current;
    getTracker(slug).then(
      (r) => {
        if (!busy.current && changes.current === sent) setState((s) => polled(s, r.tracker));
      },
      (e) => setState((s) => pollFailed(s, e)),
    );
  }, [slug]);

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback(
    (call: (at: number) => Promise<TrackerResponse>, action?: TimerAction): Promise<ApiError | null> => {
      busy.current += 1;
      changes.current += 1;
      const id = changes.current;
      const at = serverNow();
      if (action) setState((s) => pressed(s, { id, action, at }));
      const sent = queue.current.then(async () => {
        try {
          const r = await call(at);
          setState((s) => changed(s, id, r.tracker));
          channel.current?.postMessage({ slug });
          return null;
        } catch (e) {
          setState((s) => changeFailed(s, id, e));
          return e instanceof ApiError ? e : null;
        } finally {
          busy.current -= 1;
        }
      });
      queue.current = sent;
      return sent;
    },
    [slug],
  );

  useEffect(() => {
    if (!slug) return;
    load();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    try {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.onmessage = (m) => {
        if (m.data?.slug === slug) load();
      };
    } catch {
      channel.current = null;
    }
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      channel.current?.close();
    };
  }, [slug, load]);

  const clearError = useCallback(() => setState(dismissed), []);
  return {
    tracker: state.tracker,
    missing: slug === null || state.missing,
    expired: state.expired,
    error: state.error ?? state.pollError,
    run,
    reload: load,
    clearError,
  };
}
