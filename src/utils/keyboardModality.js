/**
 * keyboardModality.js — was the last thing the person did a key press or a
 * pointer press (mouse, pen, finger)?
 *
 * KAL-66: keyboard-only behaviour (moving focus into a menu as it opens,
 * handing focus back to the button that opened it) must not change anything
 * for mouse and touch users, so the menu helpers ask this first. Same idea as
 * the browser's own :focus-visible heuristic, which we cannot read from JS.
 */
let lastWasKeyboard = false;
let installed = false;

const install = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', (event) => {
    // Modifier-only presses (Cmd held for a shortcut) are not navigation.
    if (event.key === 'Meta' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift') return;
    lastWasKeyboard = true;
  }, true);
  window.addEventListener('pointerdown', () => { lastWasKeyboard = false; }, true);
};

install();

export const lastInputWasKeyboard = () => {
  install();
  return lastWasKeyboard;
};
