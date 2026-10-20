import { errorCode } from '../fixtures/api';
import { auditFor, AUTHORING_NOW, seriesByTitle, SEEDED_SERIES, storedSeries } from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { expectTopRightOfHeader } from '../fixtures/layout';
import { accounts, departmentId, ORG_A, ORG_B, seededStudent, STUDENT_NAMES } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { pathPattern } from '../pages/paths';
import {
  SERIES_EMPTY,
  SERIES_ERRORS,
  SERIES_LINK,
  SeriesForm,
  SeriesListPage,
  SeriesPage,
} from '../pages/series-pages';
import { FULL_REVIEW_BLOCKED, SETTING_OPTIONS } from '../pages/settings-controls';
import { expectShellRules } from '../pages/shell';
import { expectEmptyState, expectFieldError, expectNoFieldError } from '../pages/ui';

// F-2.02 Series with defaults and eligibility (SER-01, SER-07, SER-09, US-AD-04; SER-02 is proved by integration
// tests and its status changes are shown here). Contract: docs/testids/phase-2.md, "Series list", "New series and
// Edit series", "Settings", "Eligibility editor".

const orgPath = `organizations/${ORG_A.id}`;
const noRules = { departmentIds: [], graduationYears: [], include: [], exclude: [] };

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-2.02 series with defaults and eligibility', () => {
  test('SER-01 US-AD-04 an admin creates a series with title, description, dates, default settings and eligibility', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const list = new SeriesListPage(page);
    await list.openFromSidebar();
    await expectTopRightOfHeader(list.shell.main, list.heading, list.newSeries);
    const form = await list.startNew();
    await expect(page).toHaveURL(pathPattern('/admin/series/new/'));

    await form.fillDetails({
      title: 'Placement drive 2026',
      description: 'Aptitude and reasoning tests before the November drive.',
      startDate: '2026-11-01',
      endDate: '2026-11-20',
      dailyStart: '09:00',
      dailyEnd: '18:00',
    });
    await expect(form.unsaved).toBeVisible();
    const s = form.settings;
    await s.choose('Timing mode', 'Flexible window');
    await s.spin('Duration (minutes)').fill('90');
    await s.choose('Window end policy', 'Hard close at window end');
    await s.spin('Maximum strikes').fill('5');
    await s.pick('Developer tools policy', 'Block only');
    await s.setSwitch('Second camera (phone)', true);
    await s.setSwitch('Shuffle options', false);
    await s.pick('Result release', 'After the window closes');
    await s.pick('Result detail', 'Full review with correct answers and explanations');
    await expectNoFieldError(s.select('Result release'));
    await form.eligibility.department('Computer').check();
    await form.eligibility.year(2026).check();
    await form.eligibility.expectCount(5);
    await expectNoSeriousA11yViolations(page);

    const series = await form.submitAndOpen('Placement drive 2026');

    await expect(series.status).toHaveText('Draft');
    await expect(series.shell.main).toContainText('1 Nov 2026 to 20 Nov 2026');
    await expect(series.shell.main).toContainText('09:00 to 18:00 IST');
    const stored = await seriesByTitle(emulators, ORG_A.id, 'Placement drive 2026');
    expect(stored.data).toMatchObject({
      orgId: ORG_A.id,
      description: 'Aptitude and reasoning tests before the November drive.',
      status: 'draft',
      startDate: '2026-11-01',
      endDate: '2026-11-20',
      dailyWindow: { startMinutes: 540, endMinutes: 1080 },
      defaults: {
        timingMode: 'flexible',
        durationMin: 90,
        windowEndPolicy: 'hard_close',
        maxStrikes: 5,
        devtoolsPolicy: 'block',
        fullscreenRequired: true,
        cameraRequired: true,
        secondCamera: true,
        shuffleQuestions: true,
        shuffleOptions: false,
        resultRelease: 'after_close',
        resultDetail: 'full',
        showPastScores: true,
        testLeaderboard: false,
        seriesLeaderboard: false,
      },
      eligibility: {
        departmentIds: [departmentId(ORG_A, 'Computer')],
        graduationYears: [2026],
        include: [],
        exclude: [],
      },
    });
    const [entry] = await auditFor(emulators, ORG_A.id, 'series.create', stored.id);
    expect(entry?.data.actor, 'series.create actor').toMatchObject({ email: accounts.adminA.email, role: 'admin' });

    await list.goto();
    await expect(await list.cell('Placement drive 2026', 'Dates')).toHaveText('1 Nov 2026 to 20 Nov 2026');
    await expect(await list.cell('Placement drive 2026', 'Tests')).toHaveText('0');
    await expect(await list.cell('Placement drive 2026', 'Status')).toHaveText('Draft');
    await expectShellRules(page, SERIES_LINK.path);
  });

  test('SER-07 US-AD-04 the live count of matching students follows the rules and opens the matching list', async ({
    page,
    signInAs,
    apiAs,
  }) => {
    // Student 06 (IT, 2027) is disabled: only registered students ever match (SER-04).
    const admin = await apiAs(accounts.adminA);
    const disabled = seededStudent(ORG_A, 6);
    expect((await admin.post('/v1/whitelist/bulk', { action: 'disable', emails: [disabled.email] })).status).toBe(200);
    await signInAs(accounts.adminA);
    const form = new SeriesForm(page, 'new');
    await form.gotoNew();
    const rules = form.eligibility;

    await rules.expectCount(19);
    await rules.department('Computer').check();
    await rules.expectCount(5);
    await rules.department('IT').check();
    await rules.expectCount(9);
    await rules.year(2026).check();
    await rules.expectCount(5);
    await rules.exclude.fill(seededStudent(ORG_A, 1).email);
    await rules.expectCount(4);
    await rules.include.fill(seededStudent(ORG_A, 3).prn);
    await rules.expectCount(5);

    const names = await rules.matchingNames();
    const expected = [3, 5, 9, 13, 17].map((n) => STUDENT_NAMES[n - 1]!);
    expect([...names].sort()).toEqual([...expected].sort());
    await expect(rules.matchingDialog()).toContainText(seededStudent(ORG_A, 3).prn);
    await expectNoSeriousA11yViolations(page);
    await rules.closeMatching();

    await rules.year(2026).uncheck();
    await rules.include.fill('');
    await rules.expectCount(8);
    const it = await rules.matchingNames();
    expect(it, 'the disabled student is never listed').not.toContain(disabled.name);
    expect(it).toContain(STUDENT_NAMES[1]);
  });

  test('SER-09 a full review released on submit in a flexible window is blocked with the reason', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const form = new SeriesForm(page, 'new');
    await form.gotoNew();
    await form.fillDetails({
      title: 'Practice week',
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      dailyStart: '09:00',
      dailyEnd: '21:00',
    });
    const s = form.settings;
    await s.choose('Timing mode', 'Flexible window');
    await s.pick('Result detail', SETTING_OPTIONS['Result detail'][2]);
    await s.pick('Result release', 'Immediately on submit');

    await expectFieldError(form.shell.main, s.select('Result release'), FULL_REVIEW_BLOCKED);
    await form.submit.click();
    await expect(form.heading, 'the form stays open').toBeVisible();
    await expect(page).toHaveURL(pathPattern('/admin/series/new/'));
    expect(await emulators.count(orgPath, 'series'), 'nothing saved').toBe(0);

    await s.pick('Result release', 'After the window closes');
    await expectNoFieldError(s.select('Result release'));
    await expect(form.text(FULL_REVIEW_BLOCKED)).toHaveCount(0);
    await form.submitAndOpen('Practice week');
    expect((await seriesByTitle(emulators, ORG_A.id, 'Practice week')).data.defaults).toMatchObject({
      timingMode: 'flexible',
      resultDetail: 'full',
      resultRelease: 'after_close',
    });

    const api = await apiAs(accounts.adminA);
    const refused = await api.post('/v1/series', {
      title: 'Leaky series',
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      dailyWindow: { startMinutes: 540, endMinutes: 1260 },
      defaults: { timingMode: 'flexible', durationMin: 60, resultDetail: 'full', resultRelease: 'immediate' },
      eligibility: noRules,
    });
    expect(refused.status).toBe(400);
    expect(errorCode(refused)).toBe('FULL_REVIEW_BEFORE_CLOSE');
    expect(await emulators.where(orgPath, 'series', 'title', 'Leaky series')).toHaveLength(0);
  });

  test('SER-01 a missing title or an end date before the start date is refused next to the field', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const form = new SeriesForm(page, 'new');
    await form.gotoNew();
    await form.fillDetails({ startDate: '2026-11-10', endDate: '2026-11-01', dailyStart: '10:00', dailyEnd: '11:00' });

    await form.submit.click();

    await expectFieldError(form.shell.main, form.title, SERIES_ERRORS.title);
    await expectFieldError(form.shell.main, form.endDate, SERIES_ERRORS.endBeforeStart);
    await expect(page).toHaveURL(pathPattern('/admin/series/new/'));
    expect(await emulators.count(orgPath, 'series')).toBe(0);
  });

  test('SER-02 a new series is a draft; the admin activates and archives it, and the change is logged', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { seriesId } = await testApi.seedSeries({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const series = new SeriesPage(page);
    await series.goto(seriesId, SEEDED_SERIES.title);
    await expect(series.status).toHaveText('Draft');

    await series.chooseAction('Activate series');

    await expect(series.status).toHaveText('Active');
    await expect.poll(async () => (await storedSeries(emulators, ORG_A.id, seriesId)).status).toBe('active');
    const [activated] = await auditFor(emulators, ORG_A.id, 'series.activate', seriesId);
    expect(activated?.data).toMatchObject({ before: { status: 'draft' }, after: { status: 'active' } });

    await series.archive(SEEDED_SERIES.title);

    await expect(series.status).toHaveText('Archived');
    await expect.poll(async () => (await storedSeries(emulators, ORG_A.id, seriesId)).status).toBe('archived');
    expect(await auditFor(emulators, ORG_A.id, 'series.archive', seriesId)).toHaveLength(1);
  });

  test('SER-01 an organization without series shows the empty state with one way to create one', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.adminA);
    const list = new SeriesListPage(page);
    await list.goto();

    await expectEmptyState(list.shell.main, SERIES_EMPTY.sentence, SERIES_EMPTY.action);
    await expect(list.list).toHaveCount(0);
  });

  test('SER-01 SER-07 students are refused the series endpoints', async ({ apiAs }) => {
    const student = await apiAs(accounts.studentA);

    expect((await student.get('/v1/series')).status).toBe(403);
    expect(
      (
        await student.post('/v1/series', {
          title: 'Student series',
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          dailyWindow: { startMinutes: 600, endMinutes: 660 },
          defaults: {},
          eligibility: noRules,
        })
      ).status,
    ).toBe(403);
    expect((await student.post('/v1/series/new/eligibility/preview', { eligibility: noRules })).status).toBe(403);
  });

  test('ORG-05 ORG-14 SER-07 an org A admin gets 404 for org B series, and a super admin can act on both', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const { seriesId: seriesB } = await testApi.seedSeries({ orgId: ORG_B.id, title: 'Placement 2026 COEP' });
    const adminA = await apiAs(accounts.adminA);

    expect((await adminA.get(`/v1/series/${seriesB}`)).status).toBe(404);
    expect((await adminA.patch(`/v1/series/${seriesB}`, { title: 'Taken over' })).status).toBe(404);
    expect((await adminA.post(`/v1/series/${seriesB}/eligibility/preview`, { eligibility: noRules })).status).toBe(404);
    const listA = await adminA.get<{ items: Array<{ id: string }> }>('/v1/series');
    expect(listA.status).toBe(200);
    expect(listA.body.items.map((s) => s.id)).not.toContain(seriesB);
    expect((await storedSeries(emulators, ORG_B.id, seriesB)).title).toBe('Placement 2026 COEP');

    const superA = await apiAs(accounts.superAdmin, { orgId: ORG_A.id });
    const created = await superA.post<{ id: string }>('/v1/series', {
      title: 'Super series',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      dailyWindow: { startMinutes: 600, endMinutes: 660 },
      defaults: {},
      eligibility: noRules,
    });
    expect([200, 201]).toContain(created.status);
    expect((await storedSeries(emulators, ORG_A.id, created.body.id)).status).toBe('draft');
    const preview = await superA.post<{ count: number }>('/v1/series/new/eligibility/preview', {
      eligibility: { ...noRules, departmentIds: [departmentId(ORG_A, 'Computer')] },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.count).toBe(5);

    const superB = superA.inOrg(ORG_B.id);
    expect((await superB.get(`/v1/series/${seriesB}`)).status).toBe(200);
    expect((await superB.patch(`/v1/series/${seriesB}`, { title: 'Placement 2026 (COEP)' })).status).toBe(200);
    expect((await storedSeries(emulators, ORG_B.id, seriesB)).title).toBe('Placement 2026 (COEP)');
    const [entry] = await auditFor(emulators, ORG_B.id, 'series.update', seriesB);
    expect(entry?.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });
  });
});
