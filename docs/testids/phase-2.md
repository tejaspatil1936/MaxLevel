# Phase 2 test contract: authoring

The phase 2 acceptance tests (tests/acceptance/phase-2/) find elements through the page objects in
tests/acceptance/pages/, by role and accessible name. The implementation must expose exactly these names. The phase 0
and phase 1 contracts (docs/testids/phase-0.md, docs/testids/phase-1.md) stay valid, including every convention of
phase 1 ("Conventions used below": exact names, `(required)` labels, field errors with `aria-invalid` and
`aria-describedby`, confirmation `alertdialog`s with focus on `Cancel`, native selects, focus return, en-IN numbers).

Further conventions for phase 2:

- Dates are shown as `d MMM yyyy` (`2 Nov 2026`). Times are shown in 24-hour `HH:mm` in the **organization's**
  timezone, never the browser's, and every time range a person acts on names the zone with the short name from
  `Intl.DateTimeFormat('en-IN', { timeZone: org.timezone, timeZoneName: 'short' })`, which is `IST` for
  `Asia/Kolkata` (TST-07, UX-11). A range reads `10:00 to 11:00 IST`.
- Date, time and date-time fields are native `<input type="date">`, `type="time"` and `type="datetime-local"`. A
  date-time typed into a `datetime-local` field means that wall-clock time in the organization's timezone.
- All stored times are epoch milliseconds, UTC (PLAN section 5). Series dates are stored as `yyyy-mm-dd` strings and the
  series daily window as minutes after midnight in the organization's timezone (`{ startMinutes, endMinutes }`).
- A notice after a successful action is a `status` element (for example a Sonner toast) whose whole text is the notice.
- Status words shown to people: series `Draft`, `Active`, `Archived`; tests `Draft`, `In review`, `Approved`,
  `Scheduled`, `Live`, `Closed`; questions `Approved`, `Draft`.
- Opening `/admin/series/view/?id=…` or `/admin/tests/edit/?id=…` with an ID that is not in the organization being
  worked in shows a level-1 heading exactly `Series not found` (or `Test not found`), the text exactly
  `This series doesn't exist in <org name>.` (or `This test doesn't exist in <org name>.`) and a link exactly
  `Back to series` to `/admin/series/`. Nothing of the other organization's record is shown.

## Test clock

Phase 2 tests set the API's test clock to **20 Oct 2026, 06:00 UTC** (11:30 IST) at the start of every test
(`POST /__test/clock { nowMs: 1792476000000 }`), so the series and test dates below (November 2026) are in the future.
The web app takes "now" from the server (`X-Server-Time`), never from the device clock, wherever it decides a status or
a default (for example the graduation years offered: 2025 to 2031).

## Settings (spec 5.4) and how they are named

The series form (`Default settings`) and the test editor's `Settings` tab use the same controls and labels. Stored keys
follow PLAN section 5 `Settings`.

| Setting | Control and exact label | Options shown, then stored value | System default |
| --- | --- | --- | --- |
| Timing mode | `radiogroup` `Timing mode` | `Fixed slot` `fixed`; `Flexible window` `flexible` | `fixed` |
| Daily window (series only) | time inputs `Daily start time (required)`, `Daily end time (required)` | stored `dailyWindow: { startMinutes, endMinutes }` | none |
| Window (test only, override) | date-time inputs `Window start`, `Window end` | stored `window: { start, end }` (UTC ms) | from the series daily window on the test's scheduled date |
| Duration | `spinbutton` `Duration (minutes)` | `durationMin`; in fixed slot mode it is read-only and shows the slot length | 60 |
| Late entry cutoff | `spinbutton` `Late entry cutoff (minutes)` (fixed slot only) | `lateEntryCutoffMin` | 15 |
| Window end policy | `radiogroup` `Window end policy` (flexible only) | `Last start leaves full duration` `full_duration`; `Hard close at window end` `hard_close` | `full_duration` |
| Maximum strikes | `spinbutton` `Maximum strikes` | `maxStrikes`, whole number 1 to 10 | 3 |
| Developer tools policy | native select `Developer tools policy` | `Block and strike` `block_strike`; `Block only` `block`; `Allow (practice tests)` `allow` | `block_strike` |
| Switches | `switch`es `Fullscreen required`, `Laptop camera required`, `Second camera (phone)`, `Shuffle questions`, `Shuffle options`, `Show past scores to students`, `Test leaderboard`, `Series leaderboard` | `fullscreenRequired`, `cameraRequired`, `secondCamera`, `shuffleQuestions`, `shuffleOptions`, `showPastScores`, `testLeaderboard`, `seriesLeaderboard` | on, on, off, on, on, on, off, off |
| Result release | native select `Result release` | `Immediately on submit` `immediate`; `After the window closes` `after_close`; `Manually` `manual`; `Never` `never` | `after_close` |
| Result detail | native select `Result detail` | `Score only` `score`; `Score with section breakdown` `sections`; `Full review with correct answers and explanations` `full` | `sections` |

Field errors (exact): maximum strikes outside 1 to 10 or not whole `Enter a whole number from 1 to 10.`; duration or
late entry cutoff not a whole number of at least 1 `Enter a whole number of minutes, 1 or more.`; daily end not after
daily start `The daily end time must be after the start time.`; window end not after window start
`The window must end after it starts.`

**Flexible window and full review (SER-09).** When the resolved values are timing mode `flexible`, result detail
`full` and result release `immediate`, the `Result release` field shows this error as soon as the combination is
chosen (before any save), and the form does not save while it is shown:

`In a flexible window, a full review released on submit would show the answers to students who haven't started yet. Release results after the window closes, or choose a lower detail level.`

The API refuses the same combination with `400` and error code `FULL_REVIEW_BEFORE_CLOSE`, on series defaults and on
the resolved settings of a test. (`Manually` is allowed here. Phase 4's **Release results** action must refuse a
full-review release before a flexible window closes, so a manual release can never leak answers either.)

