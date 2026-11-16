# Uploads only the Harmonized variables files that differ from the bucket (by MD5), for slow or metered connections.
# Run after install_site_data() in the survey harmonization project:
#   powershell -ExecutionPolicy Bypass -File deploy_harmonized_changed.ps1 [-DryRun]
# Same bucket, cache and gcloud settings as deploy_data.ps1. index.json.gz goes last, so the site never points at a file
# that is not there yet. Files on the bucket that the build no longer makes are left in place (nothing points at them).
param([switch]$DryRun)
$bucket = "gs://survey-data-509608"
$root = Join-Path $PSScriptRoot "site\data\harmonized"
$env:CLOUDSDK_STORAGE_PROCESS_COUNT = "1"
$env:CLOUDSDK_STORAGE_THREAD_COUNT = "8"
$env:CLOUDSDK_CORE_DISABLE_PROMPTS = "1"

$remote = @{}
gcloud storage objects list "$bucket/data/harmonized/**" --format="csv[no-heading](name,md5_hash)" | ForEach-Object {
  $p = $_ -split ","
  $remote[$p[0]] = $p[1]
}
if ($LASTEXITCODE -ne 0) { throw "gcloud listing failed ($LASTEXITCODE)" }

$md5 = [System.Security.Cryptography.MD5]::Create()
$changed = @(Get-ChildItem $root -Recurse -File | Where-Object {
  $rel = "data/harmonized/" + $_.FullName.Substring($root.Length + 1).Replace("\", "/")
  $remote[$rel] -ne [Convert]::ToBase64String($md5.ComputeHash([IO.File]::ReadAllBytes($_.FullName)))
})
$bytes = ($changed | Measure-Object -Property Length -Sum).Sum
Write-Host ("{0} of {1} files differ from the bucket ({2:N1} MB)" -f $changed.Count, (Get-ChildItem $root -Recurse -File).Count, ($bytes / 1MB))
if ($DryRun -or -not $changed.Count) { return }

$index = $changed | Where-Object { $_.Name -eq "index.json.gz" -and $_.DirectoryName -eq $root }
$groups = $changed | Where-Object { $_ -notin $index } | Group-Object DirectoryName
foreach ($g in $groups) {
  $dir = $g.Name.Substring($root.Length).TrimStart("\").Replace("\", "/")
  $dest = if ($dir) { "$bucket/data/harmonized/$dir/" } else { "$bucket/data/harmonized/" }
  $g.Group.FullName | gcloud storage cp -I $dest --cache-control="public, max-age=300"
  if ($LASTEXITCODE -ne 0) { throw "upload to $dest failed ($LASTEXITCODE)" }
}
if ($index) {
  gcloud storage cp $index.FullName "$bucket/data/harmonized/" --cache-control="public, max-age=300"
  if ($LASTEXITCODE -ne 0) { throw "upload of index.json.gz failed ($LASTEXITCODE)" }
}
Write-Host "Uploaded $($changed.Count) files to $bucket/data/harmonized"
