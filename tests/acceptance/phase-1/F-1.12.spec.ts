import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import type { ApiClient } from '../fixtures/api';
import { parseCsv } from '../fixtures/files';
import { accounts, departmentId, ORG_A, ORG_B, type SeedAccount } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { AUDIT_EMPTY, AuditPage } from '../pages/admin-pages';
import { adminHome } from '../pages/role-home';
import { expectShellRules, Shell } from '../pages/shell';
import { expectTopRightOfHeader } from '../fixtures/layout';
import { button, cellIn, downloadText, expectEmptyState } from '../pages/ui';

// F-1.12 Audit log screens (AUD-03, US-SA-06, US-AD-16). Contract: docs/testids/phase-1.md, "Audit log".

const day = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));

/** Audit entries in both orgs: admin1@a.test adds Aerospace, admin2@a.test renames IT, admin1@b.test adds Biotechnology. */
async function makeEntries(apiAs: (a: SeedAccount) => Promise<ApiClient>) {
  const a1 = await apiAs(accounts.adminA);
  const a2 = await apiAs(accounts.adminA2);
  const b1 = await apiAs(accounts.adminB);
  expect((await a1.post('/v1/departments', { name: 'Aerospace' })).status).toBeLessThan(300);
  expect((await a2.patch(`/v1/departments/${departmentId(ORG_A, 'IT')}`, { name: 'Info Tech' })).status).toBeLessThan(
    300,
  );
  expect((await b1.post('/v1/departments', { name: 'Biotechnology' })).status).toBeLessThan(300);
}

