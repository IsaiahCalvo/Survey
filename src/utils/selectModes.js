export const SELECT_MODE_OPTIONS = Object.freeze([
  Object.freeze({ tool: 'select', mode: 'rectangle', label: 'Rectangle Select', hint: 'V' }),
  Object.freeze({ tool: 'select', mode: 'lasso', label: 'Lasso Select', hint: 'Alt+V' }),
  Object.freeze({ tool: 'text-select', mode: 'text', label: 'Text Select', hint: '⇧V' }),
]);

export const SELECT_MODE_STORAGE_KEY = 'lastSelectMode';

/**
 * PASS 7 (board 14, owner ruling): the one-word name each mode carries inside
 * the Box / Lasso / Text segmented toggle, on desktop and on the phone. The
 * full names above stay the accessible name and the tooltip, so a segment that
 * reads "Box" still announces "Rectangle Select".
 */
export const SELECT_MODE_SHORT_LABELS = Object.freeze({
  rectangle: 'Box',
  lasso: 'Lasso',
  text: 'Text',
});

/** True when the armed tool is any member of the Select family. */
export function isSelectFamilyTool(activeTool) {
  return activeTool === 'select' || activeTool === 'text-select';
}

const isSelectMode = (mode) => SELECT_MODE_OPTIONS.some((option) => option.mode === mode);

export function getSelectModeIconName(mode = 'rectangle') {
  if (mode === 'lasso') return 'lassoSelect';
  if (mode === 'text') return 'textSelect';
  return 'selectCursor';
}

export function getSelectFamilyIconName(activeTool, selectionMode = 'rectangle') {
  return getSelectModeIconName(activeTool === 'text-select' ? 'text' : selectionMode);
}

export function getSelectFamilyTransition(mode = 'rectangle') {
  const selectionMode = isSelectMode(mode) ? mode : 'rectangle';
  return {
    activeTool: selectionMode === 'text' ? 'text-select' : 'select',
    selectionMode,
  };
}

export function loadSelectMode(storage = globalThis?.localStorage) {
  try {
    const stored = storage?.getItem?.(SELECT_MODE_STORAGE_KEY);
    return isSelectMode(stored) ? stored : 'rectangle';
  } catch (_) {
    return 'rectangle';
  }
}

export function saveSelectMode(mode, storage = globalThis?.localStorage) {
  if (!isSelectMode(mode)) return;
  try {
    storage?.setItem?.(SELECT_MODE_STORAGE_KEY, mode);
  } catch (_) {
    // Storage may be blocked in private browsing; the in-memory mode still works.
  }
}

export function getSelectModeMenuFocusIndex(key, currentIndex, itemCount) {
  if (!(itemCount > 0)) return null;
  if (key === 'ArrowDown') return (currentIndex + 1) % itemCount;
  if (key === 'ArrowUp') return (currentIndex - 1 + itemCount) % itemCount;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  return null;
}

export function getNextSelectModeMenuOpen(isOpen, isActive) {
  return isActive ? !isOpen : true;
}

export function getSelectFamilyLabel(activeTool, selectionMode = 'rectangle') {
  if (activeTool === 'text-select' || selectionMode === 'text') return 'Text Select';
  return selectionMode === 'lasso' ? 'Lasso Select' : 'Rectangle Select';
}

export function isSelectModeActive(option, selectionMode = 'rectangle') {
  return selectionMode === option.mode;
}

// ---------------------------------------------------------------------------
// SELECTION DISMISS RULES (owner 2026-10-02) — the one table that decides when
// an annotation selection (shapes, ink, text boxes, callouts, Survey Markers)
// is dropped. PDFViewer reads these three answers and nothing else; tune here.
//   - tool switch      -> getToolSwitchSelectionClearReason
//   - Escape key       -> shouldEscapeDeselect
//   - plain press on the grey area around the page -> shouldBackdropPressDeselect
// Things that never deselect (no rule needed): changing a property of the
// picked mark in the properties bar, scroll / zoom, opening the right-click
// menu, undo of a property change.
// ---------------------------------------------------------------------------

/**
 * The tools that themselves pick marks. Moving between them keeps the
 * selection; switching to any other tool drops it.
 */
export const SELECTION_KEEPING_TOOLS = Object.freeze(['pan', 'select', 'text-select']);

/** Escape deselects under every tool (Drawboard: Esc = "Deselect All"). */
export function shouldEscapeDeselect(_activeTool) {
  return true;
}

/**
 * A plain press on the grey backdrop deselects only under the Select family;
 * under a drawing tool a press is the start of a stroke.
 */
export function shouldBackdropPressDeselect(activeTool) {
  return isSelectFamilyTool(activeTool);
}

/**
 * The one tool-switch rule for annotation selection (Drawboard PDF / common
 * PDF-editor convention): switching to a drawing, shape, text, eraser, survey
 * or any other non-picking tool clears the selection. Pan <-> Select (box or
 * lasso) <-> Text Select keeps it, except that leaving Text Select still clears
 * (its native text range and annotation pick end together, as before).
 * Returns the clear reason, or null to keep the selection.
 */
export function getToolSwitchSelectionClearReason(previousTool, nextTool) {
  if (previousTool === nextTool) return null;
  if (previousTool === 'text-select') return 'text-select-tool-change';
  if (SELECTION_KEEPING_TOOLS.includes(nextTool)) return null;
  return 'tool-change';
}
