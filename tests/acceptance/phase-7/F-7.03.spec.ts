import { readFile } from 'node:fs/promises';
import { AUTHORING_NOW, auditFor, istMs } from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { expectApiError } from '../fixtures/exam';
import { errorOf } from '../fixtures/imports';
import { expectPdfText, readPdf } from '../fixtures/pdf';
import {
  aiReportsUsed,
  getReport,
  GOOD_ANSWER,
  listReports,
  postReport,
  readyReport,
  REPORT_COLUMNS,
  REPORT_ELIGIBILITY,
  REPORT_TEXTS,
  REPORTED_TEST,
  requestedText,
  requestReport,
  scriptReport,
  setReportEntitlements,
  seedReportedSeries,
  sitReportedTest,
  STATUS_WORDS,
  SERIES_MONTH,
  storedReports,
  TEST_PDF_LINES,
} from '../fixtures/reports';
import { errorCode, readXlsx } from '../fixtures/results';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { headerTexts } from '../pages/results-pages';
import { pathPattern } from '../pages/paths';
import { OrgDetailPage } from '../pages/platform';
import { ReportsPage } from '../pages/reports-page';
import { expectShellRules, NOT_INCLUDED, Shell } from '../pages/shell';
import { cellIn, expectEmptyState, expectFieldError } from '../pages/ui';

// F-7.03 Report gating, limits and listing (US-AD-15, EXP-07; EXP-06's listing). Contract: docs/testids/phase-7.md,
// "Admin screen", "Requests the tests send directly" and "Counting".

