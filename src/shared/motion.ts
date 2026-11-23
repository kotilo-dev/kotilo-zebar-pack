/**
 * Island motion: the shape grows first and the content follows; on the way back
 * the content leaves first and the shape shrinks after it.
 */
export const motion = {
  panelIn: 500,
  panelOut: 260,
  contentDelay: 90,
  contentOut: 80,
  normal: 260,
  /** Slight overshoot when the island grows. */
  curveIn: [0.05, 0.9, 0.1, 1.05] as const,
  curveOut: [0.3, 0, 0.2, 1] as const,
};

export type Bezier = readonly [number, number, number, number];

export const cssBezier = (b: Bezier) => `cubic-bezier(${b.join(', ')})`;

/** Cubic-bezier easing, solved for x with Newton steps and a bisection fallback. */
export function bezierEasing([x1, y1, x2, y2]: Bezier): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solve = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-5) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > 1e-5) {
      if (sx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}
