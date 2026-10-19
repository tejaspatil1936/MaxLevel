# Progress

Unattended build driven by docs/prompts/00-oneshot.md on branch build/all.

## Setup (prompts 01 and 02)

- Audit: docs/req-matrix.json (297 IDs, 11 proposed), OPEN_QUESTIONS.md (33 questions, all AUTO-DECIDED),
  TEST_ENV.md, OWNER_SETUP.md, MANUAL_CHECKS.md.
- Scaffold: pnpm + Turborepo; packages/config, shared, ui; apps/web (static export), api, worker; Firebase emulators
  (demo-mitaoe) with deny-all rules; lefthook; Vitest unit and emulator integration tests; rules tests; Playwright
  (desktop, exam, phone, lockdown) against the local production stack; base seed; test-only API; feature_list.json
  (65 features); scripts/verify.sh; CI workflow.
- Harness self-test (in a clone under /tmp/harness-test, deleted afterwards):
  - Breaking `TestClock.now()` in packages/shared made `scripts/verify.sh fast` print `VERIFY fast FAIL`
    (the unit step failed).
  - After `build(harness): freeze verification harness`, changing one character of a locked harness file in a fresh
    clone made `node scripts/locks.mjs harness check` print `HARNESS CHANGED` and exit 1. The clone was deleted.
- Setup gates: `VERIFY fast PASS 64521e8` and `VERIFY full PASS 64521e8` before the lock.
- Skipped from prompt 02 per 00-oneshot overrides: the build/setup branch (all work is on build/all) and the pull
  request plus CI watch (one pull request at the end, section D).

## Phase 0

PHASE 0 START 394563f76d813680052bb2201bd4ca963b9c65a8
Note: while a locked phase is incomplete, `verify.sh feature` fails its coverage step (every REQ of a locked phase
needs a test). A feature counts as done when status.json shows it true and coverage is the only failed step.
F-0.01 done — token unit tests: contrast in light, dark and high contrast; spacing, radius, shadow, motion; no decorative effects
F-0.04 done — error shape, X-Server-Time, schema route table and stripping, CORS, structured hashed logs, SIGTERM drain
F-0.03 done — repo-rule tests: static export, no dynamic segments, vercel headers, org-scoped query keys, jsx-no-literals, axe in CI, no keys, pinned deps, Renovate
F-0.05 done — token verification with revocation on admin writes, bootstrap order super admin > admin > whitelist with claims and uid links, org choice, /v1/me, X-Org-Id for super admins
F-0.06 done — admin guard (org admin or super admin + X-Org-Id), route-table parity and 404 isolation tests with per-route samples, orgId-first data layer check, GET /v1/org and PATCH /v1/org/settings
F-0.08 done — append-only audit log written in the same batch as the change, with actor, target, scrubbed before/after, IP, user agent, request ID
F-0.09 done — Firestore and Storage deny-all rules tests (from setup); infrastructure items are owner checks
F-0.07 done — FF-01 resolution, FEATURE_DISABLED gate (also for super admins), 60 s clock cache, atomic monthly usage counters in the org timezone
F-0.10 done — Google popup and emulator sign-in, bootstrap and token refresh, role homes, client guards, AUTH-03 alert; CSP allows the Firebase auth helper script
F-0.02 done — Radix-based core components, Storybook catalogue in light, dark and high contrast, reduced motion instant
QA and spec review: 4 blocking findings fixed with regression tests (verified-Google-only bootstrap, Table component, same-account sign-in retry, page titles); minor findings fixed or in docs/BACKLOG.md
PHASE 0 DONE 10/10 features

## Phase 1

PHASE 1 START eefa9ba9a2b10e15c781dcc6cfb2c07986cebf01
Tests: 118 phase 1 acceptance tests by test-author, reviewed twice by spec-reviewer (first FAIL with 3 blocking items, fixed; second PASS), locked at 08e2687.
Note: verify.sh runs with PLAYWRIGHT_HTML_OPEN=never; otherwise a failing run waits on Playwright's HTML report server.
F-1.01 done — organizations list, new organization form with logo and departments, detail with status changes (restore from archived)
F-1.02 done — admins table, add by email, remove with confirmation and token revocation
F-1.03 done — feature switches and limits, usage against limits, FF-03 locked sidebar entry
F-1.04 done — super-admin switcher above Main, Working in banner, archived read-only workspace, choice kept per tab
F-1.05 done — sidebar with icons below 1,200 px, skip link, focus ring, 44 px targets, Ctrl K palette, ? shortcuts
F-1.06 done — departments CRUD, merge, archive/restore, delete only when unused
F-1.07 done — upload wizard: CSV/XLSX parsed in the browser, column mapping, validation report, limit check
F-1.08 done — whitelist list, search, status filter, bulk disable/enable/export/remove, single add
F-1.09 done — org chooser group, suspended/archived refusals, account menu with org switch, DPDP consent
F-1.10 done — profile completion with PRN from the list, profile lock with optimistic switch and rollback
F-1.11 done — student directory with filters, sorting, columns, density; non-modal drawer with attempts and history
F-1.12 done — org and platform audit logs with filters in the org timezone and CSV export
F-1.13 done — accessibility panel saved to the account and applied before first paint, reading ruler
Release gate: spec review found 3 blocking items (archived-org platform writes, removed-entry student re-enable, preferences recreating a deleted record); QA found 6 more (duplicate PRN from the whitelist, accessibility panel taller than the screen, menu focus ring, sticky bar covering a field, unnamed loading states) plus CSV formula cells (owner instruction). Each fixed after a regression test; minor findings in docs/BACKLOG.md.
VERIFY full PASS 7c851a27fd45df6d0590fc38440c80eb9db16b48 (docs/verification/phase-1.md)
PHASE 1 DONE 13/13 features

