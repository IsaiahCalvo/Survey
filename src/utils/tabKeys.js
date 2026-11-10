/**
 * tabKeys.js — next / previous document tab from the keyboard (Nightly, flag
 * 'tab-keys'; Drawboard PDF Pro trial audit 2026-11-09).
 *
 * Alt+Shift+] goes to the next open document, Alt+Shift+[ to the one
 * before, wrapping round. Matched by key code, since Alt and Shift change the
 * character these keys type on a Mac. Browsers keep Ctrl+Tab and
 * Ctrl+PageUp / PageDown for their own tabs, so those are not used.
 */

/** +1 for next, -1 for previous, 0 when this keydown is not a tab key. */
export function tabStepForKey(event) {
  if (!event || !event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return 0;
  if (event.code === 'BracketRight') return 1;
  if (event.code === 'BracketLeft') return -1;
  return 0;
}

/**
 * The tab to show after a step. `ids` are the open documents in strip order
 * (Home left out); from Home, next is the first and previous the last.
 */
export function steppedTabId(ids, activeId, step) {
  if (!Array.isArray(ids) || ids.length === 0 || !step) return null;
  const at = ids.indexOf(activeId);
  if (at === -1) return step > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(at + step + ids.length) % ids.length];
}
