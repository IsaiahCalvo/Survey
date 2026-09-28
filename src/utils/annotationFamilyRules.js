/**
 * annotationFamilyRules.js — one set of rules every mark type obeys for the
 * shared actions (w52 "one annotation family", 2026-09-28).
 *
 * Before this file each selection path (single drag, group drag, marquee,
 * lasso, callout click, counter orbit, z-order hotkeys) carried its own copy
 * of "may this mark move / be picked / be restacked", and the copies drifted:
 * a group drag moved imported highlights a single drag refused to move, the
 * marquee picked callouts the page was hiding, and callouts stayed clickable
 * inside a space where every other background mark goes inert. Each rule now
 * lives here once and every path calls it.
 *
 * Pure JS — the Node test runner imports this directly.
 */
import {
  isMovementLockedAnnotation,
  isTransformLockedAnnotation,
} from './annotationSelectionEligibility.js';
import {
  ANNOTATION_VISIBILITY_SCOPE,
  getAnnotationVisibilityScope,
} from './annotationVisibilityRules.js';
import { isUserLocked } from '../lib/collab/permissionScope.js';
import { getAnnotationBBox } from './svgBoundingBox.js';
import { commitInkObjectMove, isAbsoluteInkGeometry } from './inkGeometryTransform.js';
import { mergeDraggedMarksOntoPage } from './dragCommitMerge.js';
import { roundCommittedAnnotationsGeometry } from './annotationCommitRounding.js';
import { deepClone } from './deepClone.js';

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/**
 * May this mark's body be moved (drag, group drag, arrow-key nudge)?
 * The exact test the single-mark drag has always used: text markup is a
 * range anchored to PDF text (only its end handles change it), and a mark
 * locked against movement on both axes (imported highlights, fully locked
 * marks) never moves.
 */
export function canMoveAnnotation(annotation) {
  if (!annotation) return false;
  // RULED 2026-09-28 owner: open editing + lock — a user-locked mark never
  // moves, for anyone (its author or the document owner unlocks it first).
  if (isUserLocked(annotation)) return false;
  if (annotation?.data?.type === 'text-markup') return false;
  if (isMovementLockedAnnotation(annotation)) return false;
  if (isTransformLockedAnnotation(annotation)) return false;
  return true;
}

/**
 * May a counter be Shift-orbited (its body swings round the pointer tip and
 * its pointer angle turns)? Orbit both moves and rotates, so it needs both to
 * be unlocked — the same gate the move and rotate handles apply.
 */
