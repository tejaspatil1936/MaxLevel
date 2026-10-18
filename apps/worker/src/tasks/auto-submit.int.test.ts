import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initFirestore } from '../firebase';
import { clearFirestore } from '../test-support/emulators';
import { localTaskQueue } from './local-queue';

// /tasks/auto-submit on the Firestore emulator (EX-16, EX-17, REL-04): the attempt is finalized with no browser.

const db = initFirestore();
const clock = new TestClock();
let app: FastifyInstance;
const org = db.doc('organizations/org-a');
const START = 1_793_592_000_000;
const DEADLINE = START + 30 * 60_000;
const DUE = DEADLINE + 120_000;

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
  // A published test: +2 / −1 by its own marking, section `quant` worth +3 each, q4 worth 5 on its own.
  await org
    .collection('tests')
    .doc('t1')
    .set({
      seriesId: 's1',
      sections: [{ id: 'quant', name: 'Quant', order: 1, forwardOnly: false, marks: 3 }],
      resolved: { marking: { marks: 2, negativeMarks: 1, preset: 'custom' }, floorAtZero: false },
    });
  for (const [id, correct, marks] of [
    ['q1', 'a', undefined],
    ['q2', 'b', undefined],
    ['q3', 'c', undefined],
    ['q4', 'd', 5],
    ['q5', 'a', undefined],
  ] as const)
    await org
      .collection('tests/t1/questions')
      .doc(id)
      .set({ correctOptionIds: [correct], explanation: `Why ${id}`, ...(marks ? { marks } : {}) });
  // The stored draw holds four of the five questions, q1 and q2 in `quant`.
  await org
    .collection('attempts')
    .doc('att-1')
    .set({
      orgId: 'org-a',
      testId: 't1',
      seriesId: 's1',
      studentId: 'stu-1',
      status: 'in_progress',
      startedAt: START,
      deadlineAt: DEADLINE,
      draw: {
        questionIds: ['q2', 'q1', 'q3', 'q4'],
        optionOrder: {},
        sections: [
          { sectionId: 'quant', questionIds: ['q2', 'q1'] },
          { sectionId: null, questionIds: ['q3', 'q4'] },
        ],
      },
    });
  const answers = org.collection('attempts/att-1/answers');
  await answers.doc('q1').set({ optionId: 'a', seq: 2, clientTs: START, serverTs: START });
  await answers.doc('q2').set({ optionId: 'a', seq: 1, clientTs: START, serverTs: START });
  await answers.doc('q4').set({ optionId: 'd', seq: 1, clientTs: START, serverTs: START });
  await answers.doc('q5').set({ optionId: 'a', seq: 1, clientTs: START, serverTs: START });
});

const run = (payload: object) => app.inject({ method: 'POST', url: '/tasks/auto-submit', payload });
const attempt = async () => (await org.collection('attempts').doc('att-1').get()).data()!;
const tasks = async () => (await db.collection('_localTasks').get()).docs.map((d) => d.data());

describe('the auto-submit task', () => {
  it('EX-16 EX-17 REL-04 finalizes an attempt nobody submitted from its stored draw, queues the leaderboard, and a second run changes nothing', async () => {
    clock.set(DUE + 5_000);
    const res = await run({ orgId: 'org-a', attemptId: 'att-1', deadlineAt: DEADLINE });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, outcome: 'finalized' });
    const done = await attempt();
    expect(done).toMatchObject({ status: 'auto_submitted', submittedAt: DUE + 5_000 });
    expect(done.result).toEqual({
      score: 3 - 1 + 5,
      max: 3 + 3 + 2 + 5,
      pct: Math.round((7 / 13) * 100 * 1e6) / 1e6,
      correct: 2,
      incorrect: 1,
      unanswered: 1,
      sections: {
        quant: { score: 2, max: 6, correct: 1, incorrect: 1, unanswered: 0 },
        none: { score: 5, max: 7, correct: 1, incorrect: 0, unanswered: 1 },
      },
      durationSec: 30 * 60,
    });
    const slot = Math.floor((DUE + 5_000) / 30_000);
    expect(await tasks()).toEqual([
      expect.objectContaining({
        name: `leaderboard-org-a-t1-${slot}`,
        path: '/tasks/leaderboard',
        payload: { orgId: 'org-a', testId: 't1', seriesId: 's1' },
        status: 'pending',
      }),
    ]);

    clock.set(DUE + 60_000);
    for (const payload of [
      { orgId: 'org-a', attemptId: 'att-1', deadlineAt: DEADLINE },
      { orgId: 'org-a', attemptId: 'att-1' },
    ]) {
      const again = await run(payload);
      expect(again.statusCode).toBe(200);
      expect(again.json().outcome).toBe('skipped');
    }
    expect(await attempt(), 'the same stored effect as one run').toEqual(done);
    expect(await tasks()).toHaveLength(1);
  });

  it('EX-16 queues a task for a deadline moved later and finalizes nothing; a run before its deadline is retried', async () => {
    const later = DEADLINE + 10 * 60_000;
    await org.collection('attempts').doc('att-1').update({ deadlineAt: later, extraTimeSec: 600 });
    clock.set(DUE);
    const res = await run({ orgId: 'org-a', attemptId: 'att-1', deadlineAt: DEADLINE });
    expect(res.json()).toEqual({ ok: true, outcome: 'rescheduled' });
    expect((await attempt()).status).toBe('in_progress');
    expect(await tasks()).toEqual([
      expect.objectContaining({
        name: `auto-submit-att-1-${later}`,
        path: '/tasks/auto-submit',
        payload: { orgId: 'org-a', attemptId: 'att-1', deadlineAt: later },
        scheduleTime: later + 120_000,
      }),
    ]);
    expect((await run({ orgId: 'org-a', attemptId: 'att-1', deadlineAt: DEADLINE })).statusCode).toBe(200);
    expect(await tasks(), 'rescheduling twice queues one task').toHaveLength(1);

    const early = await run({ orgId: 'org-a', attemptId: 'att-1', deadlineAt: later });
    expect(early.statusCode, 'too early for its own deadline').toBe(503);
    clock.set(later + 120_000);
    expect((await run({ orgId: 'org-a', attemptId: 'att-1', deadlineAt: later })).json().outcome).toBe('finalized');
    expect((await attempt()).status).toBe('auto_submitted');
  });

  it('REL-04 ORG-03 a missing attempt, one of another org and a finished one are acknowledged unchanged', async () => {
    clock.set(DUE);
    await org
      .collection('attempts')
      .doc('att-2')
      .set({ orgId: 'org-a', testId: 't1', status: 'submitted', deadlineAt: DEADLINE, submittedAt: 7 });
    for (const payload of [
      { orgId: 'org-a', attemptId: 'nope' },
      { orgId: 'org-b', attemptId: 'att-1' },
      { orgId: 'org-a', attemptId: 'att-2' },
    ]) {
      const res = await run(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(200);
      expect(res.json().outcome).toBe('skipped');
    }
    expect((await org.collection('attempts').doc('att-2').get()).data()).toMatchObject({
      status: 'submitted',
      submittedAt: 7,
    });
    expect((await attempt()).status).toBe('in_progress');
    expect(await tasks()).toEqual([]);
    expect((await run({ attemptId: 'att-1' })).statusCode, 'no org').toBe(400);
  });
});
