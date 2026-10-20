# Prompt 00 — Unattended build of every phase (one session)

The owner is asleep and will not answer anything. Never wait for a reply. Work through A, B and D in order.

## Overrides (these win over the other prompts)
1. Branch: all work happens on build/all. Wherever a prompt says to create or use another branch (build/setup, phase/N-...) or to branch from main, stay on build/all. Push after every feature and every phase.
2. Questions: never wait. For every question in docs/OPEN_QUESTIONS.md, apply its proposed default, write "Answer: AUTO-DECIDED, <default>" under it, and log it in docs/DECISIONS.md. Proposed requirements stay unbuilt.
3. No pull request until section D. Skip the PR and CI-watching steps in prompts 02 and 30.
4. Diffs: wherever a prompt says `git diff main...HEAD`, use `git diff <start>...HEAD`, where <start> is this phase's `PHASE N START <sha>` line in PROGRESS.md.
5. Run every prompt yourself in this session. Never hand a whole prompt to a subagent, because subagents cannot start their own subagents. Start only the agents the prompts name (test-author, spec-reviewer, qa-explorer, one general-purpose agent per feature), always in the foreground.
6. Owner-only items (cloud projects, staging, real keys, webcam clips) are skipped. Tests that need them become entries in docs/MANUAL_CHECKS.md, never fake passes. Never touch real cloud accounts.
7. Keep this conversation small: one status line per feature, three lines per phase. Detail goes in PROGRESS.md. After any compaction, re-read PROGRESS.md and this file before continuing.

## A. Setup
Carry out docs/prompts/01-audit.md, then docs/prompts/02-scaffold-harness.md, with the overrides.

## B. Phases 0 to 8, in order
For each phase N:
1. Commit a line `PHASE N START <current HEAD sha>` to PROGRESS.md.
2. Carry out docs/prompts/10-phase-tests.md for phase N.
3. Carry out docs/prompts/20-phase-build.md for phase N.
4. Carry out steps 1 to 4 of docs/prompts/30-phase-release.md for phase N.
5. Commit `PHASE N DONE <passing>/<total> features` to PROGRESS.md, push, and print the same line.

If BLOCKED.md appears during a phase: run `scripts/loop.sh stop`, then move BLOCKED.md to docs/blocked/phase-N-<feature-id>.md and commit it. If no later feature depends on the blocked one, continue. If one does, leave BLOCKED.md at the repo root, print it and stop.

## D. Finish
1. Run `scripts/verify.sh full`, print its last line, then print `git rev-parse HEAD`.
2. Write docs/MORNING_REPORT.md: passing/total features per phase, every file in docs/blocked/ with a one-line reason, all AUTO-DECIDED answers, TEST_CHANGE_REQUESTS.md entries, and the owner actions from OWNER_SETUP.md and MANUAL_CHECKS.md. Commit and push.
3. Open one pull request to main with `scripts/gh-pr.sh create "Build: phases 0 to 8" docs/MORNING_REPORT.md` and print its URL. Check CI with `scripts/gh-pr.sh checks` until every run finishes, and fix failures with new commits. Never merge.
