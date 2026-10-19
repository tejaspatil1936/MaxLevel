import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';

// OPS-07, A11Y-17: a standing accommodation for a series is added to the deadline when an attempt of its tests starts.

const { db, auth } = initFirebase();
const org = `organizations/${SEED.orgA}`;
let ctx: Awaited<ReturnType<typeof testApp>>;
let api: ReturnType<typeof attemptClient>;

const accommodate = (n: number, seriesId: string, a: { extraPct?: number; extraMin?: number }) =>
  db.doc(`${org}/students/stu-org-a-0${n}`).update({ [`accommodations.${seriesId}`]: a });
const stored = async (id: string) => (await db.doc(`${org}/attempts/${id}`).get()).data()!;

beforeAll(async () => {
  ctx = await testApp();
  api = attemptClient(ctx.app);
});

beforeEach(async () => {
  await clearEmulators();
  ctx.clock.set(NOW);
  await seedBase(db, NOW);
});

describe('standing accommodations at attempt start', () => {
  it('OPS-07 A11Y-17 a fixed slot ends later by the accommodation, past the window end', async () => {
    const t = await api.examTest(); // a 60-minute slot
    await accommodate(1, t.seriesId, { extraPct: 50 });
    await accommodate(2, t.seriesId, { extraMin: 15 });
    const a = await api.start(t.testId, await studentOf(auth, 1));
    const b = await api.start(t.testId, await studentOf(auth, 2));
    expect(a.body.attempt.deadlineAt).toBe(t.window.end + 30 * MIN);
    expect(await stored(a.body.attempt.id)).toMatchObject({ extraTimeSec: 1800, deadlineAt: t.window.end + 30 * MIN });
    expect(await stored(b.body.attempt.id)).toMatchObject({ extraTimeSec: 900, deadlineAt: t.window.end + 15 * MIN });
  });

  it('OPS-07 A11Y-17 a flexible window with full duration adds it after start plus duration', async () => {
    const t = await api.examTest({ timingMode: 'flexible', windowMin: 120, durationMin: 40 });
    await accommodate(1, t.seriesId, { extraPct: 50 });
    ctx.clock.advance(5 * MIN);
    const res = await api.start(t.testId, await studentOf(auth, 1));
    expect(await stored(res.body.attempt.id)).toMatchObject({ extraTimeSec: 1200, deadlineAt: NOW + 65 * MIN });
    expect(res.body.attempt.deadlineAt).toBe(NOW + 65 * MIN);
  });

  it('OPS-07 A11Y-17 under hard close it is added after the earlier of start plus duration and the window end', async () => {
    const t = await api.examTest({
      timingMode: 'flexible',
      windowMin: 60,
      durationMin: 40,
      overrides: { windowEndPolicy: 'hard_close' },
    });
    await accommodate(1, t.seriesId, { extraMin: 10 });
    ctx.clock.set(t.window.end - 20 * MIN);
    const res = await api.start(t.testId, await studentOf(auth, 1));
    expect(res.status, res.raw).toBe(201);
    expect(await stored(res.body.attempt.id)).toMatchObject({ extraTimeSec: 600, deadlineAt: t.window.end + 10 * MIN });
  });

  it('OPS-07 an attempt already in progress keeps its deadline, and a test of another series gets nothing', async () => {
    const t = await api.examTest();
    const other = await api.examTest({ title: 'Logical reasoning' });
    const s1 = await studentOf(auth, 1);
    const early = await api.start(t.testId, s1);
    await accommodate(1, t.seriesId, { extraMin: 15 });
    const again = await api.start(t.testId, s1);
    expect(again.body.attempt).toMatchObject({ id: early.body.attempt.id, deadlineAt: t.window.end });
    expect(await stored(early.body.attempt.id)).toMatchObject({ extraTimeSec: 0, deadlineAt: t.window.end });

    const elsewhere = await api.start(other.testId, s1);
    expect(await stored(elsewhere.body.attempt.id)).toMatchObject({ extraTimeSec: 0, deadlineAt: other.window.end });
  });
});
