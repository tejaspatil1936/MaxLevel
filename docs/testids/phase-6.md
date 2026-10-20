# Phase 6 test contract: AI import

The phase 6 acceptance tests (tests/acceptance/phase-6/) find elements through the page objects in
tests/acceptance/pages/, by role and accessible name. The implementation must expose exactly these names. The phase 0
to 5 contracts (docs/testids/phase-0.md to phase-5.md) stay valid, with every convention listed there: exact names,
`(required)` labels, field errors (visible text, `aria-invalid="true"`, the error in the field's accessible
description), confirmation `alertdialog`s with focus starting on `Cancel`, en-IN numbers, `d MMM yyyy` dates, 24-hour
`HH:mm` times in the organization's timezone named `IST` for `Asia/Kolkata`, a notice after an action as a `status`
whose whole text is the notice, the phase 1 shell rules, the phase 2 not-found convention and question rendering (the
student view: Markdown, KaTeX MathML, code blocks, images named by their alt text). Phase 6 only adds to them.

Further conventions for phase 6:

- **Test clock.** Every phase 6 test sets the API's clock to **20 Oct 2026, 06:00 UTC** (11:30 IST,
  `POST /__test/clock { nowMs: 1792476000000 }`) first, as in phase 2. The month for usage counting is therefore
  `2026-10`.
- **The model is always the AI SDK mock** (DECISIONS Q30): `LLM_PROVIDER=mock`. What it answers is set by each test
  through the test-only route `/__test/llm` (below), from recorded fixtures in `tests/fixtures/llm/`. A real-provider
  smoke test runs only when a provider key is present (below, "Unit and integration tests").
- **Source files are kept** with their job, never deleted automatically (DECISIONS Q31).
- **Updates without reload.** The review page shows each change of the job (progress, retry, ready, failed) within
  5 seconds without a reload (polling `GET /v1/imports/{id}` at most every 2 seconds while the job is not finished is
  enough).
- Sample upload files are built at test time by `tests/acceptance/fixtures/import-files.ts` (a small PDF writer,
  ExcelJS for XLSX, plain text for the rest); the recorded model answers live in `tests/fixtures/llm/*.json`.

## Formats and limits (IMP-01, IMP-02, SEC-06)

The format comes from the file name's extension, ignoring case:

| Extension | Format | How the worker reads it | Counts as an AI import |
| --- | --- | --- | --- |
| `.json` | `json` | `parseQuestionJson` (phase 2 formats: legacy and `mitaoe-questions/1`) | no |
| `.xlsx` | `xlsx` | first worksheet; a template sheet (below) is read directly, any other sheet goes to the model | only when not a template |
| `.csv` | `csv` | UTF-8, RFC 4180; template or model as for XLSX | only when not a template |
| `.pdf` | `pdf` | each page goes to the model as a page (IMP-03) | yes |
| `.txt` | `txt` | the text goes to the model | yes |
| `.md` | `md` | the text goes to the model | yes |

Any other extension (`.docx`, `.png`, none) is refused. Limits:

| Limit | Value | Checked by | Error code | Message (exact; also the UI text) |
| --- | --- | --- | --- | --- |
| File size | 25 MB = 26,214,400 bytes | the API from the declared size; the upload URL (a larger body is refused); the API again on start from the stored object | `FILE_TOO_LARGE` | `This file is larger than 25 MB. Split it into smaller files.` |
| PDF pages | 100 | the worker, before any model call | `TOO_MANY_PAGES` | `This PDF has <n> pages. The limit is 100 pages.` |
| Sheet rows | 5,000 non-empty rows after the header, first worksheet | the worker, before any model call | `TOO_MANY_ROWS` | `This sheet has <n> rows. The limit is 5,000 rows.` (`5,001`) |
| Format | the six above | the API | `UNSUPPORTED_FORMAT` | `This file type can't be imported. Use JSON, PDF, XLSX, CSV, TXT or MD.` |

**File signature** (SEC-06), checked by the API on start (first 64 KB of the stored object) and again by the worker
before parsing; only the worker parses a file:

| Format | The bytes must |
| --- | --- |
| `pdf` | start with `%PDF-` |
| `xlsx` | start with `PK\x03\x04` (a ZIP); the worker also needs `xl/workbook.xml` inside |
| `json`, `csv`, `txt`, `md` | be UTF-8 (a BOM is allowed) with no NUL byte; `json` also starts, after whitespace, with `{` or `[` |

A mismatch is `FILE_SIGNATURE_MISMATCH` with the message `This file isn't a real <FORMAT> file. Check the file and try
again.` (`PDF`, `XLSX`, `CSV`, `JSON`, `TXT`, `MD`). A PNG named `paper.pdf` and a PNG named `questions.csv` are both
mismatches.

