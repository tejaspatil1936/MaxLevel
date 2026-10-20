import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { AUTHORING_NOW, BASIC_QUESTIONS, optionName, SEEDED_TEST } from '../fixtures/authoring';
import { startAttempt } from '../fixtures/exam';
import { EXAM_HEADING } from '../fixtures/exam-session';
import {
  MIN,
  prewarmTaskName,
  readRunbook,
  runbookSection,
  runPrewarmTask,
  setTheme,
  THEME_COLOURS,
  THEMES,
  type ThemeName,
} from '../fixtures/live';
import { answer, NOV_2_0930_IST, scoreText, sitAndSubmit, submit, timeAndStrikes } from '../fixtures/results';
import { accounts, departmentId, ORG_A, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ExamScreen } from '../pages/exam-screen';
import { LiveDashboard } from '../pages/live-pages';
import { StudentResultPage } from '../pages/results-pages';
import { TestEditorPage } from '../pages/test-editor';

// F-5.05 Screenshot tests, pre-warming and the exam-day runbook (UI-15; PERF-06 as far as the local queue shows it;
// REL-07 and A11Y-18 as static content). Contract: docs/testids/phase-5.md, "Screenshot tests", "Pre-warming" and
// "Static checks". Baselines are made once from the finished phase 5 build with --update-snapshots and reviewed by a
// person (docs/MANUAL_CHECKS.md).

const COMPUTER = { seriesEligibility: { departmentIds: [departmentId(ORG_A, 'Computer')] } };
const SHOT = { fullPage: true, animations: 'disabled', caret: 'hide' } as const;

/** The theme took effect on the page (so the screenshot is of that theme, not of a page that ignored it). */
async function expectTheme(page: Page, theme: ThemeName): Promise<void> {
  const colours = THEME_COLOURS[theme];
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), {
      message: `${theme} background`,
    })
    .toBe(colours.background);
  if (colours.text)
    expect(await page.evaluate(() => getComputedStyle(document.body).color), `${theme} text`).toBe(colours.text);
}

test.describe('F-5.05 screenshots of the exam screen @exam', () => {
  test('UI-15 the exam screen in light, dark and high contrast', async ({ page, signInAs, apiAs, testApi }) => {
    test.setTimeout(120_000);
    await testApi.clock.set(NOV_2_0930_IST);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    await signInAs(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const payload = await startAttempt(student, t.testId);
    await answer(student, testApi, payload, { 0: '20 m/s' });
    const exam = new ExamScreen(page);
    for (const theme of THEMES) {
      await setTheme(student, theme);
      await exam.gotoAttempt(payload.attempt.id, EXAM_HEADING);
      await expectTheme(page, theme);
      await expect(exam.option(optionName(BASIC_QUESTIONS[0]!, 0))).toBeChecked();
      await exam.expectSaved();
      await expect(page).toHaveScreenshot(`exam-${theme}.png`, { ...SHOT, mask: [exam.timer] });
    }
  });
});

test.describe('F-5.05 screenshots', () => {
  test('UI-15 the result page in light, dark and high contrast', async ({ page, signInAs, apiAs, testApi }) => {
    test.setTimeout(120_000);
    await testApi.clock.set(NOV_2_0930_IST);
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { resultRelease: 'immediate', resultDetail: 'full' },
    });
    await signInAs(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const attemptId = await sitAndSubmit(student, testApi, t.testId, { 0: '20 m/s', 1: '30' }, 12);
    const result = new StudentResultPage(page);
    for (const theme of THEMES) {
      await setTheme(student, theme);
      await result.goto(attemptId, EXAM_HEADING);
      await expectTheme(page, theme);
      await expect(result.inResult(scoreText(2, 4))).toBeVisible();
      await expect(result.inResult(timeAndStrikes(720, 0))).toBeVisible();
      await expect(result.review.getByRole('listitem')).toHaveCount(4);
      await expect(page).toHaveScreenshot(`result-${theme}.png`, SHOT);
    }
  });

  test('UI-15 the live view in light, dark and high contrast', async ({ page, signInAs, apiAs, testApi }) => {
    test.setTimeout(120_000);
    await testApi.clock.set(NOV_2_0930_IST);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const aarav = await apiAs(studentOfA(1));
    const a1 = await startAttempt(aarav, t.testId);
    await answer(aarav, testApi, a1, { 0: '20 m/s' });
    const vihaan = await apiAs(studentOfA(5));
    await submit(vihaan, (await startAttempt(vihaan, t.testId)).attempt.id);

    await signInAs(accounts.adminA);
    const admin = await apiAs(accounts.adminA);
    const live = new LiveDashboard(page);
    for (const theme of THEMES) {
      await setTheme(admin, theme);
      await live.goto(t.testId, EXAM_HEADING);
      await expectTheme(page, theme);
      await live.expectRow(studentOfA(1).name, { Status: 'In progress', Answered: '1 / 4' });
      await live.expectRow(studentOfA(5).name, { Status: 'Submitted' });
      await expect(live.rows).toHaveCount(5);
      if (theme === 'light') await expectNoSeriousA11yViolations(page);
      await expect(page).toHaveScreenshot(`live-${theme}.png`, { ...SHOT, mask: await live.clockCells() });
    }
  });

  test('UI-15 the test editor in light, dark and high contrast', async ({ page, signInAs, apiAs, testApi }) => {
    test.setTimeout(120_000);
    await testApi.clock.set(AUTHORING_NOW);
    const t = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'basic' });
    await signInAs(accounts.adminA);
    const admin = await apiAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    for (const theme of THEMES) {
      await setTheme(admin, theme);
      await editor.goto(t.testId, SEEDED_TEST.heading);
      await expectTheme(page, theme);
      await expect(editor.schedule(SEEDED_TEST.schedule)).toBeVisible();
      await expect(editor.tab('Questions')).toHaveAttribute('aria-selected', 'true');
      await expect(editor.panel('Questions').getByText(BASIC_QUESTIONS[0]!.prompt, { exact: true })).toBeVisible();
      await expect(page).toHaveScreenshot(`editor-${theme}.png`, SHOT);
    }
  });
});

