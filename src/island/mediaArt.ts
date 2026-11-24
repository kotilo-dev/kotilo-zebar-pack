import { useEffect } from 'react';
import { mediaKey, type MediaArt } from '../shared/AlbumArt';
import { STORED, writeStored } from '../shared/stored';
import type { IslandOutputs } from './providers';
import { mediaArt } from './system';

type Session = NonNullable<NonNullable<IslandOutputs['media']>['currentSession']>;

/**
 * Reads the cover once per track and shares it with the bar. Browsers often
 * hand Windows the new title before the new thumbnail, so the first read waits
 * a moment, and a read that finds no cover (or the previous track) tries once
 * more a few seconds later.
 */
export function useMediaArtSync(session: Session | null | undefined) {
  const key = session ? mediaKey(session) : null;
  const title = session?.title ?? null;
  useEffect(() => {
    if (key == null) {
      writeStored(STORED.mediaArt, null);
      return;
    }
    let cancelled = false;
    const timers: number[] = [];
    const read = (retry: boolean) => {
      void mediaArt()
        .then((found) => {
          if (cancelled) return;
          const sameTrack = found != null && found.title === (title ?? '');
          if (sameTrack && found.art) {
            writeStored(STORED.mediaArt, { key, art: found.art } satisfies MediaArt);
          } else if (retry) {
            timers.push(window.setTimeout(() => read(false), 4000));
          }
        })
        .catch((err) => console.warn('[kotilo] media art', err));
    };
    timers.push(window.setTimeout(() => read(true), 1200));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
