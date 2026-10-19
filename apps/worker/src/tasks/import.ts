import {
  costEstimateUsd,
  draftsFromModel,
  extractionPrompt,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_PDF_PAGES,
  IMPORT_MAX_SHEET_ROWS,
  IMPORT_MESSAGES,
  IMPORT_SIGNATURE_BYTES,
  importFlags,
  importRetryDelayMs,
  importRetryTask,
  jsonQuestionsToDrafts,
  LlmAnswerSchema,
  monthKey,
  parseQuestionJson,
  sheetParts,
  sheetRowCount,
  signatureMatches,
  templateRowsToDrafts,
  textParts,
  type Clock,
  type DraftInput,
  type ImportError,
  type TaskQueue,
} from '@mitaoe/shared';
import { z } from 'zod';
import type { FileStore } from '../firebase';
import type { ImportData, ImportJob } from '../import-data';
import { readCsv, readPdf, readXlsx, utf8Text } from '../import-files';
import { storePdfPage } from './import-pages';
import { LlmUnavailableError, type LlmDriver, type LlmPart, type LlmResponse } from '../llm/driver';

export const importPayloadSchema = z.object({
  orgId: z.string().min(1).max(128),
  jobId: z.string().min(1).max(128),
});
export type ImportRun = z.infer<typeof importPayloadSchema>;

type ImportTokens = { input: number; output: number };

/** A pino or Fastify logger. */
export interface ImportLog {
  info(obj: object, msg: string): void;
}

/** One page (PDF) or part (TXT, MD, a sheet outside the template) the model reads. */
type ModelPart = { text: string } | { file: () => Promise<Uint8Array> };
/** What reading the file gave: drafts read directly, parts for the model, or a refusal. */
type Read = { drafts: DraftInput[] } | { parts: ModelPart[]; sheet: boolean } | { error: ImportError };

const refused = (code: string, message: string, retryable = false): { error: ImportError } => ({
  error: { code, message, retryable },
});
const LLM_UNAVAILABLE = refused('LLM_UNAVAILABLE', IMPORT_MESSAGES.llmUnavailable, true);

/** Reads the stored file by its format, after the size and signature checks (SEC-06), with the IMP-02 limits. */
async function readSource(job: ImportJob, bytes: Buffer): Promise<Read> {
  const mismatch = refused('FILE_SIGNATURE_MISMATCH', IMPORT_MESSAGES.mismatch(job.format));
  if (bytes.length > IMPORT_MAX_BYTES) return refused('FILE_TOO_LARGE', IMPORT_MESSAGES.tooLarge);
  if (!signatureMatches(job.format, bytes.subarray(0, IMPORT_SIGNATURE_BYTES))) return mismatch;
  switch (job.format) {
    case 'json': {
      let parsed: ReturnType<typeof parseQuestionJson> | null = null;
      try {
        parsed = parseQuestionJson(JSON.parse(utf8Text(bytes)));
      } catch {
        parsed = null;
      }
      if (!parsed || 'error' in parsed) return refused('INVALID_FILE', IMPORT_MESSAGES.invalidJson);
      return { drafts: jsonQuestionsToDrafts(parsed.questions) };
    }
    case 'pdf': {
      const pdf = await readPdf(bytes);
      if (!pdf) return mismatch;
      if (pdf.pageCount > IMPORT_MAX_PDF_PAGES)
        return refused('TOO_MANY_PAGES', IMPORT_MESSAGES.tooManyPages(pdf.pageCount));
      return {
        parts: Array.from({ length: pdf.pageCount }, (_, i) => ({ file: () => pdf.page(i + 1) })),
        sheet: false,
      };
    }
    case 'csv':
    case 'xlsx': {
      const sheet = job.format === 'csv' ? readCsv(bytes) : await readXlsx(bytes);
      if (!sheet) return mismatch;
      if ('unzippedTooLarge' in sheet) return refused('INVALID_FILE', IMPORT_MESSAGES.unzippedTooLarge);
      if ('tooManyRows' in sheet) return refused('TOO_MANY_ROWS', IMPORT_MESSAGES.tooManyRows(sheet.tooManyRows));
      const { rows } = sheet;
      const count = sheetRowCount(rows);
      if (count > IMPORT_MAX_SHEET_ROWS) return refused('TOO_MANY_ROWS', IMPORT_MESSAGES.tooManyRows(count));
      const template = templateRowsToDrafts(rows);
      if (!('error' in template)) return { drafts: template };
      return { parts: sheetParts(rows).map((text) => ({ text })), sheet: true };
    }
    case 'txt':
    case 'md':
      return { parts: textParts(utf8Text(bytes), job.format).map((text) => ({ text })), sheet: false };
  }
}

/**
 * /tasks/import (spec 6.2; docs/testids/phase-6.md "Worker pipeline"): sets the job `running`, checks the stored file
 * again (size, signature) and its page or row limit before any model call, reads JSON and template sheets directly,
 * and sends every other file to the model one page (or part) per call, in page order, one call at a time, saving each
 * page's drafts with the progress. An AI job is counted once against `ai_imports_per_month` before its first call
 * (IMP-08). A model failure (a provider error or an answer outside LlmAnswerSchema) stops at that page: the job waits
 * `retrying` for 1, 2, then 4 minutes, with the next run queued at `retryAt`, which resumes at the first page not done;
 * the fourth failure in a row fails it, retryable by an admin (REL-06). When every page is done the checks run on
 * every draft and the job is `ready`. A job that is not started, already finished, or still waiting for its retry is
 * left as it is, so a task delivered twice or early changes nothing.
 */
