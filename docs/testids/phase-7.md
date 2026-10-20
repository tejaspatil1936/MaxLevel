# Phase 7 test contract: analytics reports

The phase 7 acceptance tests (tests/acceptance/phase-7/) find elements through the page objects in
tests/acceptance/pages/, by role and accessible name, and read what the system stored through the API, the emulators'
REST endpoints and the files it produced. The implementation must expose exactly these names and shapes. The phase 0
to 6 contracts (docs/testids/phase-0.md to phase-6.md) stay valid, with every convention listed there: exact names,
`(required)` labels, field errors (visible text, `aria-invalid="true"`, the error in the field's accessible
description), en-IN numbers with at most two decimals (phase 4), `d MMM yyyy` dates, 24-hour `HH:mm` times in the
organization's timezone named `IST` for `Asia/Kolkata`, a notice after an action as a `status` whose whole text is the
notice, the phase 1 shell rules, empty states (test ID `empty-state`, one sentence and one action), the FF-03 lock text
`Not included in your organization's plan`. Phase 7 only adds to them.

Further conventions for phase 7:

- **Test clock.** Every phase 7 test sets the API's clock to **20 Oct 2026, 06:00 UTC** (11:30 IST,
  `POST /__test/clock { nowMs: 1792476000000 }`) first, as in phases 2 and 6, and keeps it there (it only moves when a
  test moves it). Usage is counted in the month of the clock in the organization's timezone: `2026-10`. Tests on a
  two-day series move it to **2 Nov 2026, 09:30 IST** first (phase 4's instant, inside the `Placement 2026` dates of
  the `authoring-series` scenario), so their tests are `Day 1` on 1 Nov and `Day 2` on 2 Nov and their month is
  `2026-11`.
- **`analytics_reports` is off by default** (spec 2.4). Tests that generate reports first turn it on for the
  organization through `PUT /v1/platform/orgs/{orgId}/entitlements` as the super admin (phase 1).
- **The model is always the AI SDK mock** (DECISIONS Q30, `LLM_PROVIDER=mock`). What it answers to a report is set by
  each test through `POST /__test/llm` (below). A real-provider smoke test runs only when provider credentials are
  present (below, "Unit and integration tests").
- **Data for the reports** comes from the phase 3 and 4 scenarios (`exam-test`, `graded-attempts`) and from attempts sat
  through the real API (phase 4 helpers). No new scenario is needed.
- **Updates without reload.** The Reports page shows each status change of a report within 5 seconds without a reload
  (polling `GET /v1/reports` at most every 2 seconds while any listed report is `queued`, `running` or `retrying` is
  enough).
- Generated PDFs are read in the tests with pdf.js (text and document information); XLSX files with ExcelJS. Nothing
  generated is written under tests/acceptance/.

## Feature F-7.01 (EXP-04): no acceptance file

EXP-04 is verified by unit tests (below). Its numbers are also checked end to end, through the metrics a report holds
and the text of its PDF, by the F-7.02 and F-7.03 acceptance tests.

## Metrics (EXP-04)

All numbers are computed by code in `packages/shared` (spec 9.5); the model only writes the narrative. A report holds
one `ReportMetrics` record. Every non-integer number in it is rounded to 2 decimal places. It holds no student name,
email, PRN or student ID: only counts, scores, rates and labels (department names, test headings, option texts).

