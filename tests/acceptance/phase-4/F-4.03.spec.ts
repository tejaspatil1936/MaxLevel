import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { scrollsHorizontally } from '../fixtures/layout';
import { BASIC_QUESTIONS, SECTIONED_PROMPTS } from '../fixtures/authoring';
import { expectApiError, leaksAnswerKey, storedAttempt } from '../fixtures/exam';
import {
  boardSoon,
  freezeClock,
  getResult,
  marksText,
  pctText,
  releasedKeysIn,
  RESULT_TEXTS,
  scoreText,
  sit,
  strike,
  submit,
  testBoard,
  timeAndStrikes,
} from '../fixtures/results';
import { accounts, ORG_A, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { seeYourResult, StudentResultPage } from '../pages/results-pages';
import { StudentDashboard } from '../pages/student-pages';
import { cellIn, rowWith } from '../pages/ui';

// F-4.03 Result page and full review (RES-02, RES-03, RES-06, US-ST-07; SER-10 below the browser). Contract:
// docs/testids/phase-4.md, "Result page" and "Result".

const HEADING = 'Day 1: Quantitative aptitude';
const SECTIONED_EXPLANATIONS = [...SECTIONED_PROMPTS.Quant, ...SECTIONED_PROMPTS.Verbal].map(
  (p) => `Explanation for ${p}.`,
);
const BASIC_EXPLANATIONS = BASIC_QUESTIONS.flatMap((q) => (q.explanation ? [q.explanation] : []));
const MIN = 60_000;

test.describe('F-4.03 result page', () => {
  test('RES-02 US-ST-07 DATA-05 a released result shows score, out of, percentage, rank, sections, time taken and strikes', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    await freezeClock(testApi);
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      questions: 'sectioned',
      overrides: { resultRelease: 'immediate', resultDetail: 'sections', testLeaderboard: true },
    });
    await signInAs(accounts.studentA);
    const me = await apiAs(accounts.studentA);
    const rival = await apiAs(studentOfA(2));
    const mine = await sit(me, testApi, t.testId, { 0: 'Option one', 1: 'Option two', 6: 'Option one' });
    const theirs = await sit(rival, testApi, t.testId, { 0: 'Option one', 1: 'Option one', 2: 'Option one' });
    await strike(me, testApi, mine.attempt.id, 1);
    await testApi.clock.advance(12 * MIN);
    await submit(me, mine.attempt.id);
    await testApi.clock.advance(MIN);
    await submit(rival, theirs.attempt.id);
    await testApi.clock.advance(31_000);
    await boardSoon(emulators, testApi, ORG_A.id, testBoard(t.testId), (rows) => rows.length === 2, 'board of two');
    const stored = await storedAttempt(emulators, ORG_A.id, mine.attempt.id);
    const durationSec = (stored.result as { durationSec: number }).durationSec;
    expect(durationSec, 'started, then 12 minutes to the submit').toBe(12 * 60);

    const dash = new StudentDashboard(page);
    await dash.goto();
    const done = dash.item('Completed', HEADING).getByRole('link', { name: HEADING, exact: true });
    await expect(done).toHaveAttribute('href', new RegExp(`/student/result/\\?attempt=${mine.attempt.id}$`));
    await done.click();
    const result = new StudentResultPage(page);
    await result.expectOn(mine.attempt.id, HEADING);

    await expect(result.inResult(scoreText(2, 10))).toBeVisible();
    await expect(result.inResult(pctText(20))).toBeVisible();
    await expect(result.inResult(RESULT_TEXTS.rank(2, 2))).toBeVisible();
    await expect(result.inResult(timeAndStrikes(durationSec, 1))).toBeVisible();
    await expect(result.inResult('12 minutes, 1 strike')).toBeVisible();
    for (const [section, score, correct, wrong, skipped] of [
      ['Quant', scoreText(1, 6), '1', '1', '4'],
      ['Verbal', scoreText(1, 4), '1', '0', '3'],
    ] as const) {
      const row = rowWith(result.sections, section);
      await expect(row, `${section} row`).toHaveCount(1);
      await expect(await cellIn(result.sections, row, 'Score')).toHaveText(score);
      await expect(await cellIn(result.sections, row, 'Correct')).toHaveText(correct);
      await expect(await cellIn(result.sections, row, 'Wrong')).toHaveText(wrong);
      await expect(await cellIn(result.sections, row, 'Skipped')).toHaveText(skipped);
    }
    await expect(result.reviewLink).toHaveCount(0);
    await expect(result.review).toHaveCount(0);
    await expect(result.back).toHaveAttribute('href', /\/student\/?$/);
    await expectNoSeriousA11yViolations(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(result.result).toBeVisible();
    expect(await scrollsHorizontally(page), 'the result page reflows at 320 px').toBe(false);
    await page.setViewportSize({ width: 1280, height: 800 });

    const body = await getResult(me, mine.attempt.id);
    expect(body).toMatchObject({
      release: 'released',
      detail: 'sections',
      status: 'submitted',
      score: 2,
      max: 10,
      pct: 20,
      durationSec: 720,
      strikesCount: 1,
      rank: { rank: 2, total: 2 },
    });
    expect(body.sections?.map((s) => [s.name, s.score, s.max, s.correct, s.incorrect, s.unanswered])).toEqual([
      ['Quant', 1, 6, 1, 1, 4],
      ['Verbal', 1, 4, 1, 0, 3],
    ]);
    expect('review' in body, 'no review below full detail').toBe(false);
    expect(leaksAnswerKey(body, SECTIONED_EXPLANATIONS), 'answer keys with section detail').toEqual([]);
  });

  test('RES-03 SER-10 DATA-05 a full review lists every question with the answer, the correct answer, marks and the explanation only where one exists', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: {
        resultRelease: 'immediate',
        resultDetail: 'full',
        marking: { marks: 1, negativeMarks: 0.25, preset: 'p1_m025' },
      },
    });
    await signInAs(accounts.studentA);
    const me = await apiAs(accounts.studentA);
    const payload = await sit(me, testApi, t.testId, { 0: '20 m/s', 1: '25', 3: '32' });
    await submit(me, payload.attempt.id);

    const result = new StudentResultPage(page);
    await result.goto(payload.attempt.id, HEADING);
    await expect(result.inResult(scoreText(1.75, 4))).toBeVisible();
    await expect(result.inResult(pctText(43.75))).toBeVisible();
    await expect(result.sections, 'no section table in a test without sections').toHaveCount(0);
    await expect(result.reviewLink).toHaveAttribute('href', /#answer-review$/);
    await result.reviewLink.click();
    await expect(result.reviewHeading).toBeInViewport();
    await expect(result.reviewHeading).toHaveAttribute('id', 'answer-review');
    await expect(result.review.getByRole('listitem')).toHaveCount(4);

    const expected = [
      { your: 'A. 20 m/s', correct: 'A. 20 m/s', verdict: 'Correct', marks: marksText(1) },
      { your: 'A. 25', correct: 'B. 30', verdict: 'Wrong', marks: marksText(-0.25) },
      { your: 'none', correct: 'B. 4', verdict: 'Skipped', marks: marksText(0) },
      { your: 'C. 32', correct: 'C. 32', verdict: 'Correct', marks: marksText(1) },
    ];
    for (const [i, e] of expected.entries()) {
      const item = result.reviewItem(i + 1);
      await expect(item, `review item ${i + 1}`).toHaveCount(1);
      await expect(item.getByText(`Your answer: ${e.your}`, { exact: true })).toBeVisible();
      await expect(item.getByText(`Correct answer: ${e.correct}`, { exact: true })).toBeVisible();
      await expect(item.getByText(e.verdict, { exact: true })).toBeVisible();
      await expect(item.getByText(`Marks: ${e.marks}`, { exact: true })).toBeVisible();
      const explanation = BASIC_QUESTIONS[i]!.explanation;
      if (explanation) {
        await expect(StudentResultPage.explanationHeading(item)).toBeVisible();
        await expect(item).toContainText(explanation);
      } else {
        await expect(StudentResultPage.explanationHeading(item), 'no explanation heading without one').toHaveCount(0);
      }
    }
    await expect(result.reviewItem(1)).toContainText('A train 240 m long passes a pole in 12 seconds.');
    await expect(result.reviewItem(3).locator('math'), 'math as MathML in the review').toHaveCount(1);
    await expectNoSeriousA11yViolations(page);

    const body = await getResult(me, payload.attempt.id);
    expect(body).toMatchObject({ release: 'released', detail: 'full', score: 1.75, max: 4 });
    expect(body.review).toHaveLength(4);
    const review = body.review!;
    expect(review.map((r) => r.questionId)).toEqual(payload.questions.map((q) => q.id));
    expect(review.map((r) => r.marks)).toEqual([1, -0.25, 0, 1]);
    expect(review[2]!.chosenOptionId).toBeNull();
    expect(review.map((r) => r.correctOptionIds.length)).toEqual([1, 1, 1, 1]);
    expect(review.map((r) => 'explanation' in r)).toEqual([true, true, false, true]);
    expect(review[3]!.explanation).toBe(BASIC_QUESTIONS[3]!.explanation);
  });

  test('US-ST-07 DATA-05 with score only the student sees the total without sections or a review, and the API sends neither', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      questions: 'sectioned',
      overrides: { resultRelease: 'immediate', resultDetail: 'score' },
    });
    await signInAs(accounts.studentA);
    const me = await apiAs(accounts.studentA);
    const payload = await sit(me, testApi, t.testId, { 0: 'Option one', 6: 'Option one', 7: 'Option one' });
    await submit(me, payload.attempt.id);

    const result = new StudentResultPage(page);
    await result.goto(payload.attempt.id, HEADING);
    await expect(result.inResult(scoreText(3, 10))).toBeVisible();
    await expect(result.inResult(pctText(30))).toBeVisible();
    await expect(result.sections).toHaveCount(0);
    await expect(result.reviewLink).toHaveCount(0);
    await expect(result.review).toHaveCount(0);
    await expect(result.rankLine, 'no rank with the test leaderboard off').toHaveCount(0);

    const body = await getResult(me, payload.attempt.id);
    expect(body).toMatchObject({ release: 'released', detail: 'score', score: 3, max: 10, pct: 30 });
    expect('sections' in body, 'no sections with score only').toBe(false);
    expect('review' in body, 'no review with score only').toBe(false);
    expect('rank' in body, 'no rank with the leaderboard off').toBe(false);
    expect(leaksAnswerKey(body, SECTIONED_EXPLANATIONS)).toEqual([]);
  });

  test('RES-06 PR-10 a terminated attempt shows its status and reason with its graded score, and is not ranked', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    await freezeClock(testApi);
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { maxStrikes: 2, resultRelease: 'immediate', resultDetail: 'sections', testLeaderboard: true },
    });
    await signInAs(accounts.studentA);
    const me = await apiAs(accounts.studentA);
    const other = await apiAs(studentOfA(2));
    const mine = await sit(me, testApi, t.testId, { 0: '20 m/s' });
    expect(await strike(me, testApi, mine.attempt.id, 2), 'the second strike ends the attempt').toBe('terminated');
    const theirs = await sit(other, testApi, t.testId, { 0: '20 m/s', 1: '30' });
    await submit(other, theirs.attempt.id);
    await testApi.clock.advance(31_000);
    await boardSoon(emulators, testApi, ORG_A.id, testBoard(t.testId), (rows) => rows.length === 1, 'board of one');
    const stored = await storedAttempt(emulators, ORG_A.id, mine.attempt.id);
    const durationSec = (stored.result as { durationSec: number }).durationSec;

    await page.goto(`/exam/submitted/?attempt=${mine.attempt.id}`);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: 'Your test was ended', exact: true }),
    ).toBeVisible();
    await seeYourResult(page).click();
    const result = new StudentResultPage(page);
    await result.expectOn(mine.attempt.id, HEADING);
    await expect(result.endedHeading).toBeVisible();
    await expect(result.text(RESULT_TEXTS.endedReason(2))).toBeVisible();
    await expect(result.inResult(scoreText(1, 4))).toBeVisible();
    await expect(result.inResult(timeAndStrikes(durationSec, 2))).toBeVisible();
    await expect(result.inResult(RESULT_TEXTS.notRanked)).toBeVisible();
    await expect(result.rankLine).toHaveCount(0);

    const body = await getResult(me, mine.attempt.id);
    expect(body).toMatchObject({
      status: 'terminated',
      terminationReason: 'max_strikes',
      strikesCount: 2,
      maxStrikes: 2,
      release: 'released',
      score: 1,
    });
    expect('rank' in body, 'terminated attempts have no rank').toBe(false);
  });

  test('RES-06 a terminated attempt shows its reason while the results are not released, and no score', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    await freezeClock(testApi);
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { maxStrikes: 3, resultRelease: 'manual' },
    });
    await signInAs(accounts.studentA);
    const me = await apiAs(accounts.studentA);
    const mine = await sit(me, testApi, t.testId, { 0: '20 m/s' });
    expect(await strike(me, testApi, mine.attempt.id, 3)).toBe('terminated');

    const result = new StudentResultPage(page);
    await result.goto(mine.attempt.id, HEADING);
    await expect(result.endedHeading).toBeVisible();
    await expect(result.text(RESULT_TEXTS.endedReason(3))).toBeVisible();
    await expect(result.text(RESULT_TEXTS.pendingManual)).toBeVisible();
    await expect(result.result).toHaveCount(0);
    const body = await getResult(me, mine.attempt.id);
    expect(body).toMatchObject({ status: 'terminated', terminationReason: 'max_strikes', release: 'pending' });
    expect(releasedKeysIn(body)).toEqual([]);
    expect(leaksAnswerKey(body, BASIC_EXPLANATIONS)).toEqual([]);
  });

  test('US-ST-07 another student or organization gets Result not found, an admin 403, and a test in progress offers Resume test', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { resultRelease: 'immediate' } });
    const other = await testApi.seedExamTest({ orgId: ORG_A.id, seriesId: t.seriesId, title: 'Verbal ability' });
    await signInAs(studentOfA(2));
    const owner = await apiAs(accounts.studentA);
    const payload = await sit(owner, testApi, t.testId, { 0: '20 m/s' });
    await submit(owner, payload.attempt.id);

    const result = new StudentResultPage(page);
    await page.goto(StudentResultPage.url(payload.attempt.id));
    await expect(result.heading(RESULT_TEXTS.notFoundHeading)).toBeVisible();
    await expect(result.text(RESULT_TEXTS.notFoundText)).toBeVisible();
    await expect(result.back).toHaveAttribute('href', /\/student\/?$/);
    await expect(result.result).toHaveCount(0);
    await expect(result.main.getByText(HEADING)).toHaveCount(0);

    const intruder = await apiAs(studentOfA(2));
    expectApiError(await intruder.get(`/v1/student/results/${payload.attempt.id}`), 404);
    expectApiError(await (await apiAs(accounts.studentB)).get(`/v1/student/results/${payload.attempt.id}`), 404);
    expectApiError(await (await apiAs(accounts.adminA)).get(`/v1/student/results/${payload.attempt.id}`), 403);

    const running = await sit(intruder, testApi, other.testId);
    expectApiError(await intruder.get(`/v1/student/results/${running.attempt.id}`), 409, 'ATTEMPT_IN_PROGRESS');
    await result.goto(running.attempt.id, 'Day 2: Verbal ability');
    await expect(result.text(RESULT_TEXTS.inProgress)).toBeVisible();
    await expect(result.resume).toHaveAttribute('href', new RegExp(`/exam/\\?attempt=${running.attempt.id}$`));
    await expect(result.result).toHaveCount(0);
  });
});
