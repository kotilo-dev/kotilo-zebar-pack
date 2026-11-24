import { create } from 'zustand';
import { listKeybindings, setKeybinding, type WmKeybinding } from './system';
import type { PanelId } from './store';

/**
 * GlazeWM's keybindings as the Settings page and the launcher show them. All of
 * them live in GlazeWM's config: Kotilo's own open an island panel through a
 * binding mode named `island-<panel>` (see `useShortcuts` in Island.tsx), the
 * rest are GlazeWM's.
 */

export type Keybinding = WmKeybinding & {
  /** What the keys do, in plain words. */
  label: string;
  /** Kotilo's shortcuts (an island panel) or GlazeWM's. */
  owner: 'kotilo' | 'glazewm';
};

const PANEL_NAMES: Partial<Record<PanelId, string>> = {
  control: 'Control center',
  launcher: 'Launcher',
  power: 'Power menu',
  timer: 'Timer',
  clipboard: 'Clipboard history',
  windows: 'Window list',
  notifications: 'Notifications',
  settings: 'Settings',
  calendar: 'Calendar',
  weather: 'Weather',
  todo: 'To-do',
  notes: 'Notes',
  rss: 'News',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A plain description of one GlazeWM command; the command itself when it is not a known one. */
function describe(command: string): string {
  const c = command.trim();
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^wm-enable-binding-mode --name island-(\S+)$/))) return `Open ${PANEL_NAMES[m[1] as PanelId] ?? m[1]}`;
  if ((m = c.match(/^focus --direction (\w+)$/))) return `Focus ${m[1]}`;
  if ((m = c.match(/^move --direction (\w+)$/))) return `Move window ${m[1]}`;
  if ((m = c.match(/^move-workspace --direction (\w+)$/))) return `Move workspace ${m[1]}`;
  if ((m = c.match(/^resize --(width|height) ([+-])/))) return `${m[2] === '+' ? 'Grow' : 'Shrink'} ${m[1]}`;
  if ((m = c.match(/^wm-enable-binding-mode --name (\S+)$/))) return `${cap(m[1])} mode`;
  if ((m = c.match(/^focus --workspace (\S+)$/))) return `Workspace ${m[1]}`;
  if ((m = c.match(/^move --workspace (\S+)$/))) return `Move window to workspace ${m[1]}`;
  if ((m = c.match(/^shell-exec (.+)$/))) return `Run ${m[1]}`;
  const fixed: Record<string, string> = {
    'wm-toggle-pause': 'Pause GlazeWM',
    'toggle-tiling-direction': 'Flip tiling direction',
    'wm-cycle-focus': 'Switch focus between tiling and floating',
    'toggle-floating --centered': 'Toggle floating',
    'toggle-floating': 'Toggle floating',
    'toggle-tiling': 'Toggle tiling',
    'toggle-fullscreen': 'Toggle fullscreen',
    'toggle-minimized': 'Minimize window',
    close: 'Close window',
    'wm-exit': 'Exit GlazeWM',
    'wm-reload-config': 'Reload GlazeWM config',
    'wm-redraw': 'Redraw windows',
    'focus --next-active-workspace': 'Next workspace',
    'focus --prev-active-workspace': 'Previous workspace',
    'focus --recent-workspace': 'Last used workspace',
    'focus --next-workspace': 'Next workspace',
    'focus --prev-workspace': 'Previous workspace',
  };
  return fixed[c] ?? c;
}

/** The label of a keybinding: "move to workspace 2 and follow" reads better than two commands. */
function labelFor(commands: string[]): string {
  const [first, second] = commands;
  const ws = first?.match(/^move --workspace (\S+)$/);
  if (ws && second === `focus --workspace ${ws[1]}` && commands.length === 2) return `Move window to workspace ${ws[1]} and follow`;
  return commands.map(describe).join(', then ') || '(no command)';
}

const toKeybinding = (k: WmKeybinding): Keybinding => ({
  ...k,
  label: labelFor(k.commands),
  owner: k.commands.some((c) => /^wm-enable-binding-mode --name island-/.test(c)) ? 'kotilo' : 'glazewm',
});

/** "alt+shift+v" -> "Alt+Shift+V". */
export function formatCombo(combo: string): string {
  const names: Record<string, string> = {
    lwin: 'Win', rwin: 'Win', ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', space: 'Space', enter: 'Enter',
    escape: 'Esc', back: 'Backspace', tab: 'Tab', left: '←', right: '→', up: '↑', down: '↓', delete: 'Del',
  };
  return combo
    .split('+')
    .map((k) => names[k] ?? (k.length === 1 ? k.toUpperCase() : cap(k.replace(/_/g, ' '))))
    .join('+');
}

/** Modifier keys; a combination needs at least one (or a function key), so typing is never taken over. */
const MODIFIERS = ['ctrl', 'alt', 'shift', 'lwin'] as const;

const CODE_NAMES: Record<string, string> = {
  Space: 'space', Enter: 'enter', Tab: 'tab', Backspace: 'back', Delete: 'delete', Insert: 'insert', Home: 'home',
  End: 'end', PageUp: 'page_up', PageDown: 'page_down', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up',
  ArrowDown: 'down', Minus: 'oem_minus', Equal: 'oem_plus', Comma: 'oem_comma', Period: 'oem_period',
  Semicolon: 'oem_semicolon', Slash: 'oem_question', Backquote: 'oem_tilde', BracketLeft: 'oem_open_brackets',
  BracketRight: 'oem_close_brackets', Backslash: 'oem_pipe', Quote: 'oem_quotes', PrintScreen: 'print_screen',
};

/**
 * The GlazeWM name of a key press, such as "alt+shift+v"; null while only
 * modifiers are held or for a key without a GlazeWM name. Uses the physical key
 * (`code`), so the keyboard layout does not change the name.
 */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = `numpad${code.slice(6)}`;
  else if (/^F\d{1,2}$/.test(code)) key = code.toLowerCase();
  else key = CODE_NAMES[code] ?? null;
  if (!key) return null;
  const mods = MODIFIERS.filter((m) => (m === 'ctrl' ? e.ctrlKey : m === 'alt' ? e.altKey : m === 'shift' ? e.shiftKey : e.metaKey));
  return [...mods, key].join('+');
}

/** Whether a combination is safe to bind globally: a modifier plus a key, or a function key. */
export const usableCombo = (combo: string) => {
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  return parts.length > 1 || /^f\d{1,2}$/.test(key);
};

type State = {
  items: Keybinding[] | null;
  error: string | null;
  loading: boolean;
  /** Text the Keybindings page filters by (the launcher sets it when it opens the page). */
  filter: string;
  load: () => Promise<void>;
  setFilter: (text: string) => void;
  /**
   * Writes new combinations for one keybinding and has GlazeWM reload its
   * config. `reload` is the GlazeWM provider's command runner.
   */
  save: (k: Keybinding, bindings: string[], reload: () => Promise<unknown>) => Promise<void>;
};

let loadPromise: Promise<void> | null = null;

export const useKeybindings = create<State>((set, get) => ({
  items: null,
  error: null,
  loading: false,
  filter: '',
  load: () => {
    loadPromise ??= (async () => {
      set({ loading: true });
      try {
        set({ items: (await listKeybindings()).map(toKeybinding), error: null });
      } catch (err) {
        set({ error: String(err) });
      } finally {
        set({ loading: false });
        loadPromise = null;
      }
    })();
    return loadPromise;
  },
  setFilter: (filter) => set({ filter }),
  save: async (k, bindings, reload) => {
    await setKeybinding(k, bindings);
    await reload();
    await get().load();
  },
}));
