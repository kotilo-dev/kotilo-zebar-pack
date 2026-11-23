import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, Search } from 'lucide-react';
import type { IslandOutputs } from './providers';
import { PanelHeader } from './components';
import { useKeepFocused } from './panels';
import { useIsland } from './store';

type Workspace = NonNullable<IslandOutputs['glazewm']>['allWorkspaces'][number];
type Node = Workspace['children'][number];
type WindowNode = Extract<Node, { type: 'window' }>;

type Row = { win: WindowNode; workspace: Workspace };

/** Windows of a workspace, depth first, so they follow the order on screen. */
function windowsOf(children: Node[]): WindowNode[] {
  return children.flatMap((c) => (c.type === 'window' ? [c] : windowsOf(c.children)));
}

const workspaceLabel = (ws: Workspace) => ws.displayName || ws.name;

/**
 * Every window GlazeWM manages, grouped by workspace (on all monitors). Typing
 * filters by app or title; a click or Enter switches to the window's workspace
 * and focuses it.
 */
export function WindowsView({ out, active }: { out: IslandOutputs; active: boolean }) {
  const closePanel = useIsland((s) => s.closePanel);
  const wm = out.glazewm;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const selectedRow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!active) return;
    setQuery('');
    setSelected(0);
  }, [active]);

  useKeepFocused(active, input);

  const rows = useMemo<Row[]>(() => {
    if (!wm) return [];
    const q = query.trim().toLowerCase();
    return [...wm.allWorkspaces]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .flatMap((workspace) => windowsOf(workspace.children).map((win) => ({ win, workspace })))
      .filter(({ win }) => !q || `${win.processName} ${win.title}`.toLowerCase().includes(q));
  }, [wm, query]);

  // A block body on purpose: WebView2 returns a Promise from scrollIntoView, and
  // an effect that returns it makes React call it as a cleanup, which crashes the island.
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const focus = (row: Row | undefined) => {
    if (!row || !wm) return;
    closePanel();
    // `focus --container-id` alone moves GlazeWM's focus but can leave the
    // window's workspace hidden (seen when the island holds the foreground), so
    // the workspace is shown first, the way the bar's workspace buttons do it.
    void wm
      .runCommand(`focus --workspace ${row.workspace.name}`)
      .then(() => wm.runCommand(`focus --container-id ${row.win.id}`))
      .catch((err) => console.warn('[kotilo] focus window', err));
  };

  return (
    <div className="view-panel windows">
      <PanelHeader title="Windows" back />
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
              setSelected((i) => Math.min(i + 1, rows.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              focus(rows[selected]);
            }
          }}
        />
        {wm && <span className="search-count">{rows.length}</span>}
      </label>
      <div className="results panel-scroll">
        {!wm && <span className="muted-text">GlazeWM is not running</span>}
        {wm && rows.length === 0 && <span className="muted-text">{query.trim() ? 'Nothing found' : 'No windows open'}</span>}
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
              <button
                ref={i === selected ? selectedRow : undefined}
                className={`result ${i === selected ? 'selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => focus(row)}
                title={row.win.title}
              >
                <span className="result-avatar">
                  <AppWindow size={15} />
                </span>
                <span className="window-text">
                  <span className="ellipsis">{row.win.processName || row.win.title}</span>
                  {row.win.title && row.win.processName && <span className="window-title ellipsis">{row.win.title}</span>}
                </span>
                {i === selected && <span className="result-hint">Go ↵</span>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
