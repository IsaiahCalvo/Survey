/**
 * menuKeyHints — the key for a mark menu item, shown on its row and in its
 * hint (Nightly flag 'menu-keys', Drawboard PDF Pro trial audit 2026-11-09:
 * Drawboard prints keys on two rows; Survey printed none).
 *
 * The chords are the sheet's own (utils/keyboardShortcuts.js), passed through
 * the person's own rebinding (customKeyboardShortcuts.shortcutBinding), so a
 * row never shows a key that no longer works.
 */
import { chordKeycaps } from './keyboardShortcuts.js';

export const MENU_KEY_CHORDS = Object.freeze({
  cut: 'mod+x',
  copy: 'mod+c',
  paste: 'mod+v',
  duplicate: 'mod+d',
  delete: 'delete',
  bringForward: 'mod+]',
  bringToFront: 'mod+shift+]',
  sendBackward: 'mod+[',
  sendToBack: 'mod+shift+[',
});

/** "Ctrl+Shift+]" (or "⌘+Shift+]" on a Mac); null for an item with no key. */
export function menuKeyHint(key, { isMac = false, binding = (chord) => chord } = {}) {
  const chord = MENU_KEY_CHORDS[key];
  if (!chord) return null;
  const bound = binding(chord) || chord;
  return chordKeycaps(bound, { isMac }).join('+');
}
