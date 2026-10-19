import {
  dayLabels,
  docIdSchema,
  manualReleaseRefusal,
  resultReleaseState,
  resultsOverviewSchema,
  testReleaseSummarySchema,
  type ResultsOverview,
  type TestReleaseSummary,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { TestRecord } from '../data/tests';
import { notFound } from '../errors';
import type { ApiContext } from './context';
import { releaseInputOf } from './release';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: docIdSchema });

/**
 * The admin results pages' reads (US-AD-10, RES-01, RES-05): published tests with their release setting and state,
 * worked out on the server clock (the SER-09 refusal depends on it), and the series that hold them.
 */
export function resultsRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, clock } = ctx;

  /** Day labels and titles of the named series, read once each. */
  async function seriesInfo(orgId: string, seriesIds: Iterable<string>) {
    const ids = [...new Set(seriesIds)];
    const [series, lists] = await Promise.all([
      Promise.all(ids.map((id) => data.series.getSeries(orgId, id))),
      Promise.all(ids.map((id) => data.tests.listTests(orgId, id))),
    ]);
    const titles = new Map(ids.map((id, i) => [id, series[i]?.title ?? '']));
    const labels: Record<string, string | null> = Object.assign({}, ...lists.map((l) => dayLabels(l)));
    return { titles, labels };
  }

  function summary(test: TestRecord, info: Awaited<ReturnType<typeof seriesInfo>>, now: number): TestReleaseSummary {
    const input = releaseInputOf({ ...test, resolved: test.resolved! });
    return {
      testId: test.id,
      title: test.title,
      dayLabel: info.labels[test.id] ?? null,
      seriesId: test.seriesId,
      seriesTitle: info.titles.get(test.seriesId) ?? '',
      scheduledDate: test.scheduledDate,
      resultRelease: input.settings.resultRelease,
      resultDetail: input.settings.resultDetail,
      state: resultReleaseState(input),
      windowEnd: input.settings.window?.end ?? null,
      resultsReleasedAt: input.resultsReleasedAt,
      refusal: manualReleaseRefusal(input, now),
    };
  }

  return async (app) => {
    app.get('/v1/results', { config: admin, schema: { response: { 200: resultsOverviewSchema } } }, async (req) => {
      const orgId = req.orgId!;
      const tests = (await data.tests.listPublishedTests(orgId)).filter((t) => t.resolved);
      const info = await seriesInfo(
        orgId,
        tests.map((t) => t.seriesId),
      );
      const now = clock.now();
      const counts = new Map<string, number>();
      for (const t of tests) counts.set(t.seriesId, (counts.get(t.seriesId) ?? 0) + 1);
      const overview: ResultsOverview = {
        tests: tests.map((t) => summary(t, info, now)),
        series: [...counts]
          .map(([id, testCount]) => ({ id, title: info.titles.get(id) ?? '', testCount }))
          .sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id)),
      };
      return overview;
    });

    app.get(
      '/v1/tests/:id/release',
      { config: admin, schema: { params: idParams, response: { 200: testReleaseSummarySchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const test = await data.tests.getTest(orgId, req.params.id);
        if (!test?.resolved || test.status !== 'scheduled') throw notFound('Test');
        return summary(test, await seriesInfo(orgId, [test.seriesId]), clock.now());
      },
    );
  };
}
