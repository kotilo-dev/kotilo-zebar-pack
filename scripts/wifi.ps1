# Wi-Fi helper for the island, built on the Native Wifi API (wlanapi.dll).
# netsh output is localized, so it is never parsed.
#
# Runs as a long-lived process: the island starts it once (shellSpawn) and
# writes one request per line to stdin; each answer is one JSON line on stdout.
#   list              -> {"ok":true,"interface":true,"networks":[{ssid,signal,secured,auth,sae,saved,connected,profile}]}
#                        auth is "open", "personal" (WPA-PSK, WPA2-Personal, WPA3-SAE) or
#                        "enterprise" (WPA, WPA2/WPA3-Enterprise, anything else); sae is true
#                        for WPA3-SAE (scans first and waits ~3 s; no wireless adapter gives
#                        {"ok":true,"interface":false,"networks":[]})
#   connect <profile> -> {"ok":true}   only for a saved profile of that exact name (the `profile` from list)
#   join <hexSsid> <hexPassword>
#                     -> {"ok":true}   creates (never overwrites) an all-user profile named after the
#                        SSID for an in-range open/personal network, connects and waits up to 15 s.
#                        Both arguments are UTF-8 bytes in hex; the password is "-" for open networks
#                        and 8-63 characters (or 64 hex digits) otherwise. Errors: "enterprise",
#                        "not in range", "wrong-password", "timeout", "access-denied", "invalid ssid",
#                        "invalid password", "profile exists" (a profile of that name is already
#                        saved; use connect). A failed join deletes the profile it created. The
#                        password is never printed or stored by the script.
#   disconnect        -> {"ok":true}
#
# Errors are {"ok":false,"error":"..."}. error "location" means Windows denied
# access (Windows 11 24H2 needs the location permission for Wi-Fi scans).
# The first wireless interface is used. The script stores nothing; only join
# creates or changes a profile.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public class WlanException : Exception {
  public int Code;
  public WlanException(string what, int code) : base(what + " failed (error " + code + ")") { Code = code; }
}

public class WlanNet {
  public string Ssid;
  public string Profile;
  public int Signal;
  public bool Secured;
  public string Auth;
  public bool Sae;
  public bool Connected;
  public bool Saved;
}

public static class Wlan {
  const int ERROR_ACCESS_DENIED = 5;

  [StructLayout(LayoutKind.Sequential)]
  struct ConnParams {
    public int Mode;
    public IntPtr Profile;
    public IntPtr Ssid;
    public IntPtr Bssids;
    public int BssType;
    public int Flags;
  }

