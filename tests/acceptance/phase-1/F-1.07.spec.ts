import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { PDF_BYTES, writeCsv, writeXlsx } from '../fixtures/files';
import { expectTopRightOfHeader } from '../fixtures/layout';
import { accounts, adminC, invitedOfA, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { studentHome } from '../pages/role-home';
import { expectShellRules, Shell } from '../pages/shell';
import { button, count, expectEmptyState, expectFieldError, field } from '../pages/ui';
import { entriesText, overLimitText, WHITELIST_EMPTY, WHITELIST_ERRORS, WhitelistPage } from '../pages/whitelist-page';

// F-1.07 Whitelist upload wizard (WL-02, WL-03, US-AD-01, UX-08; WL-01 is proved by integration tests and checked
// here in what is stored). Contract: docs/testids/phase-1.md, "Whitelist" and "Upload wizard".

const orgPath = `organizations/${ORG_A.id}`;
const pad = (n: number, width = 4) => String(n).padStart(width, '0');

test.describe('F-1.07 whitelist upload wizard', () => {
  test('WL-02 WL-03 US-AD-01 an admin uploads a CSV, maps its columns, sees the validation report and saves', async ({
    page,
    signInAs,
    emulators,
  }) => {
    const before = await emulators.count(orgPath, 'whitelist');
    const csv = await writeCsv(test.info().outputPath('whitelist.csv'), [
      ['Student email', 'Roll / PRN', 'Remarks'],
      ['new01@a.test', 'NEW-001', 'First batch'],
      ['  New02@A.TEST ', 'NEW-002', ''],
      ['not-an-email', 'NEW-003', ''],
      ['NEW01@a.test', 'NEW-004', 'Second copy'],
      ['student02@a.test', '22010102', ''],
      ['new03@a.test', '', 'No PRN yet'],
    ]);
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    await expect(whitelist.count).toHaveText(entriesText(before));
    const wizard = whitelist.wizard;

    await wizard.open(whitelist.upload);
    await wizard.chooseFile(csv);
    await wizard.mapColumns({ email: 'Student email', prn: 'Roll / PRN', note: 'Remarks' });

    await expect(wizard.previewRow('new01@a.test')).toContainText('NEW-001');
    await expect(wizard.preview).toContainText('First batch');
    await expect(wizard.preview).toContainText('not-an-email');
    await expect(wizard.preview).not.toContainText('new03@a.test');
    await wizard.toReport();

    await expect(wizard.reportLine('Ready to add', 3)).toBeVisible();
    await expect(wizard.reportLine('Invalid emails', 1)).toBeVisible();
    await expect(wizard.reportLine('Duplicates in the file', 1)).toBeVisible();
    await expect(wizard.reportLine('Already on the whitelist', 1)).toBeVisible();
    await expect(wizard.problem('not-an-email', 'Invalid email')).toBeVisible();
    await expect(wizard.problem('NEW01@a.test', 'Duplicate in the file')).toBeVisible();
    await expect(wizard.problem('student02@a.test', 'Already on the whitelist')).toBeVisible();
    await expect(wizard.overLimit).toHaveCount(0);
    expect(await emulators.count(orgPath, 'whitelist'), 'nothing saved before Save').toBe(before);
    await expectNoSeriousA11yViolations(page);

    await wizard.save.click();

    await expect(wizard.dialog).toBeHidden();
    await expect(whitelist.added(3)).toBeVisible();
    await expect(whitelist.count).toHaveText(entriesText(before + 3));
    await expect(await whitelist.statusOf('new02@a.test')).toHaveText('Invited');
    expect(await emulators.count(orgPath, 'whitelist')).toBe(before + 3);
    const new01 = await emulators.whitelistEntry(ORG_A.id, 'new01@a.test');
    expect(new01!.data).toMatchObject({
      email: 'new01@a.test',
      prn: 'NEW-001',
      note: 'First batch',
      status: 'invited',
    });
    const new02 = await emulators.whitelistEntry(ORG_A.id, 'new02@a.test');
    expect(new02!.data, 'email stored lowercase and trimmed').toMatchObject({ email: 'new02@a.test', prn: 'NEW-002' });
    expect(new02!.data, 'never a department').not.toHaveProperty('departmentId');
    expect(new02!.data).not.toHaveProperty('department');
    expect((await emulators.whitelistEntry(ORG_A.id, 'new03@a.test'))!.data.prn ?? '').toBe('');
    expect(await emulators.whitelistEntry(ORG_A.id, 'not-an-email')).toBeNull();
    const imports = await emulators.audit(ORG_A.id, 'whitelist.import');
    expect(imports, 'whitelist.import audit entry').toHaveLength(1);
    expect(imports[0]!.data.actor).toMatchObject({ email: accounts.adminA.email, role: 'admin' });
  });

  test('WL-02 an admin uploads an XLSX file through the same mapping step, with a preview of the first rows', async ({
    page,
    signInAs,
    emulators,
  }) => {
    const before = await emulators.count(orgPath, 'whitelist');
    const rows = Array.from({ length: 6 }, (_, i) => [`xlsx${i + 1}@a.test`, `XL-${i + 1}`, `Row ${i + 1}`]);
    const xlsx = await writeXlsx(test.info().outputPath('whitelist.xlsx'), [['Email ID', 'PRN', 'Note'], ...rows]);
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    const wizard = whitelist.wizard;

    await wizard.open(whitelist.upload);
    await wizard.chooseFile(xlsx);
    await wizard.mapColumns({ email: 'Email ID', prn: 'PRN', note: 'Note' });

    for (const r of rows.slice(0, 5)) await expect(wizard.preview).toContainText(r[0]!);
    await expect(wizard.preview).not.toContainText(rows[5]![0]!);
    await wizard.toReport();
    await expect(wizard.reportLine('Ready to add', 6)).toBeVisible();
    await expect(wizard.reportLine('Invalid emails', 0)).toBeVisible();
    await wizard.save.click();

    await expect(wizard.dialog).toBeHidden();
    await expect(whitelist.count).toHaveText(entriesText(before + 6));
    expect((await emulators.whitelistEntry(ORG_A.id, 'xlsx6@a.test'))!.data).toMatchObject({
      prn: 'XL-6',
      note: 'Row 6',
      status: 'invited',
      source: 'upload',
    });
  });

  test('WL-02 US-AD-01 an admin pastes a list, and adds a single entry', async ({ page, signInAs, emulators }) => {
    const before = await emulators.count(orgPath, 'whitelist');
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    const wizard = whitelist.wizard;

    await wizard.open(whitelist.upload);
    await wizard.paste(['paste1@a.test', ' PASTE2@a.test', 'bad@', 'student03@a.test']);

    await expect(wizard.reportLine('Ready to add', 2)).toBeVisible();
    await expect(wizard.reportLine('Invalid emails', 1)).toBeVisible();
    await expect(wizard.reportLine('Already on the whitelist', 1)).toBeVisible();
    await wizard.save.click();
    await expect(wizard.dialog).toBeHidden();
    await expect(whitelist.count).toHaveText(entriesText(before + 2));
    expect((await emulators.whitelistEntry(ORG_A.id, 'paste2@a.test'))!.data).toMatchObject({
      status: 'invited',
      source: 'paste',
    });

    const dlg = await whitelist.addOne({ email: 'Single@A.test', prn: 'SGL-1', note: 'Late joiner' });

    await expect(dlg).toBeHidden();
    await expect(await whitelist.statusOf('single@a.test')).toHaveText('Invited');
    await expect(whitelist.count).toHaveText(entriesText(before + 3));
    expect((await emulators.whitelistEntry(ORG_A.id, 'single@a.test'))!.data).toMatchObject({
      prn: 'SGL-1',
      note: 'Late joiner',
      status: 'invited',
      source: 'single',
    });
    expect(await emulators.audit(ORG_A.id, 'whitelist.add'), 'whitelist.add audit entry').toHaveLength(1);
  });

  test('WL-02 UX-09 a single entry with an invalid or listed email is refused next to the field', async ({
    page,
    signInAs,
    emulators,
  }) => {
    const before = await emulators.count(orgPath, 'whitelist');
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();

    const dlg = await whitelist.addOne({ email: 'not-an-email' });
    const email = field(dlg, 'Email (required)');
    await expectFieldError(dlg, email, WHITELIST_ERRORS.invalidEmail);
    await email.fill('invited01@a.test');
    await button(dlg, 'Add entry').click();
    await expectFieldError(dlg, email, WHITELIST_ERRORS.alreadyListed);

    expect(await emulators.count(orgPath, 'whitelist')).toBe(before);
  });

  test('WL-03 the report shows when an upload would pass the max_students limit, and saving is refused', async ({
    page,
    signInAs,
    emulators,
  }) => {
    const before = await emulators.count(orgPath, 'whitelist');
    const extra = 2000 - before + 1;
    const rows = Array.from({ length: extra }, (_, i) => [`limit${pad(i + 1)}@a.test`]);
    const csv = await writeCsv(test.info().outputPath('over-limit.csv'), [['Email'], ...rows]);
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    const wizard = whitelist.wizard;

    await wizard.open(whitelist.upload);
    await wizard.chooseFile(csv);
    await wizard.mapColumns({ email: 'Email' });
    await wizard.toReport();

    await expect(wizard.reportLine('Ready to add', extra)).toBeVisible();
    await expect(wizard.overLimit).toHaveText(overLimitText(before + extra, 2000));
    await expect(wizard.save).toBeDisabled();
    expect(await emulators.count(orgPath, 'whitelist')).toBe(before);
  });

  test('WL-02 US-AD-01 UX-09 a file that is not CSV or XLSX is refused on the first step', async ({
    page,
    signInAs,
    emulators,
  }) => {
    const before = await emulators.count(orgPath, 'whitelist');
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    const wizard = whitelist.wizard;
    await wizard.open(whitelist.upload);

    await wizard.uploadFile.check();
    await wizard.file.setInputFiles({ name: 'students.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES });
    await wizard.continue.click();

    await expectFieldError(wizard.dialog, wizard.file, WHITELIST_ERRORS.wrongFile);
    await expect(wizard.sourceStep).toBeVisible();
    await expect(wizard.mappingStep).toHaveCount(0);
    expect(await emulators.count(orgPath, 'whitelist')).toBe(before);
  });

  test('WL-02 WL-03 an admin onboards 1,000 test students from one upload', async ({ page, signInAs, emulators }) => {
    test.setTimeout(180_000);
    const before = await emulators.count(orgPath, 'whitelist');
    const rows = Array.from({ length: 1000 }, (_, i) => [`onboard${pad(i + 1)}@a.test`, `ONB-${pad(i + 1)}`]);
    const csv = await writeCsv(test.info().outputPath('onboard-1000.csv'), [['Email', 'PRN'], ...rows]);
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    const wizard = whitelist.wizard;

    await wizard.open(whitelist.upload);
    await wizard.chooseFile(csv);
    await wizard.mapColumns({ email: 'Email', prn: 'PRN' });
    await wizard.toReport();
    await expect(wizard.reportLine('Ready to add', 1000)).toBeVisible();
    await wizard.save.click();

    await expect(wizard.dialog).toBeHidden({ timeout: 120_000 });
    await expect(whitelist.added(1000)).toBeVisible();
    await expect(whitelist.count).toHaveText(`${count(before + 1000)} entries`);
    expect(await emulators.count(orgPath, 'whitelist')).toBe(before + 1000);
    expect((await emulators.whitelistEntry(ORG_A.id, 'onboard1000@a.test'))!.data).toMatchObject({
      prn: 'ONB-1000',
      status: 'invited',
    });
  });

  test('UX-08 US-AD-01 an empty whitelist shows one sentence and one action that starts the upload', async ({
    page,
    signInAs,
    testApi,
  }) => {
    await testApi.seedEmptyOrg();
    await signInAs(adminC);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();

    await expectEmptyState(whitelist.shell.main, WHITELIST_EMPTY.sentence, WHITELIST_EMPTY.action);
    await expect(whitelist.count).toHaveText(entriesText(0));
    await whitelist.upload.click();

    await expect(whitelist.wizard.dialog).toBeVisible();
    await expect(whitelist.wizard.sourceStep).toBeVisible();
  });

  test('WL-02 ORG-14 a super admin uploads to org A through the switcher and the import is logged as the super admin', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);
    await shell.goToAdmin('Whitelist');
    const whitelist = new WhitelistPage(page);
    const wizard = whitelist.wizard;

    await wizard.open(whitelist.upload);
    await wizard.paste(['sa-added@a.test']);
    await expect(wizard.reportLine('Ready to add', 1)).toBeVisible();
    await wizard.save.click();

    await expect(wizard.dialog).toBeHidden();
    await expect(await whitelist.statusOf('sa-added@a.test')).toHaveText('Invited');
    expect(await emulators.whitelistEntry(ORG_A.id, 'sa-added@a.test')).not.toBeNull();
    expect(await emulators.whitelistEntry(ORG_B.id, 'sa-added@a.test')).toBeNull();
    const imports = await emulators.audit(ORG_A.id, 'whitelist.import');
    expect(imports).toHaveLength(1);
    expect(imports[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });
  });

  test('WL-02 a student can neither open the whitelist nor import through the API', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    const before = await emulators.count(orgPath, 'whitelist');
    await signInAs(accounts.studentA);
    const api = await apiAs(accounts.studentA);

    const res = await api.post('/v1/whitelist/import', { rows: [{ email: 'self-added@a.test' }], commit: true });

    expect(res.status).toBe(403);
    expect(await emulators.count(orgPath, 'whitelist')).toBe(before);
    await page.goto('/admin/whitelist/');
    await studentHome(page).expectShown();
    await expect(new WhitelistPage(page).heading).toHaveCount(0);
  });

  test('A11Y-07 UX-04 A11Y-16 UX-12 UX-01 the whitelist page meets the shell rules with its primary action top-right', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    await expect(whitelist.row(invitedOfA(1).email)).toBeVisible();

    await expectShellRules(page, '/admin/whitelist/');
    await expectTopRightOfHeader(whitelist.shell.main, whitelist.heading, whitelist.upload);
  });

  test('UX-06 WL-02 the command palette action Upload whitelist opens the wizard', async ({ page, signInAs }) => {
    await signInAs(accounts.adminA);
    const shell = new Shell(page);

    await shell.openPalette();
    await shell.paletteChoose('upload', 'Upload whitelist');

    await expect(page).toHaveURL(/\/admin\/whitelist\//);
    const whitelist = new WhitelistPage(page);
    await expect(whitelist.wizard.dialog).toBeVisible();
    await expect(whitelist.wizard.sourceStep).toBeVisible();
  });
});
