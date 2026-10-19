import {
  dayLabels,
  docIdSchema,
  monthKey,
  pageOf,
  pageQuerySchema,
  REPORT_CONTENT_TYPES,
  REPORT_MESSAGES,
  reportCreatedSchema,
  reportFilename,
  reportListItemSchema,
  reportRequestSchema,
  reportTask,
  reportUsageSchema,
  reportViewSchema,
  testBoardTitle,
  type ReportListItem,
  type ReportScope,
  type ReportView,
} from '@mitaoe/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageItems } from '../data/page';
import type { ReportRecord } from '../data/reports';
import { AppError, notFound } from '../errors';
import { ORG_ID } from '../plugins/auth';
import { reportLinks } from '../services/report-links';
import type { ApiContext } from './context';
import { originOf } from './exports';

const reporting = { access: 'admin' as const, feature: 'analytics_reports' as const };
const idParams = z.object({ id: docIdSchema });
const fileParams = z.object({ id: docIdSchema, kind: z.enum(['pdf', 'xlsx']) });
const linkQuery = z.object({
  org: z.string().regex(ORG_ID),
  expires: z.coerce.number().int(),
  sig: z.string().max(128),
});

/**
 * Analytics reports (US-AD-15, EXP-05 to EXP-07; docs/testids/phase-7.md). `POST /v1/reports` checks the test or
 * series, its finished attempts and the month's allowance, then stores the queued report, its count and its
 * `report.create` audit entry in one transaction and queues `/tasks/report`. `GET /v1/reports/{id}` and the list show
 * the worker's progress and, once ready, fresh 15-minute signed links; following one (`/files/{kind}`, no sign-in)
 * downloads the file from Storage. Every route needs `analytics_reports` (FF-02), past reports included.
 */
