/**
 * The browser's own zone data, for the Start today stamp: the local date where the button is
 * pressed, when that date starts and ends there, and how pages name the zone. The server
 * checks the stamp against its clock and decides Save last day by `day_end_ms` alone.
 */

export type DayStamp = { date: string; tz: string; tz_label: string; day_start_ms: number; day_end_ms: number };

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The calendar date at `ms` in `tz`, as YYYY-MM-DD. */
export function localDate(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** How far `tz`'s wall clock is ahead of UTC at `ms`. */
function zoneOffset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * When `date` starts in `tz`: its local midnight, the earlier one where midnight happens twice,
 * and the moment the clock jumps where a DST change skips midnight.
 */
export function zoneMidnight(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  const first = wall - zoneOffset(wall, tz);
  const second = wall - zoneOffset(first, tz);
  const onDate = [first, second].filter((t) => localDate(t, tz) === date);
  return onDate.length ? Math.min(...onDate) : first;
}

function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Cities whose zone kept an old name that browsers still report (Chrome says Asia/Calcutta). */
const RENAMED: Record<string, string> = {
  Calcutta: 'Kolkata', Saigon: 'Ho Chi Minh', Katmandu: 'Kathmandu', Rangoon: 'Yangon', Kiev: 'Kyiv',
  Dacca: 'Dhaka', Thimbu: 'Thimphu', 'Ulan Bator': 'Ulaanbaatar', Godthab: 'Nuuk', Ashkhabad: 'Ashgabat',
};

/** "Asia/Kolkata" as "Kolkata (IST)": the city, and the shortest abbreviation a locale offers. */
export function zoneLabel(tz: string, ms: number): string {
  if (tz === 'UTC' || tz === 'Etc/UTC') return 'UTC';
  const raw = (tz.split('/').pop() || tz).replace(/_/g, ' ');
  const city = RENAMED[raw] ?? raw;
  let abbr = '';
  for (const locale of ['en-US', 'en-GB', 'en-IN', 'en-AU', 'en-NZ', 'en-CA', 'en-ZA', 'en-SG']) {
    try {
      const name = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? '';
      if (!abbr) abbr = name;
      if (name && !/^(GMT|UTC)[+-−]/.test(name)) {
        abbr = name;
        break;
      }
    } catch {
      // a locale this browser lacks: try the next one
    }
  }
  return abbr ? `${city} (${abbr})` : city;
}

/** What Start today sends, for the moment `nowMs` (server time) in the browser's zone. */
export function dayStamp(nowMs: number, tz = browserZone()): DayStamp {
  const date = localDate(nowMs, tz);
  return { date, tz, tz_label: zoneLabel(tz, nowMs), day_start_ms: zoneMidnight(date, tz), day_end_ms: zoneMidnight(nextDate(date), tz) };
}

/** "9:02 am": a moment as the clock read in the day's own zone. */
export function clockTime(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
      .format(ms).replace(/\s*([AP])M$/i, (_, a: string) => ` ${a.toLowerCase()}m`);
  } catch {
    return '';
  }
}