```ts
interface ReportMetrics {
  version: 1;
  scope: 'test' | 'series';
  title: string;                // test: its heading (`Day 1: Quantitative aptitude`); series: its title
  maxScore: number;             // test: totalMarks; series: the sum of totalMarks of its published tests
  participation: {
    eligible: number;           // students matching the test's (series: the series') eligibility, status active
    finished: number;           // test: finished attempts; series: students with at least one finished attempt
    inProgress: number;         // test only (0 for a series)
    notStarted: number;         // eligible − finished − inProgress, never below 0
    ratePct: number;            // finished / eligible × 100 (0 when eligible is 0)
  };
  statuses: { submitted: number; autoSubmitted: number; terminated: number };   // finished attempts by status
  scores: {                     // test: each finished attempt's score; series: each finished student's total
    mean: number; median: number; top: number; bottom: number;
    stdDev: number;             // population standard deviation
    meanPct: number;            // mean / maxScore × 100
    distribution: Array<{ fromPct: number; toPct: number; count: number }>;   // 10 bands 0–10, …, 90–100
  };
  sections: Array<{ sectionId: string; name: string; max: number; mean: number; meanPct: number }>;  // test only
  departments: Array<{ departmentId: string; name: string; finished: number; mean: number; meanPct: number }>;
  questions: Array<{            // test only, in test order
    number: number; questionId: string; sectionName: string | null;
    served: number; answered: number; correct: number;
    correctRatePct: number;     // correct / served × 100
    discriminationIndex: number | null;
    wrongPicks: Array<{ letter: string; text: string; count: number }>;   // wrong options picked at least once
  }>;
  mostMissed: Array<{ number: number; correctRatePct: number }>;                      // test only, up to 5
  mostPickedWrong: Array<{ number: number; letter: string; text: string; count: number }>;   // test only, up to 5
  strikes: { total: number; attemptsWithStrikes: number; terminated: number };
  timeTaken: {                  // over finished attempts, durationSec
    meanSec: number; medianSec: number; minSec: number; maxSec: number;
    distribution: Array<{ fromMin: number; toMin: number; count: number }>;   // 5-minute bands from 0
  };
  trends: Array<{               // series only, one per published test with a finished attempt
    testId: string; heading: string; date: string;   // date: scheduledDate, `yyyy-mm-dd`
    finished: number; mean: number; median: number;
    max: number;                // that test's maximum score (its totalMarks)
    meanPct: number;            // mean / max × 100
  }>;
  discriminationGroupPct: 27;
}
```

Rules:

- **Finished** attempts are `submitted`, `auto_submitted` and `terminated` ones (terminated attempts are graded, spec
  15.3, and counted here, unlike on leaderboards). `reset` attempts and attempts still in progress are left out.
- **Median** of an even count is the mean of the two middle values.
- **Score distribution**: band k (0 to 9) holds percentages from 10k (inclusive) to 10k + 10 (exclusive); the last band
  also holds 100.
- **Departments**: only departments with at least one finished attempt (series: finished student), in the
  organization's department order; `name` is the department's name.
- **Sections**: one entry per section of the test in section order; empty for an unsectioned test and for a series.
- **Questions** come from the attempts' stored draws and answer records: `served` counts finished attempts whose draw
  holds the question, `answered` those with a non-null answer, `correct` those whose answer is the correct option.
  `letter` is the option's letter in the question as authored (A for its first option).
- **Discrimination index** (top 27% against bottom 27%): sort the finished attempts that were served the question by
  score descending, ties by student ID ascending; k = ceil(0.27 × n); index = (correct in the first k − correct in the
  last k) / k. `null` when n < 2.
- **Most-missed questions**: lowest `correctRatePct` first, ties by question number; at most 5.
- **Most-picked wrong options**: highest count first, then question number, then letter; at most 5.
- **Series**: a student's total is the sum of their finished attempts' scores over the series' published tests (a test
  not taken counts 0, as LB-02). `questions`, `mostMissed`, `mostPickedWrong` and `sections` are empty; `trends` lists
  the tests in schedule order (scheduled date, then window start, then heading). A test report's `trends` is empty.

## Summary and the number check (EXP-05)

- The worker sends the model exactly two messages: a **system** message with the fixed instructions
  (`SUMMARY_INSTRUCTIONS`: write a short summary and 2 to 5 recommendations for the placement cell, use only numbers
  that appear in the metrics, never name or guess at individual students), and a **user** message that is exactly
  `JSON.stringify(metrics)` of the report's stored metrics, nothing else.
- The model answers `{ summary: string, recommendations: string[] }` (`ReportSummarySchema` in packages/shared:
  `summary` 1 to 2,000 characters, 1 to 6 recommendations of 1 to 500 characters each). An answer that fails the schema
  is a model failure (below).
