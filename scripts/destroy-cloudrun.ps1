# Script to completely destroy Cloud Run services and images to achieve $0 cost
param(
    [switch]$Force
)

$PROJECT_ID = "test-prep-e4d7f"
$REGION = "asia-south1"
$REPO_NAME = "testprep"

if (-not $Force) {
    $confirm = Read-Host "Are you sure you want to DESTROY all Cloud Run backend services and images? (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

Write-Host "==> Deleting testprep-api Cloud Run service..." -ForegroundColor Yellow
gcloud run services delete testprep-api --region=$REGION --project=$PROJECT_ID --quiet 2>&1 | Out-Null

Write-Host "==> Deleting testprep-worker Cloud Run service..." -ForegroundColor Yellow
gcloud run services delete testprep-worker --region=$REGION --project=$PROJECT_ID --quiet 2>&1 | Out-Null

Write-Host "==> Cleaning up Artifact Registry images..." -ForegroundColor Yellow
gcloud artifacts repositories delete $REPO_NAME --location=$REGION --project=$PROJECT_ID --quiet 2>&1 | Out-Null

Write-Host "`nAll backend Cloud Run compute resources have been destroyed." -ForegroundColor Green
Write-Host "Your active compute cost is now $0.00." -ForegroundColor Green
Write-Host "To re-deploy at any time, simply run: .\scripts\deploy-cloudrun.ps1" -ForegroundColor Cyan