## Eligibility editor (series form and test `Eligibility` tab)

| What | Role | Name or text |
| --- | --- | --- |
| Editor | `group` | exactly `Students who can take this series` (on the test tab: `Students who can take this test`) |
| Departments | `group` `Departments` | one `checkbox` per active department, named exactly the department name. On a test, only the departments the series allows are offered (all of them when the series has no department rule) |
| Graduation years | `group` `Graduation years` | one `checkbox` per year from the current year minus 1 to plus 5 (2025 to 2031), named exactly the year |
| Include list | textbox (multi-line) | exactly `Also include`; description `Emails or PRNs, one per line.` |
| Exclude list | textbox (multi-line) | exactly `Exclude`; description `Emails or PRNs, one per line.` |
| Live count | `status` | exactly `<n> students can take this series` (`1 student can take this series`; test tab: `… this test`), en-IN grouping; updates while the rules are edited, without saving |
| Matching list | `button` | exactly `Show matching students`; opens `dialog` exactly `Students who can take this series` (`… this test`) with a `table` exactly `Matching students`, columns `Name`, `PRN`, `Department`, `Graduation year`, one row per matching student, and a `Close` button |

Rules (SER-04, SER-05, SER-06): only students whose status is `registered` ever match. A student matches when they are
not on the exclude list and either are on the include list or match every non-empty filter (department any of the
selected, graduation year any of the selected). An empty filter or list means no restriction. A test's rules apply on
top of its series' rules (both must match), so a test can narrow but never widen. Include and exclude lists are stored
as student IDs; an entry that matches no student shows the field error `No student matches <entry>. Check the email or PRN.`

Stored as `eligibility: { departmentIds, graduationYears, include, exclude }` on the series and on the test.

## Requests the tests send directly

As in phase 1, with real ID tokens; super admins add `X-Org-Id`. Every admin route below answers `404` (never `403`)
for a resource of another organization (ORG-05), the same as for a super admin with `X-Org-Id` of the organization that
does hold it answers `200` or `201` (ORG-11, ORG-14), and `403` for a student token (role check before body
validation). Error bodies follow API-01.

| Request | Body | Expected |
| --- | --- | --- |
| `GET /v1/series` | | `200` `{ items: Series[], nextCursor }` |
| `POST /v1/series` | `{ title, description?, startDate, endDate, dailyWindow: { startMinutes, endMinutes }, defaults: Partial<Settings>, eligibility: EligibilityRules }` | `200` or `201` with `{ id }`; status `draft`; `400 FULL_REVIEW_BEFORE_CLOSE` for the SER-09 combination |
| `GET`, `PATCH /v1/series/{id}` | PATCH `{ title }` or `{ status: "active" \| "archived" \| "draft" }` | `200` |
| `POST /v1/series/{id}/eligibility/preview` | `{ eligibility: EligibilityRules }` | `200` `{ count, students: [{ id, name, prn, departmentId, graduationYear }] }` for those rules; `{id}` may be `new` for a series not yet saved |
| `POST /v1/tests/{id}/eligibility/preview` | `{ eligibility: EligibilityRules }` | as above, for students matching the stored series rules and these test rules |
| `GET /v1/tests?seriesId=…` | | `200` `{ items: Test[] }`; `404` when the series is not in the org |
| `POST /v1/tests` | `{ seriesId, title, company?, dayNumber?, dayHidden?, scheduledDate }` | `200` or `201` with `{ id }`; status `draft`; `404` when `seriesId` is another org's |
| `GET /v1/tests/{id}` | | `200`; body has `id`, `status` (derived: `live` while now is inside the resolved window of a scheduled test, `closed` after it) and `effective`: the settings resolved now (test override, then series default, then system default) with `window: { start, end }` in UTC ms |
| `PATCH /v1/tests/{id}` | any of `{ title, company, dayNumber, dayHidden, scheduledDate, overrides, eligibility, sections, drawCount }`; `overrides` replaces the whole override map; `sections` replaces the section list (entries without `id` are new) | `200`; `400 MIX_UNSATISFIABLE`, `400 DRAW_TOO_LARGE`, `400 FULL_REVIEW_BEFORE_CLOSE` as described below |
| `GET /v1/tests/{id}/questions` | | `200` `{ items: Question[] }` in `order` |
| `POST /v1/tests/{id}/questions` | `{ prompt, options: [{ id, text }], correctOptionIds, explanation?, difficulty?, sectionId?, marks?, negativeMarks?, tags?, timeLimitSec?, images? }` | `200` or `201` with `{ id, status }`; status `approved` when the question passes the checks, else `draft` (DECISIONS Q17) |
| `PATCH /v1/tests/{id}/questions/{questionId}` | any of the `POST` fields | `200` with `{ id, status }`, checked again |
| `DELETE /v1/tests/{id}/questions/{questionId}` | | `200` or `204`; the remaining questions keep their relative order |
| `PUT /v1/tests/{id}/questions/order` | `{ ids: string[] }` (every question ID of the test, in the new order) | `200`; `400` when the list is not exactly the test's question IDs |
| `GET /v1/tests/{id}/preview` | | `200` the exam payload for preview, including each question's `correctOptionIds` and `explanation` (admins only) |
| `POST /v1/tests/{id}/approve` | `{}` | `200` `{ status: "approved", totalMarks }`; `409 CHECKLIST_FAILED` with `details.failed` (the failed checklist texts) when any check fails, and nothing changes |
| `POST /v1/tests/{id}/publish` | `{}` | `200` `{ status: "scheduled" }`; `409 TEST_NOT_APPROVED` for a test that is not approved, and nothing changes |

`POST /v1/tests/{id}/publish` is this phase's addition to the endpoint table of spec 11.5 (DECISIONS Q14: **Publish
test** moves an approved test to `scheduled`). `GET /v1/tests/{id}/preview` and
`POST /v1/tests/{id}/eligibility/preview` are additions too.