- **Number check** (`unsupportedNumbers(text, metrics)`): every number written with digits in the summary or a
  recommendation (`5`, `2.33`, `1,234.5`, `20%`, the 4 of `Q4`; commas are grouping, a `%` sign is ignored) must equal a supported
  value, or that value rounded to 0, 1 or 2 decimals. Supported values are every number in the metrics and every number
  written with digits inside a metrics string (an option text such as `24 m/s`, a heading such as `Day 1: …`, a date),
  except inside ID fields (keys ending in `Id`).
- A rejected answer is not used. The worker asks again with the same user message, the system message ending with one
  more line that names the unsupported numbers. At most **3 calls** per report: the first accepted answer becomes the
  summary (`summaryStatus: "accepted"`). When all 3 are rejected the report is still made, with the statistics and
  without any summary or recommendations (`summary: null`, `recommendations: []`, `summaryStatus: "rejected"`).
- A **model failure** (provider error, timeout, an answer that fails the schema) follows the phase 6 retry schedule
  (REL-06): status `retrying`, `error { code: "LLM_UNAVAILABLE", message: "The AI service didn't answer.",
  retryable: true }`, `retryAt` = now + 60 000 × 2^(k−1) ms for the k-th failure in a row, the task queued again for
  `retryAt`; the fourth failure in a row sets `failed` with `message: "The AI service didn't answer after 4 tries."`.
  Rejected answers are not failures and never wait.

## Report files (EXP-06)

- The worker renders a React template to HTML and prints it to PDF with **headless Chromium** (A4). The PDF is stored
  at exactly `organizations/{orgId}/reports/{reportId}/report.pdf` (`application/pdf`) and is not post-processed: its
  document information keeps Chromium's `Producer` (starts with `Skia/PDF`), and its `Title` is exactly
  `Analytics report: <metrics.title>` (the HTML `<title>`).
- With `includeXlsx: true`, an XLSX of the raw metrics is stored at exactly
  `organizations/{orgId}/reports/{reportId}/metrics.xlsx`.
- Downloads use signed links valid for 15 minutes (900 000 ms on the server clock, as EXP-03), served with
  `Content-Disposition: attachment` and the file names exactly `report-<reportId>.pdf` and
  `report-<reportId>-metrics.xlsx`.

**PDF text.** The tests compare text ignoring all whitespace (so line breaks and spacing between runs never matter).
The PDF holds, as text:

| Part | Text (exact, numbers as on screens: en-IN, at most two decimals) |
| --- | --- |
| Title | `Analytics report`, then `<metrics.title>` |
| Organization and time | the organization's name; `Generated <d MMM yyyy>, <HH:mm> IST` (when the report was requested) |
| Summary | heading `Summary`; the line `Written by AI from the statistics in this report.`; the summary text exactly as accepted |
| Recommendations | heading `Recommendations`; each recommendation exactly, in order |
| Summary left out | instead of the two parts above when `summaryStatus` is `rejected`: heading `Summary` and exactly `The written summary was left out because it used numbers that are not in these statistics.` |
| Key figures | heading `Key figures`; test: `Students who finished: <finished> of <eligible>`, `Mean score: <mean> / <max>`, `Median score: <median> / <max>`, `Top score: <top> / <max>`, `Bottom score: <bottom> / <max>`; series: the same with `Mean total`, `Median total`, `Top total`, `Bottom total` |
| Trends | series only: heading `Trends across days`; per test in order `<heading>: <finished> students, mean <mean> / <max>` (`1 student`) |
| Score distribution | heading `Score distribution` |
| Sections | heading `Sections` and `<name>: mean <mean> / <max>` per section, sectioned tests only |
| Departments | heading `Departments`; per department `<name>: <finished> students, mean <mean> / <max>` (`1 student`) |
| Questions | test only: heading `Questions` (a table of every question: number, correct rate, discrimination index) |
| Most-missed questions | test only: heading `Most-missed questions`; per item `Question <n>: <rate>% correct` |
| Most-picked wrong options | test only: heading `Most-picked wrong options`; per item `Question <n>: <letter>. <text>, picked <count> times` (`1 time`) |
| Strikes | heading `Strikes`; `Attempts with strikes: <attemptsWithStrikes> of <finished attempts>`, `Total strikes: <total>`, `Ended after strikes: <terminated>` |
| Time taken | heading `Time taken`; `Median time taken: <phase 4 time format>` (`10 minutes`, `1 minute`, `45 seconds`) |

