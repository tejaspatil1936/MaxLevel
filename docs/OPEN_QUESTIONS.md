# Open questions

Questions for the owner, sorted by the phase that needs the answer. Each has a proposed default that the build uses
if no answer arrives in time (marked AUTO-DECIDED, and logged in docs/DECISIONS.md). Write answers on the `Answer:` line.

## Phase 0

### 1. How common are students in several organizations?
- Question: Spec 15.3. How often will one email be whitelisted in more than one organization?
- REQ: AUTH-04, AUTH-02
- Proposed default: rare, but supported exactly as AUTH-04 says: bootstrap returns the list of organizations, the
  student picks one, the claims hold that one `orgId`, and switching repeats bootstrap.
- Impact if wrong: if it is common, the chooser needs a remembered default and an org switcher in the student top bar.
- Needed by: phase 0 (bootstrap contract), built in phase 1

Answer: AUTO-DECIDED, rare, but supported exactly as AUTH-04 says: bootstrap returns the list of organizations, the student picks one, the claims hold that one `orgId`, and switching repeats bootstrap.### 2. Domain names for the app and the API
- Question: Spec 15.3. Which domains do the web app and the API use?
- REQ: SEC-05, WEB-04, CI-01
- Proposed default: `app.<domain>` and `api.<domain>`, read from configuration (`APP_ORIGINS`, `NEXT_PUBLIC_API_URL`).
  Locally and in CI: `http://localhost:3000` and `http://localhost:4000`.
- Impact if wrong: configuration change only.
- Needed by: phase 0

Answer: AUTO-DECIDED, `app.<domain>` and `api.<domain>`, read from configuration (`APP_ORIGINS`, `NEXT_PUBLIC_API_URL`). Locally and in CI: `http://localhost:3000` and `http://localhost:4000`.### 3. Staging-only "done when" criteria
- Question: Phase 0 (sign in on staging), phase 5 (k6 against staging, PERF-07) and phase 8 (pilot) need cloud
  projects the agent cannot create. What is the agent's gate for those phases?
- REQ: CI-01, PERF-07, OBS-02
- Proposed default: the agent's phase gate is the local production build on the emulators; staging checks go to
  docs/MANUAL_CHECKS.md and docs/OWNER_SETUP.md.
- Impact if wrong: phases would stay open until the owner creates the projects.
- Needed by: phase 0

Answer: AUTO-DECIDED, the agent's phase gate is the local production build on the emulators; staging checks go to docs/MANUAL_CHECKS.md and docs/OWNER_SETUP.md.### 4. CI-02 Playwright target before staging exists
- Question: CI-02 runs Playwright against a Vercel preview with the staging API. Staging does not exist yet.
- REQ: CI-02
- Proposed default: until staging exists, CI runs the same suite against a local production build on the emulators.
  Both run once OWNER_SETUP phase 0 is done.
- Impact if wrong: CI would have no end-to-end run until staging exists.
- Needed by: phase 0

Answer: AUTO-DECIDED, until staging exists, CI runs the same suite against a local production build on the emulators. Both run once OWNER_SETUP phase 0 is done.### 5. Admin and super-admin records are keyed by uid, but are added by email
- Question: Spec 10.1 keys `admins/{uid}` and `superAdmins/{uid}`, but ORG-08 adds an admin by email before any
  Firebase user exists, and the first super admin has no uid either. Contradiction between 10.1 and ORG-08 / AUTH-02.
- REQ: ORG-08, AUTH-02, DATA-01
- Proposed default: like students (DATA-01), admin and super-admin records get a generated ID and store `email` and
  `uid?`; bootstrap matches by email and links the uid at first sign-in. `userIndex/{uid}` stays keyed by uid.
  The first super admin is created by a seed script (emulators) or by the owner (docs/OWNER_SETUP.md).
- Impact if wrong: a data migration of two small collections.
- Needed by: phase 0

Answer: AUTO-DECIDED, like students (DATA-01), admin and super-admin records get a generated ID and store `email` and `uid?`; bootstrap matches by email and links the uid at first sign-in. `userIndex/{uid}` stays keyed by uid. The first super admin is created by a seed script (emulators) or by the owner (docs/OWNER_SETUP.md).### 6. High contrast in dark mode
- Question: A11Y-01 defines high contrast as pure #000000 text on #FFFFFF. Does it also apply when the theme is dark?
- REQ: A11Y-01, A11Y-13, UI-13
- Proposed default: high contrast is one theme (black on white, 2 px borders, black outlines) that wins over light or dark.
- Impact if wrong: a second high-contrast token set (white on black).
- Needed by: phase 0 (tokens)

