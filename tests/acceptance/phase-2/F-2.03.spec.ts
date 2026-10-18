import {
  auditFor,
  AUTHORING_NOW,
  istMs,
  SEEDED_SERIES,
  SEEDED_TEST,
  storedTest,
  testByTitle,
  testsOfSeries,
} from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { expectTopRightOfHeader } from '../fixtures/layout';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { pathPattern } from '../pages/paths';
import { DAY_LABEL_HINT, SeriesPage, TEST_ERRORS, TIMELINE_EMPTY } from '../pages/series-pages';
import { expectShellRules } from '../pages/shell';
import { TestEditorPage } from '../pages/test-editor';
import { expectEmptyState, expectFieldError, field } from '../pages/ui';

// F-2.03 Tests and the series timeline (TST-01, SER-03, TST-07; TST-02 numbering is proved by unit tests and shown
// here). Contract: docs/testids/phase-2.md, "Series page" and "Test editor".

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-2.03 tests and the series timeline', () => {
  test('TST-01 SER-03 an admin adds tests and the series page lists them day by day in scheduled order with status', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { seriesId } = await testApi.seedSeries({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const series = new SeriesPage(page);
    await series.goto(seriesId, SEEDED_SERIES.title);
    await expectTopRightOfHeader(series.shell.main, series.shell.heading(SEEDED_SERIES.title), series.addTest);

    await series.addTest.click();
    await expect(field(series.addTestDialog(), 'Day label')).toHaveAccessibleDescription(DAY_LABEL_HINT);
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await series.add({ title: 'Aptitude', company: 'TCS', scheduledDate: '2026-11-03' });
    await expect(series.notice('Test added')).toBeVisible();
    await series.add({ title: 'Reasoning', company: 'Infosys', scheduledDate: '2026-11-02' });
    await series.add({ title: 'Verbal ability', scheduledDate: '2026-11-04' });

    expect(await series.timelineTitles()).toEqual(['Reasoning', 'Aptitude', 'Verbal ability']);
    await expect(series.item('Reasoning')).toHaveText(
      /Day 1[\s\S]*Reasoning[\s\S]*Infosys[\s\S]*2 Nov 2026, 10:00 to 11:00 IST[\s\S]*Draft/,
    );
    await expect(series.item('Aptitude')).toHaveText(
      /Day 2[\s\S]*Aptitude[\s\S]*TCS[\s\S]*3 Nov 2026, 10:00 to 11:00 IST[\s\S]*Draft/,
    );
    await expect(series.item('Verbal ability')).toHaveText(
      /Day 3[\s\S]*Verbal ability[\s\S]*4 Nov 2026, 10:00 to 11:00 IST[\s\S]*Draft/,
    );

    const stored = await testsOfSeries(emulators, ORG_A.id, seriesId);
    expect(stored).toHaveLength(3);
    const aptitude = await testByTitle(emulators, ORG_A.id, 'Aptitude');
    expect(aptitude.data).toMatchObject({
      orgId: ORG_A.id,
      seriesId,
      company: 'TCS',
      scheduledDate: '2026-11-03',
      dayHidden: false,
      status: 'draft',
      overrides: {},
    });
    expect(aptitude.data.dayNumber ?? null, 'no day number stored: it is suggested').toBeNull();
    const [entry] = await auditFor(emulators, ORG_A.id, 'test.create', aptitude.id);
    expect(entry?.data.actor).toMatchObject({ email: accounts.adminA.email, role: 'admin' });

    await series.testLink('Aptitude').click();
    const editor = new TestEditorPage(page);
    await editor.expectShown('Day 2: Aptitude');
    await expect(page).toHaveURL(pathPattern('/admin/tests/edit/'));
    await expect(editor.schedule('Scheduled 3 Nov 2026, 10:00 to 11:00 IST')).toBeVisible();
    await expect(editor.status).toHaveText('Draft');
    await expectShellRules(page, '/admin/tests/edit/');
  });

  test('TST-02 a day label can be renamed or hidden, and the other tests keep their schedule position', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { seriesId, testId: first } = await testApi.seedAuthoringTest({
      orgId: ORG_A.id,
      title: 'Reasoning',
      scheduledDate: '2026-11-02',
      questions: 'none',
    });
    const { testId: second } = await testApi.seedAuthoringTest({
      orgId: ORG_A.id,
      seriesId,
      title: 'Aptitude',
      scheduledDate: '2026-11-03',
      questions: 'none',
    });
    await testApi.seedAuthoringTest({
      orgId: ORG_A.id,
      seriesId,
      title: 'Verbal ability',
      scheduledDate: '2026-11-04',
      questions: 'none',
    });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(second, 'Day 2: Aptitude');

    await editor.editDetailsWith({ dayLabel: 'Mock 1' });

    await editor.expectShown('Mock 1: Aptitude');
    await expect.poll(async () => (await storedTest(emulators, ORG_A.id, second)).dayNumber).toBe('Mock 1');

    await editor.goto(first, 'Day 1: Reasoning');
    await editor.editDetailsWith({ hideDay: true });
    await editor.expectShown('Reasoning');
    await expect.poll(async () => (await storedTest(emulators, ORG_A.id, first)).dayHidden).toBe(true);

    const series = new SeriesPage(page);
    await series.goto(seriesId, SEEDED_SERIES.title);
    expect(await series.timelineTitles()).toEqual(['Reasoning', 'Aptitude', 'Verbal ability']);
    await expect(series.item('Reasoning')).not.toContainText(/Day \d/);
    await expect(series.item('Aptitude')).toHaveText(/Mock 1[\s\S]*Aptitude/);
    await expect(series.item('Aptitude')).not.toContainText(/Day \d/);
    await expect(series.item('Verbal ability')).toHaveText(/Day 3[\s\S]*Verbal ability/);
    expect(await auditFor(emulators, ORG_A.id, 'test.update', second)).toHaveLength(1);
  });

  test('TST-01 a missing title or a date outside the series is refused next to the field', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { seriesId } = await testApi.seedSeries({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const series = new SeriesPage(page);
    await series.goto(seriesId, SEEDED_SERIES.title);

    const dlg = await series.addTestWith({ title: '', scheduledDate: '2026-12-05' });

    await expect(dlg).toBeVisible();
    await expectFieldError(dlg, field(dlg, 'Title (required)'), TEST_ERRORS.title);
    await expectFieldError(
      dlg,
      field(dlg, 'Scheduled date (required)'),
      TEST_ERRORS.outsideSeries('1 Nov 2026', '30 Nov 2026'),
    );
    expect(await testsOfSeries(emulators, ORG_A.id, seriesId)).toHaveLength(0);
  });

  test('SER-03 a series without tests says so and offers Add test', async ({ page, signInAs, testApi }) => {
    const { seriesId } = await testApi.seedSeries({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const series = new SeriesPage(page);

    await series.goto(seriesId, SEEDED_SERIES.title);

    await expectEmptyState(series.shell.main, TIMELINE_EMPTY.sentence, TIMELINE_EMPTY.action);
    await expect(series.items).toHaveCount(0);
  });

  test('ORG-05 ORG-14 TST-01 tests of org B are 404 for an org A admin, students are refused, a super admin acts in both', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const b = await testApi.seedAuthoringTest({ orgId: ORG_B.id, questions: 'none' });
    const { seriesId: seriesA } = await testApi.seedSeries({ orgId: ORG_A.id });
    const adminA = await apiAs(accounts.adminA);

    expect(
      (await adminA.post('/v1/tests', { seriesId: b.seriesId, title: 'Smuggled', scheduledDate: '2026-11-03' })).status,
    ).toBe(404);
    expect((await adminA.get(`/v1/tests/${b.testId}`)).status).toBe(404);
    expect((await adminA.get(`/v1/tests?seriesId=${b.seriesId}`)).status).toBe(404);
    expect(await testsOfSeries(emulators, ORG_B.id, b.seriesId)).toHaveLength(1);

    const student = await apiAs(accounts.studentA);
    expect((await student.get(`/v1/tests?seriesId=${seriesA}`)).status).toBe(403);
    expect(
      (await student.post('/v1/tests', { seriesId: seriesA, title: 'Mine', scheduledDate: '2026-11-03' })).status,
    ).toBe(403);

    const superA = await apiAs(accounts.superAdmin, { orgId: ORG_A.id });
    const created = await superA.post<{ id: string }>('/v1/tests', {
      seriesId: seriesA,
      title: 'Logical reasoning',
      company: 'Wipro',
      scheduledDate: '2026-11-05',
    });
    expect([200, 201]).toContain(created.status);
    expect(await storedTest(emulators, ORG_A.id, created.body.id)).toMatchObject({
      seriesId: seriesA,
      title: 'Logical reasoning',
      status: 'draft',
    });
    const listed = await superA.get<{ items: Array<{ id: string }> }>(`/v1/tests?seriesId=${seriesA}`);
    expect(listed.body.items.map((t) => t.id)).toEqual([created.body.id]);
    expect((await superA.inOrg(ORG_B.id).get(`/v1/tests/${b.testId}`)).status).toBe(200);
  });
});

