# Test environment

How every external dependency runs in tests without real accounts. Tests never mock Firestore, Realtime Database,
Auth or Storage: they run on the Firebase Emulator Suite. Only the LLM and Cloud Tasks are replaced, through their
interfaces (CLAUDE.md).

## Local stack and ports

| Process | Port | Notes |
| --- | --- | --- |
| Web (static export in `apps/web/out`, served by a static file server) | 3000 | Built with the emulator variables below |
| API (`apps/api`, built, `NODE_ENV=test`) | 4000 | Test-only routes enabled (see "Test-only API") |
| Worker (`apps/worker`, built, `NODE_ENV=test`) | 4001 | `/tasks/*` open without OIDC in test mode only |
| Auth emulator | 9099 | |
| Firestore emulator | 8080 | |
| Realtime Database emulator | 9000 | Namespace `demo-mitaoe-default-rtdb` |
| Storage emulator | 9199 | Bucket `demo-mitaoe.appspot.com` |
| Emulator hub | 4400 | |

Firebase project ID: `demo-mitaoe`. A `demo-` project needs no Google sign-in and cannot reach real cloud resources.

Environment for the API and worker in tests:

```text
NODE_ENV=test
TEST_API_SECRET=local-test-secret
GCLOUD_PROJECT=demo-mitaoe
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
TASK_QUEUE=local
WORKER_URL=http://127.0.0.1:4001
APP_ORIGINS=http://localhost:3000
LLM_PROVIDER=mock
METADATA_SERVER_DETECTION=none
```

Web build variables for tests (`NEXT_PUBLIC_*` are inlined at build time):

```text
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-mitaoe
NEXT_PUBLIC_FIREBASE_API_KEY=demo-key
NEXT_PUBLIC_AUTH_EMULATOR_HOST=127.0.0.1:9099
NEXT_PUBLIC_DATABASE_EMULATOR_HOST=127.0.0.1:9000
```

## Firebase Auth emulator and Google sign-in

- The real sign-in button calls `signInWithPopup(GoogleAuthProvider)`. On the Auth emulator the popup is the
  emulator's own account chooser (`/emulator/auth/handler`), where a test adds an account by email and display name.
  AUTH-01 tests use this real popup flow.
- Every other test signs in faster through an emulator-only credential: the web app exposes
  `window.__e2e.signIn(email, name?)`, which calls
  `signInWithCredential(auth, GoogleAuthProvider.credential('{"sub":…,"email":…,"email_verified":true}'))`.
  The Auth emulator accepts these unsigned Google credentials; real Firebase rejects them.
- That helper exists only when `NEXT_PUBLIC_AUTH_EMULATOR_HOST` is set at build time. The production build is made
  without it, so the code is removed by dead-code elimination; `verify.sh full` greps the production bundle for
  `__e2e` and fails if found.
- After sign-in the app calls `POST /v1/session/bootstrap` and refreshes the token, exactly as in production.
- Custom claims, token revocation (`verifyIdToken(token, true)`) and `createCustomToken` all work on the emulator;
  the Admin SDK signs custom tokens without a key when `FIREBASE_AUTH_EMULATOR_HOST` is set.

## Firestore, Realtime Database and Storage

- Integration tests (`*.int.test.ts`) use the running emulators when their ports are open, otherwise they run under
  `firebase emulators:exec`.
- Security rules are tested with `@firebase/rules-unit-testing` (`*.rules.test.ts`): Firestore and Storage deny every
  client access (DATA-08, DATA-09); Realtime Database rules per DATA-07 and DATA-10.
- Tests reset state through the test-only API (`POST /__test/reset`), which clears all four emulators over their REST
  endpoints and loads the seed.

## Cloud Tasks

There is no Cloud Tasks emulator. Domain code enqueues through the `TaskQueue` interface:

- `cloud-tasks` driver in production (OIDC push to the worker).
- `local` driver in development and tests: tasks are stored in the Firestore emulator (`_localTasks/{name}`) with their
  schedule time, so the API and the worker share one queue. The API process dispatches a task to `WORKER_URL/tasks/…`
  once `clock.now() >= scheduleTime`, checking every 250 ms. Task names make enqueueing idempotent.
- Time comes from the injected `Clock`: `system` in production, `test` (settable) when `NODE_ENV=test`.

## Test-only API

Enabled only when `NODE_ENV=test` **and** `TEST_API_SECRET` is set; every call needs the header
`X-Test-Secret: <TEST_API_SECRET>`. The routes are not registered otherwise, and the production build is checked
for their absence (a request to `/__test/clock` returns 404).

| Route | Body | Effect |
| --- | --- | --- |
| `GET /__test/clock` | | `{ nowMs }` |
| `POST /__test/clock` | `{ nowMs }` or `{ advanceMs }` | Sets or moves the API's and worker's test clock (the API forwards to the worker) |
| `POST /__test/clock/real` | | Back to following real time from the current offset |
| `POST /__test/tasks/run-due` | | Runs every task due at the current clock, waits for them, returns `{ ran: [names] }` |
| `GET /__test/tasks` | | Lists pending tasks (name, path, scheduleTime) |
| `POST /__test/reset` | `{ seed?: "base" \| "none" }` | Clears the emulators, resets the clock to real time and loads the seed |
| `POST /__test/seed/:scenario` | scenario options | Adds scenario data (for example a scheduled test with questions) and returns its IDs |

