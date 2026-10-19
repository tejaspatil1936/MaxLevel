import type { ImportDraft, ImportError, ImportFormat, ImportProgress, ImportStatus } from '@mitaoe/shared';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { writer, type Tx } from './tx';

/**
 * `organizations/{orgId}/importJobs/{jobId}` (docs/testids/phase-6.md "Job record"): the API stores it awaiting the
 * upload and starts it; the worker fills in progress, drafts and the model's usage.
 */
export interface ImportJobRecord {
  id: string;
  orgId: string;
  testId: string;
  /** As the admin's file was named. */
  filename: string;
  format: ImportFormat;
  contentType: string;
  /** The declared size; the upload link and the start check the real one. */
  sizeBytes: number;
  filePath: string;
  status: ImportStatus;
  progress: ImportProgress;
  error?: ImportError;
  retryAt?: number;
  aiCounted?: boolean;
  provider?: string;
  model?: string;
  tokens?: { input: number; output: number };
  costEstimate?: number;
  createdBy: string;
  createdAt: number;
  startedAt?: number;
}

export type StoredDraft = Omit<ImportDraft, 'id'> & { id: string };

export function importsData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/importJobs`);
  const read = (d: DocumentSnapshot) => ({ ...(d.data() as Omit<ImportJobRecord, 'id'>), id: d.id });

  return {
    /** A new job ID in the organization, for the record and its audit entry written in one batch. */
    newImportId(orgId: string): string {
      return col(orgId).doc().id;
    },

    addImport(orgId: string, tx: Tx, rec: Omit<ImportJobRecord, 'orgId'>): void {
      const { id, ...fields } = rec;
      writer(tx).create(col(orgId).doc(id), { ...fields, orgId });
    },

    /** A job of this organization, or null (another organization's job is not found, ORG-05). */
    async getImport(orgId: string, jobId: string): Promise<ImportJobRecord | null> {
      const d = await col(orgId).doc(jobId).get();
      return d.exists ? read(d) : null;
    },

    /** The test's jobs, newest first, each with its number of pending drafts. */
    async listImports(orgId: string, testId: string): Promise<Array<ImportJobRecord & { pendingCount: number }>> {
      const snap = await col(orgId).where('testId', '==', testId).get();
      const jobs = snap.docs.map(read).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      return Promise.all(
        jobs.map(async (job) => {
          if (job.status !== 'ready') return { ...job, pendingCount: 0 };
          const pending = await col(orgId)
            .doc(job.id)
            .collection('drafts')
            .where('status', '==', 'pending')
            .count()
            .get();
          return { ...job, pendingCount: pending.data().count };
        }),
      );
    },

    /** The job's drafts in `order`. */
    async listDrafts(orgId: string, jobId: string): Promise<StoredDraft[]> {
      const snap = await col(orgId).doc(jobId).collection('drafts').orderBy('order').get();
      return snap.docs.map((d) => ({ ...(d.data() as Omit<StoredDraft, 'id'>), id: d.id }));
    },

    /**
     * Moves a job awaiting its upload to `queued`, or to `failed` with `error` when a start check refused it, in a
     * transaction. Returns the status the job has afterwards and whether this call changed it, so a repeated or
     * concurrent start queues nothing new.
     */
    async leaveAwaitingUpload(
      orgId: string,
      jobId: string,
      now: number,
      outcome: { status: 'queued' } | { status: 'failed'; error: ImportError },
    ): Promise<{ changed: boolean; status: ImportStatus } | null> {
      const ref = col(orgId).doc(jobId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const status = snap.get('status') as ImportStatus;
        if (status !== 'awaiting_upload') return { changed: false, status };
        tx.update(ref, { ...outcome, startedAt: now });
        return { changed: true, status: outcome.status };
      });
    },
  };
}
