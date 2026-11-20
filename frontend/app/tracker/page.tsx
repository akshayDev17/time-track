'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../lib/api';
import { serverNow } from '../../lib/clock';
import { dateLabel, plural } from '../../lib/format';
import { chartsHref, homeHref, slugOf } from '../../lib/paths';
import { cardClock, cardMode, dayPanel, RENAME_HINT, settled, trackerView, type DayButton } from '../../lib/views';
import { dayStamp } from '../../lib/zones';
import { ConfirmDialog } from '../components/Dialog';
import Masthead from '../components/Masthead';
import { ChartIcon, ControlBar, Pill, RenameGrid, TimerCard, useTick } from '../components/parts';
import { useTracker } from '../components/useTracker';

type Confirm =
  | { kind: 'clear'; id: number }
  | { kind: 'clear-all' }
  | { kind: 'remove'; id: number }
  | { kind: 'discard' }
  | null;

const RENAME_DELAY_MS = 600;

function DayButtonCell({ cls, label, b, onClick }: { cls: string; label: string; b: DayButton; onClick?: () => void }) {
  return (
    <div className="dbtn">
      <button type="button" className={`btn ${cls}`} disabled={!b.on} onClick={onClick}>{label}</button>
      <p className="why">{b.why}</p>
    </div>
  );
}

/**
 * The tracker page: /time-track/<slug>. What it shows depends on its day (views 4, 7 and 10);
 * every value comes from the server's start and stop times, so every device signed in to the
 * account shows the same times, ticking. At the day's end it shows the day saved and every
 * timer at zero, without a reload.
 */
