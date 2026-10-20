import { API_URL } from '../../env';
import { errorCode } from '../fixtures/api';
import { BASIC_QUESTIONS, optionName } from '../fixtures/authoring';
import { installRequestTimer, requestTimes } from '../fixtures/devices';
import {
  expectApiError,
  postEvent,
  putAnswers,
  startAttempt,
  storedAnswers,
  storedAttempt,
  expectEventsSoon,
} from '../fixtures/exam';
import { openExam } from '../fixtures/exam-session';
import { apiRequest, holdApiRequests } from '../fixtures/network';
import { accounts, ORG_A, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';

// F-3.07 Offline autosave and answer sync (EX-10, EX-12, US-ST-05; and the API side: EX-11, EX-13, EX-14, DATA-03,
// OBS-03, API-06). Contract: docs/testids/phase-3.md, "Autosave" and "Answers". Network drops are real: the browser
// context goes offline, or requests to the API fail; the API itself is never answered for.

const Q = (n: 1 | 2 | 3 | 4) => BASIC_QUESTIONS[n - 1]!;
const ANSWERS_PATH = /\/v1\/attempts\/[^/]+\/answers$/;

test.describe('F-3.07 offline autosave @exam', () => {
  test('EX-10 US-ST-05 EX-12 answers given offline survive a reload and sync when the connection returns', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const { exam, attemptId, payload } = await openExam({ page, signInAs, apiAs, testApi });
    const ids = payload.questions.map((q) => q.id);
    await exam.expectSaved();

    await page.context().setOffline(true);
    await exam.choose(optionName(Q(1), 0));
    await exam.saveAndNext.click();
    await exam.choose(optionName(Q(2), 1));
    await exam.saveAndNext.click();
    await exam.choose(optionName(Q(3), 2));
    await expect(exam.syncStatus).toHaveText('Offline, 3 answers waiting');

    // Reload while the API still can't be reached: the exam comes back from the device alone.
    await page.route(`${API_URL}/**`, (route) => route.abort('internetdisconnected'));
    await page.context().setOffline(false);
    await page.reload();
    await exam.expectAttemptOpen();
    await expect(exam.syncStatus).toHaveText('Offline, 3 answers waiting');
    await exam.goToQuestion(1, 4);
    await expect(exam.option(optionName(Q(1), 0))).toBeChecked();
    await exam.goToQuestion(2, 4);
    await expect(exam.option(optionName(Q(2), 1))).toBeChecked();
    await exam.goToQuestion(3, 4);
    await expect(exam.option(optionName(Q(3), 2))).toBeChecked();
    expect(Object.keys(await storedAnswers(emulators, ORG_A.id, attemptId)), 'nothing reached the server yet').toEqual(
      [],
    );

    await page.unroute(`${API_URL}/**`);

    await exam.expectSaved(45_000);
    const stored = await storedAnswers(emulators, ORG_A.id, attemptId);
    expect(stored[ids[0]!]).toMatchObject({ optionId: 'a' });
    expect(stored[ids[1]!]).toMatchObject({ optionId: 'b' });
    expect(stored[ids[2]!]).toMatchObject({ optionId: 'c' });
    for (const id of ids.slice(0, 3)) {
      expect(Number(stored[id]!.seq), `seq of ${id}`).toBeGreaterThanOrEqual(1);
      expect(typeof stored[id]!.clientTs, `clientTs of ${id}`).toBe('number');
    }
    const sync = (await storedAttempt(emulators, ORG_A.id, attemptId)).sync as Record<string, unknown> | undefined;
    expect(typeof sync?.backlog, 'backlog reported with the batch').toBe('number');
    expect(typeof sync?.clockOffsetMs, 'clock offset reported with the batch').toBe('number');
  });

  test('EX-12 A11Y-09 A11Y-14 the sync status reads Saving while a batch is in flight and Saved after, politely, with an icon', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const { exam, attemptId, payload } = await openExam({ page, signInAs, apiAs, testApi });
    await exam.expectSaved();
    expect(await exam.syncStatus.getAttribute('aria-live'), 'polite, never assertive').not.toBe('assertive');
    await expect(exam.syncStatus.locator('svg')).not.toHaveCount(0);
    const held = await holdApiRequests(page, apiRequest('PUT', ANSWERS_PATH));

    await exam.choose(optionName(Q(1), 3));
    await held.waitUntilHeld();

    await expect(exam.syncStatus).toHaveText('Saving');
    await expect(exam.syncStatus.locator('svg')).not.toHaveCount(0);
    held.release();
    await exam.expectSaved();
    expect((await storedAnswers(emulators, ORG_A.id, attemptId))[payload.questions[0]!.id]).toMatchObject({
      optionId: 'd',
    });
  });

  test('EX-12 failed syncs are retried after 1, 2, 4 and 8 seconds, then every 15 seconds', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    test.setTimeout(120_000);
    await page.clock.install();
    await installRequestTimer(page, ANSWERS_PATH);
    const { exam } = await openExam({ page, signInAs, apiAs, testApi });
    await exam.expectSaved();
    await page.route(ANSWERS_PATH, (route) =>
      route.request().method() === 'PUT' ? route.abort('connectionrefused') : route.continue(),
    );
    const start = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(start + 1_000);

    await exam.choose(optionName(Q(1), 0));

    // Step the paused device clock in quarter seconds and note when each sync attempt is sent.
    const expected = [1_000, 2_000, 4_000, 8_000, 15_000, 15_000];
    let times: number[] = [];
    for (let elapsed = 0; elapsed < 60_000 && times.length < expected.length + 1; elapsed += 250) {
      await page.clock.runFor(250);
      times = await requestTimes(page, 'PUT');
    }
    expect(times.length, 'sync attempts sent').toBeGreaterThanOrEqual(expected.length + 1);
    const gaps = times.slice(1, expected.length + 1).map((t, i) => t - times[i]!);
    for (const [i, gap] of gaps.entries()) {
      expect(gap, `wait before retry ${i + 1}`).toBeGreaterThanOrEqual(expected[i]! - 100);
      expect(gap, `wait before retry ${i + 1}`).toBeLessThanOrEqual(expected[i]! + 600);
    }
    await expect(exam.syncStatus).toHaveText('Offline, 1 answer waiting');

    await page.unroute(ANSWERS_PATH);
    await page.clock.resume();
    await page.clock.runFor(16_000);
    await exam.expectSaved();
  });
});

