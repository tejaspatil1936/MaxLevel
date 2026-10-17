# MITAOE Prep — System Design

A proctored placement-prep platform for MIT Academy of Engineering students. Admins run a **series** of five daily company-style MCQ tests. Students take each test inside a locked-down exam screen. After the series, a leaderboard ranks everyone.

Read this whole file before writing code. Build in the phases at the end. Do not add features that are not in this document.

---

## 1. Goals and scale

| Item | Value |
|---|---|
| Users | about 500 eligible students, 1 to 3 admins |
| Peak concurrency | 250 to 300 students inside one test window |
| Test shape | 30 MCQs, 30 minutes, one attempt, five tests per series |
| Hosting | Vercel Hobby (free) |
| Backend | Firebase Auth + Firestore (Spark plan), accessed only from server code |

Free-tier budget (check before launch): Firestore Spark allows 50,000 reads and 20,000 writes per day. This design uses about 5 operations per student per test, so a 300-student test day costs roughly 1,500 operations in total.

---

## 2. Stack

- Next.js (App Router), TypeScript strict
- Tailwind CSS v4 (`@import "tailwindcss"`, design tokens in an `@theme {}` block in CSS, no `tailwind.config.js`)
- Firebase Auth (client SDK for sign-in only) and Firebase Admin SDK (server only)
- Fonts via `next/font/google`: Bricolage Grotesque and Instrument Sans
- No other UI kit. Build components from the design system in section 9.

Project rules:
1. Every API response uses one envelope: `{ "success": boolean, "data": any | null, "error": string | null }`. Errors also use it.
2. Components never call `fetch` directly. All calls go through `lib/apiClient.ts`, which attaches the Firebase ID token and unwraps the envelope.
3. Secrets live in `.env.local` only. Server variables have no prefix. Only Firebase web config uses `NEXT_PUBLIC_`.
4. Deliver full files, not diffs or snippets.

Environment variables: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `NEXT_PUBLIC_FIREBASE_*` (web config), `ADMIN_EMAILS` (comma-separated), `APP_TIMEZONE=Asia/Kolkata`.

Folder structure:

```
app/
  (public)/page.tsx                     landing + sign-in
  (student)/dashboard/page.tsx
  (student)/tests/[testId]/rules/page.tsx
  (student)/tests/[testId]/exam/page.tsx
  (student)/tests/[testId]/result/page.tsx
  (student)/leaderboard/page.tsx
  (admin)/admin/...                     series, tests, eligibility, attempts
  api/...                               route handlers (section 5)
components/ui/  components/exam/  components/admin/
hooks/          useProctor.ts  useExamTimer.ts  useFaceMonitor.ts
lib/            firebase-client.ts  firebase-admin.ts  apiClient.ts
                auth.ts  grade.ts  time.ts  csv.ts  validate.ts
types/
```

---

## 3. Core rules (decisions already made)

1. **Eligibility gate.** Admin uploads a CSV or XLSX with columns `prn,email,name`. A person can register only if their PRN or email matches a row. One account per row.
2. **Sign-in.** Firebase email-link sign-in (passwordless) after the eligibility check passes. This proves email ownership without building OTP infrastructure. A custom 6-digit OTP can replace it later.
3. **Series.** A series holds five tests (Day 1 to Day 5). Only one series is `active` at a time. Admin can archive a finished series and start a new one. All series share the same eligibility list.
4. **Test window.** Each test has a date and a daily window (default 07:00 to 15:00, editable per series and per test). A student can start only inside the window. Their deadline is `startedAt + durationMin`, and is not cut short by the window closing.
5. **One attempt per student per test.**
6. **Score visibility is admin-controlled.** `series.resultsVisible` (per-test results after submitting) and `series.leaderboardVisible` (leaderboard). Both default to `false`. A test can override the series setting with its own `resultsVisible`.
7. **Leaderboard.** Rank by total score, descending. Tie-break by lower total time taken. A missed test scores 0. Show per-test marks and the total.
8. **Question sourcing.** Admin uploads a JSON file per test (schema in section 4). A crawler is out of scope for this repo: it will be a separate local tool that outputs this same JSON.

---

## 4. Firestore data model

Firestore rules: `allow read, write: if false;` for every path. Clients never touch Firestore. All reads and writes go through route handlers using the Admin SDK. This keeps answer keys and questions unreachable from the browser.

