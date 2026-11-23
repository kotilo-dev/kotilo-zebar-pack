# Changelog

## Unreleased

- **Added:** the launcher is now one search box, inspired by KRunner and rofi: open windows (switch to
  them), system commands (sign out, restart and shut down need a second Enter), GlazeWM commands, Windows
  Settings pages and recent files, ranked by fuzzy match and frecency.
- **Added:** launcher prefixes: `=` calculator and unit conversion (length, mass, temperature, volume,
  data, time, speed; conversions and plain sums like `(23+5)*5` also work without `=`), `:` emoji, `?` web search, `,` clipboard history.
- **Added:** program icons in the window list and in launcher results for windows.
- **Added:** close buttons in the window list (X on a row, Delete, or "Close all" with a second click).

- **Added:** a tiling direction button on the bar's left side; a click flips GlazeWM between side by side and stacked.
- **Added:** an "All windows" button next to it opens a new island panel that lists the windows of every workspace,
  searchable; a click or Enter switches to that window's workspace and focuses it.
- **Added:** both buttons can be hidden in Settings → Bar items.
- **Changed:** About is now the first entry in Settings.

## 0.1.1 — 2026-11-23

- **Fixed:** in marketplace installs the island never got keyboard focus, so the launcher search could not be
  typed into and Esc did not close panels. The focus helper looked for the window title of a local copy only.
- **Added:** click a day in the control centre's month grid to see that day's events; "Back to today" returns.
- **Docs:** calendar events need classic Outlook; the new Outlook for Windows has no local interface to read from.

## 0.1.0 — 2026-11-23

First release: GlazeWM top bar with a dynamic island — control centre, app launcher with calculator, Wi-Fi,
Bluetooth, sound, system monitor, calendar, clipboard history, system tray, Windows notifications, to-do, notes,
timer / stopwatch / Pomodoro, power menu and 17 themes.
