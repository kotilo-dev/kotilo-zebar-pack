import { invoke } from '@tauri-apps/api/core';
import { shellExec, shellSpawn } from 'zebar';
import { windowSettled } from '../shared/widgetWindow';

type ShellProcess = Awaited<ReturnType<typeof shellSpawn>>;

/**
 * Everything the island runs on the system. Each call here needs a matching,
 * anchored rule under `privileges.shellCommands` in zpack.json; Zebar rejects
 * anything else.
 */

/**
 * What Zebar's desktop side hands each widget. Zebar 3.1.1 sends `htmlPath`
 * but not the `configPath` its typings promise.
 */
type WidgetState = { htmlPath: string };

function widgetState(): WidgetState {
  const fromWindow = (window as unknown as { __ZEBAR_STATE?: WidgetState }).__ZEBAR_STATE;
  return fromWindow ?? JSON.parse(sessionStorage.getItem('ZEBAR_STATE') ?? '{}');
}

/** The pack folder: the HTML lives at `<pack>\dist\island.html`. */
function packDir(): string {
  const parts = widgetState().htmlPath.split(/[\\/]/);
  return parts.slice(0, -2).join('\\');
}

type Script =
  | 'list-apps'
  | 'app-icons'
  | 'sleep'
  | 'focus'
  | 'clipboard'
  | 'audio'
  | 'wifi'
  | 'sysmon'
  | 'calendar'
  | 'bluetooth'
  | 'appearance'
  | 'tweaks'
  | 'notifications'
  | 'recent'
  | 'window-icons';

const scriptArgs = (name: Script) => [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  `${packDir()}\\scripts\\${name}.ps1`,
];

const runScript = (name: Script) => shellExec('powershell.exe', scriptArgs(name));

export type StartApp = { name: string; appId: string };

export async function listApps(): Promise<StartApp[]> {
  const out = await runScript('list-apps');
  if (out.code !== 0) throw new Error(out.stderr || `list-apps exited with ${out.code}`);
  const raw = JSON.parse(out.stdout || '[]') as { Name: string; AppID: string }[] | { Name: string; AppID: string };
  return (Array.isArray(raw) ? raw : [raw]).map((a) => ({ name: a.Name, appId: a.AppID }));
}

/** Icons of the Start menu apps as data URLs, keyed by AppID. Cached on disk by the script. */
export async function appIcons(): Promise<Record<string, string>> {
  const out = await runScript('app-icons');
  if (out.code !== 0) throw new Error(out.stderr || `app-icons exited with ${out.code}`);
  const raw = JSON.parse(out.stdout || '{}') as Record<string, string>;
  const icons: Record<string, string> = {};
  // An app without an icon keeps an empty entry, so it does not count as new on every launcher open.
  for (const [id, png] of Object.entries(raw)) icons[id] = png ? `data:image/png;base64,${png}` : '';
  return icons;
}

export function launchApp(app: StartApp) {
  return shellExec('explorer.exe', [`shell:AppsFolder\\${app.appId}`]);
}

let focusHelper: Promise<ShellProcess> | null = null;

/** Starts scripts/focus.ps1 once and keeps it running; it restarts if it ever exits. */
function startFocusHelper(): Promise<ShellProcess> {
  focusHelper ??= shellSpawn('powershell.exe', scriptArgs('focus')).then((proc) => {
    proc.onStdout((line) => line.trim() !== 'ok' && line.trim() !== 'ready' && console.warn('[kotilo] focus:', line));
    proc.onExit(() => (focusHelper = null));
    return proc;
  });
  focusHelper.catch(() => (focusHelper = null));
  return focusHelper;
}

/** Warms the helper up at start, so the first shortcut is as quick as the rest. */
export const prepareFocus = () => void startFocusHelper().catch((err) => console.warn('[kotilo] focus helper', err));

