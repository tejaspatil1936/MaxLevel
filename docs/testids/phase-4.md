# Phase 4 test contract: results

The phase 4 acceptance tests (tests/acceptance/phase-4/) find elements through the page objects in
tests/acceptance/pages/, by role and accessible name. The implementation must expose exactly these names. The phase 0
to 3 contracts (docs/testids/phase-0.md to phase-3.md) stay valid, with every convention listed there (exact names,
`(required)` labels, field errors, confirmation `alertdialog`s with focus on `Cancel` and the confirm button to its
right, `redpen` destructive buttons, en-IN numbers, `d MMM yyyy` dates, 24-hour `HH:mm` times in the organization's
timezone named `IST` for `Asia/Kolkata`, a notice after an action as a `status` whose whole text is the notice). In
particular phase 3's submitted screen (`/exam/submitted/?attempt=`), student dashboard (`/student/`), test page and the
`exam-test` scenario keep their names; phase 4 only adds to them, as listed below.

Further conventions for phase 4:

- **Scores** are shown with en-IN grouping and at most two decimal places, trailing zeros dropped
  (`new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })`): `2.75`, `10`, `1,234.5`. A score with its maximum
  reads `<score> / <max>` (`2.75 / 10`). A percentage reads `<n>%` with the same number format (`27.5%`, `100%`).
  A negative score uses the minus sign U+2212 (`−0.5 / 4`).
- **Marks gained or lost** on one question read `+<n>` for a gain, `−<n>` (U+2212) for a loss and `0` for none
  (`+1`, `−0.25`, `0`).
- **Time taken** on the result page reads `<n> minutes` (whole minutes, rounded down; `1 minute`), or
  `<n> seconds` under one minute (`1 second`). In leaderboard tables the `Time taken` cell reads like the exam timer:
  `MM:SS` below one hour (`12:05`) and `H:MM:SS` from one hour (`1:02:03`).
- **Strike summary** reads `no strikes`, `1 strike` or `<n> strikes`.
- **Attempt status words** are phase 3's: `Submitted` (`submitted`), `Submitted automatically` (`auto_submitted`),
  `Ended after strikes` (`terminated`); exports add `In progress` (`in_progress`).
- **Board IDs** are `test_<testId>` and `series_<seriesId>`, as in spec 10.1.

## Result release (RES-01, RES-05, LB-04, DATA-05)

The release setting is the resolved `resultRelease` of the test (`resolved` snapshot, which phase 2 and 3 already
update in place when a release or visibility setting changes after publishing). The test record keeps the release state
in PLAN's fields: `resultsReleasedAt` (epoch ms, or absent or `null`) and `resultsWithdrawn` (boolean, absent = false).

A test's results are **released to students** when:

| `resultRelease` | Released when |
| --- | --- |
| `immediate` | always, unless `resultsWithdrawn` |
| `after_close` | `resultsReleasedAt` is set (by the release task at window end, or by an early **Release results**) and not `resultsWithdrawn` |
| `manual` | `resultsReleasedAt` is set by **Release results** and not `resultsWithdrawn` |
| `never` | never |

The **release state** shown to students is `released`, `pending` (not yet released), `withdrawn` (`resultsWithdrawn`)
or `never`. A test's results are **public** when they are released and, in a flexible window, the window has closed
(LB-04). Leaderboards follow the public state (below).