**Template sheet.** The first row is the header. Header cells are matched ignoring case and surrounding spaces:
`Question`, `Option A` to `Option F`, `Correct`, `Explanation`, `Difficulty`, `Section`, `Marks`, `Negative marks`,
`Tags`. A sheet is a template when its header has `Question`, `Option A`, `Option B` and `Correct`. Each non-empty row
is one question: empty option cells are dropped, `Correct` holds the letter of the correct option (any case; several
letters separated by commas fail the single-answer check; empty means no answer), `Difficulty` is `easy`, `medium` or
`hard` (any case), `Tags` are comma-separated. A sheet that is not a template is sent to the model in parts of 200 rows
(as CSV text). TXT and MD files are sent in parts of at most 12,000 characters, split at line breaks (MD before a
heading where it can). Each part counts as a page in the progress.

## Requests the tests send directly

As in phases 1 to 5, with real ID tokens; super admins add `X-Org-Id`. Error bodies follow API-01. Every admin route
below answers `404` (never `403`) for a resource of another organization (ORG-05), the same success for a super admin
with `X-Org-Id` of the organization that holds it (ORG-11, ORG-14, the audit entry naming the super admin as actor with
`actor.role: "superAdmin"`), and `403` to a student token (role check before body validation).

| Request | Body | Expected |
| --- | --- | --- |
| `POST /v1/imports` | `{ testId, filename, contentType, sizeBytes }` with `Idempotency-Key` | `201` `{ id, status: "awaiting_upload", uploadUrl, uploadExpiresAt }`. Stores the job (below) and writes `import.create`. `400 IDEMPOTENCY_KEY_REQUIRED` without the key (a repeated key replays the first response: same `id`); `400 VALIDATION` for a missing field; `400 UNSUPPORTED_FORMAT`; `400 FILE_TOO_LARGE` when `sizeBytes` > 26,214,400; `404` for a test of another organization; `403 FEATURE_DISABLED` for `pdf`, `txt` and `md` while `ai_question_import` is off (JSON and sheets are still accepted); `409 LIMIT_REACHED` for `pdf`, `txt` and `md` when the month's `aiImports` has reached `ai_imports_per_month`, with `details: { limit: "ai_imports_per_month", max }`; nothing is stored on any refusal |
| `PUT <uploadUrl>` (no `Authorization`) | the file's bytes, `Content-Type` as declared | `200`; stores the bytes at the job's `filePath` in Storage. A body over 26,214,400 bytes is refused with a `4xx` status and nothing is stored; after `uploadExpiresAt` (15 minutes, 900 000 ms after the job was created, on the server clock) a `4xx` status and nothing is stored; once the job has been started (any status but `awaiting_upload`) a `4xx` status and the stored file is unchanged |
| `POST /v1/imports/{id}/start` | `{}` | `202` `{ id, status: "queued" }`; queues the worker task (below). Repeating it on a job that is already started answers `202` with the current status and queues nothing new. `409 UPLOAD_MISSING` when nothing was uploaded (the job stays `awaiting_upload`); `400 FILE_TOO_LARGE` or `400 FILE_SIGNATURE_MISMATCH` from the stored object, and `409 LIMIT_REACHED` (AI formats, as above): the job becomes `failed` with that `error`, `retryable: false`, and no task is queued |
| `GET /v1/imports?testId=<testId>` | | `200` `{ items: [{ id, filename, format, status, pendingCount, createdAt }] }`, newest first; `404` for a test of another organization |
| `GET /v1/imports/{id}` | | `200` the job view: `{ id, testId, filename, format, status, progress: { pagesDone, pagesTotal, questionsFound }, error?: { code, message, retryable }, retryAt?, provider?, model?, tokens?: { input, output }, costEstimate?, createdAt, drafts: Draft[] }`; `drafts` (below) in `order`, empty until the job is `ready` |
| `GET /v1/imports/{id}/pages/{page}` | | PDF jobs: `200` `{ url, contentType, expiresAt }`, a signed link (15 minutes) to that source page as `image/png` or `application/pdf`; `404` for a page out of range or a job of another format |
| `PATCH /v1/imports/{id}/drafts/{draftId}` | any of `{ prompt, options: [{ id, text }], correctOptionIds, explanation, difficulty, images: [{ path, alt }] }` (`images` may only keep or drop paths the draft already has) | `200` the updated draft with its flags checked again (and every other pending draft's duplicate flags); `400 VALIDATION` when `images` names a path the draft does not already have (another draft's, another test's or another organization's), storing nothing (ORG-05); `409 DRAFT_NOT_PENDING` for an approved or discarded draft |
| `POST /v1/imports/{id}/approve` | `{ draftIds: string[] }` | `200` `{ questionIds }` in draft order (below); `400 VALIDATION` for an empty list; `409 DRAFTS_FLAGGED` with `details.draftIds` (the flagged ones) when any listed draft has a flag; `409 DRAFT_NOT_PENDING` when any is approved or discarded; `409 IMPORT_NOT_READY` before the job is `ready`; `409 TEST_LOCKED` once an attempt of the test has started (TST-06). Any refusal changes nothing |
| `POST /v1/imports/{id}/discard` | `{ draftIds: string[] }` | `200` `{ discarded: <n> }`; the drafts get `status: "discarded"`; `409 DRAFT_NOT_PENDING` as above |
| `POST /v1/imports/{id}/retry` | `{}` | `202` `{ id, status: "queued" }` for a `failed` job whose `error.retryable` is `true`: queues the task again, keeps every page already done, and does not count the import again; `409 IMPORT_NOT_RETRYABLE` for any other job |

