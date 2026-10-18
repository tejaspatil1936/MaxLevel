# Test change requests

Locked acceptance tests the build believes are wrong. The owner decides; the build does not edit locked tests.

## 2026-10-18 — tests/acceptance/phase-3/F-3.12.spec.ts:126 "PR-03 the self-view can be collapsed…" is intermittent

- What happens: about 1 run in 4 fails with `clock.pauseAt: Cannot fast-forward to the past`, with or without later
  changes (found by the phase 4 test author, reproduced on the committed tree).
- Why: the test calls `page.clock.pauseAt(Date.now() + 100)` after `page.clock.install()`. Playwright's installed clock
  can already be ahead of the Node process's `Date.now()` by more than 100 ms (the page has been running timers since
  install), so the pause target is in the clock's past.
- Proposed change: pause relative to the page clock, for example
  `await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000)`, or call `page.clock.runFor(...)` instead
  of pausing at an absolute time.
- Effect until then: a full verify can fail on this test alone; a rerun passes. No application change can avoid it.
