# Backlog

Non-blocking findings from reviews and QA. Blocking ones are fixed in the phase that finds them.

## Phase 0

- The AUTH-01 popup tests depend on the Auth emulator's iframe loading `https://apis.google.com/js/api.js`; a slow
  fetch through the network makes them flaky (seen twice in about ten runs). A self-hosted gapi is not possible with
  firebase-tools 15; revisit if CI shows the same.
- Bootstrap writes the custom claims and `userIndex/{uid}` separately; a failure between them leaves them disagreeing
  until the next sign-in repeats bootstrap.
- Admin landing tests other than one per role use the emulator credential helper rather than the popup (test review).
- `nonInstantMotion` in the phase 0 tests also requires animations to be 0 s under reduced motion: every later
  skeleton or spinner on the role homes must stop animating with reduced motion (tokens.css already forces it).
- The sign-in page is checked only at 1280 px in phase 0 tests; the 360 px check comes with UX-12 in phase 1.
- The phase 0 test seed fixture names role keys in titles ("superAdmin home").

## Phase 1 (release-gate review)

- Audit filters for Actor, Action and Target match by substring and also match `target.type`; the contract says exact.
- `listAudit` and `listAuditAcrossOrgs` read the newest 2,000 entries and filter in memory; large logs and CSV exports can miss older entries. Move filters into Firestore queries with indexes.
- The merge route does not check that the target department is active.
- First-sign-in student creation in bootstrap is a batch, not a transaction; two simultaneous first sign-ins could create two records.
- Org admins see the IP and user agent of super-admin actions in their audit log and the student change history.
- Account-status invalidation clears only the local instance's cache; other instances keep the old status for up to 60 s (within AUTH-06).

## Phase 1 (QA pass, minor)

- Double clicks send duplicate requests (consent, whitelist save with two audit entries, student delete); the max_students check is not atomic under parallel single adds.
- Focus falls back to the page after consent turns into the profile form, after a server error on profile save, and after deleting a student.
- /platform/org/ without ?id= shows a skeleton forever instead of a not-found message.
- When a super admin enters an org, the first GET /v1/org can go out without X-Org-Id (400 in the console) and the banner briefly reads "Working in" with no name.
- Admins listed in two orgs have no account menu to switch; adding an existing super admin or a student email as an admin gives no warning; the whitelist accepts admin emails.
- Toggling profile lock offline shows On with no pending notice until the request replays.
- Student directory filters and sort are not kept in the URL; Back with the drawer open leaves the page.
- Copy: the admin Add student form says "Enter your PRN."; a status filter with no results says "No students match your search."; the audit log shows raw JSON and department IDs.
- After sign-out the sign-in page keeps the previous user's theme and text size.
- axe reports aria-hidden-focus while the org switcher menu is open (the skip link is under the aria-hidden area).
- The emulator Google popup often fails to hand back its result here because the auth iframe loads gapi from apis.google.com (AUTH-01 popup tests).

## Phase 2 (mid-phase review)

