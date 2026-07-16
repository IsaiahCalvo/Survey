/**
 * undoRedoHotkeys.js — the app-wide undo/redo keyboard standard (KAL-301 follow-up).
 *
 * Owner decision (2026-06-10, applies app-wide):
 *   UNDO = Cmd+Z or Ctrl+Z
 *   REDO = Cmd+Shift+Z, Ctrl+Shift+Z, Cmd+Y, or Ctrl+Y — ALL FOUR must work.
 *
 * Both PDFViewer's global capture handler and RegionSelectionTool's region-edit
 * handler consume these predicates so the two surfaces can never drift apart.
 *
 * `event.code` (physical key) is checked alongside `event.key` because some
 * layouts/modifier combinations report a different `key` value while the
 * physical Z/Y keys are held with Ctrl+Shift — `code` is layout-stable.
 */

const isZKey = (event) => {
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  return key === 'z' || event.code === 'KeyZ';
};

const isYKey = (event) => {
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  return key === 'y' || event.code === 'KeyY';
};

/** True when the event is Cmd+Z / Ctrl+Z (no Shift). */
export const isUndoKeyEvent = (event) => {
  if (!event || !(event.metaKey || event.ctrlKey)) return false;
  if (event.altKey) return false;
  return !event.shiftKey && isZKey(event);
};

/** True when the event is Cmd+Shift+Z, Ctrl+Shift+Z, Cmd+Y, or Ctrl+Y. */
export const isRedoKeyEvent = (event) => {
  if (!event || !(event.metaKey || event.ctrlKey)) return false;
  if (event.altKey) return false;
  if (event.shiftKey && isZKey(event)) return true;
  return isYKey(event);
};

/** True when the event belongs to the undo/redo hotkey family at all. */
export const isUndoRedoKeyEvent = (event) => (
  isUndoKeyEvent(event) || isRedoKeyEvent(event)
);

/** True when a matched undo/redo shortcut must not execute in PDFViewer. */
export const isUndoRedoBlocked = (doc) => {
  if (!doc) return false;
  if (doc.body?.getAttribute('data-readonly') === 'true') return true;
  if (typeof doc.querySelector === 'function' && doc.querySelector('[data-region-selection-ui="true"]')) return true;
  const active = doc.activeElement;
  return Boolean(active && (
    active.tagName === 'INPUT'
    || active.tagName === 'TEXTAREA'
    || active.isContentEditable
  ));
};
