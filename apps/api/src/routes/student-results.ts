import { dayLabels, resultDetailShown, studentResult, studentResultSchema, type StudentResult } from '@mitaoe/shared';
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
 * review; the response schema strips everything else.
 */
export function studentResultRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, clock, published } = ctx;

  return async (app) => {
    app.get(
      '/v1/student/results/:attemptId',
      { config: student, schema: { params, response: { 200: studentResultSchema } } },
      async (req): Promise<StudentResult> => {
        const orgId = req.orgId!;
        const attempt = await data.attempts.getAttempt(orgId, req.params.attemptId);
        if (!attempt || attempt.studentId !== studentOf(req).studentId || attempt.status === 'reset')
          throw notFound('Result');
        if (attempt.status === 'in_progress')
          throw new AppError(409, 'ATTEMPT_IN_PROGRESS', 'This test is still in progress.');
        const test = await data.tests.getTest(orgId, attempt.testId);
        if (!test?.resolved) throw notFound('Result');
        const settings = test.resolved;
        const release = {
          resultsReleasedAt: test.resultsReleasedAt ?? null,
          resultsWithdrawn: test.resultsWithdrawn === true,
        };
        const now = clock.now();
        const full = resultDetailShown(settings, release, now) === 'full';
        const [list, set, answers] = await Promise.all([
          data.tests.listTests(orgId, test.seriesId),
          full ? published.questions(orgId, test) : null,
          full ? data.attempts.getAnswers(orgId, attempt.id) : null,
        ]);
        return studentResult({
          attempt,
          test: { title: test.title, dayLabel: dayLabels(list)[test.id] ?? null, sections: test.sections },
          settings,
          release,
          now,
          ...(set && answers ? { review: { questions: set.byId, answers } } : {}),
        });
      },
    );
  };
}
