import { CALLOUT_MARK_GROUP, getToolGroup } from './markToolGroup.js';

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
//   - a press on the page under any tool -> resolveToolPress (rules below)
// Things that never deselect (SELECTION_SURVIVES): changing a property of the
// picked mark in the properties bar, scroll / zoom, a page change, opening a
// panel or the right-click menu, undo. (A tool switch other than Select <->
// Pan does drop it, owner 2026-10-04.)
// ---------------------------------------------------------------------------

/**
 * The tools that pick any mark. Moving between them keeps the selection;
 * every other tool switch drops it (owner 2026-10-04, rule 12 below).
 */
export const SELECTION_KEEPING_TOOLS = Object.freeze(['pan', 'select', 'text-select']);

/** Escape deselects under every tool (Drawboard: Esc = "Deselect All"). */
export function shouldEscapeDeselect(_activeTool) {
  return true;
}

/**
 * A plain press on the grey backdrop deselects under the Select family (on
 * the press) and — owner 2026-10-04, "clicking empty space while something
 * is selected must deselect it" — under the Shapes / Text tools that pick
 * their own group's marks (on a click: the viewer waits for a release that
 * did not travel). Pan picks by its own quick-click and keeps a pick while it
 * pans; the Draw group never holds one.
 */
export function shouldBackdropPressDeselect(activeTool) {
  return isSelectFamilyTool(activeTool) || (activeTool !== 'pan' && canToolPickAnyGroup(activeTool));
}

// ---------------------------------------------------------------------------
// DRAWBOARD PDF RULES (owner 2026-10-02; study: scratchpad/drawboard2/RULES.md)
// The one table for "what does a press or a key do to the selection" under
// every tool. The viewer, the SVG layer and the Text / Counter overlays ask
// these functions and nothing else. Numbers are the study's rule numbers;
// tests/selectModes.test.mjs pins each one.
//
// OWN TOOL GROUP ONLY (owner 2026-10-04, replaces Drawboard's "a shape tool
// clicks any mark"): "the select tool can select any annotation, and its
// formatting and tool groups come up … The same thing should happen with the
// pan tool. If any tool from the draw tool group is active and the user
// clicks, it should use that tool, not use it for selection. If any tool from
// the shapes tool group is active, it should [use] that tool, but … also be
// able to select [marks] within its tool group. The same thing goes for
// text." So:
//   Select / Lasso / Text Select / Pan — a click picks ANY mark.
//   Draw group (pen, highlighter, eraser) — a press always uses the tool;
//     never picks, no hover halo, never grabs the selection.
//   Every other group (Shapes, Text, Survey Marker) — a click picks a mark of
//     the tool's OWN group (utils/markToolGroup.js); a mark of another group
//     is not there for the tool: the press does what it does on empty page.
// tests/toolPressMatrix.test.mjs pins every tool x mark pair.
// ---------------------------------------------------------------------------

/** The tools that pick any mark, whatever its group. */
export const PICK_ANY_TOOLS = Object.freeze(['select', 'text-select', 'pan']);

/**
 * Can `tool` pick (click-select, hover-halo, grab) a mark of `markGroup`
 * (utils/markToolGroup.js getMarkGroup)? Select, Text Select and Pan: any
 * mark. The Draw group: none. Any other tool: its own group's marks only.
 */
export function canToolPickMark(tool, markGroup) {
  if (PICK_ANY_TOOLS.includes(tool)) return true;
  const group = getToolGroup(tool);
  if (!group || group === 'draw') return false;
  return markGroup === group;
}

/** Does `tool` pick any marks at all (and so show a hover halo on them)? */
export function canToolPickAnyGroup(tool) {
  if (PICK_ANY_TOOLS.includes(tool)) return true;
  const group = getToolGroup(tool);
  return !!group && group !== 'draw';
}

/**
 * Rule 1 — tool classes (HOW a tool uses a press; WHICH marks it may pick is
 * canToolPickMark above).
 *   select : picks marks itself (Select, Lasso = Select in lasso mode, Text
 *            Select, Pan).
 *   shape  : draws on a drag, picks on a click (Rectangle, Ellipse, Line,
 *            Arrow, Callout; Cloud is a border style of these, not a tool).
 *   ink    : Pen, Highlighter — never pick; a press draws.
 *   point  : Polygon, Polyline — a click drops a point (mid-shape, always).
 *   eraser : deletes the marks it touches.
 *   text   : the Text box tool (rule 6).
 *   place  : Counter and Survey Marker (ours, not in Drawboard): a click on a
 *            mark it may pick picks it, a press elsewhere places a new one.
 */
export const TOOL_CLASSES = Object.freeze({
  select: Object.freeze(['select', 'text-select', 'pan']),
  shape: Object.freeze(['rect', 'ellipse', 'line', 'arrow', 'callout']),
  ink: Object.freeze(['pen', 'highlighter']),
  point: Object.freeze(['polygon', 'polyline']),
  eraser: Object.freeze(['eraser']),
  text: Object.freeze(['text']),
  place: Object.freeze(['counter', 'survey-marker']),
});

/** Tools whose drag draws a new shape and whose click picks (rule 3). */
export const SHAPE_DRAW_TOOLS = TOOL_CLASSES.shape;

export function getToolSelectionClass(tool) {
  for (const [name, tools] of Object.entries(TOOL_CLASSES)) {
    if (tools.includes(tool)) return name;
  }
  return 'other';
}

/**
 * Rule 2 — the blue hover halo: under Pan and every tool that picks marks,
 * over a mark that tool may pick (`markGroup` given), or at all (omitted).
 * Select draws its own halo on the live layer. (The eraser's Whole-mode
 * delete preview is the eraser's own tool preview, not this halo.)
 */
