import { liveRecordPath, type LiveRecord } from '@mitaoe/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';

// The live mirror (OPS-02, spec 10.2): the API writes live/{orgId}/{testId}/{attemptId} on a reservation, a start,
// every answer batch, every counted strike and every finish. Writes are fire and forget, so the tests wait for them.

const { db, auth, rtdb } = initFirebase();
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

const record = async (testId: string, attemptId: string) =>
  (await rtdb.ref(liveRecordPath(SEED.orgA, testId, attemptId)).get()).val() as LiveRecord | null;
const expectRecord = (testId: string, attemptId: string, expected: Partial<LiveRecord>) =>
  expect.poll(() => record(testId, attemptId)).toMatchObject(expected);

const post = async (url: string, headers: Record<string, string>, payload: object) => {
  const res = await ctx.app.inject({ method: 'POST', url, headers, payload });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};
const answer = (questionId: string, seq: number, optionId: string | null) => ({
  questionId,
  optionId,
  seq,
  clientTs: NOW + seq,
});

describe('live mirror', () => {
  it('OPS-02 a reservation is pairing; the start writes the full record; answers and strikes update it', async () => {
    const t = await api.examTest({ overrides: { secondCamera: true, maxStrikes: 5 } });
    const s1 = await studentOf(auth, 1);
    const reserved = await post(`/v1/tests/${t.testId}/pairing-token`, s1, {});
    expect(reserved.status).toBe(200);
    const id = reserved.body.attemptId as string;
    await expectRecord(t.testId, id, {
      studentId: `stu-${SEED.orgA}-01`,
      name: 'Aarav Kulkarni',
      prn: '22010101',
      status: 'pairing',
      updatedAt: NOW,
    });

    ctx.clock.advance(1_000);
    const started = await api.start(t.testId, s1);
    expect(started.body.attempt.id).toBe(id);
    expect(await record(t.testId, id)).toEqual({
      studentId: `stu-${SEED.orgA}-01`,
      name: 'Aarav Kulkarni',
      prn: '22010101',
      status: 'in_progress',
      answered: 0,
      total: 4,
      strikes: 0,
      deadlineAt: started.body.attempt.deadlineAt,
      startedAt: NOW + 1_000,
      updatedAt: NOW + 1_000,
    });

    const [q0, q1] = t.questionIds as [string, string];
    const batch = (answers: object[], backlog = 0) => ({ answers, backlog, clockOffsetMs: 0 });
    expect((await api.answers(id, s1, batch([answer(q0, 1, 'a'), answer(q1, 1, 'b')], 3))).status).toBe(200);
    await expectRecord(t.testId, id, { answered: 2, backlog: 3 } as Partial<LiveRecord>);
    expect((await api.answers(id, s1, batch([answer(q1, 2, null)]))).status).toBe(200);
    await expectRecord(t.testId, id, { answered: 1, backlog: 0 } as Partial<LiveRecord>);

    const strike = await post(`/v1/attempts/${id}/events`, s1, { type: 'tab_hidden', clientTs: NOW, details: {} });
    expect(strike.body).toMatchObject({ strikesCount: 1, counted: true });
    await expectRecord(t.testId, id, { strikes: 1, status: 'in_progress' });
  });

  it('OPS-02 every kind of finish mirrors its status: submitted, submitted automatically and terminated', async () => {
    const t = await api.examTest({ overrides: { maxStrikes: 1 } });
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const res = await api.start(t.testId, await studentOf(auth, n));
      expect(res.status).toBe(201);
      ids.push(res.body.attempt.id);
    }
    const key = () => ({ 'idempotency-key': crypto.randomUUID() });
    expect((await post(`/v1/attempts/${ids[0]}/submit`, { ...(await studentOf(auth, 1)), ...key() }, {})).status).toBe(
      200,
    );
    const timeUp = await post(
      `/v1/attempts/${ids[1]}/submit`,
      { ...(await studentOf(auth, 2)), ...key() },
      {
        reason: 'time_up',
      },
    );
    expect(timeUp.status).toBe(200);
    const ended = await post(`/v1/attempts/${ids[2]}/events`, await studentOf(auth, 3), {
      type: 'fullscreen_exit',
      clientTs: NOW,
      details: {},
    });
    expect(ended.body).toMatchObject({ status: 'terminated' });

    await expectRecord(t.testId, ids[0]!, { status: 'submitted', answered: 0, strikes: 0 });
    await expectRecord(t.testId, ids[1]!, { status: 'auto_submitted' });
    await expectRecord(t.testId, ids[2]!, { status: 'terminated', strikes: 1 });
  });
});
