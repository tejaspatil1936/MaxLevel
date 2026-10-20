import { APICallError } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { AiSdkLlm } from './ai-sdk';
import { LlmUnavailableError, type LlmRequest } from './driver';

// The AI SDK adapter against the AI SDK's own mock model (DECISIONS Q30): no provider is ever called here.

const PRICES = { inputPerMTok: 1, outputPerMTok: 4 };
const ANSWER = { questions: [{ prompt: 'What is 2 + 2?', options: ['3', '4'], correct: [1] }] };
const REQUEST: LlmRequest = {
  page: 2,
  system: 'The system instructions',
  parts: [
    { type: 'text', text: '<file_content>\n</file_content>' },
    { type: 'file', mediaType: 'application/pdf', data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) },
  ],
};

const answering = (text: string) =>
  new MockLanguageModelV2({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: 'stop',
      usage: { inputTokens: 1200, outputTokens: 80, totalTokens: 1280 },
      warnings: [],
    }),
  });

describe('AiSdkLlm', () => {
  it('IMP-03 IMP-07 sends the system instructions and the page as text and file parts, and reports the usage', async () => {
    const model = answering(JSON.stringify(ANSWER));
    const llm = new AiSdkLlm('vertex', 'gemini-test', model, PRICES);
    const res = await llm.generate(REQUEST);
    expect(res).toEqual({ output: ANSWER, usage: { inputTokens: 1200, outputTokens: 80 } });
    expect([llm.provider, llm.model, llm.prices]).toEqual(['vertex', 'gemini-test', PRICES]);

    const [call] = model.doGenerateCalls;
    expect(call!.responseFormat).toMatchObject({ type: 'json', name: 'questions' });
    expect(call!.prompt[0]).toEqual({ role: 'system', content: 'The system instructions' });
    const user = call!.prompt[1] as { role: string; content: Array<{ type: string; mediaType?: string }> };
    expect(user.role).toBe('user');
    expect(user.content.map((p) => [p.type, p.mediaType])).toEqual([
      ['text', undefined],
      ['file', 'application/pdf'],
    ]);
  });

  it('REL-06 a provider error is a model failure with its HTTP status, and the SDK does not retry it', async () => {
    let calls = 0;
    const model = new MockLanguageModelV2({
      doGenerate: async () => {
        calls++;
        throw new APICallError({
          message: 'Service unavailable',
          url: 'https://example.invalid',
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: true,
        });
      },
    });
    const err = await new AiSdkLlm('vertex', 'm', model, PRICES).generate(REQUEST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect((err as LlmUnavailableError).status).toBe(503);
    expect(calls, 'the worker retries on its own schedule').toBe(1);
  });

  it('REL-06 IMP-05 an answer outside the schema or not JSON is a model failure', async () => {
    for (const text of ['not json', JSON.stringify({ questions: [{ prompt: 'No options' }] })]) {
      const err = await new AiSdkLlm('vertex', 'm', answering(text), PRICES).generate(REQUEST).catch((e: unknown) => e);
      expect(err, text).toBeInstanceOf(LlmUnavailableError);
    }
  });

  it('REL-06 a call that does not answer in time is a model failure', async () => {
    const model = new MockLanguageModelV2({
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) =>
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason as Error), { once: true }),
        ),
    });
    const err = await new AiSdkLlm('vertex', 'm', model, PRICES, 20).generate(REQUEST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
  });

  it('EXP-05 a summary call sends the instructions as the system message and only the metrics JSON as user text', async () => {
    const answer = { summary: 'Five finished.', recommendations: ['Practise question 4.'] };
    const model = answering(JSON.stringify(answer));
    const res = await new AiSdkLlm('vertex', 'm', model, PRICES).summarize({ system: 'Rules', prompt: '{"a":1}' });
    expect(res).toEqual({ output: answer, usage: { inputTokens: 1200, outputTokens: 80 } });
    const [call] = model.doGenerateCalls;
    expect(call!.responseFormat).toMatchObject({ type: 'json', name: 'report_summary' });
    expect(call!.prompt).toEqual([
      { role: 'system', content: 'Rules' },
      { role: 'user', content: [{ type: 'text', text: '{"a":1}' }] },
    ]);
    const bad = await new AiSdkLlm('vertex', 'm', answering('{"summary":""}'), PRICES)
      .summarize({ system: 'Rules', prompt: '{}' })
      .catch((e: unknown) => e);
    expect(bad, 'an answer outside ReportSummarySchema is a model failure').toBeInstanceOf(LlmUnavailableError);
  });
});
