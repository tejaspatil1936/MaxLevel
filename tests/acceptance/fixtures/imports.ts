import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import type { ApiClient, ApiResponse } from './api';
import type { Emulators, StoredDoc } from './emulators';
import type { Box, ImportFile } from './import-files';
import type { TestApi } from './test-api';

// The import API, its stored records and the Storage objects it writes (docs/testids/phase-6.md). Tests create jobs
// only through the real API; these helpers wait on the job's state, never for a fixed time.

/** Exact texts of the phase 6 contract. */
export const IMPORT_TEXTS = {
  formats: 'JSON, PDF, XLSX, CSV, TXT or MD, up to 25 MB. PDFs can have up to 100 pages and sheets up to 5,000 rows.',
  noFile: 'Choose a file to import.',
  unsupported: "This file type can't be imported. Use JSON, PDF, XLSX, CSV, TXT or MD.",
  tooLarge: 'This file is larger than 25 MB. Split it into smaller files.',
  mismatch: (format: string) => `This file isn't a real ${format} file. Check the file and try again.`,
  tooManyPages: (n: string) => `This PDF has ${n} pages. The limit is 100 pages.`,
  tooManyRows: (n: string) => `This sheet has ${n} rows. The limit is 5,000 rows.`,
  limitReached: (n: number) =>
    `This month's AI import limit (${n}) is used up. JSON files and template sheets can still be imported.`,
  llmUnavailable: "The AI service didn't answer.",
  llmGaveUp: "The AI service didn't answer after 4 tries.",
  retryAt: (hhmm: string) => `The AI service didn't answer. The import will try again at ${hhmm} IST.`,
  failed: (message: string) => `The import failed. ${message}`,
  leave: 'You can leave this page. The import keeps running.',
  pagesProcessed: (done: number, total: number) => `Pages processed: ${done} of ${total}`,
  questionsFound: (n: number) => `Questions found: ${n}`,
  approved: (n: number) => (n === 1 ? 'Approved 1 question' : `Approved ${n} questions`),
  discarded: (n: number) => `Question ${n} discarded`,
  saved: (n: number) => `Question ${n} saved`,
  fixFirst: 'Fix the reasons above before approving.',
  fixBeforeApproving: 'Fix the reasons before approving this question.',
  addedAs: (m: number) => `Added to the test as question ${m}.`,
  empty: {
    sentence: 'No questions were found in this file. Check that it holds questions, or import another file.',
    action: 'Import another file',
  },
} as const;

/** Flag texts of the question checks (docs/testids/phase-6.md, "Question checks on drafts"). */
export const FLAG_TEXTS = {
  NO_CORRECT_ANSWER: 'No correct answer found in the source.',
  TOO_FEW_OPTIONS: 'A question needs at least two options.',
  MULTIPLE_CORRECT: 'More than one option is marked correct.',
  EMPTY_PROMPT: 'The question text is empty.',
  DUPLICATE_IN_TEST: (m: number) => `This looks like a duplicate of question ${m} in the test.`,
  DUPLICATE_IN_IMPORT: (n: number) => `This looks like a duplicate of imported question ${n}.`,
  MISSING_FIGURE: "The question refers to a figure that wasn't found.",
  IMAGE_WITHOUT_ALT: (k: number) => `Image ${k} has no alt text.`,
} as const;

/** The quant-paper fixture's drafts by order: their flags right after the import into the `basic` test. */
export const QUANT_PAPER_FLAGS: Record<number, Array<{ code: string; text: string }>> = {
  1: [],
  2: [{ code: 'DUPLICATE_IN_TEST', text: FLAG_TEXTS.DUPLICATE_IN_TEST(2) }],
  3: [{ code: 'MISSING_FIGURE', text: FLAG_TEXTS.MISSING_FIGURE }],
  4: [{ code: 'NO_CORRECT_ANSWER', text: FLAG_TEXTS.NO_CORRECT_ANSWER }],
  5: [],
  6: [{ code: 'TOO_FEW_OPTIONS', text: FLAG_TEXTS.TOO_FEW_OPTIONS }],
  7: [{ code: 'MULTIPLE_CORRECT', text: FLAG_TEXTS.MULTIPLE_CORRECT }],
  8: [{ code: 'DUPLICATE_IN_IMPORT', text: FLAG_TEXTS.DUPLICATE_IN_IMPORT(1) }],
  9: [{ code: 'EMPTY_PROMPT', text: FLAG_TEXTS.EMPTY_PROMPT }],
};
export const QUANT_PAPER_VALID = [1, 5] as const;
export const QUANT_PAPER_FLAGGED = [2, 3, 4, 6, 7, 8, 9] as const;

/** Usage month of the phase 6 clock (20 Oct 2026). */
export const USAGE_MONTH = '2026-10';

export type JobStatus = 'awaiting_upload' | 'queued' | 'running' | 'retrying' | 'ready' | 'failed';

