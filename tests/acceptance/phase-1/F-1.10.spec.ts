import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { errorCode } from '../fixtures/api';
import { scrollsHorizontally, undersizedTargets } from '../fixtures/layout';
import { anyMutation, holdApiRequests } from '../fixtures/network';
import { accounts, departmentId, INVITED01_PRN, invitedOfA, ORG_A, seededStudent } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { SettingsPage } from '../pages/admin-pages';
import { ConsentNotice, PROFILE_ERRORS, PROFILE_LOCKED_NOTE, ProfileForm } from '../pages/profile-page';
import { studentHome } from '../pages/role-home';
import { DepartmentsPage } from '../pages/departments-page';
import { expectShellRules, Shell, StudentShell } from '../pages/shell';
import { expectFieldError, labelElement } from '../pages/ui';

// F-1.10 Profile completion and locking (STU-01, STU-02, STU-03, US-ST-02, UX-07).
// Contract: docs/testids/phase-1.md, "Consent notice and profile" and "Settings".

const orgPath = `organizations/${ORG_A.id}`;

test.describe('F-1.10 profile completion and locking', () => {
  test('STU-01 STU-02 US-ST-02 first sign-in forces profile completion with the whitelist PRN prefilled and locked', async ({
    page,
    startSignIn,
    emulators,
  }) => {
    const invited = invitedOfA(1);
    await startSignIn(invited);
    const consent = new ConsentNotice(page);
    await consent.expectShown();
    await consent.agree.click();
    const profile = new ProfileForm(page);

    await profile.expectCompletionShown();
    await expect(profile.prn).toHaveValue(INVITED01_PRN);
    await expect(profile.prn).not.toBeEditable();
    await page.goto('/student/');
    await profile.expectCompletionShown();
    await expect(studentHome(page).heading).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    await profile.fill({ name: 'Meera Kulkarni', department: 'IT', graduationYear: 2027 });
    await profile.saveAndContinue.click();

    await studentHome(page).expectShown();
    const user = await emulators.authAccount(invited.email);
    const record = await emulators.studentByEmail(ORG_A.id, invited.email);
    expect(record!.data).toMatchObject({
      name: 'Meera Kulkarni',
      prn: INVITED01_PRN,
      departmentId: departmentId(ORG_A, 'IT'),
      graduationYear: 2027,
      status: 'registered',
      uid: user.localId,
    });
    expect((await emulators.whitelistEntry(ORG_A.id, invited.email))!.data.status).toBe('registered');
  });

  test('STU-01 STU-02 UX-09 A11Y-11 the profile form refuses a missing name and a PRN already used in the org', async ({
    page,
    startSignIn,
    emulators,
  }) => {
    const invited = invitedOfA(2);
    await startSignIn(invited);
    const consent = new ConsentNotice(page);
    await consent.expectShown();
    await consent.agree.click();
    const profile = new ProfileForm(page);
    await profile.expectCompletionShown();
    for (const label of [
      'Full name (required)',
      'PRN (required)',
      'Department (required)',
      'Graduation year (required)',
    ])
      await expect(labelElement(profile.main, label), `visible label ${label}`).toBeVisible();

    await profile.fill({ name: '', prn: 'KR-2027-1', department: 'ENTC', graduationYear: 2027 });
    await profile.saveAndContinue.click();
    await expectFieldError(profile.main, profile.fullName, PROFILE_ERRORS.nameMissing);

    const taken = seededStudent(ORG_A, 1).prn;
    await profile.fill({ name: 'Kiran Rao', prn: taken });
    await profile.saveAndContinue.click();

    await expectFieldError(profile.main, profile.prn, PROFILE_ERRORS.prnTaken);
    await expect(profile.completeHeading).toBeVisible();
    expect(await emulators.where(orgPath, 'students', 'prn', taken), 'PRN still unique').toHaveLength(1);
    expect((await emulators.whitelistEntry(ORG_A.id, invited.email))!.data.status).toBe('invited');
  });

  test('US-ST-02 a registered student edits the profile later', async ({ page, signInAs, emulators }) => {
    await signInAs(accounts.studentA);
    await new StudentShell(page).choose('Profile');
    const profile = new ProfileForm(page);
    await expect(profile.profileHeading).toBeVisible();
    const aarav = seededStudent(ORG_A, 1);
    await expect(profile.fullName).toHaveValue(aarav.name);

    await profile.fill({ name: 'Aarav S. Kulkarni', graduationYear: 2027 });
    await profile.saveChanges.click();

    await expect(profile.fullName).toHaveValue('Aarav S. Kulkarni');
    await page.reload();
    await expect(profile.fullName).toHaveValue('Aarav S. Kulkarni');
    expect((await emulators.doc(`${orgPath}/students/${aarav.id}`))!.data).toMatchObject({
      name: 'Aarav S. Kulkarni',
      graduationYear: 2027,
    });
  });

  test('STU-03 UX-07 the profile lock toggle updates at once, and a locked profile is read-only for the student', async ({
    page,
    signInAs,
    newSession,
    apiAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.section('Student profiles')).toBeVisible();
    await expect(settings.profileLock).not.toBeChecked();
    const held = await holdApiRequests(page, anyMutation);

    await settings.profileLock.click();
    await held.waitUntilHeld();
    await expect(settings.profileLock, 'optimistic: on before the server answers').toBeChecked();
    held.release();

    await expect(settings.profileLock).toBeChecked();
    await expect(settings.refused).toHaveCount(0);
    await page.reload();
    await expect(settings.profileLock).toBeChecked();
    expect((await emulators.doc(orgPath))!.data.profileLocked).toBe(true);
    expect(await emulators.audit(ORG_A.id, 'org.settings.update'), 'org.settings.update audit entry').toHaveLength(1);

    const studentPage = await newSession(accounts.studentA);
    await new StudentShell(studentPage).choose('Profile');
    const profile = new ProfileForm(studentPage);
    await expect(profile.profileHeading).toBeVisible();
    await expect(profile.lockedNote).toHaveText(PROFILE_LOCKED_NOTE);
    await expect(profile.fullName).not.toBeEditable();
    await expect(profile.prn).not.toBeEditable();
    await expect(profile.saveChanges).toHaveCount(0);

    const aarav = seededStudent(ORG_A, 1);
    const api = await apiAs(accounts.studentA);
    const res = await api.put('/v1/me/profile', {
      name: 'Changed while locked',
      prn: aarav.prn,
      departmentId: aarav.departmentId,
      graduationYear: aarav.graduationYear,
    });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('PROFILE_LOCKED');
    expect((await emulators.doc(`${orgPath}/students/${aarav.id}`))!.data.name).toBe(aarav.name);
  });

  test('UX-07 a toggle the server refuses rolls back with an explanation', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const superApi = await apiAs(accounts.superAdmin);
    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.profileLock).not.toBeChecked();
    const held = await holdApiRequests(page, anyMutation);

    await settings.profileLock.click();
    await held.waitUntilHeld();
    await expect(settings.profileLock).toBeChecked();
    // A real refusal: while the save is in flight the organization is archived, so the API refuses the change.
    expect((await superApi.patch(`/v1/platform/orgs/${ORG_A.id}`, { status: 'archived' })).status).toBe(200);
    held.release();

    await expect(settings.refused).toBeVisible();
    await expect(settings.profileLock).not.toBeChecked();
    expect((await emulators.doc(orgPath))!.data.profileLocked ?? false).toBe(false);
  });

  test('STU-03 ORG-12 ORG-14 a super admin locks profiles through the switcher, logged as the super admin', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);
    await shell.goToAdmin('Settings');
    const settings = new SettingsPage(page);

    await settings.profileLock.click();

    await expect(settings.profileLock).toBeChecked();
    await page.reload();
    await expect(settings.profileLock).toBeChecked();
    expect((await emulators.doc(orgPath))!.data.profileLocked).toBe(true);
    const entries = await emulators.audit(ORG_A.id, 'org.settings.update');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });
  });

  test('STU-05 US-AD-03 the profile form offers exactly the active departments, with renames shown', async ({
    page,
    signInAs,
    newBrowser,
    startSignIn,
  }) => {
    await signInAs(accounts.adminA);
    const departments = new DepartmentsPage(page);
    await departments.goto();
    await departments.addDepartment('Robotics');
    await expect(departments.row('Robotics')).toBeVisible();
    await departments.rename('Computer', 'Computer Engineering');
    await departments.choose('Mechanical', 'Archive');
    await expect(await departments.cell('Mechanical', 'Status')).toHaveText('Archived');

    const studentPage = await newBrowser();
    await startSignIn(invitedOfA(1), studentPage);
    const consent = new ConsentNotice(studentPage);
    await consent.expectShown();
    await consent.agree.click();
    const profile = new ProfileForm(studentPage);
    await profile.expectCompletionShown();

    expect((await profile.departmentOptions()).sort()).toEqual(['Computer Engineering', 'ENTC', 'IT', 'Robotics']);
  });

  test('UX-04 A11Y-16 UX-12 the profile page has 44 px targets and works at 360 px', async ({ page, signInAs }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signInAs(accounts.studentA);
    const profile = new ProfileForm(page);

    await profile.goto();

    await expect(profile.profileHeading).toBeVisible();
    await expect(profile.fullName).toBeVisible();
    expect(await scrollsHorizontally(page), 'horizontal scroll on /profile/ at 360 px').toBe(false);
    expect(await undersizedTargets(page), 'small targets on /profile/').toEqual([]);
  });

  test('A11Y-07 UX-04 A11Y-16 UX-12 the settings page meets the shell rules', async ({ page, signInAs }) => {
    await signInAs(accounts.adminA);
    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.profileLock).toBeVisible();

    await expectShellRules(page, '/admin/settings/');
  });
});
