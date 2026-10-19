import { MOCK_LLM_PRICES, type LlmPrices } from '@mitaoe/shared';
import type { WorkerConfig } from '../config';
import type { LlmDriver } from './driver';
import { ScriptedLlm } from './scripted';

type LlmConfig = Pick<WorkerConfig, 'env' | 'llmProvider' | 'llmModel' | 'llmPriceInput' | 'llmPriceOutput'>;

/** The configured prices (LLM_PRICE_…_USD_PER_MTOK), each falling back to the driver's default (IMP-07). */
export const llmPrices = (config: LlmConfig, defaults: LlmPrices): LlmPrices => ({
  inputPerMTok: config.llmPriceInput ?? defaults.inputPerMTok,
  outputPerMTok: config.llmPriceOutput ?? defaults.outputPerMTok,
});

/**
 * The driver LLM_PROVIDER names (IMP-07): `mock` is the scripted test model and is refused in production. Real
 * providers arrive with the AI SDK adapter (F-6.03); until then any other value leaves AI imports without a model.
 */
export function selectLlm(config: LlmConfig): LlmDriver | undefined {
  if (config.llmProvider !== 'mock') return undefined;
  if (config.env === 'production') throw new Error('LLM_PROVIDER=mock is for tests and development only.');
  return new ScriptedLlm(config.llmModel ?? 'mock-model', llmPrices(config, MOCK_LLM_PRICES));
}
