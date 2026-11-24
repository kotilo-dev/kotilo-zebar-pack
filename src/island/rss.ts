import { create } from 'zustand';
import { readStored, STORED, writeStored } from '../shared/stored';
import { fetchFeed, type FeedItem } from './system';

/**
 * The News panel's feeds and stories. The feed list and the last stories read
 * from each feed are kept in local storage, so the panel shows them at once
 * after a restart; feeds are read again when the panel opens and the last read
 * is older than `MAX_AGE`, or on Refresh.
 */

export type Feed = { url: string; title: string };
type FeedState = { items: FeedItem[]; at: number; error?: string };
export type Story = FeedItem & { feed: string; time: number };

const MAX_AGE = 15 * 60_000;

const isFeed = (f: unknown): f is Feed =>
  !!f && typeof (f as Feed).url === 'string' && typeof (f as Feed).title === 'string';

function storedFeeds(): Feed[] {
  const list = readStored<unknown>(STORED.rssFeeds, []);
  return Array.isArray(list) ? list.filter(isFeed) : [];
}

function storedCache(): Record<string, FeedState> {
  const cache = readStored<unknown>(STORED.rssCache, {});
  return cache && typeof cache === 'object' ? (cache as Record<string, FeedState>) : {};
}

type State = {
  feeds: Feed[];
  cache: Record<string, FeedState>;
  loading: boolean;
  /** Reads the feeds again; only those older than `MAX_AGE` unless `force`. */
  refresh: (force?: boolean) => Promise<void>;
  /** Reads a new feed first, so a wrong address is reported instead of added. */
  add: (url: string) => Promise<void>;
  remove: (url: string) => void;
};

export const useRss = create<State>((set, get) => {
  const saveCache = (cache: Record<string, FeedState>) => {
    set({ cache });
    writeStored(STORED.rssCache, cache);
  };
  const read = async (feed: Feed) => {
    try {
      const { title, items } = await fetchFeed(feed.url);
      saveCache({ ...get().cache, [feed.url]: { items, at: Date.now() } });
      // A feed added before its name was known gets the name the feed gives.
      if (feed.title === feed.url && title) {
        const feeds = get().feeds.map((f) => (f.url === feed.url ? { ...f, title } : f));
        set({ feeds });
        writeStored(STORED.rssFeeds, feeds);
      }
    } catch (err) {
      const old = get().cache[feed.url];
      saveCache({ ...get().cache, [feed.url]: { items: old?.items ?? [], at: Date.now(), error: String(err).replace(/^Error: /, '') } });
    }
  };
  let running: Promise<void> | null = null;

  return {
    feeds: storedFeeds(),
    cache: storedCache(),
    loading: false,
    refresh: (force = false) => {
      running ??= (async () => {
        const due = get().feeds.filter((f) => force || Date.now() - (get().cache[f.url]?.at ?? 0) > MAX_AGE);
        if (!due.length) return;
        set({ loading: true });
        try {
          for (const feed of due) await read(feed);
        } finally {
          set({ loading: false });
        }
      })().finally(() => (running = null));
      return running;
    },
    add: async (input) => {
      let url = input.trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      if (get().feeds.some((f) => f.url === url)) throw new Error('That feed is already in the list');
      const { title, items } = await fetchFeed(url);
      const feeds = [...get().feeds, { url, title: title || url }];
      set({ feeds });
      writeStored(STORED.rssFeeds, feeds);
      saveCache({ ...get().cache, [url]: { items, at: Date.now() } });
    },
    remove: (url) => {
      const feeds = get().feeds.filter((f) => f.url !== url);
      set({ feeds });
      writeStored(STORED.rssFeeds, feeds);
      const { [url]: _gone, ...rest } = get().cache;
      saveCache(rest);
    },
  };
});

/** All stories, newest first; stories without a date keep their feed's order after the dated ones. */
export function allStories(feeds: Feed[], cache: Record<string, FeedState>, max = 80): Story[] {
  const out: Story[] = [];
  for (const f of feeds) {
    for (const item of cache[f.url]?.items ?? []) {
      const t = Date.parse(item.date);
      out.push({ ...item, feed: f.title, time: Number.isNaN(t) ? 0 : t });
    }
  }
  return out.sort((a, b) => b.time - a.time).slice(0, max);
}
