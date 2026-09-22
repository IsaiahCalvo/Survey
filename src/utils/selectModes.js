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
