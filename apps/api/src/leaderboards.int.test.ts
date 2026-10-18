import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';

// GET /v1/leaderboards/{boardId}, the open check for students (LB-04, RES-05). Serving boards is F-4.05's.

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

const board = async (boardId: string) => {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/v1/leaderboards/${boardId}`,
    headers: await studentOf(auth),
  });
  return { status: res.statusCode, raw: res.body };
};
const closed = (r: { status: number; raw: string }) => [r.status, errorCode(r)];

describe('leaderboard open check', () => {
  it('RES-05 LB-04 a test board is closed while withdrawn, pending, never shared or with its setting off', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'immediate', testLeaderboard: true } });
    const test = db.doc(`organizations/${SEED.orgA}/tests/${t.testId}`);
    expect((await board(`test_${t.testId}`)).status, 'open: served by F-4.05').toBe(501);
    for (const change of [
      { resultsWithdrawn: true },
      { resultsWithdrawn: false, 'resolved.resultRelease': 'manual' },
      { 'resolved.resultRelease': 'never' },
      { 'resolved.resultRelease': 'immediate', 'resolved.testLeaderboard': false },
    ]) {
      await test.update(change);
      expect(closed(await board(`test_${t.testId}`)), JSON.stringify(change)).toEqual([
        404,
        'LEADERBOARD_NOT_AVAILABLE',
      ]);
    }
    expect(closed(await board('test_missing'))).toEqual([404, 'LEADERBOARD_NOT_AVAILABLE']);
    expect(closed(await board('nonsense'))).toEqual([404, 'LEADERBOARD_NOT_AVAILABLE']);
  });

  it('LB-04 a series board needs its setting and one test with public results', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'manual' } });
    const series = db.doc(`organizations/${SEED.orgA}/series/${t.seriesId}`);
    expect(closed(await board(`series_${t.seriesId}`))).toEqual([404, 'LEADERBOARD_NOT_AVAILABLE']);
    await series.update({ 'defaults.seriesLeaderboard': true });
    expect(closed(await board(`series_${t.seriesId}`)), 'no public results').toEqual([
      404,
      'LEADERBOARD_NOT_AVAILABLE',
    ]);
    await db.doc(`organizations/${SEED.orgA}/tests/${t.testId}`).update({ resultsReleasedAt: NOW });
    expect((await board(`series_${t.seriesId}`)).status).toBe(501);
  });
});
