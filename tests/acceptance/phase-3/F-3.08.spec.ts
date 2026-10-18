import { stackEnv } from '../../env';
import { BASIC_QUESTIONS, optionName } from '../fixtures/authoring';
import {
  advanceExamTime,
  expectApiError,
  expectAttemptSoon,
  idempotency,
  leaksAnswerKey,
  putAnswers,
  SECTIONED_OPTIONS,
  startAttempt,
  storedAnswers,
  storedAttempt,
  SUBMITTED,
} from '../fixtures/exam';
import { openExam } from '../fixtures/exam-session';
import { apiRequest, holdApiRequests, recordApiCalls } from '../fixtures/network';
import { accounts, ORG_A, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { SubmittedPage } from '../pages/exam-flow';
import { cellIn, expectConfirmLayout, rowWith } from '../pages/ui';

// F-3.08 Submit, auto-submit and grading (EX-15; and EX-16, EX-17, REL-04 below the browser). Contract:
// docs/testids/phase-3.md, "Submit", "Auto-submit task" and "Requests the tests send directly".

const WORKER_URL = stackEnv.WORKER_URL ?? 'http://127.0.0.1:4001';
const sectioned = (i: number) => `${String.fromCharCode(65 + i)}. ${SECTIONED_OPTIONS[i]}`;
const p1m025 = { marking: { marks: 1, negativeMarks: 0.25, preset: 'p1_m025' } };

test.describe('F-3.08 submit @exam', () => {
  test('EX-15 EX-17 Submit test shows answered, unanswered and marked per section, syncs every answer, then submits and grades', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const { exam, attemptId, t, payload } = await openExam(
      { page, signInAs, apiAs, testApi },
      { questions: 'sectioned', overrides: p1m025 },
    );
    const ids = payload.questions.map((q) => q.id);
    await exam.choose(sectioned(0)); // Quant 1: correct
    await exam.saveAndNext.click();
    await exam.choose(sectioned(1)); // Quant 2: wrong
    await exam.saveAndNext.click();
    await exam.markForReview.click(); // Quant 3: marked, no answer
    await exam.goToQuestion(7, 10);
    await exam.choose(sectioned(0)); // Verbal 1: correct
    await exam.expectSaved();
    const held = await holdApiRequests(page, apiRequest('PUT', /\/v1\/attempts\/[^/]+\/answers$/));
    const calls = recordApiCalls(page);
    await exam.saveAndNext.click();
    await exam.choose(sectioned(0)); // Verbal 2: correct, its sync held in flight
    await held.waitUntilHeld();

    const summary = await exam.openSummary();

    await expectConfirmLayout(summary, 'Submit test', false);
    const table = exam.summaryTable();
    for (const [section, answered, notAnswered, marked] of [
      ['Quant', '2', '4', '1'],
      ['Verbal', '2', '2', '0'],
    ] as const) {
      const row = rowWith(table, section);
      await expect(row).toHaveCount(1);
      await expect(await cellIn(table, row, 'Answered'), `${section} answered`).toHaveText(answered);
      await expect(await cellIn(table, row, 'Not answered'), `${section} not answered`).toHaveText(notAnswered);
      await expect(await cellIn(table, row, 'Marked for review'), `${section} marked`).toHaveText(marked);
    }
    await exam.confirmSubmit.click();
    expect(
      calls().filter((c) => c.endsWith('/submit')),
      'no submit while an answer is in flight',
    ).toEqual([]);
    held.release();

    const submitted = new SubmittedPage(page);
    await submitted.expectShown(attemptId, SUBMITTED.heading);
    await expect(submitted.text(SUBMITTED.afterClose(t.window.end))).toBeVisible();
    await expect(submitted.back).toHaveAttribute('href', /\/student\/?$/);
    const order = calls();
    expect(order.lastIndexOf(`PUT /v1/attempts/${attemptId}/answers`), 'answers synced before the submit').toBeLessThan(
      order.indexOf(`POST /v1/attempts/${attemptId}/submit`),
    );
    expect(order.indexOf(`POST /v1/attempts/${attemptId}/submit`)).toBeGreaterThanOrEqual(0);

    expect((await storedAnswers(emulators, ORG_A.id, attemptId))[ids[7]!]).toMatchObject({ optionId: 'a' });
    const stored = await storedAttempt(emulators, ORG_A.id, attemptId);
    expect(stored.status).toBe('submitted');
    expect(typeof stored.submittedAt).toBe('number');
    expect(stored.result).toMatchObject({ score: 2.75, max: 10, correct: 3, incorrect: 1, unanswered: 6 });
    expect((stored.result as { sections: Record<string, unknown> }).sections).toMatchObject({
      [t.sectionIds.Quant!]: { score: 0.75, max: 6, correct: 1, incorrect: 1, unanswered: 4 },
      [t.sectionIds.Verbal!]: { score: 2, max: 4, correct: 2, incorrect: 0, unanswered: 2 },
    });
  });

  test('EX-15 an offline submit says so, keeps retrying and goes through when the connection returns', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const { exam, attemptId } = await openExam({ page, signInAs, apiAs, testApi });
    await exam.choose(optionName(BASIC_QUESTIONS[0]!, 0));
    await exam.expectSaved();
    await page.context().setOffline(true);

    await exam.openSummary();
    await expect(exam.summaryTable()).toBeVisible();
    await expect(
      await cellIn(exam.summaryTable(), rowWith(exam.summaryTable(), 'All questions'), 'Answered'),
    ).toHaveText('1');
    await exam.confirmSubmit.click();

    await expect(exam.summary.getByRole('status').filter({ hasText: SUBMITTED.offline })).toBeVisible();
    expect((await storedAttempt(emulators, ORG_A.id, attemptId)).status).toBe('in_progress');
    await page.context().setOffline(false);
    const submitted = new SubmittedPage(page);
    await expect(submitted.heading(SUBMITTED.heading)).toBeVisible({ timeout: 45_000 });
    await submitted.expectShown(attemptId, SUBMITTED.heading);
    expect((await storedAttempt(emulators, ORG_A.id, attemptId)).status).toBe('submitted');
  });

  test('EX-16 EX-17 when time runs out the browser syncs and submits by itself', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    await page.clock.install();
    const { exam, attemptId, payload } = await openExam(
      { page, signInAs, apiAs, testApi },
      { timingMode: 'flexible', durationMin: 2 },
    );
    await exam.choose(optionName(BASIC_QUESTIONS[0]!, 0));
    await exam.expectSaved();

    await advanceExamTime(page, testApi, payload.attempt.deadlineAt - (await testApi.clock.now()) + 2_000);

    const submitted = new SubmittedPage(page);
    await expect(submitted.heading(SUBMITTED.heading)).toBeVisible({ timeout: 20_000 });
    await submitted.expectShown(attemptId, SUBMITTED.heading);
    await expect(submitted.text(SUBMITTED.auto)).toBeVisible();
    const stored = await storedAttempt(emulators, ORG_A.id, attemptId);
    expect(stored.status).toBe('auto_submitted');
    expect(stored.result).toMatchObject({ score: 1, max: 4, correct: 1, incorrect: 0, unanswered: 3 });
  });
});

