# Clipboard history helper for the island, built on Windows' own clipboard
# history (the Win+V list).
#
# Runs as a long-lived process: the island starts it once (shellSpawn) and
# writes one request per line to stdin; each answer is one JSON line on stdout.
#   list            -> {"ok":true,"enabled":true,"items":[{id,kind,text,image,time}]}
#   set <id>        -> {"ok":true}   puts that history item on the clipboard
#   delete <id>     -> {"ok":true}
#   clear           -> {"ok":true}
#
# Nothing is stored by this script. Windows keeps the history and already
# leaves out content that password managers mark as private. Text previews are
# cut to 300 characters; selecting an item hands Windows the original item, so
# the full content never passes through here.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime, System.Drawing
$null = [Windows.ApplicationModel.DataTransfer.Clipboard, Windows.ApplicationModel.DataTransfer, ContentType = WindowsRuntime]
$null = [Windows.ApplicationModel.DataTransfer.StandardDataFormats, Windows.ApplicationModel.DataTransfer, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStreamReference, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$Clipboard = [Windows.ApplicationModel.DataTransfer.Clipboard]
$Formats = [Windows.ApplicationModel.DataTransfer.StandardDataFormats]

# Windows PowerShell has no `await` for WinRT; AsTask turns an IAsyncOperation into a Task.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Wait-Op($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(); $task.Result
}

function Get-HistoryItems {
  $result = Wait-Op ($Clipboard::GetHistoryItemsAsync()) ([Windows.ApplicationModel.DataTransfer.ClipboardHistoryItemsResult])
  if ($result.Status -ne 'Success') { return $null }
  , @($result.Items)
}

# The WinRT stream reaches PowerShell as a bare COM object, so PowerShell cannot
# pick the AsStreamForRead overload by itself; invoking the method through
# reflection lets .NET cast the object to IInputStream.
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

function Get-Thumbnail($content) {
  $source = $null; $image = $null; $thumb = $null
  try {
    $reference = Wait-Op ($content.GetBitmapAsync()) ([Windows.Storage.Streams.RandomAccessStreamReference])
    $stream = Wait-Op ($reference.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $source = $asStreamForRead.Invoke($null, @($stream))
    $image = [System.Drawing.Image]::FromStream($source)
    # 1.0 and 160.0, not 1 and 160: with an integer first argument PowerShell
    # picks Math.Min(int, int) and rounds the scale down to 0.
    $scale = [Math]::Min(1.0, 160.0 / [Math]::Max($image.Width, $image.Height))
    $thumb = New-Object System.Drawing.Bitmap $image, ([int][Math]::Max(1, $image.Width * $scale)), ([int][Math]::Max(1, $image.Height * $scale))
    $png = New-Object System.IO.MemoryStream
    $thumb.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
    [Convert]::ToBase64String($png.ToArray())
  } catch {
    [Console]::Error.WriteLine("thumbnail failed: $($_.Exception.Message)")
    $null
  } finally {
    if ($thumb) { $thumb.Dispose() }
    if ($image) { $image.Dispose() }
    if ($source) { $source.Dispose() }
  }
}

function Get-List {
  if (-not $Clipboard::IsHistoryEnabled()) { return @{ ok = $true; enabled = $false; items = @() } }
  $items = Get-HistoryItems
  if ($null -eq $items) { return @{ ok = $false; error = 'Clipboard history is not available' } }
  $list = foreach ($item in $items | Select-Object -First 25) {
    $content = $item.Content
    $entry = [ordered]@{ id = $item.Id; time = $item.Timestamp.ToUnixTimeMilliseconds(); kind = 'other'; text = $null; image = $null }
    if ($content.Contains($Formats::Text)) {
      $text = Wait-Op ($content.GetTextAsync()) ([string])
      $entry.kind = 'text'
      $entry.text = if ($text.Length -gt 300) { $text.Substring(0, 300) } else { $text }
    } elseif ($content.Contains($Formats::Bitmap)) {
      $entry.kind = 'image'
      $entry.image = Get-Thumbnail $content
    } elseif ($content.Contains($Formats::StorageItems)) {
      $entry.kind = 'files'
    }
    $entry
  }
  @{ ok = $true; enabled = $true; items = @($list) }
}

function Find-Item([string]$id) {
  $items = Get-HistoryItems
  if ($items) { $items | Where-Object { $_.Id -eq $id } | Select-Object -First 1 }
}

function Invoke-Request([string]$line) {
  $parts = $line.Trim() -split ' ', 2
  switch ($parts[0]) {
    'list' { return Get-List }
    'set' {
      $item = Find-Item $parts[1]
      if (-not $item) { return @{ ok = $false; error = 'Item not found' } }
      $status = "$($Clipboard::SetHistoryItemAsContent($item))"
      if ($status -eq 'Success') { return @{ ok = $true } }
      return @{ ok = $false; error = $status }
    }
    'delete' {
      $item = Find-Item $parts[1]
      if (-not $item) { return @{ ok = $false; error = 'Item not found' } }
      return @{ ok = $Clipboard::DeleteItemFromHistory($item) }
    }
    'clear' { return @{ ok = $Clipboard::ClearHistory() } }
    default { return @{ ok = $false; error = "Unknown request '$($parts[0])'" } }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  try { $answer = Invoke-Request $line } catch { $answer = @{ ok = $false; error = $_.Exception.Message } }
  [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 4))
}
