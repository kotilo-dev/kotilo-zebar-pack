# Appearance helper for the island: wallpaper picker and GlazeWM border colours.
#
# Runs as a long-lived process (Windows PowerShell 5.1): the island starts it
# once (shellSpawn) and writes one request per line to stdin; each answer is
# one JSON line on stdout.
#   wallpapers                       -> {"ok":true,"folder":"<path>","current":"<path>|null","items":[{name,file,thumb,width,height}]}
#   set-wallpaper <hexFileName>      -> {"ok":true,"current":"<path>"}
#   restore-wallpaper <hexFullPath> <style> <tile>
#                                    -> {"ok":true,"current":"<path>"}   (undo helper for tests: only
#                                       when KOTILO_DEV=1, which the island never sets; local paths only)
#   borders <#focused> <#other>      -> {"ok":true,"changed":true|false}
#   keybindings                      -> {"ok":true,"items":[{line,commands:[..],bindings:[..],editable}]}
#                                       (the top-level keybindings list; `line` is the index of the
#                                       entry's bindings: line; only one-line lists are editable)
#   set-keybinding <line> <hexCommandsJson> <hexBindingsJson>
#                                    -> {"ok":true,"changed":true|false}  rewrites only that entry's
#                                       bindings: line, after checking it still runs those commands
#   gaps                             -> {"ok":true,"top":48,"right":8,"left":8,"scaleWithDpi":true}
#                                       (GlazeWM's outer gap in px, read only; a side that is not
#                                       given in px is null; the floating bar lines up with it)
# Errors are {"ok":false,"error":"..."}; the loop keeps running.
#
# <hexFileName> / <hexFullPath> are the UTF-8 bytes of the name, hex-encoded, so
# nothing from the UI is ever parsed as a path or a shell token. set-wallpaper
# only accepts a plain file name inside <Pictures>\Wallpapers, where <Pictures>
# is the user's real Pictures folder (it can be redirected, e.g. to OneDrive).
#
# Thumbnails (~320 px wide JPEG, base64) are cached in
# %LOCALAPPDATA%\kotilo-zebar-pack\thumbs, keyed by file name + length +
# LastWriteTimeUtc; cache files of vanished sources are removed.
#
# `borders` edits only the two `color:` lines under focused_window.border and
# other_windows.border in %USERPROFILE%\.glzr\glazewm\config.yaml. Quoting,
# indentation, line endings, encoding and every other byte stay as they are.
# The first real write copies the file to config.yaml.bak-appearance. The write
# is atomic (temp file next to the config, then replace). This script does not
# reload GlazeWM.
#
# DRY RUN: with environment variable KOTILO_DRY_RUN=1 nothing is changed; the
# state-changing functions (Invoke-SetWallpaper, Write-GlazeConfig) return the
# answer with "dryRun":true and a description of what they would have done.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type -Namespace Kotilo -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, string pvParam, uint fWinIni);
'@

$WallpaperDir = Join-Path ([Environment]::GetFolderPath('MyPictures')) 'Wallpapers'
$ThumbDir = Join-Path $env:LOCALAPPDATA 'kotilo-zebar-pack\thumbs'
$GlazeConfig = Join-Path $env:USERPROFILE '.glzr\glazewm\config.yaml'
$DesktopKey = 'HKCU:\Control Panel\Desktop'
$ImageExtensions = @('.jpg', '.jpeg', '.png', '.bmp')

function Test-DryRun { $env:KOTILO_DRY_RUN -eq '1' }

# ---------- input validation ----------

function ConvertFrom-HexUtf8([string]$hex) {
  if ($hex -notmatch '^[0-9a-fA-F]+$' -or ($hex.Length % 2) -ne 0) { throw 'Argument must be hex-encoded' }
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring(2 * $i, 2), 16) }
  try { (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes) }
  catch { throw 'Argument is not valid UTF-8' }
}

function Test-ImageExtension([string]$path) {
  $ImageExtensions -contains [IO.Path]::GetExtension($path).ToLowerInvariant()
}

