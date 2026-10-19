import { randomUUID } from 'node:crypto';
import {
  dayLabels,
  docIdSchema,
  drawAttempt,
  examPreviewSchema,
  resolveSettings,
  testDrawPools,
  type ExamPreview,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../errors';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: docIdSchema });

/**
 * GET /v1/tests/{id}/preview (Q-13, US-AD-08): the exam payload a student would get, drawn with a fresh random seed
 * each time and the settings in force, plus the answer key for Show answers. Nothing is stored.
 */
export function examPreviewRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, questionImages } = ctx;

  return async (app) => {
    app.get(
      '/v1/tests/:id/preview',
      { config: admin, schema: { params: idParams, response: { 200: examPreviewSchema } } },
      async (req): Promise<ExamPreview> => {
        const orgId = req.orgId!;
        const test = await data.tests.getTest(orgId, req.params.id);
        if (!test) throw notFound('Test');
        const [series, org, siblings, questions] = await Promise.all([
          data.series.getSeries(orgId, test.seriesId),
          data.orgs.getOrg(orgId),
          data.tests.listTests(orgId, test.seriesId),
          data.questions.listQuestions(orgId, test.id),
        ]);
        if (!series) throw notFound('Test');
        const settings = test.resolved ?? resolveSettings({ series, test, timezone: org?.timezone ?? 'Asia/Kolkata' });
        const byId = new Map(questions.map((q) => [q.id, q]));
        const draw = drawAttempt(
          testDrawPools(test, questions),
          Object.fromEntries(questions.map((q) => [q.id, q.options.map((o) => o.id)])),
          settings,
          randomUUID(),
        );
        const drawn = draw.questionIds.map((id) => {
          const q = byId.get(id)!;
          const options = new Map(q.options.map((o) => [o.id, o]));
          const timeLimitSec =
            settings.questionTimeMode === 'same'
              ? settings.questionTimeLimitSec
              : settings.questionTimeMode === 'each'
                ? q.timeLimitSec
                : undefined;
          return {
            id: q.id,
            ...(q.sectionId ? { sectionId: q.sectionId } : {}),
            prompt: q.prompt,
            images: q.images,
            options: draw.optionOrder[id]!.map((o) => options.get(o)!),
            ...(q.marks !== undefined ? { marks: q.marks } : {}),
            ...(q.negativeMarks !== undefined ? { negativeMarks: q.negativeMarks } : {}),
            ...(timeLimitSec !== undefined ? { timeLimitSec } : {}),
            correctOptionIds: q.correctOptionIds,
            ...(q.explanation ? { explanation: q.explanation } : {}),
          };
        });
        const paths = drawn.flatMap((q) => [...q.images, ...q.options.flatMap((o) => (o.image ? [o.image] : []))]);
        return {
          test: { id: test.id, title: test.title, dayLabel: dayLabels(siblings)[test.id] ?? null },
          durationMin: settings.durationMin,
          sections: test.sections.map((s) => ({
            id: s.id,
            name: s.name,
            order: s.order,
            ...(s.instructions ? { instructions: s.instructions } : {}),
            ...(s.durationMin !== undefined ? { durationMin: s.durationMin } : {}),
            forwardOnly: s.forwardOnly,
          })),
          questions: drawn,
          imageUrls: await questionImages.dataUrls(paths.map((i) => i.path)),
        };
      },
    );
  };
}
