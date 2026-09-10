/**
 * draftKeyboardTarget.js — who owns Enter / Escape while a click-to-place
 * draft (polygon, polyline) is in flight.
 *
 * UX 2026-09-09. Enter must finish the draft and Escape must cancel it no
 * matter where keyboard focus happens to sit — the user's hands are on the
 * page, not on the chrome, and after picking the tool from the shape menu the
 * browser leaves focus on the toolbar BUTTON (and, if they nudged the cloud
 * Bump control first, in that number input). The draft listener runs on
 * `window` in the CAPTURE phase, so it is the first handler on the page; the
 * only thing it must still yield to is somebody actually TYPING.
 *
 * "Typing" means a text-entry surface. The old test bailed on any
 * `tagName === 'INPUT'`, which handed Enter to buttons, checkboxes, radios,
 * ranges and colour swatches as well — controls where Enter has nothing to do
 * with text and the draft should win.
 *
 * UX 2026-09-10 (round 4, defect 3). The sub-toolbar's NUMERIC fields ("Cloud
 * bump size", "Width") are `<input type="text" inputmode="numeric">`, so the
 * typing test above correctly calls them text entry — and that handed them
 * Enter and Escape while a polygon / polyline draft was in flight. Nudging the
 * Bump control mid-draft (exactly what a user does: place a few points, decide
 * the crowns are too small, fix them, carry on) therefore left the draft
 * un-finishable: Enter did nothing and Escape did nothing.
 *
 * Contract: a NUMERIC CHROME FIELD yields both keys to a draft in flight.
 * Enter commits the field's value (the draft handler blurs it, and every one
 * of these fields commits on blur) AND finishes the draft; Escape blurs the
 * field and cancels the draft. Genuine text-editing surfaces — annotation text
 * editors, the search box, name fields — keep Enter / Escape for themselves,
 * because there Enter means "newline / submit what I typed" and losing it
 * would be data loss.
 *
 * A field opts in by carrying `data-draft-yields-keys` (or living inside an
 * element that does). It is an opt-IN, so nothing keeps its keys by accident.
 */

/** Attribute a chrome numeric field carries to yield Enter/Escape to a draft. */
export const DRAFT_KEY_YIELD_ATTR = 'data-draft-yields-keys';

// <input type> values that accept typed characters. Everything else (button,
// submit, reset, checkbox, radio, range, color, file, image) is a widget.
const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'tel', 'email', 'password', 'number',
  'date', 'datetime-local', 'month', 'week', 'time',
  // An <input> with no/unknown type behaves as type="text".
  '',
]);

/**
 * True when the event target is a surface the user could be typing into, and
 * therefore owns Enter / Escape for itself.
 *
 * Accepts any object with `tagName` / `type` / `isContentEditable`, so it can
 * be unit-tested without a DOM.
 */
export function isTextEntryTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = String(target.type ?? '').toLowerCase();
  return TEXT_ENTRY_INPUT_TYPES.has(type);
}

/**
 * True when this target is a chrome control that has opted to hand Enter /
 * Escape to a click-to-place draft rather than consume them itself.
 *
 * Accepts a real DOM node (uses `closest`, so a wrapper can opt a whole
 * control in) or a plain object with `dataset` / `getAttribute`, so it is
 * unit-testable without a DOM.
 */
export function yieldsDraftKeys(target) {
  if (!target) return false;
  if (typeof target.closest === 'function') {
    try {
      if (target.closest(`[${DRAFT_KEY_YIELD_ATTR}]`)) return true;
    } catch (_) { /* detached node */ }
  }
  if (typeof target.getAttribute === 'function' && target.getAttribute(DRAFT_KEY_YIELD_ATTR) != null) return true;
  return !!(target.dataset && target.dataset.draftYieldsKeys != null);
}

/**
 * Who owns Enter / Escape right now, with a click-to-place draft in flight:
 * the DRAFT, unless the event landed on a genuine text-editing surface that
 * has not opted out.
 */
export function draftOwnsKeyboard(target) {
  return !isTextEntryTarget(target) || yieldsDraftKeys(target);
}

/**
 * Drop keyboard focus from a chrome control that has just armed a
 * click-to-place tool, so the browser cannot route the draft's Enter to it
 * (and so a stray Space does not re-click it). Safe on any element or none.
 */
export function releaseFocusForDraftTool(element) {
  const candidates = [element];
  if (typeof document !== 'undefined') candidates.push(document.activeElement);
  for (const node of candidates) {
    if (node && typeof node.blur === 'function' && node !== document?.body) {
      try { node.blur(); } catch (_) { /* detached node */ }
    }
  }
}
