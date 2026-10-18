import { pendingTaskSchema, TestClock } from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Deps } from '../deps';
import { AppError } from '../errors';
import { localTaskQueue } from '../tasks/local-queue';
import { clearEmulators } from '../test-support/emulators';
import { SCENARIOS } from '../test-support/scenarios';
import { seedBase } from '../test-support/seed';

/** True only when NODE_ENV=test, TEST_API_SECRET is set and the clock is settable (PLAN section 6). */
export const testApiEnabled = (deps: Deps): deps is Deps & { clock: TestClock } =>
  deps.config.env === 'test' && !!deps.config.testApiSecret && deps.clock instanceof TestClock;

/** In-memory caches the reset empties, so one test's entitlements or account status never leak into the next. */
export interface ResettableCaches {
  clearCaches: () => void;
}

export function testOnlyRoutes(deps: Deps & { clock: TestClock } & ResettableCaches): FastifyPluginAsyncZod {
  const { clock, config } = deps;
  const clockBody = z.union([z.object({ nowMs: z.number().int() }), z.object({ advanceMs: z.number().int() })]);
  const clockReply = { 200: z.object({ nowMs: z.number() }) };

  const forwardClockToWorker = async () => {
    const res = await fetch(`${config.workerUrl}/__test/clock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-secret': config.testApiSecret ?? '' },
      body: JSON.stringify({ nowMs: clock.now() }),
    }).catch(() => null);
    if (!res?.ok) throw new AppError(502, 'INTERNAL', 'The worker did not accept the clock change.');
  };

  return async (app) => {
    app.addHook('onRequest', async (req) => {
      if (req.headers['x-test-secret'] !== config.testApiSecret)
        throw new AppError(403, 'FORBIDDEN', 'Test secret missing.');
    });

    app.get('/__test/clock', { schema: { response: clockReply } }, async () => ({ nowMs: clock.now() }));

    app.post('/__test/clock', { schema: { body: clockBody, response: clockReply } }, async (req) => {
      if ('nowMs' in req.body) clock.set(req.body.nowMs);
      else clock.advance(req.body.advanceMs);
      await forwardClockToWorker();
      return { nowMs: clock.now() };
    });

    // The local queue's tasks not yet run (docs/TEST_ENV.md, "Test-only API").
    app.get(
      '/__test/tasks',
      { schema: { response: { 200: z.object({ tasks: z.array(pendingTaskSchema) }) } } },
      async () => ({ tasks: await localTaskQueue(deps.firebase.db, clock).pending() }),
    );

    app.post('/__test/clock/real', { schema: { response: clockReply } }, async () => {
      clock.followReal();
      return { nowMs: clock.now() };
    });

    app.post(
      '/__test/reset',
      {
        schema: {
          body: z.object({ seed: z.enum(['base', 'none']).default('base') }).default({ seed: 'base' }),
          response: { 200: z.object({ ok: z.literal(true) }) },
        },
      },
      async (req) => {
        clock.reset();
        deps.clearCaches();
        await clearEmulators();
        if (req.body.seed === 'base') await seedBase(deps.firebase.db, clock.now());
        return { ok: true as const };
      },
    );

    app.post(
      '/__test/seed/:scenario',
      {
        schema: {
          params: z.object({ scenario: z.string() }),
          body: z.record(z.string(), z.unknown()).default({}),
          // Scenario IDs: a string, a list in order (questionIds), a map by name (sectionIds) or times (window).
          response: {
            200: z.record(
              z.string(),
              z.union([
                z.string(),
                z.array(z.string()),
                z.record(z.string(), z.string()),
                z.record(z.string(), z.number()),
              ]),
            ),
          },
        },
      },
      async (req) => {
        const run = SCENARIOS[req.params.scenario];
        if (!run) throw new AppError(404, 'NOT_FOUND', `No scenario named ${req.params.scenario}.`);
        return run(deps.firebase.db, clock.now(), req.body);
      },
    );
  };
}
