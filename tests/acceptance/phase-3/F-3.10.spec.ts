import {
  expectApiError,
  listEvents,
  postEvent,
  putAnswers,
  startAttempt,
  storedAttempt,
  storedEvents,
} from '../fixtures/exam';
import { accounts, ORG_A, ORG_B, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';

// F-3.10 Proctoring events and strikes API (PR-07, PR-08, PR-10, PR-11; integration-verified, docs/testids/phase-3.md
// "Events"). These tests pin the HTTP contract the exam screen and the admin timeline rely on.

test.describe('F-3.10 proctoring events API', () => {
  test('PR-07 PR-08 PR-11 strike events within 3 seconds count once, the server returns the count, and every event is logged', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    const student = await apiAs(accounts.studentA);
    const { attempt } = await startAttempt(student, t.testId);
    const now = await testApi.clock.now();

    const first = await postEvent(student, attempt.id, 'fullscreen_exit', now, { source: 'test' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ strikesCount: 1, counted: true, status: 'in_progress' });
    expect((await postEvent(student, attempt.id, 'window_blur', now + 100)).body).toMatchObject({
      strikesCount: 1,
      counted: false,
    });
    expect((await postEvent(student, attempt.id, 'context_menu', now + 200)).body).toMatchObject({
      strikesCount: 1,
      counted: false,
    });
    await testApi.clock.advance(4_000);
    expect((await postEvent(student, attempt.id, 'tab_hidden', now + 4_100)).body).toMatchObject({
      strikesCount: 2,
      counted: true,
      status: 'in_progress',
    });

    expect((await storedAttempt(emulators, ORG_A.id, attempt.id)).strikesCount).toBe(2);
    const admin = await apiAs(accounts.adminA);
    const items = await listEvents(admin, attempt.id);
    expect(items.map((e) => e.type)).toEqual(['fullscreen_exit', 'window_blur', 'context_menu', 'tab_hidden']);
    expect(items.map((e) => e.strikeNumber ?? null)).toEqual([1, null, null, 2]);
    expect(items.map((e) => e.clientTs)).toEqual([now, now + 100, now + 200, now + 4_100]);
    expect(items[0]!.details).toMatchObject({ source: 'test' });
    for (let i = 1; i < items.length; i++) expect(items[i]!.serverTs).toBeGreaterThanOrEqual(items[i - 1]!.serverTs);
    expect(await storedEvents(emulators, ORG_A.id, attempt.id)).toHaveLength(4);
    expectApiError(await student.get(`/v1/attempts/${attempt.id}/events`), 403);
  });

  test('PR-10 the strike that reaches the maximum ends and grades the attempt, and nothing more is accepted', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { maxStrikes: 2 } });
    const student = await apiAs(accounts.studentA);
    const { attempt, questions } = await startAttempt(student, t.testId);
    const now = await testApi.clock.now();
    await putAnswers(student, attempt.id, [{ questionId: questions[0]!.id, optionId: 'a', seq: 1, clientTs: now }]);

    expect((await postEvent(student, attempt.id, 'tab_hidden', now)).body).toMatchObject({ strikesCount: 1 });
    await testApi.clock.advance(4_000);
    const last = await postEvent(student, attempt.id, 'no_face', now + 4_000);

    expect(last.body).toMatchObject({ strikesCount: 2, counted: true, status: 'terminated' });
    const stored = await storedAttempt(emulators, ORG_A.id, attempt.id);
    expect(stored).toMatchObject({ status: 'terminated', terminationReason: 'max_strikes', strikesCount: 2 });
    expect(stored.result).toMatchObject({ score: 1, max: 4, correct: 1, unanswered: 3 });
    expectApiError(
      await putAnswers(student, attempt.id, [
        { questionId: questions[1]!.id, optionId: 'b', seq: 1, clientTs: now + 5_000 },
      ]),
      409,
      'ATTEMPT_FINISHED',
    );
    expectApiError(await postEvent(student, attempt.id, 'tab_hidden', now + 9_000), 409, 'ATTEMPT_FINISHED');
    expect((await storedAttempt(emulators, ORG_A.id, attempt.id)).strikesCount).toBe(2);
  });

  test('ORG-05 ORG-14 PR-11 the event timeline is open to admins of the attempt org and to super admins, and to nobody else', async ({
    testApi,
    apiAs,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    const student = await apiAs(accounts.studentA);
    const { attempt } = await startAttempt(student, t.testId);
    await postEvent(student, attempt.id, 'window_blur', await testApi.clock.now());
    const adminA = await apiAs(accounts.adminA);
    const expected = await listEvents(adminA, attempt.id);
    expect(expected.map((e) => e.type)).toEqual(['window_blur']);

    expectApiError(await (await apiAs(accounts.adminB)).get(`/v1/attempts/${attempt.id}/events`), 404);
    const superA = await apiAs(accounts.superAdmin, { orgId: ORG_A.id });
    expect(await listEvents(superA, attempt.id)).toEqual(expected);
    expectApiError(await superA.inOrg(ORG_B.id).get(`/v1/attempts/${attempt.id}/events`), 404);
    expectApiError(await postEvent(await apiAs(accounts.studentB), attempt.id, 'tab_hidden', Date.now()), 404);
    expectApiError(await postEvent(await apiAs(studentOfA(2)), attempt.id, 'tab_hidden', Date.now()), 404);
    expect(await listEvents(adminA, attempt.id)).toHaveLength(1);
  });
});
