# Lists the user's recently opened files and folders as JSON, newest first:
# [{ "name": "...", "lnk": "<shortcut path>", "target": "<file path>", "folder": false, "time": <ms> }].
#
# Windows keeps a shortcut (.lnk) in %AppData%\Microsoft\Windows\Recent for
# each file and folder opened through Explorer or the file dialogs. The island
# opens an item through that shortcut, so its shell rule only has to allow
# .lnk files in this one folder. Shortcuts whose target no longer exists, and
# those pointing at the network (which can hang while resolving), are left out.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$folder = Join-Path $env:APPDATA 'Microsoft\Windows\Recent'
$shell = New-Object -ComObject WScript.Shell
$epoch = [DateTime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)

$items = foreach ($lnk in Get-ChildItem -LiteralPath $folder -Filter *.lnk -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 60) {
  try { $target = $shell.CreateShortcut($lnk.FullName).TargetPath } catch { continue }
  if (-not $target -or $target.StartsWith('\\')) { continue }
  if (-not (Test-Path -LiteralPath $target)) { continue }
  [pscustomobject]@{
    name   = [IO.Path]::GetFileName($target.TrimEnd('\'))
    lnk    = $lnk.FullName
    target = $target
    folder = (Test-Path -LiteralPath $target -PathType Container)
    time   = [long]($lnk.LastWriteTimeUtc - $epoch).TotalMilliseconds
  }
}

@($items | Select-Object -First 40) | ConvertTo-Json -Compress
