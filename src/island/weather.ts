import { useEffect, useState } from 'react';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react';

/**
 * Hourly and daily forecasts from Open-Meteo (the free service Zebar's own
 * weather provider uses; no key needed). Zebar's provider only gives the
 * current weather, so the forecast panel asks Open-Meteo directly, with the
 * approximate location from Zebar's `ip` provider. A forecast is reused for
 * 15 minutes, and the last one is kept in storage so the panel opens filled.
 */

export type Hour = { time: number; temp: number; code: number; rain: number; day: boolean };
export type Day = { time: number; min: number; max: number; code: number; rain: number; sunrise: number; sunset: number; uv: number };
export type Forecast = {
  fetchedAt: number;
  lat: number;
  lon: number;
  current: { temp: number; feels: number; humidity: number; wind: number; code: number; day: boolean };
  hours: Hour[];
  days: Day[];
};

const CACHE_KEY = 'kotilo.weather.forecast.v1';
const FRESH_MS = 15 * 60_000;

function readCache(): Forecast | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Forecast | null;
  } catch {
    return null;
  }
}

/** Same place for caching purposes: within about 10 km. */
const samePlace = (f: Forecast, lat: number, lon: number) => Math.abs(f.lat - lat) < 0.1 && Math.abs(f.lon - lon) < 0.1;

async function fetchForecast(lat: number, lon: number): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '7',
    wind_speed_unit: 'kmh',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
  const j = await res.json();
  const ms = (s: number) => s * 1000;
  const c = j.current;
  const h = j.hourly;
  const d = j.daily;
  return {
    fetchedAt: Date.now(),
    lat,
    lon,
    current: {
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m,
      code: c.weather_code,
      day: c.is_day === 1,
    },
    hours: (h.time as number[]).map((t, i) => ({
      time: ms(t),
      temp: h.temperature_2m[i],
      code: h.weather_code[i],
      rain: h.precipitation_probability[i] ?? 0,
      day: h.is_day[i] === 1,
    })),
    days: (d.time as number[]).map((t, i) => ({
      time: ms(t),
      min: d.temperature_2m_min[i],
      max: d.temperature_2m_max[i],
      code: d.weather_code[i],
      rain: d.precipitation_probability_max[i] ?? 0,
      sunrise: ms(d.sunrise[i]),
      sunset: ms(d.sunset[i]),
      uv: d.uv_index_max[i] ?? 0,
    })),
  };
}

let inflight: Promise<Forecast> | null = null;

/**
 * The forecast for a place, refreshed while `active` when the kept one is
 * older than 15 minutes or for another place. `error` is set when a refresh
 * fails; the last forecast stays visible meanwhile.
 */
export function useForecast(active: boolean, lat: number | null, lon: number | null) {
  const [forecast, setForecast] = useState<Forecast | null>(readCache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active || lat == null || lon == null) return;
    const kept = readCache();
    if (kept && samePlace(kept, lat, lon) && Date.now() - kept.fetchedAt < FRESH_MS) {
      setForecast(kept);
      return;
    }
    let cancelled = false;
    inflight ??= fetchForecast(lat, lon).finally(() => (inflight = null));
    inflight
      .then((f) => {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(f));
        } catch {
          // Storage unavailable: the forecast is simply fetched again next time.
        }
        if (!cancelled) {
          setForecast(f);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(String(err?.message ?? err)));
    return () => {
      cancelled = true;
    };
  }, [active, lat, lon]);
  return { forecast, error };
}

/** A WMO weather code as an icon (day or night) and a short label. */
export function describeCode(code: number, day = true): [LucideIcon, string] {
  if (code === 0) return [day ? Sun : Moon, 'Clear'];
  if (code === 1) return [day ? Sun : Moon, 'Mostly clear'];
  if (code === 2) return [day ? CloudSun : CloudMoon, 'Partly cloudy'];
  if (code === 3) return [Cloud, 'Overcast'];
  if (code === 45 || code === 48) return [CloudFog, 'Fog'];
  if (code >= 51 && code <= 57) return [CloudDrizzle, 'Drizzle'];
  if (code >= 61 && code <= 67) return [CloudRain, code >= 65 ? 'Heavy rain' : 'Rain'];
  if (code >= 71 && code <= 77) return [CloudSnow, 'Snow'];
  if (code >= 80 && code <= 82) return [day ? CloudSunRain : CloudMoonRain, 'Showers'];
  if (code === 85 || code === 86) return [CloudSnow, 'Snow showers'];
  if (code >= 95) return [CloudLightning, 'Thunderstorm'];
  return [Cloud, 'Cloudy'];
}
