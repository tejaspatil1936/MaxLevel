import { beforeEach, describe, expect, it } from 'vitest';
import { emailKey } from './data/keys';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims, idTokenFor, signIn } from './test-support/tokens';

const { db, auth } = initFirebase();
const orgA = SEED.orgA;
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });
const audit = async () =>
  (await db.collection(`organizations/${orgA}/auditLogs`).orderBy('createdAt').get()).docs.map((d) => d.data());

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

describe('whitelist entries', () => {
  it('WL-01 entries store the email lowercase and trimmed, optional PRN and note, and never a department', async () => {
    const { app } = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/whitelist/import',
      headers: await admin(),
      payload: {
        mode: 'commit',
        source: 'paste',
        rows: [{ email: '  New.Student@A.Test ', prn: 'P-77', note: 'Late joiner' }, { email: 'plain@a.test' }],
      },
    });
    expect(res.json()).toMatchObject({ committed: true, toAdd: 2 });
    const entry = (await db.doc(`organizations/${orgA}/whitelist/${emailKey('new.student@a.test')}`).get()).data();
    expect(entry).toMatchObject({ email: 'new.student@a.test', prn: 'P-77', note: 'Late joiner', status: 'invited' });
    expect(entry).not.toHaveProperty('departmentId');
    expect((await db.doc(`organizations/${orgA}/whitelist/${emailKey('plain@a.test')}`).get()).data()).toMatchObject({
      prn: null,
      note: null,
    });
    expect((await db.doc(`emailIndex/${emailKey('new.student@a.test')}`).get()).get('orgIds')).toEqual([orgA]);
  });
});

describe('manual add and first sign-in', () => {
  it('DATA-01 a manual add generates the studentId, and the uid is linked when the student first signs in', async () => {
    const { app } = await testApp();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/students',
      headers: await admin(),
      payload: {
        email: 'Manual@A.test',
        name: 'Meera Manual',
        prn: 'M-1',
        departmentId: 'dept-org-a-it',
        graduationYear: 2027,
      },
    });
    expect(created.statusCode).toBe(201);
    const { id, status, uid } = created.json();
    expect(id).toMatch(/^[A-Za-z0-9]{10,}$/);
    expect([status, uid]).toEqual(['invited', null]);
    expect((await db.doc(`organizations/${orgA}/whitelist/${emailKey('manual@a.test')}`).get()).get('studentId')).toBe(
      id,
    );

    const user = await signIn(auth, 'manual@a.test');
    const boot = await app.inject({
      method: 'POST',
      url: '/v1/session/bootstrap',
      headers: { authorization: `Bearer ${await user.token()}` },
      payload: {},
    });
    expect(boot.json()).toMatchObject({ role: 'student', studentId: id });
    expect((await db.doc(`organizations/${orgA}/students/${id}`).get()).get('uid')).toBe(user.uid);
  });
});

describe('departments', () => {
  it('STU-06 students store a departmentId, so renaming the department shows the new name everywhere', async () => {
    const { app } = await testApp();
    const headers = await admin();
    expect((await db.doc(`organizations/${orgA}/students/stu-org-a-02`).get()).get('departmentId')).toBe(
      'dept-org-a-it',
    );
    await app.inject({
      method: 'PATCH',
      url: '/v1/departments/dept-org-a-it',
      headers,
      payload: { name: 'Information Technology' },
    });
    const list = await app.inject({ method: 'GET', url: '/v1/students?departmentId=dept-org-a-it', headers });
    expect(new Set(list.json().items.map((s: { departmentName: string }) => s.departmentName))).toEqual(
      new Set(['Information Technology']),
    );
    const detail = await app.inject({ method: 'GET', url: '/v1/students/stu-org-a-02', headers });
    expect(detail.json().student.departmentName).toBe('Information Technology');
  });
});

