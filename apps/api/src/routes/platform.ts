import {
  adminAddSchema,
  auditPageSchema,
  auditQuerySchema,
  clearStorageRequestSchema,
  clearStorageResponseSchema,
  entitlementsPutSchema,
  monthKey,
  orgAdminSchema,
  orgCreateSchema,
  orgPatchSchema,
  orgStorageSummarySchema,
  platformOrgDetailSchema,
  platformOrgSchema,
  usageSchema,
  type OrgStorageFile,
  type OrgStorageSummary,
  type OrgUsage,
  type StorageCategory,
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

// DECISIONS Q9 refinement: an archived organization is read-only, except for restoring it.
function refuseArchived(org: { status: string }): void {
  if (org.status === 'archived')
    throw new AppError(409, 'ORG_ARCHIVED', 'This organization is archived and read-only. Restore it to make changes.');
}

function categorizeStoragePath(name: string): StorageCategory {
  if (name.includes('/imports/')) return 'imports';
  if (name.includes('/exports/')) return 'exports';
  if (name.includes('/reports/')) return 'reports';
  if (name.includes('/questions/')) return 'questions';
  if (name.includes('/logo.') || name.includes('/logos/')) return 'logos';
  return 'other';
}

async function listOrgStorage(
  bucket: ApiContext['firebase']['bucket'],
  orgId: string,
): Promise<{ files: OrgStorageFile[]; summary: OrgStorageSummary }> {
  const [filesWithOrgPrefix] = await bucket.getFiles({ prefix: `organizations/${orgId}/` }).catch(() => [[]]);
  const [filesWithoutOrgPrefix] = await bucket.getFiles({ prefix: `${orgId}/` }).catch(() => [[]]);

  const map = new Map<string, OrgStorageFile>();
  const categories: Record<string, { count: number; bytes: number }> = {
    imports: { count: 0, bytes: 0 },
    exports: { count: 0, bytes: 0 },
    reports: { count: 0, bytes: 0 },
    questions: { count: 0, bytes: 0 },
    logos: { count: 0, bytes: 0 },
    other: { count: 0, bytes: 0 },
  };

  let totalBytes = 0;
  let totalFiles = 0;

  for (const f of [...filesWithOrgPrefix, ...filesWithoutOrgPrefix]) {
    if (map.has(f.name)) continue;
    const size = Number(f.metadata?.size ?? 0) || 0;
    const updated = f.metadata?.updated ?? new Date().toISOString();
    const contentType = f.metadata?.contentType;
    const category = categorizeStoragePath(f.name);
    const shortName = f.name.replace(/^organizations\/[^/]+\//, '').replace(new RegExp(`^${orgId}/`), '');

    const record: OrgStorageFile = {
      name: shortName || f.name,
      path: f.name,
      size,
      updated,
      contentType,
      category,
    };
    map.set(f.name, record);

    const cat = categories[category] ?? (categories[category] = { count: 0, bytes: 0 });
    cat.count += 1;
    cat.bytes += size;
    totalBytes += size;
    totalFiles += 1;
  }

  const allFiles = Array.from(map.values()).sort(
    (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime(),
  );

  return {
    files: allFiles,
    summary: {
      orgId,
      totalBytes,
      totalFiles,
      categories,
      recentFiles: allFiles.slice(0, 100),
    },
  };
}

/** Super-admin console: organizations, their admins, entitlements, usage and the cross-org audit log (spec 2). */
export function platformRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, entitlements, status, logos } = ctx;
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
    logoUrl: await logos.dataUrl(org.logoPath),
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
            'This slug is already used by another organization. Choose a different one.',
            { field: 'slug' },
          );
        }
        const logoPath = body.logo ? await logos.save(orgId, body.logo) : null;
        const batch = db.batch();
        data.orgs.createOrg(orgId, batch, {
          name: body.name,
          slug: body.slug,
          timezone: body.timezone,
          logoPath,
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
            after: { name: body.name, slug: body.slug, timezone: body.timezone, logoPath, departments: unique },
          },
          orgId,
        );
        await batch.commit().catch((e: { code?: number }) => {
          if (e.code === 6)
            throw new AppError(
              409,
              'SLUG_TAKEN',
              'This slug is already used by another organization. Choose a different one.',
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
        if (
          before.status === 'archived' &&
          (req.body.name || req.body.timezone || req.body.logo) &&
          req.body.status !== 'active'
        ) {
          throw new AppError(
            409,
            'ORG_ARCHIVED',
            'This organization is archived and read-only. Restore it to make changes.',
          );
        }
        const { logo, ...fields } = req.body;
        const logoPath = logo ? await logos.save(orgId, logo) : undefined;
        const batch = db.batch();
        data.orgs.updateOrg(orgId, batch, { ...fields, ...(logoPath ? { logoPath } : {}) });
        const changed = Object.fromEntries(Object.keys(fields).map((k) => [k, before[k as keyof typeof before]]));
        const action =
          req.body.status && req.body.status !== before.status
            ? `org.${req.body.status === 'active' ? 'restore' : req.body.status === 'suspended' ? 'suspend' : 'archive'}`
            : 'org.update';
        audit(
          req,
          batch,
          {
            action,
            target: { type: 'organization', id: orgId },
            before: changed,
            after: { ...fields, ...(logoPath ? { logoPath } : {}) },
          },
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
        refuseArchived(org);
        if (await data.admins.findActiveAdminByEmail(orgId, req.body.email)) {
          throw new AppError(409, 'ADMIN_EXISTS', 'This email is already an admin of this organization.', {
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
        audit(req, batch, { action: 'org.admin.add', target: { type: 'admin', id: adminId }, after: req.body }, orgId);
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
        const org = await data.orgs.getOrgRecord(orgId);
        if (!org) throw notFound('Organization');
        refuseArchived(org);
        const admin = await data.admins.getAdmin(orgId, adminId);
        if (!admin || admin.status !== 'active') throw notFound('Admin');
        const batch = db.batch();
        data.admins.removeAdmin(orgId, batch, adminId);
        audit(
          req,
          batch,
          {
            action: 'org.admin.remove',
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
        refuseArchived(org);
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

    // Super-admin only: view object storage files & breakdown for an organization
    app.get(
      '/v1/platform/orgs/:orgId/storage',
      { config: sa, schema: { params: orgParams, response: { 200: orgStorageSummarySchema } } },
      async (req) => {
        const { orgId } = req.params;
        const org = await data.orgs.getOrgRecord(orgId);
        if (!org) throw notFound('Organization');
        const { summary } = await listOrgStorage(ctx.firebase.bucket, orgId);
        return summary;
      },
    );

    // Super-admin only: clear storage files for an organization (all junk or by category)
    app.post(
      '/v1/platform/orgs/:orgId/storage/clear',
      {
        config: sa,
        schema: {
          params: orgParams,
          body: clearStorageRequestSchema,
          response: { 200: clearStorageResponseSchema },
        },
      },
      async (req) => {
        const { orgId } = req.params;
        const org = await data.orgs.getOrgRecord(orgId);
        if (!org) throw notFound('Organization');

        const { category } = req.body;
        const { files, summary } = await listOrgStorage(ctx.firebase.bucket, orgId);

        // Safety rule: 'all' clears everything except organization logo to protect branding
        const filesToDelete =
          category === 'all'
            ? files.filter((f) => f.category !== 'logos')
            : files.filter((f) => f.category === category);

        let deletedCount = 0;
        let deletedBytes = 0;

        for (let i = 0; i < filesToDelete.length; i += 25) {
          const chunk = filesToDelete.slice(i, i + 25);
          await Promise.all(
            chunk.map(async (f) => {
              try {
                await ctx.firebase.bucket.file(f.path).delete({ ignoreNotFound: true });
                deletedCount += 1;
                deletedBytes += f.size;
              } catch (err) {
                req.log.warn({ err, path: f.path }, 'platform.storage_delete_failed');
              }
            }),
          );
        }

        const remainingBytes = Math.max(0, summary.totalBytes - deletedBytes);
        const remainingFiles = Math.max(0, summary.totalFiles - deletedCount);

        // Sync remaining storage bytes in usage records
        const month = monthKey(clock.now(), org.timezone);
        await data.usage.setStorageBytes(orgId, month, remainingBytes);

        // Audit log the storage purge
        const batch = db.batch();
        audit(
          req,
          batch,
          {
            action: 'org.storage.clear',
            target: { type: 'organization', id: orgId },
            after: { category, deletedCount, deletedBytes, remainingBytes, remainingFiles },
          },
          orgId,
        );
        await batch.commit();

        return {
          deletedCount,
          deletedBytes,
          category,
          remainingBytes,
          remainingFiles,
        };
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