test.describe('F-3.07 answer sync API', () => {
  test('EX-11 EX-14 DATA-03 OBS-03 answers keep only higher sequence numbers, one record per question, with backlog and offset stored', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    const student = await apiAs(accounts.studentA);
    const { attempt, questions } = await startAttempt(student, t.testId);
    const [q1, q2] = [questions[0]!.id, questions[1]!.id];
    const now = await testApi.clock.now();

    const first = await putAnswers(student, attempt.id, [{ questionId: q1, optionId: 'b', seq: 2, clientTs: now }], {
      backlog: 3,
      clockOffsetMs: -120,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.saved).toEqual([q1]);
    const older = await putAnswers(student, attempt.id, [{ questionId: q1, optionId: 'c', seq: 1, clientTs: now + 1 }]);
    expect(older.body.stale, 'a lower seq is stale').toEqual([q1]);
    const same = await putAnswers(student, attempt.id, [{ questionId: q1, optionId: 'd', seq: 2, clientTs: now + 2 }]);
    expect(same.body.stale, 'an equal seq is stale').toEqual([q1]);
    const both = await putAnswers(
      student,
      attempt.id,
      [
        { questionId: q2, optionId: 'a', seq: 1, clientTs: now + 3 },
        { questionId: q1, optionId: 'a', seq: 3, clientTs: now + 3 },
      ],
      { backlog: 1, clockOffsetMs: 250 },
    );
    expect([...both.body.saved].sort()).toEqual([q1, q2].sort());

    const stored = await storedAnswers(emulators, ORG_A.id, attempt.id);
    expect(Object.keys(stored).sort(), 'one record per question').toEqual([q1, q2].sort());
    expect(stored[q1]).toMatchObject({ optionId: 'a', seq: 3 });
    expect(stored[q2]).toMatchObject({ optionId: 'a', seq: 1 });
    expect(typeof stored[q1]!.serverTs).toBe('number');
    expect((await storedAttempt(emulators, ORG_A.id, attempt.id)).sync).toMatchObject({
      backlog: 1,
      clockOffsetMs: 250,
    });

    const other = await apiAs(studentOfA(2));
    expectApiError(
      await putAnswers(other, attempt.id, [{ questionId: q1, optionId: 'b', seq: 9, clientTs: now }]),
      404,
    );
    expectApiError(await putAnswers(await apiAs(accounts.adminA), attempt.id, []), 403);
    expect((await storedAnswers(emulators, ORG_A.id, attempt.id))[q1]).toMatchObject({ optionId: 'a', seq: 3 });
  });

  test('EX-13 API-06 answers time-stamped before the deadline are kept as late sync within 2 minutes, later ones refused, and bursts get 429', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, timingMode: 'flexible', durationMin: 5 });
    const student = await apiAs(accounts.studentA);
    const { attempt, questions } = await startAttempt(student, t.testId);
    const deadline = attempt.deadlineAt;
    await testApi.clock.advance(deadline - (await testApi.clock.now()) + 30_000);

    const late = await putAnswers(student, attempt.id, [
      { questionId: questions[0]!.id, optionId: 'a', seq: 1, clientTs: deadline - 10_000 },
    ]);
    expect(late.status, JSON.stringify(late.body)).toBe(200);
    expect(late.body.saved).toEqual([questions[0]!.id]);
    const after = await putAnswers(student, attempt.id, [
      { questionId: questions[1]!.id, optionId: 'b', seq: 1, clientTs: deadline + 5_000 },
    ]);
    expect(after.body.rejected).toEqual([{ questionId: questions[1]!.id, code: 'AFTER_DEADLINE' }]);

    const stored = await storedAnswers(emulators, ORG_A.id, attempt.id);
    expect(stored[questions[0]!.id]).toMatchObject({ optionId: 'a', lateSync: true });
    expect(stored[questions[1]!.id], 'the late-stamped answer is not stored').toBeUndefined();
    await expectEventsSoon(
      emulators,
      ORG_A.id,
      attempt.id,
      (events) => events.some((e) => e.data.type === 'late_sync'),
      'a late_sync event stored',
    );

    // Rate limits are per user: a burst of answer saves and of event reports from one student.
    const busy = await apiAs(studentOfA(3));
    const t2 = await testApi.seedExamTest({ orgId: ORG_A.id, title: 'Burst test' });
    const run = await startAttempt(busy, t2.testId);
    const now = await testApi.clock.now();
    const saves = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        putAnswers(busy, run.attempt.id, [
          { questionId: run.questions[0]!.id, optionId: 'a', seq: i + 1, clientTs: now },
        ]),
      ),
    );
    const limitedSaves = saves.filter((r) => r.status === 429);
    expect(limitedSaves.length, 'answer saves refused beyond the burst').toBeGreaterThan(0);
    expect(limitedSaves.map((r) => errorCode(r))).toEqual(limitedSaves.map(() => 'RATE_LIMITED'));
    const reports = await Promise.all(
      Array.from({ length: 20 }, (_, i) => postEvent(busy, run.attempt.id, 'context_menu', now + i)),
    );
    expect(reports.filter((r) => r.status === 429).length, 'event reports refused beyond the burst').toBeGreaterThan(0);
  });
});
