import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { seedBase } from './test-support/seed';

// API-06: per-user rate limits on the exam's answer saves (10 a second after a burst), keyed by uid.

const { db, auth } = initFirebase();
let api: ReturnType<typeof attemptClient>;
let ctx: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  ctx = await testApp();
  api = attemptClient(ctx.app);
});

beforeEach(async () => {
  await clearEmulators();
  ctx.clock.set(NOW);
  await seedBase(db, NOW);
});

async function started(t: { testId: string; questionIds: string[] }, n: number) {
  const headers = await studentOf(auth, n);
  const { body } = await api.start(t.testId, headers);
  return { headers, id: body.attempt.id, q: t.questionIds };
}

const save = (id: string, headers: Record<string, string>, questionId: string, seq: number) =>
  api.answers(id, headers, {
    answers: [{ questionId, optionId: 'a', seq, clientTs: NOW }],
    backlog: 0,
    clockOffsetMs: 0,
  });

describe('rate limits', () => {
  it('API-06 answer saves beyond the burst within a second get 429 RATE_LIMITED, per user', async () => {
    const t = await api.examTest();
    const busy = await started(t, 1);
    const calm = await started(t, 2);

    const burst = await Promise.all(
      Array.from({ length: 30 }, (_, i) => save(busy.id, busy.headers, busy.q[0]!, i + 1)),
    );
    const limited = burst.filter((r) => r.status === 429);
    expect(limited.length, 'saves refused beyond the burst').toBeGreaterThan(0);
    expect(limited.map(errorCode)).toEqual(limited.map(() => 'RATE_LIMITED'));
    expect(burst.filter((r) => r.status === 200).length, 'the burst itself is saved').toBeGreaterThanOrEqual(15);
    expect(burst.every((r) => r.status === 200 || r.status === 429)).toBe(true);

    // Another student is counted on their own.
    const other = await save(calm.id, calm.headers, calm.q[0]!, 1);
    expect(other.status, other.raw).toBe(200);
  });
});
