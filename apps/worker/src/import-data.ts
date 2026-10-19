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
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';

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
  /** When a job `retrying` runs again. */
  retryAt?: number;
  /** The run that holds the job while it is `running`, until `leaseUntil` on the Clock. */
  runId?: string;
  leaseUntil?: number;
}

/** How long a claimed run holds a job: longer than one page takes (a model call times out after 120 s). */
export const IMPORT_LEASE_MS = 5 * 60_000;

/** A write of a run that no longer holds its job: another run took it over after the lease ran out. */
export class ImportLeaseLost extends Error {
  constructor() {
    super('This import run no longer holds its job.');
  }
}

/** What a claim gave: the job, now held by the run; the time another run holds it until; or nothing to do. */
export type ImportClaim = { job: ImportJob } | { heldUntil: number } | null;

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
  /** USD, from the tokens and the model's prices (IMP-07). */
  costEstimate?: number;
  /** Renews the run's lease to this time; null releases it. Any status but `running` releases it as well. */
  leaseUntil?: number | null;
}

/** The job fields an update writes. */
function updateFields(u: ImportUpdate) {
  const { error, leaseUntil, ...rest } = u;
  return {
    ...rest,
    ...(error === undefined ? {} : { error: error ?? FieldValue.delete() }),
    ...(leaseUntil === undefined ? {} : { leaseUntil: leaseUntil ?? FieldValue.delete() }),
    ...(u.status && u.status !== 'retrying' ? { retryAt: FieldValue.delete() } : {}),
    ...(u.status && u.status !== 'running' ? { leaseUntil: FieldValue.delete() } : {}),
  };
}

/** A stored draft, before and after the checks. */
export type StoredDraftFields = Omit<DraftInput, 'figure'> & {
  flags: Array<{ code: string; text: string }>;
  status: 'pending';
};

/** Firestore takes at most 500 writes and 10 MiB in one commit; drafts are written in chunks well inside both. */
export const WRITE_CHUNK_DOCS = 400;
export const WRITE_CHUNK_BYTES = 6 * 1024 * 1024;

/**
 * `items` in order, in chunks of at most WRITE_CHUNK_DOCS items and WRITE_CHUNK_BYTES of `size` each (an item larger
 * than that goes alone). Always at least one chunk, so the job's own update has a commit to go in.
 */
export function writeChunks<T>(items: readonly T[], size: (item: T) => number = jsonBytes): T[][] {
  const chunks: T[][] = [[]];
  let bytes = 0;
  for (const item of items) {
    const n = size(item);
    const last = chunks[chunks.length - 1]!;
    if (last.length > 0 && (last.length >= WRITE_CHUNK_DOCS || bytes + n > WRITE_CHUNK_BYTES)) {
      chunks.push([item]);
      bytes = n;
    } else {
      last.push(item);
      bytes += n;
    }
  }
  return chunks;
}
/** About what a document costs in a commit: its JSON in UTF-8, plus its path. */
const jsonBytes = (item: unknown) => Buffer.byteLength(JSON.stringify(item)) + 200;

/** Draft IDs follow `order`, so a task delivered twice writes the same drafts again. */
export const draftId = (order: number) => `d${String(order).padStart(4, '0')}`;

