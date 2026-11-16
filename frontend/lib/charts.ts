/**
 * The Charts page's numbers. Every graph of a tracker shares one axis: one point per date
 * from the tracker's first saved day (or, for 30 / 90, the last 30 / 90 days, never before
 * it) to its last saved day, so the graphs line up for comparison.
 *
 * On a date with no saved day nothing is drawn (`null`). On a saved day a timer shows its
 * saved minutes; a timer unused that day was saved as 0 and shows 0. A timer added later than
 * the tracker's first saved day is drawn as 0 on every saved day before it existed, so its
 * line still starts where the others do, but its median counts only the days it existed. A
 * removed timer draws nothing after its last saved day. The Total graph is the sum of every
 * saved value of each day, with its median over the saved days.
 */
import { dateLabel, dateOf, dayNumber, dur, median } from './format.ts';
import type { HistoryResponse, HistoryTimer } from './types.ts';

export type Range = 30 | 90 | 'all';

export type Graph = {
  key: string;
  title: string;
  /** null for the Total graph. */
  timer: HistoryTimer | null;
  /** Minutes per axis date; null where nothing is drawn. */
  points: (number | null)[];
  /** What hovering or tapping each point says. */
  tips: string[];
  median: number | null;
  /** The saved days the median counts. */
  saved: number;
};

export type Charts = { from: string; to: string; total: Graph; timers: Graph[] };

/** The axis: [start, end] as day numbers, ending on the last saved day. */
export function rangeDays(history: HistoryResponse, range: Range): { start: number; end: number } {
  const days = history.days.map((d) => dayNumber(d.date));
  const first = Math.min(...days);
  const end = Math.max(...days);
  return { start: range === 'all' ? first : Math.max(first, end - range + 1), end };
}

const tip = (day: number, text: string) => `${dateLabel(dateOf(day))} · ${text}`;

export function charts(history: HistoryResponse, range: Range): Charts | null {
  if (!history.days.length) return null;
  const { start, end } = rangeDays(history, range);
  const byDay = new Map(history.days.map((d) => [dayNumber(d.date), d.values]));
  const axis = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const totalPoints = axis.map((day) => {
    const values = byDay.get(day);
    return values ? Object.values(values).reduce((a, b) => a + b, 0) / 60000 : null;
  });
  const total: Graph = {
    key: 'total',
    title: 'Total · every timer',
    timer: null,
    points: totalPoints,
    tips: axis.map((day, i) => tip(day, totalPoints[i] === null ? 'not saved' : dur(totalPoints[i]!))),
    ...counted(totalPoints),
  };

  const timers = history.timers.map((timer): Graph => {
    const id = String(timer.id);
    const own = history.days.filter((d) => d.values[id] !== undefined).map((d) => dayNumber(d.date));
    const firstOwn = own.length ? Math.min(...own) : Infinity;
    const lastOwn = timer.removed_on === null ? Infinity : own.length ? Math.max(...own) : -Infinity;
    const points: (number | null)[] = [];
    const tips: string[] = [];
    const mine: (number | null)[] = [];
    for (const day of axis) {
      const values = byDay.get(day);
      if (!values || day > lastOwn) {
        points.push(null);
        mine.push(null);
        tips.push(tip(day, values ? 'removed' : 'not saved'));
      } else if (day < firstOwn) {
        points.push(0);
        mine.push(null);
        tips.push(tip(day, '0 m · not added yet'));
      } else {
        const minutes = (values[id] ?? 0) / 60000;
        points.push(minutes);
        mine.push(minutes);
        tips.push(tip(day, dur(minutes)));
      }
    }
    return {
      key: id,
      title: timer.name || (timer.number ? `Timer ${timer.number}` : 'Timer'),
      timer,
      points,
      tips,
      ...counted(mine),
    };
  });

  return { from: dateLabel(dateOf(start)), to: dateLabel(dateOf(end)), total, timers };
}

function counted(points: (number | null)[]): { median: number | null; saved: number } {
  const nums = points.filter((v): v is number => v !== null);
  return { median: median(nums), saved: nums.length };
}

export function rangeLabel(range: Range): string {
  return range === 'all' ? 'all saved days' : `the last ${range} days`;
}

/** The median card's line under the number. */
export function medianNote(saved: number, range: Range): string {
  return saved
    ? `a day, over ${saved} saved day${saved === 1 ? '' : 's'} in ${rangeLabel(range)}`
    : `No saved days in ${rangeLabel(range)}`;
}
