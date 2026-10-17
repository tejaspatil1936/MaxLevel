# PLAN — MITAOE Prep as it will be built

Source of truth: docs/SYSTEM_DESIGN.md. Decisions: docs/DECISIONS.md. Test environment: docs/TEST_ENV.md.
This file says how the spec becomes code: architecture, layout, the interfaces every layer uses, the data model as
types, the test-only API, and the build order inside each phase.

## 1. Architecture (spec 9)

```text
Browser (student, admin, super admin, phone)
  ├─ static files ── apps/web (Next.js static export; Vercel CDN in production, `serve` locally)
  ├─ REST + Firebase ID token ── apps/api (Fastify, always on, Cloud Run asia-south1)
  │                                 ├─ Firestore (system of record, Admin SDK only)
  │                                 ├─ Realtime Database (live/, signals/, attemptOwners/)
  │                                 ├─ Storage (through StorageSigner)
  │                                 └─ TaskQueue ──► apps/worker /tasks/* (Fastify, Cloud Run)
  ├─ Firebase Auth (Google sign-in; custom tokens for the phone)
  └─ Realtime Database directly (presence writes, live/ and signals/ reads, guarded by rules)
```

- The web app never talks to Firestore or Storage directly (DATA-08, DATA-09). It uses the Firebase JS SDK only for
  Auth and Realtime Database (9.4).
- Every API request carries `Authorization: Bearer <ID token>` (AUTH-05). The org comes from the `orgId` claim, or
  from `X-Org-Id` for super admins (API-04, ORG-11).
- Domain code gets time only from the injected `Clock` and enqueues work only through `TaskQueue` (CLAUDE.md).
- Scoring, draw, settings resolution, eligibility and timing live only in `packages/shared` (9.5).

## 2. Repository layout (spec 9.5)

```text
apps/
  web/                    Next.js App Router, output: 'export'
    app/                  routes (no dynamic segments; IDs in search params, WEB-02)
    src/lib/              api client, auth provider, query keys, i18n, preferences, offline queue (idb)
    src/features/<area>/  screens and hooks per area (platform, admin, student, exam, phone)
    vercel.json           security headers (WEB-04)
  api/
    src/app.ts            buildApp(deps): registers plugins and routes; used by server.ts and tests
    src/server.ts         listen on PORT, SIGTERM drain (REL-03)
    src/deps.ts           Deps: clock, queue, signer, firestore, rtdb, auth, config, logger
    src/plugins/          auth, org-context, errors, server-time, request-log, idempotency, rate-limit, feature-gate
    src/data/             data-access layer, one module per collection; every function takes orgId first (ORG-03)
    src/services/         entitlements cache, account-status cache, audit writer, live mirror, attempt engine
    src/routes/           session, me, platform/*, admin/*, student/*, pairing, files, test-only
    src/test/             integration test helpers (emulator reset, token minting)
  worker/
    src/app.ts            buildWorker(deps); /tasks/* routes with OIDC check (open only in test mode)
    src/tasks/            auto-submit, release-results, leaderboard, import, report, export, prewarm, migrate
packages/
  shared/src/             zod schemas (entities, requests, responses), Clock, entitlements, settings, eligibility,
                          draw, marks, scoring, timing, leaderboard ranking, question checks, day numbers, errors
  ui/src/                 tokens.css, theme.css (@theme), components (Radix-based), Storybook stories
  config/                 tsconfig.base.json, eslint.config.js, prettier.config.js
tests/
  acceptance/phase-N/     locked Playwright specs, one file per feature
  acceptance/pages/       page objects (editable)
  acceptance/fixtures/    sign-in per role, seed, clock, axe helper
  regression/             tests for bugs found by qa-explorer
  fixtures/camera/        .y4m clips;   fixtures/llm/  recorded model outputs
  load/                   k6 scripts
scripts/                  verify.sh, seed, locks, coverage, loop, gh-pr
firebase.json, firestore.rules, storage.rules, database.rules.json, .firebaserc (demo-mitaoe)
```

## 3. Interfaces

