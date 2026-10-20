import { BASIC_QUESTIONS, optionName } from '../fixtures/authoring';
import {
  advanceExamTime,
  expectApiError,
  putAnswers,
  startAttempt,
  storedAnswers,
  storedAttempt,
} from '../fixtures/exam';
import { openExam } from '../fixtures/exam-session';
import { accounts, ORG_A } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';

// F-3.09 Per-question timers (Q-11; Q-12 on the server). Contract: docs/testids/phase-3.md, "Per-question timers" and
// "Answers".

const timed = { overrides: { questionTimeMode: 'same', questionTimeLimitSec: 20 } };

test.describe('F-3.09 per-question timers @exam', () => {
  test('Q-11 when a question time runs out its answer is saved, it locks and the exam moves on, and navigation is forward-only', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    await page.clock.install();
    const { exam, attemptId, payload } = await openExam({ page, signInAs, apiAs, testApi }, timed);
    const ids = payload.questions.map((q) => q.id);

    await expect(exam.questionTimer).toHaveText(/^0:(1\d|20)$/);
    await expect(exam.previous).toBeDisabled();
    await expect(exam.trackButton(2), 'no jumping ahead').toBeDisabled();
    await exam.choose(optionName(BASIC_QUESTIONS[0]!, 0));

    await advanceExamTime(page, testApi, 21_000);

    await expect(exam.question(2, 4)).toBeVisible();
    await expect(exam.trackState(1, 'answered, locked')).toHaveCount(1);
    await expect(exam.trackButton(1), 'no going back').toBeDisabled();
    await expect(exam.previous).toBeDisabled();
    await expect(exam.questionTimer).toHaveText(/^0:(1\d|20)$/);
    await expect
      .poll(async () => (await storedAnswers(emulators, ORG_A.id, attemptId))[ids[0]!]?.optionId, {
        message: 'question 1 answer saved',
      })
      .toBe('a');

    await exam.saveAndNext.click();
    await expect(exam.question(3, 4)).toBeVisible();
    await expect(exam.trackState(2, 'not answered, locked')).toHaveCount(1);
    await expect
      .poll(
        async () =>
          Object.keys(((await storedAttempt(emulators, ORG_A.id, attemptId)).questionServedAt ?? {}) as object).sort(),
        {
          message: 'serve times recorded',
        },
      )
      .toEqual([ids[0]!, ids[1]!, ids[2]!].sort());
  });
});

test.describe('F-3.09 per-question timers API', () => {
  test('Q-12 the server records when a timed question is first served and refuses answers after its limit plus 2 seconds', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...timed });
    const student = await apiAs(accounts.studentA);
    const { attempt, questions } = await startAttempt(student, t.testId);
    const q1 = questions[0]!.id;
    const ts = () => testApi.clock.now();

    const unserved = await putAnswers(student, attempt.id, [
      { questionId: q1, optionId: 'a', seq: 1, clientTs: await ts() },
    ]);
    expect(unserved.body.rejected).toEqual([{ questionId: q1, code: 'QUESTION_NOT_SERVED' }]);
    const served = await student.post<{ servedAt: number }>(`/v1/attempts/${attempt.id}/navigate`, { questionId: q1 });
    expect(served.status, JSON.stringify(served.body)).toBe(200);
    const again = await student.post<{ servedAt: number }>(`/v1/attempts/${attempt.id}/navigate`, { questionId: q1 });
    expect(again.body.servedAt, 'the first serve time is kept').toBe(served.body.servedAt);

    await testApi.clock.advance(served.body.servedAt + 21_000 - (await ts()));
    const inGrace = await putAnswers(student, attempt.id, [
      { questionId: q1, optionId: 'a', seq: 2, clientTs: await ts() },
    ]);
    expect(inGrace.body.saved, 'within the limit plus grace').toEqual([q1]);
    await testApi.clock.advance(2_500);
    const tooLate = await putAnswers(student, attempt.id, [
      { questionId: q1, optionId: 'b', seq: 3, clientTs: await ts() },
    ]);
    expect(tooLate.body.rejected).toEqual([{ questionId: q1, code: 'QUESTION_TIME_UP' }]);

    expect((await storedAnswers(emulators, ORG_A.id, attempt.id))[q1]).toMatchObject({ optionId: 'a', seq: 2 });
    expect((await storedAttempt(emulators, ORG_A.id, attempt.id)).questionServedAt).toMatchObject({
      [q1]: served.body.servedAt,
    });
    expectApiError(
      await (await apiAs(accounts.adminA)).post(`/v1/attempts/${attempt.id}/navigate`, { questionId: q1 }),
      403,
    );
  });
});
