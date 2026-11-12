/**
 * pasteInPlaceKey.js — Nightly 'paste-in-place-key' (Drawboard PDF Pro push
 * 2026-11-12): Ctrl+Shift+V (Cmd+Shift+V) pastes the copied marks at their
 * own spot, like the page menu's "Paste in place" row. Pure rules + the page
 * under a screen point, for tests.
 */

/** True for Ctrl/Cmd+Shift+V (read from the key's place too). */
export function isPasteInPlaceKey(event) {
  if (!event || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return false;
  return event.code === 'KeyV' || String(event.key || '').toLowerCase() === 'v';
}

/**
 * The page number under a screen point: the marks overlay is portalled
 * outside the page div, so its own page attribute wins, then the bare page.
 */
export function pageNumberAtPoint(x, y, doc = typeof document !== 'undefined' ? document : null) {
  const el = doc?.elementFromPoint?.(x, y);
  if (!el) return null;
  const overlay = el.closest?.('[data-diag-svg-wrapper], [data-pal-root]');
  let attr = overlay?.getAttribute?.('data-diag-svg-wrapper') || overlay?.getAttribute?.('data-pal-root');
  if (!attr) {
    const pageDiv = el.closest?.('.survey-pdfjs-page-div');
    attr = pageDiv?.getAttribute?.('data-page-number') || null;
  }
  const n = attr ? parseInt(attr, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
