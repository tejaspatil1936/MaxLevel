# F-4.03 Result page and full review — blocked by one locked assertion

- Status: the feature is built and pushed. `scripts/verify.sh feature F-4.03` passes 600 of 601 tests.
- Failing: tests/acceptance/phase-4/F-4.03.spec.ts:171 expects exactly one `math` element in review item 3.
  That item is the seeded prompt `If $x + 3 = 7$, what is $x$?`, which holds two formulas, so the MathML rendering
  the contract asks for ("as on the exam screen") gives two. Phase 2 tests on the same prompt use `math.first()`.
- With only that line changed to `.first()…toBeAttached()`, every other check in the test passes (checked with an
  uncommitted copy).
- Owner action: approve the entry in TEST_CHANGE_REQUESTS.md (2026-10-18, F-4.03.spec.ts:171) and relock phase 4.
- Later features continue: the application code F-4.04 and F-4.05 depend on is complete.
