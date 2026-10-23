# Test change requests

Locked acceptance tests the build believes are wrong. The owner decides; the build does not edit locked tests.

All entries below were approved by the owner on 2026-10-20 and applied in 15d6bc8 (phases 3 and 4 relocked,
scripts/locks.mjs refrozen). None are open.

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

## 2026-10-19 — the acceptance lock counts the F-5.05 screenshot baselines as added tests

- What happens: after the UI-15 baselines are committed where the contract puts them
  (`tests/acceptance/phase-5/F-5.05.spec.ts-snapshots/*.png`, docs/testids/phase-5.md "Screenshot tests"),
  `scripts/verify.sh` fails its `acceptance-lock` step with `added to locked phase 5: …-snapshots/<name>.png` for
  each of the twelve images. Every other step passes and `.verify/status.json` shows F-5.05 true.
- Why: `scripts/locks.mjs acceptance check` reports every file under a locked phase directory that is not in
  `tests/acceptance.lock`, while `acceptance write` locks only `*.spec.ts`; so no baseline beside a spec can pass, and
  the harness files may not be edited by the build.
- Proposed change: in `scripts/locks.mjs`, either skip `*-snapshots/` paths in the "added" check, or lock them too
  (`acceptance write` taking every file of the phase, so a regenerated baseline is a reviewed lock change, which fits
  the contract's "regenerated only together with an intended visual change"), then re-lock phase 5. Alternative
  without a harness change: a `snapshotPathTemplate` in playwright.config.ts outside `tests/acceptance/phase-*/`,
  which moves the baselines away from where the contract and docs/MANUAL_CHECKS.md say they live.
- Effect until then: `scripts/verify.sh feature F-5.05` and every later phase 5 verify print FAIL on
  `acceptance-lock` alone.

## 2026-10-23 — a Microphone preflight row and a privacy note for tests with voice detection

- What happens: voice detection (setting `audioProctoring`, on by default for new tests) needs the microphone, but
  `PreflightPage.passAndContinue` (tests/acceptance/pages/exam-flow.ts) asserts the exact number of check rows and
  `FIX_LINES` lists the only check names, so a `Microphone` row would fail every locked exam test that passes
  preflight. The rules screen's privacy note is also matched word for word (`PRIVACY_NOTE`, F-3.04 EX-02), and with
  voice detection on its second sentence ("Only proctoring events … are sent") is no longer the whole story.
- What the build does meanwhile: preflight asks for the microphone alongside the other devices without a row, and a
  refusal blocks nothing: the exam reports `mic_unavailable` for the admin to see. The rules screen keeps the locked
  note and adds a separate "What this test monitors" list that discloses the 5-second clips and their 14-day deletion.
- Proposed change: add `Microphone` to `FIX_LINES` (fix line: "Allow this page to use the microphone, then choose
  Check again.") and to `ALL_CHECKS` for a test with voice detection on, so a refused microphone keeps the student out
  of the rules like a refused camera; and allow the privacy note to read, with voice detection on, "Camera video never
  leaves your device. Only proctoring events, such as leaving fullscreen, are sent to the server, and a 5-second
  recording when talking is detected."