export function shouldShowHoverHalo(tool, markGroup) {
  if (arguments.length < 2) return canToolPickAnyGroup(tool);
  return canToolPickMark(tool, markGroup);
}

/**
 * Can a press under `tool` take hold of the current selection (move it, drag
 * its handles, double-press its text) instead of using the tool? Only a tool
 * that may pick every selected mark: Select / Pan always, a group tool when
 * the whole selection is its own group's, the Draw group never (a press there
 * always draws or erases).
 */
export function canToolGrabSelection(tool, selectedMarkGroups = []) {
  if (!canToolPickAnyGroup(tool)) return false;
  return Array.from(selectedMarkGroups).every((group) => canToolPickMark(tool, group));
}

/**
 * Rules 2-6 and 8 — one press on the page.
 *
 * target: 'selection' (a selected mark or one of its handles), 'text' (an
 *         unselected text box or callout), 'mark' (any other unselected mark)
 *         or 'empty'.
 * markGroup: the pressed mark's tool group (utils/markToolGroup.js). A mark
 *         the tool may not pick (canToolPickMark) counts as empty page.
 * Returns { drag, click, clearsSelection }:
 *   drag  — what the press does if it travels: 'manipulate' (move / resize
 *           the selection, tool stays), 'box-select', 'pan', 'draw', 'erase',
 *           'place' (the tool's own job) or 'none'.
 *   click — what it does if it does not travel: 'keep', 'select' (the pressed
 *           mark), 'add' (Shift: add it), 'deselect', 'new-text', or 'tool'
 *           (the tool's own click: a dot, a point, a pin, the start of a
 *           Line's click-click).
 *   clearsSelection — the selection goes as soon as the press lands.
 */
export function resolveToolPress({ tool, target = 'empty', markGroup = null, hasSelection = false, shiftKey = false } = {}) {
  const cls = getToolSelectionClass(tool);
  const result = (drag, click, clearsSelection = false) => ({ drag, click, clearsSelection });
  // The selected mark and its handles move / resize it (rules 3, 4) — under a
  // tool that may grab it (callers only report 'selection' then).
  if (target === 'selection' && canToolPickAnyGroup(tool)) return result('manipulate', 'keep');
  // Own group only: a mark the tool may not pick is not there for it.
  const onMark = (target === 'mark' || target === 'text') && canToolPickMark(tool, markGroup);
  switch (cls) {
    case 'select': {
      const drag = tool === 'pan' ? 'pan' : 'box-select';
      // Rule 2 / 3 / 8: a click picks (Shift adds); a drag is the tool's own
      // job even when it starts on a mark that is not selected.
      if (onMark) return result(drag, shiftKey ? 'add' : 'select');
      if (hasSelection) return result(drag, shiftKey ? 'keep' : 'deselect');
      return result(drag, 'keep');
    }
    case 'shape':
      // A click picks an own-group mark (Shift adds); a drag draws, even from
      // a mark. Empty page: a click only drops the pick; with nothing picked
      // the click is the tool's own (Line / Arrow click-click).
      if (onMark) return result('draw', shiftKey ? 'add' : 'select');
      if (hasSelection) return result('draw', shiftKey ? 'keep' : 'deselect');
      return result('draw', 'tool');
    case 'ink':
      // Rule 4: never picks, ignores Shift; a press clears and draws.
      return result('draw', 'tool', hasSelection);
    case 'point':
      // Callers ask only before the first point: once a shape is under way
      // every click is a point.
      if (onMark) return result('none', shiftKey ? 'add' : 'select');
      if (hasSelection) return result('none', 'deselect', true);
      return result('none', 'tool');
    case 'eraser':
      // Rule 5: erases what it touches and drops the selection.
      return result('erase', 'tool', hasSelection);
    case 'text':
      // Rule 6 (owner 2026-10-04): a click on a text box or callout picks it
      // (a double-click / second click on the picked text edits it, rule 7);
      // anywhere else, with nothing picked, makes a new box; with something
      // picked the first click only drops the pick.
      if (onMark) return result('none', 'select');
      if (!hasSelection) return result('draw', 'new-text');
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
  // Tools that may pick a text box (Select, Pan, the Text group) pick it on a
  // mouse double-click and edit it on a double-tap; any other tool's double
  // press is its own.
  if (canToolPickMark(tool, CALLOUT_MARK_GROUP)) return pointerType === 'touch' ? 'edit' : 'select';
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

/** Rule 12 — none of these ever drop the selection (none is a tool switch). */
export const SELECTION_SURVIVES = Object.freeze([
  'scroll', 'zoom', 'page-change', 'panel-open',
]);

/**
 * Rule 12 — the one tool-switch rule for annotation selection.
 * Owner 2026-10-04: "Switching tools clears the selection, EXCEPT switching
 * between Select and Pan (both can select, so keep it)" — so the new tool
 * works on its very first press, with no picked mark or handles in its way.
 * However the switch was asked for (tool button, shortcut key, category tab)
 * a switch to a drawing / shape / text / eraser tool drops the pick. A switch
 * INTO Pan, Select (box or lasso) or Text Select keeps it: those tools pick
 * any mark, and the viewer's own hand-overs (a new callout opening its editor,
 * "show this mark" from a panel, closing Areas) switch to Select with a pick
 * in hand. Leaving Text Select still clears (its native text range and
 * annotation pick end together, as before). `source` is still passed by the
 * viewer for its logs; it no longer changes the answer.
 * Returns the clear reason, or null to keep it.
 */
export function getToolSwitchSelectionClearReason(previousTool, nextTool, _options = {}) {
  if (previousTool === nextTool) return null;
  if (previousTool === 'text-select') return 'text-select-tool-change';
  if (SELECTION_KEEPING_TOOLS.includes(nextTool)) return null;
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