function Resolve-WallpaperName([string]$hexName) {
  $name = ConvertFrom-HexUtf8 $hexName
  if (-not $name) { throw 'Empty file name' }
  if ($name.Contains('..')) { throw 'Invalid file name' }
  if ($name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) { throw 'Invalid file name' }
  foreach ($c in $name.ToCharArray()) { if ([char]::IsControl($c)) { throw 'Invalid file name' } }
  $full = [IO.Path]::GetFullPath((Join-Path $WallpaperDir $name))
  $folder = [IO.Path]::GetFullPath($WallpaperDir).TrimEnd('\')
  $parent = [IO.Path]::GetDirectoryName($full)
  if (-not $parent -or -not [string]::Equals($parent.TrimEnd('\'), $folder, [StringComparison]::OrdinalIgnoreCase)) { throw 'File is outside the wallpaper folder' }
  if (-not (Test-ImageExtension $full)) { throw 'Not an allowed image type' }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw 'File not found' }
  $full
}

function Resolve-ImagePath([string]$hexPath) {
  $path = ConvertFrom-HexUtf8 $hexPath
  if (-not $path) { throw 'Empty path' }
  foreach ($c in $path.ToCharArray()) { if ([char]::IsControl($c)) { throw 'Invalid path' } }
  if (-not [IO.Path]::IsPathRooted($path)) { throw 'Path must be absolute' }
  # Local drives only: a UNC path (\\host\share, \\?\...) would make Windows connect
  # to that host and could leak the user's credentials.
  if ($path -notmatch '^[A-Za-z]:\\') { throw 'Only local paths are allowed' }
  $full = [IO.Path]::GetFullPath($path)
  if (-not (Test-ImageExtension $full)) { throw 'Not an allowed image type' }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw 'File not found' }
  $full
}

function Assert-Colour([string]$colour) {
  if ($colour -notmatch '^#[0-9a-fA-F]{6}$') { throw "Invalid colour '$colour'" }
}

# ---------- wallpapers (read-only) ----------

function Get-CurrentWallpaper {
  $value = (Get-ItemProperty -LiteralPath $DesktopKey -Name WallPaper -ErrorAction SilentlyContinue).WallPaper
  if ($value) { [string]$value } else { $null }
}

function Get-DisplayName([string]$file) {
  $n = [IO.Path]::GetFileNameWithoutExtension($file)
  $n = $n -replace '[-_ ]\d{3,5}x\d{3,5}(?:[-_]\d+)?$', ''
  $n = ($n -replace '[-_]+', ' ').Trim()
  if ($n) { $n } else { [IO.Path]::GetFileNameWithoutExtension($file) }
}

function Get-CacheKey($file) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes("$($file.Name)|$($file.Length)|$($file.LastWriteTimeUtc.Ticks)")
    ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$jpegParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$jpegParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]80)

# Returns the image size; writes the thumbnail to $cachePath when it does not exist yet.
function Get-ThumbAndSize([string]$source, [string]$cachePath) {
  $stream = [IO.File]::Open($source, 'Open', 'Read', 'ReadWrite')
  $image = $null
  try {
    # validateImageData = $false: the header is enough for the size; pixels are only decoded when drawn.
    $image = [System.Drawing.Image]::FromStream($stream, $false, $false)
    $size = @{ width = $image.Width; height = $image.Height }
    if (-not (Test-Path -LiteralPath $cachePath)) {
      $w = [Math]::Min(320, $image.Width)
      $h = [int][Math]::Max(1, [Math]::Round($image.Height * ($w / [double]$image.Width)))
      $bmp = New-Object System.Drawing.Bitmap $w, $h
      try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
          $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
          $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
          $g.DrawImage($image, 0, 0, $w, $h)
        } finally { $g.Dispose() }
        $tmp = "$cachePath.tmp"
        $bmp.Save($tmp, $jpegCodec, $jpegParams)
        Move-Item -LiteralPath $tmp -Destination $cachePath -Force
      } finally { $bmp.Dispose() }
    }
    $size
  } finally {
    if ($image) { $image.Dispose() }
    $stream.Dispose()
  }
}