Answer: AUTO-DECIDED, high contrast is one theme (black on white, 2 px borders, black outlines) that wins over light or dark.### 7. Storybook for the component catalogue
- Question: UI-14 asks for Storybook, which is not in the 9.4 stack table.
- REQ: UI-14
- Proposed default: Storybook (React + Vite builder) in packages/ui, checked by `storybook build` in verify full.
- Impact if wrong: swap the catalogue tool; components are unaffected.
- Needed by: phase 0

Answer: AUTO-DECIDED, Storybook (React + Vite builder) in packages/ui, checked by `storybook build` in verify full.### 8. Translation layer
- Question: A11Y-23 asks for a translation layer from day one, without naming one.
- REQ: A11Y-23
- Proposed default: a typed message catalogue in packages/ui (`t('key')` with an English dictionary) and an ESLint rule
  that rejects raw text in JSX in apps/web.
- Impact if wrong: replacing the helper with a library such as next-intl later.
- Needed by: phase 0

Answer: AUTO-DECIDED, a typed message catalogue in packages/ui (`t('key')` with an English dictionary) and an ESLint rule that rejects raw text in JSX in apps/web.
## Phase 1

### 9. Archived organizations and sign-in
- Question: ORG-07 says an archived organization is read-only for super admins, but not whether its admins and
  students can still sign in.
- REQ: ORG-07, US-SA-05
- Proposed default: nobody in an archived organization can sign in (as with suspended); super admins can read it but
  every mutation returns 409 ORG_ARCHIVED.
- Impact if wrong: admins of archived orgs would need a read-only mode.
- Needed by: phase 1

Answer: AUTO-DECIDED, nobody in an archived organization can sign in (as with suspended); super admins can read it but every mutation returns 409 ORG_ARCHIVED.### 10. Reflow at 320 px versus admin pages from 768 px
- Question: A11Y-15 says pages other than the exam reflow at 320 CSS px; UX-12 says admin pages work from 768 px up.
  Contradiction.
- REQ: A11Y-15, UX-12
- Proposed default: student and phone pages reflow at 320 px with no horizontal page scroll. Admin pages are designed
  for 768 px and up; below that they still reflow (sidebar becomes a menu button) and wide tables scroll inside their
  own region, which WCAG 1.4.10 allows for data tables.
- Impact if wrong: admin layouts would need a dedicated narrow design.
- Needed by: phase 1

Answer: AUTO-DECIDED, student and phone pages reflow at 320 px with no horizontal page scroll. Admin pages are designed for 768 px and up; below that they still reflow (sidebar becomes a menu button) and wide tables scroll inside their own region, which WCAG 1.4.10 allows for data tables.### 11. Whitelist upload parsing location
- Question: SEC-06 says parsing happens only in the worker, but WL-02 needs a column-mapping preview before saving.
- REQ: WL-02, WL-03, SEC-06
- Proposed default: whitelist CSV and XLSX files are parsed in the admin's browser (Papa Parse, ExcelJS); only the
  mapped rows are sent to `POST /v1/whitelist/import` as JSON, validated with Zod. No file reaches the server, so
  SEC-06 applies to the import pipeline (phase 6) and report or export files only.
- Impact if wrong: a signed upload plus a worker parse job for whitelists.
- Needed by: phase 1

Answer: AUTO-DECIDED, whitelist CSV and XLSX files are parsed in the admin's browser (Papa Parse, ExcelJS); only the mapped rows are sent to `POST /v1/whitelist/import` as JSON, validated with Zod. No file reaches the server, so SEC-06 applies to the import pipeline (phase 6) and report or export files only.### 12. Plans and FF-06
- Question: Spec 15.3: what goes in each plan (Basic, Pro)? FF-06 (named plan presets) is Proposed.
- REQ: FF-01, FF-06
- Proposed default: one built-in plan `standard` equal to the system defaults; FF-06 stays unbuilt. Resolution still
  reads org override, then plan, then system default.
- Impact if wrong: adding plan records later is data only.
- Needed by: before the first paying organization (phase 1 for the console)

Answer: AUTO-DECIDED, one built-in plan `standard` equal to the system defaults; FF-06 stays unbuilt. Resolution still reads org override, then plan, then system default.
## Phase 2

### 13. Multiple-correct and numeric questions
- Question: Spec 15.3. Add multiple-correct and numeric question types in v1?
- REQ: Q-01, IMP-09
- Proposed default: later. v1 is single correct only; the schema keeps `type` and an array `correctOptionIds` so
  adding types later needs no migration.
