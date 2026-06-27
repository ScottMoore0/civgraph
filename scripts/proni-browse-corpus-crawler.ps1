param(
  [ValidateSet('Index','Fetch','Both','Quick')]
  [string]$Mode = 'Both',
  [ValidateSet('PowerShell','HttpClient')]
  [string]$Client = 'HttpClient',
  [ValidateSet('Branch','Page','Record')]
  [string]$QueueGranularity = 'Page',
  [string[]]$Letters = @('A'),
  [switch]$AllLetters,
  [string]$BranchPathCsv = '',
  [int]$MaxBranches = 25,
  [int]$MaxRecords = 100,
  [int]$MaxPagesPerBranch = 50,
  [int]$Workers = 1,
  [double]$GlobalRps = 1.0,
  [double]$WorkerRps = 1.0,
  [int]$TimeoutSec = 20,
  [int]$BackoffSeconds = 20,
  [int]$MaxRetries = 2,
  [switch]$StopOnMismatch,
  [switch]$StopOnBlocked,
  [switch]$Resume,
  [object]$UsePageSnapshots = $true,
  [object]$FetchFromSnapshots = $true,
  [object]$ShardWorkerOutputs = $true,
  [switch]$WorkerMode,
  [int]$WorkerId = 0,
  [string]$QueuePath = '',
  [string]$IndexPath = '',
  [string]$SnapshotDir = '',
  [string]$OutDir = 'tmp/proni-corpus-crawl',
  [string]$UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148 Safari/537.36'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$GlobalRpsWasProvided = $PSBoundParameters.ContainsKey('GlobalRps')
$WorkerRpsWasProvided = $PSBoundParameters.ContainsKey('WorkerRps')

function ConvertTo-BooleanFlag($Value, [bool]$Default = $false) {
  if ($null -eq $Value) { return $Default }
  if ($Value -is [bool]) { return [bool]$Value }
  if ($Value -is [int] -or $Value -is [long] -or $Value -is [double]) { return ([double]$Value) -ne 0 }
  $text = ([string]$Value).Trim()
  if (-not $text) { return $Default }
  if ($text -match '^(1|true|t|yes|y|on)$') { return $true }
  if ($text -match '^(0|false|f|no|n|off)$') { return $false }
  return $Default
}

$Base = 'https://apps.proni.gov.uk/eCatNI_IE/'
$ScriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
$OutDir = if ([IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path (Get-Location) $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

if ($AllLetters) {
  $Letters = @(65..90 | ForEach-Object { [string][char]$_ })
}

$UsePageSnapshots = ConvertTo-BooleanFlag $UsePageSnapshots $true
$FetchFromSnapshots = ConvertTo-BooleanFlag $FetchFromSnapshots $true
$ShardWorkerOutputs = ConvertTo-BooleanFlag $ShardWorkerOutputs $true

if ($Mode -eq 'Quick') {
  if (-not $GlobalRpsWasProvided) { $GlobalRps = 18.0 }
  if (-not $WorkerRpsWasProvided) { $WorkerRps = 18.0 }
}

if (-not $IndexPath) {
  $IndexPath = Join-Path $OutDir 'records-index.jsonl'
} elseif (-not [IO.Path]::IsPathRooted($IndexPath)) {
  $IndexPath = Join-Path (Get-Location) $IndexPath
}

if (-not $SnapshotDir) {
  $SnapshotDir = Join-Path $OutDir 'page-snapshots'
} elseif (-not [IO.Path]::IsPathRooted($SnapshotDir)) {
  $SnapshotDir = Join-Path (Get-Location) $SnapshotDir
}
if ($UsePageSnapshots) {
  New-Item -ItemType Directory -Force -Path $SnapshotDir | Out-Null
  $SnapshotDir = (Resolve-Path $SnapshotDir).Path
}

$DetailsPath = Join-Path $OutDir 'records-details.jsonl'
$QuickPath = Join-Path $OutDir 'records-quick.jsonl'
$FailuresPath = Join-Path $OutDir 'failures.jsonl'
$EventsPath = Join-Path $OutDir 'events.jsonl'
$StatePath = Join-Path $OutDir 'state.json'
$SummaryPath = Join-Path $OutDir 'summary.json'

if ($WorkerMode) {
  $StatePath = Join-Path $OutDir "state-worker-$WorkerId.json"
  $SummaryPath = Join-Path $OutDir "summary-worker-$WorkerId.json"
  if ($ShardWorkerOutputs) {
    $DetailsPath = Join-Path $OutDir "records-details-worker-$WorkerId.jsonl"
    $FailuresPath = Join-Path $OutDir "failures-worker-$WorkerId.jsonl"
    $EventsPath = Join-Path $OutDir "events-worker-$WorkerId.jsonl"
  }
}

$Headers = @{
  'User-Agent' = $UserAgent
  'Accept' = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  'Accept-Language' = 'en-US,en;q=0.9,en-GB;q=0.8'
}

$script:Session = $null
$script:HttpClient = $null
$script:HttpHandler = $null
$script:LastWorkerRequestMs = 0L
$script:Stats = [ordered]@{
  StartedAt = (Get-Date).ToUniversalTime().ToString('o')
  Mode = $Mode
  Client = $Client
  QueueGranularity = $QueueGranularity
  UsePageSnapshots = [bool]$UsePageSnapshots
  FetchFromSnapshots = [bool]$FetchFromSnapshots
  ShardWorkerOutputs = [bool]$ShardWorkerOutputs
  WorkerMode = [bool]$WorkerMode
  WorkerId = $WorkerId
  BranchesIndexed = 0
  BranchesFetched = 0
  BranchesQueued = 0
  BranchPagesIndexed = 0
  BranchPagesFetched = 0
  RecordsIndexed = 0
  RecordsQuickScanned = 0
  DetailsFetched = 0
  Mismatches = 0
  Failures = 0
  BlockedResponses = 0
  Retries = 0
}

function Html-Decode([string]$Value) {
  if ($null -eq $Value) { return '' }
  return [System.Net.WebUtility]::HtmlDecode($Value)
}

function Strip-Html([string]$Html) {
  if ($null -eq $Html) { return '' }
  $text = [regex]::Replace($Html, '<script[\s\S]*?</script>', ' ', 'IgnoreCase')
  $text = [regex]::Replace($text, '<style[\s\S]*?</style>', ' ', 'IgnoreCase')
  $text = [regex]::Replace($text, '<br\s*/?>', ' ', 'IgnoreCase')
  $text = [regex]::Replace($text, '<[^>]+>', ' ')
  $text = Html-Decode $text
  return ([regex]::Replace($text, '\s+', ' ').Trim())
}

function Get-TagAttribute([string]$Tag, [string]$Name) {
  $match = [regex]::Match($Tag, "\b$([regex]::Escape($Name))\s*=\s*""([^""]*)""", 'IgnoreCase')
  if ($match.Success) { return (Html-Decode $match.Groups[1].Value) }
  $match = [regex]::Match($Tag, "\b$([regex]::Escape($Name))\s*=\s*'([^']*)'", 'IgnoreCase')
  if ($match.Success) { return (Html-Decode $match.Groups[1].Value) }
  return ''
}

function Write-JsonLine([string]$Path, [object]$Value) {
  $line = ($Value | ConvertTo-Json -Compress -Depth 40)
  $lockPath = "$Path.lock"
  $fs = Open-ExclusiveFileWithRetry $lockPath
  try {
    $line | Add-Content -Path $Path -Encoding UTF8
  } finally {
    $fs.Dispose()
  }
}

function Write-Event([string]$Type, [hashtable]$Data = @{}) {
  $event = [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    type = $Type
    workerId = $WorkerId
  }
  foreach ($key in $Data.Keys) { $event[$key] = $Data[$key] }
  Write-JsonLine $EventsPath ([pscustomobject]$event)
}

function Write-Failure([hashtable]$Data) {
  $script:Stats.Failures++
  $failure = [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    workerId = $WorkerId
  }
  foreach ($key in $Data.Keys) { $failure[$key] = $Data[$key] }
  Write-JsonLine $FailuresPath ([pscustomobject]$failure)
}

function Open-ExclusiveFileWithRetry([string]$Path, [int]$TimeoutMs = 10000) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($true) {
    try {
      return [IO.File]::Open($Path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
      if ($sw.ElapsedMilliseconds -ge $TimeoutMs) { throw }
      Start-Sleep -Milliseconds 75
    }
  }
}

function Save-State {
  $script:Stats.UpdatedAt = (Get-Date).ToUniversalTime().ToString('o')
  [pscustomobject]$script:Stats | ConvertTo-Json -Depth 20 | Set-Content -Path $StatePath -Encoding UTF8
}

function Get-TextLineCount([string]$Path) {
  if (-not (Test-Path $Path)) { return 0 }
  return [int](Get-Content -Path $Path | Where-Object { $_.Trim() } | Measure-Object).Count
}

function Add-DerivedRunStats {
  $script:Stats.IndexRowsOnDisk = Get-TextLineCount $IndexPath
  $script:Stats.QuickRowsOnDisk = Get-TextLineCount $QuickPath
  $script:Stats.DetailRowsOnDisk = Get-TextLineCount $DetailsPath
  $script:Stats.FailureRowsOnDisk = Get-TextLineCount $FailuresPath
  try {
    $started = [DateTime]::Parse([string]$script:Stats.StartedAt).ToUniversalTime()
    $elapsed = [Math]::Max(0.001, ((Get-Date).ToUniversalTime() - $started).TotalSeconds)
    $script:Stats.ElapsedSeconds = [Math]::Round($elapsed, 3)
    $script:Stats.IndexRowsPerSecond = [Math]::Round(([double]$script:Stats.IndexRowsOnDisk / $elapsed), 3)
    $script:Stats.QuickRowsPerSecond = [Math]::Round(([double]$script:Stats.QuickRowsOnDisk / $elapsed), 3)
    $script:Stats.DetailRowsPerSecond = [Math]::Round(([double]$script:Stats.DetailRowsOnDisk / $elapsed), 3)
  } catch {
    $script:Stats.RateCalculationError = $_.Exception.Message
  }
  if ($QueuePath -and (Test-Path $QueuePath)) {
    try {
      $queue = Get-Content -Path $QueuePath -Raw | ConvertFrom-Json
      $script:Stats.QueueBranches = @($queue.branches).Count
      $script:Stats.QueueDone = @($queue.branches | Where-Object { $_.status -eq 'done' }).Count
      $script:Stats.QueuePending = @($queue.branches | Where-Object { $_.status -eq 'pending' }).Count
      $script:Stats.QueueFailed = @($queue.branches | Where-Object { $_.status -eq 'failed' }).Count
      $script:Stats.QueueRunning = @($queue.branches | Where-Object { $_.status -eq 'running' }).Count
    } catch {
      $script:Stats.QueueReadError = $_.Exception.Message
    }
  }
}

function Get-ObjectValue([object]$Object, [string]$Name, $Default = $null) {
  if ($null -eq $Object) { return $Default }
  if ($Object -is [hashtable] -and $Object.ContainsKey($Name)) { return $Object[$Name] }
  $property = $Object.PSObject.Properties[$Name]
  if ($property) { return $property.Value }
  return $Default
}

function Get-TextSha256([string]$Value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-SafePathSegment([string]$Value) {
  if (-not $Value) { return 'root' }
  $clean = [regex]::Replace($Value, '[^A-Za-z0-9._-]+', '_').Trim('_')
  if ($clean.Length -gt 80) { $clean = $clean.Substring(0, 80) }
  if (-not $clean) { return 'root' }
  return $clean
}

function Get-TaskKey([string]$BranchKey, [int]$Page = 0, [string]$Ctl = '') {
  if ($QueueGranularity -eq 'Branch') { return $BranchKey }
  if ($QueueGranularity -eq 'Page') { return "$BranchKey|page:$Page" }
  return "$BranchKey|page:$Page|ctl:$Ctl"
}

function Save-PageSnapshot([object]$Branch, [int]$PageNumber, [string]$Html, [object[]]$Rows) {
  if (-not $UsePageSnapshots) { return $null }
  $branchKey = Get-BranchKey $Branch
  $hash = Get-TextSha256 "$branchKey|$PageNumber"
  $letterDir = Join-Path $SnapshotDir (Get-SafePathSegment $Branch.Letter)
  New-Item -ItemType Directory -Force -Path $letterDir | Out-Null
  $htmlPath = Join-Path $letterDir "$hash.html"
  $metaPath = Join-Path $letterDir "$hash.json"
  [IO.File]::WriteAllText($htmlPath, $Html, [Text.UTF8Encoding]::new($false))
  $metadata = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    branchKey = $branchKey
    letter = $Branch.Letter
    path = @($Branch.Path)
    page = $PageNumber
    pageHash = Get-PageHash $Html
    htmlPath = $htmlPath
    rowCount = @($Rows).Count
    cookieHeader = Get-ProniCookieHeader
  }
  [pscustomobject]$metadata | ConvertTo-Json -Depth 20 | Set-Content -Path $metaPath -Encoding UTF8
  return [pscustomobject]@{
    HtmlPath = $htmlPath
    MetadataPath = $metaPath
    PageHash = $metadata.pageHash
  }
}

function Read-PageSnapshot([object]$IndexRow) {
  if (-not $FetchFromSnapshots) { return '' }
  $path = [string](Get-ObjectValue $IndexRow 'pageSnapshotPath' '')
  if (-not $path -or -not (Test-Path $path)) { return '' }
  $html = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
  $expectedHash = [string](Get-ObjectValue $IndexRow 'pageHash' '')
  if ($expectedHash) {
    $actualHash = Get-PageHash $html
    if ($actualHash -ne $expectedHash) {
      Write-Event 'snapshot-hash-mismatch' @{ path=$path; expected=$expectedHash; actual=$actualHash }
      return ''
    }
  }
  return $html
}

function Read-PageSnapshotMetadata([object]$IndexRow) {
  $path = [string](Get-ObjectValue $IndexRow 'pageSnapshotMetadataPath' '')
  if (-not $path -or -not (Test-Path $path)) { return $null }
  try {
    return Get-Content -Path $path -Raw | ConvertFrom-Json
  } catch {
    Write-Event 'snapshot-metadata-read-failed' @{ path=$path; error=$_.Exception.Message }
    return $null
  }
}

function Set-ProniCookieHeader([string]$CookieHeader) {
  if (-not $CookieHeader) { return }
  try {
    if ($Client -eq 'HttpClient' -and $script:HttpHandler -and $script:HttpHandler.CookieContainer) {
      $script:HttpHandler.CookieContainer.SetCookies([Uri]$Base, $CookieHeader)
      return
    }
    if ($script:Session -and $script:Session.Cookies) {
      $script:Session.Cookies.SetCookies([Uri]$Base, $CookieHeader)
    }
  } catch {
    Write-Event 'cookie-header-apply-failed' @{ error=$_.Exception.Message }
  }
}

function Apply-PageSnapshotState([object]$IndexRow) {
  $metadata = Read-PageSnapshotMetadata $IndexRow
  if ($metadata -and $metadata.cookieHeader) {
    Set-ProniCookieHeader ([string]$metadata.cookieHeader)
    Write-Event 'snapshot-cookie-applied' @{ path=([string](Get-ObjectValue $IndexRow 'pageSnapshotMetadataPath' '')) }
  }
}

function Add-IndexLookupRow([hashtable]$Map, [string]$Key, [object]$Row) {
  if (-not $Map.ContainsKey($Key)) {
    $Map[$Key] = New-Object 'System.Collections.Generic.List[object]'
  }
  $Map[$Key].Add($Row)
}

function Initialize-IndexLookups([object[]]$IndexRows) {
  $byBranch = @{}
  $byPage = @{}
  $byRecord = @{}
  foreach ($row in $IndexRows) {
    $branchKey = [string](Get-ObjectValue $row 'branchKey' '')
    if (-not $branchKey) { continue }
    $page = [int](Get-ObjectValue $row 'page' 0)
    $ctl = [string](Get-ObjectValue $row 'ctl' '')
    Add-IndexLookupRow $byBranch $branchKey $row
    Add-IndexLookupRow $byPage "$branchKey|page:$page" $row
    Add-IndexLookupRow $byRecord "$branchKey|page:$page|ctl:$ctl" $row
  }
  $script:IndexLookupByBranch = $byBranch
  $script:IndexLookupByPage = $byPage
  $script:IndexLookupByRecord = $byRecord
}

function Get-IndexRowsForTask([object]$Task, [object[]]$FallbackIndexRows) {
  $taskKind = [string](Get-ObjectValue $Task 'TaskKind' 'Branch')
  $taskKey = [string](Get-ObjectValue $Task 'TaskKey' '')
  $branchKey = [string](Get-ObjectValue $Task 'BranchKey' '')
  if ($script:IndexLookupByRecord -or $script:IndexLookupByPage -or $script:IndexLookupByBranch) {
    if ($taskKind -eq 'Record' -and $script:IndexLookupByRecord.ContainsKey($taskKey)) {
      return @($script:IndexLookupByRecord[$taskKey].ToArray())
    }
    if ($taskKind -eq 'Page' -and $script:IndexLookupByPage.ContainsKey($taskKey)) {
      return @($script:IndexLookupByPage[$taskKey].ToArray())
    }
    if ($script:IndexLookupByBranch.ContainsKey($branchKey)) {
      return @($script:IndexLookupByBranch[$branchKey].ToArray())
    }
  }
  if ($taskKind -eq 'Record') {
    $page = [int](Get-ObjectValue $Task 'Page' 0)
    $ctl = [string](Get-ObjectValue $Task 'Ctl' '')
    return @($FallbackIndexRows | Where-Object { $_.branchKey -eq $branchKey -and [int]$_.page -eq $page -and [string]$_.ctl -eq $ctl })
  }
  if ($taskKind -eq 'Page') {
    $page = [int](Get-ObjectValue $Task 'Page' 0)
    return @($FallbackIndexRows | Where-Object { $_.branchKey -eq $branchKey -and [int]$_.page -eq $page })
  }
  return @($FallbackIndexRows | Where-Object { $_.branchKey -eq $branchKey })
}

function Parse-Inputs([string]$Html) {
  $dict = [ordered]@{}
  foreach ($m in [regex]::Matches($Html, '<input\b[^>]*>', 'IgnoreCase')) {
    $tag = $m.Value
    $name = Get-TagAttribute $tag 'name'
    if (-not $name) { continue }
    $type = (Get-TagAttribute $tag 'type').ToLowerInvariant()
    if (-not $type) { $type = 'text' }
    if ($type -in @('submit','image','button')) { continue }
    if (-not $dict.Contains($name)) { $dict[$name] = (Get-TagAttribute $tag 'value') }
  }
  return $dict
}

function ConvertTo-FormBody([string]$Html, [hashtable]$Extra) {
  $body = Parse-Inputs $Html
  foreach ($key in @('__LASTFOCUS','__EVENTTARGET','__EVENTARGUMENT')) {
    if ($body.Contains($key) -and -not $Extra.ContainsKey($key)) { $body[$key] = '' }
  }
  if ($body.Contains('__SCROLLPOSITIONX')) { $body['__SCROLLPOSITIONX'] = '0' }
  if ($body.Contains('__SCROLLPOSITIONY')) { $body['__SCROLLPOSITIONY'] = '0' }
  foreach ($key in $Extra.Keys) { $body[$key] = $Extra[$key] }
  return $body
}

function Initialize-ProniClient {
  $script:Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  if ($Client -eq 'HttpClient') {
    Add-Type -AssemblyName System.Net.Http
    $script:HttpHandler = New-Object System.Net.Http.HttpClientHandler
    $script:HttpHandler.CookieContainer = New-Object System.Net.CookieContainer
    $script:HttpHandler.AllowAutoRedirect = $true
    $script:HttpClient = New-Object System.Net.Http.HttpClient($script:HttpHandler)
    $script:HttpClient.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
    $script:HttpClient.DefaultRequestHeaders.UserAgent.ParseAdd($UserAgent)
    $script:HttpClient.DefaultRequestHeaders.Accept.ParseAdd('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
    $script:HttpClient.DefaultRequestHeaders.AcceptLanguage.ParseAdd('en-US')
    $script:HttpClient.DefaultRequestHeaders.AcceptLanguage.ParseAdd('en;q=0.9')
    $script:HttpClient.DefaultRequestHeaders.AcceptLanguage.ParseAdd('en-GB;q=0.8')
  }
}

function Get-ProniCookieHeader {
  try {
    if ($Client -eq 'HttpClient' -and $script:HttpHandler -and $script:HttpHandler.CookieContainer) {
      return [string]$script:HttpHandler.CookieContainer.GetCookieHeader([Uri]$Base)
    }
    if ($script:Session -and $script:Session.Cookies) {
      return [string]$script:Session.Cookies.GetCookieHeader([Uri]$Base)
    }
  } catch {
    Write-Event 'cookie-header-read-failed' @{ error=$_.Exception.Message }
  }
  return ''
}

function Wait-RequestPace {
  if ($WorkerRps -gt 0) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $gap = [int][Math]::Ceiling(1000.0 / $WorkerRps)
    $wait = $script:LastWorkerRequestMs + $gap - $now
    if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
    $script:LastWorkerRequestMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }

  if ($GlobalRps -le 0) { return }
  $lockPath = Join-Path $OutDir 'global-rate.lock'
  $ratePath = Join-Path $OutDir 'global-rate.json'
  $fs = Open-ExclusiveFileWithRetry $lockPath
  try {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $last = 0L
    if (Test-Path $ratePath) {
      try {
        $state = Get-Content -Path $ratePath -Raw | ConvertFrom-Json
        $last = [int64]$state.lastRequestMs
      } catch {
        $last = 0L
      }
    }
    $gap = [int][Math]::Ceiling(1000.0 / $GlobalRps)
    $wait = $last + $gap - $now
    if ($wait -gt 0) {
      Start-Sleep -Milliseconds $wait
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    @{ lastRequestMs = $now } | ConvertTo-Json -Compress | Set-Content -Path $ratePath -Encoding UTF8
  } finally {
    $fs.Dispose()
  }
}

function Invoke-HttpClientRequest([string]$Method, [string]$Uri, [hashtable]$Body = $null, [string]$Referer = '') {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    if ($Method -eq 'GET') {
      $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $Uri)
    } else {
      $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $Uri)
      $pairs = New-Object 'System.Collections.Generic.List[System.Collections.Generic.KeyValuePair[string,string]]'
      foreach ($key in $Body.Keys) {
        $pairs.Add([System.Collections.Generic.KeyValuePair[string,string]]::new([string]$key, [string]$Body[$key]))
      }
      $request.Content = [System.Net.Http.FormUrlEncodedContent]::new($pairs)
    }
    if ($Referer) { $request.Headers.Referrer = [Uri]$Referer }
    $response = $script:HttpClient.SendAsync($request).GetAwaiter().GetResult()
    $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $sw.Stop()
    return [pscustomobject]@{ Ok=$response.IsSuccessStatusCode; Status=[int]$response.StatusCode; Content=[string]$content; Ms=$sw.Elapsed.TotalMilliseconds; Error='' }
  } catch {
    $sw.Stop()
    return [pscustomobject]@{ Ok=$false; Status=0; Content=''; Ms=$sw.Elapsed.TotalMilliseconds; Error=$_.Exception.Message }
  }
}

function Invoke-ProniRequest([string]$Method, [string]$Uri, [hashtable]$Body = $null, [string]$Referer = '') {
  Wait-RequestPace
  if ($Client -eq 'HttpClient') {
    return Invoke-HttpClientRequest $Method $Uri $Body $Referer
  }

  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $requestHeaders = @{} + $Headers
    if ($Referer) { $requestHeaders['Referer'] = $Referer }
    if ($Method -eq 'GET') {
      $res = Invoke-WebRequest -UseBasicParsing -Uri $Uri -WebSession $script:Session -Headers $requestHeaders -TimeoutSec $TimeoutSec
    } else {
      $res = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Method Post -Body $Body -WebSession $script:Session -Headers $requestHeaders -TimeoutSec $TimeoutSec
    }
    $sw.Stop()
    return [pscustomobject]@{ Ok=$true; Status=[int]$res.StatusCode; Content=[string]$res.Content; Ms=$sw.Elapsed.TotalMilliseconds; Error='' }
  } catch {
    $sw.Stop()
    $status = 0
    if ($_.Exception.Response) {
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    }
    return [pscustomobject]@{ Ok=$false; Status=$status; Content=''; Ms=$sw.Elapsed.TotalMilliseconds; Error=$_.Exception.Message }
  }
}

