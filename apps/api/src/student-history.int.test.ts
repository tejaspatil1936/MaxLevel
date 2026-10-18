import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { TEST_SECRET, testApp } from './test-support/app';
import { attemptClient, leaks, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// GET /v1/student/history (US-ST-08, RES-04, DATA-05) on the emulators: the caller's finished attempts by series and
// day, with the score only where the release state and Show past scores allow it.

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

const history = async (headers: Record<string, string>) => {
  const res = await ctx.app.inject({ method: 'GET', url: '/v1/student/history', headers });
  return { status: res.statusCode, body: res.json() as { series: Array<Record<string, unknown>> }, raw: res.body };
};
async function graded(testId: string, attempts: object[]) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/__test/seed/graded-attempts',
    headers: { 'x-test-secret': TEST_SECRET },
    payload: { orgId: SEED.orgA, testId, attempts },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { attemptIds: string[] }).attemptIds;
}
const setTest = (testId: string, fields: Record<string, unknown>) => db.doc(`${org}/tests/${testId}`).update(fields);

describe('student history', () => {
  it('US-ST-08 RES-04 DATA-05 lists finished attempts by series and day, with scores only where they may be shown', async () => {
    const quant = await api.examTest({ opensInMin: -1440, overrides: { resultRelease: 'immediate' } });
    const verbal = await api.examTest({
      seriesId: quant.seriesId,
      title: 'Verbal ability',
      overrides: { resultRelease: 'immediate', showPastScores: false },
    });
    const logic = await api.examTest({ seriesId: quant.seriesId, title: 'Logical reasoning' });
    const other = await api.examTest({
      title: 'Coding basics',
      opensInMin: 2 * 1440,
      overrides: { resultRelease: 'manual' },
    });
    await db.doc(`${org}/series/${other.seriesId}`).update({ title: 'Internship drive 2026', startDate: '2026-11-01' });
    const [q1] = await graded(quant.testId, [{ studentId: 'stu-org-a-01', score: 3, timeSec: 600 }]);
    await graded(quant.testId, [{ studentId: 'stu-org-a-02', score: 4, timeSec: 600 }]);
    const [v1] = await graded(verbal.testId, [{ studentId: 'stu-org-a-01', score: 2, timeSec: 600 }]);
    const [l1] = await graded(logic.testId, [
      { studentId: 'stu-org-a-01', score: 4, timeSec: 60, status: 'terminated' },
    ]);
    const [c1] = await graded(other.testId, [{ studentId: 'stu-org-a-01', score: 1, timeSec: 60 }]);
    await setTest(other.testId, { resultsReleasedAt: NOW, resultsWithdrawn: true });

    const res = await history(await studentOf(auth, 1));
    expect(res.status, res.raw).toBe(200);
    expect(res.body.series.map((s) => [s.id, s.title])).toEqual([
      [other.seriesId, 'Internship drive 2026'],
      [quant.seriesId, 'Placement 2026'],
    ]);
    expect(res.body.series[1]!.tests).toEqual([
      {
        testId: quant.testId,
        title: 'Quantitative aptitude',
        dayLabel: 'Day 1',
        scheduledDate: '2026-11-01',
        attemptId: q1,
        status: 'submitted',
        scoreState: 'shown',
        score: 3,
        max: 4,
      },
      expect.objectContaining({ attemptId: v1, dayLabel: 'Day 2', scoreState: 'hidden' }),
      expect.objectContaining({ attemptId: l1, dayLabel: 'Day 3', status: 'terminated', scoreState: 'pending' }),
    ]);
    expect(res.body.series[0]!.tests).toEqual([expect.objectContaining({ attemptId: c1, scoreState: 'withdrawn' })]);
    for (const k of ['score', 'max', 'pct'])
      expect(res.raw.match(new RegExp(`"${k}"`, 'g'))?.length ?? 0, k).toBe(k === 'pct' ? 0 : 1);
    expect(leaks(res.raw)).toEqual([]);

    // TST-06: a changed setting takes effect on the next request.
    await setTest(quant.testId, { 'resolved.showPastScores': false });
    await setTest(other.testId, { 'resolved.resultRelease': 'never' });
    const after = await history(await studentOf(auth, 1));
    const states = after.body.series.flatMap((s) =>
      (s.tests as Array<{ scoreState: string }>).map((x) => x.scoreState),
    );
    expect(states).toEqual(['never', 'hidden', 'hidden', 'pending']);
    expect(after.raw).not.toContain('"score"');
  });

  it('US-ST-08 ORG-03 leaves out attempts in progress, of other students and other orgs; staff tokens are 403', async () => {
    const t = await api.examTest({ overrides: { resultRelease: 'immediate' } });
    const s1 = await studentOf(auth, 1);
    expect((await api.start(t.testId, s1)).status).toBe(201);
    ctx.clock.advance(MIN);
    await graded(t.testId, [{ studentId: 'stu-org-a-02', score: 4, timeSec: 600 }]);
    expect((await history(s1)).body).toEqual({ series: [] });
    expect((await history(await studentOf(auth, 1, SEED.orgB))).body).toEqual({ series: [] });

    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    const sa = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
    expect((await history(admin)).status).toBe(403);
    expect((await history({ ...sa, 'x-org-id': SEED.orgA })).status).toBe(403);
  });
});
