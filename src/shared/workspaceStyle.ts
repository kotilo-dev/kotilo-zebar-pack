/**
 * How the bar draws its workspace buttons, picked in the island's settings and
 * kept in the widgets' shared storage (`STORED.workspaceStyle`). The styles
 * follow the usual Linux bars: plain numbers, dots that stretch into a pill on
 * the focused workspace, Roman numerals and kanji numerals.
 */
export const WORKSPACE_STYLES = [
  { id: 'numbers', label: 'Numbers', sample: '1 2 3' },
  { id: 'dots', label: 'Dots', sample: '● ○ ●' },
  { id: 'roman', label: 'Roman', sample: 'I II III' },
  { id: 'kanji', label: 'Kanji', sample: '一 二 三' },
] as const;

export type WorkspaceStyle = (typeof WORKSPACE_STYLES)[number]['id'];

export const DEFAULT_WORKSPACE_STYLE: WorkspaceStyle = 'numbers';

export const isWorkspaceStyle = (v: unknown): v is WorkspaceStyle => WORKSPACE_STYLES.some((s) => s.id === v);

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function toRoman(n: number): string {
  let out = '';
  for (const [value, mark] of ROMAN) for (; n >= value; n -= value) out += mark;
  return out;
}

const KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function toKanji(n: number): string {
  if (n < 10) return KANJI[n];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${tens > 1 ? KANJI[tens] : ''}十${ones ? KANJI[ones] : ''}`;
  }
  return String(n);
}

/**
 * The text on a workspace button. A display name set in GlazeWM's config always
 * wins; Roman and kanji apply to numeric names only (others keep their name);
 * the dots style draws no text.
 */
export function workspaceText(style: WorkspaceStyle, name: string, displayName?: string | null): string {
  if (style === 'dots') return '';
  if (displayName) return displayName;
  const n = /^\d+$/.test(name) ? Number(name) : NaN;
  if (Number.isNaN(n) || n < 1) return name;
  if (style === 'roman') return toRoman(n);
  if (style === 'kanji') return toKanji(n);
  return name;
}
