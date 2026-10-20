import { LlmAnswerSchema, ReportSummarySchema, type LlmPrices } from '@mitaoe/shared';
import { APICallError, generateObject, type LanguageModel } from 'ai';
import { LlmUnavailableError, type LlmDriver, type LlmRequest, type LlmResponse, type SummaryRequest } from './driver';

/** How long one model call may take before it counts as a failure (REL-06): a page of a dense paper takes well under. */
const LLM_CALL_TIMEOUT_MS = 120_000;

/**
 * The AI SDK adapter (IMP-07, DECISIONS Q30): any AI SDK language model (Gemini on Vertex AI in production, set by
 * LLM_PROVIDER and LLM_MODEL in select.ts) asked for one structured answer per page in the shape of LlmAnswerSchema.
 * The SDK's own retries are off, because the worker retries on its 1, 2 and 4 minute schedule; any error of the call,
 * a timeout or an answer the SDK cannot parse is a model failure (LlmUnavailableError). The worker validates the
 * answer with LlmAnswerSchema again itself.
 */
export class AiSdkLlm implements LlmDriver {
  constructor(
    readonly provider: string,
    readonly model: string,
    private readonly languageModel: Exclude<LanguageModel, string>,
    readonly prices: LlmPrices,
    private readonly timeoutMs = LLM_CALL_TIMEOUT_MS,
  ) {}

  async generate(request: LlmRequest): Promise<LlmResponse> {
    return this.call(async (abortSignal) => {
      const result = await generateObject({
        model: this.languageModel,
        schema: LlmAnswerSchema,
        schemaName: 'questions',
        system: request.system,
        messages: [
          {
            role: 'user',
            content: request.parts.map((p) =>
              p.type === 'text'
                ? { type: 'text' as const, text: p.text }
                : { type: 'file' as const, data: p.data, mediaType: p.mediaType },
            ),
          },
        ],
        maxRetries: 0,
        abortSignal,
      });
      return { output: result.object, usage: result.usage };
    });
  }

  /** A report summary (EXP-05): the instructions as the system message and the metrics JSON as the only user text. */
  async summarize(request: SummaryRequest): Promise<LlmResponse> {
    return this.call(async (abortSignal) => {
      const result = await generateObject({
        model: this.languageModel,
        schema: ReportSummarySchema,
        schemaName: 'report_summary',
        system: request.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }] }],
        maxRetries: 0,
        abortSignal,
      });
      return { output: result.object, usage: result.usage };
    });
  }

  /** Runs one call with the timeout; any error of it is a model failure (LlmUnavailableError). */
  private async call(
    run: (
      abortSignal: AbortSignal,
    ) => Promise<{ output: unknown; usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } }>,
  ): Promise<LlmResponse> {
    try {
      const { output, usage } = await run(AbortSignal.timeout(this.timeoutMs));
      return { output, usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } };
    } catch (err) {
      const status = APICallError.isInstance(err) ? err.statusCode : undefined;
      throw new LlmUnavailableError(
        `The model call failed: ${err instanceof Error ? err.message : String(err)}`,
        status,
      );
    }
  }
}
