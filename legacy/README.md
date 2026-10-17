# MITAOE Prep — Enterprise Placement Examination & Proctoring Platform

> A mission-critical, institutional placement examination and automated proctoring platform engineered for the **MIT Academy of Engineering (MITAOE)**. Designed to conduct high-stakes campus placement drives (TCS, Infosys, Cognizant, etc.) for **1,000–2,000 candidates** with **~500 concurrent test-takers**, featuring dual-device camera proctoring, zero-trust browser lockdown, instant server grading, and cumulative rank leaderboards.

---

## 1. Executive Overview & Current State

**MITAOE Prep** bridges the gap between physical paper-based examination integrity and modern cloud scalability. The platform enforces strict corporate campus assessment conditions through a hybrid on-device AI and secondary-camera monitoring system, while preserving 100% student privacy (zero video streams or snapshots sent to cloud servers).

### Current Operational State
- **Engine**: Next.js 15+ (App Router), React 19, TypeScript (Strict).
- **Database & Auth**: Google Cloud Firestore (Blaze Pay-As-You-Go Plan) with 100% server-side Firebase Admin SDK isolation and zero client read/write access.
- **Production Status**: Production-ready. Successfully running multi-day mock placement series (e.g., 5-day Infosys / TCS test tracks).
- **Infrastructure Strategy**: Multi-cloud deployment plan spanning **Google Cloud Run (Mumbai)** (funded via ₹25,000 GCP credits for 70 days) and **AWS EC2 Graviton3** (funded via $100 AWS credits for 5+ months). Detailed in [`CLOUD_ARCHITECTURE_AND_PRICING_GUIDE.md`](./CLOUD_ARCHITECTURE_AND_PRICING_GUIDE.md).

---

## 2. Technology Stack