function Invoke-ProniGet([string]$Uri) {
  return Invoke-ProniRequest 'GET' $Uri $null ''
}

function Invoke-ProniPost([string]$Uri, [string]$Html, [hashtable]$Extra) {
  $body = ConvertTo-FormBody $Html $Extra
  return Invoke-ProniRequest 'POST' $Uri $body $Uri
}

function Test-Blocked([object]$Res) {
  if (-not $Res.Ok) { return $true }
  if ($Res.Status -ne 200) { return $true }
  if ($Res.Content -match 'Request Rejected|support ID|Access Denied|Too Many Requests|rate limit|throttl') { return $true }
  return $false
}

function Get-FailureReason([object]$Res) {
  if ($Res.Ok -and $Res.Status -eq 200 -and -not (Test-Blocked $Res)) { return '' }
  if (-not $Res.Ok) { return $Res.Error }
  if ($Res.Status -ne 200) { return "http $($Res.Status)" }
  if ($Res.Content -match 'Request Rejected|support ID') { return 'waf request rejected' }
  if ($Res.Content -match 'Access Denied') { return 'access denied text' }
  if ($Res.Content -match 'Too Many Requests|rate limit|throttl') { return 'rate-limit text' }
  return 'blocked response text'
}

function Assert-ProniOk([object]$Res, [string]$Context) {
  if (-not (Test-Blocked $Res)) { return }
  $script:Stats.BlockedResponses++
  $reason = Get-FailureReason $Res
  Write-Failure @{ type='request-failed'; context=$Context; status=$Res.Status; ms=[Math]::Round($Res.Ms, 3); reason=$reason }
  if ($StopOnBlocked) { throw "$Context failed: $reason" }
  throw "$Context failed: $reason"
}

