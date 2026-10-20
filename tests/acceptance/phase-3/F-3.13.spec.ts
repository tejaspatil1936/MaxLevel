import { optionName, BASIC_QUESTIONS } from '../fixtures/authoring';
import { expectNoMediaSent, installWakeLockSpy, recordTraffic, wakeLockRequests } from '../fixtures/devices';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { storedTest } from '../fixtures/authoring';
import {
  advanceExamTime,
  expectApiError,
  expectEventsSoon,
  postStart,
  strikeNumbersOf,
  PAIRING,
  PAIRING_LINK,
  startAttempt,
  storedAttempt,
  storedEvents,
  STRIKE_REASONS,
} from '../fixtures/exam';
import { EXAM_HEADING } from '../fixtures/exam-session';
import { scrollsHorizontally } from '../fixtures/layout';
import { controllableRtdb } from '../fixtures/rtdb';
import { accounts, departmentId, ORG_A, ORG_B, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import type { ApiClient } from '../fixtures/api';
import { ExamScreen } from '../pages/exam-screen';
import { BASIC_CHECKS, PairingRegion, PreflightPage } from '../pages/exam-flow';
import { PhonePage } from '../pages/phone-page';
import { StudentTestPage } from '../pages/student-pages';

// F-3.13 Phone pairing and presence (PR-13, PR-15, PR-16, PR-17, DATA-06, REL-05, US-ST-04; PR-14 checked on the
// redeem response). Contract: docs/testids/phase-3.md, "Rules" (phone pairing), "Phone pairing page" and "On the
// laptop". The phone is a second, 390 px browser context with the same fake camera; Realtime Database is the emulator.

const phoneCamera = { overrides: { secondCamera: true } };
const MIN = 60_000;

/** `POST /v1/tests/{testId}/pairing-token`: the rules screen's code, reserving the attempt ID before Start. */
function reserve(api: ApiClient, testId: string) {
  return api.post<PairingToken & { attemptId: string }>(`/v1/tests/${testId}/pairing-token`, {});
}

interface PairingToken {
  token: string;
  url: string;
  expiresAt: number;
}

async function pairingToken(api: ApiClient, attemptId: string): Promise<PairingToken> {
  const res = await api.post<PairingToken>(`/v1/attempts/${attemptId}/pairing-token`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.url).toMatch(PAIRING_LINK);
  return res.body;
}

/** The claims a Firebase custom token carries (the emulator's tokens are unsigned JWTs). */
function customTokenClaims(token: string): Record<string, unknown> {
  const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as {
    claims?: Record<string, unknown>;
  };
  return payload.claims ?? {};
}

/** Expiry texts for a code issued between `from` and `to` (server time): 5 minutes later, in IST. */
function expiryPattern(from: number, to: number): RegExp {
  const texts = [...new Set([from, to].map((ms) => PAIRING.expiresAt(ms + 5 * MIN)))];
  return new RegExp(`^\\s*(?:${texts.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*$`);
}

test.describe('F-3.13 phone pairing on the laptop @exam', () => {
  test('US-ST-04 PR-13 PR-15 the student pairs a phone by QR code on the rules screen, and Start waits for it', async ({
    page,
    signInAs,
    testApi,
    newPhone,
    rtdb,
    emulators,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...phoneCamera });
    await signInAs(accounts.studentA);
    const preflight = new PreflightPage(page);
    await preflight.goto(t.testId);
    const before = await testApi.clock.now();
    const rules = await preflight.passAndContinue(BASIC_CHECKS);

    const pairing = rules.pairing;
    await expect(pairing.qr).toBeVisible();
    const link = await pairing.url();
    expect(link).toMatch(PAIRING_LINK);
    await expect(pairing.region.getByText(/^This code works once/)).toHaveText(
      expiryPattern(before, await testApi.clock.now()),
    );
    await expect(pairing.status).toHaveText('Phone not connected');
    await rules.agreement.check();
    await rules.expectStartDisabled('Connect your phone first.');

    const phone = new PhonePage(await newPhone());
    await phone.open(link);
    await phone.expectConnected();
    await phone.expectCameraPlaying();

    await expect(pairing.status).toHaveText('Phone connected', { timeout: 20_000 });
    await rules.expectStartEnabled();
    const pressedAt = await testApi.clock.now();
    const attemptId = await rules.agreeAndStart();
    const exam = new ExamScreen(page);
    await expect(exam.phoneStatus('Phone connected')).toBeVisible();
    await rtdb.expectPresence(ORG_A.id, t.testId, attemptId, 'phone', { online: true, cameraOn: true });
    await rtdb.expectPresence(ORG_A.id, t.testId, attemptId, 'laptop', { online: true });
    expect(
      Number((await storedAttempt(emulators, ORG_A.id, attemptId)).startedAt),
      'pairing did not start the clock',
    ).toBeGreaterThanOrEqual(pressedAt);
  });

  test('PR-16 a phone gone for over 15 seconds brings up the reconnect overlay with a fresh code, and over 60 seconds a strike', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    newPhone,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...phoneCamera });
    await page.clock.install();
    await signInAs(accounts.studentA);
    const api = await apiAs(accounts.studentA);
    const { attempt } = await startAttempt(api, t.testId);
    const first = await pairingToken(api, attempt.id);
    const phonePage = await newPhone();
    const phone = new PhonePage(phonePage);
    await phone.open(first.url);
    await phone.expectConnected();
    const exam = new ExamScreen(page);
    await exam.gotoAttempt(attempt.id, EXAM_HEADING);
    await expect(exam.phoneStatus('Phone connected')).toBeVisible({ timeout: 20_000 });

    await phonePage.context().close();

    await expect(exam.phoneStatus('Phone disconnected')).toBeVisible({ timeout: 20_000 });
    await expect(exam.reconnect).toHaveCount(0);
    await advanceExamTime(page, testApi, 16_000);
    await expect(exam.reconnect).toBeVisible();
    await expect(exam.reconnect.getByText(PAIRING.reconnect, { exact: true })).toBeVisible();
    const fresh = new PairingRegion(exam.reconnect);
    await expect(fresh.qr).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    const freshLink = await fresh.url();
    expect(freshLink).toMatch(PAIRING_LINK);
    expect(freshLink, 'a new code').not.toBe(first.url);
    expect((await storedAttempt(emulators, ORG_A.id, attempt.id)).strikesCount, 'no strike at 15 seconds').toBe(0);

    await advanceExamTime(page, testApi, 45_000);

    const warning = exam.strikeWarning(1, 3);
    await expect(warning.getByText(STRIKE_REASONS.phone_disconnected, { exact: true })).toBeVisible();
    await warning.getByRole('button', { name: 'I understand', exact: true }).click();
    const events = await expectEventsSoon(
      emulators,
      ORG_A.id,
      attempt.id,
      (evs) => strikeNumbersOf(evs, 'phone_disconnected').includes(1),
      'phone_disconnected stored as strike 1',
    );
    expect(strikeNumbersOf(events, 'phone_disconnected')).toEqual([1]);

    const again = new PhonePage(await newPhone());
    await again.open(freshLink);
    await again.expectConnected();
    await expect(exam.reconnect).toBeHidden({ timeout: 20_000 });
    await expect(exam.phoneStatus('Phone connected')).toBeVisible();
  });

  test('DATA-06 closing the exam tab marks the laptop offline at once', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    rtdb,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    await signInAs(accounts.studentA);
    const { attempt } = await startAttempt(await apiAs(accounts.studentA), t.testId);
    await new ExamScreen(page).gotoAttempt(attempt.id, EXAM_HEADING);
    await rtdb.expectPresence(ORG_A.id, t.testId, attempt.id, 'laptop', { online: true, visible: true });

    await page.close();

    await rtdb.expectPresence(ORG_A.id, t.testId, attempt.id, 'laptop', { online: false });
  });

  test('REL-05 with Realtime Database unreachable the exam goes on and no phone strike is recorded', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    newPhone,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...phoneCamera });
    await page.clock.install();
    const link = await controllableRtdb(page);
    await signInAs(accounts.studentA);
    const api = await apiAs(accounts.studentA);
    const { attempt } = await startAttempt(api, t.testId);
    const phonePage = await newPhone();
    await new PhonePage(phonePage).open((await pairingToken(api, attempt.id)).url);
    await new PhonePage(phonePage).expectConnected();
    const exam = new ExamScreen(page);
    await exam.gotoAttempt(attempt.id, EXAM_HEADING);
    await expect(exam.phoneStatus('Phone connected')).toBeVisible({ timeout: 20_000 });

    await link.cut();
    await expect(exam.phoneStatus('Phone status unavailable')).toBeVisible({ timeout: 20_000 });
    await phonePage.context().close();
    await advanceExamTime(page, testApi, 70_000);

    await exam.choose(optionName(BASIC_QUESTIONS[0]!, 0));
    await exam.expectSaved();
    await expect(exam.reconnect).toHaveCount(0);
    await expect(exam.warnings).toHaveCount(0);
    await expect(exam.phoneStatus('Phone status unavailable')).toBeVisible();
    expect((await storedAttempt(emulators, ORG_A.id, attempt.id)).strikesCount).toBe(0);
    const events = await storedEvents(emulators, ORG_A.id, attempt.id);
    expect(events.filter((e) => e.data.type === 'phone_disconnected')).toEqual([]);
  });
});

