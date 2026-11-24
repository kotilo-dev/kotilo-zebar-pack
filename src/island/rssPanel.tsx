import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Rss, X } from 'lucide-react';
import { PanelHeader } from './components';
import { allStories, useRss } from './rss';
import { useIsland } from './store';
import { openFeedLink } from './system';

function ago(time: number, now: number) {
  if (!time) return '';
  const s = Math.max(0, Math.round((now - time) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/**
 * News: the stories of the user's RSS and Atom feeds, newest first. A click
 * opens the story in the default browser. "Feeds" adds and removes feeds.
 */
export function RssView({ active }: { active: boolean }) {
  const { feeds, cache, loading, refresh, add, remove } = useRss();
  const closePanel = useIsland((s) => s.closePanel);
  const [tab, setTab] = useState<'news' | 'feeds'>('news');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  /** The feed the stories are narrowed to (its URL); null shows all. */
  const [only, setOnly] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    setError(null);
    setTab(feeds.length ? 'news' : 'feeds');
    void refresh();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const shownFeed = only && feeds.some((f) => f.url === only) ? only : null;
  const stories = allStories(shownFeed ? feeds.filter((f) => f.url === shownFeed) : feeds, cache);

  const submit = () => {
    if (!url.trim() || adding) return;
    setAdding(true);
    setError(null);
    add(url)
      .then(() => setUrl(''))
      .catch((err) => setError(String(err).replace(/^Error: /, '')))
      .finally(() => setAdding(false));
  };

  const open = (link: string) => {
    closePanel();
    void openFeedLink(link).catch((err) => console.warn('[kotilo] news', err));
  };

  return (
    <div className="view-panel rss">
      <PanelHeader title="News" back />
      <div className="list-head">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={tab === 'news'} className={tab === 'news' ? 'on' : ''} onClick={() => setTab('news')}>
            Stories
          </button>
          <button role="tab" aria-selected={tab === 'feeds'} className={tab === 'feeds' ? 'on' : ''} onClick={() => setTab('feeds')}>
            Feeds{feeds.length ? ` · ${feeds.length}` : ''}
          </button>
        </div>
        <button className="chip-button" onClick={() => void refresh(true)} disabled={loading || !feeds.length} title="Read the feeds again">
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
          {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      {tab === 'news' ? (
        <>
          {feeds.length > 1 && (
            <div className="rss-filter" role="radiogroup" aria-label="Feed">
              <button role="radio" aria-checked={!shownFeed} className={!shownFeed ? 'on' : ''} onClick={() => setOnly(null)}>
                All
              </button>
              {feeds.map((f) => (
                <button
                  key={f.url}
                  role="radio"
                  aria-checked={shownFeed === f.url}
                  className={shownFeed === f.url ? 'on' : ''}
                  onClick={() => setOnly(f.url)}
                  title={f.url}
                >
                  {f.title}
                </button>
              ))}
            </div>
          )}
          <div className="rss-list panel-scroll">
            {feeds.length === 0 && <span className="muted-text">No feeds yet. Add one under Feeds.</span>}
            {feeds.length > 0 && stories.length === 0 && (
              <span className="muted-text">{loading ? 'Reading the feeds…' : 'No stories. Check the feeds for errors.'}</span>
            )}
            {stories.map((s) => (
              <button key={`${s.feed}|${s.link}`} className="rss-story" onClick={() => open(s.link)} title={s.link}>
                <span className="rss-title">{s.title}</span>
                <span className="rss-meta muted-text">
                  {s.feed}
                  {s.time ? ` · ${ago(s.time, now)}` : ''}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="search">
            <Plus size={15} className="accent" />
            <input
              value={url}
              placeholder="Paste a feed address (RSS or Atom) and press Enter"
              spellCheck={false}
              disabled={adding}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          {adding && <span className="muted-text rss-note">Reading the feed…</span>}
          {error && <p className="panel-error">{error}</p>}
          <div className="rss-list panel-scroll">
            {feeds.length === 0 && (
              <span className="muted-text">For example https://feeds.bbci.co.uk/news/world/rss.xml or a site's /feed address.</span>
            )}
            {feeds.map((f) => {
              const state = cache[f.url];
              return (
                <div key={f.url} className="rss-feed">
                  <Rss size={14} className="accent" />
                  <span className="rss-feed-text">
                    <span className="ellipsis">{f.title}</span>
                    <span className={`ellipsis ${state?.error ? 'danger-text' : 'muted-text'}`} title={state?.error ?? f.url}>
                      {state?.error ? `Could not read: ${state.error}` : `${state?.items.length ?? 0} stories · ${f.url}`}
                    </span>
                  </span>
                  <button className="clip-delete" onClick={() => remove(f.url)} aria-label={`Remove ${f.title}`} title="Remove">
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
