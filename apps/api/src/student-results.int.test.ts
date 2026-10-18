import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, leaks, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// GET /v1/student/results/{attemptId} (RES-01, RES-05, SER-10, DATA-05) on the emulators: what a student sees of a
// finished attempt follows the test's release state and detail level on every request.

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

const RELEASED_ONLY = ['detail', 'score', 'max', 'pct', 'durationSec', 'rank', 'sections', 'review'];
const result = async (id: string, headers: Record<string, string>) => {
  const res = await ctx.app.inject({ method: 'GET', url: `/v1/student/results/${id}`, headers });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, raw: res.body };
};
/** Sits the `basic` set (correct a, b, b, c): q1 right, q2 wrong, the rest unanswered; returns the attempt ID. */
async function sit(testId: string, questionIds: string[], submit = true) {
  const s1 = await student(1);
  const { body } = await api.start(testId, s1);
  const answers = [
    { questionId: questionIds[0]!, optionId: 'a', seq: 1, clientTs: NOW },
    { questionId: questionIds[1]!, optionId: 'a', seq: 1, clientTs: NOW },
  ];
  expect((await api.answers(body.attempt.id, s1, { answers, backlog: 0, clockOffsetMs: 0 })).status).toBe(200);
  ctx.clock.advance(5 * MIN);
  if (submit) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/attempts/${body.attempt.id}/submit`,
      headers: { ...s1, 'idempotency-key': crypto.randomUUID() },
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  return body.attempt.id;
}
const setTest = (testId: string, fields: Record<string, unknown>) => db.doc(`${org}/tests/${testId}`).update(fields);

describe('student result', () => {
  it('RES-01 DATA-05 a manual test is pending with no score until released, then shows the score only', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'manual', resultDetail: 'score' } });
    const id = await sit(t.testId, t.questionIds);
    const pending = await result(id, await student(1));
    expect(pending.status).toBe(200);
    expect(pending.body).toMatchObject({
      attemptId: id,
      testId: t.testId,
      title: 'Quantitative aptitude',
      dayLabel: 'Day 1',
      status: 'submitted',
      release: 'pending',
      resultRelease: 'manual',
      windowEnd: t.window.end,
      strikesCount: 0,
      maxStrikes: 3,
    });
    for (const k of RELEASED_ONLY) expect(k in pending.body, k).toBe(false);
    expect(leaks(pending.raw)).toEqual([]);

    await setTest(t.testId, { resultsReleasedAt: NOW });
    const released = await result(id, await student(1));
    expect(released.body).toMatchObject({
      release: 'released',
      detail: 'score',
      score: 1,
      max: 4,
      pct: 25,
      durationSec: 300,
    });
    expect('sections' in released.body).toBe(false);
    expect(leaks(released.raw)).toEqual([]);
  });

  it('RES-05 RES-01 withdrawn and never results hide the score; a changed detail takes effect on the next request', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'immediate', resultDetail: 'sections' } });
    const id = await sit(t.testId, t.questionIds);
    const shown = await result(id, await student(1));
    expect(shown.body).toMatchObject({ release: 'released', detail: 'sections', sections: [] });
    expect(leaks(shown.raw)).toEqual([]);

    await setTest(t.testId, { resultsWithdrawn: true });
    const withdrawn = await result(id, await student(1));
    expect(withdrawn.body.release).toBe('withdrawn');
    for (const k of RELEASED_ONLY) expect(k in withdrawn.body, k).toBe(false);

    await setTest(t.testId, { resultsWithdrawn: false, 'resolved.resultRelease': 'never' });
    const never = await result(id, await student(1));
    expect(never.body.release).toBe('never');
    for (const k of RELEASED_ONLY) expect(k in never.body, k).toBe(false);
  });

  it('SER-10 DATA-05 a released full review lists every drawn question with explanations only where they exist', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'immediate', resultDetail: 'full' } });
    const id = await sit(t.testId, t.questionIds);
    const { body } = await result(id, await student(1));
    const review = body.review as Array<Record<string, unknown>>;
    expect(review.map((r) => r.questionId)).toEqual(t.questionIds);
    expect(review.map((r) => [r.chosenOptionId, r.correctOptionIds, r.marks])).toEqual([
      ['a', ['a'], 1],
      ['a', ['b'], 0],
      [null, ['b'], 0],
      [null, ['c'], 0],
    ]);
    expect(review.map((r) => 'explanation' in r)).toEqual([true, true, false, true]);
    expect(review[0]!.options).toEqual([
      { id: 'a', text: '20 m/s' },
      { id: 'b', text: '24 m/s' },
      { id: 'c', text: '18 m/s' },
      { id: 'd', text: '22 m/s' },
    ]);

    // Detail lowered after attempts: no review, no key, no explanation.
    await setTest(t.testId, { 'resolved.resultDetail': 'sections' });
    const lowered = await result(id, await student(1));
    expect('review' in lowered.body).toBe(false);
    expect(leaks(lowered.raw)).toEqual([]);
  });

  it('ORG-05 DATA-05 an attempt in progress is 409, another student or org is 404, and staff tokens are 403', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'immediate' } });
    const id = await sit(t.testId, t.questionIds, false);
    const res = await result(id, await student(1));
    expect([res.status, errorCode(res)]).toEqual([409, 'ATTEMPT_IN_PROGRESS']);
    expect((await result(id, await student(2))).status).toBe(404);
    expect((await result(id, await student(1, SEED.orgB))).status).toBe(404);
    expect((await result('nope', await student(1))).status).toBe(404);
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    expect((await result(id, admin)).status).toBe(403);
  });
});
