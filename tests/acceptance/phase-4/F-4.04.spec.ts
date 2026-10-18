import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { scrollsHorizontally } from '../fixtures/layout';
import { BASIC_QUESTIONS } from '../fixtures/authoring';
import { expectApiError, leaksAnswerKey } from '../fixtures/exam';
import {
  expectReleased,
  HISTORY_EMPTY,
  HISTORY_SCORE,
  NOV_2_0930_IST,
  scoreText,
  sit,
  withdrawResults,
} from '../fixtures/results';
import { accounts, ORG_A, seededStudent } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { headerTexts, StudentHistoryPage, StudentNav, tableTexts } from '../pages/results-pages';
import { pathPattern } from '../pages/paths';
import { TestEditorPage } from '../pages/test-editor';
import { cellIn, expectEmptyState } from '../pages/ui';

// F-4.04 Student history (RES-04, US-ST-08). Contract: docs/testids/phase-4.md, "History" and "Requests the tests
// send directly".

const A01 = seededStudent(ORG_A, 1).id;
const A02 = seededStudent(ORG_A, 2).id;
const COLUMNS = ['Day', 'Test', 'Date', 'Status', 'Score'];
const BASIC_EXPLANATIONS = BASIC_QUESTIONS.flatMap((q) => (q.explanation ? [q.explanation] : []));

interface History {
  series: Array<{
    id: string;
    title: string;
    tests: Array<{
      testId: string;
      title: string;
      dayLabel: string | null;
      scheduledDate: string;
      attemptId: string;
      status: string;
      scoreState: string;
      score?: number;
      max?: number;
    }>;
  }>;
}

