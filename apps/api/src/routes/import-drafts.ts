import {
  importApprovedSchema,
  importDiscardedSchema,
  importDraftIdsSchema,
  importDraftPatchSchema,
  importDraftSchema,
  importFiguresFolder,
} from '@mitaoe/shared';
import type { Transaction } from 'firebase-admin/firestore';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ImportJobRecord, StoredDraft } from '../data/imports';
import { AppError, notFound } from '../errors';
import { applyWrite, changedFlags, draftEdit, pendingFlags } from '../services/import-drafts';
import { questionImagePrefix } from '../services/question-images';
import { attemptsStarted, returnsToReview, testLocked } from '../services/test-review';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });
const draftParams = idParams.extend({ draftId: z.string().min(1).max(128) });

const notPending = (draftIds: string[]) =>
  new AppError(409, 'DRAFT_NOT_PENDING', 'This question was already approved or discarded.', { draftIds });

/** The listed drafts in `order`; every one must exist (404) and be pending (409 DRAFT_NOT_PENDING). */
function pendingListed(drafts: StoredDraft[], ids: readonly string[]): StoredDraft[] {
  const listed = ids.map((id) => drafts.find((d) => d.id === id));
  if (listed.some((d) => !d)) throw notFound('Draft');
  const done = listed.filter((d) => d!.status !== 'pending').map((d) => d!.id);
  if (done.length) throw notPending(done);
  return (listed as StoredDraft[]).sort((a, b) => a.order - b.order);
}

/** IMP-10: a draft with a flag cannot be approved until it is fixed. */
function refuseFlagged(listed: StoredDraft[]): void {
  const flagged = listed.filter((d) => d.flags.length > 0).map((d) => d.id);
  if (flagged.length)
    throw new AppError(409, 'DRAFTS_FLAGGED', 'Fix the reasons listed before approving these questions.', {
      draftIds: flagged,
    });
}

/**
 * The review of an import's drafts (IMP-11, docs/testids/phase-6.md): an edit of a pending draft and the discard of
 * some, each checking every pending draft again in the same transaction, so the stored flags always match what is
 * pending. Drafts can change only once the job is `ready`; another organization's job is not found (ORG-05).
 */
