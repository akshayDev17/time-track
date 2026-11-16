'use client';

import { useEffect, useState } from 'react';
import { ApiError, getHistory, getMe, isSignedOut, SIGN_IN_HREF } from '../../../lib/api';
import { charts, medianNote, type Range } from '../../../lib/charts';
import { dateLabel } from '../../../lib/format';
import { homeHref, slugOf, trackerHref } from '../../../lib/paths';
import type { HistoryResponse } from '../../../lib/types';
import Masthead from '../../components/Masthead';
import { GraphRow } from '../../components/parts';

const RANGES: [Range, string][] = [[30, '30 days'], [90, '90 days'], ['all', 'All']];

/**
 * The Charts page (view 11): the Total graph first (every timer's time, day by day), then one
 * graph per timer, each with its median card, over 30 / 90 / All (opening on 30, A1), all on
 * one axis from the tracker's first saved day (lib/charts.ts). A removed timer keeps its
 * graph, marked removed (A3). Discarded days were never saved, so they never show here.
 */
export default function ChartsPage() {
  const [slug, setSlug] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [problem, setProblem] = useState<'missing' | 'expired' | string | null>(null);
  const [range, setRange] = useState<Range>(30);

  useEffect(() => {
    const s = slugOf(window.location.pathname);
    setSlug(s);
    getMe().then((me) => setEmail(me.email), () => {});
    if (!s) {
      setProblem('missing');
      return;
    }
    getHistory(s).then(setHistory, (e) => {
      if (isSignedOut(e)) setProblem('expired');
      else if (e instanceof ApiError && e.status === 404) setProblem('missing');
      else setProblem(e instanceof Error ? e.message : 'Something went wrong.');
    });
  }, []);

  const name = history?.name ?? 'Tracker';
  const tail = [{ label: 'Trackers', href: homeHref() }, { label: name, href: slug ? trackerHref(slug) : undefined }, { label: 'Charts' }];
  const data = history ? charts(history, range) : null;

  return (
    <div className="pw">
      <Masthead session="signed-in" email={email} tail={tail} />
      {problem === 'expired' && <div className="banner" role="alert">Your sign-in expired.<a className="linkbtn" href={SIGN_IN_HREF}>Sign in again</a></div>}
      {problem === 'missing' && <div className="card empty"><p>No such tracker. <a className="inl" href={homeHref()}>Back to your trackers</a>.</p></div>}
      {problem && problem !== 'expired' && problem !== 'missing' && <div className="banner" role="alert">{problem}</div>}
      {!problem && !history && <p className="loading">Loading…</p>}
      {history && (
        <>
          <div className="thead">
            <h2>{history.name} · charts</h2>
            <div className="right">
              <div className="rseg" role="group" aria-label="Range">
                {RANGES.map(([r, label]) => (
                  <button type="button" key={String(r)} aria-pressed={range === r} onClick={() => setRange(r)}>{label}</button>
                ))}
              </div>
              <a className="btn ghost sm" href={trackerHref(history.slug)}>Back to tracker</a>
            </div>
          </div>
          <p className="gnote">The total of every timer comes first, then one graph per timer, all on the same dates. Each circle is a saved day; hover or tap one to read it. The dashed line is the median.</p>
          {data ? (
            [data.total, ...data.timers].map((g) => (
              <GraphRow
                key={g.key}
                title={g.title}
                points={g.points}
                tips={g.tips}
                median={g.median}
                medianNote={medianNote(g.saved, range)}
                from={data.from}
                to={data.to}
                total={g.timer === null}
                removed={g.timer?.removed_on != null}
                sub={g.timer?.removed_on ? `Removed ${dateLabel(g.timer.removed_on)}. Its saved days stay.` : undefined}
              />
            ))
          ) : (
            <div className="card empty"><p>No saved days yet. Save a day and its times show up here, one graph per timer.</p></div>
          )}
        </>
      )}
    </div>
  );
}