```
eligibleUsers/{prn}
  prn, email (lowercase), name, claimedByUid | null

users/{uid}
  prn, email, name, role: "student" | "admin", createdAt

series/{seriesId}
  title, status: "draft" | "active" | "archived"
  window: { start: "07:00", end: "15:00", tz: "Asia/Kolkata" }
  durationMin: 30
  maxStrikes: 3
  devtoolsOpenPolicy: "strike" | "submit"      (default "strike")
  resultsVisible: false
  leaderboardVisible: false
  createdAt, archivedAt | null

tests/{testId}
  seriesId, day: 1..5, title, company
  date: "YYYY-MM-DD"
  window: { start, end } | null                (null inherits from series)
  durationMin | null                           (null inherits)
  questionCount
  resultsVisible: boolean | null               (null inherits)
  hasQuestions: boolean

testQuestions/{testId}                         one doc, one read per student
  questions: [{ id, text, options: string[4], topic?, source? }]

answerKeys/{testId}                            server-only, never returned to clients
  answers: { [questionId]: 0..3 }
  explanations?: { [questionId]: string }

attempts/{testId}_{uid}                        deterministic id enforces one attempt
  uid, seriesId, testId
  status: "in_progress" | "submitted" | "auto_submitted"
  submitReason: "manual" | "timeout" | "strikes" | "devtools" | "camera" | "expired" | null
  startedAt, deadlineAt                        server timestamps
  answers: { [questionId]: 0..3 }
  score, total, timeTakenSec
  strikes: number
  events: [{ type, at, meta? }]                capped at 100
  submittedAt

leaderboards/{seriesId}
  generatedAt
  rows: [{ uid, name, prn, scores: { d1..d5 }, total, timeSec, rank }]
```

Question JSON accepted by the admin upload (validate strictly, reject the whole file on any error and report the failing index):

```json
{
  "questions": [
    {
      "id": "q1",
      "text": "string",
      "options": ["A text", "B text", "C text", "D text"],
      "correctIndex": 2,
      "explanation": "optional string",
      "topic": "optional string",
      "source": "optional string"
    }
  ]
}
```

On upload, split it: `questions` without `correctIndex` into `testQuestions`, and answers into `answerKeys`.

---

## 5. API routes

Auth: `Authorization: Bearer <Firebase ID token>`, verified with the Admin SDK on every route except the first. Admin routes also require `role === "admin"` (bootstrap admins from `ADMIN_EMAILS`).

Public
- `POST /api/auth/check-eligibility` body `{ prn?, email? }` returns `{ eligible: boolean }`. Throttle by IP. Never reveal which field matched or any row data.
- `POST /api/auth/complete-registration` after email-link sign-in. Re-checks eligibility, creates `users/{uid}`, sets `claimedByUid`. Rejects if the row is already claimed.

Student
- `GET /api/series/active` returns the active series and its five tests with a computed `state`: `upcoming | open | closed | submitted`. No questions.
- `POST /api/tests/:testId/start` checks the window and that no attempt exists, creates the attempt with `deadlineAt`, returns `{ attemptId, questions, deadlineAt, serverNow }`. If an `in_progress` attempt exists and the deadline has not passed, return it again (this is the refresh and reconnect path).
- `PUT /api/attempts/:attemptId/answers` autosave. Called about every 2 minutes and on reconnect. Rejects after `deadlineAt + 30s`.
- `POST /api/attempts/:attemptId/violation` body `{ type, meta?, answers? }`. The server is authoritative on strikes: it increments, appends to `events`, and returns `{ strikes, max, autoSubmit }`. For instant-submit types it grades using the `answers` sent in this request (fallback: last autosave).
- `POST /api/attempts/:attemptId/submit` body `{ answers }`. Grades on the server, writes score, returns only `{ submitted: true }` unless results are visible.
- `GET /api/attempts/:attemptId/result` returns score and per-question review only when visibility allows; otherwise `403` with a clear message.
- `GET /api/leaderboard/:seriesId` only when `leaderboardVisible`.

Admin
- `POST /api/admin/eligibility/upload` multipart CSV/XLSX. Upsert by PRN, report added, updated, and rejected rows.
- `POST /api/admin/series` create. `PATCH /api/admin/series/:id` edit window, duration, strikes, visibility toggles. `POST /api/admin/series/:id/activate` (fails if another is active). `POST /api/admin/series/:id/archive` (read-only afterward).
- `PUT /api/admin/tests/:testId` edit title, company, date, window, duration, visibility override.
- `POST /api/admin/tests/:testId/questions` JSON upload (section 4).
- `POST /api/admin/series/:id/leaderboard/generate` finalizes expired attempts, then writes `leaderboards/{seriesId}`.
- `GET /api/admin/tests/:testId/attempts` list attempts with strikes, events, and submit reason. `GET .../export` returns CSV.

