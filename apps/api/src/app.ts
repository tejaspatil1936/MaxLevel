import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Deps } from './deps';
import { registerErrorHandling } from './plugins/errors';
import { registerServerTime } from './plugins/server-time';
import { healthRoutes } from './routes/health';

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
  return app;
}
