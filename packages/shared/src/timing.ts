import type { Settings } from './settings';

// Timing rules (spec 5.5, TST-07, TST-08). Every time is epoch ms (UTC); `now` comes from the caller's Clock.

const MIN = 60_000;

export type StartRefusal = 'WINDOW_NOT_OPEN' | 'WINDOW_CLOSED';

type StartSettings = Pick<Settings, 'timingMode' | 'window' | 'durationMin' | 'lateEntryCutoffMin' | 'windowEndPolicy'>;
type DeadlineSettings = Pick<Settings, 'timingMode' | 'window' | 'durationMin' | 'windowEndPolicy'>;

function windowOf(s: { window: Settings['window'] }): NonNullable<Settings['window']> {
  if (!s.window) throw new Error('The test has no window, so it has no start or deadline times.');
  return s.window;
}

/**
 * The last moment an attempt can start: fixed slot, slot start + late entry cutoff (never past the slot end);
 * flexible `full_duration`, window end − duration; flexible `hard_close`, window end (a start must come before it).
 */
export function lastStartAt(s: StartSettings): number {
  const w = windowOf(s);
  if (s.timingMode === 'fixed') return Math.min(w.start + s.lateEntryCutoffMin * MIN, w.end);
  return s.windowEndPolicy === 'full_duration' ? w.end - s.durationMin * MIN : w.end;
}

/**
 * Whether an attempt may start at `now` (spec 5.5): fixed slot from slot start to slot start + cutoff, both inclusive;
 * flexible `full_duration` from window start to window end − duration, inclusive; flexible `hard_close` from window
 * start to strictly before window end. A test without a window never opens.
 */
export function canStart(s: StartSettings, now: number): { ok: true } | { ok: false; code: StartRefusal } {
  if (!s.window || now < s.window.start) return { ok: false, code: 'WINDOW_NOT_OPEN' };
  const last = lastStartAt(s);
  const open = s.timingMode === 'flexible' && s.windowEndPolicy === 'hard_close' ? now < last : now <= last;
  return open ? { ok: true } : { ok: false, code: 'WINDOW_CLOSED' };
}

/**
 * The attempt deadline, computed once at start (spec 5.5): fixed slot, slot end (latecomers get only what is left);
 * flexible `full_duration`, start + duration; flexible `hard_close`, the earlier of start + duration and window end.
 * Extra time (OPS-06, OPS-07) is added on top and may pass the window end (OPS-08).
 */
export function attemptDeadline(s: DeadlineSettings, startedAt: number, extraTimeSec = 0): number {
  const extra = extraTimeSec * 1000;
  if (s.timingMode === 'fixed') return windowOf(s).end + extra;
  const full = startedAt + s.durationMin * MIN;
  return (s.windowEndPolicy === 'hard_close' ? Math.min(full, windowOf(s).end) : full) + extra;
}

/**
 * When a section's own timer ends (TST-08): its start plus its duration, never later than the attempt deadline. A
 * section without a duration runs to the attempt deadline.
 */
export function sectionDeadline(
  sectionStartedAt: number,
  sectionDurationMin: number | undefined,
  attemptDeadline: number,
): number {
  if (sectionDurationMin === undefined) return attemptDeadline;
  return Math.min(sectionStartedAt + sectionDurationMin * MIN, attemptDeadline);
}

/**
 * A question's own time limit in seconds under the test's question time mode (Q-10, Q-11): the test's limit for every
 * question with `same`, the question's own limit with `each`, and none with `none` (or a question without one).
 */
export function questionTimeLimit(
  s: Pick<Settings, 'questionTimeMode' | 'questionTimeLimitSec'>,
  question: { timeLimitSec?: number },
): number | undefined {
  if (s.questionTimeMode === 'same') return s.questionTimeLimitSec;
  if (s.questionTimeMode === 'each') return question.timeLimitSec;
  return undefined;
}

/**
 * When a timed question's time ends (Q-11): its first serve time plus its limit. The exam screen locks it then; the
 * server still takes answers for `QUESTION_TIME_GRACE_MS` more (Q-12, `answerVerdict`).
 */
export const questionTimeUpAt = (servedAt: number, timeLimitSec: number): number => servedAt + timeLimitSec * 1000;
