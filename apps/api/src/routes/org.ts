import { orgDetailSchema, orgSettingsPatchSchema } from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Data } from '../data';
import type { Deps } from '../deps';
import { notFound } from '../errors';
import type { AuditWriter } from '../services/audit';

/** The organization an admin (or a super admin with X-Org-Id) works in. */
export function orgRoutes(deps: Deps & { data: Data; audit: AuditWriter }): FastifyPluginAsyncZod {
  const { data, audit } = deps;
  return async (app) => {
    app.get('/v1/org', { config: { access: 'admin' }, schema: { response: { 200: orgDetailSchema } } }, async (req) => {
      return (await data.orgs.getOrgDetail(req.orgId!)) ?? Promise.reject(notFound('Organization'));
    });

    app.patch(
      '/v1/org/settings',
      { config: { access: 'admin' }, schema: { body: orgSettingsPatchSchema, response: { 200: orgDetailSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const before = await data.orgs.getOrgDetail(orgId);
        if (!before) throw notFound('Organization');
        const batch = deps.firebase.db.batch();
        data.orgs.updateOrgSettings(orgId, batch, req.body);
        audit(req, batch, {
          action: 'org.settings.update',
          target: { type: 'organization', id: orgId },
          before: { profileLocked: before.profileLocked },
          after: { profileLocked: req.body.profileLocked ?? before.profileLocked },
        });
        await batch.commit();
        return (await data.orgs.getOrgDetail(orgId))!;
      },
    );
  };
}
