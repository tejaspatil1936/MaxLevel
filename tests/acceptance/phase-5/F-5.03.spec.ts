import { expectApiError, istTime, remainingPattern, startAttempt, storedAttempt, timerText } from '../fixtures/exam';
import { EXAM_HEADING } from '../fixtures/exam-session';
import {
  accommodationText,
  deleteAccommodation,
  LIVE_ERRORS,
  LIVE_TEXTS,
  MIN,
  putAccommodation,
  setAccommodation,
  storedAccommodations,
} from '../fixtures/live';
import { accounts, ORG_A, seededStudent, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { BASIC_CHECKS, PreflightPage } from '../pages/exam-flow';
import { ExamScreen } from '../pages/exam-screen';
import { AccommodationsSection, noticeOn } from '../pages/live-pages';
import { StudentsPage } from '../pages/students-page';
import { StudentTestPage } from '../pages/student-pages';
import { expectConfirmLayout, expectFieldError } from '../pages/ui';

// F-5.03 Standing accommodations (OPS-07, A11Y-17). Contract: docs/testids/phase-5.md, "Standing accommodations",
// "Standing accommodations in the student drawer" and "Student screens" (rules screen).

const SERIES = 'Placement 2026'; // the exam-test scenario's series
const OTHER_SERIES = 'Mock drive 2026';
const AARAV = accounts.studentA.name;
const stu = (n: number) => seededStudent(ORG_A, n).id;

test.describe('F-5.03 standing accommodations', () => {
  test('OPS-07 A11Y-17 an admin adds a 50% accommodation for a series, the rules show it, and it applies when the attempt starts', async ({
    page,
    signInAs,
    testApi,
    newSession,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    await testApi.seedSeries({ orgId: ORG_A.id, title: OTHER_SERIES, status: 'active' });

    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();
    const drawer = await students.openDrawer(AARAV);
    const acc = new AccommodationsSection(page, drawer.dialog);
    await expect(acc.heading).toBeVisible();
    await expect(acc.none).toBeVisible();
    await acc.add.click();
    await expect(acc.series.locator('option', { hasText: OTHER_SERIES })).toHaveCount(1);
    await expect(acc.kindOption('Percentage of the duration')).toBeChecked();
    await acc.fill({ series: SERIES, kind: 'Percentage of the duration', amount: 50 });
    await expect(noticeOn(page, LIVE_TEXTS.accommodationSaved)).toBeVisible();
    await expect(acc.addDialog).toBeHidden();
    await expect(acc.items).toHaveCount(1);
    await expect(acc.item(accommodationText(SERIES, { extraPct: 50 }))).toBeVisible();
    await expect(acc.none).toHaveCount(0);

    expect(await storedAccommodations(emulators, ORG_A.id, stu(1))).toEqual({ [t.seriesId]: { extraPct: 50 } });
    const audit = (await emulators.audit(ORG_A.id, 'student.accommodation.update')).filter(
      (d) => (d.data.target as { id?: string }).id === stu(1),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data).toMatchObject({
      actor: { email: accounts.adminA.email, role: 'admin' },
      target: { type: 'student', id: stu(1) },
      after: { seriesId: t.seriesId, extraPct: 50 },
    });

    // The student sees it before starting, and the deadline gets 30 minutes on top of the 60-minute slot.
    const extended = t.window.end + 30 * MIN;
    const studentPage = await newSession(accounts.studentA);
    const testPage = new StudentTestPage(studentPage);
    await testPage.goto(t.testId, EXAM_HEADING);
    await testPage.checkDevice.click();
    const rules = await new PreflightPage(studentPage).passAndContinue(BASIC_CHECKS);
    await expect(rules.rule('Extra time: 30 minutes')).toBeVisible();
    await expect(rules.rule(`Deadline: ${istTime(extended)} IST`)).toBeVisible();
    const items = (await rules.rules.getByRole('listitem').allInnerTexts()).map((s) => s.trim());
    expect(items.indexOf('Extra time: 30 minutes'), 'right after the duration').toBe(
      items.indexOf('Duration: 60 minutes') + 1,
    );
    const attemptId = await rules.agreeAndStart();
    const exam = new ExamScreen(studentPage);
    await expect(exam.timer).toHaveText(remainingPattern(timerText, extended - (await testApi.clock.now())));

    expect(await storedAttempt(emulators, ORG_A.id, attemptId)).toMatchObject({
      extraTimeSec: 1800,
      deadlineAt: extended,
    });
  });

  test('OPS-07 A11Y-17 minutes or a percentage apply only to the series they are for, and only to attempts started afterwards', async ({
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const fixed = await testApi.seedExamTest({ orgId: ORG_A.id });
    const flexible = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Logical reasoning',
      timingMode: 'flexible',
      durationMin: 40,
      windowMin: 120,
    });
    const admin = await apiAs(accounts.adminA);

    const aarav = await apiAs(studentOfA(1));
    const early = await startAttempt(aarav, fixed.testId);
    await setAccommodation(admin, stu(1), fixed.seriesId, { extraMin: 15 });
    await setAccommodation(admin, stu(5), fixed.seriesId, { extraMin: 15 });
    await setAccommodation(admin, stu(3), flexible.seriesId, { extraPct: 50 });
    expect(await storedAccommodations(emulators, ORG_A.id, stu(5))).toEqual({ [fixed.seriesId]: { extraMin: 15 } });

    // Started before the accommodation: unchanged.
    expect(await storedAttempt(emulators, ORG_A.id, early.attempt.id)).toMatchObject({
      extraTimeSec: 0,
      deadlineAt: fixed.window.end,
    });

    const vihaan = await apiAs(studentOfA(5));
    const v1 = await startAttempt(vihaan, fixed.testId);
    expect(v1.attempt.deadlineAt, 'slot end + 15 minutes, past the window end').toBe(fixed.window.end + 15 * MIN);
    expect(await storedAttempt(emulators, ORG_A.id, v1.attempt.id)).toMatchObject({ extraTimeSec: 900 });
    // Another series: nothing extra.
    const v2 = await startAttempt(vihaan, flexible.testId);
    const v2Stored = await storedAttempt(emulators, ORG_A.id, v2.attempt.id);
    expect(v2Stored.extraTimeSec ?? 0).toBe(0);
    expect(v2Stored.deadlineAt).toBe(Number(v2Stored.startedAt) + 40 * MIN);

    // 50% of a 40-minute flexible duration is 20 minutes after the duration.
    const rohan = await apiAs(studentOfA(3));
    const r2 = await startAttempt(rohan, flexible.testId);
    const r2Stored = await storedAttempt(emulators, ORG_A.id, r2.attempt.id);
    expect(r2Stored.extraTimeSec).toBe(1200);
    expect(r2Stored.deadlineAt).toBe(Number(r2Stored.startedAt) + 60 * MIN);
    expect(r2.attempt.deadlineAt).toBe(r2Stored.deadlineAt);

    // Replacing and removing.
    await setAccommodation(admin, stu(5), fixed.seriesId, { extraPct: 25 });
    expect(await storedAccommodations(emulators, ORG_A.id, stu(5))).toEqual({ [fixed.seriesId]: { extraPct: 25 } });
    expect((await deleteAccommodation(admin, stu(5), fixed.seriesId)).status).toBe(200);
    expect(await storedAccommodations(emulators, ORG_A.id, stu(5))).toEqual({});
  });

  test('OPS-07 ORG-05 ORG-14 an accommodation needs a series and an amount in range; students and org B are refused, a super admin may set one, and the admin can remove it', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const students = new StudentsPage(page);
    await students.goto();
    let drawer = await students.openDrawer(AARAV);
    let acc = new AccommodationsSection(page, drawer.dialog);
    await acc.add.click();
    await acc.fill({ amount: 0 });
    await expectFieldError(acc.addDialog, acc.series, LIVE_ERRORS.series);
    await expectFieldError(acc.addDialog, acc.amount, LIVE_ERRORS.pct);
    await acc.fill({ series: SERIES, kind: 'Minutes', amount: 601 });
    await expectFieldError(acc.addDialog, acc.amount, LIVE_ERRORS.accMinutes);
    await expect(acc.addDialog).toBeVisible();
    expect(await storedAccommodations(emulators, ORG_A.id, stu(1))).toEqual({});

    const admin = await apiAs(accounts.adminA);
    for (const body of [
      { extraPct: 0 },
      { extraPct: 201 },
      { extraMin: 601 },
      { extraPct: 10, extraMin: 5 },
      {},
      { extraMin: 1.5 },
    ])
      expectApiError(await putAccommodation(admin, stu(1), t.seriesId, body), 400, 'VALIDATION');
    expectApiError(await putAccommodation(admin, stu(1), 'no-such-series', { extraPct: 10 }), 404);
    expectApiError(await putAccommodation(await apiAs(accounts.studentA), stu(1), t.seriesId, { extraPct: 10 }), 403);
    expectApiError(await putAccommodation(await apiAs(accounts.adminB), stu(1), t.seriesId, { extraPct: 10 }), 404);
    expectApiError(await deleteAccommodation(await apiAs(accounts.adminB), stu(1), t.seriesId), 404);
    expectApiError(await deleteAccommodation(await apiAs(accounts.studentA), stu(1), t.seriesId), 403);
    expect(await storedAccommodations(emulators, ORG_A.id, stu(1))).toEqual({});

    const asSuper = await putAccommodation(await apiAs(accounts.superAdmin, { orgId: ORG_A.id }), stu(1), t.seriesId, {
      extraMin: 1,
    });
    expect(asSuper.status, JSON.stringify(asSuper.body)).toBe(200);
    const audit = await emulators.audit(ORG_A.id, 'student.accommodation.update');
    expect(audit.map((d) => d.data.actor)).toEqual([expect.objectContaining({ role: 'superAdmin' })]);

    await page.reload();
    await students.goto();
    drawer = await students.openDrawer(AARAV);
    acc = new AccommodationsSection(page, drawer.dialog);
    await expect(acc.item(accommodationText(SERIES, { extraMin: 1 }))).toBeVisible();
    await acc.removeButton(SERIES).click();
    const remove = acc.removeDialog(SERIES);
    await expectConfirmLayout(remove, 'Remove accommodation', true);
    await remove.getByRole('button', { name: 'Remove accommodation', exact: true }).click();
    await expect(noticeOn(page, LIVE_TEXTS.accommodationRemoved)).toBeVisible();
    await expect(acc.none).toBeVisible();
    expect(await storedAccommodations(emulators, ORG_A.id, stu(1))).toEqual({});
  });
});
