import {
  autoSubmitTask,
  extensionNotice,
  extraTimeGrantSchema,
  extraTimeNeedsConfirmation,
  extraTimeResultSchema,
  type ExtraTimeResult,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../errors';
import { liveMirror } from '../services/live-mirror';
import type { ApiContext } from './context';

const idParams = z.object({ id: z.string().min(1).max(128) });
const finishedError = () =>
  new AppError(409, 'ATTEMPT_FINISHED', 'This attempt is finished, so its time can no longer change.');

/**
 * An admin's actions on an attempt during the test (spec 8.3 to 8.5). Each route is for admins of the attempt's
 * organization and super admins working in it (ORG-11, ORG-14); another organization's attempt is 404 (ORG-05).
 */
export function attemptActionRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, queue } = ctx;

  return async (app) => {
    const live = liveMirror(ctx.firebase.rtdb, app.log);

    /**
     * POST /v1/attempts/{id}/extra-time (OPS-06, OPS-08, OPS-09, spec 11.3): adds the minutes to the deadline of an
     * attempt in progress, which may pass the window end, with the audit entry in the same transaction. A grant above
     * the test's duration needs `confirmOverDuration`. The auto-submit task for the new deadline is queued at once; the
     * old one finds the later deadline when it fires and finalizes nothing. The live record and the student's signal
     * get the new deadline.
     */
    app.post(
      '/v1/attempts/:id/extra-time',
      {
        config: { access: 'admin' as const, feature: 'extra_time_grants' as const },
        schema: { params: idParams, body: extraTimeGrantSchema, response: { 200: extraTimeResultSchema } },
      },
      async (req): Promise<ExtraTimeResult> => {
        const orgId = req.orgId!;
        const { minutes, reason, confirmOverDuration } = req.body;
        const attempt = await data.attempts.getAttempt(orgId, req.params.id);
        if (!attempt) throw notFound('Attempt');
        if (attempt.status !== 'in_progress') throw finishedError();
        const test = await data.tests.getTest(orgId, attempt.testId);
        if (!test?.resolved) throw notFound('Attempt');
        const { durationMin } = test.resolved;
        if (extraTimeNeedsConfirmation(minutes, durationMin) && confirmOverDuration !== true)
          throw new AppError(
            409,
            'EXTRA_TIME_CONFIRMATION_REQUIRED',
            `${minutes} minutes is more than the test's duration of ${durationMin} minutes. Confirm to grant it.`,
            { minutes, durationMin },
          );

        const now = clock.now();
        const done = await data.attempts.grantExtraTime(orgId, attempt.id, minutes * 60, (before, after, tx) =>
          audit(req, tx, {
            action: 'attempt.extra_time.grant',
            target: { type: 'attempt', id: attempt.id },
            before: { deadlineAt: before.deadlineAt, extraTimeSec: before.extraTimeSec },
            after: { minutes, reason, deadlineAt: after.deadlineAt, extraTimeSec: after.extraTimeSec },
          }),
        );
        if (!done) throw notFound('Attempt');
        if (done === 'ATTEMPT_FINISHED') throw finishedError();
        await Promise.all([
          queue.enqueue(autoSubmitTask(orgId, done.id, done.deadlineAt)),
          live.extended(orgId, done, extensionNotice(minutes), now),
        ]);
        return { deadlineAt: done.deadlineAt, extraTimeSec: done.extraTimeSec };
      },
    );
  };
}
