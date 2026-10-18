import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { EXAM_HEADING } from '../fixtures/exam-session';
import { FIX_LINES, istTime, markingText, START_BLOCKED, storedAttempt, STRIKE_REASONS } from '../fixtures/exam';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ExamScreen } from '../pages/exam-screen';
import { ALL_CHECKS, BASIC_CHECKS, CAMERA_CHECKS, PreflightPage, RulesPage } from '../pages/exam-flow';
import { pathPattern } from '../pages/paths';
import { StudentTestPage, TestNotAvailable } from '../pages/student-pages';
import { count } from '../pages/ui';

// F-3.04 Preflight and rules screens (EX-01, EX-02, PERF-05, US-ST-04). Contract: docs/testids/phase-3.md,
// "Preflight" and "Rules".

const MEDIAPIPE = /^http:\/\/localhost:3000\/mediapipe\/.+\.(wasm|tflite)$/;

test.describe('F-3.04 preflight @lockdown', () => {
  test('EX-01 US-ST-04 preflight shows every check passing with its detail, fullscreen, camera and face detection included', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { fullscreenRequired: true, cameraRequired: true },
    });
    await signInAs(accounts.studentA);
    const testPage = new StudentTestPage(page);
    await testPage.goto(t.testId, EXAM_HEADING);

    await testPage.checkDevice.click();

    const preflight = new PreflightPage(page);
    await expect(page).toHaveURL(pathPattern('/exam/preflight/'));
    await expect(preflight.heading).toBeVisible();
    const items = preflight.checks.getByRole('listitem');
    await expect(items).toHaveCount(ALL_CHECKS.length);
    for (const [i, name] of ALL_CHECKS.entries()) {
      await expect(items.nth(i), `check ${i + 1}`).toHaveText(new RegExp(`^\\s*${name}\\b`));
      await preflight.expectCheck(name, 'Passed');
      await expect(preflight.check(name)).not.toContainText(FIX_LINES[name]);
    }
    await expect(preflight.check('Screen width')).toContainText(`${count(1024)} px wide`);
    await expect(preflight.check('Connection')).toContainText(/Round trip \d+ ms/);
    await expect(preflight.check('Clock')).toContainText(/Clock offset \d+ s/);
    await expect(preflight.continueToRules).toBeEnabled();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('F-3.04 preflight and rules @exam', () => {
  test('EX-01 a failing check shows its fix line and keeps the student from the rules until it passes', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    await signInAs(accounts.studentA);
    await page.setViewportSize({ width: 900, height: 768 });
    const preflight = new PreflightPage(page);

    await preflight.goto(t.testId);

    await preflight.expectCheck('Screen width', 'Failed');
    await expect(preflight.check('Screen width')).toContainText(FIX_LINES['Screen width']);
    for (const name of ['Connection', 'Clock', 'Browser'] as const) await preflight.expectCheck(name, 'Passed');
    await expect(preflight.continueToRules).toBeDisabled();

    await page.setViewportSize({ width: 1024, height: 768 });
    await preflight.checkAgain.click();
    await preflight.expectCheck('Screen width', 'Passed');
    await expect(preflight.check('Screen width')).not.toContainText(FIX_LINES['Screen width']);
    await expect(preflight.continueToRules).toBeEnabled();
  });

  test('EX-02 the rules show duration, deadline, strikes, marking, sections and the privacy note, and Start needs the agreement', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      questions: 'sectioned',
      sectionDraws: { Quant: 3, Verbal: 2 },
      overrides: { marking: { marks: 1, negativeMarks: 0.25, preset: 'p1_m025' }, maxStrikes: 4 },
    });
    await signInAs(accounts.studentA);
    const preflight = new PreflightPage(page);
    await preflight.goto(t.testId);
    const rules = await preflight.passAndContinue(BASIC_CHECKS);

    for (const line of [
      'Duration: 60 minutes',
      `Deadline: ${istTime(t.window.end)} IST`,
      'Maximum strikes: 4',
      `Marking: ${markingText(1, 0.25)}`,
      'Sections: Quant (3 questions), Verbal (2 questions)',
    ])
      await expect(rules.rule(line), line).toHaveCount(1);
    await expect(rules.privacyNote).toBeVisible();
    await expect(rules.agreement).not.toBeChecked();
    await rules.expectStartDisabled(START_BLOCKED.agreement);
    await expectNoSeriousA11yViolations(page);
    const before = await testApi.clock.now();

    const attemptId = await rules.agreeAndStart();

    const exam = new ExamScreen(page);
    await expect(exam.question(1, 5)).toBeVisible();
    await expect(exam.currentSection).toHaveText('Quant');
    const stored = await storedAttempt(emulators, ORG_A.id, attemptId);
    expect(stored).toMatchObject({
      testId: t.testId,
      studentId: 'stu-org-a-01',
      status: 'in_progress',
      deadlineAt: t.window.end,
    });
    expect(Number(stored.startedAt)).toBeGreaterThanOrEqual(before);
  });

  test('EX-02 without passed device checks Start stays disabled, and other orgs and staff are turned away', async ({
    page,
    signInAs,
    testApi,
    emulators,
    newSession,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    const other = await testApi.seedExamTest({ orgId: ORG_B.id, title: 'COEP aptitude' });
    await signInAs(accounts.studentA);
    const rules = new RulesPage(page);

    await rules.goto(t.testId);

    await rules.expectStartDisabled(START_BLOCKED.checks);
    await expect(rules.checkDevice).toHaveAttribute('href', new RegExp(`/exam/preflight/\\?test=${t.testId}$`));
    await rules.agreement.check();
    await rules.expectStartDisabled(START_BLOCKED.checks);
    expect(await emulators.count(`organizations/${ORG_A.id}`, 'attempts'), 'no attempt stored').toBe(0);

    await page.goto(PreflightPage.url(other.testId));
    await new TestNotAvailable(page).expectShown();
    await page.goto(RulesPage.url(other.testId));
    await new TestNotAvailable(page).expectShown();

    const admin = await newSession(accounts.adminA);
    await admin.goto(PreflightPage.url(t.testId));
    await expect(admin).toHaveURL(pathPattern('/admin/'));
  });

  test('PERF-05 the face model and WASM load during preflight with immutable caching, and the exam screen fetches none of them again', async ({
    page,
    signInAs,
    testApi,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { cameraRequired: true } });
    await signInAs(accounts.studentA);
    let phase: 'preflight' | 'exam' = 'preflight';
    const loaded: Array<{ url: string; phase: string; cacheControl: string }> = [];
    page.on('response', (res) => {
      if (/\/mediapipe\//.test(res.url()))
        loaded.push({ url: res.url(), phase, cacheControl: res.headers()['cache-control'] ?? '' });
    });
    const preflight = new PreflightPage(page);
    await preflight.goto(t.testId);

    const rules = await preflight.passAndContinue(CAMERA_CHECKS);

    const during = loaded.filter((l) => l.phase === 'preflight');
    expect(
      during.some((l) => /\/mediapipe\/models\/blaze_face_short_range\.tflite$/.test(l.url)),
      'model loaded',
    ).toBe(true);
    expect(
      during.some((l) => /\/mediapipe\/wasm\/.+\.wasm$/.test(l.url)),
      'WASM loaded',
    ).toBe(true);
    for (const l of during.filter((x) => MEDIAPIPE.test(x.url)))
      expect(l.cacheControl, `Cache-Control of ${l.url}`).toContain('immutable');
    phase = 'exam';

    await rules.agreeAndStart();

    // Face detection is running on the exam screen: the camera shows no face, so the grace period ends in a strike.
    const exam = new ExamScreen(page);
    await expect(exam.warnings).toContainText(STRIKE_REASONS.no_face, { timeout: 20_000 });
    expect(
      loaded.filter((l) => l.phase === 'exam').map((l) => l.url),
      'MediaPipe requests after preflight',
    ).toEqual([]);
  });
});
