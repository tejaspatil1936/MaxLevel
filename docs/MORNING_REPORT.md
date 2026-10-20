# Morning report: build of phases 0 to 8

Branch `build/all`. Every phase ran the same loop: tests written and locked first, features built one at a time, then a release gate (spec review, QA as real users, fixes after a regression test, `verify.sh full`).

## Result

All 65 features are built. The owner approved the three test change requests on 2026-10-20, and they were applied in
15d6bc8 with phases 3 and 4 relocked and `scripts/locks.mjs` refrozen:

- F-3.12.spec.ts:126 now pauses the page clock 1 s ahead instead of 100 ms, so it can't land in the clock's past.
- F-4.03.spec.ts:171 now checks the first `math` element; the prompt holds two formulas.
- `scripts/locks.mjs` no longer counts `*-snapshots/` files in a locked phase folder as added tests.

That clears the failures recorded before: the `acceptance-lock` step and the F-4.03 assertion, which also marked
F-3.03 failing through the shared DATA-05. The final `scripts/verify.sh full` result and its commit were printed when
the build finished, and the PR's CI runs the same command.

Late fixes found while getting CI green:
- 935efe8: an integration test (API-01 empty settings change) depended on emulator data left by earlier runs.
- 9a6a45a, f810ece: screenshot tests render text the same on every host, with a 120-pixel allowance for math italics.
- c187861: arrow keys in tabs lost presses on a busy machine.

The 4 skipped tests are the two camera-clip tests (waiting for OWNER_SETUP 3.1) and the two real-provider smoke tests
(no credentials).

| Phase | Features |
| --- | --- |
| 0 Foundations | 10 |
| 1 Organizations, students, shell | 13 |
| 2 Series, tests, questions | 9 |
| 3 Exam taking and proctoring | 13 |
| 4 Results, leaderboards, exports | 6 |
| 5 Live operations | 5 |
| 6 AI question import | 4 |
| 7 Analytics reports | 3 |
| 8 Accessibility statement, migrations | 2 |
| **Total** | **65** |

Per-phase verification reports: docs/verification/phase-1.md to phase-8.md. Progress, decisions and review findings:
PROGRESS.md.

## Blocked (docs/blocked/)

None. The four files recorded before (F-3.03, F-3.12, F-4.03 and F-5.05) were removed once the approved test changes
were applied.

## Test change requests (TEST_CHANGE_REQUESTS.md)

All three were approved by the owner and applied in 15d6bc8. None are open.

## Auto-decided answers (docs/OPEN_QUESTIONS.md)

Every open question was decided by its proposed default. Each one is logged in docs/DECISIONS.md.

