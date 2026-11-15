'use client';

import { useEffect, useState } from 'react';
import { deleteTracker, listTrackers } from '../../lib/api';
import { serverNow } from '../../lib/clock';
import { plural } from '../../lib/format';
import { chartsHref, newHref, trackerHref } from '../../lib/paths';
import type { TrackerSummary } from '../../lib/types';
import { listPill } from '../../lib/views';
import { ConfirmDialog } from './Dialog';
import { ChartIcon, Pill, useTick } from './parts';

/** Trackers (view 2): each row's day state, its chart icon and Delete; New tracker on top. */
export default function TrackersList({ initial, onError }: { initial: TrackerSummary[]; onError: (e: unknown) => void }) {
  const [rows, setRows] = useState(initial);
  const [deleting, setDeleting] = useState<TrackerSummary | null>(null);
  useTick(true, 30000);

  // Open days run elsewhere too: refresh when the tab comes back.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') listTrackers().then((r) => setRows(r.trackers), onError);
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [onError]);

  const now = serverNow();
  return (
    <>
      <div className="lhead">
        <h2>Your trackers</h2>
        <a className="btn" href={newHref()}>New tracker</a>
      </div>
      {rows.length ? (
        <ul className="tlist">
          {rows.map((t) => (
            <li className="card trk" key={t.slug}>
              <div className="trk-main">
                <a className="tn" href={trackerHref(t.slug)}>{t.name}</a>
                <div className="tm">{plural(t.timer_count, 'timer')}</div>
                <div className="ts"><Pill pill={listPill(t, now)} /></div>
              </div>
              <div className="acts">
                <a className="iconbtn" href={chartsHref(t.slug)} aria-label={`Charts for ${t.name}`} title="Charts"><ChartIcon /></a>
                <button type="button" className="btn ghost sm dangertext" onClick={() => setDeleting(t)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card empty"><p>No trackers yet. Make one with New tracker.</p></div>
      )}
      {deleting && (
        <ConfirmDialog
          body={`${deleting.name} and every day in it are deleted for good.`}
          ok="Delete tracker"
          onCancel={() => setDeleting(null)}
          onOk={() => {
            const slug = deleting.slug;
            setDeleting(null);
            deleteTracker(slug).then(() => setRows((rs) => rs.filter((r) => r.slug !== slug)), onError);
          }}
        />
      )}
    </>
  );
}
