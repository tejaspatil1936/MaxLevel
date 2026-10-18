import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { expectBootstrapped } from '../fixtures/identity';
import { accounts, ORG_A, type SeedAccount } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ORG_ERRORS, OrgDetailPage } from '../pages/platform';
import { Shell } from '../pages/shell';
import { SignInPage, UNLISTED_MESSAGE } from '../pages/sign-in-page';
import { adminHome } from '../pages/role-home';
import { cancelButton, expectConfirmLayout, expectFieldError, field } from '../pages/ui';

// F-1.02 Organization admins (ORG-08, US-SA-02; AUTH-06 is proved by integration tests).
// Contract: docs/testids/phase-1.md, "Organization detail".

const NEW_ADMIN: SeedAccount = {
  email: 'placement.head@a.test',
  name: 'Placement Head',
  role: 'admin',
  orgId: ORG_A.id,
};

test.describe('F-1.02 organization admins', () => {
  test("ORG-08 US-SA-02 a super admin adds an admin by email who then signs in to that org's admin workspace", async ({
    page,
    signInAs,
    newSession,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);
    await expect(detail.section('Admins')).toBeVisible();
    await expect(detail.adminRow(accounts.adminA.email)).toBeVisible();

    const dlg = await detail.addAdminByEmail(NEW_ADMIN.email, NEW_ADMIN.name);

    await expect(dlg).toBeHidden();
    await expect(detail.adminRow(NEW_ADMIN.email)).toBeVisible();
    await expect(detail.adminRow(NEW_ADMIN.email)).toContainText(NEW_ADMIN.name);
    const records = await emulators.where(`organizations/${ORG_A.id}`, 'admins', 'email', NEW_ADMIN.email);
    expect(records, 'one admin record').toHaveLength(1);
    expect(records[0]!.data).toMatchObject({ email: NEW_ADMIN.email, status: 'active' });
    expect(records[0]!.data.uid, 'no uid before first sign-in').toBeUndefined();
    const added = await emulators.audit(ORG_A.id, 'org.admin.add');
    expect(added, 'org.admin.add audit entry').toHaveLength(1);
    expect(added[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });

    const adminPage = await newSession(NEW_ADMIN);

    await expect(new Shell(adminPage).banner).toContainText(ORG_A.name);
    await expectBootstrapped(emulators, NEW_ADMIN);
  });

  test('US-SA-02 a removed admin loses access at once: tokens are revoked and the next sign-in is refused', async ({
    page,
    signInAs,
    newSession,
    startSignIn,
    newBrowser,
    emulators,
  }) => {
    await newSession(accounts.adminA2);
    const before = await emulators.authAccount(accounts.adminA2.email);
    expect(before.customClaims).toMatchObject({ role: 'admin', orgId: ORG_A.id });
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);
    const removedAtSec = Math.floor(Date.now() / 1000);

    await detail.removeAdmin(accounts.adminA2.email);

    await expect(detail.adminRow(accounts.adminA2.email)).toHaveCount(0);
    await expect(detail.adminRow(accounts.adminA.email)).toBeVisible();
    const record = await emulators.where(`organizations/${ORG_A.id}`, 'admins', 'email', accounts.adminA2.email);
    expect(record.map((r) => r.data.status)).toEqual(['removed']);
    const user = await emulators.authAccount(accounts.adminA2.email);
    expect(user.validSince ?? 0, 'refresh tokens revoked (validSince moved)').toBeGreaterThanOrEqual(removedAtSec);

    const other = await newBrowser();
    const signIn = await startSignIn(accounts.adminA2, other);
    await expect(signIn.unlistedAlert).toHaveText(UNLISTED_MESSAGE);
    await signIn.expectShown();
    expect(await emulators.audit(ORG_A.id, 'org.admin.remove'), 'org.admin.remove audit entry').toHaveLength(1);
  });

  test('ORG-08 UX-02 removing an admin asks first, with focus on Cancel', async ({ page, signInAs, emulators }) => {
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);

    const confirm = await detail.openRemoveAdmin(accounts.adminA2.email);
    await expectConfirmLayout(confirm, 'Remove admin', true);
    await cancelButton(confirm).click();

    await expect(confirm).toBeHidden();
    await expect(detail.adminRow(accounts.adminA2.email)).toBeVisible();
    const record = await emulators.where(`organizations/${ORG_A.id}`, 'admins', 'email', accounts.adminA2.email);
    expect(record.map((r) => r.data.status)).toEqual(['active']);
  });

  test('ORG-08 UX-09 adding an email that is already an admin is refused next to the field', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);

    const dlg = await detail.addAdminByEmail(accounts.adminA.email);

    await expect(dlg).toBeVisible();
    await expectFieldError(dlg, field(dlg, 'Email (required)'), ORG_ERRORS.adminExists);
    expect(await emulators.where(`organizations/${ORG_A.id}`, 'admins', 'email', accounts.adminA.email)).toHaveLength(
      1,
    );
    await expectNoSeriousA11yViolations(page);
  });

  test('ORG-08 US-SA-02 an admin cannot add admins, even to their own organization', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const api = await apiAs(accounts.adminA);

    const res = await api.post(`/v1/platform/orgs/${ORG_A.id}/admins`, { email: 'sneaky@a.test', name: 'Sneaky' });

    expect(res.status).toBe(403);
    expect(await emulators.where(`organizations/${ORG_A.id}`, 'admins', 'email', 'sneaky@a.test')).toHaveLength(0);
    await page.goto(`/platform/org/?id=${ORG_A.id}`);
    await adminHome(page).expectShown();
    await expect(new OrgDetailPage(page).addAdmin).toHaveCount(0);
    await expect(new SignInPage(page).unlistedAlert).toHaveCount(0);
  });
});
