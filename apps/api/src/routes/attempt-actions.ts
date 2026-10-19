import {
  attemptActionResultSchema,
  attemptActionSchema,
  autoSubmitTask,
  extensionNotice,
  extraTimeGrantSchema,
  extraTimeNeedsConfirmation,
  extraTimeResultSchema,
  type AttemptActionResult,
  type ExtraTimeResult,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../errors';
import { attemptGrader } from '../services/grading';
import { liveMirror } from '../services/live-mirror';
import type { ApiContext } from './context';

const idParams = z.object({ id: z.string().min(1).max(128) });
const finishedError = () =>
  new AppError(409, 'ATTEMPT_FINISHED', 'This attempt is finished, so its time can no longer change.');
const notInProgress = () => new AppError(409, 'ATTEMPT_FINISHED', 'This attempt is no longer in progress.');
const reasonRoute = { config: { access: 'admin' as const } };
const reasonSchema = { params: idParams, body: attemptActionSchema, response: { 200: attemptActionResultSchema } };

/**
 * An admin's actions on an attempt during the test (spec 8.3 to 8.5). Each route is for admins of the attempt's
 * organization and super admins working in it (ORG-11, ORG-14); another organization's attempt is 404 (ORG-05).
 */
export function attemptActionRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, queue } = ctx;

  return async (app) => {
    const live = liveMirror(ctx.firebase.rtdb, app.log);
    const grader = attemptGrader({ ...ctx, rtdb: ctx.firebase.rtdb, log: app.log });

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

    /**
     * POST /v1/attempts/{id}/terminate (OPS-04, spec 8.5): ends an attempt in progress exactly as a strike termination
     * does (graded, `terminated`, mirrored live) with the admin's reason, the audit entry in the finishing transaction.
     * The student's screen learns it at its next save or report (409 ATTEMPT_FINISHED).
     */
    app.post('/v1/attempts/:id/terminate', { ...reasonRoute, schema: reasonSchema }, async (req) => {
      const orgId = req.orgId!;
      const { reason } = req.body;
      const attempt = await data.attempts.getAttempt(orgId, req.params.id);
      if (!attempt) throw notFound('Attempt');
      if (attempt.status !== 'in_progress') throw notInProgress();
      const done = await grader.finishWith(orgId, attempt, 'terminated', {
        terminationReason: reason,
        write: (before, after, tx) =>
          audit(req, tx, {
            action: 'attempt.terminate',
            target: { type: 'attempt', id: attempt.id },
            before: { status: before.status },
            after: { reason, status: after.status },
          }),
      });
      if (!done.finalized) throw notInProgress();
      return { status: done.attempt.status } satisfies AttemptActionResult;
    });

    /**
     * POST /v1/attempts/{id}/reinstate (OPS-04, spec 8.5): a terminated attempt continues with its answers, strikes and
     * deadline; the grade and termination are removed with the audit entry in one transaction. The auto-submit task
     * for the deadline is queued again (idempotent by name, EX-16) and the live record shows it in progress. While it
     * is in progress the student gets no answer key: the attempt payload never carries one and the result is
     * 409 ATTEMPT_IN_PROGRESS, even when a full review was released before (DATA-05).
     */
    app.post('/v1/attempts/:id/reinstate', { ...reasonRoute, schema: reasonSchema }, async (req) => {
      const orgId = req.orgId!;
      const { reason } = req.body;
      const done = await data.attempts.reinstateAttempt(orgId, req.params.id, (before, after, tx) =>
        audit(req, tx, {
          action: 'attempt.reinstate',
          target: { type: 'attempt', id: before.id },
          before: { status: before.status, terminationReason: before.terminationReason ?? null },
          after: { reason, status: after.status },
        }),
      );
      if (!done) throw notFound('Attempt');
      if (done === 'ATTEMPT_NOT_TERMINATED')
        throw new AppError(409, 'ATTEMPT_NOT_TERMINATED', 'Only a terminated attempt can be reinstated.');
      await queue.enqueue(autoSubmitTask(orgId, done.id, done.deadlineAt));
      live.reinstated(orgId, done, clock.now());
      return { status: done.status } satisfies AttemptActionResult;
    });
  };
}
