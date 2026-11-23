# Audio helper for the island: output/input device switching and per-app volume,
# built on the Windows Core Audio COM APIs (no third-party tools).
#
# Runs as a long-lived process: the island starts it once (shellSpawn) and
# writes one request per line to stdin; each answer is one JSON line on stdout.
#   devices                 -> {"ok":true,"playback":[{id,name,isDefault}],"recording":[...]}
#                              active endpoints only
#   sessions                -> {"ok":true,"sessions":[{pid,name,volume,muted}]}
#                              audio sessions on the default playback device, merged per pid,
#                              volume 0-100
#   set-default <id>        -> {"ok":true}   default device for console, multimedia and
#                              communications roles
#   app-volume <pid> <0-100> -> {"ok":true}  all sessions of that pid on the default playback device
#   app-mute <pid> <0|1>     -> {"ok":true}
#
# Errors are {"ok":false,"error":"..."}; the loop keeps running. The process exits
# when stdin closes. Setting the default device uses the undocumented IPolicyConfig
# interface (the same one the Sound control panel uses).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Compiled once at startup. Windows PowerShell 5.1 ships a C# 5 compiler, so no
# newer syntax here.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace KotiloAudio
{
    [StructLayout(LayoutKind.Sequential)]
    public struct PROPERTYKEY { public Guid fmtid; public uint pid; }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PROPERTYKEY key);
        [PreserveSig] int GetValue(ref PROPERTYKEY key, IntPtr value);
        [PreserveSig] int SetValue(ref PROPERTYKEY key, IntPtr value);
        [PreserveSig] int Commit();
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr groupingParam, uint flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr groupingParam, uint flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
        [PreserveSig] int RegisterSessionNotification(IntPtr notification);
        [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
        [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr notification);
        [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        // IAudioSessionControl
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
        [PreserveSig] int GetGroupingParam(out Guid param);
        [PreserveSig] int SetGroupingParam(ref Guid param, ref Guid context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr events);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr events);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid context);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    // Undocumented; vtable order matters, so the methods before SetDefaultEndpoint are placeholders.
    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat();
        [PreserveSig] int GetDeviceFormat();
        [PreserveSig] int ResetDeviceFormat();
        [PreserveSig] int SetDeviceFormat();
        [PreserveSig] int GetProcessingPeriod();
        [PreserveSig] int SetProcessingPeriod();
        [PreserveSig] int GetShareMode();
        [PreserveSig] int SetShareMode();
        [PreserveSig] int GetPropertyValue();
        [PreserveSig] int SetPropertyValue();
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
        [PreserveSig] int SetEndpointVisibility();
    }

    public class SessionInfo
    {
        public int Pid;
        public string Name;
        public int Volume;
        public bool Muted;
    }

    public class DeviceInfo
    {
        public string Id;
        public string Name;
        public bool IsDefault;
    }

    public static class Audio
    {
        const int eRender = 0, eCapture = 1;
        const int eConsole = 0, eMultimedia = 1, eCommunications = 2;
        const int DEVICE_STATE_ACTIVE = 1;
        const int STGM_READ = 0;
        const int CLSCTX_ALL = 23;
        const int SESSION_EXPIRED = 2;

        [DllImport("ole32.dll")] static extern int PropVariantClear(IntPtr pv);

        static void Check(int hr)
        {
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        }

        static IMMDeviceEnumerator Enumerator()
        {
            return (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        }

        static string DeviceId(IMMDevice device)
        {
            string id;
            Check(device.GetId(out id));
            return id;
        }

        static string FriendlyName(IMMDevice device)
        {
            IPropertyStore store;
            Check(device.OpenPropertyStore(STGM_READ, out store));
            IntPtr pv = Marshal.AllocCoTaskMem(24);
            try
            {
                for (int i = 0; i < 24; i++) Marshal.WriteByte(pv, i, 0);
                PROPERTYKEY key = new PROPERTYKEY();
                key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
                key.pid = 14;
                Check(store.GetValue(ref key, pv));
                short vt = Marshal.ReadInt16(pv, 0);
                string name = null;
                if (vt == 31) name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(pv, 8));
                PropVariantClear(pv);
                return name;
            }
            finally
            {
                Marshal.FreeCoTaskMem(pv);
                Marshal.ReleaseComObject(store);
            }
        }

        public static List<DeviceInfo> Devices(bool recording)
        {
            int flow = recording ? eCapture : eRender;
            IMMDeviceEnumerator en = Enumerator();
            string defaultId = null;
            IMMDevice def;
            if (en.GetDefaultAudioEndpoint(flow, eConsole, out def) == 0)
            {
                defaultId = DeviceId(def);
                Marshal.ReleaseComObject(def);
            }
            IMMDeviceCollection col;
            Check(en.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, out col));
            uint count;
            Check(col.GetCount(out count));
            List<DeviceInfo> list = new List<DeviceInfo>();
            for (uint i = 0; i < count; i++)
            {
                IMMDevice dev;
                Check(col.Item(i, out dev));
                DeviceInfo info = new DeviceInfo();
                info.Id = DeviceId(dev);
                info.Name = FriendlyName(dev);
                info.IsDefault = info.Id == defaultId;
                list.Add(info);
                Marshal.ReleaseComObject(dev);
            }
            Marshal.ReleaseComObject(col);
            Marshal.ReleaseComObject(en);
            return list;
        }

        public static void SetDefault(string id)
        {
            IPolicyConfig policy = (IPolicyConfig)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")));
            try
            {
                Check(policy.SetDefaultEndpoint(id, eConsole));
                Check(policy.SetDefaultEndpoint(id, eMultimedia));
                Check(policy.SetDefaultEndpoint(id, eCommunications));
            }
            finally
            {
                Marshal.ReleaseComObject(policy);
            }
        }

        // Calls visit for every non-system, non-expired session of the default playback device.
        delegate void Visit(int pid, IAudioSessionControl2 control, ISimpleAudioVolume volume);

        static void EachSession(Visit visit)
        {
            IMMDeviceEnumerator en = Enumerator();
            IMMDevice dev;
            Check(en.GetDefaultAudioEndpoint(eRender, eConsole, out dev));
            Guid iid = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
            object o;
            Check(dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o));
            IAudioSessionManager2 mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator sessions;
            Check(mgr.GetSessionEnumerator(out sessions));
            int count;
            Check(sessions.GetCount(out count));
            for (int i = 0; i < count; i++)
            {
                IAudioSessionControl2 ctl;
                Check(sessions.GetSession(i, out ctl));
                try
                {
                    int state;
                    Check(ctl.GetState(out state));
                    if (state == SESSION_EXPIRED) continue;
                    if (ctl.IsSystemSoundsSession() == 0) continue;
                    uint pid;
                    Check(ctl.GetProcessId(out pid));
                    if (pid == 0) continue;
                    visit((int)pid, ctl, (ISimpleAudioVolume)ctl);
                }
                finally
                {
                    Marshal.ReleaseComObject(ctl);
                }
            }
            Marshal.ReleaseComObject(sessions);
            Marshal.ReleaseComObject(mgr);
            Marshal.ReleaseComObject(dev);
            Marshal.ReleaseComObject(en);
        }

        static string ProcessLabel(int pid, string displayName)
        {
            try
            {
                // Disposed each time: this runs on every poll of the sound panel.
                using (Process p = Process.GetProcessById(pid))
                {
                    string name = null;
                    try
                    {
                        name = p.MainModule.FileVersionInfo.FileDescription;
                    }
                    catch { }
                    if (!string.IsNullOrWhiteSpace(name)) return name.Trim();
                    if (!string.IsNullOrWhiteSpace(p.ProcessName)) return p.ProcessName;
                }
            }
            catch { }
            if (!string.IsNullOrWhiteSpace(displayName)) return displayName;
            return "PID " + pid;
        }

        public static List<SessionInfo> Sessions()
        {
            List<SessionInfo> list = new List<SessionInfo>();
            Dictionary<int, SessionInfo> byPid = new Dictionary<int, SessionInfo>();
            Dictionary<int, bool> allMuted = new Dictionary<int, bool>();
            EachSession(delegate (int pid, IAudioSessionControl2 ctl, ISimpleAudioVolume vol)
            {
                float level = 0; bool muted = false;
                vol.GetMasterVolume(out level);
                vol.GetMute(out muted);
                int v = (int)Math.Round(level * 100);
                SessionInfo info;
                if (byPid.TryGetValue(pid, out info))
                {
                    if (v > info.Volume) info.Volume = v;
                    allMuted[pid] = allMuted[pid] && muted;
                    info.Muted = allMuted[pid];
                    return;
                }
                string display = null;
                try { ctl.GetDisplayName(out display); } catch { }
                info = new SessionInfo();
                info.Pid = pid;
                info.Name = ProcessLabel(pid, display);
                info.Volume = v;
                info.Muted = muted;
                allMuted[pid] = muted;
                byPid[pid] = info;
                list.Add(info);
            });
            return list;
        }

        // Returns how many sessions of the pid were changed.
        public static int SetAppVolume(int pid, int percent)
        {
            int n = 0;
            Guid ctx = Guid.Empty;
            EachSession(delegate (int p, IAudioSessionControl2 ctl, ISimpleAudioVolume vol)
            {
                if (p != pid) return;
                Check(vol.SetMasterVolume(percent / 100f, ref ctx));
                n++;
            });
            return n;
        }

        public static int SetAppMute(int pid, bool mute)
        {
            int n = 0;
            Guid ctx = Guid.Empty;
            EachSession(delegate (int p, IAudioSessionControl2 ctl, ISimpleAudioVolume vol)
            {
                if (p != pid) return;
                Check(vol.SetMute(mute, ref ctx));
                n++;
            });
            return n;
        }
    }
}
'@

