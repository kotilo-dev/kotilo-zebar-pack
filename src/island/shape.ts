import { useEffect, useRef, useState } from 'react';
import { bezierEasing, motion } from '../shared/motion';

/** Bar height in CSS px; must match `--bar-h` in theme.css. */
export const BAR_H = 32;
/** Largest shoulder radius any view uses; the window always leaves room for it. */
export const MAX_SHOULDER = 22;
/** Room for the outline's anti-aliasing at the window edges. */
const EDGE = 2;

/**
 * The island's outline. `w` and `h` are the body's size (h counts from the top
 * of the screen, so the part below the bar is `h - BAR_H`), `r` the radius of
 * the lower corners and `s` the radius of the concave shoulders where the body
 * meets the bar's line.
 */
export type Shape = { w: number; h: number; r: number; s: number };

/** Widest island body of any view (the launcher). A wider view would be cut off on the left. */
export const MAX_BODY_W = 620;

/**
 * The island is laid out in a box this wide whose middle is the screen's
 * middle. The window's left edge sits on this box's left edge and never moves;
 * only the window's width and height change. Moving and resizing a window are
 * two separate calls, and between them the island showed for a frame at the
 * wrong place (a flicker at the end of every panel close). With a fixed left
 * edge one resize call is enough, and even a stale frame draws the island in
 * the right place.
 */
export const LAYOUT_W = MAX_BODY_W + 2 * MAX_SHOULDER + 2 * EDGE;

/** The window for a shape: from the layout box's left edge to just past the shape's right shoulder. */
export function windowSizeFor(shape: Shape) {
  if (shape.w > MAX_BODY_W) console.warn(`[kotilo] island ${shape.w}px is wider than MAX_BODY_W (${MAX_BODY_W})`);
  return { width: Math.ceil(LAYOUT_W / 2 + shape.w / 2 + MAX_SHOULDER + EDGE), height: shape.h + EDGE };
}

/**
 * SVG path of the island inside a window `winW` wide. With `outline` set, the
 * path is the open line along the shoulders, sides and bottom, inset half a
 * pixel so a 1px stroke lands on whole pixels and meets the bar's bottom line.
 */
export function islandPath(winW: number, { w, h, r, s }: Shape, outline = false): string {
  const inset = outline ? 0.5 : 0;
  const cx = winW / 2;
  const x0 = cx - w / 2 + inset;
  const x1 = cx + w / 2 - inset;
  const top = BAR_H - inset;
  const bottom = h - inset;
  const hang = Math.max(0, bottom - top);

  // Horizontal radii keep their full size; vertical radii shrink to fit the
  // part below the bar, split between shoulder and corner in proportion. On a
  // shallow island the curves become flat ellipses: one soft S from the bar's
  // line to the bottom instead of two tight quarter circles.
  const sx = Math.max(0, s);
  const rx = Math.max(0, Math.min(r, w / 2));
  const share = sx + rx > 0 ? sx / (sx + rx) : 0.5;
  const sy = Math.min(sx, hang * share);
  const ry = Math.min(rx, hang - sy);

  const sides =
    `A ${sx} ${sy} 0 0 0 ${x1} ${top + sy} ` +
    `V ${bottom - ry} A ${rx} ${ry} 0 0 1 ${x1 - rx} ${bottom} ` +
    `H ${x0 + rx} A ${rx} ${ry} 0 0 1 ${x0} ${bottom - ry} ` +
    `V ${top + sy} A ${sx} ${sy} 0 0 0 ${x0 - sx} ${top}`;

  return outline
    ? `M ${x1 + sx} ${top} ${sides}`
    : `M ${x0 - sx} 0 H ${x1 + sx} V ${top} ${sides} Z`;
}

type Track = { from: number; to: number; start: number; delay: number; duration: number; ease: (t: number) => number };

const easeIn = bezierEasing(motion.curveIn);
const easeOut = bezierEasing(motion.curveOut);

function track(from: number, to: number, grows: boolean, now: number): Track {
  return grows
    ? { from, to, start: now, delay: 0, duration: motion.panelIn, ease: easeIn }
    : { from, to, start: now, delay: motion.contentOut, duration: motion.panelOut, ease: easeOut };
}

function valueAt(t: Track, now: number) {
  const p = (now - t.start - t.delay) / t.duration;
  if (p <= 0) return t.from;
  if (p >= 1) return t.to;
  return t.from + (t.to - t.from) * t.ease(p);
}

/**
 * Animates the shape towards `target`. Width and height move on their own:
 * each grows at once with a slight overshoot, or shrinks after the content has
 * faded. Returns the shape for the current frame.
 */
export function useAnimatedShape(target: Shape): Shape {
  const [shape, setShape] = useState(target);
  const current = useRef(target);
  const tracks = useRef<Record<keyof Shape, Track> | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const now = performance.now();
    const c = current.current;
    const wGrows = target.w > c.w;
    const hGrows = target.h > c.h;
    tracks.current = {
      w: track(c.w, target.w, wGrows, now),
      h: track(c.h, target.h, hGrows, now),
      r: track(c.r, target.r, hGrows, now),
      s: track(c.s, target.s, hGrows, now),
    };

    const tick = () => {
      const t = tracks.current!;
      const time = performance.now();
      const next: Shape = { w: valueAt(t.w, time), h: valueAt(t.h, time), r: valueAt(t.r, time), s: valueAt(t.s, time) };
      current.current = next;
      setShape(next);
      const done = (Object.keys(t) as (keyof Shape)[]).every((k) => time - t[k].start >= t[k].delay + t[k].duration);
      if (!done) frame.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target.w, target.h, target.r, target.s]);

  return shape;
}

/** How long a shrink takes from the moment the target changes. */
export const SHRINK_MS = motion.contentOut + motion.panelOut;
