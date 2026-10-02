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
// is dropped. PDFViewer reads these answers and nothing else; tune here.
//   - tool switch      -> getToolSwitchSelectionClearReason (+ how it was asked)
//   - Escape key       -> shouldEscapeDeselect, resolveEscape
//   - plain press on the grey area around the page -> shouldBackdropPressDeselect
//   - a press on the page under any tool -> resolveToolPress (Drawboard rules below)
// Things that never deselect (SELECTION_SURVIVES): changing a property of the
// picked mark in the properties bar, scroll / zoom, a page change, opening a
// panel or the right-click menu, a tool shortcut key, a category tab, undo.
// ---------------------------------------------------------------------------

/**
 * The tools that themselves pick marks. Moving between them keeps the
 * selection however the switch was made.
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

// ---------------------------------------------------------------------------
// DRAWBOARD PDF RULES (owner 2026-10-02; study: scratchpad/drawboard2/RULES.md)
// The one table for "what does a press or a key do to the selection" under
// every tool. The viewer, the SVG layer and the Text / Counter overlays ask
// these functions and nothing else. Numbers are the study's rule numbers;
// tests/selectModes.test.mjs pins each one.
// ---------------------------------------------------------------------------

/**
 * Rule 1 — tool classes.
 *   select : picks marks itself (Select, Lasso = Select in lasso mode, Text
 *            Select, Pan) or draws a shape on a drag but still picks on a
 *            click (Rectangle, Ellipse, Line, Arrow, Callout; Cloud is a
 *            border style of these, not a tool).
 *   ink    : Pen, Highlighter — never pick; a press draws.
 *   point  : Polygon, Polyline — a click drops a point; never pick.
 *   eraser : deletes the marks it touches; never the selected one.
 *   text   : the Text box tool (rule 6).
 *   place  : Counter and Survey Marker (ours, not in Drawboard): a click on a
 *            mark picks it, a press on empty page places a new one.
 */
export const TOOL_CLASSES = Object.freeze({
  select: Object.freeze(['select', 'text-select', 'pan', 'rect', 'ellipse', 'line', 'arrow', 'callout']),
  ink: Object.freeze(['pen', 'highlighter']),
  point: Object.freeze(['polygon', 'polyline']),
  eraser: Object.freeze(['eraser']),
  text: Object.freeze(['text']),
  place: Object.freeze(['counter', 'survey-marker']),
});

/** Select-capable tools whose drag draws a new shape (rule 3). */
export const SHAPE_DRAW_TOOLS = Object.freeze(['rect', 'ellipse', 'line', 'arrow', 'callout']);

export function getToolSelectionClass(tool) {
  for (const [name, tools] of Object.entries(TOOL_CLASSES)) {
    if (tools.includes(tool)) return name;
  }
  return 'other';
}

/** Rule 2 — the blue hover halo shows under every select-capable tool. */
export function shouldShowHoverHalo(tool) {
  return getToolSelectionClass(tool) === 'select';
}

/**
 * Rules 2-6 and 8 — one press on the page.
 *
 * target: 'selection' (a selected mark or one of its handles), 'text' (an
 *         unselected text box or callout), 'mark' (any other unselected mark)
 *         or 'empty'.
 * Returns { drag, click, clearsSelection }:
 *   drag  — what the press does if it travels: 'manipulate' (move / resize
 *           the selection, tool stays), 'box-select', 'pan', 'draw', 'erase',
 *           'place' (the tool's own job) or 'none'.
 *   click — what it does if it does not travel: 'keep', 'select' (the pressed
 *           mark), 'add' (Shift: add it), 'deselect', 'edit' (open the pressed
 *           text), 'new-text', or 'tool' (the tool's own click: a dot, a
 *           point, a pin, the start of a Line's click-click).
 *   clearsSelection — the selection goes as soon as the press lands.
 */
export function resolveToolPress({ tool, target = 'empty', hasSelection = false, shiftKey = false } = {}) {
  const cls = getToolSelectionClass(tool);
  const onMark = target === 'mark' || target === 'text';
  const result = (drag, click, clearsSelection = false) => ({ drag, click, clearsSelection });
  // Any tool: the selected mark and its handles move / resize it (rule 3, 4).
  if (target === 'selection') return result('manipulate', 'keep');
  switch (cls) {
    case 'select': {
      const drag = tool === 'pan' ? 'pan'
        : (tool === 'select' || tool === 'text-select') ? 'box-select'
          : 'draw';
      // Rule 2 / 3 / 8: a click picks (Shift adds); a drag is the tool's own
      // job even when it starts on a mark that is not selected.
      if (onMark) return result(drag, shiftKey ? 'add' : 'select');
      // Empty page: a click only drops the selection. With nothing picked a
      // drawing tool's click is its own (Line / Arrow click-click).
      if (hasSelection) return result(drag, shiftKey ? 'keep' : 'deselect');
      return result(drag, SHAPE_DRAW_TOOLS.includes(tool) ? 'tool' : 'keep');
    }
    case 'ink':
      // Rule 4: never picks, ignores Shift; any other press clears and draws.
      return result('draw', 'tool', hasSelection);
    case 'point':
      // A click with something picked only deselects; never picks marks.
      if (hasSelection) return result('none', 'deselect', true);
      return result('none', 'tool');
    case 'eraser':
      // Rule 5: erases what it touches and drops the selection.
      return result('erase', 'tool', hasSelection);
    case 'text':
      // Rule 6.
      if (!hasSelection) return result('draw', 'new-text');
      if (target === 'text') return result('none', 'edit');
      if (target === 'mark') return result('none', 'select');
      return result('none', 'deselect', true);
    case 'place':
      // Counter drops a pin with a press; Survey Marker drags out a box.
      if (onMark) return result(tool === 'survey-marker' ? 'place' : 'none', 'select');
      return result('place', 'tool', hasSelection);
    default:
      return result('none', 'keep');
  }
}

