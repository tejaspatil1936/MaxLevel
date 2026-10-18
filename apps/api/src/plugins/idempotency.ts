import { createHash } from 'node:crypto';
import type { Clock } from '@mitaoe/shared';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { IdempotencyData } from '../data/idempotency';
import { AppError } from '../errors';

/** API-02: a repeated key replays the stored response for 24 hours. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY = /^[\x21-\x7e]{1,200}$/;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The route needs an Idempotency-Key and replays the stored response for a repeated one (API-02). */
    idempotent?: boolean;
  }
  interface FastifyRequest {
    idempotency?: { id: string; replayed: boolean };
  }
}

/**
 * API-02: routes marked `idempotent` refuse a request without an Idempotency-Key (400 IDEMPOTENCY_KEY_REQUIRED). A
 * successful response is stored under the caller, the method and URL and the key; the same request with the same key
 * within 24 hours (on the Clock) gets that status and body again, byte for byte, without running the handler. Errors
 * are not stored, so a refused request can be retried with its key. Register before compression, so the body stored
 * is the JSON sent, and before the routes. The check is a route-level preHandler, so it runs after every app-level one
 * (sign-in, account and org status, feature gate: AUTH-06, ORG-13): a refused caller never gets a stored response back.
 */
export function registerIdempotency(app: FastifyInstance, deps: { store: IdempotencyData; clock: Clock }): void {
  const { store, clock } = deps;

  const check: preHandlerAsyncHookHandler = async (req, reply) => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !KEY.test(key))
      throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header with this request.', {
        header: 'Idempotency-Key',
      });
    const orgId = req.orgId;
    if (!orgId || !req.user) throw new AppError(403, 'FORBIDDEN', 'Your account cannot use this.');
    const id = createHash('sha256').update(`${req.user.uid}\n${req.method} ${req.url}\n${key}`).digest('hex');
    const stored = await store.getResponse(orgId, id);
    if (stored && clock.now() - stored.createdAt < IDEMPOTENCY_TTL_MS) {
      req.idempotency = { id, replayed: true };
      return reply.status(stored.status).type('application/json; charset=utf-8').send(stored.body);
    }
    req.idempotency = { id, replayed: false };
  };

  app.addHook('onRoute', (route) => {
    if (!route.config?.idempotent) return;
    route.preHandler = [...(route.preHandler ? [route.preHandler].flat() : []), check];
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const pending = req.idempotency;
    if (!pending || pending.replayed || reply.statusCode >= 300 || typeof payload !== 'string') return payload;
    const createdAt = clock.now();
    await store.putResponse(
      req.orgId!,
      pending.id,
      { status: reply.statusCode, body: payload, createdAt },
      createdAt + IDEMPOTENCY_TTL_MS,
    );
    return payload;
  });
}
