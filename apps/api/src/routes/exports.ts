import {
  exportCreatedSchema,
  exportFilename,
  exportInfoSchema,
  exportRequestSchema,
  exportTask,
  type ExportInfo,
} from '@mitaoe/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../errors';
import { exportLinks } from '../services/export-links';
import type { ApiContext } from './context';

const exporting = { access: 'admin' as const, feature: 'results_export' as const, idempotent: true };
const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });

/** The API's own origin as the caller reached it, so download links are absolute (docs/testids/phase-4.md). */
export const originOf = (req: FastifyRequest) => `${req.protocol}://${req.host}`;

/**
 * Results exports (US-AD-14, EXP-01 to EXP-03). `POST /v1/exports` stores the export record and its `results.export`
 * audit entry in one batch and queues `/tasks/export`; it builds nothing itself. `GET /v1/exports/{id}` reports the
 * worker's progress and, once ready, a fresh signed link valid for 15 minutes.
 */
export function exportRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, queue } = ctx;
  const db = ctx.firebase.db;
  const links = exportLinks(ctx.config.exportLinkSecret, clock);

  /** A published test or a series of the organization; anything else, another org's included, is 404 (ORG-05). */
  async function assertTarget(orgId: string, scope: 'test' | 'series', refId: string) {
    if (scope === 'test') {
      if (!(await data.tests.getTest(orgId, refId))?.resolved) throw notFound('Test');
    } else if (!(await data.series.getSeries(orgId, refId))) throw notFound('Series');
  }

  return async (app) => {
    app.post(
      '/v1/exports',
      { config: exporting, schema: { body: exportRequestSchema, response: { 202: exportCreatedSchema } } },
      async (req, reply) => {
        const orgId = req.orgId!;
        const { scope, refId, format } = req.body;
        await assertTarget(orgId, scope, refId);
        const id = data.exports.newExportId(orgId);
        const filename = exportFilename(scope, refId, format);
        const batch = db.batch();
        data.exports.addExport(orgId, batch, {
          id,
          scope,
          refId,
          format,
          status: 'queued',
          filePath: `organizations/${orgId}/exports/${id}/${filename}`,
          filename,
          createdBy: req.user!.uid,
          createdAt: clock.now(),
        });
        audit(req, batch, {
          action: 'results.export',
          target: { type: scope, id: refId },
          after: { format, exportId: id },
        });
        await batch.commit();
        await queue.enqueue(exportTask(orgId, id));
        return reply.status(202).send({ id, status: 'queued' as const });
      },
    );

    app.get(
      '/v1/exports/:id',
      { config: admin, schema: { params: idParams, response: { 200: exportInfoSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const rec = await data.exports.getExport(orgId, req.params.id);
        if (!rec) throw notFound('Export');
        const info: ExportInfo = {
          id: rec.id,
          scope: rec.scope,
          refId: rec.refId,
          format: rec.format,
          status: rec.status,
          filename: rec.filename,
        };
        return rec.status === 'ready' ? { ...info, ...links.issue(originOf(req), orgId, rec.id) } : info;
      },
    );
  };
}
