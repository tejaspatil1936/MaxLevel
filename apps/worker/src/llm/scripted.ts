import type { LlmCall, LlmScript } from '@mitaoe/shared';
import { LlmUnavailableError, type LlmDriver, type LlmRequest, type LlmResponse } from './driver';

const DEFAULT_USAGE = { inputTokens: 1000, outputTokens: 200 };

/**
 * The mock model of every test (DECISIONS Q30; docs/testids/phase-6.md "Test-only routes"). It answers a call for page
 * p with `{ questions: pages[p] ?? [] }`, fails the next `failures[p]` calls for that page with a provider error
 * (HTTP 503), and holds calls for the pages in `hold` until `release()`. Every call is logged with its parts.
 */
export class ScriptedLlm implements LlmDriver {
  readonly provider = 'mock';
  private script: LlmScript = {};
  private failuresLeft = new Map<number, number>();
  private held = new Set<number>();
  private waiting: Array<() => void> = [];
  private log: LlmCall[] = [];

  constructor(readonly model = 'mock-model') {}

  /** Replaces the script and clears the call log; calls already held stay held until released. */
  setScript(script: LlmScript): void {
    this.script = script;
    this.failuresLeft = new Map(Object.entries(script.failures ?? {}).map(([p, n]) => [Number(p), n]));
    this.held = new Set(script.hold ?? []);
    this.log = [];
  }

  /** Lets every held call, and every later call of a held page, answer. */
  release(): void {
    this.held.clear();
    for (const go of this.waiting.splice(0)) go();
  }

  /** Back to an empty script with no calls, releasing held ones (POST /__test/reset). */
  reset(): void {
    this.setScript({});
    this.release();
  }

  calls(): LlmCall[] {
    return [...this.log];
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const { page } = request;
    this.log.push({
      page,
      parts: request.parts.map((p) =>
        p.type === 'file' ? { type: 'file', mediaType: p.mediaType } : { type: 'text' },
      ),
    });
    if (this.held.has(page)) await new Promise<void>((go) => this.waiting.push(go));
    const failures = this.failuresLeft.get(page) ?? 0;
    if (failures > 0) {
      this.failuresLeft.set(page, failures - 1);
      throw new LlmUnavailableError('The mock provider answered 503.', 503);
    }
    return {
      output: { questions: this.script.pages?.[String(page)] ?? [] },
      usage: this.script.usage ?? DEFAULT_USAGE,
    };
  }
}
