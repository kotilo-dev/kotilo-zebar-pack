import { useEffect, useState } from 'react';

/**
 * Small values the island shares with the bar. The two widgets are separate
 * windows of one origin, so they share `localStorage`; a write in one fires a
 * `storage` event in the other.
 */
export const STORED = {
  bluetooth: 'kotilo.bluetooth',
  timer: 'kotilo.timer',
  todos: 'kotilo.todos',
  awake: 'kotilo.awake',
  notes: 'kotilo.notes',
  /** Bar items the user turned off in the island's settings (see `barItems.ts`). */
  barHidden: 'kotilo.bar.hidden',
  /** How the bar draws workspace buttons (see `workspaceStyle.ts`). */
  workspaceStyle: 'kotilo.bar.workspaceStyle',
  /** How many Windows notifications the island lists (muted apps left out), for the bar's bell. */
  notifyCount: 'kotilo.notify.count',
  /** App names whose notifications the island ignores (set in Settings). */
  notifyMuted: 'kotilo.notify.muted',
} as const;

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Writes only when the value changed, so the other window sees no empty events. */
export function writeStored(key: string, value: unknown) {
  try {
    const raw = JSON.stringify(value);
    if (localStorage.getItem(key) !== raw) localStorage.setItem(key, raw);
  } catch {
    // Storage unavailable: the other widget simply shows nothing for it.
  }
}

/** A value another widget writes, kept current through the `storage` event. */
export function useStored<T>(key: string, fallback: T): T {
  const [value, setValue] = useState(() => readStored(key, fallback));
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === key && setValue(readStored(key, fallback));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}