export function importData(db: Firestore) {
  const job = (orgId: string, jobId: string) => db.doc(`organizations/${orgId}/importJobs/${jobId}`);
  /** Runs `write` in a transaction only while `runId` holds the job; ImportLeaseLost otherwise, writing nothing. */
  const held = (
    orgId: string,
    jobId: string,
    runId: string,
    write: (tx: Transaction, ref: DocumentReference) => void,
  ): Promise<void> =>
    db.runTransaction(async (tx) => {
      const ref = job(orgId, jobId);
      if ((await tx.get(ref)).get('runId') !== runId) throw new ImportLeaseLost();
      write(tx, ref);
    });

  return {
    async getJob(orgId: string, jobId: string): Promise<ImportJob | null> {
      const d = await job(orgId, jobId).get();
      return d.exists ? ({ ...d.data(), id: d.id } as ImportJob) : null;
    },

    /**
     * Moves a started job to `running`, held by `runId` until `leaseUntil` (REL-06), clearing a retry's wait. Claims
     * nothing unless the job is queued, retrying with its `retryAt` reached, or running with no lease held: a job
     * another run holds gives the time it is held until, so a task delivered again starts no second run. A page
     * task's `page` must be the first page not done, so a page task delivered twice reads its page once.
     */
    async claim(
      orgId: string,
      jobId: string,
      run: { runId: string; now: number; leaseUntil: number; page?: number },
    ): Promise<ImportClaim> {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(job(orgId, jobId));
        if (!snap.exists) return null;
        const current = { ...snap.data(), id: snap.id } as ImportJob;
        const { status } = current;
        if (!['queued', 'running', 'retrying'].includes(status)) return null;
        if (status === 'retrying' && Number(current.retryAt ?? 0) > run.now) return null;
        if (status === 'running' && Number(current.leaseUntil ?? 0) > run.now)
          return { heldUntil: Number(current.leaseUntil) };
        if (run.page !== undefined && current.progress.pagesDone + 1 !== run.page) return null;
        tx.update(job(orgId, jobId), {
          status: 'running',
          runId: run.runId,
          leaseUntil: run.leaseUntil,
          error: FieldValue.delete(),
          retryAt: FieldValue.delete(),
        });
        return {
          job: { ...current, status: 'running', runId: run.runId, leaseUntil: run.leaseUntil },
        };
      });
    },

    async update(orgId: string, jobId: string, runId: string, u: ImportUpdate): Promise<void> {
      await held(orgId, jobId, runId, (tx, ref) => void tx.update(ref, updateFields(u)));
    },

    /** Lets the job go after a run stopped on an unexpected error, so the queue's next delivery can claim it. */
    async release(orgId: string, jobId: string, runId: string): Promise<void> {
      await held(orgId, jobId, runId, (tx, ref) => void tx.update(ref, { leaseUntil: FieldValue.delete() })).catch(
        (err: unknown) => {
          if (!(err instanceof ImportLeaseLost)) throw err;
        },
      );
    },

    /**
     * Counts the job as one AI import of the month, once (IMP-08): in one transaction, unless `aiCounted` is set it
     * raises `usage/{month}.aiImports` when below `limit` and sets `aiCounted`. False at the limit, changing nothing.
     */
    async countAiImport(orgId: string, jobId: string, runId: string, month: string, limit: number): Promise<boolean> {
      const usage = db.doc(`organizations/${orgId}/usage/${month}`);
      return db.runTransaction(async (tx) => {
        const [j, u] = await Promise.all([tx.get(job(orgId, jobId)), tx.get(usage)]);
        if (j.get('runId') !== runId) throw new ImportLeaseLost();
        if (j.get('aiCounted') === true) return true;
        if (((u.get('aiImports') as number | undefined) ?? 0) >= limit) return false;
        tx.set(usage, { orgId, month, aiImports: FieldValue.increment(1) }, { merge: true });
        tx.update(job(orgId, jobId), { aiCounted: true });
        return true;
      });
    },

    /**
     * Saves a page's drafts, then the job's progress with the last of them, in transactions within Firestore's
     * limits (writeChunks), each only while the run holds the job.
     */
    async saveDrafts(orgId: string, jobId: string, runId: string, drafts: DraftInput[], u: ImportUpdate) {
      const docs = drafts.map(({ figure: _figure, ...d }) => ({ ...d, flags: [], status: 'pending' as const }));
      const chunks = writeChunks(docs);
      for (const [i, chunk] of chunks.entries())
        await held(orgId, jobId, runId, (tx, ref) => {
          for (const d of chunk) tx.set(ref.collection('drafts').doc(draftId(d.order)), d);
          if (i === chunks.length - 1) tx.update(ref, updateFields(u));
        });
    },

    async listDrafts(orgId: string, jobId: string): Promise<Array<StoredDraftFields & { id: string }>> {
      const snap = await job(orgId, jobId).collection('drafts').orderBy('order').get();
      return snap.docs.map((d) => ({ ...(d.data() as StoredDraftFields), id: d.id }));
    },

    /** Stores each draft's flags, then the job's final fields with the last of them, as saveDrafts writes. */
    async finish(
      orgId: string,
      jobId: string,
      runId: string,
      flags: Map<string, StoredDraftFields['flags']>,
      u: ImportUpdate,
    ) {
      const chunks = writeChunks([...flags]);
      for (const [i, chunk] of chunks.entries())
        await held(orgId, jobId, runId, (tx, ref) => {
          for (const [id, f] of chunk) tx.update(ref.collection('drafts').doc(id), { flags: f });
          if (i === chunks.length - 1)
            tx.update(ref, { ...updateFields(u), error: FieldValue.delete(), retryAt: FieldValue.delete() });
        });
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
