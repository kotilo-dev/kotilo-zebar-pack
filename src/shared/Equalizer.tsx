import './equalizer.css';

/** Three bars that bounce while something plays. Used by the bar and the island. */
export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className={`equalizer ${playing ? 'playing' : ''}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}
