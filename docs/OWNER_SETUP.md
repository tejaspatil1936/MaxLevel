# Owner setup

Steps only the owner can do, grouped by the phase that first needs them. The agent never touches real cloud accounts;
until these are done, every phase is gated on the local production build running on the emulators
(docs/OPEN_QUESTIONS.md question 3).

Each step lists what to do, where, how to confirm it worked, and the requirement IDs it unblocks.

## Phase 0

### 0.1 Three GCP and Firebase projects
- What: create `mitaoe-prep-dev`, `mitaoe-prep-staging` and `mitaoe-prep-prod` (any IDs; put them in `.firebaserc`
  aliases `dev`, `staging`, `prod`). In each: Firestore in Native mode in `asia-south1`, Realtime Database in
  `asia-southeast1`, a Storage bucket in `asia-south1`, and Firebase Authentication with the Google provider enabled.
- Where: console.cloud.google.com and console.firebase.google.com.
- Confirm: `firebase projects:list` shows all three; Firestore location reads `asia-south1`.
- Unblocks: CI-01, staging sign-in for the phase 0 "done when".

### 0.2 Firestore backups
- What: enable point-in-time recovery (7 days) and a daily scheduled export to a Cloud Storage bucket with a 30-day
  lifecycle rule, in staging and prod.
- Where: Firestore → Disaster recovery; Cloud Scheduler or the Firestore scheduled backups page.
- Confirm: `gcloud firestore databases describe` shows `pointInTimeRecoveryEnablement: ENABLED`; a backup appears the next day.
- Unblocks: DATA-11.

### 0.3 Service accounts and roles (least privilege)
- What: in each project create `api@`, `worker@` and `tasks@` service accounts.
  - `api@`: Firestore user (`roles/datastore.user`), Firebase Realtime Database admin, Storage object admin on the
    app bucket, Firebase Authentication admin, Cloud Tasks enqueuer, Service Account User on `tasks@`,
    and Service Account Token Creator **on itself only** (for signed URLs and custom tokens without key files;
    OPEN_QUESTIONS 21).
  - `worker@`: Firestore user, Storage object admin on the app bucket, Cloud Tasks enqueuer, Service Account User on
    `tasks@`, Secret Manager accessor for the LLM key, and Token Creator on itself (signed export links).
  - `tasks@`: Cloud Run invoker on the worker service only.
- Where: IAM & Admin → Service accounts.
- Confirm: `gcloud projects get-iam-policy <project>` lists only these bindings; no keys exist
  (`gcloud iam service-accounts keys list` shows only Google-managed keys).
- Unblocks: SEC-01, SEC-03, PR-14, DATA-09, EXP-03.

### 0.4 Secret Manager
- What: create secrets `llm-api-key` (phase 6), `sentry-dsn-api`, `sentry-dsn-worker`, and `export-link-secret`
  (at least 32 random bytes, e.g. `openssl rand -hex 32`). Mount them in Cloud Run as environment variables at deploy
  time; `export-link-secret` becomes `EXPORT_LINK_SECRET` on the `api` service, one value shared by every instance
  (it signs export download links, EXP-03). Without it the production API logs an error at startup and every export route answers 503.
- Where: Security → Secret Manager.
- Confirm: `gcloud secrets list` shows them; the services start with the secret values present.
- Unblocks: SEC-02, OBS-02, IMP-07, EXP-03.

### 0.5 Artifact Registry
- What: a Docker repository `mitaoe` in `asia-south1` in staging and prod.
- Where: Artifact Registry.
- Confirm: `gcloud artifacts repositories list --location asia-south1`.
- Unblocks: CI-03.

### 0.6 Workload Identity Federation for GitHub Actions
- What: a workload identity pool and GitHub OIDC provider limited to this repository, and a `deployer@` service
  account (Cloud Run admin, Artifact Registry writer, Service Account User on `api@` and `worker@`) that the pool can
  impersonate. No JSON keys in GitHub (SEC-01).
- Where: IAM & Admin → Workload Identity Federation.
- Confirm: a workflow using `google-github-actions/auth` with `workload_identity_provider` runs `gcloud auth list`.
- Unblocks: CI-03, SEC-01.

### 0.7 Domains, load balancer, Cloud Armor and TLS
- What: pick the domains (OPEN_QUESTIONS 2, default `app.<domain>` and `api.<domain>`). Create a global external
  Application Load Balancer with a serverless NEG for the `api` Cloud Run service, a Google-managed certificate for
  `api.<domain>`, and a Cloud Armor policy with a per-IP rate limit. Point DNS at the load balancer IP.
- Where: Network services → Load balancing; Cloud Armor; your DNS provider. Then replace `https://api.mitaoe.example` in `apps/web/vercel.json` (CSP connect-src) with the real API origin.
- Confirm: `curl -I https://api.<domain>/health` returns 200 with an `X-Server-Time` header.
- Unblocks: API-06 (per-IP part), SEC-05, CI-01.

