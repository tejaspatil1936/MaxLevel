import { TestClock, type ImportFormat } from '@mitaoe/shared';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initFileStore, initFirestore } from '../firebase';
import { importData } from '../import-data';
import { ScriptedLlm } from '../llm/scripted';
import { clearFirestore } from '../test-support/emulators';
import { importJobs } from '../test-support/import-jobs';
import { localTaskQueue } from './local-queue';

// /tasks/import on the Firestore and Storage emulators with the scripted mock model (IMP-01, IMP-02, IMP-08, SEC-06).

const db = initFirestore();
const files = initFileStore();
const clock = new TestClock();
const llm = new ScriptedLlm();
const org = db.doc('organizations/org-a');
const NOW = 1_792_476_000_000; // 20 Oct 2026, 11:30 IST
let app: FastifyInstance;
const jobs = importJobs(db, files, () => app);
let n = 0;

beforeAll(async () => {
  app = await buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue: localTaskQueue(db, clock),
    imports: { data: importData(db), files },
    llm,
  });
});

const REASONING = [
  {
    prompt: 'Find the next number: 3, 6, 12, 24, ...',
    options: ['30', '36', '48', '60'],
    correct: [2],
    section: 'Reasoning',
  },
  { prompt: 'Which statement must be true?', options: ['All', 'Some', 'None', 'Neither'], correct: [3] },
];

beforeEach(async () => {
  await clearFirestore();
  clock.set(NOW);
  llm.reset();
  llm.setScript({ pages: { '1': REASONING } });
  await org.set({ orgId: 'org-a', timezone: 'Asia/Kolkata' });
  await org.collection('tests').doc('t1').set({ orgId: 'org-a', title: 'Day 1' });
});

/** Stores the file and a started job for it, runs the task and returns the stored job and its drafts. */
async function runImport(filename: string, format: ImportFormat, bytes: Buffer | Uint8Array) {
  const id = `job-${++n}`;
  const filePath = `organizations/org-a/imports/${id}/source.${format}`;
  await files.save(filePath, Buffer.from(bytes), 'application/octet-stream');
  await org
    .collection('importJobs')
    .doc(id)
    .set({
      orgId: 'org-a',
      testId: 't1',
      filename,
      format,
      filePath,
      status: 'queued',
      progress: { pagesDone: 0, pagesTotal: 0, questionsFound: 0 },
      createdBy: 'uid-1',
      createdAt: NOW,
    });
  await jobs.run(id);
  const job = (await org.collection('importJobs').doc(id).get()).data()!;
  const drafts = (await org.collection(`importJobs/${id}/drafts`).orderBy('order').get()).docs.map((d) => d.data());
  return { id, job, drafts };
}
const aiImports = async () => Number((await org.collection('usage').doc('2026-10').get()).get('aiImports') ?? 0);

