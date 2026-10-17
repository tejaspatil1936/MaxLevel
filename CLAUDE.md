# MITAOE Prep — working rules

Spec: docs/SYSTEM_DESIGN.md (the owner's file: read it, never edit it). Requirement map: docs/req-matrix.json.
Plan: PLAN.md. Decisions: docs/DECISIONS.md. Progress: PROGRESS.md. Prompts: docs/prompts/.
legacy/ is a read-only reference. Section 15.1 of the spec lists what to reuse and what never to carry over.

## Commands
- pnpm install; pnpm turbo run build | typecheck | lint | test
- scripts/verify.sh fast | full [--phase N] | feature <id> (starts the emulators itself when they are not running)
- scripts/loop.sh start N | feature <id> | stop | status
- scripts/gh-pr.sh create "<title>" <body-file> | checks (use this, not gh pr: GraphQL is blocked in cloud sessions)

## Cloud sessions (claude.ai/code)
- Node 24 is at /opt/node24/bin. If `node -v` is not v24, prefix commands with PATH=/opt/node24/bin:$PATH.
- Give long commands a long timeout (verify full can take 20 minutes); never cut a gate short to save time.
- The VM can be rebuilt between turns: background processes and .claude/state/ may be gone.
  If you are in a /goal build loop and `scripts/loop.sh status` says "Loop off", run `scripts/loop.sh start N` again.
- Run subagents in the foreground and wait for them.

## Stack rules
- TypeScript strict everywhere. Zod schemas in packages/shared define every request and response.
- Scoring, question draw, settings resolution and timing rules live only in packages/shared (spec 9.5).
- Every data-access function takes orgId (ORG-03). Admin routes allow "admin of this org, or super admin with X-Org-Id" (ORG-11).
- Domain code gets time from the injected Clock and enqueues work through the TaskQueue interface. Never call Date.now() directly.
- Students never receive correctOptionIds or explanation before a full review is released (DATA-05). Response schemas enforce it.
- apps/web is a static export: no route handlers, server actions or middleware; IDs travel in search params (WEB-01, WEB-02).
- UI uses the section 13 tokens and components only. Nothing from the section 13.11 "Not allowed" list.
- Tests: Firestore, RTDB, Auth and Storage run on the emulators, never mocked. Only the LLM and Cloud Tasks are faked, through their interfaces.
- Tests never use fixed waits (waitForTimeout) or retries. Wait on events, network responses or visible state.

## Commits (enforced by hooks; read before every commit)
- One logical change per commit, and each commit builds on its own.
- Order a feature as separate commits: shared schema or logic, then data access, then API route, then UI, then tests that are not already beside their code.
- Header: type(scope): summary. Types: feat fix test refactor perf docs build ci chore style revert.
  Scopes: web api worker shared ui config e2e infra harness docs deps repo. Max 72 chars, lowercase start, no period.
- feat, fix, test and perf commits end with a trailer: Refs: EX-10, EX-11
- At most 300 changed lines and 12 files (lockfiles, docs, snapshots and binaries are not counted).
  Bigger only for scaffolding or generated code, with the trailer: Large-Change: <reason>
- Stage explicit paths: git add <file> <file>. Never git add -A, git add ., -u, commit -a, --amend, --no-verify, rebase, reset --hard, force push, or push to main.
- If a hook rejects a commit, fix the cause and commit again. Never work around a hook.
- Push after every finished feature. Work on the branch the current prompt names.

## Decision policy
1. The spec or DECISIONS.md says it: do it.
2. Silent and reversible: pick the simplest option that fits the stack, add one line to docs/DECISIONS.md, keep going.
3. The spec contradicts itself: follow the more specific section, log it in DECISIONS.md and OPEN_QUESTIONS.md, keep going.
4. Never stop to ask about naming, styling, folder layout, or a library inside the approved stack (spec 9.4).
   Every new dependency gets a DECISIONS.md line.
5. Stop and write BLOCKED.md only for: staging or production systems, real student data, paid services,
   credentials you do not have, deleting data that existed before this session, or a feature that failed three fresh attempts.
6. Pass status is written only by scripts/verify.sh into .verify/. Never edit locked acceptance tests, lock files,
   hooks, .claude/settings.json or legacy/. If a locked test looks wrong, write it in TEST_CHANGE_REQUESTS.md and move on.
   If only a selector is wrong, fix the page object in tests/acceptance/pages/.
7. "Proposed" items in the spec are not built unless DECISIONS.md approves them.

## Blocking findings (the only reviewer findings that must be fixed before a phase ends)
A requirement not met, a crash, lost or leaked data, a tenant-isolation hole, an answer-key exposure,
a security issue, or a WCAG 2.2 AA failure on a changed screen. Everything else goes to docs/BACKLOG.md.

## Context
- When compacting, keep: phase, current feature id, files changed, last verify line, open blockers.
- Status messages in the conversation: one line, under 20 words. Detail goes in PROGRESS.md.
