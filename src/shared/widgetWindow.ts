import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { currentMonitor, primaryMonitor } from '@tauri-apps/api/window';
import { currentWidget } from 'zebar';

/**
 * Moves and resizes the widget's own window. Sizes are given in CSS (logical)
 * pixels and converted with the monitor's scale factor, so the result is the
 * same at 100 % and 125 % scaling. Zebar 3.1.1 grants widgets
 * `core:window:allow-set-size` and `allow-set-position`.
 */

type Monitor = { x: number; y: number; width: number; height: number; scale: number };

let monitorPromise: Promise<Monitor> | null = null;

function tauriWindow() {
  try {
    return currentWidget().tauriWindow;
  } catch {
    return null; // Opened outside Zebar (e.g. in a browser while developing).
  }
}

async function readMonitor(): Promise<Monitor> {
  const m = tauriWindow() ? await currentMonitor().catch(() => null) : null;
  if (m) {
    return { x: m.position.x, y: m.position.y, width: m.size.width, height: m.size.height, scale: m.scaleFactor };
  }
  const scale = window.devicePixelRatio || 1;
  return { x: 0, y: 0, width: Math.round(screen.width * scale), height: Math.round(screen.height * scale), scale };
}

export function monitor(): Promise<Monitor> {
  monitorPromise ??= readMonitor();
  return monitorPromise;
}

/** Whether this widget window is on the primary monitor (the island's monitor). True outside Zebar. */
export async function onPrimaryMonitor(): Promise<boolean> {
  if (!tauriWindow()) return true;
  const [mine, primary] = await Promise.all([currentMonitor(), primaryMonitor()]).catch(() => [null, null]);
  if (!mine || !primary) return true;
  return mine.position.x === primary.position.x && mine.position.y === primary.position.y;
}

/**
 * - `top-full`: the full width of the top of the screen (the bar).
 * - `{ centerAt }`: the window's left edge is placed `centerAt` CSS px left of
 *   the screen's middle and stays there; only its size changes afterwards. The
 *   island uses this so a resize never needs a second, separate move call.
 */
export type Placement = 'top-full' | { centerAt: number };

// Calls are serialised and coalesced: only the latest requested frame is applied.
let pending: { width: number; height: number; placement: Placement } | null = null;
let running = false;
/** The x last applied, so the window is only moved when that changes (in practice once). */
let placedX: number | null = null;

export function placeWindow(width: number, height: number, placement: Placement) {
  pending = { width, height, placement };
  if (!running) void drain();
}

async function drain() {
  running = true;
  try {
    while (pending) {
      const { width, height, placement } = pending;
      pending = null;
      const win = tauriWindow();
      if (!win) continue;
      const m = await monitor();
      const full = placement === 'top-full';
      const pw = full ? m.width : Math.ceil(width * m.scale);
      const ph = Math.ceil(height * m.scale);
      const x = full ? m.x : m.x + Math.round(m.width / 2 - placement.centerAt * m.scale);
      await win.setSize(new PhysicalSize(pw, ph));
      if (x !== placedX) {
        await win.setPosition(new PhysicalPosition(x, m.y));
        placedX = x;
      }
    }
  } catch (err) {
    console.error('[kotilo] window placement failed', err);
  } finally {
    running = false;
  }
}

/**
 * Resolves once every requested move/resize has been applied. A short delay
 * first lets React commit the render whose effect requests the new size.
 */
export async function windowSettled(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
  while (running || pending) await new Promise((r) => setTimeout(r, 16));
}

/**
 * Runs `onBlur` whenever the page loses focus to another window (a click
 * elsewhere). This is the DOM event on purpose: Tauri's `onFocusChanged`
 * also reports `false` when focus merely moves from the top-level window into
 * the WebView inside it, which would close a panel the moment it gets focus.
 * Even the DOM event fires for focus that bounces away and back within a few
 * milliseconds (seen while the focus helper's click is handled), so the page
 * only counts as blurred if it is still unfocused 150 ms later.
 */
export function onWindowBlur(onBlur: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!document.hasFocus()) onBlur();
    }, 150);
  };
  window.addEventListener('blur', check);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('blur', check);
  };
}
