# Prompt 10 — Acceptance tests for one phase

The owner's message names the phase number N. Branch: phase/N-<short-name>, created from the latest main.
Read CLAUDE.md, PROGRESS.md and `git log --oneline -20` first.

## 1. Decisions for this phase
The owner's message may contain answers, by question number. Write them under each question's `Answer:` line in
docs/OPEN_QUESTIONS.md, and fold every answered question needed by phase N into docs/DECISIONS.md (one commit).
If an answer approves a Proposed requirement, note that the owner must set its status to "approved" in docs/req-matrix.json
(the matrix is under the harness lock) and add it to PROGRESS.md as an owner action. Any question needed by
phase N that still has no answer: apply its proposed default and mark it AUTO-DECIDED in OPEN_QUESTIONS.md and DECISIONS.md.

## 2. Tests from the spec, not the code
Spawn the test-author agent with: "Phase N. Features: <the feature ids of phase N from feature_list.json>."
Wait for it in the foreground.

## 3. Independent review
Spawn the spec-reviewer agent on the new files in tests/acceptance/ and docs/testids/phase-N.md.
Have the test-author fix every blocking item. Repeat the review once if anything was blocking.

## 4. Fail for the right reason
Run the phase's acceptance tests. Every test must fail because the feature is missing (route, element or endpoint absent),
never because of a syntax, import, fixture or seed error. Fix any that fail for the wrong reason.

## 5. Commit and lock
Commit in this order, each on its own:
1. docs/testids/phase-N.md (`docs(docs): add phase N test id contract`)
2. page objects and fixtures (`test(e2e): ...`, Refs: the REQ IDs they serve)
3. one commit per feature's spec file (`test(e2e): add acceptance tests for F-N.xx`, Refs: its REQ IDs)
Then run `node scripts/locks.mjs acceptance write --phase N` and commit tests/acceptance.lock alone
(`test(e2e): lock phase N acceptance tests`, Refs: one REQ ID of the phase). Push the branch.

Reply with one line: how many tests, how many REQ IDs covered, anything moved to integration or manual and why.
