import { advanceExamTime, remainingPattern, timerText } from '../fixtures/exam';
import { openExam } from '../fixtures/exam-session';
import { cssOf } from '../fixtures/layout';
import { expect, test } from '../fixtures/test';
import { REDPEN } from '../pages/ui';

// F-3.06 Exam timer and announcements (EX-06, A11Y-06, A11Y-09). Contract: docs/testids/phase-3.md, "Exam screen in
// attempt mode" (Timer, Time announcements) and "Server time". The device and server clocks are moved together.

const MIN = 60_000;

test.describe('F-3.06 exam timer @exam', () => {
  test('EX-06 the timer counts down to the deadline by the server time, even when the device clock is 7 minutes fast', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    await page.clock.install({ time: Date.now() + 7 * MIN });
    const { exam, payload } = await openExam({ page, signInAs, apiAs, testApi });

    const remaining = payload.attempt.deadlineAt - (await testApi.clock.now());
    await expect(exam.timer).toHaveText(remainingPattern(timerText, remaining, 20_000));
    expect(remaining, 'the scenario deadline is about 58 minutes away').toBeGreaterThan(50 * MIN);
    expect([null, 'off'], 'the timer is not a live region').toContain(await exam.timer.getAttribute('aria-live'));
    expect(await cssOf(exam.timer, 'color'), 'no red pen above 10 minutes').not.toBe(REDPEN);
  });

  test('EX-06 A11Y-09 at 10, 5 and 1 minutes left the timer turns red pen and the time is announced politely, not every second', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    test.setTimeout(120_000);
    await page.clock.install();
    // Flexible window, 11 minutes from the start.
    const { exam, payload } = await openExam(
      { page, signInAs, apiAs, testApi },
      { timingMode: 'flexible', durationMin: 11 },
    );
    const deadline = payload.attempt.deadlineAt;
    const left = async () => deadline - (await testApi.clock.now());
    await expect(exam.timer).toHaveText(remainingPattern(timerText, await left(), 20_000));
    await expect(exam.announcements).toHaveText('');
    expect(await exam.announcements.getAttribute('aria-live'), 'polite, never assertive').not.toBe('assertive');

    await advanceExamTime(page, testApi, (await left()) - 10 * MIN + 2_000);

    await expect(exam.announcements).toHaveText('10 minutes left');
    await expect(exam.announcements).toBeVisible();
    await expect(exam.timer).toHaveText(remainingPattern(timerText, await left(), 20_000));
    await expect.poll(() => cssOf(exam.timer, 'color'), { message: 'timer colour below 10 minutes' }).toBe(REDPEN);

    await advanceExamTime(page, testApi, (await left()) - 5 * MIN + 2_000);
    await expect(exam.announcements).toHaveText('5 minutes left');

    await advanceExamTime(page, testApi, (await left()) - 1 * MIN + 2_000);
    await expect(exam.announcements).toHaveText('1 minute left');
    await expect(exam.timer).toHaveText(/^00:[0-5]\d$/);

    await advanceExamTime(page, testApi, 5_000);
    await expect(exam.timer).toHaveText(remainingPattern(timerText, await left(), 20_000));
    await expect(exam.announcements, 'no announcement every second').toHaveText('1 minute left');
  });

  test('A11Y-06 pressing T announces the time left', async ({ page, signInAs, apiAs, testApi }) => {
    const { exam, payload } = await openExam({ page, signInAs, apiAs, testApi });
    const minutes = Math.floor((payload.attempt.deadlineAt - (await testApi.clock.now())) / MIN);

    await page.keyboard.press('t');

    await expect(exam.announcements).toHaveText(new RegExp(`^(${minutes}|${minutes - 1}) minutes left$`));
    await expect(exam.announcements).toBeVisible();
  });
});
