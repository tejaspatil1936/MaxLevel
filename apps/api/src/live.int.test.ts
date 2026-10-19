import type { LiveRoster, LiveTestList, TestAttemptList } from '@mitaoe/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// The live view's API reads (OPS-01, OPS-02, PERF-04): the live exams list, the one roster load and the test's
// attempts. Live statuses come from Realtime Database, so no route here answers per update.

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
const get = async <T>(url: string, headers: Record<string, string>) => {
  const res = await ctx.app.inject({ method: 'GET', url, headers });
  return { status: res.statusCode, body: res.json() as T };
};
const COMPUTER = { departmentIds: [`dept-${SEED.orgA}-computer`] };

describe('live view reads', () => {
  it('PERF-04 OPS-01 the roster is the eligible registered students, loaded once with the test heading, camera setting and duration', async () => {
    const t = await api.examTest({ seriesEligibility: COMPUTER, overrides: { secondCamera: true } });
    const roster = await get<LiveRoster>(`/v1/tests/${t.testId}/live`, await adminA());
    expect(roster.status).toBe(200);
    expect(roster.body.test).toEqual({
      id: t.testId,
      title: 'Quantitative aptitude',
      dayLabel: 'Day 1',
      secondCamera: true,
      durationMin: 60,
    });
    expect(roster.body.students.map((s) => s.id)).toEqual(
      [1, 5, 9, 13, 17]
        .map((n) => `stu-${SEED.orgA}-${String(n).padStart(2, '0')}`)
        .sort((a, b) => {
          const name = (id: string) => roster.body.students.find((s) => s.id === id)!.name;
          return name(a).localeCompare(name(b));
        }),
    );
    expect(roster.body.students[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      prn: expect.any(String),
    });

    const draft = await api.examTest({ publish: false });
    expect((await get(`/v1/tests/${draft.testId}/live`, await adminA())).status).toBe(404);
  });

  it('OPS-01 the live exams list holds published tests whose window is open now, earliest start first', async () => {
    const later = await api.examTest({ title: 'Later today', opensInMin: 120 });
    const second = await api.examTest({ title: 'Verbal', opensInMin: -1 });
    const first = await api.examTest({ title: 'Reasoning', opensInMin: -30 });
    await api.examTest({ title: 'Closed', opensInMin: -90 });
    const list = await get<LiveTestList>('/v1/live-tests', await adminA());
    expect(list.status).toBe(200);
    expect(list.body.items.map((i) => i.testId)).toEqual([first.testId, second.testId]);
    expect(list.body.items[0]).toEqual({
      testId: first.testId,
      title: 'Reasoning',
      dayLabel: expect.any(String),
      seriesId: first.seriesId,
      seriesTitle: 'Placement 2026',
      window: first.window,
    });
    expect(list.body.items.some((i) => i.testId === later.testId)).toBe(false);
  });

  it('OPS-02 ORG-05 a test’s attempts list every attempt for its org’s admins only', async () => {
    const t = await api.examTest();
    const started = await api.start(t.testId, await studentOf(auth, 1));
    const attempts = await get<TestAttemptList>(`/v1/tests/${t.testId}/attempts`, await adminA());
    expect(attempts.status).toBe(200);
    expect(attempts.body.items).toEqual([
      {
        id: started.body.attempt.id,
        studentId: `stu-${SEED.orgA}-01`,
        status: 'in_progress',
        startedAt: NOW,
        deadlineAt: started.body.attempt.deadlineAt,
        extraTimeSec: 0,
        strikesCount: 0,
      },
    ]);
    const adminB = await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
    expect((await get(`/v1/tests/${t.testId}/attempts`, adminB)).status).toBe(404);
    expect((await get(`/v1/tests/${t.testId}/live`, adminB)).status).toBe(404);
    expect((await get(`/v1/tests/${t.testId}/attempts`, await studentOf(auth, 1))).status).toBe(403);
  });
});
