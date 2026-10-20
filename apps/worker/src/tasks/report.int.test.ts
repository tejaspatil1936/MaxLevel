import { SUMMARY_INSTRUCTIONS, TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initFileStore, initFirestore } from '../firebase';
import { ScriptedLlm } from '../llm/scripted';
import { reportData } from '../report-data';
import { chromiumPrinter, type PdfPrinter } from '../report-pdf';
import { clearFirestore } from '../test-support/emulators';
import { localTaskQueue } from './local-queue';

// The report task on the emulators with the scripted mock model and headless Chromium (EXP-04 to EXP-06, REL-04,
// REL-06): the metrics computed from stored attempts, the summary asked for with only the metrics JSON and checked
// for unsupported numbers, the PDF and XLSX stored, and model failures waiting on the retry schedule.

const db = initFirestore();
const files = initFileStore();
const clock = new TestClock();
const llm = new ScriptedLlm();
const chromium = chromiumPrinter();
/** Chromium, except that the next print fails while `failNextPrint` is set (a print that crashed). */
let failNextPrint = false;
const printer: PdfPrinter = {
  print: (html) => {
    if (!failNextPrint) return chromium.print(html);
    failNextPrint = false;
    return Promise.reject(new Error('print crashed'));
  },
  close: () => chromium.close(),
};
const NOW = 1_792_476_900_000; // 20 Oct 2026, 11:45 IST
const MIN = 60_000;
const org = db.doc('organizations/org-a');
let app: FastifyInstance;

const GOOD = {
  summary: '3 of the 4 eligible students finished. The mean score was 1 out of 2.',
  recommendations: ['Revisit question 2.'],
};
const BAD = { summary: 'Students scored 93.7% on average.', recommendations: ['Keep going.'] };

beforeAll(async () => {
  app = await buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue: localTaskQueue(db, clock),
    reports: { data: reportData(db), files, printer },
    llm,
  });
});
afterAll(() => app.close());

beforeEach(async () => {
  await clearFirestore();
  clock.set(NOW);
  llm.reset();
  await org.set({ orgId: 'org-a', name: 'MIT Academy of Engineering', timezone: 'Asia/Kolkata' });
  await org.collection('departments').doc('cs').set({ orgId: 'org-a', name: 'Computer' });
  await org.collection('departments').doc('it').set({ orgId: 'org-a', name: 'IT' });
  for (const [id, dep] of [
    ['s1', 'cs'],
    ['s2', 'cs'],
    ['s3', 'it'],
    ['s4', 'it'],
  ] as const)
    await org
      .collection('students')
      .doc(id)
      .set({ orgId: 'org-a', departmentId: dep, status: 'registered', name: `Name ${id}` });
  await org
    .collection('series')
    .doc('ser')
    .set({ orgId: 'org-a', title: 'Placement 2026', status: 'active', eligibility: {} });
  const test = org.collection('tests').doc('t1');
  await test.set({
    orgId: 'org-a',
    seriesId: 'ser',
    title: 'Quantitative aptitude',
    scheduledDate: '2026-11-01',
    totalMarks: 2,
    sections: [],
    resolved: { window: { start: 0, end: 1 } },
  });
  const options = (...texts: string[]) => texts.map((text, i) => ({ id: `${text}-${i}`, text }));
  await test
    .collection('questions')
    .doc('q1')
    .set({ order: 1, status: 'approved', options: options('24 m/s', '20 m/s'), correctOptionIds: ['20 m/s-1'] });
  await test
    .collection('questions')
    .doc('q2')
    .set({ order: 2, status: 'approved', options: options('30', '25'), correctOptionIds: ['30-0'] });
  const sat = async (id: string, studentId: string, status: string, score: number, picks: Record<string, string>) => {
    const ref = org.collection('attempts').doc(id);
    await ref.set({
      orgId: 'org-a',
      testId: 't1',
      seriesId: 'ser',
      studentId,
      status,
      strikesCount: status === 'terminated' ? 3 : 0,
      draw: { questionIds: ['q1', 'q2'] },
      result: { score, durationSec: 540, sections: {} },
    });
    for (const [q, optionId] of Object.entries(picks)) await ref.collection('answers').doc(q).set({ optionId });
  };
  await sat('a1', 's1', 'submitted', 2, { q1: '20 m/s-1', q2: '30-0' });
  await sat('a2', 's2', 'submitted', 1, { q1: '20 m/s-1', q2: '25-1' });
  await sat('a3', 's3', 'terminated', 0, { q1: '24 m/s-0' });
  await org
    .collection('attempts')
    .doc('a4')
    .set({ orgId: 'org-a', testId: 't1', studentId: 's4', status: 'in_progress' });
});