function Invoke-WithRetry([scriptblock]$Action, [string]$Context) {
  $attempt = 0
  while ($true) {
    try {
      return & $Action
    } catch {
      $attempt++
      if ($attempt -gt $MaxRetries) { throw }
      $script:Stats.Retries++
      Write-Event 'retry' @{ context=$Context; attempt=$attempt; error=$_.Exception.Message; backoffSeconds=$BackoffSeconds }
      Start-Sleep -Seconds $BackoffSeconds
      Initialize-ProniClient
    }
  }
}

function Parse-GridRows([string]$Html) {
  $map = [ordered]@{}
  foreach ($m in [regex]::Matches($Html, '<input\b[^>]*GridView1\$ctl(\d+)\$(ResultsSelect|ResultsView)[^>]*>', 'IgnoreCase')) {
    $tag = $m.Value
    $ctl = "ctl$($m.Groups[1].Value)"
    $kind = $m.Groups[2].Value
    $name = Get-TagAttribute $tag 'name'
    $value = Get-TagAttribute $tag 'value'
    $disabled = $tag -match '\bdisabled\b'
    if (-not $map.Contains($ctl)) { $map[$ctl] = [ordered]@{ Ctl=$ctl } }
    $map[$ctl][$kind] = [ordered]@{ Name=$name; Value=$value; Disabled=$disabled }
  }

  foreach ($tr in [regex]::Matches($Html, '<tr\b[\s\S]*?</tr>', 'IgnoreCase')) {
    $rowHtml = $tr.Value
    $ctlMatch = [regex]::Match($rowHtml, 'GridView1\$ctl(\d+)\$', 'IgnoreCase')
    if (-not $ctlMatch.Success) { continue }
    $ctl = "ctl$($ctlMatch.Groups[1].Value)"
    if (-not $map.Contains($ctl)) { continue }
    $map[$ctl]['Text'] = Strip-Html $rowHtml
  }

  return @($map.Values | ForEach-Object { [pscustomobject]$_ })
}

