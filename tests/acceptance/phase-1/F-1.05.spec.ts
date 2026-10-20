import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { box, scrollsHorizontally, tabAndCheckFocusRing, tabUntilFocused, undersizedTargets } from '../fixtures/layout';
import { accounts, ORG_A } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { pathPattern } from '../pages/paths';
import { OrgDetailPage, OrganizationsPage } from '../pages/platform';
import { adminHome, studentHome } from '../pages/role-home';
import { ADMIN_LINKS, expectShellRules, NOT_INCLUDED, Shell, StudentShell } from '../pages/shell';

// F-1.05 Admin shell, navigation and command palette (UX-04, UX-06, UX-12, A11Y-03, A11Y-04, A11Y-07, A11Y-16), plus
// the locked sidebar entry of FF-03. Contract: docs/testids/phase-1.md, "Shared shell" and "Command palette and
// shortcuts". Each later admin screen checks the same shell rules in its own feature file.

test.describe('F-1.05 admin shell, navigation and command palette', () => {
  test('A11Y-07 UX-04 A11Y-16 UX-12 the admin overview has the shell landmarks, heading order, 44 px targets and reflows at 768 px', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.adminA);
    const shell = new Shell(page);
    for (const [name, path] of Object.entries(ADMIN_LINKS))
      await expect(shell.navLink(name), `sidebar link ${name}`).toHaveAttribute('href', new RegExp(`${path}$`));

    await expectShellRules(page, '/admin/');
    await expectNoSeriousA11yViolations(page);
  });

  test('A11Y-07 UX-04 A11Y-16 UX-12 platform pages have the shell landmarks, heading order, 44 px targets and reflow at 768 px', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await expect(shell.navLink('Organizations')).toHaveAttribute('href', /\/platform\/$/);
    await expect(shell.navLink('Audit log')).toHaveAttribute('href', /\/platform\/audit\/$/);
    await expect(new OrganizationsPage(page).list).toBeVisible();
    await expectShellRules(page, '/platform/');

    await new OrgDetailPage(page).goto(ORG_A.id, ORG_A.name);
    await expectShellRules(page, '/platform/org/');
  });

  test('A11Y-03 the skip link is the first tab stop and moves focus to the main content', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    const orgs = new OrganizationsPage(page);
    await expect(orgs.newOrganization).toBeVisible();

    await page.keyboard.press('Tab');

    await expect(shell.skipLink).toBeFocused();
    await expect(shell.skipLink).toBeVisible();
    const skip = await box(shell.skipLink);
    expect(Math.min(skip.width, skip.height), 'skip link target size when shown').toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Enter');
    expect(
      await shell.main.evaluate((m) => m === document.activeElement || m.contains(document.activeElement)),
      'focus moved to the main content',
    ).toBe(true);
    await page.keyboard.press('Tab');
    expect(
      await shell.main.evaluate((m) => m.contains(document.activeElement) && m !== document.activeElement),
      'the next Tab stays in the main content',
    ).toBe(true);
  });

  test('A11Y-03 A11Y-05 navigation and page actions work by keyboard in a logical order, and dialogs return focus', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    const orgs = new OrganizationsPage(page);

    await tabUntilFocused(page, shell.navLink('Organizations'));
    await tabUntilFocused(page, orgs.newOrganization);
    await page.keyboard.press('Enter');
    await expect(shell.heading('New organization')).toBeVisible();

    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);
    await tabUntilFocused(page, detail.editDetails);
    await page.keyboard.press('Enter');
    await expect(detail.editDialog()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail.editDialog()).toBeHidden();
    await expect(detail.editDetails).toBeFocused();
  });

  test('A11Y-04 the focus ring is a 2 px ballpoint outline with a 2 px offset and is never covered', async ({
    page,
    signInAs,
    newSession,
  }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await signInAs(accounts.adminA);
    expect(await tabAndCheckFocusRing(page, 20), 'focus ring on /admin/').toEqual([]);

    const superPage = await newSession(accounts.superAdmin);
    await superPage.setViewportSize({ width: 1280, height: 600 });
    await expect(new OrganizationsPage(superPage).list).toBeVisible();
    expect(await tabAndCheckFocusRing(superPage, 30), 'focus ring on /platform/').toEqual([]);
  });

  test('UX-04 A11Y-16 every clickable target on the student home and its shortcut list is at least 44 by 44 px', async ({
    page,
    signInAs,
  }) => {
    const home = await signInAs(accounts.studentA);
    await expect(home.banner).toBeVisible();
    expect(await undersizedTargets(page), 'small targets on /student/').toEqual([]);
    const student = new StudentShell(page);

    await page.keyboard.press('?');

    await expect(student.shortcuts).toBeVisible();
    expect(await undersizedTargets(page), 'small targets with the shortcut list open').toEqual([]);
  });

  test('UX-06 A11Y-05 Ctrl K opens the command palette, typing filters it, and Escape returns focus', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.adminA);
    const shell = new Shell(page);
    await tabUntilFocused(page, shell.navLink('Overview'));

    await shell.openPalette();
    await shell.paletteInput.fill('overv');
    await expect(shell.paletteOption('Overview')).toBeVisible();
    await expect(shell.paletteOption('Departments')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await expect(shell.palette).toBeHidden();
    await expect(shell.navLink('Overview')).toBeFocused();

    await page.keyboard.press('Meta+K');
    await expect(shell.palette).toBeVisible();
    await shell.paletteChoose('overview', 'Overview');
    await adminHome(page).expectShown();
  });

  test('UX-06 ? lists keyboard shortcuts on admin screens, but not while typing in a field', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.adminA);
    const shell = new Shell(page);

    await shell.openShortcuts();
    await expect(shell.shortcuts).toContainText('Ctrl K');
    await expect(shell.shortcuts).toContainText('Open the command palette');
    await expect(shell.shortcuts).toContainText('Show keyboard shortcuts');
    await page.keyboard.press('Escape');
    await expect(shell.shortcuts).toBeHidden();

    await shell.openPalette();
    await page.keyboard.press('?');
    await expect(shell.paletteInput).toHaveValue('?');
    await expect(shell.shortcuts).toHaveCount(0);
  });

  test('UX-06 students get the shortcut list but no command palette', async ({ page, signInAs }) => {
    await signInAs(accounts.studentA);
    const student = new StudentShell(page);
    const shell = new Shell(page);

    await page.keyboard.press('Control+K');
    await page.keyboard.press('?');

    await expect(student.shortcuts).toBeVisible();
    await expect(student.shortcuts).toContainText('Show keyboard shortcuts');
    await expect(shell.palette).toHaveCount(0);
  });

  test('UX-12 the admin sidebar shows text from 1,200 px and icons below, keeping every link named', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.adminA);
    const shell = new Shell(page);
    expect((await box(shell.nav)).width, 'sidebar width at 1,280 px').toBeGreaterThanOrEqual(160);

    for (const width of [1199, 1024, 768]) {
      await page.setViewportSize({ width, height: 800 });
      expect((await box(shell.nav)).width, `sidebar width at ${width} px`).toBeLessThanOrEqual(96);
      for (const name of Object.keys(ADMIN_LINKS))
        await expect(shell.navLink(name), `${name} at ${width} px`).toBeVisible();
      expect(await scrollsHorizontally(page), `horizontal page scroll at ${width} px`).toBe(false);
    }
    await shell.navLink('Overview').click();
    await expect(page).toHaveURL(pathPattern('/admin/'));
  });

  test('UX-12 the student home works at 360 px', async ({ page, signInAs }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signInAs(accounts.studentA);

    await expect(studentHome(page).heading).toBeVisible();
    await expect(studentHome(page).banner).toBeVisible();
    expect(await scrollsHorizontally(page), 'horizontal scroll on /student/ at 360 px').toBe(false);
    expect(await undersizedTargets(page), 'small targets on /student/ at 360 px').toEqual([]);

    await page.keyboard.press('?');
    const shortcuts = new StudentShell(page).shortcuts;
    await expect(shortcuts).toBeVisible();
    const dlg = await box(shortcuts);
    expect(dlg.x, 'shortcut list inside the 360 px viewport').toBeGreaterThanOrEqual(0);
    expect(dlg.x + dlg.width, 'shortcut list inside the 360 px viewport').toBeLessThanOrEqual(360);
    expect(await scrollsHorizontally(page), 'horizontal scroll with the shortcut list open').toBe(false);
  });

  test('FF-03 a disabled feature keeps its sidebar entry, marked as not included, until it is enabled', async ({
    page,
    signInAs,
    apiAs,
  }) => {
    await signInAs(accounts.adminA);
    const shell = new Shell(page);
    await expect(shell.navLink('Reports')).toBeVisible();
    await expect(shell.navLink('Reports')).toHaveAccessibleDescription(NOT_INCLUDED);
    await expect(shell.navLink('Students')).not.toHaveAccessibleDescription(NOT_INCLUDED);

    const superApi = await apiAs(accounts.superAdmin);
    const res = await superApi.put(`/v1/platform/orgs/${ORG_A.id}/entitlements`, {
      featureOverrides: { analytics_reports: true },
      limitOverrides: {},
    });
    expect(res.status).toBe(200);
    await page.reload();

    await expect(shell.navLink('Reports')).toBeVisible();
    await expect(shell.navLink('Reports')).not.toHaveAccessibleDescription(NOT_INCLUDED);
  });
});