const create = async (id: string, includeXlsx = false) => {
  await org.collection('reports').doc(id).set({
    orgId: 'org-a',
    scope: 'test',
    refId: 't1',
    title: 'Day 1: Quantitative aptitude',
    status: 'queued',
    includeXlsx,
    createdBy: 'uid-1',
    createdByName: 'Admin 1',
    createdAt: NOW,
  });
  return id;
};
const run = async (id: string) => {
  const res = await app.inject({ method: 'POST', url: '/tasks/report', payload: { orgId: 'org-a', reportId: id } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { outcome: string }).outcome;
};
const stored = async (id: string) => (await org.collection('reports').doc(id).get()).data()!;
const tasks = async (id: string) =>
  (await db.collection('_localTasks').where('status', '==', 'pending').get()).docs
    .filter((d) => d.id.includes(id))
    .map((d) => ({ name: d.id, path: d.get('path') as string, scheduleTime: d.get('scheduleTime') as number }));
const markRun = async (id: string) => {
  for (const t of await tasks(id)) await db.collection('_localTasks').doc(t.name).update({ status: 'done' });
};
const pdfText = async (path: string) => {
  const doc = await getDocument({ data: new Uint8Array((await files.read(path))!), isEvalSupported: false }).promise;
  let text = '';
  for (let n = 1; n <= doc.numPages; n++)
    for (const item of (await (await doc.getPage(n)).getTextContent()).items) text += 'str' in item ? item.str : '';
  const producer = String(((await doc.getMetadata()).info as Record<string, unknown>).Producer);
  await doc.destroy();
  return { producer, text: text.replace(/\s+/g, '') };
};

describe('report task', () => {
  it('EXP-04 EXP-05 EXP-06 computes the metrics, asks with only their JSON, stores the PDF and marks it ready', async () => {
    llm.setScript({ report: { answers: [GOOD] } });
    const id = await create('r1');
    expect(await run(id)).toBe('ready: summary accepted');
    const rec = await stored(id);
    expect(rec).toMatchObject({
      status: 'ready',
      summary: GOOD.summary,
      recommendations: GOOD.recommendations,
      summaryStatus: 'accepted',
      summaryCalls: 1,
      provider: 'mock',
      model: 'mock-model',
      tokens: { input: 1000, output: 200 },
      pdfPath: `organizations/org-a/reports/${id}/report.pdf`,
      finishedAt: NOW,
    });
    expect(rec.xlsxPath).toBeUndefined();
    expect(rec.metrics).toMatchObject({
      title: 'Day 1: Quantitative aptitude',
      maxScore: 2,
      participation: { eligible: 4, finished: 3, inProgress: 1, notStarted: 0, ratePct: 75 },
      statuses: { submitted: 2, autoSubmitted: 0, terminated: 1 },
      scores: { mean: 1, median: 1, top: 2, bottom: 0 },
      departments: [
        { departmentId: 'cs', name: 'Computer', finished: 2, mean: 1.5, meanPct: 75 },
        { departmentId: 'it', name: 'IT', finished: 1, mean: 0, meanPct: 0 },
      ],
      mostMissed: [
        { number: 2, correctRatePct: 33.33 },
        { number: 1, correctRatePct: 66.67 },
      ],
      strikes: { total: 3, attemptsWithStrikes: 1, terminated: 1 },
    });
    const calls = llm.reportCalls();
    expect(calls).toEqual([{ system: SUMMARY_INSTRUCTIONS, prompt: JSON.stringify(rec.metrics) }]);
    expect(calls[0]!.prompt, 'no student in what the model receives').not.toMatch(/Name s\d|"s\d"/);
    const pdf = await pdfText(rec.pdfPath as string);
    expect(pdf.producer).toMatch(/^Skia\/PDF/);
    expect(pdf.text).toContain('WrittenbyAIfromthestatisticsinthisreport.');
    expect(pdf.text).toContain(GOOD.summary.replace(/\s+/g, ''));
    expect(pdf.text).toContain('Endedafterstrikes:1');
    expect(await tasks(id)).toEqual([]);

    expect(await run(id), 'REL-04 a task delivered again changes nothing').toBe('skipped');
    expect(llm.reportCalls()).toHaveLength(1);
  });

  it('EXP-05 an answer quoting an unsupported number is re-asked naming it, at most three answers in all', async () => {
    llm.setScript({ report: { answers: [BAD, BAD, GOOD] } });
    const id = await create('r2', true);
    expect(await run(id)).toBe('ready: summary accepted');
    const calls = llm.reportCalls();
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.prompt)).size, 'the same user message each time').toBe(1);
    expect(calls[0]!.system).toBe(SUMMARY_INSTRUCTIONS);
    expect(calls[1]!.system.startsWith(SUMMARY_INSTRUCTIONS)).toBe(true);
    expect(calls[1]!.system.split('\n').at(-1)).toContain('93.7');
    expect(await stored(id)).toMatchObject({
      summaryStatus: 'accepted',
      summary: GOOD.summary,
      summaryCalls: 3,
      xlsxPath: `organizations/org-a/reports/${id}/metrics.xlsx`,
    });
    expect(await files.read(`organizations/org-a/reports/${id}/metrics.xlsx`)).not.toBeNull();
  });

  it('EXP-05 three rejected answers leave the statistics with no summary, and nothing is retried later', async () => {
    llm.setScript({ report: { answers: [BAD] } });
    const id = await create('r3');
    expect(await run(id)).toBe('ready: summary rejected');
    expect(await stored(id)).toMatchObject({
      status: 'ready',
      summaryStatus: 'rejected',
      summary: null,
      recommendations: [],
      summaryCalls: 3,
    });
    expect(llm.reportCalls()).toHaveLength(3);
    expect(await tasks(id)).toEqual([]);
    const pdf = await pdfText((await stored(id)).pdfPath as string);
    expect(pdf.text).toContain('Thewrittensummarywasleftoutbecauseitusednumbersthatarenotinthesestatistics.');
    expect(pdf.text).not.toContain('93.7');
    expect(pdf.text).not.toContain('Recommendations');
  });

  it('REL-06 EXP-05 a provider error waits 1, 2 then 4 minutes with a task at retryAt; the fourth fails it', async () => {
    llm.setScript({ report: { answers: [GOOD], failures: 1 } });
    const id = await create('r4');
    expect(await run(id)).toBe(`retrying at ${NOW + MIN}`);
    const waiting = await stored(id);
    expect(waiting).toMatchObject({
      status: 'retrying',
      retryAt: NOW + MIN,
      failures: 1,
      error: { code: 'LLM_UNAVAILABLE', message: "The AI service didn't answer.", retryable: true },
    });
    expect(waiting.pdfPath).toBeUndefined();
    expect(waiting.metrics, 'the metrics are kept for the retry').toBeDefined();
    expect(await tasks(id)).toEqual([
      { name: `report-${id}-retry-1-${NOW + MIN}`, path: '/tasks/report', scheduleTime: NOW + MIN },
    ]);
    expect(await run(id), 'delivered before retryAt').toBe(`skipped: waiting until ${NOW + MIN}`);
    await markRun(id);
    clock.advance(MIN);
    expect(await run(id)).toBe('ready: summary accepted');
    const done = await stored(id);
    expect(done).toMatchObject({ status: 'ready', failures: 0, summaryCalls: 2 });
    expect(done.error).toBeUndefined();
    expect(done.retryAt).toBeUndefined();
    expect(llm.reportCalls().map((c) => c.prompt)).toEqual([
      JSON.stringify(done.metrics),
      JSON.stringify(done.metrics),
    ]);

    llm.setScript({ report: { answers: [GOOD], failures: 4 } });
    const failing = await create('r5');
    for (const delay of [MIN, 2 * MIN, 4 * MIN]) {
      const now = clock.now();
      expect(await run(failing)).toBe(`retrying at ${now + delay}`);
      await markRun(failing);
      clock.advance(delay);
    }
    expect(await run(failing)).toBe('failed: LLM_UNAVAILABLE');
    expect(await stored(failing)).toMatchObject({
      status: 'failed',
      error: { code: 'LLM_UNAVAILABLE', message: "The AI service didn't answer after 4 tries." },
      summaryCalls: 4,
    });
    expect(await tasks(failing)).toEqual([]);
  });

  it('REL-06 a retry delivered before its retryAt queues the run again for retryAt', async () => {
    llm.setScript({ report: { answers: [GOOD], failures: 1 } });
    const id = await create('r7');
    expect(await run(id)).toBe(`retrying at ${NOW + MIN}`);
    // The retry task itself arrives a second early (the queue's clock runs ahead): it is used up by this delivery.
    await markRun(id);
    clock.advance(MIN - 1000);
    expect(await run(id)).toBe(`skipped: waiting until ${NOW + MIN}`);
    expect((await tasks(id)).map((t) => t.scheduleTime)).toEqual([NOW + MIN]);
    await markRun(id);
    clock.advance(1000);
    expect(await run(id)).toBe('ready: summary accepted');
  });

  it('REL-04 an accepted summary is stored before the print, so a delivery after a failed print asks nothing', async () => {
    llm.setScript({ report: { answers: [GOOD] } });
    const id = await create('r8');
    failNextPrint = true;
    const res = await app.inject({ method: 'POST', url: '/tasks/report', payload: { orgId: 'org-a', reportId: id } });
    expect(res.statusCode, 'the queue delivers it again').toBe(500);
    expect(await stored(id)).toMatchObject({ summaryStatus: 'accepted', summary: GOOD.summary, summaryCalls: 1 });
    expect(await run(id)).toBe('ready: summary accepted');
    expect(llm.reportCalls(), 'the model is not asked again').toHaveLength(1);
    expect(await stored(id)).toMatchObject({ status: 'ready', summary: GOOD.summary, summaryCalls: 1 });
  });

  it('REL-04 a delivery while another run holds the report queues a check for when its lease ends', async () => {
    const id = await create('r6');
    await org
      .collection('reports')
      .doc(id)
      .update({ status: 'running', runId: 'other', leaseUntil: NOW + 5 * MIN });
    expect(await run(id)).toBe(`skipped: held until ${NOW + 5 * MIN}`);
    expect((await tasks(id)).map((t) => t.scheduleTime)).toEqual([NOW + 5 * MIN]);
    await markRun(id);
    clock.advance(5 * MIN);
    expect(await run(id), 'a run that died is taken over once its lease ends').toBe('ready: summary accepted');
  });
});
