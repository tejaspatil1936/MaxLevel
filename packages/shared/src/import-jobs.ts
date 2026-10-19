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

/** `PATCH /v1/imports/{id}/drafts/{draftId}`: any of these; `images` may only keep or drop paths the draft has. */
export const importDraftPatchSchema = z
  .object({
    prompt: z.string().max(20000),
    options: z
      .array(z.object({ id: z.string().regex(/^[a-f]$/), text: z.string().max(5000) }))
      .max(6)
      .refine((o) => new Set(o.map((x) => x.id)).size === o.length, { message: 'Option IDs must differ.' }),
    correctOptionIds: z.array(z.string().regex(/^[a-f]$/)).max(6),
    /** An empty explanation or `null` removes it. */
    explanation: z.string().max(20000).nullable(),
    difficulty: z.enum(['easy', 'medium', 'hard']).nullable(),
    images: z.array(z.object({ path: z.string().min(1).max(512), alt: z.string().max(500) })).max(10),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field.' });
export type ImportDraftPatch = z.infer<typeof importDraftPatchSchema>;

/** `POST /v1/imports/{id}/approve` and `…/discard`: the drafts, by ID. */
export const importDraftIdsSchema = z.object({ draftIds: z.array(id).min(1).max(1000) }).strict();
export const importApprovedSchema = z.object({ questionIds: z.array(z.string()) });
export const importDiscardedSchema = z.object({ discarded: z.number().int() });

/** A signed link to a PDF job's source page works for 15 minutes on the server clock. */
export const IMPORT_PAGE_LINK_TTL_MS = 15 * 60_000;
/** `GET /v1/imports/{id}/pages/{page}`: a signed link to that page, rendered as PNG or as a one-page PDF. */
export const importPageLinkSchema = z.object({
  url: z.string(),
  contentType: z.enum(['image/png', 'application/pdf']),
  expiresAt: z.number().int(),
});
export type ImportPageLink = z.infer<typeof importPageLinkSchema>;

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

/** Where the worker keeps a PDF job's page `page` for the review screen: rendered as PNG, or the one-page PDF. */
export const importPagePath = (orgId: string, jobId: string, page: number, ext: 'png' | 'pdf') =>
  `organizations/${orgId}/imports/${jobId}/pages/${page}.${ext}`;

/** The folder of a job's cropped figures (IMP-03); a draft may only point at images in it that it already has. */
export const importFiguresFolder = (orgId: string, jobId: string) => `organizations/${orgId}/imports/${jobId}/figures/`;

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
