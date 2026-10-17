# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **MITAOE Engineering Students:** Candidates appearing for official placement recruitment drives (Day 1 to Day 5 company-style series: TCS Ninja/Digital, Infosys, etc.). They take locked-down timed exams, monitor remaining time, review proctored compliance, and track performance rankings on the series leaderboard.
- **Placement Cell Administrators:** Faculty and placement coordinators who configure assessment series, upload eligibility CSVs, author questions, manage active test windows, audit student attempts and violation strikes, and publish sealed result scorecards and leaderboards.

## Product Purpose

MITAOE Prep provides a high-integrity, institutional placement assessment platform that mirrors official corporate campus drives. It enables students to practice under strict, realistic examination conditions with automated proctoring, while providing administrators with automated scoring, fraud prevention, and performance analytics.

## Positioning

An institutional campus assessment engine combining physical examination ergonomics (physical OMR sheet aesthetic, single choice bubbles, high contrast typography) with modern zero-trust browser security (HTML5 fullscreen lock, tab blur detection, system clipboard interception, zero-tolerance devtools ban) and 100% on-device AI face presence verification (MediaPipe BlazeFace).

## Operating Context

- **Environment:** Monitored desktop/laptop browser environments in campus labs or student hostels.
- **Workflows:** 
  1. Google authentication cross-referenced with institutional eligibility whitelist.
  2. Diagnostic hardware clearance (screen width ≥ 1024px, fullscreen API, active server link, local camera face detection).
  3. Single-attempt 30-minute exam session with server-enforced countdown, background autosave, and client-side anti-cheat enforcement.
  4. Instant auto-submission on 3 warning strikes or timer expiry.
  5. Admin dashboard for series management, attempt resets, and leaderboard publishing.

## Capabilities and Constraints

- **Client Restrictions:** Single-window HTML5 fullscreen lock; clipboard copying and pasting prohibited; browser inspector shortcuts (F12, Ctrl+Shift+I) instantly terminate exam; window focus loss triggers immediate warning strike.
- **Privacy & Proctoring:** Real-time on-device face presence using MediaPipe BlazeFace. Zero video frames or photos uploaded or stored remotely.
- **Server Architecture:** Next.js 15 App Router on Vercel; Firestore database with zero client-side access (`allow read, write: if false;`); all operations strictly via Firebase Admin SDK.
- **Rate Limits & Scaling:** Tuned for up to 300 concurrent test-takers within Spark free-tier quotas (~5 operations per student per test).

## Brand Commitments

- **Name:** MITAOE Prep
- **Visual Identity:** Physical examination OMR paper aesthetic with clean, authoritative, high-contrast typography and subtle borders over heavy drop-shadows.
- **Palette:** Paper background (`#F4F5F7`), Surface (`#FFFFFF`), Deep Ink (`#0B1220`), Ink Muted (`#5B6578`), Pen Blue (`#1B2BD6`), Pen Wash (`#E8EBFF`), Amber Warning (`#E8A100`), Red Alert (`#D92D3F`), Green Success (`#0E9F6E`).
- **Typography:** Bricolage Grotesque (headings, display numbers, metrics) and Instrument Sans (body, instructions, options).
- **Styling Rules:** Borders over shadows (`border border-line`), high contrast, no decorative gradients or generic AI slop.

## Evidence on Hand

- Architecture and specification: `system-design.md`
- Eligibility sample dataset: `samples/eligibility.csv`
- Question bank schemas and fixtures: `samples/questions.json`

## Product Principles

1. **Uncompromising Exam Integrity:** The platform protects honest test-takers through automated server timing, lockdown enforcement, and fraud deterrence.
2. **Respect for Candidate Privacy:** Camera proctoring runs purely on-device using client-side WebAssembly/WebGL models without streaming candidate video to cloud servers.
3. **Physical OMR Clarity:** Interfaces resemble physical examination papers with clear bubble grids, high legibility, and zero visual clutter.
4. **Deterministic Fairness:** Server-side grading, transparent strike tracking, and instant auto-save prevent loss of candidate work under network fluctuations.

## Accessibility & Inclusion

- High contrast text conforming to WCAG AA.
- Full keyboard navigability on question selectors and radio bubbles.
- Clear error and warning states with redundant text tags alongside color codes.
