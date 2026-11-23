import { useEffect } from 'react';
import { emit } from '@tauri-apps/api/event';
import {
  ArrowDown,
  ArrowUp,
  Battery,
  BatteryCharging,
  BatteryLow,
  Bell,
  Bluetooth,
  BluetoothOff,
  Coffee,
  ListTodo,
  MicOff,
  Network,
  Target,
  Timer as TimerIcon,
  Watch,
  Wifi,
  WifiHigh,
  WifiLow,
  WifiOff,
  WifiZero,
} from 'lucide-react';
import { createProviderGroup } from 'zebar';
import type { BarItemId } from '../shared/barItems';
import { Equalizer } from '../shared/Equalizer';
import logoUrl from '../shared/kotilo.svg';
import { formatDuration, POMODORO_LABEL, useNow, type SharedTimer } from '../shared/liveTimer';
import { formatRate } from '../shared/netSpeed';
import { STORED, useStored } from '../shared/stored';
import { openCount, type Todo } from '../shared/todos';
import { useProviderGroup } from '../shared/useProviders';
import { placeWindow } from '../shared/widgetWindow';

const providers = createProviderGroup({
  glazewm: { type: 'glazewm' },
  network: { type: 'network', refreshInterval: 2000 },
  battery: { type: 'battery', refreshInterval: 10_000 },
  media: { type: 'media' },
  audio: { type: 'audio' },
});

type Out = typeof providers.outputMap;

/** Bar height in CSS px; must match `--bar-h` and `BAR_H` in the island. */
const BAR_H = 32;

/**
 * The strip along the top of the screen. Its middle stays empty: the island
 * widget sits there, on top of it, and shares its background and line.
 * On the right, live items (music, timers, open tasks, a muted microphone,
 * keep awake) show only while they apply; the network speed is always there.
 * A click on an item opens the matching island panel. Each item can be turned
 * off in the island's settings panel.
 */
export function Bar() {
  const out = useProviderGroup(providers);
  // Items turned off in the island's settings panel.
  const hidden = useStored<BarItemId[]>(STORED.barHidden, []);
  const shown = (id: BarItemId) => !(Array.isArray(hidden) && hidden.includes(id));

  // Size the window in CSS px so the bar is equally tall at any display scaling.
  useEffect(() => placeWindow(0, BAR_H, 'top-full'), []);

  return (
    <div className="bar">
      <div className="bar-side left">
        {/* The logo is the start button: it opens the island's app launcher. */}
        <button className="logo" onClick={() => openPanel('launcher')} title="Apps (Alt+E)">
          <img src={logoUrl} alt="Kotilo" />
        </button>
        <Workspaces out={out} />
        <FocusedTitle out={out} />
      </div>
      <div className="bar-side right">
        {shown('media') && <NowPlaying out={out} />}
        {shown('timer') && <LiveTimer />}
        {shown('todo') && <OpenTodos />}
        {shown('notify') && <NotifyCount />}
        {shown('mic') && <MicMuted out={out} />}
        {shown('awake') && <KeepAwake />}
        {shown('speed') && <NetSpeed out={out} />}
        {shown('network') && <NetworkStatus out={out} />}
        {shown('bluetooth') && <BluetoothStatus />}
        {shown('battery') && <BatteryStatus out={out} />}
      </div>
    </div>
  );
}

