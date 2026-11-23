# Lists the apps in the Start menu as JSON: [{ "Name": "...", "AppID": "..." }].
# Every entry can be opened with `explorer.exe shell:AppsFolder\<AppID>`.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-StartApps |
  Where-Object { $_.Name -and $_.AppID } |
  Sort-Object Name -Unique |
  Select-Object Name, AppID |
  ConvertTo-Json -Compress
