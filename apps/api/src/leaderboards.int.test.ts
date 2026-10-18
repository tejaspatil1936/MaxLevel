import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// GET /v1/leaderboards/{boardId} (LB-04, LB-05, US-ST-09, RES-05): open to students only when enabled and public,
// every row for admins.

const { db, auth } = initFirebase();
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
const get = async (boardId: string, headers: Record<string, string>) => {
  const res = await ctx.app.inject({ method: 'GET', url: `/v1/leaderboards/${boardId}`, headers });
  return { status: res.statusCode, raw: res.body, body: res.json() as Record<string, unknown> };
};
const closed = (r: { status: number; raw: string }) => [r.status, errorCode(r)];
const NOT_OPEN = [404, 'LEADERBOARD_NOT_AVAILABLE'];
const row = (n: number, score: number) => ({
  studentId: `stu-org-a-${String(n).padStart(2, '0')}`,
  name: `S ${n}`,
  departmentId: 'dept-org-a-computer',
  score,
  rank: n,
  timeSec: 60 * n,
});
/** A stored board of org A with `count` rows, as the worker writes it. */
const storeBoard = (boardId: string, count: number) =>
  db.doc(`organizations/${SEED.orgA}/leaderboards/${boardId}`).set({
    orgId: SEED.orgA,
    computedAt: NOW,
    total: count,
    pageCount: 1,
    rows: Array.from({ length: count }, (_, i) => row(i + 1, 100 - i)),
  });

describe('leaderboard board', () => {
  it('LB-04 RES-05 a test board is closed to students while off, pending, withdrawn, never shared or the flexible window is open', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'immediate', testLeaderboard: true } });
    await storeBoard(`test_${t.testId}`, 2);
    const test = db.doc(`organizations/${SEED.orgA}/tests/${t.testId}`);
    const student = await studentOf(auth);
    const admin = await adminA();
    expect((await get(`test_${t.testId}`, student)).status, 'open').toBe(200);
    for (const change of [
      { resultsWithdrawn: true },
      { resultsWithdrawn: false, 'resolved.resultRelease': 'manual' },
      { 'resolved.resultRelease': 'never' },
      { 'resolved.resultRelease': 'immediate', 'resolved.testLeaderboard': false },
      { 'resolved.testLeaderboard': true, 'resolved.timingMode': 'flexible' },
    ]) {
      await test.update(change);
      expect(closed(await get(`test_${t.testId}`, student)), JSON.stringify(change)).toEqual(NOT_OPEN);
      const full = await get(`test_${t.testId}`, admin);
      expect([full.status, (full.body.rows as unknown[]).length], 'admins always see every row').toEqual([200, 2]);
    }
    ctx.clock.set(t.window.end + MIN);
    expect((await get(`test_${t.testId}`, student)).status, 'flexible window closed').toBe(200);
    expect(closed(await get('test_missing', student))).toEqual(NOT_OPEN);
    expect(closed(await get('nonsense', student))).toEqual(NOT_OPEN);
    expect(closed(await get('test_missing', admin))).toEqual([404, 'NOT_FOUND']);
  });

  it('LB-04 a series board needs its setting and one test with public results', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'manual' } });
    await storeBoard(`series_${t.seriesId}`, 1);
    const series = db.doc(`organizations/${SEED.orgA}/series/${t.seriesId}`);
    const student = await studentOf(auth);
    expect(closed(await get(`series_${t.seriesId}`, student))).toEqual(NOT_OPEN);
    await series.update({ 'defaults.seriesLeaderboard': true });
    expect(closed(await get(`series_${t.seriesId}`, student)), 'no public results').toEqual(NOT_OPEN);
    expect((await get(`series_${t.seriesId}`, await adminA())).status).toBe(200);
    await db.doc(`organizations/${SEED.orgA}/tests/${t.testId}`).update({ resultsReleasedAt: NOW });
    const open = await get(`series_${t.seriesId}`, student);
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({ kind: 'series', title: 'Placement 2026', total: 1 });
    expect(open.body).not.toHaveProperty('max');
  });

  it('LB-05 US-ST-09 a student gets the top 50 and their own row; an admin and a super admin every row', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'immediate', testLeaderboard: true } });
    await storeBoard(`test_${t.testId}`, 60);
    const mine = await get(`test_${t.testId}`, await studentOf(auth, 1));
    expect(mine.body).toMatchObject({ boardId: `test_${t.testId}`, kind: 'test', total: 60, computedAt: NOW });
    expect(mine.body.title).toMatch(/^Day 1: /);
    expect(mine.body.rows).toHaveLength(50);
    expect(mine.body.me).toEqual({ rank: 1, name: 'S 1', department: 'Computer', score: 100, timeSec: 60 });
    expect(mine.raw).not.toMatch(/studentId|departmentId/);
    const ref = db.doc(`organizations/${SEED.orgA}/leaderboards/test_${t.testId}`);
    const rows = (await ref.get()).get('rows') as Array<ReturnType<typeof row>>;
    rows[19]!.studentId = 'stu-org-a-55';
    rows[54]!.studentId = 'stu-org-a-20';
    await ref.update({ rows });
    const own = await get(`test_${t.testId}`, await studentOf(auth, 20));
    expect(own.body.me, 'outside the top 50').toMatchObject({ rank: 55, name: 'S 55' });
    expect(own.body.rows).toHaveLength(50);
    const full = await get(`test_${t.testId}`, await adminA());
    expect([(full.body.rows as unknown[]).length, full.body.me]).toEqual([60, null]);
    const superAdmin = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
    const sa = await get(`test_${t.testId}`, { ...superAdmin, 'x-org-id': SEED.orgA });
    expect([(sa.body.rows as unknown[]).length, sa.body.me]).toEqual([60, null]);
  });

  it('LB-04 ORG-05 only students the series and test admit, or with an attempt on it, see the board; other orgs get 404', async () => {
    const t = await api.examTest({
      overrides: { resultRelease: 'immediate', testLeaderboard: true },
      seriesEligibility: { exclude: ['stu-org-a-02', 'stu-org-a-03'] },
    });
    await storeBoard(`test_${t.testId}`, 1);
    expect(closed(await get(`test_${t.testId}`, await studentOf(auth, 2))), 'not admitted').toEqual(NOT_OPEN);
    await db.collection(`organizations/${SEED.orgA}/attempts`).add({
      orgId: SEED.orgA,
      testId: t.testId,
      seriesId: t.seriesId,
      studentId: 'stu-org-a-03',
      status: 'submitted',
    });
    expect((await get(`test_${t.testId}`, await studentOf(auth, 3))).status, 'has an attempt').toBe(200);
    expect(closed(await get(`test_${t.testId}`, await studentOf(auth, 1, SEED.orgB)))).toEqual(NOT_OPEN);
    const adminB = await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
    expect((await get(`test_${t.testId}`, adminB)).status).toBe(404);
  });

  it('FF-02 with public_leaderboards off students and admins get 403 FEATURE_DISABLED', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'immediate', testLeaderboard: true } });
    await db.doc(`organizations/${SEED.orgA}`).update({ featureOverrides: { public_leaderboards: false } });
    const fresh = await testApp(); // its own entitlements cache, which has not seen the feature on
    for (const headers of [await studentOf(auth), await adminA()]) {
      const res = await fresh.app.inject({ method: 'GET', url: `/v1/leaderboards/test_${t.testId}`, headers });
      expect(closed({ status: res.statusCode, raw: res.body })).toEqual([403, 'FEATURE_DISABLED']);
    }
  });
});

