import { describe, expect, it } from 'vitest';
import { ScriptedLlm } from './scripted';
import { selectLlm } from './select';

describe('selectLlm', () => {
  it('IMP-07 LLM_PROVIDER=mock gives the scripted model with LLM_MODEL or its default, never in production', () => {
    const mock = selectLlm({ env: 'test', llmProvider: 'mock' });
    expect(mock).toBeInstanceOf(ScriptedLlm);
    expect([mock?.provider, mock?.model]).toEqual(['mock', 'mock-model']);
    expect(selectLlm({ env: 'test', llmProvider: 'mock', llmModel: 'other-model' })?.model).toBe('other-model');
    expect(() => selectLlm({ env: 'production', llmProvider: 'mock' })).toThrow(/tests and development only/);
    expect(selectLlm({ env: 'test' })).toBeUndefined();
  });
});