/**
 * Rule 7 — a double-click (double-tap) on text. `wasSelected` is whether the
 * text was already selected BEFORE the double-click began.
 * Returns 'edit' | 'select' | 'tool'.
 */
export function resolveTextDoubleClick({ tool, wasSelected = false, pointerType = 'mouse' } = {}) {
  if (wasSelected) return 'edit';
  if (tool === 'text-select') return 'edit';
  if (getToolSelectionClass(tool) === 'select') return pointerType === 'touch' ? 'edit' : 'select';
  return 'tool';
}

/**
 * Rule 10 — each Escape press does ONE thing, in this order.
 * Returns 'close-popover' | 'commit-edit' | 'cancel-draft' | 'deselect'
 * | 'switch-to-pan' | null.
 */
export function resolveEscape({ popoverOpen = false, editing = false, draft = false, hasSelection = false, tool = 'pan' } = {}) {
  if (popoverOpen) return 'close-popover';
  if (editing) return 'commit-edit';
  if (draft) return 'cancel-draft';
  if (hasSelection) return 'deselect';
  if (tool !== 'pan') return 'switch-to-pan';
  return null;
}

/** Rule 10 — after Escape commits a text edit, the box stays selected. */
export const ESCAPE_COMMIT_KEEPS_TEXT_SELECTED = true;

/** Rule 10 — Delete removes the selection under any tool; the tool stays. */
export function shouldDeleteKeyRemoveSelection(_tool, hasSelection) {
  return !!hasSelection;
}

/**
 * Rule 10 — undo never changes what is picked: the current selection stays
 * (a mark moved back stays selected) and the mark undo brings back is never
 * picked. Only a mark that undo removes leaves the selection.
 */
export const UNDO_SELECTION_RULE = Object.freeze({ keepsSelection: true, addsSelection: false });

/** Rule 11 — handles hide while the selection is moved, resized or rotated. */
export const CHROME_HIDDEN_DURING = Object.freeze(['dragging', 'resizing', 'rotating']);
export function shouldHideSelectionChrome(interactionState) {
  return CHROME_HIDDEN_DURING.includes(interactionState);
}

/** Rule 12 — none of these ever drop the selection. */
export const SELECTION_SURVIVES = Object.freeze([
  'scroll', 'zoom', 'page-change', 'panel-open', 'shortcut-key', 'category-tab', 'pan-button',
]);

/**
 * Rule 12 — the one tool-switch rule for annotation selection. A tool
 * shortcut key, a toolbar category tab and the Pan button keep the
 * selection; picking a specific tool button in the toolbar ('toolbar', also
 * the answer for a caller that does not say) drops it. Pan <-> Select (box or
 * lasso) <-> Text Select keeps it however it was switched, except that leaving
 * Text Select still clears (its native text range and annotation pick end
 * together, as before). Returns the clear reason, or null to keep it.
 */
export function getToolSwitchSelectionClearReason(previousTool, nextTool, { source = 'toolbar' } = {}) {
  if (previousTool === nextTool) return null;
  if (previousTool === 'text-select') return 'text-select-tool-change';
  if (SELECTION_KEEPING_TOOLS.includes(nextTool)) return null;
  if (SELECTION_SURVIVES.includes(source)) return null;
  return 'tool-change';
}

/**
 * Rule 13 — touch: a tap is a click, a press-and-hold acts like a tap (it
 * picks what it lands on), a double-tap on text edits it under Select, Pan
 * and the shape tools.
 *
 * NOT YET COPIED: Drawboard opens no menu on a hold and keeps the actions
 * (Delete, Copy, Order…) behind its toolbar's ⋮ button. On our phone the hold
 * menu (Pan / Select) is still the only way to reach those actions for a
 * picked mark, and the phone ⋮ button belongs to the tool-settings sheet, so
 * the hold menu stays until that button carries the menu.
 */
export const TOUCH_RULES = Object.freeze({
  tapIsClick: true,
  holdIsTap: true,
  holdOpensMenu: true, // Drawboard: false — see above.
  doubleTapEditsText: true,
});