## Phase 2

PHASE 2 START c5c79f0b796d1131f2ea80243bd1ead0b7da03e5
Tests: 55 phase 2 acceptance tests by test-author (23 e2e REQs; unit/integration REQs specified in the contract), reviewed twice (first FAIL: legacy JSON import; second PASS), locked.
F-2.01 done — eligibility, seeded draw, marks and presets, day labels, settings resolution, question checks, JSON import parsing, authoring schemas (shared, unit-tested)
F-2.02 done — series API with SER-09 refusal and eligibility preview, student series listing service, series list, new/edit forms with settings controls and live eligibility count, series page with activate/archive
F-2.03 done — tests API with derived live/closed status, authoring-test scenario, series timeline with day labels in the org timezone, Add test dialog, test editor shell
F-2.04 done — test Settings tab with Inherited/Overridden groups and reset, test Eligibility tab narrowing the series rules with its own preview route
F-2.05 done — question CRUD, reorder (drag and keyboard), image upload, JSON import (legacy and mitaoe-questions/1), editor with live Student view (markdown-it, KaTeX MathML, Shiki)
F-2.06 done — sections table and dialog with draw and difficulty-mix validation (API 400s), whole-test draw, marking presets and per-question time limits
F-2.07 done — reusable exam screen (options, palette, navigation) in preview mode at /exam/?preview=, fresh seeded draw from GET /v1/tests/{id}/preview, Show answers, no attempt or proctoring
F-2.08 done — approval checklist (shared), approve and publish endpoints with settings snapshot and SER-09 refusal, return to in_review on edits before attempts, checklist in the Preview tab
F-2.09 done — super-admin authoring in an org workspace works through the shared admin routes with the super admin as actor (verified, no extra code)
Checkpoints: mid-phase review and QA found 1 blocking issue (series edit could make a test leak answers, SER-09); release-gate review and QA found 2 more (in-place snapshot update skipping the SER-09 check; publish not re-checking settings). Each fixed after a regression test; minor findings in docs/BACKLOG.md.
VERIFY full PASS 7530c6dc3c60c6a1d22c454716806da44249097c (docs/verification/phase-2.md)
PHASE 2 DONE 9/9 features

## Phase 3

