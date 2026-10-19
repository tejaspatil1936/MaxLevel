import { expectApiError, putAnswers, remainingPattern, startAttempt, storedAttempt, timerText } from '../fixtures/exam';
import { EXAM_HEADING } from '../fixtures/exam-session';
import {
  attemptAudit,
  expectAttemptStatus,
  expectLiveRecord,
  extensionNotice,
  grantExtraTime,
  LIVE_ERRORS,
  LIVE_TEXTS,
  MIN,
  postExtraTime,
  signalRecord,
  timeLeftPattern,
} from '../fixtures/live';
import { setFeature, submit } from '../fixtures/results';
import { accounts, departmentId, ORG_A, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ExamScreen } from '../pages/exam-screen';
import { LiveDashboard } from '../pages/live-pages';
import { NOT_INCLUDED } from '../pages/shell';
import { expectConfirmLayout, expectFieldError } from '../pages/ui';

// F-5.02 Extra time and student signals (OPS-06, OPS-08, US-AD-12; OPS-09 through the stored audit entry).
// Contract: docs/testids/phase-5.md, "Extra time", "Grant extra time" and "Exam screen".

const COMPUTER = { seriesEligibility: { departmentIds: [departmentId(ORG_A, 'Computer')] } };
const AARAV = accounts.studentA.name;
const FIVE_SECONDS = 5_000;

