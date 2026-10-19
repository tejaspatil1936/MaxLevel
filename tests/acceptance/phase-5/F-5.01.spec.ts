import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { expectApiError, postEvent, startAttempt, windowText } from '../fixtures/exam';
import { EXAM_HEADING } from '../fixtures/exam-session';
import {
  countTexts,
  expectLiveRecord,
  getTestAttempts,
  LIVE_STATUS,
  LIVE_TEXTS,
  reservePairing,
  submitAutomatically,
  timeLeftPattern,
} from '../fixtures/live';
import { recordApiCalls } from '../fixtures/network';
import { answer, strike, submit } from '../fixtures/results';
import { accounts, departmentId, ORG_A, seededStudent, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ExamScreen } from '../pages/exam-screen';
import { LIVE_FILTERS, LIVE_LINK, LiveDashboard, LiveExamsPage, ROSTER_COLUMNS } from '../pages/live-pages';
import { PhonePage } from '../pages/phone-page';
import { pathPattern } from '../pages/paths';
import { expectShellRules } from '../pages/shell';
import { expectOnStudentHome } from '../pages/student-pages';
import { expectEmptyState } from '../pages/ui';

// F-5.01 Live dashboard and Realtime Database mirror (OPS-01, OPS-03, US-AD-11; OPS-02 and PERF-04 as far as the
// browser and the stored mirror show them). Contract: docs/testids/phase-5.md, "Live mirror", "Live exams" and
// "Live view".

const name = (n: number) => studentOfA(n).name;
const prn = (n: number) => seededStudent(ORG_A, n).prn;
/** Odd-numbered org A students graduate in 2026: 1, 3, 5, … 19 (ten students). */
const CLASS_OF_2026 = { seriesEligibility: { graduationYears: [2026] } };
/** Computer is every fourth org A student: 1, 5, 9, 13, 17. */
const COMPUTER = { seriesEligibility: { departmentIds: [departmentId(ORG_A, 'Computer')] } };
const FIVE_SECONDS = 5_000;

