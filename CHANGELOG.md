# Changelog

## Unreleased

- **Added:** a Files panel (folder button in the control centre's top left): it starts with your main
  folders and drives, a click goes into a folder and Up (or Backspace) goes back. Each row can open the
  item (a folder in File Explorer, a file in its default app), copy the file itself to paste in File
  Explorer, or copy its path. Hidden and system files are not listed.
- **Changed:** the Clipboard button moved to the right-hand group of the control centre's header.

## 0.3.0 — 2026-11-24

- **Added:** a News panel (RSS button in the control centre's top left): stories from your RSS and Atom
  feeds, newest first, with a feed filter; a click opens the story in your browser. Feeds are read by a
  helper (most feeds cannot be read from the page) and only when the panel opens, at most every 15 minutes.
- **Added:** Settings › Keybindings lists Kotilo's and GlazeWM's shortcuts from GlazeWM's config. Click a
  key combination and press new keys to change it; conflicts are refused, the change is written to that
  one line of the config and GlazeWM reloads it. Shortcuts can also be found in the launcher.
- **Added:** bar styles (full, floating, segments) and bar opacity in Settings; the floating bar lines up
  with GlazeWM's outer gaps, and the island follows the opacity.
- **Added:** workspace styles in Settings (numbers, dots, Roman, kanji).
- **Added:** a Task Manager button in the control centre and on the system monitor, and a Today button
  in the calendar.
- **Changed:** Settings is split into pages: Appearance, Bar & workspaces, Notifications, Keybindings;
  Windows Settings is at the bottom.
- **Changed:** the now-playing equalizer is replaced by the album cover in the island's media card (the
  bar shows a music icon); while media plays this uses about a third of the CPU.
- **Changed:** the media card is one row with the controls on the right; the weather card is larger and
  no longer repeats the battery.
- **Changed:** the Kotilo logo follows the theme colours.
- **Fixed:** picking a minimized window in the window list now restores it.

## 0.2.1 — 2026-11-24

- **Fixed:** program icons did not show in the window list when the launcher had loaded them first.

## 0.2.0 — 2026-11-24

- **Changed:** PowerShell helpers used now and then (sound, Wi-Fi, appearance, quick settings, system
  monitor, calendar) exit after 3 minutes without requests and start again when needed; each held about
  60-70 MB. Keep awake keeps its helper running while it is on.
- **Changed:** the launcher reads the app list at most every 10 minutes and recent files every 2 minutes,
  instead of on every opening (about 2.3 s of CPU each time).
- **Changed:** the now-playing equalizer animates with `transform` instead of `height`, so it no longer
  re-lays out the bar and the island on every frame; while media plays this halves Zebar's CPU use.
- **Fixed:** helpers that stopped answering were never ended: Zebar 3.1.1's `ShellProcess.kill` sends the
  wrong argument name, like `write`. The island now calls the command directly.
- **Added:** a weather panel (button in the control centre's top left, or click the weather card): now,
  the next 24 hours and 7 days with rain chance, daily ranges, sunrise, sunset and UV, from Open-Meteo.

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
