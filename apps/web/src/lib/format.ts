// Numbers and times shown to people (UI-06): en-IN grouping, times in the organization's timezone.
const numbers = new Intl.NumberFormat('en-IN');
export const formatCount = (n: number) => numbers.format(n);

export function formatDateTime(ms: number, timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(ms);
}

/** Midnight at the start (or the end) of a yyyy-mm-dd day in a timezone, as epoch milliseconds. */
export function dayBoundary(day: string, timeZone: string, end: boolean): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const utc = Date.UTC(y, m - 1, d + (end ? 1 : 0));
  // The zone's offset at that instant: format it there and compare with UTC.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return utc - (local - utc) - (end ? 1 : 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A yyyy-mm-dd calendar date as `d MMM yyyy` (`2 Nov 2026`); no timezone applies to a calendar date. */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const two = (n: number) => String(n).padStart(2, '0');
/** Minutes after midnight as 24-hour `HH:mm`. */
export const formatMinutes = (minutes: number) => `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;

/** `HH:mm` from a time input as minutes after midnight, or null when empty or not a time. */
export function parseMinutes(time: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The zone's short name at an instant, for example `IST` for Asia/Kolkata (TST-07, UX-11). */
export function zoneName(timeZone: string, at: number): string {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone, timeZoneName: 'short' }).formatToParts(at);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}