export function canOrbitCounter(annotation) {
  if (annotation?.data?.type !== 'counter') return false;
  if (!canMoveAnnotation(annotation)) return false;
  if (annotation.lockRotation) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Space interactivity
// ---------------------------------------------------------------------------

/**
 * Inside an active space only marks scoped to one of that space's regions
 * can be picked; everything else stays visible as background but inert.
 * Outside a space every visible mark is interactive. (PAL interaction rule,
 * ported to the SVG layer for shapes; callouts now obey it too.)
 */
export function isInteractiveForActiveSpace({
  activeSpaceId = null,
  isScopedRegionAnnotation = false,
  derivedSpaceId = null,
} = {}) {
  if (activeSpaceId !== null && activeSpaceId !== undefined) {
    return Boolean(isScopedRegionAnnotation) && derivedSpaceId === activeSpaceId;
  }
  return true;
}

/** Same rule, resolving the mark's scope + space from the mark itself. */
export function isAnnotationInteractiveInActiveSpace({
  annotation,
  activeSpaceId = null,
  getSpaceIdForRegion = null,
} = {}) {
  if (!annotation) return false;
  const scope = getAnnotationVisibilityScope({
    moduleId: annotation.moduleId ?? null,
    regionId: annotation.regionId ?? null,
  });
  const isScopedRegionAnnotation = scope === ANNOTATION_VISIBILITY_SCOPE.REGION
    || scope === ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;
  const derivedSpaceId = isScopedRegionAnnotation && typeof getSpaceIdForRegion === 'function'
    ? getSpaceIdForRegion(annotation.regionId)
    : null;
  return isInteractiveForActiveSpace({ activeSpaceId, isScopedRegionAnnotation, derivedSpaceId });
}

/**
 * Keep only the callouts the page is actually showing and letting the user
 * pick. `isCalloutSelectable` is the layer's predicate (visible in context AND
 * interactive for the active space); when absent every callout passes, so
 * boot / test mounts keep their old behaviour.
 */
export function filterSelectableCallouts(callouts, isCalloutSelectable) {
  const list = Array.isArray(callouts) ? callouts : [];
  if (typeof isCalloutSelectable !== 'function') return list;
  return list.filter((callout) => callout && isCalloutSelectable(callout.id));
}

// ---------------------------------------------------------------------------
// Z-order for a whole selection
// ---------------------------------------------------------------------------

/**
 * Restack a selection inside the page's ONE stacking order, keeping the
 * selected marks' order among themselves.
 *   front    — every selected mark to the top, in its current relative order
 *   back     — every selected mark to the bottom, in its current relative order
 *   forward  — each selected run steps up past its next unselected neighbour
 *   backward — each selected run steps down past its previous unselected neighbour
 * Callouts take part through their projected slot in the same array.
 *
 * @param {Array} objects  the page's objects, bottom → top
 * @param {Iterable<number>} selectedIndices
 * @param {'front'|'back'|'forward'|'backward'} direction
 * @returns {{ objects: Array, selectedIndices: number[], changed: boolean, order: number[] }}
 *   `objects` holds the SAME object references, reordered; `order[newIndex]`
 *   is the old index now at newIndex.
 */
export function reorderSelectionInStack(objects, selectedIndices, direction) {
  const list = Array.isArray(objects) ? objects : [];
  const selected = new Set();
  for (const index of selectedIndices || []) {
    if (Number.isInteger(index) && index >= 0 && index < list.length) selected.add(index);
  }
  let entries = list.map((object, index) => ({ object, index, selected: selected.has(index) }));
  if (selected.size > 0) {
    if (direction === 'front' || direction === 'back') {
      const picked = entries.filter((entry) => entry.selected);
      const rest = entries.filter((entry) => !entry.selected);
      entries = direction === 'front' ? [...rest, ...picked] : [...picked, ...rest];
    } else if (direction === 'forward') {
      for (let index = entries.length - 2; index >= 0; index -= 1) {
        if (entries[index].selected && !entries[index + 1].selected) {
          [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]];
        }
      }
    } else if (direction === 'backward') {
      for (let index = 1; index < entries.length; index += 1) {
        if (entries[index].selected && !entries[index - 1].selected) {
          [entries[index], entries[index - 1]] = [entries[index - 1], entries[index]];
        }
      }
    }
  }
  const order = entries.map((entry) => entry.index);
  const changed = order.some((oldIndex, newIndex) => oldIndex !== newIndex);
  return {
    objects: entries.map((entry) => entry.object),
    selectedIndices: entries.reduce((acc, entry, index) => {
      if (entry.selected) acc.push(index);
      return acc;
    }, []),
    changed,
    order,
  };
}

/** Cmd/Ctrl + ] / [ (Shift = all the way) → z-order direction, else null. */
export function zOrderDirectionForKey(event) {
  if (!event) return null;
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (event.code === 'BracketRight') return event.shiftKey ? 'front' : 'forward';
  if (event.code === 'BracketLeft') return event.shiftKey ? 'back' : 'backward';
  return null;
}

// ---------------------------------------------------------------------------
// Arrow-key nudge
// ---------------------------------------------------------------------------

export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;
// A nudge burst commits this long after its last press (taps and auto-repeat
// in quick succession are one move, one Undo step, one saved row). w57: 400 ms
// — longer than the OS auto-repeat gap and a quick re-tap, short enough that
// other screens get the move right after you pause.
export const NUDGE_IDLE_COMMIT_MS = 400;

const ARROW_DELTAS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export const isArrowKey = (key) => Object.prototype.hasOwnProperty.call(ARROW_DELTAS, key);

/**
 * Page-unit step for an arrow key press: 1 per press, 10 with Shift.
 * Returns null for any other key or when Cmd/Ctrl/Alt is held (those chords
 * belong to the app / OS — word jumps, page turns, history).
 */
export function nudgeDeltaForKey(event) {
  if (!event || !isArrowKey(event.key)) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
  const [ux, uy] = ARROW_DELTAS[event.key];
  return { dx: ux * step, dy: uy * step };
}

/**
 * True when keyboard focus is somewhere that owns typing or arrow keys (an
 * input, a text area, a select, a contentEditable editor, the Fabric hidden
 * textarea, a menu / listbox / slider / tab / dialog widget) — arrow keys
 * must work there, never move the selection.
 */
