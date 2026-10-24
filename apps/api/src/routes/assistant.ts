import {
  applyActionRequestSchema,
  applyActionResponseSchema,
  assistantChatRequestSchema,
  assistantChatResponseSchema,
  diagnosticReportSchema,
  docIdSchema,
  FULL_REVIEW_BEFORE_CLOSE_MESSAGE,
  seriesCreateSchema,
  seriesPatchSchema,
  settingsProblems,
  testCreateSchema,
  testPatchSchema,
  type ApplyActionResponse,
  type AssistantChatResponse,
  type SeriesDefaults,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../errors';
import { ASSISTANT_RATE_LIMIT } from '../plugins/rate-limit';
import { createAdminAssistantService } from '../services/admin-assistant';
import { adminDiagnosticService } from '../services/admin-diagnostic';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const testIdParams = z.object({ id: docIdSchema });
const diagnoseQuery = z.object({ student: z.string().optional() });

function refuseLeakyDefaults(defaults?: Partial<SeriesDefaults>): void {
  if (defaults && settingsProblems(defaults).length) {
    throw new AppError(400, 'FULL_REVIEW_BEFORE_CLOSE', FULL_REVIEW_BEFORE_CLOSE_MESSAGE, { field: 'resultRelease' });
  }
}

function refuseDateOutside(series: { startDate: string; endDate: string }, date: string): void {
  if (date < series.startDate || date > series.endDate) {
    throw new AppError(
      400,
      'DATE_OUTSIDE_SERIES',
      `Choose a date from ${series.startDate} to ${series.endDate}, the series dates.`,
      { field: 'scheduledDate' },
    );
  }
}

export function assistantRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, clock, entitlements, audit } = ctx;
  const db = ctx.firebase.db;
  const diagnostics = adminDiagnosticService(data);
  const assistantService = createAdminAssistantService(data, entitlements);

  return async (app) => {
    // 1. Direct 1-Click Test Diagnostic Endpoint
    app.get(
      '/v1/admin/diagnose/tests/:id',
      {
        config: admin,
        schema: {
          params: testIdParams,
          querystring: diagnoseQuery,
          response: { 200: diagnosticReportSchema },
        },
      },
      async (req) => {
        const report = await diagnostics.diagnoseTest(req.orgId!, req.params.id, clock.now(), req.query.student);
        if (!report) throw notFound('Test');
        return report;
      },
    );

    // 2. Interactive Admin Assistant Chat Endpoint (Rate limited to control LLM costs)
    app.post(
      '/v1/admin/assistant/chat',
      {
        config: { ...admin, rateLimit: ASSISTANT_RATE_LIMIT },
        schema: {
          body: assistantChatRequestSchema,
          response: { 200: assistantChatResponseSchema },
        },
      },
      async (req): Promise<AssistantChatResponse> => {
        const orgId = req.orgId!;
        const now = clock.now();
        const { messages, context } = req.body;
        return assistantService.chat(orgId, messages, now, context);
      },
    );

    // 3. Apply Admin Action Endpoint (Human-in-the-loop explicit confirmation)
    app.post(
      '/v1/admin/assistant/apply-action',
      {
        config: admin,
        schema: {
          body: applyActionRequestSchema,
          response: { 200: applyActionResponseSchema },
        },
      },
      async (req): Promise<ApplyActionResponse> => {
        const orgId = req.orgId!;
        await entitlements.requireFeature(orgId, 'ai_assistant_write');
        const { proposal } = req.body;
        const now = clock.now();
        const batch = db.batch();

        switch (proposal.actionType) {
          case 'create_series': {
            if (!proposal.seriesData) throw new AppError(400, 'BAD_REQUEST', 'Missing series data in proposal.');
            const parsed = seriesCreateSchema.parse(proposal.seriesData);
            refuseLeakyDefaults(parsed.defaults);
            const id = data.series.createSeries(orgId, batch, parsed, now);
            audit(req, batch, { action: 'series.create', target: { type: 'series', id }, after: parsed });
            await batch.commit();
            return {
              success: true,
              actionType: 'create_series',
              createdId: id,
              seriesId: id,
              message: `Successfully created test series "${parsed.title}".`,
              editUrl: `/admin/series/edit?id=${id}`,
            };
          }

          case 'create_test': {
            if (!proposal.testData) throw new AppError(400, 'BAD_REQUEST', 'Missing test data in proposal.');
            const { seriesId, scheduledDate, title, company, dayNumber, overrides, eligibility, sections } =
              proposal.testData;
            const s = await data.series.getSeries(orgId, seriesId);
            if (!s) throw notFound('Series');
            refuseDateOutside(s, scheduledDate);

            const testInput = testCreateSchema.parse({
              seriesId,
              title,
              scheduledDate,
              company: company || undefined,
              dayNumber: dayNumber || null,
              dayHidden: false,
            });

            const id = data.tests.createTest(orgId, batch, testInput, now);
            if (overrides || eligibility || sections) {
              const nextSections = sections?.map((x, i) => ({
                ...x,
                id: x.id ?? data.tests.newSectionId(orgId),
                order: i + 1,
              }));
              data.tests.updateTest(orgId, batch, id, {
                ...(overrides ? { overrides } : {}),
                ...(eligibility ? { eligibility } : {}),
                ...(nextSections ? { sections: nextSections } : {}),
                updatedAt: now,
              });
            }
            audit(req, batch, { action: 'test.create', target: { type: 'test', id }, after: proposal.testData });
            await batch.commit();
            return {
              success: true,
              actionType: 'create_test',
              createdId: id,
              seriesId,
              testId: id,
              message: `Successfully created test "${title}". Questions can now be uploaded in the Test Editor.`,
              editUrl: `/admin/tests/edit?id=${id}`,
            };
          }

          case 'update_series': {
            if (!proposal.seriesId) throw new AppError(400, 'BAD_REQUEST', 'Missing series ID in proposal.');
            const s = await data.series.getSeries(orgId, proposal.seriesId);
            if (!s) throw notFound('Series');
            if (proposal.seriesData?.defaults) refuseLeakyDefaults(proposal.seriesData.defaults);
            const patch = seriesPatchSchema.parse(proposal.seriesData);
            data.series.updateSeries(orgId, batch, proposal.seriesId, {
              ...patch,
              updatedAt: now,
            });
            audit(req, batch, {
              action: 'series.patch',
              target: { type: 'series', id: proposal.seriesId },
              after: patch,
            });
            await batch.commit();
            return {
              success: true,
              actionType: 'update_series',
              seriesId: proposal.seriesId,
              message: `Successfully updated series "${proposal.title}".`,
              editUrl: `/admin/series/edit?id=${proposal.seriesId}`,
            };
          }

          case 'update_test': {
            if (!proposal.testId) throw new AppError(400, 'BAD_REQUEST', 'Missing test ID in proposal.');
            const before = await data.tests.getTest(orgId, proposal.testId);
            if (!before) throw notFound('Test');
            if (proposal.testData?.scheduledDate) {
              const s = await data.series.getSeries(orgId, before.seriesId);
              if (s) refuseDateOutside(s, proposal.testData.scheduledDate);
            }
            const patch = testPatchSchema.parse(proposal.testData);
            const { sections, ...rest } = patch;
            const nextSections = sections?.map((x, i) => ({
              ...x,
              id: x.id ?? data.tests.newSectionId(orgId),
              order: i + 1,
            }));
            data.tests.updateTest(orgId, batch, proposal.testId, {
              ...rest,
              ...(nextSections ? { sections: nextSections } : {}),
              updatedAt: now,
            });
            audit(req, batch, {
              action: 'test.patch',
              target: { type: 'test', id: proposal.testId },
              after: patch,
            });
            await batch.commit();
            return {
              success: true,
              actionType: 'update_test',
              testId: proposal.testId,
              seriesId: before.seriesId,
              message: `Successfully updated test "${proposal.title}".`,
              editUrl: `/admin/tests/edit?id=${proposal.testId}`,
            };
          }
        }
      },
    );
  };
}