export interface Draft {
  id: string;
  order: number;
  sourcePage: number;
  prompt: string;
  options: Array<{ id: string; text: string }>;
  correctOptionIds: string[];
  explanation?: string;
  difficulty?: string;
  difficultySuggested?: boolean;
  sectionName?: string;
  images: Array<{ path: string; alt: string }>;
  box?: Box;
  flags: Array<{ code: string; text: string }>;
  status: 'pending' | 'approved' | 'discarded';
  questionId?: string;
}

export interface ImportJobView {
  id: string;
  testId: string;
  filename: string;
  format: string;
  status: JobStatus;
  progress: { pagesDone: number; pagesTotal: number; questionsFound: number };
  error?: { code: string; message: string; retryable: boolean };
  retryAt?: number;
  provider?: string;
  model?: string;
  tokens?: { input: number; output: number };
  costEstimate?: number;
  createdAt: number;
  drafts: Draft[];
}

export interface CreatedImport {
  id: string;
  status: string;
  uploadUrl: string;
  uploadExpiresAt: number;
}

const key = () => ({ 'idempotency-key': randomUUID() });

/** The `error.message` and `error.details` of an API-01 error body. */
export function errorOf(res: ApiResponse<unknown>): { message?: string; details?: Record<string, unknown> } {
  return (res.body as { error?: { message?: string; details?: Record<string, unknown> } } | null)?.error ?? {};
}

/** `POST /v1/imports` for this file, with a fresh (or given) Idempotency-Key. */
export function postImport(
  api: ApiClient,
  testId: string,
  f: ImportFile,
  opts: { key?: string; sizeBytes?: number; noKey?: boolean } = {},
): Promise<ApiResponse<CreatedImport>> {
  const headers: Record<string, string> = opts.noKey ? {} : opts.key ? { 'idempotency-key': opts.key } : key();
  return api.post<CreatedImport>(
    '/v1/imports',
    { testId, filename: f.name, contentType: f.contentType, sizeBytes: opts.sizeBytes ?? f.bytes.length },
    headers,
  );
}

/** PUTs bytes to a signed upload URL with no credentials; returns the HTTP status. */
/**
 * PUTs bytes to a signed upload URL with no credentials; returns the HTTP status, or 0 when the server closed the
 * connection instead of answering (a refusal too, for example of a body over the size limit).
 */
