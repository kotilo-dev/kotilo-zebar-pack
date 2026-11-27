import { create } from 'zustand';
import { STORED, writeStored } from '../shared/stored';
import type { WmGaps } from '../shared/barStyle';
import { glazeGaps, glazeSettings, setGlazeSetting, type GlazeConfig, type GlazeValue } from './system';

/**
 * GlazeWM's settings other than its keybindings, as Settings › Window manager
 * shows them. The values come from GlazeWM's config through appearance.ps1,
 * which only writes the paths listed there ($GlazeSettings); this catalogue
 * gives them names and the controls they get.
 */

export type SettingKind =
  | { type: 'bool' }
  | { type: 'px' }
  | { type: 'pct' }
  | { type: 'choice'; options: { value: string; label: string }[] };

export type Setting = {
  path: string;
  label: string;
  hint?: string;
  kind: SettingKind;
  /** Greyed out unless this bool setting is on (or, with `when`, has that value). */
  needs?: { path: string; when?: GlazeValue };
};

const bool: SettingKind = { type: 'bool' };
const px: SettingKind = { type: 'px' };
const pct: SettingKind = { type: 'pct' };
const choice = (...options: [string, string][]): SettingKind => ({
  type: 'choice',
  options: options.map(([value, label]) => ({ value, label })),
});

export const GENERAL: Setting[] = [
  { path: 'general.focus_follows_cursor', label: 'Focus follows cursor', hint: 'Focus the window under the mouse', kind: bool },
  {
    path: 'general.toggle_workspace_on_refocus',
    label: 'Toggle workspace on refocus',
    hint: 'Focusing the current workspace goes back to the previous one',
    kind: bool,
  },
  { path: 'general.cursor_jump.enabled', label: 'Cursor jump', hint: 'Move the mouse along with the focus', kind: bool },
  {
    path: 'general.cursor_jump.trigger',
    label: 'Jump when focus changes',
    kind: choice(['monitor_focus', 'Monitor'], ['window_focus', 'Window']),
    needs: { path: 'general.cursor_jump.enabled' },
  },
  {
    path: 'general.hide_method',
    label: 'Hide windows by',
    hint: 'Cloak has no animation; Hide is the older method',
    kind: choice(['cloak', 'Cloak'], ['hide', 'Hide']),
  },
  {
    path: 'general.show_all_in_taskbar',
    label: 'Show all windows in the taskbar',
    hint: 'Also windows on hidden workspaces (only with Cloak)',
    kind: bool,
    needs: { path: 'general.hide_method', when: 'cloak' },
  },
];

export const GAPS: Setting[] = [
  { path: 'gaps.scale_with_dpi', label: 'Scale with DPI', hint: "Grow the gaps with the monitor's scaling", kind: bool },
  { path: 'gaps.inner_gap', label: 'Between windows', kind: px },
];

/** The four sides of the outer gap, shown in one row. */
export const OUTER_GAP = (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
  path: `gaps.outer_gap.${side}`,
  label: side.charAt(0).toUpperCase() + side.slice(1),
}));

/** Effects of the focused window or of the other windows. */
export const effects = (section: 'focused_window' | 'other_windows'): Setting[] => {
  const p = `window_effects.${section}`;
  return [
    { path: `${p}.border.enabled`, label: 'Border', kind: bool },
    { path: `${p}.hide_title_bar.enabled`, label: 'Hide title bar', kind: bool },
    { path: `${p}.corner_style.enabled`, label: 'Corner style', hint: 'Windows 11 only', kind: bool },
    {
      path: `${p}.corner_style.style`,
      label: 'Corners',
      kind: choice(['square', 'Square'], ['rounded', 'Rounded'], ['small_rounded', 'Small']),
      needs: { path: `${p}.corner_style.enabled` },
    },
    { path: `${p}.transparency.enabled`, label: 'Transparency', kind: bool },
    {
      path: `${p}.transparency.opacity`,
      label: 'Opacity',
      hint: '0% is fully transparent and cannot be focused',
      kind: pct,
      needs: { path: `${p}.transparency.enabled` },
    },
  ];
};

export const BEHAVIOR: Setting[] = [
  { path: 'window_behavior.initial_state', label: 'New windows open', kind: choice(['tiling', 'Tiling'], ['floating', 'Floating']) },
  { path: 'window_behavior.state_defaults.floating.centered', label: 'Center floating windows', kind: bool },
  { path: 'window_behavior.state_defaults.floating.shown_on_top', label: 'Floating windows always on top', kind: bool },
  {
    path: 'window_behavior.state_defaults.fullscreen.maximized',
    label: 'Fullscreen maximizes',
    hint: 'Maximize instead of covering the whole screen, when the window allows it',
    kind: bool,
  },
  { path: 'window_behavior.state_defaults.fullscreen.shown_on_top', label: 'Fullscreen windows always on top', kind: bool },
];

/** The range a number setting accepts (the helper checks the same). */
export const numberRange = (kind: SettingKind) => (kind.type === 'pct' ? { max: 100, unit: '%' } : { max: 200, unit: 'px' });

type State = {
  config: GlazeConfig | null;
  error: string | null;
  load: () => Promise<void>;
  /**
   * Writes one setting and has GlazeWM reload its config. `reload` is the
   * GlazeWM provider's command runner. The page shows the new value at once and
   * goes back to the file's value if the write fails.
   */
  save: (path: string, value: boolean | number | string, reload: () => Promise<unknown>) => Promise<void>;
};

let loadPromise: Promise<void> | null = null;

export const useGlazeSettings = create<State>((set, get) => ({
  config: null,
  error: null,
  load: () => {
    loadPromise ??= (async () => {
      try {
        set({ config: await glazeSettings(), error: null });
      } catch (err) {
        set({ error: String(err) });
      } finally {
        loadPromise = null;
      }
    })();
    return loadPromise;
  },
  save: async (path, value, reload) => {
    const config = get().config;
    if (config) set({ config: { ...config, values: { ...config.values, [path]: value } } });
    try {
      if (await setGlazeSetting(path, value)) await reload();
      // The floating bar lines up with GlazeWM's outer gap; give it the new one.
      if (path.startsWith('gaps.')) {
        const g = await glazeGaps();
        writeStored(STORED.wmGaps, { left: g.left, right: g.right, scaleWithDpi: g.scaleWithDpi } satisfies WmGaps);
      }
    } finally {
      await get().load();
    }
  },
}));
