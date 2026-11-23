import type { LucideIcon } from 'lucide-react';
import {
  AppWindow,
  ArrowRightLeft,
  Columns2,
  Expand,
  File,
  Folder,
  Globe,
  Layers,
  Lock,
  LogOut,
  Maximize2,
  Minimize2,
  Moon,
  MoveRight,
  Pause,
  Power,
  RefreshCw,
  RotateCw,
  Settings,
  SquareStack,
  X,
} from 'lucide-react';
import { matchAny, type Match } from './search';
import type { PowerAction, RecentFile } from './system';
import { sortedWorkspaces, workspaceLabel, type WindowRow, type WmOutput } from './wmWindows';

/**
 * What the launcher can find besides apps, as plain data. Each source turns a
 * query into scored candidates; the launcher view adds apps, merges, ranks and
 * runs them.
 */

export type Kind = 'app' | 'window' | 'system' | 'wm' | 'setting' | 'file' | 'web' | 'calc' | 'emoji' | 'clip';

/** Ties in score go to the kind listed first. */
export const KIND_ORDER: Kind[] = ['calc', 'app', 'window', 'system', 'wm', 'setting', 'file', 'clip', 'emoji', 'web'];

export type Candidate<T> = { item: T; match: Match };

/** Keeps the items whose title or keywords match, with their match. */
export function filterMatches<T>(items: readonly T[], query: string, text: (item: T) => [string, readonly string[]]) {
  const out: Candidate<T>[] = [];
  for (const item of items) {
    const [title, keywords] = text(item);
    const m = matchAny(title, keywords, query);
    if (m) out.push({ item, match: m });
  }
  return out;
}

/* ---- Open windows ----------------------------------------------------------------- */

/** A window matches on its program name and its title; the program name is what is shown and highlighted. */
export const matchWindows = (rows: WindowRow[], query: string) =>
  filterMatches(rows, query, (r) => [r.win.processName || r.win.title, [r.win.title]]);

/* ---- System commands ---------------------------------------------------------------- */

export type SystemCommand = { action: PowerAction; title: string; keywords: string[]; icon: LucideIcon; confirm: boolean };

/** Sign out, restart and shut down close apps, so they need a second Enter (or click). */
export const SYSTEM_COMMANDS: SystemCommand[] = [
  { action: 'lock', title: 'Lock', keywords: ['lock screen', 'lock computer'], icon: Lock, confirm: false },
  { action: 'sleep', title: 'Sleep', keywords: ['suspend', 'standby'], icon: Moon, confirm: false },
  { action: 'signout', title: 'Sign out', keywords: ['log out', 'logout', 'log off'], icon: LogOut, confirm: true },
  { action: 'restart', title: 'Restart', keywords: ['reboot'], icon: RotateCw, confirm: true },
  { action: 'shutdown', title: 'Shut down', keywords: ['shutdown', 'power off', 'turn off'], icon: Power, confirm: true },
];

/* ---- GlazeWM commands --------------------------------------------------------------- */

export type WmCommand = {
  key: string;
  title: string;
  keywords: string[];
  icon: LucideIcon;
  command: string;
  /** Acts on the focused window (its name is shown under the title). */
  onWindow: boolean;
};

const FIXED_WM_COMMANDS: WmCommand[] = [
  { key: 'float', title: 'Toggle floating', keywords: ['float', 'floating', 'unfloat'], icon: SquareStack, command: 'toggle-floating --centered', onWindow: true },
  { key: 'fullscreen', title: 'Toggle fullscreen', keywords: ['fullscreen', 'maximize'], icon: Maximize2, command: 'toggle-fullscreen', onWindow: true },
  { key: 'tiling', title: 'Tile window', keywords: ['tile', 'tiling', 'untile'], icon: Columns2, command: 'toggle-tiling', onWindow: true },
  { key: 'minimize', title: 'Minimize window', keywords: ['minimize', 'hide'], icon: Minimize2, command: 'toggle-minimized', onWindow: true },
  { key: 'close', title: 'Close window', keywords: ['close', 'quit', 'kill'], icon: X, command: 'close', onWindow: true },
  { key: 'direction', title: 'Flip tiling direction', keywords: ['tiling direction', 'split', 'horizontal', 'vertical'], icon: ArrowRightLeft, command: 'toggle-tiling-direction', onWindow: false },
  { key: 'pause', title: 'Pause or resume GlazeWM', keywords: ['pause', 'resume', 'glazewm'], icon: Pause, command: 'wm-toggle-pause', onWindow: false },
  { key: 'reload', title: 'Reload GlazeWM config', keywords: ['reload', 'config', 'glazewm'], icon: RefreshCw, command: 'wm-reload-config', onWindow: false },
  { key: 'redraw', title: 'Redraw windows', keywords: ['redraw', 'refresh', 'glazewm'], icon: Expand, command: 'wm-redraw', onWindow: false },
];

/** The fixed commands plus "go to" and "move window to" for each workspace. */
export function wmCommands(wm: WmOutput): WmCommand[] {
  const perWorkspace = sortedWorkspaces(wm).flatMap((ws) => {
    const name = workspaceLabel(ws);
    return [
      {
        key: `go-${ws.name}`,
        title: `Go to workspace ${name}`,
        keywords: [`ws ${name}`, `workspace ${name}`, `desktop ${name}`],
        icon: Layers,
        command: `focus --workspace ${ws.name}`,
        onWindow: false,
      },
      {
        key: `move-${ws.name}`,
        title: `Move window to workspace ${name}`,
        keywords: [`move ${name}`, `send ${name}`, `move to ${name}`],
        icon: MoveRight,
        command: `move --workspace ${ws.name}`,
        onWindow: true,
      },
    ];
  });
  return [...FIXED_WM_COMMANDS, ...perWorkspace];
}

