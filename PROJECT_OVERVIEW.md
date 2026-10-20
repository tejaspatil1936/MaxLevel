# MaxLevel (maxlevel.in) — Technical & Project Executive Summary

> **Live Web Application**: [https://maxlevel.in](https://maxlevel.in)  
> **Backend Infrastructure**: Google Cloud Platform (Mumbai Region — `asia-south1`)  
> **Prepared For**: Academic Review, Faculty Mentors & Department Leadership  

---

## 1. Executive Summary

**MaxLevel** is a modern, high-concurrency examination, campus placement prep, and proctored assessment platform built specifically for colleges and academic institutions. 

Unlike traditional LMS tools that struggle under sudden traffic spikes (such as when hundreds of students begin an exam simultaneously), MaxLevel uses an **event-driven, serverless architecture** that automatically scales to handle thousands of concurrent test-takers while costing **$0.00 to run when idle**.

---

## 2. Core Capabilities & Key Features

### A. For Students (Exam Experience)
- **Zero-Friction Sign-In**: Instant login with official college Google accounts.
- **Distraction-Free Test Interface**: Fast, responsive question viewer with math formulas (LaTeX / KaTeX), code snippets, and diagrams.
- **Auto-Save & Network Resilience**: Answers are saved after every selection. If a student's Wi-Fi drops or laptop reboots, they can re-open the browser and continue right where they left off without losing a single second or answer.
- **Live Proctoring & Integrity Checks**:
  - Fullscreen enforcement and tab-switch detection.
  - Periodic focus tracking and activity timestamps recorded in real time.
- **Instant Result Analytics**: Detailed breakdown of accuracy, time spent per question, topic strengths, and weaknesses.

### B. For Faculty & College Placement Cells (Admin Dashboard)
- **Multi-Tenant Architecture**: Each college or department operates in its own isolated workspace.
- **AI-Powered Question Generation & PDF Import**:
  - Upload textbook PDFs, question banks, or notes.
  - Integrated with **Google Cloud Vertex AI (Gemini 2.5 Flash)** to automatically extract questions, options, correct answers, and explanations in seconds.
- **Student Whitelist Management**: Restrict exams only to verified roll numbers or student email IDs.
- **Real-Time Proctoring Dashboard**: Faculty can watch student progress, online/offline status, and tab-switch warnings live as the exam is happening.
- **1-Click Exporting**:
  - Download official Grade Cards in PDF format.
  - Export class-wide result spreadsheets (.xlsx) for placement records.

---

## 3. Capacity & Concurrent User Load

The platform is designed to effortlessly scale across entire batches of students simultaneously:

| Metric | Capacity | Practical Explanation |
| :--- | :--- | :--- |
| **Simultaneous Exam Takers** | **1,500 to 3,000+ Students** | Entire departments or multiple college batches can take an exam at the exact same moment. |
| **Peak Throughput** | **800+ requests per second** | Handled by auto-scaling API containers with response times under 50ms. |
| **Realtime Monitoring Connections** | **200,000 active devices** | Handled by Google Firebase Realtime WebSockets for zero-lag timer synchronization and proctoring logs. |
| **Theoretical Maximum** | **50,000+ Students** | Cloud Run can scale up to 1,000 container instances across India without requiring code redesign. |

---

## 4. Costing & Cloud Architecture

One of the largest achievements of MaxLevel is **cost efficiency**. Traditional cloud servers (AWS EC2, digital machines) charge 24 hours a day, 7 days a week, even during vacations or at night when nobody is using them.

MaxLevel utilizes **Serverless Scale-to-Zero**:

### Cost Breakdown:
1. **Idle Time (No Exams Active)**: **₹0.00 / month ($0.00)**  
   - When no tests are ongoing, all compute containers shut down completely. There are zero idle hourly server fees.
2. **During an Exam Drive (e.g., 1,000 students taking a 2-hour test)**:
   - Compute & Data transfer: **~₹15 to ₹40 total for the entire exam**.
3. **Current Funding**:
   - The project is fully provisioned on Google Cloud Platform with **₹28,793+ in active trial credits**, meaning the platform can run hundreds of full-scale college exams over the coming months with **zero out-of-pocket expenses**.

---

## 5. Technology Stack & Security

- **Frontend Application**: Next.js 16 (React 19) hosted globally on Vercel Edge CDN for instant page loads.
- **Backend API**: Node.js 24 + Fastify hosted on Google Cloud Run (Mumbai Region) for ultra-low latency in India.
- **Background Worker**: Dedicated container running Headless Chromium for PDF rendering and large spreadsheet processing.
- **Database & Realtime Layer**: Google Cloud Firestore & Firebase Realtime Database.
- **Artificial Intelligence**: Google Vertex AI (`gemini-2.5-flash`).
- **Security & Data Privacy**:
  - End-to-end HTTPS/TLS encryption.
  - Strict Content Security Policies (CSP) preventing script injections.
  - Role-Based Access Control (SuperAdmin, College Admin, Student).
  - API secrets managed through **Google Secret Manager**.

---

## 6. Live Project Links & Quick Access

- **Public Production Web App**: [https://maxlevel.in](https://maxlevel.in)
- **Alternative Access**: [https://www.maxlevel.in](https://www.maxlevel.in)
- **Cloud Backend Endpoint**: [https://testprep-api-xj4srdjhbq-el.a.run.app](https://testprep-api-xj4srdjhbq-el.a.run.app)
- **Source Code Repository**: [https://github.com/tejaspatil1936/MaxLevel](https://github.com/tejaspatil1936/MaxLevel)

---
*Created by Atharva Baodhankar & Tejas Patil (MaxLevel Team).*