test.describe('F-5.01 live dashboard', () => {
  test('OPS-01 OPS-02 US-AD-11 the live view counts every status and lists each student with answered, strikes, phone, last seen and time left', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    rtdb,
  }) => {
    test.setTimeout(120_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...CLASS_OF_2026, overrides: { secondCamera: true } });

    const aarav = await apiAs(studentOfA(1));
    const a1 = await startAttempt(aarav, t.testId);
    await answer(aarav, testApi, a1, { 0: '20 m/s', 1: '25' });
    const rohan = await apiAs(studentOfA(3));
    const a3 = await startAttempt(rohan, t.testId);
    expect((await postEvent(rohan, a3.attempt.id, 'tab_hidden', await testApi.clock.now())).body.strikesCount).toBe(1);
    const vihaan = await apiAs(studentOfA(5));
    const a5 = await startAttempt(vihaan, t.testId);
    await submit(vihaan, a5.attempt.id);
    const arjun = await apiAs(studentOfA(7));
    const a7 = await startAttempt(arjun, t.testId);
    await submitAutomatically(arjun, a7.attempt.id);
    const siddharth = await apiAs(studentOfA(9));
    const a9 = await startAttempt(siddharth, t.testId);
    expect(await strike(siddharth, testApi, a9.attempt.id, 3)).toBe('terminated');
    const aditya = await apiAs(studentOfA(11));
    const reserved = await reservePairing(aditya, t.testId);

    // What the API mirrored into Realtime Database (OPS-02).
    await expectLiveRecord(rtdb, ORG_A.id, t.testId, a1.attempt.id, {
      name: name(1),
      prn: prn(1),
      status: 'in_progress',
      answered: 2,
      total: 4,
      strikes: 0,
      deadlineAt: a1.attempt.deadlineAt,
    });
    await expectLiveRecord(rtdb, ORG_A.id, t.testId, a3.attempt.id, { status: 'in_progress', strikes: 1, answered: 0 });
    await expectLiveRecord(rtdb, ORG_A.id, t.testId, a5.attempt.id, { status: 'submitted' });
    await expectLiveRecord(rtdb, ORG_A.id, t.testId, a7.attempt.id, { status: 'auto_submitted' });
    await expectLiveRecord(rtdb, ORG_A.id, t.testId, a9.attempt.id, { status: 'terminated', strikes: 3 });
    await expectLiveRecord(rtdb, ORG_A.id, t.testId, reserved.attemptId, { status: 'pairing', name: name(11) });

    await signInAs(accounts.adminA);
    const shell = new LiveExamsPage(page).shell;
    await shell.navLink(LIVE_LINK.name).click();
    await expect(page).toHaveURL(pathPattern(LIVE_LINK.path));
    const list = new LiveExamsPage(page);
    await expect(list.heading).toBeVisible();
    await expect(list.row(EXAM_HEADING)).toContainText(windowText(t.window.start, t.window.end));
    await list.testLink(EXAM_HEADING).click();

    const live = new LiveDashboard(page);
    await live.expectShown(EXAM_HEADING);
    await expect(page).toHaveURL(pathPattern('/admin/live/'));
    await live.expectCounts(
      countTexts({
        eligible: 10,
        notStarted: 4,
        pairing: 1,
        inProgress: 2,
        submitted: 1,
        autoSubmitted: 1,
        terminated: 1,
      }),
    );
    await expect(live.roster.getByRole('columnheader')).toHaveText(ROSTER_COLUMNS.map((c) => c));
    await expect(live.rows).toHaveCount(10);
    for (const f of LIVE_FILTERS) await expect(live.filter(f)).toHaveAttribute('aria-pressed', 'false');

    await live.expectRow(name(1), {
      PRN: prn(1),
      Status: LIVE_STATUS.inProgress,
      Answered: '2 / 4',
      Strikes: '0',
      Phone: 'Disconnected',
      'Last seen': 'Not seen',
      'Time left': await timeLeftPattern(testApi, a1.attempt.deadlineAt),
    });
    await live.expectRow(name(3), { Status: LIVE_STATUS.inProgress, Answered: '0 / 4', Strikes: '1' });
    await live.expectRow(name(5), { Status: LIVE_STATUS.submitted, 'Time left': '', 'Last seen': '' });
    await live.expectRow(name(7), { Status: LIVE_STATUS.autoSubmitted });
    await live.expectRow(name(9), { Status: LIVE_STATUS.terminated, Strikes: '3' });
    await live.expectRow(name(11), { Status: LIVE_STATUS.pairing, Answered: '', Strikes: '', Phone: 'Disconnected' });
    for (const n of [13, 15, 17, 19])
      await live.expectRow(name(n), { PRN: prn(n), Status: LIVE_STATUS.notStarted, Answered: '', Strikes: '' });
    await expect(live.actionsButton(name(13)), 'no actions before a start').toHaveCount(0);
    await expect(live.actionsButton(name(11)), 'no actions while pairing').toHaveCount(0);
    await expect(live.actionsButton(name(1))).toBeVisible();
    await expect(live.main.getByRole('button', { name: /extra time for all/i }), 'OPS-05 is not built').toHaveCount(0);

    await expectNoSeriousA11yViolations(page);
    await expectShellRules(page, 'live view');
  });

  test('US-AD-11 PERF-04 a student starting, answering, getting a strike and submitting reaches the open live view within 5 seconds, without the page asking the API', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const aarav = await apiAs(studentOfA(1));
    const a1 = await startAttempt(aarav, t.testId);
    const vihaan = await apiAs(studentOfA(5));

    await signInAs(accounts.adminA);
    const live = new LiveDashboard(page);
    await live.goto(t.testId, EXAM_HEADING);
    await live.expectCounts(
      countTexts({
        eligible: 5,
        notStarted: 4,
        pairing: 0,
        inProgress: 1,
        submitted: 0,
        autoSubmitted: 0,
        terminated: 0,
      }),
    );
    await live.expectRow(name(5), { Status: LIVE_STATUS.notStarted });
    const calls = recordApiCalls(page);

    const a5 = await startAttempt(vihaan, t.testId);
    await live.expectRow(name(5), { Status: LIVE_STATUS.inProgress, Answered: '0 / 4' }, FIVE_SECONDS);
    await live.expectCounts(
      countTexts({
        eligible: 5,
        notStarted: 3,
        pairing: 0,
        inProgress: 2,
        submitted: 0,
        autoSubmitted: 0,
        terminated: 0,
      }),
      FIVE_SECONDS,
    );

    await answer(aarav, testApi, a1, { 0: '20 m/s' });
    await live.expectRow(name(1), { Answered: '1 / 4' }, FIVE_SECONDS);

    expect((await postEvent(aarav, a1.attempt.id, 'fullscreen_exit', await testApi.clock.now())).status).toBe(200);
    await live.expectRow(name(1), { Strikes: '1' }, FIVE_SECONDS);

    await submit(vihaan, a5.attempt.id);
    await live.expectRow(name(5), { Status: LIVE_STATUS.submitted }, FIVE_SECONDS);
    await live.expectCounts(
      countTexts({
        eligible: 5,
        notStarted: 3,
        pairing: 0,
        inProgress: 1,
        submitted: 1,
        autoSubmitted: 0,
        terminated: 0,
      }),
      FIVE_SECONDS,
    );

    expect(
      calls().filter((c) => /^\w+ \/v1\/(tests|attempts)\b/.test(c)),
      'live updates came from Realtime Database, not API requests',
    ).toEqual([]);
  });

  test('OPS-03 filters keep students with strikes, a disconnected phone, offline for more than 60 s, not started or terminated', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    newSession,
    newPhone,
    rtdb,
  }) => {
    test.setTimeout(150_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER, overrides: { secondCamera: true } });

    // Aarav: phone paired, exam open in his own browser, so laptop and phone are online.
    const studentPage = await newSession(accounts.studentA);
    const aarav = await apiAs(accounts.studentA);
    const pairing = await reservePairing(aarav, t.testId);
    const phone = new PhonePage(await newPhone());
    await phone.open(pairing.url);
    await phone.expectConnected();
    const a1 = await startAttempt(aarav, t.testId);
    expect(a1.attempt.id).toBe(pairing.attemptId);
    const exam = new ExamScreen(studentPage);
    await exam.gotoAttempt(a1.attempt.id, EXAM_HEADING);
    await expect(exam.phoneStatus('Phone connected')).toBeVisible();
    await rtdb.expectPresence(ORG_A.id, t.testId, a1.attempt.id, 'laptop', { online: true });
    await rtdb.expectPresence(ORG_A.id, t.testId, a1.attempt.id, 'phone', { online: true });

    // Vihaan: started through the API only (no laptop, no phone), one strike.
    const vihaan = await apiAs(studentOfA(5));
    const a5 = await startAttempt(vihaan, t.testId);
    expect((await postEvent(vihaan, a5.attempt.id, 'window_blur', await testApi.clock.now())).status).toBe(200);
    // Siddharth: ended after three strikes.
    const siddharth = await apiAs(studentOfA(9));
    const a9 = await startAttempt(siddharth, t.testId);
    expect(await strike(siddharth, testApi, a9.attempt.id, 3)).toBe('terminated');
    // Omkar (13) and Yash (17) have not started. Over a minute passes on the server.
    await testApi.clock.advance(61_000);

    await signInAs(accounts.adminA);
    const live = new LiveDashboard(page);
    await live.goto(t.testId, EXAM_HEADING);
    await live.expectNameSet([name(1), name(5), name(9), name(13), name(17)]);
    await live.expectRow(name(1), { Phone: 'Connected', 'Last seen': 'Online' });
    await live.expectRow(name(5), { Phone: 'Disconnected', 'Last seen': 'Not seen', Strikes: '1' });

    await live.setFilter('With strikes', true);
    await live.expectNameSet([name(5), name(9)]);
    await live.setFilter('With strikes', false);

    await live.setFilter('Phone disconnected', true);
    await live.expectNameSet([name(5)]);
    await live.setFilter('Phone disconnected', false);

    await live.setFilter('Offline for more than 60 s', true);
    await live.expectNameSet([name(5)]);
    await live.setFilter('Offline for more than 60 s', false);

    await live.setFilter('Not started', true);
    await live.expectNameSet([name(13), name(17)]);
    await live.setFilter('Not started', false);

    await live.setFilter('Terminated', true);
    await live.expectNameSet([name(9)]);
    // Several filters: a row must match every one.
    await live.setFilter('With strikes', true);
    await live.expectNameSet([name(9)]);
    await live.setFilter('Not started', true);
    await expectEmptyState(live.main, LIVE_TEXTS.noMatch.sentence, LIVE_TEXTS.noMatch.action);
    await live.empty.getByRole('button', { name: LIVE_TEXTS.noMatch.action, exact: true }).click();
    for (const f of LIVE_FILTERS) await expect(live.filter(f)).toHaveAttribute('aria-pressed', 'false');
    await live.expectNameSet([name(1), name(5), name(9), name(13), name(17)]);

    await live.search.fill(prn(13));
    await live.expectNameSet([name(13)]);
    await live.search.fill('yash');
    await live.expectNameSet([name(17)]);
  });

  test('OPS-03 sorting on a column orders the roster ascending then descending, empty cells last', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const aarav = await apiAs(studentOfA(1));
    const a1 = await startAttempt(aarav, t.testId);
    await answer(aarav, testApi, a1, { 0: '20 m/s', 1: '30' });
    const vihaan = await apiAs(studentOfA(5));
    const a5 = await startAttempt(vihaan, t.testId);
    expect((await postEvent(vihaan, a5.attempt.id, 'window_blur', await testApi.clock.now())).status).toBe(200);
    const siddharth = await apiAs(studentOfA(9));
    const a9 = await startAttempt(siddharth, t.testId);
    expect(await strike(siddharth, testApi, a9.attempt.id, 3)).toBe('terminated');

    await signInAs(accounts.adminA);
    const live = new LiveDashboard(page);
    await live.goto(t.testId, EXAM_HEADING);
    await expect(live.columnHeader('Student')).toHaveAttribute('aria-sort', 'ascending');
    await live.expectNames([name(1), name(13), name(9), name(5), name(17)]);

    await live.sortButton('Strikes').click();
    await expect(live.columnHeader('Strikes')).toHaveAttribute('aria-sort', 'ascending');
    await live.expectNames([name(1), name(5), name(9), name(13), name(17)]);
    await live.sortButton('Strikes').click();
    await expect(live.columnHeader('Strikes')).toHaveAttribute('aria-sort', 'descending');
    await live.expectNames([name(9), name(5), name(1), name(13), name(17)]);

    await live.sortButton('Answered').click();
    await live.sortButton('Answered').click();
    await expect(live.columnHeader('Answered')).toHaveAttribute('aria-sort', 'descending');
    await live.expectNames([name(1), name(9), name(5), name(13), name(17)]);

    await live.sortButton('Student').click();
    await live.sortButton('Student').click();
    await expect(live.columnHeader('Student')).toHaveAttribute('aria-sort', 'descending');
    await live.expectNames([name(17), name(5), name(9), name(13), name(1)]);
  });

  test('OPS-01 with no live test the live exams page says so, and a test nobody has started shows every student as not started', async ({
    page,
    signInAs,
    testApi,
  }) => {
    await testApi.seedExamTest({ orgId: ORG_A.id, title: 'Later today', opensInMin: 120 });
    await signInAs(accounts.adminA);
    const list = new LiveExamsPage(page);
    await list.goto();
    await expectEmptyState(list.shell.main, LIVE_TEXTS.listEmpty.sentence, LIVE_TEXTS.listEmpty.action);
    await expect(list.shell.main.getByRole('link', { name: LIVE_TEXTS.listEmpty.action, exact: true })).toHaveAttribute(
      'href',
      /\/admin\/series\/?$/,
    );

    await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    await page.reload();
    await expect(list.rows).toHaveCount(1);
    await list.testLink(EXAM_HEADING).click();
    const live = new LiveDashboard(page);
    await live.expectShown(EXAM_HEADING);
    await live.expectCounts(
      countTexts({
        eligible: 5,
        notStarted: 5,
        pairing: 0,
        inProgress: 0,
        submitted: 0,
        autoSubmitted: 0,
        terminated: 0,
      }),
    );
    await expect(live.rows).toHaveCount(5);
    for (const n of [1, 5, 9, 13, 17])
      await live.expectRow(name(n), { Status: LIVE_STATUS.notStarted, 'Time left': '' });
    await expect(live.roster.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
  });

  test('OPS-02 ORG-05 ORG-14 only admins of the organization see the live view: org B gets Test not found and 404, a super admin sees it, a student is sent home', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    newSession,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const aarav = await apiAs(studentOfA(1));
    const a1 = await startAttempt(aarav, t.testId);

    await signInAs(accounts.adminB);
    const live = new LiveDashboard(page);
    await page.goto(LiveDashboard.url(t.testId));
    await expect(live.shell.heading('Test not found')).toBeVisible();
    await expect(
      live.main.getByText(LIVE_TEXTS.notFoundText('College of Engineering Pune'), { exact: true }),
    ).toBeVisible();
    await expect(live.main.getByRole('link', { name: 'Back to live exams', exact: true })).toHaveAttribute(
      'href',
      /\/admin\/live\/?$/,
    );
    await expect(live.main.getByText(name(1))).toHaveCount(0);
    await expect(live.roster).toHaveCount(0);

    expectApiError(await getTestAttempts(await apiAs(accounts.adminB), t.testId), 404);
    expectApiError(await getTestAttempts(aarav, t.testId), 403);
    const asSuper = await getTestAttempts(await apiAs(accounts.superAdmin, { orgId: ORG_A.id }), t.testId);
    expect(asSuper.status, JSON.stringify(asSuper.body)).toBe(200);
    expect(asSuper.body.items.map((i) => i.id)).toEqual([a1.attempt.id]);
    const asAdmin = await getTestAttempts(await apiAs(accounts.adminA), t.testId);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.items[0]).toMatchObject({ id: a1.attempt.id, status: 'in_progress', extraTimeSec: 0 });

    const superPage = await newSession(accounts.superAdmin);
    const superLive = new LiveDashboard(superPage);
    await superLive.shell.enterOrg(ORG_A.name);
    await superLive.goto(t.testId, EXAM_HEADING);
    await superLive.expectRow(name(1), { Status: LIVE_STATUS.inProgress });

    const studentPage = await newSession(accounts.studentA);
    await studentPage.goto(LIVE_LINK.path);
    await expectOnStudentHome(studentPage);
  });
});
