import { BASIC_QUESTIONS, optionName } from '../fixtures/authoring';
import {
  expectApiError,
  leaksAnswerKey,
  listEvents,
  postEvent,
  postStart,
  startAttempt,
  storedAnswers,
  storedAttempt,
} from '../fixtures/exam';
import { EXAM_HEADING } from '../fixtures/exam-session';
import {
  attemptAudit,
  attemptIndex,
  countTexts,
  expectAttemptStatus,
  getTestAttempts,
  LIVE_ERRORS,
  LIVE_STATUS,
  LIVE_TEXTS,
  MIN,
  postAttemptAction,
  timelineItemPattern,
} from '../fixtures/live';
import { answer, submit } from '../fixtures/results';
import { accounts, departmentId, ORG_A, seededStudent, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { SubmittedPage } from '../pages/exam-flow';
import { ExamScreen } from '../pages/exam-screen';
import { LiveDashboard, ResetAttemptScreen, type RowAction } from '../pages/live-pages';
import { StudentTestPage } from '../pages/student-pages';
import { expectConfirmLayout, expectFieldError } from '../pages/ui';

// F-5.04 Reset, terminate, reinstate and event timeline (OPS-04, US-AD-13; OPS-10 through what the browser and the
// stored attempts show). Contract: docs/testids/phase-5.md, "Row actions menu", "Timeline drawer", "Terminate,
// reinstate and reset" and "Student screens".

const COMPUTER = { seriesEligibility: { departmentIds: [departmentId(ORG_A, 'Computer')] } };
const AARAV = accounts.studentA.name;
const FIVE_SECONDS = 5_000;
const BASIC_EXPLANATIONS = BASIC_QUESTIONS.flatMap((q) => (q.explanation ? [q.explanation] : []));
const IN_PROGRESS_ITEMS: RowAction[] = ['View timeline', 'Grant extra time', 'Reset attempt', 'Terminate attempt'];

test.describe('F-5.04 row actions', () => {
  test('OPS-04 View timeline lists the attempt events in server-time order with counted strikes', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const aarav = await apiAs(accounts.studentA);
    const a1 = await startAttempt(aarav, t.testId);
    const id = a1.attempt.id;
    expect((await postEvent(aarav, id, 'window_blur', await testApi.clock.now())).body.counted).toBe(true);
    expect((await postEvent(aarav, id, 'tab_hidden', await testApi.clock.now())).body.counted).toBe(false);
    await testApi.clock.advance(4_000);
    expect((await postEvent(aarav, id, 'fullscreen_exit', await testApi.clock.now())).body.strikesCount).toBe(2);
    expect((await postEvent(aarav, id, 'context_menu', await testApi.clock.now())).status).toBe(200);
    await startAttempt(await apiAs(studentOfA(5)), t.testId);
    const events = await listEvents(await apiAs(accounts.adminA), id);
    expect(events.map((e) => e.type)).toEqual(['window_blur', 'tab_hidden', 'fullscreen_exit', 'context_menu']);

    await signInAs(accounts.adminA);
    const live = new LiveDashboard(page);
    await live.goto(t.testId, EXAM_HEADING);
    const menu = await live.openActions(AARAV);
    await expect(menu.getByRole('menuitem')).toHaveText(IN_PROGRESS_ITEMS);
    await live.menuItem('View timeline').click();
    const timeline = live.timeline(AARAV);
    await expect(timeline.dialog).toBeVisible();
    await expect(timeline.items).toHaveText(events.map((e) => timelineItemPattern(e.serverTs, e.type, e.strikeNumber)));
    await expect(timeline.items.nth(0)).toContainText('Strike 1');
    await expect(timeline.items.nth(1)).not.toContainText('Strike');
    await expect(timeline.items.nth(2)).toContainText('Strike 2');
    // Non-modal: the roster stays in view behind the drawer.
    await expect(live.roster).toBeVisible();
    await timeline.close.click();
    await expect(timeline.dialog).toBeHidden();
    await expect(live.actionsButton(AARAV)).toBeFocused();

    await live.choose(studentOfA(5).name, 'View timeline');
    const empty = live.timeline(studentOfA(5).name);
    await expect(empty.noEvents).toBeVisible();
    await expect(empty.events).toHaveCount(0);
  });

  test('OPS-04 RES-06 terminating with a reason ends the attempt for the student, and reinstating lets them continue with their answers', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    newSession,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const studentPage = await newSession(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const payload = await startAttempt(student, t.testId);
    const id = payload.attempt.id;
    const exam = new ExamScreen(studentPage);
    await exam.gotoAttempt(id, EXAM_HEADING);
    await exam.choose(optionName(BASIC_QUESTIONS[0]!, 0));
    await exam.expectSaved();

    await signInAs(accounts.adminA);
    const live = new LiveDashboard(page);
    await live.goto(t.testId, EXAM_HEADING);
    await live.choose(AARAV, 'Terminate attempt');
    const end = live.reasonDialog('terminate', AARAV);
    await expect(end.dialog).toBeVisible();
    await expect(end.text(LIVE_TEXTS.terminateText)).toBeVisible();
    await expectConfirmLayout(end.dialog, 'Terminate attempt', true);
    await end.confirm.click();
    await expectFieldError(end.dialog, end.reason, LIVE_ERRORS.terminateReason);
    expect((await storedAttempt(emulators, ORG_A.id, id)).status).toBe('in_progress');
    await end.reason.fill('Phone seen on the desk');
    await end.confirm.click();
    await expect(live.notice(LIVE_TEXTS.terminated)).toBeVisible();
    await live.expectRow(AARAV, { Status: LIVE_STATUS.terminated }, FIVE_SECONDS);
    await live.expectCounts(
      countTexts({
        eligible: 5,
        notStarted: 4,
        pairing: 0,
        inProgress: 0,
        submitted: 0,
        autoSubmitted: 0,
        terminated: 1,
      }),
      FIVE_SECONDS,
    );
    const ended = await storedAttempt(emulators, ORG_A.id, id);
    expect(ended).toMatchObject({ status: 'terminated', terminationReason: 'Phone seen on the desk' });
    expect(ended.result, 'graded on termination').toMatchObject({ correct: 1 });
    const endAudit = await attemptAudit(emulators, ORG_A.id, 'attempt.terminate', id);
    expect(endAudit).toHaveLength(1);
    expect(endAudit[0]!.data).toMatchObject({
      actor: { email: accounts.adminA.email },
      after: { reason: 'Phone seen on the desk' },
    });

    // Opening the attempt again shows the ended screen with the admin's reason (RES-06).
    await studentPage.reload();
    const submitted = new SubmittedPage(studentPage);
    await submitted.expectShown(id, 'Your test was ended');
    await expect(submitted.text(LIVE_TEXTS.endedByAdmin('Phone seen on the desk'))).toBeVisible();

    const menu = await live.openActions(AARAV);
    await expect(menu.getByRole('menuitem')).toHaveText(['View timeline', 'Reset attempt', 'Reinstate attempt']);
    await live.menuItem('Reinstate attempt').click();
    const back = live.reasonDialog('reinstate', AARAV);
    await expect(back.text(LIVE_TEXTS.reinstateText(payload.attempt.deadlineAt))).toBeVisible();
    await expectConfirmLayout(back.dialog, 'Reinstate attempt', false);
    await back.confirm.click();
    await expectFieldError(back.dialog, back.reason, LIVE_ERRORS.reinstateReason);
    await back.reason.fill('Reviewed the recording: a false alarm');
    await back.confirm.click();
    await expect(live.notice(LIVE_TEXTS.reinstated)).toBeVisible();
    await live.expectRow(AARAV, { Status: LIVE_STATUS.inProgress, Answered: '1 / 4' }, FIVE_SECONDS);

    const reinstated = await storedAttempt(emulators, ORG_A.id, id);
    expect(reinstated).toMatchObject({ status: 'in_progress', deadlineAt: payload.attempt.deadlineAt });
    expect(reinstated.terminationReason ?? null).toBeNull();
    expect(reinstated.result ?? null).toBeNull();
    expect(Object.keys(await storedAnswers(emulators, ORG_A.id, id))).toEqual([payload.questions[0]!.id]);
    expect(await attemptAudit(emulators, ORG_A.id, 'attempt.reinstate', id)).toHaveLength(1);
    const resumed = await student.get(`/v1/attempts/${id}`);
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
    expect(leaksAnswerKey(resumed.body, BASIC_EXPLANATIONS), 'no answer key after a reinstate (DATA-05)').toEqual([]);

    await exam.gotoAttempt(id, EXAM_HEADING);
    await expect(exam.option(optionName(BASIC_QUESTIONS[0]!, 0))).toBeChecked();
    await exam.saveAndNext.click();
    await exam.choose(optionName(BASIC_QUESTIONS[1]!, 1));
    await exam.expectSaved();
  });

  test('OPS-10 US-AD-13 reset needs a reason, keeps the old attempt as reset, and the student starts again with a new draw and the slot end as deadline', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    newSession,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const studentPage = await newSession(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const first = await startAttempt(student, t.testId);
    const oldId = first.attempt.id;
    await answer(student, testApi, first, { 0: '20 m/s', 1: '30' });
    // Past the 15-minute late-entry cutoff (DECISIONS Q25).
    await testApi.clock.advance(20 * MIN);

    await signInAs(accounts.adminA);
    const live = new LiveDashboard(page);
    await live.goto(t.testId, EXAM_HEADING);
    await live.choose(AARAV, 'Reset attempt');
    const reset = live.reasonDialog('reset', AARAV);
    await expect(reset.text(LIVE_TEXTS.resetText)).toBeVisible();
    await expectConfirmLayout(reset.dialog, 'Reset attempt', true);
    await reset.confirm.click();
    await expectFieldError(reset.dialog, reset.reason, LIVE_ERRORS.resetReason);
    expect((await storedAttempt(emulators, ORG_A.id, oldId)).status).toBe('in_progress');
    await reset.reason.fill('Laptop crashed during the test');
    await reset.confirm.click();
    await expect(live.notice(LIVE_TEXTS.reset)).toBeVisible();
    await live.expectRow(AARAV, { Status: LIVE_STATUS.notStarted, Answered: '' }, FIVE_SECONDS);
    await expect(live.actionsButton(AARAV)).toHaveCount(0);
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
      FIVE_SECONDS,
    );

    const old = await storedAttempt(emulators, ORG_A.id, oldId);
    expect(old).toMatchObject({ status: 'reset', resetReason: 'Laptop crashed during the test' });
    expect(typeof old.resetAt).toBe('number');
    expect(typeof old.resetBy).toBe('string');
    expect(old.draw, 'old draw kept').toMatchObject({ questionIds: first.questions.map((q) => q.id) });
    expect(Object.keys(await storedAnswers(emulators, ORG_A.id, oldId)).sort(), 'old answers kept').toEqual(
      [first.questions[0]!.id, first.questions[1]!.id].sort(),
    );
    const audit = await attemptAudit(emulators, ORG_A.id, 'attempt.reset', oldId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data).toMatchObject({
      actor: { email: accounts.adminA.email, role: 'admin' },
      after: { reason: 'Laptop crashed during the test' },
    });
    expect(
      (await attemptIndex(emulators, ORG_A.id, t.testId, seededStudent(ORG_A, 1).id))?.activeAttemptId ?? null,
    ).not.toBe(oldId);

    // The student: the old attempt says it was reset, and the test page offers a fresh start.
    const resetScreen = new ResetAttemptScreen(studentPage);
    await studentPage.goto(ExamScreen.attemptUrl(oldId));
    await expect(resetScreen.heading).toBeVisible();
    await expect(resetScreen.text(LIVE_TEXTS.resetBody)).toBeVisible();
    await expect(resetScreen.back).toHaveAttribute('href', /\/student\/?$/);
    const testPage = new StudentTestPage(studentPage);
    await testPage.goto(t.testId, EXAM_HEADING);
    await expect(testPage.checkDevice).toBeVisible();
    await expect(testPage.resume).toHaveCount(0);

    const again = await postStart(student, t.testId);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const newId = again.body.attempt.id;
    expect(newId).not.toBe(oldId);
    expect(again.body.attempt.deadlineAt, 'fixed slot: the slot end (Q25)').toBe(t.window.end);
    expect(again.body.answers).toEqual({});
    const fresh = await storedAttempt(emulators, ORG_A.id, newId);
    expect(fresh).toMatchObject({ status: 'in_progress', deadlineAt: t.window.end });
    expect((fresh.draw as { questionIds?: string[] }).questionIds, 'a draw of its own').toHaveLength(4);
    expect(await storedAnswers(emulators, ORG_A.id, newId)).toEqual({});
    expect(await attemptIndex(emulators, ORG_A.id, t.testId, seededStudent(ORG_A, 1).id)).toMatchObject({
      activeAttemptId: newId,
      attemptCount: 2,
    });
    const listed = await getTestAttempts(await apiAs(accounts.adminA), t.testId);
    expect(listed.body.items.map((i) => [i.id, i.status]).sort()).toEqual(
      [
        [oldId, 'reset'],
        [newId, 'in_progress'],
      ].sort(),
    );
    await live.expectRow(AARAV, { Status: LIVE_STATUS.inProgress, Answered: '0 / 4' }, FIVE_SECONDS);
  });

  test('OPS-04 OPS-10 ORG-05 ORG-14 terminate, reinstate and reset refuse a missing reason, the wrong status, students and org B, and work for a super admin', async ({
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const student = await apiAs(accounts.studentA);
    const id = (await startAttempt(student, t.testId)).attempt.id;
    const admin = await apiAs(accounts.adminA);
    const adminB = await apiAs(accounts.adminB);

    for (const action of ['terminate', 'reinstate', 'reset'] as const) {
      expectApiError(await postAttemptAction(admin, id, action, {}), 400, 'VALIDATION');
      expectApiError(await postAttemptAction(admin, id, action, { reason: '  ' }), 400, 'VALIDATION');
      expectApiError(await postAttemptAction(student, id, action), 403);
      expectApiError(await postAttemptAction(adminB, id, action), 404);
    }
    expectApiError(await adminB.get(`/v1/attempts/${id}/events`), 404);
    expectApiError(
      await postAttemptAction(admin, id, 'reinstate', { reason: 'Not ended' }),
      409,
      'ATTEMPT_NOT_TERMINATED',
    );
    expect((await storedAttempt(emulators, ORG_A.id, id)).status).toBe('in_progress');
    for (const action of ['attempt.terminate', 'attempt.reinstate', 'attempt.reset'])
      expect(await attemptAudit(emulators, ORG_A.id, action, id), `${action} not written`).toEqual([]);

    const superA = await apiAs(accounts.superAdmin, { orgId: ORG_A.id });
    expect((await postAttemptAction(superA, id, 'terminate', { reason: 'Platform check' })).status).toBe(200);
    await expectAttemptStatus(emulators, ORG_A.id, id, 'terminated');
    expectApiError(await postAttemptAction(admin, id, 'terminate', { reason: 'Again' }), 409, 'ATTEMPT_FINISHED');
    expect((await postAttemptAction(superA, id, 'reinstate', { reason: 'Platform check' })).status).toBe(200);
    await expectAttemptStatus(emulators, ORG_A.id, id, 'in_progress');
    expect((await postAttemptAction(superA, id, 'reset', { reason: 'Platform check' })).status).toBe(200);
    await expectAttemptStatus(emulators, ORG_A.id, id, 'reset');
    expectApiError(await postAttemptAction(admin, id, 'reset', { reason: 'Twice' }), 409, 'ATTEMPT_ALREADY_RESET');
    for (const action of ['attempt.terminate', 'attempt.reinstate', 'attempt.reset']) {
      const entries = await attemptAudit(emulators, ORG_A.id, action, id);
      expect(entries, action).toHaveLength(1);
      expect(entries[0]!.data.actor, action).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });
    }

    // A submitted attempt can be reset, not terminated.
    const vihaan = await apiAs(studentOfA(5));
    const v = (await startAttempt(vihaan, t.testId)).attempt.id;
    await submit(vihaan, v);
    expectApiError(await postAttemptAction(admin, v, 'terminate', { reason: 'Late' }), 409, 'ATTEMPT_FINISHED');
    expect((await postAttemptAction(admin, v, 'reset', { reason: 'Submitted by mistake' })).status).toBe(200);
  });
});
