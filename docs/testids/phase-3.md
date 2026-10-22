# Phase 3 test contract: exam engine

The phase 3 acceptance tests (tests/acceptance/phase-3/) find elements through the page objects in
tests/acceptance/pages/, by role and accessible name. The implementation must expose exactly these names. The phase 0,
1 and 2 contracts (docs/testids/phase-0.md, phase-1.md, phase-2.md) stay valid, including every convention listed there
(exact names, `(required)` labels, field errors, confirmation `alertdialog`s with focus on `Cancel`, en-IN numbers,
`d MMM yyyy` dates, 24-hour `HH:mm` times in the organization's timezone named `IST` for `Asia/Kolkata`). In
particular the exam screen of phase 2 (`/exam/?preview=<testId>`) is the same screen students get here: its names
(`Question <n> of <total>`, `Answer options`, `<letter>. <option text>`, `Previous`, `Mark for review`,
`Clear answer`, `Save and next`, `Question palette`, `Question <n>, <state>`) carry over unchanged into attempt mode.

Further conventions for phase 3:

- **Times shown to students** are in the organization's timezone, never the browser's, and every time a student acts
  on names the zone (UX-11, TST-07). Tests run some pages with the browser set to `America/New_York` to prove it.
- **Windows** read `<d MMM yyyy>, <HH:mm> to <HH:mm> IST` (`2 Nov 2026, 10:00 to 11:00 IST`). A window whose end
  falls on another date in the organization's timezone reads `<d MMM yyyy>, <HH:mm> to <d MMM yyyy>, <HH:mm> IST`.
- **Countdowns** on student pages (`timer` role) read `HH:MM:SS` below one day, `1 day HH:MM:SS`, and
  `<n> days HH:MM:SS` from two days.
- **The exam timer** (`timer` role) reads `MM:SS` below one hour (`41:58`, `09:59`) and `H:MM:SS` from one hour
  (`1:00:00`). The per-question timer reads `M:SS` (`0:20`).
- **Marking** reads `+<marks> for a correct answer, −<negative> for a wrong answer, 0 for no answer`, with `0` in place
  of `−<negative>` when nothing is taken off (`+1 for a correct answer, 0 for a wrong answer, 0 for no answer`). The
  minus is U+2212; numbers use en-IN (`0.25`).
- **"Disabled"** means the `disabled` attribute or `aria-disabled="true"`.
- **Server time.** Every exam decision and every countdown uses the server's time: the client measures the offset from
  `X-Server-Time` (API-03) and shows `deadline − (device time + offset)` (EX-06). Tests move the device clock with
  Playwright's `page.clock` and the server clock with `POST /__test/clock { advanceMs }`, usually both by the same
  amount, so the two stay consistent.
- **The exam is one client-side session.** Going from the test page to preflight, the rules and the exam never reloads
  the document (client-side navigation), so what preflight loads (the face detector) is reused (PERF-05).

## Test clock

Phase 3 tests that run an exam leave the API's test clock **running from real time** (as `POST /__test/reset` leaves
it), so the browser's clock and the server's agree and preflight's clock check passes. Scenario windows are set
relative to the clock's current time (`opensInMin`, below). `POST /__test/clock { advanceMs }` must move a running
clock forward and keep it running; the API forwards the change to the worker, and the local task queue dispatches a task
as soon as the moved clock passes its schedule time. Dashboard tests that need fixed texts set the clock to
**2 Nov 2026, 09:30 IST** (`POST /__test/clock { nowMs: 1793592000000 }`) before seeding.

## Requests the tests send directly

As in phases 1 and 2, with real ID tokens; super admins add `X-Org-Id`. Error bodies follow API-01. Student routes
answer `403` to an admin or super-admin token and `404` (never `403`) for an attempt that is not the caller's own or is
in another organization. Admin routes answer `404` for a resource of another organization (ORG-05), the same `200` for
a super admin with `X-Org-Id` of the organization that holds it (ORG-11, ORG-14), and `403` to a student token.

`Idempotency-Key` (API-02) is required on `POST /v1/attempts` and `POST /v1/attempts/{id}/submit`; without it the API
answers `400 IDEMPOTENCY_KEY_REQUIRED`. A repeated key replays the stored response (same status, same body) for 24 hours.

