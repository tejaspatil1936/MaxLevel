# Prompt 01 — Requirement map and audit (run once)

Branch: build/setup (create it from main). Do not write application code. Do not edit docs/SYSTEM_DESIGN.md.
Read CLAUDE.md, then docs/SYSTEM_DESIGN.md in full, then the legacy/ folder structure (structure only, not every file).

## 1. docs/req-matrix.json
One entry for every requirement ID in the spec: the bold IDs (EX-10, A11Y-03, ...) and the user-story IDs (US-AD-04, ...).

```json
{ "EX-10": { "phase": 3, "status": "agreed", "verify": "e2e", "check": "go offline, answer 3 questions, reload, answers still shown" } }
```

- phase: from spec 15.2. Cross-cutting rules (UI, UX, A11Y, SEC, DATA, API, WEB, OBS) go in the first phase that needs them;
  a rule that keeps applying later is still proved once, where it is first built.
- status: "proposed" for anything marked (Proposed) in the spec, otherwise "agreed".
- verify: the most automatable kind that genuinely proves it:
  e2e for anything a person sees or does; integration for API, Firestore, RTDB, rules and worker behaviour;
  unit for pure logic in packages/shared; static for lint, type or config rules; infra for cloud configuration;
  manual only when nothing else can prove it (screen-reader passes, staging load tests, the pilot).
- check: one line saying how it will be proved.

Run `node scripts/req-coverage.mjs --matrix-only` until it prints Matrix OK.

## 2. docs/OPEN_QUESTIONS.md
Numbered. For each: the question, REQ IDs, proposed default, impact if the default is wrong, phase needed by,
and an empty line `Answer:` for the owner. Sort by phase.
Include every row of spec 15.3, every contradiction, every requirement without testable acceptance criteria, and these known items:

1. Late sync versus auto-submit. EX-13 accepts offline answers up to 2 minutes after the deadline, but EX-16 and EX-17
   finalize and grade at the deadline. Proposed default: the auto-submit task fires at deadline + 2 minutes, and a
   client submit before then is graded after its queue is flushed.
2. Per-question timers offline. Q-12 relies on the server recording when each question is first served
   (POST /navigate), which cannot reach the server while offline (EX-10, EX-13). Proposed default: per-question
   timers require a live connection; offline navigation is held at the current question until the serve call succeeds.
3. Fixed slot window extension. TST-06 allows extending the window end after attempts start. Does that move slotEnd
   and therefore every deadline in a fixed-slot test? Proposed default: no; deadlines change only through extra time.
4. Signing on Cloud Run without key files (SEC-01). Signed URLs (DATA-09) and phone custom tokens (PR-14) need the
   service account to sign through IAM. Proposed default: grant the api service account Service Account Token Creator
   on itself only, and add this to SEC-03's role list.
5. Staging-only "done when" criteria. Phase 0 (sign in on staging), phase 5 (k6 against staging, PERF-07) and phase 8
   (pilot) need cloud projects the agent cannot create. Proposed default: the agent's phase gate is the local production
   build on the emulators; staging checks go to docs/MANUAL_CHECKS.md and docs/OWNER_SETUP.md.
6. CI-02 runs Playwright against a Vercel preview with the staging API. Until staging exists, CI runs the same suite
   against a local production build on the emulators. Proposed default: both, switching when OWNER_SETUP phase 0 is done.
7. Proctoring in automated tests. Camera, fullscreen and focus behave differently in headless browsers. Proposed default:
   Chromium fake camera files (no face, one face, two faces) and headed Chromium under xvfb for lockdown tests.

## 3. docs/TEST_ENV.md
For every external dependency, how tests run without real accounts. At least:
- Firebase Auth emulator, with Google sign-in through the emulator's own sign-in flow or an emulator-only credential.
  It must be impossible in a production build: the code path exists only when the emulator host is configured.
- Firestore, Realtime Database and Storage emulators; security rules tested with @firebase/rules-unit-testing (DATA-08 to DATA-10).
- Cloud Tasks: no local emulator, so a TaskQueue interface with a local in-process driver that honours schedule times
  against the injected Clock, plus a test-only API endpoint (enabled only in test mode) to advance the clock and run due tasks.
- Signed URLs and custom tokens on the emulators (Storage and Auth emulator behaviour, with a StorageSigner interface where needed).
- LLM: AI SDK mock model with recorded fixtures for every test; a real-provider smoke test only when a key is present.
- MediaPipe face detection: Chromium flags --use-fake-device-for-media-stream and --use-file-for-fake-video-capture with
  .y4m clips in tests/fixtures/camera/. The face clips come from the owner (see OWNER_SETUP.md); the no-face clip can be generated.
- Phone pairing: a second Playwright browser context at 390 px using the pairing link.
- Headless Chromium for report PDFs in the worker: real.
- Sentry: disabled in tests. Cloud Armor, load balancer, Workload Identity Federation: infra, checked manually.
- k6: staging only (manual check), plus a small local smoke run against the emulators.

## 4. docs/OWNER_SETUP.md
Steps only the owner can do, grouped by the phase that first needs them: three GCP and Firebase projects (dev, staging, prod)
and their regions; Workload Identity Federation for GitHub Actions; Artifact Registry; Cloud Tasks queues; Secret Manager;
service accounts and roles (including item 4 above); load balancer, Cloud Armor, managed TLS and DNS; Vercel Pro project and
environment variables; Sentry; the LLM provider key; a 5-second webcam clip of the owner's face and one with two faces, for the
camera fixtures (convert with: ffmpeg -i in.mp4 -pix_fmt yuv420p -s 640x480 -r 15 out.y4m).
Each step: what, where, how to confirm it worked, and the REQ IDs it unblocks.

## 5. docs/MANUAL_CHECKS.md
One entry per REQ whose verify kind is static, manual or infra: the REQ ID, the check, who runs it, and when.

## Finish
Commit each file on its own (`docs(docs): ...`), push build/setup, and stop. Do not ask questions one at a time:
everything for the owner goes into OPEN_QUESTIONS.md.
