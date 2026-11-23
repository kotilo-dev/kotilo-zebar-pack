import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { POMODORO_LABEL, POMODORO_MIN, POMODORO_ROUNDS } from '../shared/liveTimer';
import { cssBezier, motion } from '../shared/motion';
import { useProviderGroup } from '../shared/useProviders';
import { onWindowBlur, placeWindow } from '../shared/widgetWindow';
import { providers, type IslandOutputs } from './providers';
import { islandPath, LAYOUT_W, SHRINK_MS, useAnimatedShape, windowSizeFor, type Shape } from './shape';
import { listen } from '@tauri-apps/api/event';
import { AboutView } from './aboutPanel';
import { AppearanceView } from './appearancePanel';
import { ClipboardView, PowerView, TimerView, TrayView } from './panels';
import { LauncherView } from './launcherPanel';
import { focusIsland, prepareClipboard, prepareFocus } from './system';
import { PANELS, resolveMode, useIsland, type IslandMode, type PanelId } from './store';
import { chime, formatDuration, useShareTimer, useTimer } from './timer';
import { TodoView } from './todoPanel';
import { NotesView } from './notesPanel';
import { SettingsView } from './settingsPanel';
import { NotificationsView } from './notificationsPanel';
import { WindowsView } from './windowsPanel';
import { WeatherView } from './weatherPanel';
import { useNotificationPolling } from './notifications';
import { useTweaks, useTweaksPolling } from './quickActions';
import {
  AudioView,
  BluetoothView,
  CalendarView,
  SysmonView,
  upcomingMeeting,
  useBluetoothPolling,
  useCalendar,
  useCalendarPolling,
  useCollectHistory,
  WifiView,
} from './systemPanels';
import {
  BannerView,
  ClockMeetingView,
  ClockView,
  ControlView,
  OsdView,
  shapeFor,
} from './views';

export function Island() {
  const out = useProviderGroup(providers);
  const { panel, osd, banner, togglePanel, closePanel } = useIsland();
  useChangeIndicators(out);
  useTimerFinish();
  useShareTimer();
  useShortcuts(out);
  usePanelRequests();
  useCollectHistory(out);
  useCalendarPolling();
  const meeting = !!upcomingMeeting(useCalendar((c) => c.events), out.clock?.now ?? Date.now());

  const mode = resolveMode({ panel, osd, banner }, { meeting });
  useBluetoothPolling(mode);
  useTweaksPolling(mode);
  useNotificationPolling(mode);
  // The control centre is taller where the display has a brightness control; re-render when that is known.
  useTweaks((t) => t.state?.brightness != null);
  const target = shapeFor(mode, out);
  useFittedWindow(windowSizeFor(target));
  // Everything is drawn in the fixed layout box, centred on the screen's middle.
  const winWidth = LAYOUT_W;
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    prepareFocus();
    prepareClipboard();
  }, []);

  // Esc or a click anywhere else closes an open panel.
  useEffect(
    () =>
      onWindowBlur(() => {
        const island = useIsland.getState();
        if (island.panel && Date.now() < island.keepOpenUntil) void focusIsland();
        else island.closePanel();
      }),
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closePanel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePanel]);

  // A click on the resting island opens what it is showing: the calendar before
  // a meeting, otherwise the control centre. Inside a panel, clicks belong to the panel.
  // A click within 400 ms of a panel closing belongs to whatever closed it
  // (a click elsewhere, Esc), not to a new request.
  const onSurfaceClick = panel
    ? undefined
    : () => {
        if (Date.now() - useIsland.getState().closedAt < 400) return;
        // A banner can name its own panel (a notification opens the notification list).
        if (mode === 'banner' && banner?.panel) {
          useIsland.getState().dismissBanner();
          return togglePanel(banner.panel);
        }
        togglePanel(mode === 'clockMeeting' ? 'calendar' : 'control');
      };

  return (
    <div className="island-root">
      <ShapeLayer target={target} winWidth={winWidth} contentRef={contentRef} />
      <div ref={contentRef} className="island-content" onClick={onSurfaceClick}>
        <View name="clock" mode={mode} winWidth={winWidth} out={out}>
          <ClockView out={out} />
        </View>
        <View name="osd" mode={mode} winWidth={winWidth} out={out}>
          <OsdView kind={osd} out={out} />
        </View>
        <View name="banner" mode={mode} winWidth={winWidth} out={out}>
          <BannerView banner={banner} />
        </View>
        <View name="clockMeeting" mode={mode} winWidth={winWidth} out={out}>
          {meeting && <ClockMeetingView out={out} />}
        </View>
        <View name="control" mode={mode} winWidth={winWidth} out={out}>
          <ControlView out={out} />
        </View>
        <View name="power" mode={mode} winWidth={winWidth} out={out}>
          <PowerView />
        </View>
        <View name="timer" mode={mode} winWidth={winWidth} out={out}>
          <TimerView active={mode === 'timer'} />
        </View>
        <View name="launcher" mode={mode} winWidth={winWidth} out={out}>
          <LauncherView out={out} active={mode === 'launcher'} />
        </View>
        <View name="clipboard" mode={mode} winWidth={winWidth} out={out}>
          <ClipboardView active={mode === 'clipboard'} />
        </View>
        <View name="tray" mode={mode} winWidth={winWidth} out={out}>
          <TrayView out={out} />
        </View>
        <View name="audio" mode={mode} winWidth={winWidth} out={out}>
          <AudioView out={out} active={mode === 'audio'} />
        </View>
        <View name="wifi" mode={mode} winWidth={winWidth} out={out}>
          <WifiView out={out} active={mode === 'wifi'} />
        </View>
        <View name="sysmon" mode={mode} winWidth={winWidth} out={out}>
          <SysmonView out={out} active={mode === 'sysmon'} />
        </View>
        <View name="calendar" mode={mode} winWidth={winWidth} out={out}>
          <CalendarView out={out} active={mode === 'calendar'} />
        </View>
        <View name="bluetooth" mode={mode} winWidth={winWidth} out={out}>
          <BluetoothView active={mode === 'bluetooth'} />
        </View>
        <View name="appearance" mode={mode} winWidth={winWidth} out={out}>
          <AppearanceView out={out} active={mode === 'appearance'} />
        </View>
        <View name="about" mode={mode} winWidth={winWidth} out={out}>
          <AboutView active={mode === 'about'} />
        </View>
        <View name="todo" mode={mode} winWidth={winWidth} out={out}>
          <TodoView active={mode === 'todo'} />
        </View>
        <View name="notes" mode={mode} winWidth={winWidth} out={out}>
          <NotesView active={mode === 'notes'} />
        </View>
        <View name="settings" mode={mode} winWidth={winWidth} out={out}>
          <SettingsView />
        </View>
        <View name="notifications" mode={mode} winWidth={winWidth} out={out}>
          <NotificationsView active={mode === 'notifications'} />
        </View>
        <View name="windows" mode={mode} winWidth={winWidth} out={out}>
          <WindowsView out={out} active={mode === 'windows'} />
        </View>
        <View name="weather" mode={mode} winWidth={winWidth} out={out}>
          <WeatherView out={out} active={mode === 'weather'} />
        </View>
      </div>
    </div>
  );
}

