import {
  leaderboardRecomputeTask,
  releaseResultsTask,
  releaseTaskAction,
  type Clock,
  type TaskQueue,
} from '@mitaoe/shared';
import { z } from 'zod';
import type { ReleaseTest, WorkerData } from '../data';

export const releaseResultsPayloadSchema = z.object({
  orgId: z.string().min(1).max(128),
  testId: z.string().min(1).max(128),
});
export type ReleaseResultsRun = z.infer<typeof releaseResultsPayloadSchema>;

/** What a run did: nothing (`skipped`, `early`), a recompute only, or a release with a recompute. */
export type ReleaseResultsOutcome = 'skipped' | 'early' | 'recomputed' | 'released';

const asInput = (t: ReleaseTest) => ({
  settings: t.resolved,
  resultsReleasedAt: t.resultsReleasedAt,
  resultsWithdrawn: t.resultsWithdrawn,
});

/**
 * /tasks/release-results (RES-01, LB-03, REL-04): at or after the window end it queues a leaderboard recompute (a
 * flexible window's boards open then), and an `after_close` test not yet released or withdrawn gets
 * `resultsReleasedAt`. Before the end it stores nothing and queues the task for the window end it now has; a
 * released or withdrawn test is left as it is (no audit entry: this is not an admin action). Every run answers 200.
 */
export function releaseResultsHandler(deps: { data: WorkerData; clock: Clock; queue: TaskQueue }) {
  const { data, clock, queue } = deps;
  return async (run: ReleaseResultsRun): Promise<ReleaseResultsOutcome> => {
    const test = await data.getReleaseTest(run.orgId, run.testId);
    const now = clock.now();
    if (!test) return 'skipped';
    const action = releaseTaskAction(asInput(test), now);
    const windowEnd = test.resolved.window?.end;
    if (action === 'early') {
      if (windowEnd !== undefined) await queue.enqueue(releaseResultsTask({ ...run, windowEnd }));
      return 'early';
    }
    const released =
      action === 'release' &&
      (await data.releaseByTask(run.orgId, run.testId, (t) => releaseTaskAction(asInput(t), now) === 'release', now));
    await queue.enqueue(
      leaderboardRecomputeTask({ ...run, seriesId: test.seriesId }, `close-${String(windowEnd)}`, now),
    );
    return released ? 'released' : 'recomputed';
  };
}
