import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import {
  blurWindowAndReturn,
  dispatchPrevented,
  installPreventionRecorder,
  leaveTabAndReturn,
  selectedText,
  wasPrevented,
} from '../fixtures/devices';
import {
  advanceExamTime,
  expectAttemptSoon,
  expectEventsSoon,
  strikeNumbersOf,
  listEvents,
  storedAttempt,
  storedEvents,
  STRIKE_REASONS,
  strikesLeftText,
  SUBMITTED,
  terminatedText,
} from '../fixtures/exam';
import { EXAM_HEADING, openExam } from '../fixtures/exam-session';
import { cssOf } from '../fixtures/layout';
import { apiRequest, holdApiRequests } from '../fixtures/network';
import { accounts, ORG_A } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ExamScreen } from '../pages/exam-screen';
import { PreflightPage, SubmittedPage } from '../pages/exam-flow';
import { StudentTestPage } from '../pages/student-pages';

// F-3.11 Browser lockdown and strike warnings (PR-04, PR-05, PR-06, PR-09, US-ST-06). Contract: docs/testids/phase-3.md,
// "Strike warnings and lockdown". Fullscreen changes are real (the @lockdown project runs a headed browser under xvfb);
// a tab switch is sent as the browser's own blur and visibilitychange events, because Playwright keeps every Chromium
// tab visible and focused (fixtures/devices.ts, leaveTabAndReturn).

const EVENTS_PATH = /\/v1\/attempts\/[^/]+\/events$/;

const isFullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement !== null);

test.describe('F-3.11 browser lockdown @lockdown', () => {
  test('PR-04 PR-09 US-ST-06 leaving fullscreen warns at once with the reason and count, and Return to fullscreen goes back in', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { fullscreenRequired: true } });
    await signInAs(accounts.studentA);
    const testPage = new StudentTestPage(page);
    await testPage.goto(t.testId, EXAM_HEADING);
    await testPage.checkDevice.click();
    const rules = await new PreflightPage(page).passAndContinue([
      'Screen width',
      'Fullscreen',
      'Connection',
      'Clock',
      'Browser',
    ]);
    const attemptId = await rules.agreeAndStart();
    await expect.poll(() => isFullscreen(page), { message: 'exam opened in fullscreen' }).toBe(true);
    const exam = new ExamScreen(page);
    const held = await holdApiRequests(page, apiRequest('POST', EVENTS_PATH));

    await page.evaluate(() => document.exitFullscreen());

    // The warning is on screen before the server has answered.
    await held.waitUntilHeld();
    await expect(exam.warnings).toBeVisible();
    await expect(exam.warnings).toContainText(STRIKE_REASONS.fullscreen_exit);
    held.release();
    const warning = exam.strikeWarning(1, 3);
    await expect(warning).toBeVisible();
    await expect(warning.getByText(STRIKE_REASONS.fullscreen_exit, { exact: true })).toBeVisible();
    await expect(warning.getByText(strikesLeftText(2), { exact: true })).toBeVisible();
    const back = warning.getByRole('button', { name: 'Return to fullscreen', exact: true });
    await expect(warning.getByRole('button')).toHaveCount(1);
    await expect(back).toBeFocused();
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(warning, 'Escape does not dismiss the warning').toBeVisible();

    await back.click();

    await expect(warning).toBeHidden();
    await expect.poll(() => isFullscreen(page), { message: 'back in fullscreen' }).toBe(true);
    await expect(exam.strikeTally(1, 3)).toBeVisible();
    await expectAttemptSoon(emulators, ORG_A.id, attemptId, (a) => a.strikesCount === 1, 'one strike stored');
    const events = await expectEventsSoon(
      emulators,
      ORG_A.id,
      attemptId,
      (evs) => evs.some((e) => e.data.strikeNumber === 1),
      'the strike event stored',
    );
    expect(events.filter((e) => e.data.strikeNumber === 1).map((e) => e.data.type)).toEqual(['fullscreen_exit']);
  });

  test('PR-05 PR-07 leaving the tab records one strike for the blur and the hidden page together', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const { exam, attemptId } = await openExam({ page, signInAs, apiAs, testApi });

    await leaveTabAndReturn(page);

    const warning = exam.strikeWarning(1, 3);
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(new RegExp(`${STRIKE_REASONS.tab_hidden}|${STRIKE_REASONS.window_blur}`));
    await expect(warning.getByText(strikesLeftText(2), { exact: true })).toBeVisible();
    await warning.getByRole('button', { name: 'I understand', exact: true }).click();
    await expect(warning).toBeHidden();
    await expect(exam.strikeTally(1, 3)).toBeVisible();
    const stored = await expectAttemptSoon(
      emulators,
      ORG_A.id,
      attemptId,
      (a) => a.strikesCount === 1,
      'one strike stored',
    );
    expect(stored.strikesCount).toBe(1);
    const events = await storedEvents(emulators, ORG_A.id, attemptId);
    const focusEvents = events.filter((e) => ['tab_hidden', 'window_blur'].includes(String(e.data.type)));
    expect(focusEvents.length, 'the switch was logged').toBeGreaterThanOrEqual(1);
    expect(
      events.filter((e) => e.data.strikeNumber !== undefined),
      'counted once',
    ).toHaveLength(1);
  });

  test('PR-05 the exam window losing focus, with the page still visible, records a strike for the lost focus', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const { exam, attemptId } = await openExam({ page, signInAs, apiAs, testApi });

    await blurWindowAndReturn(page);

    const warning = exam.strikeWarning(1, 3);
    await expect(warning).toBeVisible();
    await expect(warning.getByText(STRIKE_REASONS.window_blur, { exact: true })).toBeVisible();
    await expect(warning.getByText(strikesLeftText(2), { exact: true })).toBeVisible();
    await warning.getByRole('button', { name: 'I understand', exact: true }).click();
    await expect(warning).toBeHidden();
    await expect(exam.strikeTally(1, 3)).toBeVisible();
    const events = await expectEventsSoon(
      emulators,
      ORG_A.id,
      attemptId,
      (evs) => strikeNumbersOf(evs, 'window_blur').includes(1),
      'window_blur stored as strike 1',
    );
    expect(strikeNumbersOf(events, 'window_blur')).toEqual([1]);
    expect(strikeNumbersOf(events, 'tab_hidden'), 'the page never became hidden').toEqual([]);
  });

  test('PR-10 PR-09 the last strike ends the test and the student is told why', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    await page.clock.install();
    const { exam, attemptId } = await openExam({ page, signInAs, apiAs, testApi }, { overrides: { maxStrikes: 2 } });
    await leaveTabAndReturn(page);
    const warning = exam.strikeWarning(1, 2);
    await expect(warning.getByText(strikesLeftText(1), { exact: true })).toBeVisible();
    await warning.getByRole('button', { name: 'I understand', exact: true }).click();
    await expectAttemptSoon(emulators, ORG_A.id, attemptId, (a) => a.strikesCount === 1, 'first strike stored');
    await advanceExamTime(page, testApi, 5_000);

    await leaveTabAndReturn(page);

    const ended = new SubmittedPage(page);
    await expect(ended.heading(SUBMITTED.ended)).toBeVisible({ timeout: 20_000 });
    await ended.expectShown(attemptId, SUBMITTED.ended);
    await expect(ended.text(terminatedText(2))).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    expect(await storedAttempt(emulators, ORG_A.id, attemptId)).toMatchObject({
      status: 'terminated',
      terminationReason: 'max_strikes',
      strikesCount: 2,
    });
  });
});