export function isTypingTarget(element) {
  if (!element) return false;
  const tag = String(element.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (element.isContentEditable === true) return true;
  if (element.contentEditable === 'true') return true;
  if (typeof element.closest === 'function') {
    if (element.closest('.fabric-hidden-textarea')) return true;
    if (element.closest('[contenteditable="true"]')) return true;
    // Widgets that use the arrow keys themselves: toolbar dropdowns and
    // menus, the colour picker's sliders, tabs, radio groups, dialogs.
    // (Review 2026-09-28: the nudge swallowed ArrowDown in the stroke
    // dropdown and the hue slider while a mark was selected.)
    if (element.closest(ARROW_OWNING_WIDGETS)) return true;
  }
  return false;
}

// A held arrow key stops counting as held this long after its last keydown
// (auto-repeat sends a keydown every ~30-80 ms once it starts; macOS's
// slowest "Delay until repeat" is ~2 s). Covers a release the page never saw.
export const NUDGE_HELD_KEY_GRACE_MS = 2500;

/**
 * Is an arrow key of this burst still held down? Then the idle commit waits
 * (one hold = one undo step, however slow the OS repeat delay).
 * @param {{ keysDown?: Set<string>, lastKeyDownAt?: number }} burst
 */
export function isNudgeKeyStillHeld(burst, now) {
  if (!burst || !(burst.keysDown instanceof Set) || burst.keysDown.size === 0) return false;
  const last = Number(burst.lastKeyDownAt);
  if (!Number.isFinite(last)) return false;
  return now - last < NUDGE_HELD_KEY_GRACE_MS;
}

// Save-a-running-nudge-burst hooks. Each page layer registers one while it
// can nudge; Undo / Redo call flushPendingNudges() first, because the
// viewer's undo key handler runs before the layers' listeners (and the
// desktop app's Edit menu sends no key to the page at all).
const pendingNudgeFlushes = new Set();

export function registerPendingNudgeFlush(flush) {
  if (typeof flush !== 'function') return () => {};
  pendingNudgeFlushes.add(flush);
  return () => pendingNudgeFlushes.delete(flush);
}

export function flushPendingNudges() {
  for (const flush of Array.from(pendingNudgeFlushes)) {
    try { flush(); } catch { /* a failed flush never blocks Undo */ }
  }
}

/**
 * True while a popover that sits over the page is open — the right-click
 * menu. Arrow keys then belong to it: the mark behind it must not move where
 * you can't see it (Acrobat / Drawboard never move a mark with a menu open).
 */
export function isArrowOwningPopoverOpen(doc) {
  if (!doc || typeof doc.querySelector !== 'function') return false;
  return doc.querySelector('[data-annotation-context-menu]') != null;
}

/**
 * The render-time preview a nudge burst paints (no store write per press —
 * the same translate a drag paints). One selected shape previews like a
 * single drag (numeric id: its handles follow); anything else previews like a
 * group drag (the frame, callouts and Survey Markers follow). `nudge: true`
 * lets the commit clear only its own preview.
 * @param {{ startObjects: object, calloutOriginals: object, markerBoxes?: object,
 *           singleShape?: boolean, dx: number, dy: number }} burst
 */
export function nudgePreviewTransform(burst) {
  const indexes = Object.keys(burst?.startObjects || {}).map(Number);
  const calloutIds = Object.keys(burst?.calloutOriginals || {});
  const markerIds = Object.keys(burst?.markerBoxes || {});
  const dx = Number(burst?.dx) || 0;
  const dy = Number(burst?.dy) || 0;
  if (burst?.singleShape && indexes.length === 1 && calloutIds.length === 0 && markerIds.length === 0) {
    return { id: indexes[0], dx, dy, nudge: true };
  }
  return {
    id: 'group',
    dx,
    dy,
    affectedIds: new Set(indexes),
    affectedCalloutIds: calloutIds.length > 0 ? new Set(calloutIds) : null,
    affectedMarkerIds: markerIds.length > 0 ? new Set(markerIds) : null,
    markerDelta: markerIds.length > 0 ? { dx, dy } : null,
    nudge: true,
  };
}

const ARROW_OWNING_WIDGETS = [
  'menu', 'menubar', 'menuitem', 'menuitemradio', 'menuitemcheckbox',
  'listbox', 'option', 'combobox', 'slider', 'spinbutton', 'scrollbar',
  'tab', 'tablist', 'radio', 'radiogroup', 'grid', 'tree', 'treegrid',
  'dialog', 'alertdialog',
].map((role) => `[role="${role}"]`).join(',');

/**
 * Clamp a nudge so the selection's union box stays on the page, moving every
 * member by the same amount (relative positions never drift at an edge). A
 * box that already sits past an edge is never pushed back in by a nudge in
 * the other direction.
 * @param {Array<{left:number, top:number, width:number, height:number}>} boxes page units
 */
export function clampNudgeDelta(boxes, dx, dy, pageWidth, pageHeight) {
  const list = (Array.isArray(boxes) ? boxes : []).filter((box) => box
    && Number.isFinite(box.left) && Number.isFinite(box.top)
    && Number.isFinite(box.width) && Number.isFinite(box.height));
  if (list.length === 0 || !(pageWidth > 0) || !(pageHeight > 0)) return { dx, dy };
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  for (const box of list) {
    minLeft = Math.min(minLeft, box.left);
    minTop = Math.min(minTop, box.top);
    maxRight = Math.max(maxRight, box.left + box.width);
    maxBottom = Math.max(maxBottom, box.top + box.height);
  }
  const minDx = Math.min(0, -minLeft);
  const maxDx = Math.max(0, pageWidth - maxRight);
  const minDy = Math.min(0, -minTop);
  const maxDy = Math.max(0, pageHeight - maxBottom);
  return {
    dx: Math.max(minDx, Math.min(maxDx, dx)),
    dy: Math.max(minDy, Math.min(maxDy, dy)),
  };
}

/** A callout's page-unit box (arrow tip, knee and text box together). */
export function getCalloutPageBox(callout, pageWidth, pageHeight) {
  if (!callout) return null;
  const xs = [callout.arrowTip?.x, callout.knee?.x, callout.textBoxPosition?.x]
    .filter(Number.isFinite);
  const ys = [callout.arrowTip?.y, callout.knee?.y, callout.textBoxPosition?.y]
    .filter(Number.isFinite);
  if (xs.length === 0 || ys.length === 0) return null;
  if (Number.isFinite(callout.textBoxPosition?.x)) {
    xs.push(callout.textBoxPosition.x + (Number(callout.textBoxWidth) || 0));
  }
  if (Number.isFinite(callout.textBoxPosition?.y)) {
    ys.push(callout.textBoxPosition.y + (Number(callout.textBoxHeight) || 0));
  }
  const left = Math.min(...xs) * pageWidth;
  const top = Math.min(...ys) * pageHeight;
  return {
    left,
    top,
    width: Math.max(...xs) * pageWidth - left,
    height: Math.max(...ys) * pageHeight - top,
  };
}

/** The callout geometry patch a nudge of (dx, dy) page units produces. */
export function nudgeCalloutPatch(original, dx, dy, pageWidth, pageHeight) {
  const nx = dx / (pageWidth || 1);
  const ny = dy / (pageHeight || 1);
  const shift = (point) => ({ x: (point?.x ?? 0) + nx, y: (point?.y ?? 0) + ny });
  return {
    arrowTip: shift(original?.arrowTip),
    knee: shift(original?.knee),
    textBoxPosition: shift(original?.textBoxPosition),
  };
}

/**
 * Translate one mark by (dx, dy) page units exactly as a group drag commits
 * it: absolute-coordinate ink moves its path data, everything else moves
 * left/top, and a curved line's absolute midpoint rides along.
 */
export function translateAnnotationForMove(annotation, dx, dy) {
  const moved = deepClone(annotation);
  if (isAbsoluteInkGeometry(moved)) {
    Object.assign(moved, commitInkObjectMove(moved, dx, dy));
    return moved;
  }
  moved.left = (moved.left ?? 0) + dx;
  moved.top = (moved.top ?? 0) + dy;
  if (String(moved.type || '').toLowerCase() === 'line' && moved.data?.midpoint) {
    moved.data = {
      ...moved.data,
      midpoint: { x: moved.data.midpoint.x + dx, y: moved.data.midpoint.y + dy },
    };
  }
  return moved;
}

/**
 * The page a nudge frame saves: each nudged mark's burst-start copy moved by
 * the burst's total delta, written field-by-field onto the page AS IT IS NOW
 * (mergeDraggedMarksOntoPage), so a collaborator's edit that landed mid-burst
 * is never overwritten and a mark deleted meanwhile stays deleted.
 *
 * @param {object} currentPage   { objects } now
 * @param {object} startObjects  { [burstStartIndex]: burst-start object }
 * @returns {{ annotations: object, indexes: number[] } | null}
 */
export function buildNudgedPage(currentPage, startObjects, dx, dy) {
  const draggedObjects = [];
  for (const [indexKey, startObject] of Object.entries(startObjects || {})) {
    if (!startObject) continue;
    draggedObjects[Number(indexKey)] = translateAnnotationForMove(startObject, dx, dy);
  }
  const merged = mergeDraggedMarksOntoPage(currentPage, { objects: draggedObjects }, startObjects);
  if (!merged) return null;
  roundCommittedAnnotationsGeometry(merged.annotations, merged.indexes);
  return merged;
}

/** Page-unit boxes of the marks about to be nudged (for clampNudgeDelta). */
export function getNudgeBoxes(startObjects) {
  return Object.values(startObjects || {})
    .filter(Boolean)
    .map((object) => getAnnotationBBox(object));
}
