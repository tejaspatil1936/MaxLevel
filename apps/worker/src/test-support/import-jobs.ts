import { randomUUID } from 'node:crypto';
import type { ImportFormat, TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import type { Firestore } from 'firebase-admin/firestore';
import { PDFDocument } from 'pdf-lib';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import type { FileStore } from '../firebase';
import { importData } from '../import-data';
import type { LlmDriver } from '../llm/driver';
import { localTaskQueue } from '../tasks/local-queue';

// Import jobs on the emulators for the worker's integration tests: a stored source file and a started job, the task
// run through the worker's own route, and what it left behind. Test use only.

export const IMPORT_NOW = 1_792_476_000_000; // 20 Oct 2026, 11:30 IST

export async function importWorker(opts: {
  db: Firestore;
  files: FileStore;
  clock: TestClock;
  llm: LlmDriver;
  config?: NodeJS.ProcessEnv;
}): Promise<FastifyInstance> {
  return buildWorker({
    clock: opts.clock,
    config: { ...loadConfig({ NODE_ENV: 'test', ...opts.config }), logLevel: 'silent' },
    data: workerData(opts.db),
    queue: localTaskQueue(opts.db, opts.clock),
    imports: { data: importData(opts.db), files: opts.files },
    llm: opts.llm,
  });
}

/** An A4 PDF with `pages` empty pages. */
export async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save();
}

export function importJobs(db: Firestore, files: FileStore, app: () => FastifyInstance, orgId = 'org-a') {
  const org = db.doc(`organizations/${orgId}`);
  let n = 0;

  const job = async (id: string) => (await org.collection('importJobs').doc(id).get()).data()!;
  const drafts = async (id: string) =>
    (await org.collection(`importJobs/${id}/drafts`).orderBy('order').get()).docs.map((d) => d.data());

  return {
    org,
    job,
    drafts,

    /** Stores the file and a queued job for it in test `t1`; returns the job ID. */
    async create(filename: string, format: ImportFormat, bytes: Uint8Array): Promise<string> {
      const id = `job-${++n}-${randomUUID().slice(0, 8)}`;
      const filePath = `organizations/${orgId}/imports/${id}/source.${format}`;
      await files.save(filePath, Buffer.from(bytes), 'application/octet-stream');
      await org
        .collection('importJobs')
        .doc(id)
        .set({
          orgId,
          testId: 't1',
          filename,
          format,
          filePath,
          status: 'queued',
          progress: { pagesDone: 0, pagesTotal: 0, questionsFound: 0 },
          createdBy: 'uid-1',
          createdAt: IMPORT_NOW,
        });
      return id;
    },

    /** Posts the job's task to the worker, which must answer 200; returns its outcome. */
    async run(id: string): Promise<string> {
      const res = await app().inject({ method: 'POST', url: '/tasks/import', payload: { orgId, jobId: id } });
      if (res.statusCode !== 200) throw new Error(`/tasks/import answered ${res.statusCode}: ${res.body}`);
      return (res.json() as { outcome: string }).outcome;
    },

    /** The job's queued tasks, as the local queue stores them. */
    async tasks(id: string): Promise<Array<{ name: string; scheduleTime: number }>> {
      const snap = await db.collection('_localTasks').where('status', '==', 'pending').get();
      return snap.docs
        .filter((d) => d.get('path') === '/tasks/import' && d.id.includes(id))
        .map((d) => ({ name: d.id, scheduleTime: d.get('scheduleTime') as number }));
    },

    /** Marks the job's queued tasks as run, as the dispatcher does after a 200. */
    async markRun(id: string): Promise<void> {
      for (const t of await this.tasks(id)) await db.collection('_localTasks').doc(t.name).update({ status: 'done' });
    },
  };
}