### 0.8 Vercel Pro project
- What: a Vercel Pro project for `apps/web` (framework Next.js, output static). Environment variables per environment:
  `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_API_KEY`,
  `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_DATABASE_URL`, `NEXT_PUBLIC_SENTRY_DSN`,
  `NEXT_PUBLIC_ACCESSIBILITY_EMAIL` (a mailbox you monitor, shown as the contact on the public accessibility
  statement `/accessibility/`; until it is set the page shows the placeholder `accessibility@mitaoe.example`).
  Never set `NEXT_PUBLIC_AUTH_EMULATOR_HOST` outside local builds. Map `app.<domain>` to production.
- Where: vercel.com.
- Confirm: a preview deployment for a pull request loads the sign-in page; response headers include the CSP from `vercel.json`.
- Unblocks: CI-01, CI-02, WEB-04.

### 0.9 Sentry
- What: projects `web`, `api` and `worker`; put the DSNs in Secret Manager (0.4) and Vercel (0.8); create an auth
  token for source-map upload and add it to GitHub Actions secrets as `SENTRY_AUTH_TOKEN`.
- Where: sentry.io.
- Confirm: a test error from each service appears in its project with a release and readable stack trace.
- Unblocks: OBS-02.

### 0.10 First super admin
- What: add your Google account as the first super admin in each environment:
  `pnpm --filter @mitaoe/api run add-super-admin -- --project <id> --email you@example.com` (uses your own gcloud login).
- Where: your terminal, authenticated with `gcloud auth application-default login`.
- Confirm: signing in to staging lands on the Platform console.
- Unblocks: all three roles signing in on staging (phase 0 "done when").

### 0.11 GitHub repository settings
- What: turn off squash merging, keep merge commits, protect `main` (require a pull request and the `ci` check).
  Install Renovate on the repository (SEC-09).
- Where: GitHub → Settings.
- Confirm: a direct push to `main` is refused; Renovate opens its onboarding pull request.
- Unblocks: SEC-09, CI-02.

## Phase 3

### 3.1 Webcam clips for the camera fixtures
- What: two 5-second webcam clips: one of your face looking at the screen, and one with two faces. Convert each with
  `ffmpeg -i in.mp4 -pix_fmt yuv420p -s 640x480 -r 15 out.y4m` and upload them as `tests/fixtures/camera/one-face.y4m`
  and `tests/fixtures/camera/two-faces.y4m`.
- Where: GitHub → Add file → Upload files, on the working branch.
- Confirm: the PR-02 one-face and two-face tests stop skipping.
- Unblocks: PR-01, PR-02 (face present and multiple faces), EX-01 (face detection check passing).

### 3.2 Cloud Tasks queues
- What: queues `auto-submit`, `results`, `leaderboard`, `imports`, `reports`, `exports` and `prewarm` in `asia-south1`
  in staging and prod, each with OIDC push to the worker using `tasks@`.
- Where: Cloud Tasks.
- Confirm: `gcloud tasks queues list --location asia-south1`.
- Unblocks: EX-16, RES-01, LB-03, EXP-03, IMP-04, PERF-06.

## Phase 5

### 5.1 Pre-warming and monitoring
- What: no scheduler job is needed for pre-warming. Publishing a test queues one task per slot on the `prewarm` queue
  (3.2), named `prewarm-<orgId>-<testId>-<windowStart>`, due 30 minutes before the window start; the worker's
  `/tasks/prewarm` handler then raises the API minimum instances (docs/runbooks/exam-day.md). Locally the scaler only
  logs; when the Cloud Run scaler arrives with deployment, `worker@` needs permission to update the api service
  (Cloud Run Developer on that service). Also: the alert policies in OBS-04 and the exam-day dashboard in OBS-05.
- Where: Cloud Tasks (the `prewarm` queue); Cloud Monitoring.
- Confirm: after publishing a staging test, `gcloud tasks list --queue prewarm --location asia-south1` shows its
  `prewarm-…` task; the dashboard shows active attempts during a staging run; a forced 5xx burst fires the alert.
- Unblocks: PERF-06, OBS-04, OBS-05.

### 5.2 Staging load test
- What: run `k6 run -e API_URL=<staging api> -e TEST_ID=<published test> -e TOKENS=tokens.json tests/load/exam-500.js`
  against staging (docs/MANUAL_CHECKS.md PERF-07), with a test that is live for the whole run.
- Tokens: `tokens.json` is a JSON array of Firebase ID tokens of 500 registered students eligible for that test, one
  per virtual user. The repo has no script that makes them: create the students in staging (the student import), then
  on your own machine mint an ID token for each with the Firebase Admin SDK (`createCustomToken`, exchanged through
  the Identity Toolkit `signInWithCustomToken` endpoint). ID tokens last one hour, so mint them just before the run and
  keep the test's duration under about 50 minutes. Never commit the file.
- Where: a machine with k6.
- Confirm: k6 thresholds pass.
- Unblocks: PERF-07, phase 5 "done when".

## Phase 6

### 6.1 LLM provider
- What: choose the provider (OPEN_QUESTIONS 30, default Gemini on Vertex AI). For Vertex AI: enable the Vertex AI API
  and grant `worker@` Vertex AI user; no key needed. For OpenAI or Bedrock: put the key in `llm-api-key` (0.4).
  Set `LLM_PROVIDER` and `LLM_MODEL` on the worker service.
