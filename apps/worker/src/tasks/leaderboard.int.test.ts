import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initFirestore } from '../firebase';
import { clearFirestore } from '../test-support/emulators';
import { localTaskQueue } from './local-queue';

// /tasks/leaderboard on the Firestore emulator (LB-01 to LB-04, REL-04): the test board ranks every finished attempt
// but terminated ones, the series board sums only tests whose results are public, and a second run stores the same rows.

const db = initFirestore();
const clock = new TestClock();
const org = db.doc('organizations/org-a');
const START = 1_793_592_000_000;
const END = START + 60 * 60_000;
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue: localTaskQueue(db, clock),
  });
});

beforeEach(async () => {
  await clearFirestore();
  clock.set(END + 1_000);
});

const publish = (id: string, resolved: object = {}) =>
  org
    .collection('tests')
    .doc(id)
    .set({
      orgId: 'org-a',
      seriesId: 's1',
      resolved: { timingMode: 'fixed', window: { start: START, end: END }, resultRelease: 'immediate', ...resolved },
    });
const sat = (testId: string, studentId: string, score: number, status = 'submitted') =>
  org
    .collection('attempts')
    .doc(`${testId}-${studentId}`)
    .set({
      orgId: 'org-a',
      testId,
      seriesId: 's1',
      studentId,
      status,
      startedAt: START,
      submittedAt: START + 600_000,
      result: { score, max: 4, durationSec: 600 },
    });
const run = async (testId = 't1') => {
  const res = await app.inject({
    method: 'POST',
    url: '/tasks/leaderboard',
    payload: { orgId: 'org-a', testId, seriesId: 's1' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ outcome: string }>().outcome;
};
const board = async (id: string) => (await org.collection('leaderboards').doc(id).get()).data();
const ranks = (rows: Array<{ studentId: string; rank: number; score: number }>) =>
  rows.map((r) => [r.studentId, r.rank, r.score]);

describe('/tasks/leaderboard', () => {
  it('LB-01 LB-03 REL-04 stores the test board without terminated attempts, and the same rows on a second run', async () => {
    for (const [id, name] of [
      ['stu-1', 'Asha'],
      ['stu-2', 'Bina'],
    ] as const)
      await org.collection('students').doc(id).set({ name, departmentId: 'd1' });
    await publish('t1');
    await sat('t1', 'stu-1', 2);
    await sat('t1', 'stu-2', 3);
    await sat('t1', 'stu-3', 4, 'terminated');
    await sat('t1', 'stu-4', 4, 'in_progress');

    expect(await run()).toBe('stored');
    const first = await board('test_t1');
    expect(first).toMatchObject({ computedAt: END + 1_000, total: 2 });
    expect(first!.rows).toEqual([
      { studentId: 'stu-2', name: 'Bina', departmentId: 'd1', score: 3, rank: 1, timeSec: 600 },
      { studentId: 'stu-1', name: 'Asha', departmentId: 'd1', score: 2, rank: 2, timeSec: 600 },
    ]);
    clock.set(END + 5_000);
    await run();
    expect((await board('test_t1'))!.rows, 'a second run stores the same rows').toEqual(first!.rows);
    expect(ranks((await board('series_s1'))!.rows)).toEqual([
      ['stu-2', 1, 3],
      ['stu-1', 2, 2],
    ]);
  });

  it('LB-02 LB-04 the series board sums only tests whose results are public', async () => {
    await publish('t1');
    await publish('t2', { resultRelease: 'manual' });
    await publish('t3', { timingMode: 'flexible', window: { start: START, end: END + 600_000 } });
    await sat('t1', 'stu-1', 2);
    await sat('t2', 'stu-1', 4);
    await sat('t2', 'stu-2', 4);
    await sat('t3', 'stu-2', 4);

    await run('t2');
    expect(ranks((await board('test_t2'))!.rows), 'the test board ranks before release').toEqual([
      ['stu-1', 1, 4],
      ['stu-2', 1, 4],
    ]);
    expect(ranks((await board('series_s1'))!.rows), 'only t1 is public').toEqual([['stu-1', 1, 2]]);
    clock.set(END + 600_000);
    await run('t3');
    expect(ranks((await board('series_s1'))!.rows), 't3 once its window closed').toEqual([
      ['stu-2', 1, 4],
      ['stu-1', 2, 2],
    ]);
  });

  it('LB-03 acknowledges a missing or unpublished test and stores nothing', async () => {
    expect(await run()).toBe('skipped');
    await org.collection('tests').doc('t1').set({ orgId: 'org-a', seriesId: 's1' });
    expect(await run()).toBe('skipped');
    expect((await org.collection('leaderboards').get()).size).toBe(0);
  });
});
