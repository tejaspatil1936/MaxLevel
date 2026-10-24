# Deployment & Operations Runbook: MaxLevel (`maxlevel.in`)

This document contains instructions to deploy, update, configure custom domains, and destroy your infrastructure for **$0 cost** when not in use.

---

## 🏗️ Architecture Overview

| Layer | Service | Platform | Cost When Idle |
| :--- | :--- | :--- | :--- |
| **Frontend** | `apps/web` (Next.js Static Export) | **Vercel** (`maxlevel.in`) | **$0.00** (Free Tier) |
| **Backend API** | `apps/api` (Fastify Server) | **Google Cloud Run** (`api.maxlevel.in`) | **$0.00** (Scales to 0 instances) |
| **Worker Engine** | `apps/worker` (Chromium & AI) | **Google Cloud Run** | **$0.00** (Scales to 0 instances) |
| **Database & Auth**| Firestore, RTDB, Auth, Storage | **Firebase** (`test-prep-e4d7f`) | Free tier / Pay as you go |

---

## 🚀 1. Deploying the Backend (Cloud Run)

Whenever you want to deploy the backend services for the first time or after making code changes:

Open PowerShell in the project root and run:
```powershell
.\scripts\deploy-cloudrun.ps1
```

### What this script handles automatically:
1. Enables necessary Google Cloud APIs (`run.googleapis.com`, `artifactregistry.googleapis.com`, `secretmanager.googleapis.com`, `aiplatform.googleapis.com`).
2. Creates the Artifact Registry repository `testprep` in `asia-south1`.
3. Creates the secret `export-link-secret` in Secret Manager.
4. Builds and pushes the Worker Docker container and deploys `testprep-worker`.
5. Builds and pushes the API Docker container and deploys `testprep-api` with CORS configured for `https://maxlevel.in`.
6. Outputs the live URLs.

---

## 🌐 2. Custom Domain Setup (`maxlevel.in`)

### Step 2.1: GoDaddy DNS Records
Log into GoDaddy DNS management for `maxlevel.in` and add:

| Type | Name / Host | Points to / Value | Purpose |
| :--- | :--- | :--- | :--- |
| **A** | `@` | `76.76.21.21` | Points `maxlevel.in` to Vercel |
| **CNAME** | `www` | `cname.vercel-dns.com` | Points `www.maxlevel.in` to Vercel |
| **CNAME** | `api` | `ghs.googlehosted.com` | Points `api.maxlevel.in` to Cloud Run |
| **CNAME** | `auth` | `test-prep-e4d7f.web.app` | Points `auth.maxlevel.in` to Firebase Hosting (Auth popup handler) |

### Step 2.2: Map `api.maxlevel.in` in Google Cloud
Run this command in PowerShell:
```powershell
gcloud beta run domain-mappings create --service testprep-api --domain api.maxlevel.in --region asia-south1
```
*Note: If GoDaddy requires a specific DNS verification TXT record, the above command will print it.*

### Step 2.3: Authorize Domain in Firebase
1. Open [Firebase Console -> Authentication -> Settings](https://console.firebase.google.com/project/test-prep-e4d7f/authentication/settings).
2. Under **Authorized Domains**, ensure the following are present:
   - `maxlevel.in`
   - `www.maxlevel.in`
   - `auth.maxlevel.in`

---

## ⚡ 3. Deploying the Frontend (Vercel)

1. Open [Vercel](https://vercel.com) and import the repository.
2. In Project Settings:
   - **Root Directory**: `apps/web`
   - **Framework Preset**: `Next.js`
   - **Output Directory**: Leave as default (`.next`) — do **not** override to `out`.
3. Add Environment Variables:
   - `NEXT_PUBLIC_API_URL` = `https://api.maxlevel.in`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID` = `test-prep-e4d7f`
   - `NEXT_PUBLIC_FIREBASE_API_KEY` = `AIzaSyAuV33S7ub9yYfTXhL93ZysMFSHzybx3Pk`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` = `auth.maxlevel.in`
   - `NEXT_PUBLIC_FIREBASE_DATABASE_URL` = `https://test-prep-e4d7f-default-rtdb.asia-southeast1.firebasedatabase.app`
   - `NEXT_PUBLIC_ACCESSIBILITY_EMAIL` = `admin@mitaoe.ac.in`
4. Under **Settings -> Domains**, add `maxlevel.in`.

---

## 🔄 4. What Happens When You Update Code?

- **Frontend updates**: Just run `git push origin main`. Vercel automatically rebuilds and updates the live site in under 60 seconds with zero downtime.
- **Backend updates**: Modify your code, then run:
  ```powershell
  .\scripts\deploy-cloudrun.ps1
  ```
  Cloud Run performs a rolling update (starts new container, health-checks it, switches traffic, stops old container) with zero downtime.

---

## 💥 5. Destroying Infrastructure ($0 Cost Guarantee)

If you have finished testing, concluded an exam season, or want to guarantee **zero compute billing**:

```powershell
.\scripts\destroy-cloudrun.ps1
```

### What this does:
- Deletes the `testprep-api` Cloud Run service.
- Deletes the `testprep-worker` Cloud Run service.
- Deletes all built container images from Artifact Registry.
- Your compute cost immediately drops to **$0.00**.

Whenever you want the platform back online, simply run `.\scripts\deploy-cloudrun.ps1` again.
