import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { box, expectTopRightOfHeader, tabAndCheckFocusRing } from '../fixtures/layout';
import { apiRequest, holdApiRequests } from '../fixtures/network';
import {
  accounts,
  adminC,
  departmentId,
  ORG_A,
  ORG_B,
  seededStudent,
  STUDENT_NAMES,
  type SeedAccount,
} from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ConsentNotice } from '../pages/profile-page';
import { studentHome } from '../pages/role-home';
import { DepartmentsPage } from '../pages/departments-page';
import { expectShellRules, Shell } from '../pages/shell';
import { STUDENT_ERRORS, STUDENTS_EMPTY, STUDENTS_NO_MATCH, StudentDrawer, StudentsPage } from '../pages/students-page';
import {
  button,
  cancelButton,
  cellIn,
  emptyState,
  expectConfirmLayout,
  expectEmptyState,
  expectFieldError,
  field,
  rowWith,
} from '../pages/ui';

// F-1.11 Student directory and detail (STU-08, STU-09, STU-10, US-AD-02, UX-02, UX-05, A11Y-05; STU-11 is proved by
// integration tests and checked here in what is stored). Contract: docs/testids/phase-1.md, "Students".

const orgPath = `organizations/${ORG_A.id}`;
const byName = (a: string, b: string) => a.localeCompare(b, 'en');

