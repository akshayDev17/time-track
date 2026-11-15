'use client';

import { useEffect, useState } from 'react';
import { createTracker, getMe, isSignedOut, SIGN_IN_HREF } from '../../lib/api';
import { homeHref, trackerHref } from '../../lib/paths';
import { MAX_TIMERS } from '../../lib/views';
import Masthead from '../components/Masthead';

/** New tracker (view 3): a name and 1 to 15 timers, starting at 10 like the reference (B4). */
export default function NewTracker() {
  const [name, setName] = useState('');
  const [count, setCount] = useState(10);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMe().then((me) => setEmail(me.email), () => {});
  }, []);

  const create = () => {
    setBusy(true);
    createTracker(name, count).then(
      (r) => window.location.assign(trackerHref(r.tracker.slug)),
      (e) => {
        setBusy(false);
        setError(isSignedOut(e) ? 'Your sign-in expired.' : e instanceof Error ? e.message : 'Something went wrong.');
      },
    );
  };

  return (
    <div className="pw">
      <Masthead session="signed-in" email={email} tail={[{ label: 'Trackers', href: homeHref() }, { label: 'New tracker' }]} />
      {error && (
        <div className="banner" role="alert">
          {error}
          {error === 'Your sign-in expired.' && <a className="linkbtn" href={SIGN_IN_HREF}>Sign in again</a>}
        </div>
      )}
      <form className="card form" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <h2>New tracker</h2>
        <div className="fld">
          <label htmlFor="nt-name">Name</label>
          <input id="nt-name" className="inp" type="text" value={name} maxLength={60} placeholder="e.g. Workday" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fld">
          <span className="flab">Timers</span>
          <div className="stepper">
            <button type="button" aria-label="One fewer timer" disabled={count <= 1} onClick={() => setCount((c) => Math.max(1, c - 1))}>−</button>
            <output aria-live="polite">{count}</output>
            <button type="button" aria-label="One more timer" disabled={count >= MAX_TIMERS} onClick={() => setCount((c) => Math.min(MAX_TIMERS, c + 1))}>+</button>
          </div>
          <p className="hint">1 to 15. You can add, remove and rename them later.</p>
        </div>
        <p className="hint hint2">Each day you track is stamped with the date and time zone where you press Start today.</p>
        <div className="frow">
          <button type="submit" className="btn" disabled={busy}>Create tracker</button>
          <a className="btn ghost" href={homeHref()}>Cancel</a>
        </div>
      </form>
    </div>
  );
}
