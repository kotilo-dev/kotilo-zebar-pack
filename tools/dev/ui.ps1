# UI test helpers: screenshots, key presses and clicks in physical pixels.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
if (-not ('KUi' -as [type])) {
  Add-Type @'
using System; using System.Runtime.InteropServices;
public static class KUi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
}
'@
}
[KUi]::SetProcessDPIAware() | Out-Null
$script:ShotDir = Join-Path $env:TEMP "kotilo-shots"
New-Item -ItemType Directory -Force $script:ShotDir | Out-Null

function Save-Shot([string]$Name, [int]$X = 460, [int]$Y = 0, [int]$W = 1000, [int]$H = 700) {
  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size)
  $bmp.Save("$script:ShotDir\$Name.png"); $g.Dispose(); $bmp.Dispose()
}

function Send-Keys([byte[]]$Keys) {
  foreach ($k in $Keys) { [KUi]::keybd_event($k, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30 }
  [array]::Reverse($Keys)
  foreach ($k in $Keys) { [KUi]::keybd_event($k, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30 }
}

function Send-Text([string]$Text) {
  foreach ($c in $Text.ToUpper().ToCharArray()) { Send-Keys @([byte][char]$c) }
}

function Invoke-Click([int]$X, [int]$Y) {
  [KUi]::SetCursorPos($X, $Y); Start-Sleep -Milliseconds 80
  [KUi]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [KUi]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
}

function Get-ForegroundTitle {
  $sb = New-Object System.Text.StringBuilder 256
  [KUi]::GetWindowText([KUi]::GetForegroundWindow(), $sb, 256) | Out-Null
  $sb.ToString()
}