/**
 * Writes to a spawned process's stdin. `ShellProcess.write` cannot be used:
 * in Zebar 3.1.1 the client calls `shell_write` with `{ processId }` while the
 * desktop command takes `pid`, so every write fails. This calls the same
 * command with the argument name it expects.
 */
const writeStdin = (proc: ShellProcess, data: string) => invoke('shell_write', { pid: proc.processId, buffer: data });

/**
 * Gives the island keyboard focus, e.g. after a GlazeWM shortcut opened a panel.
 * Waits until the window has grown to the panel's size first: the helper's
 * click lands at the window's top-left corner, which only then is empty margin
 * (on the small resting window it would hit the panel itself).
 */
export async function focusIsland() {
  try {
    await windowSettled();
    await writeStdin(await startFocusHelper(), 'focus\n');
  } catch (err) {
    console.warn('[kotilo] focus failed', err);
  }
}

/* ---- Long-lived helpers -------------------------------------------------------- */

type Answer = { ok: boolean; error?: string; [key: string]: unknown };

/**
 * A script that runs as long as the island does: it takes one request per line
 * on stdin and answers each with one JSON line, in order, so answers are
 * matched to requests first-in, first-out. Output may arrive split into chunks,
 * so it is collected until it parses. Started on first use (or by `prepare`).
 *
 * First-in, first-out matching only holds while every request gets exactly one
 * answer, so anything that could break that resets the helper instead: a
 * request that does not answer within its timeout kills the process and fails
 * every waiting request; the next request starts a fresh one.
 *
 * The helper works through requests one at a time, so a request's clock starts
 * when it reaches the head of the queue, not when it is queued: a quick poll
 * queued behind a slow connect must not time out (and kill the helper halfway
 * through the connect) while the connect is still legitimately running.
 */
function lineHelper(script: Script, timeoutMs = 15_000) {
  type Waiter = {
    resolve: (answer: Answer) => void;
    timeout: number;
    /** The request's first word, for the timeout message (never its arguments, which may hold a password). */
    label: string;
    timer?: ReturnType<typeof setTimeout>;
  };
  type Running = { proc: ShellProcess; waiting: Waiter[]; startedAt: number };
  let running: Promise<Running> | null = null;
  /** No restart before this time: a helper that dies at start-up must not respawn on every poll. */
  let retryAfter = 0;

  const failAll = (helper: Running, error: string) =>
    helper.waiting.splice(0).forEach((w) => {
      clearTimeout(w.timer);
      w.resolve({ ok: false, error });
    });

  /** Starts the clock of the request the helper is working on now. */
  const armHead = (helper: Running) => {
    const head = helper.waiting[0];
    if (!head || head.timer) return;
    head.timer = setTimeout(() => {
      failAll(helper, `${script}: no answer to ${head.label}`);
      helper.proc.kill();
    }, head.timeout);
  };

  const start = (): Promise<Running> => {
    if (!running && Date.now() < retryAfter) return Promise.reject(new Error(`${script} helper failed to start`));
    running ??= shellSpawn('powershell.exe', scriptArgs(script)).then((proc) => {
      const helper: Running = { proc, waiting: [], startedAt: Date.now() };
      let buffer = '';
      proc.onStdout((chunk) => {
        const parts = (buffer + chunk).split(/\r?\n/);
        buffer = '';
        parts.forEach((part, i) => {
          if (!part.trim()) return;
          let answer: Answer & { ready?: boolean };
          try {
            answer = JSON.parse(part);
          } catch {
            if (i === parts.length - 1) buffer = part; // An incomplete last line; the rest follows.
            return;
          }
          if (answer.ready) return;
          const waiter = helper.waiting.shift();
          if (waiter) {
            clearTimeout(waiter.timer);
            waiter.resolve(answer);
            armHead(helper);
          }
        });
      });
      proc.onStderr((line) => console.warn(`[kotilo] ${script}:`, line));
      proc.onExit(() => {
        running = null;
        if (Date.now() - helper.startedAt < 5000) retryAfter = Date.now() + 30_000;
        failAll(helper, `${script} helper exited`);
      });
      return helper;
    });
    running.catch(() => {
      running = null;
      retryAfter = Date.now() + 30_000;
    });
    return running;
  };

  /**
   * Sends one request; resolves with the answer's fields, rejects with its
   * error. `timeout` overrides the helper's default for slow requests.
   */
  async function request<T = Answer>(line: string, timeout = timeoutMs): Promise<T> {
    // A line break would turn one request into two and shift every later answer.
    if (/[\r\n]/.test(line)) throw new Error(`${script}: request contains a line break`);
    const helper = await start();
    const answer = new Promise<Answer>((resolve) => {
      helper.waiting.push({ resolve, timeout, label: line.split(' ')[0] });
      armHead(helper);
    });
    try {
      await writeStdin(helper.proc, `${line}\n`);
    } catch (err) {
      // The request never reached the helper, so its answer will not come: reset.
      failAll(helper, String(err));
      helper.proc.kill();
    }
    const result = await answer;
    if (!result.ok) throw new Error(result.error ?? `${script}: ${line} failed`);
    return result as T;
  }

  /** Warms the helper up so its first request is as quick as the rest. */
  const prepare = () => void start().catch((err) => console.warn(`[kotilo] ${script} helper`, err));

  return { request, prepare };
}

