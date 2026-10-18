import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';
import { WEB_URL } from '../../env';
import { BASIC_QUESTIONS, optionName } from '../fixtures/authoring';
import { ALLOWED_HOSTS, cameraTracks, expectNoMediaSent, installCameraSpy, recordTraffic } from '../fixtures/devices';
import {
  expectAttemptSoon,
  FIX_LINES,
  listEvents,
  startAttempt,
  storedAttempt,
  STRIKE_REASONS,
} from '../fixtures/exam';
import { EXAM_HEADING, openExam } from '../fixtures/exam-session';
import { accounts, ORG_A } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ExamScreen } from '../pages/exam-screen';
import { CAMERA_CHECKS, PreflightPage } from '../pages/exam-flow';
import { studentHome } from '../pages/role-home';
import { SignInPage } from '../pages/sign-in-page';

// F-3.12 Laptop camera proctoring (PR-01, PR-02, PR-03). Contract: docs/testids/phase-3.md, "Laptop camera". The real
// MediaPipe detector runs on Chromium's fake camera (tests/fixtures/camera/no-face.y4m in this project); the clips
// with faces come from the owner and their tests skip until the files exist (docs/MANUAL_CHECKS.md).

const camera = { overrides: { cameraRequired: true } };
const clip = (name: string) => `tests/fixtures/camera/${name}`;

/** A separate browser with its own camera setup, signed in as a student and on the student home. */
async function studentBrowser(args: string[]): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ args });
  const context = await browser.newContext({
    baseURL: WEB_URL,
    viewport: { width: 1024, height: 768 },
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  });
  await context.grantPermissions(['camera'], { origin: WEB_URL });
  const page = await context.newPage();
  const signIn = new SignInPage(page);
  await signIn.goto();
  await signIn.signInWithEmulatorCredential(accounts.studentA.email, accounts.studentA.name);
  await studentHome(page).expectShown();
  return { browser, page };
}

