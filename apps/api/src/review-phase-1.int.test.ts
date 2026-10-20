import { beforeEach, describe, expect, it } from 'vitest';
import { emailKey } from './data/keys';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims, signIn } from './test-support/tokens';

// Regressions for the phase 1 release-gate review (docs/verification/phase-1.md).
const { db, auth } = initFirebase();
const orgA = SEED.orgA;
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });
const superAdmin = () => asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

describe('archived organizations stay read-only on the platform routes', () => {
  it('ORG-07 US-SA-05 entitlements and admin removal are refused with 409 ORG_ARCHIVED', async () => {
    const { app } = await testApp();
    const headers = await superAdmin();
    const archive = await app.inject({
      method: 'PATCH',
      url: `/v1/platform/orgs/${orgA}`,
      headers,
      payload: { status: 'archived' },
    });
    expect(archive.statusCode).toBe(200);
    const ent = await app.inject({
      method: 'PUT',
      url: `/v1/platform/orgs/${orgA}/entitlements`,
      headers,
      payload: { featureOverrides: { analytics_reports: true }, limitOverrides: {} },
    });
    expect([ent.statusCode, ent.json().error?.code]).toEqual([409, 'ORG_ARCHIVED']);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/platform/orgs/${orgA}/admins/adm-org-a-2`,
      headers,
    });
    expect([removed.statusCode, removed.json().error?.code]).toEqual([409, 'ORG_ARCHIVED']);
    expect((await db.doc(`organizations/${orgA}`).get()).get('featureOverrides')).toEqual({});
    expect((await db.doc(`organizations/${orgA}/admins/adm-org-a-2`).get()).get('status')).toBe('active');
  });
});

describe('a student whose whitelist entry was removed', () => {
  const email = 'student04@a.test';
  const id = 'stu-org-a-04';
  const removeEntry = async () => {
    const { app } = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/whitelist/bulk',
      headers: await admin(),
      payload: { action: 'remove', emails: [email] },
    });
    expect(res.statusCode).toBe(200);
    return app;
  };

  it('WL-05 STU-09 can still be edited, and enabling asks for the email to be listed again', async () => {
    const app = await removeEntry();
    const headers = await admin();
    const edit = await app.inject({ method: 'PATCH', url: `/v1/students/${id}`, headers, payload: { prn: 'NEW-04' } });
    expect(edit.statusCode).toBe(200);
    const enable = await app.inject({
      method: 'PATCH',
      url: `/v1/students/${id}`,
      headers,
      payload: { status: 'registered' },
    });
    expect([enable.statusCode, enable.json().error?.code]).toEqual([409, 'NOT_LISTED']);
  });

  it('WL-05 US-AD-02 listing the email again links the kept record instead of creating a second one', async () => {
    const app = await removeEntry();
    const added = await app.inject({
      method: 'POST',
      url: '/v1/whitelist/import',
      headers: await admin(),
      payload: { mode: 'commit', source: 'single', rows: [{ email }] },
    });
    expect(added.statusCode).toBe(200);
    expect((await db.doc(`organizations/${orgA}/whitelist/${emailKey(email)}`).get()).get('studentId')).toBe(id);
    const user = await signIn(auth, email);
    const boot = await app.inject({
      method: 'POST',
      url: '/v1/session/bootstrap',
      headers: { authorization: `Bearer ${await user.token()}` },
      payload: {},
    });
    expect(boot.json()).toMatchObject({ role: 'student', studentId: id });
    const records = await db.collection(`organizations/${orgA}/students`).where('email', '==', email).get();
    expect(records.size).toBe(1);
    expect(records.docs[0]!.get('status')).toBe('registered');
  });
});

describe('preferences of a deleted student', () => {
  it('STU-08 US-AD-02 a still-valid token cannot recreate the record, and the directory keeps working', async () => {
    const { app } = await testApp();
    const token = await asClaims(auth, 'student05@a.test', { role: 'student', orgId: orgA, studentId: 'stu-org-a-05' });
    const del = await app.inject({ method: 'DELETE', url: '/v1/students/stu-org-a-05', headers: await admin() });
    expect(del.statusCode).toBe(200);
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/me/preferences',
      headers: token,
      payload: {
        textSize: 130,
        theme: 'dark',
        highContrast: false,
        reduceMotion: 'system',
        increasedSpacing: false,
        readingRuler: false,
      },
    });
    expect(put.statusCode).toBeGreaterThanOrEqual(400);
    expect((await db.doc(`organizations/${orgA}/students/stu-org-a-05`).get()).exists).toBe(false);
    const list = await app.inject({ method: 'GET', url: '/v1/students?q=student', headers: await admin() });
    expect(list.statusCode).toBe(200);
  });
});