```ts
// packages/shared/src/clock.ts
export interface Clock { now(): number }                       // epoch ms
export const systemClock: Clock;
export class TestClock implements Clock {                      // used only when NODE_ENV=test
  now(): number; set(ms: number): void; advance(ms: number): void; followReal(): void;
}

// packages/shared/src/tasks.ts
export type TaskPath =
  | '/tasks/auto-submit' | '/tasks/release-results' | '/tasks/leaderboard' | '/tasks/import'
  | '/tasks/report' | '/tasks/export' | '/tasks/prewarm' | '/tasks/migrate';
export interface TaskRequest<P = unknown> {
  name: string;            // deterministic, makes enqueueing idempotent, e.g. `auto-submit-${attemptId}-${deadlineAt}`
  path: TaskPath;
  payload: P;
  scheduleTime?: number;   // epoch ms; omitted = now
}
export interface TaskQueue {
  enqueue(task: TaskRequest): Promise<void>;   // ignores ALREADY_EXISTS
}
// drivers: apps/api/src/tasks/cloud-tasks-queue.ts (OIDC push), apps/api/src/tasks/local-queue.ts
// (Firestore-emulator backed, dispatched by the API process against the Clock; see TEST_ENV.md)

// apps/api/src/storage/signer.ts
export interface StorageSigner {
  uploadUrl(path: string, opts: { contentType: string; maxBytes: number; expiresInSec: number }): Promise<string>;
  downloadUrl(path: string, opts: { expiresInSec: number; filename?: string }): Promise<string>;
}
// drivers: GcsSigner (v4 signed URLs signed through IAM signBlob, no key files) and EmulatorSigner
// (HMAC tokens to /v1/files/upload|download/:token, expiry checked against the Clock)

// packages/shared/src/llm.ts (types) + apps/worker/src/llm/*.ts (drivers)
export interface LlmClient {
  extractQuestions(input: {
    pages: Array<{ page: number; text?: string; image?: Uint8Array }>;
    hints: { sectionNames?: string[] };
  }): Promise<{ questions: DraftQuestion[]; usage: LlmUsage }>;
  writeReportSummary(metrics: ReportMetrics): Promise<{ summary: string; recommendations: string[]; usage: LlmUsage }>;
}
export interface LlmUsage { provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }
// drivers: AiSdkLlmClient(provider from LLM_PROVIDER, model from LLM_MODEL) and the AI SDK mock model with fixtures
```

```ts
// apps/api/src/deps.ts
export interface Deps {
  clock: Clock; queue: TaskQueue; signer: StorageSigner;
  db: Firestore; rtdb: Database; auth: Auth;
  config: Config; logger: Logger;
}
export function buildApp(deps: Deps): Promise<FastifyInstance>;
```

### Request context and guards

```ts
// apps/api/src/plugins/auth.ts — decorates request.user from the verified token
export type Role = 'superAdmin' | 'admin' | 'student' | 'device';
export interface AuthUser { uid: string; email: string; role?: Role; orgId?: string; studentId?: string; attemptId?: string }

// Every route declares its access in config; the guard plugin enforces it (ORG-11, FF-02).
export interface RouteAccess {
  access: 'public' | 'signedIn' | 'superAdmin' | 'admin' | 'student' | 'device';
  feature?: FeatureFlag;         // 403 FEATURE_DISABLED when off for the org (FF-02, ORG-13)
  checkRevoked?: boolean;        // default true for admin and superAdmin mutations (AUTH-05)
}
// 'admin' = admin whose claim orgId is the org, or super admin with X-Org-Id (ORG-11). request.orgId is set.
// Resources of another org are looked up under request.orgId only, so they are 404, never 403 (ORG-05).
```

## 4. Data-access layer (ORG-03)

Each module in `apps/api/src/data/` exports a factory that takes `Firestore` and returns functions whose first
parameter is `orgId`. Only `platform.ts` (super-admin cross-org lists) and `identity.ts` (bootstrap lookups by email)
are exempt, as ORG-03 allows. Writes that need an audit entry take a `WriteBatch` or `Transaction` so the audit writer
adds its entry to the same commit (AUD-02).

