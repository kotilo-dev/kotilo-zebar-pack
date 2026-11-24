import { useRef } from 'react';
import { Droplets, MapPin, Sunrise, Sunset } from 'lucide-react';
import { PanelHeader } from './components';
import type { IslandOutputs } from './providers';
import { describeCode, useForecast, type Day } from './weather';
import { DEMO } from './demo';

const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const hour = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit' });
const deg = (v: number) => `${Math.round(v)}°`;

function dayName(t: number, i: number) {
  if (i === 0) return 'Today';
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short' });
}

/** Rain chance shown only when it is worth a look. */
const RainChance = ({ value }: { value: number }) =>
  value >= 20 ? (
    <span className="wx-rain">
      <Droplets size={11} />
      {Math.round(value)}%
    </span>
  ) : (
    <span className="wx-rain" />
  );

/**
 * The weather panel: now, the next 24 hours and the next 7 days, for the
 * approximate location of this computer's public IP address.
 */
export function WeatherView({ out, active }: { out: IslandOutputs; active: boolean }) {
  const ip = out.ip;
  const { forecast, error } = useForecast(active, ip?.approxLatitude ?? null, ip?.approxLongitude ?? null);
  const strip = useRef<HTMLDivElement>(null);

  if (!forecast) {
    return (
      <div className="view-panel weather-panel">
        <PanelHeader title="Weather" back />
        <span className="muted-text">{error ? `Could not load the forecast: ${error}` : ip ? 'Loading the forecast…' : 'Finding your location…'}</span>
      </div>
    );
  }

  const now = Date.now();
  const c = forecast.current;
  const [NowIcon, nowText] = describeCode(c.code, c.day);
  const today = forecast.days[0];
  // From the current hour on, 24 hours.
  const first = Math.max(0, forecast.hours.findIndex((h) => h.time + 3_600_000 > now));
  const hours = forecast.hours.slice(first, first + 24);
  const weekMin = Math.min(...forecast.days.map((d) => d.min));
  const weekMax = Math.max(...forecast.days.map((d) => d.max));

  return (
    <div className="view-panel weather-panel">
      <PanelHeader title="Weather" back />

      <section className="wx-now">
        <NowIcon size={44} className="accent" />
        <div className="wx-now-main">
          <span className="wx-now-temp">{deg(c.temp)}</span>
          <span className="wx-now-text">{nowText}</span>
        </div>
        <div className="wx-now-meta">
          {ip?.approxCity && !DEMO && (
            <span className="wx-place">
              <MapPin size={12} />
              {ip.approxCity}
            </span>
          )}
          {today && (
            <span>
              H {deg(today.max)} · L {deg(today.min)}
            </span>
          )}
          <span>
            Feels {deg(c.feels)} · Humidity {Math.round(c.humidity)}% · Wind {Math.round(c.wind)} km/h
          </span>
          {today && (
            <span className="wx-sun">
              <Sunrise size={12} /> {hhmm(today.sunrise)}
              <Sunset size={12} /> {hhmm(today.sunset)}
              {today.uv >= 1 && <> · UV {Math.round(today.uv)}</>}
            </span>
          )}
        </div>
      </section>

      <section className="wx-section">
        <h3 className="section-title">Next 24 hours</h3>
        <div
          className="wx-hours"
          ref={strip}
          // A mouse wheel scrolls the strip sideways.
          onWheel={(e) => {
            if (strip.current && e.deltaY) strip.current.scrollLeft += e.deltaY;
          }}
        >
          {hours.map((h, i) => {
            const [Icon] = describeCode(h.code, h.day);
            return (
              <div key={h.time} className={`wx-hour ${i === 0 ? 'now' : ''}`}>
                <span className="wx-hour-time">{i === 0 ? 'Now' : hour(h.time)}</span>
                <Icon size={18} />
                <span className="wx-hour-temp">{deg(h.temp)}</span>
                <RainChance value={h.rain} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="wx-section">
        <h3 className="section-title">7 days</h3>
        <div className="wx-days">
          {forecast.days.map((d, i) => (
            <DayRow key={d.time} day={d} index={i} weekMin={weekMin} weekMax={weekMax} now={i === 0 ? c.temp : null} />
          ))}
        </div>
      </section>

      <span className="wx-source">
        Open-Meteo · updated {hhmm(forecast.fetchedAt)}
        {error && ' · refresh failed'}
      </span>
    </div>
  );
}

/** One day: name, icon, rain chance, and its low-to-high range on the week's scale (today marks the current temperature). */
function DayRow({ day, index, weekMin, weekMax, now }: { day: Day; index: number; weekMin: number; weekMax: number; now: number | null }) {
  const [Icon, text] = describeCode(day.code);
  const span = Math.max(1, weekMax - weekMin);
  const left = ((day.min - weekMin) / span) * 100;
  const width = ((day.max - day.min) / span) * 100;
  const dot = now == null ? null : Math.min(100, Math.max(0, ((now - weekMin) / span) * 100));
  return (
    <div className="wx-day" title={text}>
      <span className="wx-day-name">{dayName(day.time, index)}</span>
      <Icon size={17} />
      <RainChance value={day.rain} />
      <span className="wx-day-min">{deg(day.min)}</span>
      <span className="wx-range">
        <span className="wx-range-fill" style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }} />
        {dot != null && <span className="wx-range-dot" style={{ left: `${dot}%` }} />}
      </span>
      <span className="wx-day-max">{deg(day.max)}</span>
    </div>
  );
}