export function importHandler(deps: {
  imports: ImportData;
  files: FileStore;
  clock: Clock;
  queue: TaskQueue;
  llm?: LlmDriver;
  /** Where the `import.job.done` line goes (the task route's logger). */
  log?: ImportLog;
}) {
  const { imports: data, files, clock, queue, llm, log } = deps;

  return async ({ orgId, jobId }: ImportRun): Promise<string> => {
    const job = await data.getJob(orgId, jobId);
    if (!job || !(await data.claim(orgId, jobId, clock.now()))) return 'skipped';
    const fail = async ({ error }: { error: ImportError }) => {
      await data.update(orgId, jobId, { status: 'failed', error });
      return `failed: ${error.code}`;
    };

    const bytes = await files.read(job.filePath);
    if (!bytes) return fail(refused('UPLOAD_MISSING', IMPORT_MESSAGES.uploadMissing));
    const read = await readSource(job, bytes);
    if ('error' in read) return fail(read);

    let progress = { ...job.progress };
    let modelUsage: { provider: string; model: string; tokens: ImportTokens; costEstimate: number } | undefined;
    if ('drafts' in read) {
      progress = { pagesDone: 1, pagesTotal: 1, questionsFound: read.drafts.length };
      await data.saveDrafts(orgId, jobId, read.drafts, { progress });
    } else {
      const ent = await data.entitlements(orgId);
      if (!ent) return 'skipped';
      if (read.sheet && !ent.features.ai_question_import)
        return fail(refused('FEATURE_DISABLED', IMPORT_MESSAGES.aiOff));
      if (!llm) return fail(LLM_UNAVAILABLE);
      const limit = ent.limits.ai_imports_per_month;
      if (!(await data.countAiImport(orgId, jobId, monthKey(clock.now(), ent.timezone), limit)))
        return fail(refused('LIMIT_REACHED', IMPORT_MESSAGES.limitReached(limit)));

      progress.pagesTotal = read.parts.length;
      let tokens = job.tokens ?? { input: 0, output: 0 };
      /** What the job records of the model (IMP-07): the tokens of every successful call and their estimated cost. */
      const usage = () => ({
        provider: llm.provider,
        model: llm.model,
        tokens,
        costEstimate: costEstimateUsd(tokens, llm.prices),
      });
      /** Keeps the pages done and waits to retry, or fails on the fourth failure in a row (REL-06). */
      const modelFailed = async (): Promise<string> => {
        const failures = (job.failures ?? 0) + 1;
        const delay = importRetryDelayMs(failures);
        if (delay === null) {
          await data.update(orgId, jobId, { ...usage(), failures });
          return fail(refused('LLM_UNAVAILABLE', IMPORT_MESSAGES.llmGaveUp, true));
        }
        const retryAt = clock.now() + delay;
        await queue.enqueue(importRetryTask(orgId, jobId, `retry-${failures}-${retryAt}`, retryAt));
        await data.update(orgId, jobId, {
          ...usage(),
          failures,
          status: 'retrying',
          error: LLM_UNAVAILABLE.error,
          retryAt,
        });
        return `retrying at ${retryAt}`;
      };
      await data.update(orgId, jobId, { progress });
      const hints =
        progress.pagesDone > 0 ? [...new Set((await data.listDrafts(orgId, jobId)).map((d) => d.sectionName))] : [];
      for (let page = progress.pagesDone + 1; page <= read.parts.length; page++) {
        const part = read.parts[page - 1]!;
        const prompt = extractionPrompt({
          page,
          ...('text' in part ? { text: part.text } : {}),
          hasPageFile: 'file' in part,
          sectionHints: hints.filter((h): h is string => !!h),
        });
        const parts: LlmPart[] = [{ type: 'text', text: prompt.userText }];
        const pageFile = 'file' in part ? await part.file() : null;
        if (pageFile) parts.push({ type: 'file', mediaType: 'application/pdf', data: pageFile });
        let res: LlmResponse;
        try {
          res = await llm.generate({ page, system: prompt.system, parts });
        } catch (err) {
          if (!(err instanceof LlmUnavailableError)) throw err;
          return modelFailed();
        }
        const answer = LlmAnswerSchema.safeParse(res.output);
        if (!answer.success) return modelFailed();
        tokens = { input: tokens.input + res.usage.inputTokens, output: tokens.output + res.usage.outputTokens };
        let drafts = draftsFromModel(page, answer.data.questions, progress.questionsFound + 1);
        if (pageFile)
          drafts = await storePdfPage({ files, ...(log ? { log } : {}) }, { orgId, jobId, page }, pageFile, drafts);
        for (const d of drafts) if (d.sectionName && !hints.includes(d.sectionName)) hints.push(d.sectionName);
        progress = { ...progress, pagesDone: page, questionsFound: progress.questionsFound + drafts.length };
        job.failures = 0;
        await data.saveDrafts(orgId, jobId, drafts, { progress, failures: 0, ...usage() });
      }
      modelUsage = usage();
    }

    // Every page is done: the checks run on every draft, in order (IMP-09).
    const [drafts, testQuestions] = await Promise.all([
      data.listDrafts(orgId, jobId),
      data.testQuestions(orgId, job.testId),
    ]);
    const flags = new Map(
      drafts.map((d, i) => [d.id, importFlags(d, { earlierPending: drafts.slice(0, i), testQuestions })] as const),
    );
    await data.finish(orgId, jobId, flags, { status: 'ready', progress });
    // IMP-07: one structured line per finished job, with the model's usage when the model was used.
    log?.info(
      {
        event: 'import.job.done',
        orgId,
        jobId,
        format: job.format,
        pages: progress.pagesTotal,
        drafts: drafts.length,
        ...modelUsage,
      },
      'import.job.done',
    );
    return `ready: ${drafts.length} drafts`;
  };
}