## Test-only scenarios (`POST /__test/seed/:scenario`)

Seeds write directly (no audit entries). Settings below are PLAN `Settings` keys.

| Scenario | Body | Creates | Returns |
| --- | --- | --- | --- |
| `authoring-series` | `{ orgId, title?, status?, defaults?, eligibility? }` | A series in that org: title `Placement 2026` (or `title`), description `Daily tests for the 2026 placement season.`, `startDate` `2026-11-01`, `endDate` `2026-11-30`, `dailyWindow` 600 to 660 (10:00 to 11:00 in the org timezone), status `draft` (or `status`), `defaults` holding every system default from the settings table merged with `defaults`, `eligibility` with empty lists merged with `eligibility` | `{ seriesId }` |
| `authoring-test` | `{ orgId, seriesId?, title?, company?, scheduledDate?, questions?, invalidQuestion?, overrides?, sectionDraws?, testDraw?, publish? }` | Without `seriesId`, first the default `authoring-series` series. Then a test: title `Quantitative aptitude` (or `title`), company `TCS` (or `company`), `scheduledDate` `2026-11-02` (or given), no day number, `dayHidden: false`, `overrides` as given (default `{}`), `drawCount` = `testDraw`, and the questions of the chosen set (`questions`: `none`, `basic` (default) or `sectioned`; see below). `sectionDraws` maps a section name to its `drawCount`. `invalidQuestion: true` appends one `draft` question (below). Status `draft` with no questions, else `in_review`. `publish: true` approves and publishes it: status `scheduled`, `approval` set, `resolved` snapshot and `totalMarks` saved | `{ seriesId, testId, questionIds: string[] (in order), sectionIds: { [name]: id } }` |

`basic` questions, in order, all `approved`, no section, no marks of their own, option IDs `a` to `d`:

| # | Prompt | Options (correct in bold) | Explanation | Difficulty |
| --- | --- | --- | --- | --- |
| 1 | `A train 240 m long passes a pole in 12 seconds. What is its speed?` | **`20 m/s`**, `24 m/s`, `18 m/s`, `22 m/s` | `Speed is distance over time: 240 / 12 = 20 m/s.` | easy |
| 2 | `What is 15% of 200?` | `25`, **`30`**, `35`, `40` | `15 / 100 × 200 = 30.` | medium |
| 3 | `If $x + 3 = 7$, what is $x$?` | `3`, **`4`**, `5`, `7` | none | easy |
| 4 | `Which number comes next: 2, 4, 8, 16?` | `24`, `30`, **`32`**, `64` | `Each number doubles: 16 × 2 = 32.` | hard |

`invalidQuestion` adds question 5: `Which of these is a prime number?` with options `21`, `23`, `25`, `27`, no correct
answer, status `draft`.

`sectioned` questions: sections `Quant` (order 1, instructions `Answer every question. Calculators are not allowed.`)
and `Verbal` (order 2, instructions `Read each passage carefully.`), both `forwardOnly: false`, no duration, no draw
unless `sectionDraws` says so. Questions in order, all `approved`, options `Option one` (correct), `Option two`,
`Option three`, `Option four`, explanation `Explanation for <prompt>.`: in `Quant` `Quant easy 1`, `Quant easy 2`,
`Quant easy 3` (easy), `Quant medium 1`, `Quant medium 2` (medium), `Quant hard 1` (hard); in `Verbal`
`Verbal easy 1`, `Verbal easy 2` (easy), `Verbal medium 1`, `Verbal medium 2` (medium).

## Audit actions

Written to the organization's `auditLogs` in the same batch as the change (AUD-02), with `actor { uid, role, email }`
of whoever acted, a super admin included (ORG-04, ORG-12, US-SA-07).

| Action | Target id | Notes |
| --- | --- | --- |
| `series.create`, `series.update` | series ID | `series.update` covers title, description, dates, daily window, default settings and eligibility |
| `series.activate`, `series.archive` | series ID | `before.status` and `after.status` |
| `test.create`, `test.update` | test ID | `test.update` covers details, day label, date, eligibility, sections, draw, marking and time limits |
| `test.settings.update` | test ID | setting overrides; `before` and `after` hold the override maps |
| `test.approve`, `test.publish` | test ID | |
| `question.create`, `question.update`, `question.delete` | question ID | |
| `question.reorder`, `question.import` | test ID | `question.import`: `after.count` is the number of questions added |

## Admin workspace additions

The sidebar `Main` navigation gains a link exactly `Series` to `/admin/series/`, after `Departments`. It is a page in
the command palette like every other sidebar link. Every phase 2 admin page meets the phase 1 shell rules (one banner,
one `Main` navigation, one main, heading order, 44 px targets, no horizontal scroll at 768 px, focus ring) and has no
serious axe violation.

### Series list: `/admin/series/`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Series` |
| Primary action | `link` or `button` | exactly `New series` (top-right, UX-01), opens `/admin/series/new/` |
| List | `table` | exactly `Series`; columns `Title`, `Dates`, `Tests`, `Status` |
| Row | `row` | first cell holds a `link` named exactly the series title, to `/admin/series/view/?id=<seriesId>`; `Dates` exactly `1 Nov 2026 to 30 Nov 2026`; `Tests` the number of tests; `Status` exactly `Draft`, `Active` or `Archived` |
| Empty state | test ID `empty-state` | exactly `No series yet. Create a series to start adding tests.` and one action `New series` |

### New series and Edit series: `/admin/series/new/`, `/admin/series/edit/?id=<seriesId>`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `New series` (edit: `Edit series`) |
| Details | fields | `Title (required)` textbox; `Description` textbox (multi-line); `Start date (required)`, `End date (required)` date inputs; `Daily start time (required)`, `Daily end time (required)` time inputs |
| Default settings | `group` | exactly `Default settings`, holding every control of the settings table (except the test-only `Window`) prefilled with the system defaults (new) or the stored values (edit) |
| Eligibility | | the eligibility editor, `Students who can take this series` |
| Sticky footer bar | `region` | exactly `Form actions`, `position` `sticky` or `fixed`; `Discard` then the primary button `Create series` (edit: `Save changes`) at its far right; `status` exactly `Unsaved changes` while anything differs from the initial values |

