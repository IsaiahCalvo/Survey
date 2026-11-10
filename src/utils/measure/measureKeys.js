/**
 * measureKeys.js — Alt+Shift+letter arms a measure tool (Nightly, flag
 * 'measure-keys'; Drawboard PDF Pro trial audit 2026-11-10).
 *
 * L Length, P Perimeter, A Area; with 'measure-depth' also Q Polylength and
 * V Volume. Matched by key code, since Alt changes the typed letter on a Mac.
 */

const CODES = Object.freeze({
  KeyL: 'length',
  KeyP: 'perimeter',
  KeyA: 'area',
  KeyQ: 'polylength',
  KeyV: 'volume',
});
const DEPTH_KINDS = new Set(['polylength', 'volume']);

/** The measure kind an Alt+Shift key arms, or null. */
export function measureKindForKey(event, { depth = false } = {}) {
  if (!event || !event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return null;
  const fromCode = CODES[event.code];
  const fromKey = !fromCode && typeof event.key === 'string' && event.key.length === 1
    ? CODES[`Key${event.key.toUpperCase()}`]
    : null;
  const kind = fromCode || fromKey || null;
  if (!kind) return null;
  if (DEPTH_KINDS.has(kind) && !depth) return null;
  return kind;
}

/** The key badge a measure menu row shows. */
export function measureKeyBadge(kind, { depth = false } = {}) {
  const code = Object.keys(CODES).find((c) => CODES[c] === kind);
  if (!code || (DEPTH_KINDS.has(kind) && !depth)) return null;
  return `Alt+Shift+${code.slice(3)}`;
}
