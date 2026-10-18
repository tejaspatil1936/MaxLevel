import { t } from '@/i18n';

// What the exam timer says and when (EX-06, A11Y-06, A11Y-09): red pen below 10 minutes, a polite announcement as the
// time left passes 10, 5 and 1 minutes, and the time left in words for the T key.

const MIN = 60_000;
const WARNINGS = [10, 5, 1] as const;

/** How often the clock offset is measured again from X-Server-Time while the exam is open (EX-06). */
export const CLOCK_REFRESH_MS = 60_000;

/** The timer's numerals turn red pen below 10 minutes, and not before (13.6). */
export const isFinalMinutes = (remainingMs: number) => remainingMs < 10 * MIN;

/**
 * The warning (in minutes) passed between two readings of the time left, or null. A jump past several warnings (a
 * sleeping laptop) gives only the last one passed; the first reading after opening the exam announces nothing.
 */
export function passedWarning(beforeMs: number, nowMs: number): number | null {
  let passed: number | null = null;
  for (const m of WARNINGS) if (beforeMs > m * MIN && nowMs <= m * MIN) passed = m;
  return passed;
}

/** A warning in words: `10 minutes left`, `1 minute left`. */
export const warningText = (minutes: number) =>
  minutes === 1 ? t('attempt.oneMinuteLeft') : t('attempt.minutesLeft', { n: minutes });

/** The time left in words for the T key: whole minutes rounded down, or seconds under one minute (A11Y-06). */
export function timeLeftText(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000));
  if (s >= 60) return warningText(Math.floor(s / 60));
  return s === 1 ? t('attempt.oneSecondLeft') : t('attempt.secondsLeft', { n: s });
}
