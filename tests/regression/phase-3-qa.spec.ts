import type { Locator, Page } from '@playwright/test';
import { BASIC_QUESTIONS, optionName } from '../acceptance/fixtures/authoring';
import { EXAM_HEADING, openExam, type ExamFixtures } from '../acceptance/fixtures/exam-session';
import { startAttempt, storedAttempt, storedEvents } from '../acceptance/fixtures/exam';
import { accounts, ORG_A } from '../acceptance/fixtures/seed';
import { expect, test } from '../acceptance/fixtures/test';
import type { ApiClient } from '../acceptance/fixtures/api';
import { ExamScreen } from '../acceptance/pages/exam-screen';
import { PhonePage } from '../acceptance/pages/phone-page';

// Bugs found by the phase 3 release-gate QA. Each test failed before its fix.

const phoneCamera = { overrides: { secondCamera: true } };

async function pairingUrl(api: ApiClient, attemptId: string): Promise<string> {
  const res = await api.post<{ url: string }>(`/v1/attempts/${attemptId}/pairing-token`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.url;
}

/**
 * Counts the page's Realtime Database connection attempts (WebSocket or long-polling) from now on, so a test can wait
 * until the SDK has retried while offline instead of sleeping.
 */
function rtdbAttempts(page: Page): () => number {
  let n = 0;
  const rtdb = (url: string) => /^(wss?|https?):\/\/(127\.0\.0\.1|localhost):9000\//.test(url);
  page.on('websocket', (ws) => {
    if (rtdb(ws.url())) n++;
  });
  page.on('request', (req) => {
    if (rtdb(req.url())) n++;
  });
  return () => n;
}

/**
 * Takes `page` offline until it shows that it lost Realtime Database (`noticed`) and its client has retried at least
 * `retries` times, then back online.
 */
async function offlineThroughRetries(page: Page, noticed: Locator, retries: number): Promise<void> {
  await page.context().setOffline(true);
  await expect(noticed).toBeVisible({ timeout: 30_000 });
  const attempts = rtdbAttempts(page);
  await expect
    .poll(attempts, { message: `${retries} reconnect attempts while offline`, timeout: 30_000 })
    .toBeGreaterThanOrEqual(retries);
  await page.context().setOffline(false);
}

/** An attempt in progress with a paired phone, both connected. */
async function pairedExam(f: ExamFixtures & { newPhone: () => Promise<Page> }) {
  const t = await f.testApi.seedExamTest({ orgId: ORG_A.id, ...phoneCamera });
  await f.signInAs(accounts.studentA);
  const api = await f.apiAs(accounts.studentA);
  const { attempt } = await startAttempt(api, t.testId);
  const phonePage = await f.newPhone();
  const phone = new PhonePage(phonePage);
  await phone.open(await pairingUrl(api, attempt.id));
  await phone.expectConnected();
  const exam = new ExamScreen(f.page);
  await exam.gotoAttempt(attempt.id, EXAM_HEADING);
  await expect(exam.phoneStatus('Phone connected')).toBeVisible({ timeout: 20_000 });
  return { t, attemptId: attempt.id, exam, phone, phonePage };
}

test.describe('phase 3 QA: Realtime Database comes back after a network drop @exam', () => {
  test('PR-15 PR-16 DATA-06 REL-05 the laptop offline for a while then online shows the phone connected again', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    newPhone,
  }) => {
    test.setTimeout(120_000);
    const { exam } = await pairedExam({ page, signInAs, apiAs, testApi, newPhone });

    await offlineThroughRetries(page, exam.phoneStatus('Phone status unavailable'), 3);

    await expect(exam.phoneStatus('Phone connected')).toBeVisible({ timeout: 45_000 });
  });

  test('PR-15 PR-16 REL-05 the phone offline for a while then online reconnects with no phone_disconnected strike', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    newPhone,
    emulators,
    rtdb,
  }) => {
    test.setTimeout(120_000);
    const { t, attemptId, exam, phone, phonePage } = await pairedExam({ page, signInAs, apiAs, testApi, newPhone });

    await offlineThroughRetries(phonePage, phone.connection.filter({ hasText: 'Reconnecting' }), 3);

    await expect(phone.connection).toHaveText('Connected', { timeout: 45_000 });
    await rtdb.expectPresence(ORG_A.id, t.testId, attemptId, 'phone', { online: true });
    await expect(exam.phoneStatus('Phone connected')).toBeVisible({ timeout: 45_000 });
    expect((await storedAttempt(emulators, ORG_A.id, attemptId)).strikesCount).toBe(0);
    const events = await storedEvents(emulators, ORG_A.id, attemptId);
    expect(events.filter((e) => e.data.type === 'phone_disconnected')).toEqual([]);
  });
});

test.describe('phase 3 QA: keyboard focus stays in the exam @lockdown', () => {
  test('PR-05 A11Y-03 Tab past Save and next keeps focus inside the page and records no strike', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const { exam, attemptId } = await openExam({ page, signInAs, apiAs, testApi });
    await page.evaluate(() => {
      const w = window as unknown as { windowBlurs: number };
      w.windowBlurs = 0;
      window.addEventListener('blur', (e) => {
        if (e.target === window) w.windowBlurs++;
      });
    });
    await exam.saveAndNext.focus();
    await expect(exam.saveAndNext).toBeFocused();

    await page.keyboard.press('Tab');

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.activeElement;
            return document.hasFocus() && !!el && el !== document.body && document.body.contains(el);
          }),
        { message: 'focus is on an element inside the page' },
      )
      .toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect(exam.saveAndNext, 'Shift+Tab goes back to Save and next').toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { windowBlurs: number }).windowBlurs)).toBe(0);
    // An answer round trip, so any strike report sent on the way has reached the server first.
    await exam.choose(optionName(BASIC_QUESTIONS[0]!, 0));
    await exam.expectSaved();
    await expect(exam.warnings).toHaveCount(0);
    expect((await storedAttempt(emulators, ORG_A.id, attemptId)).strikesCount).toBe(0);
  });
});