function Workspaces({ out }: { out: Out }) {
  const wm = out.glazewm;
  if (!wm) return null;
  return (
    <div
      className="workspaces"
      onWheel={(e) => wm.runCommand(e.deltaY < 0 ? 'focus --prev-active-workspace' : 'focus --next-active-workspace')}
    >
      {wm.currentWorkspaces.map((ws) => (
        <button
          key={ws.name}
          className={`workspace ${ws.hasFocus ? 'focused' : ''} ${ws.isDisplayed ? 'displayed' : ''} ${ws.children.length ? '' : 'empty'}`}
          onClick={() => wm.runCommand(`focus --workspace ${ws.name}`)}
        >
          {ws.displayName || ws.name}
        </button>
      ))}
      {wm.isPaused && (
        <button className="chip warning" onClick={() => wm.runCommand('wm-toggle-pause')}>
          Paused
        </button>
      )}
      {/* `island-*` modes are the island's keyboard shortcuts, not modes to show. */}
      {wm.bindingModes.filter((mode) => !mode.name.startsWith('island-')).map((mode) => (
        <button
          key={mode.name}
          className="chip"
          onClick={() => wm.runCommand(`wm-disable-binding-mode --name ${mode.name}`)}
        >
          {mode.displayName ?? mode.name}
        </button>
      ))}
    </div>
  );
}

function FocusedTitle({ out }: { out: Out }) {
  const focused = out.glazewm?.focusedContainer;
  if (!focused || focused.type !== 'window') return null;
  return <span className="focused-title">{focused.processName || focused.title}</span>;
}

/** Asks the island (another window) to open one of its panels. */
const openPanel = (panel: string) => void emit('kotilo:toggle-panel', panel).catch(() => {});

/** The playing track, only while something plays. A click opens the control centre, which holds the player. */
function NowPlaying({ out }: { out: Out }) {
  const session = out.media?.currentSession;
  if (!session?.isPlaying) return null;
  const label = [session.title, session.artist].filter(Boolean).join(' · ');
  return (
    <button className="status now-playing" onClick={() => openPanel('control')} title={label || 'Now playing'}>
      <Equalizer playing />
      <span className="ellipsis">{session.title || 'Playing'}</span>
    </button>
  );
}

/**
 * The running countdown, pomodoro phase or stopwatch (in that order), only
 * while one runs. The timers live in the island, which shares their times
 * through the widgets' common storage; the bar counts on its own clock from
 * there. A click opens the island's timer panel.
 */
function LiveTimer() {
  const timer = useStored<SharedTimer>(STORED.timer, null);
  const stopwatchOnly = timer != null && timer.endsAt == null && timer.pomodoro == null;
  const now = useNow(timer != null, stopwatchOnly ? 100 : 250);
  if (!timer) return null;

  let icon = <Watch size={14} />;
  let title = 'Stopwatch';
  let text = formatDuration(timer.swBanked + (timer.swStartedAt ? now - timer.swStartedAt : 0), true);
  if (timer.endsAt != null) {
    icon = <TimerIcon size={14} />;
    title = 'Timer';
    text = formatDuration(Math.max(0, timer.endsAt - now));
  } else if (timer.pomodoro) {
    icon = timer.pomodoro.phase === 'work' ? <Target size={14} /> : <Coffee size={14} />;
    title = `Pomodoro · ${POMODORO_LABEL[timer.pomodoro.phase]}`;
    text = formatDuration(Math.max(0, timer.pomodoro.endsAt - now));
  }
  return (
    <button className="status live-timer" onClick={() => openPanel('timer')} title={title}>
      {icon}
      {text}
    </button>
  );
}

/** The number of open to-do items, only when there are any. A click opens the island's to-do panel. */
function OpenTodos() {
  const todos = useStored<Todo[]>(STORED.todos, []);
  const count = Array.isArray(todos) ? openCount(todos) : 0;
  if (count === 0) return null;
  return (
    <button className="status" onClick={() => openPanel('todo')} title={`${count} open ${count === 1 ? 'task' : 'tasks'}`}>
      <ListTodo size={14} />
      {count}
    </button>
  );
}

/** A bell with the number of Windows notifications (muted apps left out), only when there are any. */
function NotifyCount() {
  const count = useStored<number>(STORED.notifyCount, 0);
  if (!count) return null;
  return (
    <button className="status" onClick={() => openPanel('notifications')} title={`${count} ${count === 1 ? 'notification' : 'notifications'}`}>
      <Bell size={14} />
      {count}
    </button>
  );
}

