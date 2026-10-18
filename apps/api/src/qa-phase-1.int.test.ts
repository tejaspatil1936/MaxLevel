import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims, signIn } from './test-support/tokens';

// Regressions for the phase 1 QA pass (docs/verification/phase-1.md).
const { db, auth } = initFirebase();
const orgA = SEED.orgA;

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

describe('PRN uniqueness', () => {
  it('STU-02 WL-01 a whitelist PRN that another student already holds is refused at profile completion', async () => {
    const { app } = await testApp();
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });
    // The holder's ID sorts after the new student's generated one, so a lookup that stops at the first match finds the
    // new student itself.
    const taken = 'QA-PRN-1';
    const holder = (await db.doc(`organizations/${orgA}/students/stu-org-a-01`).get()).data()!;
    await db.doc(`organizations/${orgA}/students/zzzz-holder`).set({ ...holder, prn: taken, email: 'holder@a.test' });
    await app.inject({
      method: 'POST',
      url: '/v1/whitelist/import',
      headers: admin,
      payload: { mode: 'commit', source: 'single', rows: [{ email: 'newthree@a.test', prn: taken }] },
    });
    const user = await signIn(auth, 'newthree@a.test');
    const auth1 = { authorization: `Bearer ${await user.token()}` };
    await app.inject({ method: 'POST', url: '/v1/session/bootstrap', headers: auth1, payload: {} });
    const headers = { authorization: `Bearer ${await user.token()}` };
    expect((await app.inject({ method: 'POST', url: '/v1/me/consent', headers, payload: {} })).statusCode).toBe(200);
    const save = await app.inject({
      method: 'PUT',
      url: '/v1/me/profile',
      headers,
      payload: { name: 'New Three', prn: taken, departmentId: 'dept-org-a-it', graduationYear: 2027 },
    });
    expect([save.statusCode, save.json().error?.code]).toEqual([409, 'PRN_TAKEN']);
    const holders = await db.collection(`organizations/${orgA}/students`).where('prn', '==', taken).get();
    expect(holders.docs.filter((d) => d.get('status') === 'registered')).toHaveLength(1);
  });
});
