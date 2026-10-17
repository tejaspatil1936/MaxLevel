import { z } from 'zod';

/** Stable error codes the web app maps to friendly copy (API-01). */
export const ERROR_CODES = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'FEATURE_DISABLED',
  'LIMIT_REACHED',
  'RATE_LIMITED',
  'NOT_ON_LIST',
  'ORG_SUSPENDED',
  'ORG_ARCHIVED',
  'ACCOUNT_DISABLED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | (string & {});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
