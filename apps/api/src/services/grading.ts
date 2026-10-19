import {
  gradeAttempt,
  leaderboardTask,
  type AttemptRecord,
  type AttemptStatus,
  type Clock,
  type TaskQueue,
} from '@mitaoe/shared';
import type { Database } from 'firebase-admin/database';
import type { Data } from '../data';
import type { AttemptChangeWriter } from '../data/attempts';
import { notFound } from '../errors';
import { liveMirror } from './live-mirror';
import type { PublishedTestCache } from './published-tests';
import type { WarnLogger } from './rtdb-writes';

export interface GraderDeps {
  data: Data;
  clock: Clock;
  queue: TaskQueue;
  published: PublishedTestCache;
  rtdb: Database;
  log: WarnLogger;
}

export type FinishedStatus = Extract<AttemptStatus, 'submitted' | 'auto_submitted' | 'terminated'>;

/**
 * Grading on the server (EX-17, spec 11.1): an attempt still in progress is finished with this status and graded by
 * shared `gradeAttempt` from its stored draw, its stored answers (read in the finishing transaction) and the test's
 * answer key, never the client's view. A newly finished attempt queues a leaderboard recompute for its test (LB-03)
 * and is mirrored to `live/…` (OPS-02);
 * one finished before is returned as stored (REL-04).
 */
export function attemptGrader({ data, clock, queue, published, rtdb, log }: GraderDeps) {
  const live = liveMirror(rtdb, log);
  /**
   * Finishes the attempt with this status when it is still in progress, and says whether this call finished it.
   * `write` adds an admin's audit entry to the finishing transaction (OPS-04, AUD-02).
   */
  async function finishWith(
    orgId: string,
    attempt: AttemptRecord,
    status: FinishedStatus,
    extra: { terminationReason?: string; write?: AttemptChangeWriter } = {},
  ): Promise<{ attempt: AttemptRecord; finalized: boolean }> {
    const test = await data.tests.getTest(orgId, attempt.testId);
    if (!test?.resolved) throw notFound('Attempt');
    const settings = test.resolved;
    const set = await published.questions(orgId, test);
    const now = clock.now();
    const done = await data.attempts.finalizeAttempt(
      orgId,
      attempt.id,
      (stored, answers) => ({
        status,
        submittedAt: now,
        result: gradeAttempt({
          attempt: stored,
          questions: set.byId,
          sections: test.sections,
          settings,
          answers,
          submittedAt: now,
        }),
        ...(extra.terminationReason ? { terminationReason: extra.terminationReason } : {}),
      }),
      extra.write,
    );
    if (!done) throw notFound('Attempt');
    if (done.finalized) {
      live.finished(orgId, done.attempt, now);
      await queue.enqueue(leaderboardTask(orgId, attempt.testId, attempt.seriesId, now));
    }
    return done;
  }

  return {
    finishWith,
    async finish(
      orgId: string,
      attempt: AttemptRecord,
      status: FinishedStatus,
      extra: { terminationReason?: string } = {},
    ): Promise<AttemptRecord> {
      return (await finishWith(orgId, attempt, status, extra)).attempt;
    },
  };
}
export type AttemptGrader = ReturnType<typeof attemptGrader>;
