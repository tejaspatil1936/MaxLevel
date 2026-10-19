import { z } from 'zod';
import { IMPORT_FORMATS, type ImportFormat } from './import-formats';
import { boxSchema } from './import-llm';
import type { TaskRequest } from './tasks';

// Import jobs (spec 6.2; docs/testids/phase-6.md "Requests the tests send directly"): the requests and answers of
// `/v1/imports`, the stored job's statuses and the worker task. The API never parses a file; the worker does.

const id = z.string().min(1).max(128);

/** `awaiting_upload` → `queued` (started) → `running` → `ready`; `retrying` and `failed` from the running states. */
export const IMPORT_STATUSES = ['awaiting_upload', 'queued', 'running', 'retrying', 'ready', 'failed'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export const importFormatSchema = z.enum(IMPORT_FORMATS);

/** The signed upload link works for 15 minutes after the job was created, on the server clock. */
export const IMPORT_UPLOAD_TTL_MS = 15 * 60_000;

/** `POST /v1/imports` (with an Idempotency-Key, API-02). `sizeBytes` is the declared size; the upload checks it again. */
export const importCreateSchema = z.object({
  testId: id,
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().max(255),
  sizeBytes: z.number().int().nonnegative(),
});
export type ImportCreate = z.infer<typeof importCreateSchema>;

export const importCreatedSchema = z.object({
  id: z.string(),
  status: z.enum(IMPORT_STATUSES),
  uploadUrl: z.string(),
  uploadExpiresAt: z.number().int(),
});
export type ImportCreated = z.infer<typeof importCreatedSchema>;

/** `POST /v1/imports/{id}/start` (and later `…/retry`). */
export const importStartedSchema = z.object({ id: z.string(), status: z.enum(IMPORT_STATUSES) });
export type ImportStarted = z.infer<typeof importStartedSchema>;

export const importErrorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() });
export type ImportError = z.infer<typeof importErrorSchema>;

export const importProgressSchema = z.object({
  pagesDone: z.number().int(),
  pagesTotal: z.number().int(),
  questionsFound: z.number().int(),
});
export type ImportProgress = z.infer<typeof importProgressSchema>;

export const DRAFT_STATUSES = ['pending', 'approved', 'discarded'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** One draft of the job view (admins only: drafts carry their correct answers). */
export const importDraftSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  sourcePage: z.number().int(),
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  correctOptionIds: z.array(z.string()),
  explanation: z.string().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  difficultySuggested: z.boolean(),
  sectionName: z.string().optional(),
  images: z.array(z.object({ path: z.string(), alt: z.string() })),
  box: boxSchema.optional(),
  flags: z.array(z.object({ code: z.string(), text: z.string() })),
  status: z.enum(DRAFT_STATUSES),
  questionId: z.string().optional(),
});
export type ImportDraft = z.infer<typeof importDraftSchema>;

/** `GET /v1/imports/{id}`: `drafts` in `order`, empty until the job is `ready`. */
export const importJobViewSchema = z.object({
  id: z.string(),
  testId: z.string(),
  filename: z.string(),
  format: importFormatSchema,
  status: z.enum(IMPORT_STATUSES),
  progress: importProgressSchema,
  error: importErrorSchema.optional(),
  retryAt: z.number().int().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  tokens: z.object({ input: z.number().int(), output: z.number().int() }).optional(),
  costEstimate: z.number().optional(),
  createdAt: z.number().int(),
  drafts: z.array(importDraftSchema),
});
export type ImportJobView = z.infer<typeof importJobViewSchema>;

/** `GET /v1/imports?testId=`: the test's jobs, newest first. */
export const importListQuerySchema = z.object({ testId: id });
export const importListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      filename: z.string(),
      format: importFormatSchema,
      status: z.enum(IMPORT_STATUSES),
      pendingCount: z.number().int(),
      createdAt: z.number().int(),
    }),
  ),
});
export type ImportList = z.infer<typeof importListSchema>;

/** Where the source file is kept with its job (DECISIONS Q31), by its lower-case extension. */
export const importFilePath = (orgId: string, jobId: string, format: ImportFormat) =>
  `organizations/${orgId}/imports/${jobId}/source.${format}`;

export interface ImportPayload {
  orgId: string;
  jobId: string;
}

/** The worker task of one import, due at once; its name contains the job ID. */
export function importTask(orgId: string, jobId: string): TaskRequest<ImportPayload> {
  return { name: `import-${jobId}`, path: '/tasks/import', payload: { orgId, jobId } };
}

/**
 * A later run of the same import, due at `scheduleTime` (now when omitted): a model retry (REL-06) or an admin's
 * retry. `run` makes the name unique among the job's tasks, so a done task never hides it; the name holds the job ID.
 */
export function importRetryTask(
  orgId: string,
  jobId: string,
  run: string,
  scheduleTime?: number,
): TaskRequest<ImportPayload> {
  return {
    ...importTask(orgId, jobId),
    name: `import-${jobId}-${run}`,
    ...(scheduleTime === undefined ? {} : { scheduleTime }),
  };
}
