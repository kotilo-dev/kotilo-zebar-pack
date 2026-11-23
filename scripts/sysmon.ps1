# System monitor helper for the island: top processes by CPU and by memory.
#
# Runs as a long-lived process: the island starts it once (shellSpawn) and
# writes one request per line to stdin; each answer is one JSON line on stdout.
#   top -> {"ok":true,"cpu":[{name,count,cpu,mb}],"memory":[{name,count,cpu,mb}]}
#
# Both lists hold 6 entries, processes grouped by name (count = group size).
# cpu is the share of the whole machine (0-100, one decimal): the growth of
# TotalProcessorTime since the previous `top` call, divided by elapsed wall
# time and the logical processor count. The first call has no previous sample,
# so it samples, waits 500 ms and samples again. mb is PrivateMemorySize64
# summed over the group, in whole MB. Processes whose CPU time cannot be read
# (access denied) are skipped for the cpu figure but still counted for memory.
# Nothing is stored on disk.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Cores = [Environment]::ProcessorCount
$Prev = @{}          # key "pid:startTicks" -> total CPU seconds at $PrevTime
$PrevTime = $null

# One pass over all processes. Returns rows with name, key, cpu seconds
# (or $null when unreadable) and private bytes.
function Get-Sample {
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($p in [System.Diagnostics.Process]::GetProcesses()) {
    try {
      if ($p.Id -eq 0 -or $p.ProcessName -eq 'Idle') { continue }
      $key = $null; $cpu = $null
      try {
        $cpu = $p.TotalProcessorTime.TotalSeconds
        $key = "$($p.Id):$($p.StartTime.Ticks)"
      } catch { $cpu = $null; $key = $null }
      $mem = 0L
      try { $mem = $p.PrivateMemorySize64 } catch { }
      $rows.Add([pscustomobject]@{ Name = $p.ProcessName; Key = $key; Cpu = $cpu; Mem = $mem })
    } catch {
      # process vanished mid-read
    } finally {
      $p.Dispose()
    }
  }
  , $rows
}

function Get-Top {
  if ($null -eq $script:PrevTime) {
    $first = Get-Sample
    $script:PrevTime = [DateTime]::UtcNow
    $script:Prev = @{}
    foreach ($r in $first) { if ($r.Key) { $script:Prev[$r.Key] = $r.Cpu } }
    Start-Sleep -Milliseconds 500
  }
  $rows = Get-Sample
  $now = [DateTime]::UtcNow
  $elapsed = ($now - $script:PrevTime).TotalSeconds
  if ($elapsed -le 0) { $elapsed = 0.001 }

  $groups = @{}
  $next = @{}
  foreach ($r in $rows) {
    $g = $groups[$r.Name]
    if (-not $g) { $g = @{ name = $r.Name; count = 0; delta = 0.0; mem = 0L }; $groups[$r.Name] = $g }
    $g.count++
    $g.mem += $r.Mem
    if ($r.Key) {
      $next[$r.Key] = $r.Cpu
      if ($script:Prev.ContainsKey($r.Key)) {
        $d = $r.Cpu - $script:Prev[$r.Key]
        if ($d -gt 0) { $g.delta += $d }
      }
    }
  }
  $script:Prev = $next
  $script:PrevTime = $now

  $all = foreach ($g in $groups.Values) {
    [pscustomobject][ordered]@{
      name  = $g.name
      count = $g.count
      cpu   = [Math]::Round([Math]::Min(100.0, 100.0 * $g.delta / $elapsed / $Cores), 1)
      mb    = [int][Math]::Round($g.mem / 1MB)
    }
  }
  $byCpu = @($all | Sort-Object -Property @{ Expression = 'cpu'; Descending = $true }, @{ Expression = 'mb'; Descending = $true } | Select-Object -First 6)
  $byMem = @($all | Sort-Object -Property @{ Expression = 'mb'; Descending = $true } | Select-Object -First 6)
  @{ ok = $true; cpu = $byCpu; memory = $byMem }
}

function Invoke-Request([string]$line) {
  $parts = $line.Trim() -split ' ', 2
  switch ($parts[0]) {
    'top' { return Get-Top }
    default { return @{ ok = $false; error = "Unknown request '$($parts[0])'" } }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  try { $answer = Invoke-Request $line } catch { $answer = @{ ok = $false; error = $_.Exception.Message } }
  [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 5))
}
