# Upload FGB map files to Neocities from local machine
# Usage: .\scripts\upload-maps.ps1 -Token "your-neocities-api-token"

param(
    [Parameter(Mandatory = $true)]
    [string]$Token
)

$baseDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$mapsDir = Join-Path $baseDir "data\maps"

if (-not (Test-Path $mapsDir)) {
    Write-Error "Maps directory not found: $mapsDir"
    exit 1
}

# Find all FGB files
$files = Get-ChildItem -Path $mapsDir -Recurse -Filter "*.fgb"
$total = $files.Count
$count = 0
$failed = 0

Write-Host "Found $total FGB files to upload from $mapsDir" -ForegroundColor Cyan
Write-Host ""

foreach ($file in $files) {
    $count++
    $relativePath = $file.FullName.Substring($baseDir.Length + 1).Replace('\', '/')
    
    Write-Host "[$count/$total] Uploading: $relativePath" -ForegroundColor Gray
    
    $success = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $result = & curl.exe -s -w "%{http_code}" `
                -H "Authorization: Bearer $Token" `
                -F "$relativePath=@$($file.FullName)" `
                "https://neocities.org/api/upload" 2>&1
            
            $resultStr = [string]$result
            $httpCode = $resultStr.Substring($resultStr.Length - 3)
            
            if ($httpCode -eq "200") {
                $success = $true
                break
            }
            else {
                Write-Host "  Attempt $attempt failed (HTTP $httpCode)" -ForegroundColor Yellow
                Start-Sleep -Seconds 3
            }
        }
        catch {
            Write-Host "  Attempt $attempt error: $_" -ForegroundColor Yellow
            Start-Sleep -Seconds 3
        }
    }
    
    if (-not $success) {
        Write-Host "  FAILED: $relativePath" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
if ($failed -gt 0) {
    Write-Host "Upload complete. Total: $total, Failed: $failed" -ForegroundColor Yellow
}
else {
    Write-Host "Upload complete. Total: $total, all succeeded!" -ForegroundColor Green
}
