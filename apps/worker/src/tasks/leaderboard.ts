import { rankSeries, rankTest, resultsPublic, seriesBoardId, testBoardId, type Clock } from '@mitaoe/shared';
import { z } from 'zod';
import type { ReleaseTest, WorkerData } from '../data';

export const leaderboardPayloadSchema = z.object({
  orgId: z.string().min(1).max(128),
  testId: z.string().min(1).max(128),
  seriesId: z.string().min(1).max(128),
});
export type LeaderboardRun = z.infer<typeof leaderboardPayloadSchema>;

const isPublic = (t: ReleaseTest, now: number) =>
  resultsPublic(
    { settings: t.resolved, resultsReleasedAt: t.resultsReleasedAt, resultsWithdrawn: t.resultsWithdrawn },
    now,
  );

/**
 * /tasks/leaderboard (LB-01 to LB-03, REL-04): recomputes and stores the test board (every finished attempt but
 * terminated ones, whatever the release state; students see it only once it is open) and its series board (only the
 * tests whose results are public, LB-04). Rows depend only on stored attempts, so a second run stores the same rows.
 */
export function leaderboardHandler(deps: { data: WorkerData; clock: Clock }) {
  const { data, clock } = deps;
  return async (run: LeaderboardRun): Promise<'skipped' | 'stored'> => {
    const test = await data.getReleaseTest(run.orgId, run.testId);
    if (!test) return 'skipped';
    const now = clock.now();
    const seriesId = test.seriesId || run.seriesId;
    const counted = (await data.listSeriesReleaseTests(run.orgId, seriesId)).filter((t) => isPublic(t, now));
    const attempts = new Map(
      await Promise.all(
        [...new Set([test.id, ...counted.map((t) => t.id)])].map(
          async (id) => [id, await data.listRankableAttempts(run.orgId, id)] as const,
        ),
      ),
    );
    await data.putLeaderboard(run.orgId, testBoardId(test.id), now, rankTest(attempts.get(test.id) ?? []));
    const series = rankSeries(counted.map((t) => ({ testId: t.id, attempts: attempts.get(t.id) ?? [] })));
    await data.putLeaderboard(run.orgId, seriesBoardId(seriesId), now, series);
    return 'stored';
  };
}
