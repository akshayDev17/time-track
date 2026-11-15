'use client';

import { useEffect, useRef } from 'react';

/** The scrim and card every dialog shares; Escape and a click on the scrim cancel. */
function Shell({ onCancel, label, children }: { onCancel: () => void; label: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  // The page re-renders every second (its clocks), so the latest handler is read from a ref
  // and focus moves only when the dialog opens and closes.
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="card dlg" role="dialog" aria-modal="true" aria-label={label} ref={box}>
        {children}
      </div>
    </>
  );
}

/** "Are you sure?" with one line on what happens (answer 13). */
export function ConfirmDialog({ body, ok, onOk, onCancel }: { body: string; ok: string; onOk: () => void; onCancel: () => void }) {
  return (
    <Shell onCancel={onCancel} label="Are you sure?">
      <h4>Are you sure?</h4>
      <p>{body}</p>
      <div className="dact">
        <button type="button" className="btn ghost" data-autofocus onClick={onCancel}>Cancel</button>
        <button type="button" className="btn danger" onClick={onOk}>{ok}</button>
      </div>
    </Shell>
  );
}

/** The Start today prompt while the last day is unsaved (answer 2, view 6). */
export function StartTodayPrompt({
  dateLabel, running, onSave, onDiscard, onCancel,
}: {
  dateLabel: string;
  running: number;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Shell onCancel={onCancel} label="Your last day isn’t saved">
      <h4>Your last day isn’t saved</h4>
      <p>{dateLabel} still has unsaved times. Save it first, or discard it. Then today starts with every timer at zero.</p>
      <div className="dact col">
        <button type="button" className="btn go" disabled={running > 0} data-autofocus={running ? undefined : true} onClick={onSave}>Save it first</button>
        {running > 0 && <p className="why">Stop all timers first: {running} still running on that day.</p>}
        <button type="button" className="btn ghost dangertext" onClick={onDiscard}>Discard it</button>
        <button type="button" className="linkbtn" data-autofocus={running ? true : undefined} onClick={onCancel}>Cancel</button>
      </div>
    </Shell>
  );
}
