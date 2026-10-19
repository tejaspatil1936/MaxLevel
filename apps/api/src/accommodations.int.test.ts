import type { AuditEntry } from '@mitaoe/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// PUT and DELETE /v1/students/{id}/accommodations/{seriesId} (OPS-07, A11Y-17, ORG-05, ORG-14, AUD-02).

const { db, auth } = initFirebase();
const org = `organizations/${SEED.orgA}`;
const STU = 'stu-org-a-01';
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
const call = async (method: 'PUT' | 'DELETE', headers: Record<string, string>, seriesId: string, payload?: object) => {
  const res = await ctx.app.inject({
    method,
    url: `/v1/students/${STU}/accommodations/${seriesId}`,
    headers,
    ...(payload ? { payload } : {}),
  });
  return { status: res.statusCode, body: res.json() as { error?: { code: string } } };
};
const stored = async () => ((await db.doc(`${org}/students/${STU}`).get()).get('accommodations') ?? {}) as object;
const entries = async () =>
  (await db.collection(`${org}/auditLogs`).where('action', '==', 'student.accommodation.update').get()).docs.map(
    (d) => d.data() as AuditEntry,
  );

describe('standing accommodation routes', () => {
  it('OPS-07 A11Y-17 AUD-02 an admin sets, replaces and removes one, each with its audit entry, and the next start uses it', async () => {
    const t = await api.examTest();
    const admin = await adminA();
    expect(await call('PUT', admin, t.seriesId, { extraPct: 50 })).toEqual({
      status: 200,
      body: { accommodations: { [t.seriesId]: { extraPct: 50 } } },
    });
    expect(await stored()).toEqual({ [t.seriesId]: { extraPct: 50 } });
    let log = await entries();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actor: { email: 'admin1@a.test', role: 'admin' },
      target: { type: 'student', id: STU },
      after: { seriesId: t.seriesId, extraPct: 50 },
    });

    expect((await call('PUT', admin, t.seriesId, { extraMin: 15 })).status).toBe(200);
    expect(await stored()).toEqual({ [t.seriesId]: { extraMin: 15 } });
    const detail = await ctx.app.inject({ method: 'GET', url: `/v1/students/${STU}`, headers: admin });
    expect(detail.json().accommodations).toEqual({ [t.seriesId]: { extraMin: 15 } });

    const started = await api.start(t.testId, await studentOf(auth, 1));
    expect(started.body.attempt.deadlineAt).toBe(t.window.end + 15 * MIN);

    expect(await call('DELETE', admin, t.seriesId)).toEqual({ status: 200, body: { accommodations: {} } });
    expect(await stored()).toEqual({});
    log = await entries();
    expect(log.map((e) => e.after)).toEqual(
      expect.arrayContaining([
        { seriesId: t.seriesId, removed: true },
        { seriesId: t.seriesId, extraMin: 15 },
      ]),
    );
    // Removing again finds nothing to remove and writes nothing.
    expect((await call('DELETE', admin, t.seriesId)).status).toBe(200);
    expect(await entries()).toHaveLength(3);
  });

  it('OPS-07 ORG-05 a bad body, an unknown or foreign series and another org are refused, storing nothing', async () => {
    const t = await api.examTest();
    await db.doc(`organizations/${SEED.orgB}/series/ser-b`).set({ orgId: SEED.orgB, title: 'B', status: 'active' });
    const admin = await adminA();
    for (const body of [
      {},
      { extraPct: 0 },
      { extraPct: 201 },
      { extraMin: 601 },
      { extraMin: 1.5 },
      { extraPct: 10, extraMin: 5 },
    ]) {
      const res = await call('PUT', admin, t.seriesId, body);
      expect([res.status, res.body.error?.code], JSON.stringify(body)).toEqual([400, 'VALIDATION']);
    }
    expect((await call('PUT', admin, 'no-such-series', { extraPct: 10 })).status).toBe(404);
    expect((await call('PUT', admin, 'ser-b', { extraPct: 10 })).status).toBe(404);
    const adminB = await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
    expect((await call('PUT', adminB, t.seriesId, { extraPct: 10 })).status).toBe(404);
    expect((await call('DELETE', adminB, t.seriesId)).status).toBe(404);
    const student = await studentOf(auth, 1);
    expect((await call('PUT', student, t.seriesId, { extraPct: 10 })).status).toBe(403);
    expect((await call('DELETE', student, t.seriesId)).status).toBe(403);
    expect(await stored()).toEqual({});
    expect(await entries()).toEqual([]);
  });

  it('ORG-14 a super admin with X-Org-Id sets one and is named as the actor', async () => {
    const t = await api.examTest();
    const asSuper = { ...(await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' })), 'x-org-id': SEED.orgA };
    expect((await call('PUT', asSuper, t.seriesId, { extraMin: 1 })).status).toBe(200);
    expect((await entries()).map((e) => e.actor.role)).toEqual(['superAdmin']);
  });
});
