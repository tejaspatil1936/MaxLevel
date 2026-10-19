import { attemptPayloadSchema } from '@mitaoe/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode as code, leaks, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// POST /v1/attempts (EX-03, EX-04, SER-08, DATA-05, PERF-03, API-02).

const { db, auth, rtdb } = initFirebase();
const org = `organizations/${SEED.orgA}`;
const student = (n = 1, orgId: string = SEED.orgA) => studentOf(auth, n, orgId);
let ctx: Awaited<ReturnType<typeof testApp>>;
let api: ReturnType<typeof attemptClient>;
const examTest = (body: object = {}) => api.examTest(body);
const start = (...args: Parameters<typeof api.start>) => api.start(...args);

beforeAll(async () => {
  ctx = await testApp();
  api = attemptClient(ctx.app);
});

beforeEach(async () => {
  await clearEmulators();
  ctx.clock.set(NOW);
  await seedBase(db, NOW);
});

describe('starting an attempt', () => {
  it('EX-03 EX-04 PERF-03 DATA-05 stores the attempt, schedules auto-submit, mirrors it and returns one payload without answers', async () => {
    const t = await examTest();
    const s1 = await student(1);
    const first = await start(t.testId, s1, 'key-1');

    expect(first.status, first.raw).toBe(201);
    expect(attemptPayloadSchema.parse(first.body)).toEqual(first.body);
    const id = first.body.attempt.id;
    expect(first.body).toMatchObject({
      test: { id: t.testId, title: 'Quantitative aptitude', dayLabel: 'Day 1' },
      attempt: {
        testId: t.testId,
        status: 'in_progress',
        startedAt: NOW,
        deadlineAt: t.window.end,
        strikesCount: 0,
        maxStrikes: 3,
      },
      sections: [],
      answers: {},
      questionServedAt: {},
      serverTime: NOW,
      settings: { timingMode: 'fixed', window: t.window, marking: { marks: 1, negativeMarks: 0 } },
    });
    expect(first.body.questions.map((q) => q.id)).toEqual(t.questionIds);
    expect(first.body.questions[1]).toMatchObject({ sectionId: null, prompt: 'What is 15% of 200?' });
    expect(first.body.questions[1]!.options.map((o) => o.text)).toEqual(['25', '30', '35', '40']);
    expect(leaks(first.raw), 'answer keys in the start payload').toEqual([]);

    const stored = (await db.doc(`${org}/attempts/${id}`).get()).data()!;
    expect(stored).toMatchObject({
      orgId: SEED.orgA,
      testId: t.testId,
      seriesId: t.seriesId,
      studentId: 'stu-org-a-01',
      status: 'in_progress',
      startedAt: NOW,
      deadlineAt: t.window.end,
      extraTimeSec: 0,
      strikesCount: 0,
      draw: { questionIds: t.questionIds },
    });
    expect((await db.doc(`${org}/attemptIndex/${t.testId}_stu-org-a-01`).get()).data()).toMatchObject({
      activeAttemptId: id,
      attemptCount: 1,
    });
    expect((await db.doc(`${org}/tests/${t.testId}`).get()).get('attemptsStarted')).toBe(true);
    expect(await ctx.queue.pending()).toEqual([
      // Queued when the scenario published the test, as Publish test does (PERF-06).
      {
        name: `prewarm-${SEED.orgA}-${t.testId}-${t.window.start}`,
        path: '/tasks/prewarm',
        scheduleTime: NOW,
      },
      {
        name: `release-results-${SEED.orgA}-${t.testId}-${t.window.end}`,
        path: '/tasks/release-results',
        scheduleTime: t.window.end,
      },
      { name: `auto-submit-${id}-${t.window.end}`, path: '/tasks/auto-submit', scheduleTime: t.window.end + 120_000 },
    ]);
    expect((await rtdb.ref(`attemptOwners/${id}`).get()).val()).toBe(stored.uid);
    expect((await rtdb.ref(`live/${SEED.orgA}/${t.testId}/${id}`).get()).val()).toEqual({
      studentId: `stu-${SEED.orgA}-01`,
      name: 'Aarav Kulkarni',
      prn: '22010101',
      status: 'in_progress',
      answered: 0,
      total: 4,
      strikes: 0,
      deadlineAt: t.window.end,
      startedAt: NOW,
      updatedAt: NOW,
    });

    // EX-04, API-02: the same key replays byte for byte; another key returns the same attempt.
    ctx.clock.advance(MIN);
    const replay = await start(t.testId, s1, 'key-1');
    expect(replay.status).toBe(201);
    expect(replay.raw).toBe(first.raw);
    const again = await start(t.testId, s1, 'key-2');
    expect(again.status).toBe(200);
    expect(again.body.attempt).toEqual(first.body.attempt);
    expect(again.body.questions).toEqual(first.body.questions);
    expect(again.body.serverTime).toBe(NOW + MIN);
    expect((await db.collection(`${org}/attempts`).get()).size).toBe(1);
    expect(await ctx.queue.pending(), 'still one auto-submit, one release and one pre-warm task').toHaveLength(3);
  });

  it('EX-03 SER-08 refuses a student the stored rules leave out, outside the window, and tests not open to start', async () => {
    const t = await examTest({ eligibility: { exclude: ['stu-org-a-03'] } });
    const mech = await examTest({
      title: 'Mechanical design',
      eligibility: { departmentIds: ['dept-org-a-mechanical'] },
    });
    const s1 = await student(1);

    // Student 01 (Computer) moved to Mechanical after the dashboard loaded; student 03 is on the exclude list.
    await db.doc(`${org}/students/stu-org-a-01`).update({ departmentId: 'dept-org-a-mechanical' });
    expect((await start(mech.testId, s1)).status, 'eligible now').toBe(201);
    await db.doc(`${org}/students/stu-org-a-05`).update({ graduationYear: 2031 });
    await db.doc(`${org}/series/${t.seriesId}`).update({ 'eligibility.graduationYears': [2026, 2027] });
    for (const n of [3, 5]) {
      const refused = await start(t.testId, await student(n));
      expect(refused.status, `student ${n}`).toBe(403);
      expect(code(refused)).toBe('NOT_ELIGIBLE');
    }
    const upcoming = await examTest({ title: 'Later test', opensInMin: 60 });
    const late = await examTest({ title: 'Late test', opensInMin: -20 });
    const draft = await examTest({ title: 'Unpublished test', publish: false });
    const paused = await examTest({ title: 'Paused series test', seriesStatus: 'draft' });
    const b = await examTest({ orgId: SEED.orgB, title: 'COEP aptitude' });
    expect(code(await start(upcoming.testId, s1))).toBe('WINDOW_NOT_OPEN');
    expect(code(await start(late.testId, s1))).toBe('WINDOW_CLOSED');
    for (const id of [draft.testId, paused.testId, b.testId, 'missing'])
      expect((await start(id, s1)).status, id).toBe(404);
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    expect((await start(t.testId, admin)).status).toBe(403);
    const missingKey = await start(t.testId, s1, null);
    expect(missingKey.status).toBe(400);
    expect(code(missingKey)).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const attempts = await db.collection(`${org}/attempts`).get();
    expect(
      attempts.docs.map((d) => d.get('testId')),
      'only the eligible start stored',
    ).toEqual([mech.testId]);
    expect((await db.doc(`${org}/tests/${t.testId}`).get()).get('attemptsStarted')).toBe(false);

    // A finished attempt is not started again.
    await db.doc(`${org}/attempts/${attempts.docs[0]!.id}`).update({ status: 'submitted', submittedAt: NOW });
    expect(code(await start(mech.testId, s1))).toBe('ATTEMPT_FINISHED');
  });

  it('EX-03 a flexible window fixes the deadline at start plus duration, and a start uses a reserved attempt ID', async () => {
    const t = await examTest({ timingMode: 'flexible', windowMin: 180, durationMin: 45 });
    await db.doc(`${org}/attemptIndex/${t.testId}_stu-org-a-01`).set({
      testId: t.testId,
      studentId: 'stu-org-a-01',
      reservedAttemptId: 'att-reserved-1',
      attemptCount: 0,
    });
    ctx.clock.advance(10 * MIN);
    const res = await start(t.testId, await student(1));
    expect(res.status, res.raw).toBe(201);
    expect(res.body.attempt).toMatchObject({ id: 'att-reserved-1', deadlineAt: NOW + 55 * MIN });
  });

  it('API-02 submitting needs an Idempotency-Key', async () => {
    const t = await examTest();
    const s1 = await student(1);
    const { body } = await start(t.testId, s1);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/attempts/${body.attempt.id}/submit`,
      headers: s1,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
