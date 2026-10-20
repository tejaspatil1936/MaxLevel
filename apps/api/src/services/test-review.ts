import type { Data } from '../data';
import type { TestRecord } from '../data/tests';
import { AppError } from '../errors';

/**
 * TST-06, Q-15 (DECISIONS 2026-10-18): whether an attempt of the test has started: the test's `attemptsStarted` flag
 * or a stored attempt. An attempt index entry that only holds a phone pairing reservation is not an attempt.
 */
export async function attemptsStarted(data: Data, orgId: string, test: TestRecord): Promise<boolean> {
  return test.attemptsStarted || (await data.attempts.hasAttempts(orgId, test.id));
}

/** Q-15, DECISIONS Q16: an edit of an approved or scheduled test sends it back to review while no attempt started. */
export const returnsToReview = (test: TestRecord, started: boolean): boolean =>
  !started && (test.status === 'approved' || test.status === 'scheduled');

/** TST-06: once an attempt has started, the question set and the settings that shape an attempt are locked. */
export const testLocked = (what: 'questions' | 'settings', field?: string) =>
  new AppError(
    409,
    'TEST_LOCKED',
    what === 'questions'
      ? 'Attempts have started, so the questions of this test can no longer change.'
      : 'Attempts have started, so this setting can no longer change. You can still extend a flexible window and change release, leaderboard and visibility settings.',
    field ? { field } : {},
  );
