import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { BASIC_QUESTIONS, optionName, SECTIONED_PROMPTS } from '../fixtures/authoring';
import { colourBlindShots } from '../fixtures/devices';
import { remainingPattern, SHORTCUTS, startAttempt, storedAnswers, storedAttempt, timerText } from '../fixtures/exam';
import { EXAM_HEADING, openExam } from '../fixtures/exam-session';
import { box, scrollsHorizontally } from '../fixtures/layout';
import { recordApiCalls } from '../fixtures/network';
import { accounts, ORG_A, studentOfA, studentOfB } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ExamScreen, LEGEND, type QuestionState } from '../pages/exam-screen';
import { pathPattern } from '../pages/paths';
import { StudentDashboard, StudentTestPage } from '../pages/student-pages';

// F-3.05 Exam screen, palette and navigation (EX-05, EX-07, EX-08, EX-09, UX-03, A11Y-08, A11Y-14, A11Y-15).
// Contract: docs/testids/phase-3.md, "Exam screen in attempt mode". The exam project is 1,024 px wide, so the palette
// is a drawer there.

const Q = (n: 1 | 2 | 3 | 4) => BASIC_QUESTIONS[n - 1]!;

/** Opens the palette drawer, checks each question's state there, and closes it again. */
async function expectPaletteStates(exam: ExamScreen, states: Record<number, QuestionState>): Promise<void> {
  await exam.openPalette();
  for (const [n, state] of Object.entries(states))
    await expect(exam.paletteState(Number(n), state), `palette: question ${n} ${state}`).toHaveCount(1);
  if (await exam.paletteToggle.isVisible()) {
    await exam.page.keyboard.press('Escape');
    await expect(exam.palette).toBeHidden();
  }
}

/** The timing track shows question n in this state. */
async function expectTrack(exam: ExamScreen, n: number, state: QuestionState): Promise<void> {
  await expect(exam.trackState(n, state), `track: question ${n} ${state}`).toHaveCount(1);
}

