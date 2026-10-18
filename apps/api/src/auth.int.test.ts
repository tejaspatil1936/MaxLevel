import { NOT_ON_LIST_MESSAGE, TestClock } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer } from './app';
import { loadConfig } from './config';
import { createData } from './data';
import { emailKey } from './data/keys';
import { initFirebase } from './firebase';
import { registerAuth } from './plugins/auth';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { idTokenFor, revokeAfter, signIn } from './test-support/tokens';

const { db, auth } = initFirebase();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

async function bootstrap(email: string, body: Record<string, unknown> = {}) {
  const { app } = await testApp();
  const user = await signIn(auth, email);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/session/bootstrap',
    headers: bearer(await user.token()),
    payload: body,
  });
  return { app, user, res };
}

describe('token verification', () => {
  it('AUTH-05 requests without a token or with a bad token get 401', async () => {
    const { app } = await testApp();
    for (const headers of [{}, { authorization: 'Bearer not-a-token' }, { authorization: 'Basic abc' }]) {
      const res = await app.inject({ method: 'GET', url: '/v1/me', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('AUTH-05 admin mutations refuse a token issued before revocation', async () => {
    const app = await createServer({ ...loadConfig({}), logLevel: 'silent' }, new TestClock());
    registerAuth(app, { auth, data: createData(db) });
    const ok = { schema: { response: { 200: z.object({ orgId: z.string() }) } } };
    app.post('/v1/thing', { ...ok, config: { access: 'admin' } }, async (req) => ({ orgId: req.orgId! }));
    const user = await signIn(auth, 'admin1@a.test');
    await auth.setCustomUserClaims(user.uid, { role: 'admin', orgId: SEED.orgA });
    const nowSec = Math.floor(Date.now() / 1000);
    const before = await idTokenFor(auth, user.uid, { authTimeSec: nowSec });
    expect((await app.inject({ method: 'POST', url: '/v1/thing', headers: bearer(before) })).statusCode).toBe(200);
    // Revocation recorded after the token was issued (the emulator's validSince, as revokeRefreshTokens sets it).
    await revokeAfter(user.uid, nowSec + 10);
    expect((await app.inject({ method: 'POST', url: '/v1/thing', headers: bearer(before) })).statusCode).toBe(401);
  });
});

describe('session bootstrap', () => {
  it('AUTH-02 a super-admin email resolves to superAdmin before any admin or whitelist record', async () => {
    await db
      .doc(`organizations/${SEED.orgA}/admins/adm-x`)
      .set({ orgId: SEED.orgA, email: SEED.superAdmin, status: 'active', uid: null });
    await db.doc(`emailIndex/${emailKey(SEED.superAdmin)}`).set({ orgIds: [SEED.orgA] });
    const { res, user } = await bootstrap(SEED.superAdmin);
    expect(res.json()).toEqual({ status: 'ok', role: 'superAdmin', orgId: null, studentId: null, refreshToken: true });
    expect((await auth.getUser(user.uid)).customClaims).toEqual({ role: 'superAdmin' });
    expect((await db.doc('superAdmins/sa-1').get()).get('uid')).toBe(user.uid);
  });

  it('AUTH-02 an admin email resolves to admin of its org before a whitelist entry', async () => {
    await db
      .doc(`organizations/${SEED.orgA}/whitelist/${emailKey('admin1@a.test')}`)
      .set({ email: 'admin1@a.test', status: 'invited' });
    const { res, user } = await bootstrap('admin1@a.test');
    expect(res.json()).toMatchObject({ status: 'ok', role: 'admin', orgId: SEED.orgA });
    expect((await auth.getUser(user.uid)).customClaims).toEqual({ role: 'admin', orgId: SEED.orgA });
    expect((await db.doc(`organizations/${SEED.orgA}/admins/adm-org-a-1`).get()).get('uid')).toBe(user.uid);
  });

  it('AUTH-02 a whitelisted student gets role, org and studentId, and the uid is linked', async () => {
    const { res, user } = await bootstrap('student03@b.test');
    expect(res.json()).toEqual({
      status: 'ok',
      role: 'student',
      orgId: SEED.orgB,
      studentId: 'stu-org-b-03',
      refreshToken: true,
    });
    expect((await auth.getUser(user.uid)).customClaims).toEqual({
      role: 'student',
      orgId: SEED.orgB,
      studentId: 'stu-org-b-03',
    });
    expect((await db.doc(`organizations/${SEED.orgB}/students/stu-org-b-03`).get()).get('uid')).toBe(user.uid);
    expect((await db.doc(`userIndex/${user.uid}`).get()).data()).toMatchObject({ role: 'student', orgId: SEED.orgB });
  });

  it('AUTH-02 an email on no list is refused with the plain message and gets no claims', async () => {
    const { res, user } = await bootstrap(SEED.nobody);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'NOT_ON_LIST', message: NOT_ON_LIST_MESSAGE, details: {} } });
    expect((await auth.getUser(user.uid)).customClaims ?? {}).toEqual({});
  });

  it('AUTH-02 only verified Google accounts are resolved; other sign-in methods get no role', async () => {
    const { app } = await testApp();
    for (const [email, opts] of [
      [SEED.superAdmin, { emailVerified: false }],
      ['admin1@a.test', { provider: 'password' }],
      ['student02@a.test', { provider: 'anonymous' }],
    ] as const) {
      const user = await signIn(auth, email);
      const token = await idTokenFor(auth, user.uid, opts);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/session/bootstrap',
        headers: bearer(token),
        payload: {},
      });
      expect(res.statusCode, email).toBe(403);
      expect(res.json().error.code).toBe('NOT_ON_LIST');
      expect((await auth.getUser(user.uid)).customClaims ?? {}).toEqual({});
    }
    expect((await db.doc('superAdmins/sa-1').get()).get('uid')).toBeNull();
    expect((await db.doc(`organizations/${SEED.orgA}/admins/adm-org-a-1`).get()).get('uid')).toBeNull();
  });

  it('AUTH-02 a disabled whitelist entry is refused like an unlisted email', async () => {
    await db.doc(`organizations/${SEED.orgA}/whitelist/${emailKey('student05@a.test')}`).update({ status: 'disabled' });
    const { res } = await bootstrap('student05@a.test');
    expect(res.json().error.code).toBe('NOT_ON_LIST');
  });

  it('AUTH-02 an email in two orgs is asked to choose, then gets the chosen org', async () => {
    const first = await bootstrap(SEED.multiOrg);
    expect(first.res.json()).toEqual({
      status: 'choose_org',
      orgs: [
        { orgId: SEED.orgA, name: 'MIT Academy of Engineering' },
        { orgId: SEED.orgB, name: 'College of Engineering Pune' },
      ],
    });
    const chosen = await first.app.inject({
      method: 'POST',
      url: '/v1/session/bootstrap',
      headers: bearer(await first.user.token()),
      payload: { orgId: SEED.orgB },
    });
    expect(chosen.json()).toMatchObject({ status: 'ok', role: 'student', orgId: SEED.orgB });
  });

  it('AUTH-02 asking again to choose clears the previous choice, so a reload cannot slip into the old org', async () => {
    const first = await bootstrap(SEED.multiOrg, { orgId: SEED.orgA });
    expect((await auth.getUser(first.user.uid)).customClaims).toMatchObject({ orgId: SEED.orgA });
    const again = await first.app.inject({
      method: 'POST',
      url: '/v1/session/bootstrap',
      headers: bearer(await first.user.token()),
      payload: {},
    });
    expect(again.json().status).toBe('choose_org');
    expect((await auth.getUser(first.user.uid)).customClaims ?? {}).toEqual({});
  });
});