**Job record** `organizations/{orgId}/importJobs/{jobId}` (PLAN `ImportJob`, extended): `orgId`, `testId`,
`filename` (as given), `format`, `contentType`, `sizeBytes`, `filePath` exactly
`organizations/{orgId}/imports/{jobId}/source.<ext>` (lower-case extension), `status`, `progress`
`{ pagesDone, pagesTotal, questionsFound }`, `error` `{ code, message, retryable }` when it failed or waits to retry,
`retryAt` while waiting to retry, `aiCounted: true` once it was counted as an AI import, `provider`, `model`,
`tokens { input, output }` and `costEstimate` (USD) once the model was used, `createdBy` (the uid of whoever called
`POST /v1/imports`) and `createdAt`.

**Statuses**: `awaiting_upload` → `queued` (started) → `running` → `ready`, with `retrying` (a model call failed and a
retry is queued) and `failed` possible from `queued`, `running` or `retrying`. PLAN's `ImportJob.status` gains
`awaiting_upload` and `retrying`.

**Draft** `organizations/{orgId}/importJobs/{jobId}/drafts/{draftId}`, and each item of the job view's `drafts`:

| Field | Meaning |
| --- | --- |
| `id`, `order` | `order` is the draft's number in the import, 1, 2, … in source order (page, then position on the page). It never changes |
| `sourcePage` | PDF page number; part number for TXT, MD and non-template sheets; the row number (header = row 1) for template sheets; `1` for JSON |
| `prompt`, `options` | wording exactly as the source has it (IMP-05); options get IDs `a` to `f` in order |
| `correctOptionIds` | the options the source marks correct (empty when it marks none; the model never invents one) |
| `explanation` | only when the source has one |
| `difficulty`, `difficultySuggested` | the model's suggestion and `difficultySuggested: true`; from a template or JSON, the given value and `false` |
| `sectionName` | the section heading the question sits under, when there is one |
| `images` | `[{ path, alt }]`: each figure the model located, cropped from the page, stored as PNG under `organizations/{orgId}/imports/{jobId}/figures/`, with the model's alt text (A11Y-10) |
| `box` | `{ x, y, w, h }`, where the question is on its page, as fractions of the page's width and height from its top-left corner (when the model gave one) |
| `flags` | `[{ code, text }]`, the checks below; empty when the draft is valid |
| `status`, `questionId` | `pending`, `approved` (with the new question's ID) or `discarded` |

## Question checks on drafts (IMP-09, IMP-10)

Run by the worker on every draft when the job finishes, and again on every pending draft after any draft edit, approval
or discard. Each failed check is one flag, in this order, with exactly this text:

| Code | When | Text (exact) |
| --- | --- | --- |
| `NO_CORRECT_ANSWER` | no correct option, or the correct ID names a missing or empty option | `No correct answer found in the source.` |
| `TOO_FEW_OPTIONS` | fewer than two non-empty options | `A question needs at least two options.` |
| `MULTIPLE_CORRECT` | more than one correct option (v1 is single-answer, DECISIONS Q13) | `More than one option is marked correct.` |
| `EMPTY_PROMPT` | the prompt is empty or only whitespace | `The question text is empty.` |
| `DUPLICATE_IN_TEST` | same prompt as a question already in the test (DECISIONS: ignoring case, spacing and closing punctuation); `<m>` is that question's position | `This looks like a duplicate of question <m> in the test.` |
| `DUPLICATE_IN_IMPORT` | same prompt as an earlier **pending** draft of this import (lower `order`), and not a duplicate in the test; `<n>` is that draft's `order` | `This looks like a duplicate of imported question <n>.` |
| `MISSING_FIGURE` | the model says the question refers to a figure, or the prompt names one (`figure`, `diagram`, `graph`, `chart`, `picture` or `image` as a whole word, any case), and the draft has no image | `The question refers to a figure that wasn't found.` |
| `IMAGE_WITHOUT_ALT` | image `<k>` (1-based) has empty alt text | `Image <k> has no alt text.` |

An empty prompt is never a duplicate. A draft with any flag cannot be approved until it is fixed (IMP-10): the review
screen does not offer it and the API refuses it (`409 DRAFTS_FLAGGED`).

## Approval (IMP-12, US-AD-06)

Nothing is added to the test before approval. `POST /v1/imports/{id}/approve` appends one question per listed draft
after the test's last question, in draft `order`, in one batch with the audit entry `question.import`
(`after.count`, `after.jobId`): `prompt`, `options`, `correctOptionIds`, `explanation`, `difficulty`, `images` (each
image copied to `organizations/{orgId}/tests/{testId}/images/` and named there), `sectionId` (the test section whose
name matches `sectionName` ignoring case, else none), `status: "approved"` and `source` exactly
`{ kind: "ai", jobId, page: sourcePage }` for drafts the model made, or `{ kind: "json", jobId }` for JSON and template
sheets. The drafts get `status: "approved"` and `questionId`. The test's status follows phases 2 and 3 (a `draft` test
becomes `in_review`; an approved or scheduled one with no attempts returns to `in_review`, Q-15; with an attempt, the
`409 TEST_LOCKED` above).

