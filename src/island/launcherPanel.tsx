import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Calculator, ClipboardList, Search, type LucideIcon } from 'lucide-react';
import { calculate, formatResult } from './calc';
import { PanelHeader } from './components';
import { EMOJI } from './emoji';
import {
  fileIcon,
  filterMatches,
  ICONS,
  KIND_ORDER,
  matchKeybindings,
  matchRecentFiles,
  matchSettings,
  matchWindows,
  parentFolder,
  SYSTEM_COMMANDS,
  wmCommands,
  type Kind,
} from './launcherSources';
import { formatCombo, useKeybindings } from './keybindings';
import { appIconCache, loadAppIcons, useKeepFocused } from './panels';
import type { IslandOutputs } from './providers';
import { fold, frecency, frecencyBonus, match, remember } from './search';
import { useIsland } from './store';
import {
  clipboardHistory,
  copyClipItem,
  launchApp,
  launchAppAsAdmin,
  listApps,
  openRecentFile,
  openSettingsPage,
  recentFiles,
  runPower,
  webSearch,
  type ClipItem,
  type RecentFile,
  type StartApp,
} from './system';
import { convert, describe, formatAmount } from './units';
import { allWindows, focusWindow, useWindowIcons, windowIcon } from './wmWindows';

const MAX_RESULTS = 8;

/** One row of the launcher. `at` marks the matched letters of the title; `run` does the thing. */
type Result = {
  key: string;
  kind: Kind;
  title: string;
  at?: number[];
  sub?: string;
  icon: { img?: string; Icon?: LucideIcon; text?: string; emoji?: boolean };
  hint: string;
  score: number;
  /** Needs a second Enter or click (sign out, restart, shut down). */
  confirm?: boolean;
  disabled?: boolean;
  run: () => void;
  /** Ctrl+Shift+Enter or Ctrl+Shift+click, as in the Start menu: run as administrator. */
  runAsAdmin?: () => void;
};

// Lists kept between openings, so the launcher shows them at once. Each read
// starts a PowerShell (about 1.4 s of CPU for the apps, 0.9 s for recent
// files), so they are read again only when older than these ages.
let appCache: StartApp[] | null = null;
let appsReadAt = 0;
let recentCache: RecentFile[] = [];
let recentReadAt = 0;
const APPS_MAX_AGE = 10 * 60_000;
const RECENT_MAX_AGE = 2 * 60_000;

/**
 * The launcher: one search box for apps, open windows, system and GlazeWM
 * commands, Settings pages and recent files, in the spirit of KRunner and
 * rofi. A prefix switches mode: "=" calculates and converts units, ":" finds
 * an emoji, "?" searches the web and "," searches the clipboard history.
 * Results are ranked by how well they match and by frecency (how often and
 * how recently each was chosen).
 */
