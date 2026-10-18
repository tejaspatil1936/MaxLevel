import {
  createdIdSchema,
  eligibilityPreviewRequestSchema,
  eligibilityPreviewResponseSchema,
  FULL_REVIEW_BEFORE_CLOSE_MESSAGE,
  pageOf,
  pageQuerySchema,
  seriesCreateSchema,
  seriesPatchSchema,
  seriesSchema,
  resolveSettings,
  settingsProblems,
  type Series,
  type SeriesDefaults,
  type SeriesStatus,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageItems } from '../data/page';
import type { SeriesRecord } from '../data/series';
import { AppError, notFound } from '../errors';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });

/** SER-09: a flexible window with a full review released on submit would leak answers. */
function refuseLeakyDefaults(defaults: Partial<SeriesDefaults>): void {
  if (settingsProblems(defaults).length)
    throw new AppError(400, 'FULL_REVIEW_BEFORE_CLOSE', FULL_REVIEW_BEFORE_CLOSE_MESSAGE, { field: 'resultRelease' });
}

const STATUS_ACTION: Partial<Record<SeriesStatus, string>> = { active: 'series.activate', archived: 'series.archive' };

/** Series with default settings and eligibility (SER-01, SER-02, SER-07, SER-09, US-AD-04). */
export function seriesRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, eligibility } = ctx;
  const db = ctx.firebase.db;
  const view = (s: SeriesRecord, testCount: number): Series => ({ ...s, testCount });
  const one = async (orgId: string, id: string): Promise<Series> => {
    const s = await data.series.getSeries(orgId, id);
    if (!s) throw notFound('Series');
    return view(s, (await data.series.countTestsBySeries(orgId)).get(id) ?? 0);
  };

  return async (app) => {
    app.get(
      '/v1/series',
      { config: admin, schema: { querystring: pageQuerySchema, response: { 200: pageOf(seriesSchema) } } },
      async (req) => {
        const orgId = req.orgId!;
        const [list, counts] = await Promise.all([
          data.series.listSeries(orgId),
          data.series.countTestsBySeries(orgId),
        ]);
        return pageItems(
          list.map((s) => view(s, counts.get(s.id) ?? 0)),
          req.query.cursor,
          req.query.limit,
        );
      },
    );

    app.post(
      '/v1/series',
      { config: admin, schema: { body: seriesCreateSchema, response: { 201: createdIdSchema } } },
      async (req, reply) => {
        const orgId = req.orgId!;
        refuseLeakyDefaults(req.body.defaults);
        const batch = db.batch();
        const id = data.series.createSeries(orgId, batch, req.body, clock.now());
        audit(req, batch, { action: 'series.create', target: { type: 'series', id }, after: req.body });
        await batch.commit();
        return reply.status(201).send({ id });
      },
    );

    app.get(
      '/v1/series/:id',
      { config: admin, schema: { params: idParams, response: { 200: seriesSchema } } },
      async (req) => one(req.orgId!, req.params.id),
    );

    app.patch(
      '/v1/series/:id',
      { config: admin, schema: { params: idParams, body: seriesPatchSchema, response: { 200: seriesSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const before = await data.series.getSeries(orgId, req.params.id);
        if (!before) throw notFound('Series');
        const patch = req.body;
        if ((patch.endDate ?? before.endDate) < (patch.startDate ?? before.startDate))
          throw new AppError(400, 'VALIDATION', "The end date can't be before the start date.", { field: 'endDate' });
        if (patch.defaults) refuseLeakyDefaults(patch.defaults);
        // SER-09: new defaults or a new daily window must not put any of the series' tests into the leaky combination.
        if (patch.defaults || patch.dailyWindow) {
          const [tests, org] = await Promise.all([data.tests.listTests(orgId, before.id), data.orgs.getOrg(orgId)]);
          const series = {
            defaults: patch.defaults ?? before.defaults,
            dailyWindow: patch.dailyWindow ?? before.dailyWindow,
          };
          for (const test of tests) {
            const resolved = resolveSettings({ series, test, timezone: org?.timezone ?? 'Asia/Kolkata' });
            refuseLeakyDefaults(resolved);
          }
        }
        const batch = db.batch();
        data.series.updateSeries(orgId, batch, before.id, { ...patch, updatedAt: clock.now() });
        const statusChange = patch.status !== undefined && patch.status !== before.status;
        audit(req, batch, {
          action: (statusChange && STATUS_ACTION[patch.status!]) || 'series.update',
          target: { type: 'series', id: before.id },
          before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof SeriesRecord] ?? null])),
          after: patch,
        });
        await batch.commit();
        return one(orgId, before.id);
      },
    );

    // SER-07: the live count and matching list while rules are edited; `new` is a series not saved yet.
    app.post(
      '/v1/series/:id/eligibility/preview',
      {
        config: admin,
        schema: {
          params: idParams,
          body: eligibilityPreviewRequestSchema,
          response: { 200: eligibilityPreviewResponseSchema },
        },
      },
      async (req) => {
        const orgId = req.orgId!;
        if (req.params.id !== 'new' && !(await data.series.getSeries(orgId, req.params.id))) throw notFound('Series');
        const students = await eligibility.matchingStudents(orgId, req.body.eligibility);
        return { count: students.length, students };
      },
    );
  };
}