/* ---- Windows Settings pages ------------------------------------------------------------ */

export type SettingsPage = { page: string; title: string; keywords: string[] };

/**
 * Pages of the Settings app. Every `page` must be listed in the `ms-settings:`
 * rule in zpack.json, or Zebar refuses to open it.
 */
export const SETTINGS_PAGES: SettingsPage[] = [
  { page: 'display', title: 'Display', keywords: ['screen', 'resolution', 'scale', 'monitor', 'brightness'] },
  { page: 'sound', title: 'Sound', keywords: ['audio', 'volume', 'speakers', 'microphone'] },
  { page: 'bluetooth', title: 'Bluetooth & devices', keywords: ['bluetooth', 'devices', 'pair'] },
  { page: 'network-wifi', title: 'Wi-Fi', keywords: ['wifi', 'wireless', 'internet'] },
  { page: 'network-status', title: 'Network & internet', keywords: ['network', 'ethernet', 'internet'] },
  { page: 'network-vpn', title: 'VPN', keywords: ['vpn'] },
  { page: 'notifications', title: 'Notifications', keywords: ['notifications', 'alerts'] },
  { page: 'quiethours', title: 'Do not disturb', keywords: ['focus', 'quiet hours', 'dnd'] },
  { page: 'nightlight', title: 'Night light', keywords: ['night light', 'blue light', 'warm'] },
  { page: 'powersleep', title: 'Power & battery', keywords: ['power', 'sleep', 'battery', 'screen timeout'] },
  { page: 'batterysaver', title: 'Battery saver', keywords: ['battery', 'energy saver'] },
  { page: 'storagesense', title: 'Storage', keywords: ['disk', 'storage', 'space', 'cleanup'] },
  { page: 'appsfeatures', title: 'Installed apps', keywords: ['apps', 'uninstall', 'programs'] },
  { page: 'defaultapps', title: 'Default apps', keywords: ['default', 'browser', 'open with'] },
  { page: 'startupapps', title: 'Startup apps', keywords: ['startup', 'autostart', 'boot'] },
  { page: 'personalization', title: 'Personalization', keywords: ['personalize', 'look'] },
  { page: 'personalization-background', title: 'Background', keywords: ['wallpaper', 'background', 'desktop'] },
  { page: 'colors', title: 'Colors', keywords: ['dark mode', 'light mode', 'accent', 'theme'] },
  { page: 'themes', title: 'Themes', keywords: ['theme', 'cursor', 'icons'] },
  { page: 'taskbar', title: 'Taskbar', keywords: ['taskbar', 'tray'] },
  { page: 'lockscreen', title: 'Lock screen', keywords: ['lock screen', 'screensaver'] },
  { page: 'mousetouchpad', title: 'Mouse', keywords: ['mouse', 'touchpad', 'pointer', 'scroll'] },
  { page: 'typing', title: 'Typing', keywords: ['keyboard', 'typing', 'autocorrect'] },
  { page: 'dateandtime', title: 'Date & time', keywords: ['date', 'time', 'clock', 'time zone'] },
  { page: 'regionlanguage', title: 'Language & region', keywords: ['language', 'region', 'keyboard layout', 'locale'] },
  { page: 'windowsupdate', title: 'Windows Update', keywords: ['update', 'updates', 'patch'] },
  { page: 'privacy', title: 'Privacy & security', keywords: ['privacy', 'security', 'permissions'] },
  { page: 'yourinfo', title: 'Accounts', keywords: ['account', 'user', 'profile'] },
  { page: 'signinoptions', title: 'Sign-in options', keywords: ['password', 'pin', 'hello', 'sign in'] },
  { page: 'about', title: 'About this PC', keywords: ['about', 'system info', 'pc name', 'specs'] },
  { page: 'multitasking', title: 'Multitasking', keywords: ['snap', 'alt tab', 'virtual desktops'] },
  { page: 'printers', title: 'Printers & scanners', keywords: ['printer', 'print', 'scanner'] },
  { page: 'easeofaccess', title: 'Accessibility', keywords: ['accessibility', 'ease of access', 'narrator', 'magnifier'] },
  { page: 'clipboard', title: 'Clipboard', keywords: ['clipboard', 'history', 'win+v'] },
];

/** A settings page matches on its name and words, and on "<name> settings". */
export const matchSettings = (query: string) =>
  filterMatches(SETTINGS_PAGES, query, (p) => [p.title, [...p.keywords, `${p.title} settings`, 'settings']]);

/* ---- Recent files ----------------------------------------------------------------------- */

export const matchRecentFiles = (files: RecentFile[], query: string) =>
  filterMatches(files, query, (f) => [f.name, [f.target]]);

export const fileIcon = (f: RecentFile) => (f.folder ? Folder : File);

/** The folder a file is in, for the line under its name. */
export const parentFolder = (path: string) => path.replace(/[\\/][^\\/]*[\\/]?$/, '') || path;

/* ---- Icons used by the view -------------------------------------------------------------- */

export const ICONS = { window: AppWindow, setting: Settings, web: Globe };
