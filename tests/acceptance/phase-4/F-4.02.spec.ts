import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { auditFor, storedTest } from '../fixtures/authoring';
import { expectApiError, leaksAnswerKey } from '../fixtures/exam';
import {
  ADMIN_RELEASE_TEXTS,
  expectReleased,
  freezeClock,
  getBoard,
  getResult,
  NOV_2_0930_IST,
  pctText,
  releasedKeysIn,
  releaseFields,
  releaseResults,
  RESULT_TEXTS,
  RESULTS_EMPTY,
  RESULTS_STATE_WORDS,
  scoreText,
  sitAndSubmit,
  testBoard,
  withdrawResults,
} from '../fixtures/results';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import {
  AdminResultsList,
  AdminTestResults,
  RESULTS_LINK,
  seeYourResult,
  StudentResultPage,
} from '../pages/results-pages';
import { expectShellRules } from '../pages/shell';
import { cellIn, expectConfirmLayout, expectEmptyState } from '../pages/ui';
import { TestEditorPage } from '../pages/test-editor';

// F-4.02 Result release modes and withdrawal (RES-01, RES-05, US-AD-10). Contract: docs/testids/phase-4.md, "Result
// release", "Test results" and "Result page".

const HEADING = 'Day 1: Quantitative aptitude';
const BASIC_RIGHT = { 0: '20 m/s', 1: '30' }; // 2 of 4 with +1 and 0

