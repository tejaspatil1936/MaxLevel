import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { adminC, accounts, departmentId, ORG_A, ORG_B, seededStudent } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { DEPARTMENT_EMPTY, DEPARTMENT_EXISTS, DepartmentsPage, inUseText } from '../pages/departments-page';
import { errorCode } from '../fixtures/api';
import { expectTopRightOfHeader } from '../fixtures/layout';
import { pathPattern } from '../pages/paths';
import { OrgDetailPage } from '../pages/platform';
import { ARCHIVED_WORKSPACE_NOTICE, expectShellRules, Shell } from '../pages/shell';
import { button, expectConfirmLayout, expectEmptyState, expectFieldError, field } from '../pages/ui';

// F-1.06 Departments (STU-05, STU-07, US-AD-03; STU-06 is proved by integration tests and shown here end to end).
// Contract: docs/testids/phase-1.md, "Departments".

test.describe('F-1.06 departments', () => {
  test('STU-05 US-AD-03 an admin adds, renames and archives departments', async ({ page, signInAs, emulators }) => {
    await signInAs(accounts.adminA);
    const departments = new DepartmentsPage(page);
    await departments.goto();
    await expect(await departments.cell('Computer', 'Students')).toHaveText('5');

    const dlg = await departments.addDepartment('Robotics');
    await expect(dlg).toBeHidden();
    await expect(await departments.cell('Robotics', 'Students')).toHaveText('0');
    await expect(await departments.cell('Robotics', 'Status')).toHaveText('Active');
    await departments.rename('Computer', 'Computer Engineering');
    await expect(departments.row('Computer Engineering')).toBeVisible();
    await expect(departments.row('Computer')).toHaveCount(0);
    await departments.choose('Mechanical', 'Archive');
    await expect(await departments.cell('Mechanical', 'Status')).toHaveText('Archived');

    const computerId = departmentId(ORG_A, 'Computer');
    expect((await emulators.doc(`organizations/${ORG_A.id}/departments/${computerId}`))!.data.name).toBe(
      'Computer Engineering',
    );
    const aarav = seededStudent(ORG_A, 1);
    expect((await emulators.doc(`organizations/${ORG_A.id}/students/${aarav.id}`))!.data.departmentId).toBe(computerId);
    expect(await emulators.audit(ORG_A.id, 'department.create'), 'department.create').toHaveLength(1);
    expect(await emulators.audit(ORG_A.id, 'department.update'), 'department.update (rename)').toHaveLength(1);
    expect(await emulators.audit(ORG_A.id, 'department.archive'), 'department.archive').toHaveLength(1);

    await departments.goto();
    await expect(departments.row('Computer Engineering')).toBeVisible();
    await expect(await departments.cell('Mechanical', 'Status')).toHaveText('Archived');
  });

  test('STU-07 a department in use cannot be deleted; it is merged into another one instead', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const departments = new DepartmentsPage(page);
    await departments.goto();

    const menu = await departments.openMenu('Mechanical');
    const del = departments.menuItem('Delete');
    await expect(del).toHaveAttribute('aria-disabled', 'true');
    await expect(menu).toContainText(inUseText(5));
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(departments.row('Mechanical')).toBeVisible();

    await departments.merge('Mechanical', 'ENTC');

    await expect(await departments.cell('Mechanical', 'Status')).toHaveText('Archived');
    await expect(await departments.cell('Mechanical', 'Students')).toHaveText('0');
    await expect(await departments.cell('ENTC', 'Students')).toHaveText('10');
    const org = `organizations/${ORG_A.id}`;
    expect(await emulators.where(org, 'students', 'departmentId', departmentId(ORG_A, 'Mechanical'))).toHaveLength(0);
    expect(await emulators.where(org, 'students', 'departmentId', departmentId(ORG_A, 'ENTC'))).toHaveLength(10);
    expect((await emulators.doc(`${org}/departments/${departmentId(ORG_A, 'Mechanical')}`))!.data.status).toBe(
      'archived',
    );
    expect(await emulators.audit(ORG_A.id, 'department.merge'), 'department.merge').toHaveLength(1);
  });

  test('STU-07 UX-02 an unused department can be deleted after a confirmation that starts on Cancel', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const departments = new DepartmentsPage(page);
    await departments.goto();
    await departments.addDepartment('Temporary');
    await expect(departments.row('Temporary')).toBeVisible();

    await departments.choose('Temporary', 'Delete');
    const confirm = departments.deleteDialog('Temporary');
    await expect(confirm).toBeVisible();
    await expectConfirmLayout(confirm, 'Delete department', true);
    await button(confirm, 'Delete department').click();

    await expect(confirm).toBeHidden();
    await expect(departments.row('Temporary')).toHaveCount(0);
    await expect(departments.row('Computer')).toBeVisible();
    expect(await emulators.where(`organizations/${ORG_A.id}`, 'departments', 'name', 'Temporary')).toHaveLength(0);
  });

  test('US-AD-03 UX-09 A11Y-11 a department name already in use is refused next to the field', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const departments = new DepartmentsPage(page);
    await departments.goto();

    const dlg = await departments.addDepartment('computer');

    await expect(dlg).toBeVisible();
    await expectFieldError(dlg, field(dlg, 'Name (required)'), DEPARTMENT_EXISTS);
    const names = (await emulators.list(`organizations/${ORG_A.id}`, 'departments')).map((d) =>
      String(d.data.name).toLowerCase(),
    );
    expect(names.filter((n) => n === 'computer')).toHaveLength(1);
    await expectNoSeriousA11yViolations(page);
  });

  test('UX-08 US-AD-03 an organization without departments shows one sentence and one action', async ({
    page,
    signInAs,
    testApi,
  }) => {
    await testApi.seedEmptyOrg();
    await signInAs(adminC);
    const departments = new DepartmentsPage(page);
    await departments.goto();

    await expectEmptyState(departments.shell.main, DEPARTMENT_EMPTY.sentence, DEPARTMENT_EMPTY.action);
    await departments.add.click();

    await expect(departments.addDialog()).toBeVisible();
  });

  test('ORG-05 an admin of org B gets 404 for an org A department and nothing changes', async ({
    apiAs,
    emulators,
  }) => {
    const adminB = await apiAs(accounts.adminB);
    const computer = departmentId(ORG_A, 'Computer');

    const res = await adminB.patch(`/v1/departments/${computer}`, { name: 'Taken over' });

    expect(res.status).toBe(404);
    expect((await emulators.doc(`organizations/${ORG_A.id}/departments/${computer}`))!.data.name).toBe('Computer');
    expect(await emulators.audit(ORG_A.id, 'department.update')).toHaveLength(0);

    // Control: the same request by org A's own admin succeeds, so the 404 above is about the tenant, not the route.
    const adminA = await apiAs(accounts.adminA);
    expect((await adminA.patch(`/v1/departments/${computer}`, { name: 'Computer' })).status).toBe(200);
  });

  test('ORG-12 ORG-14 a super admin renames a department through the org switcher, logged as the super admin', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);
    await shell.goToAdmin('Departments');
    const departments = new DepartmentsPage(page);

    await departments.rename('IT', 'Information Technology');

    await expect(departments.row('Information Technology')).toBeVisible();
    const it = departmentId(ORG_A, 'IT');
    expect((await emulators.doc(`organizations/${ORG_A.id}/departments/${it}`))!.data.name).toBe(
      'Information Technology',
    );
    const entries = await emulators.audit(ORG_A.id, 'department.update');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });

    const superInA = (await apiAs(accounts.superAdmin)).inOrg(ORG_A.id);
    const listed = await superInA.get<{ items?: Array<{ id: string; name: string }> }>('/v1/departments');
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).toContain('Information Technology');
  });

  test('A11Y-07 UX-04 A11Y-16 UX-12 the departments page meets the shell rules', async ({ page, signInAs }) => {
    await signInAs(accounts.adminA);
    const departments = new DepartmentsPage(page);
    await departments.goto();
    await expect(departments.row('Computer')).toBeVisible();

    await expectShellRules(page, '/admin/departments/');
    await expectTopRightOfHeader(departments.shell.main, departments.heading, departments.add);
  });

  test('UX-06 the command palette jumps to the departments page and starts Add department', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.adminA);
    const shell = new Shell(page);
    const departments = new DepartmentsPage(page);

    await shell.openPalette();
    await shell.paletteChoose('depart', 'Departments');
    await expect(page).toHaveURL(pathPattern('/admin/departments/'));
    await expect(departments.row('Computer')).toBeVisible();

    await shell.openPalette();
    await shell.paletteChoose('add dep', 'Add department');
    await expect(departments.addDialog()).toBeVisible();
  });

  test('ORG-07 in an archived organization the super admin sees departments but cannot change them', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    const superApi = await apiAs(accounts.superAdmin);
    expect((await superApi.patch(`/v1/platform/orgs/${ORG_B.id}`, { status: 'archived' })).status).toBe(200);
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_B.name);
    await shell.goToAdmin('Departments');
    const departments = new DepartmentsPage(page);

    await expect(shell.archivedNotice).toHaveText(ARCHIVED_WORKSPACE_NOTICE);
    await expect(departments.row('Civil')).toBeVisible();
    await expect(departments.add).toBeDisabled();
    const before = await emulators.count(`organizations/${ORG_B.id}`, 'departments');
    const res = await superApi.inOrg(ORG_B.id).post('/v1/departments', { name: 'Added while archived' });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ORG_ARCHIVED');
    expect(await emulators.count(`organizations/${ORG_B.id}`, 'departments')).toBe(before);
  });

  test("US-SA-02 a removed admin's old token can no longer change departments", async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    const removed = await apiAs(accounts.adminA2);
    const first = await removed.post('/v1/departments', { name: 'Made before removal' });
    expect(first.status, 'the admin could change departments before removal').toBeLessThan(300);
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);

    await detail.removeAdmin(accounts.adminA2.email);
    await expect(detail.adminRow(accounts.adminA2.email)).toHaveCount(0);

    const after = await removed.post('/v1/departments', { name: 'Made after removal' });
    // 401 when the revocation check sees it; 403 ACCOUNT_DISABLED when the removal fell in the same second as the
    // token's auth_time and the account-status check refuses instead. Either way the change is refused.
    expect([401, 403], `admin mutation with a revoked token got ${after.status}`).toContain(after.status);
    expect(
      await emulators.where(`organizations/${ORG_A.id}`, 'departments', 'name', 'Made after removal'),
    ).toHaveLength(0);
  });
});
