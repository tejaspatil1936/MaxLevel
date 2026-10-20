import { expect } from '@playwright/test';
import type { Emulators } from './emulators';
import type { SeedAccount } from './seed';

/**
 * What bootstrap must have stored for a seeded account after its first sign-in (AUTH-02, ORG-02, DATA-01, DECISIONS
 * Q5): custom claims { role, orgId, studentId? } on the Auth emulator account, and the account's uid linked on the
 * matching super-admin, admin or student record.
 */
export async function expectBootstrapped(emulators: Emulators, account: SeedAccount): Promise<void> {
  const user = await emulators.authAccount(account.email);
  expect(user.customClaims.role, `role claim of ${account.email}`).toBe(account.role);

  if (account.role === 'superAdmin') {
    const records = await emulators.where('', 'superAdmins', 'email', account.email);
    expect(
      records.map((r) => r.data.uid),
      'uid linked on the super-admin record',
    ).toEqual([user.localId]);
    return;
  }
  expect(user.customClaims.orgId, `orgId claim of ${account.email}`).toBe(account.orgId);

  if (account.role === 'admin') {
    const records = await emulators.where(`organizations/${account.orgId}`, 'admins', 'email', account.email);
    expect(
      records.map((r) => r.data.uid),
      'uid linked on the admin record',
    ).toEqual([user.localId]);
    return;
  }
  const studentId = user.customClaims.studentId;
  expect(typeof studentId, `studentId claim of ${account.email}`).toBe('string');
  const record = await emulators.doc(`organizations/${account.orgId}/students/${String(studentId)}`);
  expect(record?.data, 'student record named by the studentId claim').toMatchObject({
    email: account.email,
    orgId: account.orgId,
    uid: user.localId,
  });
}

/**
 * An account on no list gets no role (AUTH-03): its Auth emulator account exists (so the sign-in really happened)
 * and carries no role claim.
 */
export async function expectNoRole(emulators: Emulators, email: string): Promise<void> {
  const user = await emulators.authAccount(email);
  expect(user.customClaims, `claims of ${email}`).not.toHaveProperty('role');
}
