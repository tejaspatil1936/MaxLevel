import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { errorCode } from '../fixtures/api';
import { PNG_1X1 } from '../fixtures/files';
import { box, cssOf, expectTopRightOfHeader, focusedStyle } from '../fixtures/layout';
import { accounts, ORG_A, ORG_B, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { adminHome } from '../pages/role-home';
import {
  ARCHIVED_SIGN_IN,
  expectOrgDetail,
  ORG_ERRORS,
  OrgDetailPage,
  OrganizationsPage,
  signInRefusal,
  SUSPENDED_SIGN_IN,
} from '../pages/platform';
import { SignInPage } from '../pages/sign-in-page';
import { expectFieldError, field, labelElement } from '../pages/ui';

// F-1.01 Organizations console (ORG-06, ORG-07, US-SA-01, US-SA-05, UX-01, UX-09, A11Y-11).
// Contract: docs/testids/phase-1.md, "Platform console".

const NEW_ORG = {
  name: 'Vishwakarma Institute of Technology',
  slug: 'vit-pune',
  departments: ['Computer', 'Electronics', 'Chemical'],
};

test.describe('F-1.01 organizations console', () => {
  test('ORG-06 US-SA-01 a super admin creates an organization with name, slug, timezone, logo and departments and it appears as active', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const orgs = new OrganizationsPage(page);
    await expect(orgs.status(ORG_A.name)).toHaveText('Active');
    const form = await orgs.startNewOrganization();
    await expect(form.timezone).toHaveValue('Asia/Kolkata');

    await form.fill({
      ...NEW_ORG,
      logo: { name: 'vit-logo.png', mimeType: 'image/png', buffer: PNG_1X1 },
    });
    await form.create.click();

    const detail = await expectOrgDetail(page, NEW_ORG.name);
    await expect(detail.status).toHaveText('Active');
    await expect(detail.logo(NEW_ORG.name)).toBeVisible();

    const stored = await emulators.orgBySlug(NEW_ORG.slug);
    expect(stored, 'organization stored under its slug').not.toBeNull();
    expect(stored!.data).toMatchObject({
      name: NEW_ORG.name,
      slug: NEW_ORG.slug,
      status: 'active',
      timezone: 'Asia/Kolkata',
    });
    expect(typeof stored!.data.logoPath, 'logoPath stored').toBe('string');
    expect(String(stored!.data.logoPath)).not.toBe('');
    const departments = await emulators.list(`organizations/${stored!.id}`, 'departments');
    expect(departments.map((d) => d.data.name).sort()).toEqual([...NEW_ORG.departments].sort());
    const created = await emulators.audit(stored!.id, 'org.create');
    expect(created, 'org.create audit entry').toHaveLength(1);
    expect(created[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });

    await orgs.goto();
    await expect(orgs.row(NEW_ORG.name)).toBeVisible();
    await expect(orgs.status(NEW_ORG.name)).toHaveText('Active');
    await expectNoSeriousA11yViolations(page);
  });

  test('ORG-06 a super admin edits the details of an organization and the change is audit-logged', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_B.id, ORG_B.name);

    await detail.editName(ORG_B.name, 'COEP Technological University');

    await expect(detail.shell.heading('COEP Technological University')).toBeVisible();
    expect((await emulators.doc(`organizations/${ORG_B.id}`))!.data.name).toBe('COEP Technological University');
    const updates = await emulators.audit(ORG_B.id, 'org.update');
    expect(updates, 'org.update audit entry').toHaveLength(1);
    expect(JSON.stringify(updates[0]!.data.before)).toContain(ORG_B.name);
    expect(JSON.stringify(updates[0]!.data.after)).toContain('COEP Technological University');
  });

  test('US-SA-01 UX-09 A11Y-11 a slug already in use and a missing name are refused next to their fields and nothing is stored', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const form = await new OrganizationsPage(page).startNewOrganization();
    const orgsBefore = await emulators.count('', 'organizations');

    await form.fill({ name: 'Another Pune College', slug: ORG_B.slug });
    await form.create.click();

    await expectFieldError(page, form.slug, ORG_ERRORS.slugTaken);
    await expect(form.heading).toBeVisible();

    await form.name.fill('');
    await form.slug.fill('another-pune');
    await form.create.click();

    await expectFieldError(page, form.name, ORG_ERRORS.nameMissing);
    await expect(form.heading).toBeVisible();
    expect(await emulators.count('', 'organizations'), 'no organization stored').toBe(orgsBefore);
    expect((await emulators.orgBySlug(ORG_B.slug))!.data.name).toBe(ORG_B.name);
    expect(await emulators.orgBySlug('another-pune')).toBeNull();
    await expectNoSeriousA11yViolations(page);
  });

  test('A11Y-11 every field of the new organization form has a visible label and required fields say so in words', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.superAdmin);
    const form = await new OrganizationsPage(page).startNewOrganization();

    for (const label of ['Name (required)', 'URL slug (required)', 'Timezone (required)', 'Logo', 'Departments']) {
      await expect(labelElement(form.shell.main, label), `visible label ${label}`).toBeVisible();
      await expect(field(form.shell.main, label), `field labelled ${label}`).toHaveCount(1);
    }
    for (const optional of ['Logo', 'Departments'])
      await expect(labelElement(form.shell.main, optional)).not.toContainText('required');
  });

  test('UX-01 the primary action sits top-right and the long form has a sticky footer with Discard then the primary button', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.superAdmin);
    const orgs = new OrganizationsPage(page);
    await expectTopRightOfHeader(orgs.shell.main, orgs.shell.heading('Organizations'), orgs.newOrganization);

    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);
    await expectTopRightOfHeader(detail.shell.main, detail.shell.heading(ORG_A.name), detail.editDetails);

    await orgs.goto();
    const form = await orgs.startNewOrganization();
    await expect(form.footer).toBeVisible();
    expect(['sticky', 'fixed']).toContain(await cssOf(form.footer, 'position'));
    const [footer, discard, create] = [await box(form.footer), await box(form.discard), await box(form.create)];
    expect(discard.x + discard.width, 'Discard left of Create organization').toBeLessThanOrEqual(create.x);
    expect(footer.x + footer.width - (create.x + create.width), 'primary at the far right').toBeLessThanOrEqual(48);
    await expect(form.unsaved).toHaveCount(0);

    await form.name.fill('Half-typed College');
    await expect(form.unsaved).toBeVisible();
    await form.discard.click();

    await expect(form.name).toHaveValue('');
    await expect(form.unsaved).toHaveCount(0);
  });

  test('ORG-07 US-SA-05 suspending an organization stops its admins and students signing in, and restoring it lets them back', async ({
    page,
    signInAs,
    newBrowser,
    startSignIn,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);

    await detail.changeStatus('Suspend organization', ORG_A.name);

    await expect(detail.status).toHaveText('Suspended');
    expect((await emulators.doc(`organizations/${ORG_A.id}`))!.data.status).toBe('suspended');
    for (const account of [accounts.adminA, studentOfA(2)]) {
      const other = await newBrowser();
      const signIn = await startSignIn(account, other);
      await expect(signInRefusal(other, 'suspended')).toBeVisible();
      await expect(signInRefusal(other, 'suspended')).toHaveText(SUSPENDED_SIGN_IN);
      await signIn.expectShown();
      const user = await emulators.authAccount(account.email);
      expect(user.customClaims, `claims of ${account.email}`).not.toHaveProperty('role');
    }
    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await expect(orgs.status(ORG_A.name)).toHaveText('Suspended');
    expect((await emulators.list(`organizations/${ORG_A.id}`, 'students')).length, 'data kept').toBeGreaterThan(0);

    await orgs.openOrg(ORG_A.name);
    await detail.changeStatus('Restore organization', ORG_A.name);

    await expect(detail.status).toHaveText('Active');
    const again = await newBrowser();
    await startSignIn(accounts.adminA, again);
    await adminHome(again).expectShown();
    const suspend = await emulators.audit(ORG_A.id, 'org.suspend');
    const restore = await emulators.audit(ORG_A.id, 'org.restore');
    expect(suspend, 'org.suspend audit entry').toHaveLength(1);
    expect(suspend[0]!.data).toMatchObject({ before: { status: 'active' }, after: { status: 'suspended' } });
    expect(restore, 'org.restore audit entry').toHaveLength(1);
    expect(restore[0]!.data).toMatchObject({ before: { status: 'suspended' }, after: { status: 'active' } });
  });

  test('ORG-07 US-SA-05 an archived organization is read-only for the super admin, refuses sign-in and can be restored', async ({
    page,
    signInAs,
    newBrowser,
    startSignIn,
    apiAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_B.id, ORG_B.name);

    await detail.changeStatus('Archive organization', ORG_B.name);

    await expect(detail.status).toHaveText('Archived');
    await expect(detail.editDetails).toBeDisabled();
    await detail.moreActions.click();
    await expect(detail.menuItem('Restore organization')).toBeVisible();
    await expect(detail.menuItem('Archive organization')).toHaveCount(0);
    await page.keyboard.press('Escape');

    const superApi = await apiAs(accounts.superAdmin);
    const rename = await superApi.patch(`/v1/platform/orgs/${ORG_B.id}`, { name: 'Renamed while archived' });
    expect(rename.status).toBe(409);
    expect(errorCode(rename)).toBe('ORG_ARCHIVED');
    expect((await emulators.doc(`organizations/${ORG_B.id}`))!.data.name).toBe(ORG_B.name);
    expect((await emulators.list(`organizations/${ORG_B.id}`, 'students')).length, 'data kept').toBeGreaterThan(0);

    const other = await newBrowser();
    const signIn = await startSignIn(accounts.adminB, other);
    await expect(signInRefusal(other, 'archived')).toHaveText(ARCHIVED_SIGN_IN);
    await signIn.expectShown();

    await detail.changeStatus('Restore organization', ORG_B.name);

    await expect(detail.status).toHaveText('Active');
    await expect(detail.editDetails).toBeEnabled();
    expect((await emulators.doc(`organizations/${ORG_B.id}`))!.data.status).toBe('active');
    const archive = await emulators.audit(ORG_B.id, 'org.archive');
    expect(archive, 'org.archive audit entry').toHaveLength(1);
    expect(archive[0]!.data).toMatchObject({ before: { status: 'active' }, after: { status: 'archived' } });
    expect(await emulators.audit(ORG_B.id, 'org.restore'), 'org.restore audit entry').toHaveLength(1);
  });

  test('UX-01 A11Y-04 the sticky footer of the long form never covers the focused field', async ({
    page,
    signInAs,
  }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await signInAs(accounts.superAdmin);
    const form = await new OrganizationsPage(page).startNewOrganization();
    await form.name.focus();

    const covered: string[] = [];
    for (let i = 0; i < 12; i++) {
      const style = await focusedStyle(page);
      if (!style.unobscured) covered.push(style.description);
      if (await form.create.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(form.create).toBeFocused();
    expect(covered, 'focused elements covered by the footer bar').toEqual([]);
  });

  test('ORG-06 US-SA-01 an admin cannot create organizations or open the platform console', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    const home = await signInAs(accounts.adminA);
    const api = await apiAs(accounts.adminA);

    const res = await api.post('/v1/platform/orgs', {
      name: 'Admin-made College',
      slug: 'admin-made',
      timezone: 'Asia/Kolkata',
      departments: [],
    });

    expect(res.status).toBe(403);
    expect(await emulators.orgBySlug('admin-made')).toBeNull();
    await page.goto('/platform/');
    await home.expectShown();
    await expect(new OrganizationsPage(page).newOrganization).toHaveCount(0);
    await expect(new SignInPage(page).unlistedAlert).toHaveCount(0);
  });
});