**Release task** (RES-01): publishing a test (`POST /v1/tests/{id}/publish`, and the `exam-test` scenario's `publish`)
and every attempt start enqueue (idempotently by name) one task with path `/tasks/release-results`, name
`release-results-<orgId>-<testId>-<windowEnd>`, payload `{ orgId, testId }` and `scheduleTime` the resolved window end.
When it runs at or after the window end it queues a leaderboard recompute (whatever the mode, since a flexible
window's boards open then), and on a test whose `resultRelease` is `after_close` with no `resultsReleasedAt` it also
stores `resultsReleasedAt` (the clock's now). Before the window end, and for a test already released or withdrawn, it
stores nothing (a withdrawn test stays withdrawn). Running it twice has the effect of running it once (REL-04).

**Release results** (`POST /v1/tests/{id}/release`) stores `resultsReleasedAt` (now) and `resultsWithdrawn: false`,
writes the audit entry `test.results.release` in the same batch, and queues a leaderboard recompute due at once. It is
refused, with nothing stored:

- `409 RESULTS_NOT_RELEASABLE` when `resultRelease` is `never`;
- `409 FULL_REVIEW_BEFORE_CLOSE` when the resolved timing mode is `flexible`, `resultDetail` is `full` and the window
  has not closed (SER-09, DATA-05; docs/DECISIONS.md 2026-10-18). After the window end it succeeds.

On a test that is already released and not withdrawn it answers `200` and changes nothing.

**Withdraw results** (`POST /v1/tests/{id}/withdraw-results`) stores `resultsWithdrawn: true`, writes the audit entry
`test.results.withdraw`, and queues a leaderboard recompute due at once. `409 RESULTS_NOT_RELEASED` when the results
are not released. **Release results** on a withdrawn test releases it again.

Changing `resultRelease`, `resultDetail`, `showPastScores`, `testLeaderboard` or `seriesLeaderboard` after attempts have
started still saves (TST-06) and takes effect on the next request.

## Requests the tests send directly

As in phases 1 to 3, with real ID tokens; super admins add `X-Org-Id`. Error bodies follow API-01. Admin routes answer
`404` (never `403`) for a resource of another organization (ORG-05), the same success for a super admin with `X-Org-Id`
of the organization that holds it (ORG-11, ORG-14), with the audit entry naming the super admin as actor, and `403` to
a student token. Student routes answer `403` to an admin or super-admin token and `404` for an attempt that is not the
caller's own (matched by the token's `studentId` claim) or is in another organization.

| Request | Body | Expected |
| --- | --- | --- |
| `POST /v1/tests/{id}/release` | `{}` | admin: `200` `{ resultsReleasedAt }`; refusals as above |
| `POST /v1/tests/{id}/withdraw-results` | `{}` | admin: `200` `{ resultsWithdrawn: true }`; `409 RESULTS_NOT_RELEASED` |
| `GET /v1/student/results/{attemptId}` | | student: `200` the **result** (below); `409 ATTEMPT_IN_PROGRESS` for an attempt still in progress |
| `GET /v1/student/history` | | student: `200` the **history** (below) |
| `GET /v1/leaderboards/{boardId}` | | `200` the **board** (below). Admin: always, every row. Student: only while the board is open to them (below), else `404 LEADERBOARD_NOT_AVAILABLE`. A board of another organization is `404` for everyone but a super admin with that `X-Org-Id`. With `public_leaderboards` off: `403 FEATURE_DISABLED` |
| `POST /v1/exports` | `{ scope: "test" \| "series", refId, format: "csv" \| "xlsx" }` with `Idempotency-Key` | admin: `200`, `201` or `202` `{ id, status }` (`queued`, `running` or `ready`); `400 IDEMPOTENCY_KEY_REQUIRED` without the key; `404` when `refId` is not a test or series of the organization; `403 FEATURE_DISABLED` with `results_export` off |
| `GET /v1/exports/{id}` | | admin: `200` `{ id, scope, refId, format, status, url?, expiresAt?, filename? }`; `status` `queued`, `running`, `ready` or `failed`; when `ready`, `url` is a fresh signed download link and `expiresAt` is 15 minutes (900 000 ms) after the request on the server clock; `404` for another organization's export |
| `GET <url>` (the signed link, no `Authorization`) | | `200` with the file, `Content-Disposition: attachment; filename="<filename>"`, `Content-Type` `text/csv; charset=utf-8` (CSV) or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX). After `expiresAt` on the server clock: a `4xx` status and no file |
| Worker `POST http://127.0.0.1:4001/tasks/leaderboard` | `{ orgId, testId, seriesId }` | `200`; recomputes and stores `leaderboards/test_<testId>` and `leaderboards/series_<seriesId>` |
| Worker `POST http://127.0.0.1:4001/tasks/release-results` | `{ orgId, testId }` | `200` every time; behaves as described above |

**Result** (`GET /v1/student/results/{attemptId}`, US-ST-07, RES-02, RES-03, RES-06, DATA-05):

```ts
{
  attemptId, testId, status,                 // 'submitted' | 'auto_submitted' | 'terminated'
  terminationReason?,                        // terminated only, e.g. 'max_strikes'
  strikesCount, maxStrikes,
  release: 'released' | 'pending' | 'withdrawn' | 'never',
  // only when release is 'released':
  detail: 'score' | 'sections' | 'full',
  score, max, pct, durationSec,
  rank?: { rank, total },                    // only when the student's row is on the test board and the board is open
  sections?: Array<{ sectionId: string | null, name, score, max, correct, incorrect, unanswered }>,  // 'sections' and 'full'
  review?: Array<{ questionId, sectionId, prompt, options: Array<{ id, text }>, chosenOptionId: string | null,
                   correctOptionIds: string[], marks, explanation? }>,                                 // 'full' only
}
```

- Unless `release` is `released`, the body has none of `score`, `max`, `pct`, `durationSec`, `rank`, `sections` and
  `review`.
- `sections` is in section order; questions in no section of a sectioned test are one entry with `sectionId: null` and
  name `Other questions`; a test without sections has an empty `sections` array.
- `review` lists every drawn question in exam order with options in the order the student saw them; `marks` is the
  marks gained (positive), lost (negative) or 0; `explanation` is present only for questions that have one (SER-10).
- The keys `correctOptionIds` and `explanation` and any explanation text appear only in `review`, so only when the
  detail is `full` and the results are released (DATA-05). The dashboard, history and leaderboards never contain them.

**History** (`GET /v1/student/history`, US-ST-08, RES-04):

```ts
{
  series: Array<{ id, title, tests: Array<{
    testId, title, dayLabel: string | null, scheduledDate, attemptId, status,
    scoreState: 'shown' | 'hidden' | 'pending' | 'withdrawn' | 'never',
    score?, max?,                            // only when scoreState is 'shown'
  }> }>
}
```

Every finished attempt (`submitted`, `auto_submitted`, `terminated`; not `in_progress` or `reset`) of the student's own
organization, grouped by series (newest series start date first), tests in scheduled order (date, then day order).
`scoreState` is `shown` when the results are released and `showPastScores` is on; `hidden` when they are released and
`showPastScores` is off; otherwise the release state (`pending`, `withdrawn`, `never`).

**Board** (`GET /v1/leaderboards/{boardId}`, LB-05, US-ST-09):

```ts
{
  boardId, kind: 'test' | 'series', title,   // the test heading or the series title
  computedAt: number | null, total,          // total = number of ranked rows
  max?,                                      // test boards: the test's total marks
  rows: Array<{ rank, name, department, score, timeSec }>,   // department = the department's name (DECISIONS Q28)
  me: { rank, name, department, score, timeSec } | null,     // students: their own row, or null; admins: null
}
```

For a student `rows` holds the first 50 ranked rows; for an admin every row. A board not computed yet has
`computedAt: null` and no rows.

## Leaderboards (LB-01 to LB-05)

Stored as one record per board, `organizations/{orgId}/leaderboards/test_<testId>` and `…/series_<seriesId>`, with
`computedAt` and `rows: [{ studentId, name, departmentId, score, rank, timeSec }]` in rank order (spec 10.1).

- **Test board** (LB-01): every finished attempt of the test except `terminated` (and `reset`) attempts (PR-10,
  DECISIONS Q23). Ordered by higher score, then shorter time taken (`timeSec` = the result's `durationSec`), then
  earlier submission. Rows equal on all three (submission compared in whole seconds) share a rank, and the next rank
  skips (1, 2, 2, 4); rows sharing a rank are listed by name.
- **Series board** (LB-02): one row per student with at least one counted attempt in the series. A counted attempt is a
  test board row (so terminated attempts never count) of a test whose results are public. `score` is the sum of the
  student's counted scores (a test not taken counts 0), `timeSec` the sum of their times; higher total first; equal
  totals share a rank; ties listed by name.
- **Recompute** (LB-03): a finished attempt queues `/tasks/leaderboard` with payload `{ orgId, testId, seriesId }`, named
  `leaderboard-<orgId>-<testId>-<slot>` and scheduled at the end of its 30-second slot (DECISIONS 2026-10-18), so every
  finish within one slot shares one recompute; Release results, Withdraw results and the release task queue one more,
  due at once. Each run recomputes the test board and its series board.
- **Open to students** (LB-04): a test board when `public_leaderboards` is on, the resolved `testLeaderboard` is on and
  the results are public (released, and in a flexible window only after the window end); a series board when
  `public_leaderboards` is on, the series default `seriesLeaderboard` is on and at least one of its tests has public
  results. Only students the series (and, for a test board, the test) admits, or who have an attempt on it, see it.
  Admins always see every board (LB-05).

## Test-only scenarios (`POST /__test/seed/:scenario`)

Earlier scenarios stay as they are, except that `exam-test` with `publish` now also queues the release task, as
publishing does. Seeds write directly: no audit entries, no leaderboard task and no computed board unless stated.
Phase 4 adds:

| Scenario | Body | Creates | Returns |
| --- | --- | --- | --- |
| `more-students` | `{ orgId, count }` | Registered students numbered 21 to 20 + `count` in that org, made exactly like the base seed's: ID `stu-<orgId>-NN`, email `studentNN@a.test` (`@b.test` in org B), name `Student NN`, PRN `220101NN` (`B220101NN` in org B), department number n of the org's list taken in order and cycling (`departments[(n − 1) mod length]`), graduation year 2026 for odd and 2027 for even numbers, profile complete, consent given, whitelist entry `registered` | `{ studentIds: string[] }` |
| `graded-attempts` | `{ orgId, testId, attempts: Array<{ studentId, score, timeSec, status?, submittedAt?, strikesCount?, terminationReason?, correct?, incorrect?, unanswered? }> }` | For each entry one finished attempt of that test: `status` (default `submitted`; `auto_submitted` and `terminated` allowed), `seriesId` of the test, `startedAt` the test's resolved window start, `submittedAt` (default `startedAt + timeSec × 1000`), `deadlineAt` the window end, `extraTimeSec: 0`, `strikesCount` (default 0), `terminationReason` (default `max_strikes` when terminated), `draw` holding the test's approved questions in order with their stored option order, and `result { score, max: the test's totalMarks, pct: score / max × 100, sections: {}, correct, incorrect, unanswered (default 0), durationSec: timeSec }`; plus its `attemptIndex/{testId}_{studentId}` entry; the test gets `attemptsStarted: true`. No answer records | `{ attemptIds: string[] }` in input order |

## Student pages

### Student top bar (addition)

The student top bar's `banner` gains a `navigation` exactly `Main` with `link`s exactly `Tests` (`/student/`),
`History` (`/student/history/`) and `Leaderboards` (`/student/leaderboards/`); the link of the page shown carries
`aria-current="page"`. The exam screen keeps its own top bar without it.

### Dashboard and submitted screen (additions)

- A `Completed` item's test heading becomes a `link` named exactly the heading, to
  `/student/result/?attempt=<attemptId>`. Its status word stays.
- The submitted screen (`/exam/submitted/?attempt=`, both `Test submitted` and `Your test was ended`) shows a `link`
  exactly `See your result` to `/student/result/?attempt=<attemptId>` whenever the result is released to the student.

### Result page: `/student/result/?attempt=<attemptId>` (US-ST-07, RES-02, RES-03, RES-06, SER-10)

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly the test heading |
| Result | `region` | exactly `Your result`, shown only when released; holds the texts exactly `<score> / <max>` (in `display-1` numerals) and `<pct>%`, the line exactly `<time taken>, <strike summary>` (`12 minutes, 1 strike`), and the rank line (below) |
| Rank | text in `Your result` | exactly `Rank <n> of <total>` when the test leaderboard is on, the board is open and the attempt is on it; exactly `Your rank will be shown after the window closes at <HH:mm> IST.` while the test leaderboard is on but a flexible window is still open; exactly `Not ranked, because the test was ended.` for a terminated attempt when the test leaderboard is on; nothing when the test leaderboard is off |
| Sections | `table` | exactly `Section scores`, for detail `sections` and `full` in a sectioned test; columns `Section`, `Score`, `Correct`, `Wrong`, `Skipped`; one row per section in order (first cell the section name; `Other questions` for questions in no section); `Score` reads `<score> / <max>` |
| Review link | `link` | exactly `Review answers`, detail `full` only, to `#answer-review` on the same page |
| Review | `heading` level 2 and `list` | the heading exactly `Answer review` (with `id="answer-review"`), then a `list` exactly `Answer review` with one `listitem` per question in exam order (below); detail `full` only |
| Terminated | `heading` level 2 and text | for a terminated attempt, whether or not the results are released: the heading exactly `Your test was ended` and the text exactly `Reason: You reached the maximum of <max> strikes.` (`terminationReason: "max_strikes"`; another reason reads `Reason: <reason>`) |
| Pending | text | exactly `Results will be released after the window closes at <HH:mm> IST.` (`after_close`) or `Your placement cell will release the results.` (`manual`) |
| Never | text | exactly `Results for this test are not shared with students.` |
| Withdrawn | `heading` level 2 and text | the heading exactly `Results are being reviewed` and the text exactly `Your placement cell is checking these results. They will be shown here again once the review is done.` |
| Back | `link` | exactly `Back to your tests`, to `/student/` |
| In progress | text and `link` | exactly `This test is still in progress.` and a `link` exactly `Resume test` to `/exam/?attempt=<attemptId>` |
| Not found | | for an attempt that is not the student's own or is in another organization: `heading` level 1 exactly `Result not found`, text exactly `This result doesn't exist or isn't yours.`, `link` exactly `Back to your tests`. Nothing of the attempt is shown |

Unless the results are released the page shows no score, percentage, rank, section table or review.

Review items (`listitem` of `Answer review`), each holding, in order:

- `heading` level 3 exactly `Question <n>`;
- the prompt, rendered as on the exam screen;
- the text exactly `Your answer: <letter>. <option text>` or `Your answer: none`, letters following the order the student
  saw (A for the first option shown);
- the text exactly `Correct answer: <letter>. <option text>`;
- exactly one verdict word `Correct`, `Wrong` or `Skipped`, with an icon (not colour alone);
- the text exactly `Marks: <marks>` (`Marks: +1`, `Marks: −0.25`, `Marks: 0`);
- only when the question has an explanation: `heading` level 4 exactly `Explanation`, followed by the explanation
  (SER-10). A question without one has no `Explanation` heading.

### History: `/student/history/` (US-ST-08, RES-04)

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Your history` |
| Series | `heading` level 2 and `table` | per series of the history, the heading exactly the series title, then a `table` named exactly the series title, columns `Day`, `Test`, `Date`, `Status`, `Score`; one row per attempt in the history's order |
| Row | `row` | `Day` the day label (empty when hidden); `Test` a `link` named exactly the test title, to `/student/result/?attempt=<attemptId>`; `Date` the scheduled date (`2 Nov 2026`); `Status` the status word; `Score` exactly `<score> / <max>` (`shown`), `Not shown` (`hidden`), `Not released yet` (`pending`), `Being reviewed` (`withdrawn`) or `Not shared` (`never`) |
| Empty | test ID `empty-state` | exactly `You haven't finished any tests yet. Your results will be listed here.` and one action `See your tests` (a link to `/student/`) |

### Leaderboards: `/student/leaderboards/` and `/student/leaderboards/?board=<boardId>` (US-ST-09, LB-04, LB-05)

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Leaderboards` |
| Boards | `list` | exactly `Open leaderboards`; one `listitem` per board open to the student, holding a `link` named exactly the board title (series title or test heading) to `/student/leaderboards/?board=<boardId>` and the text `Series leaderboard` or `Test leaderboard` |
| Empty | test ID `empty-state` | exactly `No leaderboards are open yet. They open once results are released.` and one action `See your tests` (a link to `/student/`) |
| Feature off | text | with `public_leaderboards` off, exactly `Leaderboards aren't available in your organization.` instead of the list |
| Board heading | `heading` level 1 | exactly `<board title> leaderboard` (`Day 1: Quantitative aptitude leaderboard`, `Placement 2026 leaderboard`) |
| Own rank | text | exactly `You are ranked <n> of <total>.`, or `You are not on this leaderboard.` |
| Table | `table` | exactly `Leaderboard`; test boards: columns `Rank`, `Name`, `Department`, `Score`, `Time taken` (`Score` `<score> / <max>`); series boards: columns `Rank`, `Name`, `Department`, `Total` (`Total` the summed score). The first 50 ranked rows, then the student's own row when it is not among them |
| Own row | `row` | carries `aria-current="true"`, its `Name` cell reads exactly `<full name> (you)`, and its cells have the `ballpoint-wash` background `rgb(230, 233, 251)` (light theme); no other row has any of the three |
| Not open | | for a board not open to the student: `heading` level 1 exactly `Leaderboard not available`, text exactly `This leaderboard isn't open to you.`, `link` exactly `Back to leaderboards` to `/student/leaderboards/` |

## Admin pages

The sidebar `Main` navigation gains a link exactly `Results` to `/admin/results/`, after `Series`. Every phase 4 admin
page meets the phase 1 shell rules and has no serious axe violation.

### Results list: `/admin/results/`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Results` |
| Tests | `table` | exactly `Tests`; columns `Test`, `Series`, `Date`, `Results`; one row per published test (stored status `scheduled`), newest date first; first cell a `link` named exactly the test heading to `/admin/results/?test=<testId>`; `Results` exactly `Released`, `After the window closes`, `Waiting for release`, `Withdrawn` or `Not shared` |
| Series | `table` | exactly `Series`; columns `Series`, `Tests`; one row per series with a published test; first cell a `link` named exactly the series title to `/admin/results/?series=<seriesId>` |
| Empty | test ID `empty-state` | exactly `No published tests yet. Publish a test to see its results here.` and one action `Go to series` (a link to `/admin/series/`) |

### Test results: `/admin/results/?test=<testId>`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Results for <test heading>` |
| Release | `region` | exactly `Result release`, holding one state text, exactly: `Released to students.`; `Results will be released after the window closes at <HH:mm> IST.`; `Waiting for you to release the results.`; `Results for this test are not shared with students.`; or `Withdrawn. Students see that their results are being reviewed.` |
| Release results | `button` in `Result release` | exactly `Release results`; shown unless the results are released or the setting is `never`. Disabled (`aria-disabled="true"` or `disabled`) in the SER-09 case (flexible window, full review, window still open), with accessible description exactly `A full review can't be released before the window closes at <HH:mm> IST, because students who haven't started would see the answers.` Opens `alertdialog` exactly `Release results?` holding the text `Students will see their results as soon as you release them.`, with confirm `Release results`; afterwards a `status` exactly `Results released` |
| Withdraw results | `button` in `Result release` | exactly `Withdraw results`; shown only while released. Opens `alertdialog` exactly `Withdraw results?` with the destructive confirm `Withdraw results`; afterwards a `status` exactly `Results withdrawn` |
| Export | `region` | exactly `Export results` (below) |
| Leaderboard | `heading` level 2 and `table` | the heading exactly `Leaderboard`, then a `table` exactly `Leaderboard` with columns `Rank`, `Name`, `Department`, `Score`, `Time taken` and **every** ranked row (LB-05); while no row exists, the text exactly `No ranked attempts yet. The leaderboard fills in as students submit.` With `public_leaderboards` off, the text exactly `Not included in your organization's plan` in place of the table |
| Not found | | another organization's test: `heading` level 1 exactly `Test not found`, text exactly `This test doesn't exist in <org name>.`, `link` exactly `Back to results` to `/admin/results/` |

### Series results: `/admin/results/?series=<seriesId>`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Results for <series title>` |
| Export | `region` | exactly `Export results` (below) |
| Leaderboard | `heading` level 2 and `table` | as on the test page, with the series board's columns `Rank`, `Name`, `Department`, `Total` and every row |
| Not found | | `heading` level 1 exactly `Series not found`, text exactly `This series doesn't exist in <org name>.`, `link` exactly `Back to results` |

### Export results region (US-AD-14, EXP-01 to EXP-03)

| What | Role | Name or text |
| --- | --- | --- |
| Formats | `button`s | exactly `Export CSV` and `Export XLSX`. With `results_export` off both are disabled with accessible description exactly `Not included in your organization's plan` (FF-03) |
| Progress | `status` in the region | exactly `Preparing your export` while the export is queued or running, then exactly `Your export is ready.` |
| Download | `link` in the region | exactly `Download CSV` or `Download XLSX`, its `href` the absolute signed link of `GET /v1/exports/{id}`, opening in the same tab (no `target`), so pressing it downloads the file; next to it the text exactly `This link works for 15 minutes.` |
| Failed | `alert` in the region | exactly `The export failed. Try again.` |

Pressing a format button calls `POST /v1/exports` (with an `Idempotency-Key`), which stores
`organizations/{orgId}/exports/{exportId}` `{ orgId, scope, refId, format, status, createdBy, createdAt }`, writes
the audit entry `results.export` (target `{ type: "test" | "series", id: refId }`, `after.format`, `after.exportId`)
in the same batch, and queues `/tasks/export` with payload `{ orgId, exportId }`. The worker builds the file, saves it to
Storage at the export's `filePath` and sets `status: "ready"` (EXP-03). The page polls `GET /v1/exports/{id}` until it is
ready. File names: `results-<testId>.csv` / `.xlsx` and `series-results-<seriesId>.csv` / `.xlsx`.

**Files.** CSV is UTF-8 with a byte order mark, comma-separated with RFC 4180 quoting, header row first. XLSX holds the
same tables, numbers as numeric cells and every other value as text. Numbers have no grouping and a `.` decimal point;
`Percentage` is rounded to two decimals (`17.5`); an empty value is an empty cell. Times read `yyyy-MM-dd HH:mm:ss` in
the organization's timezone.

**Test export** (EXP-01): one row per attempt of the test that is not `reset`, ranked rows first in rank order (ties by
name), then the rest by name. Columns, exactly and in this order (section columns only in a sectioned test, one per
section in section order):

`Name`, `Email`, `PRN`, `Department` (the department's name), `Graduation year`, `Status` (status word), `Score`,
`Maximum`, `Percentage`, `Rank` (empty when not on the board), `<section name> score`…, `Correct`, `Incorrect`,
`Unanswered`, `Started at (IST)`, `Submitted at (IST)` (empty while in progress), `Time taken (seconds)` (the result's
`durationSec`), `Strikes`, `Termination reason` (`Maximum strikes reached` for `max_strikes`, else the stored reason;
empty when not terminated), `Extra time (minutes)` (`extraTimeSec / 60`).

The XLSX has one sheet named exactly `Results` with that table.

**Series export** (EXP-02): one row per student with a finished attempt in the series, series-board rows first in rank
order, then the others by name. Columns, exactly: `Name`, `Email`, `PRN`, `Department`, `Graduation year`, one column per
test of the series in scheduled order named exactly its heading (`Day 1: Quantitative aptitude`) holding the student's
counted score (empty when not taken or not counted), `Total` (the sum, a test not taken counting 0), `Rank` (the series
board rank; empty when not on the board). The XLSX has a first sheet named exactly `Series` with that table, then one
sheet per test in scheduled order holding that test's export table, named by the test heading with each of
`: \ / ? * [ ]` removed, runs of spaces collapsed to one and cut to 31 characters (`Day 1 Quantitative aptitude`).

## Audit actions

| Action | Target | Notes |
| --- | --- | --- |
| `test.results.release` | test ID | `after.resultsReleasedAt` |
| `test.results.withdraw` | test ID | |
| `results.export` | `{ type: "test" \| "series", id }` | `after.format`, `after.exportId` |

The release task writes no audit entry (it is not an admin action).

## Unit and integration tests the build must add

These REQs are verified below the browser. The builder writes them beside the code (Vitest; integration tests on the
emulators), each test title starting with its REQ IDs. Functions are exported from `packages/shared`
(`@mitaoe/shared`) with these exact names.

```ts
// leaderboard.ts
export interface RankableAttempt {
  studentId: string; name: string; departmentId: string;
  status: AttemptStatus; score: number; timeSec: number; submittedAt: number;
}
export interface LeaderboardRow { studentId: string; name: string; departmentId: string; score: number; rank: number; timeSec: number }
export function rankTest(attempts: ReadonlyArray<RankableAttempt>): LeaderboardRow[];
export interface SeriesLeaderboardRow extends LeaderboardRow { scores: Record<string, number | null> }  // per testId; null = not counted
export function rankSeries(tests: ReadonlyArray<{ testId: string; attempts: ReadonlyArray<RankableAttempt> }>): SeriesLeaderboardRow[];
export function studentBoardView<T extends { studentId: string }>(rows: ReadonlyArray<T>, studentId: string, top?: number): { rows: T[]; me: T | null };
export const LEADERBOARD_PAGE_ROWS = 5000;
export function leaderboardPages<T>(rows: ReadonlyArray<T>): T[][];

// release.ts
export type ReleaseState = 'released' | 'pending' | 'withdrawn' | 'never';
export interface ReleaseInput {
  settings: Pick<Settings, 'resultRelease' | 'resultDetail' | 'timingMode' | 'window'>;
  resultsReleasedAt?: number | null; resultsWithdrawn?: boolean;
}
export function resultReleaseState(input: ReleaseInput): ReleaseState;
export function resultsPublic(input: ReleaseInput, now: number): boolean;
export function manualReleaseRefusal(input: ReleaseInput, now: number): null | 'RESULTS_NOT_RELEASABLE' | 'FULL_REVIEW_BEFORE_CLOSE';
export function releaseResultsTask(input: { orgId: string; testId: string; windowEnd: number }): TaskRequest<{ orgId: string; testId: string }>;

// exports.ts
export function testExportColumns(sections: ReadonlyArray<{ name: string }>, zone: string): string[];
export function seriesExportColumns(testHeadings: ReadonlyArray<string>): string[];
export function xlsxSheetName(heading: string): string;
```

| REQ | Kind | Behaviours the tests must show |
| --- | --- | --- |
| LB-01 | unit | `rankTest`: higher score first, then lower `timeSec`, then earlier `submittedAt`; rows equal on score, `timeSec` and submission second share a rank and the next rank skips (scores 10, 8, 8, 5 with equal times and seconds give ranks 1, 2, 2, 4); equal score with a shorter time ranks higher; equal score and time with a later submission ranks lower; `terminated`, `reset` and `in_progress` attempts are left out; an empty input gives no rows; ties are listed by name |
| LB-02 | unit | `rankSeries`: a student's score is the sum over the tests; a test the student did not take counts 0 and its `scores` entry is `null`; a terminated attempt counts nothing (its entry `null`) and a student whose only attempts are terminated gets no row; equal totals share a rank (1, 2, 2, 4); `timeSec` is the sum of counted times |
| DATA-04 | unit | 2,000 rows with 60-character names serialized as JSON are under 1 MiB (1,048,576 bytes); `leaderboardPages` returns one page for up to `LEADERBOARD_PAGE_ROWS` rows and splits 12,001 rows into pages of at most 5,000 in order, losing none; `studentBoardView` returns the first 50 rows and `me` (the student's row whether inside or outside the top 50, `null` when absent) |
| RES-01 | integration | on the emulators with the test clock: `immediate` results are released at submit; `after_close` stay `pending` until the `/tasks/release-results` task runs at window end, which stores `resultsReleasedAt` (before the window end, for another mode, for a released or withdrawn test it changes nothing, and twice equals once); `manual` waits for `POST /release`; `never` refuses it (`409 RESULTS_NOT_RELEASABLE`); `resultReleaseState`, `resultsPublic` and `manualReleaseRefusal` unit-tested on every mode, including `FULL_REVIEW_BEFORE_CLOSE` before and not after a flexible window's end, and `releaseResultsTask` naming and scheduling |
| LB-03 | integration | the leaderboard handler writes `leaderboards/test_<testId>` and `series_<seriesId>` with `computedAt` and the ranked rows; finishes within one 30-second slot enqueue one task (`leaderboard-<orgId>-<testId>-<slot>`), a finish in the next slot a second; Release results, Withdraw results and the release task each queue a recompute; running a handler twice stores the same rows (REL-04) |
| LB-04 | integration | `GET /v1/leaderboards/{boardId}` for a student is `404 LEADERBOARD_NOT_AVAILABLE` while the test leaderboard is off, the results are pending, withdrawn or never shared, or a flexible window is open, and `200` once open; for a series board while `seriesLeaderboard` is off or no test has public results; an admin gets `200` with every row in all those cases; `403 FEATURE_DISABLED` with `public_leaderboards` off |
| SER-10 | integration | `GET /v1/student/results/{id}` with a released full review holds `explanation` only on the review entries of questions that have one; with detail `score` or `sections`, or results not released, the body has no `review`, `correctOptionIds` or `explanation` (DATA-05) |
| EXP-01 | integration | the export builder for a test (worker) writes CSV and XLSX with exactly the columns above in order, including one section column per section, the status words, ranks matching `rankTest`, IST times and `Maximum strikes reached`; `testExportColumns` unit-tested |
| EXP-02 | integration | the series export has one row per student with a finished attempt, per-test score columns (empty for not taken or terminated), `Total` and `Rank` matching `rankSeries`; the XLSX has `Series` then one sheet per test named by `xlsxSheetName` (unit-tested: forbidden characters removed, spaces collapsed, at most 31 characters) |
| EXP-03 | integration | `POST /v1/exports` only queues `/tasks/export` (the API process builds nothing); the worker handler stores the file and `status: "ready"`, and a second run changes nothing (REL-04); signed links expire 15 minutes after issue on the Clock; `results.export` is written in the same batch as the export record |

Also: every new admin route (`POST /v1/tests/{id}/release`, `POST /v1/tests/{id}/withdraw-results`, `POST /v1/exports`,
`GET /v1/exports/{id}`, `GET /v1/leaderboards/{boardId}`) is in the phase 0 route-table tests (ORG-05 404 for org B,
ORG-14 with an admin token and with a super-admin token plus `X-Org-Id`), and DATA-05's integration test adds
`GET /v1/student/results/{id}`, `GET /v1/student/history` and `GET /v1/leaderboards/{boardId}` to the student routes
it walks.

## Test IDs

| Test ID | Where | Why not a role |
| --- | --- | --- |
| `empty-state` | history, leaderboards and results list empty states (phase 1 convention) | one sentence and one action, no distinct role |
