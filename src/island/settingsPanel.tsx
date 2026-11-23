import { useState } from 'react';
import { ChevronRight, ExternalLink, Monitor, Palette } from 'lucide-react';
import { version } from '../../zpack.json';
import { BAR_ITEMS, type BarItemId } from '../shared/barItems';
import logoUrl from '../shared/kotilo.svg';
import { readStored, STORED, writeStored } from '../shared/stored';
import { PanelHeader } from './components';
import { useNotifications } from './notifications';
import { useIsland } from './store';
import { openWindowsSettings } from './system';

/**
 * Settings: the way into About and Appearance, which items the bar shows (the tiling
 * direction and the right side's items), and which apps' notifications the island ignores. Turning a bar
 * item off writes the hidden list to the widgets' shared storage; the bar
 * follows at once.
 */
export function SettingsView() {
  const openPanel = useIsland((s) => s.openPanel);
  const closePanel = useIsland((s) => s.closePanel);
  const [hidden, setHidden] = useState<BarItemId[]>(() => {
    const list = readStored<unknown>(STORED.barHidden, []);
    return Array.isArray(list) ? (list as BarItemId[]) : [];
  });

  // Apps that have sent notifications, plus any muted earlier, in name order.
  const items = useNotifications((n) => n.items);
  const muted = useNotifications((n) => n.muted);
  const setMuted = useNotifications((n) => n.setMuted);
  const notifyApps = [...new Set([...items.map((n) => n.app), ...muted])].sort((a, b) => a.localeCompare(b));

  const toggle = (id: BarItemId) => {
    const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
    setHidden(next);
    writeStored(STORED.barHidden, next);
  };

  return (
    <div className="view-panel settings">
      <PanelHeader title="Settings" back />

      <button className="settings-link" onClick={() => openPanel('about')}>
        <span className="tile-icon about-icon">
          <img src={logoUrl} alt="" />
        </span>
        <span className="tile-text">
          <strong>About Kotilo</strong>
          <span>Version {version} · kotilo.dev</span>
        </span>
        <ChevronRight size={16} className="settings-chevron" />
      </button>

      <button className="settings-link" onClick={() => openPanel('appearance')}>
        <span className="tile-icon">
          <Palette size={16} />
        </span>
        <span className="tile-text">
          <strong>Appearance</strong>
          <span>Theme, wallpaper and window borders</span>
        </span>
        <ChevronRight size={16} className="settings-chevron" />
      </button>

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

      <div className="settings-list panel-scroll">
        <h3 className="section-title">Bar items</h3>
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

        <h3 className="section-title settings-section">Notifications from</h3>
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
