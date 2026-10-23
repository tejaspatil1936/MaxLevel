import type { Page } from '@playwright/test';
import { BASIC_QUESTIONS, optionName } from '../acceptance/fixtures/authoring';
import { expectEventsSoon, startAttempt, storedAttempt } from '../acceptance/fixtures/exam';
import { openExam } from '../acceptance/fixtures/exam-session';
import { accounts, ORG_A } from '../acceptance/fixtures/seed';
import { expect, test } from '../acceptance/fixtures/test';
import { ExamScreen } from '../acceptance/pages/exam-screen';
import { alertDialog } from '../acceptance/pages/ui';

// Next-gen proctoring (owner request 2026-10-23; docs/DECISIONS.md): a second screen, scripted answers and voice
// detection, end to end on the real exam screen. Screens and the microphone are simulated in the page, since a test
// browser has one screen and a beeping fake microphone.

/** Makes the page report one screen or two (`screen.isExtended`), and fires the screen change event on a switch. */
async function screens(page: Page, extended: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(window.screen, 'isExtended', { configurable: true, get: () => value });
    (window.screen as unknown as EventTarget).dispatchEvent(new Event('change'));
  }, extended);
}

/**
 * Replaces the microphone with speech-like sound: band-limited noise in syllables of 200 ms, 4 a second, at varying
 * loudness, the way talking looks to the detector. The page's audio starts on the first click, as browsers require.
 */
async function talkingMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.audio || constraints.video) return original(constraints);
      const ctx = new AudioContext();
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const voice = ctx.createBiquadFilter();
      voice.type = 'bandpass';
      voice.frequency.value = 800;
      voice.Q.value = 0.7;
      const syllables = ctx.createGain();
      syllables.gain.value = 0;
      for (let k = 0; k < 2_400; k++) {
        const at = ctx.currentTime + k * 0.25;
        syllables.gain.setValueAtTime(0.2 + (0.6 * ((k * 7) % 5)) / 5, at);
        syllables.gain.setValueAtTime(0, at + 0.2);
      }
      const out = ctx.createMediaStreamDestination();
      source.connect(voice).connect(syllables).connect(out);
      source.start();
      document.addEventListener('pointerdown', () => void ctx.resume(), { capture: true });
      return out.stream;
    };
  });
}

test.describe('next-gen proctoring @exam', () => {
  test('PR-04 a second screen is a strike and blocks the exam until it is unplugged', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    // Opened straight from a link, so the fullscreen dialog is up and the page behind it is inert.
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { fullscreenRequired: true } });
    await signInAs(accounts.studentA);
    const { attempt } = await startAttempt(await apiAs(accounts.studentA), t.testId);
    const attemptId = attempt.id;
    const exam = new ExamScreen(page);
    await page.goto(ExamScreen.attemptUrl(attemptId));
    await expect(alertDialog(page, 'This test runs in fullscreen')).toBeVisible();
    await screens(page, true);
    const events = await expectEventsSoon(
      emulators,
      ORG_A.id,
      attemptId,
      (evs) => evs.some((e) => e.data.type === 'dual_monitor'),
      'dual_monitor stored',
    );
    expect(events.filter((e) => e.data.type === 'dual_monitor')).toHaveLength(1);
    // Acknowledge whatever strike warning is up; the second-screen dialog stays until the screen is gone.
    while (await exam.warnings.filter({ hasText: /^Strike/ }).count())
      await exam.warnings.getByRole('button', { name: 'I understand', exact: true }).first().click();
    const blocked = alertDialog(page, 'Second screen detected');
    await expect(blocked).toBeVisible();
    await blocked.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(blocked, 'still two screens').toBeVisible();
    // Unplugging fires the screen change event: the dialog closes by itself.
    await screens(page, false);
    await expect(blocked).toBeHidden();
    // With the screen gone, the fullscreen dialog it was holding back comes up.
    await expect(alertDialog(page, 'This test runs in fullscreen')).toBeVisible();
  });

  test('PR-06 an answer clicked by a script is not taken, and is one automated_input strike', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const { exam, attemptId } = await openExam({ page, signInAs, apiAs, testApi });
    const first = exam.option(optionName(BASIC_QUESTIONS[0]!, 0));
    await first.evaluate((radio: HTMLInputElement) => radio.click());
    const warning = exam.strikeWarning(1, 3);
    await expect(warning.getByText('An answer was entered by a script, not by you.', { exact: true })).toBeVisible();
    await warning.getByRole('button', { name: 'I understand', exact: true }).click();
    await expect(first).not.toBeChecked();
    // A second scripted click is stopped too, without another strike.
    await first.evaluate((radio: HTMLInputElement) => radio.click());
    await expect(first).not.toBeChecked();
    await expect(exam.warnings).toHaveCount(0);
    // A person's own click still answers; once it is saved, the events show the one strike.
    await exam.choose(optionName(BASIC_QUESTIONS[0]!, 0));
    await exam.expectSaved();
    const events = await expectEventsSoon(
      emulators,
      ORG_A.id,
      attemptId,
      (evs) => evs.some((e) => e.data.type === 'automated_input'),
      'automated_input stored',
    );
    expect(events.filter((e) => e.data.type === 'automated_input').map((e) => e.data.strikeNumber)).toEqual([1]);
  });

  test('voice detection logs talking with a stored recording, and never a strike', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(120_000);
    await talkingMicrophone(page);
    const { exam, attemptId } = await openExam(
      { page, signInAs, apiAs, testApi },
      { overrides: { audioProctoring: true } },
    );
    // Browsers start page audio on a gesture: a click on the question.
    await exam.option(optionName(BASIC_QUESTIONS[0]!, 0)).click();
    const events = await expectEventsSoon(
      emulators,
      ORG_A.id,
      attemptId,
      (evs) => evs.some((e) => e.data.type === 'voice_detected'),
      'voice_detected stored',
    );
    const voice = events.find((e) => e.data.type === 'voice_detected')!;
    expect(voice.data.strikeNumber).toBeUndefined();
    expect(voice.data.details).toMatchObject({ clipId: expect.stringMatching(/^clip-/), whisper: false });
    await expect
      .poll(async () => (await storedAttempt(emulators, ORG_A.id, attemptId)).audioProofCount, {
        message: 'the clip was uploaded',
        timeout: 30_000,
      })
      .toBe(1);
    await expect(exam.warnings).toHaveCount(0);
  });
});