test.describe('F-1.11 student directory and detail', () => {
  test('STU-08 search finds students by name, email and PRN', async ({ page, signInAs }) => {
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();
    await expect(students.rows).toHaveCount(20);

    for (const [query, n] of [
      ['Rohan', 3],
      [seededStudent(ORG_A, 5).email, 5],
      [seededStudent(ORG_A, 10).prn, 10],
    ] as const) {
      await students.search.fill(String(query));
      await expect(students.rows).toHaveCount(1);
      await expect(students.nameButton(seededStudent(ORG_A, n).name)).toBeVisible();
    }
    await expectNoSeriousA11yViolations(page);
  });

  test('STU-08 filters by department, graduation year and status', async ({ page, signInAs }) => {
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();

    await students.department.selectOption({ label: 'ENTC' });
    await expect(students.rows).toHaveCount(5);
    for (const n of [3, 7, 11, 15, 19])
      await expect(await students.cell(seededStudent(ORG_A, n).name, 'Department')).toHaveText('ENTC');

    await students.department.selectOption({ label: 'All departments' });
    await students.graduationYear.selectOption({ label: '2027' });
    await expect(students.rows).toHaveCount(10);
    await expect(students.nameButton(seededStudent(ORG_A, 2).name)).toBeVisible();
    await expect(students.nameButton(seededStudent(ORG_A, 1).name)).toHaveCount(0);

    await students.graduationYear.selectOption({ label: 'All years' });
    await students.status.selectOption({ label: 'Registered' });
    await expect(students.rows).toHaveCount(20);
  });

  test('STU-08 columns sort both ways, and the column picker and density toggle change the table', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();
    const sorted = [...STUDENT_NAMES].sort(byName);

    await students.sortButton('Name').click();
    await expect(students.columnHeader('Name')).toHaveAttribute('aria-sort', 'ascending');
    await expect(students.rows.first()).toContainText(sorted[0]!);
    expect(await students.names()).toEqual(sorted);
    await students.sortButton('Name').click();
    await expect(students.columnHeader('Name')).toHaveAttribute('aria-sort', 'descending');
    await expect(students.rows.first()).toContainText(sorted[sorted.length - 1]!);
    expect(await students.names()).toEqual([...sorted].reverse());

    await students.columns.click();
    const emailColumn = students.columnChoice('Email');
    await expect(emailColumn).toBeChecked();
    await emailColumn.click();
    await expect(students.columnHeader('Email')).toHaveCount(0);
    await expect(students.columnHeader('PRN')).toBeVisible();
    await page.keyboard.press('Escape');

    const comfortable = (await box(students.rows.first())).height;
    await students.densityOption('Compact').check();
    await expect(students.densityOption('Compact')).toBeChecked();
    await expect.poll(async () => (await box(students.rows.first())).height).toBeLessThan(comfortable);
    expect((await box(students.rows.first())).height, 'compact rows stay at least 44 px').toBeGreaterThanOrEqual(44);
  });

  test('UX-05 STU-10 clicking a row opens a 560 px drawer with the profile, attempts and change history', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const ishita = seededStudent(ORG_A, 2);
    await testApi.seedStudentAttempts(ORG_A.id, ishita.id);
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();

    await (await students.cell(ishita.name, 'PRN')).click();

    const drawer = new StudentDrawer(page, ishita.name);
    await expect(drawer.dialog).toBeVisible();
    const panel = await box(drawer.dialog);
    expect(Math.round(panel.width), 'drawer width').toBe(560);
    expect(
      Math.abs(panel.x + panel.width - page.viewportSize()!.width),
      'drawer on the right edge',
    ).toBeLessThanOrEqual(1);
    await expect(students.list).toBeVisible();
    for (const heading of [drawer.profile, drawer.attemptsHeading]) await expect(heading).toBeVisible();
    for (const text of [ishita.email, ishita.prn, ishita.department, String(ishita.graduationYear)])
      await expect(drawer.dialog).toContainText(text);
    const attempt = rowWith(drawer.attempts, 'Day 1: Aptitude');
    await expect(await cellIn(drawer.attempts, attempt, 'Score')).toHaveText('42 / 50');
    await expect(await cellIn(drawer.attempts, attempt, 'Strikes')).toHaveText('1');
    await expect(drawer.historyHeading).toBeVisible();
    await expect(drawer.noChanges, 'no audit entries for this student yet').toBeVisible();
    await expect(drawer.historyItems).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    await drawer.close.click();
    await expect(drawer.dialog).toBeHidden();
  });

  test('STU-09 STU-10 STU-11 US-AD-02 an admin edits a student; the change saves and shows in the change history', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();
    const aarav = seededStudent(ORG_A, 1);
    const drawer = await students.openDrawer(aarav.name);
    await expect(drawer.noAttempts).toBeVisible();
    await expect(drawer.noChanges).toBeVisible();

    await drawer.edit({ name: 'Aarav S. Kulkarni', department: 'IT' });

    const edited = new StudentDrawer(page, 'Aarav S. Kulkarni');
    await expect(edited.dialog).toBeVisible();
    await expect(edited.noChanges).toHaveCount(0);
    const latest = edited.historyItems.first();
    await expect(latest).toContainText(accounts.adminA.email);
    await expect(latest).toContainText(aarav.name);
    await expect(latest).toContainText('Aarav S. Kulkarni');
    await expect(students.nameButton(seededStudent(ORG_A, 2).name), 'the list stays readable').toBeVisible();
    await edited.close.click();
    await expect(edited.dialog).toBeHidden();
    await expect(students.nameButton('Aarav S. Kulkarni'), 'focus back on the opener').toBeFocused();
    await expect(await students.cell('Aarav S. Kulkarni', 'Department')).toHaveText('IT');
    expect((await emulators.doc(`${orgPath}/students/${aarav.id}`))!.data).toMatchObject({
      name: 'Aarav S. Kulkarni',
      departmentId: departmentId(ORG_A, 'IT'),
    });
    const entries = await emulators.audit(ORG_A.id, 'student.update');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.data).toMatchObject({
      target: { id: aarav.id },
      before: { name: aarav.name },
      after: { name: 'Aarav S. Kulkarni' },
    });
  });

  test('STU-09 US-AD-02 a manually added student stays invited until their first sign-in links the account', async ({
    page,
    signInAs,
    newBrowser,
    startSignIn,
    emulators,
  }) => {
    const manual: SeedAccount = { email: 'manual01@a.test', name: 'Manual Student', role: 'student', orgId: ORG_A.id };
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();

    const dlg = await students.addStudent({
      email: manual.email,
      name: manual.name,
      prn: 'MAN-001',
      department: 'ENTC',
      graduationYear: 2027,
    });

    await expect(dlg).toBeHidden();
    await expect(await students.cell(manual.name, 'Status')).toHaveText('Invited');
    const record = await emulators.studentByEmail(ORG_A.id, manual.email);
    expect(record!.data).toMatchObject({
      name: manual.name,
      prn: 'MAN-001',
      departmentId: departmentId(ORG_A, 'ENTC'),
      graduationYear: 2027,
      status: 'invited',
    });
    expect(record!.data.uid, 'no uid before first sign-in').toBeUndefined();
    expect((await emulators.whitelistEntry(ORG_A.id, manual.email))!.data).toMatchObject({
      status: 'invited',
      studentId: record!.id,
      source: 'manual',
    });
    const created = await emulators.audit(ORG_A.id, 'student.create');
    expect(created).toHaveLength(1);
    expect(created[0]!.data.target).toMatchObject({ id: record!.id });

    const studentPage = await newBrowser();
    await startSignIn(manual, studentPage);
    const consent = new ConsentNotice(studentPage);
    await consent.expectShown();
    await consent.agree.click();
    await studentHome(studentPage).expectShown();

    const user = await emulators.authAccount(manual.email);
    expect(user.customClaims).toMatchObject({ role: 'student', orgId: ORG_A.id, studentId: record!.id });
    expect((await emulators.doc(`${orgPath}/students/${record!.id}`))!.data).toMatchObject({
      uid: user.localId,
      status: 'registered',
    });
  });

  test('STU-09 UX-09 a manual add with a PRN or email already in use is refused next to the field', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();

    const dlg = await students.addStudent({
      email: 'manual02@a.test',
      name: 'Second Manual',
      prn: seededStudent(ORG_A, 1).prn,
      department: 'IT',
      graduationYear: 2026,
    });
    await expectFieldError(dlg, field(dlg, 'PRN (required)'), STUDENT_ERRORS.prnTaken);
    await field(dlg, 'PRN (required)').fill('MAN-002');
    await field(dlg, 'Email (required)').fill(seededStudent(ORG_A, 2).email);
    await button(dlg, 'Add student').click();
    await expectFieldError(dlg, field(dlg, 'Email (required)'), STUDENT_ERRORS.emailListed);

    expect(await emulators.studentByEmail(ORG_A.id, 'manual02@a.test')).toBeNull();
    expect(await emulators.where(orgPath, 'students', 'prn', 'MAN-002')).toHaveLength(0);
  });

  test('STU-09 UX-02 A11Y-05 disabling a student is in the overflow menu, and its dialog traps focus and starts on Cancel', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();
    const rohan = seededStudent(ORG_A, 3);
    const drawer = await students.openDrawer(rohan.name);
    await expect(drawer.editProfile).toBeVisible();
    await expect(drawer.actionItem('Delete student')).toHaveCount(0);
    await expect(drawer.actionItem('Disable student')).toHaveCount(0);

    await drawer.chooseAction('Disable student');
    const confirm = drawer.disableDialog();
    await expect(confirm).toBeVisible();
    await expectConfirmLayout(confirm, 'Disable student', true);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await confirm.evaluate((d) => d.contains(document.activeElement)), 'focus stays in the dialog').toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(drawer.moreActions).toBeFocused();
    expect((await emulators.doc(`${orgPath}/students/${rohan.id}`))!.data.status).toBe('registered');

    await drawer.chooseAction('Disable student');
    await button(confirm, 'Disable student').click();

    await expect(confirm).toBeHidden();
    await expect(await students.cell(rohan.name, 'Status')).toHaveText('Disabled');
    expect((await emulators.doc(`${orgPath}/students/${rohan.id}`))!.data.status).toBe('disabled');
    expect((await emulators.whitelistEntry(ORG_A.id, rohan.email))!.data.status).toBe('disabled');
    expect(await emulators.audit(ORG_A.id, 'student.disable')).toHaveLength(1);
  });

  test('US-AD-02 UX-02 deleting a student with attempts needs the typed name and keeps the results', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const sneha = seededStudent(ORG_A, 4);
    const { attemptId } = await testApi.seedStudentAttempts(ORG_A.id, sneha.id);
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();
    const drawer = await students.openDrawer(sneha.name);

    await drawer.chooseAction('Delete student');
    const confirm = drawer.deleteDialog();
    await expect(confirm).toBeVisible();
    await expect(cancelButton(confirm)).toBeFocused();
    const del = button(confirm, 'Delete student');
    await expect(drawer.typedConfirmation()).toBeVisible();
    await expect(del).toBeDisabled();
    await drawer.typedConfirmation().fill('Sneha');
    await expect(del).toBeDisabled();
    await drawer.typedConfirmation().fill(sneha.name);
    await expect(del).toBeEnabled();
    // Focus is in the textbox now; it started on Cancel (checked above).
    await expectConfirmLayout(confirm, 'Delete student', true, { focusOnCancel: false });
    await del.click();

    await expect(confirm).toBeHidden();
    await expect(students.nameButton(sneha.name)).toHaveCount(0);
    expect(await emulators.doc(`${orgPath}/students/${sneha.id}`)).toBeNull();
    expect(await emulators.doc(`${orgPath}/attempts/${attemptId}`), 'attempt and result kept').not.toBeNull();
    expect(await emulators.audit(ORG_A.id, 'student.delete')).toHaveLength(1);
  });

  test('US-AD-02 deleting a student without attempts asks for a plain confirmation', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();
    const kavya = seededStudent(ORG_A, 8);
    const drawer = await students.openDrawer(kavya.name);

    await drawer.chooseAction('Delete student');
    const confirm = drawer.deleteDialog();
    await expect(confirm).toBeVisible();
    await expect(drawer.typedConfirmation()).toHaveCount(0);
    await expectConfirmLayout(confirm, 'Delete student', true);
    await button(confirm, 'Delete student').click();

    await expect(confirm).toBeHidden();
    await expect(students.nameButton(kavya.name)).toHaveCount(0);
    await expect(students.rows).toHaveCount(19);
    expect(await emulators.doc(`${orgPath}/students/${kavya.id}`)).toBeNull();
  });

  test('UX-05 selecting rows shows a bulk-action bar at the bottom', async ({ page, signInAs }) => {
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();
    await expect(students.bulkBar).toHaveCount(0);

    await students.select(seededStudent(ORG_A, 1).name).check();
    await students.select(seededStudent(ORG_A, 2).name).check();

    await expect(students.bulkBar).toBeVisible();
    await expect(students.bulkBar).toContainText('2 selected');
    const bar = await box(students.bulkBar);
    expect(page.viewportSize()!.height - (bar.y + bar.height), 'bar at the bottom').toBeLessThanOrEqual(32);
    await students.select(seededStudent(ORG_A, 1).name).uncheck();
    await students.select(seededStudent(ORG_A, 2).name).uncheck();
    await expect(students.bulkBar).toHaveCount(0);
  });

  test('UX-08 STU-08 an organization without students shows one sentence and one action', async ({
    page,
    signInAs,
    testApi,
  }) => {
    await testApi.seedEmptyOrg();
    await signInAs(adminC);
    const students = new StudentsPage(page);
    await page.goto('/admin/students/');
    await expect(students.heading).toBeVisible();

    await expectEmptyState(students.shell.main, STUDENTS_EMPTY.sentence, STUDENTS_EMPTY.action);
    await button(emptyState(students.shell.main), STUDENTS_EMPTY.action).click();
    await expect(students.addDialog()).toBeVisible();
  });

  test('STU-08 UX-08 a search without matches offers to clear it', async ({ page, signInAs }) => {
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();

    await students.search.fill('zzz-nobody');

    await expectEmptyState(students.shell.main, STUDENTS_NO_MATCH.sentence, STUDENTS_NO_MATCH.action);
    await button(students.shell.main, STUDENTS_NO_MATCH.action).click();
    await expect(students.search).toHaveValue('');
    await expect(students.rows).toHaveCount(20);
  });

  test('ORG-05 an admin of org B gets 404 for an org A student on read, edit and delete', async ({
    apiAs,
    emulators,
  }) => {
    const adminB = await apiAs(accounts.adminB);
    const aarav = seededStudent(ORG_A, 1);

    const read = await adminB.get(`/v1/students/${aarav.id}`);
    const edit = await adminB.patch(`/v1/students/${aarav.id}`, { name: 'Taken over' });
    const remove = await adminB.delete(`/v1/students/${aarav.id}`);

    expect([read.status, edit.status, remove.status]).toEqual([404, 404, 404]);
    expect(JSON.stringify(read.body)).not.toContain(aarav.email);
    const stored = await emulators.doc(`${orgPath}/students/${aarav.id}`);
    expect(stored!.data).toMatchObject({ name: aarav.name, status: 'registered' });

    // Control: org A's own admin reads the same record, so the 404s above are about the tenant, not the route.
    const own = await (await apiAs(accounts.adminA)).get(`/v1/students/${aarav.id}`);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).toContain(aarav.email);
  });

  test('STU-09 STU-11 ORG-14 a super admin edits a student through the switcher, logged as the super admin', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);
    await shell.goToAdmin('Students');
    const students = new StudentsPage(page);
    const riya = seededStudent(ORG_A, 12);
    const drawer = await students.openDrawer(riya.name);

    await drawer.edit({ name: 'Riya S. Kale' });

    await expect(students.nameButton('Riya S. Kale')).toBeVisible();
    expect((await emulators.doc(`${orgPath}/students/${riya.id}`))!.data.name).toBe('Riya S. Kale');
    const entries = await emulators.audit(ORG_A.id, 'student.update');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });

    const superInA = (await apiAs(accounts.superAdmin)).inOrg(ORG_A.id);
    const read = await superInA.get(`/v1/students/${riya.id}`);
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.body)).toContain('Riya S. Kale');
  });

  test('STU-09 a student cannot read the directory or a student record through the API', async ({ apiAs }) => {
    const api = await apiAs(accounts.studentA);

    const list = await api.get('/v1/students');
    const one = await api.get(`/v1/students/${seededStudent(ORG_A, 2).id}`);

    expect([list.status, one.status]).toEqual([403, 403]);
    expect(JSON.stringify(list.body)).not.toContain(seededStudent(ORG_A, 2).email);
  });

  test('UX-07 the student list shows skeletons shaped like the content while it loads', async ({ page, signInAs }) => {
    await signInAs(accounts.adminA);
    const held = await holdApiRequests(page, apiRequest('GET', '/v1/students'));
    const students = new StudentsPage(page);

    await page.goto('/admin/students/');
    await held.waitUntilHeld();

    await expect(students.heading).toBeVisible();
    await expect(students.skeletons.first()).toBeVisible();
    await expect(students.busy.first()).toBeVisible();
    await expect(students.nameButton(seededStudent(ORG_A, 1).name)).toHaveCount(0);
    held.release();
    await expect(students.nameButton(seededStudent(ORG_A, 1).name)).toBeVisible();
    await expect(students.skeletons).toHaveCount(0);
    await expect(students.busy).toHaveCount(0);
  });

  test('UX-06 the command palette jumps to a student and opens their drawer', async ({ page, signInAs }) => {
    await signInAs(accounts.adminA);
    const shell = new Shell(page);
    const rohan = seededStudent(ORG_A, 3);

    await shell.openPalette();
    await shell.paletteChoose('Rohan', `${rohan.name}, ${rohan.prn}`);

    await expect(page).toHaveURL(/\/admin\/students\//);
    const drawer = new StudentDrawer(page, rohan.name);
    await expect(drawer.dialog).toBeVisible();
    await expect(drawer.dialog).toContainText(rohan.email);

    await page.keyboard.press('Escape');
    await expect(drawer.dialog).toBeHidden();
    await shell.openPalette();
    await shell.paletteChoose('add stu', 'Add student');
    await expect(new StudentsPage(page).addDialog()).toBeVisible();
  });

  test('A11Y-04 UX-05 with the bulk-action bar showing, the focused element is never covered', async ({
    page,
    signInAs,
  }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();

    await students.select(seededStudent(ORG_A, 1).name).check();
    await expect(students.bulkBar).toBeVisible();

    expect(await tabAndCheckFocusRing(page, 45), 'focus ring with the bulk-action bar showing').toEqual([]);
  });

  test('STU-06 STU-10 a renamed department shows its new name in the directory and the drawer', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const departments = new DepartmentsPage(page);
    await departments.goto();
    await departments.rename('Computer', 'Computer Engineering');
    const students = new StudentsPage(page);
    const aarav = seededStudent(ORG_A, 1);

    await students.goto();

    await expect(await students.cell(aarav.name, 'Department')).toHaveText('Computer Engineering');
    const drawer = await students.openDrawer(aarav.name);
    await expect(drawer.dialog).toContainText('Computer Engineering');
    expect((await emulators.doc(`${orgPath}/students/${aarav.id}`))!.data.departmentId).toBe(
      departmentId(ORG_A, 'Computer'),
    );
  });

  test('A11Y-07 UX-04 A11Y-16 UX-12 UX-01 the students page meets the shell rules with its primary action top-right', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();

    await expectShellRules(page, '/admin/students/');
    await expectTopRightOfHeader(students.shell.main, students.heading, students.add);
  });

  test('ORG-12 ORG-14 the directory shows only the students of the organization the super admin works in', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_B.name);
    await shell.goToAdmin('Students');
    const students = new StudentsPage(page);
    const aaravB = seededStudent(ORG_B, 1);

    await expect(await students.cell(aaravB.name, 'PRN')).toHaveText(aaravB.prn);
    await expect(students.exactCell(seededStudent(ORG_A, 1).prn)).toHaveCount(0);
    await expect(students.rows).toHaveCount(20);
    await expect(shell.workspaceNotice(ORG_B.name)).toBeVisible();
  });
});