- 1. How common are students in several organizations?: rare, but supported exactly as AUTH-04 says: bootstrap returns the list of organizations, the student picks one, the claims hold that one `orgId`, and switching repeats bootstrap.
- 2. Domain names for the app and the API: `app.<domain>` and `api.<domain>`, read from configuration (`APP_ORIGINS`, `NEXT_PUBLIC_API_URL`). Locally and in CI: `http://localhost:3000` and `http://localhost:4000`.
- 3. Staging-only "done when" criteria: the agent's phase gate is the local production build on the emulators; staging checks go to docs/MANUAL_CHECKS.md and docs/OWNER_SETUP.md.
- 4. CI-02 Playwright target before staging exists: until staging exists, CI runs the same suite against a local production build on the emulators. Both run once OWNER_SETUP phase 0 is done.
- 5. Admin and super-admin records are keyed by uid, but are added by email: like students (DATA-01), admin and super-admin records get a generated ID and store `email` and `uid?`; bootstrap matches by email and links the uid at first sign-in. `userIndex/{uid}` stays keyed by uid. The first super admin is created by a seed script (emulators) or by the owner (docs/OWNER_SETUP.md).
- 6. High contrast in dark mode: high contrast is one theme (black on white, 2 px borders, black outlines) that wins over light or dark.
- 7. Storybook for the component catalogue: Storybook (React + Vite builder) in packages/ui, checked by `storybook build` in verify full.
- 8. Translation layer: a typed message catalogue in packages/ui (`t('key')` with an English dictionary) and an ESLint rule that rejects raw text in JSX in apps/web.
- 9. Archived organizations and sign-in: nobody in an archived organization can sign in (as with suspended); super admins can read it but every mutation returns 409 ORG_ARCHIVED.
- 10. Reflow at 320 px versus admin pages from 768 px: student and phone pages reflow at 320 px with no horizontal page scroll. Admin pages are designed for 768 px and up; below that they still reflow (sidebar becomes a menu button) and wide tables scroll inside their own region, which WCAG 1.4.10 allows for data tables.
- 11. Whitelist upload parsing location: whitelist CSV and XLSX files are parsed in the admin's browser (Papa Parse, ExcelJS); only the mapped rows are sent to `POST /v1/whitelist/import` as JSON, validated with Zod. No file reaches the server, so SEC-06 applies to the import pipeline (phase 6) and report or export files only.
- 12. Plans and FF-06: one built-in plan `standard` equal to the system defaults; FF-06 stays unbuilt. Resolution still reads org override, then plan, then system default.
- 13. Multiple-correct and numeric questions: later. v1 is single correct only; the schema keeps `type` and an array `correctOptionIds` so adding types later needs no migration.
- 14. "Publish" versus "schedule": **Publish test** moves an approved test to `scheduled` and saves the resolved snapshot (TST-05). `live` and `closed` follow from the window times and are not set by hand.
- 15. What counts as "preview approved": approval happens from the Preview tab: running the Q-14 checklist and pressing **Approve test** there is the preview approval. No separate record.
- 16. Editing a scheduled test before attempts start: yes. Editing questions, sections or locked settings of an approved or scheduled test with no attempts returns it to `in_review` and clears the snapshot; release and visibility settings do not.
- 17. Status of manually written questions: a manual or JSON question that passes the IMP-09 checks is saved as `approved`; one that does not is saved as `draft` with its reasons shown. Imported questions follow IMP-12.
- 18. Late sync versus auto-submit: the auto-submit task fires at deadline + 2 minutes, and a client submit before then is graded after its queue is flushed.
- 19. Per-question timers offline: per-question timers require a live connection; offline navigation is held at the current question until the serve call succeeds.
- 20. Fixed slot window extension: no; deadlines change only through extra time.
- 21. Signing on Cloud Run without key files: grant the api service account Service Account Token Creator on itself only, and add this to SEC-03's role list.
- 22. Proctoring in automated tests: Chromium fake camera files (no face, one face, two faces) and headed Chromium under xvfb for lockdown tests.
- 23. Grade terminated attempts or score them zero?: as the spec says: grade the answers so far, mark `terminated`, leave out of leaderboards.
- 24. First warning free of a strike (PR-12)?: no. PR-12 stays Proposed and unbuilt.
- 25. Reset in a fixed slot after the late-entry cutoff: a reset attempt may start after the late-entry cutoff; its deadline follows the normal rule for the timing mode (fixed slot: slotEnd plus extra time). The admin adds extra time if the student needs more.
- 26. Email notifications in v1?: later; not built.
- 27. Series certificates in v1?: later; not built.
- 28. Default leaderboard identity: full name with the department name in its own column; SER-11 stays unbuilt.
- 29. "Extra time for all" in the live dashboard layout: the button is not built until OPS-05 is approved.
- 35. Reinstating an attempt after its full review was released: allowed as proposed (DECISIONS 2026-10-19).
- 30. Which LLM provider?: Gemini on Vertex AI through the AI SDK, set by configuration. All tests use the AI SDK mock model; the real-provider smoke test runs only when a key is present.
- 36. Two functions named retryDelayMs: as proposed (DECISIONS 2026-10-19).
- 37. Past reports while the report feature is off: as proposed (DECISIONS 2026-10-19).
- 31. Retention periods: keep everything in v1; no automatic deletion. Uploaded import source files are kept with their job.
- 32. Requirements that cannot be proved automatically: yes; each is a docs/MANUAL_CHECKS.md entry with who runs it and when.
- 33. Coding questions with code execution?: out of v1.
- 34. Restoring an archived organization: a super admin's status change on the organization itself is the one mutation allowed, so it can be restored.

## Owner actions

### From docs/OWNER_SETUP.md

- **0.1–0.11:** GCP and Firebase projects (dev, staging, prod), Firestore PITR and backups, least-privilege service accounts, Secret Manager, Artifact Registry, Workload Identity Federation, domains and Cloud Armor, the Vercel project, Sentry, the first super admin, GitHub repository settings.
- **0.4:** set `EXPORT_LINK_SECRET` (32+ random bytes) on the API service. Without it, production answers every export and report link with 503.
- **3.1:** record webcam clips (one face, two faces) for the camera tests. **3.2:** create the Cloud Tasks queues.
- **5.1:** pre-warming, alert policies and the exam-day dashboard. **5.2:** the staging k6 load test (tests/load/exam-500.js); tokens as described there.
- **6.1:** LLM provider (Gemini on Vertex AI) credentials. **6.2:** a real 30-page question PDF.
- **8.1:** the production deploy pipeline with the freeze check and rollback (ci.yml is harness-locked; steps described there).
- **8.2:** pilot exam. **8.3:** screen-reader passes. **8.4:** set `NEXT_PUBLIC_ACCESSIBILITY_EMAIL` in Vercel. **8.5:** the migrations queue and the post-deploy migrate task.

### From docs/MANUAL_CHECKS.md (owner-run checks)

