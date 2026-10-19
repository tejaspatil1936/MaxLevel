import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFileStore, initFirestore } from '../firebase';
import { ScriptedLlm } from '../llm/scripted';
import { clearFirestore } from '../test-support/emulators';
import { brokenPagePdf } from '../test-support/hostile-files';
import { IMPORT_NOW, importJobs, importWorker } from '../test-support/import-jobs';

// Hostile import files through /tasks/import on the emulators (SEC-06): each ends the job with a refusal it keeps,
// never with a task that throws and is retried with the job left `running`.

const db = initFirestore();
const files = initFileStore();
const clock = new TestClock();
const llm = new ScriptedLlm();
let app: FastifyInstance;
const jobs = importJobs(db, files, () => app);

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

describe('import task on hostile files', () => {
  it('SEC-06 IMP-03 a PDF page that cannot be copied fails the job INVALID_FILE, not retryable, at that page', async () => {
    llm.setScript({ pages: { '1': [{ prompt: 'Question on page 1', options: ['1', '2'], correct: [0] }] } });
    const id = await jobs.create('paper.pdf', 'pdf', await brokenPagePdf(3, 2));
    expect(await jobs.run(id)).toBe('failed: INVALID_FILE');
    expect(await jobs.job(id)).toMatchObject({
      status: 'failed',
      progress: { pagesDone: 1, pagesTotal: 3, questionsFound: 1 },
      error: {
        code: 'INVALID_FILE',
        message: "Page 2 of this PDF can't be read. Check the file and try again.",
        retryable: false,
      },
    });
    expect(llm.calls().map((c) => c.page)).toEqual([1]);
    expect(await jobs.tasks(id)).toEqual([]);
  });
});
