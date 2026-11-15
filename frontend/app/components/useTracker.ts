'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getTracker, ApiError } from '../../lib/api';
import { LOADING, changed, changeFailed, dismissed, pollFailed, polled, type Load } from '../../lib/load';
import type { TrackerResponse } from '../../lib/types';

/** How often a visible tracker page asks the server for changes made on other devices. */
export const POLL_MS = 3000;
const CHANNEL = 'time-track';

/**
 * One tracker's server state, kept fresh: polled while the tab is visible, reloaded when it
 * comes back, and announced to this browser's other tabs (BroadcastChannel) after each change
 * so they follow at once. `run` sends one change and takes the server's answer as the state.
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

  const run = useCallback(
    async (call: () => Promise<TrackerResponse>): Promise<ApiError | null> => {
      busy.current += 1;
      changes.current += 1;
      try {
        const r = await call();
        setState(changed(r.tracker));
        channel.current?.postMessage({ slug });
        return null;
      } catch (e) {
        setState((s) => changeFailed(s, e));
        return e instanceof ApiError ? e : null;
      } finally {
        busy.current -= 1;
      }
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
