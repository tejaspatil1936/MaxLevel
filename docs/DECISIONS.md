# Decisions

One line per decision: date | source | decision | REQ IDs. Owner answers and AUTO-DECIDED defaults come from
docs/OPEN_QUESTIONS.md; build choices are the agent's own under decision policy rule 2 in CLAUDE.md.

## From open questions (no owner answer, proposed default applied)

- 2026-10-17 | Q1 How common are students in several organizations? | rare, but supported exactly as AUTH-04 says: bootstrap returns the list of organizations, the student picks one, the claims hold that one `orgId`, and switching repeats bootstrap. | AUTH-04, AUTH-02 | AUTO-DECIDED
- 2026-10-17 | Q2 Domain names for the app and the API | `app.<domain>` and `api.<domain>`, read from configuration (`APP_ORIGINS`, `NEXT_PUBLIC_API_URL`). Locally and in CI: `http://localhost:3000` and `http://localhost:4000`. | SEC-05, WEB-04, CI-01 | AUTO-DECIDED
- 2026-10-17 | Q3 Staging-only "done when" criteria | the agent's phase gate is the local production build on the emulators; staging checks go to docs/MANUAL_CHECKS.md and docs/OWNER_SETUP.md. | CI-01, PERF-07, OBS-02 | AUTO-DECIDED
- 2026-10-17 | Q4 CI-02 Playwright target before staging exists | until staging exists, CI runs the same suite against a local production build on the emulators. Both run once OWNER_SETUP phase 0 is done. | CI-02 | AUTO-DECIDED
- 2026-10-17 | Q5 Admin and super-admin records are keyed by uid, but are added by email | like students (DATA-01), admin and super-admin records get a generated ID and store `email` and `uid?`; bootstrap matches by email and links the uid at first sign-in. `userIndex/{uid}` stays keyed by uid. The first super admin is created by a seed script (emulators) or by the owner (docs/OWNER_SETUP.md). | ORG-08, AUTH-02, DATA-01 | AUTO-DECIDED
- 2026-10-17 | Q6 High contrast in dark mode | high contrast is one theme (black on white, 2 px borders, black outlines) that wins over light or dark. | A11Y-01, A11Y-13, UI-13 | AUTO-DECIDED
- 2026-10-17 | Q7 Storybook for the component catalogue | Storybook (React + Vite builder) in packages/ui, checked by `storybook build` in verify full. | UI-14 | AUTO-DECIDED
- 2026-10-17 | Q8 Translation layer | a typed message catalogue in packages/ui (`t('key')` with an English dictionary) and an ESLint rule that rejects raw text in JSX in apps/web. | A11Y-23 | AUTO-DECIDED
- 2026-10-17 | Q9 Archived organizations and sign-in | nobody in an archived organization can sign in (as with suspended); super admins can read it but every mutation returns 409 ORG_ARCHIVED. | ORG-07, US-SA-05 | AUTO-DECIDED
- 2026-10-17 | Q10 Reflow at 320 px versus admin pages from 768 px | student and phone pages reflow at 320 px with no horizontal page scroll. Admin pages are designed for 768 px and up; below that they still reflow (sidebar becomes a menu button) and wide tables scroll inside their own region, which WCAG 1.4.10 allows for data tables. | A11Y-15, UX-12 | AUTO-DECIDED
- 2026-10-17 | Q11 Whitelist upload parsing location | whitelist CSV and XLSX files are parsed in the admin's browser (Papa Parse, ExcelJS); only the mapped rows are sent to `POST /v1/whitelist/import` as JSON, validated with Zod. No file reaches the server, so SEC-06 applies to the import pipeline (phase 6) and report or export files only. | WL-02, WL-03, SEC-06 | AUTO-DECIDED
- 2026-10-17 | Q12 Plans and FF-06 | one built-in plan `standard` equal to the system defaults; FF-06 stays unbuilt. Resolution still reads org override, then plan, then system default. | FF-01, FF-06 | AUTO-DECIDED
- 2026-10-17 | Q13 Multiple-correct and numeric questions | later. v1 is single correct only; the schema keeps `type` and an array `correctOptionIds` so adding types later needs no migration. | Q-01, IMP-09 | AUTO-DECIDED
- 2026-10-17 | Q14 "Publish" versus "schedule" | **Publish test** moves an approved test to `scheduled` and saves the resolved snapshot (TST-05). `live` and `closed` follow from the window times and are not set by hand. | TST-04, TST-05, UX-10, US-AD-09 | AUTO-DECIDED
- 2026-10-17 | Q15 What counts as "preview approved" | approval happens from the Preview tab: running the Q-14 checklist and pressing **Approve test** there is the preview approval. No separate record. | TST-04, Q-13, Q-14 | AUTO-DECIDED
- 2026-10-17 | Q16 Editing a scheduled test before attempts start | yes. Editing questions, sections or locked settings of an approved or scheduled test with no attempts returns it to `in_review` and clears the snapshot; release and visibility settings do not. | Q-15, TST-04, TST-05 | AUTO-DECIDED
- 2026-10-17 | Q17 Status of manually written questions | a manual or JSON question that passes the IMP-09 checks is saved as `approved`; one that does not is saved as `draft` with its reasons shown. Imported questions follow IMP-12. | Q-01, Q-04, Q-14 | AUTO-DECIDED
- 2026-10-17 | Q18 Late sync versus auto-submit | the auto-submit task fires at deadline + 2 minutes, and a client submit before then is graded after its queue is flushed. | EX-13, EX-16, EX-17 | AUTO-DECIDED
- 2026-10-17 | Q19 Per-question timers offline | per-question timers require a live connection; offline navigation is held at the current question until the serve call succeeds. | Q-11, Q-12, EX-10, EX-13 | AUTO-DECIDED
- 2026-10-17 | Q20 Fixed slot window extension | no; deadlines change only through extra time. | TST-06, OPS-06 | AUTO-DECIDED
- 2026-10-17 | Q21 Signing on Cloud Run without key files | grant the api service account Service Account Token Creator on itself only, and add this to SEC-03's role list. | SEC-01, SEC-03, DATA-09, PR-14 | AUTO-DECIDED
- 2026-10-17 | Q22 Proctoring in automated tests | Chromium fake camera files (no face, one face, two faces) and headed Chromium under xvfb for lockdown tests. | PR-01 to PR-06, EX-01 | AUTO-DECIDED
- 2026-10-17 | Q23 Grade terminated attempts or score them zero? | as the spec says: grade the answers so far, mark `terminated`, leave out of leaderboards. | PR-10, LB-02 | AUTO-DECIDED
- 2026-10-17 | Q24 First warning free of a strike (PR-12)? | no. PR-12 stays Proposed and unbuilt. | PR-12 | AUTO-DECIDED
- 2026-10-17 | Q25 Reset in a fixed slot after the late-entry cutoff | a reset attempt may start after the late-entry cutoff; its deadline follows the normal rule for the timing mode (fixed slot: slotEnd plus extra time). The admin adds extra time if the student needs more. | OPS-10, TST-07 | AUTO-DECIDED
- 2026-10-17 | Q26 Email notifications in v1? | later; not built. | none (8.9 is Proposed) | AUTO-DECIDED
- 2026-10-17 | Q27 Series certificates in v1? | later; not built. | none (8.9 is Proposed) | AUTO-DECIDED
- 2026-10-17 | Q28 Default leaderboard identity | full name with the department name in its own column; SER-11 stays unbuilt. | SER-11, LB-05 | AUTO-DECIDED
- 2026-10-17 | Q29 "Extra time for all" in the live dashboard layout | the button is not built until OPS-05 is approved. | OPS-05, OPS-01 | AUTO-DECIDED
- 2026-10-17 | Q30 Which LLM provider? | Gemini on Vertex AI through the AI SDK, set by configuration. All tests use the AI SDK mock model; the real-provider smoke test runs only when a key is present. | IMP-07, EXP-05 | AUTO-DECIDED
- 2026-10-17 | Q31 Retention periods | keep everything in v1; no automatic deletion. Uploaded import source files are kept with their job. | AUD-05, DATA-11 | AUTO-DECIDED
- 2026-10-17 | Q32 Requirements that cannot be proved automatically | yes; each is a docs/MANUAL_CHECKS.md entry with who runs it and when. | UI-02, UI-04, UI-06, UI-11, UX-13, UX-14, A11Y-12, PERF-07, PR-02 | AUTO-DECIDED
- 2026-10-17 | Q33 Coding questions with code execution? | out of v1. | none (non-goal 1.2) | AUTO-DECIDED

## Build choices