/* ---- Clipboard history (scripts/clipboard.ps1, Windows' own Win+V history) ---- */

export type ClipItem = {
  id: string;
  kind: 'text' | 'image' | 'files' | 'other';
  /** First 300 characters for text items. */
  text: string | null;
  /** Base64 PNG thumbnail for image items. */
  image: string | null;
  /** When it was copied, ms since epoch. */
  time: number;
};

const clipboard = lineHelper('clipboard');

/** Loading WinRT takes a second, so the helper starts with the island. */
export const prepareClipboard = clipboard.prepare;

export async function clipboardHistory(): Promise<{ enabled: boolean; items: ClipItem[] }> {
  const answer = await clipboard.request<{ enabled?: boolean; items?: ClipItem[] }>('list');
  return { enabled: answer.enabled ?? false, items: answer.items ?? [] };
}

/** Puts a history item back on the clipboard, ready for Ctrl+V. */
export const copyClipItem = (id: string) => clipboard.request(`set ${id}`).then(() => {});
export const deleteClipItem = (id: string) => clipboard.request(`delete ${id}`).then(() => {});
export const clearClipboardHistory = () => clipboard.request('clear').then(() => {});

/* ---- Sound (scripts/audio.ps1: default device and per-app volume) ------------- */

const audio = lineHelper('audio');

export type AppSession = { pid: number; name: string; volume: number; muted: boolean };

/** Apps playing through the default output device. */
export const audioSessions = () => audio.request<{ sessions: AppSession[] }>('sessions').then((a) => a.sessions ?? []);
/** Makes a device the default for every role (apps, media, calls). */
export const setDefaultAudioDevice = (deviceId: string) => audio.request(`set-default ${deviceId}`).then(() => {});
export const setAppVolume = (pid: number, volume: number) =>
  audio.request(`app-volume ${pid} ${Math.round(Math.max(0, Math.min(100, volume)))}`).then(() => {});
export const setAppMute = (pid: number, muted: boolean) => audio.request(`app-mute ${pid} ${muted ? 1 : 0}`).then(() => {});

/* ---- Wi-Fi (scripts/wifi.ps1, the Native Wifi API) ------------------------------ */

// A scan waits about three seconds, a connection request a little more.
const wifi = lineHelper('wifi', 20_000);

export type WifiNetwork = {
  ssid: string;
  signal: number;
  secured: boolean;
  saved: boolean;
  connected: boolean;
  /** The saved profile to connect with; its name can differ from the SSID. */
  profile: string | null;
  /** How the network signs in: no password, a password, or company sign-in (joined in Settings only). */
  auth: 'open' | 'personal' | 'enterprise';
};

