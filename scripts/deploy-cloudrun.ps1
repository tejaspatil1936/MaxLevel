# Deployment script for Google Cloud Run (test-prep-e4d7f)
$ErrorActionPreference = "Stop"

$PROJECT_ID = "test-prep-e4d7f"
$REGION = "asia-south1"
$REPO_NAME = "testprep"

Write-Host "==> Ensuring required Google Cloud APIs are enabled..." -ForegroundColor Cyan
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com --project $PROJECT_ID

Write-Host "==> Checking Artifact Registry..." -ForegroundColor Cyan
$repoCheck = gcloud artifacts repositories describe $REPO_NAME --location=$REGION --project=$PROJECT_ID 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating Docker repository '$REPO_NAME' in $REGION..." -ForegroundColor Yellow
    gcloud artifacts repositories create $REPO_NAME --repository-format=docker --location=$REGION --project=$PROJECT_ID
}

Write-Host "==> Ensuring EXPORT_LINK_SECRET secret exists..." -ForegroundColor Cyan
$secretCheck = gcloud secrets describe export-link-secret --project=$PROJECT_ID 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating export-link-secret..." -ForegroundColor Yellow
    $secretValue = [System.Guid]::NewGuid().ToString("N") + [System.Guid]::NewGuid().ToString("N")
    $secretValue | gcloud secrets create export-link-secret --data-file=- --project=$PROJECT_ID
}

$IMAGE_TAG_API = "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/api:latest"
$IMAGE_TAG_WORKER = "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/worker:latest"

Write-Host "==> Building and pushing Worker image..." -ForegroundColor Cyan
docker build -t $IMAGE_TAG_WORKER -f apps/worker/Dockerfile .
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
docker push $IMAGE_TAG_WORKER

Write-Host "==> Deploying Worker to Cloud Run..." -ForegroundColor Cyan
gcloud run deploy testprep-worker `
    --image=$IMAGE_TAG_WORKER `
    --region=$REGION `
    --platform=managed `
    --allow-unauthenticated `
    --min-instances=0 `
    --max-instances=5 `
    --memory=1Gi `
    --cpu=1 `
    --set-env-vars="NODE_ENV=production,PORT=4001,HOST=0.0.0.0,GCLOUD_PROJECT=$PROJECT_ID,LLM_PROVIDER=vertex,GOOGLE_VERTEX_PROJECT=$PROJECT_ID,GOOGLE_VERTEX_LOCATION=$REGION,LLM_MODEL=gemini-2.0-flash,FIREBASE_DATABASE_URL=https://$PROJECT_ID-default-rtdb.firebaseio.com,FIREBASE_STORAGE_BUCKET=$PROJECT_ID.firebasestorage.app" `
    --project=$PROJECT_ID

$workerUrl = (gcloud run services describe testprep-worker --region=$REGION --project=$PROJECT_ID --format="value(status.url)").Trim()
Write-Host "Worker deployed at: $workerUrl" -ForegroundColor Green

Write-Host "==> Building and pushing API image..." -ForegroundColor Cyan
docker build -t $IMAGE_TAG_API -f apps/api/Dockerfile .
docker push $IMAGE_TAG_API

Write-Host "==> Deploying API to Cloud Run..." -ForegroundColor Cyan
gcloud run deploy testprep-api `
    --image=$IMAGE_TAG_API `
    --region=$REGION `
    --platform=managed `
    --allow-unauthenticated `
    --min-instances=0 `
    --max-instances=10 `
    --memory=512Mi `
    --cpu=1 `
    --set-env-vars="NODE_ENV=production,PORT=4000,HOST=0.0.0.0,GCLOUD_PROJECT=$PROJECT_ID,APP_ORIGINS=https://maxlevel.in,https://www.maxlevel.in,TASK_QUEUE=local,WORKER_URL=$workerUrl,FIREBASE_DATABASE_URL=https://$PROJECT_ID-default-rtdb.firebaseio.com,FIREBASE_STORAGE_BUCKET=$PROJECT_ID.firebasestorage.app" `
    --set-secrets="EXPORT_LINK_SECRET=export-link-secret:latest" `
    --project=$PROJECT_ID

$apiUrl = (gcloud run services describe testprep-api --region=$REGION --project=$PROJECT_ID --format="value(status.url)").Trim()

Write-Host "`n=======================================================" -ForegroundColor Green
Write-Host "SUCCESS! Your backend services are live:" -ForegroundColor Green
Write-Host "API URL:    $apiUrl" -ForegroundColor Yellow
Write-Host "Worker URL: $workerUrl" -ForegroundColor Yellow
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "To link custom domain api.maxlevel.in, run:" -ForegroundColor Cyan
Write-Host "gcloud beta run domain-mappings create --service testprep-api --domain api.maxlevel.in --region $REGION" -ForegroundColor White
