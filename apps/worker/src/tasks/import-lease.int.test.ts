import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFileStore, initFirestore } from '../firebase';
import type { LlmRequest, LlmResponse } from '../llm/driver';
import { ScriptedLlm } from '../llm/scripted';
import { clearFirestore } from '../test-support/emulators';
import { blankPdf, IMPORT_NOW, importJobs, importWorker } from '../test-support/import-jobs';

// REL-06, IMP-08 on the emulators: a job is read by one run at a time. A task delivered again while a run holds the
// job (a queue that gave up waiting for the answer and re-sent it) starts no second run and no second model call; a
// run whose lease ran out saves nothing more once another run took the job over.

/** The scripted mock, telling the test when its n-th call has started. */
class WatchedLlm extends ScriptedLlm {
  private waiters: Array<{ n: number; go: () => void }> = [];

  /** Resolves once `n` calls have started. */
  called(n: number): Promise<void> {
    if (this.calls().length >= n) return Promise.resolve();
    return new Promise((go) => this.waiters.push({ n, go }));
  }

  override generate(request: LlmRequest): Promise<LlmResponse> {
    const answer = super.generate(request);
    const count = this.calls().length;
    for (const w of this.waiters.filter((x) => x.n <= count)) w.go();
    this.waiters = this.waiters.filter((x) => x.n > count);
    return answer;
  }
}

const db = initFirestore();
const files = initFileStore();
const clock = new TestClock();
const llm = new WatchedLlm();
const MIN = 60_000;
let app: FastifyInstance;
const jobs = importJobs(db, files, () => app);

const page = (n: number) => [{ prompt: `Question on page ${n}`, options: ['1', '2'], correct: [0] }];
const PAGES = { '1': page(1), '2': page(2), '3': page(3) };

/** One delivery of the job's first task, as a queue that re-sends it would make. */
async function deliver(id: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/tasks/import', payload: { orgId: 'org-a', jobId: id } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { outcome: string }).outcome;
}

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

describe('import runs one at a time', () => {
  it('REL-06 IMP-08 a task delivered again while a page is being read starts no second run', async () => {
    llm.setScript({ pages: PAGES, hold: [1] });
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(3));
    const first = jobs.run(id);
    await llm.called(1);
    const second = deliver(id);
    // The second delivery either answers at once or, without a lease, reaches the model as well.
    await Promise.race([second, llm.called(2)]);
    llm.release();
    expect(await second).toMatch(/^skipped/);
    expect(await first).toBe('ready: 3 drafts');
    expect(llm.calls().map((c) => c.page)).toEqual([1, 2, 3]);
    expect((await jobs.drafts(id)).map((d) => d.order)).toEqual([1, 2, 3]);
  });

  it('REL-06 a run whose lease ran out saves nothing more; the run that took the job over finishes it', async () => {
    llm.setScript({ pages: PAGES, hold: [2] });
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(3));
    const stale = jobs.run(id);
    await llm.called(2);
    clock.advance(10 * MIN);
    const takeover = jobs.run(id);
    await Promise.race([takeover, llm.called(3)]);
    llm.release();
    expect(await stale).toBe('superseded');
    expect(await takeover).toBe('ready: 3 drafts');
    expect(llm.calls().map((c) => c.page)).toEqual([1, 2, 2, 3]);
    expect(await jobs.job(id)).toMatchObject({
      status: 'ready',
      progress: { pagesDone: 3, pagesTotal: 3, questionsFound: 3 },
      tokens: { input: 3000, output: 600 },
    });
    expect((await jobs.drafts(id)).map((d) => [d.order, d.sourcePage])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });
});