### Frontend & Core
* **Framework**: [Next.js 15+](https://nextjs.org/) (App Router, Server Actions, API Route Handlers).
* **UI Library**: React 19, Tailwind CSS v4 (`@theme` tokens, clean borders, high contrast, OMR paper aesthetic).
* **Typography**: Bricolage Grotesque (headings, numerical scores, timers) & Instrument Sans (body UI, questions, options).
* **Icons**: Lucide React.
* **Canvas & Certificates**: HTML5 Canvas rendering for dynamic, high-resolution student placement certificates.

### Backend & Cloud
* **Runtime**: Node.js 20 LTS.
* **Database**: Google Cloud Firestore (Distributed NoSQL).
* **Authentication**: Firebase Authentication (Google OAuth 2.0 with institutional email verification).
* **Security Layer**: Complete client lockdown via `firestore.rules` (`allow read, write: if false;`). Every read, write, and grade is cryptographically verified via Firebase Admin SDK on the server.
* **Hosting Options**: Dockerized Next.js running on **Google Cloud Run** or **AWS EC2 (Graviton3 `t4g.small` / `c7g.xlarge`)** behind Nginx reverse proxy.

### On-Device AI & Proctoring
* **Face Detection**: Google MediaPipe FaceDetector (`@mediapipe/tasks-vision`) executing on client WebAssembly (`wasm`) and WebGL (`/models/blaze_face_short_range.tflite`).
* **Dual-Device Protocol**: Lightweight HTTP polling and WebSockets/heartbeats for phone camera synchronization.

---

## 3. Who Does What: Role-Based Capabilities

```
+-----------------------------------------------------------------------------------+
|                                 MITAOE PREP PLATFORM                              |
+-----------------------------------------------------------------------------------+
                               |                                     |
               [ Student / Candidate Role ]           [ Faculty / Admin Role ]
                               |                                     |
              - Google Auth + PRN Whitelisting      - Test Series Management
              - Diagnostic Hardware Pre-flight      - Question Authoring & Sets
              - Phone Camera QR Pairing             - Eligibility Whitelist Upload
              - Timed Exam with OMR Navigation      - Live Proctoring Audit Table
              - Instant Autosave & Auto-Submit      - Real-Time Strike Monitoring
              - Scorecards & Answer Explanations    - Attempt Reset & Dispute Override
              - Series Leaderboard & Certificate    - Results Export (CSV / Excel)
```

### 1. Student / Candidate Workflow
1. **Google Login**: Candidate logs in using their Google account.
2. **Eligibility Verification**: The server verifies if their email or PRN exists in the uploaded institutional whitelist. Non-eligible students are rejected.
3. **Registration Completion**: If first-time login, students complete their profile (PRN, Full Name, Branch, Graduation Year).
4. **Diagnostic Pre-Flight Check**:
   - Screen resolution clearance (minimum width $\ge$ 1024px; mobile laptops/desktops required).
   - Fullscreen API permission test.
   - Primary laptop webcam access and AI face detection initialization.
   - Dual-Device Secondary Camera pairing via QR code.
5. **Rules & Integrity Agreement**: Displays exam rules, countdown window, strike limits, and negative marking rules.
6. **Live Examination**:
   - Multi-section questions with OMR bubble navigation.
   - Continuous timer countdown synchronized with the server's authoritative timestamp.
   - Real-time answer autosave upon every click.
   - Marked for review / Flagging capability.
7. **Instant Result & Review**:
   - Score calculation, sectional performance, time spent, and strike audit report.
   - Comprehensive question-by-question review with detailed explanations once the test window closes.
8. **Rankings & Certifications**:
   - Real-time series leaderboard rank.
   - Verifiable, downloadable placement certificate.

### 2. Faculty / Administrator Workflow
1. **Series Management**:
   - Create, edit, activate, pause, or archive multi-day placement test series (e.g. Day 1: Verbal, Day 2: Quant, Day 3: Logical, Day 4: Pseudo-code, Day 5: Advanced Coding).
2. **Question Bank Authoring**:
   - Import JSON question banks or manually compose questions with multiple sections, custom positive/negative marks, rich explanations, and options.
3. **Eligibility Management**:
   - Upload CSV/XLSX roster files containing allowed student emails, PRNs, and departments.
4. **Live Proctoring & Attempts Command Center**:
   - High-density administrative audit table with real-time status pills:
     - `Pairing / Rules` (amber): Student is pairing their phone or reviewing rules.
     - `In progress` (blue): Student actively answering questions.
     - `Submitted` (green): Completed and graded.
     - `Auto-submitted` (purple): Auto-submitted by server on timer expiry.
     - `Terminated` (red): Disqualified due to 3 proctoring strikes.
   - Filter pills (`All`, `With strikes`, `Terminated`, `Submitted`, etc.) and multi-column sorting (Score, Started At, Duration, Strikes, Name).
   - Deep-dive attempt proctoring audit log viewer displaying exact millisecond timestamps and violation types.
   - **Emergency Reset Action**: Allows faculty to reset an attempt if a student experienced an authentic power or hardware failure.
5. **Analytics & Leaderboard Publishing**:
   - Toggle leaderboard visibility.
   - One-click export of complete examination scores, strike breakdowns, and completion times to CSV/Excel for college placement records.

---

## 4. Deep-Dive Feature Breakdown

### A. Dual-Device AI Proctoring System
* **Laptop Camera (Primary)**:
  * Runs MediaPipe BlazeFace locally in client WebAssembly.
  * Checks for continuous human face presence every 500ms.
  * **Violations flagged**: Face not visible (looking away/left seat) or multiple faces detected (collusion).
  * **Zero Video Streaming**: Only metadata events (`face_absent`, `multiple_faces`) are logged. Video frames never leave the device.
* **Smartphone Camera (Secondary / Side-Profile)**:
  * Student scans a dynamic QR code on the rules screen using their phone.
  * The phone opens a lightweight proctoring page (`/proctor/pair/[attemptId]`) and activates its camera.
  * Emits continuous heartbeats to the server (`/api/proctor/heartbeat`) confirming the phone is active, upright, and monitoring the candidate's desk and keyboard angle.
  * If the phone disconnects or the tab is closed, the laptop displays an emergency reconnection overlay.

### B. Zero-Trust Anti-Cheat & Lockdown Engine
The examination screen (`/tests/[testId]/exam`) acts as a locked-down virtual kiosk:
* **HTML5 Fullscreen Enforcement**: Exiting fullscreen triggers an immediate warning dialog and registers a proctoring strike.
* **Window Blur / Tab Switch Interception**: Utilizing `document.visibilitychange` and `window.onblur`, switching tabs or minimizing the browser triggers an instant strike.
* **DevTools & Inspection Ban**: Intercepts `F12`, `Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+U`, and right-click context menus.
* **System Clipboard Interception**: `copy`, `cut`, and `paste` events are blocked across the entire exam window.
* **Three-Strike Rule**: Accumulating **3 strikes** results in immediate, irreversible disqualification: the exam is locked, submitted to the server, and flagged as `Terminated`.

### C. OMR Examination Interface
* **Physical Paper Aesthetic**: Clean, high-legibility layout with bubble selectors that mimic real TCS/Infosys OMR testing sheets.
* **Dynamic Palette**: Quick jump grid displaying question states:
  - Grey: Unvisited
  - White with border: Visited, unanswered
  - Blue: Answered & saved
  - Amber / Flagged: Marked for review
  - Purple: Answered & marked for review
* **Section Switching**: Supports multi-section tests (e.g. Quantitative Ability &rarr; Verbal Reasoning &rarr; Technical Coding) with sectional timers and rules.
* **Fail-Safe Autosave**: Every selection sends a lightweight background request to `/api/attempts/[attemptId]/answers`. If the student refreshes or experiences network jitter, their saved answers are restored instantly from the server.

---

## 5. Database Schema & Data Models

All data is stored in **Google Cloud Firestore**. Client access is blocked; interactions occur exclusively through server API routes using `firebase-admin`.

```
Firestore Root
├── users/                     # Student & Administrator profiles
│   └── {uid}
│       ├── email, prn, name, branch, graduationYear, role ("student" | "admin")
│
├── eligibility/               # Whitelisted candidate rosters
│   └── {prn}
│       ├── prn, email, name, branch, addedAt
│
├── series/                    # Placement series containers (e.g., "Infosys Preparation 2026")
│   └── {seriesId}
│       ├── title, company, description, status ("draft" | "active" | "archived")
│       └── totalTests, startDate, endDate
│
├── tests/                     # Individual timed examination papers
│   └── {testId}
│       ├── seriesId, title, durationMinutes, totalMarks, passingMarks
│       ├── windowStart, windowEnd, status ("scheduled" | "live" | "closed")
│       ├── proctoringConfig { requireCamera, requirePhone, maxStrikes }
│       └── sections: [ { id, name, durationMinutes, totalQuestions } ]
│
├── questions/                 # Question banks for each test
│   └── {questionId}
│       ├── testId, sectionId, questionNumber, prompt, codeSnippet
│       ├── options: [ { id, text } ]
│       ├── correctOptionId, marks, negativeMarks, explanation
│
└── attempts/                  # Individual student test sessions
    └── {attemptId}
        ├── testId, uid, prn, studentName, studentEmail
        ├── status ("awaiting_start" | "in_progress" | "submitted" | "auto_submitted" | "terminated")
        ├── startedAt, completedAt, durationSeconds
        ├── answers: { [questionId]: { selectedOptionId, answeredAt } }
        ├── score, correctCount, incorrectCount, unattemptedCount
        ├── strikesCount, terminationReason
        ├── phone: { pairedAt, lastBeatAt, deviceModel }
        └── proctor_logs: [
              { timestamp, eventType, details, strikeNumber }
            ]
```

---

## 6. Cloud Infrastructure & Hosting Strategy

The platform is designed to be completely **stateless**, enabling seamless migration across cloud providers without losing user data or test attempts.

For detailed pricing models, sizing benchmarks, and operational runbooks, refer to:
**[`CLOUD_ARCHITECTURE_AND_PRICING_GUIDE.md`](./CLOUD_ARCHITECTURE_AND_PRICING_GUIDE.md)**

### Phase 1: Google Cloud Run (Mumbai `asia-south1`)
* **Funded By**: ₹25,000 INR GCP Credit (70-day runway).
* **Cost to Institution**: **₹0 out of pocket**.
* **Auto-Scaling**: Runs 1 warm instance 24/7 for instant leaderboards and student logins, scaling up to 15+ container replicas during the 500-student test rush.
* **Networking**: Direct Hostinger domain mapping via Google Global Anycast IPs with automatic, free Google-managed SSL.

### Phase 2: AWS EC2 Graviton3 (Mumbai `ap-south-1`)
* **Funded By**: $100 USD AWS Credit (~5.2-month runway).
* **Cost to Institution**: **₹0 out of pocket**.
* **Dynamic-Resize Strategy**: Runs on an ultra-efficient `t4g.small` ($12/mo) 24/7, with a 60-second resize to `c7g.xlarge` (4 vCPU, 8 GB RAM) during active exam hours.

---

## 7. Environment Variables Reference

Create a `.env.local` file in the project root for local development:

```env
# -------------------------------------------------------------
# FIREBASE SERVER-SIDE ADMIN CREDENTIALS (Strictly Server-Only)
# -------------------------------------------------------------
FIREBASE_PROJECT_ID=mitaoe-prep-f89f9
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@mitaoe-prep-f89f9.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgk...=\n-----END PRIVATE KEY-----\n"

# -------------------------------------------------------------
# INSTITUTIONAL CONTROLS & TIMEZONE
# -------------------------------------------------------------
ADMIN_EMAILS=admin@mitaoe.ac.in,placement@mitaoe.ac.in
APP_TIMEZONE=Asia/Kolkata

# -------------------------------------------------------------
# FIREBASE CLIENT-SIDE CONFIGURATION (Publicly Accessible)
# -------------------------------------------------------------
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=mitaoe-prep-f89f9.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=mitaoe-prep-f89f9
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=mitaoe-prep-f89f9.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=255398771472
NEXT_PUBLIC_FIREBASE_APP_ID=1:255398771472:web:xxxxxxxxxxxxxx
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-R94VY3YD3Z
```

---

## 8. Local Development & Setup

### Prerequisites
- Node.js 20.x or higher
- npm 10.x or higher
- Valid Firebase Project with Firestore and Google Authentication enabled

### Installation Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/atharvabaodhankar/MITAOE-Prep.git
   cd MITAOE-Prep
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   ```bash
   cp .env.example .env.local
   # Fill in your Firebase Admin private key and client credentials
   ```

4. **Run Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Typecheck & Production Build**:
   ```bash
   npx tsc --noEmit
   npm run build
   ```

---

## 9. Directory Structure

```
MITAOE-Prep/
├── app/
│   ├── (admin)/admin/              # Faculty & Administrator portals
│   │   ├── series/                 # Placement series management
│   │   ├── tests/[testId]/         # Test questions, settings, eligibility
│   │   │   └── attempts/           # Live proctoring attempts & audit table
│   │   └── eligibility/            # Candidate whitelist CSV uploader
│   │
│   ├── (student)/                  # Student & Candidate portals
│   │   ├── dashboard/              # Student tests list & progress
│   │   ├── tests/[testId]/
│   │   │   ├── preflight/          # Diagnostic camera & resolution check
│   │   │   ├── rules/              # Rules agreement & Phone QR pairing
│   │   │   ├── exam/               # Fullscreen proctored OMR examination
│   │   │   └── result/             # Instant scorecard & solution review
│   │   └── leaderboard/            # Live institution-wide rankings
│   │
│   ├── (proctor)/proctor/pair/     # Secondary mobile camera streaming view
│   ├── api/                        # Server Route Handlers (Firebase Admin only)
│   │   ├── admin/                  # Admin-only mutations & exports
│   │   ├── attempts/               # Autosave answers & submit exam
│   │   └── proctor/                # Heartbeats & violation logging
│   └── globals.css                 # Tailwind CSS v4 design system
│
├── components/
│   ├── ui/                         # Clean, high-contrast OMR UI primitives
│   ├── proctor/                    # MediaPipe camera & face detector components
│   └── exam/                       # Question palette, timers, & options
│
├── lib/
│   ├── firebase-admin.ts           # Server-side Firebase Admin SDK singleton
│   ├── firebase-client.ts          # Client-side Firebase SDK singleton
│   ├── auth.ts                     # Session & role verification helpers
│   └── proctoring.ts               # Violation detection & strike rules
│
├── public/
│   └── models/                     # Self-hosted MediaPipe BlazeFace tflite & wasm
│
├── CLOUD_ARCHITECTURE_AND_PRICING_GUIDE.md  # Detailed GCP & AWS infrastructure guide
├── firestore.rules                 # Total lockdown security rules
└── package.json
```

---

## 10. Security & Integrity Guarantees

1. **Zero Client Trust**: All scoring, clock countdowns, and strike registrations occur on the server. A student cannot tamper with JavaScript on their machine to fake answers or add extra time.
2. **Authoritative Server Timer**: An attempt's expiration time is computed as `startedAt + durationMinutes` on the server. If a client attempts to submit late, the server marks the attempt as `auto_submitted` and ignores late answers.
3. **Privacy Compliance**: All video processing runs strictly inside the candidate's browser via WebAssembly. Neither the primary laptop webcam nor the secondary smartphone camera sends video feeds or photos to the cloud.
4. **Data Isolation**: Firestore database rules reject 100% of direct read and write requests from web clients. Only the backend Node.js server using a cryptographically verified Service Account can query or modify examination data.

---

## 11. License & Attribution

Developed for **MIT Academy of Engineering (MITAOE)** Placement and Training Cell.  
Engineered by Atharva Baodhankar. All rights reserved.