/** UTF-8 bytes as hex, so names and passwords with spaces or any character travel safely in one line. */
const hex = (text: string) => Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Joins a network that has no saved profile: saves one with the password and
 * connects, waiting up to 15 s. Rejects with `wrong-password` or `timeout`;
 * the new profile is removed again on failure. Open networks take no password.
 */
export const joinWifi = (ssid: string, password: string | null) =>
  wifi.request(`join ${hex(ssid)} ${password ? hex(password) : '-'}`, 25_000).then(() => {});

/** Scans (about three seconds) and lists the networks in range. `null` when there is no Wi-Fi adapter. */
export const wifiNetworks = () =>
  wifi
    .request<{ interface: boolean; networks: WifiNetwork[] }>('list')
    .then((a) => (a.interface ? a.networks ?? [] : null));
/** Connects with a saved profile (`WifiNetwork.profile`). */
export const connectWifi = (profile: string) => wifi.request(`connect ${profile}`).then(() => {});
export const disconnectWifi = () => wifi.request('disconnect').then(() => {});
export const openWifiSettings = () => shellExec('explorer.exe', ['ms-settings:network-wifi']);

/* ---- Bluetooth (scripts/bluetooth.ps1, WinRT radios + bthprops) ------------------ */

const bluetooth = lineHelper('bluetooth');

export type BtDevice = {
  /** Bluetooth address, 12 hex digits. */
  id: string;
  name: string;
  kind: 'headphones' | 'speaker' | 'keyboard' | 'mouse' | 'phone' | 'other';
  connected: boolean;
  /** 0..100, or null when the device does not report it. */
  battery: number | null;
  /** Speakers and headphones: these can be connected and disconnected from the island. */
  audio: boolean;
};

export type BtState = { radio: 'on' | 'off' | 'none'; devices: BtDevice[] };

export const bluetoothState = () =>
  bluetooth.request<BtState>('state').then((a) => ({ radio: a.radio, devices: a.devices ?? [] }));
export const setBluetoothRadio = (on: boolean) => bluetooth.request(`radio ${on ? 'on' : 'off'}`).then(() => {});
/** Connecting turns the device's audio services on and waits for them; it can take several seconds. */
export const connectBluetooth = (id: string) => bluetooth.request(`connect ${id}`, 30_000).then(() => {});
export const disconnectBluetooth = (id: string) => bluetooth.request(`disconnect ${id}`, 30_000).then(() => {});
export const openBluetoothSettings = () => shellExec('explorer.exe', ['ms-settings:bluetooth']);

/* ---- About: Kotilo's site and GitHub, opened in the default browser --------------- */

export const openKotiloSite = () => shellExec('explorer.exe', ['https://kotilo.dev']);
export const openKotiloGithub = () => shellExec('explorer.exe', ['https://github.com/kotilo-dev']);

/* ---- Appearance (scripts/appearance.ps1: wallpapers, GlazeWM border colours) ----- */

const appearance = lineHelper('appearance', 20_000);

export type Wallpaper = {
  /** Display name. */
  name: string;
  /** File name inside ~\Pictures\Wallpapers. */
  file: string;
  /** Base64 JPEG thumbnail, about 320 px wide; null when the image could not be read. */
  thumb: string | null;
  width: number;
  height: number;
};

/**
 * The images in <Pictures>\Wallpapers, that folder's full path and the current
 * wallpaper's full path. The first listing makes a thumbnail of every image
 * (large 4K files), so it gets a long timeout of its own.
 */
export const listWallpapers = () =>
  appearance
    .request<{ folder: string; current: string | null; items: Wallpaper[] }>('wallpapers', 120_000)
    .then((a) => ({ folder: a.folder, current: a.current ?? null, items: a.items ?? [] }));

