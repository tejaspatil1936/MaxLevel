import { describe, expect, it } from 'vitest';
import { LlmUnavailableError } from './driver';
import { ScriptedLlm } from './scripted';

const call = (llm: ScriptedLlm, page: number) =>
  llm.generate({
    page,
    system: 's',
    parts: [
      { type: 'text', text: 'x' },
      { type: 'file', mediaType: 'application/pdf', data: new Uint8Array([1]) },
    ],
  });

describe('scripted mock model', () => {
  it('IMP-07 answers each page from the script with its usage and logs the parts of every call', async () => {
    const llm = new ScriptedLlm();
    llm.setScript({ pages: { '1': [{ prompt: 'Q' }] }, usage: { inputTokens: 5, outputTokens: 2 } });
    expect(await call(llm, 1)).toEqual({
      output: { questions: [{ prompt: 'Q' }] },
      usage: { inputTokens: 5, outputTokens: 2 },
    });
    expect((await call(llm, 2)).output).toEqual({ questions: [] });
    expect(llm.calls()).toEqual([
      { page: 1, parts: [{ type: 'text' }, { type: 'file', mediaType: 'application/pdf' }] },
      { page: 2, parts: [{ type: 'text' }, { type: 'file', mediaType: 'application/pdf' }] },
    ]);
    expect([llm.provider, llm.model]).toEqual(['mock', 'mock-model']);
    llm.setScript({});
    expect(llm.calls(), 'a new script clears the log').toEqual([]);
    expect((await call(llm, 1)).usage).toEqual({ inputTokens: 1000, outputTokens: 200 });
  });

  it('REL-06 fails the next n calls of a page with a provider error, then answers', async () => {
    const llm = new ScriptedLlm();
    llm.setScript({ pages: { '1': [] }, failures: { '1': 2 } });
    await expect(call(llm, 1)).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(call(llm, 1)).rejects.toMatchObject({ status: 503 });
    expect((await call(llm, 1)).output).toEqual({ questions: [] });
  });

  it('REL-06 holds the calls of a held page until released; other pages answer meanwhile', async () => {
    const llm = new ScriptedLlm();
    llm.setScript({ hold: [2] });
    let answered = false;
    const held = call(llm, 2).then(() => (answered = true));
    await call(llm, 1);
    expect(answered).toBe(false);
    llm.release();
    await held;
    expect(answered).toBe(true);
    await call(llm, 2);
    llm.setScript({ hold: [3] });
    const later = call(llm, 3);
    llm.reset();
    await expect(later).resolves.toMatchObject({ output: { questions: [] } });
  });

  it('EXP-05 REL-06 answers report calls in order, the last repeating, after the scripted failures, and logs each', async () => {
    const llm = new ScriptedLlm();
    const ask = (n: number) => llm.summarize({ system: `system ${n}`, prompt: '{"version":1}' });
    expect((await ask(0)).output, 'without a report script').toEqual({
      summary: 'Summary.',
      recommendations: ['Recommendation.'],
    });
    const a = { summary: 'A.', recommendations: ['One.'] };
    const b = { summary: 'B.', recommendations: ['Two.'] };
    llm.setScript({ report: { answers: [a, b], failures: 1 } });
    expect(llm.reportCalls(), 'a new script clears the report log').toEqual([]);
    await expect(ask(1)).rejects.toMatchObject({ status: 503 });
    expect((await ask(2)).output).toEqual(a);
    expect((await ask(3)).output).toEqual(b);
    expect((await ask(4)).output).toEqual(b);
    expect(llm.reportCalls().map((c) => c.system)).toEqual(['system 1', 'system 2', 'system 3', 'system 4']);
    expect(llm.reportCalls()[0]).toEqual({ system: 'system 1', prompt: '{"version":1}' });
    expect(llm.calls(), 'report calls are not import calls').toEqual([]);
    llm.reset();
    expect(llm.reportCalls()).toEqual([]);
  });
});