export async function uploadTo(request: APIRequestContext, url: string, f: ImportFile): Promise<number> {
  try {
    const res = await request.put(url, {
      headers: { 'content-type': f.contentType },
      data: f.bytes,
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    return res.status();
  } catch {
    return 0;
  }
}

/** An upload status that means the link refused the bytes: a 4xx answer or a closed connection. */
export const uploadRefused = (status: number) => status === 0 || (status >= 400 && status < 500);

export function startImport(api: ApiClient, jobId: string): Promise<ApiResponse<{ id: string; status: string }>> {
  return api.post<{ id: string; status: string }>(`/v1/imports/${jobId}/start`, {});
}

/** Creates the job, uploads the file and starts it; fails unless every step is accepted. Returns the job ID. */
export async function importFile(api: ApiClient, request: APIRequestContext, testId: string, f: ImportFile) {
  const created = await postImport(api, testId, f);
  expect(created.status, `POST /v1/imports ${f.name}: ${JSON.stringify(created.body)}`).toBe(201);
  expect(created.body.status).toBe('awaiting_upload');
  expect(await uploadTo(request, created.body.uploadUrl, f), `upload of ${f.name}`).toBe(200);
  const started = await startImport(api, created.body.id);
  expect(started.status, `start ${f.name}: ${JSON.stringify(started.body)}`).toBe(202);
  return created.body.id;
}

export async function getJob(api: ApiClient, jobId: string): Promise<ImportJobView> {
  const res = await api.get<ImportJobView>(`/v1/imports/${jobId}`);
  expect(res.status, `GET /v1/imports/${jobId}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body;
}

/**
 * Waits until the job reaches one of these statuses, running due tasks on each look unless `runDue` is false (a
 * held model call keeps its task in flight, so tests with a hold let the queue dispatch on its own).
 */
export async function waitForJob(
  api: ApiClient,
  testApi: TestApi,
  jobId: string,
  until: JobStatus | JobStatus[] = 'ready',
  opts: { runDue?: boolean; timeout?: number } = {},
): Promise<ImportJobView> {
  const wanted = Array.isArray(until) ? until : [until];
  let last: ImportJobView | null = null;
  await expect
    .poll(
      async () => {
        if (opts.runDue ?? true) await testApi.tasks.runDue();
        last = await getJob(api, jobId);
        return last.status;
      },
      { message: `import ${jobId} reaches ${wanted.join(' or ')}`, timeout: opts.timeout ?? 30_000 },
    )
    .toMatch(new RegExp(`^(${wanted.join('|')})$`));
  return last!;
}

/** Waits until the job view satisfies `ok` (for example a new `retryAt`), running due tasks on each look. */
export async function waitForJobState(
  api: ApiClient,
  testApi: TestApi,
  jobId: string,
  ok: (job: ImportJobView) => boolean,
  message: string,
): Promise<ImportJobView> {
  let last: ImportJobView | null = null;
  await expect
    .poll(
      async () => {
        await testApi.tasks.runDue();
        last = await getJob(api, jobId);
        return ok(last);
      },
      { message: `import ${jobId}: ${message}`, timeout: 30_000 },
    )
    .toBe(true);
  return last!;
}

/** Imports a file through the API and waits until the job is ready. */
export async function importReady(
  api: ApiClient,
  request: APIRequestContext,
  testApi: TestApi,
  testId: string,
  f: ImportFile,
): Promise<ImportJobView> {
  const id = await importFile(api, request, testId, f);
  const job = await waitForJob(api, testApi, id, ['ready', 'failed']);
  expect(job.error, `import of ${f.name} failed`).toBeUndefined();
  expect(job.status).toBe('ready');
  return job;
}

export const draftByOrder = (job: ImportJobView, order: number): Draft => {
  const d = job.drafts.find((x) => x.order === order);
  expect(d, `draft ${order} of ${job.id}`).toBeDefined();
  return d!;
};

export function approveDrafts(api: ApiClient, jobId: string, draftIds: string[]) {
  return api.post<{ questionIds: string[] }>(`/v1/imports/${jobId}/approve`, { draftIds });
}

export function discardDrafts(api: ApiClient, jobId: string, draftIds: string[]) {
  return api.post<{ discarded: number }>(`/v1/imports/${jobId}/discard`, { draftIds });
}

export function retryImport(api: ApiClient, jobId: string) {
  return api.post<{ id: string; status: string }>(`/v1/imports/${jobId}/retry`, {});
}

/** The text of the option a draft or question marks correct (single answer), or undefined. */
export function correctText(q: { options: Array<{ id: string; text: string }>; correctOptionIds: string[] }) {
  return q.options.find((o) => q.correctOptionIds.includes(o.id))?.text;
}

// ---------- stored state ----------

export async function storedJob(e: Emulators, orgId: string, jobId: string): Promise<Record<string, unknown>> {
  const doc = await e.doc(`organizations/${orgId}/importJobs/${jobId}`);
  expect(doc, `import job ${jobId} in ${orgId}`).not.toBeNull();
  return doc!.data;
}

export async function storedJobs(e: Emulators, orgId: string): Promise<StoredDoc[]> {
  return e.list(`organizations/${orgId}`, 'importJobs');
}

/** The stored drafts of a job, sorted by `order`. */
export async function storedDrafts(e: Emulators, orgId: string, jobId: string): Promise<StoredDoc[]> {
  const docs = await e.list(`organizations/${orgId}/importJobs/${jobId}`, 'drafts');
  return docs.sort((a, b) => Number(a.data.order) - Number(b.data.order));
}

/** The org's `aiImports` counter for the month (0 when the usage record or field does not exist). */
export async function aiImportsUsed(e: Emulators, orgId: string, month: string = USAGE_MONTH): Promise<number> {
  const doc = await e.doc(`organizations/${orgId}/usage/${month}`);
  return Number(doc?.data.aiImports ?? 0);
}

/** Pending import tasks of this job (path `/tasks/import`, name containing the job ID). */
export async function importTasks(testApi: TestApi, jobId: string) {
  return (await testApi.tasks.pending()).filter((t) => t.path === '/tasks/import' && t.name.includes(jobId));
}

/** Sets the org's monthly AI import limit through the platform API (phase 1 entitlements). */
export async function setAiImportLimit(superAdmin: ApiClient, orgId: string, max: number): Promise<void> {
  const res = await superAdmin.put(`/v1/platform/orgs/${orgId}/entitlements`, {
    featureOverrides: {},
    limitOverrides: { ai_imports_per_month: max },
  });
  expect(res.status, `entitlements: ${JSON.stringify(res.body)}`).toBe(200);
}

// ---------- Storage emulator ----------

const STORAGE = 'http://127.0.0.1:9199';
const BUCKET = 'demo-mitaoe.appspot.com';
const objectUrl = (path: string) => `${STORAGE}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}`;

/** Metadata of a Storage emulator object (owner credential, rules bypassed), or null when there is none. */
export async function storageObject(
  request: APIRequestContext,
  path: string,
): Promise<{ size: number; contentType: string } | null> {
  const res = await request.get(objectUrl(path), {
    headers: { authorization: 'Bearer owner' },
    failOnStatusCode: false,
  });
  if (res.status() === 404) return null;
  expect(res.status(), `storage ${path}: ${await res.text()}`).toBe(200);
  const meta = (await res.json()) as { size: string | number; contentType?: string };
  return { size: Number(meta.size), contentType: meta.contentType ?? '' };
}

/** The bytes of a Storage emulator object, or null when there is none. */
export async function storageBytes(request: APIRequestContext, path: string): Promise<Buffer | null> {
  const res = await request.get(`${objectUrl(path)}?alt=media`, {
    headers: { authorization: 'Bearer owner' },
    failOnStatusCode: false,
  });
  if (res.status() === 404) return null;
  expect(res.status(), `storage ${path}`).toBe(200);
  return res.body();
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const isPng = (b: Buffer | null) => !!b && b.subarray(0, 8).equals(PNG_SIGNATURE);
