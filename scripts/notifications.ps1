# Windows notification helper for the island: reads the toasts in the Windows
# notification centre and removes them on request.
#
# Runs as a long-lived process: the island starts it once (shellSpawn) and
# writes one request per line to stdin; each answer is one JSON line on stdout.
#   list            -> {"ok":true,"access":"Allowed","items":[{id,app,aumid,title,body,time}]}
#   remove <id>[,<id>...] -> {"ok":true,"removed":n}
#   clear           -> {"ok":true}   (every toast in the notification centre)
#   activate <hexAumid> -> {"ok":true,"activated":bool}  brings the app's open window forward
#                     (the AppUserModelID as hex-encoded UTF-8; false when it has no window)
#
# Uses UserNotificationListener (WinRT), which Windows PowerShell 5.1 can call
# when "Notification access" is allowed in Windows privacy settings. Nothing is
# written to disk; titles and texts are only passed to the island to show.
# `time` is ms since the epoch. The newest 100 toasts are listed.
#
# With $env:KOTILO_DRY_RUN = '1', remove, clear and activate change nothing.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.UI.Notifications.KnownNotificationBindings, Windows.UI.Notifications, ContentType = WindowsRuntime]

# Finding an app's open window by its AppUserModelID: first the ID a window
# sets on itself (most apps with notifications do), then the ID of the
# packaged process that owns it (Store apps such as the new Outlook).
Add-Type -Namespace Kotilo -Name AppWindows -MemberDefinition @'
public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern int GetApplicationUserModelId(IntPtr process, ref uint length, System.Text.StringBuilder id);
[DllImport("shell32.dll")] public static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
[DllImport("ole32.dll")] public static extern int PropVariantClear(ref PropVariant pv);

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PropertyKey { public Guid fmtid; public uint pid; }

[StructLayout(LayoutKind.Explicit)]
public struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(8)] public long pad; }

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  int GetCount(out uint count);
  int GetAt(uint index, out PropertyKey key);
  int GetValue(ref PropertyKey key, out PropVariant value);
  int SetValue(ref PropertyKey key, ref PropVariant value);
  int Commit();
}

/** The AppUserModelID a window set on itself, or null. */
public static string WindowAumid(IntPtr hwnd) {
  Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
  IPropertyStore store;
  if (SHGetPropertyStoreForWindow(hwnd, ref iid, out store) != 0 || store == null) return null;
  try {
    PropertyKey key = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    PropVariant v;
    if (store.GetValue(ref key, out v) != 0) return null;
    string id = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : null;   // VT_LPWSTR
    PropVariantClear(ref v);
    return id;
  } finally { Marshal.ReleaseComObject(store); }
}

/** The AppUserModelID of a packaged process, or null for ordinary desktop apps. */
public static string ProcessAumid(uint pid) {
  IntPtr h = OpenProcess(0x1000, false, pid);   // PROCESS_QUERY_LIMITED_INFORMATION
  if (h == IntPtr.Zero) return null;
  try {
    uint len = 512;
    var sb = new System.Text.StringBuilder((int)len);
    return GetApplicationUserModelId(h, ref len, sb) == 0 ? sb.ToString() : null;
  } finally { CloseHandle(h); }
}

/** The topmost visible (or minimised), titled, unowned window of the app with this ID. */
public static IntPtr FindAppWindow(string aumid) {
  IntPtr found = IntPtr.Zero;
  EnumWindows((h, l) => {
    if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero || GetWindowTextLength(h) == 0) return true;  // GW_OWNER
    string id = WindowAumid(h);
    if (id == null) { uint pid; GetWindowThreadProcessId(h, out pid); id = ProcessAumid(pid); }
    if (id != null && string.Equals(id, aumid, StringComparison.OrdinalIgnoreCase)) { found = h; return false; }
    return true;
  }, IntPtr.Zero);
  return found;
}
'@

$DryRun = $env:KOTILO_DRY_RUN -eq '1'
$Listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current

function ConvertFrom-HexUtf8([string]$hex) {
  if ($hex -notmatch '^[0-9a-fA-F]+$' -or ($hex.Length % 2) -ne 0 -or $hex.Length -gt 1024) { throw 'Argument must be hex-encoded' }
  $bytes = for ($i = 0; $i -lt $hex.Length; $i += 2) { [Convert]::ToByte($hex.Substring($i, 2), 16) }
  [System.Text.Encoding]::UTF8.GetString([byte[]]$bytes)
}