test.describe('F-3.11 copy, print and developer tools @exam', () => {
  test('PR-06 copy, cut, paste, printing and selecting question text are blocked, and developer tools keys strike under Block and strike', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    await installPreventionRecorder(page);
    const { exam, attemptId } = await openExam({ page, signInAs, apiAs, testApi });
    const prompt = exam.promptText('A train 240 m long passes a pole in 12 seconds.');

    await prompt.click({ clickCount: 3 });
    expect(await selectedText(page), 'question text cannot be selected').toBe('');
    expect(await cssOf(prompt, 'user-select')).toBe('none');
    for (const type of ['copy', 'cut', 'paste'] as const)
      expect(await dispatchPrevented(prompt, type), `${type} prevented`).toBe(true);
    await prompt.click({ button: 'right' });
    expect(await wasPrevented(page, 'contextmenu'), 'context menu prevented').toBe(true);
    await page.keyboard.press('Control+p');
    expect(await wasPrevented(page, 'keydown', 'p'), 'Ctrl+P prevented').toBe(true);
    await page.emulateMedia({ media: 'print' });
    await expect(prompt, 'nothing of the question prints').toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(prompt).toBeVisible();

    await page.keyboard.press('F12');

    expect(await wasPrevented(page, 'keydown', 'F12'), 'F12 prevented').toBe(true);
    const warning = exam.strikeWarning(1, 3);
    await expect(warning.getByText(STRIKE_REASONS.devtools, { exact: true })).toBeVisible();
    await warning.getByRole('button', { name: 'I understand', exact: true }).click();
    await expect(warning).toBeHidden();
    const events = await expectEventsSoon(
      emulators,
      ORG_A.id,
      attemptId,
      (evs) => strikeNumbersOf(evs, 'devtools').includes(1) && evs.some((e) => e.data.type === 'context_menu'),
      'devtools strike and context menu stored',
    );
    expect(strikeNumbersOf(events, 'devtools')).toEqual([1]);
    expect(
      events.map((e) => e.data.type),
      'context menu logged',
    ).toContain('context_menu');
  });

  test('PR-06 under Block only, developer tools keys are blocked and logged without a strike', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    await installPreventionRecorder(page);
    const { exam, attemptId } = await openExam(
      { page, signInAs, apiAs, testApi },
      { overrides: { devtoolsPolicy: 'block' } },
    );

    await page.keyboard.press('Control+Shift+I');

    expect(await wasPrevented(page, 'keydown', 'I'), 'Ctrl+Shift+I prevented').toBe(true);
    const admin = await apiAs(accounts.adminA);
    await expect
      .poll(async () => (await listEvents(admin, attemptId)).filter((e) => e.type === 'devtools').length, {
        message: 'devtools event logged',
      })
      .toBe(1);
    expect((await listEvents(admin, attemptId)).find((e) => e.type === 'devtools')?.strikeNumber).toBeUndefined();
    expect((await storedAttempt(emulators, ORG_A.id, attemptId)).strikesCount).toBe(0);
    await expect(exam.warnings).toHaveCount(0);
    await expect(exam.strikeTally(0, 3)).toBeVisible();
  });
});