/** Makes an image from the folder the desktop background ("Fill"). Resolves with the new wallpaper path. */
export const setWallpaper = (file: string) =>
  appearance.request<{ current: string }>(`set-wallpaper ${hex(file)}`).then((a) => a.current);

/** Writes the two GlazeWM border colours to its config (only those two lines). `changed` is false if they already matched. */
export const setBorderColors = (focused: string, other: string) =>
  appearance.request<{ changed: boolean }>(`borders ${focused} ${other}`).then((a) => a.changed);

/* ---- Quick toggles (scripts/tweaks.ps1: keep awake, app theme, brightness) -------- */

const tweaks = lineHelper('tweaks');

/** `brightness` is null where the display has no brightness control (most external monitors). */
export type Tweaks = { awake: boolean; theme: 'dark' | 'light'; brightness: number | null };

const pickTweaks = (a: Tweaks): Tweaks => ({ awake: a.awake, theme: a.theme, brightness: a.brightness ?? null });

export const tweaksStatus = () => tweaks.request<Tweaks>('status').then(pickTweaks);
/** Keeps the machine from sleeping while on; the screen still turns off and locks as usual. */
export const setKeepAwake = (on: boolean) => tweaks.request<Tweaks>(`awake ${on ? 'on' : 'off'}`).then(pickTweaks);
export const setAppTheme = (theme: 'dark' | 'light') => tweaks.request<Tweaks>(`theme ${theme}`).then(pickTweaks);
export const setBrightness = (level: number) =>
  tweaks.request<Tweaks>(`brightness ${Math.round(Math.max(5, Math.min(100, level)))}`).then(pickTweaks);
export const prepareTweaks = tweaks.prepare;

/** Windows' own snipping overlay. */
export const openScreenClip = () => shellExec('explorer.exe', ['ms-screenclip:']);

/* ---- Windows notifications (scripts/notifications.ps1) --------------------------- */

const notifications = lineHelper('notifications');

/** A toast in the Windows notification centre. `aumid` is the app's ID, which also opens it. */
export type WinNotification = { id: number; app: string; aumid: string | null; title: string; body: string; time: number };

/** `access` is Windows' answer to "may this read notifications" (Allowed, Denied, Unspecified). */
export const listNotifications = () =>
  notifications
    .request<{ access: string; items?: WinNotification[] | WinNotification }>('list')
    .then((a) => ({ access: a.access, items: a.items == null ? [] : Array.isArray(a.items) ? a.items : [a.items] }));

export const removeNotifications = (ids: number[]) =>
  ids.length ? notifications.request(`remove ${ids.map((id) => Math.trunc(id)).join(',')}`).then(() => {}) : Promise.resolve();

export const openNotificationSettings = () => shellExec('explorer.exe', ['ms-settings:notifications']);
/** The Windows Settings app on its home page. */
export const openWindowsSettings = () => shellExec('explorer.exe', ['ms-settings:']);

/**
 * One page of the Windows Settings app. Each page needs its name in the
 * `ms-settings:` rule in zpack.json (see `SETTINGS_PAGES` in launcherSources.ts).
 */
export const openSettingsPage = (page: string) => shellExec('explorer.exe', [`ms-settings:${page}`]);

/**
 * Searches the web in the default browser. The query is percent-encoded down
 * to letters, digits and `%._~-`, the only characters the zpack.json rule allows.
 * `explorer.exe` cannot be used here: given an address with a `?`, it opens
 * File Explorer instead of the browser. `url.dll,FileProtocolHandler` hands
 * the address to the default browser as is.
 */
export function webSearch(query: string) {
  const q = encodeURIComponent(query).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return shellExec('rundll32.exe', ['url.dll,FileProtocolHandler', `https://www.google.com/search?q=${q}`]);
}

/* ---- Recent files (scripts/recent.ps1) ------------------------------------------ */

