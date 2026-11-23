import { useEffect, useState } from 'react';
import type { IslandOutputs } from './providers';
import { windowIcons } from './system';

/** GlazeWM's windows as the island's window list and launcher use them. */

export type WmOutput = NonNullable<IslandOutputs['glazewm']>;
export type Workspace = WmOutput['allWorkspaces'][number];
type Node = Workspace['children'][number];
export type WindowNode = Extract<Node, { type: 'window' }>;

export type WindowRow = { win: WindowNode; workspace: Workspace };

/** Windows of a workspace, depth first, so they follow the order on screen. */
function windowsOf(children: Node[]): WindowNode[] {
  return children.flatMap((c) => (c.type === 'window' ? [c] : windowsOf(c.children)));
}

export const workspaceLabel = (ws: Workspace) => ws.displayName || ws.name;

/** Workspaces in name order ("2" before "10"). */
export const sortedWorkspaces = (wm: WmOutput) =>
  [...wm.allWorkspaces].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

/** Every managed window on every monitor, grouped by workspace in name order. */
export const allWindows = (wm: WmOutput): WindowRow[] =>
  sortedWorkspaces(wm).flatMap((workspace) => windowsOf(workspace.children).map((win) => ({ win, workspace })));

/**
 * Shows the window's workspace, then focuses the window. `focus --container-id`
 * alone moves GlazeWM's focus but can leave the workspace hidden (seen when the
 * island holds the foreground), so the workspace goes first, the way the bar's
 * workspace buttons switch.
 */
export function focusWindow(wm: WmOutput, row: WindowRow) {
  void wm
    .runCommand(`focus --workspace ${row.workspace.name}`)
    .then(() => wm.runCommand(`focus --container-id ${row.win.id}`))
    .catch((err) => console.warn('[kotilo] focus window', err));
}

/** Asks the window to close, as its own X button would (an app can still ask to save). */
export function closeWindow(wm: WmOutput, id: string) {
  void wm.runCommand('close', id).catch((err) => console.warn('[kotilo] close window', err));
}

/* ---- Program icons for windows ------------------------------------------------- */

let iconCache: Record<string, string> = {};
let iconLoad: Promise<void> | null = null;

/**
 * Icons for the given process names, from scripts/window-icons.ps1. The script
 * runs again only when a name has no entry yet (a program without a readable
 * icon keeps an empty one, so it does not trigger a run every time).
 */
export function useWindowIcons(active: boolean, processNames: string[]): Record<string, string> {
  const [icons, setIcons] = useState(iconCache);
  const missing = processNames.some((n) => !(n.toLowerCase() in iconCache));
  useEffect(() => {
    if (!active || !missing) return;
    iconLoad ??= windowIcons()
      .then((found) => {
        iconCache = { ...iconCache, ...found };
        // Names the script did not report (no main window) count as "no icon".
        for (const n of processNames) if (!(n.toLowerCase() in iconCache)) iconCache[n.toLowerCase()] = '';
      })
      .catch((err) => console.warn('[kotilo] window icons', err))
      .finally(() => (iconLoad = null));
    void iconLoad.then(() => setIcons(iconCache));
  }, [active, missing]); // eslint-disable-line react-hooks/exhaustive-deps
  return icons;
}

export const windowIcon = (icons: Record<string, string>, processName: string) =>
  icons[processName.toLowerCase()] || undefined;
