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
