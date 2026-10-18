import { TestClock, type Clock, type TaskQueue } from '@mitaoe/shared';
import { z } from 'zod';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { WorkerConfig } from './config';
import type { WorkerData } from './data';
import { taskAuthCheck, type TaskAuthCheck } from './oidc';
import type { ExportData } from './export-data';
import type { FileStore } from './firebase';
import { autoSubmitHandler, autoSubmitPayloadSchema } from './tasks/auto-submit';
import { exportHandler, exportPayloadSchema } from './tasks/export';
import { leaderboardHandler, leaderboardPayloadSchema } from './tasks/leaderboard';
import { releaseResultsHandler, releaseResultsPayloadSchema } from './tasks/release-results';

export interface WorkerDeps {
  clock: Clock;
  config: WorkerConfig;
  checkTaskAuth?: TaskAuthCheck;
  data: WorkerData;
  /** Follow-up work (rescheduling, leaderboards) goes through this queue only. */
  queue: TaskQueue;
  /** Results exports (EXP-03): their records and the Storage bucket the files go to. */
  exports?: { data: ExportData; files: FileStore };
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
      const autoSubmit = autoSubmitHandler(deps);
      tasks
        .withTypeProvider<ZodTypeProvider>()
        .post('/auto-submit', { schema: { body: autoSubmitPayloadSchema } }, async (req, reply) => {
          const outcome = await autoSubmit(req.body);
          req.log.info({ task: 'auto-submit', attemptId: req.body.attemptId, outcome }, 'task done');
          // A run before its deadline is answered 503 so the queue tries again later (Cloud Tasks retries non-2xx).
          if (outcome === 'retry')
            return reply.status(503).send({
              error: { code: 'TOO_EARLY', message: 'The attempt is not due yet; retry later.', details: {} },
            });
          return { ok: true, outcome };
        });
      const releaseResults = releaseResultsHandler(deps);
      tasks
        .withTypeProvider<ZodTypeProvider>()
        .post('/release-results', { schema: { body: releaseResultsPayloadSchema } }, async (req) => {
          const outcome = await releaseResults(req.body);
          req.log.info({ task: 'release-results', testId: req.body.testId, outcome }, 'task done');
          return { ok: true, outcome };
        });
      const leaderboard = leaderboardHandler(deps);
      tasks
        .withTypeProvider<ZodTypeProvider>()
        .post('/leaderboard', { schema: { body: leaderboardPayloadSchema } }, async (req) => {
          const outcome = await leaderboard(req.body);
          req.log.info({ task: 'leaderboard', testId: req.body.testId, outcome }, 'task done');
          return { ok: true, outcome };
        });
      const handled: string[] = ['auto-submit', 'release-results', 'leaderboard'];
      if (deps.exports) {
        const run = exportHandler({ exports: deps.exports.data, files: deps.exports.files, clock });
        handled.push('export');
        tasks
          .withTypeProvider<ZodTypeProvider>()
          .post('/export', { schema: { body: exportPayloadSchema } }, async (req) => {
            const outcome = await run(req.body);
            req.log.info({ task: 'export', exportId: req.body.exportId, outcome }, 'task done');
            return { ok: true, outcome };
          });
      }
      for (const name of TASK_NAMES.filter((n) => !handled.includes(n))) {
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
