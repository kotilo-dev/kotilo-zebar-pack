import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Copy, ExternalLink, File, Folder, HardDrive, House, Link, Search } from 'lucide-react';
import { PanelHeader } from './components';
import { useKeepFocused } from './panels';
import { fold } from './search';
import { useIsland } from './store';
import {
  copyFileToClipboard,
  copyPathToClipboard,
  listFolder,
  openFileEntry,
  type FileEntry,
  type FolderListing,
} from './system';

const opens = (entry: FileEntry) => entry.kind !== 'file';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const formatDate = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The second line of a row: where a place points, a drive's free space, a file's size and date. */
function detail(entry: FileEntry) {
  if (entry.kind === 'place') return entry.path;
  if (entry.kind === 'drive') return entry.size != null ? `${formatSize(entry.size)} free` : '';
  const parts = [];
  if (entry.kind === 'file' && entry.size != null) parts.push(formatSize(entry.size));
  if (entry.time != null) parts.push(formatDate(entry.time));
  return parts.join(' · ');
}

function EntryIcon({ entry }: { entry: FileEntry }) {
  const Icon = entry.kind === 'drive' ? HardDrive : entry.kind === 'place' ? House : entry.kind === 'folder' ? Folder : File;
  return (
    <span className="result-avatar">
      <Icon size={15} />
    </span>
  );
}

/**
 * Browses the computer's folders. It starts at the top (the user's main
 * folders and the drives); a click on a folder goes into it and the up button
 * (or Backspace in an empty search) goes back out. Each row can put the file
 * itself on the clipboard, to paste in File Explorer, or its path as text.
 */
export function FilesView({ active }: { active: boolean }) {
  const { closePanel, showBanner } = useIsland();
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const selectedRow = useRef<HTMLDivElement>(null);
  // Only the answer to the latest request is shown when folders are opened quickly one after another.
  const requestId = useRef(0);

  const go = (path: string | null) => {
    const id = ++requestId.current;
    setLoading(true);
    listFolder(path)
      .then((next) => {
        if (id !== requestId.current) return;
        setListing(next);
        setQuery('');
        setSelected(0);
        setError(null);
      })
      .catch((err) => id === requestId.current && setError(String(err).replace(/^Error: /, '')))
      .finally(() => id === requestId.current && setLoading(false));
  };

  // Every opening starts at the top.
  useEffect(() => {
    if (!active) return;
    setListing(null);
    go(null);
  }, [active]);

  useKeepFocused(active, input);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return (listing?.items ?? []).filter((e) => !q || fold(e.name).includes(q));
  }, [listing, query]);

  const current = Math.min(selected, Math.max(shown.length - 1, 0));

  // Keep the selected row in view while moving with the arrow keys.
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const atTop = listing != null && listing.path == null;
  // A drive's root has no parent folder; going up from it returns to the top.
  const up = () => {
    if (listing && listing.path != null) go(listing.parent);
  };

  const open = (entry: FileEntry | undefined) => {
    if (entry && opens(entry)) go(entry.path);
  };

  /** Opens the entry outside the island: a folder in File Explorer, a file in its default app. */
  const launch = (entry: FileEntry) =>
    openFileEntry(entry.path)
      .then(() => closePanel())
      .catch((err) => setError(String(err).replace(/^Error: /, '')));

  const copyFile = (entry: FileEntry) =>
    copyFileToClipboard(entry.path)
      .then(() => {
        closePanel();
        showBanner({ icon: 'check', title: `Copied ${entry.name}`, sub: 'Paste it in File Explorer with Ctrl+V' }, 1800);
      })
      .catch((err) => setError(String(err).replace(/^Error: /, '')));

  const copyPath = (entry: FileEntry) =>
    copyPathToClipboard(entry.path)
      .then(() => {
        closePanel();
        showBanner({ icon: 'check', title: 'Path copied', sub: entry.path }, 1800);
      })
      .catch((err) => setError(String(err).replace(/^Error: /, '')));

  const cut = listing && listing.total > listing.items.length;

  return (
    <div className="view-panel files">
      <PanelHeader title="Files" back />
      <div className="clip-toolbar">
        <button className="chip-button" onClick={up} disabled={!listing || atTop} title="Up one folder (Backspace)">
          <ArrowUp size={13} /> Up
        </button>
        <label className="search">
          <Search size={15} className="accent" />
          <input
            ref={input}
            value={query}
            placeholder={atTop ? 'Search this PC' : 'Search this folder'}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              const entry = shown[current];
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected(Math.min(current + 1, shown.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected(Math.max(current - 1, 0));
              } else if (e.key === 'Enter' && entry) {
                // Enter goes into a folder; Ctrl+Enter, or Enter on a file, opens it outside the island.
                if (e.ctrlKey || !opens(entry)) void launch(entry);
                else open(entry);
              } else if (e.key === 'Backspace' && query === '') {
                e.preventDefault();
                up();
              } else if (e.key.toLowerCase() === 'c' && e.ctrlKey && entry) {
                // Ctrl+C copies the file, Ctrl+Shift+C its path, unless text in the search box is selected.
                const box = e.currentTarget;
                if (box.selectionStart !== box.selectionEnd) return;
                e.preventDefault();
                void (e.shiftKey ? copyPath(entry) : copyFile(entry));
              }
            }}
          />
        </label>
      </div>
      <div className="files-path ellipsis" title={listing?.path ?? undefined}>
        {listing ? (listing.path ?? 'This PC') : ' '}
      </div>

      <div className="results panel-scroll">
        {!listing && !error && <span className="muted-text">Loading…</span>}
        {listing && shown.length === 0 && !loading && (
          <span className="muted-text">{listing.items.length ? 'Nothing matches' : 'This folder is empty'}</span>
        )}
        {shown.map((entry, i) => (
          <div
            key={entry.path}
            ref={i === current ? selectedRow : undefined}
            role="button"
            className={`result file-item ${i === current ? 'selected' : ''} ${opens(entry) ? 'opens' : ''}`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => open(entry)}
            title={entry.path}
          >
            <EntryIcon entry={entry} />
            <span className="window-text">
              <span className="ellipsis">{entry.name}</span>
              {detail(entry) && <span className="window-title ellipsis">{detail(entry)}</span>}
            </span>
            <span className="file-actions">
              <button
                className="file-action"
                aria-label={`Open ${entry.name}`}
                title={opens(entry) ? 'Open in File Explorer (Ctrl+Enter)' : 'Open (Enter)'}
                onClick={(e) => {
                  e.stopPropagation();
                  void launch(entry);
                }}
              >
                <ExternalLink size={14} />
              </button>
              <button
                className="file-action"
                aria-label={`Copy ${entry.name}`}
                title={entry.kind === 'file' ? 'Copy file (Ctrl+C)' : 'Copy folder (Ctrl+C)'}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyFile(entry);
                }}
              >
                <Copy size={14} />
              </button>
              <button
                className="file-action"
                aria-label={`Copy the path of ${entry.name}`}
                title="Copy path (Ctrl+Shift+C)"
                onClick={(e) => {
                  e.stopPropagation();
                  void copyPath(entry);
                }}
              >
                <Link size={14} />
              </button>
            </span>
          </div>
        ))}
        {cut && <span className="muted-text">Showing the first {listing.items.length} of {listing.total} items</span>}
      </div>
      {error && <p className="panel-error ellipsis">{error}</p>}
    </div>
  );
}