function Get-Wallpapers {
  $files = @()
  if (Test-Path -LiteralPath $WallpaperDir -PathType Container) {
    $files = @(Get-ChildItem -LiteralPath $WallpaperDir -File | Where-Object { Test-ImageExtension $_.Name } | Sort-Object Name)
  }
  if (-not (Test-Path -LiteralPath $ThumbDir)) { $null = New-Item -ItemType Directory -Path $ThumbDir -Force }
  $keep = @{}
  $items = @()
  foreach ($f in $files) {
    $key = Get-CacheKey $f
    $cache = Join-Path $ThumbDir "$key.jpg"
    $keep["$key.jpg"] = $true
    try {
      $size = Get-ThumbAndSize $f.FullName $cache
      $thumb = [Convert]::ToBase64String([IO.File]::ReadAllBytes($cache))
    } catch {
      [Console]::Error.WriteLine("thumbnail failed for $($f.Name): $($_.Exception.Message)")
      $size = @{ width = 0; height = 0 }; $thumb = $null
    }
    $items += [ordered]@{ name = (Get-DisplayName $f.Name); file = $f.Name; thumb = $thumb; width = $size.width; height = $size.height }
  }
  Get-ChildItem -LiteralPath $ThumbDir -File -ErrorAction SilentlyContinue | Where-Object { -not $keep.ContainsKey($_.Name) } | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
  }
  @{ ok = $true; folder = [IO.Path]::GetFullPath($WallpaperDir); current = (Get-CurrentWallpaper); items = @($items) }
}

# ---------- wallpaper writes (one function; validates again and honours dry run) ----------

