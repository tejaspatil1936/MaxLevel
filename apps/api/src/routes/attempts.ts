import {
  answerBatchResultSchema,
  answerBatchSchema,
  attemptEventReportSchema,
  attemptEventResultSchema,
  attemptPayloadSchema,
  attemptStartSchema,
  attemptSubmitResultSchema,
  attemptSubmitSchema,
  type AttemptPayload,
} from '@mitaoe/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../errors';
import { ANSWER_RATE_LIMIT, EVENT_RATE_LIMIT } from '../plugins/rate-limit';
import { attemptService } from '../services/attempts';
import type { ApiContext } from './context';

const student = { access: 'student' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });

const studentOf = (req: FastifyRequest) => {
  const studentId = req.user?.studentId;
  if (!studentId || !req.user) throw new AppError(403, 'FORBIDDEN', 'Only students take tests.');
  return { uid: req.user.uid, studentId };
};

/**
 * A student's attempts (spec 11.1, docs/testids/phase-3.md): start and resume return the one exam payload (PERF-03).
 * Staff tokens get 403; another student's or another organization's attempt is 404.
 */
export function attemptRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const attempts = attemptService({ ...ctx, rtdb: ctx.firebase.rtdb });

  return async (app) => {
    app.post(
      '/v1/attempts',
      {
        config: { ...student, idempotent: true },
        schema: { body: attemptStartSchema, response: { 200: attemptPayloadSchema, 201: attemptPayloadSchema } },
      },
      async (req, reply): Promise<AttemptPayload> => {
        const { payload, created } = await attempts.start(req.orgId!, studentOf(req), req.body.testId);
        return reply.status(created ? 201 : 200).send(payload);
      },
    );

    app.get(
      '/v1/attempts/:id',
      { config: student, schema: { params: idParams, response: { 200: attemptPayloadSchema } } },
      async (req) => attempts.resume(req.orgId!, studentOf(req).studentId, req.params.id),
    );

    // EX-10, EX-11: the exam screen's answer batches, limited per user (API-06).
    app.put(
      '/v1/attempts/:id/answers',
      {
        config: { ...student, rateLimit: ANSWER_RATE_LIMIT },
        schema: { params: idParams, body: answerBatchSchema, response: { 200: answerBatchResultSchema } },
      },
      async (req) => attempts.saveAnswers(req.orgId!, studentOf(req).studentId, req.params.id, req.body),
    );

    // PR-08: the client's proctoring reports, limited per user (API-06). Logging and counting come with F-3.10.
    app.post(
      '/v1/attempts/:id/events',
      {
        config: { ...student, rateLimit: EVENT_RATE_LIMIT },
        schema: { params: idParams, body: attemptEventReportSchema, response: { 200: attemptEventResultSchema } },
      },
      async (req) => {
        const attempt = await ctx.data.attempts.getAttempt(req.orgId!, req.params.id);
        if (!attempt || attempt.studentId !== studentOf(req).studentId) throw notFound('Attempt');
        throw new AppError(501, 'NOT_IMPLEMENTED', "Reporting events isn't available yet.");
      },
    );

    // EX-15: submitting and grading come with F-3.08; the Idempotency-Key requirement (API-02) holds already.
    app.post(
      '/v1/attempts/:id/submit',
      {
        config: { ...student, idempotent: true },
        schema: { params: idParams, body: attemptSubmitSchema, response: { 200: attemptSubmitResultSchema } },
      },
      async (req) => {
        const attempt = await ctx.data.attempts.getAttempt(req.orgId!, req.params.id);
        if (!attempt || attempt.studentId !== studentOf(req).studentId) throw notFound('Attempt');
        throw new AppError(501, 'NOT_IMPLEMENTED', "Submitting isn't available yet.");
      },
    );
  };
}
