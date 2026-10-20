import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// PUT /v1/attempts/{id}/answers (EX-11, EX-13, EX-14, DATA-03, OBS-03): the server side of answer sync.

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

/** A started attempt of the default exam test (fixed slot from NOW − 2 min to NOW + 58 min). */
async function started() {
  const t = await api.examTest();
  const s1 = await studentOf(auth, 1);
  const { body } = await api.start(t.testId, s1);
  return { t, s1, id: body.attempt.id, deadlineAt: body.attempt.deadlineAt, q: t.questionIds };
}

const batch = (answers: object[], backlog = 0, clockOffsetMs = 0) => ({ answers, backlog, clockOffsetMs });
const answer = (questionId: string, seq: number, optionId: string | null, extra: object = {}) => ({
  questionId,
  optionId,
  seq,
  clientTs: NOW + seq,
  ...extra,
});

describe('saving answers', () => {
  it('EX-11 EX-14 DATA-03 OBS-03 writes each answer in its own record only for a higher seq, and stores the sync report', async () => {
    const { t, s1, id, q } = await started();
    const before = (await db.doc(`${org}/attempts/${id}`).get()).data()!;

    const first = await api.answers(
      id,
      s1,
      batch([answer(q[0]!, 2, 'b'), answer(q[1]!, 1, null, { markedForReview: true })], 3, -250),
    );
    expect(first.status, first.raw).toBe(200);
    expect(first.body).toEqual({ saved: [q[0], q[1]], stale: [], rejected: [], serverTime: NOW });

    // A retried, reordered batch: the older seq is stale and leaves the newest answer.
    const retry = await api.answers(id, s1, batch([answer(q[0]!, 1, 'a'), answer(q[0]!, 2, 'c')]));
    expect(retry.body).toMatchObject({ saved: [], stale: [q[0], q[0]] });

    const answers = await db.collection(`${org}/attempts/${id}/answers`).get();
    expect(Object.fromEntries(answers.docs.map((d) => [d.id, d.data()]))).toEqual({
      [q[0]!]: { optionId: 'b', seq: 2, clientTs: NOW + 2, serverTs: NOW, markedForReview: false },
      [q[1]!]: { optionId: null, seq: 1, clientTs: NOW + 1, serverTs: NOW, markedForReview: true },
    });
    const after = (await db.doc(`${org}/attempts/${id}`).get()).data()!;
    const { sync, ...rest } = after;
    expect(rest, 'the attempt record is not rewritten per answer').toEqual(before);
    expect(sync).toEqual({ backlog: 0, clockOffsetMs: 0, at: NOW });
    expect((await rtdb.ref(`live/${SEED.orgA}/${t.testId}/${id}/backlog`).get()).val()).toBe(0);

    const resumed = await api.resume(id, s1);
    expect(resumed.body.answers).toEqual({
      [q[0]!]: { optionId: 'b', seq: 2 },
      [q[1]!]: { optionId: null, seq: 1, markedForReview: true },
    });
  });

  it('EX-11 DATA-03 concurrent, reordered batches keep the highest seq of each question in its own record', async () => {
    const { s1, id, q } = await started();
    const options = ['a', 'b', 'c', 'd'];
    const sends = [5, 2, 8, 1, 7, 3, 6, 4].map((seq) =>
      api.answers(id, s1, batch([answer(q[0]!, seq, options[seq % 4]!), answer(q[1]!, 9 - seq, options[seq % 4]!)])),
    );
    const results = await Promise.all(sends);
    expect(results.map((r) => r.status)).toEqual(results.map(() => 200));

    const answers = await db.collection(`${org}/attempts/${id}/answers`).get();
    expect(Object.fromEntries(answers.docs.map((d) => [d.id, [d.get('seq'), d.get('optionId')]]))).toEqual({
      [q[0]!]: [8, 'a'],
      [q[1]!]: [8, 'b'],
    });
  });

  it('EX-13 accepts an answer made before the deadline for 2 minutes after it, as a late sync, and rejects later ones', async () => {
    const { s1, id, q, deadlineAt } = await started();
    ctx.clock.set(deadlineAt + MIN);
    const late = await api.answers(
      id,
      s1,
      batch([
        { ...answer(q[0]!, 1, 'a'), clientTs: deadlineAt - 1000 },
        { ...answer(q[1]!, 1, 'a'), clientTs: deadlineAt + 1000 },
      ]),
    );
    expect(late.body).toMatchObject({ saved: [q[0]], rejected: [{ questionId: q[1], code: 'AFTER_DEADLINE' }] });
    expect((await db.doc(`${org}/attempts/${id}/answers/${q[0]}`).get()).get('lateSync')).toBe(true);
    const events = await db.collection(`${org}/attempts/${id}/events`).get();
    expect(events.docs.map((d) => d.get('type'))).toEqual(['late_sync']);

    ctx.clock.set(deadlineAt + 2 * MIN + 1);
    const tooLate = await api.answers(id, s1, batch([{ ...answer(q[2]!, 1, 'a'), clientTs: deadlineAt - 1000 }]));
    expect(tooLate.body.rejected).toEqual([{ questionId: q[2], code: 'AFTER_DEADLINE' }]);
    expect((await db.doc(`${org}/attempts/${id}/answers/${q[2]}`).get()).exists).toBe(false);
  });

  it('EX-11 refuses answers outside the draw, other students’ attempts, staff tokens and finished attempts', async () => {
    const { s1, id, q } = await started();
    const outside = await api.answers(id, s1, batch([answer(q[0]!, 1, 'z')]));
    expect(outside.status).toBe(400);
    expect((await api.answers(id, s1, batch([answer('nope', 1, 'a')]))).status).toBe(400);
    expect((await api.answers(id, s1, batch([{ ...answer(q[0]!, 1, 'a'), extra: 1 }]))).status).toBe(400);

    expect((await api.answers(id, await studentOf(auth, 2), batch([answer(q[0]!, 1, 'a')]))).status).toBe(404);
    expect((await api.answers(id, await studentOf(auth, 1, SEED.orgB), batch([]))).status).toBe(404);
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    expect((await api.answers(id, admin, batch([]))).status).toBe(403);

    await db.doc(`${org}/attempts/${id}`).update({ status: 'submitted', submittedAt: NOW });
    const finished = await api.answers(id, s1, batch([answer(q[0]!, 1, 'a')]));
    expect(finished.status).toBe(409);
    expect(errorCode(finished)).toBe('ATTEMPT_FINISHED');
    expect((await db.collection(`${org}/attempts/${id}/answers`).get()).size).toBe(0);
  });
});