```ts
type Tx = FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch;
export interface Page<T> { items: T[]; nextCursor: string | null }      // API-05
export interface PageOpts { cursor?: string; limit?: number }            // limit max 200

// identity.ts (exempt: bootstrap)
findSuperAdminByEmail(email): Promise<SuperAdminRecord | null>;
findAdminOrgsByEmail(email): Promise<Array<{ orgId: string; adminId: string }>>;
findWhitelistOrgsByEmail(email): Promise<Array<{ orgId: string; entry: WhitelistEntry }>>;
upsertUserIndex(uid, entry: UserIndex): Promise<void>;

// platform.ts (exempt: super-admin cross-org views)
listOrgs(opts: PageOpts): Promise<Page<Org>>;
listAuditAcrossOrgs(filter: AuditFilter, opts: PageOpts): Promise<Page<AuditEntry>>;

// orgs.ts
getOrg(orgId): Promise<Org | null>;
createOrg(orgId, input: OrgCreate, tx): void;
updateOrg(orgId, patch: Partial<Org>, tx): void;

// admins.ts
listAdmins(orgId): Promise<AdminRecord[]>;
addAdmin(orgId, input: { email: string; name?: string; addedBy: string }, tx): AdminRecord;
removeAdmin(orgId, adminId, tx): void;
linkAdminUid(orgId, adminId, uid): Promise<void>;

// departments.ts
listDepartments(orgId): Promise<Department[]>;
createDepartment(orgId, name, tx): Department;
updateDepartment(orgId, deptId, patch: { name?: string; status?: 'active' | 'archived' }, tx): void;
mergeDepartment(orgId, fromId, intoId): Promise<number>;           // re-points students, archives `fromId`
countStudentsInDepartment(orgId, deptId): Promise<number>;

// whitelist.ts
listWhitelist(orgId, filter: WhitelistFilter, opts: PageOpts): Promise<Page<WhitelistEntry>>;
getWhitelistEntry(orgId, email): Promise<WhitelistEntry | null>;
existingEmails(orgId, emails: string[]): Promise<Set<string>>;
putWhitelistEntries(orgId, entries: WhitelistEntry[], tx): void;
setWhitelistStatus(orgId, emails: string[], status: WhitelistStatus, tx): void;
removeWhitelistEntries(orgId, emails: string[], tx): void;
countWhitelist(orgId): Promise<number>;

// students.ts
listStudents(orgId, filter: StudentFilter, opts: PageOpts & { sort?: StudentSort }): Promise<Page<Student>>;
getStudent(orgId, studentId): Promise<Student | null>;
findStudentByPrn(orgId, prn): Promise<Student | null>;
createStudent(orgId, input: StudentCreate, tx): Student;            // DATA-01: studentId generated here
updateStudent(orgId, studentId, patch: Partial<Student>, tx): void;
deleteStudent(orgId, studentId, tx): void;
matchEligible(orgId, rules: EligibilityRules): Promise<Student[]>;  // SER-07

// series.ts, tests.ts, questions.ts
listSeries(orgId, opts): Promise<Page<Series>>;   getSeries(orgId, id); createSeries(orgId, input, tx); updateSeries(orgId, id, patch, tx);
listTests(orgId, filter: { seriesId?: string }): Promise<Test[]>;    getTest(orgId, id); createTest(...); updateTest(...);
listQuestions(orgId, testId): Promise<Question[]>;  putQuestion(orgId, testId, q, tx); deleteQuestion(orgId, testId, qid, tx);
reorderQuestions(orgId, testId, orderedIds: string[], tx): void;

// attempts.ts, answers.ts, events.ts
getAttemptIndex(orgId, testId, studentId, tx?): Promise<AttemptIndex | null>;
createAttempt(orgId, attempt: Attempt, tx): void;  getAttempt(orgId, id, tx?); updateAttempt(orgId, id, patch, tx);
listAttemptsForTest(orgId, testId, opts): Promise<Page<Attempt>>;  listAttemptsForStudent(orgId, studentId): Promise<Attempt[]>;
getAnswers(orgId, attemptId): Promise<Record<string, AnswerRecord>>;
putAnswersIfNewer(orgId, attemptId, answers: AnswerWrite[]): Promise<AnswerSyncResult>;  // EX-11, per-record transaction
addEvent(orgId, attemptId, event: AttemptEvent, tx): void;  listEvents(orgId, attemptId): Promise<AttemptEvent[]>;

// audit.ts, usage.ts, leaderboards.ts, importJobs.ts, reports.ts, exports.ts
addAudit(orgId, entry: AuditEntryInput, tx): void;                  // the only write; no update or delete exists (AUD-04)
listAudit(orgId, filter: AuditFilter, opts): Promise<Page<AuditEntry>>;
incrementUsage(orgId, month: string, field: UsageField, limit: number): Promise<boolean>; // atomic, refuses at limit (FF-04)
getUsage(orgId, month): Promise<Usage>;
getLeaderboard(orgId, boardId); putLeaderboard(orgId, boardId, board);
createImportJob / getImportJob / updateImportJob / putDrafts / listDrafts (orgId first);
createReport / getReport / listReports; createExport / getExport (orgId first).
```

