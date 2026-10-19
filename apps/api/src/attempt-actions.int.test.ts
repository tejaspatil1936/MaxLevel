import { autoSubmitAction, drawAttempt, liveRecordPath, testDrawPools, type AuditEntry } from '@mitaoe/shared';
import { createData } from './data';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, leaks, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// POST /v1/attempts/{id}/terminate and …/reinstate (OPS-04, EX-16, DATA-05, AUD-02, spec 8.5): termination grades the
// attempt with the admin's reason, a reinstate undoes it, each with its audit entry, the live record and the
// auto-submit task following.

const { db, auth, rtdb } = initFirebase();
const org = `organizations/${SEED.orgA}`;
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

const adminA = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
const act = async (id: string, action: string, headers: Record<string, string>, payload: object) => {
  const res = await ctx.app.inject({ method: 'POST', url: `/v1/attempts/${id}/${action}`, headers, payload });
  return { status: res.statusCode, body: res.json() as { status: string }, raw: res.body };
};
const stored = async (id: string) => (await db.doc(`${org}/attempts/${id}`).get()).data()!;
const entries = async (action: string, id: string) =>
  (await db.collection(`${org}/auditLogs`).where('action', '==', action).get()).docs
    .map((d) => d.data() as AuditEntry)
    .filter((e) => e.target.id === id);
const live = async (testId: string, id: string) =>
  (await rtdb.ref(liveRecordPath(SEED.orgA, testId, id)).get()).val() as Record<string, unknown>;
const autoSubmits = async (id: string) =>
  (await ctx.queue.pending()).filter((k) => k.path === '/tasks/auto-submit' && k.name.includes(id)).map((k) => k.name);

async function started(exam: object = {}) {
  const t = await api.examTest(exam);
  const s1 = await studentOf(auth, 1);
  const { body } = await api.start(t.testId, s1);
  const id = body.attempt.id;
  const saved = await api.answers(id, s1, {
    answers: [{ questionId: t.questionIds[0]!, optionId: 'a', seq: 1, clientTs: NOW }],
    backlog: 0,
    clockOffsetMs: 0,
  });
  expect(saved.status, saved.raw).toBe(200);
  return { t, s1, id, deadlineAt: body.attempt.deadlineAt, q: t.questionIds };
}

