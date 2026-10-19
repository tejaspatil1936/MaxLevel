import { importDiscardedSchema, importDraftIdsSchema, importDraftPatchSchema, importDraftSchema } from '@mitaoe/shared';
import type { Transaction } from 'firebase-admin/firestore';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ImportJobRecord, StoredDraft } from '../data/imports';
import { AppError, notFound } from '../errors';
import { applyWrite, changedFlags, draftEdit, pendingFlags } from '../services/import-drafts';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });
const draftParams = idParams.extend({ draftId: z.string().min(1).max(128) });

export const notPending = (draftIds: string[]) =>
  new AppError(409, 'DRAFT_NOT_PENDING', 'This question was already approved or discarded.', { draftIds });

/**
 * The review of an import's drafts (IMP-11, docs/testids/phase-6.md): an edit of a pending draft and the discard of
 * some, each checking every pending draft again in the same transaction, so the stored flags always match what is
 * pending. Drafts can change only once the job is `ready`; another organization's job is not found (ORG-05).
 */
export function importDraftRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit } = ctx;
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
          const drafts = await data.imports.readDrafts(tx, orgId, job.id);
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
          const drafts = await data.imports.readDrafts(tx, orgId, job.id);
          const listed = ids.map((id) => drafts.find((d) => d.id === id));
          if (listed.some((d) => !d)) throw notFound('Draft');
          const done = listed.filter((d) => d!.status !== 'pending').map((d) => d!.id);
          if (done.length) throw notPending(done);
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
  };
}
