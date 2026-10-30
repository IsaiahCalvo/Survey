/**
 * focusRingSource.js — draw the keyboard focus ring only while the user is
 * moving focus with the keyboard.
 *
 * Owner 2026-10-26: "sometimes buttons get a white border around them. It's
 * not all the time, and I don't know how to trigger it" (the "camera" row of
 * the new-marker card, the Select tool button). That border is the focus ring
 * (states.css section 4, --focus: a light grey). Chrome draws :focus-visible on
 * a CLICKED button as soon as any key is pressed while it holds focus (a tool
 * shortcut, Delete, Ctrl+Z), and on an element a script focuses after a key
 * press - so a mouse user who uses shortcuts gets rings at random.
 *
 * The rule here: a press (mouse, pen or finger) turns rings off; Tab, Shift+Tab
 * or an arrow / Home / End / Page key that MOVES focus turns them back on. Any
 * other key (shortcuts, Enter, Space, Escape) leaves the choice alone. Text
 * fields keep their focus look either way (states.css).
 *
 * Published as `<html data-focus-ring="pointer|keyboard">`; no attribute until
 * the first input, so the browser's own rule applies at start.
 */

const ROOT_ATTRIBUTE = 'data-focus-ring';
const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

let installed = false;
// The element that held focus when a navigation key went down; a focus change
// in that same task means the key moved focus.
let pendingKeyFocus = null;

function setSource(doc, source) {
  const root = doc?.documentElement;
  if (root && root.getAttribute(ROOT_ATTRIBUTE) !== source) root.setAttribute(ROOT_ATTRIBUTE, source);
}

/** Which source a keydown says, or null when it says nothing. Exported for tests. */
export function focusSourceFromKey(event) {
  if (!event || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === 'Tab') return 'keyboard';
  return NAVIGATION_KEYS.has(event.key) ? 'maybe-keyboard' : null;
}

export function installFocusRingSource(win = typeof window !== 'undefined' ? window : undefined) {
  if (installed || !win || typeof win.addEventListener !== 'function') return;
  installed = true;
  const doc = win.document;
  const options = { capture: true, passive: true };
  win.addEventListener('pointerdown', () => { pendingKeyFocus = null; setSource(doc, 'pointer'); }, options);
  win.addEventListener('keydown', (event) => {
    const source = focusSourceFromKey(event);
    if (source === 'keyboard') { setSource(doc, 'keyboard'); return; }
    if (source !== 'maybe-keyboard') return;
    // An arrow key only counts when it moves focus (a menu, a list, a radio
    // group); in the viewer it pans the page and must not light the toolbar.
    const before = doc.activeElement;
    pendingKeyFocus = before;
    win.setTimeout(() => {
      if (pendingKeyFocus === before && doc.activeElement !== before) setSource(doc, 'keyboard');
      pendingKeyFocus = null;
    }, 0);
  }, options);
}

/** Test helper: forget all state. */
export function resetFocusRingSourceForTests() {
  installed = false;
  pendingKeyFocus = null;
}
