param(
  [string]$Letter = 'A',
  [string[]]$BranchPath = @('AA','AA/1','AA/1/2'),
  [string]$BranchPathCsv = '',
  [int]$RecordLimit = 12,
  [int]$TimeoutSec = 15,
  [string]$OutDir = 'tmp/proni-crawl'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Base = 'https://apps.proni.gov.uk/eCatNI_IE/'
$Ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148 Safari/537.36'
$Headers = @{
  'User-Agent' = $Ua
  'Accept' = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  'Accept-Language' = 'en-US,en;q=0.9,en-GB;q=0.8'
}

if ($BranchPathCsv.Trim()) {
  $BranchPath = @($BranchPathCsv -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$stamp = "$(Get-Date -Format 'yyyy-MM-ddTHH-mm-ss-fffZ')-pid$PID"
$summaryPath = Join-Path $OutDir "overhead-research-$stamp.json"

$script:Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

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

function Test-Failed([object]$Res) {
  if (-not $Res.Ok) { return $true }
  if ($Res.Status -ne 200) { return $true }
  if ($Res.Content -match 'Request Rejected|support ID|Access Denied|Too Many Requests|rate limit|throttl') { return $true }
  return $false
}

function Assert-Ok([object]$Res, [string]$Context) {
  if (Test-Failed $Res) {
    $reason = if ($Res.Error) { $Res.Error } elseif ($Res.Status -ne 200) { "HTTP $($Res.Status)" } else { 'blocked/throttled response text' }
    throw "$Context failed: $reason"
  }
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

function Start-BrowseLetter([string]$TargetLetter) {
  $res = Invoke-ProniGet "$Base`SearchPage.aspx"
  Assert-Ok $res 'SearchPage'
  $res = Invoke-ProniPost "$Base`SearchPage.aspx" $res.Content @{ '__EVENTTARGET'='ctl00$siteNav1$linkBtnBrowse'; '__EVENTARGUMENT'='' }
  Assert-Ok $res 'Browse nav'
  $res = Invoke-ProniPost "$Base`BrowseSearchPage.aspx" $res.Content @{ "ctl00`$ContentPlaceHolder1`$AZButton_$TargetLetter" = $TargetLetter }
  Assert-Ok $res "Letter $TargetLetter"
  return $res.Content
}

function Click-Select([string]$Html, [object]$Row) {
  if (-not $Row.ResultsSelect -or $Row.ResultsSelect.Disabled) { throw "Row is not selectable: $($Row.ResultsSelect.Value)" }
  $res = Invoke-ProniPost "$Base`BrowseSearchResults.aspx" $Html @{ $Row.ResultsSelect.Name = $Row.ResultsSelect.Value }
  Assert-Ok $res "Select $($Row.ResultsSelect.Value)"
  return $res.Content
}

function Click-More([string]$Html, [object]$Row) {
  if (-not $Row.ResultsView) { throw "More is missing for $($Row.ResultsSelect.Value)" }
  $res = Invoke-ProniPost "$Base`BrowseSearchResults.aspx" $Html @{ $Row.ResultsView.Name = $Row.ResultsView.Value }
  Assert-Ok $res "More $($Row.ResultsSelect.Value)"
  return $res
}

function Click-SelectByRef([string]$Html, [string]$Ref) {
  foreach ($row in (Parse-GridRows $Html)) {
    if ($row.ResultsSelect -and $row.ResultsSelect.Value -eq $Ref -and -not $row.ResultsSelect.Disabled) {
      return Click-Select $Html $row
    }
  }
  throw "Could not find selectable branch $Ref"
}

function Open-BranchSnapshot([string]$TargetLetter, [string[]]$Path) {
  $script:Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $html = Start-BrowseLetter $TargetLetter
  foreach ($ref in $Path) {
    $html = Click-SelectByRef $html $ref
  }
  return $html
}

function Measure-Operation([scriptblock]$Block) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $value = & $Block
  $sw.Stop()
  return [pscustomobject]@{ Value=$value; Ms=$sw.Elapsed.TotalMilliseconds }
}

$branchOpen = Measure-Operation { Open-BranchSnapshot $Letter $BranchPath }
$branchHtml = [string]$branchOpen.Value
$leafRows = @(Parse-GridRows $branchHtml | Where-Object { $_.ResultsView -and (-not $_.ResultsSelect -or $_.ResultsSelect.Disabled) } | Select-Object -First $RecordLimit)
if (-not $leafRows.Count) {
  $leafRows = @(Parse-GridRows $branchHtml | Where-Object { $_.ResultsView } | Select-Object -First $RecordLimit)
}

$reuseResults = @()
$reuseByCtl = @{}
foreach ($row in $leafRows) {
  $res = Measure-Operation { Click-More $branchHtml $row }
  $fields = Extract-DetailFields $res.Value.Content
  $item = [pscustomobject]@{
    Ctl=$row.Ctl
    ExtractedRef=$fields.'PRONI Reference'
    DistinctRef=[bool]$fields.'PRONI Reference'
    Ms=$res.Ms
    Title=$fields.Title
  }
  $reuseByCtl[$row.Ctl] = $item
  $reuseResults += $item
}

$indexedResults = @()
foreach ($row in ($leafRows | Select-Object -First ([Math]::Min(5, $leafRows.Count)))) {
  $open = Measure-Operation { Open-BranchSnapshot $Letter $BranchPath }
  $freshRows = Parse-GridRows $open.Value
  $freshRow = $freshRows | Where-Object { $_.ResultsView -and $_.Ctl -eq $row.Ctl } | Select-Object -First 1
  if (-not $freshRow) {
    $indexedResults += [pscustomobject]@{ Ctl=$row.Ctl; ExpectedRef=$reuseByCtl[$row.Ctl].ExtractedRef; Found=$false; Match=$false; OpenMs=$open.Ms; DetailMs=0; ExtractedRef=''; Title='' }
    continue
  }
  $detail = Measure-Operation { Click-More $open.Value $freshRow }
  $fields = Extract-DetailFields $detail.Value.Content
  $indexedResults += [pscustomobject]@{
    Ctl=$row.Ctl
    ExpectedRef=$reuseByCtl[$row.Ctl].ExtractedRef
    Found=$true
    Match=($fields.'PRONI Reference' -eq $reuseByCtl[$row.Ctl].ExtractedRef)
    OpenMs=$open.Ms
    DetailMs=$detail.Ms
    ExtractedRef=$fields.'PRONI Reference'
    Title=$fields.Title
  }
}

$nodeProbe = $null
try {
  $nodeProbe = node -e "fetch('https://apps.proni.gov.uk/eCatNI_IE/SearchPage.aspx',{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148 Safari/537.36','Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9,en-GB;q=0.8'}}).then(async r=>{const t=await r.text(); console.log(JSON.stringify({ok:r.ok,status:r.status,blocked:/Request Rejected|support ID|Access Denied/.test(t),bytes:t.length,title:(t.match(/<title[^>]*>([^<]*)/i)||[])[1]||''}))}).catch(e=>{console.log(JSON.stringify({ok:false,error:String(e)}))})" 2>$null
} catch {
  $nodeProbe = (@{ ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress)
}

$summary = [pscustomobject]@{
  At=(Get-Date).ToUniversalTime().ToString('o')
  Config=[pscustomobject]@{ Letter=$Letter; BranchPath=$BranchPath; RecordLimit=$RecordLimit }
  BranchOpenMs=[Math]::Round($branchOpen.Ms, 3)
  LeafRows=$leafRows.Count
  Reuse=[pscustomobject]@{
    Tested=$reuseResults.Count
    DistinctRefs=@($reuseResults | Select-Object -ExpandProperty ExtractedRef -Unique).Count
    MissingRefs=@($reuseResults | Where-Object { -not $_.ExtractedRef }).Count
    AvgDetailMs=if ($reuseResults.Count) { [Math]::Round(($reuseResults | Measure-Object Ms -Average).Average, 3) } else { 0 }
    MaxDetailMs=if ($reuseResults.Count) { [Math]::Round(($reuseResults | Measure-Object Ms -Maximum).Maximum, 3) } else { 0 }
    Results=$reuseResults
  }
  IndexedReopen=[pscustomobject]@{
    Tested=$indexedResults.Count
    Found=@($indexedResults | Where-Object Found).Count
    Matches=@($indexedResults | Where-Object Match).Count
    AvgOpenMs=if ($indexedResults.Count) { [Math]::Round(($indexedResults | Measure-Object OpenMs -Average).Average, 3) } else { 0 }
    AvgDetailMs=if ($indexedResults.Count) { [Math]::Round(($indexedResults | Measure-Object DetailMs -Average).Average, 3) } else { 0 }
    Results=$indexedResults
  }
  ClientProbe=[pscustomobject]@{
    PowerShellInvokeWebRequest='passed all Browse operations above'
    NodeFetchRaw=$nodeProbe
  }
}

$summary | ConvertTo-Json -Depth 20 | Set-Content -Path $summaryPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 8 -Compress
"SUMMARY_FILE $summaryPath"
