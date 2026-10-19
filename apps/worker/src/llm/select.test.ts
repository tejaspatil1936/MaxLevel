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

  it('IMP-07 prices come from LLM_PRICE_INPUT_USD_PER_MTOK and LLM_PRICE_OUTPUT_USD_PER_MTOK, the mock costing 1 and 4', () => {
    expect(selectLlm({ env: 'test', llmProvider: 'mock' })?.prices).toEqual({ inputPerMTok: 1, outputPerMTok: 4 });
    expect(selectLlm({ env: 'test', llmProvider: 'mock', llmPriceInput: 0.3, llmPriceOutput: 2.5 })?.prices).toEqual({
      inputPerMTok: 0.3,
      outputPerMTok: 2.5,
    });
    expect(selectLlm({ env: 'test', llmProvider: 'mock', llmPriceOutput: 0 })?.prices).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 0,
    });
  });
});