/**
 * The animated outline. It re-renders on every animation frame, so it lives on
 * its own and clips the content through the DOM instead of through React state;
 * the views themselves only re-render when their data changes.
 */
function ShapeLayer({
  target,
  winWidth,
  contentRef,
}: {
  target: Shape;
  winWidth: number;
  contentRef: RefObject<HTMLDivElement>;
}) {
  const shape = useAnimatedShape(target);
  const fill = islandPath(winWidth, shape);
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.style.clipPath = `path('${fill}')`;
  }, [fill, contentRef]);
  return (
    <svg className="island-shape" width={winWidth} height="100%">
      <path className="island-fill" d={fill} />
      <path className="island-outline" d={islandPath(winWidth, shape, true)} />
    </svg>
  );
}

/**
 * One view of the island, laid out at its own final size and centred, so its
 * content never reflows while the shape animates; the shape's clip reveals it.
 * It fades in after the shape has started to grow and out before it shrinks.
 */
function View({
  name,
  mode,
  winWidth,
  out,
  children,
}: {
  name: IslandMode;
  mode: IslandMode;
  winWidth: number;
  out: IslandOutputs;
  children: ReactNode;
}) {
  const current = mode === name;
  const { w, h } = shapeFor(name, out);
  const transition = current
    ? `opacity ${motion.normal}ms ${cssBezier(motion.curveIn)} ${motion.contentDelay}ms`
    : `opacity ${motion.contentOut}ms linear`;
  return (
    <div
      className={`island-view ${current ? 'current' : ''}`}
      style={{ left: Math.round((winWidth - w) / 2), width: w, height: h, opacity: current ? 1 : 0, transition }}
      aria-hidden={!current}
    >
      {children}
    </div>
  );
}

/**
 * Keeps the widget window just large enough for the island. It grows at once,
 * before the shape does, and shrinks only after the shape has finished
 * shrinking, so the outline is never cut off. The window's left edge is fixed
 * (see `LAYOUT_W`), so only its right side and bottom move and the island
 * itself never shifts while the window changes size.
 */