test.describe('F-4.04 student history', () => {
  test('US-ST-08 RES-04 history lists every finished attempt by series and day, with the score only where it may be shown', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    await testApi.clock.set(NOV_2_0930_IST);
    const quant = await testApi.seedExamTest({
      orgId: ORG_A.id,
      opensInMin: -1440,
      overrides: { resultRelease: 'immediate' },
    });
    const placement = quant.seriesId;
    const verbal = await testApi.seedExamTest({
      orgId: ORG_A.id,
      seriesId: placement,
      title: 'Verbal ability',
      overrides: { resultRelease: 'immediate', showPastScores: false },
    });
    const logic = await testApi.seedExamTest({ orgId: ORG_A.id, seriesId: placement, title: 'Logical reasoning' });
    const { seriesId: internship } = await testApi.seedSeries({
      orgId: ORG_A.id,
      title: 'Internship drive 2026',
      status: 'active',
    });
    const coding = await testApi.seedExamTest({
      orgId: ORG_A.id,
      seriesId: internship,
      title: 'Coding basics',
      overrides: { resultRelease: 'never' },
    });
    const comms = await testApi.seedExamTest({
      orgId: ORG_A.id,
      seriesId: internship,
      title: 'Communication',
      overrides: { resultRelease: 'manual' },
    });
    const untaken = await testApi.seedExamTest({ orgId: ORG_A.id, seriesId: internship, title: 'Group discussion' });

    const [quantA] = await testApi.seedGradedAttempts(ORG_A.id, quant.testId, [
      { studentId: A01, score: 3, timeSec: 600, correct: 3, incorrect: 1 },
    ]);
    const [quantB] = await testApi.seedGradedAttempts(ORG_A.id, quant.testId, [
      { studentId: A02, score: 4, timeSec: 500, correct: 4 },
    ]);
    const [verbalA] = await testApi.seedGradedAttempts(ORG_A.id, verbal.testId, [
      { studentId: A01, score: 2, timeSec: 600 },
    ]);
    const [logicA] = await testApi.seedGradedAttempts(ORG_A.id, logic.testId, [
      { studentId: A01, score: 4, timeSec: 600, status: 'auto_submitted' },
    ]);
    const [codingA] = await testApi.seedGradedAttempts(ORG_A.id, coding.testId, [
      { studentId: A01, score: 1, timeSec: 300, status: 'terminated', strikesCount: 3 },
    ]);
    const [commsA] = await testApi.seedGradedAttempts(ORG_A.id, comms.testId, [
      { studentId: A01, score: 2, timeSec: 600 },
    ]);

    await signInAs(accounts.studentA);
    const admin = await apiAs(accounts.adminA);
    await expectReleased(admin, comms.testId);
    expect((await withdrawResults(admin, comms.testId)).status).toBe(200);

    const history = new StudentHistoryPage(page);
    await new StudentNav(page).open('History');
    await expect(page).toHaveURL(pathPattern('/student/history/'));
    await expect(history.heading).toBeVisible();
    await expect(new StudentNav(page).link('History')).toHaveAttribute('aria-current', 'page');

    await expect(history.seriesHeading('Internship drive 2026')).toBeVisible();
    await expect(history.seriesHeading('Placement 2026')).toBeVisible();
    const seriesHeadings = (await history.main.getByRole('heading', { level: 2 }).allInnerTexts()).map((h) => h.trim());
    expect(seriesHeadings.indexOf('Internship drive 2026'), 'series by start date, newest first').toBeLessThan(
      seriesHeadings.indexOf('Placement 2026'),
    );

    expect(await headerTexts(history.table('Placement 2026'))).toEqual(COLUMNS);
    expect(await tableTexts(history.table('Placement 2026'))).toEqual([
      ['Day 1', 'Quantitative aptitude', '1 Nov 2026', 'Submitted', scoreText(3, 4)],
      ['Day 2', 'Verbal ability', '2 Nov 2026', 'Submitted', HISTORY_SCORE.hidden],
      ['Day 3', 'Logical reasoning', '2 Nov 2026', 'Submitted automatically', HISTORY_SCORE.pending],
    ]);
    expect(await headerTexts(history.table('Internship drive 2026'))).toEqual(COLUMNS);
    expect(await tableTexts(history.table('Internship drive 2026'))).toEqual([
      ['Day 1', 'Coding basics', '2 Nov 2026', 'Ended after strikes', HISTORY_SCORE.never],
      ['Day 2', 'Communication', '2 Nov 2026', 'Submitted', HISTORY_SCORE.withdrawn],
    ]);
    for (const [series, title, id] of [
      ['Placement 2026', 'Quantitative aptitude', quantA],
      ['Placement 2026', 'Verbal ability', verbalA],
      ['Internship drive 2026', 'Communication', commsA],
    ] as const) {
      await expect(history.testLink(series, title)).toHaveAttribute(
        'href',
        new RegExp(`/student/result/\\?attempt=${id}$`),
      );
    }
    await expectNoSeriousA11yViolations(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(history.heading).toBeVisible();
    expect(await scrollsHorizontally(page), 'the history reflows at 320 px (tables scroll in their own region)').toBe(
      false,
    );
    await page.setViewportSize({ width: 1280, height: 800 });

    const student = await apiAs(accounts.studentA);
    const res = await student.get<History>('/v1/student/history');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.series.map((s) => s.id)).toEqual([internship, placement]);
    const tests = res.body.series.flatMap((s) => s.tests);
    expect(tests.map((x) => x.attemptId)).toEqual([codingA, commsA, quantA, verbalA, logicA]);
    expect(tests.map((x) => x.scoreState)).toEqual(['never', 'withdrawn', 'shown', 'hidden', 'pending']);
    expect(tests.map((x) => x.dayLabel)).toEqual(['Day 1', 'Day 2', 'Day 1', 'Day 2', 'Day 3']);
    expect(tests.find((x) => x.attemptId === quantA)).toMatchObject({ score: 3, max: 4, status: 'submitted' });
    for (const x of tests.filter((y) => y.scoreState !== 'shown'))
      expect('score' in x || 'max' in x, `no score for ${x.title} (${x.scoreState})`).toBe(false);
    const json = JSON.stringify(res.body);
    expect(json, 'an untaken test is not listed').not.toContain(untaken.testId);
    expect(json, "another student's attempt is not listed").not.toContain(quantB!);
    expect(leaksAnswerKey(res.body, BASIC_EXPLANATIONS)).toEqual([]);
  });

  test('RES-04 US-AD-10 turning Show past scores off after the test hides the score but keeps the test listed as completed', async ({
    page,
    signInAs,
    apiAs,
    newSession,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { resultRelease: 'immediate' } });
    const [attemptId] = await testApi.seedGradedAttempts(ORG_A.id, t.testId, [
      { studentId: A01, score: 3, timeSec: 600 },
    ]);
    await signInAs(accounts.studentA);
    const history = new StudentHistoryPage(page);
    await history.goto();
    const row = history.row('Placement 2026', 'Quantitative aptitude');
    await expect(row).toHaveCount(1);
    await expect(await cellIn(history.table('Placement 2026'), row, 'Score')).toHaveText(scoreText(3, 4));

    const adminPage = await newSession(accounts.adminA);
    const editor = new TestEditorPage(adminPage);
    await editor.goto(t.testId, 'Day 1: Quantitative aptitude');
    const settings = await editor.settings();
    const past = settings.setting('Show past scores to students');
    await past.expectInherited('On');
    await past.override();
    await past.controls.setSwitch('Show past scores to students', false);
    await settings.saveAndConfirm();

    await page.reload();
    await expect(history.heading).toBeVisible();
    await expect(row).toHaveCount(1);
    await expect(await cellIn(history.table('Placement 2026'), row, 'Status')).toHaveText('Submitted');
    await expect(await cellIn(history.table('Placement 2026'), row, 'Score')).toHaveText(HISTORY_SCORE.hidden);
    await expect(history.main.getByText(scoreText(3, 4))).toHaveCount(0);

    const res = await (await apiAs(accounts.studentA)).get<History>('/v1/student/history');
    expect(res.status).toBe(200);
    const entry = res.body.series.flatMap((s) => s.tests).find((x) => x.attemptId === attemptId);
    expect(entry, 'the test is still listed').toMatchObject({ scoreState: 'hidden', status: 'submitted' });
    expect('score' in entry!, 'no score in the API either').toBe(false);
  });

  test('US-ST-08 a student with no finished test sees the empty history, and admins cannot read a student history', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { resultRelease: 'immediate' } });
    await signInAs(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    await sit(student, testApi, t.testId, { 0: '20 m/s' }); // in progress: not in the history

    const history = new StudentHistoryPage(page);
    await history.goto();
    await expectEmptyState(history.main, HISTORY_EMPTY.sentence, HISTORY_EMPTY.action);
    await expect(
      history.main.getByTestId('empty-state').getByRole('link', { name: HISTORY_EMPTY.action }),
    ).toHaveAttribute('href', /\/student\/?$/);
    await expect(history.main.getByRole('table')).toHaveCount(0);

    const res = await student.get<History>('/v1/student/history');
    expect(res.status).toBe(200);
    expect(res.body.series.flatMap((s) => s.tests)).toEqual([]);
    expectApiError(await (await apiAs(accounts.adminA)).get('/v1/student/history'), 403);
    expectApiError(await (await apiAs(accounts.superAdmin)).inOrg(ORG_A.id).get('/v1/student/history'), 403);
  });
});
