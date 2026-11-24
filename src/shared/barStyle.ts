/**
 * How the bar looks, picked in the island's settings and kept in the widgets'
 * shared storage (`STORED.barStyle`, `STORED.barOpacity`). The bar window keeps
 * its height in every style, so GlazeWM's gap above the windows still fits.
 *
 * - full: edge to edge; the island hangs from the bar's bottom line.
 * - floating: one rounded bar inset from the screen edges.
 * - segments: the left and right sides as separate pills.
 *
 * In the floating and segments styles there is no bar line for the island to
 * join, so it hangs from the top of the screen like a notch.
 */
export const BAR_STYLES = [
  { id: 'full', label: 'Full' },
  { id: 'floating', label: 'Floating' },
  { id: 'segments', label: 'Segments' },
] as const;

export type BarStyle = (typeof BAR_STYLES)[number]['id'];

export const DEFAULT_BAR_STYLE: BarStyle = 'full';

export const isBarStyle = (v: unknown): v is BarStyle => BAR_STYLES.some((s) => s.id === v);

/**
 * GlazeWM's outer gap on the left and right (`gaps.outer_gap` in its config),
 * with `scaleWithDpi` from the same section. Null sides were not given in px.
 */
export type WmGaps = { left: number | null; right: number | null; scaleWithDpi: boolean } | null;

/** GlazeWM's default outer gap, used until the island has read the config. */
const DEFAULT_GAP = 8;

/** A side gap in CSS px: GlazeWM gaps without DPI scaling are physical pixels. */
export function gapCss(gaps: WmGaps, side: 'left' | 'right', dpr: number): number {
  const v = gaps?.[side];
  if (v == null) return DEFAULT_GAP;
  return gaps!.scaleWithDpi ? v : v / dpr;
}

/** Opacity of the bar's background, in percent. The island's panels stay opaque so they remain readable. */
export const BAR_OPACITIES = [100, 85, 70, 50] as const;

export type BarOpacity = (typeof BAR_OPACITIES)[number];

export const DEFAULT_BAR_OPACITY: BarOpacity = 100;

export const isBarOpacity = (v: unknown): v is BarOpacity => BAR_OPACITIES.some((o) => o === v);
