import { draftsFromModel, TestClock, type TaskQueue } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initFileStore, initFirestore } from '../firebase';
import { draftId, IMPORT_LEASE_MS, importData, type ImportData } from '../import-data';
import { ScriptedLlm } from '../llm/scripted';
import { clearFirestore } from '../test-support/emulators';
import { blankPdf, IMPORT_NOW, importJobs } from '../test-support/import-jobs';
import { localTaskQueue } from './local-queue';

// REL-06, IMP-04 on the emulators: a run that stops after a page is saved (the next page's task not queued, or the
// checks not run) leaves the job `running` with no lease. The queue then sends the same page task again: it takes the
// job back and goes on from the first page not done, so the job still ends `ready`, its drafts in order, once each.

const db = initFirestore();
const files = initFileStore();
const clock = new TestClock();
const llm = new ScriptedLlm();
let app: FastifyInstance;
const jobs = importJobs(db, files, () => app);
const data = importData(db);

/** Faults the test sets for the next call only. */
const fault = { enqueuePage: false, finish: false };

const queue: TaskQueue = {
  async enqueue(task) {
    if (fault.enqueuePage && task.name.includes('-page-')) {
      fault.enqueuePage = false;
      throw new Error('queue unavailable');
    }
    return localTaskQueue(db, clock).enqueue(task);
  },
};
const faultyData: ImportData = {
  ...data,
  async finish(...args) {
    if (fault.finish) {
      fault.finish = false;
      throw new Error('finish failed');
    }
    return data.finish(...args);
  },
};

const page = (n: number) => [{ prompt: `Question on page ${n}`, options: ['1', '2'], correct: [0] }];
const PAGES = { '1': page(1), '2': page(2), '3': page(3) };
type Payload = { orgId: string; jobId: string; page?: number };

/** One delivery of a task: its status code and outcome. */
async function deliver(payload: Payload): Promise<{ status: number; outcome?: string }> {
  const res = await app.inject({ method: 'POST', url: '/tasks/import', payload });
  return { status: res.statusCode, outcome: (res.json() as { outcome?: string }).outcome };
}

/** Takes the job's queued task for `n`, as the dispatcher does. */
async function pageTask(id: string, n: number): Promise<Payload> {
  const ref = db.collection('_localTasks').doc(`import-${id}-page-${n}`);
  const task = await ref.get();
  expect(task.get('status')).toBe('pending');
  await ref.update({ status: 'done' });
  return task.get('payload') as Payload;
}

beforeAll(async () => {
  app = await buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue,
    imports: { data: faultyData, files },
    llm,
  });
});

beforeEach(async () => {
  await clearFirestore();
  clock.set(IMPORT_NOW);
  llm.reset();
  fault.enqueuePage = false;
  fault.finish = false;
  llm.setScript({ pages: PAGES });
  await jobs.org.set({ orgId: 'org-a', timezone: 'Asia/Kolkata' });
  await jobs.org.collection('tests').doc('t1').set({ orgId: 'org-a', title: 'Day 1' });
});

async function expectReady(id: string) {
  expect(await jobs.job(id)).toMatchObject({
    status: 'ready',
    progress: { pagesDone: 3, pagesTotal: 3, questionsFound: 3 },
  });
  expect((await jobs.drafts(id)).map((d) => [d.order, d.sourcePage])).toEqual([
    [1, 1],
    [2, 2],
    [3, 3],
  ]);
  expect(llm.calls().map((c) => c.page)).toEqual([1, 2, 3]);
}

describe('an import resumes after a run stopped between pages', () => {
  it('REL-06 IMP-04 a page task sent again after the next task failed to queue goes on to the next page', async () => {
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(3));
    expect(await deliver({ orgId: 'org-a', jobId: id })).toEqual({ status: 200, outcome: 'page 1 of 3 done' });
    const task = await pageTask(id, 2);
    fault.enqueuePage = true;
    expect((await deliver(task)).status).toBe(500);
    expect(await jobs.job(id)).toMatchObject({ status: 'running', progress: { pagesDone: 2 } });

    expect(await deliver(task)).toEqual({ status: 200, outcome: 'ready: 3 drafts' });
    await expectReady(id);
  });

  it('REL-06 IMP-04 the last page task sent again after the checks failed runs the checks and sets ready', async () => {
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(3));
    await deliver({ orgId: 'org-a', jobId: id });
    expect(await deliver(await pageTask(id, 2))).toEqual({ status: 200, outcome: 'page 2 of 3 done' });
    const last = await pageTask(id, 3);
    fault.finish = true;
    expect((await deliver(last)).status).toBe(500);
    expect(await jobs.job(id)).toMatchObject({ status: 'running', progress: { pagesDone: 3 } });

    expect(await deliver(last)).toEqual({ status: 200, outcome: 'ready: 3 drafts' });
    await expectReady(id);
  });

  it('REL-06 a page task ahead of the job is still refused', async () => {
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(3));
    expect(await deliver({ orgId: 'org-a', jobId: id, page: 3 })).toEqual({ status: 200, outcome: 'skipped' });
    expect(llm.calls()).toEqual([]);
  });

  it('REL-06 a run that takes a page over replaces the drafts a run that lost the job left of that page', async () => {
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(3));
    const ref = jobs.org.collection('importJobs').doc(id);
    const stale = await data.claim('org-a', id, { runId: 'run-a', now: clock.now(), leaseUntil: clock.now() + 1 });
    expect(stale).toMatchObject({ job: { runId: 'run-a' } });
    // Run A saved the first chunk of page 1's drafts (5 of them), then lost the job before its progress was saved.
    const many = draftsFromModel(
      1,
      [...Array(5).keys()].map((i) => page(i)[0]!),
      1,
    );
    for (const d of many)
      await ref
        .collection('drafts')
        .doc(draftId(d.order))
        .set({ ...d, flags: [], status: 'pending' });

    clock.advance(IMPORT_LEASE_MS);
    await data.claim('org-a', id, { runId: 'run-b', now: clock.now(), leaseUntil: clock.now() + IMPORT_LEASE_MS });
    const progress = { pagesDone: 1, pagesTotal: 3, questionsFound: 2 };
    await data.saveDrafts('org-a', id, 'run-b', draftsFromModel(1, [...page(7), ...page(8)], 1), { progress });
    expect((await jobs.drafts(id)).map((d) => [d.order, d.prompt])).toEqual([
      [1, 'Question on page 7'],
      [2, 'Question on page 8'],
    ]);
  });
});