export default function TrackerPage() {
  const [slug, setSlug] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    setSlug(slugOf(window.location.pathname));
    api.getMe().then((me) => setEmail(me.email), () => {});
  }, []);
  const { tracker: answered, missing, expired, error, run, clearError } = useTracker(slug);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  useTick(true, 1000); // the countdown

  const sendName = useCallback(
    (id: number, name: string) => {
      if (!slug) return;
      clearTimeout(timers.current[id]);
      void run(() => api.renameTimer(slug, id, name));
    },
    [slug, run],
  );

  if (slug === undefined || (!answered && !missing && !expired && !error)) {
    return (
      <div className="pw">
        <Masthead session="signed-in" email={email} tail={[{ label: 'Trackers', href: homeHref() }, { label: 'Tracker' }]} />
        <p className="loading">Loading…</p>
      </div>
    );
  }
  if (!answered) {
    return (
      <div className="pw">
        <Masthead session="signed-in" email={email} tail={[{ label: 'Trackers', href: homeHref() }, { label: 'Tracker' }]} />
        {expired ? (
          <div className="banner" role="alert">Your sign-in expired.<a className="linkbtn" href={api.SIGN_IN_HREF}>Sign in again</a></div>
        ) : error ? (
          <div className="banner" role="alert">{error}</div>
        ) : (
          <div className="card empty"><p>No such tracker. <a className="inl" href={homeHref()}>Back to your trackers</a>.</p></div>
        )}
      </div>
    );
  }

  const s = slug!;
  const now = serverNow();
  const tracker = settled(answered, now);
  const view = trackerView(tracker, now);
  const mode = cardMode(view);
  const panel = dayPanel(tracker, now);
  const day = tracker.open_day;
  const ts = tracker.timers;
  const tname = (id: number) => {
    const i = ts.findIndex((t) => t.id === id);
    return (drafts[id] ?? ts[i]?.name) || `Timer ${i + 1}`;
  };

  const onStartToday = () => {
    clearError();
    void run(() => api.startToday(s, dayStamp(serverNow())));
  };

  const onConfirm = () => {
    const c = confirm!;
    setConfirm(null);
    if (c.kind === 'clear') void run((at) => api.timerAction(s, c.id, 'clear', at));
    else if (c.kind === 'clear-all') void run((at) => api.trackerAction(s, 'clear-all', at));
    else if (c.kind === 'remove') void run(() => api.removeTimer(s, c.id));
    else void run(() => api.discardDay(s));
  };

  const confirmBody = (c: NonNullable<Confirm>): [string, string] => {
    if (c.kind === 'clear') return [`${tname(c.id)} goes back to 00:00:00.0.`, 'Clear'];
    if (c.kind === 'clear-all') return ['Every timer goes back to 00:00:00.0.', 'Clear all'];
    if (c.kind === 'remove') return [`${tname(c.id)} leaves this tracker. Today’s time on it is not kept. Its saved days stay on the Charts page, marked removed.`, 'Remove timer'];
    return [`${day ? dateLabel(day.date, true) : 'This day'} is deleted for good. It never reaches History or the Charts page.`, 'Discard last day'];
  };

  const rename = (id: number, value: string) => {
    setDrafts((d) => ({ ...d, [id]: value }));
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => sendName(id, value), RENAME_DELAY_MS);
  };
  const renameDone = (id: number) => {
    const value = drafts[id];
    if (value === undefined) return;
    sendName(id, value);
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  };
  const shown = ts.map((t) => (drafts[t.id] !== undefined ? { ...t, name: drafts[t.id] } : t));

  return (
    <div className="pw">
      <Masthead session="signed-in" email={email} tail={[{ label: 'Trackers', href: homeHref() }, { label: tracker.name }]} />
      {expired && <div className="banner" role="alert">Your sign-in expired.<a className="linkbtn" href={api.SIGN_IN_HREF}>Sign in again</a></div>}
      {error && <div className="banner" role="alert">{error}<button type="button" className="linkbtn" onClick={clearError}>Dismiss</button></div>}
      <div className="thead">
        <h2>{tracker.name}</h2>
        <span className="meta">{plural(ts.length, 'timer')}</span>
        <div className="right">
          <a className="btn ghost sm" href={chartsHref(s)}><ChartIcon /> Charts</a>
        </div>
      </div>
      <div className="card dayp">
        <div className="dstat"><Pill pill={panel.pill} /></div>
        <p className="dexp">{panel.explain}</p>
        <div className="dbtns">
          <DayButtonCell cls="go" label="Start today" b={panel.start} onClick={onStartToday} />
          <DayButtonCell cls="" label="Save last day" b={panel.save} />
          <DayButtonCell cls="ghost dangertext" label="Discard last day" b={panel.discard} onClick={() => setConfirm({ kind: 'discard' })} />
        </div>
      </div>
      <ControlBar
        timers={ts}
        mode={mode}
        onAction={(a) => (a === 'clear-all' ? setConfirm({ kind: 'clear-all' }) : void run((at) => api.trackerAction(s, a, at), { kind: a }))}
        extra={<span className="count">{ts.length} of 15 timers</span>}
      />
      <div className="tgrid">
        {shown.map((t, i) => (
          <TimerCard
            key={t.id}
            n={i + 1}
            timer={t}
            mode={mode}
            clock={cardClock(tracker, serverNow)}
            onStart={() => void run((at) => api.timerAction(s, t.id, 'start', at), { kind: 'start', id: t.id })}
            onStop={() => void run((at) => api.timerAction(s, t.id, 'stop', at), { kind: 'stop', id: t.id })}
            onClear={() => setConfirm({ kind: 'clear', id: t.id })}
          />
        ))}
      </div>
      <RenameGrid
        timers={ts}
        names={drafts}
        editable={mode === 'live'}
        removable
        add
        hint={RENAME_HINT[mode]}
        onRename={rename}
        onBlur={renameDone}
        onRemove={(id) => setConfirm({ kind: 'remove', id })}
        onAdd={() => void run(() => api.addTimer(s))}
      />
      {mode === 'live' && (
        <p className="syncl"><Pill pill={{ tone: 'ok', text: 'Synced' }} small />Same values on every device signed in to this account.</p>
      )}
      {confirm && (() => {
        const [body, ok] = confirmBody(confirm);
        return <ConfirmDialog body={body} ok={ok} onOk={onConfirm} onCancel={() => setConfirm(null)} />;
      })()}
    </div>
  );
}
