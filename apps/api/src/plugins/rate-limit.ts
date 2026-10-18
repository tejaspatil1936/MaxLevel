import rateLimit, { type RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors';

/**
 * API-06: per-user limits on the exam's chatty routes. A route opts in with `config.rateLimit`; the check runs as a
 * route-level preHandler, after sign-in (so the key is the caller's uid) and after the account status checks. Each
 * route counts in its own one-second window per user; `max` is the steady rate plus a small burst on top.
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
    keyGenerator: (req) => (req.user ? `uid:${req.user.uid}` : `ip:${req.ip}`),
    errorResponseBuilder: () =>
      new AppError(429, 'RATE_LIMITED', 'Too many requests at once. Wait a moment and try again.'),
  });
}

/** Answer batches: 10 a second plus a burst of 5 (PUT /v1/attempts/{id}/answers). */
export const ANSWER_RATE_LIMIT: RateLimitOptions = { max: 15, timeWindow: 1000 };
/** Proctoring event reports: 5 a second plus a burst of 3 (POST /v1/attempts/{id}/events). */
export const EVENT_RATE_LIMIT: RateLimitOptions = { max: 8, timeWindow: 1000 };
