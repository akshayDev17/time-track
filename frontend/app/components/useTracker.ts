'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getTracker, isSignedOut, ApiError } from '../../lib/api';
import type { Tracker, TrackerResponse } from '../../lib/types';

/** How often a visible tracker page asks the server for changes made on other devices. */
export const POLL_MS = 3000;
const CHANNEL = 'time-track';

export type Load = { tracker: Tracker | null; missing: boolean; expired: boolean; error: string | null };

/**
 * One tracker's server state, kept fresh: polled while the tab is visible, reloaded when it
 * comes back, and announced to this browser's other tabs (BroadcastChannel) after each change
 * so they follow at once. `run` sends one change and takes the server's answer as the state.
 */
export function useTracker(slug: string | null) {
  const [state, setState] = useState<Load>({ tracker: null, missing: false, expired: false, error: null });
  const busy = useRef(0);
  const changes = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);

  const fail = useCallback((e: unknown) => {
    if (isSignedOut(e)) setState((s) => ({ ...s, expired: true }));
    else if (e instanceof ApiError && e.status === 404) setState((s) => ({ ...s, missing: true }));
    else setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Something went wrong.' }));
  }, []);

  const load = useCallback(() => {
    if (!slug || busy.current) return;
    const sent = changes.current;
    getTracker(slug).then((r) => {
      if (!busy.current && changes.current === sent) setState((s) => ({ ...s, tracker: r.tracker, missing: false }));
    }, fail);
  }, [slug, fail]);

  const run = useCallback(
    async (call: () => Promise<TrackerResponse>): Promise<ApiError | null> => {
      busy.current += 1;
      changes.current += 1;
      try {
        const r = await call();
        setState((s) => ({ ...s, tracker: r.tracker, error: null }));
        channel.current?.postMessage({ slug });
        return null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setState((s) => ({ ...s, error: e.message }));
          return e;
        }
        fail(e);
        return e instanceof ApiError ? e : null;
      } finally {
        busy.current -= 1;
      }
    },
    [slug, fail],
  );

  useEffect(() => {
    if (!slug) {
      setState((s) => ({ ...s, missing: true }));
      return;
    }
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

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);
  return { ...state, run, reload: load, clearError };
}
