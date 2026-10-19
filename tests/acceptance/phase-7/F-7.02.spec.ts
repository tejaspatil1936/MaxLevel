import { AUTHORING_NOW, auditFor } from '../fixtures/authoring';
import { expectApiError, startAttempt } from '../fixtures/exam';
import { storageObject } from '../fixtures/imports';
import { expectPdfText, expectPdfWithout } from '../fixtures/pdf';
import {
  BAD_RECOMMENDATION,
  BAD_SUMMARY,
  fetchReportFile,
  generatedLine,
  getReport,
  GOOD_ANSWER,
  postReport,
  readyReport,
  REPORT_ELIGIBILITY,
  REPORT_TEXTS,
  REPORTED_TEST,
  reportInState,
  reportPdf,
  reportPdfPath,
  reportReady,
  reportTasks,
  reportXlsxPath,
  requestReport,
  scriptReport,
  SERIES_ANSWER,
  SERIES_METRICS,
  seriesPdfLines,
  seriesTrends,
  seedReportedSeries,
  setReportEntitlements,
  SITTER_IDENTITIES,
  sitReportedTest,
  storedReport,
  storedReports,
  TEST_DISTRIBUTION,
  TEST_METRICS,
  TEST_PDF_LINES,
  TEST_QUESTIONS,
  UNSUPPORTED,
} from '../fixtures/reports';
import { readXlsx, XLSX_TYPE } from '../fixtures/results';
import { accounts, ORG_A, ORG_B, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';

// F-7.02 AI summary check and PDF report (EXP-05, EXP-06; EXP-04's numbers checked through the report). Contract:
// docs/testids/phase-7.md, "Metrics", "Summary and the number check", "Report files" and "Requests the tests send
// directly". Everything here goes through the API; the Reports page is F-7.03.

const MIN = 60_000;
const HEADING = REPORTED_TEST.heading;
const XLSX = new RegExp(`^${XLSX_TYPE.replace(/[.]/g, '\\.')}`);

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-7.02 AI summary check and PDF report', () => {
  test("EXP-04 EXP-05 EXP-06 a test report holds the computed statistics and the model's summary, in a PDF printed by headless Chromium", async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(180_000);
    await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
    const { testId } = await sitReportedTest(apiAs, testApi);
    await scriptReport(testApi, [GOOD_ANSWER]);
    const admin = await apiAs(accounts.adminA);
    const requestedAt = await testApi.clock.now();

    const id = await requestReport(admin, { scope: 'test', refId: testId });
    const view = await reportReady(admin, testApi, id);
    expect(view).toMatchObject({
      id,
      scope: 'test',
      refId: testId,
      title: HEADING,
      status: 'ready',
      includeXlsx: false,
      createdAt: requestedAt,
      createdBy: { name: 'Admin 1' },
      summaryStatus: 'accepted',
      summary: GOOD_ANSWER.summary,
      recommendations: GOOD_ANSWER.recommendations,
      provider: 'mock',
      model: 'mock-model',
    });
    expect(view.xlsx, 'no XLSX unless asked for').toBeUndefined();

    // EXP-04: every number is computed by code from the stored attempts.
    const metrics = view.metrics as Record<string, unknown> & {
      questions: Array<Record<string, unknown>>;
      scores: { distribution: Array<{ fromPct: number; toPct: number; count: number }> };
    };
    expect(metrics).toMatchObject(TEST_METRICS);
    expect(metrics.questions.map(pick)).toEqual(TEST_QUESTIONS.map((q) => ({ ...q })));
    expect(metrics.scores.distribution.map((b) => b.count)).toEqual([...TEST_DISTRIBUTION]);
    expect(metrics.scores.distribution[0]).toMatchObject({ fromPct: 0, toPct: 10 });
    const metricsText = JSON.stringify(metrics);
    for (const who of SITTER_IDENTITIES) expect(metricsText, 'no student identity in the metrics').not.toContain(who);

    // EXP-05: the model received the stored metrics as JSON and nothing else.
    const calls = await testApi.llm.reportCalls();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.prompt)).toEqual(metrics);
    for (const who of SITTER_IDENTITIES) {
      expect(calls[0]!.prompt).not.toContain(who);
      expect(calls[0]!.system).not.toContain(who);
    }

    // EXP-06: a PDF printed by Chromium, served through a 15-minute signed link, holding the statistics and summary.
    expect(view.pdf?.expiresAt).toBe(requestedAt + 15 * MIN);
    const pdf = await reportPdf(request, view);
    expect(String(pdf.info.Producer), 'printed by headless Chromium').toMatch(/^Skia\/PDF/);
    expect(pdf.info.Title).toBe(`Analytics report: ${HEADING}`);
    expectPdfText(pdf, [
      'Analytics report',
      HEADING,
      ORG_A.name,
      generatedLine(requestedAt),
      'Summary',
      REPORT_TEXTS.aiNote,
      GOOD_ANSWER.summary,
      'Recommendations',
      ...GOOD_ANSWER.recommendations,
      ...TEST_PDF_LINES,
    ]);
    expectPdfWithout(pdf, [...SITTER_IDENTITIES, REPORT_TEXTS.leftOut, 'Trends across days']);

    const stored = await storedReport(emulators, ORG_A.id, id);
    expect(stored).toMatchObject({
      orgId: ORG_A.id,
      scope: 'test',
      refId: testId,
      status: 'ready',
      includeXlsx: false,
      summaryStatus: 'accepted',
      summaryCalls: 1,
      pdfPath: reportPdfPath(ORG_A.id, id),
    });
    expect(stored.metrics).toEqual(metrics);
    const file = await storageObject(request, reportPdfPath(ORG_A.id, id));
    expect(file?.contentType).toBe('application/pdf');
    expect(await storageObject(request, reportXlsxPath(ORG_A.id, id))).toBeNull();
    const audit = await auditFor(emulators, ORG_A.id, 'report.create', id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data).toMatchObject({
      actor: { email: accounts.adminA.email, role: 'admin' },
      target: { type: 'report', id },
      after: { scope: 'test', refId: testId, includeXlsx: false },
    });
  });

  test('EXP-05 a summary or recommendation quoting a number that is not in the statistics is rejected and the model is asked again', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(180_000);
    await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
    const { testId } = await sitReportedTest(apiAs, testApi);
    await scriptReport(testApi, [BAD_SUMMARY, BAD_RECOMMENDATION, GOOD_ANSWER]);
    const admin = await apiAs(accounts.adminA);

    const view = await readyReport(admin, testApi, { scope: 'test', refId: testId });
    expect(view).toMatchObject({
      summaryStatus: 'accepted',
      summary: GOOD_ANSWER.summary,
      recommendations: GOOD_ANSWER.recommendations,
    });
    const calls = await testApi.llm.reportCalls();
    expect(calls, 'two rejected answers, then the accepted one').toHaveLength(3);
    for (const c of calls) expect(JSON.parse(c.prompt), 'every call carries only the metrics').toEqual(view.metrics);
    expect(calls[0]!.system).not.toContain(UNSUPPORTED);
    expect(calls[1]!.system, 'the re-ask names the unsupported number').toContain(UNSUPPORTED);
    expect(calls[2]!.system).toContain(UNSUPPORTED);
    expect(await storedReport(emulators, ORG_A.id, view.id)).toMatchObject({ summaryCalls: 3 });

    const pdf = await reportPdf(request, view);
    expectPdfText(pdf, [REPORT_TEXTS.aiNote, GOOD_ANSWER.summary, ...GOOD_ANSWER.recommendations]);
    expectPdfWithout(pdf, [UNSUPPORTED, BAD_SUMMARY.summary, ...BAD_RECOMMENDATION.recommendations]);
  });

  test('EXP-05 when every answer quotes unsupported numbers, the report keeps its statistics and says the summary was left out', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(180_000);
    await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
    const { testId } = await sitReportedTest(apiAs, testApi);
    await scriptReport(testApi, [BAD_SUMMARY]);
    const admin = await apiAs(accounts.adminA);

    const view = await readyReport(admin, testApi, { scope: 'test', refId: testId });
    expect(view).toMatchObject({ status: 'ready', summaryStatus: 'rejected', summary: null, recommendations: [] });
    expect(view.metrics).toMatchObject(TEST_METRICS);
    expect(await testApi.llm.reportCalls(), 'at most three calls').toHaveLength(3);
    expect(await reportTasks(testApi, view.id), 'a rejected summary is not retried later').toEqual([]);
    expect(await storedReport(emulators, ORG_A.id, view.id)).toMatchObject({
      summaryStatus: 'rejected',
      summary: null,
      summaryCalls: 3,
    });

    const pdf = await reportPdf(request, view);
    expectPdfText(pdf, ['Summary', REPORT_TEXTS.leftOut, ...TEST_PDF_LINES]);
    expectPdfWithout(pdf, [
      UNSUPPORTED,
      REPORT_TEXTS.aiNote,
      'Recommendations',
      BAD_SUMMARY.summary,
      ...BAD_SUMMARY.recommendations,
    ]);
  });

  test('EXP-06 EXP-04 the optional XLSX holds the raw statistics, sheet by sheet, next to the PDF', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(180_000);
    await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
    const { testId } = await sitReportedTest(apiAs, testApi);
    await scriptReport(testApi, [GOOD_ANSWER]);
    const admin = await apiAs(accounts.adminA);
    const requestedAt = await testApi.clock.now();

    const view = await readyReport(admin, testApi, { scope: 'test', refId: testId, includeXlsx: true });
    expect(view.includeXlsx).toBe(true);
    expect(view.xlsx?.expiresAt).toBe(requestedAt + 15 * MIN);
    const got = await fetchReportFile(request, view.xlsx, `report-${view.id}-metrics.xlsx`, XLSX);
    const sheets = await readXlsx(got.body);
    expect(sheets.map((s) => s.name)).toEqual(['Overview', 'Questions', 'Departments']);
    expect(sheets[0]!.rows).toEqual([
      ['Metric', 'Value'],
      ['Students eligible', 10],
      ['Students who finished', 5],
      ['Participation (%)', 50],
      ['Maximum score', 4],
      ['Mean score', 2],
      ['Median score', 2],
      ['Top score', 4],
      ['Bottom score', 0],
      ['Standard deviation', 1.41],
      ['Attempts with strikes', 1],
      ['Total strikes', 1],
      ['Median time taken (minutes)', 10],
    ]);
    expect(sheets[1]!.rows).toEqual([
      [
        'Question',
        'Served',
        'Answered',
        'Correct',
        'Correct rate (%)',
        'Discrimination index',
        'Most-picked wrong option',
        'Times picked',
      ],
      [1, 5, 5, 3, 60, 1, 'B. 24 m/s', 2],
      [2, 5, 5, 3, 60, 0.5, 'A. 25', 2],
      [3, 5, 5, 3, 60, 1, 'A. 3', 2],
      [4, 5, 4, 1, 20, 0.5, 'A. 24', 2],
    ]);
    expect(sheets[2]!.rows).toEqual([
      ['Department', 'Students who finished', 'Mean score', 'Mean (%)'],
      ['Computer', 3, 2.33, 58.33],
      ['IT', 2, 1.5, 37.5],
    ]);

    expect(await storedReport(emulators, ORG_A.id, view.id)).toMatchObject({
      includeXlsx: true,
      pdfPath: reportPdfPath(ORG_A.id, view.id),
      xlsxPath: reportXlsxPath(ORG_A.id, view.id),
    });
    expect((await storageObject(request, reportXlsxPath(ORG_A.id, view.id)))?.contentType).toMatch(XLSX);
    const pdf = await reportPdf(request, view);
    expectPdfText(pdf, ['Students who finished: 5 of 10', GOOD_ANSWER.summary]);
  });

  test('EXP-04 EXP-05 EXP-06 a series report shows totals and trends across days, in the PDF and the XLSX', async ({
    apiAs,
    testApi,
    request,
  }) => {
    test.setTimeout(120_000);
    await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
    const series = await seedReportedSeries(testApi);
    await scriptReport(testApi, [SERIES_ANSWER]);
    const admin = await apiAs(accounts.adminA);

    const view = await readyReport(admin, testApi, { scope: 'series', refId: series.seriesId, includeXlsx: true });
    expect(view).toMatchObject({
      scope: 'series',
      refId: series.seriesId,
      title: 'Placement 2026',
      summaryStatus: 'accepted',
      summary: SERIES_ANSWER.summary,
    });
    expect(view.metrics).toMatchObject(SERIES_METRICS);
    expect(view.metrics!.trends).toEqual(seriesTrends(series));
    const calls = await testApi.llm.reportCalls();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.prompt)).toEqual(view.metrics);

    const pdf = await reportPdf(request, view);
    expect(pdf.info.Title).toBe('Analytics report: Placement 2026');
    expectPdfText(pdf, [
      'Analytics report',
      'Placement 2026',
      SERIES_ANSWER.summary,
      ...SERIES_ANSWER.recommendations,
      ...seriesPdfLines(series),
    ]);
    expectPdfWithout(pdf, ['Most-missed questions', 'Most-picked wrong options']);

    const got = await fetchReportFile(request, view.xlsx, `report-${view.id}-metrics.xlsx`, XLSX);
    const sheets = await readXlsx(got.body);
    expect(sheets.map((s) => s.name)).toEqual(['Overview', 'Departments', 'Trends']);
    expect(sheets[0]!.rows.slice(1, 9)).toEqual([
      ['Students eligible', 10],
      ['Students who finished', 3],
      ['Participation (%)', 30],
      ['Maximum score', 8],
      ['Mean score', 4],
      ['Median score', 3],
      ['Top score', 7],
      ['Bottom score', 2],
    ]);
    expect(sheets[2]!.rows).toEqual([
      ['Test', 'Date', 'Students who finished', 'Mean score', 'Median score', 'Maximum score', 'Mean (%)'],
      [series.tests[0]!.heading, '1 Nov 2026', 2, 3, 3, 4, 75],
      [series.tests[1]!.heading, '2 Nov 2026', 3, 2, 2, 4, 50],
    ]);
  });

  test('REL-06 EXP-05 when the model fails, the report waits to retry on the schedule and then finishes', async ({
    apiAs,
    testApi,
    request,
  }) => {
    test.setTimeout(180_000);
    await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
    const { testId } = await sitReportedTest(apiAs, testApi);
    await scriptReport(testApi, [GOOD_ANSWER], 1);
    const admin = await apiAs(accounts.adminA);
    const requestedAt = await testApi.clock.now();

    const id = await requestReport(admin, { scope: 'test', refId: testId });
    const waiting = await reportInState(admin, testApi, id, 'retrying');
    expect(waiting.error).toEqual({
      code: 'LLM_UNAVAILABLE',
      message: "The AI service didn't answer.",
      retryable: true,
    });
    expect(waiting.retryAt).toBe(requestedAt + 60_000);
    expect(waiting.pdf, 'no file before the summary is settled').toBeUndefined();
    const tasks = await reportTasks(testApi, id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.scheduleTime).toBe(requestedAt + 60_000);
    expect(await testApi.llm.reportCalls()).toHaveLength(1);

    await testApi.clock.advance(60_000);
    const view = await reportReady(admin, testApi, id);
    expect(view).toMatchObject({ summaryStatus: 'accepted', summary: GOOD_ANSWER.summary });
    expect(view.error).toBeUndefined();
    expect(await testApi.llm.reportCalls()).toHaveLength(2);
    expectPdfText(await reportPdf(request, view), [GOOD_ANSWER.summary]);
  });

  test('EXP-06 API-02 a report needs an Idempotency-Key, a published test or series and a finished attempt; refusals store nothing', async ({
    apiAs,
    testApi,
    emulators,
  }) => {
    await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, seriesEligibility: REPORT_ELIGIBILITY });
    const draft = await testApi.seedExamTest({
      orgId: ORG_A.id,
      seriesId: t.seriesId,
      title: 'Logical reasoning',
      publish: false,
    });
    const admin = await apiAs(accounts.adminA);
    const body = { scope: 'test' as const, refId: t.testId };

    expectApiError(await admin.post('/v1/reports', body), 400, 'IDEMPOTENCY_KEY_REQUIRED');
    expectApiError(await postReport(admin, { scope: 'course' as 'test', refId: t.testId }), 400, 'VALIDATION');
    expectApiError(await postReport(admin, { scope: 'test', refId: 'no-such-test' }), 404);
    expectApiError(await postReport(admin, { scope: 'series', refId: 'no-such-series' }), 404);
    expectApiError(await postReport(admin, { scope: 'test', refId: draft.testId }), 404);
    expectApiError(await postReport(admin, body), 409, 'NO_FINISHED_ATTEMPTS');
    expectApiError(await postReport(admin, { scope: 'series', refId: t.seriesId }), 409, 'NO_FINISHED_ATTEMPTS');
    // An attempt still in progress is not a finished one.
    await startAttempt(await apiAs(studentOfA(1)), t.testId);
    expectApiError(await postReport(admin, body), 409, 'NO_FINISHED_ATTEMPTS');
    expectApiError(await admin.get('/v1/reports/no-such-report'), 404);
    expectApiError(await postReport(await apiAs(accounts.studentA), body), 403);

    expect(await storedReports(emulators, ORG_A.id), 'refusals store nothing').toEqual([]);
    expect(await auditFor(emulators, ORG_A.id, 'report.create')).toEqual([]);
    expect(await testApi.llm.reportCalls()).toEqual([]);
  });

  test('ORG-05 ORG-14 a report belongs to its organization: org B gets 404, a student 403, and a super admin makes one in org A', async ({
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const superAdmin = await apiAs(accounts.superAdmin);
    await setReportEntitlements(superAdmin, ORG_A.id);
    await setReportEntitlements(superAdmin, ORG_B.id);
    const series = await seedReportedSeries(testApi);
    const testId = series.tests[0]!.testId;
    const admin = await apiAs(accounts.adminA);
    const mine = await readyReport(admin, testApi, { scope: 'test', refId: testId });

    const adminB = await apiAs(accounts.adminB);
    expectApiError(await adminB.get(`/v1/reports/${mine.id}`), 404);
    expectApiError(await postReport(adminB, { scope: 'test', refId: testId }), 404);
    expectApiError(await postReport(adminB, { scope: 'series', refId: series.seriesId }), 404);
    expectApiError(await superAdmin.inOrg(ORG_B.id).get(`/v1/reports/${mine.id}`), 404);
    const student = await apiAs(accounts.studentA);
    expectApiError(await student.get(`/v1/reports/${mine.id}`), 403);
    expectApiError(await postReport(student, { scope: 'test', refId: testId }), 403);

    const asSuper = superAdmin.inOrg(ORG_A.id);
    expect((await getReport(asSuper, mine.id)).status).toBe('ready');
    const theirs = await readyReport(asSuper, testApi, { scope: 'series', refId: series.seriesId });
    expect(theirs.createdBy.name).toBe(accounts.superAdmin.email);
    expect((await getReport(admin, theirs.id)).status, "the org's admins see it too").toBe('ready');
    expect(await storedReports(emulators, ORG_B.id)).toEqual([]);
    const superUid = (await emulators.authAccount(accounts.superAdmin.email)).localId;
    const audit = await auditFor(emulators, ORG_A.id, 'report.create', theirs.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data.actor).toMatchObject({ uid: superUid, role: 'superAdmin' });
  });
});

/** The per-question fields the tests check. */
function pick(q: Record<string, unknown>) {
  return {
    number: q.number,
    served: q.served,
    answered: q.answered,
    correct: q.correct,
    correctRatePct: q.correctRatePct,
    discriminationIndex: q.discriminationIndex,
  };
}
