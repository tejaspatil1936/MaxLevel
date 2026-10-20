import { expect, type APIRequestContext } from '@playwright/test';
import ExcelJS from 'exceljs';
import { stackEnv } from '../../env';
import { errorCode, type ApiClient, type ApiResponse } from './api';
import type { Emulators, StoredDoc } from './emulators';
import { idempotency, istTime, postEvent, putAnswers, startAttempt, timerText, type ExamPayload } from './exam';
import { departmentId, seededStudent, STUDENT_NAMES, type SeedOrg } from './seed';
import type { TestApi } from './test-api';

// Phase 4 results facts, texts, API calls and file parsing (docs/testids/phase-4.md). Seeds come from the test-only
// API (`exam-test`, `more-students`, `graded-attempts`); these helpers sit attempts through the real API and read what
// the system stored or served.

export const WORKER_URL = stackEnv.WORKER_URL ?? 'http://127.0.0.1:4001';
const MIN = 60_000;

// ---------- numbers and texts as people see them ----------

const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** A score or mark count as shown: en-IN, at most two decimals, U+2212 for negatives. */
export const num = (n: number) => (n < 0 ? `−${fmt.format(-n)}` : fmt.format(n));
/** `2.75 / 10` */
export const scoreText = (score: number, max: number) => `${num(score)} / ${num(max)}`;
/** `27.5%` */
export const pctText = (pct: number) => `${num(pct)}%`;
/** `+1`, `−0.25`, `0` */
export const marksText = (m: number) => (m > 0 ? `+${fmt.format(m)}` : m < 0 ? `−${fmt.format(-m)}` : '0');

/** Result page time taken: `<n> minutes` (rounded down) or `<n> seconds` under a minute. */
export function timeTakenText(durationSec: number): string {
  if (durationSec < 60) return durationSec === 1 ? '1 second' : `${durationSec} seconds`;
  const m = Math.floor(durationSec / 60);
  return m === 1 ? '1 minute' : `${m} minutes`;
}

export const strikeSummary = (n: number) => (n === 0 ? 'no strikes' : n === 1 ? '1 strike' : `${n} strikes`);
/** The result page line `12 minutes, 1 strike`. */
export const timeAndStrikes = (durationSec: number, strikes: number) =>
  `${timeTakenText(durationSec)}, ${strikeSummary(strikes)}`;
/** Leaderboard `Time taken` cell: `MM:SS` or `H:MM:SS`. */
export const boardTime = (timeSec: number) => timerText(timeSec * 1000);

export const RESULT_TEXTS = {
  pendingAfterClose: (endMs: number) => `Results will be released after the window closes at ${istTime(endMs)} IST.`,
  pendingManual: 'Your placement cell will release the results.',
  never: 'Results for this test are not shared with students.',
  withdrawnHeading: 'Results are being reviewed',
  withdrawnText:
    'Your placement cell is checking these results. They will be shown here again once the review is done.',
  endedHeading: 'Your test was ended',
  endedReason: (max: number) => `Reason: You reached the maximum of ${max} strikes.`,
  rank: (n: number, total: number) => `Rank ${n} of ${total}`,
  rankAfterClose: (endMs: number) => `Your rank will be shown after the window closes at ${istTime(endMs)} IST.`,
  notRanked: 'Not ranked, because the test was ended.',
  inProgress: 'This test is still in progress.',
  notFoundHeading: 'Result not found',
  notFoundText: "This result doesn't exist or isn't yours.",
} as const;

export const ADMIN_RELEASE_TEXTS = {
  released: 'Released to students.',
  afterClose: (endMs: number) => `Results will be released after the window closes at ${istTime(endMs)} IST.`,
  manual: 'Waiting for you to release the results.',
  never: 'Results for this test are not shared with students.',
  withdrawn: 'Withdrawn. Students see that their results are being reviewed.',
  releaseConfirmText: 'Students will see their results as soon as you release them.',
  fullReviewBlocked: (endMs: number) =>
    `A full review can't be released before the window closes at ${istTime(endMs)} IST, because students who haven't started would see the answers.`,
  noRows: 'No ranked attempts yet. The leaderboard fills in as students submit.',
} as const;

/** `Results` column words of the admin results list. */
export const RESULTS_STATE_WORDS = {
  released: 'Released',
  afterClose: 'After the window closes',
  manual: 'Waiting for release',
  withdrawn: 'Withdrawn',
  never: 'Not shared',
} as const;

export const HISTORY_SCORE = {
  hidden: 'Not shown',
  pending: 'Not released yet',
  withdrawn: 'Being reviewed',
  never: 'Not shared',
} as const;

