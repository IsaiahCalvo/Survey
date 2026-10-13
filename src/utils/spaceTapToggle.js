/**
 * spaceTapToggle.js — Space as a tap toggle as well as a hold (Drawboard
 * audit C6).
 *
 * Holding Space pans for as long as it is held and puts the tool back on
 * release (unchanged). A quick TAP of Space — released within
 * SPACE_TAP_MAX_MS with no drag while it was down — switches to Pan and
 * remembers the tool you had; the next tap brings that tool back. This is
 * Drawboard PDF's "Swap to pan / previous tool" (it uses 333 ms; we use
 * 250 ms so a short hold-and-drag is never mistaken for a tap).
 */

export const SPACE_TAP_MAX_MS = 250;

/** Was this Space press a tap (short, and the page was not dragged)? */
export function isSpaceTap({ downAt, upAt, dragged = false, maxMs = SPACE_TAP_MAX_MS } = {}) {
  if (dragged) return false;
  if (!Number.isFinite(downAt) || !Number.isFinite(upAt)) return false;
  const held = upAt - downAt;
  return held >= 0 && held < maxMs;
}

/**
 * What a Space tap does to the tool.
 *   tool       — the active tool id now ('pan', 'pen', 'rect', ...)
 *   savedTool  — the tool a previous tap put down, or null
 * Returns { nextTool, savedTool }: nextTool is null when nothing changes.
 */
export function resolveSpaceTap({ tool, savedTool = null } = {}) {
  if (tool && tool !== 'pan') return { nextTool: 'pan', savedTool: tool };
  if (tool === 'pan' && savedTool && savedTool !== 'pan') return { nextTool: savedTool, savedTool: null };
  return { nextTool: null, savedTool: null };
}

/**
 * Focus is in a place where Space belongs to the control (a dialog, a menu,
 * a list box): a tap there must not change the tool. Text fields are already
 * excluded before the Space press is taken at all.
 */
export function isSpaceTapBlockedTarget(target) {
  const el = target && target.nodeType === 1 ? target : target?.parentElement;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"]'));
}