## 5. Data model as types (spec 10)

All types are inferred from Zod schemas in `packages/shared/src/model/*.ts`. Times are epoch milliseconds (UTC)
everywhere in storage and transport (TST-07); the web app formats them in the organization's timezone.

```ts
type Ms = number;
type FeatureFlag = 'ai_question_import' | 'question_pools' | 'sections' | 'negative_marking' | 'per_question_timer'
  | 'second_camera' | 'public_leaderboards' | 'extra_time_grants' | 'results_export' | 'analytics_reports';
type LimitKey = 'max_students' | 'max_admins' | 'ai_imports_per_month' | 'ai_reports_per_month' | 'storage_gb';

interface Plan { id: string; name: string; features: Partial<Record<FeatureFlag, boolean>>; limits: Partial<Record<LimitKey, number>> }
interface SuperAdminRecord { id: string; email: string; uid?: string; addedAt: Ms }          // DECISIONS Q5
interface UserIndex { role: Role; orgId?: string; studentId?: string; email: string }
interface EmailIndex { orgIds: string[] }                                                   // key sha256(email)

interface Org {
  id: string; name: string; slug: string; status: 'active' | 'suspended' | 'archived'; timezone: string;
  logoPath?: string; planId: string; featureOverrides: Partial<Record<FeatureFlag, boolean>>;
  limitOverrides: Partial<Record<LimitKey, number>>; profileLocked: boolean; createdAt: Ms;
}
interface AdminRecord { id: string; orgId: string; email: string; name?: string; uid?: string; status: 'active' | 'removed'; addedBy: string; addedAt: Ms }
interface Department { id: string; orgId: string; name: string; status: 'active' | 'archived' }
type WhitelistStatus = 'invited' | 'registered' | 'disabled';
interface WhitelistEntry { orgId: string; email: string; prn?: string; note?: string; status: WhitelistStatus;
  studentId?: string; source: 'upload' | 'paste' | 'single' | 'manual'; addedBy: string; addedAt: Ms }
interface Student { id: string; orgId: string; uid?: string; email: string; name: string; prn: string; departmentId: string;
  graduationYear: number; status: WhitelistStatus; accommodations: Record<string, { extraPct?: number; extraMin?: number }>;
  preferences?: Preferences; consentAt?: Ms; createdAt: Ms; updatedAt: Ms }

interface Settings {
  timingMode: 'fixed' | 'flexible';
  window: { start: Ms; end: Ms } | null;          // series: daily range { startMinutes, endMinutes } in `dailyWindow`
  durationMin: number; lateEntryCutoffMin: number; windowEndPolicy: 'full_duration' | 'hard_close';
  maxStrikes: number; devtoolsPolicy: 'block_strike' | 'block' | 'allow';
  fullscreenRequired: boolean; cameraRequired: boolean; secondCamera: boolean;
  shuffleQuestions: boolean; shuffleOptions: boolean;
  resultRelease: 'immediate' | 'after_close' | 'manual' | 'never';
  resultDetail: 'score' | 'sections' | 'full';
  showPastScores: boolean; testLeaderboard: boolean; seriesLeaderboard: boolean;
  marking: { marks: number; negativeMarks: number; preset: 'p1_0' | 'p1_m025' | 'p4_m1' | 'custom' };
  passingMarks?: number; floorAtZero: boolean; questionTimeLimitSec?: number;
}
interface EligibilityRules { departmentIds: string[]; graduationYears: number[]; include: string[]; exclude: string[] }
interface Series { id: string; orgId: string; title: string; description?: string; status: 'draft' | 'active' | 'archived';
  startDate: string; endDate: string; dailyWindow?: { startMinutes: number; endMinutes: number };
  defaults: Partial<Settings>; eligibility: EligibilityRules }
interface Section { id: string; name: string; order: number; instructions?: string; durationMin?: number; drawCount?: number;
  difficultyMix?: { easy: number; medium: number; hard: number }; forwardOnly: boolean; marks?: number; negativeMarks?: number }
type TestStatus = 'draft' | 'in_review' | 'approved' | 'scheduled' | 'live' | 'closed';
interface Test { id: string; orgId: string; seriesId: string; title: string; company?: string; dayNumber?: string | null;
  dayHidden: boolean; scheduledDate: string; overrides: Partial<Settings>; resolved?: Settings; drawCount?: number;
  sections: Section[]; eligibility?: EligibilityRules; approval?: { status: 'approved'; approvedBy: string; approvedAt: Ms };
  status: TestStatus; questionSetVersion: number; totalMarks: number; attemptsStarted: boolean;
  resultsReleasedAt?: Ms | null; resultsWithdrawn?: boolean }
interface Question { id: string; orgId: string; testId: string; sectionId?: string; order: number; type: 'single';
  prompt: string; images: QuestionImage[]; options: Array<{ id: string; text: string; image?: QuestionImage }>;
  correctOptionIds: string[]; explanation?: string; marks?: number; negativeMarks?: number;
  difficulty?: 'easy' | 'medium' | 'hard'; tags: string[]; timeLimitSec?: number;
  source: { kind: 'manual' | 'json' | 'ai'; jobId?: string; page?: number }; status: 'draft' | 'flagged' | 'approved' }
interface QuestionImage { path: string; alt: string }

type AttemptStatus = 'in_progress' | 'submitted' | 'auto_submitted' | 'terminated' | 'reset';
interface AttemptIndex { activeAttemptId: string | null; attemptCount: number }
interface Attempt { id: string; orgId: string; testId: string; seriesId: string; studentId: string; uid: string;
  status: AttemptStatus; startedAt: Ms; deadlineAt: Ms; extraTimeSec: number;
  draw: { questionIds: string[]; optionOrder: Record<string, string[]>; sections: Array<{ sectionId: string | null; questionIds: string[] }> };
  questionServedAt: Record<string, Ms>; strikesCount: number; lastStrikeAt?: Ms; submittedAt?: Ms;
  terminationReason?: string; result?: AttemptResult; sync?: { backlog: number; clockOffsetMs: number; at: Ms } }
interface AttemptResult { score: number; max: number; pct: number; passed?: boolean;
  sections: Record<string, { score: number; max: number; correct: number; incorrect: number; unanswered: number }>;
  correct: number; incorrect: number; unanswered: number; durationSec: number }
interface AnswerRecord { optionId: string | null; seq: number; clientTs: Ms; serverTs: Ms; lateSync?: boolean; markedForReview?: boolean }
interface AttemptEvent { id: string; type: ProctorEventType; details: Record<string, unknown>; clientTs: Ms; serverTs: Ms; strikeNumber?: number }
type ProctorEventType = 'fullscreen_exit' | 'tab_hidden' | 'window_blur' | 'no_face' | 'multiple_faces'
  | 'devtools' | 'phone_disconnected' | 'context_menu' | 'clipboard' | 'print' | 'late_sync' | 'note';

interface Leaderboard { computedAt: Ms; rows: Array<{ studentId: string; name: string; departmentId: string; score: number; rank: number; timeSec: number }> }
interface ImportJob { id: string; testId: string; filePath: string; format: ImportFormat; status: 'queued' | 'running' | 'ready' | 'failed';
  progress: { pagesDone: number; pagesTotal: number; questionsFound: number }; provider?: string; model?: string;
  tokens?: { input: number; output: number }; costEstimate?: number; error?: string; createdBy: string; createdAt: Ms }
interface AuditEntry { id: string; orgId: string; actor: { uid: string; role: Role; email: string }; action: string;
  target: { type: string; id: string }; before?: unknown; after?: unknown; ip: string; userAgent: string; requestId: string; createdAt: Ms }
interface Usage { aiImports: number; aiReports: number; storageBytes: number; testsRun: number }
interface Preferences { textSize: 100 | 115 | 130 | 150; theme: 'light' | 'dark' | 'system'; highContrast: boolean;
  reduceMotion: 'on' | 'off' | 'system'; increasedSpacing: boolean; readingRuler: boolean }

// Realtime Database (10.2)
interface LaptopPresence { online: boolean; lastSeen: number; fullscreen: boolean; visible: boolean }
interface PhonePresence { online: boolean; lastSeen: number; cameraOn: boolean }
interface LiveStatus { name: string; prn: string; status: AttemptStatus | 'pairing'; answered: number; total: number;
  strikes: number; deadlineAt: number; updatedAt: number; backlog?: number }
interface Signal { deadlineAt: number; notice?: string }
```

