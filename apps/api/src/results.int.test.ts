import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, NOW } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// GET /v1/results and GET /v1/tests/{id}/release (US-AD-10, RES-01, RES-05, SER-09): the admin results pages' reads.

const { db, auth } = initFirebase();
let ctx: Awaited<ReturnType<typeof testApp>>;
let api: ReturnType<typeof attemptClient>;

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, NOW);
  ctx = await testApp();
  api = attemptClient(ctx.app);
  ctx.clock.set(NOW);
});

const get = async (url: string, orgId: string = SEED.orgA) => {
  const n = orgId === SEED.orgA ? 'a' : 'b';
  const headers = await asClaims(auth, `admin1@${n}.test`, { role: 'admin', orgId });
  const res = await ctx.app.inject({ method: 'GET', url, headers });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};

describe('admin results reads', () => {
  it('US-AD-10 RES-01 RES-05 lists published tests newest first with their release state, and their series', async () => {
    const manual = await api.examTest({ overrides: { resultRelease: 'manual' } });
    const never = await api.examTest({
      seriesId: manual.seriesId,
      title: 'Verbal ability',
      opensInMin: 24 * 60,
      overrides: { resultRelease: 'never' },
    });
    ctx.clock.advance(1_000); // same date: listed in creation order
    const withdrawn = await api.examTest({ title: 'Reasoning', overrides: { resultRelease: 'immediate' } });
    await db.doc(`organizations/${SEED.orgA}/tests/${withdrawn.testId}`).update({ resultsWithdrawn: true });
    await api.examTest({ title: 'Draft', publish: false });
    await api.examTest({ orgId: SEED.orgB });

    const { status, body } = await get('/v1/results');
    expect(status).toBe(200);
    const tests = body.tests as Array<Record<string, unknown>>;
    expect(tests.map((t) => [t.title, t.dayLabel, t.state, t.resultRelease])).toEqual([
      ['Verbal ability', 'Day 2', 'never', 'never'],
      ['Quantitative aptitude', 'Day 1', 'pending', 'manual'],
      ['Reasoning', 'Day 1', 'withdrawn', 'immediate'],
    ]);
    expect(tests[1]).toMatchObject({
      testId: manual.testId,
      seriesId: manual.seriesId,
      seriesTitle: 'Placement 2026',
      windowEnd: manual.window.end,
      resultsReleasedAt: null,
      refusal: null,
    });
    expect(tests[0]!.refusal).toBe('RESULTS_NOT_RELEASABLE');
    expect(never.testId).toBe(tests[0]!.testId);
    expect(body.series).toEqual(
      [
        { id: manual.seriesId, title: 'Placement 2026', testCount: 2 },
        { id: withdrawn.seriesId, title: 'Placement 2026', testCount: 1 },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );

    expect((await get('/v1/results', SEED.orgB)).body.tests).toHaveLength(1);
  });

  it('SER-09 one test reads its refusal on the server clock; unpublished and other-org tests are 404', async () => {
    const t = await api.examTest({
      timingMode: 'flexible',
      windowMin: 90,
      durationMin: 30,
      overrides: { resultRelease: 'manual', resultDetail: 'full' },
    });
    expect((await get(`/v1/tests/${t.testId}/release`)).body).toMatchObject({
      state: 'pending',
      resultDetail: 'full',
      refusal: 'FULL_REVIEW_BEFORE_CLOSE',
    });
    ctx.clock.set(t.window.end);
    expect((await get(`/v1/tests/${t.testId}/release`)).body.refusal).toBeNull();

    const draft = await api.examTest({ publish: false });
    expect((await get(`/v1/tests/${draft.testId}/release`)).status).toBe(404);
    expect((await get(`/v1/tests/${t.testId}/release`, SEED.orgB)).status).toBe(404);
  });
});
