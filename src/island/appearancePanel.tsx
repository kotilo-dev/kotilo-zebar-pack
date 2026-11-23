import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { applyTheme, borderColors, chooseTheme, storedTheme, THEMES, type Theme } from '../shared/themes';
import type { IslandOutputs } from './providers';
import { useIsland } from './store';
import { listWallpapers, setBorderColors, setWallpaper, type Wallpaper } from './system';
import { PanelHeader } from './components';

const GROUPS: Theme['group'][] = ['Default', 'Classic', 'Popular', 'More', 'Light'];

type Walls = { folder: string; current: string | null; items: Wallpaper[] };
let wallpaperCache: Walls | null = null;

/** Whether the current wallpaper (a full path from the registry) is this file of the wallpaper folder. */
const isCurrent = (walls: Walls, file: string) =>
  !!walls.current && walls.current.toLowerCase() === `${walls.folder}\\${file}`.toLowerCase();

/**
 * Theme and wallpaper. Hovering a theme previews it on the island; clicking
 * makes it the theme of the bar, the island and GlazeWM's window borders.
 * Clicking a wallpaper sets it as the desktop background.
 */
export function AppearanceView({ out, active }: { out: IslandOutputs; active: boolean }) {
  const showBanner = useIsland((s) => s.showBanner);
  const [theme, setTheme] = useState(storedTheme);
  const [walls, setWalls] = useState(wallpaperCache);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A preview must not outlive the panel: put the chosen theme back when it closes.
  useEffect(() => {
    if (active) {
      setTheme(storedTheme());
      listWallpapers()
        .then((w) => {
          wallpaperCache = w;
          setWalls(w);
        })
        .catch((err) => setError(String(err)));
    } else {
      applyTheme(storedTheme());
    }
  }, [active]);

  const pickTheme = (t: Theme) => {
    chooseTheme(t.id);
    setTheme(t.id);
    setError(null);
    const { focused, other } = borderColors(t);
    setBorderColors(focused, other)
      // GlazeWM reads its config only on start or reload.
      .then((changed) => (changed ? out.glazewm?.runCommand('wm-reload-config') : undefined))
      .catch((err) => setError(`Window borders: ${String(err)}`));
  };

  const pickWallpaper = (w: Wallpaper) => {
    setBusy(w.file);
    setError(null);
    setWallpaper(w.file)
      .then((current) => {
        if (walls) {
          wallpaperCache = { ...walls, current };
          setWalls(wallpaperCache);
        }
        showBanner({ icon: 'check', title: 'Wallpaper set', sub: w.name }, 1800);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="view-panel appearance-panel">
      <PanelHeader title="Appearance" back="settings" />
      <div className="panel-scroll">
        <section onMouseLeave={() => applyTheme(theme)}>
          <h3 className="section-title">Theme</h3>
          {GROUPS.map((group) => (
            <div key={group} className="theme-group">
              {group !== 'Default' && <span className="theme-group-name">{group}</span>}
              <div className="theme-grid">
                {THEMES.filter((t) => t.group === group).map((t) => (
                  <button
                    key={t.id}
                    className={`theme-card ${t.id === theme ? 'on' : ''}`}
                    onMouseEnter={() => applyTheme(t.id)}
                    onClick={() => pickTheme(t)}
                    style={{ background: t.palette.surface, color: t.palette.text, borderColor: t.id === theme ? t.palette.accent : undefined }}
                  >
                    <span className="theme-swatches">
                      {[t.palette.bg, t.palette.accent, t.palette.ok, t.palette.danger].map((c, i) => (
                        <i key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="ellipsis">{t.name}</span>
                    {t.id === theme && <Check size={12} className="theme-check" style={{ color: t.palette.accent }} />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h3 className="section-title">Wallpaper</h3>
          {!walls && !error && <span className="muted-text">Loading wallpapers…</span>}
          {walls && walls.items.length === 0 && <span className="muted-text">No images in {walls.folder}</span>}
          <div className="wallpaper-grid">
            {walls?.items.map((w) => (
              <button
                key={w.file}
                className={`wallpaper ${isCurrent(walls, w.file) ? 'on' : ''} ${busy === w.file ? 'busy' : ''}`}
                onClick={() => pickWallpaper(w)}
                disabled={busy != null}
                title={w.name}
              >
                {w.thumb ? (
                  <img src={`data:image/jpeg;base64,${w.thumb}`} alt="" />
                ) : (
                  <span className="wallpaper-missing">No preview</span>
                )}
                <span className="wallpaper-name ellipsis">{w.name}</span>
                {isCurrent(walls, w.file) && (
                  <span className="wallpaper-check">
                    <Check size={12} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      </div>
      {error && <p className="panel-error ellipsis">{error}</p>}
    </div>
  );
}
