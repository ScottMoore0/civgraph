param(
  [string]$PhaseList = '4:2:A,B;8:2:C,D,E,F;16:4:G,H,I,J;24:4:K,L,M,N,O,P',
  [int]$RecordsPerWorker = 50,
  [string]$OutDir = 'tmp/proni-crawl'
)

$ErrorActionPreference = 'Stop'
$ScriptPath = Join-Path $PSScriptRoot 'proni-browse-crawl-throttle.ps1'
if (-not (Test-Path $ScriptPath)) { throw "Missing $ScriptPath" }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

function Get-LatestSummaryAfter([datetime]$After, [int]$WorkerPid) {
  Get-ChildItem -Path $OutDir -Filter "throttle-summary-*-pid$WorkerPid.json" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $After } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

$phaseResults = @()
foreach ($phase in ($PhaseList -split ';' | Where-Object { $_.Trim() })) {
  $parts = $phase.Split(':')
  if ($parts.Count -ne 3) { throw "Invalid phase: $phase" }
  $targetTotal = [double]::Parse($parts[0], [Globalization.CultureInfo]::InvariantCulture)
  $perWorker = [double]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture)
  $letters = @($parts[2].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if (-not $letters.Count) { continue }

  $started = Get-Date
  $jobs = @()
  foreach ($letter in $letters) {
    $jobs += Start-Job -ArgumentList $ScriptPath,$perWorker,$RecordsPerWorker,$OutDir,$letter -ScriptBlock {
      param($ScriptPath,$PerWorker,$RecordsPerWorker,$OutDir,$Letter)
      powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath -StepList ([string]$PerWorker) -StepRecords $RecordsPerWorker -MaxRecords $RecordsPerWorker -Letters $Letter -OutDir $OutDir
    }
  }

  Wait-Job -Job $jobs | Out-Null
  $rawOutputs = @()
  $jobErrors = @()
  foreach ($job in $jobs) {
    $rawOutputs += @(Receive-Job -Job $job -ErrorAction SilentlyContinue -ErrorVariable receivedErrors)
    if ($receivedErrors) { $jobErrors += @($receivedErrors) }
  }
  $childPids = @()
  foreach ($line in $rawOutputs) {
    if ($line -match 'pid(\d+)\.json') { $childPids += [int]$Matches[1] }
  }
  $summaries = @()
  foreach ($pidValue in ($childPids | Select-Object -Unique)) {
    $file = Get-LatestSummaryAfter $started $pidValue
    if ($file) {
      $summaries += Get-Content $file.FullName | ConvertFrom-Json
    }
  }
  Remove-Job -Job $jobs -Force

  $workerSummaries = @($summaries | ForEach-Object { $_.Summaries } | Where-Object { $_ })
  $records = [int](($workerSummaries | Measure-Object Records -Sum).Sum)
  $failures = [int](($workerSummaries | Measure-Object Failures -Sum).Sum)
  $duration = if ($workerSummaries.Count) { [double](($workerSummaries | Measure-Object DurationSeconds -Maximum).Maximum) } else { 0 }
  $actual = if ($duration -gt 0) { $records / $duration } else { 0 }
  $p95 = if ($workerSummaries.Count) { [double](($workerSummaries | Measure-Object P95Ms -Maximum).Maximum) } else { 0 }
  $max = if ($workerSummaries.Count) { [double](($workerSummaries | Measure-Object MaxMs -Maximum).Maximum) } else { 0 }
  $stopped = @($workerSummaries | Where-Object { $_.Stopped -or $_.Failures -gt 0 }).Count
  $result = [pscustomobject]@{
    Phase=$phase
    TargetTotalRps=$targetTotal
    PerWorkerRps=$perWorker
    Workers=$letters.Count
    Letters=($letters -join ',')
    Records=$records
    Failures=$failures
    FailureRate=if ($records) { [Math]::Round($failures / $records, 6) } else { 0 }
    ActualRps=[Math]::Round($actual, 4)
    MaxWorkerDurationSeconds=[Math]::Round($duration, 3)
    MaxP95Ms=[Math]::Round($p95, 3)
    MaxMs=[Math]::Round($max, 3)
    StoppedWorkers=$stopped
    JobErrors=@($jobErrors | ForEach-Object { $_.ToString() })
    WorkerSummaries=$workerSummaries
  }
  $phaseResults += $result
  $result | ConvertTo-Json -Depth 8 -Compress
  if ($failures -gt 0 -or $stopped -gt 0 -or $p95 -gt 5000) { break }
  Start-Sleep -Seconds 2
}

$stamp = "$(Get-Date -Format 'yyyy-MM-ddTHH-mm-ss-fffZ')-pid$PID"
$summaryPath = Join-Path $OutDir "parallel-throttle-summary-$stamp.json"
[pscustomobject]@{
  At=(Get-Date).ToUniversalTime().ToString('o')
  PhaseList=$PhaseList
  RecordsPerWorker=$RecordsPerWorker
  Results=$phaseResults
} | ConvertTo-Json -Depth 20 | Set-Content -Path $summaryPath -Encoding UTF8
"PARALLEL_SUMMARY_FILE $summaryPath"