describe('student audit trail', () => {
  it('STU-11 creating, editing, disabling and deleting a student are audit-logged with before and after', async () => {
    const { app } = await testApp();
    const headers = await admin();
    const id = (
      await app.inject({
        method: 'POST',
        url: '/v1/students',
        headers,
        payload: {
          email: 'trail@a.test',
          name: 'Tara Trail',
          prn: 'T-1',
          departmentId: 'dept-org-a-it',
          graduationYear: 2026,
        },
      })
    ).json().id;
    await app.inject({ method: 'PATCH', url: `/v1/students/${id}`, headers, payload: { name: 'Tara T.' } });
    await app.inject({ method: 'PATCH', url: `/v1/students/${id}`, headers, payload: { status: 'disabled' } });
    await app.inject({ method: 'DELETE', url: `/v1/students/${id}`, headers });
    const mine = (await audit()).filter((e) => e.target.id === id);
    expect(mine.map((e) => e.action)).toEqual([
      'student.create',
      'student.update',
      'student.disable',
      'student.delete',
    ]);
    expect(mine[1]).toMatchObject({ before: { name: 'Tara Trail' }, after: { name: 'Tara T.' } });
    expect(mine[2]).toMatchObject({ before: { status: 'invited' }, after: { status: 'disabled' } });
    expect(mine[3]!.before).toMatchObject({ email: 'trail@a.test', prn: 'T-1' });
  });
});

describe('pagination', () => {
  it('API-05 lists page with an opaque cursor and refuse a page size over 200', async () => {
    const { app } = await testApp();
    const headers = await admin();
    const first = (await app.inject({ method: 'GET', url: '/v1/students?limit=7', headers })).json();
    expect(first.items).toHaveLength(7);
    const seen = new Set(first.items.map((s: { id: string }) => s.id));
    let cursor = first.nextCursor;
    while (cursor) {
      const page = (await app.inject({ method: 'GET', url: `/v1/students?limit=7&cursor=${cursor}`, headers })).json();
      for (const s of page.items) seen.add(s.id);
      cursor = page.nextCursor;
    }
    expect(seen.size).toBe(20);
    expect((await app.inject({ method: 'GET', url: '/v1/students?limit=201', headers })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/whitelist?limit=200', headers })).json().items.length,
    ).toBeGreaterThan(20);
    expect((await app.inject({ method: 'GET', url: '/v1/students?cursor=garbage', headers })).statusCode).toBe(400);
  });
});

describe('access ends promptly', () => {
  it('AUTH-06 removing an admin revokes their tokens and the next request is refused', async () => {
    const { app } = await testApp();
    const user = await signIn(auth, 'admin2@a.test');
    const boot = await app.inject({
      method: 'POST',
      url: '/v1/session/bootstrap',
      headers: { authorization: `Bearer ${await user.token()}` },
      payload: {},
    });
    expect(boot.json().role).toBe('admin');
    const before = await idTokenFor(auth, user.uid, { authTimeSec: Math.floor(Date.now() / 1000) });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/org', headers: { authorization: `Bearer ${before}` } })).statusCode,
    ).toBe(200);
    const sa = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/platform/orgs/${orgA}/admins/adm-org-a-2`,
      headers: sa,
    });
    expect(removed.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/v1/org', headers: { authorization: `Bearer ${before}` } });
    expect([401, 403]).toContain(after.statusCode);
    expect((await auth.getUser(user.uid)).customClaims ?? {}).toEqual({});
  });

  it('AUTH-06 a disabled student is refused at once even with a still-valid token, through the status check', async () => {
    const { app } = await testApp();
    const token = await asClaims(auth, 'student04@a.test', { role: 'student', orgId: orgA, studentId: 'stu-org-a-04' });
    expect((await app.inject({ method: 'GET', url: '/v1/me/profile', headers: token })).statusCode).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/v1/whitelist/bulk',
      headers: await admin(),
      payload: { action: 'disable', emails: ['student04@a.test'] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/me/profile', headers: token });
    expect([401, 403]).toContain(res.statusCode);
  });
});
