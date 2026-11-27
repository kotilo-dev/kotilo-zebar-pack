import { useState } from 'react';
import type { ReactNode } from 'react';
import { Bell, ChevronRight, ExternalLink, Keyboard, LayoutGrid, Monitor, PanelTop, Palette } from 'lucide-react';
import { version } from '../../zpack.json';
import { BAR_ITEMS, type BarItemId } from '../shared/barItems';
import { KotiloMark } from '../shared/KotiloMark';
import { readStored, STORED, useStored, writeStored } from '../shared/stored';
import {
  BAR_OPACITIES,
  BAR_STYLES,
  DEFAULT_BAR_OPACITY,
  DEFAULT_BAR_STYLE,
  isBarOpacity,
  isBarStyle,
  type BarOpacity,
  type BarStyle,
} from '../shared/barStyle';
import {
  DEFAULT_WORKSPACE_STYLE,
  isWorkspaceStyle,
  WORKSPACE_STYLES,
  type WorkspaceStyle,
} from '../shared/workspaceStyle';
import { PanelHeader } from './components';
import { useNotifications } from './notifications';
import { useIsland, type PanelId } from './store';
import { openWindowsSettings } from './system';

/** A row on the Settings page that opens one of its pages. */
function SettingsLink({ icon, title, sub, panel }: { icon: ReactNode; title: string; sub: string; panel: PanelId }) {
  const openPanel = useIsland((s) => s.openPanel);
  return (
    <button className="settings-link" onClick={() => openPanel(panel)}>
      <span className="tile-icon">{icon}</span>
      <span className="tile-text">
        <strong>{title}</strong>
        <span>{sub}</span>
      </span>
      <ChevronRight size={16} className="settings-chevron" />
    </button>
  );
}

/**
 * Settings: About, then one row per group of settings (each opens its own
 * page), and the way out to Windows Settings at the bottom.
 */
export function SettingsView() {
  const openPanel = useIsland((s) => s.openPanel);
  const closePanel = useIsland((s) => s.closePanel);
  return (
    <div className="view-panel settings">
      <PanelHeader title="Settings" back />

      <button className="settings-link" onClick={() => openPanel('about')}>
        <span className="tile-icon about-icon">
          <KotiloMark />
        </span>
        <span className="tile-text">
          <strong>About Kotilo</strong>
          <span>Version {version} · kotilo.dev</span>
        </span>
        <ChevronRight size={16} className="settings-chevron" />
      </button>

      <h3 className="section-title settings-section">Kotilo</h3>
      <SettingsLink icon={<Palette size={16} />} title="Appearance" sub="Theme, wallpaper and window borders" panel="appearance" />
      <SettingsLink icon={<PanelTop size={16} />} title="Bar & workspaces" sub="Bar style, opacity, workspace numbers, bar items" panel="bar-settings" />
      <SettingsLink icon={<Bell size={16} />} title="Notifications" sub="Which apps the island shows" panel="notify-settings" />
      <SettingsLink icon={<Keyboard size={16} />} title="Keybindings" sub="Kotilo's and GlazeWM's shortcuts" panel="keybindings" />
      <SettingsLink icon={<LayoutGrid size={16} />} title="Window manager" sub="GlazeWM gaps, window effects and behavior" panel="wm-settings" />

      <h3 className="section-title settings-section">System</h3>
      <button
        className="settings-link"
        onClick={() => {
          closePanel();
          void openWindowsSettings().catch((err) => console.warn('[kotilo] settings', err));
        }}
      >
        <span className="tile-icon">
          <Monitor size={16} />
        </span>
        <span className="tile-text">
          <strong>Windows Settings</strong>
          <span>Open the system settings app</span>
        </span>
        <ExternalLink size={15} className="settings-chevron" />
      </button>
    </div>
  );
}

/**
 * Settings › Bar & workspaces: the bar's style and opacity, how it draws
 * workspaces, and which items it shows. The choices live in the widgets' shared
 * storage, so the bar follows at once.
 */