Browser time in end-to-end tests is controlled with Playwright's `page.clock` where a test needs the device clock to
move; the exam timer uses the server time from `X-Server-Time`, so server-clock changes also reach the client.

## Seed data (`base`)

All on the emulators, created by `pnpm seed` (and by `POST /__test/reset`):

| Who | Email | Notes |
| --- | --- | --- |
| Super admin | `super@platform.test` | |
| Org A | ID `org-a`, slug `mitaoe`, name "MIT Academy of Engineering", timezone Asia/Kolkata | Departments Computer, IT, ENTC, Mechanical |
| Org A admins | `admin1@a.test`, `admin2@a.test` | |
| Org A students | `student01@a.test` … `student20@a.test` | Registered, profiles complete, consent already given (SEC-08), departments cycle through the list in order, odd numbers graduate 2026 and even 2027, PRNs `220101NN` |
| Org A invited | `invited01@a.test` … `invited05@a.test` | Whitelisted, never signed in; `invited01` has PRN `A-PRN-901` on its entry |
| Org B | ID `org-b`, slug `coep`, name "College of Engineering Pune", timezone Asia/Kolkata | Departments Computer, Civil |
| Org B admins | `admin1@b.test`, `admin2@b.test` | |
| Org B students | `student01@b.test` … `student20@b.test` | Registered, profiles complete, consent given, same names, departments (Computer, Civil) and years pattern as org A, PRNs `B220101NN` |
| In both orgs | `multi@both.test` | Whitelisted (invited) in A and B |
| Nobody | `nobody@outside.test` | On no list |

Display names: admins are "Admin 1" and "Admin 2" in each org; students 01 to 20 in both orgs are, in order, Aarav Kulkarni,
Ishita Deshmukh, Rohan Patil, Sneha Joshi, Vihaan Shinde, Ananya Pawar, Arjun Jadhav, Kavya Gaikwad, Siddharth More,
Pooja Chavan, Aditya Bhosale, Riya Kale, Omkar Sawant, Tanvi Mane, Pranav Kadam, Shruti Naik, Yash Salunkhe, Neha Wagh,
Kunal Thorat and Aditi Bendre. Student IDs are `stu-<orgId>-NN`; department IDs `dept-<orgId>-<lowercase name>`.

## External services

| Dependency | How tests run it |
| --- | --- |
| Signed URLs (DATA-09, EXP-03, IMP pipeline) | `StorageSigner` interface. Production: GCS v4 signed URLs signed through IAM (no key files, SEC-01). Emulator: the API issues HMAC-signed, expiring URLs to its own `/v1/files/upload/:token` and `/v1/files/download/:token`, which stream to and from the Storage emulator. Expiry is checked against the Clock. |
| Phone custom tokens (PR-14) | `createCustomToken` on the Auth emulator (unsigned, accepted by the emulator only). |
| LLM (IMP, EXP-05) | `LlmClient` interface over the AI SDK. Tests use the AI SDK mock model (`ai/test`) with recorded fixtures in `tests/fixtures/llm/`. A real-provider smoke test runs only when a provider key is present. |
| MediaPipe face detection (PR-01, PR-02) | Chromium flags `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream` and `--use-file-for-fake-video-capture=<clip>.y4m` with clips in `tests/fixtures/camera/`. The no-face clip is generated with ffmpeg; the one-face and two-face clips come from the owner (docs/OWNER_SETUP.md). Tests needing an owner clip skip with a reason until it exists, and are listed in docs/MANUAL_CHECKS.md. |
| Fullscreen, focus and visibility (PR-04, PR-05) | Headed Chromium under `xvfb-run` for the lockdown tests, so focus and visibility changes are real. |
| Phone pairing (PR-13 to PR-16) | A second Playwright browser context at 390 px opens the pairing link from the QR code's text. |
| Report PDFs (EXP-06) | Real headless Chromium in the worker. |
| Sentry | Disabled in tests (no DSN). |
| Cloud Armor, load balancer, Workload Identity Federation | Infrastructure, checked manually (docs/MANUAL_CHECKS.md). |
| k6 | Staging only (manual check, PERF-07), plus a small local smoke run against the emulators. |

## Playwright projects

| Project | Viewport | Used for |
| --- | --- | --- |
| `desktop` | 1280 x 800 | Admin, super admin, student pages |
| `exam` | 1024 x 768 | Exam screen |
| `phone` | 390 x 844 | Phone pairing page, narrow student pages |

`retries: 0`, one worker (the clock is shared), trace and video kept on failure. An `@axe-core/playwright` helper
fails a test on any serious or critical violation.