| Request | Body | Expected |
| --- | --- | --- |
| `POST /v1/attempts` | `{ testId }` | `200` or `201`, the **exam payload** (below). Calling it again for the same test, with any key, returns the same attempt (same `attempt.id`, `deadlineAt` and question and option order) (EX-04). Concurrent calls create one attempt (DATA-02). `403 NOT_ELIGIBLE` for a student the series or test rules leave out (SER-08); `409 WINDOW_NOT_OPEN` before the start window; `409 WINDOW_CLOSED` after the last start time; `409 ATTEMPT_FINISHED` when the student's attempt is already submitted, auto-submitted or terminated; `404` for a test that is not `scheduled`, is in a series that is not `active`, or is in another organization |
| `GET /v1/attempts/{id}` | | `200`, the exam payload of that attempt, with the saved answers (EX-05); also for a finished (`submitted`, `auto_submitted`, `terminated`) and graded attempt, with `attempt.status` the finished status and still no answer key (DATA-05) |
| `PUT /v1/attempts/{id}/answers` | `{ answers: [{ questionId, optionId: string \| null, seq, clientTs, markedForReview? }], backlog, clockOffsetMs }` | `200` `{ saved: string[], stale: string[], rejected: [{ questionId, code }], serverTime }` (below); `409 ATTEMPT_FINISHED` once the attempt is finished; `429 RATE_LIMITED` beyond 10 saves per second per user, after a small burst (API-06) |
| `POST /v1/attempts/{id}/navigate` | `{ questionId }` | `200` `{ servedAt, serverTime }`; records the first serve time of a timed question (Q-12); later calls keep the first time |
| `POST /v1/attempts/{id}/events` | `{ type, clientTs, details }` | `200` `{ strikesCount, counted, status }` (below); `409 ATTEMPT_FINISHED` once finished; `429 RATE_LIMITED` beyond 5 reports per second per user (API-06) |
| `POST /v1/attempts/{id}/submit` | `{}`, or `{ reason: "time_up" }` when the client submits because time ran out | `200` `{ status, submittedAt }`; the attempt is graded (EX-17). `status` is `submitted`, or `auto_submitted` for `time_up`. A second submit replays or returns the same finished attempt (`200`, same `submittedAt`) |
| `POST /v1/tests/{testId}/pairing-token` | `{}` | phase 3 addition (Rules, "Phone pairing"): student only. `200` `{ attemptId, token, url, expiresAt }`; a repeat (same student, same test) returns the same `attemptId` with a new token; once `POST /v1/attempts` has started that attempt, the same `attemptId` again. Refusals, checked like a start and storing nothing (no `attemptIndex` entry, no `attemptOwners/{attemptId}`): `404` for a test of another organization or one that is not `scheduled`; `403 NOT_ELIGIBLE` for a student the rules leave out (SER-08); `403` for an admin or super-admin token (with or without `X-Org-Id`); `409 WINDOW_NOT_OPEN` before the start window and `409 WINDOW_CLOSED` after the last start time |
| `POST /v1/attempts/{id}/pairing-token` | `{}` | `200` `{ token, url, expiresAt }`, a new single-use pairing link valid for 5 minutes (PR-13); `url` is `http://localhost:3000/pair/?token=<token>` (the web origin plus `/pair/?token=`) |
| `POST /v1/pairing/redeem` | `{ token }`, no `Authorization` | `200` `{ customToken, orgId, testId, attemptId }`; `customToken`'s claims are `{ role: "device", orgId, attemptId }` (PR-14); `409 PAIRING_TOKEN_USED` for a used token, `410 PAIRING_TOKEN_EXPIRED` after 5 minutes, `404 PAIRING_TOKEN_INVALID` for an unknown one |
| `GET /v1/attempts/{id}/events` | | admin: `200` `{ items: [{ id, type, details, clientTs, serverTs, strikeNumber? }] }` in `serverTs` order (PR-11) |
| `GET /v1/student/dashboard` | | student: `200` `{ live: [], upcoming: [], completed: [] }`; `403` to an admin |
| `PATCH /v1/tests/{id}` | as in phase 2 | after any attempt has started (TST-06): a change to duration, timing mode, maximum strikes, marking, sections, draw, question time limits or the window start is `409 TEST_LOCKED` and stores nothing; a change to the five release and visibility settings (`resultRelease`, `resultDetail`, `showPastScores`, `testLeaderboard`, `seriesLeaderboard`) or a later window end in a flexible window is `200` |
| `POST`, `PATCH`, `DELETE /v1/tests/{id}/questions…`, `PUT …/questions/order` | as in phase 2 | `409 TEST_LOCKED` after any attempt has started |
| Worker `POST http://127.0.0.1:4001/tasks/auto-submit` | `{ orgId, attemptId }` (other payload fields optional) | `200` every time; finalizes once (REL-04) |

**Exam payload** (one response, PERF-03), for `POST /v1/attempts` and `GET /v1/attempts/{id}`:

```ts
{
  attempt: { id, testId, status, startedAt, deadlineAt, strikesCount, maxStrikes },
  questions: Array<{ id, sectionId: string | null, prompt, options: Array<{ id, text }>, images, timeLimitSec? }>,
                                                   // exam order, options in shown order (Q-06)
  sections: Array<{ id, name, order, instructions?, forwardOnly, durationMin? }>,
  answers: Record<questionId, { optionId: string | null, seq, markedForReview? }>,
  questionServedAt: Record<questionId, number>,
  serverTime: number,
  ...                                              // test title, day label and settings the screen needs
}
```

No student-facing response (`POST /v1/attempts`, `GET /v1/attempts/{id}`, answers, events, submit, dashboard) contains
the keys `correctOptionIds` or `explanation`, or any explanation text, before a full review is released (DATA-05).

**Answers** (EX-11, EX-13, Q-12): each answer is stored as `organizations/{orgId}/attempts/{attemptId}/answers/{questionId}`
with `optionId`, `seq`, `clientTs`, `serverTs`, `markedForReview` and `lateSync` when late. An answer whose `seq` is not
higher than the stored one is not written and is listed in `stale`. An answer with `clientTs` after `deadlineAt` is
rejected with code `AFTER_DEADLINE`; one with `clientTs` before `deadlineAt` arriving within 2 minutes after it is saved
with `lateSync: true` and a `late_sync` event is logged. On a timed question, an answer arriving more than its time limit
plus 2 seconds after its first serve time is rejected with `QUESTION_TIME_UP`, and one for a question never served with
`QUESTION_NOT_SERVED`. Each batch stores `sync: { backlog, clockOffsetMs, at }` on the attempt (OBS-03).

**Events** (PR-07, PR-08, PR-10, PR-11): every event is stored in `organizations/{orgId}/attempts/{attemptId}/events`
with `type`, `details`, `clientTs`, `serverTs` and, when it counted, `strikeNumber`. These types are strikes:
`fullscreen_exit`, `tab_hidden`, `window_blur`, `no_face`, `multiple_faces`, `phone_disconnected`, and `devtools` under
the `block_strike` policy. Other types (`devtools` under `block`, `context_menu`, `clipboard`, `print`, `late_sync`) are
logged only. A strike event less than 3 seconds (server time) after the last counted strike is logged but not counted
(`counted: false`). Counting increments `strikesCount` in a transaction and sets `lastStrikeAt`. The strike that reaches
`maxStrikes` terminates the attempt: `status: "terminated"`, `terminationReason: "max_strikes"`, graded `result`.

