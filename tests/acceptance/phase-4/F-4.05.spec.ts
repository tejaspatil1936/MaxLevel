import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { expectApiError } from '../fixtures/exam';
import {
  boardSoon,
  boardTime,
  expectReleased,
  freezeAtSlotStart,
  freezeClock,
  getBoard,
  LEADERBOARDS_EMPTY,
  LEADERBOARDS_OFF,
  NOV_2_0930_IST,
  RESULT_TEXTS,
  runLeaderboardTask,
  scoreText,
  seriesBoard,
  setFeature,
  sitAndSubmit,
  storedBoard,
  studentFacts,
  studentName,
  testBoard,
} from '../fixtures/results';
import { accounts, ORG_A, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import type { GradedAttemptSeed } from '../fixtures/test-api';
import {
  AdminSeriesResults,
  BALLPOINT_WASH,
  AdminTestResults,
  headerTexts,
  LeaderboardPage,
  rowBackgrounds,
  StudentLeaderboardsPage,
  StudentNav,
  StudentResultPage,
  tableTexts,
} from '../pages/results-pages';
import { dataRows, expectEmptyState } from '../pages/ui';

// F-4.05 Leaderboards (LB-03, LB-04, LB-05, US-ST-09; LB-01 and LB-02 seen through the stored boards). Contract:
// docs/testids/phase-4.md, "Leaderboards", "Board" and the student and admin leaderboard screens.

const HEADING = 'Day 1: Quantitative aptitude';
const id = (n: number) => studentFacts(ORG_A, n).id;
const dept = (n: number) => studentFacts(ORG_A, n).department;
const TEST_COLUMNS = ['Rank', 'Name', 'Department', 'Score', 'Time taken'];
const SERIES_COLUMNS = ['Rank', 'Name', 'Department', 'Total'];
const RIGHT2 = { 0: '20 m/s', 1: '30' };
const RIGHT3 = { 0: '20 m/s', 1: '30', 2: '4' };

test.describe('F-4.05 leaderboards', () => {
  test('LB-05 US-ST-09 LB-01 students see the top 50 plus their own highlighted row, admins see every row', async ({
    page,
    signInAs,
    apiAs,
    newSession,
    testApi,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { resultRelease: 'manual', testLeaderboard: true },
    });
    await testApi.seedMoreStudents(ORG_A.id, 36); // students 21 to 56
    const attempts: GradedAttemptSeed[] = [
      { studentId: id(2), score: 4, timeSec: 600 },
      { studentId: id(3), score: 4, timeSec: 700 },
      { studentId: id(4), score: 4, timeSec: 700 }, // same score, time and submission second as 03: shares rank 2
      { studentId: id(5), score: 4, timeSec: 800 },
      ...Array.from({ length: 48 }, (_, k) => ({ studentId: id(6 + k), score: 3, timeSec: 900 + k * 10 })),
      { studentId: id(1), score: 2, timeSec: 1000 },
      { studentId: id(54), score: 1, timeSec: 1000 },
      { studentId: id(55), score: 0, timeSec: 1000 },
      { studentId: id(56), score: 4, timeSec: 500, status: 'terminated', strikesCount: 3 },
    ];
    await testApi.seedGradedAttempts(ORG_A.id, t.testId, attempts);
    await signInAs(accounts.studentA);
    const adminPage = await newSession(accounts.adminA);
    const admin = await apiAs(accounts.adminA);
    await expectReleased(admin, t.testId);

    const rows = await boardSoon(emulators, testApi, ORG_A.id, testBoard(t.testId), (r) => r.length === 55, '55 rows');
    expect(rows.slice(0, 5).map((r) => [r.studentId, r.rank])).toEqual([
      [id(2), 1],
      [id(3), 2],
      [id(4), 2],
      [id(5), 4],
      [id(6), 5],
    ]);
    expect(rows.find((r) => r.studentId === id(1))).toMatchObject({ rank: 53, score: 2, timeSec: 1000 });
    expect(
      rows.map((r) => r.studentId),
      'terminated attempts are left out',
    ).not.toContain(id(56));
    expect(rows[0]).toMatchObject({ name: studentName(2), departmentId: studentFacts(ORG_A, 2).departmentId });

    const boards = new StudentLeaderboardsPage(page);
    await new StudentNav(page).open('Leaderboards');
    await expect(boards.heading).toBeVisible();
    await expect(boards.item(HEADING)).toContainText('Test leaderboard');
    await boards.link(HEADING).click();
    const board = new LeaderboardPage(page);
    await expect(board.heading(HEADING)).toBeVisible();
    await expect(board.ownRank(53, 55)).toBeVisible();
    expect(await headerTexts(board.table)).toEqual(TEST_COLUMNS);
    const shown = await tableTexts(board.table);
    expect(shown, 'top 50 plus the student row').toHaveLength(51);
    expect(shown.slice(0, 4)).toEqual([
      ['1', studentName(2), dept(2), scoreText(4, 4), boardTime(600)],
      ['2', studentName(3), dept(3), scoreText(4, 4), boardTime(700)],
      ['2', studentName(4), dept(4), scoreText(4, 4), boardTime(700)],
      ['4', studentName(5), dept(5), scoreText(4, 4), boardTime(800)],
    ]);
    expect(shown[49]).toEqual(['50', studentName(51), dept(51), scoreText(3, 4), boardTime(1350)]);
    expect(shown[50]).toEqual(['53', `${studentName(1)} (you)`, dept(1), scoreText(2, 4), boardTime(1000)]);
    expect(shown.flat(), 'no terminated attempt').not.toContain(studentName(56));
    await expect(board.ownRows).toHaveCount(1);
    const own = dataRows(board.table).nth(50);
    await expect(own).toHaveAttribute('aria-current', 'true');
    await page.mouse.move(0, 0); // no hover tint (also ballpoint-wash) on any row
    expect(await rowBackgrounds(own), 'own row highlighted').toContain(BALLPOINT_WASH);
    expect(await rowBackgrounds(dataRows(board.table).nth(0))).not.toContain(BALLPOINT_WASH);
    await expectNoSeriousA11yViolations(page);

    const student = await apiAs(accounts.studentA);
    const mine = await getBoard(student, testBoard(t.testId));
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body).toMatchObject({ kind: 'test', title: HEADING, total: 55, max: 4 });
    expect(mine.body.rows).toHaveLength(50);
    expect(mine.body.me).toMatchObject({ rank: 53, name: studentName(1), department: dept(1), score: 2 });
    const full = await getBoard(admin, testBoard(t.testId));
    expect(full.status).toBe(200);
    expect(full.body.rows).toHaveLength(55);
    expect(full.body.me).toBeNull();

    const results = new AdminTestResults(adminPage);
    await results.goto(t.testId, HEADING);
    await expect(results.leaderboardHeading).toBeVisible();
    expect(await headerTexts(results.leaderboard)).toEqual(TEST_COLUMNS);
    await expect(dataRows(results.leaderboard), 'admins see every row').toHaveCount(55);
    await expect(dataRows(results.leaderboard).nth(52)).toContainText(studentName(1));
  });

  test('LB-03 REL-04 finishes in one 30-second slot share one recompute, and the stored test and series boards follow', async ({
    request,
    apiAs,
    testApi,
    emulators,
  }) => {
    const start = await freezeAtSlotStart(testApi);
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { resultRelease: 'immediate', testLeaderboard: true },
    });
    await sitAndSubmit(await apiAs(accounts.studentA), testApi, t.testId, RIGHT2);
    await sitAndSubmit(await apiAs(studentOfA(2)), testApi, t.testId, RIGHT3);

    const isBoardTask = (k: { name: string; path: string }) =>
      k.path === '/tasks/leaderboard' && k.name.startsWith(`leaderboard-${ORG_A.id}-${t.testId}-`);
    const queued = (await testApi.tasks.pending()).filter(isBoardTask);
    expect(queued, 'one recompute for both finishes').toHaveLength(1);
    const first = queued[0]!;
    expect(first.scheduleTime % 30_000, 'scheduled at a slot end').toBe(0);
    expect(first.scheduleTime).toBeGreaterThan(start);
    expect(first.scheduleTime).toBeLessThanOrEqual(start + 30_000);
    expect(await storedBoard(emulators, ORG_A.id, testBoard(t.testId)), 'no board before the slot ends').toBeNull();

    await testApi.clock.set(first.scheduleTime + 1_000);
    const two = await boardSoon(emulators, testApi, ORG_A.id, testBoard(t.testId), (r) => r.length === 2, '2 rows');
    expect(two.map((r) => [r.studentId, r.rank, r.score])).toEqual([
      [id(2), 1, 3],
      [id(1), 2, 2],
    ]);
    const stored = await storedBoard(emulators, ORG_A.id, testBoard(t.testId));
    expect(stored!.computedAt).toBeGreaterThanOrEqual(first.scheduleTime);
    const series = await storedBoard(emulators, ORG_A.id, seriesBoard(t.seriesId));
    expect(series, 'the series board is stored too').not.toBeNull();
    expect(series!.rows.map((r) => [r.studentId, r.rank, r.score])).toEqual([
      [id(2), 1, 3],
      [id(1), 2, 2],
    ]);

    await sitAndSubmit(await apiAs(studentOfA(3)), testApi, t.testId, { 0: '20 m/s' });
    const next = (await testApi.tasks.pending()).filter(isBoardTask);
    expect(next, 'a finish in the next slot queues its own recompute').toHaveLength(1);
    expect(next[0]!.name).not.toBe(first.name);
    await testApi.clock.set(next[0]!.scheduleTime + 1_000);
    const three = await boardSoon(emulators, testApi, ORG_A.id, testBoard(t.testId), (r) => r.length === 3, '3 rows');

    for (let run = 1; run <= 2; run++)
      await runLeaderboardTask(request, { orgId: ORG_A.id, testId: t.testId, seriesId: t.seriesId });
    const again = await storedBoard(emulators, ORG_A.id, testBoard(t.testId));
    expect(again!.rows, 'running the handler again stores the same rows').toEqual(three);
  });

  test('LB-04 in a flexible window the test leaderboard and the rank open to students only after the window closes', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    await freezeClock(testApi);
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      timingMode: 'flexible',
      windowMin: 60,
      durationMin: 30,
      overrides: { resultRelease: 'immediate', resultDetail: 'score', testLeaderboard: true },
    });
    await signInAs(accounts.studentA);
    const me = await apiAs(accounts.studentA);
    const myAttempt = await sitAndSubmit(me, testApi, t.testId, RIGHT2);
    await sitAndSubmit(await apiAs(studentOfA(2)), testApi, t.testId, RIGHT3);
    await testApi.clock.advance(31_000);
    await boardSoon(emulators, testApi, ORG_A.id, testBoard(t.testId), (r) => r.length === 2, '2 rows');

    expectApiError(await getBoard(me, testBoard(t.testId)), 404, 'LEADERBOARD_NOT_AVAILABLE');
    const admin = await apiAs(accounts.adminA);
    const adminView = await getBoard(admin, testBoard(t.testId));
    expect(adminView.status).toBe(200);
    expect(adminView.body.rows).toHaveLength(2);

    const result = new StudentResultPage(page);
    await result.goto(myAttempt, HEADING);
    await expect(result.inResult(RESULT_TEXTS.rankAfterClose(t.window.end))).toBeVisible();
    await expect(result.rankLine).toHaveCount(0);
    const boards = new StudentLeaderboardsPage(page);
    await boards.goto();
    await expectEmptyState(boards.main, LEADERBOARDS_EMPTY.sentence, LEADERBOARDS_EMPTY.action);
    const board = new LeaderboardPage(page);
    await page.goto(LeaderboardPage.url(testBoard(t.testId)));
    await expect(board.notAvailable).toBeVisible();
    await expect(board.notAvailableText).toBeVisible();
    await expect(board.back).toHaveAttribute('href', /\/student\/leaderboards\/?$/);
    await expect(board.table).toHaveCount(0);

    await testApi.clock.set(t.window.end + 1_000);
    await testApi.tasks.runDue();
    const open = await getBoard(me, testBoard(t.testId));
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    expect(open.body.me).toMatchObject({ rank: 2 });
    expect(open.body.total).toBe(2);
    await result.goto(myAttempt, HEADING);
    await expect(result.inResult(RESULT_TEXTS.rank(2, 2))).toBeVisible();
    await expect(result.inResult(RESULT_TEXTS.rankAfterClose(t.window.end))).toHaveCount(0);
    await boards.goto();
    await expect(boards.item(HEADING)).toContainText('Test leaderboard');
    await boards.link(HEADING).click();
    await expect(board.heading(HEADING)).toBeVisible();
    await expect(board.ownRank(2, 2)).toBeVisible();
  });

  test('LB-04 with the test leaderboard off students get no board and no rank, while admins still see every row', async ({
    page,
    signInAs,
    request,
    apiAs,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { resultRelease: 'immediate' } });
    await signInAs(accounts.studentA);
    const me = await apiAs(accounts.studentA);
    const attemptId = await sitAndSubmit(me, testApi, t.testId, RIGHT2);
    await runLeaderboardTask(request, { orgId: ORG_A.id, testId: t.testId, seriesId: t.seriesId });

    expectApiError(await getBoard(me, testBoard(t.testId)), 404, 'LEADERBOARD_NOT_AVAILABLE');
    expectApiError(await getBoard(me, seriesBoard(t.seriesId)), 404, 'LEADERBOARD_NOT_AVAILABLE');
    const adminView = await getBoard(await apiAs(accounts.adminA), testBoard(t.testId));
    expect(adminView.status).toBe(200);
    expect(adminView.body.rows.map((r) => r.name)).toEqual([studentName(1)]);

    const result = new StudentResultPage(page);
    await result.goto(attemptId, HEADING);
    await expect(result.inResult(scoreText(2, 4))).toBeVisible();
    await expect(result.rankLine).toHaveCount(0);
    await expect(result.inResult(RESULT_TEXTS.notRanked)).toHaveCount(0);
    const boards = new StudentLeaderboardsPage(page);
    await boards.goto();
    await expectEmptyState(boards.main, LEADERBOARDS_EMPTY.sentence, LEADERBOARDS_EMPTY.action);
  });

  test('LB-02 US-ST-09 the series leaderboard sums released tests, counts a missed test as 0 and leaves terminated attempts out', async ({
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
      defaults: { seriesLeaderboard: true, resultRelease: 'manual' },
    });
    const quant = await testApi.seedExamTest({ orgId: ORG_A.id, seriesId, opensInMin: -1440 });
    const verbal = await testApi.seedExamTest({ orgId: ORG_A.id, seriesId, title: 'Verbal ability' });
    await testApi.seedGradedAttempts(ORG_A.id, quant.testId, [
      { studentId: id(1), score: 3, timeSec: 600 },
      { studentId: id(2), score: 4, timeSec: 600 },
      { studentId: id(3), score: 2, timeSec: 600 },
      { studentId: id(4), score: 4, timeSec: 300, status: 'terminated', strikesCount: 3 },
    ]);
    await testApi.seedGradedAttempts(ORG_A.id, verbal.testId, [
      { studentId: id(1), score: 2, timeSec: 600 },
      { studentId: id(2), score: 0, timeSec: 600 },
      { studentId: id(4), score: 4, timeSec: 600 },
      { studentId: id(5), score: 3, timeSec: 600 },
    ]);
    await signInAs(accounts.studentA);
    const adminPage = await newSession(accounts.adminA);
    const admin = await apiAs(accounts.adminA);
    const student = await apiAs(accounts.studentA);
    expectApiError(await getBoard(student, seriesBoard(seriesId)), 404, 'LEADERBOARD_NOT_AVAILABLE');

    await expectReleased(admin, quant.testId);
    const firstOnly = await boardSoon(
      emulators,
      testApi,
      ORG_A.id,
      seriesBoard(seriesId),
      (r) => r.length === 3,
      'Day 1 only',
    );
    expect(firstOnly.map((r) => [r.studentId, r.score, r.rank])).toEqual([
      [id(2), 4, 1],
      [id(1), 3, 2],
      [id(3), 2, 3],
    ]);

    await expectReleased(admin, verbal.testId);
    const both = await boardSoon(
      emulators,
      testApi,
      ORG_A.id,
      seriesBoard(seriesId),
      (r) => r.length === 5,
      'both days',
    );
    expect(both.map((r) => [r.studentId, r.score, r.rank])).toEqual([
      [id(1), 5, 1],
      [id(2), 4, 2],
      [id(4), 4, 2], // Day 1 terminated: only Day 2 counts
      [id(5), 3, 4], // missed Day 1: counts 0
      [id(3), 2, 5], // missed Day 2: counts 0
    ]);

    const boards = new StudentLeaderboardsPage(page);
    await boards.goto();
    await expect(boards.list.getByRole('listitem')).toHaveCount(1);
    await expect(boards.item('Placement 2026')).toContainText('Series leaderboard');
    await boards.link('Placement 2026').click();
    const board = new LeaderboardPage(page);
    await expect(board.heading('Placement 2026')).toBeVisible();
    await expect(board.ownRank(1, 5)).toBeVisible();
    expect(await headerTexts(board.table)).toEqual(SERIES_COLUMNS);
    expect(await tableTexts(board.table)).toEqual([
      ['1', `${studentName(1)} (you)`, dept(1), '5'],
      ['2', studentName(2), dept(2), '4'],
      ['2', studentName(4), dept(4), '4'],
      ['4', studentName(5), dept(5), '3'],
      ['5', studentName(3), dept(3), '2'],
    ]);
    const view = await getBoard(student, seriesBoard(seriesId));
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ kind: 'series', title: 'Placement 2026', total: 5 });
    expect(view.body.me).toMatchObject({ rank: 1, score: 5 });

    const seriesPage = new AdminSeriesResults(adminPage);
    await seriesPage.goto(seriesId, 'Placement 2026');
    expect(await headerTexts(seriesPage.leaderboard)).toEqual(SERIES_COLUMNS);
    await expect(dataRows(seriesPage.leaderboard)).toHaveCount(5);
    await expectNoSeriousA11yViolations(adminPage);
  });

  test('ORG-05 ORG-14 FF-02 leaderboards: org B gets 404, a super admin in org A sees every row, and with Leaderboards off the API answers 403', async ({
    page,
    signInAs,
    request,
    apiAs,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { resultRelease: 'immediate', testLeaderboard: true },
    });
    await testApi.seedGradedAttempts(ORG_A.id, t.testId, [
      { studentId: id(1), score: 3, timeSec: 600 },
      { studentId: id(2), score: 2, timeSec: 600 },
    ]);
    await runLeaderboardTask(request, { orgId: ORG_A.id, testId: t.testId, seriesId: t.seriesId });
    await signInAs(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const mine = await getBoard(student, testBoard(t.testId));
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.me).toMatchObject({ rank: 1 });

    expectApiError(await getBoard(await apiAs(accounts.adminB), testBoard(t.testId)), 404);
    expectApiError(await getBoard(await apiAs(accounts.studentB), testBoard(t.testId)), 404);
    const superAdmin = await apiAs(accounts.superAdmin);
    const superView = await getBoard(superAdmin.inOrg(ORG_A.id), testBoard(t.testId));
    expect(superView.status, JSON.stringify(superView.body)).toBe(200);
    expect(superView.body.rows).toHaveLength(2);
    expect(superView.body.me).toBeNull();

    await setFeature(superAdmin, ORG_A.id, 'public_leaderboards', false);
    expectApiError(await getBoard(student, testBoard(t.testId)), 403, 'FEATURE_DISABLED');
    expectApiError(await getBoard(await apiAs(accounts.adminA), testBoard(t.testId)), 403, 'FEATURE_DISABLED');
    const boards = new StudentLeaderboardsPage(page);
    await boards.goto();
    await expect(boards.text(LEADERBOARDS_OFF)).toBeVisible();
    await expect(boards.list).toHaveCount(0);
  });
});
