import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import {
  countdownText,
  DASHBOARD_EMPTY,
  markingText,
  postStart,
  remainingPattern,
  startAttempt,
  windowText,
} from '../fixtures/exam';
import { accounts, departmentId, ORG_A, ORG_B, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { pathPattern } from '../pages/paths';
import { StudentDashboard, StudentTestPage, TestNotAvailable } from '../pages/student-pages';
import { expectEmptyState } from '../pages/ui';

// F-3.02 Student dashboard and test page (US-ST-03, UX-11). Contract: docs/testids/phase-3.md, "Student dashboard"
// and "Test page". The browser runs in New York time here, so every time shown must still be the org's (IST).

/** 2 Nov 2026, 09:30 IST: the test clock for these tests (docs/testids/phase-3.md, "Test clock"). */
const NOW = Date.UTC(2026, 10, 2, 4, 0);
const MIN = 60_000;
const heading = (title: string) => `Day 1: ${title}`;

test.use({ timezoneId: 'America/New_York' });

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(NOW);
});

test.describe('F-3.02 student dashboard and test page', () => {
  test('US-ST-03 UX-11 the dashboard lists live, upcoming and completed tests with window, duration and countdown in the org timezone', async ({
    page,
    signInAs,
    testApi,
    apiAs,
  }) => {
    // Fixed slot 09:20 to 10:20 IST, last start 09:35 (15-minute cutoff): 5 minutes left to start.
    const quant = await testApi.seedExamTest({ orgId: ORG_A.id, opensInMin: -10 });
    // Flexible 09:00 to 12:00 IST, 45 minutes, full duration: last start 11:15.
    const verbal = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Verbal ability',
      company: 'Infosys',
      timingMode: 'flexible',
      opensInMin: -30,
      windowMin: 180,
      durationMin: 45,
    });
    // Opens 4 Nov 2026, 13:00 IST: 2 days 3 hours 30 minutes away.
    const logic = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Logical reasoning',
      company: 'Wipro',
      opensInMin: 2 * 1440 + 210,
    });
    const done = await testApi.seedStudentAttempts(ORG_A.id, 'stu-org-a-01');
    await signInAs(accounts.studentA);
    const dash = new StudentDashboard(page);
    await dash.goto();

    await expect(dash.groupHeading('Live now')).toBeVisible();
    const quantItem = dash.item('Live now', heading('Quantitative aptitude'));
    await expect(quantItem).toContainText('TCS');
    await expect(quantItem).toContainText(`Window: ${windowText(quant.window.start, quant.window.end)}`);
    await expect(quantItem).toContainText('Window: 2 Nov 2026, 09:20 to 10:20 IST');
    await expect(quantItem).toContainText('Duration: 60 minutes');
    await expect(dash.timer('Live now', heading('Quantitative aptitude'))).toHaveText(
      remainingPattern(countdownText, 5 * MIN, 60_000),
    );
    const verbalItem = dash.item('Live now', heading('Verbal ability'));
    await expect(verbalItem).toContainText('Window: 2 Nov 2026, 09:00 to 12:00 IST');
    await expect(verbalItem).toContainText('Duration: 45 minutes');
    await expect(dash.timer('Live now', heading('Verbal ability'))).toHaveText(
      remainingPattern(countdownText, 105 * MIN, 60_000),
    );
    const liveOrder = await dash.list('Live now').getByRole('listitem').allInnerTexts();
    expect(
      liveOrder.findIndex((t) => t.includes('Quantitative aptitude')),
      'live tests by last start time',
    ).toBeLessThan(liveOrder.findIndex((t) => t.includes('Verbal ability')));

    const logicItem = dash.item('Upcoming', heading('Logical reasoning'));
    await expect(logicItem).toContainText('Wipro');
    await expect(logicItem).toContainText(`Window: ${windowText(logic.window.start, logic.window.end)}`);
    await expect(logicItem).toContainText('Window: 4 Nov 2026, 13:00 to 14:00 IST');
    await expect(dash.timer('Upcoming', heading('Logical reasoning'))).toHaveText(
      remainingPattern(countdownText, (2 * 1440 + 210) * MIN, 60_000),
    );
    await expect(dash.timer('Upcoming', heading('Logical reasoning'))).toHaveText(/^2 days 03:(29|30):\d\d$/);

    const doneItem = dash.item('Completed', 'Day 1: Aptitude');
    await expect(doneItem).toHaveCount(1);
    await expect(doneItem).toContainText('Submitted');

    await expect(
      dash.nextTest.getByRole('link', { name: heading('Quantitative aptitude'), exact: true }),
    ).toBeVisible();
    await expect(dash.nextTest.getByRole('timer')).toHaveText(remainingPattern(countdownText, 5 * MIN, 60_000));
    await expect(dash.link('Live now', heading('Quantitative aptitude'))).toHaveAttribute(
      'href',
      new RegExp(`/student/test/\\?id=${quant.testId}$`),
    );
    await expectNoSeriousA11yViolations(page);

    const api = await apiAs(accounts.studentA);
    const res = await api.get<{ live: unknown[]; upcoming: unknown[]; completed: unknown[] }>('/v1/student/dashboard');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.live)).toContain(quant.testId);
    expect(JSON.stringify(res.body.live)).toContain(verbal.testId);
    expect(JSON.stringify(res.body.upcoming)).toContain(logic.testId);
    expect(JSON.stringify(res.body.completed)).toContain(done.testId);
  });

  test('US-ST-03 tests the student is not eligible for, draft series, unpublished, missed and other-org tests are not shown', async ({
    page,
    signInAs,
    testApi,
    apiAs,
    newSession,
  }) => {
    const open = await testApi.seedExamTest({ orgId: ORG_A.id, title: 'Open aptitude' });
    const mech = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Mechanical design',
      eligibility: { departmentIds: [departmentId(ORG_A, 'Mechanical')] },
    });
    const excluded = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Excluded aptitude',
      seriesEligibility: { exclude: ['stu-org-a-01'] },
    });
    const draftSeries = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Draft series test',
      seriesStatus: 'draft',
    });
    const unpublished = await testApi.seedExamTest({ orgId: ORG_A.id, title: 'Unpublished test', publish: false });
    const missed = await testApi.seedExamTest({ orgId: ORG_A.id, title: 'Missed test', opensInMin: -180 });
    const otherOrg = await testApi.seedExamTest({ orgId: ORG_B.id, title: 'COEP aptitude' });
    const hidden = [mech, excluded, draftSeries, unpublished, missed, otherOrg];
    const hiddenTitles = [
      'Mechanical design',
      'Excluded aptitude',
      'Draft series test',
      'Unpublished test',
      'Missed test',
      'COEP aptitude',
    ];

    await signInAs(accounts.studentA);
    const dash = new StudentDashboard(page);
    await dash.goto();

    await expect(dash.link('Live now', heading('Open aptitude'))).toBeVisible();
    for (const title of hiddenTitles) await expect(dash.main, title).not.toContainText(title);
    const api = await apiAs(accounts.studentA);
    const res = await api.get('/v1/student/dashboard');
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    expect(json).toContain(open.testId);
    for (const t of hidden) expect(json, `dashboard API lists ${t.testId}`).not.toContain(t.testId);
    expect((await postStart(api, mech.testId)).status, 'ineligible start refused').toBe(403);

    await page.goto(StudentTestPage.url(mech.testId));
    await new TestNotAvailable(page).expectShown();
    await expect(page.getByRole('main')).not.toContainText('Mechanical design');

    // The department rule is per student: a Mechanical student (student 04) sees that test.
    const mechStudent = await newSession(studentOfA(4));
    const mechDash = new StudentDashboard(mechStudent);
    await mechDash.goto();
    await expect(mechDash.link('Live now', heading('Mechanical design'))).toBeVisible();
    await expect(mechDash.main).not.toContainText('Unpublished test');
  });

  test('US-ST-03 UX-11 the test page shows the rules, the last start time and a countdown, and offers the device checks only while live', async ({
    page,
    signInAs,
    testApi,
    apiAs,
  }) => {
    const live = await testApi.seedExamTest({
      orgId: ORG_A.id,
      opensInMin: -10,
      overrides: { marking: { marks: 4, negativeMarks: 1, preset: 'p4_m1' }, maxStrikes: 5 },
    });
    const sectioned = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Aptitude sections',
      questions: 'sectioned',
      sectionDraws: { Quant: 3, Verbal: 2 },
    });
    const later = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Logical reasoning',
      opensInMin: 2 * 1440 + 210,
    });
    await signInAs(accounts.studentA);
    const testPage = new StudentTestPage(page);

    await testPage.goto(live.testId, heading('Quantitative aptitude'));

    for (const line of [
      'Window: 2 Nov 2026, 09:20 to 10:20 IST',
      'Duration: 60 minutes',
      'Questions: 4',
      'Sections: none',
      `Marking: ${markingText(4, 1)}`,
      'Maximum strikes: 5',
      'Last start: 09:35 IST',
    ])
      await expect(testPage.detail(line), line).toHaveCount(1);
    await expect(testPage.lastStartIn).toHaveText(remainingPattern(countdownText, 5 * MIN, 60_000));
    await expect(testPage.checkDevice).toHaveAttribute('href', new RegExp(`/exam/preflight/\\?test=${live.testId}$`));
    await expect(testPage.resume).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    await testPage.goto(sectioned.testId, heading('Aptitude sections'));
    await expect(testPage.detail('Questions: 5')).toHaveCount(1);
    await expect(testPage.detail('Sections: Quant (3 questions), Verbal (2 questions)')).toHaveCount(1);

    await testPage.goto(later.testId, heading('Logical reasoning'));
    await expect(testPage.opensAt('This test opens at 13:00 IST on 4 Nov 2026.')).toBeVisible();
    await expect(testPage.opensIn).toHaveText(/^2 days 03:(29|30):\d\d$/);
    await expect(testPage.checkDevice).toHaveCount(0);

    const api = await apiAs(accounts.studentA);
    const { attempt } = await startAttempt(api, live.testId);
    await testPage.goto(live.testId, heading('Quantitative aptitude'));
    await expect(testPage.resume).toHaveAttribute('href', new RegExp(`/exam/\\?attempt=${attempt.id}$`));
    await expect(testPage.checkDevice).toHaveCount(0);
  });

  test('US-ST-03 with no tests the dashboard shows one sentence and one action, and staff cannot call the student dashboard', async ({
    page,
    signInAs,
    apiAs,
  }) => {
    await signInAs(accounts.studentA);
    const dash = new StudentDashboard(page);
    await dash.goto();

    await expectEmptyState(dash.main, DASHBOARD_EMPTY.sentence, DASHBOARD_EMPTY.action);
    await expect(dash.nextTest).toHaveCount(0);
    await expect(dash.main.getByRole('link', { name: DASHBOARD_EMPTY.action, exact: true })).toHaveAttribute(
      'href',
      /\/profile\/?$/,
    );
    await dash.main.getByRole('link', { name: DASHBOARD_EMPTY.action, exact: true }).click();
    await expect(page).toHaveURL(pathPattern('/profile/'));

    const admin = await apiAs(accounts.adminA);
    expect((await admin.get('/v1/student/dashboard')).status).toBe(403);
    const superAdmin = await apiAs(accounts.superAdmin, { orgId: ORG_A.id });
    expect((await superAdmin.get('/v1/student/dashboard')).status).toBe(403);
  });
});