export const HISTORY_EMPTY = {
  sentence: "You haven't finished any tests yet. Your results will be listed here.",
  action: 'See your tests',
} as const;

export const LEADERBOARDS_EMPTY = {
  sentence: 'No leaderboards are open yet. They open once results are released.',
  action: 'See your tests',
} as const;

export const LEADERBOARDS_OFF = "Leaderboards aren't available in your organization.";

export const RESULTS_EMPTY = {
  sentence: 'No published tests yet. Publish a test to see its results here.',
  action: 'Go to series',
} as const;

export const EXPORT_TEXTS = {
  preparing: 'Preparing your export',
  ready: 'Your export is ready.',
  linkNote: 'This link works for 15 minutes.',
  failed: 'The export failed. Try again.',
} as const;

export const STATUS_WORDS: Record<string, string> = {
  submitted: 'Submitted',
  auto_submitted: 'Submitted automatically',
  terminated: 'Ended after strikes',
  in_progress: 'In progress',
};

// ---------- extra students from the `more-students` scenario ----------

const two = (n: number) => String(n).padStart(2, '0');

/** Facts of registered student n of an org: the base seed's for 1 to 20, the `more-students` scenario's from 21. */
export function studentFacts(org: SeedOrg, n: number) {
  if (n <= 20) return seededStudent(org, n);
  const department = org.departments[(n - 1) % org.departments.length]!;
  const b = org.id !== 'org-a';
  return {
    id: `stu-${org.id}-${two(n)}`,
    email: `student${two(n)}@${b ? 'b' : 'a'}.test`,
    name: `Student ${two(n)}`,
    prn: `${b ? 'B' : ''}220101${two(n)}`,
    department,
    departmentId: departmentId(org, department),
    graduationYear: n % 2 === 1 ? 2026 : 2027,
  };
}

/** Display name of registered student n (base seed names for 1 to 20, `Student NN` from 21). */
export const studentName = (n: number) => (n <= 20 ? STUDENT_NAMES[n - 1]! : `Student ${two(n)}`);

// ---------- clock ----------

/** Stops the API's test clock at its current time (a set clock stays where it is set), and returns that time. */
export async function freezeClock(testApi: TestApi): Promise<number> {
  return testApi.clock.set(await testApi.clock.now());
}

/** Freezes the clock 1 second after the start of a 30-second leaderboard slot (LB-03), and returns that time. */
export async function freezeAtSlotStart(testApi: TestApi): Promise<number> {
  const now = await testApi.clock.now();
  return testApi.clock.set(Math.floor(now / 30_000) * 30_000 + 30_000 + 1_000);
}

/** 2 Nov 2026, 09:30 IST: the phase 3 fixed instant, so seeded November series cover the clock's date. */
export const NOV_2_0930_IST = 1793592000000;

// ---------- sitting a test through the real API ----------

/** Option ID of the option with this text in a served question. */
export function optionIdByText(payload: ExamPayload, questionIndex: number, text: string): string {
  const q = payload.questions[questionIndex];
  expect(q, `question ${questionIndex + 1} in the exam payload`).toBeTruthy();
  const opt = q!.options.find((o) => o.text === text);
  expect(opt, `option ${text} of question ${questionIndex + 1}`).toBeTruthy();
  return opt!.id;
}

/** Saves answers by question index (exam order) and option text, at the server clock's time. */
export async function answer(
  api: ApiClient,
  testApi: TestApi,
  payload: ExamPayload,
  picks: Record<number, string>,
): Promise<void> {
  const now = await testApi.clock.now();
  const answers = Object.entries(picks).map(([i, text], k) => ({
    questionId: payload.questions[Number(i)]!.id,
    optionId: optionIdByText(payload, Number(i), text),
    seq: 1,
    clientTs: now - 1 - k,
  }));
  const res = await putAnswers(api, payload.attempt.id, answers);
  expect(res.status, `PUT answers: ${JSON.stringify(res.body)}`).toBe(200);
  expect(res.body.saved.length, `answers saved: ${JSON.stringify(res.body)}`).toBe(answers.length);
}

/** Submits an attempt and fails unless the API accepts it. */
export async function submit(api: ApiClient, attemptId: string): Promise<void> {
  const res = await api.post(`/v1/attempts/${attemptId}/submit`, {}, idempotency());
  expect(res.status, `submit: ${JSON.stringify(res.body)}`).toBe(200);
}

