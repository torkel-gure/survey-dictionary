# Uploads the built data (site/data) to the GCS bucket that the website reads from.
# Run after build_data.R:   powershell -ExecutionPolicy Bypass -File deploy_data.ps1
$ErrorActionPreference = "Stop"
$bucket = "gs://survey-data-509608"
$data = Join-Path $PSScriptRoot "site\data"

gcloud storage rsync $data "$bucket/data" --recursive --delete-unmatched-destination-objects
# meta.json.gz carries the build stamp that versions every other file, so it must never be cached
gcloud storage objects update "$bucket/data/meta.json.gz" --cache-control="no-cache"
Write-Host "Data uploaded to $bucket/data"
