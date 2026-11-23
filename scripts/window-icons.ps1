# Prints the icons of the programs that have windows as JSON: { "<process name>": "<base64 PNG>" }.
# The island shows them next to GlazeWM's windows, which carry the process name.
# Each icon is the program file's own icon at 32 x 32. Programs whose file
# cannot be read (other users' or protected processes) get an empty string.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing

$icons = @{}
foreach ($p in Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }) {
  if ($icons.ContainsKey($p.ProcessName)) { continue }
  $png = ''
  try {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p.Path)
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($icon.ToBitmap(), 0, 0, 32, 32)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = [Convert]::ToBase64String($ms.ToArray())
    $g.Dispose(); $bmp.Dispose(); $icon.Dispose(); $ms.Dispose()
  } catch { }
  $icons[$p.ProcessName] = $png
}

$icons | ConvertTo-Json -Compress