Student-facing response schemas (`packages/shared/src/api/student.ts`) never contain `correctOptionIds` or
`explanation`; the full-review schema is the only one that does, and it is served only after a full review is released
(DATA-05, SEC-04). Fastify serializes every response through its schema, which strips unknown fields.

## 6. Test-only API

Registered only when `NODE_ENV === 'test' && TEST_API_SECRET` (apps/api/src/routes/test-only.ts); each request needs
`X-Test-Secret`. Production builds never register it, and verify full checks that `/__test/clock` is 404 in a
production-mode start.

```ts
GET  /__test/clock                 -> { nowMs }
POST /__test/clock                 { nowMs } | { advanceMs } -> { nowMs }      // forwarded to the worker's clock
POST /__test/clock/real            -> { nowMs }
POST /__test/tasks/run-due         -> { ran: string[] }
GET  /__test/tasks                 -> { tasks: Array<{ name, path, scheduleTime }> }
POST /__test/reset                 { seed?: 'base' | 'none' } -> { ok: true }
POST /__test/seed/:scenario        scenario options -> ids        // e.g. 'scheduled-test', 'live-exam', 'results'
```

The worker exposes `POST /__test/clock` under the same conditions so the API can forward clock changes.

## 7. Web app

- Routes (all static, IDs in search params): `/` sign-in, `/choose-org`, `/profile`, `/accessibility`,
  `/student`, `/student/test?id=`, `/student/history`, `/student/leaderboards`, `/exam/preflight?test=`,
  `/exam/rules?test=`, `/exam?attempt=`, `/exam/submitted?attempt=`, `/student/result?attempt=`, `/pair?token=`,
  `/admin`, `/admin/whitelist`, `/admin/students`, `/admin/departments`, `/admin/series`, `/admin/series/view?id=`,
  `/admin/tests/edit?id=`, `/admin/imports/review?id=`, `/admin/live?test=`, `/admin/results?test=`,
  `/admin/reports`, `/admin/audit`, `/admin/settings`, `/platform`, `/platform/org?id=`, `/platform/audit`.
