'use client';

import { useEffect, useReducer } from 'react';
import { displayPieces, dur } from '../../lib/format';
import { elapsedAt, isRunning, MAX_TIMERS, type CardMode, type Pill as PillT } from '../../lib/views';
import type { Timer } from '../../lib/types';

export const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 4h11M6 4V2.75h4V4M4 4l.7 9.25h6.6L12 4M6.75 6.5v4.5M9.25 6.5v4.5" />
  </svg>
);

export const ChartIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M2.5 15.5h13M5 13V8.5M9 13V4.5M13 13v-6" />
  </svg>
);

export function Pill({ pill, small }: { pill: PillT; small?: boolean }) {
  return (
    <span className={`pill${pill.tone ? ` ${pill.tone}` : ''}${small ? ' small' : ''}`}>
      <span className="dot" />
      {pill.text}
    </span>
  );
}

/** Re-renders every `ms` while `on`. */
export function useTick(on: boolean, ms: number): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(bump, ms);
    return () => clearInterval(id);
  }, [on, ms]);
}

/** 00:00:00.0 with the leading zeros dimmed and the tenths smaller; ticks while running. */
function Display({ timer, clock }: { timer: Timer; clock: () => number }) {
  useTick(isRunning(timer), 100);
  const p = displayPieces(elapsedAt(timer, clock()));
  return p.zero ? (
    <span className="dim">{p.dim}<span className="t10">{p.tenths}</span></span>
  ) : (
    <>
      <span className="dim">{p.dim}</span>
      {p.rest}
      <span className="t10">{p.tenths}</span>
    </>
  );
}

/**
 * One timer card, as on the reference: number badge, display, one full-width button. Stopped
 * with time, the button is Resume and Clear is a small trash icon in the top corner, away
 * from it (answer 8). `live` works; `ended` leaves only a running timer's Stop (view 5b);
 * `grey` is look, not click.
 */
export function TimerCard({
  n, timer, mode, clock, onStart, onStop, onClear,
}: {
  n: number;
  timer: Timer;
  mode: CardMode;
  clock: () => number;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
}) {
  const run = isRunning(timer);
  const grey = mode === 'grey' || (mode === 'ended' && !run);
  const hasTime = !run && elapsedAt(timer, clock()) > 0;
  const label = timer.name || `timer ${n}`;
  return (
    <div className={`tc${run ? ' run' : ''}${grey ? ' grey' : ''}`}>
      <div className="tc-top">
        <span className="tc-no">{n}</span>
        <span className="tc-name">{timer.name}</span>
        {hasTime && !grey && (
          <button type="button" className="tc-clear" aria-label={`Clear ${label}`} title="Clear" onClick={onClear}>
            <TrashIcon />
          </button>
        )}
      </div>
      <div className="tc-disp"><Display timer={timer} clock={clock} /></div>
      {run ? (
        <button type="button" className="tc-btn stop" disabled={grey} aria-label={`Stop ${label}`} onClick={onStop}>Stop</button>
      ) : (
        <button type="button" className="tc-btn" disabled={grey} aria-label={`${hasTime ? 'Resume' : 'Start'} ${label}`} onClick={onStart}>
          {hasTime ? 'Resume' : 'Start'}
        </button>
      )}
    </div>
  );
}

/** Start all, Stop all, Relaunch, Clear all, above the cards. */
export function ControlBar({
  timers, mode, onAction, extra,
}: {
  timers: Timer[];
  mode: CardMode;
  onAction: (a: 'start-all' | 'stop-all' | 'relaunch' | 'clear-all') => void;
  extra?: React.ReactNode;
}) {
  const live = mode === 'live';
  const running = timers.some(isRunning);
  return (
    <div className="cbar">
      <button type="button" className="btn ghost sm" disabled={!live} onClick={() => onAction('start-all')}>Start all</button>
      <button type="button" className="btn ghost sm" disabled={!(live || (mode === 'ended' && running))} onClick={() => onAction('stop-all')}>Stop all</button>
      <button type="button" className="btn ghost sm" disabled={!live} onClick={() => onAction('relaunch')}>Relaunch</button>
      <button type="button" className="btn ghost sm dangertext" disabled={!(live && !running)} onClick={() => onAction('clear-all')}>Clear all</button>
      {live && running && <span className="cnote">Clear all waits until every timer is stopped.</span>}
      {extra}
    </div>
  );
}

