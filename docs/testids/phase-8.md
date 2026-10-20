# Phase 8 test contract: accessibility statement and migrations

The phase 8 acceptance tests (tests/acceptance/phase-8/) find elements through the page objects in
tests/acceptance/pages/, by role and accessible name, and read what the system stored through the worker, the API and
the Firestore emulator's REST endpoints. The implementation must expose exactly these names and shapes. The phase 0
to 7 contracts (docs/testids/phase-0.md to phase-7.md) stay valid, with every convention listed there (exact names,
static-export paths with trailing slashes, the phase 1 shell rules, API-01 error bodies
`{ "error": { "code", "message", "details" } }`). Phase 8 only adds to them.

Further conventions for phase 8:

- **Test clock.** Every phase 8 migration test sets the API's clock (forwarded to the worker) to
  **20 Oct 2026, 06:00 UTC** (`POST /__test/clock { nowMs: 1792476000000 }`) first, as in phases 2, 6 and 7.
- **Stored records** are read with the emulator owner credential. "Not written" means the record's Firestore
  `updateTime` is the same before and after.
- No new admin endpoint is added in phase 8, so there is no new ORG-05 or ORG-14 case.

## Feature F-8.01 (A11Y-22, A11Y-18; A11Y-12 is a manual check)

### Public accessibility statement: `/accessibility/`

A static page (WEB-01) that needs no sign-in, makes no API call it depends on, and shows the same content to a
signed-out visitor, a student, an admin and a super admin. No client guard sends anyone away from it (WEB-03 does not
apply): every role stays on `/accessibility/`. It still shows in full when every request to the API fails.

| What | Role | Name or text |
| --- | --- | --- |
| Document title | `<title>` | starts with `Accessibility statement` |
| Page content | `main` | exactly one |
| Heading | `heading` level 1 in `main` | exactly `Accessibility statement` |
| Sections | `region` (a `<section>` labelled by its level-2 heading) | exactly `Standard`, `Known gaps`, `Timed exams`, `Contact`, in this order; each holds a `heading` level 2 with the same name |
| Standard | text in `Standard` | contains `WCAG 2.2 level AA` (spec 14: "The target is WCAG 2.2 level AA on every screen, including the exam") |
| Known gaps | `list` in `Known gaps` | at least two `listitem`s. While A11Y-19 and A11Y-20 are Proposed (not built), two items describe them: one contains `screen reader`, `magnifier` and `strike` (assistive technology that takes window focus can count as leaving the exam); one contains `camera` (no exemption from the camera requirement). Other known gaps (for example the exam's single-key shortcuts, docs/BACKLOG.md) may be listed too. Matching is case-insensitive |
| Timed exams (A11Y-18) | text in `Timed exams` | says timed exams fall under WCAG's exception for real-time events and that adjustable time is still given through extra-time grants and standing accommodations: contains `WCAG`, `real-time`, `extra time` and `accommodation` (case-insensitive, the same words as the runbook's `## Timing and accessibility`) |
| Contact (help) | `link` in `Contact` | a `mailto:` link whose accessible name is exactly the email address it opens (`href` is `mailto:<name>`, no query string). The address is the implementer's choice, logged in docs/DECISIONS.md, and must be a mailbox the owner monitors (docs/MANUAL_CHECKS.md) |
| Contact, exam help | text in `Contact` | contains `placement cell` (students ask their placement cell for extra time and accommodations) |

Page rules (as for every non-exam page): headings never skip a level; no serious or critical axe violation (A11Y-21);
at 320 CSS px wide the page does not scroll horizontally (A11Y-15); every visible clickable target is at least 44 by 44
CSS px, links inside running text (`<p>`) exempt (A11Y-16).

### Ways in

| Where | Role | Name | Goes to |
| --- | --- | --- | --- |
| Sign-in page `/` | `link` | exactly `Accessibility statement` | `/accessibility/`, same tab |
| Accessibility settings dialog (phase 1, every top bar outside an attempt) | `link` in the `dialog` `Accessibility settings` | exactly `Accessibility statement` | `/accessibility/`, same tab |

The link must not appear in the accessibility settings dialog opened on the exam screens (`/exam/…`), where leaving
the page would interrupt an attempt. Everything else in the dialog stays as in phase 1.

### Exam-day runbook (A11Y-18, ties to REL-07)