function Invoke-SetWallpaper([string]$path, [string]$style, [string]$tile) {
  # Second check, at the call site of the state change.
  if ($style -notmatch '^\d{1,2}$' -or $tile -notmatch '^\d{1,2}$') { throw 'Invalid style or tile' }
  if (-not (Test-ImageExtension $path) -or $path -notmatch '^[A-Za-z]:\\' -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Invalid wallpaper path' }
  foreach ($c in $path.ToCharArray()) { if ([char]::IsControl($c)) { throw 'Invalid wallpaper path' } }
  if (Test-DryRun) {
    return @{ ok = $true; dryRun = $true; current = $path; wouldDo = @(
      "set $DesktopKey WallpaperStyle = '$style' (string)",
      "set $DesktopKey TileWallpaper = '$tile' (string)",
      "SystemParametersInfo(SPI_SETDESKWALLPAPER 0x14, 0, '$path', 0x3)") }
  }
  Set-ItemProperty -LiteralPath $DesktopKey -Name WallpaperStyle -Value $style -Type String
  Set-ItemProperty -LiteralPath $DesktopKey -Name TileWallpaper -Value $tile -Type String
  if (-not [Kotilo.Native]::SystemParametersInfo(0x14, 0, $path, 0x3)) {
    throw "SystemParametersInfo failed (error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
  }
  @{ ok = $true; current = $path }
}

# ---------- GlazeWM border colours ----------

# Splits into lines that keep their terminators.
function Split-KeepEol([string]$text) { , @([regex]::Split($text, '(?<=\n)') | Where-Object { $_ -ne '' }) }

function Get-Indent([string]$line) { $line.Length - $line.TrimStart(' ').Length }
function Test-Content([string]$line) { $t = $line.Trim(); $t -ne '' -and -not $t.StartsWith('#') }

# Finds the single line index of `<key>:` among lines in [from, to) whose indent equals $indent
# (or is greater than $parentIndent when $indent is -1: the first child level).
function Find-Child($lines, [int]$from, [int]$to, [int]$parentIndent, [string]$key) {
  $childIndent = -1
  $hits = @()
  for ($i = $from; $i -lt $to; $i++) {
    if (-not (Test-Content $lines[$i])) { continue }
    $ind = Get-Indent $lines[$i]
    if ($childIndent -lt 0) { $childIndent = $ind }
    if ($ind -eq $childIndent -and $lines[$i] -match "^\s*$([regex]::Escape($key))\s*:(\s|$)") { $hits += $i }
  }
  if ($hits.Count -ne 1) { return $null }
  $hits[0]
}

# End (exclusive) of the block that starts at line $start.
function Get-BlockEnd($lines, [int]$start) {
  $ind = Get-Indent $lines[$start]
  for ($i = $start + 1; $i -lt $lines.Count; $i++) {
    if ((Test-Content $lines[$i]) -and (Get-Indent $lines[$i]) -le $ind) { return $i }
  }
  $lines.Count
}

# Locates the colour line index for <section>.border.color; $null if not unambiguous.
function Find-BorderColour($lines, [string]$section) {
  $sectionHits = @()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$section\s*:\s*(#.*)?\r?\n?$") { $sectionHits += $i }
  }
  if ($sectionHits.Count -ne 1) { return $null }
  $s = $sectionHits[0]
  $border = Find-Child $lines ($s + 1) (Get-BlockEnd $lines $s) (Get-Indent $lines[$s]) 'border'
  if ($null -eq $border) { return $null }
  $colour = Find-Child $lines ($border + 1) (Get-BlockEnd $lines $border) (Get-Indent $lines[$border]) 'color'
  $colour
}

$ColourLine = '^(\s*color:\s*)(["'']?)(#[0-9a-fA-F]{6})\2(\s*(?:#.*)?)(\r?\n?)$'

function Write-GlazeConfig([string]$focused, [string]$other) {
  # Second check, at the call site of the state change.
  Assert-Colour $focused; Assert-Colour $other
  if (-not (Test-Path -LiteralPath $GlazeConfig -PathType Leaf)) { throw 'GlazeWM config not found' }

  $bytes = [IO.File]::ReadAllBytes($GlazeConfig)
  $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $offset = if ($bom) { 3 } else { 0 }
  $text = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes, $offset, $bytes.Length - $offset)
  $lines = [string[]](Split-KeepEol $text)

  $changes = @()
  foreach ($pair in @(@('focused_window', $focused), @('other_windows', $other))) {
    $idx = Find-BorderColour $lines $pair[0]
    if ($null -eq $idx) { throw "Could not find $($pair[0]).border.color unambiguously" }
    $m = [regex]::Match($lines[$idx], $ColourLine)
    if (-not $m.Success) { throw "Unexpected format of the $($pair[0]).border.color line" }
    if ($m.Groups[3].Value -ine $pair[1]) {
      $new = $m.Groups[1].Value + $m.Groups[2].Value + $pair[1] + $m.Groups[2].Value + $m.Groups[4].Value + $m.Groups[5].Value
      $changes += @{ index = $idx; section = $pair[0]; old = $lines[$idx].TrimEnd("`r", "`n"); new = $new.TrimEnd("`r", "`n"); line = $new }
    }
  }
  if ($changes.Count -eq 0) {
    $answer = @{ ok = $true; changed = $false }
    if (Test-DryRun) { $answer.dryRun = $true }
    return $answer
  }
  if (Test-DryRun) {
    return @{ ok = $true; dryRun = $true; changed = $true; wouldDo = @(
      "write $GlazeConfig atomically (backup to config.yaml.bak-appearance if missing)") + @($changes | ForEach-Object { "line $($_.index + 1) ($($_.section)): '$($_.old)' -> '$($_.new)'" }) }
  }

  foreach ($c in $changes) { $lines[$c.index] = $c.line }
  $out = New-Object System.Collections.Generic.List[byte]
  if ($bom) { $out.AddRange([byte[]](0xEF, 0xBB, 0xBF)) }
  $out.AddRange([byte[]][Text.Encoding]::UTF8.GetBytes(($lines -join '')))

  $backup = "$GlazeConfig.bak-appearance"
  if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $GlazeConfig -Destination $backup }
  $tmp = "$GlazeConfig.tmp-appearance"
  try {
    [IO.File]::WriteAllBytes($tmp, $out.ToArray())
    # [NullString]::Value, not $null: PowerShell turns $null into "" for a string
    # parameter, and File.Replace rejects "" as a backup path ("not of a legal form").
    [IO.File]::Replace($tmp, $GlazeConfig, [NullString]::Value)
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
  @{ ok = $true; changed = $true }
}

