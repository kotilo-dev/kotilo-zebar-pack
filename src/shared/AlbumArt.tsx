import { Music } from 'lucide-react';
import { STORED, useStored } from './stored';

/**
 * The cover of the playing track in the island's control centre. The island
 * reads it (scripts/media-art.ps1) whenever the track changes and keeps it in
 * the widgets' shared storage; a still picture costs nothing while it shows,
 * unlike the animated equalizer it replaced (the bar shows a still music note).
 * Until the cover arrives, or when the app gives none, a music note stands in.
 */
export type MediaArt = { key: string; art: string } | null;

/** Identifies a track the way Zebar's media provider reports it. */
export const mediaKey = (s: { title: string | null; artist: string | null }) => `${s.title ?? ''}\u0000${s.artist ?? ''}`;

export function AlbumArt({
  session,
  className,
  size,
}: {
  session: { title: string | null; artist: string | null };
  className?: string;
  size: number;
}) {
  const stored = useStored<MediaArt>(STORED.mediaArt, null);
  const art = stored && stored.key === mediaKey(session) ? stored.art : '';
  return (
    <span className={`album-art ${className ?? ''}`} aria-hidden>
      {art ? <img src={art} alt="" /> : <Music size={size} />}
    </span>
  );
}
