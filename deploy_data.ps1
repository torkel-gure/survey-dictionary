# Uploads the built data (site/data) to the GCS bucket that the website reads from.
# Run after build_data.R:   powershell -ExecutionPolicy Bypass -File deploy_data.ps1
# (gcloud prints progress on stderr, so check exit codes rather than using ErrorActionPreference=Stop)
$bucket = "gs://survey-data-509608"
$data = Join-Path $PSScriptRoot "site\data"
# gcloud's multi-process uploads (and `storage rsync`) hang on this machine: use cp with one process, several threads
$env:CLOUDSDK_STORAGE_PROCESS_COUNT = "1"
$env:CLOUDSDK_STORAGE_THREAD_COUNT = "8"
$env:CLOUDSDK_CORE_DISABLE_PROMPTS = "1"

function Invoke-Gcloud { gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args -join ' ') failed ($LASTEXITCODE)" } }

Push-Location $data
try {
  # shards first, then the index + meta, so visitors never get an index that points at missing shards
  Invoke-Gcloud storage cp -r q "$bucket/data/"
  Invoke-Gcloud storage cp index.json.gz "$bucket/data/"
  # meta.json.gz carries the build stamp that versions every other file, so it must never be cached
  Invoke-Gcloud storage cp meta.json.gz "$bucket/data/" --cache-control=no-cache
} finally { Pop-Location }
Write-Host "Data uploaded to $bucket/data"
