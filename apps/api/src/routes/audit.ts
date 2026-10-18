import { auditPageSchema, auditQuerySchema } from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { pageItems } from '../data/page';
import type { ApiContext } from './context';

/** The organization's audit log for its admins and super admins in its workspace (AUD-03). Read-only (AUD-04). */
export function auditRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/v1/audit',
      {
        config: { access: 'admin' },
        schema: { querystring: auditQuerySchema.omit({ orgId: true }), response: { 200: auditPageSchema } },
      },
      async (req) => {
        const { cursor, limit, ...filter } = req.query;
        return pageItems(await ctx.data.audit.listAudit(req.orgId!, filter), cursor, limit);
      },
    );
  };
}