# ---------- GlazeWM outer gap (read only) ----------

# '8px' / 8 / "8px" -> 8; anything else (percentages) -> $null.
function ConvertFrom-GapValue([string]$v) {
  $v = $v.Trim().Trim('"', "'")
  if ($v -match '^(\d+(?:\.\d+)?)(px)?$') { return [double]$Matches[1] }
  $null
}

function Get-GlazeGaps {
  if (-not (Test-Path -LiteralPath $GlazeConfig -PathType Leaf)) { throw 'GlazeWM config not found' }
  $lines = [string[]](Split-KeepEol ([IO.File]::ReadAllText($GlazeConfig)))
  $gapsHits = @(for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^gaps\s*:\s*(#.*)?\r?\n?$') { $i } })
  if ($gapsHits.Count -ne 1) { throw 'Could not find the gaps section' }
  $g = $gapsHits[0]
  $end = Get-BlockEnd $lines $g
  $answer = [ordered]@{ ok = $true; top = $null; right = $null; bottom = $null; left = $null; scaleWithDpi = $true }

  $scale = Find-Child $lines ($g + 1) $end (Get-Indent $lines[$g]) 'scale_with_dpi'
  if ($null -ne $scale -and $lines[$scale] -match ':\s*false\b') { $answer.scaleWithDpi = $false }

  $outer = Find-Child $lines ($g + 1) $end (Get-Indent $lines[$g]) 'outer_gap'
  if ($null -eq $outer) { return $answer }
  $inline = ($lines[$outer] -replace '^\s*outer_gap\s*:', '' -replace '\s+#.*$', '').Trim().Trim('"', "'")
  if ($inline) {
    # CSS-like shorthand: 1 to 4 values, top right bottom left.
    $v = @($inline -split '\s+' | ForEach-Object { ConvertFrom-GapValue $_ })
    $sides = switch ($v.Count) { 1 { $v[0], $v[0], $v[0], $v[0] } 2 { $v[0], $v[1], $v[0], $v[1] } 3 { $v[0], $v[1], $v[2], $v[1] } default { $v[0], $v[1], $v[2], $v[3] } }
    $answer.top, $answer.right, $answer.bottom, $answer.left = $sides
    return $answer
  }
  $outerEnd = Get-BlockEnd $lines $outer
  foreach ($side in 'top', 'right', 'bottom', 'left') {
    $idx = Find-Child $lines ($outer + 1) $outerEnd (Get-Indent $lines[$outer]) $side
    if ($null -ne $idx) { $answer[$side] = ConvertFrom-GapValue (($lines[$idx] -replace "^\s*$side\s*:", '') -replace '\s+#.*$', '') }
  }
  $answer
}

# ---------- GlazeWM keybindings ----------

# Reads the config as lines that keep their terminators, plus whether it had a BOM.
function Read-GlazeLines {
  if (-not (Test-Path -LiteralPath $GlazeConfig -PathType Leaf)) { throw 'GlazeWM config not found' }
  $bytes = [IO.File]::ReadAllBytes($GlazeConfig)
  $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $offset = if ($bom) { 3 } else { 0 }
  $text = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes, $offset, $bytes.Length - $offset)
  @{ bom = $bom; lines = [string[]](Split-KeepEol $text) }
}

# Writes the lines back atomically, with the same one-time backup as the border colours.
function Save-GlazeLines([string[]]$lines, [bool]$bom) {
  $out = New-Object System.Collections.Generic.List[byte]
  if ($bom) { $out.AddRange([byte[]](0xEF, 0xBB, 0xBF)) }
  $out.AddRange([byte[]][Text.Encoding]::UTF8.GetBytes(($lines -join '')))
  $backup = "$GlazeConfig.bak-appearance"
  if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $GlazeConfig -Destination $backup }
  $tmp = "$GlazeConfig.tmp-appearance"
  try {
    [IO.File]::WriteAllBytes($tmp, $out.ToArray())
    [IO.File]::Replace($tmp, $GlazeConfig, [NullString]::Value)
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
}

# A YAML flow list on one line: ['a', "b", c]  ->  @('a', 'b', 'c'); $null when it is not one.
function ConvertFrom-FlowList([string]$value) {
  $v = ($value -replace '\s+#.*$', '').Trim()
  if ($v -notmatch '^\[(.*)\]$') { return $null }
  $inner = $Matches[1]
  $items = @()
  foreach ($m in [regex]::Matches($inner, "'((?:[^']|'')*)'|""([^""]*)""|([^,\s][^,]*)")) {
    if ($m.Groups[1].Success) { $items += $m.Groups[1].Value.Replace("''", "'") }
    elseif ($m.Groups[2].Success) { $items += $m.Groups[2].Value }
    else { $items += $m.Groups[3].Value.Trim() }
  }
  , $items
}

# The entries of the top-level `keybindings:` list. Each one: its commands, its
# bindings, the line index of its `bindings:` line, and whether both are one-line
# lists (only those can be edited).
function Get-Keybindings($lines) {
  $tops = @(for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^keybindings\s*:\s*(#.*)?\r?\n?$') { $i } })
  if ($tops.Count -ne 1) { throw 'Could not find the keybindings section' }
  $start = $tops[0]
  $end = Get-BlockEnd $lines $start
  $entries = @()
  $itemIndent = -1
  $current = $null
  for ($i = $start + 1; $i -lt $end; $i++) {
    if (-not (Test-Content $lines[$i])) { continue }
    $line = $lines[$i]
    $ind = Get-Indent $line
    if ($line -match '^\s*-\s') {
      if ($itemIndent -lt 0) { $itemIndent = $ind }
      if ($ind -eq $itemIndent) {
        if ($current) { $entries += $current }
        $current = [ordered]@{ commands = $null; bindings = $null; line = -1 }
        $line = (' ' * ($ind + 2)) + ($line.Substring($ind) -replace '^-\s+', '')
      }
    }
    if (-not $current) { continue }
    if ($line -match '^\s*commands\s*:(.*)$') { $current.commands = ConvertFrom-FlowList $Matches[1] }
    elseif ($line -match '^\s*bindings\s*:(.*)$') { $current.bindings = ConvertFrom-FlowList $Matches[1]; $current.line = $i }
  }
  if ($current) { $entries += $current }
  foreach ($e in $entries) { $e.editable = ($null -ne $e.commands -and $null -ne $e.bindings -and $e.line -ge 0) }
  , $entries
}

function Get-KeybindingList {
  $cfg = Read-GlazeLines
  $list = Get-Keybindings $cfg.lines
  @{ ok = $true; items = @($list | ForEach-Object { @{ line = $_.line; commands = @($_.commands); bindings = @($_.bindings); editable = $_.editable } }) }
}

# GlazeWM key combinations: lower-case key names joined by '+', at most five keys.
$BindingPattern = '^[a-z0-9_]+(\+[a-z0-9_]+){0,4}$'

# Replaces the bindings of the entry whose `bindings:` line is $lineIndex, after
# checking that the entry still runs exactly $expected (the config may have
# changed since the island read it). The line keeps its indent, quotes and comment.
function Set-Keybinding([int]$lineIndex, [string[]]$expected, [string[]]$bindings) {
  if ($bindings.Count -lt 1 -or $bindings.Count -gt 4) { throw 'One to four key combinations' }
  foreach ($b in $bindings) { if ($b -cnotmatch $BindingPattern) { throw "Invalid key combination '$b'" } }
  $cfg = Read-GlazeLines
  $lines = $cfg.lines
  $list = Get-Keybindings $lines   # assigned first, so the pipe below goes through the entries one by one
  $entry = $list | Where-Object { $_.line -eq $lineIndex } | Select-Object -First 1
  if (-not $entry -or -not $entry.editable) { throw 'That keybinding is no longer in the config' }
  if ((@($entry.commands) -join "`n") -cne ($expected -join "`n")) { throw 'The config changed; reload the list' }

  $m = [regex]::Match($lines[$lineIndex], '^(\s*(?:-\s+)?bindings\s*:\s*)\[[^\]]*\](\s*(?:#.*)?)(\r?\n?)$')
  if (-not $m.Success) { throw 'Unexpected format of the bindings line' }
  $quoted = ($bindings | ForEach-Object { "'$_'" }) -join ', '
  $new = $m.Groups[1].Value + "[$quoted]" + $m.Groups[2].Value + $m.Groups[3].Value
  if ($new -ceq $lines[$lineIndex]) { return @{ ok = $true; changed = $false } }
  if (Test-DryRun) {
    return @{ ok = $true; dryRun = $true; changed = $true; wouldDo = "line $($lineIndex + 1): '$($lines[$lineIndex].TrimEnd("`r", "`n"))' -> '$($new.TrimEnd("`r", "`n"))'" }
  }
  $lines[$lineIndex] = $new
  Save-GlazeLines $lines $cfg.bom
  @{ ok = $true; changed = $true }
}

# ---------- request loop ----------

function Invoke-Request([string]$line) {
  $parts = $line.Trim() -split '\s+'
  switch ($parts[0]) {
    'wallpapers' { return Get-Wallpapers }
    'set-wallpaper' {
      if ($parts.Count -ne 2) { return @{ ok = $false; error = 'Usage: set-wallpaper <hexFileName>' } }
      $path = Resolve-WallpaperName $parts[1]
      return Invoke-SetWallpaper $path '10' '0'
    }
    'restore-wallpaper' {
      # Test-only: the island cannot reach it, so a compromised page cannot set arbitrary images.
      if ($env:KOTILO_DEV -ne '1') { return @{ ok = $false; error = 'restore-wallpaper is only available with KOTILO_DEV=1' } }
      if ($parts.Count -ne 4) { return @{ ok = $false; error = 'Usage: restore-wallpaper <hexFullPath> <style> <tile>' } }
      if ($parts[2] -notmatch '^\d{1,2}$' -or $parts[3] -notmatch '^\d{1,2}$') { return @{ ok = $false; error = 'Invalid style or tile' } }
      $path = Resolve-ImagePath $parts[1]
      return Invoke-SetWallpaper $path $parts[2] $parts[3]
    }
    'borders' {
      if ($parts.Count -ne 3) { return @{ ok = $false; error = 'Usage: borders <#focused> <#other>' } }
      Assert-Colour $parts[1]; Assert-Colour $parts[2]
      return Write-GlazeConfig $parts[1] $parts[2]
    }
    'gaps' { return Get-GlazeGaps }
    'keybindings' { return Get-KeybindingList }
    'set-keybinding' {
      if ($parts.Count -ne 4 -or $parts[1] -notmatch '^\d{1,5}$') { return @{ ok = $false; error = 'Usage: set-keybinding <line> <hexCommandsJson> <hexBindingsJson>' } }
      # Assigned first: Windows PowerShell's ConvertFrom-Json emits a JSON array as one object.
      $expected = ConvertFrom-HexUtf8 $parts[2] | ConvertFrom-Json
      $bindings = ConvertFrom-HexUtf8 $parts[3] | ConvertFrom-Json
      return Set-Keybinding ([int]$parts[1]) ([string[]]$expected) ([string[]]$bindings)
    }
    default { return @{ ok = $false; error = "Unknown request '$($parts[0])'" } }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  try { $answer = Invoke-Request $line } catch { $answer = @{ ok = $false; error = $_.Exception.Message } }
  [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 5))
}