- AUD-05 (phase 8): Proposed, not built. Confirm retention once approved. When: phase 8.
- DATA-11 (phase 0): PITR and daily export enabled in staging and prod (OWNER_SETUP 0.2). When: before the first real exam.
- SEC-02 (phase 0): Cloud Run services read secrets from Secret Manager mounts (OWNER_SETUP 0.4). When: staging deploy.
- SEC-03 (phase 0): IAM bindings match OWNER_SETUP 0.3 exactly. When: staging and prod setup.
- PERF-06 (phase 5): The prewarm task raises api min instances 30 minutes before a slot; check in staging Cloud Run revisions. When: before the first real exam.
- PERF-07 (phase 5): k6 run tests/load/exam-500.js against staging; every 12.2 target met. When: before the first real exam and after exam-path changes.
- REL-01 (phase 8): The deploy workflow stops when a test is live unless the override input is set. When: first production deploy.
- REL-02 (phase 8): Shift traffic to the previous revision with gcloud run services update-traffic and confirm in seconds. When: staging rehearsal.
- OBS-02 (phase 0): Sentry receives errors from web, API and worker with releases and source maps (OWNER_SETUP 0.9). When: staging.
- OBS-04 (phase 5): Alert policies exist and fire on a forced test (OWNER_SETUP 5.1). When: staging.
- OBS-05 (phase 5): Exam-day dashboard shows active attempts, RPS, latency, errors, instances, Firestore errors. When: staging.
- CI-01 (phase 0): dev, staging and prod projects exist and Vercel environments map to them (OWNER_SETUP 0.1, 0.8). When: phase 0.
- CI-03 (phase 8): Merge to main builds images, deploys staging, smoke tests, waits for approval and the freeze check, deploys prod. When: after OWNER_SETUP 0.5, 0.6, 8.1.
- A11Y-12 (phase 8): NVDA with Chrome and Firefox, VoiceOver with Safari: sign-in, profile, dashboard, preflight, exam, submit, result, admin whitelist, test editor and the public accessibility statement (`/accessibility/`). When: before each release touching a screen.
- AUTH-01, CI-01: All three roles sign in on staging. Needs: Staging project and Vercel preview (OWNER_SETUP 0.1, 0.8, 0.10). Owner runs after setup.
- IMP-03: Real 30-page PDF import. Needs: Provider key and a real PDF (OWNER_SETUP 6.1, 6.2). Owner runs in staging.
- phase 8: Pilot exam with one college. Needs: Production (OWNER_SETUP 8.2). Owner.
- PR-05: A real tab switch or window minimize during an attempt records a strike. Needs: A desktop browser on a laptop (Playwright keeps every tab visible; acceptance tests send blur and visibilitychange instead). Owner runs once per release in staging.
- UI-15: Screenshot baselines for the exam, result and editor screens look right. Needs: A person reviews the committed baseline images (tests/acceptance/phase-5/*-snapshots). Owner reviews once after phase 5.
- IMP-07: Import token counts and cost match the provider console. Needs: Provider key and a real import (OWNER_SETUP 6.1). Owner runs in staging after the first real import.
- IMP-01: Browser upload to a real signed Storage URL. Needs: Staging bucket with its CORS setting (OWNER_SETUP 6.x). Owner runs in staging.
- EXP-05: AI report summary from the real model avoids unsupported numbers and reads correctly. Needs: Provider key on staging (OWNER_SETUP 6.1). Owner runs once per model or prompt change.
- EXP-06: Report PDF layout, fonts and page breaks look right as rendered in the Cloud Run worker image. Needs: Staging worker. Owner reviews once after phase 7.
- A11Y-22: The accessibility statement's known gaps are true and its contact mailbox is answered. Needs: A person, before launch and after each release that changes accessibility. Owner.
- CI-03, CI-04: The deploy pipeline queues /tasks/migrate on staging after a deploy. Needs: GitHub Actions with Cloud Tasks on staging (OWNER_SETUP). Owner runs on the first staging deploy.

## Things to know before production

- **Cloud Tasks:** the task queue has only the local adapter (`TASK_QUEUE=local`). Production needs the Cloud Tasks adapter (docs/BACKLOG.md). Until then the in-process dispatcher is off in production, so auto-submit, release, leaderboard, import, export and report tasks will not run there.
- **Worker image:** it needs Chromium and `CHROMIUM_PATH` for report PDFs. Chromium runs without its sandbox in the container (logged in DECISIONS).
- **Dependency override:** `undici` is overridden to 6.28.1 (pnpm-workspace.yaml) to clear high advisories pulled in by the AI SDK.
- **Commit history:** commits 86dcfc3 and 827c30b do not build on their own; the next commit fixes each, and history was not rewritten. Commit 7a2f0ab (315 lines) used a Large-Change trailer outside scaffolding.
- **Backlog:** non-blocking review and QA findings for every phase are in docs/BACKLOG.md.
