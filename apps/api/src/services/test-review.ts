import type { Data } from '../data';
import type { TestRecord } from '../data/tests';

/**
 * Q-15, TST-06, DECISIONS Q16: an edit of an approved or scheduled test sends it back to review, but only while no
 * attempt exists; once one has started, the locked fields are refused instead (phase 3).
 */
export async function editReturnsToReview(data: Data, orgId: string, test: TestRecord): Promise<boolean> {
  if (test.status !== 'approved' && test.status !== 'scheduled') return false;
  if (test.attemptsStarted) return false;
  return !(await data.attempts.hasAttempts(orgId, test.id));
}
