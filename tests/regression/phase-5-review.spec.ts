import type { Page } from '@playwright/test';
import {
  expectEventsSoon,
  startAttempt,
  storedEvents,
  STRIKE_REASONS,
  strikeNumbersOf,
} from '../acceptance/fixtures/exam';
import { accounts, ORG_A } from '../acceptance/fixtures/seed';
import { expect, test } from '../acceptance/fixtures/test';
import type { TestApi } from '../acceptance/fixtures/test-api';
import type { SeedAccount } from '../acceptance/fixtures/seed';
import type { RoleHome } from '../acceptance/pages/role-home';
import type { ApiClient } from '../acceptance/fixtures/api';
import { ExamScreen } from '../acceptance/pages/exam-screen';

// Bugs found by the phase 5 review. Each test failed before its fix.

const isFullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement !== null);

/** The blocking overlay of PR-04 shown without a strike: the exam is open outside fullscreen. */
const fullscreenOverlay = (page: Page) =>
  page.getByRole('alertdialog', { name: 'This test runs in fullscreen', exact: true });

/** A fullscreen test opened straight on /exam/ (outside fullscreen), then put in fullscreen from the overlay. */
async function openInFullscreen(f: {
  page: Page;
  signInAs: (account: SeedAccount) => Promise<RoleHome>;
  apiAs: (account: SeedAccount) => Promise<ApiClient>;
  testApi: TestApi;
}) {
  const t = await f.testApi.seedExamTest({ orgId: ORG_A.id, overrides: { fullscreenRequired: true } });
  await f.signInAs(accounts.studentA);
  const payload = await startAttempt(await f.apiAs(accounts.studentA), t.testId);
  const attemptId = payload.attempt.id;
  const exam = new ExamScreen(f.page);
  await f.page.goto(ExamScreen.attemptUrl(attemptId));
  const overlay = fullscreenOverlay(f.page);
  await expect(overlay, 'opening the exam outside fullscreen blocks it').toBeVisible();
  await expect(exam.warnings, 'and is no strike').toHaveCount(1);
  await overlay.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await expect(overlay).toBeHidden();
  await expect.poll(() => isFullscreen(f.page), { message: 'in fullscreen' }).toBe(true);
  await expect(exam.strikeTally(0, 3)).toBeVisible();
  return { exam, attemptId, overlay };
}

test.describe('phase 5 review @lockdown', () => {
  test('PR-04 PR-05 leaving the exam in the same tab and coming back after more than 5 seconds is a strike, and fullscreen must be resumed', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const { exam, attemptId, overlay } = await openInFullscreen({ page, signInAs, apiAs, testApi });

    // A same-tab navigation (Alt+Home, Alt+Left, a link) blurs nothing; the page only unloads.
    await page.goto('about:blank');
    await testApi.clock.advance(6_000);
    await page.goto(ExamScreen.attemptUrl(attemptId));

    const warning = exam.strikeWarning(1, 3);
    await expect(warning).toBeVisible();
    await expect(warning.getByText(STRIKE_REASONS.tab_hidden, { exact: true })).toBeVisible();
    await warning.getByRole('button', { name: 'I understand', exact: true }).click();
    await expect(warning).toBeHidden();
    await expect(overlay, 'fullscreen ended with the page').toBeVisible();
    await overlay.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
    await expect(overlay).toBeHidden();
    await expect.poll(() => isFullscreen(page), { message: 'back in fullscreen' }).toBe(true);
    await expect(exam.strikeTally(1, 3)).toBeVisible();
    const events = await expectEventsSoon(
      emulators,
      ORG_A.id,
      attemptId,
      (evs) => strikeNumbersOf(evs, 'tab_hidden').includes(1),
      'the absence stored as strike 1',
    );
    expect(strikeNumbersOf(events, 'tab_hidden')).toEqual([1]);
  });

  test('PR-04 PR-05 a quick reload is no strike but brings back the fullscreen overlay', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const { exam, attemptId, overlay } = await openInFullscreen({ page, signInAs, apiAs, testApi });

    await page.reload();

    await expect(overlay).toBeVisible();
    await expect(exam.warnings, 'no strike warning').toHaveCount(1);
    await overlay.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
    await expect.poll(() => isFullscreen(page), { message: 'back in fullscreen' }).toBe(true);
    // A logged-only event sent after the reload: once it is stored, any report from the reload is stored too.
    await exam.promptText('A train 240 m long passes a pole in 12 seconds.').click({ button: 'right' });
    await expectEventsSoon(
      emulators,
      ORG_A.id,
      attemptId,
      (evs) => evs.some((e) => e.data.type === 'context_menu'),
      'context menu logged',
    );
    const events = await storedEvents(emulators, ORG_A.id, attemptId);
    expect(events.filter((e) => e.data.strikeNumber !== undefined).map((e) => e.data.type)).toEqual([]);
    await expect(exam.strikeTally(0, 3)).toBeVisible();
  });
});
