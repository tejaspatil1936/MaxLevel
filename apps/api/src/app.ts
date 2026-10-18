import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { Clock } from '@mitaoe/shared';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Logger } from 'pino';
import type { Config } from './config';
import type { Deps } from './deps';
import { createLogger } from './logging';
import type { IdempotencyData } from './data/idempotency';
import { registerErrorHandling } from './plugins/errors';
import { registerIdempotency } from './plugins/idempotency';
import { registerRateLimit } from './plugins/rate-limit';
import { registerRequestLog } from './plugins/request-log';
import { registerRouteTable } from './plugins/route-table';
import { registerServerTime } from './plugins/server-time';
import { createData } from './data';
import { registerAuth } from './plugins/auth';
import { healthRoutes } from './routes/health';
import { attemptRoutes } from './routes/attempts';
import { auditRoutes } from './routes/audit';
import type { ApiContext } from './routes/context';
import { departmentRoutes } from './routes/departments';
import { meRoutes } from './routes/me';
import { orgRoutes } from './routes/org';
import { pairingRoutes } from './routes/pairing';
import { platformRoutes } from './routes/platform';
import { seriesRoutes } from './routes/series';
import { studentRoutes } from './routes/students';
import { studentTestRoutes } from './routes/student-tests';
import { studentResultRoutes } from './routes/student-results';
import { leaderboardRoutes } from './routes/leaderboards';
import { questionRoutes } from './routes/questions';
import { testsRoutes } from './routes/tests';
import { releaseRoutes } from './routes/release';
import { resultsRoutes } from './routes/results';
import { exportRoutes } from './routes/exports';
import { testApprovalRoutes } from './routes/test-approval';
import { examPreviewRoutes } from './routes/exam-preview';
import { whitelistRoutes } from './routes/whitelist';
import { sessionRoutes } from './routes/session';
import { auditWriter } from './services/audit';
import { accountStatusService } from './services/account-status';
import { eligibilityService } from './services/eligibility';
import { entitlementsService } from './services/entitlements';
import { logoStore } from './services/logos';
import { publishedTestCache } from './services/published-tests';
import { questionImageStore } from './services/question-images';
import { testApiEnabled, testOnlyRoutes } from './routes/test-only';

/** A Fastify instance with the API's conventions: Zod schemas, error shape, server time, CORS, logging. */
export async function createServer(
  config: Config,
  clock: Clock,
  logger?: Logger,
  opts: { idempotency?: IdempotencyData } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: (logger ?? createLogger(config.logLevel)) as FastifyBaseLogger,
    disableRequestLogging: true,
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
    // One hop: the Google front end (load balancer) appends the client address; anything earlier is client-supplied.
    trustProxy: (_address: string, hop: number) => hop < 1,
    bodyLimit: 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerRouteTable(app);
  registerErrorHandling(app);
  registerServerTime(app, clock);
  registerRequestLog(app);
  // Before compression: the stored replay is the JSON body itself (API-02). Its key check runs at route level, after
  // registerAuth's sign-in, status and feature preHandlers, so a refused caller gets no replay (AUTH-06).
  if (opts.idempotency) registerIdempotency(app, { store: opts.idempotency, clock });
  // CORS only for the app's own origins (SEC-05). X-Server-Time must be readable by the browser (API-03).
  await app.register(cors, {
    origin: config.appOrigins,
    credentials: false,
    exposedHeaders: ['X-Server-Time', 'X-Request-Id'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Org-Id', 'X-Request-Id'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(compress, { threshold: 1024 });
  // Per-user limits on routes that opt in with config.rateLimit (API-06); registered before any route.
  await registerRateLimit(app);
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
  });
  return app;
}

export async function buildApp(deps: Deps, logger?: Logger): Promise<FastifyInstance> {
  const data = createData(deps.firebase.db);
  const app = await createServer(deps.config, deps.clock, logger, { idempotency: data.idempotency });
  const entitlements = entitlementsService(data, deps.clock);
  const status = accountStatusService(data, deps.clock);
  registerAuth(app, { auth: deps.firebase.auth, data, entitlements, status });
  await app.register(healthRoutes);
  await app.register(sessionRoutes({ ...deps, data, entitlements }));
  const questionImages = questionImageStore(deps.firebase);
  const ctx: ApiContext = {
    ...deps,
    data,
    audit: auditWriter(data, deps.clock),
    eligibility: eligibilityService(data),
    entitlements,
    status,
    logos: logoStore(deps.firebase),
    questionImages,
    published: publishedTestCache(data, questionImages, deps.clock),
  };
  await app.register(orgRoutes(ctx));
  for (const routes of [
    platformRoutes,
    departmentRoutes,
    whitelistRoutes,
    studentRoutes,
    seriesRoutes,
    testsRoutes,
    testApprovalRoutes,
    releaseRoutes,
    resultsRoutes,
    exportRoutes,
    questionRoutes,
    examPreviewRoutes,
    studentTestRoutes,
    studentResultRoutes,
    leaderboardRoutes,
    attemptRoutes,
    pairingRoutes,
    auditRoutes,
    meRoutes,
  ])
    await app.register(routes(ctx));
  // Test-only API: never registered outside NODE_ENV=test with a TEST_API_SECRET.
  if (testApiEnabled(deps)) {
    const clearCaches = () => {
      entitlements.invalidateAll();
      status.invalidate();
      ctx.published.clear();
    };
    await app.register(testOnlyRoutes({ ...deps, clearCaches }));
  }
  return app;
}