The PDF never holds a student's name, email or PRN. It has no running header or footer (no page numbers, dates, URLs or titles repeated by the browser or the template on each page: Chromium's `displayHeaderFooter` stays off), so page text is only the content above, and a paragraph split across a page break reads on without inserted text.

**XLSX sheets**, in this order (numbers as numeric cells; first row is the header):

| Sheet | Columns | Rows |
| --- | --- | --- |
| `Overview` | `Metric`, `Value` | exactly, in order: `Students eligible`, `Students who finished`, `Participation (%)`, `Maximum score`, `Mean score`, `Median score`, `Top score`, `Bottom score`, `Standard deviation`, `Attempts with strikes`, `Total strikes`, `Median time taken (minutes)` (seconds / 60, 2 decimals) |
| `Questions` | `Question`, `Served`, `Answered`, `Correct`, `Correct rate (%)`, `Discrimination index`, `Most-picked wrong option`, `Times picked` | test reports only; one row per question in order; the wrong option as `<letter>. <text>`, empty cells when none was picked (and an empty index when `null`) |
| `Departments` | `Department`, `Students who finished`, `Mean score`, `Mean (%)` | as `departments` |
| `Trends` | `Test`, `Date`, `Students who finished`, `Mean score`, `Median score`, `Maximum score`, `Mean (%)` | series reports only; as `trends`, the date as `d MMM yyyy` text |

For a series, `Overview`'s score rows hold totals.

## Requests the tests send directly

As in phases 1 to 6, with real ID tokens; super admins add `X-Org-Id`. Error bodies follow API-01. Every route below
answers `403` to a student token (role check before body validation), `403 FEATURE_DISABLED` while
`analytics_reports` is off for the organization (FF-02: every report route, so past reports are not served either
while it is off), `404` (never `403`) for a report, test or series of another organization (ORG-05), and the same
success for a super admin with `X-Org-Id` of the organization that holds it (ORG-11, ORG-14). The feature check comes
after the role check and before the body and resource checks.

| Request | Body | Expected |
| --- | --- | --- |
| `POST /v1/reports` | `{ scope: "test" \| "series", refId, includeXlsx?: boolean }` with `Idempotency-Key` | `202` `{ id, status: "queued" }`; in one transaction stores the report (below), increments `organizations/{orgId}/usage/{yyyy-mm}.aiReports` and writes `report.create`; queues the task (below). Refusals, in this order, store and count nothing: `400 IDEMPOTENCY_KEY_REQUIRED`; `400 VALIDATION`; `404` for a test or series that is unknown, of another organization, or not published; `409 NO_FINISHED_ATTEMPTS` when the test (series) has no finished attempt; `409 LIMIT_REACHED` with `details: { limit: "ai_reports_per_month", max }` when the month's `aiReports` has reached `ai_reports_per_month`. A repeated key replays the first response (same `id`) and counts nothing again (API-02) |
| `GET /v1/reports/{id}` | | `200` the report view (below); `404` for another organization's or an unknown ID |
| `GET /v1/reports` | `?cursor=&limit=` (API-05, at most 200) | `200` `{ items: ReportView[], nextCursor: string \| null }`, newest first (`createdAt`, then ID), each item as the report view without `metrics`, `summary` and `recommendations` |

