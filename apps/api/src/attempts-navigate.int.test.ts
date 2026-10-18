import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// POST /v1/attempts/{id}/navigate and the server's per-question timers (Q-11, Q-12).

const { db, auth } = initFirebase();
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

async function started(overrides: object) {
  const t = await api.examTest({ overrides });
  const s1 = await studentOf(auth, 1);
  const { body } = await api.start(t.testId, s1);
  return { s1, id: body.attempt.id, q: t.questionIds };
}

const answer = (questionId: string, seq: number, optionId: string) => ({
  answers: [{ questionId, optionId, seq, clientTs: ctx.clock.now() }],
  backlog: 0,
  clockOffsetMs: 0,
});
const servedAt = async (id: string) => (await db.doc(`${org}/attempts/${id}`).get()).get('questionServedAt') as object;

describe('per-question timers on the server', () => {
  it('Q-12 stores the first serve time once and refuses answers unserved or after the limit plus 2 seconds', async () => {
    const { s1, id, q } = await started({ questionTimeMode: 'same', questionTimeLimitSec: 20 });

    const unserved = await api.answers(id, s1, answer(q[0]!, 1, 'a'));
    expect(unserved.body.rejected).toEqual([{ questionId: q[0], code: 'QUESTION_NOT_SERVED' }]);

    const served = await api.navigate(id, s1, q[0]!);
    expect(served.status, served.raw).toBe(200);
    expect(served.body).toEqual({ servedAt: NOW, serverTime: NOW });
    ctx.clock.set(NOW + 5_000);
    expect((await api.navigate(id, s1, q[0]!)).body, 'the first time is kept').toEqual({
      servedAt: NOW,
      serverTime: NOW + 5_000,
    });

    ctx.clock.set(NOW + 22_000);
    expect((await api.answers(id, s1, answer(q[0]!, 2, 'a'))).body.saved, 'limit plus grace').toEqual([q[0]]);
    ctx.clock.set(NOW + 22_001);
    const late = await api.answers(id, s1, answer(q[0]!, 3, 'b'));
    expect(late.body.rejected).toEqual([{ questionId: q[0], code: 'QUESTION_TIME_UP' }]);
    expect((await db.doc(`${org}/attempts/${id}/answers/${q[0]}`).get()).data()).toMatchObject({
      optionId: 'a',
      seq: 2,
    });
    expect(await servedAt(id)).toEqual({ [q[0]!]: NOW });
  });

  it('Q-11 Q-12 each mode times only questions with their own limit; untimed tests store no serve times', async () => {
    const untimed = await started({});
    expect((await api.navigate(untimed.id, untimed.s1, untimed.q[0]!)).body).toEqual({
      servedAt: NOW,
      serverTime: NOW,
    });
    expect(await servedAt(untimed.id)).toEqual({});
    const saved = await api.answers(untimed.id, untimed.s1, answer(untimed.q[0]!, 1, 'a'));
    expect(saved.body.saved).toEqual([untimed.q[0]]);
  });

  it('Q-12 refuses questions outside the draw, other students, staff tokens and finished attempts', async () => {
    const { s1, id, q } = await started({ questionTimeMode: 'same', questionTimeLimitSec: 20 });
    expect((await api.navigate(id, s1, 'nope')).status).toBe(400);
    expect((await api.navigate(id, await studentOf(auth, 2), q[0]!)).status).toBe(404);
    expect((await api.navigate(id, await studentOf(auth, 1, SEED.orgB), q[0]!)).status).toBe(404);
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    expect((await api.navigate(id, admin, q[0]!)).status).toBe(403);

    await db.doc(`${org}/attempts/${id}`).update({ status: 'submitted', submittedAt: NOW });
    const finished = await api.navigate(id, s1, q[0]!);
    expect(finished.status).toBe(409);
    expect(errorCode(finished)).toBe('ATTEMPT_FINISHED');
    expect(await servedAt(id)).toEqual({});
  });
});