- Client layouts guard by claims (WEB-03). Super admins pick an organization in the switcher; the chosen org ID is kept
  in session storage and sent as `X-Org-Id`; every TanStack Query key starts with the org ID (WEB-05).
- Preferences apply before first paint through an inline script in the root layout reading the cached copy (A11Y-02).
- All copy comes from `src/i18n/en.ts` through `t()` (A11Y-23); ESLint `react/jsx-no-literals` enforces it.

## 8. Build order inside each phase

For every feature, commits go in this order (CLAUDE.md): shared schema or logic (with unit tests) → data access (with
integration tests on the emulators) → API route (integration tests, including org B 404 and super-admin parity) →
UI (page objects already exist from the phase's acceptance tests) → any remaining tests.

| Phase | Order |
| --- | --- |
| 0 | shared model + clock + entitlements → API skeleton plugins (errors, server time, auth, org context, feature gate, audit writer) → bootstrap and /me → rules → web shell, tokens, components, sign-in → tenancy and route-table tests |
| 1 | orgs and entitlements (platform console) → admins → departments → whitelist import → bootstrap for students and profile completion → student directory → audit log screens → accessibility panel |
| 2 | settings resolution and eligibility in shared → series → tests and overrides → questions and JSON import → sections, pools, marking, timers → preview → approval and publishing |
| 3 | draw, timing and scoring in shared → attempt start and resume → answers sync → exam screen and offline queue → submit and auto-submit → proctoring events and strikes → lockdown and camera → phone pairing and presence |
| 4 | ranking in shared → release task and modes → result and review screens → history → leaderboards → exports |
| 5 | live mirror → dashboard → extra time and signals → accommodations → reset, terminate, reinstate → prewarm task → runbook |
| 6 | question checks in shared → upload and job → worker extraction (JSON, sheets, LLM) → review screen → usage limits |
| 7 | metrics in shared → report job → summary check → PDF render → gating and listing |
| 8 | accessibility statement, audit fixes, security review fixes, migrations runner, performance budget |