PHASE 3 START ebe9d7d435dfbabbb82bf751cee5577df8467d7a
Tests: 59 phase 3 acceptance tests by test-author (36 e2e REQs; integration and unit REQs specified in the contract), reviewed twice (6 blocking, then 1 settled by a DECISIONS line), locked.
F-3.01 done — timing (canStart, lastStartAt, attemptDeadline, sectionDeadline), scoring with negatives, passing marks and floor, strike dedupe, sync retry and answer verdicts, attempt schemas (shared, unit-tested)
F-3.02 done — student dashboard (live, upcoming, completed) with server-clock countdowns and timezone, test page, exam-test seed scenario
F-3.03 done — POST /v1/attempts with eligibility and window checks, seeded draw, deadline, auto-submit task, Idempotency-Key replay, resume payload without answer keys, TST-06 lock, published-test cache
F-3.04 built — preflight checks with fix lines, self-hosted MediaPipe face detector, rules screen with Start (2 tests wait on F-3.05 and F-3.10-3.12)
F-3.05 done — attempt mode at /exam/?attempt=, palette states by shape with legend, timing track, drawer below 1,280 px, keyboard shortcuts, resume from saved answers; answer sync route, basic timer and submit summary landed early because the F-3.05 test needs them
Checkpoint after 5 features: spec review runs on the phase 3 diff in parallel with F-3.06; QA runs at the phase end on the finished exam flow (the stack conflicts with feature verify runs).
F-3.06 done — timer in server time with red pen under 10 minutes, polite Time announcements at 10, 5 and 1 minutes, T reads the time left
F-3.07 done — IndexedDB-first answers and offline exam payload, batched sync with seq and backoff, refused answers shown, per-user rate limits on answers and events
F-3.08 done — submit with flush and offline retry, submitted screen, auto-submit task in the worker with reschedule, local task dispatcher, grading from the stored draw, leaderboard task queued
F-3.09 done — navigate route storing first serve times, timed questions lock and advance, forward-only navigation, server refusals after limit plus 2 s; answers refused inside the transaction once an attempt is finished (review fix)
F-3.10 done — events logged and counted in one transaction with 3 s dedupe, termination at the maximum grades once, admin event timeline, client reporter with the Strike n of m warning before the API answers
F-3.11 done — lockdown: fullscreen exit, tab hidden and window blur strikes, devtools policy keys, context menu, copy, paste, print and selection blocked (fixed fractional clientTs refusals from F-3.10)
F-3.12 done — camera reopened on the exam, on-device face checks every 500 ms, no_face after 5 s and multiple_faces after 2 s as one incident, collapsible self-view keeps the camera on
F-3.04 done — PERF-05 passes now that the no_face warning exists (no MediaPipe refetch after preflight)
F-3.13 done — phone pairing on the rules screen (QR, 5-minute single-use token, device custom token), phone page with heartbeat and camera, Reconnect your phone after 15 s and strike after 60 s, REL-05 suspension, Realtime Database rules with tests
Checkpoints: mid-phase review found 1 blocking issue (palette drawer hiding focus) plus the idempotency-before-account-check order; release-gate review and QA found 4 blocking issues (API waiting on RTDB writes during an outage, RTDB never reconnecting in the browser because the CSP blocked long-polling, Tab past the last control counting as a strike, admin editor sideways scroll at 320 px) plus worker task auth defaulting open and unbounded event details; a production-mode crash from the local dispatcher was fixed too. Each fixed after a regression test; minor findings in docs/BACKLOG.md.
VERIFY full PASS 02e05bc44edf6760eac215c1cbc0397eb4b669f3 (docs/verification/phase-3.md)
PHASE 3 DONE 13/13 features

## Phase 4

PHASE 4 START 6903f950a6771bd580414b3936e31b97a3fcd385
Tests: 27 phase 4 acceptance tests by test-author for F-4.02 to F-4.06 (F-4.01 is unit-only), reviewed twice (3 blocking race fixes, then pass), locked.
F-4.01 done — rankTest and rankSeries with shared ranks, missed tests as 0, only submitted and auto-submitted attempts ranked, board ids, 5,000-row paging, student top 50 plus own row, board schemas (shared, unit-tested)
F-4.02 done — release modes (immediate, after window close via release task, manual, never), withdraw with "Results are being reviewed", admin results list and release region, student result view within the release level, leaderboard recompute queued on release (handler and read finished in F-4.05)
F-4.03 built — result page with score, out of, percentage, rank from the stored board, sections, time and strikes; full review; terminated reason; dashboard Completed links; worker leaderboard recompute handler. verify feature FAIL on one locked assertion only (two MathML formulas where the test expects one): TEST_CHANGE_REQUESTS.md, docs/blocked/phase-4-F-4.03.md
F-4.04 done — student history by series and day with scores only where the release allows, /student/history page and student nav links, graded-attempts scenario; fixed the settings tab dropping window seconds (TEST_LOCKED once attempts started)
F-4.05 done — student and admin leaderboard reads with admission checks, top 50 plus own highlighted row for students and every row for admins, 30-second slot recompute tasks, student list and board pages, admin test and series leaderboard sections, more-students scenario
F-4.06 done — test and series exports as CSV or XLSX built by the worker export task, export records and status routes, 15-minute signed download links, formula cells neutralised by one shared rule (packages/shared csv.ts)
Checkpoints: mid-phase review found 1 blocking issue (series boards over Firestore's 1 MiB document limit) plus a production-only export link key; release-gate review found the XLSX sheet names Excel refuses; QA found admin results pages blank and looping requests with leaderboards off; full runs exposed the admin heading appearing before the leaderboard table, a reload aborting the profile-lock PATCH, a client-wide keepalive slowing exam requests and a slow ORG-01 walk. Each fixed after a regression test; double release and double export clicks fixed too; minor findings in docs/BACKLOG.md.
VERIFY full FAIL acad3561604567d775d7fcef249c255d6226fa3b (docs/verification/phase-4.md): the only failing test is the locked F-4.03.spec.ts:171 assertion (TEST_CHANGE_REQUESTS.md); F-4.03 and F-3.03 (shared DATA-05) are listed in docs/blocked/.
PHASE 4 DONE 5/6 features
