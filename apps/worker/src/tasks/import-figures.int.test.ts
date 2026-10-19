import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFileStore, initFirestore } from '../firebase';
import { ScriptedLlm } from '../llm/scripted';
import { clearFirestore } from '../test-support/emulators';
import { blankPdf, IMPORT_NOW, importJobs, importWorker } from '../test-support/import-jobs';

// IMP-03 on the emulators: each PDF page reaches the mock as a page of the document, is kept as a PNG for the review
// screen, and each figure the model located is cropped from it, stored under the job's figures folder and attached.

const db = initFirestore();
const files = initFileStore();
const clock = new TestClock();
const llm = new ScriptedLlm();
let app: FastifyInstance;
const jobs = importJobs(db, files, () => app);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer | null) => !!b && b.subarray(0, 8).equals(PNG);

const CHART = {
  prompt: 'The bar chart shows sales. Which year had the most?',
  options: ['2021', '2022'],
  correct: [1],
  refersToFigure: true,
  figure: { box: { x: 0.1, y: 0.4, w: 0.5, h: 0.3 }, alt: 'Bar chart of sales for 2021 and 2022' },
  box: { x: 0.08, y: 0.3, w: 0.84, h: 0.5 },
};
const PLAIN = { prompt: 'What is 2 + 2?', options: ['3', '4'], correct: [1] };

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

describe('import figures', () => {
  it('IMP-03 each page goes as a PDF file part, is kept as a PNG, and a located figure becomes a stored PNG', async () => {
    llm.setScript({ pages: { '1': [PLAIN], '2': [CHART] } });
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(2));
    expect(await jobs.run(id)).toBe('ready: 2 drafts');
    expect(llm.calls()).toEqual(
      [1, 2].map((page) => ({ page, parts: [{ type: 'text' }, { type: 'file', mediaType: 'application/pdf' }] })),
    );
    const [plain, chart] = await jobs.drafts(id);
    expect(plain!.images).toEqual([]);
    expect(plain!.flags).toEqual([]);
    expect(chart).toMatchObject({ sourcePage: 2, box: CHART.box, flags: [] });
    expect(chart!.images).toEqual([
      { path: `organizations/org-a/imports/${id}/figures/d0002-1.png`, alt: CHART.figure.alt },
    ]);
    expect(chart!.figure, 'the box is not kept once cropped').toBeUndefined();
    expect(isPng(await files.read(chart!.images[0].path))).toBe(true);
    for (const page of [1, 2])
      expect(isPng(await files.read(`organizations/org-a/imports/${id}/pages/${page}.png`)), `page ${page}`).toBe(true);
  });

  it('IMP-03 IMP-09 a question that refers to a figure the model did not locate has no image and is flagged', async () => {
    llm.setScript({ pages: { '1': [{ ...CHART, figure: undefined }] } });
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(1));
    await jobs.run(id);
    const [d] = await jobs.drafts(id);
    expect(d!.images).toEqual([]);
    expect(d!.flags).toEqual([{ code: 'MISSING_FIGURE', text: "The question refers to a figure that wasn't found." }]);
  });

  it('IMP-03 text formats keep no page images and crop nothing', async () => {
    llm.setScript({ pages: { '1': [CHART] } });
    const id = await jobs.create('notes.txt', 'txt', Buffer.from('1. The bar chart shows sales.\n'));
    await jobs.run(id);
    const [d] = await jobs.drafts(id);
    expect(d!.images).toEqual([]);
    expect(await files.read(`organizations/org-a/imports/${id}/pages/1.png`)).toBeNull();
  });
});
