Catholic_Dioceses.fgb chunk parts

These files were split from Catholic_Dioceses.fgb for repository storage.

Reassemble in PowerShell (from this folder):
  Get-ChildItem Catholic_Dioceses.fgb.part* | Sort-Object Name | Get-Content -AsByteStream | Set-Content -AsByteStream Catholic_Dioceses.fgb