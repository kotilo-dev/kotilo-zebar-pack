# Quick system toggles for the island's control centre: keep awake, app theme
# (light/dark) and display brightness.
#
# Runs as a long-lived process: the island starts it once (shellSpawn) and
# writes one request per line to stdin; each answer is one JSON line on stdout.
#   status            -> {"ok":true,"awake":bool,"theme":"dark"|"light","brightness":0-100|null}
#   awake on|off      -> same as status
#   theme dark|light  -> same as status
#   brightness <5-100> -> same as status
#
# Keep awake asks Windows not to sleep while this process runs
# (SetThreadExecutionState with ES_CONTINUOUS | ES_SYSTEM_REQUIRED). It never
# sets ES_DISPLAY_REQUIRED: the screen still turns off and locks on the
# organisation's schedule. When the process ends (Zebar closes), Windows drops
# the request by itself.
#
# Theme writes the two per-user values the Settings app writes
# (HKCU ...\Themes\Personalize: AppsUseLightTheme, SystemUsesLightTheme) and
# tells running apps that the colour set changed. No administrator rights.
#
# Brightness uses WMI (WmiMonitorBrightnessMethods); it is null on displays
# without that support (most external monitors).
#
# With $env:KOTILO_DRY_RUN = '1' nothing is changed; answers say what would be.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Namespace Kotilo -Name Tweaks -MemberDefinition @'
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint msg, System.UIntPtr wParam, string lParam, uint flags, uint timeout, out System.UIntPtr result);
'@

$DryRun = $env:KOTILO_DRY_RUN -eq '1'
$PersonalizeKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1
$Awake = $false

function Get-Theme {
  $v = (Get-ItemProperty -LiteralPath $PersonalizeKey -Name AppsUseLightTheme -ErrorAction SilentlyContinue).AppsUseLightTheme
  if ($v -eq 1) { 'light' } else { 'dark' }
}

function Get-Brightness {
  try {
    $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
    if ($b) { [int]$b.CurrentBrightness } else { $null }
  } catch { $null }
}

function Get-Status {
  @{ ok = $true; awake = $script:Awake; theme = (Get-Theme); brightness = (Get-Brightness); dryRun = $DryRun }
}

function Set-Awake([bool]$on) {
  $flags = if ($on) { $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED } else { $ES_CONTINUOUS }
  if (-not $DryRun) {
    if ([Kotilo.Tweaks]::SetThreadExecutionState($flags) -eq 0) { throw 'SetThreadExecutionState failed' }
  }
  $script:Awake = $on
}

function Set-Theme([string]$theme) {
  # Re-checked here, next to the write: only the two known words get through.
  if ($theme -ne 'dark' -and $theme -ne 'light') { throw "Unknown theme '$theme'" }
  if ($DryRun) { return }
  $value = if ($theme -eq 'light') { 1 } else { 0 }
  Set-ItemProperty -LiteralPath $PersonalizeKey -Name AppsUseLightTheme -Value $value -Type DWord
  Set-ItemProperty -LiteralPath $PersonalizeKey -Name SystemUsesLightTheme -Value $value -Type DWord
  $result = [System.UIntPtr]::Zero
  # HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG, 1 s per window
  [Kotilo.Tweaks]::SendMessageTimeout([System.IntPtr]0xffff, 0x1A, [System.UIntPtr]::Zero, 'ImmersiveColorSet', 2, 1000, [ref]$result) | Out-Null
}

function Set-Brightness([int]$level) {
  # Never below 5: at 0 many panels go black and the slider cannot be found again.
  if ($level -lt 5 -or $level -gt 100) { throw "Brightness out of range: $level" }
  $methods = @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop)
  if ($methods.Count -eq 0) { throw 'This display does not support brightness control' }
  if ($DryRun) { return }
  foreach ($m in $methods) {
    Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$level } | Out-Null
  }
}

function Invoke-Request([string]$line) {
  $parts = $line.Trim() -split ' '
  switch -Regex ($line.Trim()) {
    '^status$' { return Get-Status }
    '^awake (on|off)$' { Set-Awake ($parts[1] -eq 'on'); return Get-Status }
    '^theme (dark|light)$' { Set-Theme $parts[1]; return Get-Status }
    '^brightness (100|[1-9][0-9]|[5-9])$' { Set-Brightness ([int]$parts[1]); return Get-Status }
    default { return @{ ok = $false; error = "Unknown request '$($parts[0])'" } }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  try { $answer = Invoke-Request $line } catch { $answer = @{ ok = $false; error = $_.Exception.Message } }
  [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 5))
}
