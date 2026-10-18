import {
  adminAddSchema,
  auditPageSchema,
  auditQuerySchema,
  entitlementsPutSchema,
  monthKey,
  orgAdminSchema,
  orgCreateSchema,
  orgPatchSchema,
  platformOrgDetailSchema,
  platformOrgSchema,
  usageSchema,
  type OrgUsage,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageItems } from '../data/page';
import type { OrgRecord } from '../data/orgs';
import { AppError, notFound } from '../errors';
import { ORG_ID } from '../plugins/auth';
import type { ApiContext } from './context';

const orgParams = z.object({ orgId: z.string().regex(ORG_ID) });
const sa = { access: 'superAdmin' as const };

/** Super-admin console: organizations, their admins, entitlements, usage and the cross-org audit log (spec 2). */
export function platformRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, entitlements, status } = ctx;
  const db = ctx.firebase.db;
  const usageOf = async (org: OrgRecord): Promise<OrgUsage> => {
    const month = monthKey(clock.now(), org.timezone);
    const [students, admins, usage] = await Promise.all([
      data.usage.countStudents(org.id),
      data.usage.countActiveAdmins(org.id),
      data.usage.getUsage(org.id, month),
    ]);
    return {
      month,
      students,
      admins,
      testsRun: usage.testsRun,
      aiImports: usage.aiImports,
      aiReports: usage.aiReports,
      storageBytes: usage.storageBytes,
    };
  };
  const summary = async (org: OrgRecord) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    timezone: org.timezone,
    status: org.status,
    logoPath: org.logoPath,
    createdAt: org.createdAt,
    usage: await usageOf(org),
    entitlements: (await entitlements.get(org.id))!,
  });
  const detail = async (orgId: string) => {
    const org = await data.orgs.getOrgRecord(orgId);
    if (!org) throw notFound('Organization');
    const [admins, departments] = await Promise.all([
      data.admins.listAdmins(orgId),
      data.departments.listDepartments(orgId),
    ]);
    return {
      ...(await summary(org)),
      admins: admins.map(({ uid: _uid, ...a }) => a),
      departments: departments.map(({ id, name, status: s }) => ({ id, name, status: s })),
      featureOverrides: org.featureOverrides,
      limitOverrides: org.limitOverrides,
      planId: org.planId,
    };
  };

  return async (app) => {
    app.get(
      '/v1/platform/orgs',
      { config: sa, schema: { response: { 200: z.object({ items: z.array(platformOrgSchema) }) } } },
      async () => ({
        items: await Promise.all((await data.platform.listOrgs()).map(summary)),
      }),
    );

    // ORG-06: name, unique slug, timezone, logo and departments.
    app.post(
      '/v1/platform/orgs',
      { config: sa, schema: { body: orgCreateSchema, response: { 201: platformOrgDetailSchema } } },
      async (req, reply) => {
        const body = req.body;
        const orgId = `org-${body.slug}`;
        if ((await data.platform.slugTaken(body.slug)) || (await data.platform.orgExists(orgId))) {
          throw new AppError(
            409,
            'SLUG_TAKEN',
            'Another organization already uses this slug. Choose a different one.',
            { field: 'slug' },
          );
        }
        const batch = db.batch();
        data.orgs.createOrg(orgId, batch, {
          name: body.name,
          slug: body.slug,
          timezone: body.timezone,
          logoPath: body.logoPath ?? null,
          createdAt: clock.now(),
        });
        const unique = [...new Map(body.departments.map((d) => [d.toLowerCase(), d])).values()];
        for (const name of unique) data.departments.createDepartment(orgId, batch, name);
        audit(
          req,
          batch,
          {
            action: 'org.create',
            target: { type: 'organization', id: orgId },
            after: { ...body, departments: unique },
          },
          orgId,
        );
        await batch.commit().catch((e: { code?: number }) => {
          if (e.code === 6)
            throw new AppError(
              409,
              'SLUG_TAKEN',
              'Another organization already uses this slug. Choose a different one.',
              { field: 'slug' },
            );
          throw e;
        });
        return reply.status(201).send(await detail(orgId));
      },
    );

    app.get(
      '/v1/platform/orgs/:orgId',
      { config: sa, schema: { params: orgParams, response: { 200: platformOrgDetailSchema } } },
      async (req) => detail(req.params.orgId),
    );

    // ORG-07: suspend, archive and restore are reversible and audit-logged.
    app.patch(
      '/v1/platform/orgs/:orgId',
      { config: sa, schema: { params: orgParams, body: orgPatchSchema, response: { 200: platformOrgDetailSchema } } },
      async (req) => {
        const { orgId } = req.params;
        const before = await data.orgs.getOrgRecord(orgId);
        if (!before) throw notFound('Organization');
        if (before.status === 'archived' && (req.body.name || req.body.timezone) && req.body.status !== 'active') {
          throw new AppError(
            409,
            'ORG_ARCHIVED',
            'This organization is archived and read-only. Restore it to make changes.',
          );
        }
        const batch = db.batch();
        data.orgs.updateOrg(orgId, batch, req.body);
        const changed = Object.fromEntries(Object.keys(req.body).map((k) => [k, before[k as keyof typeof before]]));
        const action =
          req.body.status && req.body.status !== before.status
            ? `org.status.${req.body.status === 'active' ? 'restore' : req.body.status}`
            : 'org.update';
        audit(
          req,
          batch,
          { action, target: { type: 'organization', id: orgId }, before: changed, after: req.body },
          orgId,
        );
        await batch.commit();
        status.invalidate();
        return detail(orgId);
      },
    );

    // ORG-08: an admin added by email gets access at their next sign-in.
    app.post(
      '/v1/platform/orgs/:orgId/admins',
      { config: sa, schema: { params: orgParams, body: adminAddSchema, response: { 201: orgAdminSchema } } },
      async (req, reply) => {
        const { orgId } = req.params;
        const org = await data.orgs.getOrgRecord(orgId);
        if (!org) throw notFound('Organization');
        if (org.status === 'archived')
          throw new AppError(
            409,
            'ORG_ARCHIVED',
            'This organization is archived and read-only. Restore it to make changes.',
          );
        if (await data.admins.findActiveAdminByEmail(orgId, req.body.email)) {
          throw new AppError(409, 'ADMIN_EXISTS', 'This email is already an admin of the organization.', {
            field: 'email',
          });
        }
        const limit = (await entitlements.get(orgId))!.limits.max_admins;
        if ((await data.usage.countActiveAdmins(orgId)) >= limit) {
          throw new AppError(403, 'LIMIT_REACHED', `This organization already has its maximum of ${limit} admins.`, {
            limit: 'max_admins',
            value: limit,
          });
        }
        const batch = db.batch();
        const adminId = data.admins.addAdmin(orgId, batch, {
          email: req.body.email,
          ...(req.body.name ? { name: req.body.name } : {}),
          addedBy: req.user!.uid,
          addedAt: clock.now(),
        });
        audit(req, batch, { action: 'admin.add', target: { type: 'admin', id: adminId }, after: req.body }, orgId);
        await batch.commit();
        const { uid: _uid, ...admin } = (await data.admins.getAdmin(orgId, adminId))!;
        return reply.status(201).send(admin);
      },
    );

    // US-SA-02: a removed admin loses access at once (tokens revoked, status cache cleared).
    app.delete(
      '/v1/platform/orgs/:orgId/admins/:adminId',
      {
        config: sa,
        schema: {
          params: orgParams.extend({ adminId: z.string().min(1) }),
          response: { 200: z.object({ removed: z.literal(true) }) },
        },
      },
      async (req) => {
        const { orgId, adminId } = req.params;
        const admin = await data.admins.getAdmin(orgId, adminId);
        if (!admin || admin.status !== 'active') throw notFound('Admin');
        const batch = db.batch();
        data.admins.removeAdmin(orgId, batch, adminId);
        audit(
          req,
          batch,
          {
            action: 'admin.remove',
            target: { type: 'admin', id: adminId },
            before: { email: admin.email, status: 'active' },
            after: { status: 'removed' },
          },
          orgId,
        );
        await batch.commit();
        if (admin.uid) {
          await ctx.firebase.auth.revokeRefreshTokens(admin.uid);
          await ctx.firebase.auth.setCustomUserClaims(admin.uid, null);
        }
        status.invalidate();
        return { removed: true as const };
      },
    );

    // FF-05, US-SA-03: flags and limits per org, audit-logged with before and after.
    app.put(
      '/v1/platform/orgs/:orgId/entitlements',
      {
        config: sa,
        schema: { params: orgParams, body: entitlementsPutSchema, response: { 200: platformOrgDetailSchema } },
      },
      async (req) => {
        const { orgId } = req.params;
        const org = await data.orgs.getOrgRecord(orgId);
        if (!org) throw notFound('Organization');
        const batch = db.batch();
        data.orgs.setEntitlements(orgId, batch, req.body);
        audit(
          req,
          batch,
          {
            action: 'org.entitlements.update',
            target: { type: 'organization', id: orgId },
            before: { featureOverrides: org.featureOverrides, limitOverrides: org.limitOverrides },
            after: req.body,
          },
          orgId,
        );
        await batch.commit();
        entitlements.invalidate(orgId);
        return detail(orgId);
      },
    );

    app.get(
      '/v1/platform/orgs/:orgId/usage',
      { config: sa, schema: { params: orgParams, response: { 200: usageSchema } } },
      async (req) => {
        const org = await data.orgs.getOrgRecord(req.params.orgId);
        if (!org) throw notFound('Organization');
        return usageOf(org);
      },
    );

    // US-SA-06: audit across organizations, filtered by organization, actor, action and date.
    app.get(
      '/v1/platform/audit',
      { config: sa, schema: { querystring: auditQuerySchema, response: { 200: auditPageSchema } } },
      async (req) => {
        const { cursor, limit, ...filter } = req.query;
        return pageItems(await data.platform.listAuditAcrossOrgs(filter), cursor, limit);
      },
    );
  };
}
