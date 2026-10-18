import {
  createdIdSchema,
  dayLabels,
  FULL_REVIEW_BEFORE_CLOSE_MESSAGE,
  resolveSettings,
  settingsProblems,
  testCreateSchema,
  testDetailSchema,
  testListQuerySchema,
  testListSchema,
  testPatchSchema,
  testStatusAt,
  type Test,
  type TestDetail,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SeriesRecord } from '../data/series';
import type { TestRecord, TestUpdate } from '../data/tests';
import { AppError, notFound } from '../errors';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** TST-01: a test's date lies within its series' dates. */
function refuseDateOutside(series: SeriesRecord, date: string): void {
  if (date < series.startDate || date > series.endDate)
    throw new AppError(
      400,
      'DATE_OUTSIDE_SERIES',
      `Choose a date from ${day(series.startDate)} to ${day(series.endDate)}, the series dates.`,
      { field: 'scheduledDate' },
    );
}

/** Tests of a series with their day labels and status (TST-01, TST-02, TST-04, TST-07, SER-03). */
export function testsRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock } = ctx;
  const db = ctx.firebase.db;
  const timezone = async (orgId: string) => (await data.orgs.getOrg(orgId))?.timezone ?? 'Asia/Kolkata';
  const settingsOf = (series: SeriesRecord, test: TestRecord, tz: string) =>
    test.resolved ?? resolveSettings({ series, test, timezone: tz });
  /** The test as shown: day label from the series' schedule order, status from the window and the Clock. */
  const view = (test: TestRecord, labels: Record<string, string | null>, series: SeriesRecord, tz: string): Test => ({
    ...test,
    dayLabel: labels[test.id] ?? null,
    status: testStatusAt(test.status, settingsOf(series, test, tz).window, clock.now()),
  });
  const series = async (orgId: string, seriesId: string) => {
    const s = await data.series.getSeries(orgId, seriesId);
    if (!s) throw notFound('Series');
    return s;
  };
  const detail = async (orgId: string, testId: string): Promise<TestDetail> => {
    const test = await data.tests.getTest(orgId, testId);
    if (!test) throw notFound('Test');
    const [s, tz, siblings] = await Promise.all([
      series(orgId, test.seriesId),
      timezone(orgId),
      data.tests.listTests(orgId, test.seriesId),
    ]);
    return { ...view(test, dayLabels(siblings), s, tz), effective: settingsOf(s, test, tz) };
  };

  return async (app) => {
    app.get(
      '/v1/tests',
      { config: admin, schema: { querystring: testListQuerySchema, response: { 200: testListSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const s = await series(orgId, req.query.seriesId);
        const [tests, tz] = await Promise.all([data.tests.listTests(orgId, s.id), timezone(orgId)]);
        const labels = dayLabels(tests);
        return { items: tests.map((t) => view(t, labels, s, tz)) };
      },
    );

    app.post(
      '/v1/tests',
      { config: admin, schema: { body: testCreateSchema, response: { 201: createdIdSchema } } },
      async (req, reply) => {
        const orgId = req.orgId!;
        const s = await series(orgId, req.body.seriesId);
        refuseDateOutside(s, req.body.scheduledDate);
        const input = { ...req.body, company: req.body.company || undefined, dayNumber: req.body.dayNumber || null };
        const batch = db.batch();
        const id = data.tests.createTest(orgId, batch, input, clock.now());
        audit(req, batch, { action: 'test.create', target: { type: 'test', id }, after: req.body });
        await batch.commit();
        return reply.status(201).send({ id });
      },
    );

    app.get(
      '/v1/tests/:id',
      { config: admin, schema: { params: idParams, response: { 200: testDetailSchema } } },
      async (req) => detail(req.orgId!, req.params.id),
    );

    app.patch(
      '/v1/tests/:id',
      { config: admin, schema: { params: idParams, body: testPatchSchema, response: { 200: testDetailSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const before = await data.tests.getTest(orgId, req.params.id);
        if (!before) throw notFound('Test');
        const s = await series(orgId, before.seriesId);
        const { overrides, sections, ...details } = req.body;
        if (details.scheduledDate) refuseDateOutside(s, details.scheduledDate);
        if (overrides) {
          const resolved = resolveSettings({
            series: s,
            test: { overrides, scheduledDate: details.scheduledDate ?? before.scheduledDate },
            timezone: await timezone(orgId),
          });
          if (settingsProblems(resolved).length)
            throw new AppError(400, 'FULL_REVIEW_BEFORE_CLOSE', FULL_REVIEW_BEFORE_CLOSE_MESSAGE, {
              field: 'resultRelease',
            });
        }
        const changes: TestUpdate = {
          ...details,
          ...('company' in details ? { company: details.company || null } : {}),
          ...('dayNumber' in details ? { dayNumber: details.dayNumber || null } : {}),
          ...(overrides ? { overrides } : {}),
          ...(sections
            ? {
                sections: sections.map((x, i) => ({ ...x, id: x.id ?? data.tests.newSectionId(orgId), order: i + 1 })),
              }
            : {}),
          updatedAt: clock.now(),
        };
        const batch = db.batch();
        data.tests.updateTest(orgId, batch, before.id, changes);
        const target = { type: 'test', id: before.id };
        if (overrides)
          audit(req, batch, { action: 'test.settings.update', target, before: before.overrides, after: overrides });
        const rest = Object.keys(req.body).filter((k) => k !== 'overrides') as Array<keyof TestRecord>;
        if (rest.length)
          audit(req, batch, {
            action: 'test.update',
            target,
            before: Object.fromEntries(rest.map((k) => [k, before[k] ?? null])),
            after: Object.fromEntries(rest.map((k) => [k, changes[k as keyof TestUpdate] ?? null])),
          });
        await batch.commit();
        return detail(orgId, before.id);
      },
    );
  };
}
