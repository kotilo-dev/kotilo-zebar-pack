import { emit, listen } from '@tauri-apps/api/event';

/**
 * Developer colour themes for the bar, the island and GlazeWM's window borders.
 * A theme holds only base colours; `theme.css` derives the translucent ones
 * (lines, soft accent, hairlines) from them with `color-mix`, so a new theme is
 * one entry here. Windows' own theme and accent colour are never touched.
 */
export type Palette = {
  /** Bar and island background. */
  bg: string;
  /** Cards, then raised controls, then hover. */
  surface: string;
  surface2: string;
  surfaceHover: string;
  text: string;
  subtext: string;
  muted: string;
  accent: string;
  /** Text on the accent colour. */
  accentInk: string;
  warning: string;
  danger: string;
  ok: string;
  scheme: 'dark' | 'light';
  /** GlazeWM border of unfocused windows, when it should not be `surface2`. */
  borderOther?: string;
};

export type Theme = { id: string; name: string; group: 'Default' | 'Classic' | 'Popular' | 'More' | 'Light'; palette: Palette };

const dark = (p: Omit<Palette, 'scheme'>): Palette => ({ ...p, scheme: 'dark' });
const light = (p: Omit<Palette, 'scheme'>): Palette => ({ ...p, scheme: 'light' });

export const THEMES: Theme[] = [
  {
    id: 'kotilo',
    name: 'Kotilo',
    group: 'Default',
    palette: dark({ bg: '#131220', surface: '#1c1a2b', surface2: '#262338', surfaceHover: '#2e2a44', text: '#e8e3f7', subtext: '#a7a1bd', muted: '#6f6a85', accent: '#cba6f7', accentInk: '#1b1328', warning: '#f9e2af', danger: '#f38ba8', ok: '#a6e3a1', borderOther: '#2a2740' }),
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    group: 'Classic',
    palette: dark({ bg: '#181825', surface: '#1e1e2e', surface2: '#313244', surfaceHover: '#45475a', text: '#cdd6f4', subtext: '#a6adc8', muted: '#6c7086', accent: '#cba6f7', accentInk: '#11111b', warning: '#f9e2af', danger: '#f38ba8', ok: '#a6e3a1' }),
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    group: 'Classic',
    palette: dark({ bg: '#16161e', surface: '#1a1b26', surface2: '#24283b', surfaceHover: '#292e42', text: '#c0caf5', subtext: '#a9b1d6', muted: '#565f89', accent: '#7aa2f7', accentInk: '#16161e', warning: '#e0af68', danger: '#f7768e', ok: '#9ece6a' }),
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    group: 'Classic',
    palette: dark({ bg: '#1d2021', surface: '#282828', surface2: '#3c3836', surfaceHover: '#504945', text: '#ebdbb2', subtext: '#bdae93', muted: '#928374', accent: '#fabd2f', accentInk: '#1d2021', warning: '#fe8019', danger: '#fb4934', ok: '#b8bb26' }),
  },
  {
    id: 'everforest-dark',
    name: 'Everforest Dark',
    group: 'Classic',
    palette: dark({ bg: '#232a2e', surface: '#2d353b', surface2: '#343f44', surfaceHover: '#3d484d', text: '#d3c6aa', subtext: '#9da9a0', muted: '#7a8478', accent: '#a7c080', accentInk: '#232a2e', warning: '#dbbc7f', danger: '#e67e80', ok: '#83c092' }),
  },
  {
    id: 'nord',
    name: 'Nord',
    group: 'Popular',
    palette: dark({ bg: '#2e3440', surface: '#3b4252', surface2: '#434c5e', surfaceHover: '#4c566a', text: '#eceff4', subtext: '#d8dee9', muted: '#7b88a1', accent: '#88c0d0', accentInk: '#2e3440', warning: '#ebcb8b', danger: '#bf616a', ok: '#a3be8c' }),
  },
  {
    id: 'dracula',
    name: 'Dracula',
    group: 'Popular',
    palette: dark({ bg: '#21222c', surface: '#282a36', surface2: '#343746', surfaceHover: '#44475a', text: '#f8f8f2', subtext: '#bfc0d0', muted: '#6272a4', accent: '#bd93f9', accentInk: '#21222c', warning: '#f1fa8c', danger: '#ff5555', ok: '#50fa7b' }),
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    group: 'Popular',
    palette: dark({ bg: '#191724', surface: '#1f1d2e', surface2: '#26233a', surfaceHover: '#403d52', text: '#e0def4', subtext: '#908caa', muted: '#6e6a86', accent: '#ebbcba', accentInk: '#191724', warning: '#f6c177', danger: '#eb6f92', ok: '#9ccfd8' }),
  },
  {
    id: 'kanagawa',
    name: 'Kanagawa',
    group: 'Popular',
    palette: dark({ bg: '#16161d', surface: '#1f1f28', surface2: '#2a2a37', surfaceHover: '#363646', text: '#dcd7ba', subtext: '#c8c093', muted: '#727169', accent: '#7e9cd8', accentInk: '#16161d', warning: '#e6c384', danger: '#e46876', ok: '#98bb6c' }),
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    group: 'More',
    palette: dark({ bg: '#21252b', surface: '#282c34', surface2: '#2c313a', surfaceHover: '#3e4451', text: '#d7dae0', subtext: '#abb2bf', muted: '#5c6370', accent: '#61afef', accentInk: '#21252b', warning: '#e5c07b', danger: '#e06c75', ok: '#98c379' }),
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    group: 'More',
    palette: dark({ bg: '#002b36', surface: '#073642', surface2: '#0d4250', surfaceHover: '#134a59', text: '#93a1a1', subtext: '#839496', muted: '#586e75', accent: '#268bd2', accentInk: '#fdf6e3', warning: '#b58900', danger: '#dc322f', ok: '#859900' }),
  },
  {
    id: 'monokai',
    name: 'Monokai',
    group: 'More',
    palette: dark({ bg: '#1e1f1c', surface: '#272822', surface2: '#3e3d32', surfaceHover: '#49483e', text: '#f8f8f2', subtext: '#cfcfc2', muted: '#75715e', accent: '#f92672', accentInk: '#f8f8f2', warning: '#e6db74', danger: '#fd971f', ok: '#a6e22e' }),
  },
  {
    id: 'ayu-mirage',
    name: 'Ayu Mirage',
    group: 'More',
    palette: dark({ bg: '#1f2430', surface: '#242936', surface2: '#2d3343', surfaceHover: '#363c51', text: '#cccac2', subtext: '#a6a69c', muted: '#707a8c', accent: '#ffcc66', accentInk: '#1f2430', warning: '#ffad66', danger: '#f28779', ok: '#87d96c' }),
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    group: 'Light',
    palette: light({ bg: '#eff1f5', surface: '#e6e9ef', surface2: '#dce0e8', surfaceHover: '#ccd0da', text: '#4c4f69', subtext: '#6c6f85', muted: '#9ca0b0', accent: '#8839ef', accentInk: '#eff1f5', warning: '#b06a00', danger: '#d20f39', ok: '#40a02b' }),
  },
  {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    group: 'Light',
    palette: light({ bg: '#f9f5d7', surface: '#f2e5bc', surface2: '#ebdbb2', surfaceHover: '#d5c4a1', text: '#3c3836', subtext: '#665c54', muted: '#928374', accent: '#d65d0e', accentInk: '#f9f5d7', warning: '#b57614', danger: '#9d0006', ok: '#79740e' }),
  },
  {
    id: 'everforest-light',
    name: 'Everforest Light',
    group: 'Light',
    palette: light({ bg: '#fdf6e3', surface: '#f4f0d9', surface2: '#efebd4', surfaceHover: '#e6e2cc', text: '#5c6a72', subtext: '#708089', muted: '#939f91', accent: '#8da101', accentInk: '#2f3a00', warning: '#a87a00', danger: '#f85552', ok: '#35a77c' }),
  },
  {
    id: 'tokyo-night-day',
    name: 'Tokyo Night Day',
    group: 'Light',
    palette: light({ bg: '#e1e2e7', surface: '#d5d6db', surface2: '#c8c9cf', surfaceHover: '#bcbec6', text: '#3760bf', subtext: '#6172b0', muted: '#8990b3', accent: '#2e7de9', accentInk: '#e1e2e7', warning: '#8c6c3e', danger: '#f52a65', ok: '#587539' }),
  },
];

