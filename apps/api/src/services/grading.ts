import {
  gradeAttempt,
  leaderboardTask,
  type AttemptRecord,
  type AttemptStatus,
  type Clock,
  type TaskQueue,
} from '@mitaoe/shared';
import type { Data } from '../data';
import { notFound } from '../errors';
import type { PublishedTestCache } from './published-tests';

export interface GraderDeps {
  data: Data;
  clock: Clock;
  queue: TaskQueue;
  published: PublishedTestCache;
}

export type FinishedStatus = Extract<AttemptStatus, 'submitted' | 'auto_submitted' | 'terminated'>;

/**
 * Grading on the server (EX-17, spec 11.1): an attempt still in progress is finished with this status and graded by
 * shared `gradeAttempt` from its stored draw, its stored answers (read in the finishing transaction) and the test's
 * answer key, never the client's view. A newly finished attempt queues a leaderboard recompute for its test (LB-03);
 * one finished before is returned as stored (REL-04).
 */
export function attemptGrader({ data, clock, queue, published }: GraderDeps) {
  return {
    async finish(
      orgId: string,
      attempt: AttemptRecord,
      status: FinishedStatus,
      extra: { terminationReason?: string } = {},
    ): Promise<AttemptRecord> {
      const test = await data.tests.getTest(orgId, attempt.testId);
      if (!test?.resolved) throw notFound('Attempt');
      const settings = test.resolved;
      const set = await published.questions(orgId, test);
      const now = clock.now();
      const done = await data.attempts.finalizeAttempt(orgId, attempt.id, (stored, answers) => ({
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
      }));
      if (!done) throw notFound('Attempt');
      if (done.finalized) await queue.enqueue(leaderboardTask(orgId, attempt.testId, attempt.seriesId, now));
      return done.attempt;
    },
  };
}
export type AttemptGrader = ReturnType<typeof attemptGrader>;