function useFittedWindow(size: { width: number; height: number }) {
  const applied = useRef<{ width: number; height: number } | null>(null);
  const shrinkTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const prev = applied.current;
    clearTimeout(shrinkTimer.current);
    const apply = (s: { width: number; height: number }) => {
      applied.current = s;
      placeWindow(s.width, s.height, { centerAt: LAYOUT_W / 2 });
    };
    if (!prev) {
      apply(size);
      return;
    }
    const grown = { width: Math.max(prev.width, size.width), height: Math.max(prev.height, size.height) };
    if (grown.width !== prev.width || grown.height !== prev.height) apply(grown);
    if (size.width < grown.width || size.height < grown.height) {
      shrinkTimer.current = setTimeout(() => apply(size), SHRINK_MS + 40);
    }
  }, [size.width, size.height]);
}

/** When the countdown reaches zero: a chime and a banner, and the timer resets. Likewise for pomodoro phases. */
function useTimerFinish() {
  const endsAt = useTimer((t) => t.endsAt);
  const duration = useTimer((t) => t.duration);
  useEffect(() => {
    if (!endsAt) return;
    const id = setTimeout(() => {
      useTimer.getState().resetTimer();
      chime();
      useIsland.getState().showBanner({ icon: 'check', title: 'Timer finished', sub: formatDuration(duration) }, 6000);
    }, Math.max(0, endsAt - Date.now()));
    return () => clearTimeout(id);
  }, [endsAt, duration]);

  // A pomodoro phase ending: a chime, a banner naming the next phase, which starts at once.
  const pomoEndsAt = useTimer((t) => t.pomoEndsAt);
  useEffect(() => {
    if (!pomoEndsAt) return;
    const id = setTimeout(() => {
      const timer = useTimer.getState();
      timer.nextPomodoro(true);
      const { pomoPhase, pomoRound } = useTimer.getState();
      chime();
      useIsland.getState().showBanner(
        pomoPhase === 'work'
          ? { icon: 'info', title: 'Back to focus', sub: `Round ${pomoRound} of ${POMODORO_ROUNDS} · ${POMODORO_MIN.work} min` }
          : { icon: 'check', title: `${POMODORO_LABEL[pomoPhase]} time`, sub: `${POMODORO_MIN[pomoPhase]} min` },
        6000,
      );
    }, Math.max(0, pomoEndsAt - Date.now()));
    return () => clearTimeout(id);
  }, [pomoEndsAt]);
}

/**
 * Keyboard shortcuts. Zebar has no global hotkeys, so GlazeWM provides them:
 * a key enables a binding mode named `island-<panel>`, the island sees it in
 * the GlazeWM state, opens that panel and turns the mode off again.
 */
function useShortcuts(out: IslandOutputs) {
  const wm = out.glazewm;
  const requested = wm?.bindingModes.map((m) => m.name).find((n) => n.startsWith('island-'));
  useEffect(() => {
    if (!wm || !requested) return;
    const id = requested.slice('island-'.length) as PanelId;
    void wm.runCommand(`wm-disable-binding-mode --name ${requested}`);
    if (!PANELS.includes(id)) return;
    useIsland.getState().togglePanel(id);
    // A key press leaves focus with the app underneath; take it, so the panel
    // can be typed into and Esc or a click elsewhere closes it.
    if (useIsland.getState().panel) void focusIsland();
  }, [requested]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Panels other widgets ask for (the bar's tray button) arrive as Tauri events. */
function usePanelRequests() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    listen<PanelId>('kotilo:toggle-panel', (e) => {
      if (!PANELS.includes(e.payload)) return;
      useIsland.getState().togglePanel(e.payload);
      // The click landed on the bar's window; take focus so Esc and a click elsewhere close the panel.
      if (useIsland.getState().panel) void focusIsland();
    })
      .then((unlisten) => (cancelled ? unlisten() : (stop = unlisten)))
      .catch(() => {}); // Outside Zebar there is no event bus.
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
}

/**
 * Shows a short indicator when the volume, the keyboard layout or the playing
 * track changes. Values seen in the first moments after start-up are the
 * initial state, not changes, so they are ignored.
 */
function useChangeIndicators(out: IslandOutputs) {
  const showOsd = useIsland((s) => s.showOsd);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const device = out.audio?.defaultPlaybackDevice;
  const volume = device ? Math.round(device.volume) : null;
  const muted = device?.isMuted ?? null;
  useEffect(() => {
    if (armed && volume != null) showOsd('volume');
  }, [volume, muted]); // eslint-disable-line react-hooks/exhaustive-deps

  const layout = out.keyboard?.layout ?? null;
  useEffect(() => {
    if (armed && layout) showOsd('keyboard');
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const session = out.media?.currentSession;
  const track = session?.isPlaying ? `${session.title}\u0000${session.artist}` : null;
  useEffect(() => {
    if (armed && track) showOsd('media');
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps
}
