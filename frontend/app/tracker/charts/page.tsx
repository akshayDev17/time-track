'use client';

import { useEffect, useState } from 'react';
import { ApiError, getHistory, getMe, isSignedOut, SIGN_IN_HREF } from '../../../lib/api';
import { graphs, medianNote, type Range } from '../../../lib/charts';
import { serverNow } from '../../../lib/clock';
import { dateLabel } from '../../../lib/format';
import { homeHref, slugOf, trackerHref } from '../../../lib/paths';
import type { HistoryResponse } from '../../../lib/types';
import { browserZone, localDate } from '../../../lib/zones';
import Masthead from '../../components/Masthead';
import { GraphRow } from '../../components/parts';

const RANGES: [Range, string][] = [[30, '30 days'], [90, '90 days'], ['all', 'All']];

/**
 * The Charts page (view 11): one graph per timer from its saved days, with a median card
 * each, over 30 / 90 / All (opening on 30, A1). A removed timer keeps its graph, marked
 * removed (A3). Discarded days were never saved, so they never show here.
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
  const today = localDate(serverNow(), browserZone());
  const rows = history ? graphs(history, today, range) : [];

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
          <p className="gnote">One graph per timer. Each bar is one saved day; days that were not saved stay empty. The dashed line is the median.</p>
          {history.days.length ? (
            rows.map((g) => (
              <GraphRow
                key={g.timer.id}
                title={g.title}
                bars={g.bars}
                median={g.median}
                medianNote={medianNote(g.saved, range)}
                from={g.from}
                to={g.to}
                removed={g.timer.removed_on !== null}
                sub={g.timer.removed_on ? `Removed ${dateLabel(g.timer.removed_on)}. Its saved days stay.` : undefined}
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
