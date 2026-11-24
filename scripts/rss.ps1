# Reads RSS and Atom feeds for the island's News panel, and opens a story's
# link. Runs as a line helper: one request per stdin line, one JSON answer per
# stdout line. The island cannot fetch most feeds itself (they send no CORS
# headers), so they are downloaded here.
#
# Requests (URLs are hex-encoded UTF-8, so no quoting can break the line):
#   fetch <hexUrl>   -> {"ok":true,"title":"Feed name","items":[{"title","link","date"}]}
#                       date is ISO 8601 or ""; at most 40 items; links are http(s) only
#   open <hexUrl>    -> {"ok":true}  opens an http(s) link in the default browser
#
# Safety: only http and https URLs are read or opened; a download stops after
# 10 seconds or 5 MB; the XML is read with DTD processing off and no resolver,
# so a feed cannot make this script read other files or URLs.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$MaxBytes = 5MB
$MaxItems = 40

function ConvertFrom-HexUtf8([string]$hex) {
  if ($hex -notmatch '^[0-9a-fA-F]+$' -or ($hex.Length % 2) -ne 0) { throw 'Argument must be hex-encoded' }
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring(2 * $i, 2), 16) }
  (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes)
}

# An absolute http(s) URL without spaces or control characters; $null otherwise.
function Get-WebUri([string]$text) {
  if (-not $text -or $text.Length -gt 2048 -or $text -match '[\s\x00-\x1f"<>]') { return $null }
  $uri = $null
  if (-not [Uri]::TryCreate($text.Trim(), [UriKind]::Absolute, [ref]$uri)) { return $null }
  if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') { return $null }
  $uri
}

