/**
 * pageTurnKeys.js — Nightly 'page-turn-keys' (Drawboard PDF Pro push
 * 2026-11-12): Left / Right and Shift+Up / Down turn the page. Pure.
 */

/**
 * -1 for previous page, +1 for next, 0 when the key is not a page turn.
 * `shiftArrows: false` leaves Shift+Up / Down to Nightly 'drawboard-keys',
 * which turns the page on them too, so one press never turns two pages.
 */
export function pageTurnStep(event, { shiftArrows = true } = {}) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return 0;
  if (!event.shiftKey && event.key === 'ArrowLeft') return -1;
  if (!event.shiftKey && event.key === 'ArrowRight') return 1;
  if (shiftArrows && event.shiftKey && event.key === 'ArrowUp') return -1;
  if (shiftArrows && event.shiftKey && event.key === 'ArrowDown') return 1;
  return 0;
}
