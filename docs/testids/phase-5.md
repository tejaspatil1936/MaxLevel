# Phase 5 test contract: live operations

The phase 5 acceptance tests (tests/acceptance/phase-5/) find elements through the page objects in
tests/acceptance/pages/, by role and accessible name. The implementation must expose exactly these names. The phase 0
to 4 contracts (docs/testids/phase-0.md to phase-4.md) stay valid, with every convention listed there: exact names,
`(required)` labels, field errors (visible text, `aria-invalid="true"`, the error in the field's accessible
description, shown after a save or confirm attempt), confirmation `alertdialog`s with focus starting on `Cancel` and the
confirm button to its right, `redpen` destructive confirm buttons (`rgb(184, 50, 31)`), en-IN numbers, `d MMM yyyy`
dates, 24-hour `HH:mm` times in the organization's timezone named `IST` for `Asia/Kolkata`, a notice after an action as
a `status` whose whole text is the notice, the phase 1 shell rules, the exam timer format (`MM:SS` below one hour,
`H:MM:SS` from one hour) and the phase 3 exam screen names. Phase 5 only adds to them, as listed below.

Further conventions for phase 5:

- **Server time.** The live view, its "time left" and "last seen" values, and every check of a deadline use the
  server's time (`X-Server-Time`, API-03), never the device clock alone.
- **Within 5 seconds** (OPS-02, OPS-06, US-AD-11, US-AD-12) is measured from the moment the API answers the request
  that changed the state, to the moment the admin's live view or the student's exam screen shows it. Tests wait at most
  5 000 ms for those changes.
- **Live data comes from Realtime Database** (PERF-04). Once the live view has loaded, status changes reach it through
  its Realtime Database subscription to `live/{orgId}/{testId}` and `presence/{orgId}/{testId}`, not through API calls:
  while updates arrive the page sends no request to `/v1/tests/…` or `/v1/attempts/…`.
- **"Extra time for all"** (OPS-05) is Proposed and not built (DECISIONS Q29): the live view has no such control.
- **Reset in a fixed slot after the late-entry cutoff** (DECISIONS Q25): the restarted attempt may start after the
  cutoff, and its deadline follows the normal rule for the timing mode (fixed slot: slot end plus extra time).

## Live mirror in Realtime Database (OPS-02, PERF-04, DATA-07)

Only the API writes these records (DATA-07). Admins read `live/{orgId}` and `presence/{orgId}` of their own
organization only, super admins all (DATA-10, phase 3 rules).

| Path | Written when | Fields the tests read |
| --- | --- | --- |
| `live/{orgId}/{testId}/{attemptId}` | a pairing reservation (`POST /v1/tests/{testId}/pairing-token`), an attempt start, every answer batch, every counted strike, every finish (submit, auto-submit, strike termination, admin termination), reinstatement and every extra-time grant | `name`, `prn`, `status` (`pairing`, `in_progress`, `submitted`, `auto_submitted`, `terminated`), `answered` (drawn questions with a saved non-null answer), `total` (drawn questions), `strikes`, `deadlineAt` (with all extra time), `updatedAt` |
| `live/{orgId}/{testId}/{attemptId}` | a reset | removed, or `status: "reset"`; the live view never shows a reset attempt |
| `signals/{orgId}/{attemptId}` | every extra-time grant | `deadlineAt` (the new deadline), `notice` exactly `Your time was extended by <n> minutes.` (`1 minute` for one) |

A reservation's record has `status: "pairing"`. Spec 10.2 fields stay; the implementation may add fields (for example
`studentId`) to join records to the roster.

## Requests the tests send directly

As in phases 1 to 4, with real ID tokens; super admins add `X-Org-Id`. Error bodies follow API-01. Every admin route
below answers `404` (never `403`) for a resource of another organization (ORG-05), the same success for a super admin
with `X-Org-Id` of the organization that holds it (ORG-11, ORG-14), with the audit entry naming the super admin as actor
(`actor.role: "superAdmin"`), and `403` to a student token. Each writes its audit entry in the same batch as the change
(AUD-02).

