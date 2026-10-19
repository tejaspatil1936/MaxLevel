import {
  dayLabels,
  liveRosterSchema,
  liveTestListSchema,
  NO_RESTRICTION,
  testAttemptListSchema,
  testStatusAt,
  type LiveRoster,
  type LiveTestList,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { TestRecord } from '../data/tests';
import { notFound } from '../errors';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });
const collator = new Intl.Collator('en');

/**
 * The live exam dashboard's API reads (OPS-01, OPS-02, PERF-04). The live view loads its eligible roster once; every
 * status after that comes from its Realtime Database subscription to the API's live mirror, never from these routes.
 * A test of another organization, or one that is not published, is 404 (ORG-05).
 */
export function liveRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, clock, eligibility } = ctx;

  const publishedTest = async (orgId: string, testId: string) => {
    const test = await data.tests.getTest(orgId, testId);
    if (!test?.resolved || test.status !== 'scheduled') throw notFound('Test');
    return { ...test, resolved: test.resolved };
  };
  /** Series titles and day labels of the tests' series, each series read once. */
  async function seriesInfo(orgId: string, tests: TestRecord[]) {
    const ids = [...new Set(tests.map((t) => t.seriesId))];
    const [series, lists] = await Promise.all([
      Promise.all(ids.map((id) => data.series.getSeries(orgId, id))),
      Promise.all(ids.map((id) => data.tests.listTests(orgId, id))),
    ]);
    return {
      series: new Map(ids.map((id, i) => [id, series[i] ?? null])),
      labels: Object.assign({}, ...lists.map((l) => dayLabels(l))) as Record<string, string | null>,
    };
  }

  return async (app) => {
    // The live exams list: published tests whose resolved window holds the server's now, earliest start first.
    app.get('/v1/live-tests', { config: admin, schema: { response: { 200: liveTestListSchema } } }, async (req) => {
      const orgId = req.orgId!;
      const now = clock.now();
      const tests = (await data.tests.listPublishedTests(orgId)).filter(
        (t) => t.resolved?.window && testStatusAt(t.status, t.resolved.window, now) === 'live',
      );
      const info = await seriesInfo(orgId, tests);
      const items: LiveTestList['items'] = tests.map((t) => ({
        testId: t.id,
        title: t.title,
        dayLabel: info.labels[t.id] ?? null,
        seriesId: t.seriesId,
        seriesTitle: info.series.get(t.seriesId)?.title ?? '',
        window: t.resolved!.window!,
      }));
      return {
        items: items.sort(
          (a, b) =>
            a.window.start - b.window.start || collator.compare(a.title, b.title) || a.testId.localeCompare(b.testId),
        ),
      };
    });

    // The live view's one API read (PERF-04): the registered students the series and test rules admit now.
    app.get(
      '/v1/tests/:id/live',
      { config: admin, schema: { params: idParams, response: { 200: liveRosterSchema } } },
      async (req): Promise<LiveRoster> => {
        const orgId = req.orgId!;
        const test = await publishedTest(orgId, req.params.id);
        const info = await seriesInfo(orgId, [test]);
        const series = info.series.get(test.seriesId);
        const students = await eligibility.matchingStudents(
          orgId,
          series?.eligibility ?? NO_RESTRICTION,
          test.eligibility,
        );
        return {
          test: {
            id: test.id,
            title: test.title,
            dayLabel: info.labels[test.id] ?? null,
            secondCamera: test.resolved.secondCamera === true,
          },
          students: students.map((s) => ({ id: s.id, name: s.name, prn: s.prn })),
        };
      },
    );

    // Every attempt of a published test, `reset` ones included.
    app.get(
      '/v1/tests/:id/attempts',
      { config: admin, schema: { params: idParams, response: { 200: testAttemptListSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const test = await publishedTest(orgId, req.params.id);
        return { items: await data.attempts.listTestAttempts(orgId, test.id) };
      },
    );
  };
}