- Where: Cloud Run → worker → Variables and secrets.
- Confirm: the real-provider smoke test (`pnpm --filter @mitaoe/worker test:llm-smoke`) passes in staging.
- Unblocks: IMP-03, IMP-07, phase 6 "done when" (a real 30-page PDF).

### 6.2 A real 30-page question PDF
- What: provide a representative 30-page question paper PDF (not containing student data).
- Where: share it privately, or upload to staging and run an import.
- Confirm: the import finishes with every flagged item explained.
- Unblocks: phase 6 "done when".

## Phase 8

### 8.1 Production deploy pipeline
- What: approve the `production` GitHub environment protection rule (required reviewer), so CI-03 waits for manual approval.
  The repository's `.github/workflows/ci.yml` deploys nothing; add a separate deploy workflow on merge to `main` with
  these jobs (CI-03), authenticated through Workload Identity Federation (0.6):
  1. Build the `api` and `worker` images and push them to Artifact Registry (0.5), tagged with the commit SHA.
  2. Deploy both to staging Cloud Run, then queue the migrate task on staging (8.5) and wait for it to answer 2xx.
  3. Smoke tests against staging: `GET /health` on both services answers 200 with `X-Server-Time`, and the sign-in
     page of the staging web app loads.
  4. Wait for approval in the `production` environment.
  5. Freeze check (REL-01): fail the job when any test is live, that is a published test (`status` `scheduled` or
     `live`) whose `resolved.window` contains the current time, in any organization (a collection group query on
     `tests`; grant `deployer@` Firestore viewer, `roles/datastore.viewer`, for it), unless the workflow's `override_freeze` input is
     `true`; the job log names the live tests and whether the override was used.
  6. Deploy both to production with `--no-traffic`, shift all traffic to the new revisions, then queue the migrate
     task on production (8.5).
- Rollback (REL-02): `gcloud run services update-traffic api --to-revisions <previous revision>=100 --region
  asia-south1` (the same for `worker`); it takes seconds. Migrations only ever add (a field, a default), never remove
  or rename what an older revision reads, so the previous revision keeps working on migrated data and a rollback
  never needs a reverse migration.
- Where: GitHub → Settings → Environments; `.github/workflows/` (a new deploy workflow, not `ci.yml`).
- Confirm: a merge to `main` deploys staging and waits for approval before production; with a staging test live the
  freeze check stops the job, and the override input lets it through; a rehearsed rollback on staging serves the
  previous revision within seconds (docs/MANUAL_CHECKS.md REL-01, REL-02, CI-03).
- Unblocks: CI-03, REL-01, REL-02.

### 8.2 Pilot exam
- What: run a pilot exam with one college on production, following docs/runbooks/exam-day.md.
- Where: production.
- Confirm: pilot completed with no data loss (phase 8 "done when").
- Unblocks: phase 8 "done when".

### 8.3 Screen-reader passes
- What: NVDA on Chrome and Firefox and VoiceOver on Safari across every screen (A11Y-12), using the script in
  docs/MANUAL_CHECKS.md.
- Where: Windows and macOS machines.
- Confirm: the checklist is complete with no blocking issue.
- Unblocks: A11Y-12.

### 8.4 Accessibility statement contact
- What: set `NEXT_PUBLIC_ACCESSIBILITY_EMAIL` in Vercel (0.8) for staging and production to a mailbox you monitor, then
  redeploy the web app. Read `/accessibility/` against docs/BACKLOG.md and the Proposed accessibility items.
- Where: vercel.com, then the deployed `/accessibility/` page.
- Confirm: the Contact section shows your address, and a test mail to it arrives (docs/MANUAL_CHECKS.md).
- Unblocks: A11Y-22.

### 8.5 Data migrations after a deploy
- What: create a Cloud Tasks queue `migrations` in `asia-south1` in staging and prod (OIDC push to the worker with
  `tasks@`, like 3.2), with retries on (for example max attempts 10, min backoff 60 s). After each deploy the
  pipeline (8.1) queues one task: `gcloud tasks create-http-task --queue migrations --location asia-south1
  --url https://<worker>/tasks/migrate --method POST --header Content-Type=application/json --body-content '{}'
  --oidc-service-account-email tasks@<project>.iam.gserviceaccount.com --oidc-token-audience <worker url>`, which
  needs `deployer@` to be a Cloud Tasks enqueuer and Service Account User on `tasks@`. Migrations are never run by
  hand or from the API (CI-04). The worker answers `200 { applied: [...] }`; `409 MIGRATION_RUNNING` (another run is
  working) and `500 MIGRATION_FAILED` (logged with the migration ID; nothing of it is recorded) are retried by the
  queue. `{ "through": "<id>" }` applies only up to that migration.
- Where: Cloud Tasks; the deploy workflow.
- Confirm: on the first staging deploy after phase 8 the task answers 2xx and `_migrations/0001-student-accommodations`
  exists in staging Firestore with `changed` and `appliedAt` (docs/MANUAL_CHECKS.md CI-04).
- Unblocks: CI-04, CI-03.
