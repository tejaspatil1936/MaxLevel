import type { Locator, Page } from '@playwright/test';
import { nonInstantMotion } from '../fixtures/motion';
import { holdAppScripts, waitForStyledDocument } from '../fixtures/network';
import { accounts, ORG_A, seededStudent } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import {
  AccessibilityPanel,
  appearance,
  readingRuler,
  ROOT_FONT_SIZE,
  SHEET,
  type TextSize,
} from '../pages/accessibility-panel';
import { studentHome } from '../pages/role-home';
import { Shell, StudentShell } from '../pages/shell';

// F-1.13 Accessibility panel and preferences (A11Y-01, A11Y-02, US-ST-10).
// Contract: docs/testids/phase-1.md, "Accessibility panel".

async function expectEverySetting(panel: AccessibilityPanel): Promise<void> {
  for (const size of ['100%', '115%', '130%', '150%']) await expect(panel.option(panel.textSize, size)).toBeVisible();
  for (const theme of ['Light', 'Dark', 'Follow system']) await expect(panel.option(panel.theme, theme)).toBeVisible();
  for (const motion of ['On', 'Off', 'Follow system'])
    await expect(panel.option(panel.reduceMotion, motion)).toBeVisible();
  for (const sw of [panel.highContrast, panel.increasedSpacing, panel.readingRuler]) await expect(sw).toBeVisible();
}

async function openAndCheck(page: Page, opener: Locator): Promise<void> {
  const panel = new AccessibilityPanel(page);
  await panel.open(opener);
  await expectEverySetting(panel);
  await panel.close.click();
  await expect(panel.dialog).toBeHidden();
  await expect(opener, 'focus returns to the opener').toBeFocused();
}

