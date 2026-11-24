import { useEffect, useRef } from 'react';
import { ExternalLink, Github } from 'lucide-react';
import { version } from '../../zpack.json';
import { KotiloMark } from '../shared/KotiloMark';
import { PanelHeader } from './components';
import { openKotiloGithub, openKotiloSite } from './system';

/** Kotilo's projects, as kotilo.dev describes them. */
const PROJECTS = [
  { name: 'Kotilo Desktop', text: 'A desk for your AI coding agents: real terminals, live agent status, one-click permission answers.' },
  { name: 'Kotilo Kit', text: 'An offline, keyboard-first toolbox: Base64, JSON, JWT, timestamps, regex, hashes and more.' },
  { name: 'Kotilo Deck', text: 'A full-screen dashboard for the small display next to your monitor.' },
  { name: 'Kotilo New Tab', text: 'Your bookmarks in a sidebar on every new tab, with clock, weather, calendar and notes.' },
];

/** Glyphs for the rain: half-width katakana, digits and the letters of "kotilo". */
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789KOTILOkotilo';

/**
 * Falling-glyph "digital rain" behind the panel, in the theme's accent colour.
 * It only runs while the panel is open, at about 20 frames a second, and
 * leaves no work behind when it closes.
 */
function MatrixRain({ active }: { active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!active || !el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const scale = window.devicePixelRatio || 1;
    const width = el.clientWidth;
    const height = el.clientHeight;
    el.width = Math.round(width * scale);
    el.height = Math.round(height * scale);
    ctx.scale(scale, scale);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#cba6f7';
    const bg = styles.getPropertyValue('--bg').trim() || '#131220';
    const size = 14;
    const columns = Math.ceil(width / size);
    // Each column's head starts at a random height so the rain does not begin as one line.
    const heads = Array.from({ length: columns }, () => Math.floor((Math.random() * height) / size));

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.font = `${size - 2}px Consolas, "Cascadia Mono", monospace`;

    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      // Fade what is already there a little, which leaves the trails.
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      for (let i = 0; i < columns; i++) {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        ctx.fillText(glyph, i * size, heads[i] * size);
        if (heads[i] * size > height && Math.random() > 0.975) heads[i] = 0;
        heads[i]++;
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return <canvas ref={canvas} className="matrix-rain" aria-hidden />;
}

export function AboutView({ active }: { active: boolean }) {
  return (
    <div className="view-panel about-panel">
      <MatrixRain active={active} />
      <div className="about-content">
        <PanelHeader title="About" back="settings" />
        <div className="about-head">
          <KotiloMark className="about-logo" />
          <div className="about-title">
            <strong>Kotilo</strong>
            <span>Open-source desktop tools that stay on your machine.</span>
            <em>Kotilo is Finnish for a snail shell. Koti means home.</em>
          </div>
        </div>

        <div className="about-projects">
          {PROJECTS.map((p) => (
            <div key={p.name} className="about-project">
              <strong>{p.name}</strong>
              <span>{p.text}</span>
            </div>
          ))}
        </div>

        <div className="about-foot">
          <span className="about-version">Kotilo Zebar Pack v{version}</span>
          <span className="about-links">
            <button className="chip-button on" onClick={() => void openKotiloSite()}>
              <ExternalLink size={12} /> kotilo.dev
            </button>
            <button className="chip-button" onClick={() => void openKotiloGithub()}>
              <Github size={12} /> GitHub
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
