# F-5.05 Screenshot tests, pre-warming and exam-day runbook — verify fails on the acceptance-lock step

- Status: the feature is built and pushed; every verify step except `acceptance-lock` passes and
  .verify/status.json shows F-5.05 true.
- Failing: `scripts/locks.mjs acceptance check` reports the twelve committed screenshot baselines in
  tests/acceptance/phase-5/F-5.05.spec.ts-snapshots/ as files "added to locked phase 5", because `acceptance write`
  locks only `*.spec.ts`. The repo guard forbids moving or deleting anything in a locked phase folder, so the build
  cannot relocate them, and locks.mjs is a harness file.
- Effect: every verify run from this point (feature and full) prints FAIL on `acceptance-lock` alone until the owner acts.
- Owner action: approve the TEST_CHANGE_REQUESTS.md entry (skip or lock `*-snapshots/` in scripts/locks.mjs), then
  re-lock phase 5; or move the baselines under tests/snapshots/ with a `snapshotPathTemplate` in playwright.config.ts.
