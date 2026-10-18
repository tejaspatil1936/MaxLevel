import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, MIN, NOW } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// POST /v1/tests/{id}/release and /withdraw-results (RES-01, RES-05, SER-09, DATA-05, LB-03) on the emulators.

const { db, auth } = initFirebase();
const org = `organizations/${SEED.orgA}`;
let ctx: Awaited<ReturnType<typeof testApp>>;
let api: ReturnType<typeof attemptClient>;

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, NOW);
  ctx = await testApp();
  api = attemptClient(ctx.app);
  ctx.clock.set(NOW);
});

const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
const post = async (testId: string, action: 'release' | 'withdraw-results', headers?: Record<string, string>) => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/v1/tests/${testId}/${action}`,
    headers: headers ?? (await admin()),
    payload: {},
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};
const code = (r: { body: Record<string, unknown> }) => (r.body.error as { code?: string } | undefined)?.code;
const fields = async (testId: string) => {
  const d = (await db.doc(`${org}/tests/${testId}`).get()).data()!;
  return { resultsReleasedAt: d.resultsReleasedAt ?? null, resultsWithdrawn: d.resultsWithdrawn ?? false };
};
const audit = async (action: string) =>
  (await db.collection(`${org}/auditLogs`).where('action', '==', action).get()).docs.map((d) => d.data());
const recomputes = async (testId: string) =>
  (await ctx.queue.pending()).filter((t) => t.path === '/tasks/leaderboard' && t.name.includes(`-${testId}-`));

describe('Release results and Withdraw results', () => {
  it('RES-01 LB-03 a manual release stores resultsReleasedAt with its audit entry and a recompute, once', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'manual' } });
    const first = await post(t.testId, 'release');
    expect(first).toEqual({ status: 200, body: { resultsReleasedAt: NOW } });
    expect(await fields(t.testId)).toEqual({ resultsReleasedAt: NOW, resultsWithdrawn: false });
    const entries = await audit('test.results.release');
    expect(entries).toEqual([
      expect.objectContaining({
        target: { type: 'test', id: t.testId },
        after: { resultsReleasedAt: NOW },
        actor: expect.objectContaining({ email: 'admin1@a.test', role: 'admin' }),
      }),
    ]);
    const queued = await recomputes(t.testId);
    expect(queued).toEqual([expect.objectContaining({ scheduleTime: NOW })]);
    expect(queued[0]!.name.startsWith(`leaderboard-${SEED.orgA}-${t.testId}-release-`)).toBe(true);

    ctx.clock.advance(MIN);
    expect(await post(t.testId, 'release'), 'already released: nothing changes').toEqual({
      status: 200,
      body: { resultsReleasedAt: NOW },
    });
    expect(await audit('test.results.release')).toHaveLength(1);
    expect(await recomputes(t.testId)).toHaveLength(1);
  });

  it('RES-01 never refuses Release results with 409 RESULTS_NOT_RELEASABLE and stores nothing', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'never' } });
    const res = await post(t.testId, 'release');
    expect([res.status, code(res)]).toEqual([409, 'RESULTS_NOT_RELEASABLE']);
    expect(await fields(t.testId)).toEqual({ resultsReleasedAt: null, resultsWithdrawn: false });
    expect(await audit('test.results.release')).toEqual([]);
    expect(await recomputes(t.testId)).toEqual([]);
  });

  it('SER-09 DATA-05 a full review in a flexible window is refused before the window end and released after', async () => {
    const t = await api.examTest({
      timingMode: 'flexible',
      windowMin: 90,
      durationMin: 30,
      overrides: { resultRelease: 'manual', resultDetail: 'full' },
    });
    ctx.clock.set(t.window.end - 1);
    const early = await post(t.testId, 'release');
    expect([early.status, code(early)]).toEqual([409, 'FULL_REVIEW_BEFORE_CLOSE']);
    expect(await fields(t.testId)).toEqual({ resultsReleasedAt: null, resultsWithdrawn: false });
    expect(await audit('test.results.release')).toEqual([]);
    ctx.clock.set(t.window.end);
    expect(await post(t.testId, 'release')).toEqual({ status: 200, body: { resultsReleasedAt: t.window.end } });
  });

  it('RES-01 an after_close test can be released early by an admin', async () => {
    const t = await api.examTest();
    expect((await post(t.testId, 'release')).status).toBe(200);
    expect(await fields(t.testId)).toEqual({ resultsReleasedAt: NOW, resultsWithdrawn: false });
  });

  it('RES-05 LB-03 withdrawal needs released results, stores resultsWithdrawn with its audit entry, and release undoes it', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'manual' } });
    const none = await post(t.testId, 'withdraw-results');
    expect([none.status, code(none)]).toEqual([409, 'RESULTS_NOT_RELEASED']);
    expect(await audit('test.results.withdraw')).toEqual([]);

    await post(t.testId, 'release');
    ctx.clock.advance(MIN);
    expect(await post(t.testId, 'withdraw-results')).toEqual({ status: 200, body: { resultsWithdrawn: true } });
    expect(await fields(t.testId)).toEqual({ resultsReleasedAt: NOW, resultsWithdrawn: true });
    expect(await audit('test.results.withdraw')).toEqual([
      expect.objectContaining({ target: { type: 'test', id: t.testId }, after: { resultsWithdrawn: true } }),
    ]);
    expect(await recomputes(t.testId)).toHaveLength(2);
    const again = await post(t.testId, 'withdraw-results');
    expect([again.status, code(again)], 'already withdrawn').toEqual([409, 'RESULTS_NOT_RELEASED']);

    ctx.clock.advance(MIN);
    expect(await post(t.testId, 'release')).toEqual({ status: 200, body: { resultsReleasedAt: NOW + 2 * MIN } });
    expect(await fields(t.testId)).toEqual({ resultsReleasedAt: NOW + 2 * MIN, resultsWithdrawn: false });
    expect(await recomputes(t.testId)).toHaveLength(3);
  });

  it('RES-05 immediate results can be withdrawn and released again', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'immediate' } });
    expect((await post(t.testId, 'withdraw-results')).status).toBe(200);
    expect((await fields(t.testId)).resultsWithdrawn).toBe(true);
    expect((await post(t.testId, 'release')).status).toBe(200);
    expect((await fields(t.testId)).resultsWithdrawn).toBe(false);
  });

  it('ORG-05 ORG-14 an unpublished test and another org are 404; a super admin acts as the actor', async () => {
    const draft = await api.examTest({ publish: false });
    expect((await post(draft.testId, 'release')).status).toBe(404);
    const other = await api.examTest({ orgId: SEED.orgB, overrides: { resultRelease: 'manual' } });
    expect((await post(other.testId, 'release')).status).toBe(404);
    expect(await fields(draft.testId)).toEqual({ resultsReleasedAt: null, resultsWithdrawn: false });

    const t = await api.examTest({ overrides: { resultRelease: 'manual' } });
    const sa = { ...(await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' })), 'x-org-id': SEED.orgA };
    expect((await post(t.testId, 'release', sa)).status).toBe(200);
    expect((await audit('test.results.release'))[0]!.actor).toMatchObject({
      email: SEED.superAdmin,
      role: 'superAdmin',
    });
  });
});
