import { createVertex } from '@ai-sdk/google-vertex';
import { MOCK_LLM_PRICES, type LlmPrices } from '@mitaoe/shared';
import type { WorkerConfig } from '../config';
import { AiSdkLlm } from './ai-sdk';
import type { LlmDriver } from './driver';
import { ScriptedLlm } from './scripted';

type LlmConfig = Pick<WorkerConfig, 'env' | 'llmProvider' | 'llmModel' | 'llmPriceInput' | 'llmPriceOutput'> &
  Partial<Pick<WorkerConfig, 'vertexProject' | 'vertexLocation'>>;

/** Gemini on Vertex AI when LLM_MODEL is unset, at its list prices in USD per million tokens (LLM_PRICE_… override). */
export const VERTEX_DEFAULT_MODEL = 'gemini-2.5-flash';
const VERTEX_DEFAULT_PRICES: LlmPrices = { inputPerMTok: 0.3, outputPerMTok: 2.5 };

/** The configured prices (LLM_PRICE_…_USD_PER_MTOK), each falling back to the driver's default (IMP-07). */
export const llmPrices = (config: LlmConfig, defaults: LlmPrices): LlmPrices => ({
  inputPerMTok: config.llmPriceInput ?? defaults.inputPerMTok,
  outputPerMTok: config.llmPriceOutput ?? defaults.outputPerMTok,
});

/**
 * The driver LLM_PROVIDER names (IMP-07, DECISIONS Q30), so switching providers is a configuration change:
 * - `mock`: the scripted test model, refused in production;
 * - `vertex`: Gemini on Vertex AI through the AI SDK (GOOGLE_VERTEX_PROJECT, GOOGLE_VERTEX_LOCATION; the credentials
 *   are the worker's attached service account). Building it makes no call; the first call is an import's first page.
 * Unset, AI imports have no model and fail LLM_UNAVAILABLE; any other value is a configuration error at start-up.
 */
export function selectLlm(config: LlmConfig): LlmDriver | undefined {
  switch (config.llmProvider) {
    case undefined:
      return undefined;
    case 'mock':
      if (config.env === 'production') throw new Error('LLM_PROVIDER=mock is for tests and development only.');
      return new ScriptedLlm(config.llmModel ?? 'mock-model', llmPrices(config, MOCK_LLM_PRICES));
    case 'vertex': {
      if (!config.vertexProject) throw new Error('LLM_PROVIDER=vertex needs GOOGLE_VERTEX_PROJECT.');
      const vertex = createVertex({ project: config.vertexProject, location: config.vertexLocation ?? 'asia-south1' });
      const model = config.llmModel ?? VERTEX_DEFAULT_MODEL;
      return new AiSdkLlm('vertex', model, vertex(model), llmPrices(config, VERTEX_DEFAULT_PRICES));
    }
    default:
      throw new Error(`LLM_PROVIDER=${config.llmProvider} is not a known provider. Use vertex, or mock in tests.`);
  }
}
