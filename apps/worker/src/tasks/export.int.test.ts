import { TestClock, type LeaderboardRow } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { exportData } from '../export-data';
import { initFileStore, initFirestore } from '../firebase';
import { clearFirestore } from '../test-support/emulators';
import { localTaskQueue } from './local-queue';

// /tasks/export on the Firestore and Storage emulators (EXP-01 to EXP-03, REL-04): the worker builds the file from the
// stored attempts, profiles and boards, saves it at the record's filePath and marks it ready; a second run is a no-op.

const db = initFirestore();
const files = initFileStore();
const bucket = getStorage(getApps()[0]).bucket(`${process.env.GCLOUD_PROJECT}.appspot.com`);
const clock = new TestClock();
const org = db.doc('organizations/org-a');
const START = 1_793_592_000_000; // 2 Nov 2026, 09:30 IST
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue: localTaskQueue(db, clock),
    exports: { data: exportData(db), files },
  });
});

const NAMES = ['Asha', 'Bina', 'Chirag', 'Dev'];
beforeEach(async () => {
  await clearFirestore();
  clock.set(START + 3_600_000);
  await org.set({ orgId: 'org-a', timezone: 'Asia/Kolkata' });
  await org.collection('series').doc('s1').set({ orgId: 'org-a', title: 'Placement 2026' });
  await org.collection('departments').doc('d1').set({ orgId: 'org-a', name: 'Computer Engineering' });
  for (const [i, name] of NAMES.entries())
    await org
      .collection('students')
      .doc(`stu-${i + 1}`)
      .set({
        orgId: 'org-a',
        name: i === 3 ? '=HYPERLINK("x")' : name,
        email: `s${i + 1}@a.test`,
        prn: `+2201${i + 1}`,
        departmentId: 'd1',
        graduationYear: 2026,
      });
  const test = (id: string, title: string, scheduledDate: string, sections: object[] = []) =>
    org
      .collection('tests')
      .doc(id)
      .set({
        orgId: 'org-a',
        seriesId: 's1',
        title,
        scheduledDate,
        sections,
        createdAt: 0,
        resolved: { timingMode: 'fixed', window: { start: START, end: START + 1 }, resultRelease: 'immediate' },
      });
  await test('t1', 'Quantitative aptitude', '2026-11-02', [
    { id: 'q', name: 'Quant' },
    { id: 'v', name: 'Verbal' },
  ]);
  await test('t2', 'Verbal ability', '2026-11-03');
});

const sat = (testId: string, n: number, score: number, status = 'submitted', extra: object = {}) =>
  org
    .collection('attempts')
    .doc(`${testId}-${n}-${status}`)
    .set({
      orgId: 'org-a',
      testId,
      seriesId: 's1',
      studentId: `stu-${n}`,
      status,
      startedAt: START,
      ...(status === 'in_progress' ? {} : { submittedAt: START + 600_000 + n * 1000 }),
      strikesCount: status === 'terminated' ? 3 : 0,
      ...(status === 'terminated' ? { terminationReason: 'max_strikes' } : {}),
      extraTimeSec: 0,
      ...(status === 'in_progress'
        ? {}
        : {
            result: {
              score,
              max: 3,
              pct: (score / 3) * 100,
              correct: score,
              incorrect: 0,
              unanswered: 3 - score,
              durationSec: 600,
              sections: { q: { score }, v: { score: 0 } },
            },
          }),
      ...extra,
    });
const task = async (path: string, payload: object) => {
  const res = await app.inject({ method: 'POST', url: `/tasks/${path}`, payload });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ outcome: string }>().outcome;
};
const requestExport = (id: string, scope: string, refId: string, format: string) =>
  org
    .collection('exports')
    .doc(id)
    .set({ orgId: 'org-a', scope, refId, format, status: 'queued', filePath: `organizations/org-a/exports/${id}` });