const fakeCamera = (file: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${clip(file)}`,
];

test.describe('F-3.12 laptop camera @exam', () => {
  test('PR-01 face detection uses the self-hosted MediaPipe model and WASM files and nothing from other hosts', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...camera });
    await signInAs(accounts.studentA);
    const traffic = recordTraffic(page);
    const loaded: string[] = [];
    page.on('response', (res) => {
      if (res.ok()) loaded.push(res.url());
    });
    const preflight = new PreflightPage(page);

    await preflight.goto(t.testId);

    for (const name of CAMERA_CHECKS) await preflight.expectCheck(name, 'Passed');
    expect(loaded, 'model from the web origin').toContain(`${WEB_URL}/mediapipe/models/blaze_face_short_range.tflite`);
    expect(
      loaded.some((u) => /^http:\/\/localhost:3000\/mediapipe\/wasm\/.+\.wasm$/.test(u)),
      'WASM from the web origin',
    ).toBe(true);
    expect(
      traffic
        .requests()
        .filter((r) => !ALLOWED_HOSTS.includes(r.host))
        .map((r) => r.url),
      'requests to other hosts',
    ).toEqual([]);
  });

  test('PR-02 US-ST-06 no face for more than 5 seconds records one strike, and no image leaves the device', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(90_000);
    await page.clock.install();
    await installCameraSpy(page);
    const traffic = recordTraffic(page);
    const { exam, attemptId } = await openExam({ page, signInAs, apiAs, testApi }, camera);

    const warning = exam.strikeWarning(1, 3);
    await expect(warning).toBeVisible({ timeout: 20_000 });
    await expect(warning.getByText(STRIKE_REASONS.no_face, { exact: true })).toBeVisible();
    await warning.getByRole('button', { name: 'I understand', exact: true }).click();
    await expect(warning).toBeHidden();

    // The face stays out of view: the same incident goes on, so no second strike follows.
    await page.clock.runFor(15_000);
    await exam.choose(optionName(BASIC_QUESTIONS[0]!, 0));
    await exam.expectSaved();
    await expect(exam.warnings).toHaveCount(0);
    // The warning shows before the API answers, so wait for the stored strike before counting.
    await expectAttemptSoon(emulators, ORG_A.id, attemptId, (a) => a.strikesCount === 1, 'one no-face strike stored');
    const admin = await apiAs(accounts.adminA);
    expect((await listEvents(admin, attemptId)).filter((e) => e.type === 'no_face')).toHaveLength(1);
    expect((await storedAttempt(emulators, ORG_A.id, attemptId)).strikesCount).toBe(1);
    expect(await cameraTracks(page), 'the camera is still on').toContainEqual({ live: true, enabled: true });
    expectNoMediaSent(traffic);
  });

  test('PR-03 the self-view can be collapsed while the camera stays on, and nothing turns the camera off', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    await page.clock.install();
    await installCameraSpy(page);
    const { exam } = await openExam({ page, signInAs, apiAs, testApi }, camera);
    // Hold the device clock so the no-face grace period cannot end while the preview is checked.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
    await expect(exam.video).toBeVisible();
    await expect(exam.cameraToggle).toHaveAttribute('aria-expanded', 'true');

    await exam.cameraToggle.click();

    await expect(exam.cameraToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(exam.video).toBeHidden();
    const tracks = await cameraTracks(page);
    expect(tracks.length, 'camera streams opened').toBeGreaterThan(0);
    expect(tracks.filter((t) => t.live && t.enabled).length, 'a live camera track').toBeGreaterThan(0);
    expect(
      tracks.filter((t) => !t.live),
      'stopped tracks',
    ).toEqual([]);
    const offControl = /camera off|turn off( the)? camera|stop( the)? camera|disable( the)? camera/i;
    await expect(page.getByRole('button', { name: offControl })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: /camera/i })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /camera/i })).toHaveCount(0);

    await exam.cameraToggle.click();
    await expect(exam.cameraToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(exam.video).toBeVisible();
  });

  test('PR-01 EX-01 without a camera the camera check fails with its fix line and the rules stay closed', async ({
    testApi,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...camera });
    // A camera device whose video source is missing: getUserMedia really fails (NotFoundError), as with no camera.
    const { browser, page } = await studentBrowser(fakeCamera('missing-camera.y4m'));
    try {
      const preflight = new PreflightPage(page);
      await preflight.goto(t.testId);

      await preflight.expectCheck('Camera', 'Failed');
      await expect(preflight.check('Camera')).toContainText(FIX_LINES.Camera);
      await expect(preflight.continueToRules).toBeDisabled();
    } finally {
      await browser.close();
    }
  });

  test('PR-02 with a face in view the exam records no camera strike', async ({ testApi, apiAs, emulators }) => {
    test.skip(
      !existsSync(clip('one-face.y4m')),
      'needs tests/fixtures/camera/one-face.y4m from the owner (OWNER_SETUP 3.1)',
    );
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...camera });
    const { browser, page } = await studentBrowser(fakeCamera('one-face.y4m'));
    try {
      await page.clock.install();
      const { attempt } = await startAttempt(await apiAs(accounts.studentA), t.testId);
      const exam = new ExamScreen(page);
      await exam.gotoAttempt(attempt.id, EXAM_HEADING);
      await page.clock.runFor(12_000);
      await exam.choose(optionName(BASIC_QUESTIONS[0]!, 0));
      await exam.expectSaved();
      await expect(exam.warnings).toHaveCount(0);
      expect((await storedAttempt(emulators, ORG_A.id, attempt.id)).strikesCount).toBe(0);
    } finally {
      await browser.close();
    }
  });

  test('PR-02 two faces in view for more than 2 seconds record a strike', async ({ testApi, apiAs, emulators }) => {
    test.skip(
      !existsSync(clip('two-faces.y4m')),
      'needs tests/fixtures/camera/two-faces.y4m from the owner (OWNER_SETUP 3.1)',
    );
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...camera });
    const { browser, page } = await studentBrowser(fakeCamera('two-faces.y4m'));
    try {
      const { attempt } = await startAttempt(await apiAs(accounts.studentA), t.testId);
      const exam = new ExamScreen(page);
      await exam.gotoAttempt(attempt.id, EXAM_HEADING);
      const warning = exam.strikeWarning(1, 3);
      await expect(warning.getByText(STRIKE_REASONS.multiple_faces, { exact: true })).toBeVisible({ timeout: 20_000 });
      expect((await storedAttempt(emulators, ORG_A.id, attempt.id)).strikesCount).toBe(1);
    } finally {
      await browser.close();
    }
  });
});
