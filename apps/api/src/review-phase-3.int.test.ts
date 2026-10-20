import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'firebase-admin/database';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// Regressions for the phase 3 review.
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

describe('a stored idempotent response is not replayed past the account checks', () => {
  it('API-02 AUTH-06 a disabled student repeating a stored POST /v1/attempts key is refused, not replayed', async () => {
    const t = await api.examTest();
    const s1 = await studentOf(auth, 1);
    const first = await api.start(t.testId, s1, 'key-1');
    expect(first.status, first.raw).toBe(201);

    const disable = await ctx.app.inject({
      method: 'POST',
      url: '/v1/whitelist/bulk',
      headers: await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA }),
      payload: { action: 'disable', emails: ['student01@a.test'] },
    });
    expect(disable.statusCode, disable.body).toBe(200);

    const replay = await api.start(t.testId, s1, 'key-1');
    expect([401, 403], replay.raw).toContain(replay.status);
    expect(replay.raw, 'no stored attempt payload').not.toContain(first.body.attempt.id);
  });
});

describe('a Realtime Database outage never holds up an attempt', () => {
  // firebase-admin queues writes forever while disconnected: this handle's writes never settle.
  const never = () => new Promise<void>(() => {});
  const stalled = { ref: () => ({ update: never, set: never }) } as unknown as Database;
  let down: Awaited<ReturnType<typeof testApp>>;
  let downApi: ReturnType<typeof attemptClient>;
  /** Fails the test if a request does not reply within 5 s. */
  const replies = <T>(p: Promise<T>) =>
    Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('no reply within 5 s')), 5_000))]);

  beforeAll(async () => {
    down = await testApp({ rtdb: stalled });
    downApi = attemptClient(down.app);
  });
  beforeEach(() => down.clock.set(NOW));

  it('REL-05 start, answers, a terminating strike and submit all reply while RTDB writes never settle', async () => {
    const t = await downApi.examTest({ overrides: { maxStrikes: 1 } });
    const s1 = await studentOf(auth, 2);
    const start = await replies(downApi.start(t.testId, s1));
    expect(start.status, start.raw).toBe(201);
    const id = start.body.attempt.id;

    const saved = await replies(
      downApi.answers(id, s1, {
        answers: [{ questionId: t.questionIds[0]!, optionId: 'a', seq: 1, clientTs: NOW }],
        backlog: 0,
        clockOffsetMs: 0,
      }),
    );
    expect(saved.status, saved.raw).toBe(200);
    expect(saved.body.saved).toEqual([t.questionIds[0]]);

    const strike = await replies(
      down.app.inject({
        method: 'POST',
        url: `/v1/attempts/${id}/events`,
        headers: s1,
        payload: { type: 'window_blur', clientTs: NOW, details: {} },
      }),
    );
    expect(strike.statusCode, strike.body).toBe(200);
    expect(strike.json()).toMatchObject({ strikesCount: 1, counted: true, status: 'terminated' });

    const done = await replies(
      down.app.inject({
        method: 'POST',
        url: `/v1/attempts/${id}/submit`,
        headers: { ...s1, 'idempotency-key': crypto.randomUUID() },
        payload: {},
      }),
    );
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'terminated' });
  });

  it('REL-05 pairing before Start replies while RTDB writes never settle', async () => {
    const t = await downApi.examTest();
    const s1 = await studentOf(auth, 3);
    const res = await replies(
      down.app.inject({ method: 'POST', url: `/v1/tests/${t.testId}/pairing-token`, headers: s1, payload: {} }),
    );
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('proctoring event details are bounded', () => {
  it('PR-08 PR-11 API-06 POST /v1/attempts/{id}/events refuses oversized details with 400 VALIDATION and stores nothing', async () => {
    const t = await api.examTest({ overrides: { maxStrikes: 5 } });
    const s1 = await studentOf(auth, 4);
    const start = await api.start(t.testId, s1);
    expect(start.status, start.raw).toBe(201);
    const id = start.body.attempt.id;
    const post = (details: object) =>
      ctx.app.inject({
        method: 'POST',
        url: `/v1/attempts/${id}/events`,
        headers: s1,
        payload: { type: 'context_menu', clientTs: NOW, details },
      });

    for (const details of [
      { blob: 'x'.repeat(900_000) },
      Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i])),
      { nested: { deep: true } },
    ]) {
      const res = await post(details);
      expect(res.statusCode, res.body.slice(0, 300)).toBe(400);
      expect(errorCode({ raw: res.body })).toBe('VALIDATION');
    }
    const events = await db.collection(`organizations/${SEED.orgA}/attempts/${id}/events`).get();
    expect(events.size, 'nothing stored').toBe(0);
    expect((await post({ x: 1, source: 'menu' })).statusCode).toBe(200);
  });
});