export function LauncherView({ out, active }: { out: IslandOutputs; active: boolean }) {
  const closePanel = useIsland((s) => s.closePanel);
  const openPanel = useIsland((s) => s.openPanel);
  const keybindings = useKeybindings((k) => k.items);
  const showBanner = useIsland((s) => s.showBanner);
  const wm = out.glazewm;
  const [apps, setApps] = useState<StartApp[] | null>(appCache);
  const [icons, setIcons] = useState<Record<string, string>>(appIconCache);
  const [recent, setRecent] = useState<RecentFile[]>(recentCache);
  const [clips, setClips] = useState<ClipItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [armed, setArmed] = useState<string | null>(null);
  /** Ctrl and Shift held: app rows offer "Run as admin". */
  const [adminKeys, setAdminKeys] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Each time the launcher opens: clear the search and focus it. The app list
  // and recent files are read again in the background once they are older
  // than their maximum age (the kept lists show meanwhile).
  useEffect(() => {
    if (!active) return;
    setQuery('');
    setSelected(0);
    setArmed(null);
    setAdminKeys(false);
    setClips(null);
    setIcons(appIconCache());
    // GlazeWM's keybindings, for searching them; read once, then after each change on the Keybindings page.
    if (!useKeybindings.getState().items) void useKeybindings.getState().load();
    const now = Date.now();
    if (!appCache || now - appsReadAt > APPS_MAX_AGE) {
      appsReadAt = now;
      listApps()
        .then((list) => {
          appCache = list;
          setApps(list);
          setError(null);
          // Icons load after the list (the first run extracts them, a few seconds),
          // and again only when an app without an icon shows up.
          const known = appIconCache();
          loadAppIcons(list.some((a) => !(a.appId in known)))
            .then(setIcons)
            .catch((err) => console.warn('[kotilo] app icons', err));
        })
        .catch((err) => {
          appsReadAt = 0; // Try again on the next opening.
          setError(String(err));
        });
    }
    if (now - recentReadAt > RECENT_MAX_AGE) {
      recentReadAt = now;
      recentFiles()
        .then((files) => setRecent((recentCache = files)))
        .catch((err) => {
          recentReadAt = 0;
          console.warn('[kotilo] recent files', err);
        });
    }
  }, [active]);

  useKeepFocused(active, input);

  // A command waiting for its confirming Enter gives up after three seconds.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const mode = query.startsWith('=') ? 'calc' : query.startsWith(':') ? 'emoji' : query.startsWith('?') ? 'web' : query.startsWith(',') ? 'clip' : 'all';
  const text = (mode === 'all' ? query : query.slice(1)).trim();

  // The clipboard history loads when its mode is first used in this opening.
  useEffect(() => {
    if (mode !== 'clip' || clips) return;
    clipboardHistory()
      .then((h) => setClips(h.enabled ? h.items : []))
      .catch((err) => setError(String(err)));
  }, [mode, clips]);

  const windows = useMemo(() => (wm ? allWindows(wm) : []), [wm]);
  const windowIcons = useWindowIcons(active, windows.map((r) => r.win.processName));

  const done = (key: string | null, action: () => unknown) => {
    if (key) remember(key);
    closePanel();
    void Promise.resolve()
      .then(action)
      .catch((err) => console.warn('[kotilo] launcher', err));
  };

  const copy = (value: string, title: string) =>
    navigator.clipboard
      .writeText(value)
      .then(() => {
        closePanel();
        showBanner({ icon: 'check', title, sub: 'Paste with Ctrl+V' }, 1800);
      })
      .catch((err) => setError(String(err)));

  const results = useMemo<Result[]>(() => {
    const q = fold(text);

    if (mode === 'calc') {
      const conv = convert(text);
      if (conv) {
        const value = formatAmount(conv.result);
        return [{ key: 'calc', kind: 'calc', title: describe(conv), icon: { Icon: Calculator }, hint: 'Copy ↵', score: 0, run: () => void copy(value, `Copied ${value}`) }];
      }
      const sum = text ? calculate(text) : null;
      if (sum != null) {
        const value = formatResult(sum);
        return [{ key: 'calc', kind: 'calc', title: `= ${value}`, icon: { Icon: Calculator }, hint: 'Copy ↵', score: 0, run: () => void copy(value, `Copied ${value}`) }];
      }
      return [{ key: 'calc', kind: 'calc', title: 'Type a sum or a conversion, e.g. =12*7 or =10 km to mi', icon: { Icon: Calculator }, hint: '', score: 0, disabled: true, run: () => {} }];
    }

    if (mode === 'emoji') {
      const found = q ? filterMatches(EMOJI, q, (e) => [e[1], e[2].split(' ')]) : EMOJI.map((item) => ({ item, match: { score: 0, at: [] } }));
      return found
        .sort((a, b) => b.match.score - a.match.score)
        .slice(0, MAX_RESULTS)
        .map(({ item: [emoji, name], match: m }) => ({
          key: `emoji:${emoji}`,
          kind: 'emoji' as const,
          title: name,
          at: m.at,
          icon: { text: emoji, emoji: true },
          hint: 'Copy ↵',
          score: m.score,
          run: () => void copy(emoji, `Copied ${emoji}`),
        }));
    }

    if (mode === 'web') {
      return [{
        key: 'web',
        kind: 'web',
        title: text ? `Search the web for “${text}”` : 'Type what to search the web for',
        sub: 'Google, in your default browser',
        icon: { Icon: ICONS.web },
        hint: 'Search ↵',
        score: 0,
        disabled: !text,
        run: () => done(null, () => webSearch(text)),
      }];
    }

    if (mode === 'clip') {
      if (!clips) return [];
      return clips
        .filter((c) => c.kind === 'text' && c.text && (!q || fold(c.text).includes(q)))
        .slice(0, MAX_RESULTS)
        .map((c) => ({
          key: `clip:${c.id}`,
          kind: 'clip' as const,
          title: c.text!.replace(/\s+/g, ' ').trim(),
          icon: { Icon: ClipboardList },
          hint: 'Copy ↵',
          score: 0,
          run: () =>
            void copyClipItem(c.id)
              .then(() => {
                closePanel();
                showBanner({ icon: 'check', title: 'Copied from history', sub: 'Paste with Ctrl+V' }, 1800);
              })
              .catch((err) => setError(String(err))),
        }));
    }

    const appResult = (app: StartApp, score: number, at?: number[]): Result => ({
      key: `app:${app.appId}`,
      kind: 'app',
      title: app.name,
      at,
      icon: icons[app.appId] ? { img: icons[app.appId] } : { text: app.name.slice(0, 1).toUpperCase() },
      hint: 'Open ↵',
      score,
      run: () => done(`app:${app.appId}`, () => launchApp(app)),
      runAsAdmin: () =>
        done(`app:${app.appId}`, async () => {
          const result = await launchAppAsAdmin(app);
          if (result === 'unsupported') {
            showBanner({ icon: 'info', title: `${app.name} can't run as administrator`, sub: 'Store apps run without admin rights' }, 3000);
          }
        }),
    });

    // Nothing typed: the apps chosen most, then the rest in name order.
    if (!q) {
      if (!apps) return [];
      return apps
        .map((a) => ({ a, f: frecency(`app:${a.appId}`) }))
        .sort((x, y) => y.f - x.f || x.a.name.localeCompare(y.a.name))
        .slice(0, MAX_RESULTS)
        .map(({ a }) => appResult(a, 0));
    }

    const all: Result[] = [];

    const conv = convert(text);
    if (conv) {
      const value = formatAmount(conv.result);
      all.push({ key: 'calc', kind: 'calc', title: describe(conv), icon: { Icon: Calculator }, hint: 'Copy ↵', score: 1000, run: () => void copy(value, `Copied ${value}`) });
    } else if (looksLikeSum(text)) {
      // A bare sum like "(23+5)*5" is answered without the "=" prefix too.
      const sum = calculate(text);
      if (sum != null) {
        const value = formatResult(sum);
        all.push({ key: 'calc', kind: 'calc', title: `${text} = ${value}`, icon: { Icon: Calculator }, hint: 'Copy ↵', score: 1000, run: () => void copy(value, `Copied ${value}`) });
      }
    }

    for (const app of apps ?? []) {
      const m = match(app.name, q);
      if (m) all.push(appResult(app, m.score + frecencyBonus(`app:${app.appId}`), m.at));
    }

    for (const { item: row, match: m } of matchWindows(windows, q)) {
      all.push({
        key: `window:${row.win.id}`,
        kind: 'window',
        title: row.win.processName || row.win.title,
        at: m.at,
        sub: `${row.win.title} · workspace ${row.workspace.displayName || row.workspace.name}`,
        icon: windowIcon(windowIcons, row.win.processName) ? { img: windowIcon(windowIcons, row.win.processName) } : { Icon: ICONS.window },
        hint: 'Go ↵',
        // Switching to an open window beats starting its app again, even an app
        // chosen often (frecency adds at most 25), when the program name matched;
        // a match only in the window title (a browser tab, say) gets no lift.
        score: m.score + (m.at.length ? 30 : 0),
        run: () => done(null, () => wm && focusWindow(wm, row)),
      });
    }

    for (const { item: cmd, match: m } of filterMatches(SYSTEM_COMMANDS, q, (c) => [c.title, c.keywords])) {
      const key = `system:${cmd.action}`;
      all.push({
        key,
        kind: 'system',
        title: cmd.title,
        at: m.at,
        sub: cmd.confirm ? 'Closes your apps' : undefined,
        icon: { Icon: cmd.icon },
        hint: 'Run ↵',
        score: m.score + frecencyBonus(key),
        confirm: cmd.confirm,
        run: () => done(key, () => runPower(cmd.action)),
      });
    }

    if (wm) {
      const focused = wm.focusedContainer?.type === 'window' ? wm.focusedContainer : null;
      const commands = wmCommands(wm).filter((c) => !c.onWindow || focused);
      for (const { item: cmd, match: m } of filterMatches(commands, q, (c) => [c.title, c.keywords])) {
        const key = `wm:${cmd.key}`;
        all.push({
          key,
          kind: 'wm',
          title: cmd.title,
          at: m.at,
          sub: cmd.onWindow && focused ? focused.processName || focused.title : 'GlazeWM',
          icon: { Icon: cmd.icon },
          hint: 'Run ↵',
          score: m.score + frecencyBonus(key),
          run: () =>
            done(key, async () => {
              if (!cmd.onWindow || !focused) return wm.runCommand(cmd.command);
              await wm.runCommand(cmd.command, focused.id);
              // Give the keyboard back to the window, unless it went away or moved off screen.
              if (!['close', 'minimize'].includes(cmd.key) && !cmd.key.startsWith('move-')) {
                await wm.runCommand(`focus --container-id ${focused.id}`);
              }
            }),
        });
      }
    }

    for (const { item: page, match: m } of matchSettings(q)) {
      const key = `setting:${page.page}`;
      all.push({
        key,
        kind: 'setting',
        title: page.title,
        at: m.at,
        sub: 'Windows Settings',
        icon: { Icon: ICONS.setting },
        hint: 'Open ↵',
        score: m.score + frecencyBonus(key),
        run: () => done(key, () => openSettingsPage(page.page)),
      });
    }

    if (q.length >= 2) {
      // The Keybindings page itself, then the keybindings, which open that page filtered to the one chosen.
      for (const { match: m } of filterMatches([0], q, () => ['Keybindings', ['shortcuts', 'hotkeys', 'keyboard shortcuts', 'glazewm keys']])) {
        all.push({
          key: 'kotilo:keybindings',
          kind: 'setting',
          title: 'Keybindings',
          at: m.at,
          sub: 'Kotilo settings',
          icon: { Icon: ICONS.keybinding },
          hint: 'Open ↵',
          score: m.score,
          run: () => {
            useKeybindings.getState().setFilter('');
            openPanel('keybindings');
          },
        });
      }
      for (const { match: m } of filterMatches([0], q, () => ['Window manager', ['glazewm settings', 'gaps', 'window effects', 'window rules', 'workspaces config']])) {
        all.push({
          key: 'kotilo:wm-settings',
          kind: 'setting',
          title: 'Window manager',
          at: m.at,
          sub: 'Kotilo settings · GlazeWM',
          icon: { Icon: ICONS.setting },
          hint: 'Open ↵',
          score: m.score,
          run: () => openPanel('wm-settings'),
        });
      }
      for (const { item: k, match: m } of matchKeybindings(keybindings ?? [], q)) {
        all.push({
          key: `keybinding:${k.line}`,
          kind: 'keybinding',
          title: k.label,
          at: m.at,
          sub: `${k.bindings.map(formatCombo).join(' · ')} · ${k.owner === 'kotilo' ? 'Kotilo' : 'GlazeWM'} shortcut`,
          icon: { Icon: ICONS.keybinding },
          hint: 'Edit ↵',
          score: m.score - 5,
          run: () => {
            useKeybindings.getState().setFilter(k.label);
            openPanel('keybindings');
          },
        });
      }
      for (const { item: file, match: m } of matchRecentFiles(recent, q)) {
        all.push({
          key: `file:${file.lnk}`,
          kind: 'file',
          title: file.name,
          at: m.at,
          sub: parentFolder(file.target),
          icon: { Icon: fileIcon(file) },
          hint: 'Open ↵',
          score: m.score,
          run: () => done(null, () => openRecentFile(file)),
        });
      }
    }

    all.sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title));
    const top = all.slice(0, text.length >= 2 ? MAX_RESULTS - 1 : MAX_RESULTS);

    // The web is always the last way out.
    if (text.length >= 2) {
      top.push({
        key: 'web',
        kind: 'web',
        title: `Search the web for “${text}”`,
        icon: { Icon: ICONS.web },
        hint: 'Search ↵',
        score: -1,
        run: () => done(null, () => webSearch(text)),
      });
    }
    return top;
  }, [mode, text, apps, icons, windows, windowIcons, recent, clips, wm, keybindings]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = Math.min(selected, results.length - 1);

  const choose = (result: Result | undefined, asAdmin = false) => {
    if (!result || result.disabled) return;
    if (asAdmin && result.runAsAdmin) return result.runAsAdmin();
    if (result.confirm && armed !== result.key) return setArmed(result.key);
    setArmed(null);
    result.run();
  };

  const loading = mode === 'all' && !text && !apps && !error;
  const empty = !loading && results.length === 0;

  return (
    <div className="view-panel launcher">
      <PanelHeader title="Apps" back />
      <label className="search">
        <Search size={15} className="accent" />
        <input
          ref={input}
          value={query}
          placeholder="Apps, windows, commands · : emoji · ? web · , clipboard · = calculate"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
            setArmed(null);
          }}
          onKeyDown={(e) => {
            setAdminKeys(e.ctrlKey && e.shiftKey);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected(Math.min(current + 1, results.length - 1));
              setArmed(null);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected(Math.max(current - 1, 0));
              setArmed(null);
            } else if (e.key === 'Enter') {
              choose(results[current], e.ctrlKey && e.shiftKey);
            }
          }}
          onKeyUp={(e) => setAdminKeys(e.ctrlKey && e.shiftKey)}
          onBlur={() => setAdminKeys(false)}
        />
        {apps && mode === 'all' && !text && <span className="search-count">{apps.length}</span>}
      </label>
      <div className="results">
        {loading && <span className="muted-text">Loading apps…</span>}
        {empty && <span className="muted-text">{mode === 'clip' && !clips ? 'Loading clipboard…' : 'Nothing found'}</span>}
        {results.map((r, i) => {
          const isArmed = armed === r.key;
          return (
            <button
              key={r.key}
              className={`result ${i === current ? 'selected' : ''} ${isArmed ? 'armed' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={(e) => choose(r, e.ctrlKey && e.shiftKey)}
              disabled={r.disabled}            >
              <ResultIcon icon={r.icon} />
              <span className="result-text">
                <span className="ellipsis">{highlight(r.title, r.at)}</span>
                {r.sub && <span className="result-sub ellipsis">{r.sub}</span>}
              </span>
              {(i === current || isArmed) && r.hint && (
                <span className="result-hint">
                  {isArmed ? 'Press again' : adminKeys && r.runAsAdmin ? 'Run as admin ↵' : r.hint}
                  {/* The Start menu's shortcut, shown where it applies so it can be found. */}
                  {!isArmed && !adminKeys && r.runAsAdmin && <span className="result-hint-alt">Admin Ctrl+Shift+↵</span>}
                </span>
              )}
            </button>
          );
        })}
        {error && <p className="panel-error ellipsis">{error}</p>}
      </div>
    </div>
  );
}

/**
 * Only digits, operators and parentheses, with at least one digit and one
 * operator, so a plain number or an app name never turns into a sum.
 */
const looksLikeSum = (text: string) => /^[\d\s.,+\-*/%^()x×÷]+$/.test(text) && /\d/.test(text) && /[+\-*/%^x×÷]/.test(text);

function ResultIcon({ icon }: { icon: Result['icon'] }) {
  if (icon.img) return <img className="result-icon" src={icon.img} alt="" />;
  if (icon.Icon) {
    const Icon = icon.Icon;
    return (
      <span className="result-avatar">
        <Icon size={15} />
      </span>
    );
  }
  return <span className={`result-avatar ${icon.emoji ? 'emoji' : ''}`}>{icon.text}</span>;
}

/** The title with its matched letters marked; consecutive letters share one mark. */
function highlight(title: string, at: number[] | undefined): ReactNode {
  if (!at?.length) return title;
  const marked = new Set(at);
  const parts: ReactNode[] = [];
  let i = 0;
  while (i < title.length) {
    const on = marked.has(i);
    let j = i;
    while (j < title.length && marked.has(j) === on) j++;
    parts.push(on ? <mark key={i}>{title.slice(i, j)}</mark> : title.slice(i, j));
    i = j;
  }
  return <>{parts}</>;
}
