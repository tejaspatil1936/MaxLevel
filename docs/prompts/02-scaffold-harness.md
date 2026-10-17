# Prompt 02 — Scaffold and verification harness (run once)

Branch: build/setup. Read CLAUDE.md (including the cloud session notes), docs/SYSTEM_DESIGN.md, docs/OPEN_QUESTIONS.md, docs/TEST_ENV.md, docs/req-matrix.json.
Commit granularly as CLAUDE.md requires: one tool or concern per commit. Scaffolding commits may use a Large-Change trailer.

## 1. Decisions
Fold every answered question in docs/OPEN_QUESTIONS.md into docs/DECISIONS.md: one line each with date, question number,
decision and REQ IDs. If a phase-0 question has no answer, apply its proposed default and mark it AUTO-DECIDED in both files.
If an answer approves a Proposed requirement, set its matrix status to "approved" in the same commit.

## 2. PLAN.md
Architecture as it will be built (spec 9), repo layout (9.5), and as TypeScript signatures:
- the data-access layer, where every function takes orgId (ORG-03);
- interfaces Clock (system | test), TaskQueue (cloud-tasks | local), StorageSigner, LlmClient (AI SDK | mock);
- the Firestore and Realtime Database model from spec 10 as types;
- the test-only API surface (clock control, run due tasks, seed), enabled only when NODE_ENV=test and a TEST_API_SECRET is set,
  and absent from production builds;
- build order inside each phase.

## 3. Scaffold, in this commit order
Each step builds and its smoke test passes before the next commit.
1. pnpm workspace and Turborepo with tasks build, typecheck, lint, test, test:int.
2. packages/config: tsconfig (strict), ESLint flat config, Prettier.
3. packages/shared: Zod, Vitest, the Clock interface.
4. packages/ui: tokens from spec 13.3 to 13.5 as CSS variables for light, dark and high contrast; Tailwind v4 @theme; fonts via next/font later.
5. apps/web: Next.js static export per WEB-01 to WEB-05 and vercel.json headers.
6. apps/api: Fastify with fastify-type-provider-zod, /health, the X-Server-Time header (API-03) and the error shape (API-01).
7. apps/worker: Fastify with a /tasks/* skeleton that checks OIDC in production and is open only in test mode.
8. firebase.json and .firebaserc for the demo project ID `demo-mitaoe` (demo- projects need no Google sign-in), with Auth, Firestore, Realtime Database and Storage emulators,
   and deny-all Firestore and Storage rules (DATA-08, DATA-09).
9. lefthook as a devDependency with a prepare script running `lefthook install`.

## 4. Test setup
- Vitest unit tests per package (*.test.ts). Integration tests (*.int.test.ts) run against the emulators: reuse them when
  their ports are open, otherwise run under `firebase emulators:exec`. Rules tests (*.rules.test.ts) use @firebase/rules-unit-testing.
- Playwright (as a root devDependency, so `pnpm exec playwright` works from the repo root) in tests/ with projects desktop (1280), exam (1024) and phone (390). It runs against the static export served
  locally, plus the built API and worker against the emulators. retries: 0; trace and video kept on failure;
  an @axe-core/playwright helper that fails on serious or critical violations.
- tests/fixtures/camera/: generate the no-face clip with ffmpeg; leave README.md there saying which owner clips go where.
- A seed script that creates orgs A and B, a super admin, two admins per org, departments and 20 students, all on the emulators.

## 5. feature_list.json
Every agreed (or approved) requirement of phases 0 to 8 grouped into features of roughly 1 to 3 hours of work:
`{ "id": "F-3.04", "phase": 3, "title": "...", "req_ids": ["EX-10", "EX-11"], "acceptance": "what proves it", "depends_on": [] }`
No pass field: pass status lives only in .verify/status.json, written by verify.sh. Every agreed REQ appears in exactly one feature.

## 6. scripts/verify.sh
Modes: `fast`, `full [--phase N]`, `feature <id>`.
- fast (target under 3 minutes): `node scripts/locks.mjs harness check`, `node scripts/locks.mjs acceptance check`,
  `node scripts/req-coverage.mjs`, typecheck, lint, unit tests, integration and rules tests on the emulators.
- feature <id>: fast, then the production builds, then only that feature's acceptance file.
- full: fast, then production builds (web static export, api, worker), the Playwright suite for every locked phase,
  regression tests in tests/regression/, axe, Semgrep, `gitleaks git --redact`, `pnpm audit --prod`, knip, and a check
  that playwright.config.ts has retries 0 and no test uses waitForTimeout.
- All modes refuse PASS if `git status --porcelain` shows anything outside .verify/.
- All modes write .verify/status.json `{ "commit": "<HEAD>", "mode": "...", "result": "PASS|FAIL", "features": { "F-3.04": true } }`
  (a feature passes when every test whose title names one of its REQ IDs passed in this run, and it has at least one such test)
  and .verify/VERIFICATION.md. Its first line says whether harness or locked test files changed; then one row per REQ ID with
  its tests, result and links to traces or screenshots; then how to start the stack for manual checks.
- The last line printed is exactly `VERIFY <mode> PASS <full HEAD hash>` or `VERIFY <mode> FAIL`.

## 7. CI
.github/workflows/ci.yml: on pull_request and on push to main only (running on every branch push would use up the free
GitHub Actions minutes). Install the same toolchain (Node 24, pnpm, Java 21, firebase-tools, gitleaks, semgrep,
Playwright Chromium), run `scripts/verify.sh full`, and upload .verify/ and the Playwright report as artifacts.
It never deploys anything.

## 8. Prove the harness
In a copy under /tmp/harness-test: break one function in packages/shared and confirm `verify.sh fast` prints VERIFY fast FAIL;
change one character in a file covered by the harness lock (after step 9) and confirm the lock check fails. Delete the copy.
Note both results in PROGRESS.md.

## 9. Finish
Run `scripts/verify.sh fast` and `scripts/verify.sh full`. Then run `node scripts/locks.mjs harness write` and commit
.claude/harness.lock on its own (`build(harness): freeze verification harness`). Push build/setup and open a pull request
to main with `scripts/gh-pr.sh create` (write the body to a file first): what was built, the DECISIONS added, AUTO-DECIDED items, and the harness self-test results.
Check CI with `scripts/gh-pr.sh checks` and fix failures with new commits. Do not merge.
