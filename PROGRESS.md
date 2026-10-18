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
