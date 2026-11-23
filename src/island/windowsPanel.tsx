import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, Search, X } from 'lucide-react';
import type { IslandOutputs } from './providers';
import { PanelHeader } from './components';
import { useKeepFocused } from './panels';
import { useIsland } from './store';
import {
  allWindows,
  closeWindow as closeWmWindow,
  focusWindow,
  useWindowIcons,
  windowIcon,
  workspaceLabel,
  type WindowRow as Row,
} from './wmWindows';

/**
 * Every window GlazeWM manages, grouped by workspace (on all monitors). Typing
 * filters by app or title; a click or Enter switches to the window's workspace
 * and focuses it. The X on a row (or Delete) closes that window; "Close all"
 * closes every listed window after a second click to confirm. Closing asks the
 * app to close, as its own X button would, so an app can still ask to save.
 */
export function WindowsView({ out, active }: { out: IslandOutputs; active: boolean }) {
  const closePanel = useIsland((s) => s.closePanel);
  const wm = out.glazewm;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [armedCloseAll, setArmedCloseAll] = useState(false);
  // Windows closed from this list. Zebar's GlazeWM data does not always update
  // when a window closes (only when focus also changes), so they are left out here.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const selectedRow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    setQuery('');
    setSelected(0);
    setArmedCloseAll(false);
    setClosed(new Set());
  }, [active]);

  // "Close all" waits 3 s for the confirming click, then disarms.
  useEffect(() => {
    if (!armedCloseAll) return;
    const t = setTimeout(() => setArmedCloseAll(false), 3000);
    return () => clearTimeout(t);
  }, [armedCloseAll]);

  useKeepFocused(active, input);

  const rows = useMemo<Row[]>(() => {
    if (!wm) return [];
    const q = query.trim().toLowerCase();
    return allWindows(wm)
      .filter(({ win }) => !closed.has(win.id))
      .filter(({ win }) => !q || `${win.processName} ${win.title}`.toLowerCase().includes(q));
  }, [wm, query, closed]);

  const icons = useWindowIcons(active, rows.map((r) => r.win.processName));

  // Closed windows drop out of the list; keep the selection on a row that exists.
  const current = Math.min(selected, rows.length - 1);

  // A block body on purpose: WebView2 returns a Promise from scrollIntoView, and
  // an effect that returns it makes React call it as a cleanup, which crashes the island.
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const focus = (row: Row | undefined) => {
    if (!row || !wm) return;
    closePanel();
    focusWindow(wm, row);
  };

  const closeWindow = (row: Row | undefined) => {
    if (!row || !wm) return;
    // GlazeWM focuses another window once this one closes; keep the list open.
    useIsland.setState({ keepOpenUntil: Date.now() + 1500 });
    setClosed((prev) => new Set(prev).add(row.win.id));
    closeWmWindow(wm, row.win.id);
  };

  // Closes the listed windows: all of them, or only the matches while searching.
  const closeAll = () => {
    if (!armedCloseAll) return setArmedCloseAll(true);
    setArmedCloseAll(false);
    rows.forEach(closeWindow);
  };

  const searching = query.trim() !== '';

  return (
    <div className="view-panel windows">
      <PanelHeader title="Windows" back />
      <div className="clip-toolbar">
        <label className="search">
          <Search size={15} className="accent" />
          <input
            ref={input}
            value={query}
            placeholder="Search windows"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected(Math.min(current + 1, rows.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected(Math.max(current - 1, 0));
              } else if (e.key === 'Enter') {
                focus(rows[current]);
              } else if (e.key === 'Delete' && rows[current]) {
                e.preventDefault();
                closeWindow(rows[current]);
              }
            }}
          />
          {wm && <span className="search-count">{rows.length}</span>}
        </label>
        <button
          className={`chip-button ${armedCloseAll ? 'danger' : ''}`}
          onClick={closeAll}
          disabled={rows.length === 0}
          title={searching ? 'Close the windows that match the search' : 'Close every window'}
        >
          <X size={13} /> {armedCloseAll ? 'Click again' : searching ? 'Close these' : 'Close all'}
        </button>
      </div>
      <div className="results panel-scroll">
        {!wm && <span className="muted-text">GlazeWM is not running</span>}
        {wm && rows.length === 0 && <span className="muted-text">{searching ? 'Nothing found' : 'No windows open'}</span>}
        {rows.map((row, i) => {
          const first = i === 0 || rows[i - 1].workspace.id !== row.workspace.id;
          return (
            <div key={row.win.id} className="window-row">
              {first && (
                <h3 className="section-title window-group">
                  Workspace {workspaceLabel(row.workspace)}
                  {row.workspace.hasFocus && ' · current'}
                </h3>
              )}
              <div
                ref={i === current ? selectedRow : undefined}
                role="button"
                className={`result window-item ${i === current ? 'selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => focus(row)}
                title={row.win.title}
              >
                {windowIcon(icons, row.win.processName) ? (
                  <img className="result-icon" src={windowIcon(icons, row.win.processName)} alt="" />
                ) : (
                  <span className="result-avatar">
                    <AppWindow size={15} />
                  </span>
                )}
                <span className="window-text">
                  <span className="ellipsis">{row.win.processName || row.win.title}</span>
                  {row.win.title && row.win.processName && <span className="window-title ellipsis">{row.win.title}</span>}
                </span>
                {i === current && <span className="result-hint">Go ↵</span>}
                <button
                  className="window-close"
                  aria-label={`Close ${row.win.processName || 'window'}`}
                  title="Close window (Delete)"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeWindow(row);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
