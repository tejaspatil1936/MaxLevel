import {
  pairingRedeemResultSchema,
  pairingRedeemSchema,
  pairingReservationSchema,
  pairingTokenSchema,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RateLimitOptions } from '@fastify/rate-limit';
import { pairingService } from '../services/pairing';
import { studentOf } from './attempts';
import type { ApiContext } from './context';

const student = { access: 'student' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });
const testParams = z.object({ testId: z.string().min(1).max(128) });
const empty = z.object({}).strict();
/** The phone is not signed in, so redeeming is limited per address: 30 a minute is far above any real pairing. */
const REDEEM_RATE_LIMIT: RateLimitOptions = { max: 30, timeWindow: 60_000 };

/**
 * Phone pairing (spec 7.9, 11.5; docs/testids/phase-3.md "Phone pairing"): the student asks for a pairing link on the
 * rules screen (before Start) or during the attempt, and the phone redeems it for a device sign-in.
 */
export function pairingRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const pairing = pairingService({
    data: ctx.data,
    clock: ctx.clock,
    rtdb: ctx.firebase.rtdb,
    auth: ctx.firebase.auth,
    webOrigin: ctx.config.appOrigins[0] ?? 'http://localhost:3000',
  });

  return async (app) => {
    // PR-13: pairing on the rules screen reserves the attempt ID without starting the clock.
    app.post(
      '/v1/tests/:testId/pairing-token',
      { config: student, schema: { params: testParams, body: empty, response: { 200: pairingReservationSchema } } },
      async (req) => pairing.reserve(req.orgId!, studentOf(req), req.params.testId),
    );

    // PR-13, PR-16: a new link for the attempt in progress (the reconnect overlay shows it).
    app.post(
      '/v1/attempts/:id/pairing-token',
      { config: student, schema: { params: idParams, body: empty, response: { 200: pairingTokenSchema } } },
      async (req) => pairing.forAttempt(req.orgId!, studentOf(req), req.params.id),
    );

    // PR-14: the phone exchanges the link for a custom token with the device claims.
    app.post(
      '/v1/pairing/redeem',
      {
        config: { access: 'public', rateLimit: REDEEM_RATE_LIMIT },
        schema: { body: pairingRedeemSchema, response: { 200: pairingRedeemResultSchema } },
      },
      async (req) => pairing.redeem(req.body.token),
    );
  };
}
