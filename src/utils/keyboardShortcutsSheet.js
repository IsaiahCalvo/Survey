/**
 * keyboardShortcutsSheet.js — when the "?" key opens the keyboard shortcuts
 * sheet, and how a button opens it.
 *
 * KAL-444. Intended UX: the sheet lists the keys that act inside a document, so
 * it must open from inside a document, not only from Home. Inside the viewer
 * people type into text boxes, callouts, the Survey panel, search and rename
 * fields; a question mark typed there is text, never a request for help. So
 * "?" opens the sheet only when focus is NOT on a surface that takes typing.
 *
 * Reuses the app's one "is the user typing here?" test (isTextEntryTarget in
 * draftKeyboardTarget.js) rather than writing a second one: it already counts
 * text-like <input> types, <textarea> (Fabric's hidden textarea included) and
 * any contentEditable editor, and leaves buttons, checkboxes and sliders out.
 *
 * Data only (no React), so it can be tested without a DOM.
 */
import { isTextEntryTarget } from './draftKeyboardTarget.js';

/** Window event a visible button sends to open the sheet. */
export const OPEN_KEYBOARD_SHORTCUTS_EVENT = 'keyboard-shortcuts:open';

/** Open the sheet from a button or menu item (the non-keyboard way in). */
export function openKeyboardShortcuts(win = typeof window !== 'undefined' ? window : null) {
  if (!win || typeof win.dispatchEvent !== 'function') return;
  win.dispatchEvent(new win.CustomEvent(OPEN_KEYBOARD_SHORTCUTS_EVENT));
}

/**
 * True when this keydown should toggle the sheet: a plain "?" (Shift is how
 * most layouts type it, so Shift is allowed; Cmd, Ctrl and Alt chords belong
 * to the app or the OS), not mid-composition, and not aimed at a text field.
 *
 * Both the event target and the focused element are checked: a key event can
 * be aimed at a text editor whose focus lives in a child (Fabric's hidden
 * textarea, a contentEditable span), and either one typing means "text".
 */
export function shouldToggleShortcutsSheet(event, activeElement = null) {
  if (!event || event.key !== '?') return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.isComposing) return false;
  if (isTextEntryTarget(event.target)) return false;
  if (isTextEntryTarget(activeElement)) return false;
  return true;
}