/** A red microphone while the default microphone is muted. A click opens the control centre, where it is unmuted. */
function MicMuted({ out }: { out: Out }) {
  const mic = out.audio?.defaultRecordingDevice;
  if (!mic?.isMuted) return null;
  return (
    <button className="status low" onClick={() => openPanel('control')} title={`Microphone muted (${mic.name})`}>
      <MicOff size={14} />
    </button>
  );
}

/** A cup while keep awake is on (the island owns the switch and shares its state). */
function KeepAwake() {
  const awake = useStored<boolean>(STORED.awake, false);
  if (!awake) return null;
  return (
    <button className="status" onClick={() => openPanel('control')} title="Keeping the computer awake">
      <Coffee size={14} />
    </button>
  );
}

/**
 * Download and upload speed, always shown while connected. Each figure has a
 * fixed width, so the items beside it never shift as the numbers change.
 * A click opens the Wi-Fi panel.
 */
function NetSpeed({ out }: { out: Out }) {
  const traffic = out.network?.traffic;
  if (!traffic || !out.network?.defaultInterface) return null;
  return (
    <button className="status net-speed" onClick={() => openPanel('wifi')} title="Network speed (download, upload)">
      <ArrowDown size={13} />
      <span className="rate">{formatRate(traffic.received.bytes)}</span>
      <ArrowUp size={13} />
      <span className="rate">{formatRate(traffic.transmitted.bytes)}</span>
    </button>
  );
}

/** Wi-Fi bars for a 0..100 signal. */
function wifiIcon(signal: number | null) {
  if (signal == null) return Wifi;
  if (signal >= 70) return Wifi;
  if (signal >= 45) return WifiHigh;
  if (signal >= 20) return WifiLow;
  return WifiZero;
}

/** The connection type, and for Wi-Fi the signal strength when Windows reports it (no network name). */
function NetworkStatus({ out }: { out: Out }) {
  const net = out.network;
  const type = net?.defaultInterface?.type;
  if (!net) return null;
  if (type === 'wifi') {
    const signal = net.defaultGateway?.signalStrength ?? null;
    const Icon = wifiIcon(signal);
    return (
      <button className="status" onClick={() => openPanel('wifi')} title="Wi-Fi">
        <Icon size={14} />
        {signal != null && `${Math.round(signal)}%`}
      </button>
    );
  }
  if (type) {
    return (
      <button className="status" onClick={() => openPanel('wifi')} title="Network">
        <Network size={14} />
      </button>
    );
  }
  return (
    <button className="status dim" onClick={() => openPanel('wifi')} title="Not connected">
      <WifiOff size={14} />
    </button>
  );
}

type BtSummary = { radio: 'on' | 'off' | 'none'; connected: number };

/**
 * Bluetooth and the number of connected devices. The island reads Bluetooth
 * (the bar has no shell access) and shares a summary through the widgets'
 * common storage.
 */
function BluetoothStatus() {
  const bt = useStored<BtSummary | null>(STORED.bluetooth, null);
  if (!bt || bt.radio === 'none') return null;
  const on = bt.radio === 'on';
  return (
    <button className={`status ${on ? '' : 'dim'}`} onClick={() => openPanel('bluetooth')} title="Bluetooth">
      {on ? <Bluetooth size={14} /> : <BluetoothOff size={14} />}
      {on && bt.connected}
    </button>
  );
}

function BatteryStatus({ out }: { out: Out }) {
  const b = out.battery;
  if (!b) return null;
  const Icon = b.isCharging ? BatteryCharging : b.chargePercent <= 20 ? BatteryLow : Battery;
  return (
    <span className={`status ${!b.isCharging && b.chargePercent <= 20 ? 'low' : ''}`}>
      <Icon size={15} />
      {Math.round(b.chargePercent)}%
    </span>
  );
}
