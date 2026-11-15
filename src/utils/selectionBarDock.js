// Nightly 'toolbar-settings' (Drawboard Projects parity VT-52): the picked
// marks' quick bar can dock to the bottom of the page area instead of
// floating by the mark ("Dock bar to bottom" / "Float bar by mark" on the
// mark menu). Remembered per browser, so a later pick and a reload open it
// docked too.
import { useSyncExternalStore } from 'react';

const KEY = 'survey.selectionBar.docked';
const listeners = new Set();
let docked = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'; } catch { return false; }
})();

export function isSelectionBarDocked() {
  return docked;
}

export function setSelectionBarDocked(next) {
  const value = Boolean(next);
  if (value === docked) return;
  docked = value;
  try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* storage off */ }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useSelectionBarDocked() {
  return useSyncExternalStore(subscribe, isSelectionBarDocked, () => false);
}

/** Gap between a docked bar and the bottom of the page area, in px. */
export const DOCKED_BAR_GAP = 8;

/** Where a docked bar sits: centred along the bottom of `bounds`, kept inside them. */
export function dockedBarPosition(bounds, barWidth, barHeight) {
  if (!bounds || !(bounds.right > bounds.left) || !(bounds.bottom > bounds.top)) return null;
  const w = Math.max(0, Number(barWidth) || 0);
  const h = Math.max(0, Number(barHeight) || 0);
  const left = Math.max(bounds.left, Math.round(bounds.left + (bounds.right - bounds.left - w) / 2));
  const top = Math.max(bounds.top, Math.round(bounds.bottom - h - DOCKED_BAR_GAP));
  return { left, top, side: 'docked' };
}
