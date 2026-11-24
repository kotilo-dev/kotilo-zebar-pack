import {
  Activity,
  AlertTriangle,
  Bell,
  Bluetooth,
  BluetoothOff,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Ellipsis,
  Settings,
  Cloud,
  CloudDrizzle,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Rss,
  Info,
  Keyboard,
  ListTodo,
  Power,
  Timer as TimerIcon,
  Moon,
  Music2,
  Network,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  StickyNote,
  Sun,
  Volume1,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { WeatherStatus } from 'zebar';
import { AlbumArt } from '../shared/AlbumArt';
import { DottedMeter, isoWeek, MonthCalendar, monthName, Ring, Tile } from './components';
import type { IslandOutputs } from './providers';
import { BrightnessRow, QuickToggles, useTweaks } from './quickActions';
import { BAR_H, type Shape } from './shape';
import { trayRows } from './panels';
import { demo } from './demo';
import { useIsland, type Banner, type IslandMode, type OsdKind } from './store';
import {
  bluetoothSummary,
  hhmm,
  meetingWhen,
  nextEvent,
  upcomingMeeting,
  useBluetooth,
  useCalendar,
} from './systemPanels';
import { openTaskManager, setBluetoothRadio } from './system';

/** Opens Task Manager and closes the island's panel, which would otherwise stay on top of it. */
function openTaskManagerAndClose() {
  useIsland.getState().closePanel();
  void openTaskManager().catch((err) => console.warn('[kotilo] task manager', err));
}

type Out = IslandOutputs;

/** The island's size for each view. Heights count from the top of the screen. */
export function shapeFor(mode: IslandMode, out: Out): Shape {
  switch (mode) {
    case 'clock':
      return { w: 210, h: BAR_H + 6, r: 18, s: 18 };
    case 'osd':
      return { w: 320, h: BAR_H + 18, r: 20, s: 18 };
    case 'banner':
      return { w: 380, h: BAR_H + 36, r: 24, s: 20 };
    case 'clockMeeting':
      return { w: 400, h: BAR_H + 6, r: 18, s: 18 };
    case 'control': {
      // The quick toggles row always; the brightness row only where the display
      // supports it (the island re-renders when that becomes known, see `Island`).
      const extra = 70 + (useTweaks.getState().state?.brightness != null ? 34 : 0);
      // Heights fit the content with the same 26 px margin below as at the sides
      // (the media card is 89 px plus a 14 px gap).
      return { w: 600, h: (out.media?.currentSession ? 585 : 482) + extra, r: 30, s: 22 };
    }
    case 'power':
      return { w: 560, h: BAR_H + 128, r: 28, s: 20 };
    case 'timer':
      return { w: 440, h: BAR_H + 236, r: 28, s: 20 };
    case 'launcher':
      return { w: 620, h: BAR_H + 470, r: 30, s: 22 };
    case 'clipboard':
      return { w: 560, h: BAR_H + 440, r: 30, s: 22 };
    case 'tray':
      return { w: 480, h: BAR_H + 44 + trayRows(out.systray?.icons.length ?? 0) * 46, r: 28, s: 20 };
    case 'audio':
      return { w: 520, h: BAR_H + 420, r: 30, s: 22 };
    case 'wifi':
      return { w: 480, h: BAR_H + 410, r: 30, s: 22 };
    case 'sysmon':
      return { w: 560, h: BAR_H + 440, r: 30, s: 22 };
    case 'calendar':
      return { w: 480, h: BAR_H + 420, r: 30, s: 22 };
    case 'bluetooth':
      return { w: 480, h: BAR_H + 420, r: 30, s: 22 };
    case 'appearance':
      return { w: 600, h: BAR_H + 520, r: 30, s: 22 };
    case 'about':
      return { w: 560, h: BAR_H + 392, r: 30, s: 22 };
    case 'todo':
      return { w: 480, h: BAR_H + 420, r: 30, s: 22 };
    case 'notes':
      return { w: 520, h: BAR_H + 400, r: 30, s: 22 };
    case 'notifications':
      return { w: 560, h: BAR_H + 470, r: 30, s: 22 };
    case 'settings':
      return { w: 500, h: BAR_H + 520, r: 30, s: 22 };
    case 'bar-settings':
      return { w: 500, h: BAR_H + 592, r: 30, s: 22 };
    case 'notify-settings':
      return { w: 500, h: BAR_H + 470, r: 30, s: 22 };
    case 'rss':
      return { w: 560, h: BAR_H + 500, r: 30, s: 22 };
    case 'keybindings':
      return { w: 600, h: BAR_H + 600, r: 30, s: 22 };
    case 'windows':
      return { w: 560, h: BAR_H + 470, r: 30, s: 22 };
    case 'weather':
      return { w: 600, h: BAR_H + 540, r: 30, s: 22 };
  }
}

/** A meeting about to start (or just started) next to the time. */
export function ClockMeetingView({ out }: { out: Out }) {
  const events = useCalendar((c) => c.events);
  const now = out.clock?.now ?? Date.now();
  const meeting = upcomingMeeting(events, now);
  return (
    <div className="view-clock-media">
      <span className="live">
        <CalendarClock size={14} className="accent" />
        <span className="ellipsis">{meeting?.subject || 'Meeting'}</span>
        {meeting && <span className="live-time">{meetingWhen(meeting, now)}</span>}
      </span>
      <span className="clock-time">{time(out)}</span>
    </div>
  );
}

const time = (out: Out) =>
  out.clock ? new Date(out.clock.now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';

export function ClockView({ out }: { out: Out }) {
  return <div className="view-clock">{out.clock?.formatted ?? ''}</div>;
}

function volumeIcon(volume: number, muted: boolean): LucideIcon {
  if (muted || volume === 0) return VolumeX;
  return volume < 50 ? Volume1 : Volume2;
}

export function OsdView({ kind, out }: { kind: OsdKind | null; out: Out }) {
  if (kind === 'volume') {
    const device = out.audio?.defaultPlaybackDevice;
    const volume = device?.volume ?? 0;
    const Icon = volumeIcon(volume, !!device?.isMuted);
    return (
      <div className="view-osd">
        <Icon size={16} className="accent" />
        <DottedMeter value={volume} segments={22} muted={device?.isMuted} />
        <span className="osd-value">{device?.isMuted ? 'Muted' : Math.round(volume)}</span>
      </div>
    );
  }
  if (kind === 'keyboard') {
    return (
      <div className="view-osd">
        <Keyboard size={16} className="accent" />
        <span className="osd-label">Keyboard layout</span>
        <span className="osd-value">{out.keyboard?.layout ?? ''}</span>
      </div>
    );
  }
  if (kind === 'media') {
    const s = out.media?.currentSession;
    return (
      <div className="view-osd">
        <Music2 size={16} className="accent" />
        <span className="osd-label ellipsis">
          <strong>{s?.title ?? ''}</strong>
          {s?.artist ? ` · ${s.artist}` : ''}
        </span>
      </div>
    );
  }
  return <div className="view-osd" />;
}

const BANNER_ICONS = { check: CheckCircle2, alert: AlertTriangle, info: Info, bell: Bell } as const;

export function BannerView({ banner }: { banner: Banner | null }) {
  if (!banner) return <div className="view-banner" />;
  const Icon = BANNER_ICONS[banner.icon];
  return (
    <div className="view-banner">
      {banner.image ? <img className="banner-image" src={banner.image} alt="" /> : <Icon size={20} className="accent" />}
      <div className="banner-text">
        <strong className="ellipsis">{banner.title}</strong>
        {banner.sub && <span className="ellipsis">{banner.sub}</span>}
        {banner.progress != null && (
          <span className="progress">
            <i style={{ width: `${Math.round(banner.progress * 100)}%` }} />
          </span>
        )}
      </div>
    </div>
  );
}

const WEATHER: Record<WeatherStatus, [LucideIcon, string]> = {
  clear_day: [Sun, 'Clear'],
  clear_night: [Moon, 'Clear'],
  cloudy_day: [CloudSun, 'Cloudy'],
  cloudy_night: [CloudMoon, 'Cloudy'],
  light_rain_day: [CloudDrizzle, 'Light rain'],
  light_rain_night: [CloudDrizzle, 'Light rain'],
  heavy_rain_day: [CloudRain, 'Rain'],
  heavy_rain_night: [CloudRain, 'Rain'],
  snow_day: [CloudSnow, 'Snow'],
  snow_night: [CloudSnow, 'Snow'],
  thunder_day: [CloudLightning, 'Thunderstorm'],
  thunder_night: [CloudLightning, 'Thunderstorm'],
};

function networkTile(out: Out) {
  const net = out.network;
  const type = net?.defaultInterface?.type;
  if (!net || !type) return { icon: <WifiOff size={16} />, title: 'Network', detail: 'Not connected', active: false };
  if (type === 'wifi') return { icon: <Wifi size={16} />, title: 'Wi-Fi', detail: demo(net.defaultGateway?.ssid ?? 'Connected', 'Home'), active: true };
  if (type === 'ethernet') return { icon: <Network size={16} />, title: 'Ethernet', detail: 'Connected', active: true };
  return { icon: <Network size={16} />, title: 'Network', detail: net.defaultInterface?.friendlyName ?? 'Connected', active: true };
}

function systemDisk(out: Out) {
  const disk = out.disk?.disks.find((d) => d.mountPoint.toUpperCase().startsWith('C:')) ?? out.disk?.disks[0];
  if (!disk || !disk.totalSpace.bytes) return null;
  return 100 - (disk.availableSpace.bytes / disk.totalSpace.bytes) * 100;
}

export function ControlView({ out }: { out: Out }) {
  const openPanel = useIsland((s) => s.openPanel);
  const audio = out.audio;
  const device = audio?.defaultPlaybackDevice;
  const net = networkTile(out);
  const now = out.clock ? new Date(out.clock.now) : new Date();
  const session = out.media?.currentSession;
  const battery = out.battery;
  const [WeatherIcon, weatherText] = out.weather ? WEATHER[out.weather.status] : [Cloud, ''];
  const VolumeIcon = volumeIcon(device?.volume ?? 0, !!device?.isMuted);
  const events = useCalendar((c) => c.events);
  const next = nextEvent(events, now.getTime());
  const bt = useBluetooth((b) => b.state);
  const btOn = bt?.radio === 'on';
  // Today (or no day) shows today and tomorrow; any other day shows only that day.
  const openCalendar = (day: Date | null) => {
    useCalendar.getState().pick(day && day.toDateString() !== now.toDateString() ? day : null);
    openPanel('calendar');
  };

  return (
    <div className="view-control">
      <header className="control-header">
        {/* Left: the pack's own tools. Right: system and Windows things. */}
        <span className="header-actions start">
          <button onClick={() => openPanel('clipboard')} title="Clipboard (Alt+Shift+V)">
            <ClipboardList size={14} />
          </button>
          <button onClick={() => openPanel('todo')} title="To-do">
            <ListTodo size={14} />
          </button>
          <button onClick={() => openPanel('notes')} title="Notes">
            <StickyNote size={14} />
          </button>
          <button onClick={() => openPanel('timer')} title="Timer (Alt+Shift+T)">
            <TimerIcon size={14} />
          </button>
          <button onClick={() => openPanel('weather')} title="Weather">
            <CloudSun size={14} />
          </button>
          <button onClick={() => openPanel('rss')} title="News">
            <Rss size={14} />
          </button>
        </span>
        <span>Control center</span>
        <span className="header-actions">
          <button onClick={() => openPanel('notifications')} title="Notifications">
            <Bell size={14} />
          </button>
          <button onClick={() => openPanel('tray')} title="Tray">
            <Ellipsis size={14} />
          </button>
          <button onClick={() => openTaskManagerAndClose()} title="Task Manager">
            <Activity size={14} />
          </button>
          <button onClick={() => openPanel('settings')} title="Settings">
            <Settings size={14} />
          </button>
          <button onClick={() => openPanel('power')} title="Power (Alt+X)">
            <Power size={14} />
          </button>
        </span>
      </header>

      <div className="tiles three">
        <Tile icon={net.icon} title={net.title} detail={net.detail} active={net.active} more onClick={() => openPanel('wifi')} />
        <Tile
          icon={<VolumeIcon size={16} />}
          title="Sound"
          detail={device ? (device.isMuted ? 'Muted' : demo(device.name, 'Headphones')) : 'No device'}
          active={!!device && !device.isMuted}
          more
          onClick={() => openPanel('audio')}
          onIconClick={device ? () => audio?.setMute(!device.isMuted) : undefined}
          iconLabel={device?.isMuted ? 'Unmute' : 'Mute'}
        />
        <Tile
          icon={btOn ? <Bluetooth size={16} /> : <BluetoothOff size={16} />}
          title="Bluetooth"
          detail={demo(bluetoothSummary(bt), 'Headphones')}
          active={btOn}
          more
          onClick={() => openPanel('bluetooth')}
          // Turning off from the tile could drop a Bluetooth keyboard or mouse without warning; that is done in the panel.
          onIconClick={
            bt?.radio === 'off'
              ? () =>
                  void setBluetoothRadio(true)
                    .then(() => useBluetooth.getState().refresh())
                    .catch(() => openPanel('bluetooth'))
              : () => openPanel('bluetooth')
          }
          iconLabel={btOn ? 'Bluetooth' : 'Turn Bluetooth on'}
        />
      </div>

      <QuickToggles out={out} />

      <div className="slider-row">
        <VolumeIcon size={15} className="accent" />
        <DottedMeter
          value={device?.volume ?? 0}
          segments={30}
          muted={device?.isMuted}
          onChange={device ? (v) => audio?.setVolume(v) : undefined}
        />
        <span className="slider-value">{Math.round(device?.volume ?? 0)}</span>
      </div>
      <BrightnessRow />

      <div className="rings clickable" role="button" title="System monitor" onClick={() => openPanel('sysmon')}>
        <Ring value={out.cpu?.usage ?? null} label="CPU" />
        <Ring value={out.memory?.usage ?? null} label="RAM" />
        <Ring value={systemDisk(out)} label="Disk" warnAt={90} />
        {battery ? (
          <Ring value={battery.chargePercent} label={battery.isCharging ? 'Charging' : 'Battery'} warnAt={101} />
        ) : (
          <Ring value={null} label="Battery" />
        )}
      </div>

      <div className="today-block">
        <div className="today-side">
          <button className="today-date" onClick={() => openCalendar(null)} title="Calendar">
            <span className="today-weekday">{now.toLocaleDateString('en-GB', { weekday: 'long' })}</span>
            <span className="today-day">{now.getDate()}</span>
            <span className="today-meta">
              {monthName(now.getMonth())} · Week {isoWeek(now)}
            </span>
            {next && (
              <span className="today-next ellipsis">
                <CalendarClock size={12} /> {hhmm(next.start)} {next.subject}
              </span>
            )}
          </button>
          {out.weather && (
            <div className="weather clickable" role="button" title="Weather forecast" onClick={() => openPanel('weather')}>
              <span className="weather-temp">
                <WeatherIcon size={34} className="accent" />
                {Math.round(out.weather.celsiusTemp)}°
              </span>
              <span className="weather-text">{weatherText}</span>
              <span className="weather-meta">Wind {Math.round(out.weather.windSpeed)} km/h</span>
            </div>
          )}
        </div>
        <MonthCalendar today={now} onPick={(d) => openCalendar(d)} />
      </div>

      {session && (
        <div className="media-card">
          <AlbumArt session={session} className="media-art" size={26} />
          <div className="media-text">
            <strong className="ellipsis">{session.title ?? 'Unknown track'}</strong>
            <span className="ellipsis">{session.artist ?? ''}</span>
          </div>
          <div className="media-controls">
            <button onClick={() => out.media?.previous()} aria-label="Previous">
              <SkipBack size={16} />
            </button>
            <button className="primary" onClick={() => out.media?.togglePlayPause()} aria-label="Play or pause">
              {session.isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button onClick={() => out.media?.next()} aria-label="Next">
              <SkipForward size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
