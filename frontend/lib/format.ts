/** Time and date formatting shared by every page. Pure functions. */

/** `ms` as hh:mm:ss plus its tenths digit. */
export function timeParts(ms: number): { main: string; tenths: number } {
  const t = Math.floor(Math.max(0, ms) / 100);
  const tenths = t % 10;
  const s = Math.floor(t / 10) % 60;
  const m = Math.floor(t / 600) % 60;
  const h = Math.floor(t / 36000);
  const p = (n: number) => String(n).padStart(2, '0');
  return { main: `${p(h)}:${p(m)}:${p(s)}`, tenths };
}

/**
 * The display split the way the cards draw it: the leading zeros and colons dimmed, then the
 * rest, then the smaller tenths. Under a tenth, the whole of it is dimmed.
 */
export function displayPieces(ms: number): { dim: string; rest: string; tenths: string; zero: boolean } {
  const { main, tenths } = timeParts(ms);
  if (ms < 100) return { dim: main, rest: '', tenths: `.${tenths}`, zero: true };
  let i = 0;
  while (i < main.length - 1 && (main[i] === '0' || main[i] === ':')) i++;
  return { dim: main.slice(0, i), rest: main.slice(i), tenths: `.${tenths}`, zero: false };
}

/** Minutes as "1 h 05 m" or "38 m". */
export function dur(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
}

/** The time left until `endMs`, never "0 m" while it has not arrived. */
export function untilLabel(endMs: number, nowMs: number): string {
  return dur(Math.max(1, Math.ceil((endMs - nowMs) / 60000)));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-15" as days since the epoch, the axis the Charts page counts on. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function dateOf(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

/** "2026-11-15" as "Sun 15 Nov", or "Sun 15 Nov 2026" with the year. */
export function dateLabel(date: string, year = false): string {
  const d = new Date(dayNumber(date) * 86400000);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
