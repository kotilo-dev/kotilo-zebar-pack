# Starts a Start menu app as administrator, for the island's launcher (Ctrl+Shift+Enter).
#
# Runs as a long-lived process: the island starts it (shellSpawn) and writes one
# request per line to stdin; each answer is one JSON line on stdout. The AppID is
# sent hex-encoded (UTF-8 bytes).
#   run <hex AppID>  -> {"ok":true}
#                       {"ok":false,"error":"unsupported"}  a Store app, which cannot run as administrator
#                       {"ok":false,"error":"cancelled"}    the UAC prompt was declined
#
# Only names Get-StartApps lists are started, so nothing else can be run elevated through this helper.
# Windows still asks for consent (UAC) every time.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function ConvertFrom-HexUtf8([string]$hex) {
  if ($hex -notmatch '^[0-9a-fA-F]+$' -or ($hex.Length % 2) -ne 0) { throw 'Argument must be hex-encoded' }
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring(2 * $i, 2), 16) }
  (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes)
}

# Windows offers "Run as administrator" for desktop apps and for packaged apps that run as full-trust
# desktop programs (Paint, Terminal), not for Store apps (Calculator, Clock). A packaged AppID is
# "<package family>!<app id>"; its manifest's EntryPoint tells which kind it is. Without the check,
# Windows answers an unsupported app with the same "cancelled" error as a declined UAC prompt.
function Test-CanElevate([string]$appId) {
  if ($appId -notmatch '!') { return $true }
  $family, $id = $appId -split '!', 2
  $package = Get-AppxPackage | Where-Object PackageFamilyName -eq $family | Select-Object -First 1
  if (-not $package) { return $true }
  $app = (Get-AppxPackageManifest $package).Package.Applications.Application | Where-Object Id -eq $id | Select-Object -First 1
  if (-not $app -or -not $app.EntryPoint) { return $true }
  return $app.EntryPoint -eq 'Windows.FullTrustApplication'
}

# The program file behind a Start menu entry, with the shortcut's arguments. Elevation tools that take
# over "Run as administrator" (Admin By Request, for one) need a real file: given the
# "shell:AppsFolder\<AppID>" name they fail with "The given path's format is not supported".
#   Desktop apps: the shortcut's target, which Windows keeps on the AppsFolder item.
#   Packaged full-trust apps (Paint, Terminal): the manifest's Executable in the install folder.
# Anything else (a shell folder such as Control Panel) keeps the AppsFolder name, which plain UAC accepts.
function Resolve-Target([string]$appId) {
  $item = (New-Object -ComObject Shell.Application).NameSpace('shell:AppsFolder').ParseName($appId)
  if ($item) {
    $file = [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
    if ($file -and [IO.Path]::IsPathRooted($file) -and [IO.File]::Exists($file)) {
      return @{ file = $file; arguments = [string]$item.ExtendedProperty('System.Link.Arguments') }
    }
  }
  if ($appId -match '!') {
    $family, $id = $appId -split '!', 2
    $package = Get-AppxPackage | Where-Object PackageFamilyName -eq $family | Select-Object -First 1
    if ($package) {
      $app = (Get-AppxPackageManifest $package).Package.Applications.Application | Where-Object Id -eq $id | Select-Object -First 1
      if ($app -and $app.Executable) {
        $file = Join-Path $package.InstallLocation $app.Executable
        if ([IO.File]::Exists($file)) { return @{ file = $file; arguments = '' } }
      }
    }
  }
  @{ file = "shell:AppsFolder\$appId"; arguments = '' }
}

function Start-Elevated([string]$appId) {
  if (-not (Get-StartApps | Where-Object AppID -eq $appId)) { return @{ ok = $false; error = 'Not a Start menu app' } }
  if (-not (Test-CanElevate $appId)) { return @{ ok = $false; error = 'unsupported' } }
  $target = Resolve-Target $appId
  if ($env:KOTILO_DRY_RUN) { return @{ ok = $true; dryRun = $true; file = $target.file; arguments = $target.arguments } }
  $start = @{ FilePath = $target.file; Verb = 'RunAs' }
  if ($target.arguments) { $start.ArgumentList = $target.arguments }
  if ([IO.File]::Exists($target.file)) { $start.WorkingDirectory = [IO.Path]::GetDirectoryName($target.file) }
  try {
    Start-Process @start
  } catch {
    # ERROR_CANCELLED (1223): the user said No to the UAC prompt.
    $native = $_.Exception.InnerException -as [ComponentModel.Win32Exception]
    if (($native -and $native.NativeErrorCode -eq 1223) -or $_.Exception.Message -match 'canceled by the user') {
      return @{ ok = $false; error = 'cancelled' }
    }
    throw
  }
  @{ ok = $true }
}

function Invoke-Request([string]$line) {
  $parts = $line.Trim() -split ' ', 2
  switch ($parts[0]) {
    'run' {
      if ($parts.Count -lt 2 -or -not $parts[1].Trim()) { return @{ ok = $false; error = 'No app' } }
      return Start-Elevated (ConvertFrom-HexUtf8 $parts[1].Trim())
    }
    default { return @{ ok = $false; error = "Unknown request '$($parts[0])'" } }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  try { $answer = Invoke-Request $line } catch { $answer = @{ ok = $false; error = $(if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }) } }
  [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 4))
}