export function BarSettingsView() {
  const [hidden, setHidden] = useState<BarItemId[]>(() => {
    const list = readStored<unknown>(STORED.barHidden, []);
    return Array.isArray(list) ? (list as BarItemId[]) : [];
  });

  // Writing these updates this panel and the bar at once (and the panel follows a change made elsewhere).
  const storedBarStyle = useStored<unknown>(STORED.barStyle, DEFAULT_BAR_STYLE);
  const barStyle: BarStyle = isBarStyle(storedBarStyle) ? storedBarStyle : DEFAULT_BAR_STYLE;
  const storedBarOpacity = useStored<unknown>(STORED.barOpacity, DEFAULT_BAR_OPACITY);
  const barOpacity: BarOpacity = isBarOpacity(storedBarOpacity) ? storedBarOpacity : DEFAULT_BAR_OPACITY;
  const storedWsStyle = useStored<unknown>(STORED.workspaceStyle, DEFAULT_WORKSPACE_STYLE);
  const wsStyle: WorkspaceStyle = isWorkspaceStyle(storedWsStyle) ? storedWsStyle : DEFAULT_WORKSPACE_STYLE;

  const toggle = (id: BarItemId) => {
    const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
    setHidden(next);
    writeStored(STORED.barHidden, next);
  };

  return (
    <div className="view-panel settings">
      <PanelHeader title="Bar & workspaces" back="settings" />
      <div className="settings-list panel-scroll">
        <h3 className="section-title">Bar</h3>
        <div className="option-cards three" role="radiogroup" aria-label="Bar style">
          {BAR_STYLES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={barStyle === s.id}
              className={barStyle === s.id ? 'on' : ''}
              onClick={() => writeStored(STORED.barStyle, s.id)}
            >
              <span className={`bar-sample ${s.id}`} aria-hidden>
                <i />
                <i />
              </span>
              <span className="muted-text">{s.label}</span>
            </button>
          ))}
        </div>
        <div className="settings-row static">
          <span className="settings-row-text">
            <span>Opacity</span>
            <span className="muted-text">The bar's and the island's background</span>
          </span>
          <div className="segmented" role="radiogroup" aria-label="Bar opacity">
            {BAR_OPACITIES.map((o) => (
              <button
                key={o}
                role="radio"
                aria-checked={barOpacity === o}
                className={barOpacity === o ? 'on' : ''}
                onClick={() => writeStored(STORED.barOpacity, o)}
              >
                {o}%
              </button>
            ))}
          </div>
        </div>

        <h3 className="section-title settings-section">Workspaces</h3>
        <div className="option-cards" role="radiogroup" aria-label="Workspace style">
          {WORKSPACE_STYLES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={wsStyle === s.id}
              className={wsStyle === s.id ? 'on' : ''}
              onClick={() => writeStored(STORED.workspaceStyle, s.id)}
            >
              <span className="option-sample">{s.sample}</span>
              <span className="muted-text">{s.label}</span>
            </button>
          ))}
        </div>

        <h3 className="section-title settings-section">Bar items</h3>
        {BAR_ITEMS.map((item) => {
          const on = !hidden.includes(item.id);
          return (
            <button key={item.id} className="settings-row" role="switch" aria-checked={on} onClick={() => toggle(item.id)}>
              <span className="settings-row-text">
                <span>{item.label}</span>
                <span className="muted-text">{item.hint}</span>
              </span>
              <span className={`switch ${on ? 'on' : ''}`}>
                <i />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Settings › Notifications: which apps' notifications the island ignores. */
export function NotificationSettingsView() {
  // Apps that have sent notifications, plus any muted earlier, in name order.
  const items = useNotifications((n) => n.items);
  const muted = useNotifications((n) => n.muted);
  const setMuted = useNotifications((n) => n.setMuted);
  const notifyApps = [...new Set([...items.map((n) => n.app), ...muted])].sort((a, b) => a.localeCompare(b));

  return (
    <div className="view-panel settings">
      <PanelHeader title="Notifications" back="settings" />
      <div className="settings-list panel-scroll">
        <h3 className="section-title">Notifications from</h3>
        {notifyApps.length === 0 && <span className="muted-text">Apps show up here once they send a notification.</span>}
        {notifyApps.map((app) => {
          const on = !muted.includes(app);
          return (
            <button key={app} className="settings-row" role="switch" aria-checked={on} onClick={() => setMuted(app, on)}>
              <span className="settings-row-text">
                <span>{app}</span>
                <span className="muted-text">{on ? 'Shown in the island and counted on the bar' : 'Ignored by the island'}</span>
              </span>
              <span className={`switch ${on ? 'on' : ''}`}>
                <i />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