  [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint clientVersion, IntPtr reserved, out uint negotiated, out IntPtr handle);
  [DllImport("wlanapi.dll")] static extern int WlanCloseHandle(IntPtr handle, IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr handle, IntPtr reserved, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanScan(IntPtr handle, ref Guid iface, IntPtr ssid, IntPtr ie, IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern int WlanGetAvailableNetworkList(IntPtr handle, ref Guid iface, uint flags, IntPtr reserved, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanGetProfileList(IntPtr handle, ref Guid iface, IntPtr reserved, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanConnect(IntPtr handle, ref Guid iface, ref ConnParams p, IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern int WlanDisconnect(IntPtr handle, ref Guid iface, IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern int WlanSetProfile(IntPtr handle, ref Guid iface, uint flags, [MarshalAs(UnmanagedType.LPWStr)] string xml, IntPtr security, [MarshalAs(UnmanagedType.Bool)] bool overwrite, IntPtr reserved, out uint reason);
  [DllImport("wlanapi.dll")] static extern int WlanDeleteProfile(IntPtr handle, ref Guid iface, [MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern int WlanQueryInterface(IntPtr handle, ref Guid iface, int opcode, IntPtr reserved, out uint size, out IntPtr data, IntPtr type);
  [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr p);

  static void Check(string what, int rc) {
    if (rc != 0) throw new WlanException(what, rc);
  }

  // WLAN_INTERFACE_INFO_LIST: 8-byte header, then 532-byte entries (GUID, 256 WCHAR, state).
  // Returns false when there is no wireless interface.
  static bool FirstInterface(IntPtr handle, out Guid iface) {
    iface = Guid.Empty;
    IntPtr list;
    Check("WlanEnumInterfaces", WlanEnumInterfaces(handle, IntPtr.Zero, out list));
    try {
      if (Marshal.ReadInt32(list, 0) < 1) return false;
      byte[] g = new byte[16];
      Marshal.Copy(new IntPtr(list.ToInt64() + 8), g, 0, 16);
      iface = new Guid(g);
      return true;
    } finally { WlanFreeMemory(list); }
  }

  static IntPtr Open() {
    uint negotiated; IntPtr handle;
    Check("WlanOpenHandle", WlanOpenHandle(2, IntPtr.Zero, out negotiated, out handle));
    return handle;
  }

  // WLAN_PROFILE_INFO_LIST: 8-byte header, then 516-byte entries (256 WCHAR name, flags).
  static List<string> Profiles(IntPtr handle, Guid iface) {
    var names = new List<string>();
    IntPtr list;
    Check("WlanGetProfileList", WlanGetProfileList(handle, ref iface, IntPtr.Zero, out list));
    try {
      int n = Marshal.ReadInt32(list, 0);
      for (int i = 0; i < n; i++)
        names.Add(Marshal.PtrToStringUni(new IntPtr(list.ToInt64() + 8 + i * 516)));
    } finally { WlanFreeMemory(list); }
    return names;
  }

  // WLAN_AVAILABLE_NETWORK is 628 bytes: profile name @0 (256 WCHAR), SSID length @512,
  // SSID bytes @516, signal quality @604, security enabled @608, default auth algorithm @612,
  // default cipher algorithm @616, flags @620.
  static List<WlanNet> ReadNetworks(IntPtr handle, Guid iface) {
    IntPtr list;
    Check("WlanGetAvailableNetworkList", WlanGetAvailableNetworkList(handle, ref iface, 0, IntPtr.Zero, out list));
    var result = new List<WlanNet>();
    try {
      int n = Marshal.ReadInt32(list, 0);
      for (int i = 0; i < n; i++) {
        long p = list.ToInt64() + 8 + (long)i * 628;
        int len = Marshal.ReadInt32(new IntPtr(p + 512));
        if (len < 0 || len > 32) len = 0;
        byte[] raw = new byte[len];
        if (len > 0) Marshal.Copy(new IntPtr(p + 516), raw, 0, len);
        int flags = Marshal.ReadInt32(new IntPtr(p + 620));
        var net = new WlanNet();
        net.Ssid = Encoding.UTF8.GetString(raw);
        net.Profile = Marshal.PtrToStringUni(new IntPtr(p));
        net.Signal = Marshal.ReadInt32(new IntPtr(p + 604));
        net.Secured = Marshal.ReadInt32(new IntPtr(p + 608)) != 0;
        int auth = Marshal.ReadInt32(new IntPtr(p + 612));
        net.Sae = auth == 9; // DOT11_AUTH_ALGO_WPA3_SAE
        if (auth == 1 && !net.Secured) net.Auth = "open"; // DOT11_AUTH_ALGO_80211_OPEN without security
        else if (auth == 4 || auth == 7 || auth == 9) net.Auth = "personal"; // WPA_PSK, RSNA_PSK, WPA3_SAE
        else net.Auth = "enterprise"; // WPA, RSNA, WPA3(_ENT), WEP, OWE, unknown
        net.Connected = (flags & 1) != 0; // WLAN_AVAILABLE_NETWORK_CONNECTED
        result.Add(net);
      }
    } finally { WlanFreeMemory(list); }
    return result;
  }

  // Returns null when there is no wireless interface.
  public static WlanNet[] List(int waitMs) {
    IntPtr handle = Open();
    try {
      Guid iface;
      if (!FirstInterface(handle, out iface)) return null;
      int rc = WlanScan(handle, ref iface, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
      if (rc == ERROR_ACCESS_DENIED) throw new WlanException("WlanScan", rc);
      // other scan errors (for example a scan already running) are not fatal:
      // the cached list below is still useful
      System.Threading.Thread.Sleep(waitMs);

      var result = ReadNetworks(handle, iface);

      // A network counts as saved when it carries a profile name or a profile of that name
      // exists. Windows compares profile names without case, so this does too, and the
      // real profile name is kept for `connect`.
      var saved = Profiles(handle, iface);
      foreach (var net in result) {
        if (string.IsNullOrEmpty(net.Profile))
          foreach (var pn in saved)
            if (string.Equals(pn, net.Ssid, StringComparison.OrdinalIgnoreCase)) { net.Profile = pn; break; }
        net.Saved = !string.IsNullOrEmpty(net.Profile);
      }
      return result.ToArray();
    } finally { WlanCloseHandle(handle, IntPtr.Zero); }
  }

  public static string[] SavedProfiles() {
    IntPtr handle = Open();
    try {
      Guid iface;
      if (!FirstInterface(handle, out iface)) return new string[0];
      return Profiles(handle, iface).ToArray();
    } finally { WlanCloseHandle(handle, IntPtr.Zero); }
  }

  // Returns false when there is no wireless interface.
  public static bool Connect(string profile) {
    IntPtr handle = Open();
    IntPtr name = IntPtr.Zero;
    try {
      Guid iface;
      if (!FirstInterface(handle, out iface)) return false;
      name = Marshal.StringToHGlobalUni(profile);
      var p = new ConnParams();
      p.Mode = 0; // wlan_connection_mode_profile
      p.Profile = name;
      p.BssType = 3; // dot11_BSS_type_any
      Check("WlanConnect", WlanConnect(handle, ref iface, ref p, IntPtr.Zero));
      return true;
    } finally {
      if (name != IntPtr.Zero) Marshal.FreeHGlobal(name);
      WlanCloseHandle(handle, IntPtr.Zero);
    }
  }

  static byte[] FromHex(string hex) {
    var b = new byte[hex.Length / 2];
    for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
    return b;
  }

  static string Esc(string s) { return System.Security.SecurityElement.Escape(s); }

  // mode: "open", "personal" (WPA2-Personal) or "sae" (WPA3-Personal). key is null for open.
  public static string BuildProfileXml(string name, byte[] ssid, string key, string mode) {
    var sb = new StringBuilder();
    sb.Append("<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\">");
    sb.Append("<name>").Append(Esc(name)).Append("</name>");
    sb.Append("<SSIDConfig><SSID><hex>").Append(BitConverter.ToString(ssid).Replace("-", "")).Append("</hex>");
    sb.Append("<name>").Append(Esc(name)).Append("</name></SSID></SSIDConfig>");
    sb.Append("<connectionType>ESS</connectionType><connectionMode>auto</connectionMode>");
    sb.Append("<MSM><security><authEncryption><authentication>");
    sb.Append(mode == "open" ? "open" : mode == "sae" ? "WPA3SAE" : "WPA2PSK");
    sb.Append("</authentication><encryption>").Append(mode == "open" ? "none" : "AES");
    sb.Append("</encryption><useOneX>false</useOneX></authEncryption>");
    if (mode != "open") {
      bool raw = key.Length == 64 && mode == "personal";
      sb.Append("<sharedKey><keyType>").Append(raw ? "networkKey" : "passphrase").Append("</keyType>");
      sb.Append("<protected>false</protected><keyMaterial>").Append(Esc(key)).Append("</keyMaterial></sharedKey>");
    }
    sb.Append("</security></MSM></WLANProfile>");
    return sb.ToString();
  }

  // WLAN_INTF_OPCODE_INTERFACE_STATE: an int, -1 on error.
  static int QueryState(IntPtr handle, Guid iface) {
    uint size; IntPtr data;
    if (WlanQueryInterface(handle, ref iface, 6, IntPtr.Zero, out size, out data, IntPtr.Zero) != 0) return -1;
    try { return Marshal.ReadInt32(data, 0); } finally { WlanFreeMemory(data); }
  }

  // WLAN_INTF_OPCODE_CURRENT_CONNECTION: WLAN_CONNECTION_ATTRIBUTES has state @0, mode @4,
  // profile name @8 (256 WCHAR) and the association attributes @520, which start with the SSID
  // (length @520, bytes @524). Null when not connected.
  static byte[] CurrentSsid(IntPtr handle, Guid iface) {
    uint size; IntPtr data;
    if (WlanQueryInterface(handle, ref iface, 7, IntPtr.Zero, out size, out data, IntPtr.Zero) != 0) return null;
    try {
      int len = Marshal.ReadInt32(data, 520);
      if (len < 0 || len > 32) return null;
      byte[] raw = new byte[len];
      if (len > 0) Marshal.Copy(new IntPtr(data.ToInt64() + 524), raw, 0, len);
      return raw;
    } finally { WlanFreeMemory(data); }
  }

  static bool SameBytes(byte[] a, byte[] b) {
    if (a == null || b == null || a.Length != b.Length) return false;
    for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
    return true;
  }

  // Returns "ok" or an error string. Validation happens before any API call.
  public static string Join(string hexSsid, string hexPass) {
    byte[] ssid = null, pw = null;
    char[] chars = null;
    string key = null;
    try {
      if (hexSsid == null || hexSsid.Length < 2 || hexSsid.Length > 64 || hexSsid.Length % 2 != 0 || !Regex.IsMatch(hexSsid, "^[0-9a-fA-F]+$"))
        return "invalid ssid";
      ssid = FromHex(hexSsid);
      string name;
      try { name = new UTF8Encoding(false, true).GetString(ssid); } catch (ArgumentException) { return "invalid ssid"; }
      foreach (char c in name) if (c < 0x20 || c == 0x7f) return "invalid ssid";

      bool noPass = hexPass == "-";
      if (!noPass) {
        if (hexPass == null || hexPass.Length < 2 || hexPass.Length % 2 != 0 || !Regex.IsMatch(hexPass, "^[0-9a-fA-F]+$"))
          return "invalid password";
        pw = FromHex(hexPass);
        try { chars = new UTF8Encoding(false, true).GetChars(pw); } catch (ArgumentException) { return "invalid password"; }
        foreach (char c in chars) if (c < 0x20 || c == 0x7f) return "invalid password";
        bool hex64 = chars.Length == 64 && Regex.IsMatch(new string(chars), "^[0-9a-fA-F]+$");
        if (!hex64 && (chars.Length < 8 || chars.Length > 63)) return "invalid password";
        key = new string(chars);
      }

      IntPtr handle = Open();
      try {
        Guid iface;
        if (!FirstInterface(handle, out iface)) return "No wireless interface";
        WlanNet found = null;
        foreach (var net in ReadNetworks(handle, iface))
          if (net.Ssid == name) { found = net; break; }
        if (found == null) return "not in range";
        if (found.Auth == "enterprise") return "enterprise";
        if (found.Auth == "personal" && key == null) return "invalid password";
        if (found.Auth == "personal" && found.Sae && key.Length == 64) return "invalid password";
        string mode = found.Auth == "open" ? "open" : found.Sae ? "sae" : "personal";

        // Join only creates profiles; it never replaces one the user already has
        // (profile names compare without case in Windows). Saved networks use `connect`.
        foreach (var pn in Profiles(handle, iface))
          if (string.Equals(pn, name, StringComparison.OrdinalIgnoreCase)) return "profile exists";

        bool cleanup = false, success = false;
        try {
          uint reason;
          // overwrite: false as a second guard against replacing an existing profile.
          int rc = WlanSetProfile(handle, ref iface, 0, BuildProfileXml(name, ssid, mode == "open" ? null : key, mode), IntPtr.Zero, false, IntPtr.Zero, out reason);
          if (rc == ERROR_ACCESS_DENIED) return "access-denied";
          if (rc == 183) return "profile exists"; // ERROR_ALREADY_EXISTS
          Check("WlanSetProfile", rc);
          cleanup = true; // the profile is ours; remove it again if the join fails

          IntPtr pname = Marshal.StringToHGlobalUni(name);
          try {
            var p = new ConnParams();
            p.Mode = 0; // wlan_connection_mode_profile
            p.Profile = pname;
            p.BssType = 3; // dot11_BSS_type_any
            Check("WlanConnect", WlanConnect(handle, ref iface, ref p, IntPtr.Zero));
          } finally { Marshal.FreeHGlobal(pname); }

          // wlan_interface_state: connected 1, disconnected 4, authenticating 7
          bool authenticating = false;
          int deadline = Environment.TickCount + 15000;
          while (Environment.TickCount - deadline < 0) {
            System.Threading.Thread.Sleep(500);
            int st = QueryState(handle, iface);
            if (st == 7) authenticating = true;
            if (st == 1 && SameBytes(CurrentSsid(handle, iface), ssid)) { success = true; return "ok"; }
            if (st == 4 && authenticating) return "wrong-password";
          }
          return "timeout";
        } finally {
          if (cleanup && !success) WlanDeleteProfile(handle, ref iface, name, IntPtr.Zero);
        }
      } finally { WlanCloseHandle(handle, IntPtr.Zero); }
    } finally {
      // managed strings cannot be wiped, the byte and char copies can
      if (pw != null) Array.Clear(pw, 0, pw.Length);
      if (chars != null) Array.Clear(chars, 0, chars.Length);
    }
  }

  public static bool Disconnect() {
    IntPtr handle = Open();
    try {
      Guid iface;
      if (!FirstInterface(handle, out iface)) return false;
      Check("WlanDisconnect", WlanDisconnect(handle, ref iface, IntPtr.Zero));
      return true;
    } finally { WlanCloseHandle(handle, IntPtr.Zero); }
  }
}
'@

function Get-List {
  $nets = [Wlan]::List(3000)
  if ($null -eq $nets) { return @{ ok = $true; interface = $false; networks = @() } }
  # one entry per SSID: strongest signal wins, flags are OR-ed
  $bySsid = @{}
  foreach ($n in $nets) {
    if (-not $n.Ssid) { continue }
    $isSaved = $n.Saved
    # The profile to connect with: its own name can differ from the SSID ("Home 2", renamed profiles).
    $profile = if ($n.Profile) { $n.Profile } elseif ($isSaved) { $n.Ssid } else { $null }
    $e = $bySsid[$n.Ssid]
    if ($null -eq $e) {
      $bySsid[$n.Ssid] = [ordered]@{ ssid = $n.Ssid; signal = [int]$n.Signal; secured = [bool]$n.Secured; auth = $n.Auth; sae = [bool]$n.Sae; saved = [bool]$isSaved; connected = [bool]$n.Connected; profile = $profile }
    } else {
      if (-not $e.profile) { $e.profile = $profile }
      if ($n.Signal -gt $e.signal) { $e.signal = [int]$n.Signal; $e.auth = $n.Auth; $e.sae = [bool]$n.Sae }
      $e.secured = $e.secured -or [bool]$n.Secured
      $e.saved = $e.saved -or [bool]$isSaved
      $e.connected = $e.connected -or [bool]$n.Connected
    }
  }
  $sorted = New-Object 'System.Collections.Generic.List[object]'
  foreach ($e in ($bySsid.Values | Sort-Object @{ Expression = { -not $_.connected } }, @{ Expression = { $_.signal }; Descending = $true })) { $sorted.Add($e) }
  @{ ok = $true; interface = $true; networks = $sorted.ToArray() }
}

function Invoke-Request([string]$line) {
  # Only the start is trimmed: a profile name may end in spaces.
  $parts = $line.TrimStart() -split ' ', 2
  switch ($parts[0]) {
    'list' { return Get-List }
    'connect' {
      $ssid = if ($parts.Count -gt 1) { $parts[1] } else { '' }
      if (-not $ssid) { return @{ ok = $false; error = 'Missing profile name' } }
      if (-not (@([Wlan]::SavedProfiles()) -ccontains $ssid)) { return @{ ok = $false; error = 'not saved' } }
      if (-not [Wlan]::Connect($ssid)) { return @{ ok = $false; error = 'No wireless interface' } }
      return @{ ok = $true }
    }
    'join' {
      $joinArgs = if ($parts.Count -gt 1) { @($parts[1].Trim() -split '\s+') } else { @() }
      if ($joinArgs.Count -ne 2) { return @{ ok = $false; error = 'Usage: join <hexSsid> <hexPassword>' } }
      $r = [Wlan]::Join($joinArgs[0], $joinArgs[1])
      if ($r -eq 'ok') { return @{ ok = $true } }
      return @{ ok = $false; error = $r }
    }
    'disconnect' {
      if (-not [Wlan]::Disconnect()) { return @{ ok = $false; error = 'No wireless interface' } }
      return @{ ok = $true }
    }
    default { return @{ ok = $false; error = "Unknown request '$($parts[0])'" } }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  try {
    $answer = Invoke-Request $line
  } catch {
    $ex = $_.Exception
    if ($ex.InnerException) { $ex = $ex.InnerException }
    $msg = if ($ex -is [WlanException] -and $ex.Code -eq 5) { 'location' } else { $ex.Message }
    $answer = @{ ok = $false; error = $msg }
  }
  [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 5))
}