test.describe('F-3.13 phone page @phone', () => {
  test('PR-15 PR-17 PR-14 the phone page turns the camera on, keeps the screen awake, shows how to place the phone, heartbeats every 5 seconds and sends no images', async ({
    page,
    apiAs,
    testApi,
    rtdb,
  }) => {
    test.setTimeout(90_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...phoneCamera });
    const api = await apiAs(accounts.studentA);
    const { attempt } = await startAttempt(api, t.testId);
    const issuedAt = await testApi.clock.now();
    const pairing = await pairingToken(api, attempt.id);
    expect(Math.abs(pairing.expiresAt - (issuedAt + 5 * MIN)), 'valid for 5 minutes').toBeLessThanOrEqual(5_000);
    await installWakeLockSpy(page);
    const traffic = recordTraffic(page);
    const redeemed = page.waitForResponse((r) => r.url().endsWith('/v1/pairing/redeem'));
    const phone = new PhonePage(page);

    await phone.open(pairing.url);

    await phone.expectConnected();
    await phone.expectCameraPlaying();
    await expect(phone.help).toBeVisible();
    expect(await wakeLockRequests(page), 'screen wake lock requested').toBeGreaterThan(0);
    expect(await scrollsHorizontally(page), 'no sideways scroll at 390 px').toBe(false);
    await expectNoSeriousA11yViolations(page);
    const redeem = await redeemed;
    expect(redeem.status()).toBe(200);
    const body = (await redeem.json()) as { customToken: string; attemptId: string; orgId: string };
    expect(body).toMatchObject({ attemptId: attempt.id, orgId: ORG_A.id });
    expect(customTokenClaims(body.customToken)).toMatchObject({
      role: 'device',
      orgId: ORG_A.id,
      attemptId: attempt.id,
    });

    await rtdb.expectPresence(ORG_A.id, t.testId, attempt.id, 'phone', { online: true, cameraOn: true });
    const seen: number[] = [];
    const lastSeen = async () => Number((await rtdb.presence(ORG_A.id, t.testId, attempt.id, 'phone'))?.lastSeen);
    seen.push(await lastSeen());
    for (let beat = 1; beat <= 2; beat++) {
      await expect
        .poll(lastSeen, { message: `heartbeat ${beat}`, timeout: 15_000, intervals: [100] })
        .toBeGreaterThan(seen[seen.length - 1]!);
      seen.push(await lastSeen());
    }
    const gap = seen[2]! - seen[1]!;
    expect(gap, 'heartbeat interval').toBeGreaterThanOrEqual(4_000);
    expect(gap, 'heartbeat interval').toBeLessThanOrEqual(7_000);
    expectNoMediaSent(traffic);
  });

  test('PR-13 PR-14 a pairing link works once and expires after 5 minutes, and only the attempt own student can ask for one', async ({
    page,
    apiAs,
    testApi,
    newPhone,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...phoneCamera });
    const api = await apiAs(accounts.studentA);
    const { attempt } = await startAttempt(api, t.testId);
    const once = await pairingToken(api, attempt.id);
    const phone = new PhonePage(page);
    await phone.open(once.url);
    await phone.expectConnected();

    const second = new PhonePage(await newPhone());
    await second.open(once.url);
    await expect(second.refusal).toHaveText(PAIRING.used);
    await expect(second.connection).toHaveCount(0);
    expectApiError(await api.post('/v1/pairing/redeem', { token: once.token }), 409, 'PAIRING_TOKEN_USED');

    const stale = await pairingToken(api, attempt.id);
    await testApi.clock.advance(5 * MIN + 1_000);
    const third = new PhonePage(await newPhone());
    await third.open(stale.url);
    await expect(third.refusal).toHaveText(PAIRING.expired);
    expectApiError(await api.post('/v1/pairing/redeem', { token: stale.token }), 410, 'PAIRING_TOKEN_EXPIRED');

    const bogus = new PhonePage(await newPhone());
    await bogus.open('/pair/?token=not-a-real-token');
    await expect(bogus.refusal).toHaveText(PAIRING.invalid);

    expectApiError(await (await apiAs(studentOfA(2))).post(`/v1/attempts/${attempt.id}/pairing-token`, {}), 404);
    expectApiError(await (await apiAs(accounts.adminA)).post(`/v1/attempts/${attempt.id}/pairing-token`, {}), 403);
  });
});

