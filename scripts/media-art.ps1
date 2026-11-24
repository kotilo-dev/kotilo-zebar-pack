# Prints the cover of the current media session as JSON:
#   {"ok":true,"title":"...","artist":"...","art":"<base64 JPEG>"}   (art is "" when the app gives none)
#   {"ok":false}                                                     (nothing is playing)
# The island runs it once per track (Zebar's media provider has no cover) and
# shares the picture with the bar. The cover comes from Windows' media session
# (GlobalSystemMediaTransportControls), the same one the volume flyout shows;
# browsers hand it the video's thumbnail. It is scaled down to 96 x 96 so it
# stays small in the widgets' shared storage. Nothing is written to disk.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

# WinRT async calls, awaited through .NET's AsTask (Windows PowerShell 5.1 has no await).
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Wait-Async($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { throw 'timeout' }
  $task.Result
}

$manager = Wait-Async ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $manager.GetCurrentSession()
if (-not $session) { '{"ok":false}'; exit 0 }
$props = Wait-Async ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])

$art = ''
if ($props.Thumbnail) {
  try {
    $stream = Wait-Async ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    # PowerShell 5.1 cannot cast the WinRT stream to IInputStream itself; calling
    # AsStreamForRead through reflection lets the CLR do the cast.
    $toNet = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
    $net = $toNet.Invoke($null, @($stream))
    $bytes = New-Object System.IO.MemoryStream
    $net.CopyTo($bytes)
    $net.Dispose()
    $bytes.Position = 0

    $src = [System.Drawing.Image]::FromStream($bytes)
    # Square crop from the middle (video thumbnails are 16:9), then 96 x 96.
    $side = [Math]::Min($src.Width, $src.Height)
    $crop = [System.Drawing.Rectangle]::new([int](($src.Width - $side) / 2), [int](($src.Height - $side) / 2), $side, $side)
    $bmp = New-Object System.Drawing.Bitmap 96, 96
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, [System.Drawing.Rectangle]::new(0, 0, 96, 96), $crop, [System.Drawing.GraphicsUnit]::Pixel)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $art = [Convert]::ToBase64String($ms.ToArray())
    $g.Dispose(); $bmp.Dispose(); $src.Dispose(); $ms.Dispose(); $bytes.Dispose()
  } catch { $art = '' }
}

[pscustomobject]@{ ok = $true; title = $props.Title; artist = $props.Artist; art = $art } | ConvertTo-Json -Compress
