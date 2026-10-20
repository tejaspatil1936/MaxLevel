import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFileStore, initFirestore } from '../firebase';
import { ScriptedLlm } from '../llm/scripted';
import { clearFirestore } from '../test-support/emulators';
import { blankPdf, IMPORT_NOW, importJobs, importWorker } from '../test-support/import-jobs';

// REL-06 on the emulators with the scripted mock model: a model failure keeps the pages done and waits to retry after
// 1, 2 and 4 minutes on the Clock, through the task queue; the fourth failure in a row fails the job, retryable.

const db = initFirestore();
const files = initFileStore();
const clock = new TestClock();
const llm = new ScriptedLlm();
const MIN = 60_000;
let app: FastifyInstance;
const jobs = importJobs(db, files, () => app);

const page = (n: number) => [{ prompt: `Question on page ${n}`, options: ['1', '2'], correct: [0] }];
const PAGES = { '1': page(1), '2': page(2), '3': page(3) };

beforeAll(async () => {
  app = await importWorker({ db, files, clock, llm });
});

beforeEach(async () => {
  await clearFirestore();
  clock.set(IMPORT_NOW);
  llm.reset();
  await jobs.org.set({ orgId: 'org-a', timezone: 'Asia/Kolkata' });
  await jobs.org.collection('tests').doc('t1').set({ orgId: 'org-a', title: 'Day 1' });
});

describe('import task retries', () => {
  it('REL-06 a provider error keeps the pages done, waits a minute with a task at retryAt, and resumes there', async () => {
    llm.setScript({ pages: PAGES, failures: { '2': 1 } });
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(3));
    expect(await jobs.run(id)).toBe(`retrying at ${IMPORT_NOW + MIN}`);
    expect(await jobs.job(id)).toMatchObject({
      status: 'retrying',
      progress: { pagesDone: 1, pagesTotal: 3, questionsFound: 1 },
      error: { code: 'LLM_UNAVAILABLE', message: "The AI service didn't answer.", retryable: true },
      retryAt: IMPORT_NOW + MIN,
      failures: 1,
      tokens: { input: 1000, output: 200 },
    });
    expect((await jobs.drafts(id)).map((d) => d.sourcePage)).toEqual([1]);
    const tasks = await jobs.tasks(id);
    expect(tasks.map((t) => t.scheduleTime)).toEqual([IMPORT_NOW + MIN]);
    expect(tasks[0]!.name).toContain(id);

    // Delivered before retryAt (a repeated first task), the run changes nothing.
    expect(await jobs.run(id)).toBe('skipped');
    expect(llm.calls().map((c) => c.page)).toEqual([1, 2]);

    await jobs.markRun(id);
    clock.advance(MIN);
    expect(await jobs.run(id)).toBe('ready: 3 drafts');
    const done = await jobs.job(id);
    expect(done).toMatchObject({ status: 'ready', failures: 0, progress: { pagesDone: 3, questionsFound: 3 } });
    expect(done.error).toBeUndefined();
    expect(done.retryAt).toBeUndefined();
    expect(done.tokens, 'tokens of the successful calls only').toEqual({ input: 3000, output: 600 });
    expect((await jobs.drafts(id)).map((d) => [d.order, d.sourcePage])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(llm.calls().map((c) => c.page)).toEqual([1, 2, 2, 3]);
    expect(await jobs.tasks(id)).toEqual([]);
  });

  it('REL-06 waits 1, 2 and 4 minutes after failures in a row; the fourth fails the job as retryable', async () => {
    llm.setScript({ pages: PAGES, failures: { '1': 4 } });
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(3));
    for (const delay of [MIN, 2 * MIN, 4 * MIN]) {
      const now = clock.now();
      await jobs.run(id);
      expect(await jobs.job(id)).toMatchObject({ status: 'retrying', retryAt: now + delay });
      expect((await jobs.tasks(id)).map((t) => t.scheduleTime)).toEqual([now + delay]);
      await jobs.markRun(id);
      clock.advance(delay);
    }
    expect(await jobs.run(id)).toBe('failed: LLM_UNAVAILABLE');
    const failed = await jobs.job(id);
    expect(failed).toMatchObject({
      status: 'failed',
      failures: 4,
      error: { code: 'LLM_UNAVAILABLE', message: "The AI service didn't answer after 4 tries.", retryable: true },
      progress: { pagesDone: 0 },
    });
    expect(failed.retryAt).toBeUndefined();
    expect(failed.tokens).toEqual({ input: 0, output: 0 });
    expect(await jobs.tasks(id)).toEqual([]);
    expect(llm.calls().map((c) => c.page)).toEqual([1, 1, 1, 1]);
  });

  it('REL-06 IMP-05 an answer outside LlmAnswerSchema is a model failure, retried like a provider error', async () => {
    llm.setScript({ pages: { '1': [{ prompt: 'No options given' }] } as never });
    const id = await jobs.create('notes.txt', 'txt', Buffer.from('1. A question\n'));
    await jobs.run(id);
    expect(await jobs.job(id)).toMatchObject({
      status: 'retrying',
      retryAt: IMPORT_NOW + MIN,
      error: { code: 'LLM_UNAVAILABLE', retryable: true },
      progress: { pagesDone: 0, pagesTotal: 1 },
    });
    expect(await jobs.drafts(id)).toEqual([]);
  });
});