describe('open leaderboards list', () => {
  const list = async (headers: Record<string, string>, app = ctx.app) => {
    const res = await app.inject({ method: 'GET', url: '/v1/student/leaderboards', headers });
    return { status: res.statusCode, raw: res.body, boards: (res.json() as { boards?: unknown[] }).boards };
  };

  it('US-ST-09 LB-04 lists the boards open to the student, the series board before its test boards', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'manual', testLeaderboard: true } });
    const student = await studentOf(auth);
    expect((await list(student)).boards, 'nothing released yet').toEqual([]);
    await db.doc(`organizations/${SEED.orgA}/series/${t.seriesId}`).update({ 'defaults.seriesLeaderboard': true });
    await db.doc(`organizations/${SEED.orgA}/tests/${t.testId}`).update({ resultsReleasedAt: NOW });
    const open = await list(student);
    expect(open.boards).toEqual([
      { boardId: `series_${t.seriesId}`, kind: 'series', title: 'Placement 2026' },
      { boardId: `test_${t.testId}`, kind: 'test', title: expect.stringMatching(/^Day 1: /) },
    ]);
    expect((await list(await studentOf(auth, 1, SEED.orgB))).boards, 'another org').toEqual([]);
    expect((await list(await adminA())).status, 'students only').toBe(403);
  });

  it('LB-04 a series the student no longer sees still lists its boards when they have an attempt on it', async () => {
    const t = await api.examTest({
      overrides: { resultRelease: 'immediate', testLeaderboard: true },
      seriesEligibility: { exclude: ['stu-org-a-02'] },
    });
    expect((await list(await studentOf(auth, 2))).boards).toEqual([]);
    await db.collection(`organizations/${SEED.orgA}/attempts`).add({
      orgId: SEED.orgA,
      testId: t.testId,
      seriesId: t.seriesId,
      studentId: 'stu-org-a-02',
      status: 'auto_submitted',
    });
    expect((await list(await studentOf(auth, 2))).boards).toEqual([
      { boardId: `test_${t.testId}`, kind: 'test', title: expect.stringMatching(/^Day 1: /) },
    ]);
  });

  it('FF-02 with public_leaderboards off the list answers 403 FEATURE_DISABLED', async () => {
    await db.doc(`organizations/${SEED.orgA}`).update({ featureOverrides: { public_leaderboards: false } });
    const fresh = await testApp();
    const res = await list(await studentOf(auth), fresh.app);
    expect(closed(res)).toEqual([403, 'FEATURE_DISABLED']);
  });
});
