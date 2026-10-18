import { errorCode } from '../fixtures/api';
import {
  auditFor,
  AUTHORING_NOW,
  istMs,
  SEEDED_SERIES,
  SEEDED_TEST,
  storedSeries,
  storedTest,
} from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { BALLPOINT } from '../fixtures/layout';
import { accounts, departmentId, ORG_A, ORG_B, seededStudent, STUDENT_NAMES } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { SeriesPage } from '../pages/series-pages';
import { FULL_REVIEW_BLOCKED, SETTING_ERRORS } from '../pages/settings-controls';
import { TestEditorPage } from '../pages/test-editor';
import { expectFieldError } from '../pages/ui';

// F-2.04 Inherited and overridden settings (TST-03, US-AD-05), with the test's eligibility narrowing the series'
// (SER-06, SER-07) and window times in the org timezone (TST-07). Contract: docs/testids/phase-2.md, "Settings tab",
// "Eligibility tab".

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-2.04 inherited and overridden settings', () => {
  test('TST-03 US-AD-05 a setting shows Inherited, can be overridden for the test, and resets to the series value', async ({
    page,
    signInAs,
    testApi,
    apiAs,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    let settings = await editor.settings();
    let strikes = settings.setting('Maximum strikes');
    await strikes.expectInherited('3');
    await settings.setting('Duration (minutes)').expectInherited('60 minutes');
    await settings.setting('Shuffle questions').expectInherited('On');
    await settings.setting('Result release').expectInherited('After the window closes');
    expect((await strikes.leftRule()).color, 'inherited settings have no ballpoint rule').not.toBe(BALLPOINT);
    await expectNoSeriousA11yViolations(page);

    await strikes.override();
    await expect(strikes.controls.spin('Maximum strikes')).toHaveValue('3');
    await strikes.controls.spin('Maximum strikes').fill('5');
    const shuffle = settings.setting('Shuffle questions');
    await shuffle.override();
    await shuffle.controls.setSwitch('Shuffle questions', false);
    await expect(settings.footer.unsaved).toBeVisible();
    await settings.saveAndConfirm();

    await expect
      .poll(async () => (await storedTest(emulators, ORG_A.id, testId)).overrides)
      .toEqual({ maxStrikes: 5, shuffleQuestions: false });
    const [entry] = await auditFor(emulators, ORG_A.id, 'test.settings.update', testId);
    expect(entry?.data).toMatchObject({ before: {}, after: { maxStrikes: 5, shuffleQuestions: false } });
    const api = await apiAs(accounts.adminA);
    const effective = await api.get<{ effective: Record<string, unknown> }>(`/v1/tests/${testId}`);
    expect(effective.body.effective).toMatchObject({ maxStrikes: 5, shuffleQuestions: false, durationMin: 60 });

    await page.reload();
    await editor.expectShown(SEEDED_TEST.heading);
    settings = await editor.settings();
    strikes = settings.setting('Maximum strikes');
    await strikes.expectOverridden();
    await expect(strikes.controls.spin('Maximum strikes')).toHaveValue('5');
    const rule = await strikes.leftRule();
    expect(rule.style, 'overridden left rule style').toBe('solid');
    expect(rule.width, 'overridden left rule width').toBeGreaterThanOrEqual(2);
    expect(rule.color, 'overridden left rule colour').toBe(BALLPOINT);

    await strikes.reset.click();

    await strikes.expectInherited('3');
    await settings.saveAndConfirm();
    await expect
      .poll(async () => (await storedTest(emulators, ORG_A.id, testId)).overrides)
      .toEqual({ shuffleQuestions: false });
  });

  test('TST-03 an inherited setting follows a change to the series default; an overridden one keeps its value', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { seriesId, testId } = await testApi.seedAuthoringTest({
      orgId: ORG_A.id,
      questions: 'none',
      overrides: { resultDetail: 'score' },
    });
    await signInAs(accounts.adminA);
    const series = new SeriesPage(page);
    await series.goto(seriesId, SEEDED_SERIES.title);
    const form = await series.openEdit();
    await expect(form.settings.spin('Maximum strikes')).toHaveValue('3');

    await form.settings.spin('Maximum strikes').fill('4');
    await form.settings.pick('Result detail', 'Full review with correct answers and explanations');
    await form.submitAndOpen(SEEDED_SERIES.title);

    expect((await storedSeries(emulators, ORG_A.id, seriesId)).defaults).toMatchObject({
      maxStrikes: 4,
      resultDetail: 'full',
    });
    expect(await auditFor(emulators, ORG_A.id, 'series.update', seriesId)).toHaveLength(1);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const settings = await editor.settings();
    await settings.setting('Maximum strikes').expectInherited('4');
    const detail = settings.setting('Result detail');
    await detail.expectOverridden();
    await expect(detail.controls.selected('Result detail')).toHaveText('Score only');
    expect((await storedTest(emulators, ORG_A.id, testId)).overrides).toEqual({ resultDetail: 'score' });
  });

  test('TST-03 an override outside the allowed range, or a full review on submit in a flexible window, is not saved', async ({
    page,
    signInAs,
    testApi,
    apiAs,
    emulators,
  }) => {
    const { seriesId } = await testApi.seedSeries({
      orgId: ORG_A.id,
      defaults: { timingMode: 'flexible', durationMin: 60, resultDetail: 'full', resultRelease: 'after_close' },
    });
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, seriesId, questions: 'none' });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const settings = await editor.settings();

    const strikes = settings.setting('Maximum strikes');
    await strikes.override();
    await strikes.controls.spin('Maximum strikes').fill('11');
    await settings.save.click();
    await expectFieldError(strikes.group, strikes.controls.spin('Maximum strikes'), SETTING_ERRORS.strikes);
    await strikes.reset.click();

    const release = settings.setting('Result release');
    await release.override();
    await release.controls.pick('Result release', 'Immediately on submit');
    await expectFieldError(release.group, release.controls.select('Result release'), FULL_REVIEW_BLOCKED);
    await settings.save.click();
    await expect(release.controls.select('Result release')).toHaveAttribute('aria-invalid', 'true');
    expect((await storedTest(emulators, ORG_A.id, testId)).overrides, 'nothing saved').toEqual({});

    const api = await apiAs(accounts.adminA);
    const refused = await api.patch(`/v1/tests/${testId}`, { overrides: { resultRelease: 'immediate' } });
    expect(refused.status).toBe(400);
    expect(errorCode(refused)).toBe('FULL_REVIEW_BEFORE_CLOSE');
    expect((await storedTest(emulators, ORG_A.id, testId)).overrides).toEqual({});
  });

  test('SER-06 SER-07 a test narrows the series eligibility with a live count, and an include never widens it', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { seriesId } = await testApi.seedSeries({
      orgId: ORG_A.id,
      eligibility: { departmentIds: [departmentId(ORG_A, 'Computer'), departmentId(ORG_A, 'IT')] },
    });
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, seriesId, questions: 'none' });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const tab = await editor.eligibility();
    const rules = tab.editor;
    await expect(tab.note).toBeVisible();
    await expect(rules.department('Computer')).toBeVisible();
    await expect(rules.department('IT')).toBeVisible();
    await expect(rules.department('ENTC'), 'only departments the series allows').toHaveCount(0);
    await rules.expectCount(10);

    await rules.department('IT').check();
    await rules.expectCount(5);
    await rules.exclude.fill(seededStudent(ORG_A, 2).email);
    await rules.expectCount(4);
    await rules.include.fill(seededStudent(ORG_A, 3).prn);
    await rules.expectCount(4);
    const names = await rules.matchingNames();
    expect([...names].sort()).toEqual([6, 10, 14, 18].map((n) => STUDENT_NAMES[n - 1]!).sort());
    await rules.closeMatching();
    await rules.include.fill('');
    await tab.saveAndConfirm();

    await expect
      .poll(async () => (await storedTest(emulators, ORG_A.id, testId)).eligibility)
      .toEqual({
        departmentIds: [departmentId(ORG_A, 'IT')],
        graduationYears: [],
        include: [],
        exclude: [seededStudent(ORG_A, 2).id],
      });
    expect(await auditFor(emulators, ORG_A.id, 'test.update', testId)).toHaveLength(1);
  });

  test('ORG-05 ORG-14 US-AD-05 org B test settings are 404 for an org A admin, refused for students, and open to a super admin', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const b = await testApi.seedAuthoringTest({ orgId: ORG_B.id, questions: 'none' });
    const a = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    const adminA = await apiAs(accounts.adminA);

    expect((await adminA.patch(`/v1/tests/${b.testId}`, { overrides: { maxStrikes: 9 } })).status).toBe(404);
    expect((await storedTest(emulators, ORG_B.id, b.testId)).overrides).toEqual({});
    const student = await apiAs(accounts.studentA);
    expect((await student.patch(`/v1/tests/${a.testId}`, { overrides: { maxStrikes: 9 } })).status).toBe(403);
    expect((await student.get(`/v1/tests/${a.testId}`)).status).toBe(403);

    const superB = await apiAs(accounts.superAdmin, { orgId: ORG_B.id });
    expect((await superB.patch(`/v1/tests/${b.testId}`, { overrides: { maxStrikes: 6 } })).status).toBe(200);
    expect((await storedTest(emulators, ORG_B.id, b.testId)).overrides).toEqual({ maxStrikes: 6 });
    const [entry] = await auditFor(emulators, ORG_B.id, 'test.settings.update', b.testId);
    expect(entry?.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });
    expect((await superB.inOrg(ORG_A.id).patch(`/v1/tests/${a.testId}`, { overrides: { maxStrikes: 2 } })).status).toBe(
      200,
    );
  });
});