/** A shortcut in the user's Recent folder: `lnk` is its path, `target` the file or folder it opens. */
export type RecentFile = { name: string; lnk: string; target: string; folder: boolean; time: number };

export async function recentFiles(): Promise<RecentFile[]> {
  const out = await runScript('recent');
  if (out.code !== 0) throw new Error(out.stderr || `recent exited with ${out.code}`);
  const raw = JSON.parse(out.stdout || '[]') as RecentFile[] | RecentFile;
  return Array.isArray(raw) ? raw : [raw];
}

/** Opens a recent file through its shortcut, which the zpack.json rule limits to the Recent folder. */
export const openRecentFile = (file: RecentFile) => shellExec('explorer.exe', [file.lnk]);

/* ---- Window icons (scripts/window-icons.ps1) -------------------------------------- */

/** Icons of the programs that have windows, as data URLs keyed by lower-case process name. */
export async function windowIcons(): Promise<Record<string, string>> {
  const out = await runScript('window-icons');
  if (out.code !== 0) throw new Error(out.stderr || `window-icons exited with ${out.code}`);
  const raw = JSON.parse(out.stdout || '{}') as Record<string, string>;
  const icons: Record<string, string> = {};
  for (const [name, png] of Object.entries(raw)) icons[name.toLowerCase()] = png ? `data:image/png;base64,${png}` : '';
  return icons;
}

/**
 * Shows the app a notification came from: brings its open window forward, and
 * starts it only when it has none. (Starting an app that is already open opens
 * a second window in many apps, the new Outlook among them.)
 */
export async function showNotificationApp(n: { app: string; aumid: string | null }) {
  if (!n.aumid) return;
  const { activated } = await notifications.request<{ activated: boolean }>(`activate ${hex(n.aumid)}`);
  if (!activated) await launchApp({ name: n.app, appId: n.aumid });
}

/* ---- System monitor (scripts/sysmon.ps1) ----------------------------------------- */

const sysmon = lineHelper('sysmon');

/** Processes grouped by name: `count` processes, `cpu` % of the whole machine, `mb` private memory. */
export type ProcessGroup = { name: string; count: number; cpu: number; mb: number };

export const topProcesses = () => sysmon.request<{ cpu: ProcessGroup[]; memory: ProcessGroup[] }>('top');

/* ---- Calendar (scripts/calendar.ps1, a running Outlook only) --------------------- */

// Outlook can be slow to answer while it syncs.
const calendar = lineHelper('calendar', 30_000);

export type CalendarEvent = {
  subject: string;
  /** ms since epoch */
  start: number;
  end: number;
  location: string | null;
  allDay: boolean;
  /** Outlook's BusyStatus: 0 free, 1 tentative, 2 busy, 3 away, 4 working elsewhere. */
  busy: number;
};

/** Today's and tomorrow's events, or `null` while Outlook is not running (it is never started from here). */
export const calendarEvents = () =>
  calendar
    .request<{ running: boolean; events?: CalendarEvent[] }>('events')
    .then((a) => (a.running ? a.events ?? [] : null));

/** One day's events (the local day `day` falls in), or `null` while Outlook is not running. */
export function calendarDay(day: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  return calendar
    .request<{ running: boolean; events?: CalendarEvent[] }>(`day ${date}`)
    .then((a) => (a.running ? a.events ?? [] : null));
}

export type PowerAction = 'lock' | 'sleep' | 'signout' | 'restart' | 'shutdown';

export function runPower(action: PowerAction) {
  switch (action) {
    case 'lock':
      return shellExec('rundll32.exe', ['user32.dll,LockWorkStation']);
    case 'sleep':
      return runScript('sleep');
    case 'signout':
      return shellExec('shutdown.exe', ['/l']);
    case 'restart':
      return shellExec('shutdown.exe', ['/r', '/t', '0']);
    case 'shutdown':
      return shellExec('shutdown.exe', ['/s', '/t', '0']);
  }
}