describe('claims drive the request context', () => {
  it('ORG-02 after bootstrap and a token refresh, /v1/me reports role and org from the verified claims', async () => {
    const { app, user } = await bootstrap('admin2@b.test');
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(await user.token()) });
    expect(me.json()).toMatchObject({
      role: 'admin',
      orgId: SEED.orgB,
      org: { id: SEED.orgB, name: 'College of Engineering Pune' },
    });
  });

  it('ORG-02 a token without role claims cannot read /v1/me', async () => {
    const { app } = await testApp();
    const user = await signIn(auth, 'fresh@nowhere.test');
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(await user.token()) });
    expect(me.statusCode).toBe(403);
  });

  it('API-04 admins act in their claim org and super admins in the org named by X-Org-Id', async () => {
    const app = await createServer({ ...loadConfig({}), logLevel: 'silent' }, new TestClock());
    registerAuth(app, { auth, data: createData(db) });
    app.get(
      '/v1/where',
      { config: { access: 'admin' }, schema: { response: { 200: z.object({ orgId: z.string() }) } } },
      async (req) => ({
        orgId: req.orgId!,
      }),
    );
    const admin = await signIn(auth, 'admin1@a.test');
    await auth.setCustomUserClaims(admin.uid, { role: 'admin', orgId: SEED.orgA });
    const asAdmin = await app.inject({
      method: 'GET',
      url: '/v1/where',
      headers: { ...bearer(await admin.token()), 'x-org-id': SEED.orgB },
    });
    expect(asAdmin.json()).toEqual({ orgId: SEED.orgA });

    const sa = await signIn(auth, SEED.superAdmin);
    await auth.setCustomUserClaims(sa.uid, { role: 'superAdmin' });
    const saToken = await sa.token();
    expect(
      (
        await app.inject({ method: 'GET', url: '/v1/where', headers: { ...bearer(saToken), 'x-org-id': SEED.orgB } })
      ).json(),
    ).toEqual({
      orgId: SEED.orgB,
    });
    const missing = await app.inject({ method: 'GET', url: '/v1/where', headers: bearer(saToken) });
    expect([missing.statusCode, missing.json().error.code]).toEqual([400, 'ORG_REQUIRED']);
    const unknown = await app.inject({
      method: 'GET',
      url: '/v1/where',
      headers: { ...bearer(saToken), 'x-org-id': 'org-zzz' },
    });
    expect(unknown.statusCode).toBe(404);

    const student = await signIn(auth, 'student01@a.test');
    await auth.setCustomUserClaims(student.uid, { role: 'student', orgId: SEED.orgA, studentId: 'stu-org-a-01' });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/where', headers: bearer(await student.token()) })).statusCode,
    ).toBe(403);
  });
});
