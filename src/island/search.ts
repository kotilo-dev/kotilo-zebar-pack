/**
 * Matching and ranking for the launcher: fuzzy matching with the matched
 * letters (for highlighting), and frecency, a mix of how often and how
 * recently a result was chosen.
 */

/**
 * Lower-cases for matching and treats the Turkish dotless/dotted i as plain i,
 * so "vısual" (typed on a Turkish keyboard) still finds "Visual Studio".
 * Every UTF-16 unit maps to exactly one, so positions stay valid for highlighting.
 */
export const fold = (text: string) =>
  text.split('').map((ch) => (ch === 'ı' || ch === 'İ' ? 'i' : ch.toLocaleLowerCase('en').slice(0, 1))).join('');

export type Match = { score: number; at: number[] };

/**
 * Where words start: after a space or punctuation, and at every capital letter
 * inside a word, so "VSCode" has starts V, S, C and "vsc" matches its initials.
 */
function wordStarts(text: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[\s\-_.()/\\:,]/.test(ch)) continue;
    if (i === 0 || /[\s\-_.()/\\:,]/.test(text[i - 1]) || /[A-Z]/.test(ch)) starts.push(i);
  }
  return starts;
}

const range = (from: number, length: number) => Array.from({ length }, (_, i) => from + i);

/**
 * How well `query` (already folded) matches `text`, best first:
 * the start of the text (100), the start of a word (80), the initials of the
 * words ("vsc" in "Visual Studio Code", 70), anywhere (50), and the letters in
 * order with gaps (up to 35, tighter is better; only for two letters or more,
 * and only while the letters cover at least 40 % of the stretch they span, so
 * "vsc" does not match a long name that merely contains v, s and c somewhere).
 * Null when the letters are not all there.
 */
export function match(text: string, query: string): Match | null {
  if (!query) return { score: 0, at: [] };
  const t = fold(text);
  if (t.startsWith(query)) return { score: 100, at: range(0, query.length) };
  const starts = wordStarts(text);
  const wordHit = starts.find((s) => t.startsWith(query, s));
  if (wordHit != null) return { score: 80, at: range(wordHit, query.length) };
  if (!/\s/.test(query) && query.length >= 2) {
    const initials = starts.map((s) => t[s]).join('');
    if (initials.startsWith(query)) return { score: 70, at: starts.slice(0, query.length) };
  }
  const anywhere = t.indexOf(query);
  if (anywhere >= 0) return { score: 50, at: range(anywhere, query.length) };
  if (query.length < 2) return null;
  const at: number[] = [];
  let from = 0;
  for (const ch of query) {
    if (ch === ' ') continue;
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    at.push(i);
    from = i + 1;
  }
  const density = at.length / (at[at.length - 1] - at[0] + 1);
  if (density < 0.4) return null;
  return { score: 20 + Math.round(15 * density), at };
}

/**
 * The best match over a title and extra keywords. A keyword match counts a
 * little less than a title match and highlights nothing in the title.
 * Keywords match only as text, never fuzzily: they are often long (window
 * titles), where scattered letters would match almost anything.
 */
export function matchAny(title: string, keywords: readonly string[], query: string): Match | null {
  const best = match(title, query);
  let kw: Match | null = null;
  for (const k of keywords) {
    const m = match(k, query);
    if (m && m.score >= 50 && (!kw || m.score > kw.score)) kw = m;
  }
  if (kw && (!best || kw.score * 0.9 > best.score)) return { score: kw.score * 0.9, at: [] };
  return best;
}

/* ---- Frecency ------------------------------------------------------------------ */

const FRECENCY_KEY = 'kotilo.launcher.frecency.v1';
/** The list the launcher kept before frecency (app IDs, most recent first). */
const OLD_RECENT_KEY = 'kotilo.launcher.recent.v2';
const MAX_ENTRIES = 200;
const DAY = 86_400_000;

type Entry = { count: number; last: number };
type Store = Record<string, Entry>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(FRECENCY_KEY);
    if (raw) return JSON.parse(raw) as Store;
    // First run with frecency: start from the old recent list, most recent first.
    const old = JSON.parse(localStorage.getItem(OLD_RECENT_KEY) ?? '[]') as string[];
    const now = Date.now();
    return Object.fromEntries(old.map((id, i) => [`app:${id}`, { count: 1, last: now - i * 60_000 }]));
  } catch {
    return {};
  }
}

let store: Store | null = null;
const getStore = () => (store ??= readStore());

/** Recency weights as in Firefox's frecency: the last day counts most. */
function weight(age: number) {
  if (age < DAY) return 4;
  if (age < 7 * DAY) return 2;
  if (age < 30 * DAY) return 1;
  return 0.5;
}

/** A result's frecency value; 0 for one never chosen. */
export function frecency(key: string, now = Date.now()): number {
  const e = getStore()[key];
  return e ? e.count * weight(now - e.last) : 0;
}

/** Ranking bonus from frecency, at most 25 points (a word-start match beats a substring match plus it). */
export const frecencyBonus = (key: string) => Math.min(25, 6 * Math.log2(1 + frecency(key)));

/** Records that a result was chosen. */
export function remember(key: string) {
  const s = getStore();
  const e = s[key];
  s[key] = { count: (e?.count ?? 0) + 1, last: Date.now() };
  const keys = Object.keys(s);
  if (keys.length > MAX_ENTRIES) {
    // Forget the weakest entries.
    keys
      .sort((a, b) => frecency(a) - frecency(b))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete s[k]);
  }
  try {
    localStorage.setItem(FRECENCY_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: the ranking simply does not learn this time.
  }
}
