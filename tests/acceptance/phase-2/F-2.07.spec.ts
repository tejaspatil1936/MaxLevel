import { AUTHORING_NOW, BASIC_QUESTIONS, optionName, SECTIONED_PROMPTS, SEEDED_TEST } from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { recordApiCalls } from '../fixtures/network';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ExamScreen, installProctoringSpy, proctoringCalls, simulateLeavingTheWindow } from '../pages/exam-screen';
import { pathPattern } from '../pages/paths';
import { studentHome } from '../pages/role-home';
import { PREVIEW_EMPTY, TestEditorPage } from '../pages/test-editor';
import { expectEmptyState } from '../pages/ui';

// F-2.07 Test preview (Q-13, US-AD-08). Contract: docs/testids/phase-2.md, "Preview tab" and "Exam screen in preview".

const orgPath = `organizations/${ORG_A.id}`;
const Q = (n: 1 | 2 | 3 | 4) => BASIC_QUESTIONS[n - 1]!;
const noShuffle = { shuffleQuestions: false, shuffleOptions: false };

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-2.07 test preview', () => {
  test('Q-13 US-AD-08 preview opens the real exam screen with no attempt saved and proctoring off', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, overrides: noShuffle });
    await installProctoringSpy(page);
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const preview = await editor.preview();
    const calls = recordApiCalls(page);

    await preview.openPreview.click();

    await expect(page).toHaveURL(pathPattern('/exam/'));
    const exam = new ExamScreen(page);
    await exam.expectPreviewOpen(SEEDED_TEST.heading);
    await expect(exam.question(1, 4)).toBeVisible();
    await expect(exam.promptText(Q(1).prompt)).toBeVisible();
    await expect(exam.radios).toHaveCount(4);
    for (const i of [0, 1, 2, 3]) await expect(exam.option(optionName(Q(1), i))).toBeVisible();
    await expect(exam.showAnswers).not.toBeChecked();
    await expect(exam.submit, 'nothing to submit in a preview').toHaveCount(0);
    await expect(exam.palette).toBeAttached();
    await expectNoSeriousA11yViolations(page);

    await exam.option(optionName(Q(1), 0)).check();
    await page.keyboard.press('ArrowDown');
    await expect(exam.option(optionName(Q(1), 1)), 'arrow keys move between options').toBeChecked();
    await simulateLeavingTheWindow(page);
    await exam.saveAndNext.click();
    await expect(exam.question(2, 4)).toBeVisible();
    await expect(exam.promptText(Q(2).prompt)).toBeVisible();
    await exam.previous.click();
    await expect(exam.question(1, 4)).toBeVisible();
    await expect(exam.option(optionName(Q(1), 1)), 'the answer is kept in memory').toBeChecked();

    await expect(exam.warnings, 'no strike warning or overlay').toHaveCount(0);
    expect(await proctoringCalls(page), 'no camera or fullscreen request').toEqual({ media: 0, fullscreen: 0 });
    expect(
      calls().filter((c) => /\/v1\/attempts/.test(c)),
      'no attempt, answer or event requests',
    ).toEqual([]);
    expect(await emulators.count(orgPath, 'attempts'), 'no attempt stored').toBe(0);
    expect(await emulators.count(orgPath, 'attemptIndex'), 'no attempt index stored').toBe(0);

    await exam.exitPreview.click();
    await editor.expectShown(SEEDED_TEST.heading);
    await expect(page).toHaveURL(pathPattern('/admin/tests/edit/'));
  });

  test('Q-13 A11Y-10 the Show answers toggle reveals the correct option and the explanation, and hides them again', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, overrides: noShuffle });
    await signInAs(accounts.adminA);
    await page.goto(ExamScreen.previewUrl(testId));
    const exam = new ExamScreen(page);
    await exam.expectPreviewOpen(SEEDED_TEST.heading);
    await expect(exam.correctAnswerText).toHaveCount(0);
    await expect(exam.explanationHeading).toHaveCount(0);

    await exam.showAnswers.click();

    await expect(exam.showAnswers).toBeChecked();
    await expect(exam.option(optionName(Q(1), 0))).toHaveAccessibleDescription('Correct answer');
    for (const i of [1, 2, 3])
      await expect(exam.option(optionName(Q(1), i))).not.toHaveAccessibleDescription('Correct answer');
    await expect(exam.correctAnswerText).toHaveCount(1);
    await expect(exam.explanationHeading).toBeVisible();
    await expect(exam.explanation(Q(1).explanation!)).toBeVisible();

    await exam.saveAndNext.click();
    await exam.saveAndNext.click();
    await expect(exam.question(3, 4)).toBeVisible();
    await expect(exam.option(optionName(Q(3), 1))).toHaveAccessibleDescription('Correct answer');
    await expect(exam.explanationHeading, 'no explanation for a question without one').toHaveCount(0);
    await expect(exam.math.first()).toBeAttached();
    await expect(exam.texAnnotations.first()).toHaveText(/x \+ 3 = 7/);

    await exam.showAnswers.click();

    await expect(exam.showAnswers).not.toBeChecked();
    await expect(exam.correctAnswerText).toHaveCount(0);
    await expect(exam.option(optionName(Q(3), 1))).not.toHaveAccessibleDescription('Correct answer');
  });

  test('US-AD-08 preview draws like a student attempt: sections in order and each section draw count', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({
      orgId: ORG_A.id,
      questions: 'sectioned',
      sectionDraws: { Quant: 3, Verbal: 2 },
    });
    await signInAs(accounts.adminA);
    await page.goto(ExamScreen.previewUrl(testId));
    const exam = new ExamScreen(page);
    await exam.expectPreviewOpen(SEEDED_TEST.heading);

    const shown: string[] = [];
    for (let n = 1; n <= 5; n++) {
      await expect(exam.question(n, 5)).toBeVisible();
      shown.push(await exam.shownPrompt(n <= 3 ? SECTIONED_PROMPTS.Quant : SECTIONED_PROMPTS.Verbal));
      if (n < 5) await exam.saveAndNext.click();
    }
    expect(new Set(shown).size, 'five different questions').toBe(5);
  });

  test('Q-13 a test without approved questions has nothing to preview and points to the Questions tab', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);

    const preview = await editor.preview();

    await expectEmptyState(preview.panel, PREVIEW_EMPTY.sentence, PREVIEW_EMPTY.action);
    await expect(preview.openPreview).toHaveCount(0);
    await preview.goToQuestions.click();
    await expect(editor.tab('Questions')).toHaveAttribute('aria-selected', 'true');
  });

  test('ORG-05 ORG-14 US-AD-08 students cannot open a preview, org B previews are 404, and a super admin can preview', async ({
    page,
    signInAs,
    testApi,
    apiAs,
  }) => {
    const a = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    const b = await testApi.seedAuthoringTest({ orgId: ORG_B.id });
    await signInAs(accounts.studentA);

    await page.goto(ExamScreen.previewUrl(a.testId));

    await studentHome(page).expectShown();
    await expect(new ExamScreen(page).previewNote).toHaveCount(0);
    const student = await apiAs(accounts.studentA);
    expect((await student.get(`/v1/tests/${a.testId}/preview`)).status).toBe(403);

    const adminA = await apiAs(accounts.adminA);
    expect((await adminA.get(`/v1/tests/${b.testId}/preview`)).status).toBe(404);
    const own = await adminA.get(`/v1/tests/${a.testId}/preview`);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).toContain(Q(1).prompt);
    expect(JSON.stringify(own.body), 'the admin preview carries the answer key').toContain('correctOptionIds');

    const superB = await apiAs(accounts.superAdmin, { orgId: ORG_B.id });
    const previewB = await superB.get(`/v1/tests/${b.testId}/preview`);
    expect(previewB.status).toBe(200);
    expect(JSON.stringify(previewB.body)).toContain(Q(4).prompt);
  });
});