test.describe('F-2.04 window override in the organization timezone', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('TST-03 TST-07 a window override is typed in the org timezone, stored in UTC and shown with the zone named', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    let settings = await editor.settings();
    let windowSetting = settings.setting('Window');
    await windowSetting.expectInherited('10:00 to 11:00 IST on the scheduled date');

    await windowSetting.override();
    await windowSetting.input('Window start').fill('2026-11-02T14:00');
    await windowSetting.input('Window end').fill('2026-11-02T15:30');
    await settings.saveAndConfirm();

    await expect
      .poll(async () => (await storedTest(emulators, ORG_A.id, testId)).overrides)
      .toEqual({ window: { start: istMs(2026, 11, 2, 14), end: istMs(2026, 11, 2, 15, 30) } });
    await expect(editor.schedule('Scheduled 2 Nov 2026, 14:00 to 15:30 IST')).toBeVisible();
    await page.reload();
    await editor.expectShown(SEEDED_TEST.heading);
    settings = await editor.settings();
    windowSetting = settings.setting('Window');
    await expect(windowSetting.input('Window start')).toHaveValue('2026-11-02T14:00');
    await expect(windowSetting.input('Window end')).toHaveValue('2026-11-02T15:30');

    await windowSetting.input('Window end').fill('2026-11-02T13:00');
    await settings.save.click();
    await expectFieldError(windowSetting.group, windowSetting.input('Window end'), SETTING_ERRORS.window);
  });
});