test.describe('F-1.12 audit log screens', () => {
  test('AUD-03 US-AD-16 an admin reads the org audit log with actor, time and change, and nothing from other orgs', async ({
    page,
    signInAs,
    apiAs,
  }) => {
    await signInAs(accounts.adminA);
    await makeEntries(apiAs);
    const audit = new AuditPage(page);

    await audit.goto();

    const created = audit.rowsWithAction('department.create');
    await expect(created).toHaveCount(1);
    await expect(await cellIn(audit.list, created, 'Actor')).toHaveText(accounts.adminA.email);
    await expect(await cellIn(audit.list, created, 'Change')).toContainText('Aerospace');
    await expect(await cellIn(audit.list, created, 'Time')).toHaveText(/\d{1,2}:\d{2}/);
    const renamed = audit.rowsWithAction('department.update');
    await expect(renamed).toHaveCount(1);
    await expect(await cellIn(audit.list, renamed, 'Actor')).toHaveText(accounts.adminA2.email);
    await expect(await cellIn(audit.list, renamed, 'Target')).toContainText(departmentId(ORG_A, 'IT'));
    const change = await cellIn(audit.list, renamed, 'Change');
    await expect(change).toContainText('IT');
    await expect(change).toContainText('Info Tech');
    await expect(audit.list).not.toContainText('Biotechnology');
    await expect(audit.list).not.toContainText(accounts.adminB.email);
    await expectNoSeriousA11yViolations(page);
  });

  test('AUD-03 the org log filters by actor, action, target and date, and an empty result offers to clear', async ({
    page,
    signInAs,
    apiAs,
  }) => {
    await signInAs(accounts.adminA);
    // Day boundaries are fixed before the entries are made, so a test running across IST midnight stays coherent.
    const today = day(0);
    const tomorrow = day(1);
    await makeEntries(apiAs);
    const audit = new AuditPage(page);
    await audit.goto();
    await expect(audit.rowsWithAction('department.create')).toHaveCount(1);
    await expect(audit.rowsWithAction('department.update')).toHaveCount(1);

    await audit.filter({ actor: accounts.adminA2.email });
    await expect(audit.rowsWithAction('department.update')).toHaveCount(1);
    await expect(audit.rowsWithAction('department.create')).toHaveCount(0);
    await expect(audit.list).not.toContainText(accounts.adminA.email);

    await audit.filter({ actor: '', action: 'department.create' });
    await expect(audit.rows).toHaveCount(1);
    await expect(audit.rows.first()).toContainText('Aerospace');

    await audit.filter({ action: '', target: departmentId(ORG_A, 'IT') });
    await expect(audit.rows).toHaveCount(1);
    await expect(audit.rowsWithAction('department.update')).toHaveCount(1);

    await audit.filter({ target: '', from: today, to: today });
    await expect(audit.rowsWithAction('department.create')).toHaveCount(1);
    await expect(audit.rowsWithAction('department.update')).toHaveCount(1);

    await audit.filter({ from: tomorrow, to: tomorrow });
    await expectEmptyState(audit.shell.main, AUDIT_EMPTY.sentence, AUDIT_EMPTY.action);
    await button(audit.shell.main, AUDIT_EMPTY.action).click();
    await expect(audit.rowsWithAction('department.create')).toHaveCount(1);
    await expect(audit.rowsWithAction('department.update')).toHaveCount(1);
  });

  test('AUD-03 an admin exports the filtered org log as CSV', async ({ page, signInAs, apiAs }) => {
    await signInAs(accounts.adminA);
    await makeEntries(apiAs);
    const audit = new AuditPage(page);
    await audit.goto();
    await audit.filter({ action: 'department.create' });
    await expect(audit.rows).toHaveCount(1);

    const downloading = page.waitForEvent('download');
    await audit.exportCsv.click();
    const download = await downloading;

    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const rows = parseCsv(await downloadText(download));
    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    for (const col of ['time', 'actor', 'action', 'target', 'before', 'after']) expect(header).toContain(col);
    expect(rows.slice(1)).toHaveLength(1);
    const line = rows[1]!;
    expect(line[header.indexOf('actor')]).toContain(accounts.adminA.email);
    expect(line[header.indexOf('action')]).toBe('department.create');
    expect(line.join(',')).toContain('Aerospace');
    expect(rows.flat().join(',')).not.toContain('Biotechnology');
  });

  test("AUD-03 US-SA-06 a super admin reads every organization's log and filters by organization, actor, action and date", async ({
    page,
    signInAs,
    apiAs,
  }) => {
    await signInAs(accounts.superAdmin);
    // Day boundaries are fixed before the entries are made, so a test running across IST midnight stays coherent.
    const tomorrow = day(1);
    await makeEntries(apiAs);
    const audit = new AuditPage(page, '/platform/audit/');
    await audit.goto();
    await expect(audit.list).toContainText('Aerospace');
    await expect(audit.list).toContainText('Biotechnology');
    const bio = audit.rowWith('Biotechnology');
    await expect(await cellIn(audit.list, bio, 'Organization')).toHaveText(ORG_B.name);

    await audit.filter({ organization: ORG_B.name });
    await expect(audit.list).toContainText('Biotechnology');
    await expect(audit.list).not.toContainText('Aerospace');

    await audit.filter({
      organization: 'All organizations',
      actor: accounts.adminA.email,
      action: 'department.create',
    });
    await expect(audit.rows).toHaveCount(1);
    await expect(audit.rows.first()).toContainText('Aerospace');
    await expect(await cellIn(audit.list, audit.rows.first(), 'Organization')).toHaveText(ORG_A.name);

    await audit.filter({ actor: '', action: '', from: tomorrow, to: tomorrow });
    await expectEmptyState(audit.shell.main, AUDIT_EMPTY.sentence, AUDIT_EMPTY.action);

    await button(audit.shell.main, AUDIT_EMPTY.action).click();
    const downloading = page.waitForEvent('download');
    await audit.exportCsv.click();
    const rows = parseCsv(await downloadText(await downloading));
    expect(rows[0]!.map((h) => h.trim().toLowerCase())).toContain('organization');
    expect(rows.flat().join(',')).toContain('Biotechnology');
    expect(rows.flat().join(',')).toContain('Aerospace');
  });

  test("AUD-03 ORG-12 ORG-14 a super admin in org A's workspace sees only the log of org A", async ({
    page,
    signInAs,
    apiAs,
  }) => {
    await signInAs(accounts.superAdmin);
    await makeEntries(apiAs);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);

    await shell.goToAdmin('Audit log');

    const audit = new AuditPage(page);
    await expect(audit.rowsWithAction('department.create')).toHaveCount(1);
    await expect(audit.list).toContainText('Aerospace');
    await expect(audit.list).not.toContainText('Biotechnology');
    await expect(audit.organization).toHaveCount(0);
  });

  test('AUD-03 admins cannot read the cross-organization log, and students cannot read any log', async ({
    page,
    signInAs,
    apiAs,
  }) => {
    await signInAs(accounts.adminA);
    const admin = await apiAs(accounts.adminA);
    const student = await apiAs(accounts.studentA);

    expect((await admin.get('/v1/platform/audit')).status).toBe(403);
    expect((await student.get('/v1/audit')).status).toBe(403);
    await page.goto('/platform/audit/');
    await adminHome(page).expectShown();
  });

  test('A11Y-07 UX-04 A11Y-16 UX-12 UX-01 both audit pages meet the shell rules with Export CSV top-right', async ({
    page,
    signInAs,
    newSession,
  }) => {
    await signInAs(accounts.adminA);
    const audit = new AuditPage(page);
    await audit.goto();
    await expect(audit.list).toBeVisible();
    await expectShellRules(page, '/admin/audit/');
    await expectTopRightOfHeader(audit.shell.main, audit.heading, audit.exportCsv);

    const superPage = await newSession(accounts.superAdmin);
    const platformAudit = new AuditPage(superPage, '/platform/audit/');
    await platformAudit.goto();
    await expect(platformAudit.organization).toBeVisible();
    await expectShellRules(superPage, '/platform/audit/');
    await expectTopRightOfHeader(platformAudit.shell.main, platformAudit.heading, platformAudit.exportCsv);
  });
});
