// The worker's only way to a language model (IMP-07): one call per page or part of an import, with the shared system
// instructions and a user message of text and file parts (extractionPrompt). Drivers: the scripted mock for tests
// (LLM_PROVIDER=mock, scripted.ts) and, from F-6.03, the AI SDK adapter set by configuration. The worker validates
// every answer with LlmAnswerSchema itself, so a driver returns the model's structured output unchecked.

export type LlmPart = { type: 'text'; text: string } | { type: 'file'; mediaType: string; data: Uint8Array };

export interface LlmRequest {
  /** The page (PDF) or part (TXT, MD, sheet) number, from 1. */
  page: number;
  system: string;
  parts: LlmPart[];
}

export interface LlmResponse {
  /** The model's structured output, not yet validated. */
  output: unknown;
  usage: { inputTokens: number; outputTokens: number };
}

/** The model could not answer: a provider error or a timeout. The worker retries later (REL-06). */
export class LlmUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

export interface LlmDriver {
  /** The `LLM_PROVIDER` setting, recorded on the job (`mock` in tests). */
  readonly provider: string;
  /** The `LLM_MODEL` setting or the driver's default, recorded on the job. */
  readonly model: string;
  /** One model call; throws LlmUnavailableError when the provider fails. */
  generate(request: LlmRequest): Promise<LlmResponse>;
}