- Impact if wrong: new editor, grading and import rules.
- Needed by: phase 2

Answer: AUTO-DECIDED, later. v1 is single correct only; the schema keeps `type` and an array `correctOptionIds` so adding types later needs no migration.### 14. "Publish" versus "schedule"
- Question: TST-04 names the states `approved` then `scheduled`; US-AD-09, TST-05 and UX-10 talk about publishing.
- REQ: TST-04, TST-05, UX-10, US-AD-09
- Proposed default: **Publish test** moves an approved test to `scheduled` and saves the resolved snapshot (TST-05).
  `live` and `closed` follow from the window times and are not set by hand.
- Impact if wrong: an extra state and button.
- Needed by: phase 2

Answer: AUTO-DECIDED, **Publish test** moves an approved test to `scheduled` and saves the resolved snapshot (TST-05). `live` and `closed` follow from the window times and are not set by hand.### 15. What counts as "preview approved"
- Question: TST-04 says a test is scheduled only after its questions and preview are approved, but Q-14's checklist
  does not mention preview.
- REQ: TST-04, Q-13, Q-14
- Proposed default: approval happens from the Preview tab: running the Q-14 checklist and pressing **Approve test**
  there is the preview approval. No separate record.
- Impact if wrong: a "previewed" flag per question-set version.
- Needed by: phase 2

Answer: AUTO-DECIDED, approval happens from the Preview tab: running the Q-14 checklist and pressing **Approve test** there is the preview approval. No separate record.### 16. Editing a scheduled test before attempts start
- Question: Q-15 sends an edited approved test back to `in_review`. Does that also apply to a scheduled test?
- REQ: Q-15, TST-04, TST-05
- Proposed default: yes. Editing questions, sections or locked settings of an approved or scheduled test with no
  attempts returns it to `in_review` and clears the snapshot; release and visibility settings do not.
- Impact if wrong: students could see a test whose snapshot no longer matches its questions.
- Needed by: phase 2

Answer: AUTO-DECIDED, yes. Editing questions, sections or locked settings of an approved or scheduled test with no attempts returns it to `in_review` and clears the snapshot; release and visibility settings do not.### 17. Status of manually written questions
- Question: Questions have status draft, flagged or approved (6.1), and Q-04 pools contain approved questions only.
  When does a manually written question become approved?
- REQ: Q-01, Q-04, Q-14
- Proposed default: a manual or JSON question that passes the IMP-09 checks is saved as `approved`; one that does not
  is saved as `draft` with its reasons shown. Imported questions follow IMP-12.
- Impact if wrong: an extra per-question approve click.
- Needed by: phase 2

Answer: AUTO-DECIDED, a manual or JSON question that passes the IMP-09 checks is saved as `approved`; one that does not is saved as `draft` with its reasons shown. Imported questions follow IMP-12.
## Phase 3

### 18. Late sync versus auto-submit
- Question: EX-13 accepts offline answers up to 2 minutes after the deadline, but EX-16 and EX-17 finalize and grade
  at the deadline.
- REQ: EX-13, EX-16, EX-17
- Proposed default: the auto-submit task fires at deadline + 2 minutes, and a client submit before then is graded
  after its queue is flushed.
- Impact if wrong: late-synced answers would never count, or results would change after grading.
- Needed by: phase 3

Answer: AUTO-DECIDED, the auto-submit task fires at deadline + 2 minutes, and a client submit before then is graded after its queue is flushed.### 19. Per-question timers offline
- Question: Q-12 relies on the server recording when each question is first served (POST /navigate), which cannot
  reach the server while offline (EX-10, EX-13).
- REQ: Q-11, Q-12, EX-10, EX-13
- Proposed default: per-question timers require a live connection; offline navigation is held at the current question
  until the serve call succeeds.
- Impact if wrong: students on bad Wi-Fi could lose time on timed questions.
- Needed by: phase 3

Answer: AUTO-DECIDED, per-question timers require a live connection; offline navigation is held at the current question until the serve call succeeds.### 20. Fixed slot window extension
- Question: TST-06 allows extending the window end after attempts start. Does that move slotEnd and therefore every
  deadline in a fixed-slot test?
- REQ: TST-06, OPS-06
- Proposed default: no; deadlines change only through extra time.
- Impact if wrong: extending a window would silently extend every running attempt.
- Needed by: phase 3

