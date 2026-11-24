/**
 * The Kotilo snail mark, drawn inline so it takes the active theme's colours:
 * the tile is the surface colour, the shell is the accent and the eyes are the
 * text colour. (It used to be a fixed-colour SVG file in the site's orange.)
 */
export function KotiloMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect x="2" y="2" width="60" height="60" rx="14" fill="var(--surface)" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="13.5" fill="none" stroke="var(--hairline)" strokeWidth="1" />
      <g transform="translate(32 32) scale(0.8) translate(-36.75 -32)">
        <g fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M28 30 a4 4 0 0 1 4 4 a8 8 0 0 1 -8 8 a12 12 0 0 1 -12 -12 a16 16 0 0 1 16 -16 a20 20 0 0 1 20 20" />
          <path d="M10 50 H50 a6 6 0 0 0 6 -6 V34" />
          <path d="M54 30 L51 20 M58 30 L61 21" strokeWidth="3" />
        </g>
        <circle cx="51" cy="18" r="3" fill="var(--text)" />
        <circle cx="61" cy="19" r="3" fill="var(--text)" />
      </g>
    </svg>
  );
}
