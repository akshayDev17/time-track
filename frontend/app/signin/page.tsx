'use client';

import { useEffect } from 'react';
import { homeHref } from '../../lib/paths';
import Masthead from '../components/Masthead';

/**
 * Where Sign in goes: a protected page whose only job is to be reached. Access signs the
 * visitor in on the way here, then this hands them back to /time-track, now their Trackers.
 */
export default function SignIn() {
  useEffect(() => {
    window.location.replace(homeHref());
  }, []);
  return (
    <div className="pw">
      <Masthead session="pending" tail={[]} />
      <p className="loading">Signing you in…</p>
    </div>
  );
}
