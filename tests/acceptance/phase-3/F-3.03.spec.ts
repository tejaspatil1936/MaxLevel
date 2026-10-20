import { BASIC_QUESTIONS, questionsOf, storedTest } from '../fixtures/authoring';
import {
  attemptsOfTest,
  expectApiError,
  leaksAnswerKey,
  postStart,
  startAttempt,
  storedAttempt,
  type ExamPayload,
} from '../fixtures/exam';
import { accounts, departmentId, ORG_A, ORG_B, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';

// F-3.03 Attempt start and resume API (EX-03, EX-04, SER-08, DATA-02, DATA-05, Q-06, TST-06, API-02, PERF-03). These
// REQs are integration-verified (docs/testids/phase-3.md, "Unit and integration tests the build must add"); these
// tests pin the HTTP contract the exam screen relies on ("Requests the tests send directly").

const explanations = BASIC_QUESTIONS.flatMap((q) => (q.explanation ? [q.explanation] : []));
const org = `organizations/${ORG_A.id}`;

test.describe('F-3.03 attempt start and resume API', () => {
  test('EX-03 EX-04 DATA-05 PERF-03 Q-06 starting returns one exam payload without answer keys, and starting again returns the same attempt', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    const student = await apiAs(accounts.studentA);

    const first = await postStart(student, t.testId, 'start-key-1');

    expect([200, 201], JSON.stringify(first.body)).toContain(first.status);
    const body = first.body;
    expect(body.attempt).toMatchObject({
      testId: t.testId,
      status: 'in_progress',
      deadlineAt: t.window.end,
      strikesCount: 0,
      maxStrikes: 3,
    });
    expect(body.questions.map((q) => q.prompt)).toEqual(BASIC_QUESTIONS.map((q) => q.prompt));
    expect(body.questions[0]!.options.map((o) => o.text)).toEqual([...BASIC_QUESTIONS[0]!.options]);
    expect(typeof body.serverTime).toBe('number');
    expect(leaksAnswerKey(body, explanations), 'answer keys in the start payload').toEqual([]);

    const replay = await postStart(student, t.testId, 'start-key-1');
    expect(replay.status, 'a repeated key replays the status').toBe(first.status);
    expect(replay.body, 'a repeated key replays the body').toEqual(first.body);
    const again = await postStart(student, t.testId, 'start-key-2');
    expect([200, 201]).toContain(again.status);
    expect(again.body.attempt.id, 'a second start returns the same attempt').toBe(body.attempt.id);
    expect(again.body.attempt.deadlineAt).toBe(body.attempt.deadlineAt);
    expect(again.body.questions.map((q) => q.id)).toEqual(body.questions.map((q) => q.id));

    const resume = await student.get<ExamPayload>(`/v1/attempts/${body.attempt.id}`);
    expect(resume.status).toBe(200);
    expect(resume.body.attempt.deadlineAt).toBe(body.attempt.deadlineAt);
    expect(resume.body.questions.map((q) => q.id)).toEqual(body.questions.map((q) => q.id));
    expect(resume.body.questions.map((q) => q.options.map((o) => o.id))).toEqual(
      body.questions.map((q) => q.options.map((o) => o.id)),
    );
    expect(leaksAnswerKey(resume.body, explanations), 'answer keys in the resume payload').toEqual([]);

    const stored = await storedAttempt(emulators, ORG_A.id, body.attempt.id);
    expect(stored).toMatchObject({
      testId: t.testId,
      seriesId: t.seriesId,
      studentId: 'stu-org-a-01',
      status: 'in_progress',
      deadlineAt: t.window.end,
      strikesCount: 0,
    });
    expect((stored.draw as { questionIds: string[] }).questionIds).toEqual(body.questions.map((q) => q.id));
    const index = await emulators.doc(`${org}/attemptIndex/${t.testId}_stu-org-a-01`);
    expect(index?.data.activeAttemptId).toBe(body.attempt.id);
    expect(await storedTest(emulators, ORG_A.id, t.testId)).toMatchObject({ attemptsStarted: true });
    const tasks = await testApi.tasks.pending();
    const autoSubmit = tasks.filter(
      (k) => k.path === '/tasks/auto-submit' && k.name.startsWith(`auto-submit-${body.attempt.id}`),
    );
    expect(autoSubmit, 'one auto-submit task for the attempt').toHaveLength(1);
    expect(autoSubmit[0]!.scheduleTime, 'auto-submit 2 minutes after the deadline').toBe(t.window.end + 120_000);
  });

  test('DATA-02 EX-04 concurrent starts by one student create exactly one attempt', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    const student = await apiAs(studentOfA(2));

    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => postStart(student, t.testId, `burst-${n}`)));

    for (const r of results) expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
    expect(new Set(results.map((r) => r.body.attempt.id)).size, 'one attempt ID for every call').toBe(1);
    const mine = (await attemptsOfTest(emulators, ORG_A.id, t.testId)).filter(
      (a) => a.data.studentId === 'stu-org-a-02',
    );
    expect(mine, 'stored attempts').toHaveLength(1);
  });

  test('API-02 SER-08 EX-03 a start needs an Idempotency-Key and is refused when ineligible, outside the window, unpublished or in another org', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const live = await testApi.seedExamTest({ orgId: ORG_A.id });
    const mech = await testApi.seedExamTest({
      orgId: ORG_A.id,
      title: 'Mechanical design',
      eligibility: { departmentIds: [departmentId(ORG_A, 'Mechanical')] },
    });
    const upcoming = await testApi.seedExamTest({ orgId: ORG_A.id, title: 'Later test', opensInMin: 60 });
    const late = await testApi.seedExamTest({ orgId: ORG_A.id, title: 'Late entry test', opensInMin: -20 });
    const unpublished = await testApi.seedExamTest({ orgId: ORG_A.id, title: 'Unpublished test', publish: false });
    const otherOrg = await testApi.seedExamTest({ orgId: ORG_B.id, title: 'COEP aptitude' });
    const student = await apiAs(accounts.studentA);

    expectApiError(await student.post('/v1/attempts', { testId: live.testId }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
    expectApiError(await postStart(student, mech.testId), 403, 'NOT_ELIGIBLE');
    expectApiError(await postStart(student, upcoming.testId), 409, 'WINDOW_NOT_OPEN');
    expectApiError(await postStart(student, late.testId), 409, 'WINDOW_CLOSED');
    expectApiError(await postStart(student, unpublished.testId), 404);
    expectApiError(await postStart(student, otherOrg.testId), 404);
    const admin = await apiAs(accounts.adminA);
    expectApiError(await postStart(admin, live.testId), 403);
    expect(await emulators.count(`organizations/${ORG_A.id}`, 'attempts'), 'no attempt stored').toBe(0);
    expect(await emulators.count(`organizations/${ORG_B.id}`, 'attempts'), 'no attempt stored in org B').toBe(0);

    const { attempt } = await startAttempt(student, live.testId);
    expectApiError(await student.post(`/v1/attempts/${attempt.id}/submit`, {}), 400, 'IDEMPOTENCY_KEY_REQUIRED');
    expect((await storedAttempt(emulators, ORG_A.id, attempt.id)).status, 'not submitted').toBe('in_progress');
  });

  test('TST-06 ORG-05 ORG-14 once an attempt has started, locked settings and questions are refused and release settings still change', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    await startAttempt(await apiAs(accounts.studentA), t.testId);
    const admin = await apiAs(accounts.adminA);
    const overrides = async () =>
      (await storedTest(emulators, ORG_A.id, t.testId)).overrides as Record<string, unknown>;

    expectApiError(
      await admin.patch(`/v1/tests/${t.testId}`, { overrides: { ...(await overrides()), maxStrikes: 5 } }),
      409,
      'TEST_LOCKED',
    );
    expectApiError(
      await admin.post(`/v1/tests/${t.testId}/questions`, {
        prompt: 'What is 2 + 2?',
        options: [
          { id: 'a', text: '4' },
          { id: 'b', text: '5' },
        ],
        correctOptionIds: ['a'],
      }),
      409,
      'TEST_LOCKED',
    );
    expect((await questionsOf(emulators, ORG_A.id, t.testId)).length, 'question set unchanged').toBe(4);
    const release = await admin.patch(`/v1/tests/${t.testId}`, {
      overrides: { ...(await overrides()), resultRelease: 'manual' },
    });
    expect(release.status, JSON.stringify(release.body)).toBe(200);

    const superA = await apiAs(accounts.superAdmin, { orgId: ORG_A.id });
    expectApiError(
      await superA.patch(`/v1/tests/${t.testId}`, { overrides: { ...(await overrides()), durationMin: 90 } }),
      409,
      'TEST_LOCKED',
    );
    const board = await superA.patch(`/v1/tests/${t.testId}`, {
      overrides: { ...(await overrides()), testLeaderboard: true },
    });
    expect(board.status, JSON.stringify(board.body)).toBe(200);
    const adminB = await apiAs(accounts.adminB);
    expectApiError(await adminB.patch(`/v1/tests/${t.testId}`, { overrides: { resultRelease: 'never' } }), 404);

    const stored = await storedTest(emulators, ORG_A.id, t.testId);
    expect(stored.overrides).toMatchObject({ resultRelease: 'manual', testLeaderboard: true });
    expect(stored.overrides).not.toHaveProperty('maxStrikes');
    expect(stored.overrides).not.toHaveProperty('durationMin');
    expect(stored).toMatchObject({ status: 'scheduled', resolved: { maxStrikes: 3, durationMin: 60 } });
  });
});