export function importDraftRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock } = ctx;
  const db = ctx.firebase.db;

  /** The organization's job, once it is ready, and the prompts of its test's questions for the duplicate check. */
  const readyJob = async (orgId: string, jobId: string) => {
    const job = await data.imports.getImport(orgId, jobId);
    if (!job) throw notFound('Import');
    if (job.status !== 'ready') throw new AppError(409, 'IMPORT_NOT_READY', 'This import is still being read.');
    return { job, testQuestions: await data.questions.listQuestions(orgId, job.testId) };
  };

  /** Writes the new flags of every pending draft whose flags changed (IMP-09). */
  const writeFlags = (
    orgId: string,
    tx: Transaction,
    job: ImportJobRecord,
    drafts: StoredDraft[],
    testQuestions: Array<{ prompt: string }>,
    except?: string,
  ) => {
    const flags = pendingFlags(drafts, testQuestions);
    for (const [id, f] of changedFlags(drafts, flags))
      if (id !== except) data.imports.writeDraft(orgId, tx, job.id, id, { flags: f });
    return flags;
  };

  return async (app) => {
    app.patch(
      '/v1/imports/:id/drafts/:draftId',
      {
        config: admin,
        schema: { params: draftParams, body: importDraftPatchSchema, response: { 200: importDraftSchema } },
      },
      async (req) => {
        const orgId = req.orgId!;
        const { job, testQuestions } = await readyJob(orgId, req.params.id);
        return db.runTransaction(async (tx) => {
          const drafts = await data.imports.readDrafts(orgId, tx, job.id);
          const draft = drafts.find((d) => d.id === req.params.draftId);
          if (!draft) throw notFound('Draft');
          if (draft.status !== 'pending') throw notPending([draft.id]);
          const write = draftEdit(draft, req.body);
          const edited = applyWrite(draft, write);
          const all = drafts.map((d) => (d.id === draft.id ? edited : d));
          const flags = writeFlags(orgId, tx, job, all, testQuestions, draft.id);
          const own = flags.get(draft.id) ?? [];
          data.imports.writeDraft(orgId, tx, job.id, draft.id, { ...write, flags: own });
          return { ...edited, flags: own };
        });
      },
    );

    app.post(
      '/v1/imports/:id/discard',
      {
        config: admin,
        schema: { params: idParams, body: importDraftIdsSchema, response: { 200: importDiscardedSchema } },
      },
      async (req) => {
        const orgId = req.orgId!;
        const { job, testQuestions } = await readyJob(orgId, req.params.id);
        const ids = [...new Set(req.body.draftIds)];
        return db.runTransaction(async (tx) => {
          const drafts = await data.imports.readDrafts(orgId, tx, job.id);
          pendingListed(drafts, ids);
          const all = drafts.map((d) => (ids.includes(d.id) ? { ...d, status: 'discarded' as const } : d));
          for (const id of ids) data.imports.writeDraft(orgId, tx, job.id, id, { status: 'discarded' });
          writeFlags(orgId, tx, job, all, testQuestions);
          audit(req, tx, {
            action: 'import.discard',
            target: { type: 'importJob', id: job.id },
            after: { count: ids.length },
          });
          return { discarded: ids.length };
        });
      },
    );

    // IMP-12, US-AD-06: the listed drafts become questions of the test, appended in draft order, in one transaction
    // with their drafts marked approved and the question.import entry. Nothing reaches the test before this.
    app.post(
      '/v1/imports/:id/approve',
      {
        config: admin,
        schema: { params: idParams, body: importDraftIdsSchema, response: { 200: importApprovedSchema } },
      },
      async (req) => {
        const orgId = req.orgId!;
        const { job, testQuestions } = await readyJob(orgId, req.params.id);
        const ids = [...new Set(req.body.draftIds)];
        const before = pendingListed(await data.imports.listDrafts(orgId, job.id), ids);
        refuseFlagged(before);
        const test = await data.tests.getTest(orgId, job.testId);
        if (!test) throw notFound('Test');
        if (await attemptsStarted(data, orgId, test)) throw testLocked('questions');

        // Each image is copied from the job's figures into the test's images folder, named there (A11Y-10).
        const figures = importFiguresFolder(orgId, job.id);
        const copied = new Map<string, string>();
        for (const d of before)
          for (const [k, img] of d.images.entries()) {
            if (!img.path.startsWith(figures)) throw notFound('Image');
            const to = `${questionImagePrefix(orgId, test.id)}import-${job.id}-${d.id}-${k + 1}.png`;
            await ctx.firebase.bucket.file(img.path).copy(ctx.firebase.bucket.file(to));
            copied.set(img.path, to);
          }

        const source = job.provider ? ('ai' as const) : ('json' as const);
        const sectionOf = (name?: string) =>
          name ? test.sections.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase())?.id : undefined;
        return db.runTransaction(async (tx) => {
          const drafts = await data.imports.readDrafts(orgId, tx, job.id);
          const listed = pendingListed(drafts, ids);
          refuseFlagged(listed);
          const now = clock.now();
          const last = Math.max(0, ...testQuestions.map((q) => q.order));
          const questionIds = listed.map((d, i) => {
            const sectionId = sectionOf(d.sectionName);
            const questionId = data.questions.createQuestion(
              orgId,
              tx,
              test.id,
              {
                order: last + i + 1,
                prompt: d.prompt,
                options: d.options,
                correctOptionIds: d.correctOptionIds,
                ...(d.explanation !== undefined ? { explanation: d.explanation } : {}),
                ...(d.difficulty !== undefined ? { difficulty: d.difficulty } : {}),
                ...(sectionId ? { sectionId } : {}),
                images: d.images.map((img) => ({ path: copied.get(img.path)!, alt: img.alt })),
                tags: [],
                source:
                  source === 'ai' ? { kind: 'ai', jobId: job.id, page: d.sourcePage } : { kind: 'json', jobId: job.id },
                status: 'approved',
              },
              now,
            );
            data.imports.writeDraft(orgId, tx, job.id, d.id, { status: 'approved', questionId });
            return questionId;
          });
          const approved = new Set(ids);
          const rest = drafts.map((d) => (approved.has(d.id) ? { ...d, status: 'approved' as const } : d));
          writeFlags(orgId, tx, job, rest, [...testQuestions, ...listed]);
          const review = returnsToReview(test, false) || test.status === 'draft';
          data.tests.questionsChanged(orgId, tx, test.id, now, review ? 'in_review' : undefined);
          audit(req, tx, {
            action: 'question.import',
            target: { type: 'test', id: test.id },
            after: { count: questionIds.length, ids: questionIds, jobId: job.id },
          });
          return { questionIds };
        });
      },
    );
  };
}