**Report view**: `{ id, scope, refId, title, status, includeXlsx, createdAt, createdBy: { uid, name }, error?,
retryAt?, metrics?, summary?, recommendations?, summaryStatus?, provider?, model?, pdf?, xlsx? }`. `title` is the test
heading or series title from the moment of the request; `createdBy.name` is the requester's admin name, or their email
for a super admin. Once `ready`: `metrics`, `summary` (string or `null`), `recommendations`, `summaryStatus`,
`provider` (`mock` in tests), `model` (`mock-model`), and `pdf` (and `xlsx` when included) as
`{ url, expiresAt, filename }`, a fresh signed link on every request with `expiresAt` = now + 900 000.

**Statuses**: `queued` → `running` → `ready`, with `retrying` and `failed` (model failures only) as above.

**Report record** `organizations/{orgId}/reports/{reportId}` (spec 10.1, extended): `orgId`, `scope`, `refId`, `title`,
`status`, `includeXlsx`, `metrics`, `summary`, `recommendations`, `summaryStatus`, `summaryCalls` (model calls made),
`error`, `retryAt`, `provider`, `model`, `tokens { input, output }`, `pdfPath`, `xlsxPath` (when included), `createdBy`
(uid), `createdAt`, `finishedAt`.

**Task**: path `/tasks/report`, payload `{ orgId, reportId }`, name containing the report ID (`report-<reportId>`;
retries use names that also contain it). The worker computes the metrics from stored data at run time, asks for the
summary, renders and stores the files, then sets `ready`. It answers `200` to the queue in every handled case and
tolerates a task delivered twice (REL-04).

**Counting (EXP-07, FF-04)**: one per accepted `POST /v1/reports`, atomically with the report record, in the month of
the clock in the organization's timezone; never again for a replayed key, a retry, a re-asked summary or a rejected
summary; never given back. A super admin's report counts against the organization it was made in (ORG-13).

## Test-only routes (additions)

Registered under the same conditions as the other `/__test/*` routes, each with `X-Test-Secret`.
`POST /__test/reset` and `POST /__test/llm` clear the report script and the report call log too.

`LlmScript` (phase 6) gains one optional key:

```ts
interface LlmScript {
  // … phase 6 keys (pages, usage, failures, hold) unchanged
  report?: {
    answers: Array<{ summary: string; recommendations: string[] }>;   // in call order; the last repeats once used up
    failures?: number;          // the next n report calls fail with a provider error (HTTP 503)
  };
}
```

Without `report`, a report call answers `{ summary: "Summary.", recommendations: ["Recommendation."] }`.

| Route | Body | Effect |
| --- | --- | --- |
| `GET /__test/llm/report-calls` | | `200` `{ calls: [{ system: string, prompt: string }] }`: every report call (failed ones too) since the script was last set, in order, with its system message and its user message text |

## Audit actions

| Action | Target | Notes |
| --- | --- | --- |
| `report.create` | `{ type: "report", id: reportId }` | `after.scope`, `after.refId`, `after.includeXlsx` |

## Admin screen: `/admin/reports/` (US-AD-15, EXP-06, EXP-07, FF-03)

Opened from the sidebar link `Reports` (phase 1). Meets the phase 1 shell rules and has no serious axe violation. A
student who opens it lands on `/student/` (WEB-03).

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Reports` |
| Primary action | `button` | exactly `Generate report`, top-right in the page header; opens the dialog below |
| Usage | text | exactly `Reports used this month: <used> of <limit>` (en-IN numbers), from the organization's usage and effective limit |
| Locked | | while `analytics_reports` is off: `Generate report` is disabled (`disabled` or `aria-disabled="true"`) with accessible description exactly `Not included in your organization's plan`, that text is visible on the page, and there is no usage text, no `Reports` table and no empty state |
| List | `table` | exactly `Reports`; columns exactly `Report`, `Type`, `Requested`, `Requested by`, `Status`, `Files`; one row per report, newest first (every page of `GET /v1/reports`) |
| Row cells | | `Report` the title; `Type` exactly `Test` or `Series`; `Requested` `20 Oct 2026, 11:45 IST`; `Requested by` the view's `createdBy.name`; `Status` exactly `Generating` (`queued`, `running`), `Waiting to retry`, `Ready` or `Failed`; `Files` (ready only) `link`s exactly `Download PDF` and, when included, `Download XLSX`, whose `href` is the signed link |
| Empty | test ID `empty-state` | with the feature on and no report: exactly `No reports yet. Generate a report once a test has finished attempts.` and one action, a `button` exactly `Generate report` that opens the dialog |

