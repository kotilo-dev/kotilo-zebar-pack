import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  Bluetooth,
  BluetoothOff,
  CalendarDays,
  Headphones,
  Keyboard,
  Mouse,
  Smartphone,
  Cpu,
  Eye,
  EyeOff,
  Lock,
  Mic,
  RefreshCw,
  Settings,
  Speaker,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { formatRate } from '../shared/netSpeed';
import { STORED, writeStored } from '../shared/stored';
import { DottedMeter, PanelHeader } from './components';
import type { IslandOutputs } from './providers';
import { useKeepFocused } from './panels';
import {
  audioSessions,
  bluetoothState,
  connectBluetooth,
  disconnectBluetooth,
  openBluetoothSettings,
  setBluetoothRadio,
  type BtDevice,
  type BtState,
  calendarEvents,
  connectWifi,
  disconnectWifi,
  joinWifi,
  openWifiSettings,
  setAppMute,
  setAppVolume,
  setDefaultAudioDevice,
  topProcesses,
  wifiNetworks,
  type AppSession,
  type CalendarEvent,
  type ProcessGroup,
  type WifiNetwork,
} from './system';

type Out = IslandOutputs;

/** Runs `fn` now and every `ms` while `active`. */
function useWhileActive(active: boolean, ms: number, fn: () => void) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!active) return;
    latest.current();
    const id = setInterval(() => latest.current(), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

/**
 * Sends only the newest value while a request is in flight, so dragging a
 * slider does not queue dozens of requests behind a slow helper.
 */
function latestOnly<A extends unknown[]>(send: (...args: A) => Promise<void>) {
  let busy = false;
  let pending: A | null = null;
  const run = (...args: A) => {
    if (busy) {
      pending = args;
      return;
    }
    busy = true;
    send(...args)
      .catch((err) => console.warn('[kotilo]', err))
      .finally(() => {
        busy = false;
        const next = pending;
        pending = null;
        if (next) run(...next);
      });
  };
  return run;
}

/* ---- Sound ---------------------------------------------------------------------- */

const appVolumeSenders = new Map<number, (pid: number, v: number) => void>();
const sendAppVolume = (pid: number, v: number) => {
  if (!appVolumeSenders.has(pid)) appVolumeSenders.set(pid, latestOnly((p: number, x: number) => setAppVolume(p, x)));
  appVolumeSenders.get(pid)!(pid, v);
};

export function AudioView({ out, active }: { out: Out; active: boolean }) {
  const audio = out.audio;
  const device = audio?.defaultPlaybackDevice;
  const [sessions, setSessions] = useState<AppSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  // While a slider is being dragged, its value here wins over the polled one.
  // Cleared a moment after the mouse is released, once the next poll has the
  // new value, so later changes (the Windows mixer, a failed set) show again.
  const [dragging, setDragging] = useState<Record<number, number>>({});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setDragging({}), 3500);
    };
    window.addEventListener('pointerup', release);
    return () => {
      window.removeEventListener('pointerup', release);
      clearTimeout(timer);
    };
  }, []);

  useWhileActive(active, 3000, () => {
    audioSessions()
      .then((s) => {
        setSessions(s);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  });

  const choose = (id: string) =>
    setDefaultAudioDevice(id).catch((err) => setError(String(err)));

  const mute = (s: AppSession) =>
    setAppMute(s.pid, !s.muted)
      .then(() => setSessions((list) => list.map((x) => (x.pid === s.pid ? { ...x, muted: !s.muted } : x))))
      .catch((err) => setError(String(err)));

  return (
    <div className="view-panel audio-panel">
      <PanelHeader title="Sound" back />

      <div className="slider-row">
        <button
          className="icon-toggle"
          onClick={() => device && audio?.setMute(!device.isMuted)}
          aria-label={device?.isMuted ? 'Unmute' : 'Mute'}
        >
          {device?.isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <DottedMeter
          value={device?.volume ?? 0}
          segments={30}
          muted={device?.isMuted}
          onChange={device ? (v) => audio?.setVolume(v) : undefined}
        />
        <span className="slider-value">{Math.round(device?.volume ?? 0)}</span>
      </div>

      <div className="panel-scroll">
        <section>
          <h3 className="section-title">Output</h3>
          {(audio?.playbackDevices ?? []).map((d) => (
            <button key={d.deviceId} className={`choice ${d.isDefaultPlayback ? 'on' : ''}`} onClick={() => choose(d.deviceId)}>
              <Speaker size={14} />
              <span className="ellipsis">{d.name}</span>
              {d.isDefaultPlayback && <span className="choice-dot" />}
            </button>
          ))}
        </section>

        <section>
          <h3 className="section-title">Apps</h3>
          {sessions.length === 0 && <span className="muted-text">No app is using sound</span>}
          {sessions.map((s) => (
            <div key={s.pid} className="app-row">
              <button className="icon-toggle" onClick={() => mute(s)} aria-label={s.muted ? 'Unmute' : 'Mute'}>
                {s.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
              <span className="app-name ellipsis" title={s.name}>
                {s.name}
              </span>
              <DottedMeter
                value={dragging[s.pid] ?? s.volume}
                segments={18}
                muted={s.muted}
                onChange={(v) => {
                  setDragging((d) => ({ ...d, [s.pid]: v }));
                  sendAppVolume(s.pid, v);
                }}
              />
              <span className="slider-value">{Math.round(dragging[s.pid] ?? s.volume)}</span>
            </div>
          ))}
        </section>

        <section>
          <h3 className="section-title">Input</h3>
          {(audio?.recordingDevices ?? []).map((d) => (
            <button key={d.deviceId} className={`choice ${d.isDefaultRecording ? 'on' : ''}`} onClick={() => choose(d.deviceId)}>
              <Mic size={14} />
              <span className="ellipsis">{d.name}</span>
              {d.isDefaultRecording && <span className="choice-dot" />}
            </button>
          ))}
        </section>
      </div>
      {error && <p className="panel-error ellipsis">{error}</p>}
    </div>
  );
}

/* ---- Wi-Fi ---------------------------------------------------------------------- */

let networkCache: WifiNetwork[] | null = null;

/** Four bars for a 0..100 signal. */
function SignalBars({ value }: { value: number }) {
  const bars = value >= 75 ? 4 : value >= 50 ? 3 : value >= 25 ? 2 : 1;
  return (
    <span className="signal" aria-label={`Signal ${value}%`}>
      {[1, 2, 3, 4].map((b) => (
        <i key={b} className={b <= bars ? 'on' : ''} style={{ height: 3 + b * 3 }} />
      ))}
    </span>
  );
}

export function WifiView({ out, active }: { out: Out; active: boolean }) {
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(networkCache);
  const [adapter, setAdapter] = useState(true);
  const [scanning, setScanning] = useState(false);
  // Scans can overlap (reopening the panel, the rescan after connecting); the spinner stops with the last one.
  const inFlight = useRef(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The network whose password row is open, what is typed there, and whether it shows as text.
  const [joining, setJoining] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  useKeepFocused(active && joining != null, passwordInput);

  const closeJoin = () => {
    setJoining(null);
    setPassword('');
    setReveal(false);
  };

  useEffect(() => {
    if (!active) closeJoin();
  }, [active]);

  const scan = () => {
    inFlight.current += 1;
    setScanning(true);
    wifiNetworks()
      .then((list) => {
        setAdapter(list != null);
        networkCache = list ?? [];
        setNetworks(networkCache);
        setError(null);
      })
      .catch((err) =>
        setError(String(err).includes('location') ? 'Wi-Fi scanning needs location access (Settings › Privacy › Location).' : String(err)),
      )
      .finally(() => {
        inFlight.current -= 1;
        if (inFlight.current === 0) setScanning(false);
      });
  };

  useEffect(() => {
    if (active) scan();
  }, [active]);

  const connect = (n: WifiNetwork) => {
    if (!n.profile) return;
    setBusy(n.ssid);
    connectWifi(n.profile)
      // Joining takes a few seconds; list again once it has had the time.
      .then(() => new Promise((r) => setTimeout(r, 4000)))
      .then(scan)
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(null));
  };

  /** A new network: open ones join at once, password ones open their password row first. */
  const join = (n: WifiNetwork) => {
    if (n.auth === 'personal' && joining !== n.ssid) {
      setJoining(n.ssid);
      setPassword('');
      setError(null);
      return;
    }
    // 8-63 characters, or a 64-digit hex key: what WPA2/WPA3 accept.
    if (n.auth === 'personal' && !(password.length >= 8 && password.length <= 63) && !/^[0-9a-fA-F]{64}$/.test(password)) {
      setError('Wi-Fi passwords have 8 to 63 characters.');
      return;
    }
    setBusy(n.ssid);
    setError(null);
    joinWifi(n.ssid, n.auth === 'personal' ? password : null)
      .then(() => {
        closeJoin();
        scan();
      })
      .catch((err) => {
        const text = String(err);
        setError(
          text.includes('wrong-password')
            ? 'Wrong password.'
            : text.includes('timeout')
              ? `Could not connect to ${n.ssid}.`
              : text.includes('profile exists')
                ? 'This network is already saved; connect to it instead.'
                : text.includes('enterprise')
                ? 'This network needs a company sign-in; join it in Settings.'
                : text.includes('access-denied')
                  ? 'Windows did not allow saving this network; join it in Settings.'
                  : text,
        );
        // The field is disabled until `busy` clears; select its text after that (see the effect below).
        setReselect(true);
      })
      .finally(() => setBusy(null));
  };

  // After a failed join, select the password so it can be retyped at once.
  const [reselect, setReselect] = useState(false);
  useEffect(() => {
    if (!reselect || busy != null) return;
    setReselect(false);
    passwordInput.current?.focus({ preventScroll: true });
    passwordInput.current?.select();
  }, [reselect, busy]);

  const disconnect = () => {
    setBusy('');
    disconnectWifi()
      .then(() => new Promise((r) => setTimeout(r, 1500)))
      .then(scan)
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(null));
  };

  const gateway = out.network?.defaultGateway;
  const iface = out.network?.defaultInterface;
  const traffic = out.network?.traffic;
  const connected = networks?.find((n) => n.connected);
  const others = (networks ?? []).filter((n) => !n.connected);

  return (
    <div className="view-panel wifi-panel">
      <PanelHeader title="Wi-Fi" back />

      <div className="current-network">
        <span className="tile-icon">{connected ? <Wifi size={16} /> : <WifiOff size={16} />}</span>
        <span className="tile-text">
          <strong>{connected?.ssid ?? (iface?.type === 'ethernet' ? 'Ethernet' : 'Not connected')}</strong>
          <span>
            {connected
              ? [
                  gateway?.signalStrength != null ? `${gateway.signalStrength}%` : `${connected.signal}%`,
                  iface?.ipv4Addresses[0],
                  traffic && `↓ ${formatRate(traffic.received.bytes)}  ↑ ${formatRate(traffic.transmitted.bytes)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : adapter
                ? 'Pick a network below'
                : 'No Wi-Fi adapter'}
          </span>
        </span>
        {connected && (
          <button className="chip-button" onClick={disconnect} disabled={busy != null}>
            Disconnect
          </button>
        )}
      </div>

      <div className="list-head">
        <h3 className="section-title">Networks</h3>
        <span className="list-actions">
          <button className="icon-toggle" onClick={scan} disabled={scanning || busy != null} aria-label="Scan again">
            <RefreshCw size={13} className={scanning ? 'spin' : ''} />
          </button>
          <button className="icon-toggle" onClick={() => void openWifiSettings()} aria-label="Wi-Fi settings">
            <Settings size={13} />
          </button>
        </span>
      </div>

      <div className="panel-scroll">
        {!networks && <span className="muted-text">Scanning…</span>}
        {networks && others.length === 0 && <span className="muted-text">No other networks in range</span>}
        {others.map((n) => (
          <div key={n.ssid} className={`network-item ${joining === n.ssid ? 'open' : ''}`}>
            <div className="network-row">
              <SignalBars value={n.signal} />
              <span className="ellipsis">{n.ssid}</span>
              {n.secured && <Lock size={11} className="muted-icon" />}
              {n.profile ? (
                <button className="chip-button" onClick={() => connect(n)} disabled={busy != null}>
                  {busy === n.ssid ? 'Connecting…' : 'Connect'}
                </button>
              ) : n.auth === 'enterprise' ? (
                <button className="chip-button ghost" onClick={() => void openWifiSettings()} title="Company networks are joined in Settings">
                  Settings
                </button>
              ) : joining === n.ssid ? (
                <button className="chip-button ghost" onClick={closeJoin} disabled={busy != null}>
                  Cancel
                </button>
              ) : (
                <button className="chip-button" onClick={() => join(n)} disabled={busy != null}>
                  {busy === n.ssid ? 'Connecting…' : 'Join'}
                </button>
              )}
            </div>
            {joining === n.ssid && (
              <div className="password-row">
                <label className="search">
                  <Lock size={13} className="accent" />
                  <input
                    ref={passwordInput}
                    type={reveal ? 'text' : 'password'}
                    value={password}
                    placeholder="Password"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy != null}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') join(n);
                      if (e.key === 'Escape') {
                        // Closes the row only, not the whole panel.
                        e.stopPropagation();
                        closeJoin();
                      }
                    }}
                  />
                  <button
                    className="icon-toggle"
                    onClick={(e) => {
                      e.preventDefault();
                      setReveal((r) => !r);
                    }}
                    aria-label={reveal ? 'Hide password' : 'Show password'}
                  >
                    {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </label>
                <button className="chip-button on" onClick={() => join(n)} disabled={busy != null || password.length < 8}>
                  {busy === n.ssid ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="panel-error ellipsis">{error}</p>}
    </div>
  );
}

/* ---- System monitor --------------------------------------------------------------- */

const HISTORY = 60;

type History = { cpu: number[]; memory: number[]; down: number[]; up: number[] };

/** Recent CPU, memory and network readings, collected from the providers all the time. */
export const useHistory = create<History & { push: (key: keyof History, value: number) => void }>((set) => ({
  cpu: [],
  memory: [],
  down: [],
  up: [],
  push: (key, value) => set((h) => ({ [key]: [...h[key], value].slice(-HISTORY) }) as Partial<History>),
}));

/** Feeds the history from provider updates (call once, in the island). */
export function useCollectHistory(out: Out) {
  const push = useHistory((h) => h.push);
  const cpu = out.cpu?.usage;
  const memory = out.memory?.usage;
  const traffic = out.network?.traffic;
  useEffect(() => void (cpu != null && push('cpu', cpu)), [cpu, push]);
  useEffect(() => void (memory != null && push('memory', memory)), [memory, push]);
  useEffect(() => {
    if (!traffic) return;
    push('down', traffic.received.bytes);
    push('up', traffic.transmitted.bytes);
  }, [traffic, push]);
}

/** A filled line chart of the last readings; `max` fixes the scale, otherwise it follows the data. */
function Sparkline({ values, max, className = '' }: { values: number[]; max?: number; className?: string }) {
  const w = 220;
  const h = 44;
  const top = Math.max(max ?? 0, ...values, 1);
  const step = w / (HISTORY - 1);
  const offset = (HISTORY - values.length) * step;
  const points = values.map((v, i) => `${(offset + i * step).toFixed(1)},${(h - (v / top) * (h - 2) - 1).toFixed(1)}`);
  return (
    <svg className={`sparkline ${className}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {points.length > 1 && (
        <>
          <polygon className="area" points={`${offset},${h} ${points.join(' ')} ${w},${h}`} />
          <polyline className="stroke" points={points.join(' ')} />
        </>
      )}
    </svg>
  );
}

const rate = (bytesPerSecond: number | undefined) => (bytesPerSecond == null ? '–' : formatRate(bytesPerSecond));

const memoryText = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

export function SysmonView({ out, active }: { out: Out; active: boolean }) {
  const h = useHistory();
  const [tab, setTab] = useState<'cpu' | 'memory'>('cpu');
  const [top, setTop] = useState<{ cpu: ProcessGroup[]; memory: ProcessGroup[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useWhileActive(active, 3000, () => {
    topProcesses()
      .then((t) => {
        setTop(t);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  });

  const mem = out.memory;
  const rows = top?.[tab] ?? [];
  return (
    <div className="view-panel sysmon-panel">
      <PanelHeader title="System" back />
      <div className="charts">
        <div className="chart">
          <span className="chart-label">
            CPU <strong>{Math.round(out.cpu?.usage ?? 0)}%</strong>
          </span>
          <Sparkline values={h.cpu} max={100} />
        </div>
        <div className="chart">
          <span className="chart-label">
            Memory <strong>{Math.round(mem?.usage ?? 0)}%</strong>
            {mem && <em>{memoryText(Math.round(mem.usedMemory / 1_048_576))}</em>}
          </span>
          <Sparkline values={h.memory} max={100} />
        </div>
        <div className="chart wide">
          <span className="chart-label">
            Network <strong>↓ {rate(out.network?.traffic?.received.bytes)}</strong>
            <em>↑ {rate(out.network?.traffic?.transmitted.bytes)}</em>
          </span>
          <div className="stacked">
            <Sparkline values={h.down} />
            <Sparkline values={h.up} max={Math.max(1, ...h.down)} className="secondary" />
          </div>
        </div>
      </div>

      <div className="list-head">
        <div className="segmented">
          <button className={tab === 'cpu' ? 'on' : ''} onClick={() => setTab('cpu')}>
            <Cpu size={12} /> CPU
          </button>
          <button className={tab === 'memory' ? 'on' : ''} onClick={() => setTab('memory')}>
            Memory
          </button>
        </div>
      </div>
      <div className="process-list">
        {!top && !error && <span className="muted-text">Measuring…</span>}
        {rows.map((p) => (
          <div key={p.name} className="process-row">
            <span className="ellipsis">
              {p.name}
              {p.count > 1 && <em> ×{p.count}</em>}
            </span>
            <span className={tab === 'cpu' ? 'strong' : ''}>{p.cpu.toFixed(1)}%</span>
            <span className={tab === 'memory' ? 'strong' : ''}>{memoryText(p.mb)}</span>
          </div>
        ))}
      </div>
      {error && <p className="panel-error ellipsis">{error}</p>}
    </div>
  );
}

/* ---- Calendar ---------------------------------------------------------------------- */

type CalendarState = { events: CalendarEvent[] | null; loaded: boolean; error: string | null; refresh: () => Promise<void> };

/** Outlook events, shared by the panel, the control centre and the meeting live activity. */
export const useCalendar = create<CalendarState>((set) => ({
  events: null,
  loaded: false,
  error: null,
  refresh: () =>
    calendarEvents()
      .then((events) => set({ events, loaded: true, error: null }))
      .catch((err) => set({ loaded: true, error: String(err) })),
}));

/** Reads the calendar now and every five minutes (call once, in the island). */
export function useCalendarPolling() {
  useEffect(() => {
    const refresh = () => void useCalendar.getState().refresh();
    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => clearInterval(id);
  }, []);
}

const MEETING_LEAD_MS = 10 * 60_000;
const MEETING_TAIL_MS = 5 * 60_000;

/** A timed event that starts within ten minutes or started less than five minutes ago. */
export function upcomingMeeting(events: CalendarEvent[] | null, now: number): CalendarEvent | null {
  return (
    events?.find((e) => !e.allDay && e.busy !== 0 && now >= e.start - MEETING_LEAD_MS && now < Math.min(e.end, e.start + MEETING_TAIL_MS)) ??
    null
  );
}

/** The next timed event that has not ended yet, for the control centre. */
export function nextEvent(events: CalendarEvent[] | null, now: number): CalendarEvent | null {
  return events?.find((e) => !e.allDay && e.end > now) ?? null;
}

export const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** "in 6 min", "now", "started 2 min ago". */
export function meetingWhen(e: CalendarEvent, now: number) {
  const min = Math.round((e.start - now) / 60_000);
  if (min > 0) return `in ${min} min`;
  if (min === 0) return 'now';
  return `${-min} min ago`;
}

function dayStart(ms: number, plusDays = 0) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays).getTime();
}

export function CalendarView({ out, active }: { out: Out; active: boolean }) {
  const { events, loaded, error, refresh } = useCalendar();
  const now = out.clock?.now ?? Date.now();

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const days = [
    { title: 'Today', from: dayStart(now), to: dayStart(now, 1) },
    { title: 'Tomorrow', from: dayStart(now, 1), to: dayStart(now, 2) },
  ];

  return (
    <div className="view-panel calendar-panel">
      <PanelHeader title="Calendar" back />
      <div className="panel-scroll">
        {!loaded && <span className="muted-text">Loading…</span>}
        {loaded && events == null && !error && (
          <div className="empty-state">
            <CalendarDays size={22} className="accent" />
            <span>Open Outlook to see events</span>
          </div>
        )}
        {events &&
          days.map((day) => {
            const list = events.filter((e) => e.start < day.to && e.end > day.from);
            const allDay = list.filter((e) => e.allDay);
            const timed = list.filter((e) => !e.allDay);
            return (
              <section key={day.title}>
                <h3 className="section-title">{day.title}</h3>
                {allDay.length > 0 && (
                  <div className="all-day">
                    {allDay.map((e) => (
                      <span key={`${e.subject}-${e.start}`} className="chip ellipsis">
                        {e.subject}
                      </span>
                    ))}
                  </div>
                )}
                {timed.length === 0 && allDay.length === 0 && <span className="muted-text">Nothing planned</span>}
                {timed.map((e) => (
                  <div
                    key={`${e.subject}-${e.start}`}
                    className={`event-row ${now >= e.start && now < e.end ? 'now' : ''} ${e.end <= now ? 'past' : ''} ${e.busy === 1 ? 'tentative' : ''}`}
                  >
                    <span className="event-time">
                      {hhmm(e.start)}
                      <em>{hhmm(e.end)}</em>
                    </span>
                    <span className="event-bar" />
                    <span className="event-text">
                      <strong className="ellipsis">{e.subject || '(No title)'}</strong>
                      {e.location && <span className="ellipsis">{e.location}</span>}
                    </span>
                  </div>
                ))}
              </section>
            );
          })}
        {error && <p className="panel-error ellipsis">{error}</p>}
      </div>
    </div>
  );
}

/* ---- Bluetooth ---------------------------------------------------------------------- */

type BluetoothStore = { state: BtState | null; error: string | null; refresh: () => Promise<void> };

/** Radio and paired devices, shared by the control centre tile and the panel. */
export const useBluetooth = create<BluetoothStore>((set) => ({
  state: null,
  error: null,
  refresh: () =>
    bluetoothState()
      .then((state) => {
        set({ state, error: null });
        shareBluetooth(state);
      })
      .catch((err) => set({ error: String(err) })),
}));

/**
 * The bar shows Bluetooth with the number of connected devices but cannot run
 * the helper itself, so the island leaves a summary in the widgets' shared
 * storage; the bar picks it up through the `storage` event.
 */
function shareBluetooth(state: BtState) {
  writeStored(STORED.bluetooth, { radio: state.radio, connected: state.devices.filter((d) => d.connected).length });
}

/**
 * Reads Bluetooth every 4 s while its panel is open, every 15 s while the
 * control centre is, and every 30 s otherwise (the bar shows the count too).
 */
export function useBluetoothPolling(mode: string) {
  const ms = mode === 'bluetooth' ? 4000 : mode === 'control' ? 15_000 : 30_000;
  useEffect(() => {
    const refresh = () => void useBluetooth.getState().refresh();
    refresh();
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
  }, [ms]);
}

const BT_ICONS = { headphones: Headphones, speaker: Speaker, keyboard: Keyboard, mouse: Mouse, phone: Smartphone, other: Bluetooth } as const;

/** What the control centre tile says under "Bluetooth". */
export function bluetoothSummary(state: BtState | null) {
  if (!state) return 'Loading…';
  if (state.radio === 'none') return 'No adapter';
  if (state.radio === 'off') return 'Off';
  const connected = state.devices.filter((d) => d.connected);
  if (connected.length === 0) return 'On · nothing connected';
  if (connected.length === 1) return connected[0].name;
  return `${connected.length} devices`;
}

export function BluetoothView({ active }: { active: boolean }) {
  const { state, error: loadError, refresh } = useBluetooth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Turning the radio off drops a Bluetooth keyboard or mouse too, so it asks for a second click.
  const [armedOff, setArmedOff] = useState(false);

  useEffect(() => {
    if (!active) setArmedOff(false);
  }, [active]);
  useEffect(() => {
    if (!armedOff) return;
    const t = setTimeout(() => setArmedOff(false), 4000);
    return () => clearTimeout(t);
  }, [armedOff]);

  const devices = state?.devices ?? [];
  const on = state?.radio === 'on';
  const inputConnected = devices.some((d) => d.connected && (d.kind === 'keyboard' || d.kind === 'mouse'));

  const toggleRadio = () => {
    if (on && inputConnected && !armedOff) return setArmedOff(true);
    setArmedOff(false);
    setBusy('radio');
    setBluetoothRadio(!on)
      .then(refresh)
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(null));
  };

  const toggleDevice = (d: BtDevice) => {
    setBusy(d.id);
    setError(null);
    (d.connected ? disconnectBluetooth(d.id) : connectBluetooth(d.id))
      .then(refresh)
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(null));
  };

  const row = (d: BtDevice) => {
    const Icon = BT_ICONS[d.kind] ?? Bluetooth;
    return (
      <div key={d.id} className={`bt-row ${d.connected ? 'connected' : ''}`}>
        <span className="bt-icon">
          <Icon size={15} />
        </span>
        <span className="bt-text">
          <strong className="ellipsis">{d.name}</strong>
          <span>
            {d.connected ? 'Connected' : 'Not connected'}
            {d.battery != null && ` · ${d.battery}%`}
          </span>
        </span>
        {d.audio && on && (
          <button
            className={`chip-button ${d.connected ? '' : 'on'}`}
            onClick={() => toggleDevice(d)}
            disabled={busy != null}
            title={d.connected ? 'Its sound stays off until you connect it here again' : undefined}
          >
            {busy === d.id ? (d.connected ? 'Disconnecting…' : 'Connecting…') : d.connected ? 'Disconnect' : 'Connect'}
          </button>
        )}
      </div>
    );
  };

  const connected = devices.filter((d) => d.connected);
  const paired = devices.filter((d) => !d.connected);
  return (
    <div className="view-panel bluetooth-panel">
      <PanelHeader title="Bluetooth" back />

      <div className="current-network">
        <span className={`tile-icon ${on ? '' : 'off'}`}>{on ? <Bluetooth size={16} /> : <BluetoothOff size={16} />}</span>
        <span className="tile-text">
          <strong>Bluetooth</strong>
          <span>{armedOff ? 'Your Bluetooth keyboard and mouse will disconnect' : bluetoothSummary(state)}</span>
        </span>
        {state && state.radio !== 'none' && (
          <button
            className={`chip-button ${armedOff ? 'danger' : ''}`}
            onClick={toggleRadio}
            disabled={busy != null}
          >
            {armedOff ? 'Turn off anyway' : on ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>

      <div className="panel-scroll">
        {!state && !loadError && <span className="muted-text">Loading…</span>}
        {on && connected.length > 0 && (
          <section>
            <h3 className="section-title">Connected</h3>
            {connected.map(row)}
          </section>
        )}
        {on && (
          <section>
            <h3 className="section-title">Paired</h3>
            {paired.length === 0 && <span className="muted-text">No other paired devices</span>}
            {paired.map(row)}
          </section>
        )}
      </div>
      <div className="list-head panel-foot">
        <span className="muted-text">New devices are paired in Settings</span>
        <button className="chip-button ghost" onClick={() => void openBluetoothSettings()}>
          <Settings size={12} /> Bluetooth settings
        </button>
      </div>
      {(error ?? loadError) && <p className="panel-error ellipsis">{error ?? loadError}</p>}
    </div>
  );
}