## Worker pipeline (IMP-03, IMP-07, IMP-08, REL-06)

`POST /v1/imports/{id}/start` queues a task with path `/tasks/import`, payload `{ orgId, jobId }` and a name that
contains the job ID (`import-<jobId>`); retries use names that also contain it. The worker:

1. Sets `running`, checks the signature again, then the page or row limit (failing with the codes above, not
   retryable, before any model call).
2. For a job that needs the model (PDF, TXT, MD, a non-template sheet): if `aiCounted` is not set, increments
   `organizations/{orgId}/usage/{yyyy-mm}.aiImports` atomically (the month of the clock in the organization's
   timezone) and sets `aiCounted: true`; at the limit it fails with `LIMIT_REACHED`, not retryable (FF-04, IMP-08). A
   non-template sheet while `ai_question_import` is off fails with `FEATURE_DISABLED`, message
   `AI import isn't included in your organization's plan. Use the template columns or a JSON file.` JSON and template
   sheets never touch the counter.
3. Sets `progress.pagesTotal`, then sends **one page (or part) per model call, in page order, one call at a time**. A
   PDF page goes as a page of the document (a `file` part: a one-page `application/pdf` or a rendered `image/png`),
   never as extracted text alone (IMP-03). After each page it saves that page's drafts and updates `pagesDone` and
   `questionsFound`.
4. Validates every model answer with the shared Zod schema (`LlmQuestion`, below). Figures the model located are
   cropped from the page, stored as PNG and attached to the draft (IMP-03).
5. On a model failure (a provider error, a timeout or an answer that fails the schema): keeps the pages already done,
   sets `status: "retrying"`, `error: { code: "LLM_UNAVAILABLE", message: "The AI service didn't answer.",
   retryable: true }` and `retryAt` = now + 60 000 × 2^(k−1) ms, where k is the number of failures in a row (1, 2 and
   4 minutes), and queues the task again with `scheduleTime` = `retryAt`. The next run continues from the first page
   not done. The fourth failure in a row sets `status: "failed"` with `error.code: "LLM_UNAVAILABLE"`,
   `message: "The AI service didn't answer after 4 tries."`, `retryable: true`. Exams are unaffected: the API never
   waits on the worker or the model (REL-06).
