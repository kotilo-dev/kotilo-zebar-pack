import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  Files,
  Flag,
  Image as ImageIcon,
  Lock,
  LogOut,
  Moon,
  Pause,
  Play,
  Power,
  RotateCcw,
  RotateCw,
  Search,
  SkipForward,
  Target,
  Timer as TimerIcon,
  Trash2,
  Type,
  Watch,
  X,
} from 'lucide-react';
import { calculate, formatResult } from './calc';
import { PanelHeader } from './components';
import type { IslandOutputs } from './providers';
import { useIsland } from './store';
import {
  appIcons,
  clearClipboardHistory,
  clipboardHistory,
  copyClipItem,
  deleteClipItem,
  launchApp,
  listApps,
  runPower,
  type ClipItem, type PowerAction, type StartApp } from './system';
import { POMODORO_LABEL, POMODORO_ROUNDS } from '../shared/liveTimer';
import { formatDuration, pomodoroLeft, stopwatchElapsed, timerLeft, useNow, useTimer } from './timer';

/* ---- Power ----------------------------------------------------------------- */

const POWER: { id: PowerAction; label: string; icon: typeof Lock; confirm: boolean }[] = [
  { id: 'lock', label: 'Lock', icon: Lock, confirm: false },
  { id: 'sleep', label: 'Sleep', icon: Moon, confirm: false },
  { id: 'signout', label: 'Sign out', icon: LogOut, confirm: true },
  { id: 'restart', label: 'Restart', icon: RotateCw, confirm: true },
  { id: 'shutdown', label: 'Shut down', icon: Power, confirm: true },
];

/**
 * Lock and sleep act on the first click. Sign out, restart and shut down close
 * apps, so they ask for a second click within three seconds.
 */
export function PowerView() {
  const closePanel = useIsland((s) => s.closePanel);
  const [armed, setArmed] = useState<PowerAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const run = (action: PowerAction, confirm: boolean) => {
    if (confirm && armed !== action) {
      setArmed(action);
      return;
    }
    setArmed(null);
    closePanel();
    runPower(action).catch((err) => setError(String(err)));
  };

  return (
    <div className="view-panel">
      <PanelHeader title="Power" back />
      <div className="power-row">
        {POWER.map(({ id, label, icon: Icon, confirm }) => (
          <button key={id} className={`power-button ${armed === id ? 'armed' : ''}`} onClick={() => run(id, confirm)}>
            <span className="power-icon">
              <Icon size={20} />
            </span>
            <span>{armed === id ? 'Click again' : label}</span>
          </button>
        ))}
      </div>
      {error && <p className="panel-error ellipsis">{error}</p>}
    </div>
  );
}

/* ---- Timer and stopwatch ---------------------------------------------------- */

const PRESETS = [1, 5, 10, 15, 25, 45];

type TimerTab = 'timer' | 'stopwatch' | 'pomodoro';

/** The tab to open on: whichever clock runs (countdown first), else the timer. */
function runningTab(): TimerTab {
  const s = useTimer.getState();
  if (s.endsAt) return 'timer';
  if (s.pomoEndsAt) return 'pomodoro';
  if (s.swStartedAt) return 'stopwatch';
  return 'timer';
}

