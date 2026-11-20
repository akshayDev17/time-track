'use client';

import { useCallback, useEffect, useState } from 'react';
import { SIGN_IN_HREF } from '../../lib/api';
import { actDemo, DEMO_KEY, freshDemo, loadDemo, saveDemo, settleDemo, type Demo } from '../../lib/demo';
import type { TimerAction } from '../../lib/timers';
import { dur, median } from '../../lib/format';
import { SAMPLE_DAYS } from '../../lib/sample';
import { demoPanel } from '../../lib/views';
import { browserZone } from '../../lib/zones';
import { ConfirmDialog } from './Dialog';
import { ControlBar, GraphRow, Pill, RenameGrid, TimerCard, useTick } from './parts';

type Confirm = { kind: 'clear'; id: number } | { kind: 'clear-all' } | null;

/** The stored demo as it stands now, its day closed and saved if its end has come. */
function settledDemo(): Demo {
  const now = Date.now();
  const d = loadDemo(now);
  const next = settleDemo(d, now);
  if (next !== d) saveDemo(next);
  return next;
}

/**
 * The public page (view 1): ten stopwatches that really run, in this browser only and shared
 * by its tabs, a day line (the first Start opens a day of 24 hours; at its end the timers stop,
 * the day is saved here and they go back to zero), the rename grid with Delete names, then one
 * sample graph per timer with its median card. Nothing reaches an account.
 */
export default function PublicDemo() {
  const [stored, setStored] = useState<Demo>(freshDemo);
  const [confirm, setConfirm] = useState<Confirm>(null);
  useTick(true, 1000); // the countdown

  useEffect(() => {
    setStored(settledDemo());
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEMO_KEY) setStored(settledDemo());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // At the day's end: close it, save it here and show every timer at zero, without a reload.
  const end = stored.day?.end_ms;
  useEffect(() => {
    if (end === undefined) return;
    const atEnd = setTimeout(() => setStored(settledDemo()), Math.max(0, end - Date.now() + 5));
    return () => clearTimeout(atEnd);
  }, [end]);

  const act = useCallback((a: TimerAction) => {
    setStored((d) => {
      const next = actDemo(d, a, Date.now());
      saveDemo(next);
      return next;
    });
  }, []);

  const now = Date.now();
  const demo = settleDemo(stored, now);
  const timers = demo.timers;
  const dayEnd = demo.day?.end_ms ?? Infinity;
  const clock = () => Math.min(Date.now(), dayEnd);
  const panel = demoPanel(demo, now, browserZone());

  const name = (id: number) => {
    const i = timers.findIndex((t) => t.id === id);
    return timers[i]?.name || `Timer ${i + 1}`;
  };

  return (
    <>
      <p className="standfirst">
        Ten stopwatches you can use right now. They run in this browser only and nothing reaches an account.{' '}
        <a className="inl" href={SIGN_IN_HREF}>Sign in</a> to keep trackers that run on every device and save each day.
      </p>
      <div className="demo-day">
        <Pill pill={panel.pill} />
        <p className="dexp">{panel.explain}</p>
      </div>
      <ControlBar timers={timers} mode="live" onAction={(a) => (a === 'clear-all' ? setConfirm({ kind: 'clear-all' }) : act({ kind: a }))} />
      <div className="tgrid">
        {timers.map((t, i) => (
          <TimerCard
            key={t.id}
            n={i + 1}
            timer={t}
            mode="live"
            clock={clock}
            onStart={() => act({ kind: 'start', id: t.id })}
            onStop={() => act({ kind: 'stop', id: t.id })}
            onClear={() => setConfirm({ kind: 'clear', id: t.id })}
          />
        ))}
      </div>
      <RenameGrid
        timers={timers}
        names={{}}
        editable
        removable={false}
        add={false}
        onRename={(id, value) => act({ kind: 'rename', id, name: value })}
        onDeleteNames={() => act({ kind: 'delete-names' })}
      />
      <section className="gsec">
        <div className="ps"><h3>What the charts look like</h3><span className="tag sample">Sample data</span></div>
        <p className="gnote">Made-up days, one graph per timer, with the median beside each. Signed-in trackers draw these from your saved days.</p>
        {timers.map((t, i) => {
          const points = SAMPLE_DAYS[i];
          const nums = points.filter((v): v is number => v !== null);
          return (
            <GraphRow
              key={t.id}
              title={t.name || `Timer ${i + 1}`}
              points={points}
              tips={points.map((v, d) => `Day ${d + 1} · ${v === null ? 'not saved' : dur(v)}`)}
              median={median(nums)}
              medianNote={`a day, over ${nums.length} sample days`}
              from="Day 1"
              to="Day 30"
              sample
            />
          );
        })}
      </section>
      {confirm && (
        <ConfirmDialog
          body={confirm.kind === 'clear' ? `${name(confirm.id)} goes back to 00:00:00.0.` : 'Every timer goes back to 00:00:00.0.'}
          ok={confirm.kind === 'clear' ? 'Clear' : 'Clear all'}
          onCancel={() => setConfirm(null)}
          onOk={() => {
            act(confirm.kind === 'clear' ? { kind: 'clear', id: confirm.id } : { kind: 'clear-all' });
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}
