import {
  assistantChatRequestSchema,
  assistantChatResponseSchema,
  diagnosticReportSchema,
  docIdSchema,
  type AssistantChatResponse,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../errors';
import { ASSISTANT_RATE_LIMIT } from '../plugins/rate-limit';
import { createAdminAssistantService } from '../services/admin-assistant';
import { adminDiagnosticService } from '../services/admin-diagnostic';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const testIdParams = z.object({ id: docIdSchema });
const diagnoseQuery = z.object({ student: z.string().optional() });

export function assistantRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, clock } = ctx;
  const diagnostics = adminDiagnosticService(data);
  const assistantService = createAdminAssistantService(data);

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
  };
}
