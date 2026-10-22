# Deployment script for Google Cloud Run (test-prep-e4d7f)
$ErrorActionPreference = "Continue"

$PROJECT_ID = "test-prep-e4d7f"
$REGION = "asia-south1"
$REPO_NAME = "testprep"
$GCLOUD = "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"

Write-Host "==> Ensuring required Google Cloud APIs are enabled..." -ForegroundColor Cyan
& $GCLOUD services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com cloudbuild.googleapis.com --project $PROJECT_ID

Write-Host "==> Checking Artifact Registry..." -ForegroundColor Cyan
$repoCheck = & $GCLOUD artifacts repositories describe $REPO_NAME --location=$REGION --project=$PROJECT_ID 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating Docker repository '$REPO_NAME' in $REGION..." -ForegroundColor Yellow
    & $GCLOUD artifacts repositories create $REPO_NAME --repository-format=docker --location=$REGION --project=$PROJECT_ID
}

Write-Host "==> Ensuring EXPORT_LINK_SECRET secret exists..." -ForegroundColor Cyan
$secretCheck = & $GCLOUD secrets describe export-link-secret --project=$PROJECT_ID 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating export-link-secret..." -ForegroundColor Yellow
    $secretValue = [System.Guid]::NewGuid().ToString("N") + [System.Guid]::NewGuid().ToString("N")
    $secretValue | & $GCLOUD secrets create export-link-secret --data-file=- --project=$PROJECT_ID
}

# Ensure compute service account can read secrets
$projectNumber = (& $GCLOUD projects describe $PROJECT_ID --format="value(projectNumber)").Trim()
& $GCLOUD projects add-iam-policy-binding $PROJECT_ID `
    --member="serviceAccount:$projectNumber-compute@developer.gserviceaccount.com" `
    --role="roles/secretmanager.secretAccessor" --quiet 2>&1 | Out-Null

$IMAGE_TAG_API = "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/api:latest"
$IMAGE_TAG_WORKER = "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/worker:latest"

Write-Host "==> Building Worker image with Cloud Build..." -ForegroundColor Cyan
& $GCLOUD builds submit --config=cloudbuild-worker.yaml --project=$PROJECT_ID

Write-Host "==> Deploying Worker to Cloud Run..." -ForegroundColor Cyan
& $GCLOUD run deploy testprep-worker `
    --image=$IMAGE_TAG_WORKER `
    --region=$REGION `
    --platform=managed `
    --allow-unauthenticated `
    --min-instances=0 `
    --max-instances=5 `
    --memory=1Gi `
    --cpu=1 `
    --port=4001 `
    --set-env-vars="NODE_ENV=development,HOST=0.0.0.0,GCLOUD_PROJECT=$PROJECT_ID,LLM_PROVIDER=vertex,GOOGLE_VERTEX_PROJECT=$PROJECT_ID,GOOGLE_VERTEX_LOCATION=$REGION,LLM_MODEL=gemini-2.5-flash,FIREBASE_DATABASE_URL=https://$PROJECT_ID-default-rtdb.firebaseio.com,FIREBASE_STORAGE_BUCKET=test-prep-e4d7f-storage" `
    --project=$PROJECT_ID

$workerUrl = (& $GCLOUD run services describe testprep-worker --region=$REGION --project=$PROJECT_ID --format="value(status.url)").Trim()
Write-Host "Worker deployed at: $workerUrl" -ForegroundColor Green

Write-Host "==> Building API image with Cloud Build..." -ForegroundColor Cyan
& $GCLOUD builds submit --config=cloudbuild-api.yaml --project=$PROJECT_ID

Write-Host "==> Deploying API to Cloud Run..." -ForegroundColor Cyan
& $GCLOUD run deploy testprep-api `
    --image=$IMAGE_TAG_API `
    --region=$REGION `
    --platform=managed `
    --allow-unauthenticated `
    --min-instances=0 `
    --max-instances=10 `
    --memory=512Mi `
    --cpu=1 `
    --port=4000 `
    --env-vars-file=api-env.yaml `
    --set-secrets="EXPORT_LINK_SECRET=export-link-secret:latest" `
    --project=$PROJECT_ID

$apiUrl = (& $GCLOUD run services describe testprep-api --region=$REGION --project=$PROJECT_ID --format="value(status.url)").Trim()

Write-Host "`n=======================================================" -ForegroundColor Green
Write-Host "SUCCESS! Your backend services are live:" -ForegroundColor Green
Write-Host "API URL:    $apiUrl" -ForegroundColor Yellow
Write-Host "Worker URL: $workerUrl" -ForegroundColor Yellow
Write-Host "=======================================================" -ForegroundColor Green
