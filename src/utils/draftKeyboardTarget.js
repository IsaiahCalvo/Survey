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
 */

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
