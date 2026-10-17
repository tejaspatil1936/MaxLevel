# MITAOE Prep build kit — claude.ai/code

Everything runs in Claude Code cloud sessions at claude.ai/code: no laptop builds, no Codespace minutes. Each session is a
fresh Ubuntu VM (4 vCPU, 16 GB) that clones your repo, runs the setup in this kit, and keeps working with your laptop closed.
Commits are small, typed and traced to requirement IDs, and git hooks reject anything else.

## What is in the kit

| File | Job |
| --- | --- |
| `CLAUDE.md` | Rules Claude reads every session: stack, cloud notes, commit rules, decision policy |
| `.claude/settings.json` | Deny rules and four hooks: session start, guard, Stop gate; Opus for subagents |
| `scripts/cloud-setup.sh` | Paste into the cloud environment: Node 24, Firebase CLI and emulators, gitleaks, Semgrep, Playwright system libraries |
| `scripts/session-start.sh` | Every session: Node 24 on PATH, git hooks installed, dependencies and Chromium installed, loop status shown |
| `.claude/hooks/guard.mjs` | Blocks edits to the spec, legacy, locks and hooks; blocks `git add -A`, `--amend`, `--no-verify`, force push, push to main, deploys |
| `.claude/hooks/stop-gate.sh` | During a build loop only: Claude cannot stop until `verify.sh fast` passes; writes BLOCKED.md after 5 failures |
| `.claude/agents/` | `test-author` (tests from the spec only), `spec-reviewer`, `qa-explorer` |
| `scripts/check-commit.mjs` | Commit message and size rules |
| `scripts/req-coverage.mjs`, `scripts/locks.mjs`, `scripts/loop.sh` | Requirement coverage, checksum locks, Stop gate on/off |
| `scripts/gh-pr.sh` | Opens PRs and reads CI through GitHub's REST API (`gh pr` does not work in cloud sessions) |
| `lefthook.yml` | Git hooks: gitleaks, ESLint, Prettier, typecheck, commit message |
| `docs/prompts/` | The five prompts |

## 1. Set up once (about 20 minutes)

1. **GitHub.** Create a private repo `mitaoe-prep`. Install the Claude GitHub App on it (github.com/apps/claude); cloud sessions
   need it to clone and push a private repo, and auto-fix needs it too.
2. **Put the kit in the repo.** Add the kit files at the root, your design at `docs/SYSTEM_DESIGN.md`, and the old project at
   `legacy/`, on `main`. After uploading, check on GitHub that `.claude/` is there; some browsers drop hidden folders on upload.
3. **Repo settings.** Settings → General → Pull Requests: turn off **Allow squash merging** (it would collapse your granular
   commits into one), keep **Allow merge commits**. Settings → Rules: protect `main` (require a pull request and the CI check).
4. **Cloud environment.** At claude.ai/code, open the environment selector under the message box → add an environment:
   - Name: `mitaoe`
   - Network access: **Custom**, keep the default allowlist included, and add:
     ```text
     cdn.playwright.dev
     playwright.download.prss.microsoft.com
     playwright.azureedge.net
     fonts.gstatic.com
     firebase-public.firebaseapp.com
     ```
   - Environment variables:
     ```text
     CLAUDE_CODE_SUBAGENT_MODEL=claude-opus-5-5
     BASH_DEFAULT_TIMEOUT_MS=600000
     BASH_MAX_TIMEOUT_MS=1800000
     ```
   - Setup script: paste the whole of `scripts/cloud-setup.sh`.
5. **Test it.** Start a session on the repo with the `mitaoe` environment and send:
   `Run node -v, firebase --version, gitleaks version, semgrep --version and lefthook version, and show me the session start message.`
   Expect Node v24 and all four tools. The first session takes a few minutes; later ones start from the cache.

## 2. Starting each session

New session (from the sidebar; `/clear` does not exist in cloud sessions) → repo `mitaoe-prep` → environment `mitaoe` →
branch as the table says → mode dropdown **Auto** → paste the line. You can do this from the Claude app's Code tab on your phone too.

## 3. Run order