**Attempt record** (PLAN `Attempt`): `testId`, `seriesId`, `studentId`, `uid`, `status` (`in_progress`, `submitted`,
`auto_submitted`, `terminated`), `startedAt`, `deadlineAt`, `draw { questionIds, optionOrder, sections }`,
`questionServedAt`, `strikesCount`, `submittedAt`, `result { score, max, pct, sections: { [sectionId]: { score, max,
correct, incorrect, unanswered } }, correct, incorrect, unanswered, durationSec }`. `attemptIndex/{testId}_{studentId}`
holds `activeAttemptId`. The test record gets `attemptsStarted: true` with the first start.

**Deadlines** (spec 5.5): fixed slot, deadline = slot end; flexible with `full_duration`, deadline = `startedAt` +
duration; flexible with `hard_close`, deadline = min(`startedAt` + duration, window end). Starting checks the start
window of the timing mode (fixed slot: from slot start to slot start + late entry cutoff, both inclusive).

**Auto-submit task** (EX-16, DECISIONS Q18): starting enqueues one task with path `/tasks/auto-submit`, a name starting
`auto-submit-<attemptId>`, and `scheduleTime` = `deadlineAt` + 120 000 (2 minutes of late sync). When it runs on an
attempt still in progress it stores `status: "auto_submitted"`, `submittedAt` and the graded `result`; on a finished
attempt it changes nothing.

## Test-only scenarios (`POST /__test/seed/:scenario`)

Phase 1's `student-attempts` and phase 2's `authoring-series` and `authoring-test` stay as they are. Phase 3 adds:

| Scenario | Body | Creates | Returns |
| --- | --- | --- | --- |
| `exam-test` | `{ orgId, seriesId?, title?, company?, questions?, opensInMin?, windowMin?, timingMode?, durationMin?, overrides?, eligibility?, seriesEligibility?, seriesStatus?, sectionDraws?, testDraw?, publish? }` | A test ready to sit. Without `seriesId`, first a series `Placement 2026` with status `active` (or `seriesStatus`), dates covering the test's date, daily window 600 to 660, every system default and `eligibility` from `seriesEligibility` (default no restriction). Then a test like `authoring-test` (title `Quantitative aptitude` or `title`, company `TCS` or `company`, the `basic` (default), `sectioned` or `none` question set, `sectionDraws`, `testDraw`, test `eligibility` when given) whose `overrides` are: `window` from `opensInMin` minutes after the clock's current time (default `-2`, may be negative) lasting `windowMin` minutes (default 60); `timingMode` (default `fixed`); `durationMin` when flexible (default 60); `fullscreenRequired: false`, `cameraRequired: false`, `secondCamera: false`, `shuffleQuestions: false`, `shuffleOptions: false`; then everything in `overrides` on top. `scheduledDate` is the window start's date in the org timezone. With `publish` (default `true`) it is approved and published: status `scheduled`, `resolved` snapshot, `totalMarks`. With `publish: false` it stays `in_review`. A second test in the same series is numbered by date like any other (TST-02) | `{ seriesId, testId, questionIds: string[] (in order), sectionIds: { [name]: id }, window: { start, end } }` |

So by default a test is live, in a fixed slot that began 2 minutes ago and ends in 58 minutes (inside the 15-minute late
entry cutoff), with proctoring that needs hardware switched off, shuffling off and the system default marking (+1, 0).
Proctoring tests switch on what they test through `overrides`.

## Student dashboard: `/student/` (US-ST-03, UX-11)

The phase 0 heading stays: `heading` level 1 exactly `Your tests`.

| What | Role | Name or text |
| --- | --- | --- |
| Next test | `region` | exactly `Next test`; present when a live or upcoming test exists. Holds a `link` named exactly the next test's heading (the live test with the earliest last start time, else the upcoming test that opens first) and its countdown `timer` (as in its list item), set in `display-1` numerals |
| Groups | `heading` level 2 and `list` | exactly `Live now`, `Upcoming`, `Completed`; each heading is followed by a `list` with the same name; a group with no tests is not shown |
| Live or upcoming item | `listitem` | a `link` named exactly the test heading (`<day label>: <title>`, or the title when the day label is hidden) to `/student/test/?id=<testId>`; the company; `Window: <window>`; `Duration: <n> minutes`; and a `timer`: named exactly `Opens in` (upcoming) counting to the window start, or `Last start in` (live) counting to the last start time |
| Completed item | `listitem` | the test heading and exactly one status word: `Submitted`, `Submitted automatically` or `Ended after strikes` |
| Empty state | test ID `empty-state` | exactly `No tests are open to you yet. Tests are offered by department and graduation year, so check that your profile is right.` and one action `Review your profile` (a link to `/profile/`) |

Order: live by last start time, upcoming by window start, completed newest first. The last start time is: fixed slot,
slot start + late entry cutoff; flexible `full_duration`, window end − duration; flexible `hard_close`, window end.

Only these are listed (SER-02, SER-04 to SER-06, US-AD-09): tests with stored status `scheduled` (live or upcoming by
the window and the server clock) in an `active` series of the student's own organization, for which `isEligible` holds
for the series rules and the test rules; and under `Completed`, every test the student has a finished attempt for. A
draft, in-review or approved test, a test in a draft or archived series, a test the rules leave out, a closed test the
student never sat, and anything of another organization never appear (nor in `GET /v1/student/dashboard`).

## Test page: `/student/test/?id=<testId>`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly the test heading |
| Details | `list` | exactly `Test details`, `listitem`s exactly: `Window: <window>`, `Duration: <n> minutes`, `Questions: <n>` (the draw size), `Sections: <name> (<n> questions), <name> (<n> questions)` or `Sections: none`, `Marking: <marking>`, `Maximum strikes: <n>`, `Last start: <HH:mm> IST` |
| Countdown | `timer` | `Opens in` (upcoming) or `Last start in` (live), as on the dashboard |
| Action | `link` | live with no attempt: exactly `Check your device`, to `/exam/preflight/?test=<testId>`; attempt in progress: exactly `Resume test`, to `/exam/?attempt=<attemptId>` |
| Upcoming | text | exactly `This test opens at <HH:mm> IST on <d MMM yyyy>.` and no action link |
| Finished | text | exactly `You have finished this test.` and no action link |
| Not found | | for a test the dashboard would not list (other org, not eligible, not published): `heading` level 1 exactly `Test not found`, text exactly `This test isn't available to you.`, `link` exactly `Back to your tests` to `/student/`. The same applies on `/exam/preflight/` and `/exam/rules/` |