Errors: empty title `Enter the series title.`; end date before start date `The end date can't be before the start date.`
After `Create series` (or `Save changes`) the browser shows the series page. A new series is stored with status
`draft`, the title, description, dates, `dailyWindow`, `defaults` (every setting of the form) and `eligibility`.

### Series page: `/admin/series/view/?id=<seriesId>`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly the series title |
| Facts | text in main | `1 Nov 2026 to 30 Nov 2026` and the daily window `10:00 to 11:00 IST` |
| Status | test ID `series-status` | exactly `Draft`, `Active` or `Archived` |
| Primary action | `button` | exactly `Add test` (top-right) |
| Edit | `link` or `button` | exactly `Edit series`, to the edit form |
| Overflow menu | `button` `More actions` | `menuitem`s exactly `Activate series` (draft or archived) and `Archive series` (draft or active); archiving asks `alertdialog` exactly `Archive <title>?` with confirm `Archive series` |
| Timeline | `list` | exactly `Tests by day`: one `listitem` per test in scheduled order (date, then creation order) |
| Timeline item | `listitem` | holds, in this order: the day label (unless hidden), a `link` named exactly the test title to `/admin/tests/edit/?id=<testId>`, the company (when set), `<date>, <start> to <end> <zone>` (for example `2 Nov 2026, 10:00 to 11:00 IST`) and the status word |
| Empty state | test ID `empty-state` | exactly `No tests yet. Add the first test to this series.` and one action `Add test` |

**Day labels (TST-02).** A test without a day number is labelled `Day <n>`, where n is its position in the series'
schedule order (counting every test, renamed and hidden ones too). A stored `dayNumber` is shown instead. A hidden day
label (`dayHidden: true`) is not shown anywhere, and the other tests keep their numbers.

`Add test` opens `dialog` exactly `Add test`: `Title (required)`, `Company`, `Scheduled date (required)`, `Day label`
(description exactly `Leave empty to number tests by date, for example Day 3.`), `checkbox` `Hide the day label`, and
submit `Add test`. Afterwards the dialog closes, a `status` `Test added` is shown and the timeline has the test. A new
test is stored with `seriesId`, `title`, `company`, `scheduledDate` (`yyyy-mm-dd`), `dayNumber` absent or `null`,
`dayHidden`, `overrides: {}` and status `draft`. Errors: empty title `Enter the test title.`; date outside the series
`Choose a date from 1 Nov 2026 to 30 Nov 2026, the series dates.` (with the series' own dates).

## Test editor: `/admin/tests/edit/?id=<testId>`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `<day label>: <title>` (for example `Day 1: Quantitative aptitude`), or the title alone when the day label is hidden |
| Schedule | text in main | exactly `Scheduled <date>, <start> to <end> <zone>`, from the resolved window (`Scheduled 2 Nov 2026, 10:00 to 11:00 IST`) |
| Status | test ID `test-status` | exactly the test status word; `Live` and `Closed` follow from the window and the server clock |
| Primary action | `button` | exactly `Publish test`, top-right of the page header (UX-01); disabled (`disabled` or `aria-disabled="true"`) unless the test is `Approved`, with accessible description exactly `Approve the test before publishing it.` while disabled |
| Details | `button` | exactly `Edit details`, opens `dialog` exactly `Edit test details` with the fields of `Add test` and submit `Save details` |
| Tabs | `tablist` with `tab`s | exactly `Questions`, `Sections`, `Marking and timers`, `Settings`, `Eligibility`, `Preview`; each `tabpanel` is named by its tab |

After **Publish test** succeeds: a `status` exactly `Test published` (UX-10), the status becomes `Scheduled`, and the
test is stored with `status: "scheduled"` and `resolved` holding the full resolved settings (window in UTC ms)
(TST-05). Editing questions, sections, draw, marking, time limits or any setting other than `Result release`,
`Result detail`, `Show past scores to students`, `Test leaderboard` and `Series leaderboard` on an `Approved` or
`Scheduled` test with no attempts returns it to `In review`: stored `status: "in_review"`, `approval` and `resolved`
removed (Q-15, DECISIONS Q16). Changing one of those five release and visibility settings keeps the status and updates
`resolved` in place. Editing the test's eligibility keeps the status too (eligibility is checked again when an attempt
starts, SER-08).

### Questions tab

| What | Role | Name or text |
| --- | --- | --- |
| Add | `button` | exactly `Add question`, opens the question editor `dialog` exactly `Add question` |
| JSON import | `button` | exactly `Import JSON`, opens `dialog` exactly `Import questions from JSON` |
| List | `list` | exactly `Questions`; one `listitem` per question in `order` |
| Item | `listitem` | text `Question <n>` (its position), the prompt as students see it, the section name when it has one, the status word `Approved` or `Draft`, and for a draft each reason text (below) |
| Item actions | `button`s | exactly `Edit question <n>` (opens `dialog` exactly `Edit question <n>`), `Delete question <n>` (opens `alertdialog` exactly `Delete question <n>?`, destructive confirm `Delete question`), and the drag handle `Reorder question <n>` |
| Empty state | test ID `empty-state` | exactly `No questions yet. Add the first question.` and one action `Add question` |

**Reordering (Q-01).** Dragging an item's `Reorder question <n>` handle (pointer down, move, up) onto another item's
position moves it there. By keyboard: focus the handle, `Space` picks the item up, `ArrowUp` and `ArrowDown` move it one
place, `Space` drops it, `Escape` cancels; each move is announced in a polite live region. The new order is saved at
once (`question.reorder`): the stored `order` fields follow the new sequence.

