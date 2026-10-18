import { t } from '@/i18n';

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

/** The calendar day (yyyy-mm-dd) and 24-hour time (`HH:mm`) of an instant in a timezone (TST-07). */
export function zonedParts(ms: number, timeZone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** A window as `2 Nov 2026, 10:00 to 11:00 IST`, in the organization's timezone with the zone named (UX-11). */
export function formatWindow(window: { start: number; end: number }, timeZone: string): string {
  const start = zonedParts(window.start, timeZone);
  const end = zonedParts(window.end, timeZone);
  return t('time.window', {
    date: formatDay(start.day),
    start: start.time,
    end: end.day === start.day ? end.time : t('time.dayTime', { date: formatDay(end.day), time: end.time }),
    zone: zoneName(timeZone, window.start),
  });
}

/** An instant as `HH:mm IST`: 24-hour time in the organization's timezone with the zone named (TST-07, UX-11). */
export function formatZonedTime(ms: number, timeZone: string): string {
  return t('time.zoned', { time: zonedParts(ms, timeZone).time, zone: zoneName(timeZone, ms) });
}

/** The calendar day of an instant in the organization's timezone, as `d MMM yyyy`. */
export const formatZonedDay = (ms: number, timeZone: string) => formatDay(zonedParts(ms, timeZone).day);

/** A countdown on student pages: `HH:MM:SS` below one day, `1 day HH:MM:SS`, then `<n> days HH:MM:SS`. */
export function formatCountdown(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(s / 86_400);
  const time = `${two(Math.floor((s % 86_400) / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  if (days === 0) return time;
  return days === 1 ? t('time.countdownOneDay', { time }) : t('time.countdownDays', { n: formatCount(days), time });
}

/** The exam timer (EX-06): `MM:SS` below one hour (`41:58`), `H:MM:SS` from one hour (`1:00:00`). */
export function formatExamTimer(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000));
  const h = Math.floor(s / 3600);
  const mmss = `${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return h === 0 ? mmss : `${h}:${mmss}`;
}

/** The per-question timer (Q-11): `M:SS` (`0:20`, `1:05`), whole seconds rounded down. */
export function formatQuestionTimer(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000));
  return `${Math.floor(s / 60)}:${two(s % 60)}`;
}

/** `+1 for a correct answer, −0.25 for a wrong answer, 0 for no answer` (U+2212 minus, en-IN numbers). */
export function formatMarking(m: { marks: number; negativeMarks: number }): string {
  return t('marking.summary', {
    marks: formatCount(m.marks),
    wrong: m.negativeMarks === 0 ? '0' : t('marking.deduction', { n: formatCount(m.negativeMarks) }),
  });
}