function Get-FeedBytes([Uri]$uri) {
  $req = [Net.HttpWebRequest]::Create($uri)
  $req.Timeout = 10000
  $req.ReadWriteTimeout = 10000
  $req.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Kotilo-News/1.0'
  $req.Accept = 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5'
  $req.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
  $req.MaximumAutomaticRedirections = 5
  if ($req.Proxy) { $req.Proxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials }
  $res = $req.GetResponse()
  try {
    $stream = $res.GetResponseStream()
    $out = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 65536
    while (($n = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $out.Write($buffer, 0, $n)
      if ($out.Length -gt $MaxBytes) { throw 'Feed is larger than 5 MB' }
    }
    $out.ToArray()
  } finally { $res.Close() }
}

function Read-FeedXml([byte[]]$bytes) {
  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Ignore
  $settings.XmlResolver = $null
  $settings.MaxCharactersInDocument = 20000000
  $reader = [System.Xml.XmlReader]::Create((New-Object System.IO.MemoryStream(, $bytes)), $settings)
  try {
    $doc = New-Object System.Xml.XmlDocument
    $doc.XmlResolver = $null
    try { $doc.Load($reader) } catch { throw 'Not an RSS or Atom feed (the address returned something else, such as a web page)' }
    $doc
  } finally { $reader.Close() }
}

# Plain text: entities decoded, tags and runs of white space removed.
function Get-PlainText($node) {
  if (-not $node) { return '' }
  $t = [Net.WebUtility]::HtmlDecode($node.InnerText)
  $t = $t -replace '<[^>]+>', ' '
  ($t -replace '\s+', ' ').Trim()
}

# The first child element with this local name (any namespace).
function Get-Child($node, [string]$name) {
  foreach ($c in $node.ChildNodes) { if ($c.NodeType -eq 'Element' -and $c.LocalName -eq $name) { return $c } }
  $null
}

function Get-Children($node, [string]$name) {
  @($node.ChildNodes | Where-Object { $_.NodeType -eq 'Element' -and $_.LocalName -eq $name })
}

# RSS dates (RFC 822, "Tue, 24 Nov 2026 10:00:00 GMT") and Atom dates (ISO 8601) as ISO 8601; "" when unreadable.
function ConvertTo-IsoDate([string]$text) {
  if (-not $text) { return '' }
  $t = $text.Trim()
  $d = [DateTimeOffset]::MinValue
  $styles = [Globalization.DateTimeStyles]::AllowWhiteSpaces -bor [Globalization.DateTimeStyles]::AssumeUniversal
  $inv = [Globalization.CultureInfo]::InvariantCulture
  if ([DateTimeOffset]::TryParse($t, $inv, $styles, [ref]$d)) { return $d.ToUniversalTime().ToString('o') }
  # Named US zones that .NET does not read; drop the weekday too.
  $zones = @{ EST = '-05:00'; EDT = '-04:00'; CST = '-06:00'; CDT = '-05:00'; MST = '-07:00'; MDT = '-06:00'; PST = '-08:00'; PDT = '-07:00'; UT = '+00:00'; Z = '+00:00' }
  if ($t -match '^(?:\w{3},\s*)?(.+?)\s+([A-Z]{1,3})$' -and $zones.ContainsKey($Matches[2])) {
    if ([DateTimeOffset]::TryParse("$($Matches[1]) $($zones[$Matches[2]])", $inv, $styles, [ref]$d)) { return $d.ToUniversalTime().ToString('o') }
  }
  ''
}

function Get-Feed([string]$hexUrl) {
  $uri = Get-WebUri (ConvertFrom-HexUtf8 $hexUrl)
  if (-not $uri) { throw 'Not an http or https address' }
  $doc = Read-FeedXml (Get-FeedBytes $uri)
  $root = $doc.DocumentElement
  $items = @()
  $title = ''
  switch ($root.LocalName) {
    'rss' {
      $channel = Get-Child $root 'channel'
      if (-not $channel) { throw 'RSS without a channel' }
      $title = Get-PlainText (Get-Child $channel 'title')
      foreach ($it in (Get-Children $channel 'item')) {
        $date = Get-Child $it 'pubDate'
        if (-not $date) { $date = Get-Child $it 'date' }
        $link = Get-PlainText (Get-Child $it 'link')
        if (-not $link) {
          $guid = Get-Child $it 'guid'
          if ($guid -and $guid.GetAttribute('isPermaLink') -ne 'false') { $link = Get-PlainText $guid }
        }
        $items += @{ title = Get-PlainText (Get-Child $it 'title'); link = $link; date = ConvertTo-IsoDate ($(if ($date) { $date.InnerText })) }
      }
    }
    'feed' {
      $title = Get-PlainText (Get-Child $root 'title')
      foreach ($e in (Get-Children $root 'entry')) {
        $links = Get-Children $e 'link'
        $alt = $links | Where-Object { -not $_.GetAttribute('rel') -or $_.GetAttribute('rel') -eq 'alternate' } | Select-Object -First 1
        if (-not $alt) { $alt = $links | Select-Object -First 1 }
        $date = Get-Child $e 'published'
        if (-not $date) { $date = Get-Child $e 'updated' }
        $items += @{ title = Get-PlainText (Get-Child $e 'title'); link = $(if ($alt) { $alt.GetAttribute('href') } else { '' }); date = ConvertTo-IsoDate ($(if ($date) { $date.InnerText })) }
      }
    }
    'RDF' {
      $channel = Get-Child $root 'channel'
      if ($channel) { $title = Get-PlainText (Get-Child $channel 'title') }
      foreach ($it in (Get-Children $root 'item')) {
        $date = Get-Child $it 'date'
        $items += @{ title = Get-PlainText (Get-Child $it 'title'); link = Get-PlainText (Get-Child $it 'link'); date = ConvertTo-IsoDate ($(if ($date) { $date.InnerText })) }
      }
    }
    default { throw 'Not an RSS or Atom feed' }
  }
  # Relative links resolve against the feed's address; anything not http(s) is dropped.
  $clean = @()
  foreach ($i in $items) {
    if (-not $i.title -or -not $i.link) { continue }
    $abs = $null
    if (-not [Uri]::TryCreate($uri, $i.link.Trim(), [ref]$abs)) { continue }
    if (-not (Get-WebUri $abs.AbsoluteUri)) { continue }
    if ($i.title.Length -gt 300) { $i.title = $i.title.Substring(0, 300) + '…' }
    $clean += @{ title = $i.title; link = $abs.AbsoluteUri; date = $i.date }
    if ($clean.Count -ge $MaxItems) { break }
  }
  if (-not $title) { $title = $uri.Host }
  @{ ok = $true; title = $title; items = $clean }
}

function Open-Link([string]$hexUrl) {
  $uri = Get-WebUri (ConvertFrom-HexUtf8 $hexUrl)
  if (-not $uri) { throw 'Not an http or https address' }
  Start-Process $uri.AbsoluteUri
  @{ ok = $true }
}

function Invoke-Request([string]$line) {
  $parts = $line.Trim() -split '\s+'
  if ($parts.Count -ne 2) { return @{ ok = $false; error = 'Usage: fetch|open <hexUrl>' } }
  switch ($parts[0]) {
    'fetch' { return Get-Feed $parts[1] }
    'open' { return Open-Link $parts[1] }
    default { return @{ ok = $false; error = "Unknown request '$($parts[0])'" } }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  try { $answer = Invoke-Request $line } catch { $answer = @{ ok = $false; error = $_.Exception.Message } }
  [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 5))
}
