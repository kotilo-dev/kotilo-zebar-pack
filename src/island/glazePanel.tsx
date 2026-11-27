import { useEffect, useState, type ReactNode } from 'react';
import { FileCode } from 'lucide-react';
import { PanelHeader } from './components';
import { BEHAVIOR, effects, GAPS, GENERAL, numberRange, OUTER_GAP, useGlazeSettings, type Setting, type SettingKind } from './glazeSettings';
import type { IslandOutputs } from './providers';
import { useIsland } from './store';
import { openGlazeConfig, type GlazeValue } from './system';

type Save = (path: string, value: boolean | number | string) => void;

/** A number box that saves on Enter or when it loses focus; a value out of range goes back to the saved one. */
function NumberBox({ value, kind, disabled, label, onSave }: { value: number; kind: SettingKind; disabled?: boolean; label: string; onSave: (n: number) => void }) {
  const { max, unit } = numberRange(kind);
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isInteger(n) || n < 0 || n > max) return setText(String(value));
    if (n !== value) onSave(n);
  };
  return (
    <label className={`wm-number ${disabled ? 'disabled' : ''}`}>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={text}
        disabled={disabled}
        maxLength={3}
        onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span>{unit}</span>
    </label>
  );
}

/** One setting as a row: a switch, a segmented choice or a number box. */
function SettingRow({ s, values, save, extra }: { s: Setting; values: Record<string, GlazeValue>; save: Save; extra?: ReactNode }) {
  const value = values[s.path];
  const missing = value === null || value === undefined;
  const need = s.needs ? values[s.needs.path] : true;
  const off = s.needs ? (s.needs.when === undefined ? need !== true : need !== s.needs.when) : false;
  const hint = missing ? 'Not set in the config' : s.hint;
  const text = (
    <span className="settings-row-text">
      <span>{s.label}</span>
      {hint && <span className="muted-text">{hint}</span>}
    </span>
  );

  if (s.kind.type === 'bool' && !missing) {
    const on = value === true;
    return (
      <button className={`settings-row ${off ? 'wm-off' : ''}`} role="switch" aria-checked={on} onClick={() => save(s.path, !on)}>
        {text}
        {extra}
        <span className={`switch ${on ? 'on' : ''}`}>
          <i />
        </span>
      </button>
    );
  }
  return (
    <div className={`settings-row static ${off || missing ? 'wm-off' : ''}`}>
      {text}
      {extra}
      {!missing && s.kind.type === 'choice' && (
        <div className="segmented" role="radiogroup" aria-label={s.label}>
          {s.kind.options.map((o) => (
            <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => value !== o.value && save(s.path, o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {!missing && (s.kind.type === 'px' || s.kind.type === 'pct') && typeof value === 'number' && (
        <NumberBox value={value} kind={s.kind} disabled={off} label={s.label} onSave={(n) => save(s.path, n)} />
      )}
    </div>
  );
}

/**
 * Settings › Window manager: GlazeWM's settings other than its keybindings.
 * Switches, choices and sizes are written to GlazeWM's config (only that value
 * on its line) and GlazeWM reloads it; lists (workspaces, window rules, startup
 * commands) are shown as they are and edited in the file.
 */
export function GlazeSettingsView({ out, active }: { out: IslandOutputs; active: boolean }) {
  const { config, error, load, save } = useGlazeSettings();
  const openPanel = useIsland((s) => s.openPanel);
  const closePanel = useIsland((s) => s.closePanel);
  const wm = out.glazewm;
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (active) void load();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply: Save = (path, value) => {
    if (!wm) return setMessage('GlazeWM is not running');
    setMessage(null);
    void save(path, value, () => wm.runCommand('wm-reload-config')).catch((err) => setMessage(String(err)));
  };

  const values = config?.values ?? {};
  const row = (s: Setting, extra?: ReactNode) => <SettingRow key={s.path} s={s} values={values} save={apply} extra={extra} />;
  const swatch = (colour: string | null | undefined) =>
    colour ? (
      <span className="wm-swatch" style={{ background: colour }} title={`${colour}: set by the theme in Appearance`} />
    ) : null;
  const commandList = (title: string, list: string[] | null | undefined) =>
    list && list.length > 0 ? (
      <div className="wm-commands">
        <span className="muted-text">{title}</span>
        {list.map((c, i) => (
          <code key={i}>{c}</code>
        ))}
      </div>
    ) : null;

  return (
    <div className="view-panel settings wm-settings">
      <PanelHeader title="Window manager" back="settings" />
      {message && <p className="panel-error">{message}</p>}
      {error && <p className="panel-error ellipsis">{error}</p>}
      <div className="settings-list panel-scroll">
        {!config && !error && <span className="muted-text">Reading GlazeWM's config…</span>}
        {config && (
          <>
            <h3 className="section-title">General</h3>
            {GENERAL.map((s) => row(s))}

            <h3 className="section-title settings-section">Gaps</h3>
            {GAPS.map((s) => row(s))}
            <div className="settings-row static">
              <span className="settings-row-text">
                <span>Around the screen</span>
                <span className="muted-text">Top leaves room for the bar</span>
              </span>
              <div className="wm-sides">
                {OUTER_GAP.map((g) => {
                  const v = values[g.path];
                  return typeof v === 'number' ? (
                    <span key={g.path} className="wm-side">
                      <NumberBox value={v} kind={{ type: 'px' }} label={`${g.label} gap`} onSave={(n) => apply(g.path, n)} />
                      <span className="muted-text">{g.label}</span>
                    </span>
                  ) : null;
                })}
              </div>
            </div>

            {(['focused_window', 'other_windows'] as const).map((section) => (
              <div key={section} className="wm-group">
                <h3 className="section-title settings-section">{section === 'focused_window' ? 'Focused window' : 'Other windows'}</h3>
                {effects(section).map((s, i) => row(s, i === 0 ? swatch(config.colours[section]) : undefined))}
              </div>
            ))}
            <p className="muted-text wm-note">
              Border colours follow the theme.{' '}
              <button className="wm-link" onClick={() => openPanel('appearance')}>
                Change in Appearance
              </button>
            </p>

            <h3 className="section-title settings-section">Window behavior</h3>
            {BEHAVIOR.map((s) => row(s))}

            <h3 className="section-title settings-section">Workspaces</h3>
            <div className="wm-chips">
              {config.workspaces.map((w, i) => (
                <span key={i} className="wm-chip" title={w.monitor != null ? `Monitor ${w.monitor}` : undefined}>
                  {w.displayName ?? w.name ?? '?'}
                  {w.displayName && w.name && w.displayName !== w.name && <span className="muted-text"> {w.name}</span>}
                  {w.monitor != null && <span className="muted-text"> · M{w.monitor}</span>}
                </span>
              ))}
              {config.workspaces.length === 0 && <span className="muted-text">None in the config</span>}
            </div>

            <h3 className="section-title settings-section">Window rules</h3>
            {config.rules.length === 0 && <span className="muted-text">None in the config</span>}
            {config.rules.map((r, i) => (
              <div key={i} className="wm-rule">
                <div className="wm-chips">
                  {r.commands.map((c, j) => (
                    <span key={j} className="wm-chip accent">
                      {c}
                    </span>
                  ))}
                  <span className="muted-text">
                    for {r.match.length} {r.match.length === 1 ? 'match' : 'matches'}
                  </span>
                </div>
                {r.match.map((m, j) => (
                  <code key={j} className="wm-match">
                    {m}
                  </code>
                ))}
              </div>
            ))}

            <h3 className="section-title settings-section">Commands</h3>
            {commandList('On start', config.commands.startup)}
            {commandList('On exit', config.commands.shutdown)}
            {commandList('On config reload', config.commands.reload)}

            <button
              className="settings-link wm-open"
              onClick={() => {
                closePanel();
                void openGlazeConfig().catch((err) => console.warn('[kotilo] glazewm config', err));
              }}
            >
              <span className="tile-icon">
                <FileCode size={16} />
              </span>
              <span className="tile-text">
                <strong>Edit config file</strong>
                <span>Workspaces, rules and commands are changed in the file</span>
              </span>
            </button>
            <p className="muted-text kb-note">Changes are written to GlazeWM's config (a backup is kept as config.yaml.bak-appearance) and reloaded at once.</p>
          </>
        )}
      </div>
    </div>
  );
}
