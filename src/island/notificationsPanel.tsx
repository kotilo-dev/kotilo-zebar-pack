import { useEffect, useMemo, useState } from 'react';
import { BellOff, Settings, Trash2, X } from 'lucide-react';
import { PanelHeader } from './components';
import { useNotifications, visibleNotifications } from './notifications';
import { cachedAppIcon } from './panels';
import { useIsland } from './store';
import { openNotificationSettings, showNotificationApp, type WinNotification } from './system';

function ago(time: number, now: number) {
  const s = Math.max(0, Math.round((now - time) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/**
 * The Windows notification centre, grouped by app, newest group first. A click
 * brings the app's open window forward, or starts it when it has none (Windows
 * lets no one else press a notification's own buttons);
 * × removes a notification from Windows too. Apps muted in Settings are left out.
 */
export function NotificationsView({ active }: { active: boolean }) {
  const store = useNotifications();
  const closePanel = useIsland((s) => s.closePanel);
  const [armedClear, setArmedClear] = useState(false);

  useEffect(() => {
    if (!active) setArmedClear(false);
  }, [active]);
  useEffect(() => {
    if (!armedClear) return;
    const t = setTimeout(() => setArmedClear(false), 3000);
    return () => clearTimeout(t);
  }, [armedClear]);

  const visible = visibleNotifications(store);
  const groups = useMemo(() => {
    const byApp = new Map<string, WinNotification[]>();
    for (const n of visible) byApp.set(n.app, [...(byApp.get(n.app) ?? []), n]);
    return [...byApp.entries()];
  }, [visible]);

  const open = (n: WinNotification) => {
    if (!n.aumid) return;
    closePanel();
    showNotificationApp(n).catch((err) => console.warn('[kotilo] open app', err));
  };

  const clearAll = () => {
    if (!armedClear) return setArmedClear(true);
    setArmedClear(false);
    store.remove(visible.map((n) => n.id));
  };

  const now = Date.now();
  return (
    <div className="view-panel notifications">
      <PanelHeader title="Notifications" back />
      <div className="clip-toolbar">
        <span className="muted-text notify-count">
          {visible.length === 0 ? 'No notifications' : `${visible.length} ${visible.length === 1 ? 'notification' : 'notifications'}`}
        </span>
        <button className="chip-button" onClick={() => void openNotificationSettings()} title="Windows notification settings">
          <Settings size={13} /> Windows
        </button>
        <button className={`chip-button ${armedClear ? 'danger' : ''}`} onClick={clearAll} disabled={visible.length === 0}>
          <Trash2 size={13} /> {armedClear ? 'Click again' : 'Clear all'}
        </button>
      </div>

      <div className="notify-list panel-scroll">
        {store.access != null && store.access !== 'Allowed' && (
          <span className="muted-text">
            Windows does not let Kotilo read notifications. Turn on notification access in Settings › Privacy & security ›
            Notifications.
          </span>
        )}
        {store.access === 'Allowed' && visible.length === 0 && (
          <span className="notify-empty muted-text">
            <BellOff size={18} /> You are all caught up
          </span>
        )}
        {groups.map(([app, list]) => (
          <section key={app} className="notify-group">
            <div className="notify-group-head">
              {cachedAppIcon(list[0].aumid) ? (
                <img className="notify-app-icon" src={cachedAppIcon(list[0].aumid)} alt="" />
              ) : (
                <span className="result-avatar notify-app-icon">{app.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="ellipsis">{app}</span>
              <span className="muted-text">{list.length}</span>
              <button className="clip-delete notify-group-clear" aria-label={`Clear ${app}`} onClick={() => store.remove(list.map((n) => n.id))}>
                <X size={13} />
              </button>
            </div>
            {list.map((n) => (
              <div key={n.id} className="clip-item notify-item" onClick={() => open(n)} title={n.aumid ? `Open ${app}` : undefined}>
                <span className="clip-body">
                  <strong className="notify-title ellipsis">{n.title}</strong>
                  {n.body && <span className="clip-text">{n.body}</span>}
                </span>
                <span className="clip-time">{ago(n.time, now)}</span>
                <button
                  className="clip-delete"
                  aria-label="Remove notification"
                  onClick={(e) => {
                    e.stopPropagation();
                    store.remove([n.id]);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </section>
        ))}
        {store.error && <p className="panel-error ellipsis">{store.error}</p>}
      </div>
    </div>
  );
}