**Question editor** (`dialog` `Add question` or `Edit question <n>`):

| What | Role | Name or text |
| --- | --- | --- |
| Prompt | textbox (multi-line) | exactly `Question text`; Markdown with `$…$` and `$$…$$` math, fenced code blocks and images |
| Options | `group` `Options` | textboxes exactly `Option A`, `Option B`, … (four shown for a new question, 2 to 6); `button` `Add option` (hidden at 6); `button`s `Remove option <letter>` |
| Correct answer | `radiogroup` | exactly `Correct answer`; `radio`s exactly `A`, `B`, … one per option |
| Explanation | textbox (multi-line) | exactly `Explanation` |
| Difficulty | native select | exactly `Difficulty`; `Not set`, `Easy`, `Medium`, `Hard` |
| Section | native select | exactly `Section`; `No section` then each section name (shown when the test has sections) |
| Marks | `spinbutton`s | exactly `Marks` and `Negative marks`; empty means "use the section or test value" |
| Time limit | `spinbutton` | exactly `Time limit (seconds)`; shown only when the test's time limit is `Set on each question` |
| Topic tags | textbox | exactly `Topic tags` (comma-separated) |
| Images | file input | exactly `Add image` (PNG, JPEG, SVG); each added image gets a textbox exactly `Alt text for image <n>` and a `button` `Remove image <n>` |
| Live preview | `region` | exactly `Student view`: the question exactly as the exam screen renders it, updated on every keystroke without saving. Math renders through KaTeX with MathML output (a `<math>` element whose TeX `annotation` holds the source), code blocks as `pre code` with highlighting, images as `img` named by their alt text, options as lettered rows `A`, `B`, … |
| Problems | `list` | exactly `Needs attention`, updated live; one `listitem` per reason below; absent when there is none |
| Save | `button` | exactly `Save question`; the dialog closes and a `status` `Question saved` is shown |

Question checks (DECISIONS Q17, A11Y-10, IMP-09), with their exact reason texts. A question with no reason is stored
`approved`; a question with any reason is stored `draft` and shows its reasons in `Needs attention` and in its list item:

| Check | Reason text |
| --- | --- |
| no correct answer | `No correct answer is set.` |
| fewer than two non-empty options | `A question needs at least two options.` |
| empty prompt | `The question text is empty.` |
| more than one correct option (JSON) | `More than one option is marked correct.` |
| likely duplicate of another question in the test | `This looks like a duplicate of question <n>.` |
| an image without alt text | `Image <n> has no alt text.` |

Stored question fields follow PLAN `Question`: `prompt`, `options [{ id, text }]` (empty option rows dropped),
`correctOptionIds`, `explanation`, `difficulty`, `sectionId`, `marks`, `negativeMarks`, `timeLimitSec`, `tags`,
`images [{ path, alt }]`, `order`, `source.kind` (`manual` or `json`) and `status`.

**JSON import** (`dialog` `Import questions from JSON`): file input exactly `JSON file (required)`. After a file is
chosen the dialog shows a `list` exactly `Import summary` with `listitem`s exactly `Questions found: <n>`,
`Ready to use: <n>`, `Need attention: <n>`, and the submit `button` `Import questions`. Afterwards the dialog closes,
a `status` exactly `Imported <n> questions` (`Imported 1 question`) is shown, the questions are appended in file order
with `source.kind: "json"`, checked as above, and one `question.import` entry is written. A file that is not valid
question JSON shows the field error `This file isn't valid question JSON. Check it against the import format.` and
adds nothing.

Accepted JSON, two formats, both tested end to end.

**Legacy format** (spec 15.1; as in legacy/data/infosys/infosys-set-2.json), recognised by having no `format` key:

```json
{
  "questions": [
    {
      "id": "q1",
      "text": "Markdown text",
      "options": ["first option", "second option", "third option", "fourth option"],
      "correctIndex": 1,
      "explanation": "optional",
      "topic": "optional",
      "source": "optional"
    }
  ]
}
```

Mapping: `text` becomes `prompt`; `options` become the options in order; `correctIndex` (0-based) makes the option at
that index the only entry of `correctOptionIds`; `explanation` is kept; `topic` becomes the only tag; the legacy `id`
and `source` strings are not shown (the question gets a new ID and `source.kind: "json"`). A missing or out-of-range
`correctIndex` leaves `correctOptionIds` empty, so the question is stored `draft` with `No correct answer is set.`

