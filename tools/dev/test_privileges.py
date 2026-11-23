"""Checks the island's shell privileges in zpack.json against allowed and forbidden calls."""
import json
import re
import sys

pack = json.load(open(sys.argv[1], encoding="utf-8"))
rules = [w for w in pack["widgets"] if w["name"] == "island"][0]["privileges"]["shellCommands"]

PS = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "
GLZR = PS + r"C:\Users\user\.glzr\zebar\kotilo-zebar-pack\scripts" + "\\"
DEV = PS + r"C:\Users\user\dev\kotilo-zebar-pack\scripts" + "\\"
# Where the marketplace installs a pack: %AppData%\zebar\downloads\<publisher>.<pack>@<version>.
MARKET = PS + r"C:\Users\user\AppData\Roaming\zebar\downloads\kotilo-dev.kotilo-zebar-pack@0.1.0\scripts" + "\\"

cases = [
    ("powershell.exe", GLZR + "list-apps.ps1", True),
    ("powershell.exe", PS + "C:/Users/user/.glzr/zebar/kotilo-zebar-pack/scripts/sleep.ps1", True),
    ("powershell.exe", PS + r"C:\x\kotilo-zebar-pack\scripts\evil.ps1", False),
    ("powershell.exe", r"-NoProfile -Command Remove-Item C:\ -Recurse", False),
    ("powershell.exe", GLZR + "focus.ps1", True),
    ("powershell.exe", GLZR + "focus.ps1 1; calc", False),
    ("powershell.exe", GLZR + "list-apps.ps1 -Extra", False),
    ("explorer.exe", r"shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", True),
    ("explorer.exe", r"shell:AppsFolder\{6D809377-6AF0-444B-8957-A3773F02200E}\Adobe\Acrobat Reader DC\Reader\AcroRd32.exe", True),
    ("explorer.exe", r"C:\Windows\evil.exe", False),
    ("shutdown.exe", "/s /t 0", True),
    ("shutdown.exe", "/r /t 0", True),
    ("shutdown.exe", "/l", True),
    ("shutdown.exe", "/s /t 0 /f", False),
    ("rundll32.exe", "user32.dll,LockWorkStation", True),
    ("rundll32.exe", "shell32.dll,Control_RunDLL", False),
    ("powershell.exe", GLZR + "audio.ps1", True),
    ("powershell.exe", GLZR + "wifi.ps1", True),
    ("powershell.exe", GLZR + "sysmon.ps1", True),
    ("powershell.exe", GLZR + "calendar.ps1", True),
    ("powershell.exe", GLZR + "wifi.ps1 connect x", False),
    # The pack runs from wherever the junction points (here the dev folder).
    ("powershell.exe", DEV + "wifi.ps1", True),
    # A second script slipped in before the pack path, or a pack copy outside a user profile.
    ("powershell.exe", PS + r"C:\Temp\evil.ps1 x\kotilo-zebar-pack\scripts\audio.ps1", False),
    ("powershell.exe", PS + r"C:\Users\a\evil.ps1 x\kotilo-zebar-pack\scripts\audio.ps1", False),
    ("powershell.exe", PS + r"C:\Temp\kotilo-zebar-pack\scripts\audio.ps1", False),
    ("explorer.exe", "ms-settings:network-wifi", True),
    ("explorer.exe", "ms-settings:bluetooth", True),
    ("explorer.exe", "https://kotilo.dev", True),
    ("explorer.exe", "https://github.com/kotilo-dev", True),
    ("explorer.exe", "https://kotilo.dev.evil.com", False),
    ("explorer.exe", "https://github.com/kotilo-dev/../evil", False),
    ("explorer.exe", "https://kotiloxdev", False),
    ("powershell.exe", DEV + "appearance.ps1", True),
    ("powershell.exe", DEV + "appearance.ps1 borders #000000 #000000", False),
    ("explorer.exe", "ms-settings:personalization-background", False),
    ("explorer.exe", "ms-settings:bluetooth-devices", False),
    ("powershell.exe", DEV + "bluetooth.ps1", True),
    ("powershell.exe", DEV + "bluetooth.ps1 radio off", False),
    ("explorer.exe", "ms-settings:windowsupdate", False),
    ("powershell.exe", DEV + "tweaks.ps1", True),
    ("powershell.exe", DEV + "tweaks.ps1 theme light", False),
    ("explorer.exe", "ms-screenclip:", True),
    ("explorer.exe", "ms-screenclip:?type=recording", False),
    ("explorer.exe", r"ms-screenclip: C:\evil.exe", False),
    ("powershell.exe", DEV + "notifications.ps1", True),
    ("powershell.exe", DEV + "notifications.ps1 clear", False),
    ("explorer.exe", "ms-settings:notifications", True),
    ("explorer.exe", "ms-settings:notifications-advanced", False),
    ("explorer.exe", r"ms-settings:network-wifi C:\evil.exe", False),
    ("explorer.exe", "ms-settings:", True),
    ("explorer.exe", r"ms-settings: C:\evil.exe", False),
    ("explorer.exe", "ms-settings:x", False),
    # Marketplace install folder: publisher prefix and version suffix.
    ("powershell.exe", MARKET + "list-apps.ps1", True),
    ("powershell.exe", MARKET + "notifications.ps1", True),
    ("powershell.exe", PS + r"C:\Users\user\AppData\Roaming\zebar\downloads\kotilo-zebar-pack@0.1.0\scripts\audio.ps1", True),
    ("powershell.exe", PS + r"C:\Users\user\AppData\Roaming\zebar\downloads\someone.kotilo-zebar-pack@1.2.3-beta.1\scripts\audio.ps1", True),
    ("powershell.exe", MARKET + "audio.ps1 x", False),
    ("powershell.exe", MARKET + "evil.ps1", False),
    # Look-alike pack names and tricks around the prefix and the version.
    ("powershell.exe", PS + r"C:\Users\user\AppData\Roaming\zebar\downloads\evil kotilo-zebar-pack@0.1.0\scripts\audio.ps1", False),
    ("powershell.exe", PS + r"C:\Users\user\Downloads\kotilo-zebar-pack-evil\scripts\audio.ps1", False),
    ("powershell.exe", PS + r"C:\Users\user\x\kotilo-zebar-pack@0.1.0 C:\Temp\evil.ps1 \scripts\audio.ps1", False),
    ("powershell.exe", PS + r"C:\Users\user\x\a;b.kotilo-zebar-pack\scripts\audio.ps1", False),
]

bad = 0
for program, args, expected in cases:
    allowed = any(r["program"] == program and re.search(r["argsRegex"], args) for r in rules)
    ok = allowed == expected
    bad += not ok
    print("OK " if ok else "BAD", program, args, "->", allowed)
print(f"{len(cases) - bad}/{len(cases)} passed")
sys.exit(1 if bad else 0)