Expired attempts: a student who closes the browser leaves an `in_progress` attempt. There is no cron. Instead, any read that cares (leaderboard generation, admin attempt list, the student's own result fetch) first runs `finalizeExpiredAttempts(testId)`, which grades `in_progress` attempts past `deadlineAt + 30s` from their last autosave and marks them `submitReason: "expired"`.

---

## 6. Exam flow

1. Dashboard shows the five tests with their state. A test is startable only when `open`.
2. **Rules screen** (section 7). The student must pass readiness checks and confirm before the start button enables.
3. `POST /start`. The client receives `deadlineAt` and `serverNow`, computes the clock offset once, and runs the timer from the server deadline. Refreshing never resets or pauses time.
4. Exam screen with the proctor layer active (section 8). Answers are held in memory and mirrored to `sessionStorage` and autosaved about every 2 minutes.
5. Submit manually, on timeout, or via auto-submit. The student lands on a confirmation screen that states the reason. No score is shown unless visibility allows.
6. The exam is desktop or laptop only. Below 1024px wide, show a message to switch devices and do not start.

---

## 7. Rules notice (shown before every test)

Full-screen page before the exam. Plain language, sentence case. Content:

**Heading:** Read this before you start.

**Rules:**
- You have 30 minutes. The timer runs on our server. Refreshing the page does not pause it.
- Stay in this tab and in fullscreen. Leaving either counts as a warning.
- Copying, cutting, and pasting are blocked. Each attempt counts as a warning.
- After 3 warnings your test is submitted automatically.
- Opening developer tools, or pressing their shortcuts, submits your test immediately.
- Your camera stays on for the whole test. Nothing is recorded or saved; it only checks that you are alone and in frame. *(Show this line only once camera proctoring ships, Phase 3.)*
- You get one attempt per test. Scores stay hidden until your admin releases them.

**Readiness checks** (each shows pass or fail with a fix hint): window is at least 1024px wide, fullscreen permission works, internet connection is stable, camera permission granted (Phase 3).

**Confirm:** a checkbox "I have read and accept these rules", then a primary button "Start test" that enables only when every check passes and the box is ticked. On click, show a 3-second countdown, then enter fullscreen and start.

Read the numbers from the series config, not hardcoded copy (`durationMin`, `maxStrikes`).

---

## 8. Proctoring spec

Principle: this is a deterrent, not a guarantee. A second device can defeat any browser-only check. The server is authoritative for strikes and deadlines.

Client monitor (`useProctor`):

| Signal | Detection | Action |
|---|---|---|
| Tab switch or window blur | `visibilitychange` and `window.blur`, debounced to one event per second | strike |
| Fullscreen exit | `fullscreenchange` | strike, blocking overlay to re-enter fullscreen |
| Copy, cut, paste | `copy`, `cut`, `paste` events (prevent default) | strike |
| Right-click, text selection, drag | `contextmenu`, `selectstart`, `dragstart` prevented | blocked silently, no strike |
| DevTools shortcuts | F12, Ctrl/Cmd+Shift+I, J, C, Ctrl/Cmd+U, Cmd+Option+I, J, U | **instant auto-submit** |
| DevTools opened | outer/inner window size difference over a threshold, checked every 1s | per `devtoolsOpenPolicy`: strike (default) or instant submit. This check is heuristic and can false-positive (zoom, docked panels), so default is strike |
| Reload or navigation | `beforeunload` prompt | logged as an event, no strike. The attempt resumes with the same deadline |

Strike flow: client posts to `/violation`. Server returns `{ strikes, max, autoSubmit }`. If `autoSubmit` is true the client shows the auto-submit screen. Otherwise it shows a blocking warning modal: "Warning 2 of 3", what triggered it, and one button to resume.

Offline handling: if a request fails, queue it and retry. At the deadline, submit whatever is held locally. The server accepts submissions until `deadlineAt + 30s`.

Camera monitor (**Phase 3**, `useFaceMonitor`): load a face-detection model (MediaPipe or TensorFlow.js) in the browser and run it every 1 to 2 seconds, increasing the interval to 3 to 4 seconds if inference is slow on weak machines. Flag zero faces or more than one face when sustained for more than about 8 seconds. Camera events are logged, and by default counted as strikes only after sustained detection; make this a series setting. No video or snapshots are uploaded or stored. Only the event type and timestamp are logged. If camera permission is denied, block the test start.

---

## 9. UI and design system

**Brief:** a world-class, professional proctoring product. Light theme. Big, confident typography. It must look designed for this exact job, never like a generic generated template.

**The memorable idea:** exam papers in India are answered on OMR sheets. Use that vernacular. Answer options are OMR-style bubbles that fill with ink-blue when chosen, and the question palette reads like an OMR grid. Spend the boldness here and on the timer. Keep everything else quiet.

**Color tokens** (define in `@theme`):
- `paper` `#F4F5F7` page background
- `surface` `#FFFFFF` panels
- `ink` `#0B1220` text
- `ink-muted` `#5B6578` secondary text
- `line` `#E1E5EC` borders (use borders, not shadows, to separate)
- `pen` `#1B2BD6` primary, the ink-blue used for filled bubbles and primary actions
- `pen-wash` `#E8EBFF` selected state background
- `amber` `#E8A100` warnings, `red` `#D92D3F` danger, `green` `#0E9F6E` success

**Type:**
- Display and numerals: **Bricolage Grotesque**, weights 600 to 800, tight tracking on large sizes. Use `font-variant-numeric: tabular-nums` for the timer and any score.
- Body and UI: **Instrument Sans**, 400 to 600.
- Scale: hero 96 to 144px, page titles 56px, question text 28 to 32px, body 16px, small 14px. Line length under 80 characters.
- Use large type on purpose: giant timer, giant question number, giant rank. Let type be the layout.

**Layout concepts:**
- Landing and sign-in: left-aligned giant headline "Five days. Five company tests. One leaderboard." Sign-in form beside it on desktop, stacked on mobile.
- Dashboard: series title in display type, then the five days as a real sequence (numbering is correct here because it is a sequence), each with a clear state.
- Rules page: two columns. Left, the heading in display type. Right, the rules and readiness checks.
- Exam screen: top bar with test title at left, a strike meter (three pips) in the centre, and the timer at right in large display numerals. The timer turns amber at 5 minutes left and red at 1 minute. Main area: the question number in display type, the question at 28 to 32px, options as OMR rows. Right rail: the question palette grid (answered filled, marked-for-review outlined, current ringed). Bottom: Previous, Mark for review, Next, and Submit.
- Warning modal: blocking and calm. Says what happened and how many warnings remain.
- Results and leaderboard: a sticky-header table, per-test marks, total, rank in large numerals; the signed-in student's row is highlighted.
- Admin: same tokens, denser and more utilitarian. Tables, forms, upload dropzones with clear validation errors.

**Avoid (these read as template output):**
- gradients, glass or blur panels, gradient buttons
- identical rounded cards in a grid with the same soft shadow; vary radius by role (bubbles fully round, inputs 8px, panels 12px) and prefer borders over shadows
- ALL-CAPS tracked eyebrow labels above headings, single accented word in a headline, arrows appended to button text, emoji as decoration
- fade-and-slide entrance animations on every section and hover effects on everything. Use motion only to answer an action (selecting an option fills the bubble, the timer changing state, a modal opening) plus at most one orchestrated moment on first load of the dashboard
- Lorem ipsum, fake testimonials, fake stats

**Copy:** plain verbs, sentence case, buttons say exactly what happens ("Start test", "Submit test", "Resume"). Errors say what went wrong and how to fix it, and never apologize.

**Quality floor:** keyboard focus visible everywhere, full keyboard control in the exam (1 to 4 select options, arrow keys navigate), `prefers-reduced-motion` respected, WCAG AA contrast, responsive everywhere except the exam which is desktop-only.

---

## 10. Security checklist

- Firestore rules deny all client access. Verify with a test.
- Answer keys exist only in `answerKeys`, read only in `submit`, `violation`, and finalization code.
- Timer and deadline are enforced on the server. Never trust client time.
- Verify the ID token and role on every non-public route.
- Validate every request body (use a schema validator such as zod). Cap upload sizes.
- Throttle `check-eligibility` so the roster cannot be enumerated, and return only a boolean.
- Never log tokens, answer keys, or private-key values.

---

## 11. Build phases and prompts

Work in three phases only. After each phase, the agent reports back with: the file tree it created, anything that deviated from this document and why, anything blocked, and the env vars needed. Do not start the next phase until asked.

**Phase 1: Foundation.** Next.js project, Tailwind v4 tokens, fonts, `apiClient`, Firebase client and admin setup, auth (eligibility check, email-link sign-in, complete-registration), student and admin route guards, eligibility upload, series and test CRUD (including activate and archive), question JSON upload, landing, sign-in, dashboard, and the admin screens.

**Phase 2: Exam engine.** Rules screen with readiness checks, start, autosave, violation and submit endpoints, server grading, `finalizeExpiredAttempts`, the full exam screen, `useProctor` with every signal in section 8 (except the camera), warning and auto-submit screens, and the submitted confirmation.

**Phase 3: Results and camera.** Result view with visibility toggles, leaderboard generation and display, attempts list and CSV export for admin, the camera monitor with the permission flow, a polish pass against the design rules, and a pass on the security checklist.

---

## 12. Out of scope for the MVP

Question crawler, custom 6-digit email OTP, payments, native mobile exam, video recording or snapshots, live proctor dashboard, per-series eligibility lists.
