import { z } from 'zod';

const envSchema = z.object({
  // Unset means production: only an explicit test or development run skips the task OIDC check (oidc.ts).
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().default(4001),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Expected OIDC audience (the worker's URL) and the Cloud Tasks service account email.
  TASKS_AUDIENCE: z.string().optional(),
  TASKS_SERVICE_ACCOUNT: z.string().optional(),
  TEST_API_SECRET: z.string().optional(),
  // The model AI imports use (IMP-07, DECISIONS Q30); `mock` is the scripted test model, refused in production.
  LLM_PROVIDER: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  // USD per million tokens for the job's cost estimate (IMP-07); each driver has defaults (the mock: 1 and 4).
  LLM_PRICE_INPUT_USD_PER_MTOK: z.coerce.number().nonnegative().optional(),
  LLM_PRICE_OUTPUT_USD_PER_MTOK: z.coerce.number().nonnegative().optional(),
  // LLM_PROVIDER=vertex: Gemini on Vertex AI with the worker's attached service account (DECISIONS Q30).
  GOOGLE_VERTEX_PROJECT: z.string().optional(),
  GOOGLE_VERTEX_LOCATION: z.string().default('asia-south1'),
  // The Chromium that prints report PDFs (EXP-06); unset, playwright-core's own install (PLAYWRIGHT_BROWSERS_PATH).
  CHROMIUM_PATH: z.string().optional(),
});

export type WorkerConfig = {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  tasksAudience?: string;
  tasksServiceAccount?: string;
  testApiSecret?: string;
  llmProvider?: string;
  llmModel?: string;
  llmPriceInput?: number;
  llmPriceOutput?: number;
  vertexProject?: string;
  vertexLocation: string;
  chromiumPath?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const e = envSchema.parse(env);
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    ...(e.TASKS_AUDIENCE ? { tasksAudience: e.TASKS_AUDIENCE } : {}),
    ...(e.TASKS_SERVICE_ACCOUNT ? { tasksServiceAccount: e.TASKS_SERVICE_ACCOUNT } : {}),
    ...(e.TEST_API_SECRET ? { testApiSecret: e.TEST_API_SECRET } : {}),
    ...(e.LLM_PROVIDER ? { llmProvider: e.LLM_PROVIDER } : {}),
    ...(e.LLM_MODEL ? { llmModel: e.LLM_MODEL } : {}),
    ...(e.LLM_PRICE_INPUT_USD_PER_MTOK === undefined ? {} : { llmPriceInput: e.LLM_PRICE_INPUT_USD_PER_MTOK }),
    ...(e.LLM_PRICE_OUTPUT_USD_PER_MTOK === undefined ? {} : { llmPriceOutput: e.LLM_PRICE_OUTPUT_USD_PER_MTOK }),
    ...(e.GOOGLE_VERTEX_PROJECT ? { vertexProject: e.GOOGLE_VERTEX_PROJECT } : {}),
    vertexLocation: e.GOOGLE_VERTEX_LOCATION,
    ...(e.CHROMIUM_PATH ? { chromiumPath: e.CHROMIUM_PATH } : {}),
  };
}
