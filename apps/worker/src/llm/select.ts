import type { WorkerConfig } from '../config';
import type { LlmDriver } from './driver';
import { ScriptedLlm } from './scripted';

/**
 * The driver LLM_PROVIDER names (IMP-07): `mock` is the scripted test model and is refused in production. Real
 * providers arrive with the AI SDK adapter (F-6.03); until then any other value leaves AI imports without a model.
 */
export function selectLlm(config: Pick<WorkerConfig, 'env' | 'llmProvider' | 'llmModel'>): LlmDriver | undefined {
  if (config.llmProvider !== 'mock') return undefined;
  if (config.env === 'production') throw new Error('LLM_PROVIDER=mock is for tests and development only.');
  return new ScriptedLlm(config.llmModel ?? 'mock-model');
}