test.describe('F-2.03 times in the organization timezone', () => {
  // The browser runs in New York; the organization is in Asia/Kolkata. Every time must follow the organization.
  test.use({ timezoneId: 'America/New_York' });

  test('TST-07 times are stored in UTC and shown in the org timezone with the zone named, whatever the browser zone', async ({
    page,
    signInAs,
    testApi,
    apiAs,
  }) => {
    const { seriesId, testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await signInAs(accounts.adminA);
    const series = new SeriesPage(page);
    await series.goto(seriesId, SEEDED_SERIES.title);

    await expect(series.shell.main).toContainText(SEEDED_SERIES.dailyWindow);
    await expect(series.item(SEEDED_TEST.title)).toContainText('2 Nov 2026, 10:00 to 11:00 IST');
    await series.testLink(SEEDED_TEST.title).click();
    const editor = new TestEditorPage(page);
    await editor.expectShown(SEEDED_TEST.heading);
    await expect(editor.schedule(SEEDED_TEST.schedule)).toBeVisible();

    const api = await apiAs(accounts.adminA);
    const res = await api.get<{ effective: { window: { start: number; end: number } } }>(`/v1/tests/${testId}`);
    expect(res.status).toBe(200);
    expect(res.body.effective.window).toEqual({ start: istMs(2026, 11, 2, 10), end: istMs(2026, 11, 2, 11) });
    expect(res.body.effective.window.start, '04:30 UTC').toBe(Date.UTC(2026, 10, 2, 4, 30));
  });
});
