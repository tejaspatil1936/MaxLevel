import { TestClock, type Clock } from '@mitaoe/shared';
import { z } from 'zod';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { WorkerConfig } from './config';
import { taskAuthCheck, type TaskAuthCheck } from './oidc';

export interface WorkerDeps {
  clock: Clock;
  config: WorkerConfig;
  checkTaskAuth?: TaskAuthCheck;
}

export const TASK_NAMES = [
  'auto-submit',
  'release-results',
  'leaderboard',
  'import',
  'report',
  'export',
  'prewarm',
  'migrate',
] as const;

export async function buildWorker(deps: WorkerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: deps.config.logLevel }, genReqId: () => crypto.randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const checkTaskAuth = deps.checkTaskAuth ?? taskAuthCheck(deps.config);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Server-Time', String(deps.clock.now()));
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.url}.`, details: {} } }),
  );

  app.get('/health', async () => ({ ok: true }));

  // Test-only: the API forwards clock changes here (PLAN section 6). Absent unless NODE_ENV=test with a secret.
  const { clock, config } = deps;
  if (config.env === 'test' && config.testApiSecret && clock instanceof TestClock) {
    app
      .withTypeProvider<ZodTypeProvider>()
      .post('/__test/clock', { schema: { body: z.object({ nowMs: z.number().int() }) } }, async (req, reply) => {
        if (req.headers['x-test-secret'] !== config.testApiSecret) {
          return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Test secret missing.', details: {} } });
        }
        clock.set(req.body.nowMs);
        return { nowMs: clock.now() };
      });
  }

  await app.register(
    async (tasks) => {
      tasks.addHook('onRequest', async (req, reply) => {
        if (!(await checkTaskAuth(req.headers.authorization))) {
          return reply.status(401).send({
            error: { code: 'UNAUTHENTICATED', message: 'Task requests need a valid OIDC token.', details: {} },
          });
        }
      });
      for (const name of TASK_NAMES) {
        // Handlers are added by the features that own them; until then a task is acknowledged and logged.
        tasks.post(`/${name}`, async (req) => {
          req.log.info({ task: name }, 'task received');
          return { ok: true };
        });
      }
    },
    { prefix: '/tasks' },
  );
  return app;
}
