import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_ORIGINS: z.string().default('http://localhost:3000'),
  TEST_API_SECRET: z.string().optional(),
});

export type Config = {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  appOrigins: string[];
  testApiSecret?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = envSchema.parse(env);
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    appOrigins: e.APP_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    ...(e.TEST_API_SECRET ? { testApiSecret: e.TEST_API_SECRET } : {}),
  };
}
