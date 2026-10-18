import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { parseCsv } from '../fixtures/files';
import { box, tabAndCheckFocusRing } from '../fixtures/layout';
import { accounts, INVITED01_PRN, invitedOfA, ORG_A, ORG_B, seededStudent } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { Shell } from '../pages/shell';
import { button, cancelButton, dataRows, downloadText, expectConfirmLayout, expectEmptyState } from '../pages/ui';
import { WHITELIST_NO_MATCH, WhitelistPage } from '../pages/whitelist-page';

// F-1.08 Whitelist list and bulk actions (WL-04, WL-05; API-05 is proved by integration tests).
// Contract: docs/testids/phase-1.md, "Whitelist".

const orgPath = `organizations/${ORG_A.id}`;

test.describe('F-1.08 whitelist list and bulk actions', () => {
  test('WL-04 WL-05 the whitelist shows invited, registered and disabled entries, and bulk disable works', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    const [two, three] = [invitedOfA(2).email, invitedOfA(3).email];
    await expect(await whitelist.statusOf(seededStudent(ORG_A, 1).email)).toHaveText('Registered');
    await expect(await whitelist.statusOf(invitedOfA(1).email)).toHaveText('Invited');
    await expect(whitelist.bulkBar).toHaveCount(0);

    await whitelist.select(two).check();
    await whitelist.select(three).check();

    await expect(whitelist.bulkBar).toBeVisible();
    await expect(whitelist.bulkBar).toContainText('2 selected');
    const bar = await box(whitelist.bulkBar);
    const viewport = page.viewportSize()!;
    expect(viewport.height - (bar.y + bar.height), 'bulk-action bar at the bottom').toBeLessThanOrEqual(32);
    await whitelist.bulkButton('Disable').click();

    await expect(await whitelist.statusOf(two)).toHaveText('Disabled');
    await expect(await whitelist.statusOf(three)).toHaveText('Disabled');
    expect((await emulators.whitelistEntry(ORG_A.id, two))!.data.status).toBe('disabled');
    expect((await emulators.whitelistEntry(ORG_A.id, three))!.data.status).toBe('disabled');
    expect(await emulators.audit(ORG_A.id, 'whitelist.disable'), 'whitelist.disable audit entry').not.toHaveLength(0);

    await whitelist.statusFilter.selectOption({ label: 'Disabled' });
    await expect(dataRows(whitelist.list)).toHaveCount(2);
    await expect(whitelist.row(two)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('WL-05 bulk enable restores entries, and export downloads the selected entries as CSV', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    const four = invitedOfA(4).email;
    await whitelist.select(four).check();
    await whitelist.bulkButton('Disable').click();
    await expect(await whitelist.statusOf(four)).toHaveText('Disabled');

    await whitelist.select(four).check();
    await whitelist.bulkButton('Enable').click();

    await expect(await whitelist.statusOf(four)).toHaveText('Invited');
    expect((await emulators.whitelistEntry(ORG_A.id, four))!.data.status).toBe('invited');
    expect(await emulators.audit(ORG_A.id, 'whitelist.enable'), 'whitelist.enable audit entry').not.toHaveLength(0);

    const registered = seededStudent(ORG_A, 1);
    await whitelist.select(invitedOfA(1).email).check();
    await whitelist.select(registered.email).check();
    const downloading = page.waitForEvent('download');
    await whitelist.bulkButton('Export').click();
    const download = await downloading;

    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const text = await downloadText(download);
    expect(text.split(/\r?\n/)[0]).toBe('email,prn,note,status');
    const rows = parseCsv(text).slice(1);
    expect(rows).toHaveLength(2);
    const invited = rows.find((r) => r[0] === invitedOfA(1).email);
    expect(invited?.[1]).toBe(INVITED01_PRN);
    expect(invited?.[3]).toMatch(/^invited$/i);
    const reg = rows.find((r) => r[0] === registered.email);
    expect(reg?.[3]).toMatch(/^registered$/i);
  });

  test("WL-05 UX-02 removing a registered student's entry disables the student and keeps the record", async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    const student = seededStudent(ORG_A, 3);

    await whitelist.select(student.email).check();
    await whitelist.bulkButton('Remove').click();
    const confirm = whitelist.removeDialog(1);
    await expect(confirm).toBeVisible();
    await expectConfirmLayout(confirm, 'Remove entries', true);
    await button(confirm, 'Remove entries').click();

    await expect(confirm).toBeHidden();
    await expect(whitelist.row(student.email)).toHaveCount(0);
    await expect(whitelist.row(seededStudent(ORG_A, 4).email)).toBeVisible();
    expect(await emulators.whitelistEntry(ORG_A.id, student.email)).toBeNull();
    const record = await emulators.doc(`${orgPath}/students/${student.id}`);
    expect(record, 'student record kept').not.toBeNull();
    expect(record!.data).toMatchObject({ status: 'disabled', prn: student.prn, name: student.name });
    expect(await emulators.audit(ORG_A.id, 'whitelist.remove'), 'whitelist.remove audit entry').not.toHaveLength(0);
  });

  test('WL-05 UX-02 A11Y-05 cancelling the remove dialog changes nothing and returns focus to Remove', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    const five = invitedOfA(5).email;

    await whitelist.select(five).check();
    await whitelist.bulkButton('Remove').click();
    const confirm = whitelist.removeDialog(1);
    await expect(confirm).toBeVisible();
    await cancelButton(confirm).click();

    await expect(confirm).toBeHidden();
    await expect(whitelist.bulkButton('Remove')).toBeFocused();
    await expect(whitelist.row(five)).toBeVisible();
    expect((await emulators.whitelistEntry(ORG_A.id, five))!.data.status).toBe('invited');
  });

  test('WL-04 UX-08 a search with no match says so in one sentence and offers to clear it', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();
    await whitelist.search.fill(INVITED01_PRN);
    await expect(dataRows(whitelist.list)).toHaveCount(1);
    await expect(whitelist.row(invitedOfA(1).email)).toBeVisible();

    await whitelist.search.fill('zzz-nobody');

    await expectEmptyState(whitelist.shell.main, WHITELIST_NO_MATCH.sentence, WHITELIST_NO_MATCH.action);
    await button(whitelist.shell.main, WHITELIST_NO_MATCH.action).click();
    await expect(whitelist.search).toHaveValue('');
    await expect(whitelist.row(invitedOfA(1).email)).toBeVisible();
  });

  test('ORG-05 an admin of org B gets 404 for bulk actions on org A entries, and nothing changes', async ({
    apiAs,
    emulators,
  }) => {
    const adminB = await apiAs(accounts.adminB);
    const target = invitedOfA(1).email;

    const disable = await adminB.post('/v1/whitelist/bulk', { action: 'disable', emails: [target] });
    const remove = await adminB.post('/v1/whitelist/bulk', { action: 'remove', emails: [target] });

    expect(disable.status).toBe(404);
    expect(remove.status).toBe(404);
    expect((await emulators.whitelistEntry(ORG_A.id, target))!.data.status).toBe('invited');
    expect(await emulators.audit(ORG_A.id, 'whitelist.disable')).toHaveLength(0);

    // Control: the same request by org A's own admin works, so the 404 above is about the tenant, not the route.
    const adminA = await apiAs(accounts.adminA);
    expect((await adminA.post('/v1/whitelist/bulk', { action: 'disable', emails: [target] })).status).toBe(200);
    expect((await emulators.whitelistEntry(ORG_A.id, target))!.data.status).toBe('disabled');
  });

  test('WL-05 ORG-12 ORG-14 a super admin disables an entry through the switcher, logged as the super admin', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);
    await shell.goToAdmin('Whitelist');
    const whitelist = new WhitelistPage(page);
    const target = invitedOfA(1).email;

    await whitelist.select(target).check();
    await whitelist.bulkButton('Disable').click();

    await expect(await whitelist.statusOf(target)).toHaveText('Disabled');
    expect((await emulators.whitelistEntry(ORG_A.id, target))!.data.status).toBe('disabled');
    const entries = await emulators.audit(ORG_A.id, 'whitelist.disable');
    expect(entries).not.toHaveLength(0);
    expect(entries[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });

    const superInA = (await apiAs(accounts.superAdmin)).inOrg(ORG_A.id);
    const enable = await superInA.post('/v1/whitelist/bulk', { action: 'enable', emails: [target] });
    expect(enable.status).toBe(200);
    expect((await emulators.whitelistEntry(ORG_A.id, target))!.data.status).toBe('invited');
  });

  test('A11Y-04 UX-05 with the bulk-action bar showing, the focused element is never covered', async ({
    page,
    signInAs,
  }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await signInAs(accounts.adminA);
    const whitelist = new WhitelistPage(page);
    await whitelist.goto();

    await whitelist.select(invitedOfA(1).email).check();
    await expect(whitelist.bulkBar).toBeVisible();

    expect(await tabAndCheckFocusRing(page, 45), 'focus ring with the bulk-action bar showing').toEqual([]);
  });

  test('ORG-12 ORG-14 the whitelist page shows only the entries of the organization the super admin works in', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_B.name);
    await shell.goToAdmin('Whitelist');
    const whitelist = new WhitelistPage(page);

    await expect(whitelist.row(seededStudent(ORG_B, 1).email)).toBeVisible();
    await expect(whitelist.row(invitedOfA(1).email)).toHaveCount(0);
    await expect(shell.workspaceNotice(ORG_B.name)).toBeVisible();
  });
});