function Find-NextButton([string]$Html) {
  foreach ($m in [regex]::Matches($Html, '<input\b[^>]*>', 'IgnoreCase')) {
    $tag = $m.Value
    $type = (Get-TagAttribute $tag 'type').ToLowerInvariant()
    if ($type -ne 'submit') { continue }
    if ($tag -match '\bdisabled\b') { continue }
    $value = Get-TagAttribute $tag 'value'
    $title = Get-TagAttribute $tag 'title'
    $class = Get-TagAttribute $tag 'class'
    if ($value -notmatch '^Next$' -and $title -notmatch '^Next$' -and $class -notmatch '\bNextBtn\b') { continue }
    $name = Get-TagAttribute $tag 'name'
    if ($name) { return [pscustomobject]@{ Name=$name; Value=$value } }
  }
  return $null
}

function Add-RawDetailAttribute([Collections.Specialized.OrderedDictionary]$Attributes, [string]$Key, [string]$Value) {
  if (-not $Key) { return }
  if (-not $Attributes.Contains($Key)) {
    $Attributes[$Key] = $Value
    return
  }

  $existing = $Attributes[$Key]
  if ($existing -is [array]) {
    $Attributes[$Key] = @($existing) + $Value
  } else {
    $Attributes[$Key] = @($existing, $Value)
  }
}

function Extract-DetailFields([string]$Html) {
  $wanted = @('Repository','PRONI Reference','Level','Access','Title','Dates','Description','Digital Record')
  $canonicalByLower = @{}
  foreach ($key in $wanted) { $canonicalByLower[$key.ToLowerInvariant()] = $key }

  $result = [ordered]@{}
  foreach ($key in $wanted) { $result[$key] = '' }
  $rawAttributes = [ordered]@{}

  foreach ($tr in [regex]::Matches($Html, '<tr\b[\s\S]*?</tr>', 'IgnoreCase')) {
    $rowHtml = $tr.Value
    $labelMatch = [regex]::Match($rowHtml, '<label\b[^>]*>([\s\S]*?)</label>', 'IgnoreCase')
    if (-not $labelMatch.Success) { continue }
    $key = (Strip-Html $labelMatch.Groups[1].Value).TrimEnd(':').Trim()
    if (-not $key) { continue }

    $cells = @()
    foreach ($td in [regex]::Matches($rowHtml, '<td\b[^>]*>([\s\S]*?)</td>', 'IgnoreCase')) {
      $cell = Strip-Html $td.Groups[1].Value
      if ($cell) { $cells += $cell }
    }
    $value = ''
    if ($cells.Count -ge 2) { $value = ($cells[1..($cells.Count - 1)] -join ' ').Trim() }

    Add-RawDetailAttribute $rawAttributes $key $value

    $lowerKey = $key.ToLowerInvariant()
    if ($canonicalByLower.ContainsKey($lowerKey)) {
      $result[$canonicalByLower[$lowerKey]] = $value
    }
  }

  if ($result['Digital Record'] -match '^\[?\d+\s*-') {
    $result['Digital Record'] = ''
    if ($rawAttributes.Contains('Digital Record')) { $rawAttributes['Digital Record'] = '' }
  }

  $result['rawAttributes'] = $rawAttributes
  $result['attributeKeys'] = @($rawAttributes.Keys)
  $result['rawAttributeCount'] = $rawAttributes.Count
  return [pscustomobject]$result
}

