'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, getMe, isSignedOut, listTrackers } from '../lib/api';
import type { TrackerSummary } from '../lib/types';
import Masthead, { type Session } from './components/Masthead';
import PublicDemo from './components/PublicDemo';
import TrackersList from './components/TrackersList';

/**
 * /time-track. Anyone may open it, and /me decides what it shows: signed in, the Trackers
 * list (open point C8); no Access session, the public page with its ten demo timers.
 */
export default function Home() {
  const [session, setSession] = useState<Session>('pending');
  const [email, setEmail] = useState<string | null>(null);
  const [rows, setRows] = useState<TrackerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => {
    if (isSignedOut(e)) window.location.reload();
    else setError(e instanceof Error ? e.message : 'Something went wrong.');
  }, []);

  useEffect(() => {
    getMe().then(
      (me) => {
        setEmail(me.email);
        setSession('signed-in');
        listTrackers().then((r) => setRows(r.trackers), fail);
      },
      (e) => {
        if (isSignedOut(e)) setSession('signed-out');
        else {
          setSession('signed-out');
          setError(e instanceof ApiError ? e.message : 'Time Track could not reach its server. Reload to try again.');
        }
      },
    );
  }, [fail]);

  return (
    <div className="pw">
      <Masthead session={session} email={email} tail={[]} />
      {error && <div className="banner" role="alert">{error}</div>}
      {session === 'pending' && <p className="loading">Loading…</p>}
      {session === 'signed-out' && <PublicDemo />}
      {session === 'signed-in' && (rows ? <TrackersList initial={rows} onError={fail} /> : <p className="loading">Loading…</p>)}
    </div>
  );
}
