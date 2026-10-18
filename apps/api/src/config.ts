import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_ORIGINS: z.string().default('http://localhost:3000'),
  TEST_API_SECRET: z.string().optional(),
  WORKER_URL: z.string().default('http://127.0.0.1:4001'),
  // The cloud-tasks driver arrives with the deployment phase; until then every run uses the local queue.
  TASK_QUEUE: z.enum(['local']).default('local'),
  // Signs export download links (EXP-03). Every API instance needs the same value, so production refuses to start
  // without one (Secret Manager); a development or test run without it signs with a random key of its own, so links
  // work only on that process.
  EXPORT_LINK_SECRET: z
    .string()
    .refine((s) => Buffer.byteLength(s, 'utf8') >= 32, 'EXPORT_LINK_SECRET must be at least 32 bytes')
    .optional(),
});

export type Config = {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  appOrigins: string[];
  testApiSecret?: string;
  workerUrl: string;
  taskQueue: 'local';
  exportLinkSecret: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = envSchema.parse(env);
  if (e.NODE_ENV === 'production' && !e.EXPORT_LINK_SECRET)
    throw new Error('EXPORT_LINK_SECRET (at least 32 bytes) is required when NODE_ENV is production');
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    workerUrl: e.WORKER_URL,
    taskQueue: e.TASK_QUEUE,
    exportLinkSecret: e.EXPORT_LINK_SECRET ?? randomBytes(32).toString('hex'),
    appOrigins: e.APP_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    ...(e.TEST_API_SECRET ? { testApiSecret: e.TEST_API_SECRET } : {}),
  };
}
