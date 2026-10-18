import { pairingReservationSchema } from '@mitaoe/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode as code, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// Phone pairing (PR-13, PR-14): POST /v1/tests/{testId}/pairing-token, POST /v1/attempts/{id}/pairing-token and
// POST /v1/pairing/redeem.

const { db, auth, rtdb } = initFirebase();
const org = `organizations/${SEED.orgA}`;
const LINK = /^http:\/\/localhost:3000\/pair\/\?token=org-a\.[A-Za-z0-9_-]{43}$/;
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

const post = async (url: string, headers: Record<string, string> = {}, payload: object = {}) => {
  const res = await ctx.app.inject({ method: 'POST', url, headers, payload });
  return { status: res.statusCode, body: res.json(), raw: res.body };
};
const reserve = (testId: string, headers: Record<string, string>) => post(`/v1/tests/${testId}/pairing-token`, headers);
describe('pairing before Start', () => {
  it('PR-13 ORG-05 SER-08 a code before Start is refused like a start, and a refusal stores nothing', async () => {
    const live = await api.examTest();
    const other = await api.examTest({ orgId: SEED.orgB });
    const unpublished = await api.examTest({ publish: false });
    const mech = await api.examTest({ eligibility: { departmentIds: ['dept-org-a-mechanical'] } });
    const upcoming = await api.examTest({ opensInMin: 60 });
    const late = await api.examTest({ opensInMin: -20 });
    const s1 = await studentOf(auth, 1);
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    const superAdmin = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });

    const refusals = [
      [await reserve(other.testId, s1), 404, 'NOT_FOUND'],
      [await reserve(unpublished.testId, s1), 404, 'NOT_FOUND'],
      [await reserve(mech.testId, s1), 403, 'NOT_ELIGIBLE'],
      [await reserve(upcoming.testId, s1), 409, 'WINDOW_NOT_OPEN'],
      [await reserve(late.testId, s1), 409, 'WINDOW_CLOSED'],
      [await reserve(live.testId, admin), 403, 'FORBIDDEN'],
      [await reserve(live.testId, superAdmin), 403, 'FORBIDDEN'],
      [await reserve(live.testId, { ...superAdmin, 'x-org-id': SEED.orgA }), 403, 'FORBIDDEN'],
    ] as const;
    expect(refusals.map(([r]) => [r.status, code(r)])).toEqual(refusals.map(([, s, c]) => [s, c]));
    for (const orgId of [SEED.orgA, SEED.orgB]) {
      expect((await db.collection(`organizations/${orgId}/attemptIndex`).get()).size, orgId).toBe(0);
      expect((await db.collection(`organizations/${orgId}/pairingTokens`).get()).size, orgId).toBe(0);
    }
    expect((await rtdb.ref('attemptOwners').get()).val(), 'no attempt owner').toBeNull();
  });

  it('PR-13 TST-06 a reservation keeps one attempt ID, starts no clock, locks nothing, and Start then uses it', async () => {
    const t = await api.examTest();
    const s1 = await studentOf(auth, 1);
    const first = await reserve(t.testId, s1);
    expect(first.status, first.raw).toBe(200);
    expect(pairingReservationSchema.parse(first.body)).toEqual(first.body);
    expect(first.body).toMatchObject({ url: expect.stringMatching(LINK), expiresAt: NOW + 5 * MIN });
    expect(first.body.url).toBe(`http://localhost:3000/pair/?token=${encodeURIComponent(first.body.token)}`);
    const { attemptId } = first.body as { attemptId: string };
    expect((await rtdb.ref(`attemptOwners/${attemptId}`).get()).val()).toBe(
      (await auth.getUserByEmail('student01@a.test')).uid,
    );

    const again = await reserve(t.testId, s1);
    expect(again.body.attemptId, 'a repeat keeps the reserved attempt').toBe(attemptId);
    expect(again.body.token, 'with a new code').not.toBe(first.body.token);
    expect((await db.collection(`${org}/attempts`).get()).size, 'no attempt record').toBe(0);
    expect((await db.doc(`${org}/tests/${t.testId}`).get()).get('attemptsStarted') ?? false).toBe(false);
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    const patch = async (testId: string) => {
      const overrides = (await db.doc(`${org}/tests/${testId}`).get()).get('overrides') as object;
      return ctx.app.inject({
        method: 'PATCH',
        url: `/v1/tests/${testId}`,
        headers: admin,
        payload: { overrides: { ...overrides, maxStrikes: 5 } },
      });
    };
    const reservedOnly = await api.examTest({ title: 'Reserved only' });
    expect((await reserve(reservedOnly.testId, s1)).status).toBe(200);
    expect((await patch(reservedOnly.testId)).statusCode, 'no TST-06 lock after a reservation').toBe(200);

    ctx.clock.advance(MIN);
    const started = await api.start(t.testId, s1);
    expect(started.status, started.raw).toBe(201);
    expect(started.body.attempt).toMatchObject({ id: attemptId, startedAt: NOW + MIN });
    expect((await reserve(t.testId, s1)).body.attemptId, 'pairing keeps the started attempt').toBe(attemptId);
    expect((await patch(t.testId)).statusCode, 'the lock starts with Start').toBe(409);
  });
});
