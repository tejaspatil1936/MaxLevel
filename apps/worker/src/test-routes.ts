import type { TestClock } from '@mitaoe/shared';
import { llmCallSchema, llmScriptSchema, reportLlmCallSchema } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { WorkerConfig } from './config';
import { ScriptedLlm } from './llm/scripted';

const ok = { 200: z.object({ ok: z.literal(true) }) };

/**
 * Test-only routes the API forwards to (PLAN section 6; docs/testids/phase-6.md "Test-only routes"): the clock, and
 * the mock model's script, release, call logs (imports and, phase 7, reports) and reset. Absent unless NODE_ENV=test with a secret.
 */
export async function registerTestRoutes(
  app: FastifyInstance,
  deps: { clock: TestClock; config: WorkerConfig & { testApiSecret: string }; llm?: unknown },
): Promise<void> {
  const { clock, config } = deps;
  const llm = deps.llm instanceof ScriptedLlm ? deps.llm : null;
  await app.register(async (test) => {
    test.addHook('onRequest', async (req, reply) => {
      if (req.headers['x-test-secret'] !== config.testApiSecret)
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Test secret missing.', details: {} } });
    });
    const t = test.withTypeProvider<ZodTypeProvider>();
    t.post('/__test/clock', { schema: { body: z.object({ nowMs: z.number().int() }) } }, async (req) => {
      clock.set(req.body.nowMs);
      return { nowMs: clock.now() };
    });
    if (!llm) return;
    t.post('/__test/llm', { schema: { body: llmScriptSchema, response: ok } }, async (req) => {
      llm.setScript(req.body);
      return { ok: true as const };
    });
    t.post('/__test/llm/release', { schema: { response: ok } }, async () => {
      llm.release();
      return { ok: true as const };
    });
    t.post('/__test/llm/reset', { schema: { response: ok } }, async () => {
      llm.reset();
      return { ok: true as const };
    });
    t.get(
      '/__test/llm/calls',
      { schema: { response: { 200: z.object({ calls: z.array(llmCallSchema) }) } } },
      async () => ({
        calls: llm.calls(),
      }),
    );
    t.get(
      '/__test/llm/report-calls',
      { schema: { response: { 200: z.object({ calls: z.array(reportLlmCallSchema) }) } } },
      async () => ({ calls: llm.reportCalls() }),
    );
  });
}
