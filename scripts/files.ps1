# File browser helper for the island's Files panel.
#
# Runs as a long-lived process: the island starts it (shellSpawn) and writes one
# request per line to stdin; each answer is one JSON line on stdout. Paths are
# sent hex-encoded (UTF-8 bytes), so names with any characters survive the
# console's code page.
#   list               -> {"ok":true,"path":null,"items":[...]}  drives and the user's main folders
#   list <hex path>    -> {"ok":true,"path":"C:\\x","parent":"C:\\","items":[{name,path,kind,size,time}]}
#   copy <hex path>    -> {"ok":true}   puts the file or folder on the clipboard (paste it in Explorer)
#   copy-path <hex>    -> {"ok":true}   puts the path on the clipboard as text
#   open <hex path>    -> {"ok":true}   a folder in File Explorer, a file in its default app
#
# Nothing on disk is changed (only the clipboard, and what an opened app does). Hidden and
# system entries are left out, as Explorer does by default.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms

$MaxItems = 500

function ConvertFrom-HexUtf8([string]$hex) {
  if ($hex -notmatch '^[0-9a-fA-F]+$' -or ($hex.Length % 2) -ne 0) { throw 'Argument must be hex-encoded' }
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring(2 * $i, 2), 16) }
  (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes)
}

function Get-Root {
  $items = New-Object System.Collections.Generic.List[object]
  $userDir = [Environment]::GetFolderPath('UserProfile')
  $places = @(
    @{ name = 'Home'; path = $userDir },
    @{ name = 'Desktop'; path = [Environment]::GetFolderPath('Desktop') },
    @{ name = 'Documents'; path = [Environment]::GetFolderPath('MyDocuments') },
    @{ name = 'Downloads'; path = (Join-Path $userDir 'Downloads') }
  )
  foreach ($p in $places) {
    if ($p.path -and [IO.Directory]::Exists($p.path)) {
      $entry = [ordered]@{ name = $p.name; path = $p.path; kind = 'place'; size = $null; time = $null }
      $items.Add($entry)
    }
  }
  foreach ($d in [IO.DriveInfo]::GetDrives()) {
    if (-not $d.IsReady) { continue }
    $letter = $d.Name.Substring(0, 2)
    $label = if ($d.VolumeLabel) { "$($d.VolumeLabel) ($letter)" } else { "Local Disk ($letter)" }
    $entry = [ordered]@{ name = $label; path = $d.Name; kind = 'drive'; size = $d.TotalFreeSpace; time = $null }
    $items.Add($entry)
  }
  @{ ok = $true; path = $null; parent = $null; items = $items.ToArray() }
}

function Get-Folder([string]$path) {
  $dir = New-Object IO.DirectoryInfo $path
  if (-not $dir.Exists) { return @{ ok = $false; error = 'Folder not found' } }
  $hidden = [IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::System
  $entries = @($dir.EnumerateFileSystemInfos() | Where-Object { -not ($_.Attributes -band $hidden) })
  $folders = @($entries | Where-Object { $_ -is [IO.DirectoryInfo] } | Sort-Object Name)
  $files = @($entries | Where-Object { $_ -is [IO.FileInfo] } | Sort-Object Name)
  $list = foreach ($e in @($folders + $files) | Select-Object -First $MaxItems) {
    $isDir = $e -is [IO.DirectoryInfo]
    [ordered]@{
      name = $e.Name
      path = $e.FullName
      kind = if ($isDir) { 'folder' } else { 'file' }
      size = if ($isDir) { $null } else { $e.Length }
      time = [DateTimeOffset]::new($e.LastWriteTimeUtc).ToUnixTimeMilliseconds()
    }
  }
  $parent = if ($dir.Parent) { $dir.Parent.FullName } else { $null }
  @{ ok = $true; path = $dir.FullName; parent = $parent; total = $entries.Count; items = @($list) }
}

function Set-ClipboardFile([string]$path) {
  if (-not ([IO.File]::Exists($path) -or [IO.Directory]::Exists($path))) { return @{ ok = $false; error = 'Not found' } }
  $files = New-Object System.Collections.Specialized.StringCollection
  [void]$files.Add($path)
  [System.Windows.Forms.Clipboard]::SetFileDropList($files)
  @{ ok = $true }
}

function Invoke-Request([string]$line) {
  $parts = $line.Trim() -split ' ', 2
  $arg = if ($parts.Count -gt 1 -and $parts[1].Trim()) { ConvertFrom-HexUtf8 $parts[1].Trim() } else { $null }
  switch ($parts[0]) {
    'list' { if ($arg) { return Get-Folder $arg } else { return Get-Root } }
    'copy' {
      if (-not $arg) { return @{ ok = $false; error = 'No path' } }
      return Set-ClipboardFile $arg
    }
    'copy-path' {
      if (-not $arg) { return @{ ok = $false; error = 'No path' } }
      [System.Windows.Forms.Clipboard]::SetText($arg)
      return @{ ok = $true }
    }
    'open' {
      if (-not $arg) { return @{ ok = $false; error = 'No path' } }
      if ([IO.Directory]::Exists($arg)) {
        # A trailing backslash would escape the closing quote ("C:\"); "C:\." names the same folder.
        $target = if ($arg.EndsWith('\')) { "$arg." } else { $arg }
        Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$target`""
      } elseif ([IO.File]::Exists($arg)) {
        # The file's default app, as a double-click in File Explorer would do.
        Start-Process -FilePath $arg -WorkingDirectory ([IO.Path]::GetDirectoryName($arg))
      } else {
        return @{ ok = $false; error = 'Not found' }
      }
      return @{ ok = $true }
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
