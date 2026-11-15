'use client';

import { useCallback, useEffect, useState } from 'react';
import { SIGN_IN_HREF } from '../../lib/api';
import { applyDemo, DEMO_KEY, freshDemo, loadDemo, saveDemo, type DemoAction } from '../../lib/demo';
import { median } from '../../lib/format';
import { SAMPLE_DAYS } from '../../lib/sample';
import type { Timer } from '../../lib/types';
import { ConfirmDialog } from './Dialog';
import { ControlBar, GraphRow, RenameGrid, TimerCard } from './parts';

const clock = () => Date.now();

type Confirm = { kind: 'clear'; id: number } | { kind: 'clear-all' } | null;

/**
 * The public page (view 1): ten stopwatches that really run, in this browser only and shared
 * by its tabs, the rename grid with Delete names, then one sample graph per timer with its
 * median card. Nothing reaches an account.
 */
export default function PublicDemo() {
  const [timers, setTimers] = useState<Timer[]>(freshDemo);
  const [confirm, setConfirm] = useState<Confirm>(null);

  useEffect(() => {
    setTimers(loadDemo());
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEMO_KEY) setTimers(loadDemo());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const act = useCallback((a: DemoAction) => {
    setTimers((ts) => {
      const next = applyDemo(ts, a, Date.now());
      saveDemo(next);
      return next;
    });
  }, []);

  const name = (id: number) => {
    const i = timers.findIndex((t) => t.id === id);
    return timers[i]?.name || `Timer ${i + 1}`;
  };

  return (
    <>
      <p className="standfirst">
        Ten stopwatches you can use right now. They run in this browser only and nothing is saved.{' '}
        <a className="inl" href={SIGN_IN_HREF}>Sign in</a> to keep trackers that run on every device and save each day.
      </p>
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
          const bars = SAMPLE_DAYS[i];
          const nums = bars.filter((v): v is number => v !== null);
          return (
            <GraphRow
              key={t.id}
              title={t.name || `Timer ${i + 1}`}
              bars={bars}
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
