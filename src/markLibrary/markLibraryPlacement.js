/**
 * markLibraryPlacement.js — dropping a library item on a page.
 *
 * Drawboard's two ways, both here:
 *   - click an item, then click the page: it lands centred on the click
 *     (one placement; Shift-click the item to keep it for several);
 *   - press an item and drag it onto the page: it lands where it is let go.
 * The marks a placement makes become the selection, so they can be moved
 * or restyled at once. A finger only pans the page (house rule), so a tap on
 * an item on a touch screen drops it in the middle of the page in view.
 *
 * The active viewer registers the function that places (registerLibraryPlacer);
 * the Library panel arms an item or drops one. Esc lets go of an armed item.
 */
import { markLibraryStore } from './markLibraryStore.js';

let armed = null; // { item, keep }
let dragging = null; // { item }
const listeners = new Set();
let placer = null;

const emit = () => { for (const fn of listeners) fn(); };

export function subscribeLibraryPlacement(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const getArmedLibraryItem = () => armed;

export function armLibraryItem(item, { keep = false } = {}) {
  armed = item ? { item, keep: Boolean(keep) } : null;
  emit();
}
export function disarmLibraryItem() {
  if (!armed) return;
  armed = null;
  emit();
}

/** A press-drag from the panel started (the viewer's layer follows the pointer and drops). */
export function beginLibraryDrag(item) {
  dragging = item ? { item } : null;
  emit();
}
export const getLibraryDrag = () => dragging;
export function endLibraryDrag() {
  if (!dragging) return;
  dragging = null;
  emit();
}

/** The active viewer's placer: (item, { clientX, clientY } | { center: true }) => boolean. */
export function registerLibraryPlacer(fn) {
  placer = fn;
  return () => { if (placer === fn) placer = null; };
}

/** Place `item` at a screen point (or the middle of the page in view). True when it landed. */
export function placeLibraryItem(item, where = { center: true }) {
  if (!item || typeof placer !== 'function') return false;
  const done = Boolean(placer(item, where));
  if (done) markLibraryStore.markUsed(item.id);
  return done;
}

/** The page element under a screen point, inside `root` (a viewer). */
export function pageElementAt(root, clientX, clientY) {
  if (typeof document === 'undefined' || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(clientX, clientY) : [];
  for (const el of stack) {
    const page = el?.closest?.('.survey-pdfjs-page-div[data-page-number]');
    if (page && (!root || root.contains(page))) return page;
  }
  return null;
}