test.describe('F-3.05 exam screen @exam', () => {
  test('EX-07 EX-08 A11Y-08 the track and palette name every state while the student answers, marks, clears and jumps', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const { exam, attemptId, payload } = await openExam({ page, signInAs, apiAs, testApi });
    const ids = payload.questions.map((q) => q.id);

    await expect(exam.question(1, 4)).toBeVisible();
    await expectTrack(exam, 1, 'not answered');
    await expect(exam.trackButton(1)).toHaveAttribute('aria-current', /^(step|true)$/);
    for (const n of [2, 3, 4]) await expectTrack(exam, n, 'not visited');
    await expect(exam.questionTimer, 'no per-question timer without time limits').toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    await exam.choose(optionName(Q(1), 0));
    await expectTrack(exam, 1, 'answered');
    await page.keyboard.press('ArrowDown');
    await expect(exam.option(optionName(Q(1), 1)), 'arrow keys move the choice').toBeChecked();
    await page.keyboard.press('ArrowUp');
    await expect(exam.option(optionName(Q(1), 0))).toBeChecked();

    await exam.saveAndNext.click();
    await expect(exam.question(2, 4)).toBeVisible();
    await expect(exam.trackButton(2)).toHaveAttribute('aria-current', /^(step|true)$/);
    await expect(exam.markForReview).toHaveAttribute('aria-pressed', 'false');
    await exam.markForReview.click();
    await expect(exam.markForReview).toHaveAttribute('aria-pressed', 'true');
    await expectTrack(exam, 2, 'marked for review');

    await exam.saveAndNext.click();
    await exam.choose(optionName(Q(3), 1));
    await exam.markForReview.click();
    await expectTrack(exam, 3, 'answered, marked for review');
    await exam.clearAnswer.click();
    await expect(exam.options.getByRole('radio', { checked: true }), 'no option chosen after Clear answer').toHaveCount(
      0,
    );
    await expectTrack(exam, 3, 'marked for review');

    await exam.goToQuestion(4, 4);
    await expectTrack(exam, 4, 'not answered');
    await exam.openPalette();
    await exam.paletteButton(1).click();
    await expect(exam.question(1, 4)).toBeVisible();
    await expect(exam.option(optionName(Q(1), 0)), 'the answer is still there').toBeChecked();
    await expectPaletteStates(exam, {
      1: 'answered',
      2: 'marked for review',
      3: 'marked for review',
      4: 'not answered',
    });
    await exam.openPalette();
    await expect(exam.legend.getByRole('listitem')).toHaveText([...LEGEND]);

    await exam.expectSaved();
    const answers = await storedAnswers(emulators, ORG_A.id, attemptId);
    expect(answers[ids[0]!]).toMatchObject({ optionId: 'a' });
    expect(answers[ids[1]!]).toMatchObject({ markedForReview: true });
    expect(answers[ids[1]!]?.optionId ?? null).toBeNull();
    expect(answers[ids[2]!]).toMatchObject({ optionId: null, markedForReview: true });
  });

  test('EX-09 number and letter keys choose options, N and P move, M marks and ? lists the shortcuts', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const { exam, attemptId, payload } = await openExam({ page, signInAs, apiAs, testApi });

    await page.keyboard.press('2');
    await expect(exam.option(optionName(Q(1), 1))).toBeChecked();
    await page.keyboard.press('c');
    await expect(exam.option(optionName(Q(1), 2))).toBeChecked();
    await page.keyboard.press('n');
    await expect(exam.question(2, 4)).toBeVisible();
    await page.keyboard.press('p');
    await expect(exam.question(1, 4)).toBeVisible();
    await expect(exam.option(optionName(Q(1), 2))).toBeChecked();
    await page.keyboard.press('D');
    await expect(exam.option(optionName(Q(1), 3)), 'keys are case-insensitive').toBeChecked();
    await page.keyboard.press('m');
    await expect(exam.markForReview).toHaveAttribute('aria-pressed', 'true');

    await exam.openShortcuts();
    await expect(exam.shortcutItems()).toHaveText([...SHORTCUTS]);
    await page.keyboard.press('1');
    await expect(exam.option(optionName(Q(1), 3)), 'keys do nothing behind the dialog').toBeChecked();
    await page.keyboard.press('Escape');
    await expect(exam.shortcuts).toBeHidden();

    await exam.expectSaved();
    const answers = await storedAnswers(emulators, ORG_A.id, attemptId);
    expect(answers[payload.questions[0]!.id]).toMatchObject({ optionId: 'd', markedForReview: true });
  });

  test('EX-05 EX-04 reopening the exam after closing the tab resumes the same attempt with saved answers and the same deadline', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const { exam, attemptId, t, api } = await openExam({ page, signInAs, apiAs, testApi });
    await exam.choose(optionName(Q(1), 0));
    await exam.saveAndNext.click();
    await exam.choose(optionName(Q(2), 1));
    await exam.markForReview.click();
    await exam.expectSaved();
    const deadline = Number((await storedAttempt(emulators, ORG_A.id, attemptId)).deadlineAt);
    const context = page.context();

    await page.close();
    const reopened = await context.newPage();
    const testPage = new StudentTestPage(reopened);
    await testPage.goto(t.testId, EXAM_HEADING);
    await testPage.resume.click();

    await expect(reopened).toHaveURL(new RegExp(`/exam/\\?attempt=${attemptId}$`));
    const again = new ExamScreen(reopened);
    await again.expectAttemptOpen(EXAM_HEADING);
    await again.goToQuestion(1, 4);
    await expect(again.option(optionName(Q(1), 0))).toBeChecked();
    await again.goToQuestion(2, 4);
    await expect(again.option(optionName(Q(2), 1))).toBeChecked();
    await expect(again.markForReview).toHaveAttribute('aria-pressed', 'true');
    await expectTrack(again, 2, 'answered, marked for review');
    expect(Number((await storedAttempt(emulators, ORG_A.id, attemptId)).deadlineAt), 'deadline unchanged').toBe(
      deadline,
    );
    await expect(again.timer).toHaveText(remainingPattern(timerText, deadline - (await testApi.clock.now()), 20_000));
    expect((await startAttempt(api, t.testId)).attempt.id, 'starting again returns the same attempt').toBe(attemptId);
  });

  test('UX-03 Save and next is the largest button at the bottom right, and Submit test in the top bar only opens the summary', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const { exam, attemptId } = await openExam({ page, signInAs, apiAs, testApi });
    const viewport = page.viewportSize()!;

    const buttons = page.getByRole('button');
    let largest = { name: '', area: 0 };
    for (let i = 0; i < (await buttons.count()); i++) {
      const b = buttons.nth(i);
      if (!(await b.isVisible())) continue;
      const bb = await b.boundingBox();
      if (bb && bb.width * bb.height > largest.area)
        largest = { name: (await b.getAttribute('aria-label')) ?? (await b.innerText()), area: bb.width * bb.height };
    }
    const next = await box(exam.saveAndNext);
    expect(largest.area, `largest button is ${largest.name}`).toBeLessThanOrEqual(next.width * next.height);
    expect(viewport.width - (next.x + next.width), 'Save and next near the right edge').toBeLessThanOrEqual(80);
    expect(viewport.height - (next.y + next.height), 'Save and next near the bottom edge').toBeLessThanOrEqual(120);
    const submitButton = exam.banner.getByRole('button', { name: 'Submit test', exact: true });
    const submit = await box(submitButton);
    expect(submit.y + submit.height, 'Submit test in the top bar').toBeLessThanOrEqual(viewport.height / 4);
    expect(next.y - submit.y, 'Submit test far from Save and next').toBeGreaterThan(viewport.height / 2);

    const calls = recordApiCalls(page);
    const summary = await exam.openSummary();
    await expect(summary.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await summary.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(summary).toBeHidden();
    expect(
      calls().filter((c) => c.endsWith('/submit')),
      'no submit request',
    ).toEqual([]);
    expect((await storedAttempt(emulators, ORG_A.id, attemptId)).status).toBe('in_progress');
  });

  test('A11Y-15 below 1,280 px the palette is a drawer, from 1,280 px a rail, and student pages reflow at 320 px', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    const { exam, t } = await openExam({ page, signInAs, apiAs, testApi });

    await expect(exam.paletteToggle).toBeVisible();
    await expect(exam.paletteToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(exam.palette).toBeHidden();
    await exam.paletteToggle.click();
    await expect(exam.palette).toBeVisible();
    await expect(exam.paletteToggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(exam.palette).toBeHidden();
    await expect(exam.paletteToggle, 'focus returns to the toggle').toBeFocused();
    await exam.openPalette();
    await exam.paletteButton(3).click();
    await expect(exam.question(3, 4)).toBeVisible();
    await expect(exam.palette, 'choosing a question closes the drawer').toBeHidden();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(exam.palette).toBeVisible();
    await expect(exam.paletteToggle).toHaveCount(0);

    await page.setViewportSize({ width: 320, height: 720 });
    const dash = new StudentDashboard(page);
    await dash.goto();
    await expect(dash.link('Live now', EXAM_HEADING)).toBeVisible();
    expect(await scrollsHorizontally(page), 'dashboard scrolls sideways at 320 px').toBe(false);
    const testPage = new StudentTestPage(page);
    await testPage.goto(t.testId, EXAM_HEADING);
    await expect(testPage.resume).toBeVisible();
    expect(await scrollsHorizontally(page), 'test page scrolls sideways at 320 px').toBe(false);
  });

  test('A11Y-14 every palette state differs by shape or pattern, not colour alone, and sync and strikes carry words', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    const { exam } = await openExam({ page, signInAs, apiAs, testApi });
    await exam.expectSaved();
    await expect(exam.syncStatus.locator('svg'), 'sync status icon').not.toHaveCount(0);
    await expect(exam.strikeTally(0, 3)).toBeVisible();

    await exam.openPalette();
    await expect(exam.legend.getByRole('listitem')).toHaveText([...LEGEND]);
    await expect(exam.legendSamples).toHaveCount(LEGEND.length);
    const shots = await colourBlindShots(page, exam.legendSamples);

    for (let i = 0; i < shots.length; i++)
      for (let j = i + 1; j < shots.length; j++)
        expect(shots[i]!.equals(shots[j]!), `${LEGEND[i]} and ${LEGEND[j]} look the same without colour`).toBe(false);
  });

  test('EX-08 the student jumps between sections with the palette and the current section is named', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    const { exam } = await openExam({ page, signInAs, apiAs, testApi }, { questions: 'sectioned' });
    await expect(exam.question(1, 10)).toBeVisible();
    await expect(exam.currentSection).toHaveText('Quant');
    await expect(exam.promptText(SECTIONED_PROMPTS.Quant[0])).toBeVisible();

    await exam.openPalette();
    await expect(exam.paletteSection('Quant').getByRole('button')).toHaveCount(6);
    await expect(exam.paletteSection('Verbal').getByRole('button')).toHaveCount(4);
    await exam
      .paletteSection('Verbal')
      .getByRole('button', { name: /^Question 7, / })
      .click();

    await expect(exam.question(7, 10)).toBeVisible();
    await expect(exam.currentSection).toHaveText('Verbal');
    await expect(exam.promptText(SECTIONED_PROMPTS.Verbal[0])).toBeVisible();
    await exam.previous.click();
    await expect(exam.question(6, 10)).toBeVisible();
    await expect(exam.currentSection).toHaveText('Quant');
    await expect(exam.promptText(SECTIONED_PROMPTS.Quant[5])).toBeVisible();
  });

  test('EX-05 an attempt that is not the student own shows not found, and staff are sent to their workspace', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    newSession,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    const owner = await apiAs(accounts.studentA);
    const { attempt } = await startAttempt(owner, t.testId);
    await signInAs(studentOfA(2));

    await page.goto(ExamScreen.attemptUrl(attempt.id));

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Attempt not found', exact: true })).toBeVisible();
    await expect(main.getByText("This attempt doesn't exist or isn't yours.", { exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Back to your tests', exact: true })).toHaveAttribute(
      'href',
      /\/student\/?$/,
    );
    await expect(main).not.toContainText(BASIC_QUESTIONS[0]!.prompt);
    expect((await (await apiAs(studentOfA(2))).get(`/v1/attempts/${attempt.id}`)).status).toBe(404);
    expect((await (await apiAs(studentOfB(1))).get(`/v1/attempts/${attempt.id}`)).status).toBe(404);
    expect((await (await apiAs(accounts.adminA)).get(`/v1/attempts/${attempt.id}`)).status).toBe(403);

    const admin = await newSession(accounts.adminA);
    await admin.goto(ExamScreen.attemptUrl(attempt.id));
    await expect(admin).toHaveURL(pathPattern('/admin/'));
  });
});