export function reportRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, queue, entitlements } = ctx;
  const secret = ctx.config.exportLinkSecret;
  const signer = secret ? reportLinks(secret, clock) : null;
  /** Production without EXPORT_LINK_SECRET has no shared key, so no file link is issued or followed. */
  const links = () => {
    if (!signer) throw new AppError(503, 'EXPORTS_UNAVAILABLE', 'Report files are not available right now.');
    return signer;
  };

  /**
   * A published test or a published (not draft) series of the organization, as its title of the moment and the
   * published tests whose attempts count; anything else, another org's included, is 404 (ORG-05).
   */
  async function target(orgId: string, scope: ReportScope, refId: string) {
    if (scope === 'test') {
      const test = await data.tests.getTest(orgId, refId);
      if (!test?.resolved) throw notFound('Test');
      const labels = dayLabels(await data.tests.listTests(orgId, test.seriesId));
      return { title: testBoardTitle(test.title, labels[test.id] ?? null), testIds: [test.id] };
    }
    const series = await data.series.getSeries(orgId, refId);
    if (!series || series.status === 'draft') throw notFound('Series');
    const tests = await data.tests.listTests(orgId, series.id);
    return { title: series.title, testIds: tests.filter((t) => t.resolved).map((t) => t.id) };
  }

  /** The requester's name on the report: their admin name in the org, or their email (always, for a super admin). */
  async function requesterName(req: FastifyRequest, orgId: string): Promise<string> {
    const user = req.user!;
    if (user.role !== 'admin') return user.email;
    const record =
      (await data.admins.findAdminByUid(orgId, user.uid)) ??
      (await data.admins.findActiveAdminByEmail(orgId, user.email));
    return record?.name || user.email;
  }

  function listItem(req: FastifyRequest, rec: ReportRecord): ReportListItem {
    const item: ReportListItem = {
      id: rec.id,
      scope: rec.scope,
      refId: rec.refId,
      title: rec.title,
      status: rec.status,
      includeXlsx: rec.includeXlsx,
      createdAt: rec.createdAt,
      createdBy: { uid: rec.createdBy, name: rec.createdByName },
      ...(rec.error ? { error: rec.error } : {}),
      ...(typeof rec.retryAt === 'number' ? { retryAt: rec.retryAt } : {}),
    };
    if (rec.status !== 'ready') return item;
    const link = links();
    return {
      ...item,
      ...(rec.summaryStatus ? { summaryStatus: rec.summaryStatus } : {}),
      ...(rec.provider ? { provider: rec.provider } : {}),
      ...(rec.model ? { model: rec.model } : {}),
      pdf: link.issue(originOf(req), rec.orgId, rec.id, 'pdf'),
      ...(rec.xlsxPath ? { xlsx: link.issue(originOf(req), rec.orgId, rec.id, 'xlsx') } : {}),
    };
  }

  function view(req: FastifyRequest, rec: ReportRecord): ReportView {
    const item = listItem(req, rec);
    if (rec.status !== 'ready') return item;
    return {
      ...item,
      ...(rec.metrics ? { metrics: rec.metrics } : {}),
      summary: rec.summary ?? null,
      recommendations: rec.recommendations ?? [],
    };
  }

  return async (app) => {
    app.post(
      '/v1/reports',
      {
        config: { ...reporting, idempotent: true },
        schema: { body: reportRequestSchema, response: { 202: reportCreatedSchema } },
      },
      async (req, reply) => {
        const orgId = req.orgId!;
        const { scope, refId } = req.body;
        const includeXlsx = req.body.includeXlsx ?? false;
        const { title, testIds } = await target(orgId, scope, refId);
        if (!(await data.reports.hasFinishedAttempt(orgId, testIds)))
          throw new AppError(409, 'NO_FINISHED_ATTEMPTS', REPORT_MESSAGES.noFinishedAttempts(scope));
        const e = await entitlements.get(orgId);
        if (!e) throw notFound('Organization');
        const max = e.limits.ai_reports_per_month;
        const id = data.reports.newReportId(orgId);
        const now = clock.now();
        const created = await data.reports.createReport(
          orgId,
          {
            id,
            scope,
            refId,
            title,
            includeXlsx,
            createdBy: req.user!.uid,
            createdByName: await requesterName(req, orgId),
            createdAt: now,
          },
          { month: monthKey(now, e.timezone), limit: max },
          (tx) =>
            audit(req, tx, {
              action: 'report.create',
              target: { type: 'report', id },
              after: { scope, refId, includeXlsx },
            }),
        );
        if (created === 'limit')
          throw new AppError(409, 'LIMIT_REACHED', REPORT_MESSAGES.limitReached(max), {
            limit: 'ai_reports_per_month',
            max,
          });
        await queue.enqueue(reportTask(orgId, id));
        return reply.status(202).send({ id, status: 'queued' as const });
      },
    );

    app.get(
      '/v1/reports',
      { config: reporting, schema: { querystring: pageQuerySchema, response: { 200: pageOf(reportListItemSchema) } } },
      async (req) => {
        const { cursor, limit } = req.query;
        const page = pageItems(await data.reports.listReports(req.orgId!), cursor, limit);
        return { items: page.items.map((r) => listItem(req, r)), nextCursor: page.nextCursor };
      },
    );

    // EXP-07, FF-04: the month's count against the effective limit, in the organization's timezone on the Clock.
    app.get(
      '/v1/reports/usage',
      { config: reporting, schema: { response: { 200: reportUsageSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const e = await entitlements.get(orgId);
        if (!e) throw notFound('Organization');
        const month = monthKey(clock.now(), e.timezone);
        const { aiReports } = await data.usage.getUsage(orgId, month);
        return { month, used: aiReports, limit: e.limits.ai_reports_per_month };
      },
    );

    app.get(
      '/v1/reports/:id',
      { config: reporting, schema: { params: idParams, response: { 200: reportViewSchema } } },
      async (req) => {
        const rec = await data.reports.getReport(req.orgId!, req.params.id);
        if (!rec) throw notFound('Report');
        return view(req, rec);
      },
    );

    app.get(
      '/v1/reports/:id/files/:kind',
      {
        config: { access: 'public' as const },
        schema: { params: fileParams, querystring: linkQuery, response: { 200: z.custom<Buffer>() } },
      },
      async (req, reply) => {
        const { id, kind } = req.params;
        const verdict = links().verify(id, kind, req.query);
        if (verdict === 'expired')
          throw new AppError(403, 'LINK_EXPIRED', 'This download link has expired. Open the report again.');
        if (verdict !== 'ok') throw new AppError(403, 'LINK_INVALID', 'This download link is not valid.');
        const orgId = req.query.org;
        await entitlements.requireFeature(orgId, 'analytics_reports');
        const rec = await data.reports.getReport(orgId, id);
        const path = kind === 'pdf' ? rec?.pdfPath : rec?.xlsxPath;
        if (rec?.status !== 'ready' || !path) throw notFound('Report');
        const [body] = await ctx.firebase.bucket
          .file(path)
          .download()
          .catch(() => [null]);
        if (!body) throw notFound('Report file');
        return reply
          .header('content-type', REPORT_CONTENT_TYPES[kind])
          .header('content-disposition', `attachment; filename="${reportFilename(id, kind)}"`)
          .header('cache-control', 'private, no-store')
          .send(body);
      },
    );
  };
}
