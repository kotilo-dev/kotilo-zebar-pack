import { useEffect, useState } from 'react';

export type PomodoroPhase = 'work' | 'short' | 'long';

/** Phase lengths in minutes: 25 focus, 5 short break, 15 long break after every 4th round. */
export const POMODORO_MIN: Record<PomodoroPhase, number> = { work: 25, short: 5, long: 15 };
export const POMODORO_ROUNDS = 4;

export const POMODORO_LABEL: Record<PomodoroPhase, string> = { work: 'Focus', short: 'Short break', long: 'Long break' };

/**
 * The running timers as the island shares them with the bar (under
 * `STORED.timer`, see `src/shared/stored.ts`). The timers live in the island's
 * window; the bar counts on its own clock from these times. Null while nothing runs.
 */
export type SharedTimer = {
  endsAt: number | null;
  swStartedAt: number | null;
  swBanked: number;
  pomodoro: { phase: PomodoroPhase; endsAt: number } | null;
} | null;

/** The current time, refreshed every `ms` while `active`. */
export function useNow(active: boolean, ms = 250) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** m:ss, or h:mm:ss from an hour up; `tenths` adds one decimal for the stopwatch. */
export function formatDuration(ms: number, tenths = false) {
  const total = tenths ? Math.floor(ms / 100) : Math.ceil(ms / 1000);
  const t = tenths ? total % 10 : 0;
  const secs = tenths ? Math.floor(total / 10) : total;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const core = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return tenths ? `${core}.${t}` : core;
}