const MIN = 60_000;
const HEADING = REPORTED_TEST.heading;
const SERIES = REPORTED_TEST.series;
const stu = (n: number) => `stu-${ORG_A.id}-${String(n).padStart(2, '0')}`;

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-7.03 report gating, limits and listing', () => {
  test("US-AD-15 EXP-06 EXP-07 an admin generates a report on the Reports page, sees it become ready and downloads the PDF; the month's count goes up", async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(180_000);
    await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
    await sitReportedTest(apiAs, testApi);
    await scriptReport(testApi, [GOOD_ANSWER]);
    const requestedAt = await testApi.clock.now();
    await signInAs(accounts.adminA);

    const shell = new Shell(page);
    await expect(shell.navLink('Reports')).not.toHaveAccessibleDescription(NOT_INCLUDED);
    await shell.goToAdmin('Reports');
    const reports = new ReportsPage(page);
    await expect(reports.usage(0, 20)).toBeVisible();
    await expectEmptyState(shell.main, REPORT_TEXTS.empty.sentence, REPORT_TEXTS.empty.action);
    await expect(reports.generate).toBeEnabled();

    const dlg = await reports.openGenerate();
    await expect(dlg.aTest).toBeChecked();
    await expect(dlg.aSeries).not.toBeChecked();
    await expect(dlg.test).toBeVisible();
    await expect(dlg.series).toBeHidden();
    await expect(dlg.xlsx).not.toBeChecked();
    await expect(dlg.cost(20)).toBeVisible();
    await dlg.submit.click();
    await expectFieldError(dlg.dialog, dlg.test, REPORT_TEXTS.chooseTest);
    expect(await storedReports(emulators, ORG_A.id), 'nothing created without a choice').toEqual([]);

    await dlg.generate({ test: REPORTED_TEST.option });
    await expect(dlg.dialog).toBeHidden();
    await expect(reports.notice(REPORT_TEXTS.generating)).toBeVisible();
    const row = reports.rowsFor(HEADING);
    await expect(row).toHaveCount(1);
    await expect(await reports.cell(row, 'Status')).toHaveText(STATUS_WORDS.ready, { timeout: 30_000 });
    await expect(await reports.cell(row, 'Type')).toHaveText('Test');
    await expect(await reports.cell(row, 'Requested')).toHaveText(requestedText(requestedAt));
    await expect(await reports.cell(row, 'Requested by')).toHaveText('Admin 1');
    await expect(reports.download(row, 'XLSX')).toHaveCount(0);
    await expect(reports.usage(1, 20)).toBeVisible();
    expect(await aiReportsUsed(emulators, ORG_A.id)).toBe(1);

    const [stored] = await storedReports(emulators, ORG_A.id);
    expect(stored?.data).toMatchObject({ status: 'ready', scope: 'test', title: HEADING });
    const pdfLink = reports.download(row, 'PDF');
    await expect(pdfLink).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), pdfLink.click()]);
    expect(download.suggestedFilename()).toBe(`report-${stored!.id}.pdf`);
    const pdf = await readPdf(await readFile((await download.path())!));
    expect(pdf.info.Title).toBe(`Analytics report: ${HEADING}`);
    expectPdfText(pdf, [HEADING, GOOD_ANSWER.summary, ...TEST_PDF_LINES]);

    const audit = await auditFor(emulators, ORG_A.id, 'report.create', stored!.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data.actor).toMatchObject({ email: accounts.adminA.email, role: 'admin' });
    await expectShellRules(page, 'Reports');
    await expectNoSeriousA11yViolations(page);
  });

  test('US-AD-15 FF-02 FF-03 with analytics reports off the Reports page is locked and the API refuses; past reports return when it is on again', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, seriesEligibility: REPORT_ELIGIBILITY });
    await testApi.seedGradedAttempts(ORG_A.id, t.testId, [{ studentId: stu(1), score: 3, timeSec: 600, correct: 3 }]);
    await signInAs(accounts.adminA);
    const admin = await apiAs(accounts.adminA);
    const body = { scope: 'test' as const, refId: t.testId };

    // Off by default (spec 2.4).
    const shell = new Shell(page);
    await expect(shell.navLink('Reports')).toHaveAccessibleDescription(NOT_INCLUDED);
    const reports = new ReportsPage(page);
    await reports.goto();
    await expectLocked(reports);
    expectApiError(await postReport(admin, body), 403, 'FEATURE_DISABLED');
    expectApiError(await admin.get('/v1/reports'), 403, 'FEATURE_DISABLED');
    expect(await storedReports(emulators, ORG_A.id)).toEqual([]);
    expect(await aiReportsUsed(emulators, ORG_A.id)).toBe(0);
    await expectNoSeriousA11yViolations(page);

    const superAdmin = await apiAs(accounts.superAdmin);
    await setReportEntitlements(superAdmin, ORG_A.id, { on: true });
    await reports.goto();
    await expect(reports.generate).toBeEnabled();
    await expect(reports.usage(0, 20)).toBeVisible();
    await expectEmptyState(shell.main, REPORT_TEXTS.empty.sentence, REPORT_TEXTS.empty.action);
    const made = await readyReport(admin, testApi, body);
    await reports.goto();
    await expect(await reports.cell(reports.rowsFor(HEADING), 'Status')).toHaveText(STATUS_WORDS.ready);

    await setReportEntitlements(superAdmin, ORG_A.id, { on: false });
    expectApiError(await admin.get(`/v1/reports/${made.id}`), 403, 'FEATURE_DISABLED');
    expectApiError(await admin.get('/v1/reports'), 403, 'FEATURE_DISABLED');
    await reports.goto();
    await expectLocked(reports);
    expect(await storedReports(emulators, ORG_A.id), 'turning the feature off keeps the data').toHaveLength(1);

    await setReportEntitlements(superAdmin, ORG_A.id, { on: true });
    await reports.goto();
    await expect(reports.rowsFor(HEADING)).toHaveCount(1);
    await expect(reports.download(reports.rowsFor(HEADING), 'PDF')).toBeVisible();
    expect((await getReport(admin, made.id)).status).toBe('ready');
  });

  test('EXP-07 FF-04 API-02 each report counts once against ai_reports_per_month; at the limit the API and the dialog refuse; a new month starts again', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(120_000);
    await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id, { limit: 1 });
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, seriesEligibility: REPORT_ELIGIBILITY });
    await testApi.seedGradedAttempts(ORG_A.id, t.testId, [{ studentId: stu(1), score: 3, timeSec: 600, correct: 3 }]);
    const admin = await apiAs(accounts.adminA);
    const body = { scope: 'test' as const, refId: t.testId };

    const key = 'phase-7-limit-key';
    const id = await requestReport(admin, body, key);
    expect(await aiReportsUsed(emulators, ORG_A.id)).toBe(1);
    const replay = await postReport(admin, body, key);
    expect(replay.status).toBe(202);
    expect(replay.body.id, 'a repeated key replays the same report').toBe(id);
    expect(await aiReportsUsed(emulators, ORG_A.id), 'a replay counts nothing').toBe(1);

    const refused = await postReport(admin, body);
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe('LIMIT_REACHED');
    expect(errorOf(refused).details).toEqual({
      limit: 'ai_reports_per_month',
      max: 1,
    });
    expect(await storedReports(emulators, ORG_A.id)).toHaveLength(1);
    expect(await aiReportsUsed(emulators, ORG_A.id)).toBe(1);

    await signInAs(accounts.adminA);
    const reports = new ReportsPage(page);
    await reports.goto();
    await expect(reports.usage(1, 1)).toBeVisible();
    const dlg = await reports.openGenerate();
    await expect(dlg.cost(1)).toBeVisible();
    await dlg.generate({ test: REPORTED_TEST.option });
    await expect(dlg.limitAlert(1)).toBeVisible();
    await expect(dlg.dialog).toBeVisible();
    await expect(reports.rows).toHaveCount(1);
    expect(await storedReports(emulators, ORG_A.id)).toHaveLength(1);
    expect(await aiReportsUsed(emulators, ORG_A.id)).toBe(1);

    // FF-04: counted per calendar month in the organization's timezone.
    await testApi.clock.set(istMs(2026, 11, 1, 0, 30));
    await requestReport(admin, body);
    expect(await aiReportsUsed(emulators, ORG_A.id, '2026-11')).toBe(1);
    expect(await aiReportsUsed(emulators, ORG_A.id, '2026-10')).toBe(1);
  });

  test('US-AD-15 EXP-06 past reports stay listed newest first with their files; a test without finished attempts is refused in the dialog', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(180_000);
    await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
    const series = await seedReportedSeries(testApi);
    // Day 3 on 3 Nov, published, with no attempt.
    await testApi.seedExamTest({
      orgId: ORG_A.id,
      seriesId: series.seriesId,
      title: 'Verbal ability',
      opensInMin: 1440,
    });
    const emptyHeading = 'Day 3: Verbal ability';
    const first = series.tests[0]!;
    await signInAs(accounts.adminA);
    const reports = new ReportsPage(page);
    await reports.goto();
    await expectEmptyState(reports.shell.main, REPORT_TEXTS.empty.sentence, REPORT_TEXTS.empty.action);

    const dlg = await reports.openGenerate();
    await dlg.generate({ test: `${emptyHeading}, ${SERIES}` });
    await expectFieldError(dlg.dialog, dlg.test, REPORT_TEXTS.noAttempts('test'));
    expect(await storedReports(emulators, ORG_A.id)).toEqual([]);
    expect(await aiReportsUsed(emulators, ORG_A.id, SERIES_MONTH)).toBe(0);

    const testAt = await testApi.clock.now();
    await dlg.generate({ test: `${first.heading}, ${SERIES}` }, { xlsx: true });
    await expect(dlg.dialog).toBeHidden();
    const testRow = reports.rowsFor(first.heading);
    await expect(await reports.cell(testRow, 'Status')).toHaveText(STATUS_WORDS.ready, { timeout: 30_000 });

    const seriesAt = await testApi.clock.advance(MIN);
    const dlg2 = await reports.openGenerate();
    await dlg2.generate({ series: SERIES });
    await expect(dlg2.dialog).toBeHidden();
    const seriesRow = reports.rowsFor(SERIES);
    await expect(await reports.cell(seriesRow, 'Status')).toHaveText(STATUS_WORDS.ready, { timeout: 30_000 });

    expect(await headerTexts(reports.table)).toEqual([...REPORT_COLUMNS]);
    await expect(reports.rows).toHaveCount(2);
    await expect(await cellIn(reports.table, reports.rows.nth(0), 'Report'), 'newest first').toHaveText(SERIES);
    await expect(await cellIn(reports.table, reports.rows.nth(1), 'Report')).toHaveText(first.heading);
    await expect(await reports.cell(seriesRow, 'Type')).toHaveText('Series');
    await expect(await reports.cell(seriesRow, 'Requested')).toHaveText(requestedText(seriesAt));
    await expect(await reports.cell(testRow, 'Type')).toHaveText('Test');
    await expect(await reports.cell(testRow, 'Requested')).toHaveText(requestedText(testAt));
    await expect(reports.download(seriesRow, 'PDF')).toBeVisible();
    await expect(reports.download(seriesRow, 'XLSX')).toHaveCount(0);
    await expect(reports.download(testRow, 'PDF')).toBeVisible();

    const xlsxLink = reports.download(testRow, 'XLSX');
    await expect(xlsxLink).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), xlsxLink.click()]);
    expect(download.suggestedFilename()).toMatch(/^report-.+-metrics\.xlsx$/);
    const sheets = await readXlsx(await readFile((await download.path())!));
    expect(sheets.map((s) => s.name)).toEqual(['Overview', 'Questions', 'Departments']);

    // Still listed after a reload, and by the API, in the same order.
    await reports.goto();
    await expect(reports.rows).toHaveCount(2);
    await expect(await cellIn(reports.table, reports.rows.nth(0), 'Report')).toHaveText(SERIES);
    const listed = await listReports(await apiAs(accounts.adminA));
    expect(listed.map((r) => [r.scope, r.title, r.status])).toEqual([
      ['series', SERIES, 'ready'],
      ['test', first.heading, 'ready'],
    ]);
    expect(await aiReportsUsed(emulators, ORG_A.id, SERIES_MONTH)).toBe(2);
    await expectNoSeriousA11yViolations(page);
  });

  test("ORG-05 ORG-13 ORG-14 WEB-03 org B lists none of org A's reports, a student is sent home, and a super admin's report counts against org A", async ({
    page,
    signInAs,
    apiAs,
    newSession,
    testApi,
    emulators,
  }) => {
    test.setTimeout(180_000);
    const superAdmin = await apiAs(accounts.superAdmin);
    await setReportEntitlements(superAdmin, ORG_A.id);
    await setReportEntitlements(superAdmin, ORG_B.id);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, seriesEligibility: REPORT_ELIGIBILITY });
    await testApi.seedGradedAttempts(ORG_A.id, t.testId, [{ studentId: stu(1), score: 3, timeSec: 600, correct: 3 }]);
    const admin = await apiAs(accounts.adminA);
    const mine = await readyReport(admin, testApi, { scope: 'test', refId: t.testId });

    const adminB = await apiAs(accounts.adminB);
    expect(await listReports(adminB), "org B's list holds none of org A's reports").toEqual([]);
    expectApiError(await adminB.get(`/v1/reports/${mine.id}`), 404);
    const orgB = await newSession(accounts.adminB);
    const reportsB = new ReportsPage(orgB);
    await reportsB.goto();
    await expectEmptyState(reportsB.shell.main, REPORT_TEXTS.empty.sentence, REPORT_TEXTS.empty.action);
    await expect(reportsB.rowsFor(HEADING)).toHaveCount(0);

    const student = await newSession(accounts.studentA);
    await student.goto(ReportsPage.PATH);
    await expect(student).toHaveURL(pathPattern('/student/'));
    expectApiError(await (await apiAs(accounts.studentA)).get('/v1/reports'), 403);

    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);
    await shell.goToAdmin('Reports');
    const reports = new ReportsPage(page);
    await expect(reports.rowsFor(HEADING)).toHaveCount(1);
    await expect(reports.usage(1, 20)).toBeVisible();
    // A minute later, so the two reports have distinct request times and a fixed newest-first order.
    await testApi.clock.advance(MIN);
    const dlg = await reports.openGenerate();
    await dlg.generate({ test: REPORTED_TEST.option });
    await expect(dlg.dialog).toBeHidden();
    await expect(reports.rowsFor(HEADING)).toHaveCount(2);
    const bySuperRow = reports.rowsRequestedBy(accounts.superAdmin.email);
    await expect(bySuperRow).toHaveCount(1);
    await expect(await reports.cell(bySuperRow, 'Status')).toHaveText(STATUS_WORDS.ready, { timeout: 30_000 });
    await expect(await reports.cell(reports.rows.first(), 'Requested by'), 'newest first').toHaveText(
      accounts.superAdmin.email,
    );
    await expect(reports.usage(2, 20)).toBeVisible();

    expect(await aiReportsUsed(emulators, ORG_A.id)).toBe(2);
    expect(await aiReportsUsed(emulators, ORG_B.id)).toBe(0);
    const superUid = (await emulators.authAccount(accounts.superAdmin.email)).localId;
    const bySuper = (await auditFor(emulators, ORG_A.id, 'report.create')).filter(
      (d) => (d.data.actor as { uid?: string }).uid === superUid,
    );
    expect(bySuper).toHaveLength(1);
    expect(bySuper[0]!.data.actor).toMatchObject({ role: 'superAdmin' });

    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);
    const used = await cellIn(detail.usage, detail.usageRow('Analytics reports this month'), 'Used');
    await expect(used).toHaveText('2');
  });
});

/** FF-03: the page is locked with the one-line explanation, and shows no list, usage or empty state. */
async function expectLocked(reports: ReportsPage): Promise<void> {
  await expect(reports.heading).toBeVisible();
  await expect(reports.generate).toBeDisabled();
  await expect(reports.generate).toHaveAccessibleDescription(NOT_INCLUDED);
  await expect(reports.text(NOT_INCLUDED)).toBeVisible();
  await expect(reports.table).toHaveCount(0);
  await expect(reports.empty).toHaveCount(0);
  await expect(reports.anyUsage).toHaveCount(0);
}