**Generate dialog** (`dialog` exactly `Generate report`):

| What | Role | Name or text |
| --- | --- | --- |
| Kind | `radiogroup` | exactly `Report on`, with `radio`s exactly `A test` (checked at first) and `A series` |
| Test | native select | exactly `Test (required)`, shown while `A test` is checked; a first empty option, then every published test of the organization, labelled exactly `<test heading>, <series title>` (`Day 1: Quantitative aptitude, Placement 2026`), newest scheduled date first |
| Series | native select | exactly `Series (required)`, shown while `A series` is checked; a first empty option, then every series by title |
| XLSX | `checkbox` | exactly `Include an Excel file of the statistics`, unchecked at first |
| Cost | text | exactly `Each report uses 1 of your organization's <limit> analytics reports this month.` |
| Buttons | `button`s | exactly `Cancel` and `Generate report` |

Errors (the dialog stays open, nothing is created): nothing chosen, on the select: `Choose a test.` or
`Choose a series.`; `409 NO_FINISHED_ATTEMPTS`, on the select: `This test has no finished attempts yet, so there is
nothing to report.` or `This series has no finished attempts yet, so there is nothing to report.`;
`409 LIMIT_REACHED`: an `alert` in the dialog exactly `This month's analytics report limit (<max>) is used up.`

On success the dialog closes, a `status` exactly `Generating report` appears, the new report is the table's first row
(status `Generating`, then `Ready` once the worker is done) and the usage text counts it.

## Unit and integration tests the build must add

These are verified below the browser. The builder writes them beside the code (Vitest; integration tests on the
emulators with the mock model), each test title starting with its REQ IDs. Functions are exported from
`packages/shared` (`@mitaoe/shared`) with these exact names:

```ts
// report-metrics.ts
export const DISCRIMINATION_GROUP_PCT = 27;
export interface MetricsAttempt {
  studentId: string; departmentId: string | null; status: 'submitted' | 'auto_submitted' | 'terminated';
  score: number; durationSec: number; strikesCount: number;
  sections: Record<string, { score: number }>;
  answers: Record<string, string | null>;       // questionId → chosen option ID; only questions of the draw
  drawQuestionIds: string[];
}
export function median(values: ReadonlyArray<number>): number;
export function discriminationIndex(rows: ReadonlyArray<{ studentId: string; score: number; correct: boolean }>): number | null;
export function computeTestMetrics(input: {
  title: string; maxScore: number; eligible: number; inProgress: number;
  questions: ReadonlyArray<{ id: string; sectionId: string | null; options: ReadonlyArray<{ id: string; text: string }>; correctOptionIds: ReadonlyArray<string> }>;
  sections: ReadonlyArray<{ id: string; name: string; max: number }>;
  departments: ReadonlyArray<{ id: string; name: string }>;   // in the organization's order
  attempts: ReadonlyArray<MetricsAttempt>;                     // finished attempts only
}): ReportMetrics;
export function computeSeriesMetrics(input: {
  title: string; eligible: number;
  departments: ReadonlyArray<{ id: string; name: string }>;
  tests: ReadonlyArray<{ id: string; heading: string; scheduledDate: string; windowStart: number; maxScore: number;
                         attempts: ReadonlyArray<MetricsAttempt> }>;
}): ReportMetrics;

// report-summary.ts
export const SUMMARY_INSTRUCTIONS: string;
export const ReportSummarySchema: ZodType<{ summary: string; recommendations: string[] }>;
export function summaryMessages(metrics: ReportMetrics, rejected?: ReadonlyArray<string>): { system: string; prompt: string };
export function numbersIn(text: string): number[];
export function supportedNumbers(metrics: ReportMetrics): number[];
export function unsupportedNumbers(text: string, metrics: ReportMetrics): string[];   // as written, in order
export const SUMMARY_MAX_CALLS = 3;
```

