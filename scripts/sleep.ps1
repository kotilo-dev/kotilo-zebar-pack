# Puts the machine to sleep.
# On Modern Standby (S0) machines the classic suspend call often hibernates
# instead, so there the display is turned off and Windows enters standby on its
# own. Only machines that list S3 standby as available use the classic suspend.
$ErrorActionPreference = 'Stop'

# `powercfg /a` lists the available states first, then the unavailable ones.
$available = ((powercfg /a | Out-String) -split 'not available')[0]

if ($available -match 'Standby \(S3\)') {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null
} else {
  Add-Type -Namespace Kotilo -Name Monitor -MemberDefinition @'
[DllImport("user32.dll")]
public static extern int SendMessage(int hWnd, int msg, int wParam, int lParam);
'@
  # HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, 2 = off
  [Kotilo.Monitor]::SendMessage(0xFFFF, 0x0112, 0xF170, 2) | Out-Null
}
