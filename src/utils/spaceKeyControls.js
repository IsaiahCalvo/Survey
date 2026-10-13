/**
 * spaceKeyControls.js — when Space belongs to a focused control, not to the
 * viewer's hold-Space-to-pan (KAL-503).
 *
 * The viewer listens for Space on window (capture) and takes it for panning.
 * It used to take it everywhere except text fields, so with a document open
 * Space never pressed a focused button, tab, switch or menu item — in Settings
 * or any other dialog. Enter worked.
 *
 * Space now goes to the focused control when:
 *   - the control sits in a dialog, menu or list box (the same places where a
 *     Space tap already never changes the tool — spaceTapToggle.js), or
 *   - it is a real <button> / <summary> the keyboard moved to (Tab, or focus
 *     moved by the app). A button you just clicked with the mouse keeps
 *     focus in the browser; holding Space then still pans, as before.
 * Anywhere else (the page, the grey margin, a row like a Pages card) Space
 * still pans and never scrolls. Role-only controls outside a dialog are left
 * to the viewer: their browser default for Space is to scroll.
 */

const NATIVE_CONTROL = 'button, summary';
const ROLE_CONTROL = [
  'button', 'checkbox', 'switch', 'radio', 'tab', 'option',
  'menuitem', 'menuitemcheckbox', 'menuitemradio',
].map((role) => `[role="${role}"]`).join(', ');
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"]';

/**
 * @param {Element|null} el  the focused element (document.activeElement)
 * @param {{ pointerFocused?: boolean }} options  true when the last mouse or
 *   touch press landed on this control (so focus came from a click)
 */
export function spaceBelongsToFocusedControl(el, { pointerFocused = false } = {}) {
  if (!el || el.nodeType !== 1 || typeof el.matches !== 'function') return false;
  const native = el.matches(NATIVE_CONTROL);
  if (!native && !el.matches(ROLE_CONTROL)) return false;
  if (typeof el.closest === 'function' && el.closest(OVERLAY)) return true;
  return native && !pointerFocused;
}

/**
 * Remembers what the last mouse/touch press landed on, so a button focused
 * by a click can be told apart from one the keyboard moved to. Moving focus
 * anywhere else forgets it.
 */
export function createPointerFocusTracker() {
  let pressed = null;
  const covers = (el) => Boolean(el && pressed && (el === pressed || el.contains?.(pressed)));
  return {
    onPointerDown(event) { pressed = event?.target ?? null; },
    onFocusIn(event) { if (!covers(event?.target)) pressed = null; },
    isPointerFocused: covers,
  };
}
