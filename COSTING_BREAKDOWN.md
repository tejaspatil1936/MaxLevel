# MaxLevel (maxlevel.in) — Operational Cost & Infrastructure Budget

> **Project**: MaxLevel Multi-Tenant Examination & Proctoring Platform  
> **Prepared by**: Atharva Baodhankar & Tejas Patil  
> **Target Audience**: Department Leadership, Faculty Review Committee & Finance Cell  
> **Purpose**: Transparent breakdown of pure running infrastructure costs across different student batch sizes  

---

## 1. Cost Overview & Highlights

MaxLevel is engineered on an **event-driven, serverless cloud architecture** hosted in Google Cloud's Mumbai Region (`asia-south1`).

- **Zero Idle Waste**: When no exam is running (nights, weekends, holidays), running compute instances scale to 0, incurring **₹0.00** server fees.
- **Pay-Per-Exam Compute**: Costs are only incurred during active examination windows.
- **Massive Institutional Savings**: Commercial assessment platforms (such as Mercer Mettl, Wheebox, or HackerEarth) charge colleges **₹150 to ₹250 per student per test** (₹6,00,000+ per year for 1,000 students). MaxLevel operates at a fraction of that cost.

---

## 2. Granular Running Cost Breakdown (Monthly Active Use)

The table below illustrates the real operating costs under an intensive academic test month (**4 major placement / semester exams per month, 2 hours each = 8 full hours of concurrent examination traffic**).

*All figures are rounded realistically with buffer margins for network spikes, heavy proctoring, and retry requests.*

| Infrastructure Component | Description & Metrics | 1,000 Active Students | 2,000 Active Students | 5,000 Active Students |
| :--- | :--- | :---: | :---: | :---: |
| **Domain & DNS Security** | Annual `maxlevel.in` domain registration & DNS management (GoDaddy) amortized | ₹100 / mo | ₹100 / mo | ₹100 / mo |
| **Cloud Run API (`testprep-api`)** | Auto-scaling Fastify microservice (1 vCPU, 512MB RAM) handling live exam traffic & submissions | ₹350 / mo | ₹700 / mo | ₹1,750 / mo |
| **Cloud Run Worker (`testprep-worker`)** | Headless Chrome containers generating individual PDF grade cards & college Excel exports | ₹200 / mo | ₹400 / mo | ₹1,000 / mo |
| **Realtime Database (RTDB)** | WebSockets for live exam timer sync, heartbeat focus detection, and tab-switch proctoring logs | ₹750 / mo | ₹1,500 / mo | ₹3,750 / mo |
| **Firestore Database** | Structured document storage for test banks, student submissions, and question answers | ₹100 / mo | ₹200 / mo | ₹500 / mo |
| **Vertex AI (Gemini 2.5 Flash)** | Automated PDF question-bank parsing, OCR for diagrams, and LaTeX formula formatting | ₹250 / mo | ₹500 / mo | ₹1,200 / mo |
| **Cloud Storage & Registry** | Container image storage, student webcam verification snapshots, and report archives | ₹150 / mo | ₹300 / mo | ₹700 / mo |
| **Network Egress & Bandwidth** | Secure SSL data transfer between Google Cloud, Vercel Edge CDN, and student browsers | ₹300 / mo | ₹600 / mo | ₹1,500 / mo |
| **Vercel Edge Delivery & Security** | Global Next.js CDN, DDoS protection, edge caching, and SSL certificates | ₹300 / mo | ₹600 / mo | ₹1,500 / mo |
| **Infrastructure Buffer & Contingency** | Safety margin for high-concurrency re-attempts and network retries | ₹400 / mo | ₹600 / mo | ₹1,000 / mo |
| **TOTAL ESTIMATED MONTHLY COST** | **Active examination month (4 full tests)** | **₹2,900 / mo** | **₹5,500 / mo** | **₹13,000 / mo** |

---

## 3. Projected Annual Budget Summary

In a standard academic year, colleges conduct major placement mock tests, aptitude drives, and internal semester examinations across approximately **8 to 9 active months** (accounting for vacations).

| Metric | 1,000 Students | 2,000 Students | 5,000 Students (Entire Campus) |
| :--- | :---: | :---: | :---: |
| **Annual Domain & SSL** | ₹1,000 | ₹1,000 | ₹1,000 |
| **Active Exam Months (9 Months)** | ₹26,100 | ₹49,500 | ₹1,17,000 |
| **Low-Activity / Vacation Months (3 Mo)** | ₹1,500 | ₹1,500 | ₹2,500 |
| **Emergency Infrastructure Headroom (10%)** | ₹2,900 | ₹5,200 | ₹12,100 |
| **TOTAL PROJECTED ANNUAL RUNNING COST** | **₹31,500 / year** | **₹57,200 / year** | **₹1,32,600 / year** |
| **Cost Per Student (Per Year)** | **~₹31 / student** | **~₹28 / student** | **~₹26 / student** |

---

## 4. Institutional Cost Comparison (Why MaxLevel is Highly Viable)

| Feature / Model | Commercial Vendor (Mettl / CoCubes) | MaxLevel In-House Platform |
| :--- | :--- | :--- |
| **Pricing Model** | Per-Student, Per-Exam Fee (₹150 – ₹250 / test) | Flat Infrastructure Running Cost |
| **Annual Cost (for 1,000 Students, 4 tests)** | **₹6,00,000 – ₹10,00,000 / year** | **~₹31,500 / year** |
| **Data Privacy & Ownership** | Stored on third-party commercial servers | Stored strictly in the college's secure cloud database |
| **AI Integration** | None or expensive add-on | Native Gemini 2.5 Flash question extraction included |
| **Customization** | Standard rigid interface | Custom college branding, roll numbers, and grading |
| **College Savings** | ₹0 | **Over 90% cost reduction** |

---

## 5. Formal Funding Recommendation

To maintain uninterrupted uptime, cover all Google Cloud and network infrastructure fees, and ensure continuous technical maintenance across the academic year, the proposed allocation is:

- **Option A (Department / Placement Cell Pilot — 1,000 Students)**: **₹35,000 to ₹40,000 / year**
- **Option B (Multi-Department / Full Batch Deployment — 2,000 Students)**: **₹65,000 to ₹75,000 / year**
- **Option C (Campus-Wide Unlimited License — Up to 5,000 Students)**: **₹1,40,000 to ₹1,50,000 / year** *(includes dedicated engineering maintenance buffer)*

---

*Document compiled by the MaxLevel Technical Team for institutional evaluation.*
