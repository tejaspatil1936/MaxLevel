import {
  featureMapSchema,
  limitMapSchema,
  resolveEntitlements,
  type DraftInput,
  type Entitlements,
  type ImportError,
  type ImportFormat,
  type ImportProgress,
  type ImportStatus,
} from '@mitaoe/shared';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

// The import task's data access (ORG-03: orgId first): the job record and its drafts
// (docs/testids/phase-6.md "Job record", "Draft"), the AI import counter (IMP-08) and what the checks read.

export interface ImportJob {
  id: string;
  testId: string;
  filename: string;
  format: ImportFormat;
  filePath: string;
  status: ImportStatus;
  progress: ImportProgress;
  aiCounted?: boolean;
  tokens?: { input: number; output: number };
  /** Model failures in a row (REL-06); a page read by the model sets it back to 0. */
  failures?: number;
}

/** What the task records as it goes; `error` and `retryAt` are removed when not given. */
export interface ImportUpdate {
  status?: ImportStatus;
  progress?: ImportProgress;
  error?: ImportError | null;
  /** When a job `retrying` runs again; removed by any other status. */
  retryAt?: number;
  failures?: number;
  provider?: string;
  model?: string;
  tokens?: { input: number; output: number };
}

/** A stored draft, before and after the checks. */
export type StoredDraftFields = Omit<DraftInput, 'figure'> & {
  flags: Array<{ code: string; text: string }>;
  status: 'pending';
};

/** Draft IDs follow `order`, so a task delivered twice writes the same drafts again. */
export const draftId = (order: number) => `d${String(order).padStart(4, '0')}`;

export function importData(db: Firestore) {
  const job = (orgId: string, jobId: string) => db.doc(`organizations/${orgId}/importJobs/${jobId}`);

  return {
    async getJob(orgId: string, jobId: string): Promise<ImportJob | null> {
      const d = await job(orgId, jobId).get();
      return d.exists ? ({ ...d.data(), id: d.id } as ImportJob) : null;
    },

    /**
     * Moves a started job to `running`, clearing a retry's wait; false (changing nothing) unless it is queued, running
     * or retrying with its `retryAt` reached, so an early or repeated delivery of a task leaves the wait as it is.
     */
    async claim(orgId: string, jobId: string, now: number): Promise<boolean> {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(job(orgId, jobId));
        const status = snap.get('status') as string;
        if (!['queued', 'running', 'retrying'].includes(status)) return false;
        if (status === 'retrying' && Number(snap.get('retryAt') ?? 0) > now) return false;
        tx.update(job(orgId, jobId), { status: 'running', error: FieldValue.delete(), retryAt: FieldValue.delete() });
        return true;
      });
    },

    async update(orgId: string, jobId: string, u: ImportUpdate): Promise<void> {
      const { error, ...rest } = u;
      await job(orgId, jobId).update({
        ...rest,
        ...(error === undefined ? {} : { error: error ?? FieldValue.delete() }),
        ...(u.status && u.status !== 'retrying' ? { retryAt: FieldValue.delete() } : {}),
      });
    },

    /**
     * Counts the job as one AI import of the month, once (IMP-08): in one transaction, unless `aiCounted` is set it
     * raises `usage/{month}.aiImports` when below `limit` and sets `aiCounted`. False at the limit, changing nothing.
     */
    async countAiImport(orgId: string, jobId: string, month: string, limit: number): Promise<boolean> {
      const usage = db.doc(`organizations/${orgId}/usage/${month}`);
      return db.runTransaction(async (tx) => {
        const [j, u] = await Promise.all([tx.get(job(orgId, jobId)), tx.get(usage)]);
        if (j.get('aiCounted') === true) return true;
        if (((u.get('aiImports') as number | undefined) ?? 0) >= limit) return false;
        tx.set(usage, { orgId, month, aiImports: FieldValue.increment(1) }, { merge: true });
        tx.update(job(orgId, jobId), { aiCounted: true });
        return true;
      });
    },

    /** Saves one page's drafts with the job's progress in one batch. */
    async saveDrafts(orgId: string, jobId: string, drafts: DraftInput[], u: ImportUpdate): Promise<void> {
      const batch = db.batch();
      for (const { figure: _figure, ...d } of drafts)
        batch.set(job(orgId, jobId).collection('drafts').doc(draftId(d.order)), { ...d, flags: [], status: 'pending' });
      batch.update(job(orgId, jobId), { ...u });
      await batch.commit();
    },

    async listDrafts(orgId: string, jobId: string): Promise<Array<StoredDraftFields & { id: string }>> {
      const snap = await job(orgId, jobId).collection('drafts').orderBy('order').get();
      return snap.docs.map((d) => ({ ...(d.data() as StoredDraftFields), id: d.id }));
    },

    /** Stores each draft's flags and the job's final fields in one batch. */
    async finish(orgId: string, jobId: string, flags: Map<string, StoredDraftFields['flags']>, u: ImportUpdate) {
      const batch = db.batch();
      for (const [id, f] of flags) batch.update(job(orgId, jobId).collection('drafts').doc(id), { flags: f });
      batch.update(job(orgId, jobId), { ...u, error: FieldValue.delete(), retryAt: FieldValue.delete() });
      await batch.commit();
    },

    /** The prompts of the test's questions in test order, for the duplicate check. */
    async testQuestions(orgId: string, testId: string): Promise<Array<{ prompt: string }>> {
      const snap = await db.collection(`organizations/${orgId}/tests/${testId}/questions`).get();
      return snap.docs
        .map((d) => ({
          prompt: String(d.get('prompt') ?? ''),
          order: Number(d.get('order') ?? 0),
          createdAt: Number(d.get('createdAt') ?? 0),
          id: d.id,
        }))
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .map(({ prompt }) => ({ prompt }));
    },

    /** The organization's effective flags and limits (FF-01) and its timezone, as the API resolves them. */
    async entitlements(orgId: string): Promise<(Entitlements & { timezone: string }) | null> {
      const org = await db.doc(`organizations/${orgId}`).get();
      if (!org.exists) return null;
      const plan = await db.doc(`plans/${org.get('planId') ?? 'standard'}`).get();
      return {
        ...resolveEntitlements({
          orgFeatures: featureMapSchema.catch({}).parse(org.get('featureOverrides') ?? {}),
          orgLimits: limitMapSchema.catch({}).parse(org.get('limitOverrides') ?? {}),
          planFeatures: featureMapSchema.catch({}).parse(plan.get('features') ?? {}),
          planLimits: limitMapSchema.catch({}).parse(plan.get('limits') ?? {}),
        }),
        timezone: (org.get('timezone') as string | undefined) ?? 'Asia/Kolkata',
      };
    },
  };
}
export type ImportData = ReturnType<typeof importData>;
