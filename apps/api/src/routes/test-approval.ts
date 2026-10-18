import {
  approvalChecklist,
  approveResponseSchema,
  FULL_REVIEW_BEFORE_CLOSE_MESSAGE,
  publishResponseSchema,
  releaseResultsTask,
  resolveSettings,
  settingsGaps,
  settingsProblems,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../errors';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });
/** The body is `{}`; an empty request body is accepted too. */
const emptyBody = z.object({}).strict().nullish();

/**
 * Approval and publishing (TST-04, TST-05, Q-14, US-AD-09, DECISIONS Q14, Q15): Approve test runs the checklist on the
 * server; Publish test moves an approved test to `scheduled` with the settings snapshot. Both write their audit entry
 * in the same batch as the change, and a refusal changes nothing.
 */
export function testApprovalRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock } = ctx;
  const db = ctx.firebase.db;
  /** The test with its series and the settings resolved for it now, from the series, the test and the org timezone. */
  const load = async (orgId: string, testId: string) => {
    const test = await data.tests.getTest(orgId, testId);
    if (!test) throw notFound('Test');
    const [series, org] = await Promise.all([data.series.getSeries(orgId, test.seriesId), data.orgs.getOrg(orgId)]);
    if (!series) throw notFound('Test');
    const settings = resolveSettings({ series, test, timezone: org?.timezone ?? 'Asia/Kolkata' });
    return { test, settings };
  };

  return async (app) => {
    app.post(
      '/v1/tests/:id/approve',
      { config: admin, schema: { params: idParams, body: emptyBody, response: { 200: approveResponseSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const { test, settings } = await load(orgId, req.params.id);
        if (test.status !== 'draft' && test.status !== 'in_review')
          throw new AppError(409, 'TEST_ALREADY_APPROVED', 'This test is already approved.');
        const questions = await data.questions.listQuestions(orgId, test.id);
        const checklist = approvalChecklist({ test, questions, settings });
        if (!checklist.passed)
          throw new AppError(409, 'CHECKLIST_FAILED', "This test can't be approved yet. Fix the items marked Failed.", {
            failed: checklist.items.filter((i) => !i.passed).map((i) => i.text),
          });
        const now = clock.now();
        const approval = { status: 'approved' as const, approvedBy: req.user!.uid, approvedAt: now };
        const batch = db.batch();
        data.tests.updateTest(orgId, batch, test.id, {
          status: 'approved',
          approval,
          totalMarks: checklist.totalMarks,
          updatedAt: now,
        });
        audit(req, batch, {
          action: 'test.approve',
          target: { type: 'test', id: test.id },
          before: { status: test.status },
          after: { status: 'approved', totalMarks: checklist.totalMarks },
        });
        await batch.commit();
        return { status: 'approved' as const, totalMarks: checklist.totalMarks };
      },
    );

    app.post(
      '/v1/tests/:id/publish',
      { config: admin, schema: { params: idParams, body: emptyBody, response: { 200: publishResponseSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const { test, settings } = await load(orgId, req.params.id);
        if (test.status !== 'approved')
          throw new AppError(409, 'TEST_NOT_APPROVED', 'Approve the test before publishing it.');
        // SER-09: a series default changed since approval must not make a leaky test go out.
        if (settingsProblems(settings).length)
          throw new AppError(409, 'FULL_REVIEW_BEFORE_CLOSE', FULL_REVIEW_BEFORE_CLOSE_MESSAGE, {
            field: 'resultRelease',
          });
        // Q-14: settings that changed since approval (a series default) are checked again before they are snapshotted.
        const gaps = settingsGaps(settings, test.totalMarks ?? 0);
        if (gaps.length)
          throw new AppError(
            409,
            'CHECKLIST_FAILED',
            "This test can't be published yet. Fix the items marked Failed.",
            {
              failed: [`Failed: ${gaps.join('; ')}`],
            },
          );
        const now = clock.now();
        const batch = db.batch();
        data.tests.updateTest(orgId, batch, test.id, { status: 'scheduled', resolved: settings, updatedAt: now });
        audit(req, batch, {
          action: 'test.publish',
          target: { type: 'test', id: test.id },
          before: { status: test.status },
          after: { status: 'scheduled', resolved: settings },
        });
        await batch.commit();
        // RES-01: the release task at the window end (attempt starts queue it again, idempotently by name).
        if (settings.window)
          await ctx.queue.enqueue(releaseResultsTask({ orgId, testId: test.id, windowEnd: settings.window.end }));
        return { status: 'scheduled' as const };
      },
    );
  };
}
