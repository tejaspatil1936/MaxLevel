# F-3.12 Laptop camera proctoring — one intermittent locked test

- Status: the feature is built; every F-3.12 test passes on a rerun.
- Failing intermittently: tests/acceptance/phase-3/F-3.12.spec.ts:126 "PR-03 the self-view can be collapsed…" calls
  `page.clock.pauseAt(Date.now() + 100)` after `page.clock.install()`; the page clock can already be past that
  Node-side time, so Playwright throws "Cannot fast-forward to the past". No application change can avoid it.
- Owner action: approve the TEST_CHANGE_REQUESTS.md entry (2026-10-18, F-3.12.spec.ts:126) and relock phase 3.
