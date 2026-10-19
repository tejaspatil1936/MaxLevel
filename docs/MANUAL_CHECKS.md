# Manual and static checks

One entry per requirement whose verify kind is static, manual or infra (docs/req-matrix.json), plus tests that
need something only the owner can provide. Static checks are automated in verify.sh or lint where noted; the rest are
run by a person.

| REQ | Kind | Phase | Check | Who | When |
| --- | --- | --- | --- | --- | --- |
| ORG-03 | static | 0 | Reviewer reads apps/api/src/data/*: every exported function has orgId as its first parameter; the unit test apps/api/src/data/org-scope.test.ts also fails if not. | spec-reviewer | every phase PR |
| AUD-05 | static (proposed) | 8 | Proposed, not built. Confirm retention once approved. | owner | phase 8 |
| WEB-01 | static | 0 | verify.sh full checks next.config output export and images.unoptimized, and that apps/web has no route.ts, middleware.ts or "use server". | verify.sh full | every run |
| WEB-02 | static | 0 | verify.sh full fails if any folder under apps/web/app is a dynamic segment ([id], [...slug]). | verify.sh full | every run |
| WEB-04 | static | 0 | vercel.json defines Content-Security-Policy, Permissions-Policy (camera=self), Referrer-Policy and Strict-Transport-Security; owner confirms the headers on a Vercel preview (OWNER_SETUP 0.8). | verify.sh full; owner | every run; after OWNER_SETUP 0.8 |
| WEB-05 | static | 0 | ESLint rule in apps/web rejects direct fetch in components; reviewer checks every query key starts with [orgId, ...]. | lint; spec-reviewer | every run; every phase PR |
| DATA-11 | infra | 0 | PITR and daily export enabled in staging and prod (OWNER_SETUP 0.2). | owner | before the first real exam |
| SEC-01 | static | 0 | gitleaks git --redact in verify full; grep for private_key, FIREBASE_PRIVATE_KEY and credentials JSON in the repo and workflows finds nothing. | verify.sh full | every run |
| SEC-02 | infra | 0 | Cloud Run services read secrets from Secret Manager mounts (OWNER_SETUP 0.4). | owner | staging deploy |
| SEC-03 | infra | 0 | IAM bindings match OWNER_SETUP 0.3 exactly. | owner | staging and prod setup |
| SEC-09 | static | 0 | renovate.json exists; verify full runs pnpm audit --prod; pnpm install --frozen-lockfile in CI. | verify.sh full; owner installs Renovate | every run; OWNER_SETUP 0.11 |
| PERF-06 | infra | 5 | The prewarm task raises api min instances 30 minutes before a slot; check in staging Cloud Run revisions. | owner | before the first real exam |
| PERF-07 | manual | 5 | k6 run tests/load/exam-500.js against staging; every 12.2 target met. | owner | before the first real exam and after exam-path changes |
| REL-01 | infra | 8 | The deploy workflow stops when a test is live unless the override input is set. | owner | first production deploy |
| REL-02 | infra | 8 | Shift traffic to the previous revision with gcloud run services update-traffic and confirm in seconds. | owner | staging rehearsal |
| REL-07 | static | 5 | docs/runbooks/exam-day.md exists and covers pre-warming, monitoring, extra-time policy for outages and contacts. | spec-reviewer; owner | phase 5 PR |
| OBS-02 | infra | 0 | Sentry receives errors from web, API and worker with releases and source maps (OWNER_SETUP 0.9). | owner | staging |
| OBS-04 | infra | 5 | Alert policies exist and fire on a forced test (OWNER_SETUP 5.1). | owner | staging |
| OBS-05 | infra | 5 | Exam-day dashboard shows active attempts, RPS, latency, errors, instances, Firestore errors. | owner | staging |
| CI-01 | infra | 0 | dev, staging and prod projects exist and Vercel environments map to them (OWNER_SETUP 0.1, 0.8). | owner | phase 0 |
| CI-02 | static | 0 | .github/workflows/ci.yml runs verify.sh full (lint, typecheck, unit, emulator integration, Playwright) on pull requests. | reviewer | every PR |
| CI-03 | infra | 8 | Merge to main builds images, deploys staging, smoke tests, waits for approval and the freeze check, deploys prod. | owner | after OWNER_SETUP 0.5, 0.6, 8.1 |
| CI-04 | static | 8 | Migrations live in apps/worker/src/migrations as numbered scripts run through /tasks/migrate. | spec-reviewer | phase 8 PR |
| UI-02 | static | 0 | Per screen: every state (status pills, palette, sync, strikes) has a shape, icon or words besides colour. | spec-reviewer and qa-explorer | every phase PR touching UI |
| UI-04 | static | 0 | Copy review: sentence case, no all-caps, no eyebrow labels, no middle-dot joins, no arrows in button text. | spec-reviewer | every phase PR touching UI |
| UI-06 | static | 0 | Timer and count elements use font-variant-numeric: tabular-nums, or fixed-width digit slots if Big Shoulders lacks tnum; checked once fonts are installed. | reviewer | phase 0, then phase 3 (timer) |
| UI-11 | static | 0 | At most one orchestrated motion per screen (bubble ink fill, score settle). | spec-reviewer | phases 3 and 4 |
| UI-13 | static | 0 | Tokens are CSS variables in packages/ui/src/tokens.css exposed via @theme. | reviewer | phase 0 |
| UI-14 | static | 0 | storybook build succeeds in verify full; every component in packages/ui has a story covering states in light, dark and high contrast. | verify.sh full; reviewer | every run |
| UX-13 | static | 0 | Copy review: plain, active voice, sentence case, no exclamation marks in the exam. | spec-reviewer | every phase PR touching UI |
| UX-14 | static | 0 | Copy review: labels use the users words ("Students who can take this test"). | spec-reviewer | every phase PR touching UI |
| A11Y-12 | manual | 8 | NVDA with Chrome and Firefox, VoiceOver with Safari: sign-in, profile, dashboard, preflight, exam, submit, result, admin whitelist and test editor. | owner (OWNER_SETUP 8.3) | before each release touching a screen |
| A11Y-18 | static | 5 | The accessibility statement and runbook name the WCAG real-time exception and the extra-time and accommodation alternatives. | spec-reviewer | phase 5 PR |
| A11Y-21 | static | 0 | tests/acceptance/fixtures/axe.ts fails on serious or critical violations; CI runs it on every PR. | reviewer | every PR |
| A11Y-23 | static | 0 | ESLint rule rejects raw string literals in JSX in apps/web; all copy comes from the message catalogue. | lint | every run |

## Tests waiting on owner input

| Test | Needs | REQ | Status |
| --- | --- | --- | --- |
| Face present passes the preflight face check | `tests/fixtures/camera/one-face.y4m` (OWNER_SETUP 3.1) | PR-01, EX-01 | Skips with a reason until the clip exists |
| Two faces for more than 2 seconds records a strike | `tests/fixtures/camera/two-faces.y4m` (OWNER_SETUP 3.1) | PR-02 | Skips with a reason until the clip exists |
| All three roles sign in on staging | Staging project and Vercel preview (OWNER_SETUP 0.1, 0.8, 0.10) | AUTH-01, CI-01 | Owner runs after setup |
| Real 30-page PDF import | Provider key and a real PDF (OWNER_SETUP 6.1, 6.2) | IMP-03 | Owner runs in staging |
| Pilot exam with one college | Production (OWNER_SETUP 8.2) | phase 8 | Owner |
| A real tab switch or window minimize during an attempt records a strike | A desktop browser on a laptop (Playwright keeps every tab visible; acceptance tests send blur and visibilitychange instead) | PR-05 | Owner runs once per release in staging |
| Screenshot baselines for the exam, result and editor screens look right | A person reviews the committed baseline images (tests/acceptance/phase-5/*-snapshots) | UI-15 | Owner reviews once after phase 5 |
| Import token counts and cost match the provider console | Provider key and a real import (OWNER_SETUP 6.1) | IMP-07 | Owner runs in staging after the first real import |
| Browser upload to a real signed Storage URL | Staging bucket with its CORS setting (OWNER_SETUP 6.x) | IMP-01 | Owner runs in staging |
| AI report summary from the real model avoids unsupported numbers and reads correctly | Provider key on staging (OWNER_SETUP 6.1) | EXP-05 | Owner runs once per model or prompt change |
| Report PDF layout, fonts and page breaks look right as rendered in the Cloud Run worker image | Staging worker | EXP-06 | Owner reviews once after phase 7 |
| The accessibility statement's known gaps are true and its contact mailbox is answered | A person, before launch and after each release that changes accessibility | A11Y-22 | Owner |
| The deploy pipeline queues /tasks/migrate on staging after a deploy | GitHub Actions with Cloud Tasks on staging (OWNER_SETUP) | CI-03, CI-04 | Owner runs on the first staging deploy |
