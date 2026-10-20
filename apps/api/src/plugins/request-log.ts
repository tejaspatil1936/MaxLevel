import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Organization the request acts in, set by the org-context guard. */
    orgId?: string;
  }
}

/** One structured line per request with requestId, orgId, attemptId and route (OBS-01). */
export function registerRequestLog(app: FastifyInstance): void {
  app.addHook('onResponse', async (req, reply) => {
    const params = (req.params ?? {}) as Record<string, string | undefined>;
    const route = req.routeOptions.url ?? 'unmatched';
    req.log.info(
      {
        requestId: req.id,
        orgId: req.orgId ?? null,
        attemptId: route.includes('/attempts/') ? (params.id ?? null) : null,
        route,
        method: req.method,
        statusCode: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      'request',
    );
  });
}
