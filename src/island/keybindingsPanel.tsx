import { useEffect, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { PanelHeader } from './components';
import { comboFromEvent, formatCombo, usableCombo, useKeybindings, type Keybinding } from './keybindings';
import type { IslandOutputs } from './providers';

/** Keys that work inside the island's panels; fixed in the code, shown for reference. */
const ISLAND_KEYS: { keys: string; label: string }[] = [
  { keys: 'Esc', label: 'Close the open panel' },
  { keys: '↑ ↓ · Enter', label: 'Move through and open launcher or window list results' },
  { keys: 'Delete', label: 'Close the selected window in the window list' },
  { keys: ':  ?  ,  =', label: 'Launcher: emoji, web search, clipboard, calculator' },
];

type Recording = { line: number; index: number };

/**
 * Settings › Keybindings: Kotilo's and GlazeWM's shortcuts from GlazeWM's
 * config. A click on a key combination records a new one; GlazeWM is paused
 * while recording, or it would act on the keys before the island sees them.
 * Each change rewrites only that entry's line in the config and reloads it.
 */
export function KeybindingsView({ out, active }: { out: IslandOutputs; active: boolean }) {
  const { items, error, loading, filter, load, setFilter, save } = useKeybindings();
  const wm = out.glazewm;
  const [recording, setRecording] = useState<Recording | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (active) void load();
    else {
      // Leaving the page drops the filter; the launcher sets one just before opening it.
      setRecording(null);
      setFilter('');
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause GlazeWM while recording, and unpause on any way out (done, Esc, panel closed).
  useEffect(() => {
    if (!recording || !wm || wm.isPaused) return;
    void wm.runCommand('wm-toggle-pause');
    return () => void wm.runCommand('wm-toggle-pause');
  }, [recording != null]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (k: Keybinding, bindings: string[]) => {
    if (!wm) return setMessage('GlazeWM is not running');
    setMessage(null);
    void save(k, bindings, () => wm.runCommand('wm-reload-config')).catch((err) => setMessage(String(err)));
  };

  useEffect(() => {
    if (!recording || !items) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return setRecording(null);
      const combo = comboFromEvent(e);
      if (!combo) return; // only modifiers so far
      const k = items.find((i) => i.line === recording.line);
      if (!k) return setRecording(null);
      if (!usableCombo(combo)) return setMessage(`${formatCombo(combo)} alone would take over typing; add Ctrl, Alt, Shift or Win`);
      const taken = items.find((i) => i.bindings.includes(combo) && !(i.line === k.line && i.bindings[recording.index] === combo));
      if (taken) return setMessage(`${formatCombo(combo)} is already used by “${taken.label}”`);
      const next = [...k.bindings];
      next[recording.index] = combo;
      setRecording(null);
      apply(k, next);
    };
    // Capture phase, so the island's own Esc handler does not close the panel.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = filter.trim().toLowerCase();
  const shown = (items ?? []).filter(
    (k) => !q || k.label.toLowerCase().includes(q) || k.bindings.some((b) => b.includes(q) || formatCombo(b).toLowerCase().includes(q)),
  );
  const section = (owner: Keybinding['owner']) => shown.filter((k) => k.owner === owner);
  const islandKeys = ISLAND_KEYS.filter((k) => !q || k.label.toLowerCase().includes(q) || k.keys.toLowerCase().includes(q));

  const row = (k: Keybinding) => (
    <div key={k.line} className="kb-row">
      <span className="kb-label ellipsis" title={k.commands.join('\n')}>
        {k.label}
      </span>
      <span className="kb-keys">
        {k.bindings.map((b, i) => {
          const rec = recording?.line === k.line && recording.index === i;
          return (
            <span key={`${b}-${i}`} className={`kb-chip ${rec ? 'recording' : ''}`}>
              <button
                disabled={!k.editable}
                onClick={() => {
                  setMessage(null);
                  setRecording(rec ? null : { line: k.line, index: i });
                }}
                title={k.editable ? 'Click and press new keys' : 'Not a one-line list in the config; edit it there'}
              >
                {rec ? 'Press keys…' : formatCombo(b)}
              </button>
              {k.editable && k.bindings.length > 1 && !rec && (
                <button className="kb-remove" onClick={() => apply(k, k.bindings.filter((_, j) => j !== i))} aria-label={`Remove ${formatCombo(b)}`}>
                  <X size={10} />
                </button>
              )}
            </span>
          );
        })}
        {k.editable && k.bindings.length < 4 && (
          <button
            className={`kb-add ${recording?.line === k.line && recording.index === k.bindings.length ? 'recording' : ''}`}
            onClick={() => {
              setMessage(null);
              setRecording({ line: k.line, index: k.bindings.length });
            }}
            aria-label="Add a key combination"
            title="Add a key combination"
          >
            {recording?.line === k.line && recording.index === k.bindings.length ? 'Press keys…' : <Plus size={12} />}
          </button>
        )}
      </span>
    </div>
  );

  return (
    <div className="view-panel keybindings-panel">
      <PanelHeader title="Keybindings" back="settings" />
      <label className="search">
        <Search size={15} className="accent" />
        <input value={filter} placeholder="Filter by action or keys" spellCheck={false} onChange={(e) => setFilter(e.target.value)} />
      </label>
      {message && <p className="panel-error">{message}</p>}
      {error && <p className="panel-error ellipsis">{error}</p>}
      <div className="settings-list panel-scroll">
        {!items && loading && <span className="muted-text">Reading GlazeWM's config…</span>}
        {items && (
          <>
            <h3 className="section-title">Kotilo</h3>
            {section('kotilo').map(row)}
            {section('kotilo').length === 0 && <span className="muted-text">No Kotilo shortcuts{q ? ' match' : ''}.</span>}
            <h3 className="section-title settings-section">GlazeWM</h3>
            {section('glazewm').map(row)}
            {section('glazewm').length === 0 && <span className="muted-text">No GlazeWM shortcuts{q ? ' match' : ''}.</span>}
          </>
        )}
        {islandKeys.length > 0 && <h3 className="section-title settings-section">Inside the island</h3>}
        {islandKeys.map((k) => (
          <div key={k.keys} className="kb-row">
            <span className="kb-label ellipsis">{k.label}</span>
            <span className="kb-keys">
              <span className="kb-chip static">{k.keys}</span>
            </span>
          </div>
        ))}
        <p className="muted-text kb-note">Changes are written to GlazeWM's config (a backup is kept as config.yaml.bak-appearance) and reloaded at once.</p>
      </div>
    </div>
  );
}