| Request | Body | Expected |
| --- | --- | --- |
| `GET /v1/tests/{id}/attempts` | | admin: `200` `{ items: [{ id, studentId, status, startedAt, deadlineAt, extraTimeSec, strikesCount }] }`, every attempt of the test including `reset` ones; `404` for a test of another organization |
| `POST /v1/attempts/{id}/extra-time` | `{ minutes, reason, confirmOverDuration? }` | admin: `200` `{ deadlineAt, extraTimeSec }` (below). `400 VALIDATION` when `minutes` is not a whole number from 1 to 1,440 or `reason` is missing or blank; `409 EXTRA_TIME_CONFIRMATION_REQUIRED` when `minutes` is more than the test's duration (resolved `durationMin`) and `confirmOverDuration` is not `true`, storing nothing (OPS-08); `409 ATTEMPT_FINISHED` for an attempt that is not `in_progress`; `403 FEATURE_DISABLED` with `extra_time_grants` off |
| `POST /v1/attempts/{id}/terminate` | `{ reason }` | admin: `200` `{ status: "terminated" }`; `400 VALIDATION` without a reason; `409 ATTEMPT_FINISHED` for an attempt that is not `in_progress` |
| `POST /v1/attempts/{id}/reinstate` | `{ reason }` | admin: `200` `{ status: "in_progress" }`; `400 VALIDATION` without a reason; `409 ATTEMPT_NOT_TERMINATED` for an attempt that is not `terminated` |
| `POST /v1/attempts/{id}/reset` | `{ reason }` | admin: `200` `{ status: "reset" }`; `400 VALIDATION` without a reason; `409 ATTEMPT_ALREADY_RESET` for a `reset` attempt. Any other status (`in_progress`, `submitted`, `auto_submitted`, `terminated`) can be reset |
| `GET /v1/attempts/{id}/events` | | as in phase 3 (PR-11), now also used by the timeline |
| `PUT /v1/students/{studentId}/accommodations/{seriesId}` | `{ extraPct }` or `{ extraMin }` | admin: `200`; stores the accommodation (below). `400 VALIDATION` for both keys, neither, `extraPct` that is not a whole number from 1 to 200, or `extraMin` that is not a whole number from 1 to 600; `404` for a student or series of another organization |
| `DELETE /v1/students/{studentId}/accommodations/{seriesId}` | | admin: `200`; removes it |
| `POST /v1/tests/{testId}/pairing-token` | `{}` | as in phase 3; now also writes the `pairing` live record |
| Worker `POST http://127.0.0.1:4001/tasks/prewarm` | `{ orgId, testId, windowStart }` | `200` every time (REL-04) |

**Extra time** (OPS-06, OPS-08, OPS-09, spec 11.3): a grant adds `minutes × 60` to the attempt's `extraTimeSec` and
`minutes × 60 000` to its `deadlineAt` (grants add up), writes `signals/{orgId}/{attemptId}` and the live record's
`deadlineAt`, and writes the audit entry. The new deadline may pass the window end, in either timing mode; answers with
`clientTs` before the new deadline are accepted after the window end. The auto-submit task follows the new deadline:
when the old task fires it changes nothing and a task named `auto-submit-<attemptId>-<new deadlineAt>` is pending with
`scheduleTime` = new `deadlineAt` + 120 000 (EX-16); at that time the attempt is finalized as `auto_submitted`. A
grant enqueueing the new task at once is also fine.

**Terminate** (OPS-04): stores `status: "terminated"`, `terminationReason` (the reason text as typed), `submittedAt`
and the graded `result`, exactly as a strike termination does. **Reinstate**: stores `status: "in_progress"` and
removes `terminationReason`, `submittedAt` and `result`; answers, `strikesCount` and `deadlineAt` are kept, and the
auto-submit task for the current deadline is queued again (idempotently by name).

