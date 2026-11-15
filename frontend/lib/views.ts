/**
 * Which board view a tracker is in, and what its day panel and list row say. Pure functions
 * of the tracker and the server's time; the wording is the signed-off board's.
 *
 *   v4  no open day (brand-new, or after Discard last day): greyed, only Start today
 *   v5  an earlier date's day, unsaved: greyed, Save / Discard / Start today (asks first)
 *   v5b the same with a timer still running: only Stop and Stop all on the cards
 *   v7  today's open day: everything works
 *   v10 after Save last day: read-only until the next Start today
 */
import { clockTime } from './zones.ts';
import { dateLabel, untilLabel } from './format.ts';
import type { Timer, Tracker, TrackerSummary } from './types.ts';

export type View = 'v4' | 'v5' | 'v5b' | 'v7' | 'v10';
export type CardMode = 'live' | 'ended' | 'grey';

export const isRunning = (t: Timer) => t.running_since_ms !== null;
export const runningCount = (ts: Timer[]) => ts.filter(isRunning).length;
export const elapsedAt = (t: Timer, nowMs: number) => t.acc_ms + (t.running_since_ms !== null ? Math.max(0, nowMs - t.running_since_ms) : 0);

export function trackerView(t: Tracker, nowMs: number): View {
  if (t.open_day) {
    if (nowMs < t.open_day.day_end_ms) return 'v7';
    return runningCount(t.timers) ? 'v5b' : 'v5';
  }
  return t.last_outcome === 'saved' && t.saved_day ? 'v10' : 'v4';
}

export function cardMode(view: View): CardMode {
  return view === 'v7' ? 'live' : view === 'v5' || view === 'v5b' ? 'ended' : 'grey';
}

export type Pill = { tone: '' | 'live' | 'ok' | 'warn'; text: string };
export type DayButton = { on: boolean; why: string };
export type Panel = { pill: Pill; explain: string; start: DayButton; save: DayButton; discard: DayButton };

export function dayPanel(t: Tracker, nowMs: number): Panel {
  const view = trackerView(t, nowMs);
  if (view === 'v4') {
    const fresh = t.last_outcome === null;
    return {
      pill: { tone: '', text: fresh ? 'New tracker · not started yet' : 'No open day' },
      explain: fresh
        ? 'The timers stay greyed out until you press Start today. The day gets stamped with today’s date and your time zone.'
        : 'The last day was discarded. Press Start today to begin a new day.',
      start: { on: true, why: 'Starts today with every timer at zero.' },
      save: { on: false, why: 'Nothing to save.' },
      discard: { on: false, why: 'Nothing to discard.' },
    };
  }
  if (view === 'v10') {
    const day = t.saved_day!;
    return {
      pill: { tone: 'ok', text: `Saved · ${dateLabel(day.date, true)} · read-only` },
      explain: 'Saved to History and shown on the Charts page. These times stay here, read-only, until you press Start today.',
      start: { on: true, why: 'Starts today with every timer at zero.' },
      save: { on: false, why: 'Already saved.' },
      discard: { on: false, why: 'Nothing unsaved.' },
    };
  }
  const day = t.open_day!;
  const dl = dateLabel(day.date, true);
  const ds = dateLabel(day.date);
  const tz = day.tz_label;
  if (view === 'v7') {
    const rc = runningCount(t.timers);
    return {
      pill: { tone: rc ? 'live' : 'ok', text: `Open day · today, ${dl} · started ${clockTime(day.started_at_ms, day.tz)} · ${tz}${rc ? ` · ${rc} running` : ''}` },
      explain: 'Times are kept on the server as they run. Close this tab or the laptop and they keep running; your phone shows the same times.',
      start: { on: false, why: 'Today already has its day. One day per date.' },
      save: { on: false, why: `Unlocks when ${ds} ends in ${tz}, in ${untilLabel(day.day_end_ms, nowMs)}.` },
      discard: { on: false, why: 'Unlocks when the day ends, like Save last day.' },
    };
  }
  const run = t.timers.filter(isRunning);
  const rc = run.length;
  return {
    pill: { tone: 'warn', text: `Last day not saved · ${dl} · ${tz}` },
    explain: rc
      ? `${ds} has ended, but ${run[0].name || 'a timer'}${rc > 1 ? ` and ${rc - 1} more` : ''} ${rc > 1 ? 'are' : 'is'} still running and counting into that day. Stop ${rc > 1 ? 'them' : 'it'} before saving.`
      : `${ds} has ended. Save it to keep it in History and on the Charts page, or discard it. The timers show that day’s times, greyed out.`,
    start: { on: true, why: `Asks you to save or discard ${ds} first.` },
    save: { on: !rc, why: rc ? `Stop all timers first: ${rc} still running.` : `${ds} ended at midnight in ${tz}.` },
    discard: { on: true, why: `Deletes ${ds} for good.` },
  };
}

/** The state line on a Trackers list row. */
export function listPill(s: TrackerSummary, nowMs: number): Pill {
  if (s.open_day) {
    const rc = s.open_day.running;
    if (nowMs < s.open_day.day_end_ms) return { tone: rc ? 'live' : 'ok', text: `Open day · today${rc ? ` · ${rc} running` : ''}` };
    return { tone: 'warn', text: `Last day not saved · ${dateLabel(s.open_day.date)}${rc ? ' · a timer still running' : ''}` };
  }
  if (s.last_outcome === 'saved' && s.saved_date) return { tone: 'ok', text: `Saved · ${dateLabel(s.saved_date)} · read-only until Start today` };
  return { tone: '', text: s.last_outcome === null ? 'New · not started yet' : 'No open day' };
}

export const RENAME_HINT: Record<CardMode, string> = {
  live: 'Rename, remove or add timers here, up to 15.',
  ended: 'Greyed out: this day has ended.',
  grey: 'Greyed out until Start today.',
};

export const MAX_TIMERS = 15;