test.describe('F-3.08 submit and auto-submit API', () => {
  test('EX-16 EX-17 REL-04 with the browser closed the auto-submit task finalizes the attempt, and running it again changes nothing', async ({
    request,
    testApi,
    apiAs,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, timingMode: 'flexible', durationMin: 5 });
    const student = await apiAs(accounts.studentA);
    const { attempt, questions } = await startAttempt(student, t.testId);
    const now = await testApi.clock.now();
    expect(
      (await putAnswers(student, attempt.id, [{ questionId: questions[0]!.id, optionId: 'a', seq: 1, clientTs: now }]))
        .status,
    ).toBe(200);
    const task = (await testApi.tasks.pending()).find((k) => k.name.startsWith(`auto-submit-${attempt.id}`));
    expect(task, 'auto-submit task queued at start').toBeTruthy();
    expect(task).toMatchObject({ path: '/tasks/auto-submit', scheduleTime: attempt.deadlineAt + 120_000 });

    await testApi.clock.advance(attempt.deadlineAt + 120_000 - now + 1_000);
    await testApi.tasks.runDue();

    const done = await expectAttemptSoon(
      emulators,
      ORG_A.id,
      attempt.id,
      (a) => a.status === 'auto_submitted',
      'attempt finalized by the task',
    );
    expect(done.result).toMatchObject({ score: 1, max: 4, correct: 1, incorrect: 0, unanswered: 3 });
    for (let run = 1; run <= 2; run++) {
      const res = await request.post(`${WORKER_URL}/tasks/auto-submit`, {
        data: { orgId: ORG_A.id, attemptId: attempt.id },
      });
      expect(res.status(), `handler run ${run}: ${await res.text()}`).toBe(200);
    }
    const after = await storedAttempt(emulators, ORG_A.id, attempt.id);
    expect(after.status).toBe('auto_submitted');
    expect(after.submittedAt, 'submittedAt unchanged').toBe(done.submittedAt);
    expect(after.result, 'result unchanged').toEqual(done.result);
  });

  test('EX-15 DATA-05 only the attempt own student can submit it, a repeat returns the same submission, and nothing is accepted after', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    const student = await apiAs(accounts.studentA);
    const { attempt, questions } = await startAttempt(student, t.testId);

    expectApiError(
      await (await apiAs(studentOfA(2))).post(`/v1/attempts/${attempt.id}/submit`, {}, idempotency()),
      404,
    );
    expectApiError(
      await (await apiAs(accounts.adminA)).post(`/v1/attempts/${attempt.id}/submit`, {}, idempotency()),
      403,
    );
    expect((await storedAttempt(emulators, ORG_A.id, attempt.id)).status).toBe('in_progress');

    const first = await student.post<{ status: string; submittedAt: number }>(
      `/v1/attempts/${attempt.id}/submit`,
      {},
      idempotency(),
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.status).toBe('submitted');
    expect(
      leaksAnswerKey(
        first.body,
        BASIC_QUESTIONS.flatMap((q) => (q.explanation ? [q.explanation] : [])),
      ),
    ).toEqual([]);
    const again = await student.post<{ status: string; submittedAt: number }>(
      `/v1/attempts/${attempt.id}/submit`,
      {},
      idempotency(),
    );
    expect(again.status).toBe(200);
    expect(again.body.submittedAt, 'the same submission').toBe(first.body.submittedAt);
    const now = await testApi.clock.now();
    expectApiError(
      await putAnswers(student, attempt.id, [{ questionId: questions[0]!.id, optionId: 'a', seq: 1, clientTs: now }]),
      409,
      'ATTEMPT_FINISHED',
    );
    expect(await storedAnswers(emulators, ORG_A.id, attempt.id)).toEqual({});
  });
});
