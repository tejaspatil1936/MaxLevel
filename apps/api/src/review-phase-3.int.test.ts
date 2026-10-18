import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, NOW, studentOf } from './test-support/attempts';
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
