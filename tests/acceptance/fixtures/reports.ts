import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import type { ApiClient, ApiResponse } from './api';
import type { Emulators, StoredDoc } from './emulators';
import { idempotency, istDate, istTime } from './exam';
import type { ReportSummaryAnswer } from './import-files';
import { readPdf, type PdfContent } from './pdf';
import { fetchSigned, NOV_2_0930_IST, sit, strike, submit, type Downloaded } from './results';
import { departmentId, ORG_A, studentOfA, type SeedAccount } from './seed';
import type { TestApi } from './test-api';

// Phase 7 analytics reports: requests, waits on stored state, the known data the reports are made from and what their
// statistics, PDFs and files must say (docs/testids/phase-7.md). Reports are created only through the real API or UI.

const MIN = 60_000;

/** Usage month of the phase 7 clock (20 Oct 2026, IST). */
export const REPORT_MONTH = '2026-10';

/** Exact texts of the Reports page and its dialog. */
export const REPORT_TEXTS = {
  generating: 'Generating report',
  usage: (used: number, limit: number) => `Reports used this month: ${used} of ${limit}`,
  cost: (limit: number) => `Each report uses 1 of your organization's ${limit} analytics reports this month.`,
  chooseTest: 'Choose a test.',
  chooseSeries: 'Choose a series.',
  noAttempts: (kind: 'test' | 'series') => `This ${kind} has no finished attempts yet, so there is nothing to report.`,
  limitReached: (max: number) => `This month's analytics report limit (${max}) is used up.`,
  empty: {
    sentence: 'No reports yet. Generate a report once a test has finished attempts.',
    action: 'Generate report',
  },
  /** The PDF's line under the summary heading. */
  aiNote: 'Written by AI from the statistics in this report.',
  /** The PDF's text when every answer of the model was rejected. */
  leftOut: 'The written summary was left out because it used numbers that are not in these statistics.',
} as const;

export const STATUS_WORDS = {
  generating: 'Generating',
  retrying: 'Waiting to retry',
  ready: 'Ready',
  failed: 'Failed',
} as const;

export const REPORT_COLUMNS = ['Report', 'Type', 'Requested', 'Requested by', 'Status', 'Files'] as const;

/** `20 Oct 2026, 11:45 IST`, as the Requested column shows a time. */
export const requestedText = (ms: number) => `${istDate(ms)}, ${istTime(ms)} IST`;

/** `Generated 20 Oct 2026, 11:45 IST`, as the PDF states when the report was requested. */
export const generatedLine = (ms: number) => `Generated ${requestedText(ms)}`;

// ---------- API ----------

export type ReportStatus = 'queued' | 'running' | 'retrying' | 'ready' | 'failed';

export interface SignedFile {
  url: string;
  expiresAt: number;
  filename: string;
}

export interface ReportView {
  id: string;
  scope: 'test' | 'series';
  refId: string;
  title: string;
  status: ReportStatus;
  includeXlsx: boolean;
  createdAt: number;
  createdBy: { uid: string; name: string };
  error?: { code: string; message: string; retryable: boolean };
  retryAt?: number;
  metrics?: Record<string, unknown>;
  summary?: string | null;
  recommendations?: string[];
  summaryStatus?: 'accepted' | 'rejected';
  provider?: string;
  model?: string;
  pdf?: SignedFile;
  xlsx?: SignedFile;
}

export interface ReportRequest {
  scope: 'test' | 'series';
  refId: string;
  includeXlsx?: boolean;
}

/** Turns analytics reports on (or off) for an org, with an optional monthly limit, in one entitlements change. */
export async function setReportEntitlements(
  superAdmin: ApiClient,
  orgId: string,
  opts: { on?: boolean; limit?: number } = {},
): Promise<void> {
  const res = await superAdmin.put(`/v1/platform/orgs/${orgId}/entitlements`, {
    featureOverrides: { analytics_reports: opts.on ?? true },
    limitOverrides: opts.limit === undefined ? {} : { ai_reports_per_month: opts.limit },
  });
  expect(res.status, `entitlements: ${JSON.stringify(res.body)}`).toBe(200);
}

export function postReport(
  api: ApiClient,
  body: ReportRequest,
  key: string = randomUUID(),
): Promise<ApiResponse<{ id: string; status: string }>> {
  return api.post<{ id: string; status: string }>('/v1/reports', body, idempotency(key));
}