## Preflight: `/exam/preflight/?test=<testId>` (EX-01, US-ST-04, PERF-05)

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Check your device` |
| Checks | `list` | exactly `Device checks`, one `listitem` per check below, in this order; each holds the check name, then exactly one status word `Checking`, `Passed` or `Failed` (with an icon, so not colour alone), then its detail or, when failed, its fix line |
| Recheck | `button` | exactly `Check again` |
| Continue | `link` or `button` | exactly `Continue to rules`, to `/exam/rules/?test=<testId>`; disabled until every check shown has passed |

| Check | Shown | Passes when | Detail when passed | Fix line when failed (exact) |
| --- | --- | --- | --- | --- |
| `Screen width` | always | viewport at least 1,024 CSS px wide | `<n> px wide`, n in en-IN (`1,024 px wide`) | `Use a screen at least 1,024 px wide. If you zoomed in, zoom out until this check passes.` |
| `Fullscreen` | `fullscreenRequired` | `document.fullscreenEnabled` | | `Your browser can't go fullscreen. Use current Chrome, Edge or Firefox.` |
| `Camera` | `cameraRequired` | camera permission granted and a video frame received (`getUserMedia` rejecting, for example `NotFoundError` or `NotAllowedError`, fails it) | | `Connect a camera and allow this site to use it, then press Check again.` |
| `Face detection` | `cameraRequired` | the self-hosted MediaPipe model and WASM loaded and analysed a camera frame (a face need not be in view) | | `Face detection didn't load. Reload the page, or use current Chrome or Edge.` |
| `Connection` | always | an API round trip succeeds | `Round trip <n> ms` | `Can't reach the exam server. Check your internet connection, then press Check again.` |
| `Clock` | always | the device clock is within 5 minutes of the server's | `Clock offset <n> s` (absolute whole seconds) | `Your computer's clock is off by more than 5 minutes. Set it to update automatically, then press Check again.` |
| `Browser` | always | current Chrome, Edge or Firefox, or Safari 17+ | | `Use current Chrome, Edge or Firefox, or Safari 17 or later.` |

The passed checks are kept for the browser session, so the rules screen knows them. MediaPipe's model and WASM files
are served from the web app's own origin: the model at `/mediapipe/models/blaze_face_short_range.tflite`, the WASM
files under `/mediapipe/wasm/` (PR-01), with `Cache-Control` holding `immutable` (PERF-05), and nothing is fetched from
any other host. They load during preflight and the exam screen does not request them again.

## Rules: `/exam/rules/?test=<testId>` (EX-02, PR-13)

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Exam rules` |
| Rules | `list` | exactly `Rules for this test`, `listitem`s exactly: `Duration: <n> minutes`; `Deadline: <HH:mm> IST` (fixed slot: slot end), `Deadline: <n> minutes after you start` (flexible, full duration) or `Deadline: <n> minutes after you start, and no later than <HH:mm> IST` (flexible, hard close); `Maximum strikes: <n>`; `Marking: <marking>`; `Sections: …` as on the test page |
| Privacy note | text | exactly `Camera video never leaves your device. Only proctoring events, such as leaving fullscreen, are sent to the server.` |
| Agreement | `checkbox` | exactly `I have read the rules and agree to follow them` |
| Start | `button` | exactly `Start test`. Enabled only when every preflight check has passed in this browser session, the agreement is ticked and, with a second camera, the phone is connected. While disabled its accessible description is exactly the first unmet condition: `Complete the device checks first.`, `Tick the agreement to start.`, `Connect your phone first.` |
| Device checks link | `link` | exactly `Check your device`, to the preflight, shown while the checks have not passed |

`Start test` calls `POST /v1/attempts` (with an `Idempotency-Key`), requests fullscreen in the same click when
`fullscreenRequired`, and opens `/exam/?attempt=<attemptId>`. Pressing it again on another visit resumes the same
attempt (EX-04).

**Phone pairing** (when `secondCamera` is on, PR-13, US-ST-04): the rules screen shows a `region` exactly
`Pair your phone` holding an `img` exactly `QR code to pair your phone` that encodes the pairing link, an element with
test ID `pairing-link` whose text is exactly that link (`http://localhost:3000/pair/?token=<token>`, so a student can
type it), the text exactly `This code works once and expires at <HH:mm> IST.` (5 minutes after it was issued), a
`status` whose text is exactly `Phone not connected` or `Phone connected`, and a `button` exactly `New code`. After
expiry the region shows `This code has expired.` until `New code` is pressed. Pairing happens before Start, so it
must not start the attempt's clock: the device token's `attemptId` is the attempt ID that `Start test` then opens, and
`startedAt` and the deadline are set by Start (phase 3 addition: `POST /v1/tests/{testId}/pairing-token` for a student
reserves that attempt ID on the attempt index, writes `attemptOwners/{attemptId}`, and returns `{ attemptId, token, url,
expiresAt }`; `POST /v1/attempts` then uses the reserved ID). **A reservation is not a started attempt**: it creates no
attempt record, leaves the test's `attemptsStarted` unset, does not trigger the TST-06 lock (locked settings still
save, and the Q-15 return to review still applies), and the test page still offers `Check your device`, not
`Resume test`. The attempt starts, and the lock applies, only with `POST /v1/attempts`.

## Exam screen in attempt mode: `/exam/?attempt=<attemptId>`

The phase 2 screen, with these differences. There is no preview note, no `Show answers` and no `Exit preview`.