test.describe('F-5.02 extra time', () => {
  test('OPS-06 US-AD-12 OPS-09 granting extra time moves the deadline, updates the timer of the student with a notice within 5 seconds, and is audit-logged with the reason', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    newSession,
    emulators,
    rtdb,
  }) => {
    test.setTimeout(120_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const studentPage = await newSession(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const payload = await startAttempt(student, t.testId);
    const attemptId = payload.attempt.id;
    const oldDeadline = payload.attempt.deadlineAt;
    const exam = new ExamScreen(studentPage);
    await exam.gotoAttempt(attemptId, EXAM_HEADING);
    await expect(exam.timer).toHaveText(await timeLeftPattern(testApi, oldDeadline));

    await signInAs(accounts.adminA);
    const live = new LiveDashboard(page);
    await live.goto(t.testId, EXAM_HEADING);
    await live.expectRow(AARAV, { 'Time left': await timeLeftPattern(testApi, oldDeadline) });
    await live.choose(AARAV, 'Grant extra time');
    const grant = live.extraTime(AARAV);
    await expect(grant.dialog).toBeVisible();
    await expect(grant.text(LIVE_TEXTS.currentDeadline(oldDeadline))).toBeVisible();
    const newDeadline = oldDeadline + 10 * MIN;
    await grant.fill(10, 'Power cut in lab 2');
    await expect(grant.text(LIVE_TEXTS.newDeadline(newDeadline))).toBeVisible();
    await grant.grant.click();
    await expect(live.notice(LIVE_TEXTS.extraGranted)).toBeVisible();
    await expect(grant.dialog).toBeHidden();

    // The student's timer and notice, within 5 seconds of the grant (OPS-06).
    await expect(exam.notice(extensionNotice(10))).toBeVisible({ timeout: FIVE_SECONDS });
    await expect(exam.timer).toHaveText(remainingPattern(timerText, newDeadline - (await testApi.clock.now())), {
      timeout: FIVE_SECONDS,
    });
    await live.expectRow(AARAV, { 'Time left': await timeLeftPattern(testApi, newDeadline) }, FIVE_SECONDS);
    await expect(exam.dismissNotice).toBeVisible();
    await exam.dismissNotice.click();
    await expect(exam.notice(extensionNotice(10))).toHaveCount(0);

    const stored = await storedAttempt(emulators, ORG_A.id, attemptId);
    expect(stored).toMatchObject({ status: 'in_progress', deadlineAt: newDeadline, extraTimeSec: 600 });
    expect(await signalRecord(rtdb, ORG_A.id, attemptId)).toMatchObject({
      deadlineAt: newDeadline,
      notice: extensionNotice(10),
    });
    await expectLiveRecord(rtdb, ORG_A.id, t.testId, attemptId, { deadlineAt: newDeadline });
    const audit = await attemptAudit(emulators, ORG_A.id, 'attempt.extra_time.grant', attemptId);
    expect(audit, 'one audit entry for the grant').toHaveLength(1);
    expect(audit[0]!.data).toMatchObject({
      actor: { email: accounts.adminA.email, role: 'admin' },
      target: { type: 'attempt', id: attemptId },
      before: { deadlineAt: oldDeadline },
      after: { minutes: 10, reason: 'Power cut in lab 2', deadlineAt: newDeadline },
    });

    // A second grant adds up.
    const second = await grantExtraTime(await apiAs(accounts.adminA), attemptId, 1, 'Second power cut');
    expect(second).toMatchObject({ deadlineAt: newDeadline + MIN, extraTimeSec: 660 });
    await expect(exam.notice(extensionNotice(1))).toBeVisible({ timeout: FIVE_SECONDS });
  });

  test('OPS-06 OPS-08 extra time may pass the window end: answers still save, and auto-submit waits for the new deadline', async ({
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const student = await apiAs(accounts.studentA);
    const payload = await startAttempt(student, t.testId);
    const attemptId = payload.attempt.id;
    expect(payload.attempt.deadlineAt, 'fixed slot: the deadline is the slot end').toBe(t.window.end);

    const granted = await grantExtraTime(await apiAs(accounts.adminA), attemptId, 10, 'Network outage');
    const newDeadline = t.window.end + 10 * MIN;
    expect(granted).toMatchObject({ deadlineAt: newDeadline, extraTimeSec: 600 });

    // Past the window end and past the old auto-submit time (deadline + 2 minutes), before the new deadline.
    await testApi.clock.advance(t.window.end + 3 * MIN - (await testApi.clock.now()));
    await testApi.tasks.runDue();
    expect((await storedAttempt(emulators, ORG_A.id, attemptId)).status, 'not auto-submitted at the old time').toBe(
      'in_progress',
    );
    const now = await testApi.clock.now();
    const saved = await putAnswers(student, attemptId, [
      { questionId: payload.questions[0]!.id, optionId: payload.questions[0]!.options[0]!.id, seq: 1, clientTs: now },
    ]);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.saved, 'an answer after the window end, before the new deadline').toEqual([
      payload.questions[0]!.id,
    ]);
    const pending = await testApi.tasks.pending();
    expect(
      pending.find((k) => k.name === `auto-submit-${attemptId}-${newDeadline}`),
      'task for the new deadline',
    ).toMatchObject({ path: '/tasks/auto-submit', scheduleTime: newDeadline + 2 * MIN });

    await testApi.clock.advance(newDeadline + 2 * MIN + 1_000 - (await testApi.clock.now()));
    await expect
      .poll(
        async () => {
          await testApi.tasks.runDue();
          return (await storedAttempt(emulators, ORG_A.id, attemptId)).status;
        },
        { message: 'auto-submitted at the new deadline' },
      )
      .toBe('auto_submitted');
  });

  test('OPS-08 a grant above 100% of the duration needs a second confirmation', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER }); // 60-minute slot
    const payload = await startAttempt(await apiAs(accounts.studentA), t.testId);
    const attemptId = payload.attempt.id;

    await signInAs(accounts.adminA);
    const live = new LiveDashboard(page);
    await live.goto(t.testId, EXAM_HEADING);
    await live.choose(AARAV, 'Grant extra time');
    const grant = live.extraTime(AARAV);
    await grant.fill(61, 'Lab flooded');
    await grant.grant.click();
    await expect(grant.confirm).toBeVisible();
    await expect(grant.confirm.getByText(LIVE_TEXTS.overDuration(61, 60), { exact: true })).toBeVisible();
    await expectConfirmLayout(grant.confirm, 'Grant anyway', false);
    await grant.confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(grant.confirm).toBeHidden();
    await expect(grant.dialog).toBeVisible();
    await expect(grant.minutes).toHaveValue('61');
    expect((await storedAttempt(emulators, ORG_A.id, attemptId)).extraTimeSec ?? 0, 'nothing granted').toBe(0);
    expect(await attemptAudit(emulators, ORG_A.id, 'attempt.extra_time.grant', attemptId)).toEqual([]);

    await grant.grant.click();
    await grant.confirm.getByRole('button', { name: 'Grant anyway', exact: true }).click();
    await expect(live.notice(LIVE_TEXTS.extraGranted)).toBeVisible();
    expect(await storedAttempt(emulators, ORG_A.id, attemptId)).toMatchObject({
      extraTimeSec: 61 * 60,
      deadlineAt: payload.attempt.deadlineAt + 61 * MIN,
    });

    // The API refuses the same size of grant without the confirmation, and stores nothing.
    const other = await startAttempt(await apiAs(studentOfA(5)), t.testId);
    const admin = await apiAs(accounts.adminA);
    expectApiError(
      await postExtraTime(admin, other.attempt.id, { minutes: 61, reason: 'Lab flooded' }),
      409,
      'EXTRA_TIME_CONFIRMATION_REQUIRED',
    );
    expect((await storedAttempt(emulators, ORG_A.id, other.attempt.id)).deadlineAt).toBe(other.attempt.deadlineAt);
    const confirmed = await postExtraTime(admin, other.attempt.id, {
      minutes: 61,
      reason: 'Lab flooded',
      confirmOverDuration: true,
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    // Exactly the duration needs no confirmation.
    const third = await startAttempt(await apiAs(studentOfA(9)), t.testId);
    expect((await postExtraTime(admin, third.attempt.id, { minutes: 60, reason: 'Long outage' })).status).toBe(200);
  });

  test('US-AD-12 ORG-05 ORG-14 a grant needs whole minutes and a reason; finished attempts, students and org B are refused; a super admin may grant', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const student = await apiAs(accounts.studentA);
    const payload = await startAttempt(student, t.testId);
    const attemptId = payload.attempt.id;

    await signInAs(accounts.adminA);
    const live = new LiveDashboard(page);
    await live.goto(t.testId, EXAM_HEADING);
    await live.choose(AARAV, 'Grant extra time');
    const grant = live.extraTime(AARAV);
    await grant.grant.click();
    await expectFieldError(grant.dialog, grant.minutes, LIVE_ERRORS.minutes);
    await expectFieldError(grant.dialog, grant.reason, LIVE_ERRORS.extraReason);
    await grant.fill(1441, 'Too long');
    await grant.grant.click();
    await expectFieldError(grant.dialog, grant.minutes, LIVE_ERRORS.minutes);
    await expect(grant.dialog).toBeVisible();
    expect((await storedAttempt(emulators, ORG_A.id, attemptId)).deadlineAt).toBe(payload.attempt.deadlineAt);

    const admin = await apiAs(accounts.adminA);
    expectApiError(await postExtraTime(admin, attemptId, { minutes: 10 }), 400, 'VALIDATION');
    expectApiError(await postExtraTime(admin, attemptId, { minutes: 10, reason: '   ' }), 400, 'VALIDATION');
    expectApiError(await postExtraTime(admin, attemptId, { minutes: 0, reason: 'Zero' }), 400, 'VALIDATION');
    expectApiError(await postExtraTime(admin, attemptId, { minutes: 2.5, reason: 'Half' }), 400, 'VALIDATION');
    expectApiError(await postExtraTime(student, attemptId, { minutes: 10, reason: 'Myself' }), 403);
    expectApiError(await postExtraTime(await apiAs(accounts.adminB), attemptId, { minutes: 10, reason: 'B' }), 404);
    expect(await attemptAudit(emulators, ORG_A.id, 'attempt.extra_time.grant', attemptId)).toEqual([]);

    const asSuper = await postExtraTime(await apiAs(accounts.superAdmin, { orgId: ORG_A.id }), attemptId, {
      minutes: 5,
      reason: 'Platform incident',
    });
    expect(asSuper.status, JSON.stringify(asSuper.body)).toBe(200);
    const audit = await attemptAudit(emulators, ORG_A.id, 'attempt.extra_time.grant', attemptId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });

    await submit(student, attemptId);
    await expectAttemptStatus(emulators, ORG_A.id, attemptId, 'submitted');
    expectApiError(await postExtraTime(admin, attemptId, { minutes: 5, reason: 'Late' }), 409, 'ATTEMPT_FINISHED');
  });

  test('OPS-06 FF-02 FF-03 with extra_time_grants off the menu item is locked with its reason and the API answers FEATURE_DISABLED', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...COMPUTER });
    const payload = await startAttempt(await apiAs(accounts.studentA), t.testId);
    await setFeature(await apiAs(accounts.superAdmin), ORG_A.id, 'extra_time_grants', false);

    await signInAs(accounts.adminA);
    const live = new LiveDashboard(page);
    await live.goto(t.testId, EXAM_HEADING);
    await live.openActions(AARAV);
    const item = live.menuItem('Grant extra time');
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAccessibleDescription(NOT_INCLUDED);
    await expect(live.menuItem('View timeline')).toBeVisible();

    expectApiError(
      await postExtraTime(await apiAs(accounts.adminA), payload.attempt.id, { minutes: 5, reason: 'Outage' }),
      403,
      'FEATURE_DISABLED',
    );
    expect((await storedAttempt(emulators, ORG_A.id, payload.attempt.id)).deadlineAt).toBe(payload.attempt.deadlineAt);
  });
});
