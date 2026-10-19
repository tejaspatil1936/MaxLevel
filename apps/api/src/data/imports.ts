import type { ImportDraft, ImportError, ImportFormat, ImportProgress, ImportStatus } from '@mitaoe/shared';
import { FieldValue, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
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

/** A stored draft; `refersToFigure` is the model's word that the question needs a figure (IMP-09). */
export type StoredDraft = Omit<ImportDraft, 'id'> & { id: string; refersToFigure?: boolean };
/** Draft fields to write; `null` removes a field. */
export type DraftWrite = { [K in keyof Omit<StoredDraft, 'id'>]?: StoredDraft[K] | null };

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

    /** The job, read in a transaction so the writes it decides on commit only if it is unchanged. */
    async readImport(orgId: string, tx: Transaction, jobId: string): Promise<ImportJobRecord | null> {
      const d = await tx.get(col(orgId).doc(jobId));
      return d.exists ? read(d) : null;
    },

    /** The job's drafts in `order`, read in a transaction (edits, approval and discard recheck every pending one). */
    async readDrafts(orgId: string, tx: Transaction, jobId: string): Promise<StoredDraft[]> {
      const snap = await tx.get(col(orgId).doc(jobId).collection('drafts').orderBy('order'));
      return snap.docs.map((d) => ({ ...(d.data() as Omit<StoredDraft, 'id'>), id: d.id }));
    },

    writeDraft(orgId: string, tx: Tx, jobId: string, draftId: string, fields: DraftWrite): void {
      writer(tx).update(
        col(orgId).doc(jobId).collection('drafts').doc(draftId),
        Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? FieldValue.delete() : v])),
      );
    },

    /**
     * An admin's retry of a failed job (REL-06): back to `queued` with its error, wait and failure count cleared. The
     * pages done, their drafts, the AI counter (`aiCounted`) and the usage so far are kept.
     */
    requeue(orgId: string, tx: Tx, jobId: string): void {
      writer(tx).update(col(orgId).doc(jobId), {
        status: 'queued',
        error: FieldValue.delete(),
        retryAt: FieldValue.delete(),
        failures: 0,
      });
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
