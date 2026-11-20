/**
 * Which board view a tracker is in, and what its day panel and list row say. Pure functions
 * of the tracker and the server's time; the wording is the signed-off board's.
 *
 *   v4  no open day (brand-new, or after Discard last day): greyed, only Start today
 *   v7  an open day: everything works, until 24 hours after it started
 *   v10 after the day ended and saved itself: every timer at zero, greyed, until Start today
 *
 * A day closes itself at its end (backend store.close_ended_days); `settled` shows that at the
 * end moment, before the server's next answer arrives.
 */
import { clockTime, momentLabel } from './zones.ts';
import { dateLabel, untilLabel } from './format.ts';
import type { Timer, Tracker, TrackerSummary } from './types.ts';

export type View = 'v4' | 'v7' | 'v10';
export type CardMode = 'live' | 'grey';

export const isRunning = (t: Timer) => t.running_since_ms !== null;
export const runningCount = (ts: Timer[]) => ts.filter(isRunning).length;
export const elapsedAt = (t: Timer, nowMs: number) => t.acc_ms + (t.running_since_ms !== null ? Math.max(0, nowMs - t.running_since_ms) : 0);

/**
 * The tracker as it stands at `nowMs`. A day whose end has come has closed itself, as the
 * server closes it on its next request: saved, and every timer back at zero.
 */
export function settled(t: Tracker, nowMs: number): Tracker {
  const day = t.open_day;
  if (!day || nowMs < day.day_end_ms) return t;
  return {
    ...t,
    phase: null,
    open_day: null,
    last_outcome: 'saved',
    saved_day: { ...day, saved_at_ms: day.day_end_ms },
    timers: t.timers.map((x) => ({ ...x, acc_ms: 0, running_since_ms: null })),
  };
}

/** What a timer card reads as now: the server's clock, never past the open day's end. */
export const cardClock = (t: Tracker, now: () => number) => {
  const end = t.open_day?.day_end_ms;
  return end === undefined ? now : () => Math.min(now(), end);
};

export function trackerView(tracker: Tracker, nowMs: number): View {
  const t = settled(tracker, nowMs);
  if (t.open_day) return 'v7';
  return t.last_outcome === 'saved' && t.saved_day ? 'v10' : 'v4';
}

export function cardMode(view: View): CardMode {
  return view === 'v7' ? 'live' : 'grey';
}

export type Pill = { tone: '' | 'live' | 'ok' | 'warn'; text: string };
export type DayButton = { on: boolean; why: string };
export type Panel = { pill: Pill; explain: string; start: DayButton; save: DayButton; discard: DayButton };

const START_NEXT = 'Opens a day of 24 hours from now, every timer at zero.';

/** A time, date or duration that must not break across lines ("in 24 h 00 m", "11:59 pm"). */
const nb = (s: string) => s.replace(/ /g, '\u00a0');

export function dayPanel(tracker: Tracker, nowMs: number): Panel {
  const t = settled(tracker, nowMs);
  const view = trackerView(t, nowMs);
  if (view === 'v4') {
    const fresh = t.last_outcome === null;
    return {
      pill: { tone: '', text: fresh ? 'New tracker · not started yet' : 'No open day' },
      explain: fresh
        ? 'The timers stay greyed out until you press Start today. The day gets stamped with today’s date and your time zone, and lasts 24 hours from then.'
        : 'The last day was discarded. Press Start today to begin a new day.',
      start: { on: true, why: START_NEXT },
      save: { on: false, why: 'Nothing to save.' },
      discard: { on: false, why: 'Nothing to discard.' },
    };
  }
  if (view === 'v10') {
    const day = t.saved_day!;
    return {
      pill: { tone: 'ok', text: `Saved · ${dateLabel(day.date, true)}` },
      explain: `Ended at ${momentLabel(day.day_end_ms, day.tz)} and saved to History and the Charts page. Every timer is back at zero: press Start today to begin the next day.`,
      start: { on: true, why: START_NEXT },
      save: { on: false, why: 'Already saved.' },
      discard: { on: false, why: 'Nothing to discard.' },
    };
  }
  const day = t.open_day!;
  const rc = runningCount(t.timers);
  const endsAt = momentLabel(day.day_end_ms, day.tz);
  const end = nb(endsAt);
  const until = nb(untilLabel(day.day_end_ms, nowMs));
  return {
    pill: {
      tone: rc ? 'live' : 'ok',
      text: `Open day · ${nb(dateLabel(day.date, true))} · ${nb(clockTime(day.started_at_ms, day.tz))} to ${end} · ${nb(day.tz_label)}${rc ? ` · ${rc} running` : ''}`,
    },
    explain: `Times are kept on the server as they run, so every device shows the same. At ${endsAt}, 24 hours after it started, every timer stops, the day saves itself to History and the Charts page, and the timers go back to zero.`,
    start: { on: false, why: `Opens the next day once this one ends, in ${until}.` },
    save: { on: false, why: `Saves itself at ${end}, in ${until}.` },
    discard: { on: true, why: 'Deletes this day for good.' },
  };
}

/** The state line on a Trackers list row. */
export function listPill(s: TrackerSummary, nowMs: number): Pill {
  if (s.open_day) {
    const rc = s.open_day.running;
    if (nowMs < s.open_day.day_end_ms) {
      return { tone: rc ? 'live' : 'ok', text: `Open day · until ${nb(momentLabel(s.open_day.day_end_ms, s.open_day.tz))}${rc ? ` · ${rc} running` : ''}` };
    }
    return { tone: 'ok', text: `Saved · ${dateLabel(s.open_day.date)}` };
  }
  if (s.last_outcome === 'saved' && s.saved_date) return { tone: 'ok', text: `Saved · ${dateLabel(s.saved_date)}` };
  return { tone: '', text: s.last_outcome === null ? 'New · not started yet' : 'No open day' };
}

export const RENAME_HINT: Record<CardMode, string> = {
  live: 'Rename, remove or add timers here, up to 15.',
  grey: 'Greyed out until Start today.',
};

export const MAX_TIMERS = 15;