| Step | Branch to start on | You type |
| --- | --- | --- |
| A. Audit (once) | `main` | `Read docs/prompts/01-audit.md and carry it out.` |
| You | `build/setup` | Answer the phase-0 questions in `docs/OPEN_QUESTIONS.md` (edit on GitHub), commit `docs(docs): answer phase 0 questions` |
| B. Scaffold (once) | `build/setup` | `Read docs/prompts/02-scaffold-harness.md and carry it out.` |
| You | | Review the PR and merge it with **Create a merge commit** |

Then for each phase N from 0 to 8, one session per step:

| Step | Branch to start on | You type |
| --- | --- | --- |
| 1. Questions | | Read the questions phase N needs in `docs/OPEN_QUESTIONS.md` on GitHub (`main` is protected, so answer in step 2) |
| 2. Tests | `main` | `Read docs/prompts/10-phase-tests.md and carry it out for phase N. My answers: 7) yes. 8) PRN. 9) ...` |
| 3. Build | `phase/N-...` | The goal line below |
| 4. Release | `phase/N-...` | `Read docs/prompts/30-phase-release.md and carry it out for phase N.` Then turn on **Auto-fix** in the session's CI status bar |
| 5. You | | Read the PR, the `DECISIONS.md` additions and the Playwright videos of 3 or 4 key journeys (CI artifacts); do the phase's `OWNER_SETUP.md` steps; merge with a merge commit |

The goal line for step 3. Replace N in both places; `/goal` must be the start of the message:

```text
/goal Either BLOCKED.md exists and you have printed it, OR all of these hold: every phase-N feature is true in .verify/status.json; the last line you printed from scripts/verify.sh full is "VERIFY full PASS" followed by the output of git rev-parse HEAD; git status --porcelain prints nothing; and the latest spec-reviewer report has VERDICT: PASS. Method: read docs/prompts/20-phase-build.md and carry it out for phase N. Stop after 150 turns and write a status summary to PROGRESS.md.
```

## 4. Granular commits: what gets enforced

| Rule | Enforced by |
| --- | --- |
| `type(scope): summary`, max 72 characters, fixed type and scope lists | `check-commit.mjs` |
| `Refs: EX-10, EX-11` on every feat, fix, test and perf commit; IDs must exist in the requirement map | `check-commit.mjs` |
| At most 300 changed lines and 12 files; bigger only with `Large-Change: <reason>` | `check-commit.mjs` |
| One concern per commit: schema, then data access, then route, then UI | `CLAUDE.md`; the size limit makes mixing hard |
| Explicit `git add <files>`; no `-A`, `.`, `-a`, `--amend`, `--no-verify`, rebase, force push, push to main | `guard.mjs` and deny rules |
| No secrets; lint, format and types clean | `lefthook.yml` |
| One PR per phase, merged with a merge commit | your repo settings |

Cloud commits also carry a `Claude-Session:` trailer linking the session that made them. `git log --grep EX-10` finds every
commit for a requirement.

## 5. What only you do

- Answer `docs/OPEN_QUESTIONS.md` before each phase. Unanswered ones get the proposed default, marked AUTO-DECIDED.
- Everything in `docs/OWNER_SETUP.md`: GCP and Firebase projects, service accounts, load balancer, DNS, Vercel, Sentry, the
  LLM key, and two short webcam clips for the camera tests (upload them to `tests/fixtures/camera/` on GitHub).
- Merge each phase PR. Run the staging checks in `docs/MANUAL_CHECKS.md` (k6, screen readers, the pilot).
- Change a lock: edit or delete `tests/acceptance.lock` or `.claude/harness.lock` on GitHub, then in a session ask Claude to
  make the change and re-lock. Claude cannot unlock anything itself.

## 6. When something stops

| You see | Do this |
| --- | --- |
| `BLOCKED.md` | Read it, fix the cause or answer it, then send: `Delete BLOCKED.md and continue toward the goal.` |
| "Goal paused" at a usage limit | It resumes after the reset if the session waits for it; otherwise send `continue toward the goal` |
| Session was idle and its VM was rebuilt | Open it and send `continue toward the goal`; Claude restarts the loop (CLAUDE.md tells it how) |
| You want Claude to stop | Press stop, or send: `Owner pause: write BLOCKED.md saying "paused by owner" and stop.` |
| A commit keeps being rejected | The hook message names the rule that failed |
| Playwright or emulator download fails | Add the host from the error to the environment's allowed domains |

Check progress any time by asking for `scripts/loop.sh status`, `tail -20 PROGRESS.md`, `git log --oneline -15` or `/usage`.