export function TimerView({ active }: { active: boolean }) {
  const [tab, setTab] = useState<TimerTab>(runningTab);
  // Opened from the bar's readout: show the clock that is running.
  useEffect(() => {
    if (active) setTab(runningTab());
  }, [active]);
  const t = useTimer();
  const now = useNow(t.endsAt != null || t.swStartedAt != null || t.pomoEndsAt != null, tab === 'stopwatch' ? 100 : 250);

  return (
    <div className="view-panel">
      <PanelHeader
        back
        title={
          <div className="segmented">
            <button className={tab === 'timer' ? 'on' : ''} onClick={() => setTab('timer')}>
              <TimerIcon size={13} /> Timer
            </button>
            <button className={tab === 'stopwatch' ? 'on' : ''} onClick={() => setTab('stopwatch')}>
              <Watch size={13} /> Stopwatch
            </button>
            <button className={tab === 'pomodoro' ? 'on' : ''} onClick={() => setTab('pomodoro')}>
              <Target size={13} /> Pomodoro
            </button>
          </div>
        }
      />

      {tab === 'pomodoro' ? (
        <>
          <div className="big-time">{formatDuration(pomodoroLeft(t, now))}</div>
          <div className="pomo-status">
            <span>{POMODORO_LABEL[t.pomoPhase]}</span>
            <span className="pomo-dots" aria-label={`Round ${t.pomoRound} of ${POMODORO_ROUNDS}`}>
              {Array.from({ length: POMODORO_ROUNDS }, (_, i) => (
                <i key={i} className={i < t.pomoRound - (t.pomoPhase === 'work' ? 1 : 0) ? 'done' : i === t.pomoRound - 1 ? 'now' : ''} />
              ))}
            </span>
          </div>
          <div className="time-controls">
            <button className="round" onClick={t.resetPomodoro} aria-label="Reset">
              <RotateCcw size={16} />
            </button>
            <button
              className="round primary"
              onClick={t.pomoEndsAt ? t.pausePomodoro : t.startPomodoro}
              aria-label="Start or pause"
            >
              {t.pomoEndsAt ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="round" onClick={() => t.nextPomodoro(t.pomoEndsAt != null)} aria-label="Skip to the next phase">
              <SkipForward size={16} />
            </button>
          </div>
        </>
      ) : tab === 'timer' ? (
        <>
          <div className="big-time">{formatDuration(timerLeft(t, now))}</div>
          <div className="presets">
            {PRESETS.map((m) => (
              <button
                key={m}
                className={`chip-button ${!t.endsAt && t.pausedLeft == null && t.duration === m * 60_000 ? 'on' : ''}`}
                onClick={() => t.setDuration(m * 60_000)}
              >
                {m} min
              </button>
            ))}
          </div>
          <div className="time-controls">
            <button className="round" onClick={t.resetTimer} aria-label="Reset">
              <RotateCcw size={16} />
            </button>
            <button className="round primary" onClick={t.endsAt ? t.pauseTimer : t.startTimer} aria-label="Start or pause">
              {t.endsAt ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              className="round"
              onClick={() => t.setDuration(t.duration + 60_000)}
              disabled={t.endsAt != null}
              aria-label="Add a minute"
            >
              +1
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="big-time">{formatDuration(stopwatchElapsed(t, now), true)}</div>
          <div className="laps">
            {t.laps.length === 0 ? (
              <span className="muted-text">Laps show up here</span>
            ) : (
              t.laps.slice(0, 3).map((lap, i) => (
                <span key={t.laps.length - i}>
                  Lap {t.laps.length - i} · {formatDuration(lap, true)}
                </span>
              ))
            )}
          </div>
          <div className="time-controls">
            <button className="round" onClick={t.resetStopwatch} aria-label="Reset">
              <RotateCcw size={16} />
            </button>
            <button
              className="round primary"
              onClick={t.swStartedAt ? t.pauseStopwatch : t.startStopwatch}
              aria-label="Start or pause"
            >
              {t.swStartedAt ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="round" onClick={t.lap} disabled={!t.swStartedAt} aria-label="Lap">
              <Flag size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Keeps a panel's text field focused while the panel is open. When a shortcut
 * or the bar opened it, the window gets focus a moment later through a click on
 * its margin (see scripts/focus.ps1); that click takes focus from the field, so
 * it is given back on the window's focus and after every mouse release.
 */
export function useKeepFocused(active: boolean, input: React.RefObject<HTMLInputElement | HTMLTextAreaElement>) {
  useEffect(() => {
    if (!active) return;
    const refocus = () => input.current?.focus({ preventScroll: true });
    refocus();
    window.addEventListener('focus', refocus);
    window.addEventListener('mouseup', refocus);
    return () => {
      window.removeEventListener('focus', refocus);
      window.removeEventListener('mouseup', refocus);
    };
  }, [active, input]);
}

/* ---- Launcher ----------------------------------------------------------------- */

const RECENT_KEY = 'kotilo.launcher.recent.v2';
const MAX_RESULTS = 8;

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function rememberRecent(appId: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([appId, ...readRecent().filter((id) => id !== appId)].slice(0, 12)));
  } catch {
    // Storage unavailable: the list simply starts alphabetical next time.
  }
}

/**
 * Lower-cases for matching and treats the Turkish dotless/dotted i as plain i,
 * so "vısual" (typed on a Turkish keyboard) still finds "Visual Studio".
 */
const fold = (text: string) => text.toLocaleLowerCase('en').replace(/ı/g, 'i').replace(/i̇/g, 'i');

/** Prefix of the name beats prefix of a word, which beats a match anywhere. */
function score(name: string, query: string) {
  const n = fold(name);
  if (n.startsWith(query)) return 3;
  if (n.split(/[\s\-_.]+/).some((w) => w.startsWith(query))) return 2;
  if (n.includes(query)) return 1;
  return 0;
}

let appCache: StartApp[] | null = null;
let iconCache: Record<string, string> | null = null;
let iconLoad: Promise<Record<string, string>> | null = null;

/**
 * Start menu app icons keyed by AppID, loaded once and shared with the
 * notifications (a notification's app ID is the same AppID). `refresh` runs
 * the script again (it only extracts apps missing from its disk cache).
 */
export function loadAppIcons(refresh = false): Promise<Record<string, string>> {
  if (iconCache && !refresh) return Promise.resolve(iconCache);
  iconLoad ??= appIcons()
    .then((map) => (iconCache = map))
    .finally(() => (iconLoad = null));
  return iconLoad;
}

export const cachedAppIcon = (appId: string | null) => (appId && iconCache?.[appId]) || undefined;

export function LauncherView({ active }: { active: boolean }) {
  const closePanel = useIsland((s) => s.closePanel);
  const showBanner = useIsland((s) => s.showBanner);
  const [apps, setApps] = useState<StartApp[] | null>(appCache);
  const [icons, setIcons] = useState<Record<string, string>>(iconCache ?? {});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Each time the launcher opens: clear the search, focus it, and refresh the
  // app list in the background (the cached list shows meanwhile).
  useEffect(() => {
    if (!active) return;
    setQuery('');
    setSelected(0);
    // The notifications may have loaded the shared icons since this view mounted.
    if (iconCache) setIcons(iconCache);
    listApps()
      .then((list) => {
        appCache = list;
        setApps(list);
        setError(null);
        // Icons load after the list (the first run extracts them, a few seconds),
        // and again only when an app without an icon shows up.
        const stale = !iconCache || list.some((a) => !(a.appId in iconCache!));
        loadAppIcons(stale)
          .then(setIcons)
          .catch((err) => console.warn('[kotilo] app icons', err));
      })
      .catch((err) => setError(String(err)));
  }, [active]);

  useKeepFocused(active, input);

  const results = useMemo(() => {
    if (!apps) return [];
    const q = fold(query.trim());
    if (!q) {
      const recent = readRecent();
      const byId = new Map(apps.map((a) => [a.appId, a]));
      const first = recent.map((id) => byId.get(id)).filter((a): a is StartApp => !!a);
      const rest = apps.filter((a) => !recent.includes(a.appId));
      return [...first, ...rest].slice(0, MAX_RESULTS);
    }
    return apps
      .map((a) => ({ a, s: score(a.name, q) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s || x.a.name.localeCompare(y.a.name))
      .slice(0, MAX_RESULTS)
      .map((x) => x.a);
  }, [apps, query]);

  const open = (app: StartApp | undefined) => {
    if (!app) return;
    rememberRecent(app.appId);
    closePanel();
    launchApp(app).catch((err) => setError(String(err)));
  };

  // "=12*7" turns the search into a calculator; Enter copies the result.
  const isCalc = query.trimStart().startsWith('=');
  const calc = isCalc ? calculate(query.trimStart().slice(1)) : null;
  const copyResult = () => {
    if (calc == null) return;
    const text = formatResult(calc);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        closePanel();
        showBanner({ icon: 'check', title: `Copied ${text}`, sub: 'Paste with Ctrl+V' }, 1800);
      })
      .catch((err) => setError(String(err)));
  };

  return (
    <div className="view-panel launcher">
      <PanelHeader title="Apps" back />
      <label className="search">
        <Search size={15} className="accent" />
        <input
          ref={input}
          value={query}
          placeholder="Search apps"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              if (isCalc) copyResult();
              else open(results[selected]);
            }
          }}
        />
        {apps && !isCalc && <span className="search-count">{apps.length}</span>}
      </label>
      <div className="results">
        {isCalc && (
          <button className="result selected" onClick={copyResult} disabled={calc == null}>
            <span className="result-avatar">
              <Calculator size={15} />
            </span>
            <span className="ellipsis">{calc == null ? 'Type a sum, e.g. =12*7' : `= ${formatResult(calc)}`}</span>
            {calc != null && <span className="result-hint">Copy ↵</span>}
          </button>
        )}
        {!isCalc && !apps && !error && <span className="muted-text">Loading apps…</span>}
        {!isCalc && apps && results.length === 0 && <span className="muted-text">Nothing found</span>}
        {!isCalc && results.map((app, i) => (
          <button
            key={app.appId}
            className={`result ${i === selected ? 'selected' : ''}`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => open(app)}
          >
            {icons[app.appId] ? (
              <img className="result-icon" src={icons[app.appId]} alt="" />
            ) : (
              <span className="result-avatar">{app.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="ellipsis">{highlight(app.name, query.trim())}</span>
            {i === selected && <span className="result-hint">Open ↵</span>}
          </button>
        ))}
        {error && <p className="panel-error ellipsis">{error}</p>}
      </div>
    </div>
  );
}

function highlight(name: string, query: string) {
  if (!query) return name;
  const at = fold(name).indexOf(fold(query));
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <mark>{name.slice(at, at + query.length)}</mark>
      {name.slice(at + query.length)}
    </>
  );
}

/* ---- Clipboard history --------------------------------------------------------- */

function ago(time: number, now: number) {
  const s = Math.max(0, Math.round((now - time) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

const CLIP_KIND_LABEL = { image: 'Image', files: 'Files', other: 'Other content' } as const;

/**
 * Windows' own clipboard history (the Win+V list). Picking an item puts it on
 * the clipboard and closes the panel; paste it with Ctrl+V.
 */
export function ClipboardView({ active }: { active: boolean }) {
  const { closePanel, showBanner } = useIsland();
  const [items, setItems] = useState<ClipItem[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [armedClear, setArmedClear] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const refresh = () =>
    clipboardHistory()
      .then((h) => {
        setEnabled(h.enabled);
        setItems(h.items);
        setError(null);
      })
      .catch((err) => setError(String(err)));

  useEffect(() => {
    if (!active) return;
    setQuery('');
    setSelected(0);
    setArmedClear(false);
    void refresh();
  }, [active]);

  useKeepFocused(active, input);

  useEffect(() => {
    if (!armedClear) return;
    const t = setTimeout(() => setArmedClear(false), 3000);
    return () => clearTimeout(t);
  }, [armedClear]);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return (items ?? []).filter((it) => !q || (it.text != null && fold(it.text).includes(q)));
  }, [items, query]);

  // Keep the selected row in view while moving with the arrow keys.
  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const pick = (item: ClipItem | undefined) => {
    if (!item) return;
    copyClipItem(item.id)
      .then(() => {
        closePanel();
        showBanner({ icon: 'check', title: 'Copied to clipboard', sub: 'Paste with Ctrl+V' }, 1800);
      })
      .catch((err) => setError(String(err)));
  };

  const remove = (item: ClipItem) =>
    deleteClipItem(item.id)
      .then(refresh)
      .catch((err) => setError(String(err)));

  const clearAll = () => {
    if (!armedClear) return setArmedClear(true);
    setArmedClear(false);
    clearClipboardHistory()
      .then(refresh)
      .catch((err) => setError(String(err)));
  };

  const now = Date.now();
  return (
    <div className="view-panel clipboard">
      <PanelHeader title="Clipboard" back />
      <div className="clip-toolbar">
        <label className="search">
          <Search size={15} className="accent" />
          <input
            ref={input}
            value={query}
            placeholder="Search clipboard"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected((i) => Math.min(i + 1, shown.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                pick(shown[selected]);
              } else if (e.key === 'Delete' && shown[selected]) {
                e.preventDefault();
                void remove(shown[selected]);
              }
            }}
          />
        </label>
        <button className={`chip-button ${armedClear ? 'danger' : ''}`} onClick={clearAll} disabled={!items?.length}>
          <Trash2 size={13} /> {armedClear ? 'Click again' : 'Clear all'}
        </button>
      </div>

      <div className="clip-list" ref={list}>
        {!enabled && (
          <span className="muted-text">Clipboard history is off. Turn it on in Settings › System › Clipboard.</span>
        )}
        {enabled && !items && !error && <span className="muted-text">Loading…</span>}
        {enabled && items && shown.length === 0 && (
          <span className="muted-text">{items.length ? 'Nothing matches' : 'Nothing copied yet'}</span>
        )}
        {shown.map((item, i) => (
          <div
            key={item.id}
            className={`clip-item ${i === selected ? 'selected' : ''}`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => pick(item)}
          >
            <span className="clip-kind">
              {item.kind === 'image' ? <ImageIcon size={14} /> : item.kind === 'files' ? <Files size={14} /> : <Type size={14} />}
            </span>
            <span className="clip-body">
              {item.kind === 'text' ? (
                <span className="clip-text">{item.text}</span>
              ) : item.image ? (
                <img className="clip-image" src={`data:image/png;base64,${item.image}`} alt="" />
              ) : (
                <span className="muted-text">{CLIP_KIND_LABEL[item.kind as keyof typeof CLIP_KIND_LABEL] ?? 'Item'}</span>
              )}
            </span>
            <span className="clip-time">{ago(item.time, now)}</span>
            <button
              className="clip-delete"
              aria-label="Remove from history"
              onClick={(e) => {
                e.stopPropagation();
                void remove(item);
              }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      {error && <p className="panel-error ellipsis">{error}</p>}
    </div>
  );
}

/* ---- Tray --------------------------------------------------------------------- */

export function TrayView({ out }: { out: IslandOutputs }) {
  const tray = out.systray;
  const icons = tray?.icons ?? [];
  return (
    <div className="view-panel">
      <PanelHeader title="Tray" back />
      <div className="tray-grid">
        {icons.length === 0 && <span className="muted-text">No tray icons</span>}
        {icons.map((icon) => (
          <button
            key={icon.id}
            className="tray-item"
            title={icon.tooltip}
            onClick={() => void tray?.onLeftClick(icon.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              void tray?.onRightClick(icon.id);
            }}
            onAuxClick={(e) => e.button === 1 && void tray?.onMiddleClick(icon.id)}
          >
            <img src={icon.iconUrl} alt="" />
            <span className="ellipsis">{icon.tooltip?.split('\n')[0] || 'App'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Rows the tray grid needs, so the island can size itself to fit. */
export const trayRows = (count: number) => Math.max(1, Math.ceil(count / 3));
