import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initFileStore, initFirestore, type FileStore } from '../firebase';
import { importData } from '../import-data';
import { ScriptedLlm } from '../llm/scripted';
import { clearFirestore } from '../test-support/emulators';
import { IMPORT_NOW, importJobs } from '../test-support/import-jobs';
import { localTaskQueue } from './local-queue';

// An import task that stops on an unexpected error must not leave its job `running` while the queue retries it for
// ever: a write Firestore refuses as invalid fails the job at once, and any other error fails it after a few
// deliveries, so the admin sees why (IMP-02, REL-06).

const db = initFirestore();
const files = initFileStore();
const clock = new TestClock();
const llm = new ScriptedLlm();
let app: FastifyInstance;
const jobs = importJobs(db, files, () => app);

/** Reads that fail while `storageDown` is set, as a Storage outage would. */
let storageDown = false;
const flakyFiles: FileStore = {
  save: (path, body, type) => files.save(path, body, type),
  read: async (path) => {
    if (storageDown) throw new Error('Storage is unavailable.');
    return files.read(path);
  },
};

/** Drafts too large for one Firestore document (1 MiB), as a draft past the cell limits would be. */
let padDrafts = false;
const data = importData(db);
const paddingData: typeof data = {
  ...data,
  saveDrafts: (orgId, jobId, runId, drafts, u, parts) =>
    data.saveDrafts(
      orgId,
      jobId,
      runId,
      padDrafts ? drafts.map((d) => ({ ...d, prompt: 'W'.repeat(1_100_000) })) : drafts,
      u,
      parts,
    ),
};

beforeAll(async () => {
  app = await buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue: localTaskQueue(db, clock),
    imports: { data: paddingData, files: flakyFiles },
    llm,
  });
});

beforeEach(async () => {
  await clearFirestore();
  clock.set(IMPORT_NOW);
  llm.reset();
  storageDown = false;
  padDrafts = false;
  await jobs.org.set({ orgId: 'org-a', timezone: 'Asia/Kolkata' });
  await jobs.org.collection('tests').doc('t1').set({ orgId: 'org-a', title: 'Day 1' });
});

const JSON_FILE = Buffer.from(
  JSON.stringify({
    format: 'mitaoe-questions/1',
    questions: [{ prompt: 'What is 25% of 80?', options: ['15', '20', '25', '30'], correct: 'B' }],
  }),
);

/** One delivery of the job's task, as Cloud Tasks sends it, with its retry count. */
const deliver = (jobId: string, retryCount: number) =>
  app.inject({
    method: 'POST',
    url: '/tasks/import',
    headers: { 'x-cloudtasks-taskretrycount': String(retryCount) },
    payload: { orgId: 'org-a', jobId },
  });

describe('import task on an unexpected error', () => {
  it('IMP-02 REL-06 a write Firestore refuses as INVALID_ARGUMENT fails the job INVALID_FILE at once', async () => {
    padDrafts = true;
    const id = await jobs.create('questions.json', 'json', JSON_FILE);
    const res = await deliver(id, 0);
    expect(res.statusCode, 'the queue stops retrying').toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'failed: INVALID_FILE' });
    expect(await jobs.job(id)).toMatchObject({
      status: 'failed',
      error: {
        code: 'INVALID_FILE',
        message: 'This file holds something too large to store. Check the file and try again.',
        retryable: false,
      },
    });
    expect((await jobs.job(id)).leaseUntil).toBeUndefined();
  });

  it('IMP-02 REL-06 any other error is retried by the queue, and its fifth delivery fails the job, retryable', async () => {
    storageDown = true;
    const id = await jobs.create('questions.json', 'json', JSON_FILE);
    for (const retryCount of [0, 1, 2, 3]) {
      expect((await deliver(id, retryCount)).statusCode, `delivery ${retryCount + 1} is retried`).toBe(500);
      expect(await jobs.job(id)).toMatchObject({ status: 'running' });
    }
    const last = await deliver(id, 4);
    expect(last.statusCode).toBe(200);
    expect(last.json()).toMatchObject({ outcome: 'failed: INTERNAL' });
    expect(await jobs.job(id)).toMatchObject({
      status: 'failed',
      error: { code: 'INTERNAL', message: 'Something went wrong while reading this file.', retryable: true },
    });
  });
});