test.describe('F-4.02 result release', () => {
  test('RES-01 US-AD-10 a manual release keeps results hidden until the admin presses Release results, then students see them', async ({
    page,
    signInAs,
    apiAs,
    newSession,
    testApi,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { resultRelease: 'manual', resultDetail: 'score' },
    });
    await signInAs(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const attemptId = await sitAndSubmit(student, testApi, t.testId, BASIC_RIGHT);

    const result = new StudentResultPage(page);
    await result.goto(attemptId, HEADING);
    await expect(result.text(RESULT_TEXTS.pendingManual)).toBeVisible();
    await expect(result.result).toHaveCount(0);
    const pending = await getResult(student, attemptId);
    expect(pending.release).toBe('pending');
    expect(releasedKeysIn(pending), 'no score before release').toEqual([]);

    const adminPage = await newSession(accounts.adminA);
    const admin = new AdminTestResults(adminPage);
    await admin.goto(t.testId, HEADING);
    await expect(admin.release.state(ADMIN_RELEASE_TEXTS.manual)).toBeVisible();
    await expect(admin.release.withdraw).toHaveCount(0);
    await expectNoSeriousA11yViolations(adminPage);
    await admin.release.release.click();
    await expect(admin.release.releaseDialog).toContainText(ADMIN_RELEASE_TEXTS.releaseConfirmText);
    await expectConfirmLayout(admin.release.releaseDialog, 'Release results', false);
    await admin.release.releaseDialog.getByRole('button', { name: 'Release results', exact: true }).click();
    await expect(adminPage.getByRole('status').filter({ hasText: /^\s*Results released\s*$/ })).toBeVisible();
    await expect(admin.release.state(ADMIN_RELEASE_TEXTS.released)).toBeVisible();
    await expect(admin.release.release).toHaveCount(0);
    await expect(admin.release.withdraw).toBeVisible();

    const fields = await releaseFields(emulators, ORG_A.id, t.testId);
    expect(typeof fields.resultsReleasedAt, 'resultsReleasedAt stored').toBe('number');
    expect(fields.resultsWithdrawn ?? false).toBe(false);
    const entries = await auditFor(emulators, ORG_A.id, 'test.results.release', t.testId);
    expect(entries, 'test.results.release audit entry').toHaveLength(1);
    expect(entries[0]!.data.actor).toMatchObject({ email: accounts.adminA.email, role: 'admin' });

    await page.reload();
    await expect(result.heading(HEADING)).toBeVisible();
    await expect(result.inResult(scoreText(2, 4))).toBeVisible();
    await expect(result.inResult(pctText(50))).toBeVisible();
    await expect(result.text(RESULT_TEXTS.pendingManual)).toHaveCount(0);
    const released = await getResult(student, attemptId);
    expect(released).toMatchObject({ release: 'released', detail: 'score', score: 2, max: 4, pct: 50 });
  });

  test('RES-05 LB-04 withdrawing released results shows Results are being reviewed until they are released again', async ({
    page,
    signInAs,
    apiAs,
    newSession,
    testApi,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { resultRelease: 'immediate', resultDetail: 'sections', testLeaderboard: true },
    });
    await signInAs(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const attemptId = await sitAndSubmit(student, testApi, t.testId, BASIC_RIGHT);
    const result = new StudentResultPage(page);
    await result.goto(attemptId, HEADING);
    await expect(result.inResult(scoreText(2, 4))).toBeVisible();

    const adminPage = await newSession(accounts.adminA);
    const admin = new AdminTestResults(adminPage);
    await admin.goto(t.testId, HEADING);
    await expect(admin.release.state(ADMIN_RELEASE_TEXTS.released)).toBeVisible();
    await expect(admin.release.release).toHaveCount(0);
    await admin.release.withdraw.click();
    await expectConfirmLayout(admin.release.withdrawDialog, 'Withdraw results', true);
    await admin.release.withdrawDialog.getByRole('button', { name: 'Withdraw results', exact: true }).click();
    await expect(adminPage.getByRole('status').filter({ hasText: /^\s*Results withdrawn\s*$/ })).toBeVisible();
    await expect(admin.release.state(ADMIN_RELEASE_TEXTS.withdrawn)).toBeVisible();
    await expect(admin.release.release).toBeVisible();

    expect((await releaseFields(emulators, ORG_A.id, t.testId)).resultsWithdrawn).toBe(true);
    expect(await auditFor(emulators, ORG_A.id, 'test.results.withdraw', t.testId)).toHaveLength(1);

    await page.reload();
    await expect(result.withdrawnHeading).toBeVisible();
    await expect(result.text(RESULT_TEXTS.withdrawnText)).toBeVisible();
    await expect(result.result).toHaveCount(0);
    await expect(result.main.getByText(scoreText(2, 4))).toHaveCount(0);
    const withdrawn = await getResult(student, attemptId);
    expect(withdrawn.release).toBe('withdrawn');
    expect(releasedKeysIn(withdrawn), 'no score while withdrawn').toEqual([]);
    expectApiError(await getBoard(student, testBoard(t.testId)), 404, 'LEADERBOARD_NOT_AVAILABLE');

    await expectReleased(await apiAs(accounts.adminA), t.testId);
    await page.reload();
    await expect(result.inResult(scoreText(2, 4))).toBeVisible();
    await expect(result.withdrawnHeading).toHaveCount(0);
    expect((await releaseFields(emulators, ORG_A.id, t.testId)).resultsWithdrawn).toBe(false);
  });

  test('RES-01 after the window closes: results stay pending until the release task runs at the window end', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    await freezeClock(testApi);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id }); // system default: after the window closes
    await signInAs(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const attemptId = await sitAndSubmit(student, testApi, t.testId, BASIC_RIGHT);

    const task = (await testApi.tasks.pending()).find((k) => k.path === '/tasks/release-results');
    expect(task, 'release task queued').toBeTruthy();
    expect(task).toMatchObject({
      name: `release-results-${ORG_A.id}-${t.testId}-${t.window.end}`,
      scheduleTime: t.window.end,
    });

    const result = new StudentResultPage(page);
    await result.goto(attemptId, HEADING);
    await expect(result.text(RESULT_TEXTS.pendingAfterClose(t.window.end))).toBeVisible();
    await expect(result.result).toHaveCount(0);
    expect((await getResult(student, attemptId)).release).toBe('pending');

    await testApi.tasks.runDue();
    expect(
      (await releaseFields(emulators, ORG_A.id, t.testId)).resultsReleasedAt ?? null,
      'not before the end',
    ).toBeNull();

    await testApi.clock.set(t.window.end + 1_000);
    await expect
      .poll(
        async () => {
          await testApi.tasks.runDue();
          return typeof (await releaseFields(emulators, ORG_A.id, t.testId)).resultsReleasedAt;
        },
        { message: 'release task stored resultsReleasedAt' },
      )
      .toBe('number');
    expect(await auditFor(emulators, ORG_A.id, 'test.results.release', t.testId), 'no audit for the task').toEqual([]);

    await page.reload();
    await expect(result.inResult(scoreText(2, 4))).toBeVisible();
    await expect(result.text(RESULT_TEXTS.pendingAfterClose(t.window.end))).toHaveCount(0);
    expect(await getResult(student, attemptId)).toMatchObject({ release: 'released', score: 2, max: 4 });
  });

  test('RES-01 immediate shows the result on submit; never keeps it admin-only and Release results is refused', async ({
    page,
    signInAs,
    apiAs,
    newSession,
    testApi,
    emulators,
  }) => {
    const now = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { resultRelease: 'immediate', resultDetail: 'score' },
    });
    const hidden = await testApi.seedExamTest({
      orgId: ORG_A.id,
      seriesId: now.seriesId,
      title: 'Verbal ability',
      overrides: { resultRelease: 'never' },
    });
    await signInAs(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const shownId = await sitAndSubmit(student, testApi, now.testId, BASIC_RIGHT);
    const hiddenId = await sitAndSubmit(student, testApi, hidden.testId, BASIC_RIGHT);

    expect(await getResult(student, shownId)).toMatchObject({ release: 'released', score: 2, max: 4, pct: 50 });
    await page.goto(`/exam/submitted/?attempt=${shownId}`);
    await expect(seeYourResult(page)).toHaveAttribute('href', new RegExp(`/student/result/\\?attempt=${shownId}$`));
    await seeYourResult(page).click();
    const result = new StudentResultPage(page);
    await result.expectOn(shownId, HEADING);
    await expect(result.inResult(scoreText(2, 4))).toBeVisible();

    await page.goto(`/exam/submitted/?attempt=${hiddenId}`);
    await expect(page.getByRole('main').getByText(RESULT_TEXTS.never, { exact: true })).toBeVisible();
    await expect(seeYourResult(page)).toHaveCount(0);
    await result.goto(hiddenId, 'Day 2: Verbal ability');
    await expect(result.text(RESULT_TEXTS.never)).toBeVisible();
    await expect(result.result).toHaveCount(0);
    const never = await getResult(student, hiddenId);
    expect(never.release).toBe('never');
    expect(releasedKeysIn(never)).toEqual([]);

    const adminPage = await newSession(accounts.adminA);
    const admin = await apiAs(accounts.adminA);
    expectApiError(await releaseResults(admin, hidden.testId), 409, 'RESULTS_NOT_RELEASABLE');
    expect((await releaseFields(emulators, ORG_A.id, hidden.testId)).resultsReleasedAt ?? null).toBeNull();
    expect(await auditFor(emulators, ORG_A.id, 'test.results.release', hidden.testId)).toEqual([]);

    const page2 = new AdminTestResults(adminPage);
    await page2.goto(hidden.testId, 'Day 2: Verbal ability');
    await expect(page2.release.state(ADMIN_RELEASE_TEXTS.never)).toBeVisible();
    await expect(page2.release.release).toHaveCount(0);
    await expect(page2.release.withdraw).toHaveCount(0);
  });

  test('SER-09 DATA-05 a full review cannot be released manually before a flexible window closes, and can after', async ({
    apiAs,
    newSession,
    testApi,
    emulators,
  }) => {
    await freezeClock(testApi);
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      timingMode: 'flexible',
      windowMin: 90,
      durationMin: 30,
      overrides: { resultRelease: 'manual', resultDetail: 'full' },
    });
    const student = await apiAs(accounts.studentA);
    const attemptId = await sitAndSubmit(student, testApi, t.testId, BASIC_RIGHT);
    const adminPage = await newSession(accounts.adminA);
    const admin = await apiAs(accounts.adminA);

    expectApiError(await releaseResults(admin, t.testId), 409, 'FULL_REVIEW_BEFORE_CLOSE');
    expect((await releaseFields(emulators, ORG_A.id, t.testId)).resultsReleasedAt ?? null).toBeNull();
    expect(await auditFor(emulators, ORG_A.id, 'test.results.release', t.testId)).toEqual([]);
    const pending = await getResult(student, attemptId);
    expect(pending.release).toBe('pending');
    expect(leaksAnswerKey(pending), 'no answer key before release').toEqual([]);

    const results = new AdminTestResults(adminPage);
    await results.goto(t.testId, HEADING);
    await expect(results.release.release).toBeDisabled();
    await expect(results.release.release).toHaveAccessibleDescription(
      ADMIN_RELEASE_TEXTS.fullReviewBlocked(t.window.end),
    );

    await testApi.clock.set(t.window.end + 1_000);
    await adminPage.reload();
    await expect(results.heading(HEADING)).toBeVisible();
    await expect(results.release.release).toBeEnabled();
    await results.release.releaseAndConfirm();
    const released = await getResult(student, attemptId);
    expect(released).toMatchObject({ release: 'released', detail: 'full' });
    expect(released.review, 'full review after the window closed').toHaveLength(4);
  });

  test('US-AD-10 release timing and detail follow the series default unless the test overrides them, and still change after attempts start', async ({
    page,
    signInAs,
    apiAs,
    newSession,
    testApi,
    emulators,
  }) => {
    await testApi.clock.set(NOV_2_0930_IST);
    const { seriesId } = await testApi.seedSeries({
      orgId: ORG_A.id,
      status: 'active',
      defaults: { resultRelease: 'immediate', resultDetail: 'score' },
    });
    const quant = await testApi.seedExamTest({ orgId: ORG_A.id, seriesId, title: 'Quantitative aptitude' });
    const verbal = await testApi.seedExamTest({
      orgId: ORG_A.id,
      seriesId,
      title: 'Verbal ability',
      questions: 'sectioned',
      overrides: { resultDetail: 'sections' },
    });
    await signInAs(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const quantId = await sitAndSubmit(student, testApi, quant.testId, BASIC_RIGHT);
    const verbalId = await sitAndSubmit(student, testApi, verbal.testId, { 0: 'Option one' });

    const result = new StudentResultPage(page);
    await result.goto(quantId, HEADING);
    await expect(result.inResult(scoreText(2, 4))).toBeVisible();
    await expect(result.sections).toHaveCount(0);
    await expect(result.reviewLink).toHaveCount(0);
    const quantResult = await getResult(student, quantId);
    expect(quantResult).toMatchObject({ release: 'released', detail: 'score' });
    expect('sections' in quantResult, 'no sections with score only').toBe(false);

    await result.goto(verbalId, 'Day 2: Verbal ability');
    await expect(result.sections).toBeVisible();
    await expect(result.reviewLink).toHaveCount(0);
    expect((await getResult(student, verbalId)).detail).toBe('sections');

    // After attempts have started the release detail can still change (TST-06), here through the Settings tab.
    const adminPage = await newSession(accounts.adminA);
    const editor = new TestEditorPage(adminPage);
    await editor.goto(quant.testId, HEADING);
    const settings = await editor.settings();
    const detail = settings.setting('Result detail');
    await detail.expectInherited('Score only');
    await detail.override();
    await detail.controls.pick('Result detail', 'Full review with correct answers and explanations');
    await settings.saveAndConfirm();
    const stored = await storedTest(emulators, ORG_A.id, quant.testId);
    expect(stored.overrides).toMatchObject({ resultDetail: 'full' });
    expect(stored.resolved).toMatchObject({ resultDetail: 'full', resultRelease: 'immediate' });

    await result.goto(quantId, HEADING);
    await expect(result.reviewLink).toBeVisible();
    await expect(result.review.getByRole('listitem')).toHaveCount(4);
    expect((await getResult(student, quantId)).detail).toBe('full');
  });

  test('US-AD-10 the Results page lists published tests with their release state; an organization without any sees the empty state', async ({
    page,
    signInAs,
    newSession,
    testApi,
  }) => {
    const manual = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { resultRelease: 'manual' } });
    await testApi.seedExamTest({
      orgId: ORG_A.id,
      seriesId: manual.seriesId,
      title: 'Verbal ability',
      overrides: { resultRelease: 'never' },
    });
    await signInAs(accounts.adminA);
    const list = new AdminResultsList(page);
    await list.shell.navLink(RESULTS_LINK.name).click();
    await expect(list.heading).toBeVisible();
    await expect(list.shell.navLink(RESULTS_LINK.name)).toHaveAttribute('href', /\/admin\/results\/$/);
    await expect(await cellIn(list.tests, list.testRow(HEADING), 'Results')).toHaveText(RESULTS_STATE_WORDS.manual);
    await expect(await cellIn(list.tests, list.testRow('Day 2: Verbal ability'), 'Results')).toHaveText(
      RESULTS_STATE_WORDS.never,
    );
    await expect(await cellIn(list.tests, list.testRow(HEADING), 'Series')).toHaveText('Placement 2026');
    await expect(list.seriesLink('Placement 2026')).toHaveAttribute(
      'href',
      new RegExp(`/admin/results/\\?series=${manual.seriesId}$`),
    );
    await expectNoSeriousA11yViolations(page);
    await expectShellRules(page, '/admin/results/');
    await list.testLink(HEADING).click();
    await expect(new AdminTestResults(page).heading(HEADING)).toBeVisible();
    await expectShellRules(page, '/admin/results/?test=');

    const other = await newSession(accounts.adminB);
    const otherList = new AdminResultsList(other);
    await otherList.goto();
    await expectEmptyState(other.getByRole('main'), RESULTS_EMPTY.sentence, RESULTS_EMPTY.action);
  });
});