function Get-BranchKey([object]$Branch) {
  return "$($Branch.Letter)|$(($Branch.Path -join '>'))"
}

function Get-BranchFromKey([string]$BranchKey) {
  $parts = $BranchKey -split '\|', 2
  $path = @()
  if ($parts.Count -gt 1 -and $parts[1]) {
    $path = @($parts[1] -split '>' | Where-Object { $_ })
  }
  return [pscustomobject]@{ Letter=$parts[0]; Path=$path; BranchKey=$BranchKey }
}

function Start-BrowseLetter([string]$TargetLetter) {
  $res = Invoke-ProniGet "$Base`SearchPage.aspx"
  Assert-ProniOk $res 'SearchPage'
  $res = Invoke-ProniPost "$Base`SearchPage.aspx" $res.Content @{ '__EVENTTARGET'='ctl00$siteNav1$linkBtnBrowse'; '__EVENTARGUMENT'='' }
  Assert-ProniOk $res 'Browse nav'
  $res = Invoke-ProniPost "$Base`BrowseSearchPage.aspx" $res.Content @{ "ctl00`$ContentPlaceHolder1`$AZButton_$TargetLetter" = $TargetLetter }
  Assert-ProniOk $res "Letter $TargetLetter"
  return $res.Content
}

function Click-Select([string]$Html, [object]$Row) {
  if (-not $Row.ResultsSelect -or $Row.ResultsSelect.Disabled) { throw "Row is not selectable: $($Row.Text)" }
  $res = Invoke-ProniPost "$Base`BrowseSearchResults.aspx" $Html @{ $Row.ResultsSelect.Name = $Row.ResultsSelect.Value }
  Assert-ProniOk $res "Select $($Row.ResultsSelect.Value)"
  return $res.Content
}

function Click-More([string]$Html, [object]$Row) {
  if (-not $Row.ResultsView) { throw "More is missing for $($Row.Text)" }
  $res = Invoke-ProniPost "$Base`BrowseSearchResults.aspx" $Html @{ $Row.ResultsView.Name = $Row.ResultsView.Value }
  Assert-ProniOk $res "More $($Row.ResultsSelect.Value)"
  return $res.Content
}

function Click-Next([string]$Html, [object]$NextButton) {
  $res = Invoke-ProniPost "$Base`BrowseSearchResults.aspx" $Html @{ $NextButton.Name = $NextButton.Value }
  Assert-ProniOk $res 'Next page'
  return $res.Content
}

function Click-SelectByRef([string]$Html, [string]$Ref) {
  $pageHtml = $Html
  for ($page = 1; $page -le $MaxPagesPerBranch; $page++) {
    foreach ($row in (Parse-GridRows $pageHtml)) {
      if ($row.ResultsSelect -and $row.ResultsSelect.Value -eq $Ref -and -not $row.ResultsSelect.Disabled) {
        if ($page -gt 1) {
          Write-Event 'branch-select-found-on-later-page' @{ ref=$Ref; page=$page }
        }
        return Click-Select $pageHtml $row
      }
    }
    $next = Find-NextButton $pageHtml
    if (-not $next) { break }
    $pageHtml = Click-Next $pageHtml $next
  }
  throw "Could not find selectable branch $Ref after scanning $MaxPagesPerBranch page(s)"
}

function Open-BranchSnapshot([object]$Branch) {
  Initialize-ProniClient
  $html = Start-BrowseLetter $Branch.Letter
  foreach ($ref in @($Branch.Path)) {
    $html = Click-SelectByRef $html $ref
  }
  return $html
}