| REQ | Kind | Behaviours the tests must show |
| --- | --- | --- |
| EXP-04 | unit | `computeTestMetrics` on a hand-made set of attempts gives every field of `ReportMetrics`: participation and statuses; distribution bands (0, 9.99, 10, 99.99 and 100 per cent at the edges); mean, median (odd and even counts), top, bottom and population standard deviation, rounded to 2 decimals; section averages per section; department comparison in the organization's order, departments without attempts left out; per-question served, answered, correct and rate with pools (a question served to only some attempts); `discriminationIndex` with k = ceil(0.27 n), ties by student ID, `null` below 2; most-missed and most-picked wrong options with their tie rules and the limit of 5; strike statistics including terminated attempts; time-taken mean, median, extremes and 5-minute bands; reset and in-progress attempts left out; no student ID, name or email anywhere in the output. `computeSeriesMetrics`: totals with a test not taken counting 0, students with no finished attempt left out, `trends` in schedule order with each test's figures, per-question parts empty |
| EXP-05 | unit | `summaryMessages`: `prompt` is exactly `JSON.stringify(metrics)`; `system` is the same for any metrics and, given rejected numbers, ends with a line naming them; `numbersIn` reads integers, decimals, en-IN and international grouping (`1,234.5`, `1,00,000`), percentages and negative numbers, and also digits joined to letters (`Q4`, `4th` read as 4); `unsupportedNumbers` accepts every metric value and its roundings to 0, 1 and 2 decimals and numbers written inside metric strings, and rejects a number not in the metrics, a date or year not in them, and digits that appear only inside an ID field; `ReportSummarySchema` limits |
| EXP-05 | integration | through the worker with the mock: an accepted first answer is used; a rejected answer is re-asked up to 3 calls in all; three rejections give `summaryStatus: "rejected"` with no summary; the user message of every call is the stored metrics exactly; a provider error follows the retry schedule; the real-provider smoke test (Q30) sends a sample metrics JSON to the configured provider when its credentials are present and checks the answer against `ReportSummarySchema`, and is skipped with a reason otherwise |
| EXP-06 | integration | the worker renders the PDF with headless Chromium (document information `Producer` starting `Skia/PDF`), stores it and the optional XLSX at their paths, the XLSX sheets and headers as above; signed links expire after 15 minutes on the server clock; `GET /v1/reports` pages with `cursor` and `limit`, newest first, and keeps every past report |
| EXP-07 | integration | the counter rises once per accepted request, atomically: two requests at `limit − 1` started together leave exactly one `LIMIT_REACHED`; a replayed key, a retry and a re-asked summary never count; a new month starts from 0 in the organization's timezone |

Also: `POST /v1/reports`, `GET /v1/reports` and `GET /v1/reports/{id}` are in the phase 0 route-table tests (ORG-05 404
for org B, ORG-14 with an admin token and with a super-admin token plus `X-Org-Id`, `403` for student and device tokens,
`403 FEATURE_DISABLED` while the feature is off).

## Checked outside the automated suites

Proposed rows for docs/MANUAL_CHECKS.md (the owner adds them; tests cannot judge these on the emulators):

| REQ | Why not end to end here | Check |
| --- | --- | --- |
| EXP-05 (phase 7 gate) | the real model's wording and whether it keeps to the metrics' numbers can only be seen with a provider key (Gemini on Vertex AI, OWNER_SETUP); the mock only replays scripted answers | on staging, a report for a completed series has a summary and recommendations with no unsupported number, and they read correctly against the statistics |
| EXP-06 | the PDF's layout, fonts and page breaks in the Cloud Run worker image (installed fonts, Chromium build) need a person to look at them | on staging, a test report and a series report open in a PDF reader, every section readable, tables not cut across pages, Atkinson Hyperlegible used |

## Test IDs

| Test ID | Where | Why not a role |
| --- | --- | --- |
| `empty-state` | Reports page with no report (phase 1 convention) | one sentence and one action, no distinct role |
