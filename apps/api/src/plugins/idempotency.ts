import { createHash, randomUUID } from 'node:crypto';
import type { Clock } from '@mitaoe/shared';
import type {
  FastifyInstance,
  FastifyRequest,
  preHandlerAsyncHookHandler,
  preValidationAsyncHookHandler,
} from 'fastify';
import type { IdempotencyData } from '../data/idempotency';
import { AppError } from '../errors';

/** API-02: a repeated key replays the stored response for 24 hours. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a request holds its key while it runs; a holder that stopped without an answer frees it after this. */
export const IDEMPOTENCY_LOCK_MS = 60_000;
const KEY = /^[\x21-\x7e]{1,200}$/;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The route needs an Idempotency-Key and replays the stored response for a repeated one (API-02). */
    idempotent?: boolean;
  }
  interface FastifyRequest {
    idempotency?: { id: string; replayed: boolean; token?: string };
  }
}

/**
 * API-02: routes marked `idempotent` refuse a request without an Idempotency-Key (400 IDEMPOTENCY_KEY_REQUIRED). A
 * successful response is stored under the caller, the method and URL and the key; the same request with the same key
 * within 24 hours (on the Clock) gets that status and body again, byte for byte, without running the handler. Errors
 * are not stored, so a refused request can be retried with its key. The key is claimed in a transaction before the
 * handler runs, so requests sent together with one key run it once: while the first runs, the others get 409
 * IDEMPOTENCY_IN_PROGRESS and can be sent again. Register before compression, so the body stored
 * is the JSON sent, and before the routes. The key's presence is a route-level preValidation hook, after the app-level
 * gates (sign-in, account and org status, feature gate: AUTH-06, ORG-13) and before the body is validated; the claim
 * is a route-level preHandler, after validation, so a refused caller never gets a stored response back.
 */
export function registerIdempotency(app: FastifyInstance, deps: { store: IdempotencyData; clock: Clock }): void {
  const { store, clock } = deps;

  const keyOf = (req: FastifyRequest): string => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !KEY.test(key))
      throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header with this request.', {
        header: 'Idempotency-Key',
      });
    return key;
  };

  /** A missing or malformed key is refused before the body is validated (API-02, after the app-level gates). */
  const requireKey: preValidationAsyncHookHandler = async (req) => {
    keyOf(req);
  };

  const check: preHandlerAsyncHookHandler = async (req, reply) => {
    const key = keyOf(req);
    const orgId = req.orgId;
    if (!orgId || !req.user) throw new AppError(403, 'FORBIDDEN', 'Your account cannot use this.');
    const id = createHash('sha256').update(`${req.user.uid}\n${req.method} ${req.url}\n${key}`).digest('hex');
    const token = randomUUID();
    const now = clock.now();
    const claim = await store.reserve(orgId, id, {
      token,
      now,
      ttlMs: IDEMPOTENCY_TTL_MS,
      lockedUntil: now + IDEMPOTENCY_LOCK_MS,
    });
    if (claim === 'in_progress')
      throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'This request is still being handled. Try again shortly.');
    if (claim !== 'reserved') {
      req.idempotency = { id, replayed: true };
      return reply.status(claim.replay.status).type('application/json; charset=utf-8').send(claim.replay.body);
    }
    req.idempotency = { id, replayed: false, token };
  };

  app.addHook('onRoute', (route) => {
    if (!route.config?.idempotent) return;
    route.preValidation = [...(route.preValidation ? [route.preValidation].flat() : []), requireKey];
    route.preHandler = [...(route.preHandler ? [route.preHandler].flat() : []), check];
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const pending = req.idempotency;
    if (!pending || pending.replayed) return payload;
    // A refused request frees its key, so it can be sent again (only 2xx answers are kept).
    if (reply.statusCode >= 300 || typeof payload !== 'string') {
      if (pending.token) await store.release(req.orgId!, pending.id, pending.token);
      return payload;
    }
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
