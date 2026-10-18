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
import { registerErrorHandling } from './plugins/errors';
import { registerRequestLog } from './plugins/request-log';
import { registerRouteTable } from './plugins/route-table';
import { registerServerTime } from './plugins/server-time';
import { createData } from './data';
import { registerAuth } from './plugins/auth';
import { healthRoutes } from './routes/health';
import { orgRoutes } from './routes/org';
import { sessionRoutes } from './routes/session';
import { auditWriter } from './services/audit';
import { accountStatusService } from './services/account-status';
import { entitlementsService } from './services/entitlements';
import { testApiEnabled, testOnlyRoutes } from './routes/test-only';

/** A Fastify instance with the API's conventions: Zod schemas, error shape, server time, CORS, logging. */
export async function createServer(config: Config, clock: Clock, logger?: Logger): Promise<FastifyInstance> {
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
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
  });
  return app;
}

export async function buildApp(deps: Deps, logger?: Logger): Promise<FastifyInstance> {
  const app = await createServer(deps.config, deps.clock, logger);
  const data = createData(deps.firebase.db);
  const entitlements = entitlementsService(data, deps.clock);
  const status = accountStatusService(data, deps.clock);
  registerAuth(app, { auth: deps.firebase.auth, data, entitlements, status });
  await app.register(healthRoutes);
  await app.register(sessionRoutes({ ...deps, data, entitlements }));
  await app.register(orgRoutes({ ...deps, data, audit: auditWriter(data, deps.clock) }));
  // Test-only API: never registered outside NODE_ENV=test with a TEST_API_SECRET.
  if (testApiEnabled(deps)) await app.register(testOnlyRoutes(deps));
  return app;
}
