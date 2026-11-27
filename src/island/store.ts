import { create } from 'zustand';

/** Panels the island can grow into. Only one is open at a time. */
export type PanelId =
  | 'control'
  | 'power'
  | 'timer'
  | 'launcher'
  | 'clipboard'
  | 'tray'
  | 'audio'
  | 'wifi'
  | 'sysmon'
  | 'calendar'
  | 'bluetooth'
  | 'appearance'
  | 'about'
  | 'todo'
  | 'notes'
  | 'settings'
  | 'notifications'
  | 'windows'
  | 'weather'
  | 'bar-settings'
  | 'notify-settings'
  | 'keybindings'
  | 'wm-settings'
  | 'rss'
  | 'files';

export const PANELS: readonly PanelId[] = [
  'control',
  'power',
  'timer',
  'launcher',
  'clipboard',
  'tray',
  'audio',
  'wifi',
  'sysmon',
  'calendar',
  'bluetooth',
  'appearance',
  'about',
  'todo',
  'notes',
  'settings',
  'notifications',
  'windows',
  'weather',
  'bar-settings',
  'notify-settings',
  'keybindings',
  'wm-settings',
  'rss',
  'files',
];

/** Short-lived indicators shown when something changes. */
export type OsdKind = 'volume' | 'keyboard' | 'media';

export type Banner = {
  icon: 'check' | 'alert' | 'info' | 'bell';
  title: string;
  sub?: string;
  /** 0..1, or undefined for no progress bar. */
  progress?: number;
  /** An image (data URL) shown instead of the icon, such as the app icon of a notification. */
  image?: string;
  /** The panel a click on the banner opens; otherwise a click opens the control centre. */
  panel?: PanelId;
};

type IslandState = {
  panel: PanelId | null;
  /** When a panel last closed (ms), so a click that arrives right after it does not reopen one. */
  closedAt: number;
  /**
   * Until when (ms) losing focus does not close the panel. Closing a window from
   * the window list makes GlazeWM focus another window; the panel stays open
   * and takes focus back, so several windows can be closed in a row.
   */
  keepOpenUntil: number;
  osd: OsdKind | null;
  banner: Banner | null;
  openPanel: (panel: PanelId) => void;
  togglePanel: (panel: PanelId) => void;
  closePanel: () => void;
  showOsd: (kind: OsdKind) => void;
  showBanner: (banner: Banner, ms?: number) => void;
  dismissBanner: () => void;
};

const OSD_MS: Record<OsdKind, number> = { volume: 1600, keyboard: 1600, media: 2600 };

let osdTimer: ReturnType<typeof setTimeout> | undefined;
let bannerTimer: ReturnType<typeof setTimeout> | undefined;

export const useIsland = create<IslandState>((set, get) => ({
  panel: null,
  closedAt: 0,
  keepOpenUntil: 0,
  osd: null,
  banner: null,

  openPanel: (panel) => set({ panel, osd: null }),
  togglePanel: (panel) =>
    get().panel === panel ? set({ panel: null, closedAt: Date.now() }) : set({ panel, osd: null }),
  closePanel: () => get().panel && set({ panel: null, closedAt: Date.now() }),

  showOsd: (kind) => {
    // An open panel already shows what changed; an OSD on top would only flicker.
    if (get().panel) return;
    clearTimeout(osdTimer);
    set({ osd: kind });
    osdTimer = setTimeout(() => set({ osd: null }), OSD_MS[kind]);
  },

  showBanner: (banner, ms = 3500) => {
    clearTimeout(bannerTimer);
    set({ banner });
    bannerTimer = setTimeout(() => set({ banner: null }), ms);
  },
  dismissBanner: () => {
    clearTimeout(bannerTimer);
    set({ banner: null });
  },
}));

/**
 * What the island shows, highest priority first. A running timer and the
 * playing track are shown by the bar, on its right side, not here.
 */
export type IslandMode = PanelId | 'banner' | 'osd' | 'clockMeeting' | 'clock';
export function resolveMode(
  state: Pick<IslandState, 'panel' | 'osd' | 'banner'>,
  live: { meeting: boolean },
): IslandMode {
  if (state.panel) return state.panel;
  if (state.banner) return 'banner';
  if (state.osd) return 'osd';
  if (live.meeting) return 'clockMeeting';
  return 'clock';
}
