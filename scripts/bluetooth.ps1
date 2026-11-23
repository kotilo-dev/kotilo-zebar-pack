# Bluetooth helper for the island: paired devices, connection state, battery,
# radio on/off and connect/disconnect for audio devices.
#
# Runs as a long-lived process: the island starts it once (shellSpawn) and
# writes one request per line to stdin; each answer is one JSON line on stdout.
#   state              -> {"ok":true,"radio":"on|off|none","devices":[{id,name,kind,connected,battery,audio}]}
#   radio on|off       -> {"ok":true}   switches the Bluetooth radio
#   connect <id>       -> {"ok":true}   enables the A2DP sink / Handsfree services
#   disconnect <id>    -> {"ok":true}   disables them again
#
# id is the 12-digit uppercase hex Bluetooth address (same for classic and
# Bluetooth LE). kind is headphones | speaker | keyboard | mouse | phone | other.
# battery is 0-100 or null (unknown, or the device is not connected: Windows
# keeps the last value of a BLE device around, which would be stale).
# audio is true when the device offers A2DP sink or Handsfree, i.e. when
# connect/disconnect apply. connect/disconnect refuse everything else, so a
# Bluetooth keyboard or mouse can never be switched off from here.
#
# Sources (all read-only and fast, no device scan):
#   paired list, name, class of device, LE appearance, service GUIDs
#       -> HKLM\SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices
#   connected -> bthprops BluetoothGetDeviceInfo (classic), PnP DEVPKEY_Device_IsConnected,
#                WinRT BluetoothLEDevice.ConnectionStatus (LE-only devices); for audio
#                devices also a present A2DP sink / Handsfree service node
#   battery   -> PnP property {104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2 on the device nodes
#   radio     -> WinRT Windows.Devices.Radios
# DeviceInformation.FindAllAsync with System.Devices.Aep.IsConnected works but
# takes about 30 s per protocol, far too slow for polling, so it is not used.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Radios.Radio, Windows.Devices.Radios, ContentType = WindowsRuntime]
$null = [Windows.Devices.Radios.RadioAccessStatus, Windows.Devices.Radios, ContentType = WindowsRuntime]
$null = [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
$Radio = [Windows.Devices.Radios.Radio]

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class BtNative {
  [StructLayout(LayoutKind.Sequential)]
  struct SYSTEMTIME { public ushort a, b, c, d, e, f, g, h; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct DEVINFO {
    public int dwSize; public ulong Address; public uint ulClassofDevice;
    public int fConnected; public int fRemembered; public int fAuthenticated;
    public SYSTEMTIME stLastSeen; public SYSTEMTIME stLastUsed;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string szName;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct DEVPROPKEY { public Guid fmtid; public uint pid; }

  [DllImport("bthprops.cpl")]
  static extern uint BluetoothGetDeviceInfo(IntPtr hRadio, ref DEVINFO d);
  [DllImport("bthprops.cpl")]
  static extern uint BluetoothSetServiceState(IntPtr hRadio, ref DEVINFO d, ref Guid service, uint flags);

  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  static extern uint CM_Get_Device_ID_List_SizeW(out uint len, string filter, uint flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  static extern uint CM_Get_Device_ID_ListW(string filter, char[] buf, uint len, uint flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  static extern uint CM_Locate_DevNodeW(out uint inst, string id, uint flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  static extern uint CM_Get_DevNode_PropertyW(uint inst, ref DEVPROPKEY key, out uint type, byte[] buf, ref uint size, uint flags);

  static DEVINFO NewInfo(ulong address) {
    DEVINFO d = new DEVINFO();
    d.dwSize = Marshal.SizeOf(typeof(DEVINFO));
    d.Address = address;
    return d;
  }

  // 1 connected, 0 not connected, -1 Windows does not know the device.
  public static int ClassicConnected(ulong address) {
    DEVINFO d = NewInfo(address);
    if (BluetoothGetDeviceInfo(IntPtr.Zero, ref d) != 0) return -1;
    return d.fConnected != 0 ? 1 : 0;
  }

  // BLUETOOTH_SERVICE_ENABLE = 1, BLUETOOTH_SERVICE_DISABLE = 0. Returns a Win32 error code, 0 = success.
  public static uint SetService(ulong address, Guid service, bool enable) {
    DEVINFO d = NewInfo(address);
    uint rc = BluetoothGetDeviceInfo(IntPtr.Zero, ref d);
    if (rc != 0) return rc;
    return BluetoothSetServiceState(IntPtr.Zero, ref d, ref service, enable ? 1u : 0u);
  }

  static List<string> Ids(string enumerator) {
    List<string> result = new List<string>();
    uint len;
    // 1 = CM_GETIDLIST_FILTER_ENUMERATOR
    if (CM_Get_Device_ID_List_SizeW(out len, enumerator, 1) != 0 || len < 2) return result;
    char[] buf = new char[len];
    if (CM_Get_Device_ID_ListW(enumerator, buf, len, 1) != 0) return result;
    foreach (string id in new string(buf).Split('\0')) if (id.Length > 0) result.Add(id);
    return result;
  }

  // Every device node of the Bluetooth enumerators that belongs to this address
  // (the device itself, its service nodes, its GATT nodes). hex is 12 uppercase hex digits.
  public static string[] NodesFor(string hex) {
    List<string> result = new List<string>();
    foreach (string e in new string[] { "BTHENUM", "BTHLE", "BTHLEDEVICE" })
      foreach (string id in Ids(e))
        if (id.ToUpperInvariant().Contains(hex)) result.Add(id);
    return result.ToArray();
  }

  static byte[] Prop(string id, string guid, uint pid) {
    uint inst;
    if (CM_Locate_DevNodeW(out inst, id, 0) != 0) return null;
    DEVPROPKEY key = new DEVPROPKEY();
    key.fmtid = new Guid(guid); key.pid = pid;
    uint type, size = 0;
    // CR_BUFFER_SMALL (0x1A) with the needed size means the property exists.
    if (CM_Get_DevNode_PropertyW(inst, ref key, out type, null, ref size, 0) != 0x1A || size == 0) return null;
    byte[] buf = new byte[size];
    if (CM_Get_DevNode_PropertyW(inst, ref key, out type, buf, ref size, 0) != 0) return null;
    return buf;
  }

  // Whether a node is present now. The ID list also holds nodes of devices that are
  // gone; locating with CM_LOCATE_DEVNODE_NORMAL (0) only succeeds for present ones.
  public static bool Present(string id) {
    uint inst;
    return CM_Locate_DevNodeW(out inst, id, 0) == 0;
  }

  // DEVPKEY_Device_IsConnected: 1, 0, or -1 when the node has no such property.
  public static int IsConnected(string id) {
    byte[] b = Prop(id, "83DA6326-97A6-4088-9453-A1923F573B29", 15);
    if (b == null) return -1;
    return b[0] != 0 ? 1 : 0;
  }

  // Battery percent from {104EA319-...} 2, or -1.
  public static int Battery(string id) {
    byte[] b = Prop(id, "104EA319-6EE2-4701-BD47-8DDBF425BBE5", 2);
    if (b == null) return -1;
    int v = b.Length >= 4 ? BitConverter.ToInt32(b, 0) : b[0];
    return (v >= 0 && v <= 100) ? v : -1;
  }
}
'@

# Windows PowerShell has no `await` for WinRT; AsTask turns an IAsyncOperation into a Task.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Wait-Op($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(); $task.Result
}

$A2dpSink = '0000110b-0000-1000-8000-00805f9b34fb'
$Handsfree = '0000111e-0000-1000-8000-00805f9b34fb'
$DevicesKey = 'SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices'

function Read-Text($key, [string]$name) {
  $value = $key.GetValue($name)
  if ($value -is [byte[]]) { return [System.Text.Encoding]::UTF8.GetString($value).Trim([char]0).Trim() }
  if ($null -ne $value) { return "$value".Trim() }
  $null
}

# kind from the Bluetooth class of device (classic) or the GATT appearance (LE).
function Get-Kind($cod, $appearance) {
  if ($null -ne $cod -and $cod -ne 0) {
    $major = ($cod -shr 8) -band 0x1F
    $minor = ($cod -shr 2) -band 0x3F
    switch ($major) {
      2 { return 'phone' }
      4 {
        switch ($minor) {
          { $_ -in 1, 2, 6 } { return 'headphones' }
          { $_ -in 5, 7, 10 } { return 'speaker' }
        }
        return 'other'
      }
      5 {
        switch (($cod -shr 6) -band 3) {
          1 { return 'keyboard' }
          2 { return 'mouse' }
          3 { return 'keyboard' }
        }
        return 'other'
      }
    }
    return 'other'
  }
  if ($null -ne $appearance) {
    $category = $appearance -shr 6
    $sub = $appearance -band 0x3F
    if ($category -eq 1) { return 'phone' }
    if ($category -eq 15) {
      if ($sub -eq 1 -or $sub -eq 3) { return 'keyboard' }
      if ($sub -eq 2) { return 'mouse' }
    }
    if ($category -eq 37) { return 'headphones' }
  }
  'other'
}

# Static facts about every paired device, straight from the registry.
function Get-Paired {
  $root = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($DevicesKey)
  if (-not $root) { return }
  try {
    $list = foreach ($sub in $root.GetSubKeyNames()) {
      if ($sub -notmatch '^[0-9A-Fa-f]{12}$') { continue }
      $key = $root.OpenSubKey($sub)
      if (-not $key) { continue }
      try {
        $name = Read-Text $key 'FriendlyName'
        if (-not $name) { $name = Read-Text $key 'Name' }
        if (-not $name) { $name = Read-Text $key 'LEName' }
        $cod = $key.GetValue('COD')
        $appearance = $key.GetValue('LEAppearance')
        $services = @{}
        foreach ($sf in $key.GetSubKeyNames() | Where-Object { $_ -like 'ServicesFor*' }) {
          $sk = $key.OpenSubKey($sf)
          if ($sk) { foreach ($g in $sk.GetSubKeyNames()) { $services[$g.Trim('{}').ToLowerInvariant()] = $true }; $sk.Close() }
        }
        $isClassic = ($null -ne $cod -and $cod -ne 0)
        $audio = $isClassic -and ($services.ContainsKey($A2dpSink) -or $services.ContainsKey($Handsfree))
        $kind = Get-Kind $cod $appearance
        if ($audio -and $kind -eq 'other') { $kind = 'speaker' }
        [pscustomobject]@{
          id = $sub.ToUpperInvariant(); name = if ($name) { $name } else { $sub.ToUpperInvariant() }
          kind = $kind; classic = $isClassic; audio = [bool]$audio; services = $services
        }
      } finally { $key.Close() }
    }
  } finally { $root.Close() }
  @($list)
}

# BluetoothLEDevice objects are kept so ConnectionStatus is a cheap property read.
$LeDevices = @{}
function Get-LeConnected([string]$id) {
  try {
    if (-not $LeDevices.ContainsKey($id)) {
      $address = [Convert]::ToUInt64($id, 16)
      $LeDevices[$id] = Wait-Op ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromBluetoothAddressAsync($address)) ([Windows.Devices.Bluetooth.BluetoothLEDevice])
    }
    $device = $LeDevices[$id]
    if ($null -eq $device) { $LeDevices.Remove($id); return $false }
    return ("$($device.ConnectionStatus)" -eq 'Connected')
  } catch {
    $LeDevices.Remove($id)
    return $false
  }
}

function Get-RadioState {
  $radios = Wait-Op ($Radio::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  $bt = $radios | Where-Object { "$($_.Kind)" -eq 'Bluetooth' } | Select-Object -First 1
  if (-not $bt) { return 'none' }
  if ("$($bt.State)" -eq 'On') { 'on' } else { 'off' }
}

function Get-State {
  $radio = Get-RadioState
  $list = foreach ($p in @(Get-Paired)) {
    $nodes = [BtNative]::NodesFor($p.id)
    $primary = $nodes | Where-Object { $_ -like "BTHENUM\DEV_$($p.id)\*" -or $_ -like "BTHLE\DEV_$($p.id)\*" } | Select-Object -First 1
    $connected = $false
    if ($p.classic) {
      if ([BtNative]::ClassicConnected([Convert]::ToUInt64($p.id, 16)) -eq 1) { $connected = $true }
    }
    if (-not $connected -and $primary -and [BtNative]::IsConnected($primary) -eq 1) { $connected = $true }
    if (-not $connected -and -not $p.classic) { $connected = Get-LeConnected $p.id }
    if ($connected -and $p.audio) {
      # A speaker or headset can keep its Bluetooth link (media keys) after its audio
      # service is switched off; it only plays while an A2DP or Handsfree node is present.
      $connected = [bool]($nodes | Where-Object {
        ($_ -like '*{0000110B-*' -or $_ -like '*{0000111E-*') -and [BtNative]::Present($_)
      } | Select-Object -First 1)
    }
    $battery = $null
    if ($connected) {
      foreach ($node in $nodes) {
        $value = [BtNative]::Battery($node)
        if ($value -ge 0) { $battery = $value; break }
      }
    }
    [ordered]@{ id = $p.id; name = $p.name; kind = $p.kind; connected = $connected; battery = $battery; audio = $p.audio }
  }
  $sorted = @($list | Sort-Object @{ Expression = { -not $_.connected } }, @{ Expression = { $_.name } })
  @{ ok = $true; radio = $radio; devices = $sorted }
}

function Set-RadioState([string]$target) {
  if ($target -ne 'on' -and $target -ne 'off') { return @{ ok = $false; error = "Usage: radio on|off" } }
  $access = "$(Wait-Op ($Radio::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]))"
  if ($access -ne 'Allowed') { return @{ ok = $false; error = "Radio access $access" } }
  $radios = Wait-Op ($Radio::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  $bt = $radios | Where-Object { "$($_.Kind)" -eq 'Bluetooth' } | Select-Object -First 1
  if (-not $bt) { return @{ ok = $false; error = 'No Bluetooth radio' } }
  $wanted = if ($target -eq 'on') { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
  $status = "$(Wait-Op ($bt.SetStateAsync($wanted)) ([Windows.Devices.Radios.RadioAccessStatus]))"
  if ($status -eq 'Allowed') { return @{ ok = $true } }
  @{ ok = $false; error = $status }
}

# Connect and disconnect switch the device's A2DP sink / Handsfree services.
# Measured on a JBL Go 4 (2026-11-22):
# - disable: the device disconnects and its audio endpoint is removed;
# - enable: the endpoint comes back and the device connects if it is on;
# - enable while the service is already enabled but the device is not connected
#   fails with ERROR_INVALID_PARAMETER (87); disabling first, then enabling,
#   makes it connect.
# Everything is checked before BluetoothSetServiceState is called.
function Set-AudioConnection([string]$id, [bool]$enable) {
  if ($id -notmatch '^[0-9A-F]{12}$') { return @{ ok = $false; error = 'Invalid device id' } }
  $device = @(Get-Paired) | Where-Object { $_.id -eq $id } | Select-Object -First 1
  if (-not $device) { return @{ ok = $false; error = 'Device is not paired' } }
  if (-not $device.classic -or -not $device.audio) { return @{ ok = $false; error = 'Not an audio device' } }
  $address = [Convert]::ToUInt64($id, 16)
  $failures = @()
  $touched = 0
  foreach ($service in $A2dpSink, $Handsfree) {
    if (-not $device.services.ContainsKey($service)) { continue }
    $touched++
    $label = if ($service -eq $A2dpSink) { 'audio (A2DP)' } else { 'hands-free' }
    $code = [BtNative]::SetService($address, [Guid]$service, $enable)
    if ($enable -and $code -eq 87) {
      # Already enabled but not connected: switch it off and on again. If switching
      # it back on fails, try once more so the service is not left off.
      $null = [BtNative]::SetService($address, [Guid]$service, $false)
      $code = [BtNative]::SetService($address, [Guid]$service, $true)
      if ($code -ne 0) { Start-Sleep -Milliseconds 500; $code = [BtNative]::SetService($address, [Guid]$service, $true) }
    }
    if ($code -ne 0) { $failures += "$label failed (Win32 error $code)" }
  }
  if ($touched -eq 0) { return @{ ok = $false; error = 'No audio service' } }
  # Success only when every audio service of the device switched: a speaker that is
  # left with hands-free alone would play in mono, phone quality, while looking connected.
  if ($failures.Count -gt 0) { return @{ ok = $false; error = ($failures -join '; ') } }
  @{ ok = $true }
}

function Invoke-Request([string]$line) {
  $parts = $line.Trim() -split ' ', 2
  $arg = if ($parts.Count -gt 1) { $parts[1].Trim() } else { '' }
  switch ($parts[0]) {
    'state' { return Get-State }
    'radio' { return Set-RadioState $arg }
    'connect' { return Set-AudioConnection $arg $true }
    'disconnect' { return Set-AudioConnection $arg $false }
    default { return @{ ok = $false; error = "Unknown request '$($parts[0])'" } }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  try { $answer = Invoke-Request $line } catch { $answer = @{ ok = $false; error = $_.Exception.Message } }
  [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 5))
}
