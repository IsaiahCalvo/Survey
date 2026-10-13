/**
 * linkClickPolicy.js — when does a press on a PDF link open it?
 *
 * Intended UX (Drawboard canvas audit 2026-10-13, chunk 1; owner request):
 *   - Pan: a click / tap on a link opens it.
 *   - Select (and Text Select): a click picks the link mark so it can be
 *     edited or removed; a double-click or Cmd/Ctrl+click opens it (owner
 *     rule of 2026-08-31, kept). A plain PDF link that is not a mark opens on
 *     a click under Select.
 *   - Every other tool (pen, highlighter, text, shapes, markers, eraser...):
 *     the press is the tool's — the pen draws a dot on the link, a shape
 *     starts on it. Nothing opens.
 *   - Cmd (Mac) / Ctrl (Windows, Linux) + click opens the link under ANY tool.
 *     While that key is held the link layers take the pointer, so the hand
 *     cursor shows exactly where a click would open.
 *
 * The cursor follows the same rule: a link shows the pointing hand only when
 * the press would open it (or, under Select, pick it); otherwise it shows the
 * tool's own cursor because the link takes no pointer at all.
 *
 * Pure functions, no React: the Node test runner imports them directly.
 * The key itself is read by utils/moveModifier.js (one shared key store).
 */

export const LINK_MODE_OPEN = 'open';
export const LINK_MODE_SELECT = 'select';
export const LINK_MODE_DISABLED = 'disabled';

/**
 * The link mode a tool gives a link that is also a mark (imported PDF link).
 * @param {string} activeTool
 * @returns {'open'|'select'|'disabled'}
 */
export function linkModeForTool(activeTool) {
  if (activeTool === 'pan') return LINK_MODE_OPEN;
  if (activeTool === 'select' || activeTool === 'text-select') return LINK_MODE_SELECT;
  return LINK_MODE_DISABLED;
}

/**
 * The mode a link actually runs in right now.
 * @param {object} options
 * @param {'open'|'select'|'disabled'} options.toolMode — from linkModeForTool
 * @param {boolean} [options.modifierHeld] — Cmd (Mac) / Ctrl held now
 * @param {boolean} [options.nativeTextSelection] — Text Select owns the
 *   gesture (native text drags start on links too)
 * @returns {'open'|'select'|'disabled'}
 */
export function resolveLinkMode({ toolMode, modifierHeld = false, nativeTextSelection = false } = {}) {
  if (modifierHeld) {
    // Under Select the modifier click already opens (and the link must stay
    // pickable with the key up); everywhere else the key turns the link on.
    return toolMode === LINK_MODE_SELECT && !nativeTextSelection ? LINK_MODE_SELECT : LINK_MODE_OPEN;
  }
  if (nativeTextSelection) return LINK_MODE_DISABLED;
  if (toolMode === LINK_MODE_OPEN || toolMode === LINK_MODE_SELECT) return toolMode;
  return LINK_MODE_DISABLED;
}

/** Does this click carry the "open the link" modifier (Cmd or Ctrl)? */
export function isLinkOpenModifierEvent(event) {
  return Boolean(event && (event.metaKey === true || event.ctrlKey === true));
}

/**
 * Should a finished tap / click on a link open it?
 * @param {'open'|'select'|'disabled'} mode — from resolveLinkMode
 * @param {{ metaKey?: boolean, ctrlKey?: boolean }} event
 */
export function shouldOpenLinkOnClick(mode, event) {
  if (mode === LINK_MODE_DISABLED) return false;
  return mode === LINK_MODE_OPEN || isLinkOpenModifierEvent(event);
}
