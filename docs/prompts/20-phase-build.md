# Prompt 20 — Build loop for one phase

You run this inside a /goal the owner started; the owner's message names phase N. Branch: phase/N-<short-name>.
Follow CLAUDE.md throughout, especially the commit rules and the decision policy.

## Start
0. If the session was resumed on a rebuilt VM, check `scripts/loop.sh status` first; the start step below is safe to repeat.
1. `scripts/loop.sh start N` (from now on you cannot stop while the fast gate fails).
2. Read PROGRESS.md, `git log --oneline -30`, .verify/status.json if it exists, and TEST_CHANGE_REQUESTS.md if it exists.

## For each phase-N feature in feature_list.json, in depends_on order, skipping features already true in .verify/status.json
1. `scripts/loop.sh feature <id>`
2. Spawn a fresh general-purpose agent in the foreground with this brief:
   - the feature entry, and the full text of each of its REQ IDs copied from docs/SYSTEM_DESIGN.md;
   - "Read CLAUDE.md, PLAN.md, docs/DECISIONS.md, docs/testids/phase-N.md and the feature's acceptance file in tests/acceptance/phase-N/.
     Do not edit locked tests. Implement the feature as a series of small commits that each follow CLAUDE.md:
     shared schema or logic, then data access, then route, then UI, each with its own unit or integration tests whose titles
     start with the REQ IDs they prove. Run `scripts/verify.sh feature <id>` until it passes, then report the commits you made
     and anything you logged in DECISIONS.md or TEST_CHANGE_REQUESTS.md."
3. When it returns, run `scripts/verify.sh feature <id>` yourself. Do not trust its report alone.
4. Passed: `git push`, append one line to PROGRESS.md (`F-N.xx done — <summary>`) and commit it on its own.
   Print one line: `FEATURE <id> done <n>/<total>`.
5. Failed: give one more fresh agent the failure output. After three failed agents, log it in PROGRESS.md, apply decision
   policy rule 5 if other features depend on it, otherwise move on. Print `FEATURE <id> failed <n>/<total>`.

## Every 5 features, and once at the end
1. `scripts/verify.sh full --phase N`.
2. Start the stack as .verify/VERIFICATION.md describes and spawn the qa-explorer agent for the screens this phase touched.
3. For each blocking bug: a failing test in tests/regression/ as its own commit (`test(<scope>): ...`, Refs), then the fix as
   its own commit. Minor bugs go to docs/BACKLOG.md.
4. Spawn the spec-reviewer agent on `git diff main...HEAD`. Fix blocking findings the same way; the rest go to docs/BACKLOG.md.

## Finish
Run `scripts/verify.sh full --phase N` and print its last line. Then `scripts/loop.sh stop`.
If BLOCKED.md exists, print it instead and stop.