Answer: AUTO-DECIDED, no; deadlines change only through extra time.### 21. Signing on Cloud Run without key files
- Question: Signed URLs (DATA-09) and phone custom tokens (PR-14) need the service account to sign, and SEC-01 forbids
  key files.
- REQ: SEC-01, SEC-03, DATA-09, PR-14
- Proposed default: grant the api service account Service Account Token Creator on itself only, and add this to
  SEC-03's role list.
- Impact if wrong: pairing and downloads fail in staging.
- Needed by: phase 3

Answer: AUTO-DECIDED, grant the api service account Service Account Token Creator on itself only, and add this to SEC-03's role list.### 22. Proctoring in automated tests
- Question: Camera, fullscreen and focus behave differently in headless browsers.
- REQ: PR-01 to PR-06, EX-01
- Proposed default: Chromium fake camera files (no face, one face, two faces) and headed Chromium under xvfb for
  lockdown tests.
- Impact if wrong: lockdown tests would be manual.
- Needed by: phase 3

Answer: AUTO-DECIDED, Chromium fake camera files (no face, one face, two faces) and headed Chromium under xvfb for lockdown tests.### 23. Grade terminated attempts or score them zero?
- Question: Spec 15.3.
- REQ: PR-10, LB-02
- Proposed default: as the spec says: grade the answers so far, mark `terminated`, leave out of leaderboards.
- Impact if wrong: a scoring flag.
- Needed by: phase 3

Answer: AUTO-DECIDED, as the spec says: grade the answers so far, mark `terminated`, leave out of leaderboards.### 24. First warning free of a strike (PR-12)?
- Question: Spec 15.3.
- REQ: PR-12
- Proposed default: no. PR-12 stays Proposed and unbuilt.
- Impact if wrong: a per-type counter in the strike transaction.
- Needed by: phase 3

Answer: AUTO-DECIDED, no. PR-12 stays Proposed and unbuilt.### 25. Reset in a fixed slot after the late-entry cutoff
- Question: OPS-10 lets a reset student start again "with the full time allowed by the window", but in a fixed slot
  nobody can start after the late-entry cutoff (5.5).
- REQ: OPS-10, TST-07
- Proposed default: a reset attempt may start after the late-entry cutoff; its deadline follows the normal rule for
  the timing mode (fixed slot: slotEnd plus extra time). The admin adds extra time if the student needs more.
- Impact if wrong: a reset would be useless once the cutoff has passed.
- Needed by: phase 3 (start rules), used in phase 5

Answer: AUTO-DECIDED, a reset attempt may start after the late-entry cutoff; its deadline follows the normal rule for the timing mode (fixed slot: slotEnd plus extra time). The admin adds extra time if the student needs more.
## Phase 4

### 26. Email notifications in v1?
- Question: Spec 15.3 and 8.9.
- REQ: none (8.9 is Proposed)
- Proposed default: later; not built.
- Impact if wrong: an email provider and templates.
- Needed by: phase 4

Answer: AUTO-DECIDED, later; not built.### 27. Series certificates in v1?
- Question: Spec 15.3 and 8.9.
- REQ: none (8.9 is Proposed)
- Proposed default: later; not built.
- Impact if wrong: a certificate template rendered by the worker.
- Needed by: phase 4

Answer: AUTO-DECIDED, later; not built.### 28. Default leaderboard identity
- Question: Spec 15.3. Full name, PRN, or name with department? SER-11 (a per-series choice) is Proposed.
- REQ: SER-11, LB-05
- Proposed default: full name with the department name in its own column; SER-11 stays unbuilt.
- Impact if wrong: a display change.
- Needed by: phase 4

Answer: AUTO-DECIDED, full name with the department name in its own column; SER-11 stays unbuilt.
## Phase 5

### 29. "Extra time for all" in the live dashboard layout
- Question: The 13.7 live dashboard sketch shows an **Extra time for all** button, but OPS-05 is Proposed.
  Contradiction.
- REQ: OPS-05, OPS-01
- Proposed default: the button is not built until OPS-05 is approved.
- Impact if wrong: a batch extra-time endpoint.
- Needed by: phase 5

Answer: AUTO-DECIDED, the button is not built until OPS-05 is approved.

### 35. Reinstating an attempt after its full review was released
- Question: A terminated attempt in a test that releases a full review at once lets the student read the answer key.
  If an admin then reinstates the attempt, the student continues with the key known. Should reinstate be refused
  once a full review of that attempt was released?
