import {
  dayLabels,
  resultDetailShown,
  studentResult,
  studentResultSchema,
  testBoardId,
  type StudentResult,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../errors';
import { studentOf } from './attempts';
import type { ApiContext } from './context';

const student = { access: 'student' as const };
const params = z.object({ attemptId: z.string().min(1).max(128) });

/**
 * GET /v1/student/results/{attemptId} (US-ST-07, RES-01 to RES-03, RES-05, RES-06, DATA-05): the caller's own finished
 * attempt with what the test's release state and detail level allow, read on every request so a changed release
 * setting takes effect at once (TST-06). The answer key and explanations are read, and sent, only for a released full
 * review; the response schema strips everything else. The rank reads the stored test board (LB-01), so it matches the
 * leaderboard the student can open.
 */
export function studentResultRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, clock, published, entitlements } = ctx;

  /** RES-02, LB-04: the stored test board while the test leaderboard is on for students, else undefined. */
  async function testBoard(orgId: string, testId: string, on: boolean) {
    if (!on || !(await entitlements.get(orgId))?.features.public_leaderboards) return undefined;
    const board = await data.leaderboards.getLeaderboard(orgId, testBoardId(testId));
    return { rows: board?.rows ?? null, total: board?.total ?? 0 };
  }

  return async (app) => {
    app.get(
      '/v1/student/results/:attemptId',
      { config: student, schema: { params, response: { 200: studentResultSchema } } },
      async (req): Promise<StudentResult> => {
        const orgId = req.orgId!;
        const attempt = await data.attempts.getAttempt(orgId, req.params.attemptId);
        if (!attempt || attempt.studentId !== studentOf(req).studentId || attempt.status === 'reset')
          throw notFound('Result');
        const test = await data.tests.getTest(orgId, attempt.testId);
        if (!test?.resolved) throw notFound('Result');
        const dayLabelOf = async () => dayLabels(await data.tests.listTests(orgId, test.seriesId))[test.id] ?? null;
        // The page names the test it offers to resume (US-ST-07), so the 409 carries its heading and nothing else.
        if (attempt.status === 'in_progress')
          throw new AppError(409, 'ATTEMPT_IN_PROGRESS', 'This test is still in progress.', {
            testId: test.id,
            title: test.title,
            dayLabel: await dayLabelOf(),
          });
        const settings = test.resolved;
        const release = {
          resultsReleasedAt: test.resultsReleasedAt ?? null,
          resultsWithdrawn: test.resultsWithdrawn === true,
        };
        const now = clock.now();
        const shown = resultDetailShown(settings, release, now);
        const full = shown === 'full';
        const [dayLabel, set, answers, board] = await Promise.all([
          dayLabelOf(),
          full ? published.questions(orgId, test) : null,
          full ? data.attempts.getAnswers(orgId, attempt.id) : null,
          testBoard(orgId, test.id, shown !== null && settings.testLeaderboard),
        ]);
        return studentResult({
          attempt,
          test: { title: test.title, dayLabel, sections: test.sections },
          settings,
          release,
          now,
          ...(board ? { board } : {}),
          ...(set && answers ? { review: { questions: set.byId, answers } } : {}),
        });
      },
    );
  };
}
