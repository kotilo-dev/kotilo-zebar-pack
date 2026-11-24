import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { POMODORO_LABEL, POMODORO_MIN, POMODORO_ROUNDS } from '../shared/liveTimer';
import { cssBezier, motion } from '../shared/motion';
import { useProviderGroup } from '../shared/useProviders';
import { DEFAULT_BAR_OPACITY, DEFAULT_BAR_STYLE, isBarOpacity, isBarStyle, type WmGaps } from '../shared/barStyle';
import { STORED, useStored, writeStored } from '../shared/stored';
import { useMediaArtSync } from './mediaArt';
import { onWindowBlur, placeWindow } from '../shared/widgetWindow';
import { providers, type IslandOutputs } from './providers';
import { islandPath, LAYOUT_W, SHRINK_MS, useAnimatedShape, windowSizeFor, type Shape } from './shape';
import { listen } from '@tauri-apps/api/event';
import { AboutView } from './aboutPanel';
import { AppearanceView } from './appearancePanel';
import { ClipboardView, PowerView, TimerView, TrayView } from './panels';
import { LauncherView } from './launcherPanel';
import { focusIsland, glazeGaps, prepareClipboard, prepareFocus } from './system';
import { PANELS, resolveMode, useIsland, type IslandMode, type PanelId } from './store';
import { chime, formatDuration, useShareTimer, useTimer } from './timer';
import { TodoView } from './todoPanel';
import { NotesView } from './notesPanel';
import { BarSettingsView, NotificationSettingsView, SettingsView } from './settingsPanel';
import { KeybindingsView } from './keybindingsPanel';
import { RssView } from './rssPanel';
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

/**
 * While the bar is floating or in segments, reads GlazeWM's outer gap so the
 * bar's ends line up with where GlazeWM starts and ends the windows. Read once
 * when such a style is picked (and at start); the full bar needs no gap.
 */
function useGapSync(needed: boolean) {
  useEffect(() => {
    if (!needed) return;
    glazeGaps()
      .then((g) => writeStored(STORED.wmGaps, { left: g.left, right: g.right, scaleWithDpi: g.scaleWithDpi } satisfies WmGaps))
      .catch((err) => console.warn('[kotilo] glazewm gaps', err));
  }, [needed]);
}

/**
 * Shares the island's width (body and shoulders) with the bar. A see-through
 * bar must not stack with the island, or the two layers would show as a darker
 * block: the full bar cuts its line where the island hangs (the island paints
 * only below it), the floating bar leaves a hole under the notch. A growing
 * island shares its new width at once; a shrinking one only once it has
 * shrunk, so the bar never shows through the part still on screen.
 */
function useShareWidth(width: number) {
  const shared = useRef<number | null>(null);
  useEffect(() => {
    const grows = shared.current == null || width > shared.current;
    const timer = window.setTimeout(
      () => {
        shared.current = width;
        writeStored(STORED.islandWidth, width);
      },
      grows ? 0 : SHRINK_MS,
    );
    return () => clearTimeout(timer);
  }, [width]);
}

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
  useMediaArtSync(out.media?.currentSession);
  const meeting = !!upcomingMeeting(useCalendar((c) => c.events), out.clock?.now ?? Date.now());

  const mode = resolveMode({ panel, osd, banner }, { meeting });
  useBluetoothPolling(mode);
  useTweaksPolling(mode);
  useNotificationPolling(mode);
  // The control centre is taller where the display has a brightness control; re-render when that is known.
  useTweaks((t) => t.state?.brightness != null);
  // Without the bar's full-width line (floating or segments style) the island
  // hangs from the top of the screen like a notch, with no shoulders.
  const barStyle = useStored<unknown>(STORED.barStyle, DEFAULT_BAR_STYLE);
  const notch = isBarStyle(barStyle) && barStyle !== 'full';
  useGapSync(notch);
  // The island is part of the bar and takes its opacity, panels included (the
  // cards inside them keep their own solid backgrounds).
  const storedOpacity = useStored<unknown>(STORED.barOpacity, DEFAULT_BAR_OPACITY);
  const fillOpacity = isBarOpacity(storedOpacity) ? storedOpacity / 100 : 1;
  const shaped = shapeFor(mode, out);
  const target = notch ? { ...shaped, s: 0 } : shaped;
  useShareWidth(Math.round(target.w + 2 * target.s));
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
      <ShapeLayer
        target={target}
        winWidth={winWidth}
        contentRef={contentRef}
        notch={notch}
        fillOpacity={fillOpacity}
        belowLine={!notch && fillOpacity < 1}
      />
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
        <View name="bar-settings" mode={mode} winWidth={winWidth} out={out}>
          <BarSettingsView />
        </View>
        <View name="notify-settings" mode={mode} winWidth={winWidth} out={out}>
          <NotificationSettingsView />
        </View>
        <View name="keybindings" mode={mode} winWidth={winWidth} out={out}>
          <KeybindingsView out={out} active={mode === 'keybindings'} />
        </View>
        <View name="rss" mode={mode} winWidth={winWidth} out={out}>
          <RssView active={mode === 'rss'} />
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
  notch,
  fillOpacity,
  belowLine,
}: {
  target: Shape;
  winWidth: number;
  contentRef: RefObject<HTMLDivElement>;
  notch: boolean;
  fillOpacity: number;
  /** See-through full bar: the bar paints the strip above its line, the island only what hangs below. */
  belowLine: boolean;
}) {
  const shape = useAnimatedShape(target);
  // The content is clipped to the whole shape (the clock sits in the bar's strip).
  const fill = islandPath(winWidth, shape, false, notch);
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.style.clipPath = `path('${fill}')`;
  }, [fill, contentRef]);
  return (
    <svg className="island-shape" width={winWidth} height="100%">
      <path className="island-fill" d={belowLine ? islandPath(winWidth, shape, false, false, true) : fill} style={{ fillOpacity }} />
      <path className="island-outline" d={islandPath(winWidth, shape, true, notch)} />
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
