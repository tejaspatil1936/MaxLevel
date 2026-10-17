import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Deps } from './deps';
import { registerErrorHandling } from './plugins/errors';
import { registerServerTime } from './plugins/server-time';
import { healthRoutes } from './routes/health';
import { testApiEnabled, testOnlyRoutes } from './routes/test-only';

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.logLevel },
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  registerServerTime(app, deps.clock);
  await app.register(healthRoutes);
  // Test-only API: never registered outside NODE_ENV=test with a TEST_API_SECRET.
  if (testApiEnabled(deps)) await app.register(testOnlyRoutes(deps));
  return app;
}
