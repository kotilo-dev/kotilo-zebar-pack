import { useEffect } from 'react';
import { create } from 'zustand';
import { Coffee, Mic, MicOff, Moon, ScanLine, Sun, SunDim } from 'lucide-react';
import { STORED, writeStored } from '../shared/stored';
import { DottedMeter } from './components';
import type { IslandOutputs } from './providers';
import { useIsland, type IslandMode } from './store';
import {
  openScreenClip,
  setAppTheme,
  setBrightness,
  setKeepAwake,
  tweaksStatus,
  type Tweaks,
} from './system';

type TweaksStore = {
  state: Tweaks | null;
  error: string | null;
  /** A switch's request is on its way; the switches wait, so a double click cannot send the same change twice. */
  busy: boolean;
  refresh: () => void;
  apply: (change: Promise<Tweaks>) => void;
  /** Called on every step of a drag; sends one request at a time and only the latest level. */
  brightness: (level: number) => void;
};

const MIN_BRIGHTNESS = 5;
let brightnessBusy = false;
let brightnessNext: number | null = null;

/** Keep awake, app theme and brightness, read from scripts/tweaks.ps1. */
export const useTweaks = create<TweaksStore>((set, get) => {
  const settle = (state: Tweaks) => {
    set({ state, error: null, busy: false });
    // The bar shows a cup while keep awake is on.
    writeStored(STORED.awake, state.awake);
  };
  /**
   * A failed request may mean the helper was killed (a timeout), and with it
   * Windows dropped keep awake. Read the real state again from a fresh helper;
   * if even that fails, show nothing rather than a switch that lies.
   */
  const fail = (err: unknown) => {
    set({ error: String(err), busy: false });
    tweaksStatus().then(settle, () => {
      set({ state: null });
      writeStored(STORED.awake, false);
    });
  };

  // A brightness answer reads the level back, which can lag behind the drag
  // (or behind the panel's own fade); keep the level the user picked.
  const settleBrightness = (answer: Tweaks) => {
    const level = get().state?.brightness ?? answer.brightness;
    settle({ ...answer, brightness: level });
  };

  const sendBrightness = (level: number) => {
    brightnessBusy = true;
    setBrightness(level)
      .then(settleBrightness, fail)
      .finally(() => {
        brightnessBusy = false;
        if (brightnessNext != null) {
          const next = brightnessNext;
          brightnessNext = null;
          sendBrightness(next);
        }
      });
  };

  return {
    state: null,
    error: null,
    busy: false,
    refresh: () => void tweaksStatus().then(settle, fail),
    apply: (change) => {
      set({ busy: true });
      void change.then(settle, fail);
    },
    brightness: (raw) => {
      // Never fully dark: at 0 many panels go black and the slider cannot be found again.
      const level = Math.max(MIN_BRIGHTNESS, raw);
      const state = get().state;
      if (state) set({ state: { ...state, brightness: level } });
      if (brightnessBusy) brightnessNext = level;
      else sendBrightness(level);
    },
  };
});

/**
 * Reads the toggles once at start (which also clears a keep-awake flag left in
 * storage from before a restart: the helper starts with it off) and again each
 * time the control centre opens.
 */
export function useTweaksPolling(mode: IslandMode) {
  useEffect(() => {
    if (mode === 'control') useTweaks.getState().refresh();
  }, [mode]);
  useEffect(() => {
    writeStored(STORED.awake, false);
    useTweaks.getState().refresh();
  }, []);
}

/** Four round switches under the tiles: microphone, keep awake, dark mode, screen snip. */
export function QuickToggles({ out }: { out: IslandOutputs }) {
  const audio = out.audio;
  const mic = audio?.defaultRecordingDevice;
  const tweaks = useTweaks((t) => t.state);
  const busy = useTweaks((t) => t.busy);
  const apply = useTweaks((t) => t.apply);
  const closePanel = useIsland((s) => s.closePanel);

  const snip = () => {
    closePanel();
    // After the island has shrunk back, so it is not in the picture.
    setTimeout(() => void openScreenClip(), 350);
  };

  return (
    <div className="quick-row">
      <QuickButton
        on={!!mic && !mic.isMuted}
        warn={!!mic?.isMuted}
        disabled={!mic}
        icon={mic?.isMuted ? <MicOff size={15} /> : <Mic size={15} />}
        label={!mic ? 'No mic' : mic.isMuted ? 'Mic off' : 'Mic on'}
        title={mic ? mic.name : 'No microphone'}
        onClick={() => mic && audio?.setMute(!mic.isMuted, { deviceId: mic.deviceId })}
      />
      <QuickButton
        on={!!tweaks?.awake}
        disabled={!tweaks || busy}
        icon={<Coffee size={15} />}
        label="Awake"
        title="Keep the computer from sleeping. The screen still turns off and locks as usual."
        onClick={() => tweaks && apply(setKeepAwake(!tweaks.awake))}
      />
      <QuickButton
        on={tweaks?.theme === 'dark'}
        disabled={!tweaks || busy}
        icon={tweaks?.theme === 'light' ? <Sun size={15} /> : <Moon size={15} />}
        label={tweaks?.theme === 'light' ? 'Light' : 'Dark'}
        title="Windows app mode: light or dark"
        onClick={() => tweaks && apply(setAppTheme(tweaks.theme === 'dark' ? 'light' : 'dark'))}
      />
      <QuickButton icon={<ScanLine size={15} />} label="Snip" title="Take a screenshot" onClick={snip} />
    </div>
  );
}

function QuickButton({
  icon,
  label,
  title,
  onClick,
  on = false,
  warn = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  on?: boolean;
  warn?: boolean;
  disabled?: boolean;
}) {
  return (
    <button className={`quick ${on ? 'on' : ''} ${warn ? 'warn' : ''}`} onClick={onClick} disabled={disabled} title={title}>
      <span className="quick-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/** Display brightness, only where the display supports it (laptop panels; most external monitors do not). */
export function BrightnessRow() {
  const level = useTweaks((t) => t.state?.brightness ?? null);
  const brightness = useTweaks((t) => t.brightness);
  if (level == null) return null;
  return (
    <div className="slider-row">
      <SunDim size={15} className="accent" />
      <DottedMeter value={level} segments={30} onChange={brightness} />
      <span className="slider-value">{Math.round(level)}</span>
    </div>
  );
}