- REQ: OPS-04, DATA-05
- Proposed default: allowed (the spec does not forbid it); while the attempt is in progress again no answer key is
  sent and the result route answers 409 ATTEMPT_IN_PROGRESS. BACKLOG lists a warning in the reinstate dialog.
- Impact if wrong: a 409 on reinstate when the attempt's full review was released.
- Needed by: phase 5

Answer: AUTO-DECIDED, allowed as proposed (DECISIONS 2026-10-19).
## Phase 6

### 30. Which LLM provider?
- Question: Spec 15.3. Gemini on Vertex AI, OpenAI or Amazon Bedrock?
- REQ: IMP-07, EXP-05
- Proposed default: Gemini on Vertex AI through the AI SDK, set by configuration. All tests use the AI SDK mock model;
  the real-provider smoke test runs only when a key is present.
- Impact if wrong: configuration change only (IMP-07).
- Needed by: phase 6

Answer: AUTO-DECIDED, Gemini on Vertex AI through the AI SDK, set by configuration. All tests use the AI SDK mock model; the real-provider smoke test runs only when a key is present.
### 36. Two functions named retryDelayMs
- Question: The phase 3 contract exports `retryDelayMs(failures)` (answer sync, 1 to 15 seconds) from `@mitaoe/shared`,
  and the phase 6 contract exports another `retryDelayMs(failuresInARow)` (imports, 1, 2 and 4 minutes, then null)
  from the same package. Contradiction: one package root cannot export both.
- REQ: EX-12, REL-06
- Proposed default: `import-llm.ts` defines `retryDelayMs` as the phase 6 contract says; the package root keeps the
  phase 3 one under its name and re-exports the import schedule as `importRetryDelayMs`.
- Impact if wrong: a rename.
- Needed by: phase 6

Answer: AUTO-DECIDED, as proposed (DECISIONS 2026-10-19).
### 37. Past reports while the report feature is off
- Question: FF-02 says a disabled feature is locked; EXP-06 says past reports stay listed. Should past reports stay
  downloadable when an organization loses the report feature?
- REQ: FF-02, EXP-06
- Proposed default: no; the Reports page shows the locked state and every report route answers 403 FEATURE_DISABLED
  until the feature is back, when past reports are listed again.
- Impact if wrong: a read-only list and downloads while the feature is off.
- Needed by: phase 7

Answer: AUTO-DECIDED, as proposed (DECISIONS 2026-10-19).

## Phase 8

### 31. Retention periods
- Question: Spec 15.3. Retention for attempts, uploads and audit logs? AUD-05 (2 years) is Proposed.
- REQ: AUD-05, DATA-11
- Proposed default: keep everything in v1; no automatic deletion. Uploaded import source files are kept with their job.
- Impact if wrong: a scheduled cleanup task in the worker.
- Needed by: phase 8

Answer: AUTO-DECIDED, keep everything in v1; no automatic deletion. Uploaded import source files are kept with their job.### 32. Requirements that cannot be proved automatically
- Question: These have no automatable acceptance criteria. Are the manual checks in docs/MANUAL_CHECKS.md enough?
  UI-02, UI-04, UI-11, UX-13, UX-14 (design and copy review); UI-06 (font figures); A11Y-12 (screen readers);
  PERF-07 and the 12.2 latency targets (staging load test); PR-02 two-face detection (needs the owner's webcam clip);
  the phase 8 pilot.
- REQ: UI-02, UI-04, UI-06, UI-11, UX-13, UX-14, A11Y-12, PERF-07, PR-02
- Proposed default: yes; each is a docs/MANUAL_CHECKS.md entry with who runs it and when.
- Impact if wrong: more test tooling.
- Needed by: phase 8

Answer: AUTO-DECIDED, yes; each is a docs/MANUAL_CHECKS.md entry with who runs it and when.
## After v1

### 33. Coding questions with code execution?
- Question: Spec 15.3.
- REQ: none (non-goal 1.2)
- Proposed default: out of v1.
- Impact if wrong: a sandboxed runner service.
- Needed by: after v1

Answer: AUTO-DECIDED, out of v1.
### 34. Restoring an archived organization
- Question: Q9's default says every mutation in an archived organization returns 409, but US-SA-05 requires archiving to be reversible. Contradiction.
- REQ: ORG-07, US-SA-05
- Proposed default: a super admin's status change on the organization itself is the one mutation allowed, so it can be restored.
- Impact if wrong: archived organizations could never be restored.
- Needed by: phase 1

Answer: AUTO-DECIDED, a super admin's status change on the organization itself is the one mutation allowed, so it can be restored.
