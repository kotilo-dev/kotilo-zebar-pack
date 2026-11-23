# Prints the icons of the Start menu apps as JSON: { "<AppID>": "<base64 PNG>" }.
#
# Each icon comes from the shell itself (IShellItemImageFactory on
# shell:AppsFolder\<AppID>), which covers desktop and Store apps alike.
# Extracting all of them takes a few seconds, so they are cached in
# %LOCALAPPDATA%\kotilo-zebar-pack\app-icons.json and only new apps are
# extracted on later runs.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$size = 48

# Compiling the shell bindings costs about a second, so it only happens when an
# app is missing from the cache.
$iconSource = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class KotiloIcons {
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory {
    [PreserveSig] int GetImage(Size size, int flags, out IntPtr bitmap);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid iid,
    [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);

  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr handle);

  const int SIIGBF_BIGGERSIZEOK = 0x1;
  const int SIIGBF_ICONONLY = 0x4;

  /// Base64 PNG of the item's icon, or null when the shell has none.
  public static string Png(string parsingName, int size) {
    Guid iid = typeof(IShellItemImageFactory).GUID;
    IShellItemImageFactory factory;
    try { SHCreateItemFromParsingName(parsingName, IntPtr.Zero, ref iid, out factory); }
    catch { return null; }

    IntPtr hbitmap;
    if (factory.GetImage(new Size(size, size), SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK, out hbitmap) != 0) return null;
    try {
      // FromHbitmap drops the alpha channel; the bits still carry it, so they
      // are re-read as premultiplied ARGB to keep transparent edges.
      using (Bitmap source = Image.FromHbitmap(hbitmap)) {
        Rectangle rect = new Rectangle(0, 0, source.Width, source.Height);
        BitmapData data = source.LockBits(rect, ImageLockMode.ReadOnly, source.PixelFormat);
        try {
          using (Bitmap withAlpha = new Bitmap(data.Width, data.Height, data.Stride, PixelFormat.Format32bppPArgb, data.Scan0))
          using (MemoryStream png = new MemoryStream()) {
            withAlpha.Save(png, ImageFormat.Png);
            return Convert.ToBase64String(png.ToArray());
          }
        } finally { source.UnlockBits(data); }
      }
    } finally { DeleteObject(hbitmap); }
  }
}
'@
function Initialize-IconType {
  if (-not ('KotiloIcons' -as [type])) { Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $iconSource }
}

$cacheDir = Join-Path $env:LOCALAPPDATA 'kotilo-zebar-pack'
$cacheFile = Join-Path $cacheDir 'app-icons.json'
$cache = @{}
if (Test-Path $cacheFile) {
  try {
    (Get-Content $cacheFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $cache[$_.Name] = $_.Value }
  } catch { $cache = @{} }
}

$icons = [ordered]@{}
$changed = $false
foreach ($app in Get-StartApps) {
  if (-not $app.AppID) { continue }
  if ($cache.ContainsKey($app.AppID)) {
    $icons[$app.AppID] = $cache[$app.AppID]
    continue
  }
  Initialize-IconType
  $png = [KotiloIcons]::Png("shell:AppsFolder\$($app.AppID)", $size)
  # An empty string marks "no icon" so the app is not retried on every run.
  $icons[$app.AppID] = if ($png) { $png } else { '' }
  $changed = $true
}

if ($changed -or $icons.Count -ne $cache.Count) {
  New-Item -ItemType Directory -Force $cacheDir | Out-Null
  $icons | ConvertTo-Json -Compress | Set-Content $cacheFile -Encoding UTF8
}
$icons | ConvertTo-Json -Compress
