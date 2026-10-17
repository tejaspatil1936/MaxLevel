# Prompt 30 — Release gate and pull request for one phase

The owner's message names phase N. Branch: phase/N-<short-name>. Read CLAUDE.md and PROGRESS.md first.

1. Run `scripts/verify.sh full --phase N` and print its last line.
2. Spawn the spec-reviewer on `git diff main...HEAD` and the qa-explorer on every screen of phases up to N.
   Fix only blocking findings, each as a regression test commit followed by a fix commit. Everything else goes to docs/BACKLOG.md.
3. Rerun `scripts/verify.sh full --phase N` until it passes on a clean tree.
4. Copy .verify/VERIFICATION.md to docs/verification/phase-N.md and commit it alone (`docs(docs): record phase N verification`).
   Run verify full once more so the PASS line names the final commit.
5. Push, write the body to /tmp/pr-body.md, and open the pull request with
   `scripts/gh-pr.sh create "Phase N: <name>" /tmp/pr-body.md`:
   - title: `Phase N: <name>`
   - body: REQ coverage and pass counts; DECISIONS.md lines added in this phase; AUTO-DECIDED items; TEST_CHANGE_REQUESTS.md
     entries; BACKLOG.md additions; the docs/OWNER_SETUP.md and docs/MANUAL_CHECKS.md items this phase now needs from the owner.
6. Check CI with `scripts/gh-pr.sh checks` every few minutes until every run has finished. Fix any failure with new
   commits and push again.
7. Do not merge. Reply with the pull request URL and one line on its state.
