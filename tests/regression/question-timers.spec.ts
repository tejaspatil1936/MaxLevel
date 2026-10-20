import { BASIC_QUESTIONS, optionName } from '../acceptance/fixtures/authoring';
import { openExam } from '../acceptance/fixtures/exam-session';
import { expect, test } from '../acceptance/fixtures/test';

// Per-question timer bugs found by flaky full runs of F-3.09. Each test failed before its fix.

const timed = { overrides: { questionTimeMode: 'same', questionTimeLimitSec: 20 } };

test.describe('per-question timers @exam', () => {
  test('Q-11 a question shown while the clock offset is being corrected keeps its time and is not skipped', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    await page.clock.install();
    const { exam, attemptId } = await openExam({ page, signInAs, apiAs, testApi }, timed);
    await expect(exam.questionTimer).toHaveText(/^0:(1\d|20)$/);
    const start = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(start + 1_000);

    // The server's clock moves first and an answer's response measures the offset (server 21 s ahead) before the
    // page's clock follows, so for a moment the page's server time runs 21 s ahead.
    await testApi.clock.advance(21_000);
    const saved = page.waitForResponse((r) => r.url().endsWith(`/v1/attempts/${attemptId}/answers`));
    await exam.choose(optionName(BASIC_QUESTIONS[0]!, 0));
    await saved;
    const served = page.waitForResponse(
      (r) => r.url().endsWith(`/v1/attempts/${attemptId}/navigate`) && r.request().method() === 'POST',
    );
    await page.clock.fastForward(21_000);
    // Question 1's time is up; question 2's serve report answers with the server's time and corrects the offset.
    await served;
    await expect(exam.question(2, 4)).toBeVisible();
    await expect(exam.questionTimer).toHaveText(/^0:(1\d|20)$/);

    await exam.saveAndNext.click();
    await expect(exam.question(3, 4)).toBeVisible();
    await expect(exam.trackState(2, 'not answered, locked')).toHaveCount(1);
  });
});