describe('terminate and reinstate', () => {
  it('OPS-04 AUD-02 terminating grades the attempt with the reason and its audit entry; reinstating continues it', async () => {
    const { t, s1, id, deadlineAt } = await started();
    const admin = await adminA();
    const ended = await act(id, 'terminate', admin, { reason: ' Phone seen on the desk ' });
    expect([ended.status, ended.body], ended.raw).toEqual([200, { status: 'terminated' }]);
    const end = await stored(id);
    expect(end).toMatchObject({ status: 'terminated', terminationReason: 'Phone seen on the desk', submittedAt: NOW });
    expect(end.result).toBeDefined();
    expect(await entries('attempt.terminate', id)).toMatchObject([
      { actor: { email: 'admin1@a.test', role: 'admin' }, after: { reason: 'Phone seen on the desk' } },
    ]);
    expect(await live(t.testId, id)).toMatchObject({ status: 'terminated' });
    // RES-06: the student's ended screen shows the admin's reason.
    expect((await api.resume(id, s1)).body.attempt).toMatchObject({
      status: 'terminated',
      terminationReason: 'Phone seen on the desk',
    });
    expect(errorCode(await act(id, 'terminate', admin, { reason: 'Again' }))).toBe('ATTEMPT_FINISHED');

    const back = await act(id, 'reinstate', admin, { reason: 'Reviewed the recording' });
    expect([back.status, back.body], back.raw).toEqual([200, { status: 'in_progress' }]);
    const again = await stored(id);
    expect(again).toMatchObject({ status: 'in_progress', deadlineAt, strikesCount: 0 });
    for (const key of ['terminationReason', 'submittedAt', 'result']) expect(again, key).not.toHaveProperty(key);
    expect(await entries('attempt.reinstate', id)).toMatchObject([
      { target: { type: 'attempt', id }, after: { reason: 'Reviewed the recording' } },
    ]);
    expect(await live(t.testId, id)).toMatchObject({ status: 'in_progress', answered: 1, deadlineAt });
    const resumed = await api.resume(id, s1);
    expect(resumed.body.answers).toEqual({ [t.questionIds[0]!]: { optionId: 'a', seq: 1 } });
    expect(resumed.body.attempt).not.toHaveProperty('terminationReason');
    expect(errorCode(await act(id, 'reinstate', admin, { reason: 'Twice' }))).toBe('ATTEMPT_NOT_TERMINATED');
    expect(await entries('attempt.reinstate', id)).toHaveLength(1);
  });

  it('EX-16 OPS-04 a reinstate queues the auto-submit task for the deadline again, idempotently by name', async () => {
    const { id, deadlineAt } = await started();
    const admin = await adminA();
    expect((await act(id, 'terminate', admin, { reason: 'Phone' })).status).toBe(200);
    // The queued task already ran (as when the deadline passed while the attempt was ended).
    await db.doc(`_localTasks/auto-submit-${id}-${deadlineAt}`).delete();
    expect(await autoSubmits(id)).toEqual([]);
    expect((await act(id, 'reinstate', admin, { reason: 'False alarm' })).status).toBe(200);
    expect(await autoSubmits(id)).toEqual([`auto-submit-${id}-${deadlineAt}`]);
    expect((await act(id, 'terminate', admin, { reason: 'Phone again' })).status).toBe(200);
    expect((await act(id, 'reinstate', admin, { reason: 'False alarm again' })).status).toBe(200);
    expect(await autoSubmits(id)).toEqual([`auto-submit-${id}-${deadlineAt}`]);

    // Reinstated after the task's time: a task of its own finalizes the attempt when it runs.
    expect((await act(id, 'terminate', admin, { reason: 'Phone once more' })).status).toBe(200);
    await db.doc(`_localTasks/auto-submit-${id}-${deadlineAt}`).update({ status: 'done' });
    ctx.clock.set(deadlineAt + 3 * MIN);
    expect((await act(id, 'reinstate', admin, { reason: 'Reviewed late' })).status).toBe(200);
    expect(await autoSubmits(id)).toEqual([`auto-submit-${id}-${deadlineAt}-reinstated-${deadlineAt + 3 * MIN}`]);
    const timing = await stored(id);
    expect(
      autoSubmitAction({ status: timing.status, deadlineAt: timing.deadlineAt }, deadlineAt, ctx.clock.now()),
    ).toBe('finalize');
  });

  it('OPS-04 refused actions store nothing: no reason, the wrong status, a student, another org', async () => {
    const { id, s1 } = await started();
    const admin = await adminA();
    const adminB = await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
    for (const action of ['terminate', 'reinstate']) {
      for (const payload of [{}, { reason: '   ' }])
        expect([(await act(id, action, admin, payload)).status, action]).toEqual([400, action]);
      expect((await act(id, action, s1, { reason: 'Myself' })).status).toBe(403);
      expect((await act(id, action, adminB, { reason: 'B' })).status).toBe(404);
    }
    expect(errorCode(await act(id, 'reinstate', admin, { reason: 'Not ended' }))).toBe('ATTEMPT_NOT_TERMINATED');
    expect(errorCode(await act('missing', 'terminate', admin, { reason: 'Gone' }))).toBe('NOT_FOUND');
    expect((await stored(id)).status).toBe('in_progress');
    expect(await entries('attempt.terminate', id)).toEqual([]);
    expect(await entries('attempt.reinstate', id)).toEqual([]);
  });

  it('DATA-05 OPS-04 a full review released before a reinstate is closed while the attempt is in progress again', async () => {
    const { t, s1, id, q } = await started();
    const admin = await adminA();
    expect((await act(id, 'terminate', admin, { reason: 'Phone' })).status).toBe(200);
    // After the slot, the full review is released to the student (SER-09).
    ctx.clock.set(t.window.end + MIN);
    await db.doc(`${org}/tests/${t.testId}`).update({
      'resolved.resultRelease': 'manual',
      'resolved.resultDetail': 'full',
      resultsReleasedAt: t.window.end + MIN,
    });
    const result = (h: Record<string, string>) =>
      ctx.app.inject({ method: 'GET', url: `/v1/student/results/${id}`, headers: h });
    const before = await result(s1);
    expect(before.statusCode, before.body).toBe(200);
    expect(leaks(before.body), 'the review was open before the reinstate').toContain('"correctOptionIds"');

    // Extra time keeps the reinstated attempt open past the slot.
    expect((await act(id, 'reinstate', admin, { reason: 'Reviewed the recording' })).status).toBe(200);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/v1/attempts/${id}/extra-time`,
          headers: admin,
          payload: { minutes: 30, reason: 'Make up the lost time' },
        })
      ).statusCode,
    ).toBe(200);
    const resumed = await api.resume(id, s1);
    expect(resumed.status).toBe(200);
    expect(leaks(resumed.raw)).toEqual([]);
    const during = await result(s1);
    expect([during.statusCode, errorCode({ raw: during.body })]).toEqual([409, 'ATTEMPT_IN_PROGRESS']);
    expect(leaks(during.body)).toEqual([]);
    const saved = await api.answers(id, s1, {
      answers: [{ questionId: q[1]!, optionId: 'b', seq: 1, clientTs: ctx.clock.now() }],
      backlog: 0,
      clockOffsetMs: 0,
    });
    expect(saved.body.saved).toEqual([q[1]]);
  });
});

describe('reset', () => {
  it('OPS-10 US-AD-13 REL-04 a reset needs a reason and keeps the attempt with its records; its auto-submit finalizes nothing', async () => {
    const { t, s1, id, deadlineAt, q } = await started();
    const admin = await adminA();
    const ref = db.doc(`${org}/attempts/${id}`);
    await ref
      .collection('events')
      .add({ orgId: SEED.orgA, type: 'window_blur', details: {}, clientTs: NOW, serverTs: NOW });
    for (const payload of [{}, { reason: '  ' }]) expect((await act(id, 'reset', admin, payload)).status).toBe(400);
    const before = await stored(id);

    ctx.clock.set(NOW + 5 * MIN);
    const res = await act(id, 'reset', admin, { reason: 'Laptop crashed during the test' });
    expect([res.status, res.body], res.raw).toEqual([200, { status: 'reset' }]);
    const after = await stored(id);
    expect(after).toEqual({
      ...before,
      status: 'reset',
      resetReason: 'Laptop crashed during the test',
      resetAt: NOW + 5 * MIN,
      resetBy: expect.any(String),
    });
    expect((await ref.collection('answers').get()).docs.map((d) => d.id)).toEqual([q[0]]);
    expect((await ref.collection('events').get()).size).toBe(1);
    expect(await entries('attempt.reset', id)).toMatchObject([
      { actor: { email: 'admin1@a.test', role: 'admin' }, before: { status: 'in_progress' } },
    ]);
    expect(await live(t.testId, id)).toMatchObject({ status: 'reset' });
    const index = (await db.doc(`${org}/attemptIndex/${t.testId}_stu-org-a-01`).get()).data()!;
    expect(index.activeAttemptId).toBeUndefined();
    // The task queued for the old deadline skips the reset attempt (REL-04); the student can no longer use it.
    expect(autoSubmitAction({ status: 'reset', deadlineAt }, deadlineAt, deadlineAt + 2 * MIN)).toBe('skip');
    const late = await api.answers(id, s1, {
      answers: [{ questionId: q[1]!, optionId: 'a', seq: 1, clientTs: ctx.clock.now() }],
      backlog: 0,
      clockOffsetMs: 0,
    });
    expect(errorCode(late)).toBe('ATTEMPT_FINISHED');
    expect(errorCode(await act(id, 'reset', admin, { reason: 'Twice' }))).toBe('ATTEMPT_ALREADY_RESET');
    expect(errorCode(await act(id, 'terminate', admin, { reason: 'Reset' }))).toBe('ATTEMPT_FINISHED');
    expect(errorCode(await act(id, 'reinstate', admin, { reason: 'Reset' }))).toBe('ATTEMPT_NOT_TERMINATED');
    expect(await entries('attempt.reset', id)).toHaveLength(1);
  });

  it('OPS-10 LB-03 a submitted attempt can be reset, and the leaderboard is recomputed without it', async () => {
    const { s1, id } = await started();
    const submit = await ctx.app.inject({
      method: 'POST',
      url: `/v1/attempts/${id}/submit`,
      headers: { ...s1, 'idempotency-key': crypto.randomUUID() },
      payload: {},
    });
    expect(submit.statusCode).toBe(200);
    for (const k of await ctx.queue.pending())
      if (k.path === '/tasks/leaderboard') await db.doc(`_localTasks/${k.name}`).delete();
    expect((await act(id, 'reset', await adminA(), { reason: 'Submitted by mistake' })).status).toBe(200);
    expect((await stored(id)).result).toBeDefined();
    expect((await ctx.queue.pending()).filter((k) => k.path === '/tasks/leaderboard')).toHaveLength(1);
  });

  it('OPS-10 US-AD-13 TST-07 after a reset past the late-entry cutoff the test is live again and the next start draws anew with the slot end as deadline', async () => {
    const { t, s1, id } = await started({ overrides: { shuffleQuestions: true, shuffleOptions: true } });
    const get = async (url: string, headers: Record<string, string>) => {
      const res = await ctx.app.inject({ method: 'GET', url, headers });
      return { status: res.statusCode, body: res.json() as Record<string, unknown> };
    };
    // Past the 15-minute late-entry cutoff: a student who never started is refused (Q25 applies to resets only).
    ctx.clock.set(NOW + 20 * MIN);
    expect(errorCode(await api.start(t.testId, await studentOf(auth, 2)))).toBe('WINDOW_CLOSED');
    expect((await act(id, 'reset', await adminA(), { reason: 'Laptop crashed' })).status).toBe(200);

    const dashboard = await get('/v1/student/dashboard', s1);
    expect(dashboard.body.live).toMatchObject([{ testId: t.testId, lastStartAt: t.window.end }]);
    expect((dashboard.body.live as object[])[0]).not.toHaveProperty('attemptId');
    expect((await get(`/v1/student/tests/${t.testId}`, s1)).body).toMatchObject({ state: 'live' });

    const again = await api.start(t.testId, s1);
    expect(again.status, again.raw).toBe(201);
    const newId = again.body.attempt.id;
    expect(newId).not.toBe(id);
    expect(again.body.attempt.deadlineAt, 'a fixed slot ends at the slot end').toBe(t.window.end);
    expect(again.body.answers).toEqual({});
    const data = createData(db);
    const test = (await data.tests.getTest(SEED.orgA, t.testId))!;
    const questions = await data.questions.listQuestions(SEED.orgA, t.testId);
    const options = Object.fromEntries(questions.map((q) => [q.id, q.options.map((o) => o.id)]));
    expect((await stored(newId)).draw, 'drawn again, seeded by the new attempt ID (Q-06)').toEqual(
      drawAttempt(testDrawPools(test, questions), options, test.resolved!, newId),
    );
    expect((await db.doc(`${org}/attemptIndex/${t.testId}_stu-org-a-01`).get()).data()).toMatchObject({
      activeAttemptId: newId,
      attemptCount: 2,
    });
    expect((await api.start(t.testId, s1)).body.attempt.id, 'the new attempt is the active one').toBe(newId);
    expect((await get(`/v1/student/tests/${t.testId}`, s1)).body).toMatchObject({ state: 'in_progress' });

    // At the window end the reset student cannot start either.
    expect((await act(newId, 'reset', await adminA(), { reason: 'Crashed again' })).status).toBe(200);
    ctx.clock.set(t.window.end);
    expect(errorCode(await api.start(t.testId, s1))).toBe('WINDOW_CLOSED');
  });
});