async function pdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save();
}
const HEADER = ['Question', 'Option A', 'Option B', 'Correct'];
const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n') + '\n');
const templateRows = (count: number) => [
  HEADER,
  ...Array.from({ length: count }, (_, i) => [`What is ${i} + 1?`, `${i + 1}`, `${i + 2}`, 'A']),
];
async function xlsx(rows: string[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Questions');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const JSON_FILE = Buffer.from(
  JSON.stringify({
    format: 'mitaoe-questions/1',
    questions: [
      { prompt: 'What is 25% of 80?', options: ['15', '20', '25', '30'], correct: 'B', difficulty: 'easy' },
      { prompt: 'What is the square root of 144?', options: ['10', '11', '12', '13'], correct: 'C' },
    ],
  }),
);

describe('import task', () => {
  it('IMP-01 IMP-08 JSON and template sheets are read directly, never counted and never sent to the model', async () => {
    for (const [name, format, bytes] of [
      ['questions.json', 'json', JSON_FILE],
      ['template.csv', 'csv', csv(templateRows(2))],
      ['template.xlsx', 'xlsx', await xlsx(templateRows(2))],
    ] as const) {
      const { job, drafts } = await runImport(name, format, bytes);
      expect(job, name).toMatchObject({
        status: 'ready',
        progress: { pagesDone: 1, pagesTotal: 1, questionsFound: 2 },
      });
      expect(job.provider).toBeUndefined();
      expect(job.aiCounted).toBeUndefined();
      expect(drafts.map((d) => [d.order, d.status, d.flags])).toEqual([
        [1, 'pending', []],
        [2, 'pending', []],
      ]);
    }
    const { drafts } = await runImport('t.csv', 'csv', csv(templateRows(1)));
    expect(drafts[0]).toMatchObject({
      sourcePage: 2,
      prompt: 'What is 0 + 1?',
      correctOptionIds: ['a'],
      difficultySuggested: false,
    });
    expect(llm.calls()).toEqual([]);
    expect(await aiImports()).toBe(0);
  });

  it('IMP-01 IMP-08 each PDF page, text part and free sheet part is one model call; the job counts once', async () => {
    const paper = await runImport('paper.pdf', 'pdf', await pdf(3));
    expect(paper.job).toMatchObject({
      status: 'ready',
      progress: { pagesDone: 3, pagesTotal: 3, questionsFound: 2 },
      aiCounted: true,
      provider: 'mock',
      model: 'mock-model',
      tokens: { input: 3000, output: 600 },
    });
    expect(paper.drafts.map((d) => [d.order, d.sourcePage, d.prompt, d.difficultySuggested])).toEqual([
      [1, 1, REASONING[0]!.prompt, true],
      [2, 1, REASONING[1]!.prompt, true],
    ]);
    expect(paper.drafts[0]).toMatchObject({ sectionName: 'Reasoning', correctOptionIds: ['c'] });
    expect(llm.calls()).toEqual(
      [1, 2, 3].map((page) => ({ page, parts: [{ type: 'text' }, { type: 'file', mediaType: 'application/pdf' }] })),
    );
    expect(await aiImports()).toBe(1);

    llm.setScript({ pages: { '1': REASONING } });
    const notes = await runImport('notes.md', 'md', Buffer.from('# Reasoning\n\n1. Find the next number\n'));
    const free = await runImport(
      'free.csv',
      'csv',
      csv([
        ['Q', 'Choices', 'Answer'],
        ['Largest planet?', 'Mars; Jupiter', 'Jupiter'],
      ]),
    );
    for (const r of [notes, free])
      expect(r.job).toMatchObject({ status: 'ready', aiCounted: true, progress: { pagesTotal: 1 } });
    expect(llm.calls()).toEqual([1, 1].map((page) => ({ page, parts: [{ type: 'text' }] })));
    expect(await aiImports()).toBe(3);

    // A task delivered twice changes nothing.
    const again = await app.inject({
      method: 'POST',
      url: '/tasks/import',
      payload: { orgId: 'org-a', jobId: paper.id },
    });
    expect(again.json()).toMatchObject({ outcome: 'skipped' });
    expect(await aiImports()).toBe(3);
  });

  // Each of the 100 pages is split, sent, rendered and stored, so this test gets a minute.
  it(
    'IMP-02 100 pages and 5,000 rows pass; 101 pages and 5,001 rows fail before any model call, uncounted',
    { timeout: 60_000 },
    async () => {
      llm.setScript({});
      expect((await runImport('ok.pdf', 'pdf', await pdf(100))).job).toMatchObject({
        status: 'ready',
        progress: { pagesDone: 100 },
      });
      expect((await runImport('ok.csv', 'csv', csv(templateRows(5000)))).job.status).toBe('ready');
      llm.setScript({});
      await org.collection('usage').doc('2026-10').delete();
      const long = await runImport('long.pdf', 'pdf', await pdf(101));
      expect(long.job).toMatchObject({
        status: 'failed',
        error: { code: 'TOO_MANY_PAGES', message: 'This PDF has 101 pages. The limit is 100 pages.', retryable: false },
      });
      for (const [name, format, bytes] of [
        ['rows.csv', 'csv', csv(templateRows(5001))],
        ['rows.xlsx', 'xlsx', await xlsx(templateRows(5001))],
      ] as const) {
        const r = await runImport(name, format, bytes);
        expect(r.job.error, name).toEqual({
          code: 'TOO_MANY_ROWS',
          message: 'This sheet has 5,001 rows. The limit is 5,000 rows.',
          retryable: false,
        });
        expect(r.drafts).toEqual([]);
      }
      expect(llm.calls()).toEqual([]);
      expect(await aiImports()).toBe(0);
    },
  );

  it('SEC-06 the worker checks the signature again before parsing; a ZIP without a workbook is no XLSX', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    const fake = await runImport('paper.pdf', 'pdf', png);
    expect(fake.job.error).toEqual({
      code: 'FILE_SIGNATURE_MISMATCH',
      message: "This file isn't a real PDF file. Check the file and try again.",
      retryable: false,
    });
    const zip = await runImport(
      'sheet.xlsx',
      'xlsx',
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60)]),
    );
    expect(zip.job.error).toMatchObject({ code: 'FILE_SIGNATURE_MISMATCH' });
    expect(llm.calls()).toEqual([]);
  });

  it('IMP-08 at the month limit a free sheet fails LIMIT_REACHED and a template sheet still imports', async () => {
    await org.update({ limitOverrides: { ai_imports_per_month: 1 } });
    await org.collection('usage').doc('2026-10').set({ aiImports: 1 });
    const free = await runImport(
      'free.csv',
      'csv',
      csv([
        ['Q', 'Answer'],
        ['Largest planet?', 'Jupiter'],
      ]),
    );
    expect(free.job).toMatchObject({ status: 'failed', error: { code: 'LIMIT_REACHED', retryable: false } });
    expect(free.job.aiCounted).toBeUndefined();
    expect((await runImport('t.csv', 'csv', csv(templateRows(1)))).job.status).toBe('ready');
    await org.update({ featureOverrides: { ai_question_import: false } });
    const off = await runImport(
      'free.csv',
      'csv',
      csv([
        ['Q', 'Answer'],
        ['Largest planet?', 'Jupiter'],
      ]),
    );
    expect(off.job.error).toMatchObject({ code: 'FEATURE_DISABLED', retryable: false });
    expect(await aiImports()).toBe(1);
    expect(llm.calls()).toEqual([]);
  });

  it('IMP-08 a model job whose organization is gone fails instead of staying running', async () => {
    await org.delete();
    const gone = await runImport('notes.md', 'md', Buffer.from('1. Find the next number\n'));
    expect(gone.job).toMatchObject({
      status: 'failed',
      error: {
        code: 'ORG_NOT_FOUND',
        message: 'This organization no longer exists, so the import stopped.',
        retryable: false,
      },
    });
    expect(llm.calls()).toEqual([]);
  });
});
