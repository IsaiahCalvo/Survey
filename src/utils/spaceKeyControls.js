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
 *   - it is a real <button> / <summary> reached with Tab, and no mouse or
 *     touch press has happened since. A button you clicked keeps focus in
 *     the browser, and the viewer keeps focus where it was when you press
 *     on the page; in both cases holding Space still pans, as before.
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
 * @param {{ tabbedTo?: boolean }} options  true when the last Tab press is
 *   newer than the last mouse or touch press (createFocusModalityTracker)
 */
export function spaceBelongsToFocusedControl(el, { tabbedTo = false } = {}) {
  if (!el || el.nodeType !== 1 || typeof el.matches !== 'function') return false;
  const native = el.matches(NATIVE_CONTROL);
  if (!native && !el.matches(ROLE_CONTROL)) return false;
  if (typeof el.closest === 'function' && el.closest(OVERLAY)) return true;
  return native && tabbedTo;
}

/**
 * Which came last: a Tab press or a mouse/touch press? `:focus-visible`
 * cannot tell (Chromium turns it on for a clicked button as soon as any key
 * is pressed), and a tool shortcut key must not count as keyboard focus.
 */
export function createFocusModalityTracker() {
  let tabbed = false;
  return {
    onPointerDown() { tabbed = false; },
    onKeyDown(event) { if (event?.key === 'Tab') tabbed = true; },
    tabbedTo: () => tabbed,
  };
}