`docs/runbooks/exam-day.md`, section `## Timing and accessibility`, names the public statement's path
`/accessibility/` (the statement repeats the runbook's note, and the runbook points the on-duty team to it). The phase
5 headings and words stay as they are.

## Feature F-8.02 (CI-04, REL-04; REL-01, REL-02 and CI-03 are owner checks)

### Migrations

Data migrations are versioned scripts in `apps/worker/src/migrations/`, run only through the worker task
`/tasks/migrate` (CI-04), never from the API or by hand.

- Each migration has an ID `NNNN-<kebab-name>` (four digits, then lowercase words joined by `-`); its version is the
  number `NNNN` (`0001` is version 1). Versions are unique and only ever appended.
- v1 ships **`0001-student-accommodations`**: every student record (`organizations/{orgId}/students/{studentId}`, in
  every organization) without an `accommodations` field gets `accommodations: {}`; records that have the field are not
  written. Its `changed` count is the number of records it wrote.
- A run applies, in ascending version order, every migration not yet in the ledger (with `through`, only those up to
  and including that ID), records each one in the ledger as it finishes, and stops at the first failure without
  recording it, so the next run retries it.
- **Ledger**: one record per applied migration at `_migrations/{migrationId}` (root collection, platform level):
  `{ version: number, appliedAt: Ms (Clock), changed: number }`. The ledger is never rewritten: a later run writes no
  ledger record and no data record for a migration already in it (REL-04).
- Overlapping runs (a Cloud Tasks retry while the first is still working) apply each migration once: one run applies
  it; the other answers `200` without it in `applied`, or `409 MIGRATION_RUNNING` (Cloud Tasks then retries).
- The base seed (`POST /__test/reset`) writes no ledger record, like a database before its first migration run. Every
  base-seed student record already has `accommodations` (an empty map when the student has none), so `0001` changes
  nothing on the base seed.
- The API has no route that runs migrations: `POST http://localhost:4000/tasks/migrate` answers `404` for every
  token, including a super admin's.

### Requests the tests send directly

| Request | Body | Expected |
| --- | --- | --- |
| Worker `POST http://127.0.0.1:4001/tasks/migrate` | `{}` | `200` `{ "applied": string[] }`: the IDs applied by this run, ascending version; `[]` when nothing is pending |
| Worker `POST http://127.0.0.1:4001/tasks/migrate` | `{ "through": "<migration ID>" }` | `200` as above, applying only pending migrations up to and including that ID. `400` with error code `UNKNOWN_MIGRATION` when no migration has that ID; then nothing is applied and nothing is written |
| API `POST http://localhost:4000/tasks/migrate` | `{}` | `404` |

The worker's `/tasks/*` routes are open without OIDC in test mode only (docs/TEST_ENV.md); in production the migrate
task, like every task, needs the tasks service account's OIDC token.

### Test-only scenario (`POST /__test/seed/:scenario`)

| Scenario | Body | Effect | Returns |
| --- | --- | --- | --- |
| `pre-migration-students` | `{ "orgId", "studentIds": string[] }` | removes the `accommodations` field from each of those student records of that organization (the shape before phase 5) and writes nothing else | `{ "studentIds": string[] }` |

## Unit and integration tests the build must add

These are verified below the browser. The builder writes them beside the code (Vitest; integration tests on the
emulators), each test title starting with its REQ IDs.

| REQ | Kind | Behaviours the tests must show |
| --- | --- | --- |
| CI-04 | unit | the migration list in `apps/worker/src/migrations/index.ts` has unique IDs matching `^\d{4}-[a-z0-9]+(-[a-z0-9]+)*$`, each file's ID equals its file name, versions strictly ascending with no gap |
| CI-04, REL-04 | integration | with a test migration list injected into `buildWorker(deps)`: a migration that throws stops the run, is not recorded, later migrations do not run, the response is non-2xx (so Cloud Tasks retries); the next run applies it and the rest; a run killed between a migration's data writes and its ledger record re-runs it safely because every migration is itself idempotent (running `0001` twice without the ledger writes nothing the second time) |
| CI-04 | integration | `0001-student-accommodations` pages through students in batches (never one unbounded read) across several organizations |

## Checked outside the automated suites

Proposed rows for docs/MANUAL_CHECKS.md (the owner adds them):

| REQ | Why not end to end here | Check |
| --- | --- | --- |
| A11Y-22 | whether the known gaps are true and complete and the contact mailbox is answered needs a person | before each release, the owner reads `/accessibility/` against docs/BACKLOG.md and Proposed accessibility items, and sends a test mail to the contact address |
| CI-04, CI-03 | the deploy pipeline enqueuing `/tasks/migrate` after a deploy runs only in GitHub Actions with Cloud Tasks | on the first staging deploy after phase 8, the migrate task runs with a 2xx and `_migrations/0001-student-accommodations` exists in staging Firestore |

## Test IDs

None. Every phase 8 element has a role and an accessible name.
