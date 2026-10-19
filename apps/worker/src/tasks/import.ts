import {
  draftsFromModel,
  extractionPrompt,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_PDF_PAGES,
  IMPORT_MAX_SHEET_ROWS,
  IMPORT_MESSAGES,
  IMPORT_SIGNATURE_BYTES,
  importFlags,
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
} from '@mitaoe/shared';
import { z } from 'zod';
import type { FileStore } from '../firebase';
import type { ImportData, ImportJob } from '../import-data';
import { readCsv, readPdf, readXlsx, utf8Text } from '../import-files';
import { LlmUnavailableError, type LlmDriver, type LlmPart } from '../llm/driver';

export const importPayloadSchema = z.object({
  orgId: z.string().min(1).max(128),
  jobId: z.string().min(1).max(128),
});
export type ImportRun = z.infer<typeof importPayloadSchema>;

/** One page (PDF) or part (TXT, MD, a sheet outside the template) the model reads. */
type ModelPart = { text: string } | { file: () => Promise<Uint8Array> };
/** What reading the file gave: drafts read directly, parts for the model, or a refusal. */
type Read = { drafts: DraftInput[] } | { parts: ModelPart[]; sheet: boolean } | { error: ImportError };

const refused = (code: string, message: string, retryable = false): { error: ImportError } => ({
  error: { code, message, retryable },
});
const LLM_UNAVAILABLE = refused('LLM_UNAVAILABLE', "The AI service didn't answer.", true);

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
      const rows = job.format === 'csv' ? readCsv(bytes) : await readXlsx(bytes);
      if (!rows) return mismatch;
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
 * (IMP-08). When every page is done the checks run on every draft and the job is `ready`. A job that is not started,
 * or already finished, is left as it is, so a task delivered twice changes nothing.
 */
export function importHandler(deps: { imports: ImportData; files: FileStore; clock: Clock; llm?: LlmDriver }) {
  const { imports: data, files, clock, llm } = deps;

  return async ({ orgId, jobId }: ImportRun): Promise<string> => {
    const job = await data.getJob(orgId, jobId);
    if (!job || !(await data.claim(orgId, jobId))) return 'skipped';
    const fail = async ({ error }: { error: ImportError }) => {
      await data.update(orgId, jobId, { status: 'failed', error });
      return `failed: ${error.code}`;
    };

    const bytes = await files.read(job.filePath);
    if (!bytes) return fail(refused('UPLOAD_MISSING', IMPORT_MESSAGES.uploadMissing));
    const read = await readSource(job, bytes);
    if ('error' in read) return fail(read);

    let progress = { ...job.progress };
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
      const usedModel = { provider: llm.provider, model: llm.model };
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
        if ('file' in part) parts.push({ type: 'file', mediaType: 'application/pdf', data: await part.file() });
        let output: unknown;
        try {
          const res = await llm.generate({ page, system: prompt.system, parts });
          output = res.output;
          tokens = { input: tokens.input + res.usage.inputTokens, output: tokens.output + res.usage.outputTokens };
        } catch (err) {
          if (!(err instanceof LlmUnavailableError)) throw err;
          await data.update(orgId, jobId, { ...usedModel, tokens });
          return fail(LLM_UNAVAILABLE);
        }
        const answer = LlmAnswerSchema.safeParse(output);
        if (!answer.success) {
          await data.update(orgId, jobId, { ...usedModel, tokens });
          return fail(LLM_UNAVAILABLE);
        }
        const drafts = draftsFromModel(page, answer.data.questions, progress.questionsFound + 1);
        for (const d of drafts) if (d.sectionName && !hints.includes(d.sectionName)) hints.push(d.sectionName);
        progress = { ...progress, pagesDone: page, questionsFound: progress.questionsFound + drafts.length };
        await data.saveDrafts(orgId, jobId, drafts, { progress, tokens, ...usedModel });
      }
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
    return `ready: ${drafts.length} drafts`;
  };
}
