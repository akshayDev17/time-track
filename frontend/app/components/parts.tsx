'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
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
 * from it (answer 8). `live` works; `grey` is look, not click. Clicking anywhere else on a
 * card that works presses its button (answer 11), and so do Enter and Space with the card
 * focused; its own buttons and fields only do their own thing.
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
  const grey = mode === 'grey';
  const hasTime = !run && elapsedAt(timer, clock()) > 0;
  const label = timer.name || `timer ${n}`;
  const verb = run ? 'Stop' : hasTime ? 'Resume' : 'Start';
  const toggle = run ? onStop : onStart;
  const ownControl = (target: EventTarget) => target instanceof Element && target.closest('button, input, a, textarea, select') !== null;
  return (
    <div
      className={`tc${run ? ' run' : ''}${grey ? ' grey' : ' press'}`}
      tabIndex={grey ? undefined : 0}
      role={grey ? undefined : 'group'}
      aria-label={grey ? undefined : `${label}: click the card to ${verb.toLowerCase()}`}
      onClick={grey ? undefined : (e) => {
        if (!ownControl(e.target)) toggle();
      }}
      onKeyDown={grey ? undefined : (e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        toggle();
      }}
    >
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
      <button type="button" className={`tc-btn${run ? ' stop' : ''}`} disabled={grey} aria-label={`${verb} ${label}`} onClick={toggle}>
        {verb}
      </button>
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
      <button type="button" className="btn ghost sm" disabled={!live} onClick={() => onAction('stop-all')}>Stop all</button>
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

const PLOT_H = 120;
const PAD_X = 8;
const PAD_Y = 6;

/** Each run of consecutive drawn points, as [index, value] pairs. */
function runs(points: (number | null)[]): [number, number][][] {
  const out: [number, number][][] = [];
  let run: [number, number][] = [];
  points.forEach((v, i) => {
    if (v === null) {
      if (run.length) out.push(run);
      run = [];
    } else run.push([i, v]);
  });
  if (run.length) out.push(run);
  return out;
}

/**
 * One graph: a line through each day's minutes with a circle on every drawn day (`null` draws
 * nothing and breaks the line), the dashed median, and its median card beside it. Hover or a
 * tap shows a day's date and value.
 */
export function GraphRow({
  title, points, tips, median, medianNote, from, to, sub, removed, sample, total,
}: {
  title: string;
  points: (number | null)[];
  tips: string[];
  median: number | null;
  medianNote: string;
  from: string;
  to: string;
  sub?: string;
  removed?: boolean;
  sample?: boolean;
  total?: boolean;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(1, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (at === null) return;
    // a tap elsewhere (or a click outside the plot) puts the readout away
    const away = (e: PointerEvent) => {
      if (!plot.current?.contains(e.target as Node)) setAt(null);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [at]);

  const n = points.length;
  const values = points.filter((v): v is number => v !== null);
  const maxH = Math.max(1, Math.ceil(Math.max(0, ...values) / 60));
  const top = maxH * 60;
  const mid = maxH / 2;
  const step = n > 1 ? (width - 2 * PAD_X) / (n - 1) : 0;
  const x = (i: number) => (n > 1 ? PAD_X + i * step : width / 2);
  const y = (v: number) => PAD_Y + (1 - v / top) * (PLOT_H - 2 * PAD_Y);
  const r = Math.max(1.75, Math.min(4, step / 3 || 4));
  const pick = (clientX: number) => {
    const box = plot.current!.getBoundingClientRect();
    const i = n > 1 ? Math.round((clientX - box.left - PAD_X) / step) : 0;
    setAt(Math.max(0, Math.min(n - 1, i)));
  };
  // the readout sits above the day's point (below it near the top), never past either edge
  const tipLeft = at === null ? 0 : Math.max(0, Math.min(100, (x(at) / width) * 100));
  const pointY = at === null || points[at] === null ? PLOT_H / 2 : y(points[at]!);
  const above = pointY > 34;
  const tipStyle = {
    left: `${tipLeft}%`,
    top: `${above ? pointY - r - 6 : pointY + r + 6}px`,
    transform: `translate(-${tipLeft}%, ${above ? '-100%' : '0'})`,
  };

  return (
    <div className={`grow${total ? ' total' : ''}`}>
      <div className="card gcard">
        <div className="ghead">
          <span className="gt">{title}</span>
          {removed && <span className="tag removed">Removed</span>}
          {sample && <span className="tag sample">Sample</span>}
          {sub && <span className="gsub">{sub}</span>}
        </div>
        <div className="chart">
          <div className="yax"><span>{maxH} h</span><span>{Number.isInteger(mid) ? mid : mid.toFixed(1)} h</span><span>0</span></div>
          <div
            className="plot"
            ref={plot}
            onPointerMove={(e) => pick(e.clientX)}
            onPointerDown={(e) => pick(e.clientX)}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') setAt(null);
            }}
          >
            <svg width={width} height={PLOT_H} viewBox={`0 0 ${width} ${PLOT_H}`} aria-hidden="true">
              <line className="gl" x1="0" x2={width} y1={y(mid * 60)} y2={y(mid * 60)} />
              {median !== null && <line className="medl" x1="0" x2={width} y1={y(median)} y2={y(median)} />}
              {at !== null && <line className="gcur" x1={x(at)} x2={x(at)} y1="0" y2={PLOT_H} />}
              {runs(points).map((run) => (
                <polyline key={run[0][0]} className={`gline${removed ? ' rm' : ''}`} points={run.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
              ))}
              {points.map((v, i) =>
                v === null ? null : (
                  <circle key={i} className={`gdot${removed ? ' rm' : ''}${i === at ? ' on' : ''}`} cx={x(i)} cy={y(v)} r={i === at ? r + 1.5 : r} />
                ),
              )}
            </svg>
            {at !== null && (
              <div className="gtip" role="status" style={tipStyle}>
                {tips[at]}
              </div>
            )}
          </div>
          <div className="xax"><span>{from}</span><span>{to}</span></div>
        </div>
      </div>
      <div className="card mcard">
        <span className="k">{total ? 'Median total' : 'Median'}</span>
        <span className="v">{median !== null ? dur(median) : '–'}</span>
        <span className="s">{medianNote}</span>
      </div>
    </div>
  );
}
