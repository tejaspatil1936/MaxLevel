// Answer sync rules (spec 6.6, 7.4: EX-11, EX-12, EX-13, Q-12). `serverNow` comes from the server's Clock.

/** Answers made before the deadline are still accepted when they arrive up to 2 minutes after it (EX-13). */
export const LATE_SYNC_GRACE_MS = 120_000;
/** A timed question accepts answers up to its limit plus 2 seconds after it was first served (Q-12). */
export const QUESTION_TIME_GRACE_MS = 2_000;
/** How far before the stored deadline a device's time-up submit is still taken (its clock's error, EX-16). */
export const TIME_UP_GRACE_MS = 5_000;

/**
 * EX-16, OPS-06: a time-up submit that names the deadline the device counted down to is refused while the stored
 * deadline (moved by extra time the device missed) is more than the clock grace away. A manual submit, and a time-up
 * that names no deadline (API callers), are taken at any time.
 */
export function timeUpTooEarly(input: { deadlineAt: number; claimedDeadlineAt?: number; now: number }): boolean {
  return input.claimedDeadlineAt !== undefined && input.now < input.deadlineAt - TIME_UP_GRACE_MS;
}

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000] as const;
const RETRY_STEADY_MS = 15_000;

/** How long to wait after the n-th failed sync in a row (EX-12): 1, 2, 4 and 8 seconds, then every 15, no jitter. */
export function retryDelayMs(failures: number): number {
  if (failures < 1) return 0;
  return RETRY_DELAYS_MS[failures - 1] ?? RETRY_STEADY_MS;
}

export type AnswerRejection = 'AFTER_DEADLINE' | 'QUESTION_TIME_UP' | 'QUESTION_NOT_SERVED';
export type AnswerVerdict = 'saved' | 'late_sync' | 'stale' | AnswerRejection;

/**
 * What the server does with one synced answer. In order:
 * - `stale` when its `seq` is not higher than the stored one (EX-11): the stored answer is newer or the same, so a
 *   retried batch that was already saved never reads as rejected;
 * - `AFTER_DEADLINE` when it was made after the deadline (`clientTs`) or arrives more than 2 minutes after it (EX-13);
 * - on a timed question (`timeLimitSec`), `QUESTION_NOT_SERVED` when it was never served and `QUESTION_TIME_UP` when it
 *   arrives more than the limit plus 2 seconds after the first serve time (Q-12);
 * - `late_sync` when it arrives after the deadline but within the grace (saved with `lateSync: true`);
 * - else `saved`.
 */
export function answerVerdict(input: {
  seq: number;
  storedSeq?: number;
  clientTs: number;
  serverNow: number;
  deadlineAt: number;
  servedAt?: number;
  timeLimitSec?: number;
}): AnswerVerdict {
  const { seq, storedSeq, clientTs, serverNow, deadlineAt, servedAt, timeLimitSec } = input;
  if (storedSeq !== undefined && seq <= storedSeq) return 'stale';
  if (clientTs > deadlineAt || serverNow > deadlineAt + LATE_SYNC_GRACE_MS) return 'AFTER_DEADLINE';
  if (timeLimitSec !== undefined) {
    if (servedAt === undefined) return 'QUESTION_NOT_SERVED';
    if (serverNow > servedAt + timeLimitSec * 1000 + QUESTION_TIME_GRACE_MS) return 'QUESTION_TIME_UP';
  }
  return serverNow > deadlineAt ? 'late_sync' : 'saved';
}