test.describe('F-3.13 pairing before the start API', () => {
  test('PR-13 ORG-05 ORG-11 SER-08 a pairing code before Start is refused like a start, and a refusal stores nothing', async ({
    testApi,
    apiAs,
    emulators,
    rtdb,
  }) => {
    const live = await testApi.seedExamTest({ orgId: ORG_A.id, ...phoneCamera });
    const otherOrg = await testApi.seedExamTest({ orgId: ORG_B.id, title: 'COEP aptitude', ...phoneCamera });
    const unpublished = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Unpublished test',
      publish: false,
      ...phoneCamera,
    });
    const mech = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Mechanical design',
      eligibility: { departmentIds: [departmentId(ORG_A, 'Mechanical')] },
      ...phoneCamera,
    });
    const upcoming = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Later test',
      opensInMin: 60,
      ...phoneCamera,
    });
    const late = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Late entry test',
      opensInMin: -20,
      ...phoneCamera,
    });
    const student = await apiAs(accounts.studentA);

    expectApiError(await reserve(student, otherOrg.testId), 404);
    expectApiError(await reserve(student, unpublished.testId), 404);
    expectApiError(await reserve(student, mech.testId), 403, 'NOT_ELIGIBLE');
    expectApiError(await reserve(student, upcoming.testId), 409, 'WINDOW_NOT_OPEN');
    expectApiError(await reserve(student, late.testId), 409, 'WINDOW_CLOSED');
    expectApiError(await reserve(await apiAs(accounts.adminA), live.testId), 403);
    expectApiError(await reserve(await apiAs(accounts.superAdmin, { orgId: ORG_A.id }), live.testId), 403);
    expectApiError(await reserve(await apiAs(accounts.superAdmin), live.testId), 403);

    for (const orgId of [ORG_A.id, ORG_B.id]) {
      expect(await emulators.count(`organizations/${orgId}`, 'attemptIndex'), `attempt index in ${orgId}`).toBe(0);
      expect(await emulators.count(`organizations/${orgId}`, 'attempts'), `attempts in ${orgId}`).toBe(0);
    }
    expect(await rtdb.get('attemptOwners'), 'no attempt owner written').toBeNull();

    const first = await reserve(student, live.testId);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.url).toMatch(PAIRING_LINK);
    const again = await reserve(student, live.testId);
    expect(again.body.attemptId, 'a repeat keeps the reserved attempt').toBe(first.body.attemptId);
    expect(again.body.token, 'with a new code').not.toBe(first.body.token);
  });

  test('PR-13 TST-06 a reservation is not a started attempt: no lock, no Resume test, and Start then uses the reserved attempt', async ({
    page,
    signInAs,
    testApi,
    apiAs,
    emulators,
  }) => {
    const reservedOnly = await testApi.seedExamTest({ orgId: ORG_A.id, title: 'Reserved only', ...phoneCamera });
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, ...phoneCamera });
    await signInAs(accounts.studentA);
    const student = await apiAs(accounts.studentA);
    const admin = await apiAs(accounts.adminA);
    const overrides = async (testId: string) =>
      (await storedTest(emulators, ORG_A.id, testId)).overrides as Record<string, unknown>;

    expect((await reserve(student, reservedOnly.testId)).status).toBe(200);
    const unlocked = await admin.patch(`/v1/tests/${reservedOnly.testId}`, {
      overrides: { ...(await overrides(reservedOnly.testId)), maxStrikes: 5 },
    });
    expect(unlocked.status, `a reservation does not lock the test: ${JSON.stringify(unlocked.body)}`).toBe(200);
    const storedReserved = await storedTest(emulators, ORG_A.id, reservedOnly.testId);
    expect(storedReserved.attemptsStarted ?? false, 'attemptsStarted after a reservation').toBe(false);
    expect(storedReserved.overrides).toMatchObject({ maxStrikes: 5 });

    const reserved = await reserve(student, t.testId);
    expect(reserved.status).toBe(200);
    expect(await emulators.count(`organizations/${ORG_A.id}`, 'attempts'), 'no attempt record yet').toBe(0);
    const testPage = new StudentTestPage(page);
    await testPage.goto(t.testId, EXAM_HEADING);
    await expect(testPage.checkDevice).toBeVisible();
    await expect(testPage.resume).toHaveCount(0);

    const started = await postStart(student, t.testId);
    expect([200, 201], JSON.stringify(started.body)).toContain(started.status);
    expect(started.body.attempt.id, 'Start uses the reserved attempt ID').toBe(reserved.body.attemptId);
    expect((await reserve(student, t.testId)).body.attemptId, 'and pairing keeps it').toBe(reserved.body.attemptId);
    expectApiError(
      await admin.patch(`/v1/tests/${t.testId}`, { overrides: { ...(await overrides(t.testId)), maxStrikes: 5 } }),
      409,
      'TEST_LOCKED',
    );
  });
});
