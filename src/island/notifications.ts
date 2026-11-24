import { useEffect } from 'react';
import { create } from 'zustand';
import { readStored, STORED, writeStored } from '../shared/stored';
import { cachedAppIcon, loadAppIcons } from './panels';
import { useIsland, type IslandMode } from './store';
import { listNotifications, removeNotifications, type WinNotification } from './system';
import { DEMO } from './demo';

type NotifyStore = {
  /** Every toast Windows lists, newest first (muted apps included; see `visibleNotifications`). */
  items: WinNotification[];
  /** Windows' answer to "may this read notifications"; null until the first read. */
  access: string | null;
  error: string | null;
  /** App names the user muted in Settings: left out of the panel, the banner and the bar's count. */
  muted: string[];
  refresh: () => Promise<void>;
  remove: (ids: number[]) => void;
  setMuted: (app: string, muted: boolean) => void;
};

/** Notification IDs already seen, so only new ones raise a banner. Empty until the first read. */
const seen = new Set<number>();
let seeded = false;

/**
 * IDs removed in the last few seconds, with when. A read that was already on
 * its way when the removal was sent still lists them; they are left out until
 * Windows has caught up, so a removed notification never flashes back.
 */
const removedAt = new Map<number, number>();
const REMOVAL_GRACE_MS = 10_000;

function withoutRemoved(items: WinNotification[]) {
  const now = Date.now();
  for (const [id, at] of removedAt) if (now - at > REMOVAL_GRACE_MS) removedAt.delete(id);
  return removedAt.size ? items.filter((n) => !removedAt.has(n.id)) : items;
}

export const visibleNotifications = (s: Pick<NotifyStore, 'items' | 'muted'>) =>
  s.items.filter((n) => !s.muted.includes(n.app));

const share = (s: Pick<NotifyStore, 'items' | 'muted'>) => writeStored(STORED.notifyCount, visibleNotifications(s).length);

const firstLine = (text: string) => text.split('\n')[0];

/** A short banner for a new notification (the newest one if several arrived at once). */
function announce(fresh: WinNotification[]) {
  if (DEMO) return;
  const n = fresh[0];
  const more = fresh.length > 1 ? ` · +${fresh.length - 1} more` : '';
  useIsland.getState().showBanner(
    {
      icon: 'bell',
      image: cachedAppIcon(n.aumid),
      title: n.title,
      sub: `${n.app}${n.body ? ` · ${firstLine(n.body)}` : ''}${more}`,
      panel: 'notifications',
    },
    5000,
  );
}

export const useNotifications = create<NotifyStore>((set, get) => ({
  items: [],
  access: null,
  error: null,
  muted: (() => {
    const list = readStored<unknown>(STORED.notifyMuted, []);
    return Array.isArray(list) ? (list as string[]) : [];
  })(),

  refresh: () =>
    listNotifications()
      .then(({ access, items: listed }) => {
        const items = withoutRemoved(listed);
        const fresh = items.filter((n) => !seen.has(n.id) && !get().muted.includes(n.app));
        items.forEach((n) => seen.add(n.id));
        // The first read only learns what is already there.
        if (seeded && fresh.length) announce(fresh);
        seeded = true;
        set({ items, access, error: null });
        share(get());
      })
      .catch((err) => set({ error: String(err) })),

  remove: (ids) => {
    // Shown gone at once; Windows removes them in the background.
    const now = Date.now();
    ids.forEach((id) => removedAt.set(id, now));
    set({ items: get().items.filter((n) => !ids.includes(n.id)) });
    share(get());
    removeNotifications(ids).catch((err) => set({ error: String(err) }));
  },

  setMuted: (app, muted) => {
    const list = get().muted.filter((a) => a !== app);
    if (muted) list.push(app);
    set({ muted: list });
    writeStored(STORED.notifyMuted, list);
    share(get());
  },
}));

/**
 * Reads the notifications every 4 s (every 2 s while their panel is open, so
 * removals elsewhere show quickly). Also warms the app icons used in banners.
 */
export function useNotificationPolling(mode: IslandMode) {
  const fast = mode === 'notifications';
  useEffect(() => {
    void loadAppIcons().catch(() => {});
  }, []);
  useEffect(() => {
    const refresh = useNotifications.getState().refresh;
    void refresh();
    const id = setInterval(() => void refresh(), fast ? 2000 : 4000);
    return () => clearInterval(id);
  }, [fast]);
}