test.describe('F-1.13 accessibility panel and preferences', () => {
  test('A11Y-01 the panel opens from the top bar of student, admin and platform pages and offers every setting', async ({
    page,
    signInAs,
    newSession,
  }) => {
    await signInAs(accounts.studentA);
    await openAndCheck(page, new StudentShell(page).accessibilityButton);

    const adminPage = await newSession(accounts.adminA);
    await openAndCheck(adminPage, new Shell(adminPage).accessibilityButton);

    const superPage = await newSession(accounts.superAdmin);
    await openAndCheck(superPage, new Shell(superPage).accessibilityButton);
  });

  test('A11Y-01 A11Y-02 US-ST-10 each setting applies at once and is saved to the account', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
    await signInAs(accounts.studentA);
    const panel = new AccessibilityPanel(page);
    await panel.open(new StudentShell(page).accessibilityButton);
    expect((await appearance(page)).rootFontSize).toBe(ROOT_FONT_SIZE['100%']);

    await panel.choose(panel.textSize, '130%');
    expect((await appearance(page)).rootFontSize).toBe(ROOT_FONT_SIZE['130%']);

    await panel.choose(panel.theme, 'Dark');
    expect((await appearance(page)).rootBackground).toBe(SHEET.dark);

    await panel.toggle(panel.increasedSpacing);
    const spaced = await appearance(page);
    expect(spaced.letterSpacing, 'letter spacing').toBeGreaterThanOrEqual(0.12 * spaced.bodyFontSize - 0.01);
    expect(spaced.wordSpacing, 'word spacing').toBeGreaterThanOrEqual(0.16 * spaced.bodyFontSize - 0.01);
    expect(spaced.lineHeight, 'line height').toBeGreaterThanOrEqual(1.5 * spaced.bodyFontSize - 0.01);

    await panel.toggle(panel.readingRuler);
    await expect(readingRuler(page)).toBeVisible();

    await panel.choose(panel.reduceMotion, 'On');
    expect(await nonInstantMotion(page), 'motion with Reduce motion on').toEqual([]);

    await panel.toggle(panel.highContrast);
    const contrast = await appearance(page);
    expect(contrast.rootBackground).toBe('rgb(255, 255, 255)');
    expect(contrast.bodyColor).toBe('rgb(0, 0, 0)');

    const expected = {
      textSize: 130,
      theme: 'dark',
      highContrast: true,
      reduceMotion: 'on',
      increasedSpacing: true,
      readingRuler: true,
    };
    const me = await (await apiAs(accounts.studentA)).get<{ preferences?: Record<string, unknown> }>('/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.preferences).toMatchObject(expected);
    const stored = await emulators.doc(`organizations/${ORG_A.id}/students/${seededStudent(ORG_A, 1).id}`);
    expect(stored!.data.preferences).toMatchObject(expected);
  });

  test("A11Y-02 US-ST-10 saved text size and theme apply before the app's JavaScript runs after a reload", async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.studentA);
    const panel = new AccessibilityPanel(page);
    await panel.open(new StudentShell(page).accessibilityButton);
    await panel.choose(panel.textSize, '130%');
    await panel.choose(panel.theme, 'Dark');
    await panel.close.click();

    const scripts = await holdAppScripts(page);
    await page.reload({ waitUntil: 'commit' });
    await waitForStyledDocument(page);

    const early = await appearance(page);
    expect(scripts.count(), 'app scripts still waiting').toBeGreaterThan(0);
    expect(early.rootFontSize).toBe(ROOT_FONT_SIZE['130%']);
    expect(early.rootBackground).toBe(SHEET.dark);

    await scripts.release();
    await studentHome(page).expectShown();
    expect((await appearance(page)).rootFontSize).toBe(ROOT_FONT_SIZE['130%']);
  });

  test('A11Y-02 US-ST-10 preferences follow the account to a new browser', async ({ page, signInAs, newSession }) => {
    await signInAs(accounts.studentA);
    const panel = new AccessibilityPanel(page);
    await panel.open(new StudentShell(page).accessibilityButton);
    const size: TextSize = '150%';
    await panel.choose(panel.textSize, size);
    await panel.choose(panel.theme, 'Dark');

    const other = await newSession(accounts.studentA);

    await expect(studentHome(other).heading).toBeVisible();
    const look = await appearance(other);
    expect(look.rootFontSize).toBe(ROOT_FONT_SIZE[size]);
    expect(look.rootBackground).toBe(SHEET.dark);
  });

  test('A11Y-01 Follow system makes the theme follow the device setting', async ({ page, signInAs }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await signInAs(accounts.studentA);
    const panel = new AccessibilityPanel(page);
    await panel.open(new StudentShell(page).accessibilityButton);

    await panel.choose(panel.theme, 'Light');
    expect((await appearance(page)).rootBackground).toBe(SHEET.light);
    await panel.choose(panel.theme, 'Follow system');
    expect((await appearance(page)).rootBackground).toBe(SHEET.dark);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => (await appearance(page)).rootBackground).toBe(SHEET.light);
  });

  test("A11Y-02 an admin's preferences are saved to the account too", async ({ page, signInAs, apiAs }) => {
    await signInAs(accounts.adminA);
    const panel = new AccessibilityPanel(page);
    await panel.open(new Shell(page).accessibilityButton);

    await panel.choose(panel.theme, 'Dark');

    expect((await appearance(page)).rootBackground).toBe(SHEET.dark);
    const me = await (await apiAs(accounts.adminA)).get<{ preferences?: Record<string, unknown> }>('/v1/me');
    expect(me.body.preferences).toMatchObject({ theme: 'dark' });
  });

  test('A11Y-02 a preference outside the allowed values is refused and nothing changes', async ({
    apiAs,
    emulators,
  }) => {
    const api = await apiAs(accounts.studentA);

    const res = await api.put('/v1/me/preferences', {
      textSize: 120,
      theme: 'dark',
      highContrast: false,
      reduceMotion: 'system',
      increasedSpacing: false,
      readingRuler: false,
    });

    expect(res.status).toBe(400);
    const stored = await emulators.doc(`organizations/${ORG_A.id}/students/${seededStudent(ORG_A, 1).id}`);
    expect((stored!.data.preferences as Record<string, unknown> | undefined)?.textSize ?? 100).toBe(100);
    const me = await api.get<{ preferences?: Record<string, unknown> }>('/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.preferences?.theme ?? 'system').not.toBe('dark');
  });
});
