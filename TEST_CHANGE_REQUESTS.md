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

## 2026-10-18 — tests/acceptance/phase-4/F-4.03.spec.ts:171 "RES-03 SER-10 DATA-05 a full review lists every question…" expects one `math` element

- What happens: `expect(result.reviewItem(3).locator('math')).toHaveCount(1)` fails with `Received: 2`. Every other
  check of the test passes (checked with a temporary, uncommitted copy of the test that only relaxes this line).
- Why: review item 3 is the seeded question `If $x + 3 = 7$, what is $x$?` (fixtures/authoring.ts `BASIC_QUESTIONS[2]`,
  api test-support `scenarios.ts`), which holds two inline formulas. Rendered "as on the exam screen" (contract, Review
  items), KaTeX's MathML output gives one `<math>` element per formula, so two. The phase 2 tests on the same prompt
  already use `math.first()` (F-2.05:60, F-2.07:104). Showing one `<math>` would mean merging or dropping a formula.
- Proposed change: `await expect(result.reviewItem(3).locator('math').first(), 'math as MathML in the review').toBeAttached();`
  (or `toHaveCount(2)`).
- Effect until then: `scripts/verify.sh feature F-4.03` fails on this one assertion; no application change can pass it
  without rendering the prompt wrongly.