/** The rename grid under the cards ("[1] : Name"), as on the reference. */
export function RenameGrid({
  timers, names, editable, removable, add, hint, onRename, onBlur, onRemove, onAdd, onDeleteNames,
}: {
  timers: Timer[];
  names: Record<number, string>;
  editable: boolean;
  removable: boolean;
  add: boolean;
  hint?: string;
  onRename: (id: number, name: string) => void;
  onBlur?: (id: number) => void;
  onRemove?: (id: number) => void;
  onAdd?: () => void;
  onDeleteNames?: () => void;
}) {
  const full = timers.length >= MAX_TIMERS;
  return (
    <div className={`rn${editable ? '' : ' grey'}`}>
      <div className="rn-h">
        <span>Rename</span>
        {hint && <span className="rn-hint">{hint}</span>}
      </div>
      <div className={`rn-grid${removable ? ' wide' : ''}`}>
        {timers.map((t, i) => (
          <div className="rn-f" key={t.id}>
            <span className="k">[{i + 1}] :</span>
            <input
              type="text"
              name={`name-${t.id}`}
              value={names[t.id] ?? t.name}
              placeholder="Name"
              maxLength={60}
              aria-label={`Name for timer ${i + 1}`}
              disabled={!editable}
              onChange={(e) => onRename(t.id, e.target.value)}
              onBlur={() => onBlur?.(t.id)}
            />
            {removable && (
              <button type="button" className="rm" disabled={!editable || timers.length <= 1} onClick={() => onRemove?.(t.id)}>Remove</button>
            )}
          </div>
        ))}
        {add && (
          <button type="button" className="rn-add" disabled={!editable || full} onClick={onAdd}>
            {full ? '15 of 15: the most a tracker holds' : '+ Add timer'}
          </button>
        )}
      </div>
      {onDeleteNames && (
        <div className="rn-foot">
          <button type="button" className="btn ghost sm" onClick={onDeleteNames}>Delete names</button>
        </div>
      )}
    </div>
  );
}

/** One graph (a bar per day, minutes; `null` stays empty) with its median card beside it. */
export function GraphRow({
  title, bars, median, medianNote, from, to, sub, removed, sample,
}: {
  title: string;
  bars: (number | null)[];
  median: number | null;
  medianNote: string;
  from: string;
  to: string;
  sub?: string;
  removed?: boolean;
  sample?: boolean;
}) {
  const n = Math.max(1, bars.length);
  const values = bars.filter((v): v is number => v !== null);
  const maxH = Math.max(1, Math.ceil(Math.max(0, ...values) / 60));
  const top = maxH * 60;
  const y = (v: number) => (100 - (v / top) * 100).toFixed(2);
  const mid = maxH / 2;
  return (
    <div className="grow">
      <div className="card gcard">
        <div className="ghead">
          <span className="gt">{title}</span>
          {removed && <span className="tag removed">Removed</span>}
          {sample && <span className="tag sample">Sample</span>}
          {sub && <span className="gsub">{sub}</span>}
        </div>
        <div className="chart">
          <div className="yax"><span>{maxH} h</span><span>{Number.isInteger(mid) ? mid : mid.toFixed(1)} h</span><span>0</span></div>
          <div className="plot">
            <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
              <line className="gl" x1="0" x2={n} y1="50" y2="50" vectorEffect="non-scaling-stroke" />
              {bars.map((v, i) =>
                v === null ? null : (
                  <rect key={i} className={`bar${removed ? ' rm' : ''}`} x={i + 0.15} y={v === 0 ? 99 : y(v)} width="0.7" height={v === 0 ? 1 : ((v / top) * 100).toFixed(2)} />
                ),
              )}
              {median !== null && <line className="medl" x1="0" x2={n} y1={y(median)} y2={y(median)} vectorEffect="non-scaling-stroke" />}
            </svg>
          </div>
          <div className="xax"><span>{from}</span><span>{to}</span></div>
        </div>
      </div>
      <div className="card mcard">
        <span className="k">Median</span>
        <span className="v">{median !== null ? dur(median) : '–'}</span>
        <span className="s">{medianNote}</span>
      </div>
    </div>
  );
}
