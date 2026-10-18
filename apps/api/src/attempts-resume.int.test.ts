import { drawAttempt, testDrawPools } from '@mitaoe/shared';
import { createData } from './data';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, leaks, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// The stored draw, resume and the published test cache (Q-06, EX-05, DATA-05, PERF-01).

const { db, auth } = initFirebase();
const org = `organizations/${SEED.orgA}`;
const student = (n = 1, orgId: string = SEED.orgA) => studentOf(auth, n, orgId);
let ctx: Awaited<ReturnType<typeof testApp>>;
let api: ReturnType<typeof attemptClient>;
const examTest = (body: object = {}) => api.examTest(body);
const start = (...args: Parameters<typeof api.start>) => api.start(...args);
const resume = (...args: Parameters<typeof api.resume>) => api.resume(...args);

beforeAll(async () => {
  ctx = await testApp();
  api = attemptClient(ctx.app);
});

beforeEach(async () => {
  await clearEmulators();
  ctx.clock.set(NOW);
  await seedBase(db, NOW);
});

const data = createData(db);

describe('the draw', () => {
  it('Q-06 is made once, seeded by the attempt ID, stored with the option order, and reused by resume', async () => {
    const t = await examTest({ overrides: { shuffleQuestions: true, shuffleOptions: true } });
    const s1 = await student(1);
    const { body } = await start(t.testId, s1);
    const id = body.attempt.id;

    const test = (await data.tests.getTest(SEED.orgA, t.testId))!;
    const questions = await data.questions.listQuestions(SEED.orgA, t.testId);
    const expected = drawAttempt(
      testDrawPools(test, questions),
      Object.fromEntries(questions.map((q) => [q.id, q.options.map((o) => o.id)])),
      test.resolved!,
      id,
    );
    const stored = (await db.doc(`${org}/attempts/${id}`).get()).get('draw');
    expect(stored).toEqual(expected);
    expect(body.questions.map((q) => q.id)).toEqual(expected.questionIds);
    for (const q of body.questions) expect(q.options.map((o) => o.id)).toEqual(expected.optionOrder[q.id]);

    for (let i = 0; i < 3; i++) {
      const again = await resume(id, s1);
      expect(again.body.questions, 'refreshing never reshuffles').toEqual(body.questions);
    }
    const other = await start(t.testId, await student(2));
    expect(other.body.attempt.id).not.toBe(id);
  });
});

describe('resuming an attempt', () => {
  it('EX-05 DATA-05 returns the saved answers, and after grading still no answer key; other students get 404', async () => {
    const t = await examTest();
    const s1 = await student(1);
    const { body } = await start(t.testId, s1);
    const id = body.attempt.id;
    const [q1, q2] = t.questionIds;
    await db.doc(`${org}/attempts/${id}/answers/${q1}`).set({ optionId: 'a', seq: 3, clientTs: NOW, serverTs: NOW });
    await db
      .doc(`${org}/attempts/${id}/answers/${q2}`)
      .set({ optionId: null, seq: 1, clientTs: NOW, serverTs: NOW, markedForReview: true });
    await db.doc(`${org}/attempts/${id}`).update({ [`questionServedAt.${q1}`]: NOW + 1000 });

    const res = await resume(id, s1);
    expect(res.status, res.raw).toBe(200);
    expect(res.body.answers).toEqual({
      [q1!]: { optionId: 'a', seq: 3 },
      [q2!]: { optionId: null, seq: 1, markedForReview: true },
    });
    expect(res.body.questionServedAt).toEqual({ [q1!]: NOW + 1000 });
    expect(res.body.questions).toEqual(body.questions);

    const result = {
      score: 1,
      max: 4,
      pct: 25,
      correct: 1,
      incorrect: 0,
      unanswered: 3,
      sections: {},
      durationSec: 60,
    };
    for (const status of ['submitted', 'auto_submitted', 'terminated']) {
      await db.doc(`${org}/attempts/${id}`).update({ status, submittedAt: NOW + MIN, result });
      const done = await resume(id, s1);
      expect(done.status).toBe(200);
      expect(done.body.attempt).toMatchObject({ status, submittedAt: NOW + MIN });
      expect(leaks(done.raw), `answer keys once ${status}`).toEqual([]);
      expect(done.raw).not.toContain('"result"');
    }

    expect((await resume(id, await student(2))).status, 'another student').toBe(404);
    expect((await resume(id, await student(1, SEED.orgB))).status, 'another org').toBe(404);
    expect((await resume('missing', s1)).status).toBe(404);
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    expect((await resume(id, admin)).status).toBe(403);
  });
});

describe('published test cache', () => {
  it('PERF-01 a second start reads no question records, and a question set version bump is picked up', async () => {
    const t = await examTest();
    await start(t.testId, await student(1));
    const [q1] = t.questionIds;
    // Changed behind the API's back without a new version: the cached set is still served.
    await db.doc(`${org}/tests/${t.testId}/questions/${q1}`).update({ prompt: 'Changed prompt' });
    const second = await start(t.testId, await student(2));
    expect(second.body.questions[0]!.prompt).toBe('A train 240 m long passes a pole in 12 seconds. What is its speed?');

    await db.doc(`${org}/tests/${t.testId}`).update({ questionSetVersion: 2 });
    const third = await start(t.testId, await student(3));
    expect(third.body.questions[0]!.prompt).toBe('Changed prompt');
  });
});