test.describe('F-5.05 pre-warming and runbook', () => {
  test('PERF-06 Publish test queues the pre-warm task 30 minutes before the window, and the worker accepts it twice', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    request,
  }) => {
    await testApi.clock.set(AUTHORING_NOW);
    const t = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'basic' });
    const admin = await apiAs(accounts.adminA);
    const approved = await admin.post(`/v1/tests/${t.testId}/approve`, {});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(t.testId, SEEDED_TEST.heading);
    await editor.publishTest();

    const name = prewarmTaskName(ORG_A.id, t.testId, SEEDED_TEST.windowStart);
    await expect
      .poll(async () => (await testApi.tasks.pending()).filter((k) => k.path === '/tasks/prewarm'), {
        message: 'one pre-warm task',
      })
      .toEqual([
        expect.objectContaining({ name, path: '/tasks/prewarm', scheduleTime: SEEDED_TEST.windowStart - 30 * MIN }),
      ]);

    const payload = { orgId: ORG_A.id, testId: t.testId, windowStart: SEEDED_TEST.windowStart };
    expect(await runPrewarmTask(request, payload)).toBe(200);
    expect(await runPrewarmTask(request, payload), 'idempotent (REL-04)').toBe(200);
  });

  test('REL-07 A11Y-18 the exam-day runbook covers pre-warming, monitoring, the extra-time policy, contacts and the real-time exception', async () => {
    const text = await readRunbook();
    expect(text, 'docs/runbooks/exam-day.md exists').not.toBeNull();
    const section = (h: string) => {
      const body = runbookSection(text!, h);
      expect(body, `section ## ${h}`).not.toBeNull();
      return body!;
    };
    expect(section('Pre-warming')).toMatch(/30 minutes/);
    const monitoring = section('Monitoring');
    expect(monitoring).toMatch(/dashboard/i);
    for (const alert of [/5xx/i, /p95/i, /auto-submit/i, /worker/i]) expect(monitoring).toMatch(alert);
    const policy = section('Extra-time policy for outages');
    expect(policy).toMatch(/extra time/i);
    expect(policy).toMatch(/reason/i);
    expect(section('Contacts').trim().length, 'contacts listed').toBeGreaterThan(0);
    const timing = section('Timing and accessibility');
    for (const words of [/real-time/i, /WCAG/, /extra time/i, /accommodation/i]) expect(timing).toMatch(words);
  });
});