# Brings the app's open window to the front. `activated` is false when it has
# none; the island then starts the app instead. Starting an app that is already
# open would open a second window in many apps (the new Outlook among them).
function Invoke-Activate([string]$hexAumid) {
  $aumid = ConvertFrom-HexUtf8 $hexAumid
  $hwnd = [Kotilo.AppWindows]::FindAppWindow($aumid)
  if ($hwnd -eq [IntPtr]::Zero) { return @{ ok = $true; activated = $false } }
  if ($DryRun) { return @{ ok = $true; activated = $true; dryRun = $true } }
  # A zero-pixel mouse move makes this process the last input source, which
  # Windows requires before it lets a background process bring a window forward.
  [Kotilo.AppWindows]::mouse_event(0x0001, 0, 0, 0, [UIntPtr]::Zero)
  if ([Kotilo.AppWindows]::IsIconic($hwnd)) { [Kotilo.AppWindows]::ShowWindow($hwnd, 9) | Out-Null }   # SW_RESTORE
  $ok = [Kotilo.AppWindows]::SetForegroundWindow($hwnd)
  @{ ok = $true; activated = [bool]$ok }
}

$AsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
  Select-Object -First 1
$ListType = [System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]]

function Get-Toasts {
  $task = $AsTask.MakeGenericMethod($ListType).Invoke($null, @($Listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)))
  if (-not $task.Wait(8000)) { throw 'Windows did not return the notifications in time' }
  , $task.Result
}

function Get-List {
  $access = [string]$Listener.GetAccessStatus()
  if ($access -ne 'Allowed') { return @{ ok = $true; access = $access; items = @() } }
  $items = foreach ($n in (Get-Toasts)) {
    try {
      $app = 'Unknown'; $aumid = $null
      try { $app = $n.AppInfo.DisplayInfo.DisplayName; $aumid = $n.AppInfo.AppUserModelId } catch { }
      $texts = @()
      $binding = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
      if ($binding) { $texts = @($binding.GetTextElements() | ForEach-Object { $_.Text } | Where-Object { $_ }) }
      $body = ($texts | Select-Object -Skip 1) -join "`n"
      if ($body.Length -gt 300) { $body = $body.Substring(0, 300) }
      [pscustomobject][ordered]@{
        id    = [uint32]$n.Id
        app   = $app
        aumid = $aumid
        title = if ($texts.Count) { $texts[0] } else { $app }
        body  = $body
        time  = [long]$n.CreationTime.ToUnixTimeMilliseconds()
      }
    } catch {
      # A notification that vanished or cannot be read is skipped.
    }
  }
  $sorted = @($items | Sort-Object -Property time -Descending | Select-Object -First 100)
  @{ ok = $true; access = $access; items = $sorted }
}

function Remove-Toasts([string]$ids) {
  # Re-checked here, next to the call: only comma-separated numbers get through.
  if ($ids -notmatch '^[0-9]{1,10}(,[0-9]{1,10}){0,199}$') { throw 'Bad id list' }
  $n = 0
  foreach ($id in $ids -split ',') {
    if (-not $DryRun) { $Listener.RemoveNotification([uint32]$id) }
    $n++
  }
  @{ ok = $true; removed = $n; dryRun = $DryRun }
}

function Invoke-Request([string]$line) {
  $line = $line.Trim()
  switch -Regex ($line) {
    '^list$' { return Get-List }
    '^remove ([0-9,]+)$' { return Remove-Toasts $Matches[1] }
    '^activate ([0-9a-fA-F]+)$' { return Invoke-Activate $Matches[1] }
    '^clear$' {
      if (-not $DryRun) { $Listener.ClearNotifications() }
      return @{ ok = $true; dryRun = $DryRun }
    }
    default { return @{ ok = $false; error = "Unknown request '$(($line -split ' ')[0])'" } }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  try { $answer = Invoke-Request $line } catch { $answer = @{ ok = $false; error = $_.Exception.Message } }
  [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 5))
}
