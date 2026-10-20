import { errorCode } from '../fixtures/api';
import {
  auditFor,
  AUTHORING_NOW,
  istMs,
  SEEDED_SERIES,
  SEEDED_TEST,
  storedTest,
  SYSTEM_DEFAULTS,
} from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { expectTopRightOfHeader } from '../fixtures/layout';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { SeriesPage } from '../pages/series-pages';
import { PUBLISH_DISABLED_REASON, TestEditorPage } from '../pages/test-editor';

// F-2.08 Approval checklist and publishing (Q-14, UX-10, US-AD-09; TST-04, TST-05 and Q-15 are proved by integration
// tests and their visible and stored effects are checked here). Contract: docs/testids/phase-2.md, "Preview tab" and
// "Test editor".

const ALL_PASSED = (total: number) =>
  [
    'Passed: Every question is valid',
    'Passed: Every draw can be filled',
    `Passed: Total marks ${total}`,
    'Passed: Settings are complete',
  ] as const;

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-2.08 approval checklist and publishing', () => {
  test('Q-14 the approval checklist passes for a valid test, computes total marks, and Approve test approves it', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({
      orgId: ORG_A.id,
      overrides: { marking: { marks: 4, negativeMarks: 1, preset: 'p4_m1' } },
    });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    await expect(editor.status).toHaveText('In review');
    await expect(editor.publish).toBeDisabled();
    const preview = await editor.preview();
    await preview.expectChecklist(ALL_PASSED(16));
    await expectNoSeriousA11yViolations(page);

    await preview.approveAndConfirm();

    await expect(editor.status).toHaveText('Approved');
    await expect(editor.publish).toBeEnabled();
    await expect(preview.approve).toHaveCount(0);
    const adminUid = (await emulators.authAccount(accounts.adminA.email)).localId;
    const stored = await storedTest(emulators, ORG_A.id, testId);
    expect(stored).toMatchObject({
      status: 'approved',
      totalMarks: 16,
      approval: { status: 'approved', approvedBy: adminUid },
    });
    expect(typeof (stored.approval as { approvedAt?: unknown }).approvedAt).toBe('number');
    expect(stored.resolved ?? null, 'approval alone saves no snapshot').toBeNull();
    const [entry] = await auditFor(emulators, ORG_A.id, 'test.approve', testId);
    expect(entry?.data.actor).toMatchObject({ email: accounts.adminA.email, role: 'admin' });
  });

  test('TST-05 UX-10 US-AD-09 Publish test on an approved test says "Test published", schedules it and saves the snapshot', async ({
    page,
    signInAs,
    testApi,
    apiAs,
    emulators,
  }) => {
    const { seriesId, testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, overrides: { maxStrikes: 5 } });
    expect((await (await apiAs(accounts.adminA)).post(`/v1/tests/${testId}/approve`, {})).status).toBe(200);
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    await expect(editor.status).toHaveText('Approved');
    await expectTopRightOfHeader(editor.shell.main, editor.shell.heading(SEEDED_TEST.heading), editor.publish);

    await editor.publishTest();

    await expect(editor.status).toHaveText('Scheduled');
    const stored = await storedTest(emulators, ORG_A.id, testId);
    expect(stored.status).toBe('scheduled');
    expect(stored.resolved).toMatchObject({
      ...SYSTEM_DEFAULTS,
      maxStrikes: 5,
      window: { start: SEEDED_TEST.windowStart, end: SEEDED_TEST.windowEnd },
      marking: { marks: 1, negativeMarks: 0, preset: 'p1_0' },
    });
    const [entry] = await auditFor(emulators, ORG_A.id, 'test.publish', testId);
    expect(entry?.data.actor).toMatchObject({ email: accounts.adminA.email, role: 'admin' });
    const series = new SeriesPage(page);
    await series.goto(seriesId, SEEDED_SERIES.title);
    await expect(series.item(SEEDED_TEST.title)).toContainText('Scheduled');
  });

  test('US-AD-09 TST-04 a test that is not approved cannot be published, in the editor or through the API', async ({
    page,
    signInAs,
    testApi,
    apiAs,
    emulators,
  }) => {
    const inReview = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    const draft = await testApi.seedAuthoringTest({
      orgId: ORG_A.id,
      seriesId: inReview.seriesId,
      title: 'Verbal ability',
      scheduledDate: '2026-11-03',
      questions: 'none',
    });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(inReview.testId, SEEDED_TEST.heading);

    await expect(editor.publish).toBeDisabled();
    await expect(editor.publish).toHaveAccessibleDescription(PUBLISH_DISABLED_REASON);

    const api = await apiAs(accounts.adminA);
    for (const { testId } of [inReview, draft]) {
      const refused = await api.post(`/v1/tests/${testId}/publish`, {});
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('TEST_NOT_APPROVED');
      const stored = await storedTest(emulators, ORG_A.id, testId);
      expect(stored.status).not.toBe('scheduled');
      expect(stored.resolved ?? null).toBeNull();
    }
    expect(await auditFor(emulators, ORG_A.id, 'test.publish')).toHaveLength(0);
  });

  test('Q-14 a question that needs attention fails the checklist and blocks approval until it is fixed', async ({
    page,
    signInAs,
    testApi,
    apiAs,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, invalidQuestion: true });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    let preview = await editor.preview();
    await expect(preview.checkItem(1)).toHaveText('Failed: 1 question needs attention');

    await preview.approve.click();

    await expect(preview.refused).toBeVisible();
    await expect(editor.status).toHaveText('In review');
    const refused = await (
      await apiAs(accounts.adminA)
    ).post<{ error: { details: { failed: string[] } } }>(`/v1/tests/${testId}/approve`, {});
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe('CHECKLIST_FAILED');
    expect(refused.body.error.details.failed).toContain('Failed: 1 question needs attention');
    const stored = await storedTest(emulators, ORG_A.id, testId);
    expect(stored.status).toBe('in_review');
    expect(stored.approval ?? null).toBeNull();

    const questions = await editor.questions();
    const q = await questions.openEdit(5);
    await q.fill({ correct: 'B' });
    await q.saveAndClose();
    preview = await editor.preview();
    await preview.expectChecklist(ALL_PASSED(5));
    await preview.approveAndConfirm();
    await expect(editor.status).toHaveText('Approved');
  });

  test('Q-14 a section draw that can no longer be filled fails the checklist and blocks approval', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({
      orgId: ORG_A.id,
      questions: 'sectioned',
      sectionDraws: { Quant: 5 },
    });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    let preview = await editor.preview();
    await preview.expectChecklist(ALL_PASSED(9));
    const questions = await editor.questions();

    await questions.deleteQuestion(1);
    await questions.deleteQuestion(1);

    preview = await editor.preview();
    await expect(preview.checkItem(2)).toHaveText('Failed: Quant draws 5 but has 4 approved questions');
    await expect(preview.checkItem(1)).toHaveText('Passed: Every question is valid');
    await preview.approve.click();
    await expect(preview.refused).toBeVisible();
    await expect(editor.status).toHaveText('In review');
  });

  test('Q-15 editing a question of a published test returns it to In review; a release setting change does not', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, publish: true });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    await expect(editor.status).toHaveText('Scheduled');

    const settings = await editor.settings();
    const release = settings.setting('Result release');
    await release.override();
    await release.controls.pick('Result release', 'Manually');
    await settings.saveAndConfirm();

    await expect(editor.status).toHaveText('Scheduled');
    await expect
      .poll(
        async () =>
          ((await storedTest(emulators, ORG_A.id, testId)).resolved as { resultRelease?: string })?.resultRelease,
      )
      .toBe('manual');
    expect((await storedTest(emulators, ORG_A.id, testId)).status).toBe('scheduled');

    const questions = await editor.questions();
    const q = await questions.openEdit(2);
    await q.fill({ prompt: 'What is 20% of 150?' });
    await q.saveAndClose();

    await expect(editor.status).toHaveText('In review');
    await expect(editor.publish).toBeDisabled();
    const stored = await storedTest(emulators, ORG_A.id, testId);
    expect(stored.status).toBe('in_review');
    expect(stored.resolved ?? null, 'snapshot cleared').toBeNull();
    expect(stored.approval ?? null, 'approval cleared').toBeNull();
  });

  test('TST-04 a published test shows Live during its window and Closed after it, from the server clock', async ({
    page,
    signInAs,
    testApi,
    apiAs,
  }) => {
    const { seriesId, testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, publish: true });
    await testApi.clock.set(istMs(2026, 11, 2, 10, 15));
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);

    await expect(editor.status).toHaveText('Live');
    const series = new SeriesPage(page);
    await series.goto(seriesId, SEEDED_SERIES.title);
    await expect(series.item(SEEDED_TEST.title)).toContainText('Live');

    await testApi.clock.set(istMs(2026, 11, 2, 11, 5));
    await editor.goto(testId, SEEDED_TEST.heading);

    await expect(editor.status).toHaveText('Closed');
    const res = await (await apiAs(accounts.adminA)).get<{ status: string }>(`/v1/tests/${testId}`);
    expect(res.body.status).toBe('closed');
  });

  test('ORG-05 ORG-14 TST-04 approve and publish are 404 for org B tests, refused for students, and work for a super admin', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const a = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    const b = await testApi.seedAuthoringTest({ orgId: ORG_B.id });
    const adminA = await apiAs(accounts.adminA);
    expect((await adminA.post(`/v1/tests/${b.testId}/approve`, {})).status).toBe(404);
    expect((await adminA.post(`/v1/tests/${b.testId}/publish`, {})).status).toBe(404);
    expect((await storedTest(emulators, ORG_B.id, b.testId)).status).toBe('in_review');
    const student = await apiAs(accounts.studentA);
    expect((await student.post(`/v1/tests/${a.testId}/approve`, {})).status).toBe(403);
    expect((await student.post(`/v1/tests/${a.testId}/publish`, {})).status).toBe(403);

    const superA = await apiAs(accounts.superAdmin, { orgId: ORG_A.id });
    const approved = await superA.post<{ status: string; totalMarks: number }>(`/v1/tests/${a.testId}/approve`, {});
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'approved', totalMarks: 4 });
    const published = await superA.post<{ status: string }>(`/v1/tests/${a.testId}/publish`, {});
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('scheduled');
    expect((await storedTest(emulators, ORG_A.id, a.testId)).status).toBe('scheduled');
    for (const action of ['test.approve', 'test.publish']) {
      const [entry] = await auditFor(emulators, ORG_A.id, action, a.testId);
      expect(entry?.data.actor, `${action} actor`).toMatchObject({
        email: accounts.superAdmin.email,
        role: 'superAdmin',
      });
    }
    expect((await superA.inOrg(ORG_B.id).post(`/v1/tests/${b.testId}/approve`, {})).status).toBe(200);
  });
});
