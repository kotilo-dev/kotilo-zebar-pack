import { useEffect } from 'react';
import { create } from 'zustand';
import { POMODORO_MIN, POMODORO_ROUNDS, type PomodoroPhase, type SharedTimer } from '../shared/liveTimer';
import { STORED, writeStored } from '../shared/stored';

export { formatDuration, useNow } from '../shared/liveTimer';

/**
 * Timer, stopwatch and pomodoro. They keep running while their panel is closed; the
 * bar then shows them on its right side. Times are wall-clock based
 * (`Date.now()`), so a slow or throttled frame never makes them drift.
 */
type TimerState = {
  /** Countdown length chosen by the user, in ms. */
  duration: number;
  /** When the running countdown ends, or null while it is stopped. */
  endsAt: number | null;
  /** What is left while paused, or null when not paused. */
  pausedLeft: number | null;

  /** When the stopwatch was last started, or null while stopped. */
  swStartedAt: number | null;
  /** Time collected before the last start. */
  swBanked: number;
  laps: number[];

  setDuration: (ms: number) => void;
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  startStopwatch: () => void;
  pauseStopwatch: () => void;
  lap: () => void;
  resetStopwatch: () => void;

  /** Pomodoro: the current phase, the focus round within a set (1..4), and its clock like the countdown's. */
  pomoPhase: PomodoroPhase;
  pomoRound: number;
  pomoEndsAt: number | null;
  pomoPausedLeft: number | null;
  startPomodoro: () => void;
  pausePomodoro: () => void;
  resetPomodoro: () => void;
  /** Moves to the following phase; `start` starts its clock at once. */
  nextPomodoro: (start: boolean) => void;
};

export const useTimer = create<TimerState>((set, get) => ({
  duration: 5 * 60_000,
  endsAt: null,
  pausedLeft: null,
  swStartedAt: null,
  swBanked: 0,
  laps: [],
  pomoPhase: 'work',
  pomoRound: 1,
  pomoEndsAt: null,
  pomoPausedLeft: null,

  setDuration: (ms) => set({ duration: Math.max(60_000, Math.min(ms, 24 * 3_600_000)), endsAt: null, pausedLeft: null }),
  startTimer: () => {
    const { pausedLeft, duration } = get();
    set({ endsAt: Date.now() + (pausedLeft ?? duration), pausedLeft: null });
  },
  pauseTimer: () => {
    const { endsAt } = get();
    if (endsAt) set({ endsAt: null, pausedLeft: Math.max(0, endsAt - Date.now()) });
  },
  resetTimer: () => set({ endsAt: null, pausedLeft: null }),

  startStopwatch: () => set({ swStartedAt: Date.now() }),
  pauseStopwatch: () => {
    const { swStartedAt, swBanked } = get();
    if (swStartedAt) set({ swStartedAt: null, swBanked: swBanked + Date.now() - swStartedAt });
  },
  lap: () => set({ laps: [stopwatchElapsed(get(), Date.now()), ...get().laps].slice(0, 20) }),
  resetStopwatch: () => set({ swStartedAt: null, swBanked: 0, laps: [] }),

  startPomodoro: () => {
    const { pomoPausedLeft, pomoPhase } = get();
    // `||`: a pause that landed exactly at 0 starts the phase over instead of ending it at once.
    set({ pomoEndsAt: Date.now() + (pomoPausedLeft || phaseMs(pomoPhase)), pomoPausedLeft: null });
  },
  pausePomodoro: () => {
    const { pomoEndsAt } = get();
    if (pomoEndsAt) set({ pomoEndsAt: null, pomoPausedLeft: Math.max(0, pomoEndsAt - Date.now()) });
  },
  resetPomodoro: () => set({ pomoPhase: 'work', pomoRound: 1, pomoEndsAt: null, pomoPausedLeft: null }),
  nextPomodoro: (start) => {
    const next = following(get().pomoPhase, get().pomoRound);
    set({ ...next, pomoPausedLeft: null, pomoEndsAt: start ? Date.now() + phaseMs(next.pomoPhase) : null });
  },
}));

export const timerLeft = (s: Pick<TimerState, 'endsAt' | 'pausedLeft' | 'duration'>, now: number) =>
  s.endsAt ? Math.max(0, s.endsAt - now) : s.pausedLeft ?? s.duration;

export const stopwatchElapsed = (s: Pick<TimerState, 'swStartedAt' | 'swBanked'>, now: number) =>
  s.swBanked + (s.swStartedAt ? now - s.swStartedAt : 0);

const phaseMs = (phase: PomodoroPhase) => POMODORO_MIN[phase] * 60_000;

export const pomodoroLeft = (s: Pick<TimerState, 'pomoPhase' | 'pomoEndsAt' | 'pomoPausedLeft'>, now: number) =>
  s.pomoEndsAt ? Math.max(0, s.pomoEndsAt - now) : s.pomoPausedLeft ?? phaseMs(s.pomoPhase);

/** The phase after this one: a break after focus (long after the last round), focus after a break. */
function following(phase: PomodoroPhase, round: number): { pomoPhase: PomodoroPhase; pomoRound: number } {
  if (phase === 'work') return { pomoPhase: round >= POMODORO_ROUNDS ? 'long' : 'short', pomoRound: round };
  return { pomoPhase: 'work', pomoRound: phase === 'long' ? 1 : round + 1 };
}

/**
 * Keeps the bar's timer readout current: writes the running timers to the
 * widgets' shared storage on every change (see `SharedTimer`). Runs from the
 * start, so a timer left over from before a restart is cleared.
 */
export function useShareTimer() {
  useEffect(() => {
    const write = (t: TimerState) => {
      const running = t.endsAt != null || t.swStartedAt != null || t.pomoEndsAt != null;
      const shared: SharedTimer = running
        ? {
            endsAt: t.endsAt,
            swStartedAt: t.swStartedAt,
            swBanked: t.swBanked,
            pomodoro: t.pomoEndsAt != null ? { phase: t.pomoPhase, endsAt: t.pomoEndsAt } : null,
          }
        : null;
      writeStored(STORED.timer, shared);
    };
    write(useTimer.getState());
    return useTimer.subscribe(write);
  }, []);
}

/** A soft two-note chime, synthesised so the pack ships no sound files. */
export function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.18;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.65);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    // No audio device: the banner alone has to do.
  }
}
