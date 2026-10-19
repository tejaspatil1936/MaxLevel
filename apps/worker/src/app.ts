import { TestClock, type Clock, type TaskQueue } from '@mitaoe/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { WorkerConfig } from './config';
import type { LlmDriver } from './llm/driver';
import type { WorkerData } from './data';
import { taskAuthCheck, type TaskAuthCheck } from './oidc';
import type { ExportData } from './export-data';
import type { ImportData } from './import-data';
import type { FileStore } from './firebase';
import type { LiveMirror } from './live';
import { loggingInstanceScaler, type InstanceScaler } from './scaler';
import { autoSubmitHandler, autoSubmitPayloadSchema } from './tasks/auto-submit';
import { exportHandler, exportPayloadSchema } from './tasks/export';
import { importHandler, importPayloadSchema } from './tasks/import';
import { leaderboardHandler, leaderboardPayloadSchema } from './tasks/leaderboard';
import { prewarmHandler, prewarmPayloadSchema } from './tasks/prewarm';
import { releaseResultsHandler, releaseResultsPayloadSchema } from './tasks/release-results';
import { registerTestRoutes } from './test-routes';

export interface WorkerDeps {
  clock: Clock;
  config: WorkerConfig;
  checkTaskAuth?: TaskAuthCheck;
  data: WorkerData;
  /** Follow-up work (rescheduling, leaderboards) goes through this queue only. */
  queue: TaskQueue;
  /** Results exports (EXP-03): their records and the Storage bucket the files go to. */
  exports?: { data: ExportData; files: FileStore };
  /** Question imports (spec 6.2): their jobs and drafts, and the bucket their source files are kept in. */
  imports?: { data: ImportData; files: FileStore };
  /** The live mirror in Realtime Database (OPS-02), written when a task finishes an attempt. */
  live?: LiveMirror;
  /** Raises the API's minimum instances before a slot (PERF-06); the logging driver when absent. */
  scaler?: InstanceScaler;
  /** The model AI imports use (IMP-07): the scripted mock with LLM_PROVIDER=mock; none when unset. */
  llm?: LlmDriver;
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

  // Test-only: the API forwards clock changes and the mock model's script here (PLAN section 6).
  const { clock, config } = deps;
  if (config.env === 'test' && config.testApiSecret && clock instanceof TestClock)
    await registerTestRoutes(app, { clock, config: { ...config, testApiSecret: config.testApiSecret }, llm: deps.llm });

  await app.register(
    async (tasks) => {
      tasks.addHook('onRequest', async (req, reply) => {
        if (!(await checkTaskAuth(req.headers.authorization))) {
          return reply.status(401).send({
            error: { code: 'UNAUTHENTICATED', message: 'Task requests need a valid OIDC token.', details: {} },
          });
        }
      });
      const autoSubmit = autoSubmitHandler({ ...deps, log: tasks.log });
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
      const prewarm = prewarmHandler({ ...deps, scaler: deps.scaler ?? loggingInstanceScaler(tasks.log) });
      tasks
        .withTypeProvider<ZodTypeProvider>()
        .post('/prewarm', { schema: { body: prewarmPayloadSchema } }, async (req) => {
          const outcome = await prewarm(req.body);
          req.log.info({ task: 'prewarm', testId: req.body.testId, outcome }, 'task done');
          return { ok: true, outcome };
        });
      const handled: string[] = ['auto-submit', 'release-results', 'leaderboard', 'prewarm'];
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
      if (deps.imports) {
        const run = importHandler({
          imports: deps.imports.data,
          files: deps.imports.files,
          clock,
          queue: deps.queue,
          ...(deps.llm ? { llm: deps.llm } : {}),
        });
        handled.push('import');
        tasks
          .withTypeProvider<ZodTypeProvider>()
          .post('/import', { schema: { body: importPayloadSchema } }, async (req) => {
            const outcome = await run(req.body);
            req.log.info({ task: 'import', jobId: req.body.jobId, outcome }, 'task done');
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
