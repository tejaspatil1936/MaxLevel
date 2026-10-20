import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, leaks, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// Submitting and grading (EX-15, EX-16, EX-17, DATA-05, API-02): POST /v1/attempts/{id}/submit on the emulators.

const { db, auth } = initFirebase();
const org = `organizations/${SEED.orgA}`;
const student = (n = 1, orgId: string = SEED.orgA) => studentOf(auth, n, orgId);
let ctx: Awaited<ReturnType<typeof testApp>>;
let api: ReturnType<typeof attemptClient>;

beforeAll(async () => {
  ctx = await testApp();
  api = attemptClient(ctx.app);
});

beforeEach(async () => {
  await clearEmulators();
  ctx.clock.set(NOW);
  await seedBase(db, NOW);
});

const submit = async (id: string, headers: Record<string, string>, body: object = {}, key: string | null = null) => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/v1/attempts/${id}/submit`,
    headers: { ...headers, ...(key !== null ? { 'idempotency-key': key } : {}) },
    payload: body,
  });
  return { status: res.statusCode, body: res.json() as { status: string; submittedAt: number }, raw: res.body };
};
const fresh = () => crypto.randomUUID();
const stored = async (id: string) => (await db.doc(`${org}/attempts/${id}`).get()).data()!;

/** Answers the `basic` set (correct options a, b, b, c) through the real answers route. */
async function answer(id: string, headers: Record<string, string>, picks: Record<string, string | null>) {
  const answers = Object.entries(picks).map(([questionId, optionId]) => ({
    questionId,
    optionId,
    seq: 1,
    clientTs: ctx.clock.now(),
  }));
  const res = await api.answers(id, headers, { answers, backlog: 0, clockOffsetMs: 0 });
  expect(res.status, res.raw).toBe(200);
}

describe('submitting an attempt', () => {
  it('EX-15 EX-17 grades the stored answers on submit, stores the result and queues the test leaderboard', async () => {
    const t = await api.examTest({ overrides: { marking: { marks: 1, negativeMarks: 0.25, preset: 'p1_m025' } } });
    const s1 = await student(1);
    const { body } = await api.start(t.testId, s1);
    const [q1, q2, q3] = t.questionIds;
    await answer(body.attempt.id, s1, { [q1!]: 'a', [q2!]: 'a', [q3!]: null });
    ctx.clock.set(NOW + 7 * MIN + 30_500);

    const res = await submit(body.attempt.id, s1, {}, fresh());
    expect(res.status, res.raw).toBe(200);
    expect(res.body).toEqual({ status: 'submitted', submittedAt: NOW + 7 * MIN + 30_500 });
    const a = await stored(body.attempt.id);
    expect(a).toMatchObject({ status: 'submitted', submittedAt: NOW + 7 * MIN + 30_500 });
    expect(a.result).toEqual({
      score: 0.75,
      max: 4,
      pct: 18.75,
      correct: 1,
      incorrect: 1,
      unanswered: 2,
      sections: { none: { score: 0.75, max: 4, correct: 1, incorrect: 1, unanswered: 2 } },
      durationSec: 450,
    });
    const tasks = await ctx.queue.pending();
    const slot = Math.floor((NOW + 7 * MIN + 30_500) / 30_000);
    expect(tasks).toContainEqual({
      name: `leaderboard-${SEED.orgA}-${t.testId}-${slot}`,
      path: '/tasks/leaderboard',
      scheduleTime: (slot + 1) * 30_000,
    });
    const task = await db.doc(`_localTasks/leaderboard-${SEED.orgA}-${t.testId}-${slot}`).get();
    expect(task.get('payload')).toEqual({ orgId: SEED.orgA, testId: t.testId, seriesId: t.seriesId });
  });

  it('LB-03 finishes within one 30-second slot share one recompute, run at the slot end; the next slot gets its own', async () => {
    const t = await api.examTest();
    const slotStart = (Math.floor(NOW / 30_000) + 1) * 30_000;
    const finish = async (n: number, at: number) => {
      const headers = await student(n);
      const { body } = await api.start(t.testId, headers);
      ctx.clock.set(at);
      expect((await submit(body.attempt.id, headers, {}, fresh())).status).toBe(200);
    };
    const boardTasks = async () =>
      (await ctx.queue.pending()).filter((k) => k.name.startsWith(`leaderboard-${SEED.orgA}-${t.testId}-`));
    await finish(1, slotStart + 1_000);
    await finish(2, slotStart + 29_999);
    expect(await boardTasks(), 'one task for both').toEqual([
      expect.objectContaining({ path: '/tasks/leaderboard', scheduleTime: slotStart + 30_000 }),
    ]);
    await finish(3, slotStart + 30_000);
    const next = await boardTasks();
    expect(next.map((k) => k.scheduleTime)).toEqual([slotStart + 30_000, slotStart + 60_000]);
    expect(new Set(next.map((k) => k.name)).size).toBe(2);
  });

  it('EX-17 Q-06 grades the draw stored on the attempt with the answer key, whatever the questions now say', async () => {
    const t = await api.examTest();
    const s1 = await student(1);
    const { body } = await api.start(t.testId, s1);
    const [q1, q2, q3, q4] = t.questionIds;
    await answer(body.attempt.id, s1, { [q1!]: 'a', [q2!]: 'b', [q3!]: 'b', [q4!]: 'c' });
    // The stored draw holds three of the four questions; the answer to the fourth does not count.
    const draw = (await stored(body.attempt.id)).draw as { questionIds: string[]; sections: unknown[] };
    await db.doc(`${org}/attempts/${body.attempt.id}`).update({
      'draw.questionIds': [q1, q2, q3],
      'draw.sections': [{ sectionId: null, questionIds: [q1, q2, q3] }],
    });
    expect(draw.questionIds).toHaveLength(4);

    expect((await submit(body.attempt.id, s1, {}, fresh())).status).toBe(200);
    expect((await stored(body.attempt.id)).result).toMatchObject({ score: 3, max: 3, correct: 3, unanswered: 0 });
  });

  it('EX-16 a submit because time ran out is stored as auto_submitted', async () => {
    const t = await api.examTest();
    const s1 = await student(1);
    const { body } = await api.start(t.testId, s1);
    ctx.clock.set(body.attempt.deadlineAt + 1500);
    const res = await submit(body.attempt.id, s1, { reason: 'time_up' }, fresh());
    expect(res.body).toEqual({ status: 'auto_submitted', submittedAt: body.attempt.deadlineAt + 1500 });
    expect((await stored(body.attempt.id)).result).toMatchObject({ score: 0, unanswered: 4 });
    expect((await stored(body.attempt.id)).result.durationSec).toBe((body.attempt.deadlineAt - NOW) / 1000);
  });

  it('EX-16 OPS-06 a time_up naming a deadline before the stored one is 409 with the current deadline; a manual submit is not', async () => {
    const t = await api.examTest();
    const s1 = await student(1);
    const { body } = await api.start(t.testId, s1);
    const opened = body.attempt.deadlineAt;
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    const grant = await ctx.app.inject({
      method: 'POST',
      url: `/v1/attempts/${body.attempt.id}/extra-time`,
      headers: admin,
      payload: { minutes: 10, reason: 'Power cut' },
    });
    expect(grant.statusCode, grant.body).toBe(200);
    // The device was offline during the grant: its timer reached the old deadline.
    ctx.clock.set(opened + 5_000);

    const early = await submit(body.attempt.id, s1, { reason: 'time_up', deadlineAt: opened }, fresh());
    expect(early.status, early.raw).toBe(409);
    expect(JSON.parse(early.raw)).toMatchObject({
      error: { code: 'DEADLINE_NOT_REACHED', details: { deadlineAt: opened + 10 * MIN } },
    });
    expect((await stored(body.attempt.id)).status).toBe('in_progress');

    // Within the clock grace of the stored deadline the time_up is taken.
    ctx.clock.set(opened + 10 * MIN - 1_000);
    const due = await submit(body.attempt.id, s1, { reason: 'time_up', deadlineAt: opened + 10 * MIN }, fresh());
    expect(due.body).toMatchObject({ status: 'auto_submitted' });
  });

  it('EX-15 a manual submit is taken at any time, before the deadline', async () => {
    const t = await api.examTest();
    const s1 = await student(1);
    const { body } = await api.start(t.testId, s1);
    ctx.clock.set(NOW + MIN);
    const res = await submit(body.attempt.id, s1, {}, fresh());
    expect(res.status, res.raw).toBe(200);
    expect(res.body).toMatchObject({ status: 'submitted' });
  });

  it('EX-15 API-02 a repeat returns the same submission, a replayed key the stored body, and later answers are 409', async () => {
    const t = await api.examTest();
    const s1 = await student(1);
    const { body } = await api.start(t.testId, s1);
    const key = fresh();
    const first = await submit(body.attempt.id, s1, {}, key);
    ctx.clock.set(NOW + 2 * MIN);
    const replay = await submit(body.attempt.id, s1, {}, key);
    expect(replay.raw, 'the stored response byte for byte').toBe(first.raw);
    const again = await submit(body.attempt.id, s1, { reason: 'time_up' }, fresh());
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);

    const late = await api.answers(body.attempt.id, s1, {
      answers: [{ questionId: t.questionIds[0], optionId: 'a', seq: 1, clientTs: NOW }],
      backlog: 0,
      clockOffsetMs: 0,
    });
    expect(late.status).toBe(409);
    expect(errorCode(late)).toBe('ATTEMPT_FINISHED');
    const restart = await api.start(t.testId, s1);
    expect(restart.status).toBe(409);
    expect(errorCode(restart)).toBe('ATTEMPT_FINISHED');
  });

  it('EX-15 ORG-05 only the attempt’s own student submits it: others get 404, staff 403, no key 400', async () => {
    const t = await api.examTest();
    const s1 = await student(1);
    const { body } = await api.start(t.testId, s1);
    const id = body.attempt.id;
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    const cases: Array<[string, Record<string, string>, number]> = [
      ['another student', await student(2), 404],
      ['a student of org B', await student(1, SEED.orgB), 404],
      ['an admin', admin, 403],
    ];
    for (const [who, headers, status] of cases)
      expect((await submit(id, headers, {}, fresh())).status, who).toBe(status);
    const noKey = await submit(id, s1, {});
    expect(noKey.status).toBe(400);
    expect(errorCode(noKey)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await submit(id, s1, { reason: 'early' }, fresh())).status, 'unknown reason').toBe(400);
    expect((await stored(id)).status).toBe('in_progress');
  });

  it('DATA-05 start, answers, submit and every read after grading carry no answer key or explanation', async () => {
    const t = await api.examTest();
    const s1 = await student(1);
    const bodies: string[] = [];
    const started = await api.start(t.testId, s1);
    bodies.push(started.raw);
    const id = started.body.attempt.id;
    bodies.push((await api.answers(id, s1, { answers: [], backlog: 0, clockOffsetMs: 0 })).raw);
    bodies.push((await submit(id, s1, {}, fresh())).raw);
    bodies.push((await api.resume(id, s1)).raw);
    for (const status of ['auto_submitted', 'terminated']) {
      await db.doc(`${org}/attempts/${id}`).update({ status });
      const graded = await api.resume(id, s1);
      expect(graded.body.attempt.status).toBe(status);
      bodies.push(graded.raw);
    }
    const dashboard = await ctx.app.inject({ method: 'GET', url: '/v1/student/dashboard', headers: s1 });
    expect(dashboard.json().completed).toHaveLength(1);
    bodies.push(dashboard.body);
    const history = await ctx.app.inject({ method: 'GET', url: '/v1/student/history', headers: s1 });
    expect(history.json().series).toHaveLength(1);
    bodies.push(history.body);
    await db
      .doc(`${org}/tests/${t.testId}`)
      .update({ 'resolved.testLeaderboard': true, 'resolved.resultRelease': 'immediate' });
    const board = await ctx.app.inject({ method: 'GET', url: `/v1/leaderboards/test_${t.testId}`, headers: s1 });
    expect(board.statusCode, board.body).toBe(200);
    bodies.push(board.body);
    const boards = await ctx.app.inject({ method: 'GET', url: '/v1/student/leaderboards', headers: s1 });
    expect(boards.json().boards).toHaveLength(1);
    bodies.push(boards.body);
    for (const raw of bodies) expect(leaks(raw)).toEqual([]);
  });
});