function Get-DeviceList([bool]$recording) {
  @([KotiloAudio.Audio]::Devices($recording) | ForEach-Object {
    [ordered]@{ id = $_.Id; name = $_.Name; isDefault = [bool]$_.IsDefault }
  })
}

function Read-Int([string]$text, [string]$what) {
  if ($null -eq $text -or $text -notmatch '^\d{1,9}$') { throw "Invalid $what" }
  [int]$text
}

function Invoke-Request([string]$line) {
  $parts = @($line.Trim() -split '\s+')
  switch ($parts[0]) {
    'devices' {
      return @{ ok = $true; playback = @(Get-DeviceList $false); recording = @(Get-DeviceList $true) }
    }
    'sessions' {
      $list = @([KotiloAudio.Audio]::Sessions() | ForEach-Object {
        [ordered]@{ pid = $_.Pid; name = $_.Name; volume = $_.Volume; muted = [bool]$_.Muted }
      })
      return @{ ok = $true; sessions = $list }
    }
    'set-default' {
      $id = $parts[1]
      if ($parts.Count -ne 2 -or $id -cnotmatch '^\{[0-9.]+\}\.\{[0-9a-fA-F-]{36}\}$') { return @{ ok = $false; error = 'Invalid device id' } }
      $known = @(@(Get-DeviceList $false) + @(Get-DeviceList $true) | Where-Object { $_.id -eq $id })
      if ($known.Count -eq 0) { return @{ ok = $false; error = 'Device not found or not active' } }
      [KotiloAudio.Audio]::SetDefault($id)
      return @{ ok = $true }
    }
    'app-volume' {
      if ($parts.Count -ne 3) { return @{ ok = $false; error = 'Usage: app-volume <pid> <0-100>' } }
      $procId = Read-Int $parts[1] 'pid'
      $vol = Read-Int $parts[2] 'volume'
      if ($vol -gt 100) { return @{ ok = $false; error = 'Volume must be 0-100' } }
      if ([KotiloAudio.Audio]::SetAppVolume($procId, $vol) -eq 0) { return @{ ok = $false; error = "No audio session for pid $procId" } }
      return @{ ok = $true }
    }
    'app-mute' {
      if ($parts.Count -ne 3) { return @{ ok = $false; error = 'Usage: app-mute <pid> <0|1>' } }
      $procId = Read-Int $parts[1] 'pid'
      $flag = Read-Int $parts[2] 'mute flag'
      if ($flag -gt 1) { return @{ ok = $false; error = 'Mute flag must be 0 or 1' } }
      if ([KotiloAudio.Audio]::SetAppMute($procId, ($flag -eq 1)) -eq 0) { return @{ ok = $false; error = "No audio session for pid $procId" } }
      return @{ ok = $true }
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
