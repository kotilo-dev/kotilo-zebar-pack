# Calendar helper for the island: today's and tomorrow's Outlook events.
#
# Runs as a long-lived process: the island starts it once (shellSpawn) and
# writes one request per line to stdin; each answer is one JSON line on stdout.
#   events -> {"ok":true,"running":false}
#          -> {"ok":true,"running":true,"events":[{subject,start,end,location,allDay,busy}]}
#   day <yyyy-MM-dd> -> the same answer for that one day (a day picked in the month grid)
#
# start/end are milliseconds since the Unix epoch (UTC); busy is Outlook's
# BusyStatus integer (0 free, 1 tentative, 2 busy, 3 out of office, 4 elsewhere).
# The window is today 00:00 up to the day after tomorrow 00:00 (local time),
# or the picked day 00:00 to the next 00:00; at most 30 items, recurring events
# expanded.
#
# This script never starts Outlook: it only attaches to a running instance with
# Marshal.GetActiveObject (New-Object -ComObject would launch it). With no
# OUTLOOK process, or if attaching fails, the answer is running:false. It reads
# only Subject, Start, End, Location, AllDayEvent and BusyStatus - never Body,
# organizer, recipients or addresses, which would trigger Outlook's security
# prompt. It does not call Quit; COM objects it creates are released.
#
# Restrict date strings: Outlook parses them in the current culture, so they
# are built with ToString('g') (culture short date + short time), the
# known-working form on any locale.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Epoch = New-Object DateTime 1970, 1, 1, 0, 0, 0, ([DateTimeKind]::Utc)

function Release($obj) {
  if ($null -ne $obj -and [System.Runtime.InteropServices.Marshal]::IsComObject($obj)) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj)
  }
}

function ConvertTo-Millis([DateTime]$local) {
  [long][Math]::Floor(($local.ToUniversalTime() - $Epoch).TotalMilliseconds)
}

function Get-Events([DateTime]$from, [int]$days) {
  $procs = @(Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue)
  foreach ($p in $procs) { $p.Dispose() }
  if ($procs.Count -eq 0) { return @{ ok = $true; running = $false } }

  $app = $null; $ns = $null; $folder = $null; $items = $null; $restricted = $null
  try {
    try { $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
    catch { return @{ ok = $true; running = $false } }

    $ns = $app.GetNamespace('MAPI')
    $folder = $ns.GetDefaultFolder(9)
    $items = $folder.Items
    $items.IncludeRecurrences = $true
    $items.Sort('[Start]')

    $to = $from.AddDays($days)
    $filter = "[Start] < '" + $to.ToString('g') + "' AND [End] > '" + $from.ToString('g') + "'"
    $restricted = $items.Restrict($filter)

    $list = New-Object System.Collections.Generic.List[object]
    $item = $restricted.GetFirst()
    while ($null -ne $item -and $list.Count -lt 30) {
      try {
        $list.Add([ordered]@{
          subject  = [string]$item.Subject
          start    = ConvertTo-Millis $item.Start
          end      = ConvertTo-Millis $item.End
          location = [string]$item.Location
          allDay   = [bool]$item.AllDayEvent
          busy     = [int]$item.BusyStatus
        })
      } finally { Release $item }
      $item = $restricted.GetNext()
    }
    Release $item
    return @{ ok = $true; running = $true; events = @($list) }
  } finally {
    Release $restricted; Release $items; Release $folder; Release $ns; Release $app
  }
}

function Invoke-Request([string]$line) {
  $parts = $line.Trim() -split ' ', 2
  switch ($parts[0]) {
    'events' { return Get-Events ([DateTime]::Today) 2 }
    'day' {
      $text = if ($parts.Count -gt 1) { $parts[1].Trim() } else { '' }
      $date = [DateTime]::MinValue
      if ($text -notmatch '^\d{4}-\d{2}-\d{2}$' -or
          -not [DateTime]::TryParseExact($text, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::None, [ref]$date)) {
        return @{ ok = $false; error = "Bad date '$text'" }
      }
      return Get-Events $date 1
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
