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

describe('import task on sheets too large to store', () => {
  const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n') + '\n');

  it('IMP-02 SEC-06 a template cell of 1,100,000 characters fails the job CELL_TOO_LONG before any write', async () => {
    const id = await jobs.create(
      'hugecell.csv',
      'csv',
      csv([
        ['Question', 'Option A', 'Option B', 'Correct'],
        ['W'.repeat(1_100_000), 'x', 'y', 'A'],
      ]),
    );
    expect(await jobs.run(id)).toBe('failed: CELL_TOO_LONG');
    expect(await jobs.job(id)).toMatchObject({
      status: 'failed',
      error: {
        code: 'CELL_TOO_LONG',
        message: 'Row 2 has a cell longer than 20,000 characters. Shorten it and try again.',
        retryable: false,
      },
    });
    expect(await jobs.drafts(id)).toEqual([]);
    expect((await jobs.org.collection(`importJobs/${id}/parts`).get()).size).toBe(0);
    expect(llm.calls()).toEqual([]);
  });

  it('IMP-02 SEC-06 a free sheet and a template option over their limits fail the job before any model call', async () => {
    const free = await jobs.create(
      'free.csv',
      'csv',
      csv([
        ['Q', 'Choices'],
        ['Largest planet?', 'Mars; Jupiter'],
        ['Notes', 'n'.repeat(20_001)],
      ]),
    );
    expect(await jobs.run(free)).toBe('failed: CELL_TOO_LONG');
    expect((await jobs.job(free)).error).toEqual({
      code: 'CELL_TOO_LONG',
      message: 'Row 3 has a cell longer than 20,000 characters. Shorten it and try again.',
      retryable: false,
    });
    const option = await jobs.create(
      'option.csv',
      'csv',
      csv([
        ['Question', 'Option A', 'Option B', 'Correct'],
        ['Short?', 'o'.repeat(5_001), 'y', 'A'],
      ]),
    );
    expect(await jobs.run(option)).toBe('failed: CELL_TOO_LONG');
    expect((await jobs.job(option)).error).toMatchObject({
      message: 'Row 2 has a cell longer than 5,000 characters. Shorten it and try again.',
    });
    expect(await jobs.drafts(option)).toEqual([]);
    expect(llm.calls()).toEqual([]);
  });
});
