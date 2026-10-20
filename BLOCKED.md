# BLOCKED: the final gate needs two owner changes to locked or harness files

The build of phases 0 to 8 is complete: PROGRESS.md has "PHASE 8 DONE", docs/MORNING_REPORT.md is committed, and pull
request https://github.com/tejaspatil1936/TestPrep/pull/1 is open. `scripts/verify.sh full` (locally and in CI)
fails only on two items that the build is not allowed to change (CLAUDE.md decision policy 6):

1. **acceptance-lock step.** `scripts/locks.mjs acceptance check` reports the 12 F-5.05 screenshot baselines in
   `tests/acceptance/phase-5/F-5.05.spec.ts-snapshots/` as files "added to locked phase 5", because
   `acceptance write` locks only `*.spec.ts`. locks.mjs is a harness file, and the repo guard forbids moving or deleting
   anything in a locked phase folder. Every verify run (fast, feature and full) fails this step until it changes.
   Owner action: skip or lock `*-snapshots/` in scripts/locks.mjs, then relock phase 5; or move the baselines under
   tests/snapshots/ with a `snapshotPathTemplate` in playwright.config.ts.
2. **One locked acceptance assertion.** `tests/acceptance/phase-4/F-4.03.spec.ts:171` expects one `math` element in a
   prompt that holds two formulas (`$x + 3 = 7$` and `$x$`); every other check of that test passes. It marks F-4.03, and
   F-3.03 through the shared DATA-05, as failing. Owner action: `locator('math').first()…toBeAttached()` (or
   `toHaveCount(2)`), then relock phase 4.

Also requested (intermittent, not failing the last runs): `tests/acceptance/phase-3/F-3.12.spec.ts:126` pauses the page
clock at a Node-side time that can be in the page clock's past.

Details and proposed patches: TEST_CHANGE_REQUESTS.md and docs/blocked/. Last verify full in CI on c187861: every other
step passed, 383 e2e tests passed.