**`mitaoe-questions/1` format** (this project's own; the builder logs it in docs/DECISIONS.md):

```json
{
  "format": "mitaoe-questions/1",
  "questions": [
    {
      "prompt": "Markdown text",
      "options": ["first option", "second option", "third option", "fourth option"],
      "correct": "B",
      "explanation": "optional Markdown",
      "difficulty": "easy",
      "marks": 2,
      "negativeMarks": 0.5,
      "tags": ["percentages"],
      "timeLimitSec": 60
    }
  ]
}
```

`correct` is the letter of the correct option (or an array of letters, which fails the single-answer check); a missing
`correct` gives `No correct answer is set.` Every field but `prompt` and `options` is optional.

### Sections tab

| What | Role | Name or text |
| --- | --- | --- |
| Add | `button` | exactly `Add section`, opens `dialog` exactly `Add section` |
| List | `table` | exactly `Sections`; columns `Order`, `Name`, `Questions`, `Draw`, `Difficulty mix`, `Duration`, `Navigation`. `Questions`: approved questions in the section; `Draw`: `All` or the draw count; `Difficulty mix`: `None` or `2 easy, 2 medium, 1 hard`; `Duration`: `Test timer` or `20 minutes`; `Navigation`: `Free` or `Forward only` |
| Row menu | `button` | exactly `Actions for <section name>`; `menuitem`s exactly `Edit`, `Move up`, `Move down`, `Delete`; `Edit` opens `dialog` exactly `Edit <section name>` |
| Empty state | test ID `empty-state` | exactly `No sections. All questions are drawn from one pool.` and one action `Add section` |
| Whole-test draw | shown only while the test has no sections: `heading` level 2 exactly `Whole-test draw`, `spinbutton` exactly `Questions to draw` (empty means all), `button` exactly `Save draw`, then `status` `Draw saved`; stored as the test's `drawCount` |

Section dialog fields: `Name (required)`, `Instructions` (multi-line), `Duration (minutes)`, `Questions to draw`,
`checkbox` `Forward-only navigation`, `group` exactly `Difficulty mix` with `spinbutton`s exactly `Easy`, `Medium`,
`Hard`, `spinbutton`s `Marks` and `Negative marks`; submit `Save section`. Stored in the test's `sections` with `id`,
`name`, `order` (1, 2, … as listed), `instructions`, `durationMin`, `drawCount`, `difficultyMix { easy, medium, hard }`,
`forwardOnly`, `marks`, `negativeMarks`. `Move up` and `Move down` change `order` at once.

Validation (US-AD-07, Q-05), each blocking the save, shown on the named field:

| Problem | Field | Error text |
| --- | --- | --- |
| empty name | `Name (required)` | `Enter the section name.` |
| draw larger than the section's approved questions | `Questions to draw` | `This section has <m> approved questions, so it can't draw <n>.` |
| a mix count larger than the section's approved questions of that difficulty | that difficulty's spinbutton | `This section has <m> <difficulty> questions, so the mix can't take <n>.` (`1 hard question`) |
| mix total differs from a set draw | `Questions to draw` | `The mix adds up to <t> questions. Set Questions to draw to <t> or leave it empty.` |
| whole-test draw larger than the test's approved questions | `Questions to draw` (whole-test) | `This test has <m> approved questions, so it can't draw <n>.` |

A mix with no draw count draws the mix total. The API refuses the same with `400 DRAW_TOO_LARGE` (a draw above the
pool) or `400 MIX_UNSATISFIABLE` (a mix count above a difficulty's questions, and also a mix total that differs from a
set draw, `MIX_DRAW_MISMATCH` in shared).

### Marking and timers tab

| What | Role | Name or text |
| --- | --- | --- |
| Preset | `radiogroup` | exactly `Marking scheme`; `radio`s exactly `+1 and 0`, `+1 and −0.25`, `+4 and −1`, `Custom` (the minus is U+2212) |
| Values | `spinbutton`s | exactly `Marks for a correct answer`, `Marks taken off for a wrong answer` |
| Time limit | `radiogroup` | exactly `Time limit per question`; `radio`s exactly `No time limit`, `Same limit for every question`, `Set on each question` |
| Seconds | `spinbutton` | exactly `Seconds per question` (shown with `Same limit for every question`) |
| Footer | `region` `Form actions` | `Discard`, then `Save marking and timers`; afterwards a `status` exactly `Marking and timers saved` |

A new test shows `+1 and 0` with 1 and 0, and `No time limit`. Choosing a preset fills both values, which stay
editable; a value edited so that it no longer matches a preset selects `Custom` (Q-08). Stored in the test's
`overrides.marking` as `{ marks, negativeMarks, preset }` with `preset` `p1_0`, `p1_m025`, `p4_m1` or `custom` and
`negativeMarks` as the positive number taken off (1 for −1). The time-limit choice is stored as
`overrides.questionTimeMode`: `none` (also when absent), `same` or `each`. `Same limit for every question` stores
`questionTimeMode: "same"` with `overrides.questionTimeLimitSec`; `Set on each question` stores
`questionTimeMode: "each"` and no `questionTimeLimitSec`, so the choice survives a reload, and shows
`Time limit (seconds)` in the question editor (stored as the question's `timeLimitSec`) (Q-10). Errors: marks not above
0 `Enter a number greater than 0.`; negative value below 0 `Enter 0 or a positive number.`; seconds not a whole number
of at least 1 `Enter a whole number of seconds, 1 or more.`

### Settings tab (TST-03, US-AD-05)

Every setting of the settings table (with `Window` instead of the daily times) is a `group` named exactly the setting
label (for example `Maximum strikes`, `Window`, `Result release`; for switches the switch label). Each group shows:

| State | What the group holds |
| --- | --- |
| Inherited | the text exactly `Inherited`; the text exactly `From series: <value>` (values as shown in the series form: `3`, `60 minutes`, `On`, `Off`, the option label, or for `Window` `10:00 to 11:00 IST on the scheduled date`); a `switch` exactly `Override <setting label>`, off; no editable control |
| Overridden | the text exactly `Overridden`; the switch on; the setting's control (labelled as in the settings table), prefilled with the series value when first switched on; a `button` exactly `Use series value for <setting label>`; a left rule: the group's computed `border-left-style` `solid`, `border-left-width` at least 2 px, `border-left-color` ballpoint `rgb(46, 63, 209)` (inherited groups have no ballpoint left border) |

`Use series value for …` returns the group to Inherited in one click. The tab saves through its sticky footer
`region` `Form actions` (`Discard`, then `Save settings`; `status` `Unsaved changes` while edited; afterwards `status`
exactly `Settings saved`). Stored as the test's `overrides`, holding only the overridden keys; a reset key is removed.
An inherited setting always shows the series' current value, so changing the series default changes it, and an
overridden one keeps its own value.

### Eligibility tab

The eligibility editor named `Students who can take this test`, with the text exactly
`The series rules apply first. These rules can only narrow them.`, a `button` exactly `Save eligibility`, then a
`status` exactly `Eligibility saved`. Stored as the test's `eligibility`.

### Preview tab (Q-13, Q-14, DECISIONS Q15)

| What | Role | Name or text |
| --- | --- | --- |
| Open | `link` | exactly `Open preview`, to `/exam/?preview=<testId>` |
| Checklist | `list` | exactly `Approval checklist`, four `listitem`s in this order, each exactly as below |
| Approve | `button` | exactly `Approve test` (while `Draft` or `In review`); afterwards `status` exactly `Test approved` and the status `Approved` |
| Refused | `alert` | exactly `This test can't be approved yet. Fix the items marked Failed.`; the status does not change |
| No questions | test ID `empty-state` | exactly `This test has no approved questions yet. Add questions to preview it.` and one action `Go to questions` (selects the Questions tab); `Open preview` is then not shown |

Checklist items (each with an icon too, so the words are not colour alone):

1. `Passed: Every question is valid`, or `Failed: The test has no questions`, or `Failed: <n> questions need attention`
   (`Failed: 1 question needs attention`), counting `draft` questions.
2. `Passed: Every draw can be filled`, or `Failed: ` followed by each problem, joined by `; `:
   `<pool> draws <n> but has <m> approved questions` or `<pool> needs <n> <difficulty> questions but has <m>`, where
   pool is the section name or `The test`.
3. `Passed: Total marks <t>`, where t sums, per pool, the drawn count times the pool's marks (question, then section,
   then test marks); or `Failed: Marks differ within <pool>, so totals would differ between students` when a pool with
   a draw smaller than the pool holds questions with different marks.