/** Requests a report and fails unless the API accepts it; returns its ID. */
export async function requestReport(api: ApiClient, body: ReportRequest, key?: string): Promise<string> {
  const res = await postReport(api, body, key);
  expect(res.status, `POST /v1/reports: ${JSON.stringify(res.body)}`).toBe(202);
  expect(res.body.status).toBe('queued');
  expect(typeof res.body.id).toBe('string');
  return res.body.id;
}

export async function getReport(api: ApiClient, id: string): Promise<ReportView> {
  const res = await api.get<ReportView>(`/v1/reports/${id}`);
  expect(res.status, `GET /v1/reports/${id}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body;
}

export async function listReports(api: ApiClient): Promise<ReportView[]> {
  const res = await api.get<{ items: ReportView[]; nextCursor: string | null }>('/v1/reports');
  expect(res.status, `GET /v1/reports: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.items;
}

/**
 * Runs due tasks until the report has this status, then returns its view. Waits on the report's state, never on time;
 * a report that fails while waiting for `ready` fails the test at once.
 */
export async function reportInState(
  api: ApiClient,
  testApi: TestApi,
  id: string,
  status: ReportStatus,
): Promise<ReportView> {
  let last: ReportView | null = null;
  // The poll stops on the wanted status or, when waiting for another one, on `failed`; the check after it reports which.
  await expect
    .poll(
      async () => {
        await testApi.tasks.runDue();
        last = await getReport(api, id);
        return last.status === status || last.status === 'failed';
      },
      { message: `report ${id} becomes ${status}`, timeout: 60_000 },
    )
    .toBe(true);
  const settled = last as ReportView | null;
  expect(settled?.status, `report ${id} ended ${settled?.status}: ${JSON.stringify(settled?.error)}`).toBe(status);
  return settled!;
}

export const reportReady = (api: ApiClient, testApi: TestApi, id: string) => reportInState(api, testApi, id, 'ready');

/** Requests a report and waits until it is ready. */
export async function readyReport(api: ApiClient, testApi: TestApi, body: ReportRequest): Promise<ReportView> {
  return reportReady(api, testApi, await requestReport(api, body));
}

/** Pending report tasks of this report (path `/tasks/report`, name containing the report ID). */
export async function reportTasks(testApi: TestApi, id: string) {
  return (await testApi.tasks.pending()).filter((t) => t.path === '/tasks/report' && t.name.includes(id));
}

// ---------- stored state ----------

export function storedReports(e: Emulators, orgId: string): Promise<StoredDoc[]> {
  return e.list(`organizations/${orgId}`, 'reports');
}

export async function storedReport(e: Emulators, orgId: string, id: string): Promise<Record<string, unknown>> {
  const doc = await e.doc(`organizations/${orgId}/reports/${id}`);
  expect(doc, `report ${id} in ${orgId}`).not.toBeNull();
  return doc!.data;
}

/** The org's `aiReports` counter for the month (0 when the usage record or field does not exist). */
export async function aiReportsUsed(e: Emulators, orgId: string, month: string = REPORT_MONTH): Promise<number> {
  const doc = await e.doc(`organizations/${orgId}/usage/${month}`);
  return Number(doc?.data.aiReports ?? 0);
}

export const reportPdfPath = (orgId: string, id: string) => `organizations/${orgId}/reports/${id}/report.pdf`;
export const reportXlsxPath = (orgId: string, id: string) => `organizations/${orgId}/reports/${id}/metrics.xlsx`;

// ---------- files ----------

/** Fetches a report file's signed link without credentials and checks it is served as an attachment of this name. */
export async function fetchReportFile(
  request: APIRequestContext,
  file: SignedFile | undefined,
  filename: string,
  contentType: RegExp,
): Promise<Downloaded> {
  expect(file, `signed link for ${filename}`).toBeTruthy();
  expect(file!.filename).toBe(filename);
  const got = await fetchSigned(request, file!.url);
  expect(got.status, `download of ${filename}`).toBe(200);
  expect(got.headers['content-type']).toMatch(contentType);
  expect(got.headers['content-disposition']).toMatch(/^attachment/);
  expect(got.headers['content-disposition']).toContain(filename);
  return got;
}

/** Downloads a ready report's PDF through its signed link and reads it. */
export async function reportPdf(request: APIRequestContext, view: ReportView): Promise<PdfContent> {
  const got = await fetchReportFile(request, view.pdf, `report-${view.id}.pdf`, /^application\/pdf/);
  return readPdf(got.body);
}

// ---------- the model's scripted answers ----------

/** Numbers 5, 10, 2, 4, 20 and 1.5 are all in the reported test's statistics. */
export const GOOD_ANSWER: ReportSummaryAnswer = {
  summary:
    '5 of the 10 eligible students finished the test. The mean score was 2 out of 4, and question 4 was the most missed at 20% correct.',
  recommendations: [
    'Revisit the topic of question 4, which only 1 student answered correctly.',
    'Give the IT department extra practice: its mean score was 1.5 out of 4.',
  ],
};

/** Every number except 93.7 is in the statistics; 93.7 is in none of them. */
export const UNSUPPORTED = '93.7';
export const BAD_SUMMARY: ReportSummaryAnswer = {
  summary: `Students scored ${UNSUPPORTED}% on average, and 5 of them finished the test.`,
  recommendations: ['Keep the same difficulty for the next test.'],
};
export const BAD_RECOMMENDATION: ReportSummaryAnswer = {
  summary: '5 of the 10 eligible students finished the test.',
  recommendations: [`Aim for a ${UNSUPPORTED}% pass rate in the next test.`],
};

/** Numbers 3, 10, 4, 8 and 7 are all in the reported series' statistics. */
export const SERIES_ANSWER: ReportSummaryAnswer = {
  summary: '3 of the 10 eligible students finished at least one test. The mean total was 4 out of 8.',
  recommendations: ['Encourage the 7 students who have not started to take the next test.'],
};

export async function scriptReport(testApi: TestApi, answers: ReportSummaryAnswer[], failures?: number): Promise<void> {
  await testApi.llm.script({ report: { answers, ...(failures === undefined ? {} : { failures }) } });
}

// ---------- the reported test: five Computer and IT students sit the `basic` questions ----------

/** Students 1 to 20 of org A in Computer or IT: 1, 2, 5, 6, 9, 10, 13, 14, 17 and 18 (ten eligible students). */
export const REPORT_ELIGIBILITY = {
  departmentIds: [departmentId(ORG_A, 'Computer'), departmentId(ORG_A, 'IT')],
};

export const REPORTED_TEST = {
  heading: 'Day 1: Quantitative aptitude',
  series: 'Placement 2026',
  /** The dialog's option label for the test. */
  option: 'Day 1: Quantitative aptitude, Placement 2026',
} as const;

/**
 * Who sits, what they pick (by question index and option text; `basic` set, correct: 20 m/s, 30, 4, 32), when they
 * submit (minutes after they all started) and their strikes. Scores 4, 3, 2, 0 and 1 of 4.
 */
const SITTINGS: ReadonlyArray<{ n: number; picks: Record<number, string>; minutes: number; strikes?: number }> = [
  { n: 1, picks: { 0: '20 m/s', 1: '30', 2: '4', 3: '32' }, minutes: 10 },
  { n: 2, picks: { 0: '20 m/s', 1: '30', 2: '4', 3: '64' }, minutes: 12 },
  { n: 5, picks: { 0: '20 m/s', 1: '25', 2: '4', 3: '24' }, minutes: 15, strikes: 1 },
  { n: 6, picks: { 0: '24 m/s', 1: '25', 2: '3', 3: '24' }, minutes: 5 },
  { n: 9, picks: { 0: '24 m/s', 1: '30', 2: '3' }, minutes: 8 },
];

export type ApiAs = (account: SeedAccount, opts?: { orgId?: string }) => Promise<ApiClient>;

/**
 * Seeds the reported test (its series open to Computer and IT) and has the five students sit it through the real API:
 * all start at once, then submit in turn. Leaves the clock 15 minutes after they started. Returns the IDs.
 */
export async function sitReportedTest(
  apiAs: ApiAs,
  testApi: TestApi,
): Promise<{ testId: string; seriesId: string; startedAt: number }> {
  const t = await testApi.seedExamTest({ orgId: ORG_A.id, seriesEligibility: REPORT_ELIGIBILITY });
  const startedAt = await testApi.clock.now();
  const attempts: Array<{ api: ApiClient; attemptId: string; minutes: number }> = [];
  for (const s of SITTINGS) {
    const api = await apiAs(studentOfA(s.n));
    const payload = await sit(api, testApi, t.testId, s.picks);
    if (s.strikes) expect(await strike(api, testApi, payload.attempt.id, s.strikes)).toBe('in_progress');
    attempts.push({ api, attemptId: payload.attempt.id, minutes: s.minutes });
  }
  expect(await testApi.clock.now(), 'every attempt started at the same clock time').toBe(startedAt);
  for (const a of [...attempts].sort((x, y) => x.minutes - y.minutes)) {
    await testApi.clock.set(startedAt + a.minutes * MIN);
    await submit(a.api, a.attemptId);
  }
  return { testId: t.testId, seriesId: t.seriesId, startedAt };
}

/** The statistics of the reported test (docs/testids/phase-7.md, "Metrics"). */
export const TEST_METRICS = {
  version: 1,
  scope: 'test',
  title: REPORTED_TEST.heading,
  maxScore: 4,
  participation: { eligible: 10, finished: 5, inProgress: 0, notStarted: 5, ratePct: 50 },
  statuses: { submitted: 5, autoSubmitted: 0, terminated: 0 },
  scores: { mean: 2, median: 2, top: 4, bottom: 0, stdDev: 1.41, meanPct: 50 },
  sections: [],
  departments: [
    { departmentId: departmentId(ORG_A, 'Computer'), name: 'Computer', finished: 3, mean: 2.33, meanPct: 58.33 },
    { departmentId: departmentId(ORG_A, 'IT'), name: 'IT', finished: 2, mean: 1.5, meanPct: 37.5 },
  ],
  mostMissed: [
    { number: 4, correctRatePct: 20 },
    { number: 1, correctRatePct: 60 },
    { number: 2, correctRatePct: 60 },
    { number: 3, correctRatePct: 60 },
  ],
  mostPickedWrong: [
    { number: 1, letter: 'B', text: '24 m/s', count: 2 },
    { number: 2, letter: 'A', text: '25', count: 2 },
    { number: 3, letter: 'A', text: '3', count: 2 },
    { number: 4, letter: 'A', text: '24', count: 2 },
    { number: 4, letter: 'D', text: '64', count: 1 },
  ],
  strikes: { total: 1, attemptsWithStrikes: 1, terminated: 0 },
  timeTaken: { meanSec: 600, medianSec: 600, minSec: 300, maxSec: 900 },
  trends: [],
  discriminationGroupPct: 27,
} as const;

/** Per question: served, answered, correct, rate and discrimination index (k = 2: students 1 and 2 against 6 and 9). */
export const TEST_QUESTIONS = [
  { number: 1, served: 5, answered: 5, correct: 3, correctRatePct: 60, discriminationIndex: 1 },
  { number: 2, served: 5, answered: 5, correct: 3, correctRatePct: 60, discriminationIndex: 0.5 },
  { number: 3, served: 5, answered: 5, correct: 3, correctRatePct: 60, discriminationIndex: 1 },
  { number: 4, served: 5, answered: 4, correct: 1, correctRatePct: 20, discriminationIndex: 0.5 },
] as const;

/** Scores 0, 25, 50, 75 and 100 per cent fall in bands 0, 2, 5, 7 and 9. */
export const TEST_DISTRIBUTION = [1, 0, 1, 0, 0, 1, 0, 1, 0, 1] as const;

/** What the reported test's PDF must say, apart from the title, the time and the summary. */
export const TEST_PDF_LINES = [
  'Key figures',
  'Students who finished: 5 of 10',
  'Mean score: 2 / 4',
  'Median score: 2 / 4',
  'Top score: 4 / 4',
  'Bottom score: 0 / 4',
  'Score distribution',
  'Departments',
  'Computer: 3 students, mean 2.33 / 4',
  'IT: 2 students, mean 1.5 / 4',
  'Questions',
  'Most-missed questions',
  'Question 4: 20% correct',
  'Most-picked wrong options',
  'Question 1: B. 24 m/s, picked 2 times',
  'Question 4: D. 64, picked 1 time',
  'Strikes',
  'Attempts with strikes: 1 of 5',
  'Total strikes: 1',
  'Ended after strikes: 0',
  'Time taken',
  'Median time taken: 10 minutes',
] as const;

/** Names, emails and PRNs of the students who sat: never in a report. */
export const SITTER_IDENTITIES = SITTINGS.flatMap((s) => {
  const a = studentOfA(s.n);
  return [a.name, a.email, `220101${String(s.n).padStart(2, '0')}`];
});

// ---------- the reported series: two days with graded attempts ----------

/** The series tests set the clock to 2 Nov 2026, 09:30 IST (phase 4's instant), so its usage month is November. */
export const SERIES_MONTH = '2026-11';

export interface ReportedSeries {
  seriesId: string;
  tests: Array<{ testId: string; heading: string; date: string }>;
}

/**
 * Sets the clock to 2 Nov 2026, 09:30 IST and seeds the series `Placement 2026` (1 to 30 Nov, open to Computer and
 * IT) with `Day 1: Quantitative aptitude` on 1 Nov and `Day 2: Logical reasoning` on 2 Nov, and finished attempts:
 * day 1 students 1 (4) and 2 (2); day 2 students 1 (3), 2 (1) and 5 (2). Totals 7, 3 and 2 of 8.
 */
export async function seedReportedSeries(testApi: TestApi): Promise<ReportedSeries> {
  await testApi.clock.set(NOV_2_0930_IST);
  const { seriesId } = await testApi.seedSeries({
    orgId: ORG_A.id,
    status: 'active',
    eligibility: REPORT_ELIGIBILITY,
  });
  const t1 = await testApi.seedExamTest({ orgId: ORG_A.id, seriesId, opensInMin: -1440 });
  const t2 = await testApi.seedExamTest({ orgId: ORG_A.id, seriesId, title: 'Logical reasoning', company: 'Infosys' });
  const stu = (n: number) => `stu-${ORG_A.id}-${String(n).padStart(2, '0')}`;
  await testApi.seedGradedAttempts(ORG_A.id, t1.testId, [
    { studentId: stu(1), score: 4, timeSec: 600, correct: 4 },
    { studentId: stu(2), score: 2, timeSec: 900, correct: 2 },
  ]);
  await testApi.seedGradedAttempts(ORG_A.id, t2.testId, [
    { studentId: stu(1), score: 3, timeSec: 300, correct: 3 },
    { studentId: stu(2), score: 1, timeSec: 600, correct: 1 },
    { studentId: stu(5), score: 2, timeSec: 480, correct: 2 },
  ]);
  return {
    seriesId,
    tests: [
      { testId: t1.testId, heading: 'Day 1: Quantitative aptitude', date: '2026-11-01' },
      { testId: t2.testId, heading: 'Day 2: Logical reasoning', date: '2026-11-02' },
    ],
  };
}

/** The statistics of the reported series, apart from `trends` (built from the seeded test IDs). */
export const SERIES_METRICS = {
  version: 1,
  scope: 'series',
  title: 'Placement 2026',
  maxScore: 8,
  participation: { eligible: 10, finished: 3, inProgress: 0, notStarted: 7, ratePct: 30 },
  statuses: { submitted: 5, autoSubmitted: 0, terminated: 0 },
  scores: { mean: 4, median: 3, top: 7, bottom: 2, stdDev: 2.16, meanPct: 50 },
  sections: [],
  departments: [
    { departmentId: departmentId(ORG_A, 'Computer'), name: 'Computer', finished: 2, mean: 4.5, meanPct: 56.25 },
    { departmentId: departmentId(ORG_A, 'IT'), name: 'IT', finished: 1, mean: 3, meanPct: 37.5 },
  ],
  questions: [],
  mostMissed: [],
  mostPickedWrong: [],
  strikes: { total: 0, attemptsWithStrikes: 0, terminated: 0 },
  timeTaken: { medianSec: 600, minSec: 300, maxSec: 900 },
  discriminationGroupPct: 27,
} as const;

export function seriesTrends(series: ReportedSeries) {
  return [
    {
      testId: series.tests[0]!.testId,
      heading: series.tests[0]!.heading,
      date: series.tests[0]!.date,
      finished: 2,
      mean: 3,
      median: 3,
      max: 4,
      meanPct: 75,
    },
    {
      testId: series.tests[1]!.testId,
      heading: series.tests[1]!.heading,
      date: series.tests[1]!.date,
      finished: 3,
      mean: 2,
      median: 2,
      max: 4,
      meanPct: 50,
    },
  ];
}

export function seriesPdfLines(series: ReportedSeries): string[] {
  return [
    'Key figures',
    'Students who finished: 3 of 10',
    'Mean total: 4 / 8',
    'Median total: 3 / 8',
    'Top total: 7 / 8',
    'Bottom total: 2 / 8',
    'Trends across days',
    `${series.tests[0]!.heading}: 2 students, mean 3 / 4`,
    `${series.tests[1]!.heading}: 3 students, mean 2 / 4`,
    'Departments',
    'Computer: 2 students, mean 4.5 / 8',
    'IT: 1 student, mean 3 / 8',
    'Strikes',
    'Attempts with strikes: 0 of 5',
    'Time taken',
    'Median time taken: 10 minutes',
  ];
}
