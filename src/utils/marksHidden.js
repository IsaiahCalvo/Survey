/**
 * marksHidden.js — "hide all marks" for a clean look at the drawing
 * (Nightly, flag 'hide-marks'; Drawboard PDF Pro trial audit 2026-11-09).
 *
 * One switch for the whole viewer. While it is on, the root element carries
 * data-marks-hidden and src/styles/marksHidden.css hides every page's mark
 * layers (SVG and the canvas stand-in), so they can't be picked either. It is
 * never saved: a reload always shows the marks, so nobody thinks they are
 * gone. A chip over the page says they are hidden and brings them back.
 */
import { useSyncExternalStore } from 'react';

let hidden = false;
const listeners = new Set();

export function marksHidden() {
  return hidden;
}

export function setMarksHidden(next, doc = typeof document !== 'undefined' ? document : null) {
  const value = Boolean(next);
  if (value === hidden) return;
  hidden = value;
  if (doc?.documentElement) {
    if (value) doc.documentElement.setAttribute('data-marks-hidden', '');
    else doc.documentElement.removeAttribute('data-marks-hidden');
  }
  listeners.forEach((listener) => listener());
}

export function subscribeMarksHidden(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMarksHidden() {
  return useSyncExternalStore(subscribeMarksHidden, marksHidden, () => false);
}