export const DEFAULT_THEME = 'kotilo';
const STORAGE_KEY = 'kotilo.theme';
const EVENT = 'kotilo:theme';

export const themeById = (id: string | null | undefined) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** GlazeWM border colours for a theme: the accent for the focused window, a raised surface for the rest. */
export const borderColors = (t: Theme) => ({ focused: t.palette.accent, other: t.palette.borderOther ?? t.palette.surface2 });

const TOKENS: Record<Exclude<keyof Palette, 'scheme' | 'borderOther'>, string> = {
  bg: '--bg',
  surface: '--surface',
  surface2: '--surface-2',
  surfaceHover: '--surface-hover',
  text: '--text',
  subtext: '--subtext',
  muted: '--muted',
  accent: '--accent',
  accentInk: '--accent-ink',
  warning: '--warning',
  danger: '--danger',
  ok: '--ok',
};

/** Puts a theme's colours on this page (only this window; see `chooseTheme` for all of them). */
export function applyTheme(id: string) {
  const { palette } = themeById(id);
  const root = document.documentElement.style;
  for (const [key, token] of Object.entries(TOKENS)) root.setProperty(token, palette[key as keyof typeof TOKENS]);
  root.setProperty('color-scheme', palette.scheme);
  document.documentElement.dataset.theme = id;
  // Light themes need a few tweaks (e.g. a backing behind Windows' white tray icons).
  document.documentElement.dataset.scheme = palette.scheme;
}

export function storedTheme(): string {
  try {
    return themeById(localStorage.getItem(STORAGE_KEY)).id;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Saves the choice and applies it here and in the other widget windows (the bar). */
export function chooseTheme(id: string) {
  const theme = themeById(id);
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    // Storage unavailable: the theme still applies until the widgets restart.
  }
  applyTheme(theme.id);
  void emit(EVENT, theme.id).catch(() => {}); // Outside Zebar there is no event bus.
}

/**
 * Applies the saved theme at start and follows changes made in another widget
 * window, both through the shared storage and the Tauri event.
 */
export function followTheme() {
  applyTheme(storedTheme());
  window.addEventListener('storage', (e) => e.key === STORAGE_KEY && applyTheme(storedTheme()));
  listen<string>(EVENT, (e) => applyTheme(e.payload)).catch(() => {});
}