6. When every page is done, runs the checks and sets `status: "ready"`.
7. Records on the job and in one structured log line (`import.job.done`): `provider` (the `LLM_PROVIDER` setting:
   `mock` in tests), `model` (the `LLM_MODEL` setting, or the driver's default: `mock-model` for the mock),
   `tokens { input, output }` (the sum over every successful call) and `costEstimate` =
   input / 1 000 000 × input price + output / 1 000 000 × output price, prices in USD per million tokens from
   `LLM_PRICE_INPUT_USD_PER_MTOK` and `LLM_PRICE_OUTPUT_USD_PER_MTOK`, whose defaults for the mock are `1` and `4`
   (IMP-07). JSON and template jobs record no provider, model, tokens or cost.

The worker answers `200` to the queue in every handled case, so the queue does not retry on its own as well. It
tolerates a task delivered twice.

**Model output schema** (`packages/shared`, `LlmQuestionSchema`), one call's answer being `{ questions: LlmQuestion[] }`:

```ts
interface Box { x: number; y: number; w: number; h: number }      // fractions of the page, from the top-left
interface LlmQuestion {
  prompt: string;
  options: string[];
  correct: number[];             // 0-based indexes the source marks correct; [] when it marks none
  explanation?: string;          // only when the source has one
  difficulty?: 'easy' | 'medium' | 'hard';   // a suggestion
  section?: string;              // the section heading the question sits under
  refersToFigure?: boolean;      // the question needs a figure
  figure?: { box: Box; alt: string };        // where that figure is on the page, and its alt text
  box?: Box;                     // where the question is on the page
}
```

## Test-only routes (additions)

Registered under the same conditions as the other `/__test/*` routes, each with `X-Test-Secret`. The API forwards them
to the worker, which runs the model. `POST /__test/reset` clears the script and the call log and releases held calls.

| Route | Body | Effect |
| --- | --- | --- |
| `POST /__test/llm` | `LlmScript` (below) | Replaces the mock model's script and clears the call log; answers `200` |
| `POST /__test/llm/release` | `{}` | Lets every held call (and every later call of a held page) answer; answers `200` |
| `GET /__test/llm/calls` | | `200` `{ calls: [{ page, parts: [{ type: "text" } \| { type: "file", mediaType }] }] }`: every model call since the script was set, in order, with the user-message parts it carried |

```ts
interface LlmScript {
  pages?: Record<string, LlmQuestion[]>;     // what the model finds on each page or part ("1", "2", …); none by default
  usage?: { inputTokens: number; outputTokens: number };   // reported per successful call; default 1000 and 200
  failures?: Record<string, number>;         // the next n calls for that page fail with a provider error (HTTP 503)
  hold?: number[];                           // calls for these pages wait until POST /__test/llm/release
}
```

The mock answers a call for page p with `{ questions: pages[p] ?? [] }` as the model's structured output, so the
worker's own validation runs on it. A held call blocks only that import task; other tasks keep being dispatched.

Recorded fixtures: `tests/fixtures/llm/quant-paper.json` (a three-page aptitude paper whose nine questions exercise
every check), `tests/fixtures/llm/reasoning-notes.json` (one part, two questions under the heading `Reasoning`) and
`tests/fixtures/llm/free-sheet.json` (a non-template sheet, two questions). Each holds `{ file, pages }`, and the
tests' PDF writer prints the paper's questions on the pages at their boxes.

## Audit actions

| Action | Target | Notes |
| --- | --- | --- |
| `import.create` | `{ type: "importJob", id: jobId }` | `after.testId`, `after.filename`, `after.format` |
| `import.retry` | `{ type: "importJob", id: jobId }` | written by `POST /v1/imports/{id}/retry` |
| `import.discard` | `{ type: "importJob", id: jobId }` | `after.count` |
| `question.import` | `{ type: "test", id: testId }` | as in phase 2; for imports also `after.jobId` |

## Admin screens

Every phase 6 admin page meets the phase 1 shell rules and has no serious axe violation. A student who opens
`/admin/imports/review/?id=…` lands on `/student/` (WEB-03).

### Questions tab additions (test editor)

| What | Role | Name or text |
| --- | --- | --- |
| Import | `button` | exactly `Import from file`, next to `Import JSON`; opens `dialog` exactly `Import questions from a file` |
| Imports | `list` | exactly `Imports`, shown when the test has any import; one `listitem` per job, newest first, holding a `link` named exactly the file name to `/admin/imports/review/?id=<jobId>`, the status word (below) and the time it started, `20 Oct 2026, 11:30 IST` |

Status words (here and in the review page's test ID `import-status`): `Waiting for upload`, `Queued`, `Processing`
(`running`), `Waiting to retry`, `Ready for review` (`ready` with a pending draft), `Reviewed` (`ready` with none),
`Failed`.

**Upload dialog** (`dialog` `Import questions from a file`):

| What | Role | Name or text |
| --- | --- | --- |
| Formats | text | exactly `JSON, PDF, XLSX, CSV, TXT or MD, up to 25 MB. PDFs can have up to 100 pages and sheets up to 5,000 rows.` |
| File | file input | exactly `File (required)` |
| Submit | `button` | exactly `Start import` |
| Limit reached | `alert` in the dialog | exactly `This month's AI import limit (<n>) is used up. JSON files and template sheets can still be imported.` (`409 LIMIT_REACHED`) |
| AI off | text | with `ai_question_import` off, exactly `PDF, TXT and MD imports use AI, which is not included in your organization's plan.` |

`Start import` checks the extension and size in the browser first, then calls `POST /v1/imports`, uploads to
`uploadUrl` and calls `start`. Field errors on `File (required)` (nothing is created for the first three):
no file `Choose a file to import.`; the unsupported-format and too-large messages above; a signature mismatch from
`start`, the mismatch message above. On success the browser goes to `/admin/imports/review/?id=<jobId>`.

### Review page: `/admin/imports/review/?id=<jobId>` (IMP-04, IMP-10 to IMP-13, US-AD-06)

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Import: <file name>` (`Import: quant-paper.pdf`) |
| Back | `link` | exactly `Back to <test heading>` (`Back to Day 1: Quantitative aptitude`) to `/admin/tests/edit/?id=<testId>` |
| Status | test ID `import-status` | exactly the status word |
| Progress | `region` | exactly `Import progress`, shown while the job is `queued`, `running` or `retrying`; holds a `progressbar` exactly `Pages processed` (`aria-valuemin` 0, `aria-valuemax` = `pagesTotal`, `aria-valuenow` = `pagesDone`; no `aria-valuenow` while `pagesTotal` is 0), the text exactly `Pages processed: <pagesDone> of <pagesTotal>`, the text exactly `Questions found: <n>` and the text exactly `You can leave this page. The import keeps running.` |
| Retry wait | text in the progress region | while `retrying`, exactly `The AI service didn't answer. The import will try again at <HH:mm> IST.` (`retryAt`) |
| Failed | `alert` | exactly `The import failed. <error message>` (`The import failed. This PDF has 101 pages. The limit is 100 pages.`); with a `button` exactly `Try again` beside it when the error is retryable, which calls `POST /v1/imports/{id}/retry` |
| Summary | `list` | exactly `Import summary`, once `ready`; `listitem`s exactly `Questions found: <n>`, `Need fixing: <n>` (pending with flags), `Ready to approve: <n>` (pending without), `Approved: <n>`, `Discarded: <n>` |
| Approve all | `button` | exactly `Approve all valid questions`; approves every pending draft without flags; then a `status` exactly `Approved <n> questions` (`Approved 1 question`). Disabled (`disabled` or `aria-disabled="true"`) when there is none |
| Groups | `region`s | exactly `Need fixing`, `Ready to approve`, `Approved`, `Discarded`, in this order, each with a level-2 heading of the same text, each shown only when it holds a draft (IMP-12: flagged at the top) |
| Draft | `article` | exactly `Imported question <order>`, in its group in `order`; holds a level-3 heading of the same text and the parts below |
| Source page | `region` | exactly `Source page`, beside the drafts (below) |
| No questions | test ID `empty-state` | a `ready` job with no drafts: exactly `No questions were found in this file. Check that it holds questions, or import another file.` and one action, a `button` `Import another file`, which opens the upload dialog for the same test |
| Not found | | for a job of another organization or an unknown ID: `heading` level 1 exactly `Import not found`, text exactly `This import doesn't exist in <org name>.`, `link` exactly `Back to series` to `/admin/series/`. Nothing of the job is shown |

**Inside a draft's `article`:**

| What | Role | Name or text |
| --- | --- | --- |
| Source | text | PDFs: exactly `Page <sourcePage>`; template sheets: exactly `Row <sourcePage>` |
| Question | | the prompt rendered as students see it; `img` per image named by its alt text. Prompt, options and explanation render as in phase 2 with raw HTML off: HTML in them (`<script>`, `<img onerror=…>`, event attributes) shows as literal text, and no element, script run or dialog comes from it |
| Options | `list` | exactly `Options`; `listitem`s exactly `<letter>. <text>` (`A. Rs. 480`) |
| Answer | text | exactly `Correct answer: <letter>`, or `Correct answer: none`, or `Correct answers: <letters joined by ", ">` when several |
| Difficulty | text | exactly `Suggested difficulty: <Easy\|Medium\|Hard>` when `difficultySuggested`, else `Difficulty: <…>` when set |
| Section | text | exactly `Section: <sectionName>` when detected |
| Reasons | `list` | exactly `Reasons`, only for a flagged draft; one `listitem` per flag, exactly its text, in flag order |
| Actions | `button`s | pending drafts only: exactly `Approve question <order>`, `Edit question <order>`, `Discard question <order>`. For a flagged draft `Approve question <order>` is disabled (`disabled` or `aria-disabled="true"`) with accessible description exactly `Fix the reasons above before approving.` |
| Approved | text | exactly `Added to the test as question <m>.` (its position in the test) |

`Approve question <n>` approves that draft: a `status` exactly `Approved 1 question`. `Discard question <n>` discards it
at once (no dialog; a draft is not live data): a `status` exactly `Question <n> discarded`. The draft moves to its new
group.

**Inline edit** (`Edit question <n>`): the article itself turns into a form, no dialog. Fields, inside the article, as
in the phase 2 question editor: textbox `Question text`; `group` `Options` with textboxes `Option A`, `Option B`, …;
`radiogroup` `Correct answer` with `radio`s `A`, `B`, …; textbox `Explanation`; native select `Difficulty`; a textbox
`Alt text for image <k>` per image. `button`s exactly `Save changes` and `Cancel`. Saving sends the PATCH; a `status`
exactly `Question <n> saved` appears, the flags are checked again, and the article shows its new reasons (or none) and
moves to its new group. `Cancel` (or `Escape`) leaves it unchanged. After either, focus returns to the article.

**Current draft and source page (IMP-11).** Exactly one draft `article` has `aria-current="true"`: at first the first
pending draft in display order; afterwards the last one clicked, focused or reached by a shortcut. Each `article` is
focusable (`tabindex="-1"`) and clicking it makes it current. The `Source page` region shows the current draft's page:

- PDF: an `img` (an `<img>`, or a `<canvas role="img">`) named exactly `Page <p> of <file name>`
  (`Page 2 of quant-paper.pdf`), and, when the draft has a `box`, an element with test ID `source-highlight` drawn over
  the image covering the box: its left, top, width and height, measured against the image's rendered box, are the
  box's `x`, `y`, `w`, `h` within 0.02.
- Other formats: the text of that part (sheets: the row's cells as `<header>: <value>` lines) with the question's text
  in a `mark` element when it is found there.

At 1280 px wide the `Source page` region sits beside the drafts: its left edge is at or right of the current
article's right edge, and while the page is scrolled to the current article both are in the viewport (the region
stays in view, for example `position: sticky`).

**Keyboard (IMP-13).** While focus is inside one of the group regions (on an `article` or one of its buttons; never in a
text field, select or open form), these single keys act on the current draft. They do nothing elsewhere on the page,
so they cannot fire by accident (WCAG 2.1.4):

| Key | Action |
| --- | --- |
| `J` | next draft (display order, across groups): it becomes current and gets focus, scrolled into view |
| `K` | previous draft, likewise |
| `A` | approve the current draft as `Approve question <n>` does; for a flagged draft nothing is sent and a `status` exactly `Fix the reasons before approving this question.` appears |
| `E` | open inline edit of the current draft, with focus in `Question text` |
| `D` | discard the current draft as `Discard question <n>` does |

After `A` or `D` the current draft becomes the next pending draft after it in display order (or the previous pending
one when there is none after it), with focus on it. The `Keyboard shortcuts` dialog (`?`) on this page also holds a
`list` exactly `Review shortcuts` whose `listitem`s are exactly `J Next question`, `K Previous question`,
`A Approve question`, `E Edit question`, `D Discard question` (the key, a space or other separation, the action).

## Unit and integration tests the build must add

These REQs are verified below the browser. The builder writes them beside the code (Vitest; integration tests on the
emulators with the mock model), each test title starting with its REQ IDs. Functions are exported from
`packages/shared` (`@mitaoe/shared`) with these exact names.

```ts
// import-formats.ts
export type ImportFormat = 'json' | 'pdf' | 'xlsx' | 'csv' | 'txt' | 'md';
export const IMPORT_MAX_BYTES = 26_214_400;
export const IMPORT_MAX_PDF_PAGES = 100;
export const IMPORT_MAX_SHEET_ROWS = 5000;
export function importFormatOf(filename: string): ImportFormat | null;
export function signatureMatches(format: ImportFormat, head: Uint8Array): boolean;   // the signature table above
export function usesModel(format: ImportFormat, isTemplateSheet: boolean): boolean;
export function isTemplateHeader(cells: ReadonlyArray<string>): boolean;

// import-checks.ts
export type ImportProblem =
  | { code: 'NO_CORRECT_ANSWER' } | { code: 'TOO_FEW_OPTIONS' } | { code: 'MULTIPLE_CORRECT' } | { code: 'EMPTY_PROMPT' }
  | { code: 'DUPLICATE_IN_TEST'; of: number } | { code: 'DUPLICATE_IN_IMPORT'; of: number }
  | { code: 'MISSING_FIGURE' } | { code: 'IMAGE_WITHOUT_ALT'; image: number };
export interface CheckedDraft {
  order: number; prompt: string; options: ReadonlyArray<{ id: string; text: string }>; correctOptionIds: ReadonlyArray<string>;
  images: ReadonlyArray<{ path: string; alt: string }>; refersToFigure?: boolean;
}
export function importProblems(draft: CheckedDraft, ctx: {
  earlierPending: ReadonlyArray<Pick<CheckedDraft, 'order' | 'prompt'>>;      // pending drafts with a lower order
  testQuestions: ReadonlyArray<{ prompt: string }>;                           // in test order
}): ImportProblem[];
export function importProblemText(p: ImportProblem): string;                    // the texts of the checks table
export function mentionsFigure(prompt: string): boolean;

// import-llm.ts
export const LlmQuestionSchema: ZodType<LlmQuestion>;
export const EXTRACTION_INSTRUCTIONS: string;                                   // the system instructions
export function extractionPrompt(part: { page: number; text?: string; hasPageFile: boolean; sectionHints?: string[] }):
  { system: string; userText: string };                                         // file text only inside userText's data block
export function draftsFromModel(page: number, questions: ReadonlyArray<LlmQuestion>, startOrder: number): DraftInput[];
export function templateRowsToDrafts(rows: ReadonlyArray<ReadonlyArray<string>>): DraftInput[] | { error: 'NOT_TEMPLATE' };
export function costEstimateUsd(tokens: { input: number; output: number }, prices: { inputPerMTok: number; outputPerMTok: number }): number;
export function retryDelayMs(failuresInARow: number): number | null;           // 60 000, 120 000, 240 000, then null (fail)
```

| REQ | Kind | Behaviours the tests must show |
| --- | --- | --- |
| IMP-09 | unit | `importProblems` flags each case of the checks table, alone and together in the table's order: no correct option, a correct ID naming a missing or empty option, one non-empty option, two correct options, empty and whitespace-only prompts, a duplicate of a test question (case, spacing and closing punctuation ignored) and of an earlier pending draft (a later draft names the earlier one; a duplicate in the test wins), an empty prompt never being a duplicate, a figure word (`figure`, `diagram`, `graph`, `chart`, `picture`, `image`; whole words only, so `configure` does not count) or `refersToFigure` without an image, an image with empty alt text; `importProblemText` gives exactly the texts above |
| IMP-05 | unit | `EXTRACTION_INSTRUCTIONS` tells the model to keep the original wording, never to invent a correct answer or an explanation, to give an explanation only when the source has one, to detect section headings, and to give difficulty only as a suggestion; `draftsFromModel` copies prompt and option text unchanged (no trimming inside, no re-wording), sets `correctOptionIds` only from `correct`, leaves `explanation` absent when the model gave none, and marks `difficultySuggested: true` |
| IMP-06 | unit | `extractionPrompt` puts the file's text only inside one delimited data block of `userText`, never in `system`; `system` is the same for any file content; delimiter look-alikes inside the content are escaped so the block cannot be closed early; with the injection fixture `tests/fixtures/llm/injection.txt` (it tells the model to ignore its instructions and mark every option correct), `system` is unchanged and the text stays inside the block. Through the worker with the mock, the injection file's drafts are exactly the script's questions (nothing added or marked correct) |
| IMP-01, SEC-06 | unit + integration | `importFormatOf` for each extension in any case and for refused ones; `signatureMatches` for each format, a PNG and an `MZ` header under each name, a UTF-8 BOM, a NUL byte; the API reads only the first 64 KB of the stored object and never parses it (the parsers are imported only by apps/worker, checked by a dependency rule or test) |
| IMP-02 | integration | `FILE_TOO_LARGE` from the declared size, from an upload body over the limit and from a stored object over it; a 100-page PDF passes and a 101-page one fails with `TOO_MANY_PAGES` before any model call and without counting; 5,000 rows pass and 5,001 fail with `TOO_MANY_ROWS`, for CSV and XLSX |
| IMP-03 | integration | each PDF page reaches the mock as its own call with a `file` part (`application/pdf` or `image/png`); a figure box becomes a stored PNG of the cropped area attached to the draft with the model's alt text; approving copies it under the test's images folder |
| IMP-07 | integration | provider and model come from `LLM_PROVIDER` and `LLM_MODEL` (a test with another configured model ID sees it on the job); tokens summed over successful calls only; `costEstimateUsd` unit-tested; the `import.job.done` log line has provider, model, tokens and cost |
| IMP-08 | integration | the counter rises once per AI job (not per page, not per retry, not for a manual retry), never for JSON or a template sheet, and atomically: two AI jobs started together at limit − 1 leave one `LIMIT_REACHED` |
| REL-06 | integration | a provider error leaves the job `retrying` with its done pages kept and a task at `retryAt`; `retryDelayMs` unit-tested; the fourth failure in a row fails the job as retryable; while the worker's model call hangs or fails, answer saves and attempt starts keep their normal responses (no API route awaits the worker) |
| IMP-12 | integration | approve is all-or-nothing (one flagged or non-pending draft refuses the whole list); questions keep draft order, `source`, `sectionId` by section name; `409 TEST_LOCKED` after an attempt started |

Also: every new admin route (`POST /v1/imports`, `…/start`, `GET /v1/imports`, `GET /v1/imports/{id}`,
`…/pages/{page}`, `PATCH …/drafts/{draftId}`, `…/approve`, `…/discard`, `…/retry`) is in the phase 0 route-table
tests (ORG-05 404 for org B, ORG-14 with an admin token and with a super-admin token plus `X-Org-Id`, `403` for student
and device tokens). The real-provider smoke test (Q30) sends a two-page sample PDF to the configured provider when its
credentials are present and checks the answer against `LlmQuestionSchema`; without them it is skipped with a reason.

## Checked outside the automated suites

Rows in docs/MANUAL_CHECKS.md (added there with the phase 6 contract):

| REQ | Why not end to end here | Check |
| --- | --- | --- |
| IMP-03 (phase 6 gate) | the real 30-page PDF import needs a provider key and a real question paper (OWNER_SETUP 6.1, 6.2); the mock cannot judge extraction quality | on staging, a real 30-page PDF imports with every question found, wording kept, figures cropped and every flagged item explained |
| IMP-07 | the real provider's token counts and prices | on staging, the job's provider, model, tokens and cost match the provider console within rounding |
| IMP-01 | browser uploads to a real GCS signed URL depend on the bucket's CORS setting | on staging, a PDF uploads from the deployed web app to the signed URL |

## Test IDs

| Test ID | Where | Why not a role |
| --- | --- | --- |
| `import-status` | review page header | a status badge with no landmark role |
| `source-highlight` | over the source page image | a drawn box with no semantic role |
| `empty-state` | review page with no drafts (phase 1 convention) | one sentence and one action, no distinct role |
