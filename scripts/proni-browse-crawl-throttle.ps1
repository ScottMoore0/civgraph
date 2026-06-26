param(
  [string[]]$Letters = @('A'),
  [double[]]$Steps = @(1,2,4,8,10),
  [string]$StepList = '',
  [int]$StepRecords = 100,
  [int]$MaxRecords = 500,
  [int]$MaxBranchPages = 500,
  [int]$TimeoutSec = 15,
  [double]$StopP95Ms = 5000,
  [double]$StopErrorRate = 0.02,
  [string]$OutDir = 'tmp/proni-crawl'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ($StepList.Trim()) {
  $Steps = @($StepList -split ',' | ForEach-Object { [double]::Parse($_.Trim(), [Globalization.CultureInfo]::InvariantCulture) })
}

$Base = 'https://apps.proni.gov.uk/eCatNI_IE/'
$Ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148 Safari/537.36'
$Headers = @{
  'User-Agent' = $Ua
  'Accept' = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  'Accept-Language' = 'en-US,en;q=0.9,en-GB;q=0.8'
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = "$(Get-Date -Format 'yyyy-MM-ddTHH-mm-ss-fffZ')-pid$PID"
$RecordsPath = Join-Path $OutDir "records-$stamp.jsonl"
$SummaryPath = Join-Path $OutDir "throttle-summary-$stamp.json"
$CrawlLogPath = Join-Path $OutDir "crawl-log-$stamp.jsonl"

$script:Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$SeenRecords = New-Object 'System.Collections.Generic.HashSet[string]'
$SeenBranches = New-Object 'System.Collections.Generic.HashSet[string]'
$Queue = New-Object System.Collections.Queue

function Write-JsonLine([string]$Path, [object]$Value) {
  ($Value | ConvertTo-Json -Compress -Depth 20) | Add-Content -Path $Path -Encoding UTF8
}

function Log-Crawl([hashtable]$Event) {
  $Event['at'] = (Get-Date).ToUniversalTime().ToString('o')
  Write-JsonLine $CrawlLogPath ([pscustomobject]$Event)
}

function Html-Decode([string]$Value) {
  if ($null -eq $Value) { return '' }
  return [System.Net.WebUtility]::HtmlDecode($Value)
}

function Strip-Html([string]$Html) {
  if ($null -eq $Html) { return '' }
  $text = [regex]::Replace($Html, '<script[\s\S]*?</script>', ' ', 'IgnoreCase')
  $text = [regex]::Replace($text, '<style[\s\S]*?</style>', ' ', 'IgnoreCase')
  $text = [regex]::Replace($text, '<[^>]+>', ' ')
  $text = Html-Decode $text
  return ([regex]::Replace($text, '\s+', ' ').Trim())
}

function Parse-Inputs([string]$Html) {
  $dict = [ordered]@{}
  foreach ($m in [regex]::Matches($Html, '<input\b[^>]*>', 'IgnoreCase')) {
    $tag = $m.Value
    $nameMatch = [regex]::Match($tag, '\bname="([^"]*)"', 'IgnoreCase')
    if (-not $nameMatch.Success) { continue }
    $typeMatch = [regex]::Match($tag, '\btype="([^"]*)"', 'IgnoreCase')
    $type = if ($typeMatch.Success) { $typeMatch.Groups[1].Value.ToLowerInvariant() } else { 'text' }
    if ($type -in @('submit','image','button')) { continue }
    $valueMatch = [regex]::Match($tag, '\bvalue="([^"]*)"', 'IgnoreCase')
    $name = Html-Decode $nameMatch.Groups[1].Value
    $value = if ($valueMatch.Success) { Html-Decode $valueMatch.Groups[1].Value } else { '' }
    if (-not $dict.Contains($name)) { $dict[$name] = $value }
  }
  return $dict
}

function Invoke-ProniGet([string]$Uri) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri $Uri -WebSession $script:Session -Headers $Headers -TimeoutSec $TimeoutSec
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

function Invoke-ProniPost([string]$Uri, [string]$Html, [hashtable]$Extra) {
  $body = Parse-Inputs $Html
  foreach ($key in @('__LASTFOCUS','__EVENTTARGET','__EVENTARGUMENT')) {
    if ($body.Contains($key) -and -not $Extra.ContainsKey($key)) { $body[$key] = '' }
  }
  if ($body.Contains('__SCROLLPOSITIONX')) { $body['__SCROLLPOSITIONX'] = '0' }
  if ($body.Contains('__SCROLLPOSITIONY')) { $body['__SCROLLPOSITIONY'] = '0' }
  foreach ($key in $Extra.Keys) { $body[$key] = $Extra[$key] }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Method Post -Body $body -WebSession $script:Session -Headers ($Headers + @{ Referer=$Uri }) -TimeoutSec $TimeoutSec
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

function Test-Throttle([object]$Res) {
  if (-not $Res.Ok) { return $true }
  if ($Res.Status -ne 200) { return $true }
  if ($Res.Content -match 'Request Rejected|support ID|Access Denied|Too Many Requests|rate limit|throttl') { return $true }
  if ($Res.Ms -gt 10000) { return $true }
  return $false
}

function Get-FailureReason([object]$Res) {
  if ($Res.Ok -and $Res.Status -eq 200 -and -not (Test-Throttle $Res)) { return '' }
  if (-not $Res.Ok) { return $Res.Error }
  if ($Res.Status -ne 200) { return "http $($Res.Status)" }
  if ($Res.Content -match 'Request Rejected|support ID') { return 'waf request rejected' }
  if ($Res.Content -match 'Too Many Requests|rate limit|throttl') { return 'rate-limit text' }
  if ($Res.Ms -gt 10000) { return 'slow response >10s' }
  return 'unknown failure'
}

function Parse-GridRows([string]$Html) {
  $map = [ordered]@{}
  foreach ($m in [regex]::Matches($Html, '<input\b[^>]*GridView1\$ctl(\d+)\$(ResultsSelect|ResultsView)[^>]*>', 'IgnoreCase')) {
    $tag = $m.Value
    $ctl = "ctl$($m.Groups[1].Value)"
    $kind = $m.Groups[2].Value
    $name = Html-Decode ([regex]::Match($tag, '\bname="([^"]*)"', 'IgnoreCase').Groups[1].Value)
    $valueMatch = [regex]::Match($tag, '\bvalue="([^"]*)"', 'IgnoreCase')
    $value = if ($valueMatch.Success) { Html-Decode $valueMatch.Groups[1].Value } else { '' }
    $disabled = $tag -match '\bdisabled\b'
    if (-not $map.Contains($ctl)) { $map[$ctl] = [ordered]@{ Ctl=$ctl } }
    $map[$ctl][$kind] = [ordered]@{ Name=$name; Value=$value; Disabled=$disabled }
  }
  return @($map.Values)
}

function Find-NextButton([string]$Html) {
  foreach ($m in [regex]::Matches($Html, '<input\b[^>]*>', 'IgnoreCase')) {
    $tag = $m.Value
    $type = [regex]::Match($tag, '\btype="([^"]*)"', 'IgnoreCase').Groups[1].Value.ToLowerInvariant()
    if ($type -ne 'submit') { continue }
    if ($tag -match '\bdisabled\b') { continue }
    $value = Html-Decode ([regex]::Match($tag, '\bvalue="([^"]*)"', 'IgnoreCase').Groups[1].Value)
    $title = Html-Decode ([regex]::Match($tag, '\btitle="([^"]*)"', 'IgnoreCase').Groups[1].Value)
    $class = Html-Decode ([regex]::Match($tag, '\bclass="([^"]*)"', 'IgnoreCase').Groups[1].Value)
    if ($value -notmatch '^Next$' -and $title -notmatch '^Next$' -and $class -notmatch '\bNextBtn\b') { continue }
    $name = Html-Decode ([regex]::Match($tag, '\bname="([^"]*)"', 'IgnoreCase').Groups[1].Value)
    if ($name) { return [pscustomobject]@{ Name=$name; Value=$value } }
  }
  return $null
}

function Extract-DetailFields([string]$Html) {
  $wanted = @('Repository','PRONI Reference','Level','Access','Title','Dates','Description','Digital Record')
  $result = [ordered]@{}
  foreach ($key in $wanted) { $result[$key] = '' }
  foreach ($tr in [regex]::Matches($Html, '<tr\b[\s\S]*?</tr>', 'IgnoreCase')) {
    $rowHtml = $tr.Value
    $label = Strip-Html ([regex]::Match($rowHtml, '<label\b[^>]*>([\s\S]*?)</label>', 'IgnoreCase').Groups[1].Value)
    if (-not $label) { continue }
    $key = $label.TrimEnd(':').Trim()
    $canonical = $wanted | Where-Object { $_.ToLowerInvariant() -eq $key.ToLowerInvariant() } | Select-Object -First 1
    if (-not $canonical) { continue }
    $cells = @()
    foreach ($td in [regex]::Matches($rowHtml, '<td\b[^>]*>([\s\S]*?)</td>', 'IgnoreCase')) {
      $cell = Strip-Html $td.Groups[1].Value
      if ($cell) { $cells += $cell }
    }
    if ($cells.Count -ge 2) { $result[$canonical] = ($cells[1..($cells.Count - 1)] -join ' ').Trim() }
  }
  if ($result['Digital Record'] -match '^\[?\d+\s*-') { $result['Digital Record'] = '' }
  return [pscustomobject]$result
}

function Click-Select([string]$Html, [object]$Row) {
  if (-not $Row.ResultsSelect -or $Row.ResultsSelect.Disabled) { return $null }
  $res = Invoke-ProniPost "$Base`BrowseSearchResults.aspx" $Html @{ $Row.ResultsSelect.Name = $Row.ResultsSelect.Value }
  if (Test-Throttle $res) { throw "Select $($Row.ResultsSelect.Value) failed: $(Get-FailureReason $res)" }
  return $res.Content
}

function Click-More([string]$Html, [object]$Row) {
  if (-not $Row.ResultsView) { throw "More missing for $($Row.ResultsSelect.Value)" }
  return Invoke-ProniPost "$Base`BrowseSearchResults.aspx" $Html @{ $Row.ResultsView.Name = $Row.ResultsView.Value }
}

function Start-BrowseLetter([string]$Letter) {
  $res = Invoke-ProniGet "$Base`SearchPage.aspx"
  if (Test-Throttle $res) { throw "Search page failed: $(Get-FailureReason $res)" }
  $res = Invoke-ProniPost "$Base`SearchPage.aspx" $res.Content @{ '__EVENTTARGET'='ctl00$siteNav1$linkBtnBrowse'; '__EVENTARGUMENT'='' }
  if (Test-Throttle $res) { throw "Browse nav failed: $(Get-FailureReason $res)" }
  $res = Invoke-ProniPost "$Base`BrowseSearchPage.aspx" $res.Content @{ "ctl00`$ContentPlaceHolder1`$AZButton_$Letter" = $Letter }
  if (Test-Throttle $res) { throw "Letter $Letter failed: $(Get-FailureReason $res)" }
  return $res.Content
}

function Click-SelectByRef([string]$Html, [string]$Ref) {
  $rows = Parse-GridRows $Html
  foreach ($row in $rows) {
    if ($row.ResultsSelect -and $row.ResultsSelect.Value -eq $Ref -and -not $row.ResultsSelect.Disabled) {
      return Click-Select $Html $row
    }
  }
  throw "Could not find selectable branch $Ref"
}

function Open-Branch([object]$Branch) {
  $script:Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $html = Start-BrowseLetter $Branch.Letter
  foreach ($ref in $Branch.Path) {
    $html = Click-SelectByRef $html $ref
  }
  return $html
}

function Get-Percentile([double[]]$Values, [double]$P) {
  if (-not $Values -or $Values.Count -eq 0) { return 0 }
  $sorted = @($Values | Sort-Object)
  $idx = [Math]::Min($sorted.Count - 1, [Math]::Max(0, [Math]::Ceiling(($P / 100.0) * $sorted.Count) - 1))
  return [double]$sorted[$idx]
}

foreach ($letter in $Letters) {
  $Queue.Enqueue([pscustomobject]@{ Letter=$letter; Ref="letter:$letter"; Path=@(); Depth=0 })
  Log-Crawl @{ Type='letter-enqueued'; Letter=$letter }
}

$summaries = @()

foreach ($rps in $Steps) {
  if ($SeenRecords.Count -ge $MaxRecords) { break }
  $stepStarted = [Diagnostics.Stopwatch]::StartNew()
  $records = New-Object System.Collections.Generic.List[object]
  $branchPagesVisited = 0
  $scheduled = 0
  $stopped = $false
  $stopReason = ''
  $target = [Math]::Min($StepRecords, $MaxRecords - $SeenRecords.Count)

  while ($records.Count -lt $target -and $Queue.Count -gt 0 -and $branchPagesVisited -lt $MaxBranchPages -and -not $stopped) {
    $branch = $Queue.Dequeue()
    $branchKey = "$($branch.Letter)|$(($branch.Path -join '>'))"
    if ($SeenBranches.Contains($branchKey)) { continue }
    [void]$SeenBranches.Add($branchKey)
    try {
      $html = Open-Branch $branch
    } catch {
      Log-Crawl @{ Type='branch-open-error'; Ref=$branch.Ref; Path=($branch.Path -join '>'); Error=$_.Exception.Message }
      continue
    }
    $page = 1
    while ($html -and $records.Count -lt $target -and $branchPagesVisited -lt $MaxBranchPages -and -not $stopped) {
      $branchPagesVisited++
      $rows = Parse-GridRows $html
      Log-Crawl @{ Type='page'; Rps=$rps; Branch=$branch.Ref; Page=$page; Rows=$rows.Count }
      foreach ($row in $rows) {
        if ($records.Count -ge $target -or $SeenRecords.Count -ge $MaxRecords) { break }
        if (-not $row.ResultsSelect -or -not $row.ResultsSelect.Value) { continue }
        $ref = [string]$row.ResultsSelect.Value
        if ($SeenRecords.Contains($ref)) { continue }
        [void]$SeenRecords.Add($ref)

        $targetSeconds = $scheduled / [double]$rps
        $elapsedSeconds = $stepStarted.Elapsed.TotalSeconds
        $sleepMs = [Math]::Floor([Math]::Max(0, ($targetSeconds - $elapsedSeconds) * 1000))
        if ($sleepMs -gt 0) { Start-Sleep -Milliseconds $sleepMs }
        $scheduled++

        $detail = Click-More $html $row
        $failure = Get-FailureReason $detail
        $throttle = Test-Throttle $detail
        $fields = if ($throttle) { $null } else { Extract-DetailFields $detail.Content }
        $record = [pscustomobject]@{
          At=(Get-Date).ToUniversalTime().ToString('o')
          TargetRps=$rps
          Ref=$ref
          Status=$detail.Status
          Ms=[Math]::Round($detail.Ms, 3)
          Throttle=$throttle
          Failure=$failure
          Fields=$fields
          SourceBranch=$branch.Ref
          SourceDepth=$branch.Depth
          SourcePage=$page
        }
        Write-JsonLine $RecordsPath $record
        $records.Add($record)
        if ($throttle) {
          $stopped = $true
          $stopReason = if ($failure) { $failure } else { 'throttle' }
          break
        }
      }

      # Queue child paths, not child HTML. PRONI is ASP.NET WebForms; selecting
      # a child mutates session/page state, and saved child HTML can become
      # unreliable after multiple selects from the same parent. Reopening each
      # queued branch from the root path is slower but correct.
      if (-not $stopped) {
        foreach ($row in $rows) {
          if (-not $row.ResultsSelect -or -not $row.ResultsSelect.Value -or $row.ResultsSelect.Disabled) { continue }
          $ref = [string]$row.ResultsSelect.Value
          $childPath = @($branch.Path) + @($ref)
          $childKey = "$($branch.Letter)|$(($childPath -join '>'))"
          if ($SeenBranches.Contains($childKey)) { continue }
          $Queue.Enqueue([pscustomobject]@{ Letter=$branch.Letter; Ref=$ref; Path=$childPath; Depth=$branch.Depth + 1 })
          Log-Crawl @{ Type='branch-enqueued'; Ref=$ref; Depth=$branch.Depth + 1; Path=($childPath -join '>') }
        }
      }

      if ($records.Count -ge $target -or $stopped) { break }
      $next = Find-NextButton $html
      if (-not $next) { break }
      $nextRes = Invoke-ProniPost "$Base`BrowseSearchResults.aspx" $html @{ $next.Name = $next.Value }
      if (Test-Throttle $nextRes) {
        $stopped = $true
        $stopReason = "next page failed: $(Get-FailureReason $nextRes)"
        break
      }
      $html = $nextRes.Content
      $page++
    }
  }

  $duration = [Math]::Max(0.001, $stepStarted.Elapsed.TotalSeconds)
  $latencies = @($records | ForEach-Object { [double]$_.Ms })
  $failures = @($records | Where-Object { $_.Throttle -or $_.Status -ne 200 -or $_.Failure })
  $summary = [pscustomobject]@{
    TargetRps=$rps
    TargetRecords=$target
    Records=$records.Count
    ActualRps=[Math]::Round($records.Count / $duration, 4)
    DurationSeconds=[Math]::Round($duration, 3)
    BranchPagesVisited=$branchPagesVisited
    QueuedBranches=$Queue.Count
    SeenRecords=$SeenRecords.Count
    Failures=$failures.Count
    FailureRate=[Math]::Round($failures.Count / [Math]::Max(1, $records.Count), 6)
    AvgMs=if ($latencies.Count) { [Math]::Round(($latencies | Measure-Object -Average).Average, 3) } else { 0 }
    P50Ms=[Math]::Round((Get-Percentile $latencies 50), 3)
    P95Ms=[Math]::Round((Get-Percentile $latencies 95), 3)
    P99Ms=[Math]::Round((Get-Percentile $latencies 99), 3)
    MaxMs=if ($latencies.Count) { [Math]::Round(($latencies | Measure-Object -Maximum).Maximum, 3) } else { 0 }
    FirstFailure=if ($failures.Count) { $failures[0] } else { $null }
    Stopped=$stopped
    Reason=$stopReason
  }
  $summaries += $summary
  $summary | ConvertTo-Json -Depth 10 -Compress

  if ($stopped -or $summary.FailureRate -gt $StopErrorRate -or $summary.P95Ms -gt $StopP95Ms -or $records.Count -eq 0) {
    break
  }
}

$final = [pscustomobject]@{
  At=(Get-Date).ToUniversalTime().ToString('o')
  Config=[pscustomobject]@{
    Letters=$Letters
    Steps=$Steps
    StepRecords=$StepRecords
    MaxRecords=$MaxRecords
    MaxBranchPages=$MaxBranchPages
    TimeoutSec=$TimeoutSec
    StopP95Ms=$StopP95Ms
    StopErrorRate=$StopErrorRate
  }
  OutputPaths=[pscustomobject]@{ Records=$RecordsPath; Summary=$SummaryPath; CrawlLog=$CrawlLogPath }
  SeenRecords=$SeenRecords.Count
  QueuedBranches=$Queue.Count
  Summaries=$summaries
}
$final | ConvertTo-Json -Depth 20 | Set-Content -Path $SummaryPath -Encoding UTF8
"SUMMARY_FILE $SummaryPath"
"RECORDS_FILE $RecordsPath"
"CRAWL_LOG_FILE $CrawlLogPath"
