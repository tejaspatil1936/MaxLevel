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
