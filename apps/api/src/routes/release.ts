import { randomUUID } from 'node:crypto';
import {
  leaderboardRecomputeTask,
  manualReleaseRefusal,
  releaseResponseSchema,
  resultReleaseState,
  withdrawResponseSchema,
  type ReleaseRefusal,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { TestRecord } from '../data/tests';
import { AppError, notFound } from '../errors';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });
/** The body is `{}`; an empty request body is accepted too. */
const emptyBody = z.object({}).strict().nullish();

const REFUSALS: Record<ReleaseRefusal, string> = {
  RESULTS_NOT_RELEASABLE: "This test's results are set to never be shared with students.",
  FULL_REVIEW_BEFORE_CLOSE:
    "A full review can't be released before the window closes, because students who haven't started would see the answers.",
};

/** The release input of a published test (RES-01): its settings snapshot and stored release fields. */
export const releaseInputOf = (test: TestRecord & { resolved: NonNullable<TestRecord['resolved']> }) => ({
  settings: test.resolved,
  resultsReleasedAt: test.resultsReleasedAt ?? null,
  resultsWithdrawn: test.resultsWithdrawn === true,
});

/**
 * Release results and Withdraw results (RES-01, RES-05, US-AD-10, SER-09, DATA-05). Each writes its audit entry in the
 * same batch as the change and then queues a leaderboard recompute due at once (LB-03). A refusal stores nothing.
 */
export function releaseRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, queue } = ctx;
  const db = ctx.firebase.db;

  /** A published test of the organization; anything else, including another org's test, is 404 (ORG-05). */
  const published = async (orgId: string, testId: string) => {
    const test = await data.tests.getTest(orgId, testId);
    if (!test?.resolved) throw notFound('Test');
    return { ...test, resolved: test.resolved };
  };
  /** Each action gets a recompute of its own, even two in the same millisecond on a frozen test clock. */
  const recompute = (orgId: string, test: TestRecord, action: string, now: number) =>
    queue.enqueue(
      leaderboardRecomputeTask(
        { orgId, testId: test.id, seriesId: test.seriesId },
        `${action}-${now}-${randomUUID().slice(0, 8)}`,
        now,
      ),
    );

  return async (app) => {
    app.post(
      '/v1/tests/:id/release',
      { config: admin, schema: { params: idParams, body: emptyBody, response: { 200: releaseResponseSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const test = await published(orgId, req.params.id);
        const input = releaseInputOf(test);
        const now = clock.now();
        const refusal = manualReleaseRefusal(input, now);
        if (refusal) throw new AppError(409, refusal, REFUSALS[refusal]);
        // Already released and not withdrawn: nothing changes.
        if (resultReleaseState(input) === 'released') return { resultsReleasedAt: input.resultsReleasedAt };
        const batch = db.batch();
        data.tests.setRelease(orgId, batch, test.id, { resultsReleasedAt: now, resultsWithdrawn: false });
        audit(req, batch, {
          action: 'test.results.release',
          target: { type: 'test', id: test.id },
          before: { resultsReleasedAt: input.resultsReleasedAt, resultsWithdrawn: input.resultsWithdrawn },
          after: { resultsReleasedAt: now },
        });
        await batch.commit();
        await recompute(orgId, test, 'release', now);
        return { resultsReleasedAt: now };
      },
    );

    app.post(
      '/v1/tests/:id/withdraw-results',
      { config: admin, schema: { params: idParams, body: emptyBody, response: { 200: withdrawResponseSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const test = await published(orgId, req.params.id);
        if (resultReleaseState(releaseInputOf(test)) !== 'released')
          throw new AppError(
            409,
            'RESULTS_NOT_RELEASED',
            "These results aren't released, so there's nothing to withdraw.",
          );
        const now = clock.now();
        const batch = db.batch();
        data.tests.setRelease(orgId, batch, test.id, { resultsWithdrawn: true });
        audit(req, batch, {
          action: 'test.results.withdraw',
          target: { type: 'test', id: test.id },
          before: { resultsWithdrawn: false },
          after: { resultsWithdrawn: true },
        });
        await batch.commit();
        await recompute(orgId, test, 'withdraw', now);
        return { resultsWithdrawn: true as const };
      },
    );
  };
}
