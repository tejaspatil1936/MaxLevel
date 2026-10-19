import {
  autoSubmitAction,
  autoSubmitTask,
  gradeAttempt,
  leaderboardTask,
  type Clock,
  type TaskQueue,
} from '@mitaoe/shared';
import { z } from 'zod';
import type { WorkerData } from '../data';
import type { LiveMirror } from '../live';

/** The task's payload; `deadlineAt` is the deadline it was queued for (left out by hand-made runs). */
export const autoSubmitPayloadSchema = z.object({
  orgId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128),
  deadlineAt: z.number().int().optional(),
});
export type AutoSubmitRun = z.infer<typeof autoSubmitPayloadSchema>;

/** What a run did: `retry` asks the queue to run it again later (it came before the deadline it was made for). */
export type AutoSubmitOutcome = 'finalized' | 'skipped' | 'rescheduled' | 'retry';

/**
 * /tasks/auto-submit (EX-16, REL-04, DECISIONS Q18): at deadline + 2 minutes, finalizes an attempt nobody submitted as
 * `auto_submitted`, graded by shared `gradeAttempt` from its stored draw, answers and the answer key (EX-17), and
 * queues the test's leaderboard recompute; the finish is mirrored to `live/…` (OPS-02). A finished or missing attempt is left alone, so a second run changes
 * nothing; when the deadline was moved later (extra time) a task for the new deadline is queued instead. The deadline
 * is checked again inside the finishing transaction.
 */
export function autoSubmitHandler(deps: {
  data: WorkerData;
  clock: Clock;
  queue: TaskQueue;
  live?: LiveMirror;
  log?: { warn(obj: object, msg: string): void };
}) {
  const { data, clock, queue, live, log } = deps;
  return async (run: AutoSubmitRun): Promise<AutoSubmitOutcome> => {
    const attempt = await data.getAttempt(run.orgId, run.attemptId);
    const action = autoSubmitAction(attempt, run.deadlineAt, clock.now());
    if (action === 'skip' || !attempt) return 'skipped';
    if (action === 'retry') return 'retry';
    if (action === 'reschedule') {
      await queue.enqueue(autoSubmitTask(run.orgId, attempt.id, attempt.deadlineAt));
      return 'rescheduled';
    }
    const test = await data.getGradedTest(run.orgId, attempt.testId);
    if (!test) return 'skipped';
    const keys = await data.answerKeys(run.orgId, test.id, attempt.draw.questionIds);
    const now = clock.now();
    const done = await data.finalizeAttempt(run.orgId, attempt.id, (stored, answers) =>
      autoSubmitAction(stored, run.deadlineAt, now) !== 'finalize'
        ? null
        : {
            status: 'auto_submitted',
            submittedAt: now,
            result: gradeAttempt({
              attempt: stored,
              questions: keys,
              sections: test.sections,
              settings: test.resolved,
              answers,
              submittedAt: now,
            }),
          },
    );
    if (!done?.finalized) {
      // The deadline moved while this run read the attempt: run again, and the next run reschedules.
      return done && done.attempt.status === 'in_progress' ? 'retry' : 'skipped';
    }
    // OPS-02: the live view shows the finish; a failed mirror write is logged, never retried (REL-05).
    live
      ?.finished(run.orgId, done.attempt, now)
      .catch((err: unknown) => log?.warn({ err, attemptId: attempt.id }, 'live mirror write failed'));
    await queue.enqueue(leaderboardTask(run.orgId, test.id, test.seriesId, now));
    return 'finalized';
  };
}
