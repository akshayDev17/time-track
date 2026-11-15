/**
 * The Charts page's numbers: one bar per date in the range, the saved minutes or `null` for a
 * date with no saved day (it stays empty and never counts as zero), and the median of the
 * saved days only (open point C7).
 */
import { dateLabel, dateOf, dayNumber, median } from './format.ts';
import type { HistoryResponse, HistoryTimer } from './types.ts';

export type Range = 30 | 90 | 'all';

export type Graph = {
  timer: HistoryTimer;
  title: string;
  bars: (number | null)[];
  median: number | null;
  saved: number;
  from: string;
  to: string;
};

/** The dates the range covers: ending yesterday (or the last saved date, if later). */
export function rangeDays(history: HistoryResponse, today: string, range: Range): { start: number; end: number } {
  const days = history.days.map((d) => dayNumber(d.date));
  const end = Math.max(dayNumber(today) - 1, ...days);
  const start = range === 'all' ? Math.min(days.length ? Math.min(...days) : end, end) : end - range + 1;
  return { start, end };
}

export function graphs(history: HistoryResponse, today: string, range: Range): Graph[] {
  const { start, end } = rangeDays(history, today, range);
  const byDay = new Map(history.days.map((d) => [dayNumber(d.date), d.values]));
  return history.timers.map((timer) => {
    const bars: (number | null)[] = [];
    for (let day = start; day <= end; day++) {
      const ms = byDay.get(day)?.[String(timer.id)];
      bars.push(ms === undefined ? null : ms / 60000);
    }
    const nums = bars.filter((v): v is number => v !== null);
    return {
      timer,
      title: timer.name || (timer.number ? `Timer ${timer.number}` : 'Timer'),
      bars,
      median: median(nums),
      saved: nums.length,
      from: dateLabel(dateOf(start)),
      to: dateLabel(dateOf(end)),
    };
  });
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