function Get-PageHash([string]$Html) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Html)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-IndexRows {
  if (-not (Test-Path $IndexPath)) { return @() }
  return @(Get-Content -Path $IndexPath | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
}

function Fetch-DetailRows([string]$PageHtml, [object]$Branch, [int]$PageNumber, [object[]]$Rows, [hashtable]$ExpectedByCtl = @{}) {
  foreach ($row in $Rows) {
    if ($MaxRecords -gt 0 -and $script:Stats.DetailsFetched -ge $MaxRecords) { return }
    $expected = ''
    if ($ExpectedByCtl.ContainsKey($row.Ctl)) {
      $expected = [string]$ExpectedByCtl[$row.Ctl]
    } elseif ($row.ResultsSelect -and $row.ResultsSelect.Disabled -and $row.ResultsSelect.Value) {
      $expected = [string]$row.ResultsSelect.Value
    }

    $context = "Detail $(Get-BranchKey $Branch) page $PageNumber $($row.Ctl)"
    try {
      $detailHtml = Invoke-WithRetry { Click-More $PageHtml $row } $context
      $fields = Extract-DetailFields $detailHtml
      $actual = [string]$fields.'PRONI Reference'
      $mismatch = $false
      if ($expected -and ($expected -ne $actual)) {
        $mismatch = $true
        $script:Stats.Mismatches++
        Write-Failure @{
          type='reference-mismatch'
          branchKey=(Get-BranchKey $Branch)
          page=$PageNumber
          ctl=$row.Ctl
          expectedRef=$expected
          actualRef=$actual
        }
        if ($StopOnMismatch) { throw "Reference mismatch: expected $expected got $actual" }
      }

      $record = [ordered]@{
        at = (Get-Date).ToUniversalTime().ToString('o')
        workerId = $WorkerId
        branchKey = Get-BranchKey $Branch
        letter = $Branch.Letter
        path = @($Branch.Path)
        page = $PageNumber
        ctl = $row.Ctl
        expectedRef = $expected
        extractedRef = $actual
        mismatch = $mismatch
        repository = $fields.Repository
        proniReference = $fields.'PRONI Reference'
        level = $fields.Level
        access = $fields.Access
        title = $fields.Title
        dates = $fields.Dates
        description = $fields.Description
        digitalRecord = $fields.'Digital Record'
        rawAttributeCount = $fields.rawAttributeCount
        attributeKeys = @($fields.attributeKeys)
        rawAttributes = $fields.rawAttributes
      }
      Write-JsonLine $DetailsPath ([pscustomobject]$record)
      $script:Stats.DetailsFetched++
    } catch {
      Write-Failure @{
        type='detail-fetch-failed'
        branchKey=(Get-BranchKey $Branch)
        page=$PageNumber
        ctl=$row.Ctl
        expectedRef=$expected
        error=$_.Exception.Message
      }
      if ($StopOnBlocked -or $StopOnMismatch) { throw }
    }
  }
}

function Write-QuickRecord([object]$Branch, [int]$PageNumber, [object]$Row, [string]$ExpectedRef, [string]$PageHash, [object]$Snapshot) {
  $record = [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    scanLevel = 'quick-index'
    attributeCompleteness = 'listing-only'
    validationStatus = 'unvalidated-detail'
    detailFetchAttempted = $false
    branchKey = Get-BranchKey $Branch
    letter = $Branch.Letter
    path = @($Branch.Path)
    page = $PageNumber
    ctl = $Row.Ctl
    expectedRef = $ExpectedRef
    proniReference = $ExpectedRef
    listingText = $Row.Text
    pageHash = $PageHash
    pageSnapshotPath = if ($Snapshot) { $Snapshot.HtmlPath } else { '' }
    pageSnapshotMetadataPath = if ($Snapshot) { $Snapshot.MetadataPath } else { '' }
    resultsViewName = if ($Row.ResultsView) { $Row.ResultsView.Name } else { '' }
    resultsViewValue = if ($Row.ResultsView) { $Row.ResultsView.Value } else { '' }
    resultsSelectName = if ($Row.ResultsSelect) { $Row.ResultsSelect.Name } else { '' }
    resultsSelectValue = if ($Row.ResultsSelect) { $Row.ResultsSelect.Value } else { '' }
    completenessNote = 'Quick scan records are Browse listing inventory rows only. Run Mode Fetch or Both to capture all visible detail-page attributes.'
  }
  Write-JsonLine $QuickPath ([pscustomobject]$record)
  $script:Stats.RecordsQuickScanned++
}

function Index-Branch([object]$Branch, [switch]$FetchNow) {
  $branchKey = Get-BranchKey $Branch
  Write-Event 'branch-index-start' @{ branchKey=$branchKey; path=@($Branch.Path); letter=$Branch.Letter }
  $html = Invoke-WithRetry { Open-BranchSnapshot $Branch } "Open branch $branchKey"
  $pageNumber = 1
  $newBranches = @()

  while ($pageNumber -le $MaxPagesPerBranch) {
    $rows = @(Parse-GridRows $html)
    $selectableBranches = @($rows | Where-Object { $_.ResultsSelect -and -not $_.ResultsSelect.Disabled })
    $leafRows = @($rows | Where-Object { $_.ResultsView -and (-not $_.ResultsSelect -or $_.ResultsSelect.Disabled) })
    $hash = Get-PageHash $html
    $snapshot = Save-PageSnapshot $Branch $pageNumber $html $leafRows

    foreach ($row in $selectableBranches) {
      if (-not $row.ResultsSelect.Value) { continue }
      $childPath = @(@($Branch.Path) + $row.ResultsSelect.Value)
      $child = [pscustomobject]@{ Letter=$Branch.Letter; Path=$childPath; Depth=$childPath.Count; Ref=$row.ResultsSelect.Value; ParentKey=$branchKey; Text=$row.Text }
      $newBranches += $child
    }

    foreach ($row in $leafRows) {
      if ($MaxRecords -gt 0 -and $script:Stats.RecordsIndexed -ge $MaxRecords) { break }
      $expected = if ($row.ResultsSelect -and $row.ResultsSelect.Value) { [string]$row.ResultsSelect.Value } else { '' }
      $index = [ordered]@{
        at = (Get-Date).ToUniversalTime().ToString('o')
        scanLevel = if ($Mode -eq 'Quick') { 'quick-index' } else { 'index' }
        attributeCompleteness = 'listing-only'
        validationStatus = 'unvalidated-detail'
        branchKey = $branchKey
        letter = $Branch.Letter
        path = @($Branch.Path)
        page = $pageNumber
        ctl = $row.Ctl
        expectedRef = $expected
        rowText = $row.Text
        pageHash = $hash
        pageSnapshotPath = if ($snapshot) { $snapshot.HtmlPath } else { '' }
        pageSnapshotMetadataPath = if ($snapshot) { $snapshot.MetadataPath } else { '' }
        resultsViewName = if ($row.ResultsView) { $row.ResultsView.Name } else { '' }
        resultsViewValue = if ($row.ResultsView) { $row.ResultsView.Value } else { '' }
        resultsSelectName = if ($row.ResultsSelect) { $row.ResultsSelect.Name } else { '' }
        resultsSelectValue = if ($row.ResultsSelect) { $row.ResultsSelect.Value } else { '' }
      }
      Write-JsonLine $IndexPath ([pscustomobject]$index)
      if ($Mode -eq 'Quick') {
        Write-QuickRecord $Branch $pageNumber $row $expected $hash $snapshot
      }
      $script:Stats.RecordsIndexed++
    }

    if ($FetchNow -and $leafRows.Count) {
      Fetch-DetailRows $html $Branch $pageNumber $leafRows @{}
    }

    $script:Stats.BranchPagesIndexed++
    if ($MaxRecords -gt 0 -and $script:Stats.RecordsIndexed -ge $MaxRecords) { break }
    $next = Find-NextButton $html
    if (-not $next) { break }
    $html = Invoke-WithRetry { Click-Next $html $next } "Next page $branchKey"
    $pageNumber++
  }

  $script:Stats.BranchesIndexed++
  Save-State
  Write-Event 'branch-index-complete' @{ branchKey=$branchKey; pages=$pageNumber; childBranches=$newBranches.Count }
  return $newBranches
}

function Run-IndexPass([switch]$FetchNow) {
  if (-not $Resume) {
    foreach ($path in @($IndexPath,$QuickPath,$DetailsPath,$FailuresPath,$EventsPath,$StatePath,$SummaryPath)) {
      if (Test-Path $path) { Remove-Item -LiteralPath $path -Force }
    }
  }

  $queue = New-Object System.Collections.Queue
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'

  if ($BranchPathCsv.Trim()) {
    $parts = @($BranchPathCsv -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if (-not $parts.Count) { throw 'BranchPathCsv was provided but no branch refs were parsed.' }
    $letter = $parts[0].Substring(0,1).ToUpperInvariant()
    $queue.Enqueue([pscustomobject]@{ Letter=$letter; Path=$parts; Depth=$parts.Count; Ref=$parts[-1] })
  } else {
    foreach ($letter in $Letters) {
      $queue.Enqueue([pscustomobject]@{ Letter=$letter.ToUpperInvariant(); Path=@(); Depth=0; Ref="letter:$letter" })
    }
  }

  while ($queue.Count -gt 0) {
    if ($MaxBranches -gt 0 -and $script:Stats.BranchesIndexed -ge $MaxBranches) { break }
    if ($MaxRecords -gt 0 -and $script:Stats.RecordsIndexed -ge $MaxRecords) { break }
    $branch = $queue.Dequeue()
    $branchKey = Get-BranchKey $branch
    if ($seen.Contains($branchKey)) { continue }
    [void]$seen.Add($branchKey)
    $children = @(Index-Branch $branch -FetchNow:$FetchNow)
    foreach ($child in $children) {
      $childKey = Get-BranchKey $child
      if (-not $seen.Contains($childKey)) { $queue.Enqueue($child); $script:Stats.BranchesQueued++ }
    }
  }
  Save-State
}

function Initialize-FetchQueue([object[]]$IndexRows) {
  $taskMap = [ordered]@{}
  foreach ($row in $IndexRows) {
    $branchKey = [string](Get-ObjectValue $row 'branchKey' '')
    if (-not $branchKey) { continue }
    $page = [int](Get-ObjectValue $row 'page' 0)
    $ctl = [string](Get-ObjectValue $row 'ctl' '')
    $taskKey = if ($QueueGranularity -eq 'Branch') {
      $branchKey
    } elseif ($QueueGranularity -eq 'Page') {
      "$branchKey|page:$page"
    } else {
      "$branchKey|page:$page|ctl:$ctl"
    }
    if (-not $taskMap.Contains($taskKey)) {
      $branch = Get-BranchFromKey $branchKey
      $taskMap[$taskKey] = [ordered]@{
        taskKey=$taskKey
        taskKind=$QueueGranularity
        branchKey=$branchKey
        letter=$branch.Letter
        path=@($branch.Path)
        page=$page
        ctl=if ($QueueGranularity -eq 'Record') { $ctl } else { '' }
        status='pending'
        attempts=0
        records=0
      }
    }
    $taskMap[$taskKey].records = [int]$taskMap[$taskKey].records + 1
  }
  $branches = @($taskMap.Values | ForEach-Object { [pscustomobject]$_ })
  $queue = [pscustomobject]@{
    createdAt=(Get-Date).ToUniversalTime().ToString('o')
    updatedAt=(Get-Date).ToUniversalTime().ToString('o')
    granularity=$QueueGranularity
    branches=$branches
  }
  $queue | ConvertTo-Json -Depth 30 | Set-Content -Path $QueuePath -Encoding UTF8
}

function Set-ObjectProperty([object]$Object, [string]$Name, [object]$Value) {
  if ($Object.PSObject.Properties[$Name]) {
    $Object.$Name = $Value
  } else {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
  }
}

function Invoke-QueueLock([scriptblock]$Block) {
  $lockPath = "$QueuePath.lock"
  $fs = Open-ExclusiveFileWithRetry $lockPath
  try {
    return & $Block
  } finally {
    $fs.Dispose()
  }
}

function Get-NextBranchFromQueue {
  return Invoke-QueueLock {
    if (-not (Test-Path $QueuePath)) { return $null }
    $queue = Get-Content -Path $QueuePath -Raw | ConvertFrom-Json
    $selected = $queue.branches | Where-Object { $_.status -eq 'pending' } | Select-Object -First 1
    if (-not $selected) { return $null }
    foreach ($branch in $queue.branches) {
      if ($branch.taskKey -eq $selected.taskKey) {
        $branch.status = 'running'
        Set-ObjectProperty $branch 'workerId' $WorkerId
        Set-ObjectProperty $branch 'startedAt' ((Get-Date).ToUniversalTime().ToString('o'))
        $branch.attempts = [int]$branch.attempts + 1
      }
    }
    $queue.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    $queue | ConvertTo-Json -Depth 30 | Set-Content -Path $QueuePath -Encoding UTF8
    return [pscustomobject]@{
      Letter=$selected.letter
      Path=@($selected.path)
      BranchKey=$selected.branchKey
      TaskKey=$selected.taskKey
      TaskKind=$selected.taskKind
      Page=[int]$selected.page
      Ctl=[string]$selected.ctl
    }
  }
}

function Set-QueueBranchStatus([string]$TaskKey, [string]$Status, [string]$ErrorMessage = '') {
  Invoke-QueueLock {
    $queue = Get-Content -Path $QueuePath -Raw | ConvertFrom-Json
    foreach ($branch in $queue.branches) {
      if ($branch.taskKey -eq $TaskKey) {
        $branch.status = $Status
        Set-ObjectProperty $branch 'workerId' $WorkerId
        Set-ObjectProperty $branch 'finishedAt' ((Get-Date).ToUniversalTime().ToString('o'))
        Set-ObjectProperty $branch 'error' $ErrorMessage
      }
    }
    $queue.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    $queue | ConvertTo-Json -Depth 30 | Set-Content -Path $QueuePath -Encoding UTF8
  } | Out-Null
}

function Open-BranchPageFromBrowse([object]$Branch, [int]$TargetPage) {
  $branchKey = if ($Branch.BranchKey) { $Branch.BranchKey } else { Get-BranchKey $Branch }
  $html = Invoke-WithRetry { Open-BranchSnapshot $Branch } "Open fetch branch $branchKey"
  $pageNumber = 1
  while ($pageNumber -lt $TargetPage -and $pageNumber -le $MaxPagesPerBranch) {
    $next = Find-NextButton $html
    if (-not $next) { break }
    $html = Invoke-WithRetry { Click-Next $html $next } "Next fetch page $branchKey"
    $pageNumber++
  }
  return [pscustomobject]@{ Html=$html; Page=$pageNumber }
}

function Fetch-IndexedRowsOnPage([string]$Html, [object]$Branch, [int]$PageNumber, [object[]]$ExpectedRows) {
  if (-not $ExpectedRows.Count) { return }
  $rows = @(Parse-GridRows $Html)
  $leafRows = @($rows | Where-Object { $_.ResultsView -and (-not $_.ResultsSelect -or $_.ResultsSelect.Disabled) })
  $expectedByCtl = @{}
  $wantedCtls = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($item in $ExpectedRows) {
    [void]$wantedCtls.Add([string]$item.ctl)
    if ($item.expectedRef) { $expectedByCtl[[string]$item.ctl] = [string]$item.expectedRef }
  }
  $leafRows = @($leafRows | Where-Object { $wantedCtls.Contains([string]$_.Ctl) })
  Fetch-DetailRows $Html $Branch $PageNumber $leafRows $expectedByCtl
}

function Test-IndexedPageReplay([string]$Html, [object[]]$ExpectedRows) {
  if (-not $ExpectedRows.Count) {
    return [pscustomobject]@{ Ok=$true; Reason='no rows'; ExpectedRef=''; ActualRef=''; Ctl='' }
  }

  $rows = @(Parse-GridRows $Html)
  $leafRows = @($rows | Where-Object { $_.ResultsView -and (-not $_.ResultsSelect -or $_.ResultsSelect.Disabled) })
  $first = $null
  $expected = $null
  foreach ($item in $ExpectedRows) {
    $ctl = [string]$item.ctl
    $first = $leafRows | Where-Object { [string]$_.Ctl -eq $ctl } | Select-Object -First 1
    if ($first) {
      $expected = $item
      break
    }
  }
  if (-not $first) {
    return [pscustomobject]@{ Ok=$false; Reason='expected row not found on snapshot page'; ExpectedRef=''; ActualRef=''; Ctl='' }
  }

  $res = Invoke-ProniPost "$Base`BrowseSearchResults.aspx" $Html @{ $first.ResultsView.Name = $first.ResultsView.Value }
  if (Test-Blocked $res) {
    return [pscustomobject]@{ Ok=$false; Reason=(Get-FailureReason $res); ExpectedRef=[string]$expected.expectedRef; ActualRef=''; Ctl=[string]$first.Ctl }
  }

  $fields = Extract-DetailFields $res.Content
  $actual = [string]$fields['PRONI Reference']
  $expectedRef = [string]$expected.expectedRef
  if ($expectedRef -and $actual -ne $expectedRef) {
    return [pscustomobject]@{ Ok=$false; Reason='snapshot replay returned blank or different detail record'; ExpectedRef=$expectedRef; ActualRef=$actual; Ctl=[string]$first.Ctl }
  }
  if (-not $expectedRef -and [int]$fields.rawAttributeCount -le 0) {
    return [pscustomobject]@{ Ok=$false; Reason='snapshot replay returned no detail attributes'; ExpectedRef=''; ActualRef=$actual; Ctl=[string]$first.Ctl }
  }

  return [pscustomobject]@{ Ok=$true; Reason=''; ExpectedRef=$expectedRef; ActualRef=$actual; Ctl=[string]$first.Ctl }
}

function Fetch-TaskFromIndex([object]$Task, [object[]]$IndexRows) {
  $branchKey = if ($Task.BranchKey) { $Task.BranchKey } else { Get-BranchKey $Task }
  $taskKey = if ($Task.TaskKey) { $Task.TaskKey } else { $branchKey }
  $taskKind = if ($Task.TaskKind) { $Task.TaskKind } else { 'Branch' }
  $expectedRows = @(Get-IndexRowsForTask $Task $IndexRows)
  if (-not $expectedRows.Count) { return }

  Write-Event 'fetch-task-start' @{ taskKey=$taskKey; taskKind=$taskKind; branchKey=$branchKey; expectedRecords=$expectedRows.Count }

  $pages = @($expectedRows | Group-Object page | Sort-Object { [int]$_.Name })
  foreach ($pageGroup in $pages) {
    if ($MaxRecords -gt 0 -and $script:Stats.DetailsFetched -ge $MaxRecords) { break }
    $pageNumber = [int]$pageGroup.Name
    $pageRows = @($pageGroup.Group)
    $html = ''
    $fromSnapshot = $false

    if ($FetchFromSnapshots -and $pageRows.Count) {
      $html = Read-PageSnapshot $pageRows[0]
      if ($html) {
        Apply-PageSnapshotState $pageRows[0]
        $fromSnapshot = $true
        Write-Event 'fetch-page-snapshot-hit' @{ taskKey=$taskKey; branchKey=$branchKey; page=$pageNumber; rows=$pageRows.Count }
      }
    }

    if ($html -and $fromSnapshot) {
      $probe = Test-IndexedPageReplay $html $pageRows
      if ($probe.Ok) {
        Write-Event 'fetch-page-snapshot-replay-ok' @{ taskKey=$taskKey; branchKey=$branchKey; page=$pageNumber; ctl=$probe.Ctl; expectedRef=$probe.ExpectedRef; actualRef=$probe.ActualRef }
      } else {
        Write-Event 'fetch-page-snapshot-stale' @{ taskKey=$taskKey; branchKey=$branchKey; page=$pageNumber; ctl=$probe.Ctl; expectedRef=$probe.ExpectedRef; actualRef=$probe.ActualRef; reason=$probe.Reason }
        $html = ''
        $fromSnapshot = $false
      }
    }

    if (-not $html) {
      $opened = Open-BranchPageFromBrowse $Task $pageNumber
      $html = [string]$opened.Html
      if ([int]$opened.Page -ne $pageNumber) {
        throw "Could not navigate to page $pageNumber for $branchKey; reached page $($opened.Page)"
      }
      Write-Event 'fetch-page-browse-open' @{ taskKey=$taskKey; branchKey=$branchKey; page=$pageNumber; rows=$pageRows.Count }
    }

    Fetch-IndexedRowsOnPage $html $Task $pageNumber $pageRows
    $script:Stats.BranchPagesFetched++
  }

  $script:Stats.BranchesFetched++
  Save-State
  Write-Event 'fetch-task-complete' @{ taskKey=$taskKey; taskKind=$taskKind; branchKey=$branchKey; fetched=$script:Stats.DetailsFetched }
}

function Run-FetchWorker {
  Initialize-ProniClient
  $indexRows = Get-IndexRows
  Initialize-IndexLookups $indexRows
  while ($true) {
    if ($MaxRecords -gt 0 -and $script:Stats.DetailsFetched -ge $MaxRecords) { break }
    $branch = Get-NextBranchFromQueue
    if (-not $branch) { break }
    try {
      Fetch-TaskFromIndex $branch $indexRows
      Set-QueueBranchStatus $branch.TaskKey 'done'
    } catch {
      Write-Failure @{ type='fetch-task-failed'; taskKey=$branch.TaskKey; branchKey=$branch.BranchKey; error=$_.Exception.Message }
      if ($MaxRetries -gt 0) {
        Set-QueueBranchStatus $branch.TaskKey 'failed' $_.Exception.Message
      } else {
        Set-QueueBranchStatus $branch.TaskKey 'pending' $_.Exception.Message
      }
      if ($StopOnBlocked -or $StopOnMismatch) { throw }
    }
  }
  Save-State
}

function Merge-WorkerJsonlShards([string]$Pattern, [string]$TargetPath, [bool]$AppendExisting = $false) {
  $shards = @(Get-ChildItem -Path $OutDir -Filter $Pattern -File -ErrorAction SilentlyContinue | Sort-Object Name)
  if (-not $shards.Count) { return 0 }
  $tmpPath = "$TargetPath.merge"
  if (Test-Path $tmpPath) { Remove-Item -LiteralPath $tmpPath -Force }
  if ($AppendExisting -and (Test-Path $TargetPath)) {
    Get-Content -Path $TargetPath | Add-Content -Path $tmpPath -Encoding UTF8
  }
  foreach ($shard in $shards) {
    if ((Get-Item $shard.FullName).Length -le 0) { continue }
    Get-Content -Path $shard.FullName | Add-Content -Path $tmpPath -Encoding UTF8
  }
  if (Test-Path $tmpPath) {
    Move-Item -LiteralPath $tmpPath -Destination $TargetPath -Force
  }
  return $shards.Count
}

function Merge-WorkerOutputs {
  if (-not $ShardWorkerOutputs -or $Workers -le 1) { return }
  $detailsShards = Merge-WorkerJsonlShards 'records-details-worker-*.jsonl' (Join-Path $OutDir 'records-details.jsonl') $false
  $failureShards = Merge-WorkerJsonlShards 'failures-worker-*.jsonl' (Join-Path $OutDir 'failures.jsonl') $true
  $eventShards = Merge-WorkerJsonlShards 'events-worker-*.jsonl' (Join-Path $OutDir 'events.jsonl') $true
  $script:Stats.WorkerOutputShardsMerged = [pscustomobject]@{
    details = $detailsShards
    failures = $failureShards
    events = $eventShards
  }
}

function Run-FetchPass {
  $indexRows = Get-IndexRows
  if (-not $indexRows.Count) { throw "No index records found at $IndexPath" }
  if (-not $QueuePath) { $script:QueuePath = Join-Path $OutDir 'branch-queue.json' } else { $script:QueuePath = $QueuePath }
  Set-Variable -Scope Script -Name QueuePath -Value $script:QueuePath
  if (-not $Resume -or -not (Test-Path $QueuePath)) {
    Initialize-FetchQueue $indexRows
  }

  if ($Workers -le 1) {
    Run-FetchWorker
    return
  }

  $jobs = @()
  for ($i = 1; $i -le $Workers; $i++) {
    $args = @(
      '-NoProfile','-ExecutionPolicy','Bypass','-File',$ScriptPath,
      '-Mode','Fetch',
      '-Client',$Client,
      '-QueueGranularity',$QueueGranularity,
      '-WorkerMode',
      '-WorkerId',$i,
      '-QueuePath',$QueuePath,
      '-IndexPath',$IndexPath,
      '-SnapshotDir',$SnapshotDir,
      '-OutDir',$OutDir,
      '-GlobalRps',([string]$GlobalRps),
      '-WorkerRps',([string]$WorkerRps),
      '-TimeoutSec',([string]$TimeoutSec),
      '-BackoffSeconds',([string]$BackoffSeconds),
      '-MaxRetries',([string]$MaxRetries),
      '-MaxRecords',([string]$MaxRecords),
      '-MaxPagesPerBranch',([string]$MaxPagesPerBranch),
      '-UsePageSnapshots',([string]([int][bool]$UsePageSnapshots)),
      '-FetchFromSnapshots',([string]([int][bool]$FetchFromSnapshots)),
      '-ShardWorkerOutputs',([string]([int][bool]$ShardWorkerOutputs))
    )
    if ($StopOnMismatch) { $args += '-StopOnMismatch' }
    if ($StopOnBlocked) { $args += '-StopOnBlocked' }
    $jobs += Start-Job -ScriptBlock {
      param($PowerShellArgs)
      powershell @PowerShellArgs
    } -ArgumentList (,$args)
  }

  Wait-Job -Job $jobs | Out-Null
  foreach ($job in $jobs) {
    Receive-Job -Job $job -ErrorAction Continue
  }
  Remove-Job -Job $jobs -Force
  Merge-WorkerOutputs
  Save-State
}

Initialize-ProniClient
Write-Event 'run-start' @{ mode=$Mode; client=$Client; letters=($Letters -join ','); maxBranches=$MaxBranches; maxRecords=$MaxRecords; workers=$Workers }

if ($WorkerMode) {
  if (-not $QueuePath) { throw 'WorkerMode requires QueuePath.' }
  Run-FetchWorker
} elseif ($Mode -eq 'Index') {
  Run-IndexPass
} elseif ($Mode -eq 'Quick') {
  Run-IndexPass
} elseif ($Mode -eq 'Both') {
  Run-IndexPass -FetchNow
} elseif ($Mode -eq 'Fetch') {
  Run-FetchPass
}

Add-DerivedRunStats
$script:Stats.FinishedAt = (Get-Date).ToUniversalTime().ToString('o')
[pscustomobject]$script:Stats | ConvertTo-Json -Depth 30 | Set-Content -Path $SummaryPath -Encoding UTF8
"PRONI_CRAWL_SUMMARY $SummaryPath"