- Question import (up to 1,000) and delete or reorder write every question in one batch; Firestore accepts it (no 500-write cap since 2023) but it is close to the 10 MiB request limit with long prompts. Split into chunks.
- The question editor keeps only `{ id, text }` for options, so a future option image would be dropped on save.
- Eligibility department, include and exclude IDs are stored without checking they belong to the org (matching only lists this org's students).
- The JSON import summary is not in a status region; the Needs attention box re-reads on each keystroke (announce only the count).
- Question Markdown keeps http(s) links; decide for the phase 3 exam screen whether links render as plain text.
- Changing series dates can leave tests outside the new range; uploaded images of unsaved questions stay in Storage.
- (QA) Simultaneous question writes or a zero-gap double click can store duplicate order numbers or duplicate series and imports; use a transaction for the order counter and an idempotency key on create.
- (QA) Focus goes to the page after Use series value, deleting a question, saving the first question from the empty state and removing an option; move it to a nearby control.
- (QA) Unsaved Settings and Eligibility tab edits are dropped on tab change or reload without a warning.
- (QA) A failed offline reorder keeps the new order on screen and shows the raw browser error.

## Phase 2 (release-gate review)

- Publish re-runs only settingsProblems, not checklist item 4 (settingsGaps); a series default edited between approve and publish can snapshot unchecked settings.
- Approve reads the test and its questions outside a transaction.
- sectionInputSchema accepts client-chosen IDs and does not reject duplicates in one PATCH.
- A published test's totalMarks and snapshot are not re-evaluated after a series default changes; the UI shows no staleness hint.
- PATCH writes the test document twice in one batch when sections are deleted.
- hasAttempts relies on the `${testId}_` attemptIndex key format; phase 3 must add a test for it.
- (QA) Approve and publish are not idempotent under simultaneous requests (three 200s and three audit entries); run them in a transaction.
- (QA) Focus goes to the page after Approve test, Save marking and timers and Go to questions.
- (QA) The marking-scheme radio group moves only with Left and Right; the time-limit group moves focus without selecting.
- (QA) Unsaved Marking and timers edits are dropped when switching tabs; a failed publish shows the raw browser error.
- (QA) The disabled Publish test still says "Approve the test before publishing it." once the test is scheduled or live.
- (QA) Editing a live test with no attempts returns it to In review without a confirmation.
- (QA) A section with no questions passes the draw check; a whole-test drawCount sent while the test has sections is accepted and ignored; unknown section IDs are accepted.
- (QA) The super admin's first GET /v1/org on /platform/ can return 400 ORG_REQUIRED; the editor tab is not kept in the URL.

## Phase 3 (test review)

- F-3.11 counts focus events once after the strike count reaches 1; poll until both focus events are stored so a wrongly counted second event cannot slip by.
- F-3.13 checks the absence of phone_disconnected with a single read; check after a later event round trip.
- colourBlindShots leaves background-image (hatching) in colour, which is lenient for A11Y-14.
- The browser DATA-05 dashboard check looks for field names only (the integration row checks explanation text).

## Phase 3 (mid-phase review)

- Idempotency keys are not bound to the request body; the same user reusing a key for another test gets the first payload replayed.
- TST-06: PATCH /v1/tests reads attemptsStarted outside the start transaction, so an edit racing the first start can change settings an attempt already used.
- The exam's single-key shortcuts cannot be turned off or remapped (WCAG 2.1.4); EX-09 requires them; add an off switch in the accessibility panel.
- Preflight check results change without a live region (WCAG 4.1.3).
- `_localTasks` is a top-level collection (dev/test driver only).
- Two tabs on one attempt can collide on per-question seq counters; the newer change may come back stale.
- Used and expired phone pairing tokens are never deleted; add a Firestore TTL policy on `pairingTokens` (spec 10.1 has no such collection yet).
- Reloading the phone page needs a new code (the link is single use and the device sign-in is in memory); it could keep the sign-in for the tab.
- Laptop presence `lastSeen` changes only on connect, fullscreen and visibility changes; the live view (phase 6) may want a periodic heartbeat.
- (Phase 3) TASK_QUEUE has only the local adapter; production needs the Cloud Tasks adapter (OIDC to the worker) before launch. The in-process dispatcher no longer starts in production.

## Phase 3 (release-gate review and QA, minor)

- RTDB rules for phone and laptop presence do not pin $testId to an owner record.
- Phone strike timing runs in the laptop tab and restarts on reload; time it on the server from presence data.
- Start does not check on the server that the phone is paired (strikes during the exam still cover it).
- API-06 rate limits use the in-memory store per instance, not per user across instances.
- submit with reason time_up before the deadline stores auto_submitted; store submitted when the server time is before deadlineAt.
- offline-store: a refused answer with a higher seq blocks keeping a later lower-seq answer on the device.
- Closing Keyboard shortcuts with Escape sends focus to the page instead of where it was.
- Reloading during one continuous no-face spell gives a second no_face strike.
- At 640 px wide (200% zoom) the fixed bottom bar hides the last option.
- A zero-gap double click on Submit test while offline starts two submits with different Idempotency-Keys (the server finishes once).
- putLeaderboard writes every page in one batch; a board above about 10 MiB (over 11 pages, e.g. 2,000 students with 170+ public tests in a series) would pass Firestore's request size limit.

## Phase 4 checkpoint review

- Changing resultRelease to after_close after the window has closed queues no release task; results stay pending until an admin releases them. Queue releaseResultsTask when release settings change.
- History links to the result page, which shows the score even when Show past scores is off (DECISIONS allows it; flag to the owner against RES-04's intent).
- History and leaderboard day labels are computed over listTests including drafts; check they match the student dashboard labels.
- boardLines finds the student's own row by matching field values; a mine flag on the served row would be more robust.

## Phase 4 (release-gate review, minor)

- POST /v1/exports commits the record before queue.enqueue; a failed enqueue leaves the export queued with no retry.
- The public /v1/exports/{id}/file route has no rate limit (signatures cannot be guessed, but each request runs an HMAC).
- XLSX text cells keep a visible leading apostrophe from the owner's formula rule (e.g. `'-Rahul`), since ExcelJS writes literal strings; owner may relax the rule for XLSX.
- refId accepts `/`, so `a/b` makes getTest throw a 500 instead of 404; restrict IDs to a Firestore ID pattern.
- ExportRegion polls without a ceiling; a stuck export shows Preparing indefinitely.

## Phase 4 QA (minor)

- RES-05: the submitted screen's release line follows the release mode, not the release state: a withdrawn immediate test shows `Your result is ready.` and an after_close test released early shows the after-close line next to `See your result`. The locked phase 3 contract (docs/testids/phase-3.md, Submit) fixes the line per mode, so it stays; owner to decide whether the line should use resultReleaseState (released, withdrawn) as the result page does.
- The exam screen offline copy on the device keeps the deadline it opened with after extra time is granted (F-5.02 note); refresh it from the signal.
- OPS-04: an attempt reinstated after its deadline is auto-submitted by its own task as soon as the dispatcher runs it, unless extra time is granted first; the reinstate dialog could take extra minutes in the same step (F-5.04 note).
- OPS-04, DATA-05: the reinstate dialog could warn when the test's full review was already released, since the student may have read the answer key before the reinstate (F-5.04 note).

## Phase 5 checkpoint review

- Reinstate queues its auto-submit task after the commit; a failed enqueue past the old task's time leaves no task, and a retry gets 409 NOT_TERMINATED. A failed enqueue after an extra-time grant returns 500 although the grant was saved.
- live-mirror pairing write is fire-and-forget; landing after the start write turns the live record back to pairing and the row loses its actions.
- The exam screen's time-up submit uses its opening deadline if the extra-time signal arrives late; the server could refuse a time_up submit before the stored deadline.
- Every answer batch reads the whole answers subcollection to mirror the answered count (extra reads at exam-day scale).
- AccommodationsSection loads only /v1/series?limit=200.
- The laptop presence write rule does not check that $testId is the attempt's test.
