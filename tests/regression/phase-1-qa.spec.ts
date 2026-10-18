import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yViolations } from '../acceptance/fixtures/axe';
import { writeCsv } from '../acceptance/fixtures/files';
import { focusedStyle, focusRingProblems, tabUntilFocused } from '../acceptance/fixtures/layout';
import { apiRequest, holdApiRequests } from '../acceptance/fixtures/network';
import { accounts, ORG_A } from '../acceptance/fixtures/seed';
import { expect, test } from '../acceptance/fixtures/test';
import { AccessibilityPanel } from '../acceptance/pages/accessibility-panel';
import { OrganizationsPage } from '../acceptance/pages/platform';
import { StudentShell } from '../acceptance/pages/shell';
import { WhitelistPage } from '../acceptance/pages/whitelist-page';

// Bugs found by the phase 1 QA pass (docs/verification/phase-1.md). Each test failed before its fix.

test('A11Y-01 A11Y-15 the accessibility panel fits a 360 px phone at 150% text, and every control is reachable', async ({
  page,
  signInAs,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signInAs(accounts.studentA);
  const panel = new AccessibilityPanel(page);
  await panel.open(new StudentShell(page).accessibilityButton);
  await panel.choose(panel.textSize, '150%');
  const box = (await panel.dialog.boundingBox())!;
  expect(box.y, 'panel top on screen').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, 'panel bottom on screen').toBeLessThanOrEqual(740);
  await panel.close.scrollIntoViewIfNeeded();
  await expect(panel.close).toBeInViewport();
  await panel.close.click();
  await expect(panel.dialog).toBeHidden();
});

test('A11Y-03 the whitelist wizard preview passes axe, including scrollable regions', async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await signInAs(accounts.adminA);
  const whitelist = new WhitelistPage(page);
  await whitelist.goto();
  const file = await writeCsv(join(tmpdir(), `qa-preview-${Date.now()}.csv`), [
    ['Email address', 'PRN', 'Remarks'],
    ['a.very.long.student.email.address.for.testing@a.test', 'PRN-0000000001', 'A long note that keeps going'],
    ['second.long.email.address.example@a.test', 'PRN-0000000002', 'Another note'],
  ]);
  await whitelist.wizard.open(whitelist.upload);
  await whitelist.wizard.chooseFile(file);
  await expect(whitelist.wizard.preview).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test('A11Y-04 the highlighted item of a menu shows the ballpoint focus ring', async ({ page, signInAs }) => {
  await signInAs(accounts.studentA);
  const shell = new StudentShell(page);
  await tabUntilFocused(page, shell.accountMenu);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem').nth(1)).toBeFocused();
  expect(focusRingProblems(await focusedStyle(page))).toEqual([]);
});

test('A11Y-04 the sticky form bar never covers the focused field on the new organization form', async ({
  page,
  signInAs,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAs(accounts.superAdmin);
  const form = await new OrganizationsPage(page).startNewOrganization();
  for (const field of [form.name, form.slug, form.timezone, form.logo, form.departments]) {
    await tabUntilFocused(page, field);
    const style = await focusedStyle(page);
    expect(style.unobscured, `${style.description} is not covered`).toBe(true);
  }
});

test('WCAG 4.1.2 loading placeholders never carry a label without a role', async ({ page, signInAs }) => {
  await signInAs(accounts.superAdmin);
  const held = await holdApiRequests(page, apiRequest('GET', `/v1/platform/orgs/${ORG_A.id}`));
  await page.goto(`/platform/org/?id=${ORG_A.id}`);
  await held.waitUntilHeld();
  await expect(page.locator('[aria-busy="true"]').first()).toBeAttached();
  await expect(page.locator('div[aria-label]:not([role]), span[aria-label]:not([role])')).toHaveCount(0);
  held.release();
});