**Reset** (OPS-10, US-AD-13): the attempt keeps every record it had (answers, events, draw, result) and gets
`status: "reset"`, `resetReason` (the reason text), `resetAt` and `resetBy` (the admin's uid). The attempt index
(`attemptIndex/{testId}_{studentId}`) no longer holds it as `activeAttemptId`. The student can then start again:
`POST /v1/attempts` answers `201` with a new attempt ID, a new draw stored on the new attempt (seeded by the new attempt
ID, Q-06), no answers, and the deadline of the timing mode from that start (a fixed slot's end, Q25); the index then
holds the new ID as `activeAttemptId` and `attemptCount` 2.

**Standing accommodations** (OPS-07, A11Y-17): stored on the student record as
`accommodations: { [seriesId]: { extraPct } | { extraMin } }` (PLAN `Student`). Saving one for a series that already
has one replaces it. When an attempt of a test in that series **starts**, its `extraTimeSec` is set from it and the
deadline gets it on top (spec 5.5): `extraMin × 60`, or `round(durationMin × extraPct / 100)` whole minutes × 60, where
`durationMin` is the test's resolved duration (in a fixed slot, the slot length). Attempts already started keep their
deadline; tests of other series get nothing.

**Pre-warming** (PERF-06): publishing a test (`POST /v1/tests/{id}/publish`, the **Publish test** button, and the
`exam-test` scenario's `publish`) enqueues one task with path `/tasks/prewarm`, name
`prewarm-<orgId>-<testId>-<windowStart>`, payload `{ orgId, testId, windowStart }` and `scheduleTime` = the resolved
window start − 1 800 000 (30 minutes), or the clock's now when that is already past. The handler raises the API's
minimum instances through its driver; in test mode the driver does nothing and the handler answers `200`.

## Audit actions

| Action | Target | Notes |
| --- | --- | --- |
| `attempt.extra_time.grant` | `{ type: "attempt", id: attemptId }` | `before.deadlineAt`; `after.minutes`, `after.reason`, `after.deadlineAt` |
| `attempt.terminate` | `{ type: "attempt", id }` | `after.reason` |
| `attempt.reinstate` | `{ type: "attempt", id }` | `after.reason` |
| `attempt.reset` | `{ type: "attempt", id }` | `after.reason` |
| `student.accommodation.update` | `{ type: "student", id: studentId }` | `after.seriesId` and `after.extraPct` or `after.extraMin` (on removal `after.removed: true`) |

## Test-only scenarios

No new scenario. Phase 3's `exam-test` and phase 2's `authoring-series` and `authoring-test` are used as they are,
except that `exam-test` with `publish` now also enqueues the pre-warm task, as publishing does.

## Admin pages

The sidebar `Main` navigation gains a link exactly `Live exams` to `/admin/live/`, after `Series` (spec 13.7). Every
phase 5 admin page meets the phase 1 shell rules and has no serious axe violation. A student who opens `/admin/live/`
lands on `/student/` (WEB-03).

### Live exams: `/admin/live/`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Live exams` |
| Tests | `table` | exactly `Live exams`; columns `Test`, `Series`, `Window`; one row per published test (stored status `scheduled`) whose resolved window holds the server's now, earliest window start first; first cell a `link` named exactly the test heading to `/admin/live/?test=<testId>`; `Window` as students see it (`2 Nov 2026, 09:28 to 10:28 IST`) |
| Empty | test ID `empty-state` | exactly `No tests are live right now. A test shows here while its window is open.` and one action `Go to series` (a link to `/admin/series/`) |

### Live view: `/admin/live/?test=<testId>` (OPS-01 to OPS-04, US-AD-11)

Shown for any published test of the organization, open or closed.

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Live: <test heading>` (`Live: Day 1: Quantitative aptitude`) |
| Counts | `list` | exactly `Status counts`; seven `listitem`s, in this order, each exactly `<n> <label>` with n in en-IN: `<n> eligible`, `<n> not started`, `<n> pairing`, `<n> in progress`, `<n> submitted`, `<n> submitted automatically`, `<n> terminated` |
| Filters | `group` | exactly `Filters`, holding toggle `button`s with `aria-pressed`, exactly `With strikes`, `Phone disconnected`, `Offline for more than 60 s`, `Not started`, `Terminated` |
| Search | `searchbox` | exactly `Search by name or PRN`; shows the rows whose name or PRN contains the text, ignoring case |
| Roster | `table` | exactly `Roster`; columns exactly `Student`, `PRN`, `Status`, `Answered`, `Strikes`, `Phone`, `Last seen`, `Time left`, `Actions`; one row per student (below) |
| Sorting | `button` inside each `columnheader` but `Actions` | named exactly the column name; the `columnheader` carries `aria-sort`; the first press sorts ascending, the next descending. Initially sorted by `Student` ascending (`aria-sort="ascending"` on `Student`) |
| Row actions | `button` in the `Actions` cell | exactly `Actions for <full name>`, opening a `menu` (below); absent for `Not started` and `Pairing` rows |
| No match | test ID `empty-state` | when the filters and search leave no row: exactly `No students match these filters.` and one action `Clear filters`, which un-presses every filter and empties the search |
| Not found | | for a test of another organization or one that is not published: `heading` level 1 exactly `Test not found`, text exactly `This test doesn't exist in <org name>.`, `link` exactly `Back to live exams` to `/admin/live/`. Nothing of the test is shown |

**Counts.** `eligible` is the number of registered students the series and test rules admit now (SER-04 to SER-06).
Each student counts once, by their newest attempt (a `reset` attempt counts as none): `pairing` for a reservation
without an attempt, then `in progress`, `submitted`, `submitted automatically` and `terminated` by the attempt status;
`not started` is the eligible students with neither.

**Rows.** One row per eligible student, plus one per student with a non-reset attempt or reservation who is no longer
eligible. Cells:

| Column | Text |
| --- | --- |
| `Student` | the full name (plain text) |
| `PRN` | the PRN |
| `Status` | exactly `Not started`, `Pairing`, `In progress`, `Submitted`, `Submitted automatically` or `Terminated` |
| `Answered` | exactly `<answered> / <total>` (`2 / 4`); empty for `Not started` and `Pairing` |
| `Strikes` | the number (`0`, `3`); empty for `Not started` and `Pairing` |
| `Phone` | with a second camera: exactly `Connected` (phone presence `online: true`) or `Disconnected` (otherwise) for `In progress` and `Pairing`; without a second camera exactly `Not used`; empty for every other status |
| `Last seen` | for `In progress`: exactly `Online` (laptop presence `online: true`), `<n> s ago` (offline, under a minute since `lastSeen`), `<n> min ago` (whole minutes, rounded down) or `Not seen` (no laptop presence record); empty for every other status |
| `Time left` | for `In progress`: the attempt deadline (with all extra time) minus the server's now, in the exam timer format (`41:58`, `1:08:00`), ticking; empty for every other status |

**Filters** (OPS-03). A pressed filter keeps only matching rows; with several pressed a row must match every one; the
search applies on top.

| Filter | Keeps rows where |
| --- | --- |
| `With strikes` | `Strikes` is 1 or more |
| `Phone disconnected` | `Phone` reads `Disconnected` |
| `Offline for more than 60 s` | `Status` is `In progress` and the laptop is not online: offline with `lastSeen` more than 60 s before the server's now, or no laptop presence record and `startedAt` more than 60 s before it |
| `Not started` | `Status` is `Not started` |
| `Terminated` | `Status` is `Terminated` |

**Sorting** (OPS-03). Text columns by `Intl.Collator('en')`; `Status` by the order of the counts list; `Answered` by
the answered count; `Strikes` by number; `Last seen` by how long ago (`Online` first ascending); `Time left` by
remaining time. Rows with an empty cell in the sorted column come last in both directions. Ties are listed by name, A to Z, in both directions.

**Row actions menu** (OPS-04): `menuitem`s exactly, in this order, only those that apply:

| Status | Items |
| --- | --- |
| `In progress` | `View timeline`, `Grant extra time`, `Reset attempt`, `Terminate attempt` |
| `Terminated` | `View timeline`, `Reset attempt`, `Reinstate attempt` |
| `Submitted`, `Submitted automatically` | `View timeline`, `Reset attempt` |

With `extra_time_grants` off, `Grant extra time` stays in the menu but is disabled (`aria-disabled="true"`) with
accessible description exactly `Not included in your organization's plan` (FF-03).

### Timeline drawer (OPS-04, PR-11)

`View timeline` opens a `dialog` exactly `Timeline for <full name>`: a non-modal drawer against the right edge, like
the phase 1 student drawer, with a `button` exactly `Close`. Closing it (`Close` or Escape) returns focus to the row's
`Actions for <full name>` button (the trigger of the menu that opened it, A11Y-05).

| What | Role | Name or text |
| --- | --- | --- |
| Events | `list` | exactly `Events`; one `listitem` per event of the attempt (`GET /v1/attempts/{id}/events`) in server-time order. Each holds, in order and nothing else: the server time exactly `<HH:mm:ss> IST`, the event label (below), and for a counted strike exactly `Strike <n>` |
| No events | text | exactly `No events yet.` in place of the list |

| Event type | Label (exact) |
| --- | --- |
| `fullscreen_exit` | `Left fullscreen` |
| `tab_hidden` | `Switched to another tab or window` |
| `window_blur` | `Exam window lost focus` |
| `no_face` | `No face in view for more than 5 seconds` |
| `multiple_faces` | `More than one face in view` |
| `devtools` | `Developer tools shortcut` |
| `phone_disconnected` | `Phone disconnected for more than a minute` |
| `context_menu` | `Context menu` |
| `clipboard` | `Copy or paste` |
| `print` | `Print` |
| `late_sync` | `Answer synced late` |
| `note` | the note's text |

### Grant extra time (OPS-06, OPS-08, US-AD-12)

`Grant extra time` opens a `dialog` exactly `Grant extra time to <full name>`:

| What | Role | Name or text |
| --- | --- | --- |
| Current deadline | text | exactly `Current deadline: <HH:mm> IST` |
| Minutes | `spinbutton` field | exactly `Extra minutes (required)` |
| Reason | `textbox` field | exactly `Reason (required)` |
| New deadline | text | exactly `New deadline: <HH:mm> IST`, shown while the minutes are a whole number from 1 to 1,440 |
| Actions | `button`s | exactly `Cancel`, then `Grant extra time` to its right |

Errors (after pressing `Grant extra time`, nothing sent): minutes `Enter whole minutes from 1 to 1,440.`; reason
`Enter a reason for the extra time.` On success the dialog closes and a `status` exactly `Extra time granted` appears;
the row's `Time left` follows the new deadline.

**Second confirmation** (OPS-08): when the minutes are more than the test's duration, `Grant extra time` first opens an
`alertdialog` exactly `Grant more than the test's duration?` holding the text exactly
`<n> minutes is more than the test's duration of <d> minutes.`, with `Cancel` (focused) and the confirm `Grant anyway`
to its right (not destructive). `Cancel` closes it, sends nothing and leaves the grant dialog open with its values;
`Grant anyway` sends the grant with `confirmOverDuration: true`.

### Terminate, reinstate and reset (OPS-04, OPS-10, US-AD-13)

Each opens an `alertdialog` with a `textbox` field exactly `Reason (required)`, focus starting on `Cancel`, and the
confirm button to the right of `Cancel`. An empty reason shows its field error and sends nothing.

| Action | Dialog name | Text (exact) | Confirm | Reason error | Notice |
| --- | --- | --- | --- | --- | --- |
| `Terminate attempt` | `Terminate <full name>'s attempt?` | `Their answers so far will be graded, and the test ends for them now.` | `Terminate attempt` (`redpen`) | `Enter a reason for terminating this attempt.` | `Attempt terminated` |
| `Reinstate attempt` | `Reinstate <full name>'s attempt?` | `They can continue with the answers saved so far, until <HH:mm> IST.` (the deadline) | `Reinstate attempt` | `Enter a reason for reinstating this attempt.` | `Attempt reinstated` |
| `Reset attempt` | `Reset <full name>'s attempt?` | `The current attempt is kept for the record, and they can start again with new questions.` | `Reset attempt` (`redpen`) | `Enter a reason for resetting this attempt.` | `Attempt reset` |

After each, the row shows the new status within 5 seconds (`Terminated`, `In progress`, `Not started`).

### Standing accommodations in the student drawer (OPS-07, A11Y-17)

The phase 1 student drawer (`/admin/students/`, `dialog` named the student's full name) gains a `heading` exactly
`Accommodations` after `Profile`:

| What | Role | Name or text |
| --- | --- | --- |
| List | `list` | exactly `Accommodations`; one `listitem` per accommodation, by series title, holding exactly `<series title>: <n>% extra time` or `<series title>: <n> extra minutes` (`1 extra minute`) and a `button` exactly `Remove accommodation for <series title>` |
| None | text | exactly `No accommodations.` in place of the list |
| Add | `button` | exactly `Add accommodation`, opening `dialog` exactly `Add accommodation` |

`Add accommodation` dialog: native select field exactly `Series (required)` (one option per series of the
organization that is not archived, labelled by its title); `radiogroup` exactly `Extra time as` with `radio`s exactly
`Percentage of the duration` (default) and `Minutes`; `spinbutton` field exactly `Amount (required)`; submit `button`
exactly `Save accommodation`. Errors on save: no series `Choose a series.`; amount out of range
`Enter a whole percentage from 1 to 200.` (percentage) or `Enter whole minutes from 1 to 600.` (minutes). On success
the dialog closes, a `status` exactly `Accommodation saved` appears and the list shows the item.

`Remove accommodation for <title>` opens `alertdialog` exactly `Remove the accommodation for <series title>?` with the
destructive confirm `Remove accommodation`; afterwards a `status` exactly `Accommodation removed`.

## Student screens (additions)

- **Rules screen** (`/exam/rules/?test=`): with a standing accommodation for the test's series, `Rules for this test`
  gains, right after `Duration: <n> minutes`, the `listitem` exactly `Extra time: <n> minutes` (`1 minute`), and the
  `Deadline:` item includes it (fixed slot: `Deadline: <slot end + extra, HH:mm> IST`; flexible:
  `Deadline: <duration + extra> minutes after you start`, with `, and no later than <window end + extra, HH:mm> IST`
  under hard close). Without one the list is exactly as in phase 3.
- **Exam screen** (`/exam/?attempt=`): within 5 seconds of a grant the `Time left` timer follows the new deadline and a
  `status` whose text is exactly the signal's notice (`Your time was extended by 10 minutes.`) is shown on the screen.
  The `status` element's whole text is the notice; its `button` exactly `Dismiss` sits outside the `status` element.
  It stays until the student presses `Dismiss` or the next grant replaces it. It never opens a
  dialog and never takes focus.
- **Admin termination**: the student's open exam screen moves to `/exam/submitted/?attempt=` at its next answer save or
  event report at the latest (409 `ATTEMPT_FINISHED`), showing `heading` level 1 exactly `Your test was ended` and the
  text exactly `Your placement cell ended this test. Reason: <reason>`.
- **Reset attempt**: `/exam/?attempt=<id>` and `/exam/submitted/?attempt=<id>` of a `reset` attempt show `heading`
  level 1 exactly `Your attempt was reset`, the text exactly
  `Your placement cell reset this attempt. You can start the test again from your tests.` and a `link` exactly
  `Back to your tests` to `/student/`. The student's test page offers `Check your device` again (phase 3: a reset attempt
  counts as none). This holds after the late-entry cutoff too (Q25): for a student whose newest attempt is `reset`, the
  dashboard lists the test under `Live now`, the test page offers `Check your device`, preflight and rules open, and
  `POST /v1/attempts` starts, until the window end. This overrides, for that student only, the phase 3 rules that hide a
  missed test, answer `Test not found` (404) and refuse the start with `409 WINDOW_CLOSED`.

## Screenshot tests (UI-15)

`tests/acceptance/phase-5/F-5.05.spec.ts` compares full-page screenshots (`toHaveScreenshot`, animations disabled,
caret hidden) of four screens in three themes each: `light` (theme Light, high contrast off), `dark` (theme Dark) and
`high-contrast` (high contrast on). The theme is set through `PUT /v1/me/preferences` with reduce motion `on`, and the
test first checks the theme took effect (`<html>` background `rgb(243, 245, 247)`, `rgb(15, 19, 38)` or
`rgb(255, 255, 255)` with `<body>` text `rgb(0, 0, 0)`) and that the screen's content is shown.

| Screen | Project | State | Masked |
| --- | --- | --- | --- |
| Exam screen, attempt mode | `exam` (1024 x 768) | `basic` test, question 1 answered and saved | the `Time left` timer |
| Result page | `desktop` | `basic` test, full review released, 2 of 4 right, 12 minutes | nothing |
| Live view | `desktop` | three students: in progress, submitted, not started | `Time left` and `Last seen` cells |
| Test editor, Questions tab | `desktop` | `authoring-test` with the `basic` questions, 20 Oct 2026 clock | nothing |

The API clock is fixed (2 Nov 2026, 09:30 IST for the first three; 20 Oct 2026, 11:30 IST for the editor) so every
date and score is the same on every run. Baselines live beside the spec in `F-5.05.spec.ts-snapshots/`. They are made
once from the finished phase 5 build with `--update-snapshots`, looked at by a person in all three themes before they
are committed (docs/MANUAL_CHECKS.md), and regenerated only together with an intended visual change.

## Static checks (REL-07, A11Y-18)

`docs/runbooks/exam-day.md` exists and has these level-2 headings, exactly: `## Pre-warming`, `## Monitoring`,
`## Extra-time policy for outages`, `## Contacts`, `## Timing and accessibility`.

- `Pre-warming` says minimum instances are raised 30 minutes before each slot (PERF-06) and how to check it happened.
- `Monitoring` names the exam-day dashboard (OBS-05) and each alert of OBS-04 (5xx rate, answer-save p95, failed
  auto-submit, worker failures).
- `Extra-time policy for outages` says when to grant extra time to affected students and that every grant needs a
  reason (OPS-06, OPS-09).
- `Contacts` lists who to call, by role.
- `Timing and accessibility` (A11Y-18) says timed exams fall under WCAG's exception for real-time events (the words
  `real-time` and `WCAG`) and that adjustable time is still provided through extra-time grants and standing
  accommodations (the words `extra time` and `accommodation`).

The acceptance spec reads the file and checks those headings and words. The public accessibility statement (A11Y-22,
phase 8) must repeat the A11Y-18 note when it is written.

## Unit and integration tests the build must add

These REQs are verified below the browser. The builder writes them beside the code (Vitest; integration tests on the
emulators, rules tests with `@firebase/rules-unit-testing`), each test title starting with its REQ IDs. Functions are
exported from `packages/shared` (`@mitaoe/shared`) with these exact names.

```ts
// accommodations.ts
export interface Accommodation { extraPct?: number; extraMin?: number }
export function accommodationExtraSec(durationMin: number, a: Accommodation | undefined): number;
//   extraMin × 60, or round(durationMin × extraPct / 100) × 60, or 0

// extra-time.ts
export const MAX_EXTRA_MINUTES = 1440;
export function extraTimeNeedsConfirmation(minutes: number, durationMin: number): boolean;   // minutes > durationMin
export function extensionNotice(minutes: number): string;   // 'Your time was extended by 10 minutes.' / '… 1 minute.'

// live.ts
export type LiveRowStatus = 'not_started' | 'pairing' | 'in_progress' | 'submitted' | 'auto_submitted' | 'terminated';
export function isOfflineTooLong(input: { status: LiveRowStatus; laptop?: { online: boolean; lastSeen: number } | null;
  startedAt?: number; now: number }): boolean;   // the `Offline for more than 60 s` rule above
```

| REQ | Kind | Behaviours the tests must show |
| --- | --- | --- |
| OPS-02 | integration | the API writes `live/{orgId}/{testId}/{attemptId}` (fields above) on reservation, start, answer batch, counted strike, every kind of finish, reinstatement, extra time, and removes (or marks) it on reset; rules tests: an admin of org B cannot read `live/org-a` or `presence/org-a`, an org A admin can, a super admin can, a student cannot read `live/…` at all, and no client can write `live` or `signals` |
| PERF-04 | integration | the live view's data needs no Firestore query per update: the counts are derived from the `live/` records (shared `LiveRowStatus` mapping unit-tested); the only API read the view makes is its one load of the eligible roster |
| OPS-07, A11Y-17 | unit + integration | `accommodationExtraSec` for percentages and minutes (rounding), and `POST /v1/attempts` setting `extraTimeSec` and the deadline from the accommodation in all three timing modes (spec 5.5: extra on top, also past the window end); an attempt already in progress keeps its deadline; a test of another series gets 0 |
| OPS-09 | integration | every grant writes `attempt.extra_time.grant` in the same batch as the deadline change; a refused grant (validation, confirmation, finished attempt, feature off) writes neither |
| OPS-10 | integration | reset needs a reason; the old attempt keeps its answers, events, draw and result with `status: "reset"`; the next start draws again with `drawAttempt` seeded by the new attempt ID; the old attempt's pending auto-submit task finalizes nothing when it fires (REL-04) |
| OPS-06, EX-16 | integration | after a grant, the old auto-submit task changes nothing and leaves a task for the new deadline; answers before the new deadline save after the window end |
| PERF-06 | integration | publishing enqueues `prewarm-<orgId>-<testId>-<windowStart>` at window start − 30 minutes (or now), idempotently; the worker handler calls its `InstanceScaler` driver once per task name; the Cloud Run driver is checked manually (below) |

Also: every new admin route (`GET /v1/tests/{id}/attempts`, `POST /v1/attempts/{id}/extra-time`, `…/terminate`,
`…/reinstate`, `…/reset`, `PUT` and `DELETE /v1/students/{id}/accommodations/{seriesId}`, and any route the live view
uses to load its roster) is in the phase 0 route-table tests (ORG-05 404 for org B, ORG-14 with an admin token and
with a super-admin token plus `X-Org-Id`, `403` for student and device tokens).

## Checked outside the automated suites

These go to docs/MANUAL_CHECKS.md (who runs them, and when), because they need staging or production infrastructure
that the local emulator stack does not have (DECISIONS Q3, Q32):

| REQ | Why not end to end here | Check |
| --- | --- | --- |
| PERF-07 | the k6 500-student scenario must run against staging (real Cloud Run, Firestore, load balancer); the emulators say nothing about the 12.2 latency targets | owner runs `tests/load/` k6 against staging before the first real exam and after any exam-path change; every 12.2 target met. A small local k6 smoke against the emulators may run in CI, but does not prove PERF-07 |
| PERF-06 | raising Cloud Run minimum instances needs the real Cloud Run Admin API; locally only the queued task is checked | on staging, the API's minimum instances rise within a minute of the task's schedule time and fall back after the slot |
| OBS-04 | Cloud Monitoring alert policies exist only in a GCP project | each alert (5xx above 1% for 5 minutes, answer-save p95 above 300 ms, any failed auto-submit task, repeated worker failures) exists on staging and production and fires on a forced condition |
| OBS-05 | the dashboard is a Cloud Monitoring object | the exam-day dashboard shows active attempts, requests per second, latency, errors, instances and Firestore errors |
| UI-15 (baselines) | a screenshot test can only say "unchanged" | a person reviews the twelve baseline images when they are first made and whenever they are regenerated |

## Test IDs

| Test ID | Where | Why not a role |
| --- | --- | --- |
| `empty-state` | live exams list and live view no-match state (phase 1 convention) | one sentence and one action, no distinct role |
