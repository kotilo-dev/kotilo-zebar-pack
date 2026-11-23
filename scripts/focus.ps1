# Gives the island window keyboard focus on request.
#
# Runs as a long-lived helper: the island starts it once (shellSpawn) and
# writes a line "focus" to its stdin whenever a panel opened by a shortcut or
# by the bar needs the keyboard. Compiling the Win32 bindings below takes about
# a second, so it is done once at start, not on every request.
#
# Zebar does not grant widgets `set-focus`, and Windows refuses
# SetForegroundWindow from a background process unless that process produced
# the last input event. A synthetic mouse move of zero pixels satisfies that
# rule. (A synthetic Alt press does too, but its key-up then lands on the
# island and puts it in menu mode, which stalls its message loop until the next
# key and drops its focus.)
# Bringing the top-level window forward is not enough on its own: keys still do
# not reach the WebView2 inside it until the page itself is clicked. So a click
# is posted to the WebView's render window, at the top-left corner of the
# island window (its transparent margin, where a click does nothing), without
# moving the real mouse cursor.
#
# The window is found by its title, which Zebar sets to
# "Zebar - <pack> / <widget>". (The `windowHandle` Zebar 3.1.1 hands widgets
# belongs to a hidden helper window, not to the visible one.)
$ErrorActionPreference = 'Stop'

Add-Type -Namespace Kotilo -Name Focus -MemberDefinition @'
public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder name, int max);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

public static IntPtr FindRenderWindow(IntPtr parent) {
  IntPtr found = IntPtr.Zero;
  EnumChildWindows(parent, (h, l) => {
    var name = new System.Text.StringBuilder(64);
    GetClassName(h, name, 64);
    if (name.ToString() == "Chrome_RenderWidgetHostHWND") { found = h; return false; }
    return true;
  }, IntPtr.Zero);
  return found;
}
'@

function Invoke-Focus {
  # [NullString]::Value, not $null: PowerShell turns $null into "" for string
  # parameters, and an empty class name matches no window.
  $hwnd = [Kotilo.Focus]::FindWindow([NullString]::Value, 'Zebar - kotilo-zebar-pack / island')
  if ($hwnd -eq [IntPtr]::Zero) { return 'no-window' }

  [Kotilo.Focus]::mouse_event(0x0001, 0, 0, 0, [UIntPtr]::Zero)   # MOUSEEVENTF_MOVE by 0, 0
  if (-not [Kotilo.Focus]::SetForegroundWindow($hwnd)) { return 'refused' }

  $render = [Kotilo.Focus]::FindRenderWindow($hwnd)
  if ($render -ne [IntPtr]::Zero) {
    $point = [IntPtr]((2 -shl 16) -bor 2)                          # x = 2, y = 2 (client px)
    [Kotilo.Focus]::PostMessage($render, 0x0201, [IntPtr]1, $point) | Out-Null   # WM_LBUTTONDOWN
    [Kotilo.Focus]::PostMessage($render, 0x0202, [IntPtr]0, $point) | Out-Null   # WM_LBUTTONUP
  }
  return 'ok'
}

[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line.Trim() -eq 'focus') { [Console]::Out.WriteLine((Invoke-Focus)) }
}