| What | Role | Name or text |
| --- | --- | --- |
| Title | `heading` level 1 in the `banner` | exactly the test heading |
| Sync status | `status` | named exactly `Sync status`; text exactly `Saved`, `Saving`, `Offline, <n> answers waiting` (`Offline, 1 answer waiting`) or `Offline, no answers waiting`, with an icon (`svg`) beside the word; changes are announced politely (EX-12, A11Y-09, A11Y-14) |
| Strike tally | text in the `banner` | exactly `Strikes <n> of <max>` (tally strokes are decorative) |
| Timer | `timer` | named exactly `Time left`; never a live region (no `aria-live` other than `off`); its computed `color` is `redpen` `rgb(184, 50, 31)` below 10 minutes and not before (light theme) |
| Time announcements | `status` | named exactly `Time announcements`, in the `banner`, polite; empty until the first announcement, then visible. At 10, 5 and 1 minutes left its text becomes exactly `10 minutes left`, `5 minutes left`, `1 minute left`. Pressing `T` sets it to the time left: `<n> minutes left` (whole minutes, rounded down), `1 minute left`, or `<n> seconds left` under one minute (A11Y-06) |
| Phone status | text in the `banner` (second camera only) | exactly `Phone connected`, `Phone disconnected` or `Phone status unavailable` (the laptop itself can't reach Realtime Database) |
| Submit | `button` in the `banner` | exactly `Submit test`; opens the summary, never submits directly (UX-03) |
| Current section | test ID `current-section` | sectioned tests only: exactly the current question's section name |
| Question timer | `timer` | timed questions only: named exactly `Time left for this question`, `M:SS` |
| Mark for review | `button` | exactly `Mark for review`, a toggle with `aria-pressed` `true` while the question is marked |
| Save and next | `button` | the largest button on the screen, at the bottom right (UX-03) |
| Timing track | `navigation` | exactly `Timing track`, on the sheet's left edge, always visible; one `button` per question, named like the palette's; pressing one goes to that question |
| Palette | `navigation` | exactly `Question palette`. In a sectioned test its buttons are grouped in one `group` per section, named exactly the section name. Holds a `list` exactly `Palette legend` whose `listitem`s are exactly `Not visited`, `Not answered`, `Answered`, `Marked for review`, `Answered and marked for review`, `Locked`, each with a sample bubble (test ID `legend-sample`) drawn in that state |
| Palette drawer | `button` | below 1,280 CSS px of viewport width the palette is a drawer: a `button` exactly `Question palette` with `aria-expanded` opens it; `Escape` or choosing a question closes it; while closed the palette `navigation` is not visible. From 1,280 px the palette is a visible right rail and this button is absent (A11Y-15) |
| Shortcuts | `dialog` | exactly `Keyboard shortcuts`, opened by `?`, holding a `list` with `listitem`s exactly: `1 to 6 or A to F: choose an option`, `N: next question`, `P: previous question`, `M: mark for review`, `T: hear the time left`, `?: show these shortcuts` |
| Camera preview | `button` (laptop camera only) | exactly `Camera preview`, a toggle with `aria-expanded`; collapsing hides the self-view `video` but never stops the camera; there is no control that turns the camera off (PR-03) |

**Question states** (EX-07, A11Y-08). Track and palette buttons are named exactly `Question <n>, <state>`:

| State | Name |
| --- | --- |
| not visited (never shown) | `Question <n>, not visited` |
| visited without an answer | `Question <n>, not answered` |
| answered | `Question <n>, answered` |
| marked for review, no answer | `Question <n>, marked for review` |
| answered and marked | `Question <n>, answered, marked for review` |
| locked by its timer | `Question <n>, answered, locked` or `Question <n>, not answered, locked` |

The current question's buttons carry `aria-current` (`step` or `true`). Each state is drawn with a different shape,
fill pattern or icon, not colour alone: with every colour of the legend samples forced to black on white, the six
`legend-sample` bubbles still look different from one another (A11Y-14, UI-02). The exam opens on question 1, which then
counts as visited.

**Keys** (EX-09, A11Y-06), anywhere on the exam screen when no dialog is open, case-insensitive, ignored with Ctrl, Alt
or Meta: `1` to `6` and `A` to `F` choose the option at that position, `N` next, `P` previous, `M` toggles mark for
review, `T` announces the time left, `?` opens `Keyboard shortcuts`. The arrow keys move between options (radio group).

**Navigation** (EX-08): `Previous`, `Save and next`, the track and the palette move between questions and between
sections, except in a forward-only or timed section and with per-question timers (Q-11), where earlier questions can't
be opened: `Previous` is disabled and track and palette buttons of other questions are disabled (`aria-disabled`).

**Autosave** (EX-10, EX-12, US-ST-05): every answer change and mark is written to IndexedDB at once with a
per-question sequence number and an offset-corrected timestamp, then synced in batches (`PUT …/answers`). The exam
payload, the server offset and every local answer are kept in IndexedDB too, so reloading `/exam/?attempt=` while the
API can't be reached still shows the exam with every local answer and the waiting count. After a failed sync the status
reads `Offline, <n> answers waiting`; retries wait 1, 2, 4 and 8 seconds, then every 15 seconds, measured from each
failed attempt, without jitter; a success shows `Saved`; while a batch is in flight it reads `Saving`.

**Resume** (EX-05): opening `/exam/?attempt=<id>` again (or `Resume test`) shows the same attempt: the same questions in
the same order, every saved answer and mark, and the same deadline. An attempt that is not the student's own, or is in
another organization, shows `heading` level 1 exactly `Attempt not found`, text exactly
`This attempt doesn't exist or isn't yours.` and a `link` exactly `Back to your tests`. A finished attempt opens the
submitted screen. Admins and super admins who open `/exam/?attempt=` are sent to `/admin/` (or `/platform/`).

**Per-question timers** (Q-11): with `questionTimeMode` `same` or `each`, the client calls `POST …/navigate` when it
shows a question and shows `Time left for this question`. When it reaches zero the current answer is saved, the question
locks (`…, locked`) and the next question opens. `Save and next` also locks the question it leaves.

## Strike warnings and lockdown (PR-04 to PR-06, PR-09, US-ST-06, A11Y-09)

A strike warning is an `alertdialog` named exactly `Strike <n> of <max>`. It appears at once, before the API answers,
holding the reason; `n` is the server's count once the response arrives (until then the next number). It holds the
reason text exactly as below and the text exactly `<r> strikes left before the test ends.` (`1 strike left before the
test ends.`). `Escape` does not close it. It has one `button`, which has focus: exactly `I understand`, or for
`fullscreen_exit` exactly `Return to fullscreen`, which closes it and re-enters fullscreen (the blocking overlay of
PR-04). When several events arrive within 3 seconds, one warning shows the first event's reason. The strike tally then
reads `Strikes <n> of <max>`.

| Event type | Reason text (exact) |
| --- | --- |
| `fullscreen_exit` | `You left fullscreen.` |
| `tab_hidden` | `You switched to another tab or window.` |
| `window_blur` | `The exam window lost focus.` |
| `no_face` | `We couldn't see your face for more than 5 seconds.` |
| `multiple_faces` | `More than one face was in view.` |
| `devtools` | `Developer tools are not allowed.` |
| `phone_disconnected` | `Your phone camera was disconnected for more than a minute.` |
| `phone_in_view` | `A phone was seen in your camera.` |

When the response says `terminated`, the browser opens `/exam/submitted/?attempt=<id>` with `heading` level 1 exactly
`Your test was ended` and the text exactly `You reached the maximum of <max> strikes. Your answers so far have been graded.`

Lockdown on the exam screen (not in preview):

- `fullscreenRequired`: leaving fullscreen reports `fullscreen_exit` (PR-04).
- The window losing focus reports `window_blur` and the page becoming hidden reports `tab_hidden` (PR-05). The exam
  reacts to the `blur` event on `window` and the `visibilitychange` event on `document` (reading
  `document.visibilityState`), not to polling `document.hasFocus()`: Playwright keeps every Chromium tab visible and
  focused even when headed, so the tests send a tab switch as that event sequence (`blur`, `visibilitychange` hidden,
  `visibilitychange` visible, `focus`).
- `devtoolsPolicy`: under `block_strike`, `F12`, `Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+Shift+C` and `Ctrl+U` are
  prevented and report `devtools` (a strike); under `block` they are prevented and report `devtools` (logged only);
  under `allow` nothing is done. The context menu is prevented (and `context_menu` logged) under `block_strike` and
  `block`.
- Always (PR-06): `copy`, `cut` and `paste` events are prevented, `Ctrl+P` is prevented, printing (`@media print`)
  shows no question content, and question text and options can't be selected (`user-select: none`).

## Laptop camera (PR-01 to PR-03)

With `cameraRequired`, the exam keeps the camera on for its whole length and runs MediaPipe FaceDetector (BlazeFace
short range, self-hosted files as above) on the device every 500 ms. No face for more than 5 seconds is one incident
and reports one `no_face` strike; the incident lasts until a face is seen again, so a camera that never sees a face
records exactly one strike. More than one face for more than 2 seconds reports `multiple_faces`. No image, frame or
video ever leaves the browser: no request or WebSocket message carries image or video data.

## Submit (EX-15, EX-16)

| What | Role | Name or text |
| --- | --- | --- |
| Summary | `alertdialog` | exactly `Submit test?`, focus on `Cancel`, then `Submit test` to its right |
| Table | `table` | exactly `Answer summary`; columns `Section`, `Answered`, `Not answered`, `Marked for review`; one row per section, first cell exactly the section name, or one row `All questions` in a test without sections. Marked counts every marked question, answered or not |
| Offline | `status` in the dialog | exactly `You're offline. Your test will be submitted as soon as the connection returns.` while the submit can't reach the API; it keeps retrying |

Confirming first syncs every waiting answer, then calls `POST …/submit`: no submit request is sent while an answer
batch is unsent or in flight. When time runs out the client syncs and submits by itself with `{ reason: "time_up" }`.

**Submitted screen** `/exam/submitted/?attempt=<attemptId>`: `heading` level 1 exactly `Test submitted`; for
`auto_submitted` also the text exactly `Time ran out, so your test was submitted automatically.`; the release line
exactly `Results will be released after the window closes at <HH:mm> IST.` (`after_close`),
`Your placement cell will release the results.` (`manual`), `Results for this test are not shared with students.`
(`never`) or `Your result is ready.` (`immediate`); and a `link` exactly `Back to your tests`. Fullscreen is left.

## Phone pairing page: `/pair/?token=<token>` (PR-14 to PR-17)

Designed for phones first (390 px). The page first shows a `button` exactly `Start camera` and does nothing else, so
a QR scanner's preview never uses the link up. The tap redeems the token (`POST /v1/pairing/redeem`), signs in with the
custom token, turns the camera on, requests a screen wake lock (`navigator.wakeLock.request('screen')`), and writes
`presence/{orgId}/{testId}/{attemptId}/phone` `{ online: true, lastSeen: <server timestamp>, cameraOn: true, camera,
visible, session, stateSince }` with a heartbeat every 5 seconds, and `onDisconnect` setting `online: false`. `camera`
is `starting`, `live`, `paused` or `failed`; a muted or ended camera is reopened by the page. Every write carries the
pairing's `session`, which the database rules check against `proctor/{orgId}/{attemptId}/phoneSession`, so a phone
paired later replaces this one. A reload of the same link rejoins without a new code. When another phone takes over,
the page reads `Another phone is now the camera for this test. You can close this page.`; when the attempt ends,
`Your test has ended. You can close this page.` (both `status`), and the camera stops.

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Phone camera` |
| Connection | `status` | text exactly `Connecting`, `Connected` or `Reconnecting` |
| Help | `heading` level 2 | exactly `Position your phone`, followed by the positioning steps |
| Preview | `video` | the phone's own camera, playing |
| Refused | `alert` | exactly `This pairing link has already been used. Show a new code on your laptop and scan it again.` (used), `This pairing link has expired. Show a new code on your laptop and scan it again.` (expired) or `This pairing link isn't valid. Show a new code on your laptop and scan it again.` (unknown) |

No request or WebSocket message from the phone page carries image or video data (PR-17).

**On the laptop** (PR-16): the exam screen listens to the phone presence. When it shows `online: false` the banner
reads `Phone disconnected`; so does a phone whose camera is not `live` or whose record has not changed for more than
15 seconds. After more than 15 seconds a modal `dialog` exactly `Reconnect your phone` opens with the
text exactly `Your phone camera is disconnected. Scan this code with your phone to reconnect it.`, a fresh
`img` `QR code to pair your phone` and `pairing-link` (a new token); it closes by itself when the phone is back. When
the dialog opens the laptop reports one `phone_paused` event (logged only) with `{ offlineMs, stateSince, lastSeen }`;
the API queues `/tasks/phone-check` for when the outage reaches 60 seconds, and the worker, reading the presence
records itself, records one `phone_disconnected` strike if the phone had no healthy heartbeat since and the laptop is
online. The laptop shows the warning from `proctor/{orgId}/{attemptId}/strike`. While the laptop's own Realtime Database
connection is down (`.info/connected` false), the banner reads `Phone status unavailable`, and neither the overlay nor
a phone strike happens (REL-05); answers keep saving through the API.

**Laptop presence** (DATA-06): the exam screen writes `presence/{orgId}/{testId}/{attemptId}/laptop`
`{ online: true, lastSeen, fullscreen, visible }` with `onDisconnect` setting `online: false`, so closing the tab shows
offline at once.

## Unit and integration tests the build must add

These REQs are verified below the browser. The builder writes them beside the code (Vitest; integration tests on the
emulators, rules tests with `@firebase/rules-unit-testing`), each test title starting with its REQ IDs. Functions are
exported from `packages/shared` (`@mitaoe/shared`) with these exact names.

```ts
// timing.ts
export type StartRefusal = 'WINDOW_NOT_OPEN' | 'WINDOW_CLOSED';
export function lastStartAt(s: Pick<Settings, 'timingMode' | 'window' | 'durationMin' | 'lateEntryCutoffMin' | 'windowEndPolicy'>): number;
export function canStart(s: Pick<Settings, 'timingMode' | 'window' | 'durationMin' | 'lateEntryCutoffMin' | 'windowEndPolicy'>,
  now: number): { ok: true } | { ok: false; code: StartRefusal };
export function attemptDeadline(s: Pick<Settings, 'timingMode' | 'window' | 'durationMin' | 'windowEndPolicy'>,
  startedAt: number, extraTimeSec?: number): number;
export function sectionDeadline(sectionStartedAt: number, sectionDurationMin: number | undefined, attemptDeadline: number): number;

// scoring.ts
export interface ScoringQuestion { id: string; sectionId: string | null; correctOptionIds: string[]; marks: number; negativeMarks: number }
export function scoreAttempt(input: { questions: ReadonlyArray<ScoringQuestion>;
  answers: Readonly<Record<string, { optionId: string | null } | undefined>>; passingMarks?: number; floorAtZero?: boolean;
}): { score: number; max: number; pct: number; passed?: boolean; correct: number; incorrect: number; unanswered: number;
  sections: Record<string, { score: number; max: number; correct: number; incorrect: number; unanswered: number }> };

// strikes.ts
export const STRIKE_DEDUPE_MS = 3000;
export function isStrikeEvent(type: ProctorEventType, devtoolsPolicy: Settings['devtoolsPolicy']): boolean;
export function countsAsNewStrike(lastStrikeAt: number | undefined, now: number): boolean;

// sync.ts
export const LATE_SYNC_GRACE_MS = 120_000;
export const QUESTION_TIME_GRACE_MS = 2_000;
export function retryDelayMs(failures: number): number;              // 1 → 1000, 2 → 2000, 3 → 4000, 4 → 8000, 5+ → 15000
export function answerVerdict(input: { seq: number; storedSeq?: number; clientTs: number; serverNow: number; deadlineAt: number;
  servedAt?: number; timeLimitSec?: number }): 'saved' | 'late_sync' | 'stale' | 'AFTER_DEADLINE' | 'QUESTION_TIME_UP' | 'QUESTION_NOT_SERVED';
```

| REQ | Kind | Behaviours the tests must show |
| --- | --- | --- |
| Q-09 | unit | `scoreAttempt`: a correct answer adds the question's marks, a wrong one takes off its negative marks, an unanswered one (missing or `optionId: null`) scores 0; `max` sums the marks; `pct` is score over max × 100; section totals add up to the totals; `passed` is set only with `passingMarks` (`score >= passingMarks`); a negative total stays negative unless `floorAtZero` is true, and `floorAtZero` defaults to false |
| TST-08 | unit | `sectionDeadline` is the section start plus its duration but never later than the attempt deadline, and the attempt deadline itself without a section duration; also, for every timing mode, `canStart` (fixed slot inclusive from slot start to start + cutoff; flexible `full_duration` to window end − duration; `hard_close` strictly before window end; `WINDOW_NOT_OPEN` before, `WINDOW_CLOSED` after), `lastStartAt` and `attemptDeadline` (spec 5.5, with `extraTimeSec` added on top) |
| EX-03 | integration | `POST /v1/attempts` on the emulators: checks eligibility, the start window and an existing attempt; stores the attempt with the draw and `deadlineAt`; enqueues the auto-submit task (name, path, schedule time above); writes `attemptOwners/{attemptId}` and `live/…`; returns the exam payload validated by its response schema |
| EX-04 | integration | a second start (any key) returns the same attempt; a replayed key returns the stored response byte for byte |
| SER-08 | integration | eligibility is evaluated at start from the stored series and test rules and the student record: a student whose department or year was changed after the dashboard loaded, or who was added to the test's exclude list, gets `403 NOT_ELIGIBLE` |
| DATA-02 | integration | ten concurrent starts by one student for one test create exactly one attempt and one attempt index entry |
| DATA-05 | integration | every student-facing route's response schema strips `correctOptionIds` and `explanation`; a test walks start, resume, answers, events and submit and finds neither key in any body, then reads `GET /v1/attempts/{id}` again after the attempt is graded as `submitted`, `auto_submitted` and `terminated`, and `GET /v1/student/dashboard` with a graded attempt under `completed`, and finds neither key nor any explanation text |
| Q-06 | integration | the draw is made once, seeded by the attempt ID (the same ID gives the same draw and option order through shared `drawAttempt`), stored on the attempt with the option order, reused by resume and by grading |
| TST-06 | integration | after an attempt starts, the PATCH and question routes above answer `409 TEST_LOCKED` and store nothing; release and visibility settings and a later flexible window end still save |
| API-02 | integration | start and submit without `Idempotency-Key` are `400 IDEMPOTENCY_KEY_REQUIRED`; a repeated key within 24 hours (test clock) replays the stored status and body; after 24 hours it is treated as new |
| PERF-01 | integration | resolved settings and questions are cached in memory by test ID and `questionSetVersion`: a second start reads no question records, and a version bump is picked up |
| PERF-03 | integration | the start response alone holds everything the exam screen needs (questions, options in order, sections, settings, deadline, server time) |
| EX-11 | integration | `PUT …/answers` writes an answer only when its `seq` is higher than the stored one, in a per-record transaction; stale and reordered batches leave the newest answer |
| EX-13 | integration | answers with `clientTs` before the deadline arriving within 2 minutes after it are saved with `lateSync: true` and a `late_sync` event; after the deadline by timestamp they are rejected `AFTER_DEADLINE` |
| EX-14 | integration | every answer is its own record under `attempts/{id}/answers/{questionId}`; the attempt record is not rewritten per answer (apart from `sync`) |
| DATA-03 | integration | autosaves of different questions write different answer records |
| OBS-03 | integration | each batch's `backlog` and `clockOffsetMs` are stored on the attempt as `sync` and mirrored to `live/…` as `backlog` |
| API-06 | integration | per user: more than 10 answer saves or 5 event reports within a second (after the burst) get `429 RATE_LIMITED` (`@fastify/rate-limit`, keyed by uid) |
| EX-16 | integration | the auto-submit task finalizes an in-progress attempt as `auto_submitted` with no browser involved; it is idempotent; when `deadlineAt` was moved later (extra time, set directly in the test) it enqueues a new task for the new deadline and finalizes nothing |
| EX-17 | integration | grading reads the stored draw and the answer key (never the client's view), saves `result` on the attempt, and enqueues `/tasks/leaderboard` for the test |
| REL-04 | integration | each worker task handler run twice with the same payload has the same stored effect as once (auto-submit, and every phase 3 handler) |
| Q-12 | integration | `POST …/navigate` stores the first serve time in `questionServedAt`; answers after the limit plus 2 s are `QUESTION_TIME_UP`; unserved questions are `QUESTION_NOT_SERVED` |
| PR-07 | integration | strike events within 3 seconds of the last counted strike are logged with no `strikeNumber` and do not change `strikesCount` |
| PR-08 | integration | `POST …/events` increments `strikesCount` in a transaction (concurrent reports of separate incidents never lose a count) and returns the new count; the client's own count is never read |
| PR-10 | integration | the strike that reaches `maxStrikes` stores `terminated`, `terminationReason: "max_strikes"` and the graded result; later answers and events are `409 ATTEMPT_FINISHED`; a terminated attempt is left out of leaderboard rows (shared ranking input) |
| PR-11 | integration | every event, counted or not, is stored with `serverTs`, `clientTs`, `type` and `details`, and `GET …/events` returns them in order (admin, ORG-05 404, ORG-14 super admin) |
| PR-13 | integration | `POST /v1/tests/{testId}/pairing-token`: the refusals above (`404` other org or unpublished, `403 NOT_ELIGIBLE`, `403` for admin and super-admin tokens, `409 WINDOW_NOT_OPEN` and `WINDOW_CLOSED`) write no `attemptIndex` entry and no `attemptOwners`; a repeat returns the same `attemptId`; a reservation creates no attempt, leaves `attemptsStarted` unset and no TST-06 lock, and `POST /v1/attempts` then starts that same `attemptId`; tokens are single use and valid for 5 minutes on the Clock |
| PR-14 | integration | `POST /v1/pairing/redeem` returns a custom token with claims `{ role: "device", orgId, attemptId }`; a token is single use and expires after 5 minutes on the Clock |
| DATA-07 | rules | Realtime Database rules: no client may write `live`, `signals` or `attemptOwners` |
| DATA-10 | rules | a student writes `presence/{orgId}/{testId}/{attemptId}/laptop` only when `attemptOwners/{attemptId}` is their uid; a device token writes `…/phone` only for its `attemptId` claim and nothing else; admins read `live/{orgId}` and `presence/{orgId}` only for their own `orgId`; super admins read all; a student reads only `signals/{orgId}/{attemptId}` and the phone presence of their own attempt |

Also: the QR code on the rules screen and in `Reconnect your phone` encodes exactly the pairing link (a web unit test
decodes the rendered code), and every new admin route is in the phase 0 route-table tests.

## Test IDs

| Test ID | Where | Why not a role |
| --- | --- | --- |
| `empty-state` | dashboard empty state (phase 1 convention) | one sentence and one action, no distinct role |
| `current-section` | exam sheet header | a label line with no role |
| `legend-sample` | each sample bubble in `Palette legend` | a decorative drawing of a state |
| `pairing-link` | `Pair your phone` and `Reconnect your phone` | the link as plain text for typing on a phone |