4. `Passed: Settings are complete`, or `Failed: ` followed by the problem (for example
   `The window is shorter than the duration`).

`Approve test` runs the same checks on the server (`POST /v1/tests/{id}/approve`). On success the test is stored with
`status: "approved"`, `approval { status: "approved", approvedBy: <approver's uid>, approvedAt }` and `totalMarks`.

## Exam screen in preview: `/exam/?preview=<testId>` (Q-13, US-AD-08)

The same exam screen students get in phase 3, opened for an admin (or a super admin in the organization's workspace)
with no attempt. Students who open this path are sent to `/student/`.

| What | Role | Name or text |
| --- | --- | --- |
| Top bar | `banner` | holds the test title as `heading` level 1 (exactly the editor's heading), the preview note, `Show answers` and `Exit preview` |
| Preview note | text | exactly `Preview. No attempt is saved and proctoring is off.` |
| Show answers | `switch` | exactly `Show answers`, off when the preview opens |
| Exit | `link` | exactly `Exit preview`, back to `/admin/tests/edit/?id=<testId>` |
| Question | `heading` level 2 | exactly `Question <n> of <total>`, total being the drawn count |
| Prompt | text in main | rendered as in the editor's `Student view` (MathML math, code, images with alt) |
| Options | `radiogroup` | exactly `Answer options`; `radio`s exactly `<letter>. <option text>` (`A. 20 m/s`), arrow keys move between them |
| Navigation | `button`s | exactly `Previous`, `Mark for review`, `Clear answer`, `Save and next` |
| Palette | `navigation` | exactly `Question palette`; one `button` per question named `Question <n>, <state>` (A11Y-08) |

- The draw follows the test exactly as a student would get it: sections in order, draw counts, difficulty mix and the
  shuffle settings (a fresh random seed each time the preview opens).
- Answers, marks for review and navigation work in memory only. No attempt record, attempt index, answer or event is
  stored, and no `POST /v1/attempts…` or `PUT …/answers` request is made.
- Proctoring is off: no camera request (`getUserMedia`), no fullscreen request, no strike warning or overlay when the
  window loses focus or the page is hidden. There is no `Submit test` button.
- With `Show answers` on, the correct option's radio has accessible description exactly `Correct answer` (visible text
  in its row), no other radio has it, and a question with an explanation shows a `heading` level 3 exactly
  `Explanation` followed by the explanation. Off again, both are gone.

## Unit and integration tests the build must add

These REQs are verified below the browser. The builder writes them beside the code (Vitest; integration tests on the
emulators), with each test title starting with its REQ IDs. Functions are exported from `packages/shared` (package
`@mitaoe/shared`) with these exact names and signatures.

```ts
// eligibility.ts
export interface EligibilityRules { departmentIds: string[]; graduationYears: number[]; include: string[]; exclude: string[] }
export const NO_RESTRICTION: EligibilityRules;                       // all four lists empty
export interface EligibilityStudent {
  id: string; status: 'invited' | 'registered' | 'disabled'; departmentId: string | null; graduationYear: number | null;
}
export function matchesRules(student: EligibilityStudent, rules: EligibilityRules): boolean;
export function isEligible(student: EligibilityStudent, series: EligibilityRules, test?: EligibilityRules): boolean;

// draw.ts
export type Difficulty = 'easy' | 'medium' | 'hard';
export interface DrawPool {
  sectionId: string | null;                                            // null = the whole-test pool
  questions: ReadonlyArray<{ id: string; difficulty?: Difficulty }>; // approved questions only, in order
  drawCount?: number;
  difficultyMix?: { easy: number; medium: number; hard: number };
}
export type DrawProblem =
  | { code: 'DRAW_TOO_LARGE'; sectionId: string | null; drawCount: number; available: number }
  | { code: 'MIX_UNSATISFIABLE'; sectionId: string | null; difficulty: Difficulty; wanted: number; available: number }
  | { code: 'MIX_DRAW_MISMATCH'; sectionId: string | null; mixTotal: number; drawCount: number };
export function drawSize(pool: DrawPool): number;                    // mix total, else drawCount, else all questions
export function drawProblems(pool: DrawPool): DrawProblem[];
export function drawQuestions(pools: ReadonlyArray<DrawPool>, seed: string):
  Array<{ sectionId: string | null; questionIds: string[] }>;

// marks.ts
export interface MarkLevel { marks?: number; negativeMarks?: number }
export function resolveMarks(question: MarkLevel, section: MarkLevel | undefined,
  test: { marks: number; negativeMarks: number }): { marks: number; negativeMarks: number };
export const MARKING_PRESETS: { p1_0: { marks: 1; negativeMarks: 0 }; p1_m025: { marks: 1; negativeMarks: 0.25 };
  p4_m1: { marks: 4; negativeMarks: 1 } };
export function presetFor(marks: number, negativeMarks: number): 'p1_0' | 'p1_m025' | 'p4_m1' | 'custom';

// day-labels.ts
export function dayLabels(tests: ReadonlyArray<{ id: string; scheduledDate: string; dayNumber?: string | null;
  dayHidden?: boolean }>): Record<string, string | null>;            // input order breaks date ties

// settings.ts
export const SYSTEM_DEFAULTS: Omit<Settings, 'window'>;
export function resolveSettings(input: { series: Pick<Series, 'defaults' | 'dailyWindow'>;
  test: Pick<Test, 'overrides' | 'scheduledDate'>; timezone: string }): Settings;
export function settingsProblems(settings: Partial<Settings>): Array<{ code: 'FULL_REVIEW_BEFORE_CLOSE'; field: 'resultRelease' }>;

// questions-json.ts (both import formats of the Questions tab)
export interface ImportedQuestion {
  prompt: string; options: string[]; correct: number[];              // 0-based indexes; empty = none
  explanation?: string; difficulty?: Difficulty; marks?: number; negativeMarks?: number; tags: string[];
  timeLimitSec?: number;
}
export function parseQuestionJson(json: unknown): { questions: ImportedQuestion[] } | { error: 'INVALID' };

// question-checks.ts
export type QuestionProblem =
  | { code: 'NO_CORRECT_ANSWER' } | { code: 'TOO_FEW_OPTIONS' } | { code: 'EMPTY_PROMPT' }
  | { code: 'MULTIPLE_CORRECT' } | { code: 'DUPLICATE'; of: number } | { code: 'IMAGE_WITHOUT_ALT'; image: number };
export function questionProblems(q: Pick<Question, 'prompt' | 'options' | 'correctOptionIds' | 'images'>,
  others: ReadonlyArray<Pick<Question, 'prompt'>>): QuestionProblem[];
export function problemText(p: QuestionProblem): string;             // the reason texts of the question checks table
```

| REQ | Kind | Behaviours the tests must show |
| --- | --- | --- |
| Q-01 | unit | `parseQuestionJson` maps the legacy format (`text`, `options`, `correctIndex`, `explanation`, `topic` to `tags`; an out-of-range or missing `correctIndex` gives `correct: []`) and `mitaoe-questions/1` (`correct` letter or letters to indexes), on a sample from legacy/data/infosys/infosys-set-2.json and a hand-written file; it returns `{ error: 'INVALID' }` for anything else (no `questions` array, a question without text or options, an unknown `format`) |
| SER-04 | unit | `isEligible` is false for `invited` and `disabled` students even with no rules and even when they are on the include list; true for a `registered` student with `NO_RESTRICTION` |
| SER-05 | unit | `matchesRules`: departments match any selected; graduation years any selected; both filters set means both must match; an empty filter or list means no restriction; the include list admits a student who fails the filters; the exclude list removes a student who matches; exclude beats include |
| SER-06 | unit | `isEligible(s, series, test)` is true only when both rule sets match; a test include of a student the series rejects stays false (never widens); a test exclude or narrower filter removes students the series admits |
| Q-04 | unit | `drawQuestions` with a pool of 100 and `drawCount` 20 returns 20 distinct IDs from that pool for each of several seeds, the same IDs for the same seed; without a draw count it returns every question; with a mix 2/2/1 it returns exactly that many per difficulty; `drawProblems` reports `DRAW_TOO_LARGE` for a draw above the pool size and `MIX_UNSATISFIABLE` for a mix above a difficulty's count, and nothing for a satisfiable pool |
| Q-07 | unit | `resolveMarks` takes marks from the question, else the section, else the test, and negative marks the same way independently; `0` at a level is a value (it overrides a lower level) while `undefined` falls through; `presetFor` maps 1/0, 1/0.25 and 4/1 to their presets and anything else to `custom` |
| TST-02 | unit | `dayLabels` numbers tests `Day 1`, `Day 2`, … in scheduled-date order (input order on ties), shows a stored `dayNumber` instead, gives `null` for a hidden one, and never renumbers the others because of a rename or a hidden label |
| SER-02 | integration | series status is `draft`, `active` or `archived` (PATCH moves between them, audit-logged); the student-visible series listing (the service behind `GET /v1/student/dashboard`, phase 3) returns only `active` series for which `isEligible` holds |
| TST-04 | integration | the lifecycle `draft` → `in_review` (first question added) → `approved` (`POST /approve`) → `scheduled` (`POST /publish`), with `live` and `closed` derived from the resolved window and the Clock; `POST /publish` on a `draft` or `in_review` test is `409 TEST_NOT_APPROVED` and stores nothing; status cannot be set through PATCH |
| TST-05 | integration | `POST /publish` stores `resolved` equal to `resolveSettings` of the series, the test and the org timezone at that moment, in the same batch as `status: "scheduled"` and the `test.publish` audit entry |
| Q-15 | integration | on an `approved` or `scheduled` test with no attempt: adding, editing, deleting or reordering a question, changing sections, draw, marking, time limits or a locked setting sets `status: "in_review"` and removes `approval` and `resolved`; changing `resultRelease`, `resultDetail`, `showPastScores`, `testLeaderboard` or `seriesLeaderboard` does not, and updates `resolved`; an eligibility edit does not either (eligibility is checked when an attempt starts, SER-08) |

Also, beside the routes: every new admin route is in the phase 0 route-table tests (ORG-05 404 for org B, ORG-14 with
an admin token and with a super-admin token plus `X-Org-Id`), and the SER-09 and Q17 rules have unit tests on
`settingsProblems` and `questionProblems`.

## Test IDs

| Test ID | Where | Why not a role |
| --- | --- | --- |
| `series-status` | series page header | a status badge with no landmark role |
| `test-status` | test editor header | a status badge with no landmark role |
| `empty-state` | every empty state (phase 1 convention) | one sentence and one action, no distinct role |