const stored = async (id: string) => (await org.collection('exports').doc(id).get()).data()!;
const file = async (id: string) => (await bucket.file(`organizations/org-a/exports/${id}`).download())[0];
const csvRows = (b: Buffer) =>
  b
    .subarray(3)
    .toString('utf8')
    .trimEnd()
    .split('\r\n')
    .map((l) => l.split(','));
describe('/tasks/export', () => {
  it('EXP-01 EXP-03 REL-04 writes the test CSV with every column, ranks matching rankTest, and a second run is a no-op', async () => {
    await sat('t1', 1, 1);
    await sat('t1', 2, 2, 'auto_submitted', { extraTimeSec: 120 });
    await sat('t1', 3, 3, 'terminated');
    await sat('t1', 4, 0, 'in_progress');
    await sat('t1', 1, 0, 'reset');
    await task('leaderboard', { orgId: 'org-a', testId: 't1', seriesId: 's1' });
    await requestExport('e1', 'test', 't1', 'csv');

    expect(await task('export', { orgId: 'org-a', exportId: 'e1' })).toBe('stored');
    expect(await stored('e1')).toMatchObject({ status: 'ready', readyAt: clock.now() });
    const body = await file('e1');
    expect([...body.subarray(0, 3)], 'byte order mark').toEqual([0xef, 0xbb, 0xbf]);
    const rows = csvRows(body);
    expect(rows[0]).toEqual([
      ...['Name', 'Email', 'PRN', 'Department', 'Graduation year', 'Status', 'Score', 'Maximum', 'Percentage', 'Rank'],
      ...['Quant score', 'Verbal score', 'Correct', 'Incorrect', 'Unanswered'],
      ...['Started at (IST)', 'Submitted at (IST)', 'Time taken (seconds)', 'Strikes', 'Termination reason'],
      'Extra time (minutes)',
    ]);
    const board = (await org.collection('leaderboards').doc('test_t1').get()).get('rows') as LeaderboardRow[];
    expect(rows.slice(1, 3).map((r) => [r[0], r[9]])).toEqual(board.map((r) => [r.name, String(r.rank)]));
    expect(rows[1]).toEqual([
      ...['Bina', 's2@a.test', "'+22012", 'Computer Engineering', '2026', 'Submitted automatically'],
      ...['2', '3', '66.67', '1', '2', '0', '2', '0', '1'],
      ...['2026-11-02 09:30:00', '2026-11-02 09:40:02', '600', '0', '', '2'],
    ]);
    expect(rows.slice(3).map((r) => [r[0], r[5], r[6], r[9], r[19]])).toEqual([
      [`"'=HYPERLINK(""x"")"`, 'In progress', '', '', ''],
      ['Chirag', 'Ended after strikes', '3', '', 'Maximum strikes reached'],
    ]);
    expect(rows[3]![16], 'not submitted').toBe('');
    expect(rows, 'the reset attempt is left out').toHaveLength(5);

    const [before] = await bucket.file('organizations/org-a/exports/e1').getMetadata();
    clock.set(clock.now() + 60_000);
    expect(await task('export', { orgId: 'org-a', exportId: 'e1' })).toBe('skipped');
    const [after] = await bucket.file('organizations/org-a/exports/e1').getMetadata();
    expect(after.generation, 'the file is not written again').toBe(before.generation);
    expect((await stored('e1')).readyAt).toBe(START + 3_600_000);
  });

  it('EXP-03 ORG-03 a missing test or series marks the export failed and stores no file', async () => {
    await requestExport('e5', 'test', 'nope', 'csv');
    await requestExport('e6', 'series', 'nope', 'xlsx');
    expect(await task('export', { orgId: 'org-a', exportId: 'e5' })).toBe('failed');
    expect(await task('export', { orgId: 'org-a', exportId: 'e6' })).toBe('failed');
    expect(await task('export', { orgId: 'org-b', exportId: 'e5' })).toBe('skipped');
    expect((await stored('e5')).status).toBe('failed');
    expect((await bucket.file('organizations/org-a/exports/e5').exists())[0]).toBe(false);
  });
});
