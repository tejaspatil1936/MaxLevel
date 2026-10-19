import { randomUUID } from 'node:crypto';
import {
  answeringUntil,
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
  FULL_REVIEW_WHILE_ANSWERING:
    "A full review can't be released while a student is still answering, because they would see the answers. Try again after their deadline.",
};

/** The release input of a published test (RES-01): its settings snapshot and stored release fields. */
export const releaseInputOf = (test: TestRecord & { resolved: NonNullable<TestRecord['resolved']> }) => ({
  settings: test.resolved,
  resultsReleasedAt: test.resultsReleasedAt ?? null,
  resultsWithdrawn: test.resultsWithdrawn === true,
});

/**
 * Release results and Withdraw results (RES-01, RES-05, US-AD-10, SER-09, DATA-05). Each checks the stored state and
 * writes the change with its audit entry in one transaction, then queues a leaderboard recompute due at once (LB-03).
 * A refusal stores nothing.
 */
export function releaseRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, queue } = ctx;

  /** A published test of the organization; anything else, including another org's test, is 404 (ORG-05). */
  const published = (test: TestRecord | null) => {
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
        const now = clock.now();
        // DATA-05, OPS-06: an attempt with extra time may still be answered after the window end.
        const answering = answeringUntil(await data.attempts.listTestAttempts(orgId, req.params.id), now);
        // The check and the write share a transaction: a second concurrent call sees the release and changes nothing.
        const done = await data.tests.inTestTransaction(orgId, req.params.id, (found, tx) => {
          const test = published(found);
          const input = releaseInputOf(test);
          const refusal = manualReleaseRefusal(input, now, answering);
          if (refusal)
            throw new AppError(
              409,
              refusal,
              REFUSALS[refusal],
              answering === null ? {} : { answeringUntil: answering },
            );
          // Already released and not withdrawn: nothing changes.
          if (resultReleaseState(input) === 'released') return { test, changed: false, at: input.resultsReleasedAt };
          data.tests.setRelease(orgId, tx, test.id, { resultsReleasedAt: now, resultsWithdrawn: false });
          audit(req, tx, {
            action: 'test.results.release',
            target: { type: 'test', id: test.id },
            before: { resultsReleasedAt: input.resultsReleasedAt, resultsWithdrawn: input.resultsWithdrawn },
            after: { resultsReleasedAt: now },
          });
          return { test, changed: true, at: now };
        });
        if (done.changed) await recompute(orgId, done.test, 'release', now);
        return { resultsReleasedAt: done.at };
      },
    );

    app.post(
      '/v1/tests/:id/withdraw-results',
      { config: admin, schema: { params: idParams, body: emptyBody, response: { 200: withdrawResponseSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const now = clock.now();
        // As for release: a second concurrent withdrawal sees the first and is refused, with no second audit entry.
        const test = await data.tests.inTestTransaction(orgId, req.params.id, (found, tx) => {
          const record = published(found);
          if (resultReleaseState(releaseInputOf(record)) !== 'released')
            throw new AppError(
              409,
              'RESULTS_NOT_RELEASED',
              "These results aren't released, so there's nothing to withdraw.",
            );
          data.tests.setRelease(orgId, tx, record.id, { resultsWithdrawn: true });
          audit(req, tx, {
            action: 'test.results.withdraw',
            target: { type: 'test', id: record.id },
            before: { resultsWithdrawn: false },
            after: { resultsWithdrawn: true },
          });
          return record;
        });
        await recompute(orgId, test, 'withdraw', now);
        return { resultsWithdrawn: true as const };
      },
    );
  };
}