test.describe('F-4.02 release API: tenancy and roles', () => {
  test('ORG-05 ORG-14 Release results and Withdraw results: org B gets 404, a student 403, a super admin in org A succeeds as the actor', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { resultRelease: 'manual' } });
    await signInAs(accounts.adminB);
    const student = await apiAs(accounts.studentA);
    await sitAndSubmit(student, testApi, t.testId, BASIC_RIGHT);

    const adminB = await apiAs(accounts.adminB);
    expectApiError(await releaseResults(adminB, t.testId), 404);
    expectApiError(await withdrawResults(adminB, t.testId), 404);
    expectApiError(await releaseResults(student, t.testId), 403);
    expectApiError(await withdrawResults(student, t.testId), 403);
    expect((await releaseFields(emulators, ORG_A.id, t.testId)).resultsReleasedAt ?? null).toBeNull();

    const admin = await apiAs(accounts.adminA);
    expectApiError(await withdrawResults(admin, t.testId), 409, 'RESULTS_NOT_RELEASED');

    const superA = (await apiAs(accounts.superAdmin)).inOrg(ORG_A.id);
    const released = await releaseResults(superA, t.testId);
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    expect(typeof (released.body as { resultsReleasedAt?: unknown }).resultsReleasedAt).toBe('number');
    const withdrawn = await withdrawResults(superA, t.testId);
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    expect(withdrawn.body).toMatchObject({ resultsWithdrawn: true });
    for (const action of ['test.results.release', 'test.results.withdraw']) {
      const entries = await auditFor(emulators, ORG_A.id, action, t.testId);
      expect(entries, `${action} in org A`).toHaveLength(1);
      expect(entries[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });
    }
    expect(await auditFor(emulators, ORG_B.id, 'test.results.release')).toEqual([]);

    const results = new AdminTestResults(page);
    await page.goto(AdminTestResults.url(t.testId));
    await expect(results.notFound).toBeVisible();
    await expect(results.text(`This test doesn't exist in ${ORG_B.name}.`)).toBeVisible();
    await expect(results.backToResults).toHaveAttribute('href', /\/admin\/results\/$/);
    await expect(results.release.region).toHaveCount(0);
  });
});
