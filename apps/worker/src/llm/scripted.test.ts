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
});