/** Reports strike events 4 seconds apart (server clock) until the attempt has `count` strikes. */
export async function strike(api: ApiClient, testApi: TestApi, attemptId: string, count: number): Promise<string> {
  let status = 'in_progress';
  const types = ['fullscreen_exit', 'tab_hidden', 'window_blur', 'fullscreen_exit', 'tab_hidden'];
  for (let i = 0; i < count; i++) {
    if (i > 0) await testApi.clock.advance(4_000);
    const res = await postEvent(api, attemptId, types[i % types.length]!, await testApi.clock.now());
    expect(res.status, `event ${i + 1}: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.strikesCount, `strike ${i + 1} counted`).toBe(i + 1);
    status = res.body.status;
  }
  return status;
}

/** Starts the student's attempt; with `picks`, answers them. Returns the exam payload. */
export async function sit(
  api: ApiClient,
  testApi: TestApi,
  testId: string,
  picks: Record<number, string> = {},
): Promise<ExamPayload> {
  const payload = await startAttempt(api, testId);
  if (Object.keys(picks).length) await answer(api, testApi, payload, picks);
  return payload;
}

/** Starts, answers, waits `minutes` on the server clock, then submits. Returns the attempt ID. */
export async function sitAndSubmit(
  api: ApiClient,
  testApi: TestApi,
  testId: string,
  picks: Record<number, string>,
  minutes = 0,
): Promise<string> {
  const payload = await sit(api, testApi, testId, picks);
  if (minutes) await testApi.clock.advance(minutes * MIN);
  await submit(api, payload.attempt.id);
  return payload.attempt.id;
}

// ---------- results, release and leaderboards through the API ----------

export interface StudentResult {
  attemptId: string;
  testId: string;
  status: string;
  terminationReason?: string;
  strikesCount: number;
  maxStrikes: number;
  release: 'released' | 'pending' | 'withdrawn' | 'never';
  detail?: 'score' | 'sections' | 'full';
  score?: number;
  max?: number;
  pct?: number;
  durationSec?: number;
  rank?: { rank: number; total: number };
  sections?: Array<{
    sectionId: string | null;
    name: string;
    score: number;
    max: number;
    correct: number;
    incorrect: number;
    unanswered: number;
  }>;
  review?: Array<{
    questionId: string;
    sectionId: string | null;
    prompt: string;
    options: Array<{ id: string; text: string }>;
    chosenOptionId: string | null;
    correctOptionIds: string[];
    marks: number;
    explanation?: string;
  }>;
}

export async function getResult(api: ApiClient, attemptId: string): Promise<StudentResult> {
  const res = await api.get<StudentResult>(`/v1/student/results/${attemptId}`);
  expect(res.status, `GET result: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body;
}

/** Keys a result must not carry unless it is released. */
export const RELEASED_ONLY_KEYS = ['score', 'max', 'pct', 'durationSec', 'rank', 'sections', 'review'] as const;

export function releasedKeysIn(body: object): string[] {
  return RELEASED_ONLY_KEYS.filter((k) => k in body);
}

export async function releaseResults(admin: ApiClient, testId: string): Promise<ApiResponse> {
  return admin.post(`/v1/tests/${testId}/release`, {});
}

export async function withdrawResults(admin: ApiClient, testId: string): Promise<ApiResponse> {
  return admin.post(`/v1/tests/${testId}/withdraw-results`, {});
}

export async function expectReleased(admin: ApiClient, testId: string): Promise<void> {
  const res = await releaseResults(admin, testId);
  expect(res.status, `release: ${JSON.stringify(res.body)}`).toBe(200);
}

export interface BoardRow {
  rank: number;
  name: string;
  department: string;
  score: number;
  timeSec: number;
}

export interface Board {
  boardId: string;
  kind: 'test' | 'series';
  title: string;
  computedAt: number | null;
  total: number;
  max?: number;
  rows: BoardRow[];
  me: BoardRow | null;
}

export const testBoard = (testId: string) => `test_${testId}`;
export const seriesBoard = (seriesId: string) => `series_${seriesId}`;

export function getBoard(api: ApiClient, boardId: string): Promise<ApiResponse<Board>> {
  return api.get<Board>(`/v1/leaderboards/${boardId}`);
}

/** The stored leaderboard record, or null. */
export async function storedBoard(
  e: Emulators,
  orgId: string,
  boardId: string,
): Promise<{ computedAt: number; rows: Array<Record<string, unknown>> } | null> {
  const doc = await e.doc(`organizations/${orgId}/leaderboards/${boardId}`);
  return doc ? (doc.data as { computedAt: number; rows: Array<Record<string, unknown>> }) : null;
}

/**
 * Runs due tasks until the stored board satisfies `check` (the recompute may be queued behind another task), then
 * returns it. Waits on stored state, never on time.
 */
export async function boardSoon(
  e: Emulators,
  testApi: TestApi,
  orgId: string,
  boardId: string,
  check: (rows: Array<Record<string, unknown>>) => boolean,
  message: string,
): Promise<Array<Record<string, unknown>>> {
  let rows: Array<Record<string, unknown>> = [];
  await expect
    .poll(
      async () => {
        await testApi.tasks.runDue();
        const board = await storedBoard(e, orgId, boardId);
        rows = board?.rows ?? [];
        return board !== null && check(rows);
      },
      { message, timeout: 20_000 },
    )
    .toBe(true);
  return rows;
}

/** Runs the worker's leaderboard handler directly (open in test mode), as the queue would. */
export async function runLeaderboardTask(
  request: APIRequestContext,
  payload: { orgId: string; testId: string; seriesId: string },
): Promise<void> {
  const res = await request.post(`${WORKER_URL}/tasks/leaderboard`, { data: payload });
  expect(res.status(), `leaderboard task: ${await res.text()}`).toBe(200);
}

/** Stored test record fields of the release state. */
export async function releaseFields(
  e: Emulators,
  orgId: string,
  testId: string,
): Promise<{ resultsReleasedAt?: number | null; resultsWithdrawn?: boolean }> {
  const doc = await e.doc(`organizations/${orgId}/tests/${testId}`);
  expect(doc, `test ${testId}`).not.toBeNull();
  return doc!.data as { resultsReleasedAt?: number | null; resultsWithdrawn?: boolean };
}

/** Turns one feature off (or on) for an org through the platform API (FF-01, phase 1). */
export async function setFeature(superAdmin: ApiClient, orgId: string, feature: string, on: boolean): Promise<void> {
  const res = await superAdmin.put(`/v1/platform/orgs/${orgId}/entitlements`, {
    featureOverrides: { [feature]: on },
    limitOverrides: {},
  });
  expect(res.status, `entitlements: ${JSON.stringify(res.body)}`).toBe(200);
}

export { errorCode };

// ---------- exports ----------

export interface ExportInfo {
  id: string;
  scope: 'test' | 'series';
  refId: string;
  format: 'csv' | 'xlsx';
  status: string;
  url?: string;
  expiresAt?: number;
  filename?: string;
}

export function postExport(
  admin: ApiClient,
  body: { scope: 'test' | 'series'; refId: string; format: 'csv' | 'xlsx' },
  key?: string,
): Promise<ApiResponse<{ id: string; status: string }>> {
  return admin.post<{ id: string; status: string }>('/v1/exports', body, idempotency(key));
}

/** Waits (running due tasks) until the export is ready, and returns it with its signed link. */
export async function exportReady(admin: ApiClient, testApi: TestApi, exportId: string): Promise<ExportInfo> {
  let last: ExportInfo | null = null;
  await expect
    .poll(
      async () => {
        await testApi.tasks.runDue();
        const res = await admin.get<ExportInfo>(`/v1/exports/${exportId}`);
        expect(res.status, `GET export: ${JSON.stringify(res.body)}`).toBe(200);
        last = res.body;
        expect(last.status, 'export did not fail').not.toBe('failed');
        return last.status;
      },
      { message: `export ${exportId} ready`, timeout: 30_000 },
    )
    .toBe('ready');
  return last!;
}

/** Requests an export through the API and waits until it is ready. */
export async function exportThroughApi(
  admin: ApiClient,
  testApi: TestApi,
  body: { scope: 'test' | 'series'; refId: string; format: 'csv' | 'xlsx' },
): Promise<ExportInfo> {
  const res = await postExport(admin, body);
  expect([200, 201, 202], `POST /v1/exports: ${JSON.stringify(res.body)}`).toContain(res.status);
  expect(typeof res.body.id).toBe('string');
  return exportReady(admin, testApi, res.body.id);
}

export interface Downloaded {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** Fetches a signed link with no credentials. */
export async function fetchSigned(request: APIRequestContext, url: string): Promise<Downloaded> {
  const res = await request.get(url, { failOnStatusCode: false, maxRedirects: 0 });
  return { status: res.status(), headers: res.headers(), body: await res.body() };
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** True when the buffer starts with the UTF-8 byte order mark. */
export const hasBom = (b: Buffer) => b.subarray(0, 3).equals(BOM);

/** Parses an RFC 4180 CSV buffer (BOM dropped) into rows of strings. */
export function readCsv(b: Buffer): string[][] {
  const text = (hasBom(b) ? b.subarray(3) : b).toString('utf8');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    any = true;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      any = false;
    } else cell += ch;
  }
  if (any) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export type Cell = string | number | boolean | null;

/** Every sheet of an XLSX buffer, in workbook order, as rows of plain cell values (empty cells as null). */
export async function readXlsx(b: Buffer): Promise<Array<{ name: string; rows: Cell[][] }>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(b as unknown as ArrayBuffer);
  const out: Array<{ name: string; rows: Cell[][] }> = [];
  wb.eachSheet((ws) => {
    const width = ws.getRow(1).cellCount;
    const rows: Cell[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row: Cell[] = [];
      for (let c = 1; c <= width; c++) {
        const v = ws.getCell(r, c).value as unknown;
        if (v === null || v === undefined || v === '') row.push(null);
        else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') row.push(v);
        else if (typeof v === 'object' && v !== null && 'richText' in v)
          row.push((v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join(''));
        else if (typeof v === 'object' && v !== null && 'result' in v) row.push((v as { result: Cell }).result);
        else row.push(String(v));
      }
      if (row.some((x) => x !== null)) rows.push(row);
    }
    out.push({ name: ws.name, rows });
  });
  return out;
}

/** Exported times: `yyyy-MM-dd HH:mm:ss` in IST. */
export function istDateTime(ms: number): string {
  const d = new Date(ms + 330 * MIN);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(
    d.getUTCMinutes(),
  )}:${two(d.getUTCSeconds())}`;
}

/** A number as written in an export file: no grouping, `.` decimal point. */
export const fileNumber = (n: number) => String(n);
/** Percentage as written in an export file: rounded to two decimals. */
export const filePct = (pct: number) => String(Math.round(pct * 100) / 100);

/** EXP-01 test export header row, with one `<section> score` column per section. */
export function testExportHeaders(sections: readonly string[] = []): string[] {
  return [
    'Name',
    'Email',
    'PRN',
    'Department',
    'Graduation year',
    'Status',
    'Score',
    'Maximum',
    'Percentage',
    'Rank',
    ...sections.map((s) => `${s} score`),
    'Correct',
    'Incorrect',
    'Unanswered',
    'Started at (IST)',
    'Submitted at (IST)',
    'Time taken (seconds)',
    'Strikes',
    'Termination reason',
    'Extra time (minutes)',
  ];
}

/** EXP-02 series export header row. */
export const seriesExportHeaders = (testHeadings: readonly string[]) => [
  'Name',
  'Email',
  'PRN',
  'Department',
  'Graduation year',
  ...testHeadings,
  'Total',
  'Rank',
];

export const TERMINATION_TEXT = 'Maximum strikes reached';

/**
 * The expected test-export row for a stored attempt, as strings (CSV). `rank` is '' when unranked; `sectionIds` in
 * section order.
 */
export function expectedTestRow(
  student: ReturnType<typeof studentFacts>,
  attempt: Record<string, unknown>,
  rank: string,
  sectionIds: readonly string[] = [],
): string[] {
  const result = attempt.result as {
    score: number;
    max: number;
    pct: number;
    correct: number;
    incorrect: number;
    unanswered: number;
    durationSec: number;
    sections: Record<string, { score: number }>;
  };
  return [
    student.name,
    student.email,
    student.prn,
    student.department,
    String(student.graduationYear),
    STATUS_WORDS[String(attempt.status)]!,
    fileNumber(result.score),
    fileNumber(result.max),
    filePct(result.pct),
    rank,
    ...sectionIds.map((id) => fileNumber(result.sections[id]!.score)),
    fileNumber(result.correct),
    fileNumber(result.incorrect),
    fileNumber(result.unanswered),
    istDateTime(Number(attempt.startedAt)),
    istDateTime(Number(attempt.submittedAt)),
    fileNumber(result.durationSec),
    fileNumber(Number(attempt.strikesCount ?? 0)),
    attempt.status === 'terminated' ? TERMINATION_TEXT : '',
    fileNumber(Number(attempt.extraTimeSec ?? 0) / 60),
  ];
}

/** Stored export records of an org. */
export function storedExports(e: Emulators, orgId: string): Promise<StoredDoc[]> {
  return e.list(`organizations/${orgId}`, 'exports');
}

/** True when the response is an API-01 error with this status (and code). */
export function isApiError(res: ApiResponse<unknown>, status: number, code?: string): boolean {
  return res.status === status && (code === undefined || errorCode(res) === code);
}
