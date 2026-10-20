import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError } from '../errors';

/** One error shape for every failure (API-01). */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: 'The request is not valid.',
          details: { issues: err.validation.map((v) => ({ path: v.instancePath, message: v.message })) },
        },
      });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, 'response did not match its schema');
      return reply
        .status(500)
        .send({ error: { code: 'INTERNAL', message: 'Something failed on our side.', details: {} } });
    }
    const status =
      typeof (err as { statusCode?: number }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    const code =
      status === 429 ? 'RATE_LIMITED' : status === 404 ? 'NOT_FOUND' : status >= 500 ? 'INTERNAL' : 'VALIDATION';
    const message = status >= 500 ? 'Something failed on our side.' : (err as Error).message;
    return reply.status(status).send({ error: { code, message, details: {} } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.url}.`, details: {} } }),
  );
}
