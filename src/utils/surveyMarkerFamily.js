/**
 * surveyMarkerFamily.js — Survey Markers as members of the one annotation
 * family on the canvas (w53, 2026-09-28).
 *
 * Owner ask (2026-09-28): "annotations are annotations". Survey Markers keep
 * their OWN store — the document's `surveyMarkers` map, one whole record per
 * marker, read and written by the two-way Excel sync (Row ID identity, the
 * whitelisted Excel-owned fields in importFieldWhitelist.js). Nothing here
 * changes that contract. Instead the canvas treats a marker like any other
 * mark at the INTERACTION layer: it can be picked with marquee / lasso /
 * Shift-click together with shapes and callouts, moved and nudged with them,
 * restacked among them, and copied / pasted / duplicated with them. This
 * module holds the pure rules (no React, no Yjs) so the Node tests can pin
 * them.
 *
 * Stacking model. Regular marks keep their own persisted order (each stored
 * mark carries `z`, annotationStackOrder.js); a marker cannot share that
 * number space (it lives in another map and the screen never sees a mark's
 * stored `z`). So a marker records WHERE it sits in its page's stack by
 * naming its neighbours:
 *
 *   marker.stack = { after: <id of the mark right below> | null,
 *                    before: <id of the mark right above> | null,
 *                    order: <number, ties between markers in one gap> }
 *
 * It is drawn right above `after`; if that mark is gone, right below
 * `before`; with neither found it draws on top — except a marker placed at
 * the very bottom (`bottom: true`, no mark below it), which stays at the
 * bottom. A marker with NO `stack` (every marker written before w53) draws
 * above every mark, exactly as before — an untouched document looks the same.
 *
 * `stack` is display-only bookkeeping: it is not an Excel field (the export
 * row is built from markerRowValues.js, which never reads it) and the Excel
 * "not synced" fingerprint strips it (excelSyncDirtyState.js).
 */

import { isBBoxFullyContained, isBBoxOverlapping } from './marqueeSelection.js';
import {
  doesGeometryCrossLasso,
  isGeometryFullyInsideLasso,
  normalizeLassoPolygon,
  normalizeLassoTrail,
} from './lassoSelection.js';

export const SURVEY_MARKER_HISTORY_TYPE = 'survey-marker:batch';

/** The stable id of a regular mark (the store's key, promoted to data.id). */
export function markIdOf(object) {
  if (!object || typeof object !== 'object') return null;
  const id = object?.data?.id ?? object?.id ?? null;
  if (id == null) return null;
  return String(id);
}

// ---------------------------------------------------------------------------
// Stack order
// ---------------------------------------------------------------------------

function isStack(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The gap a marker sits in: an integer g in [0, objects.length], meaning
 * "between objects[g - 1] and objects[g]" (0 = below every mark, length = on
 * top of every mark).
 */
export function resolveMarkerGap(objects, stack, idIndex = null) {
  const list = Array.isArray(objects) ? objects : [];
  const top = list.length;
  if (!isStack(stack)) return top;
  const indexOf = (id) => {
    if (id == null) return -1;
    if (idIndex) return idIndex.has(String(id)) ? idIndex.get(String(id)) : -1;
    return list.findIndex((object) => markIdOf(object) === String(id));
  };
  const after = indexOf(stack.after);
  if (after >= 0) return after + 1;
  const before = indexOf(stack.before);
  if (before >= 0) return before;
  if (stack.bottom === true) return 0;
  return top;
}

function buildIdIndex(objects) {
  const map = new Map();
  (Array.isArray(objects) ? objects : []).forEach((object, index) => {
    const id = markIdOf(object);
    if (id != null && !map.has(id)) map.set(id, index);
  });
  return map;
}

function stackOrderValue(marker) {
  const value = Number(marker?.stack?.order);
  return Number.isFinite(value) ? value : 0;
}

/**
 * The page's one stack, bottom → top, marks and markers interleaved:
 * [{ kind: 'mark', index } | { kind: 'marker', id }].
 * `markers` = [{ id, stack }] (render order; the tie-break for equal slots).
 */
export function buildFamilyStack(objects, markers) {
  const list = Array.isArray(objects) ? objects : [];
  const idIndex = buildIdIndex(list);
  const byGap = new Map();
  (Array.isArray(markers) ? markers : []).forEach((marker, position) => {
    if (!marker || marker.id == null) return;
    const gap = resolveMarkerGap(list, marker.stack, idIndex);
    if (!byGap.has(gap)) byGap.set(gap, []);
    byGap.get(gap).push({ marker, position });
  });
  for (const entries of byGap.values()) {
    entries.sort((a, b) => {
      const byOrder = stackOrderValue(a.marker) - stackOrderValue(b.marker);
      if (byOrder !== 0) return byOrder;
      return a.position - b.position;
    });
  }
  const out = [];
  const flush = (gap) => {
    for (const { marker } of byGap.get(gap) || []) out.push({ kind: 'marker', id: String(marker.id) });
  };
  for (let index = 0; index < list.length; index += 1) {
    flush(index);
    out.push({ kind: 'mark', index });
  }
  flush(list.length);
  return out;
}

/** Marker ids grouped by the gap they draw in: Map<gap, id[]> (bottom → top). */
export function markerIdsByGap(objects, markers) {
  const result = new Map();
  let gap = 0;
  for (const entry of buildFamilyStack(objects, markers)) {
    if (entry.kind === 'mark') {
      gap = entry.index + 1;
      continue;
    }
    if (!result.has(gap)) result.set(gap, []);
    result.get(gap).push(entry.id);
  }
  return result;
}

export function sameStack(a, b) {
  if (!isStack(a) || !isStack(b)) return !isStack(a) && !isStack(b);
  return (a.after ?? null) === (b.after ?? null)
    && (a.before ?? null) === (b.before ?? null)
    && Boolean(a.bottom) === Boolean(b.bottom)
    && stackOrderValue(a) === stackOrderValue({ stack: b });
}

/**
 * The `stack` of every marker in `sequence` (a family stack, bottom → top,
 * whose mark entries hold the mark objects themselves): its neighbouring
 * marks' ids and its rank among the markers sharing that gap.
 * Returns Map<markerId, stack>.
 */
export function stacksForSequence(sequence) {
  const result = new Map();
  let belowId = null;
  let run = [];
  const closeRun = (aboveId) => {
    run.forEach((id, rank) => {
      const stack = { after: belowId, before: aboveId, order: rank };
      if (belowId == null) stack.bottom = true;
      result.set(id, stack);
    });
    run = [];
  };
  for (const entry of sequence) {
    if (entry.kind === 'marker') {
      run.push(entry.id);
    } else {
      const id = markIdOf(entry.object);
      closeRun(id);
      belowId = id;
    }
  }
  closeRun(null);
  return result;
}

/**
 * Restack a selection that may mix marks and Survey Markers inside the page's
 * one stack (same permutation as reorderSelectionInStack in
 * annotationFamilyRules.js: front / back / forward / backward, the selection
 * keeps its own order).
 *
 * @param {Array} objects     the page's marks, bottom → top
 * @param {Array} markers     [{ id, stack }] the page's visible markers
 * @param {object} selection  { selectedIndices, selectedMarkerIds, direction }
 * @returns {{ objects: Array, markerStacks: Map<string, object>,
 *             selectedIndices: number[], changed: boolean, objectsChanged: boolean }}
 *   `objects` holds the same references, reordered. `markerStacks` names only
 *   markers whose stack must be written (a marker that had none gets one once
 *   anything on its page is restacked, so it stops floating above it all).
 */
const objectKeys = new WeakMap();
let objectKeySeq = 0;
// A key for a mark object: its id, else a per-object token.
function keyOfObject(object) {
  const id = markIdOf(object);
  if (id != null) return id;
  if (!object || typeof object !== 'object') return '?';
  if (!objectKeys.has(object)) { objectKeySeq += 1; objectKeys.set(object, `#${objectKeySeq}`); }
  return objectKeys.get(object);
}

export function planFamilyReorder(objects, markers, { selectedIndices = [], selectedMarkerIds = [], direction, overlaps = null } = {}) {
  const list = Array.isArray(objects) ? objects : [];
  const markerList = (Array.isArray(markers) ? markers : []).filter((m) => m && m.id != null);
  const markerById = new Map(markerList.map((m) => [String(m.id), m]));
  const pickedIndices = new Set([...(selectedIndices || [])].filter((i) => Number.isInteger(i)));
  const pickedMarkers = new Set([...(selectedMarkerIds || [])].map(String).filter((id) => markerById.has(id)));
  const sequence = buildFamilyStack(list, markerList).map((entry) => ({
    ...entry,
    object: entry.kind === 'mark' ? list[entry.index] : null,
    selected: entry.kind === 'mark' ? pickedIndices.has(entry.index) : pickedMarkers.has(entry.id),
  }));
  let entries = sequence.slice();
  const pickedCount = pickedIndices.size + pickedMarkers.size;
  // One item stepping forward / backward with an `overlaps(a, b)` test: it
  // jumps past the nearest neighbour it actually overlaps (Figma rule, the
  // same one the single-mark Bring forward / Send backward use), or stays.
  if (pickedCount === 1 && typeof overlaps === 'function'
    && (direction === 'forward' || direction === 'backward')) {
    const from = entries.findIndex((entry) => entry.selected);
    const step = direction === 'forward' ? 1 : -1;
    let to = -1;
    for (let index = from + step; index >= 0 && index < entries.length; index += step) {
      if (overlaps(entries[from], entries[index])) { to = index; break; }
    }
    if (to >= 0) {
      const [moved] = entries.splice(from, 1);
      entries.splice(to, 0, moved);
    }
  } else if (pickedCount > 0) {
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
  const changed = entries.some((entry, index) => entry !== sequence[index]);
  const nextObjects = entries.filter((entry) => entry.kind === 'mark').map((entry) => entry.object);
  const objectsChanged = entries
    .filter((entry) => entry.kind === 'mark')
    .some((entry, position) => entry.index !== position);
  // Write a marker's stack only where its drawn place would otherwise be
  // wrong: a restack of marks never rewrites markers that stay where they
  // are (each write is a whole-record write in the marker store).
  const markerStacks = new Map();
  if (changed) {
    const planned = stacksForSequence(entries);
    const keyOfEntry = (entry) => (entry.kind === 'marker' ? `k:${entry.id}` : `m:${keyOfObject(entry.object)}`);
    const plannedKeys = entries.map(keyOfEntry);
    const resolveKeys = (overrides) => buildFamilyStack(
      nextObjects,
      markerList.map((marker) => (overrides.has(String(marker.id))
        ? { ...marker, stack: overrides.get(String(marker.id)) }
        : marker)),
    ).map((entry) => (entry.kind === 'marker' ? `k:${entry.id}` : `m:${keyOfObject(nextObjects[entry.index])}`));
    const neighbours = (keys, key) => {
      const at = keys.indexOf(key);
      return `${keys[at - 1] ?? '^'}|${keys[at + 1] ?? '$'}`;
    };
    const current = resolveKeys(new Map());
    for (const [id] of planned) {
      const key = `k:${id}`;
      if (neighbours(current, key) !== neighbours(plannedKeys, key)) markerStacks.set(id, planned.get(id));
    }
    if (resolveKeys(markerStacks).join(',') !== plannedKeys.join(',')) {
      for (const [id, stack] of planned) {
        if (!sameStack(markerById.get(id)?.stack, stack)) markerStacks.set(id, stack);
      }
    }
  }
  const selectedAfter = [];
  entries.filter((entry) => entry.kind === 'mark').forEach((entry, position) => {
    if (entry.selected) selectedAfter.push(position);
  });
  return { objects: nextObjects, markerStacks, selectedIndices: selectedAfter, changed, objectsChanged };
}

/**
 * The stack a NEW marker gets so it lands on top of its page, like every new
 * mark (right above the page's current top mark).
 */
export function stackOnTop(objects) {
  const list = Array.isArray(objects) ? objects : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const id = markIdOf(list[index]);
    if (id != null) return { after: id, before: null, order: Date.now() };
  }
  return { after: null, before: null, bottom: true, order: Date.now() };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** A marker record's page-unit box { left, top, width, height, angle }. */
export function surveyMarkerRecordBox(record) {
  const b = record?.bounds;
  if (!b) return null;
  const left = Number(b.x);
  const top = Number(b.y);
  const width = Number(b.width);
  const height = Number(b.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  const angle = Number(b.angle);
  return { left, top, width, height, angle: Number.isFinite(angle) ? angle : 0 };
}

/** The four corners of a (possibly rotated about its centre) box. */
export function boxCorners(box) {
  if (!box) return [];
  const { left, top, width, height } = box;
  const cx = left + width / 2;
  const cy = top + height / 2;
  const rad = ((Number(box.angle) || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [left, top], [left + width, top], [left + width, top + height], [left, top + height],
  ].map(([x, y]) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  }));
}

/** Axis-aligned bounds { left, top, right, bottom, width, height } of a box. */
export function boxWorldBounds(box) {
  const corners = boxCorners(box);
  if (corners.length === 0) return null;
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Lasso geometry (lassoSelection.js shape) of a marker box. */
export function surveyMarkerLassoGeometry(box) {
  const bounds = boxWorldBounds(box);
  if (!bounds) return null;
  return { bounds, outlines: [boxCorners(box)], interiorSelectable: true };
}

/** Move a record's bounds by (dx, dy) page units; everything else untouched. */
export function translateSurveyMarkerRecord(record, dx, dy) {
  if (!record?.bounds) return record;
  return {
    ...record,
    bounds: {
      ...record.bounds,
      x: (Number(record.bounds.x) || 0) + dx,
      y: (Number(record.bounds.y) || 0) + dy,
    },
  };
}

// ---------------------------------------------------------------------------
// Undo / redo (local annotation history lane)
// ---------------------------------------------------------------------------
//
// A family action that changes marks AND markers is ONE undo step: the page
// action (fabric:batch / fabric:reorder …) and a `survey-marker:batch` child
// ride one `fabric:document-batch`. A marker-only action is that child alone.
// Undo writes back ONLY the fields the step changed onto each marker as it is
// now (field-level, like the page lane), so an Excel edit to a marker's name
// or checklist made after the step is never reverted.

/** { type, changes: [{ id, before, after }] } or null when nothing changed. */
export function buildSurveyMarkerHistoryAction(changes) {
  const list = (Array.isArray(changes) ? changes : [])
    .filter((change) => change && change.id != null)
    .filter((change) => JSON.stringify(change.before ?? null) !== JSON.stringify(change.after ?? null))
    .map((change) => ({
      id: String(change.id),
      before: change.before == null ? null : JSON.parse(JSON.stringify(change.before)),
      after: change.after == null ? null : JSON.parse(JSON.stringify(change.after)),
    }));
  return list.length > 0 ? { type: SURVEY_MARKER_HISTORY_TYPE, changes: list } : null;
}

export function invertSurveyMarkerHistoryAction(action) {
  if (action?.type !== SURVEY_MARKER_HISTORY_TYPE) return null;
  return {
    type: SURVEY_MARKER_HISTORY_TYPE,
    changes: [...(action.changes || [])].reverse().map((change) => ({
      id: change.id,
      before: change.after ?? null,
      after: change.before ?? null,
    })),
  };
}

/** Every survey-marker child of an action (walks document batches). */
export function collectSurveyMarkerHistoryActions(action, out = []) {
  if (!action || typeof action !== 'object') return out;
  if (action.type === SURVEY_MARKER_HISTORY_TYPE) {
    out.push(action);
  } else if (action.type === 'fabric:document-batch') {
    (action.actions || []).forEach((child) => collectSurveyMarkerHistoryActions(child, out));
  }
  return out;
}

const jsonOf = (value) => JSON.stringify(value === undefined ? null : value);

/**
 * Apply a survey-marker history action to the markers dict.
 *   after == null  → the marker is removed (it was created by the step)
 *   before == null → the marker is (re)created as `after`
 *   otherwise      → only the top-level fields that differ between before and
 *                    after are written onto the marker as it is now; a marker
 *                    deleted meanwhile stays deleted.
 * Returns { markers, changedIds } (`markers` is the same object when nothing
 * changed).
 */
export function applySurveyMarkerHistoryAction(markers, action) {
  const current = markers && typeof markers === 'object' ? markers : {};
  if (action?.type !== SURVEY_MARKER_HISTORY_TYPE) return { markers: current, changedIds: [] };
  let next = current;
  const changedIds = [];
  const write = (id, value) => {
    if (next === current) next = { ...current };
    if (value == null) delete next[id];
    else next[id] = value;
    changedIds.push(id);
  };
  for (const change of action.changes || []) {
    const id = String(change.id);
    const now = next[id];
    if (change.after == null) {
      if (now !== undefined) write(id, null);
      continue;
    }
    if (change.before == null) {
      if (jsonOf(now) !== jsonOf(change.after)) write(id, JSON.parse(JSON.stringify(change.after)));
      continue;
    }
    if (now === undefined) continue; // deleted meanwhile — stays deleted
    const fields = new Set([...Object.keys(change.before), ...Object.keys(change.after)]);
    let merged = null;
    for (const field of fields) {
      if (jsonOf(change.before[field]) === jsonOf(change.after[field])) continue;
      if (jsonOf(now[field]) === jsonOf(change.after[field])) continue;
      if (!merged) merged = { ...now };
      if (change.after[field] === undefined) delete merged[field];
      else merged[field] = JSON.parse(JSON.stringify(change.after[field]));
    }
    if (merged) write(id, merged);
  }
  return { markers: next, changedIds };
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/**
 * The fields a copied Survey Marker carries into its copy. A copy is a NEW
 * survey item: it gets a new id, the next default name of its category, an
 * empty checklist and no Excel identity (no Row ID, no export bookkeeping, no
 * row index), so the next export writes it as a new row and the Excel side
 * never mistakes it for the original. It keeps what it looks like: its
 * category, its entity (colour) and its size and rotation.
 */
export const SURVEY_MARKER_COPIED_FIELDS = Object.freeze([
  'categoryId', 'entityId', 'entityName', 'entityColor', 'color', 'opacity',
]);

/** A clipboard entry for one marker record (plain JSON). */
export function surveyMarkerClipboardEntry(record) {
  if (!record?.bounds) return null;
  const entry = { bounds: { ...record.bounds }, moduleId: record.moduleId ?? null };
  for (const field of SURVEY_MARKER_COPIED_FIELDS) {
    if (record[field] !== undefined) entry[field] = JSON.parse(JSON.stringify(record[field]));
  }
  return entry;
}

/**
 * The new marker record a pasted clipboard entry becomes.
 * @param {object} entry  surveyMarkerClipboardEntry(...)
 * @param {object} opts   { id, pageNumber, dx, dy, moduleId, regionId,
 *                          categoryId, name, userId, stack }
 */
export function buildPastedSurveyMarker(entry, opts = {}) {
  const record = {
    id: opts.id,
    pageNumber: opts.pageNumber,
    bounds: {
      ...entry.bounds,
      x: (Number(entry.bounds?.x) || 0) + (Number(opts.dx) || 0),
      y: (Number(entry.bounds?.y) || 0) + (Number(opts.dy) || 0),
    },
    moduleId: opts.moduleId ?? null,
    regionId: opts.regionId ?? null,
    name: opts.name ?? '',
    checklistResponses: {},
  };
  for (const field of SURVEY_MARKER_COPIED_FIELDS) {
    if (field === 'categoryId') continue;
    if (entry[field] !== undefined) record[field] = JSON.parse(JSON.stringify(entry[field]));
  }
  record.categoryId = opts.categoryId ?? null;
  if (opts.userId) record.userId = opts.userId;
  if (opts.stack) record.stack = opts.stack;
  return record;
}

// ---------------------------------------------------------------------------
// Canvas render entries (newSurveyMarkersByPage)
// ---------------------------------------------------------------------------

/**
 * The canvas entry a saved marker record draws as — the exact shape the
 * viewer's module rebuild effect produces (PDFViewer, "Restore surveyMarkers
 * when switching modules"), plus its `stack`.
 */
export function surveyMarkerRenderEntry(annotationId, record, normalizeColor = null) {
  if (!record?.pageNumber || !record?.bounds) return null;
  const needsEntity = !record.entityColor && !record.entityId;
  const storedColor = record.entityColor || record.color;
  const color = storedColor
    ? ((typeof normalizeColor === 'function' ? normalizeColor(storedColor) : null) || storedColor)
    : null;
  const angle = Number(record.bounds.angle);
  return {
    x: record.bounds.x,
    y: record.bounds.y,
    width: record.bounds.width,
    height: record.bounds.height,
    angle: Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : 0,
    annotationId,
    moduleId: record.moduleId,
    regionId: record.regionId ?? null,
    ...(needsEntity ? { needsEntity: true } : {}),
    ...(color ? { color } : {}),
    ...(record.stack ? { stack: record.stack } : {}),
  };
}

/**
 * Write the changed markers into the per-page canvas lists in the SAME update
 * that changes the store, so a moved / restacked / pasted marker never draws
 * one frame at its old place (the module rebuild effect runs after paint).
 * A marker keeps its slot in its page's list; one that moved page or was
 * created is appended; one deleted or outside the open module is dropped.
 */
export function patchSurveyMarkerRenderPages(byPage, markers, changedIds, { selectedModuleId = null, normalizeColor = null } = {}) {
  const ids = new Set((changedIds || []).map(String));
  if (ids.size === 0) return byPage;
  const next = {};
  const placed = new Set();
  for (const [page, list] of Object.entries(byPage || {})) {
    const entries = [];
    for (const entry of Array.isArray(list) ? list : []) {
      const id = entry?.annotationId != null ? String(entry.annotationId) : null;
      if (!id || !ids.has(id)) { entries.push(entry); continue; }
      const record = markers?.[id];
      if (!record || Number(record.pageNumber) !== Number(page)
        || (selectedModuleId && record.moduleId !== selectedModuleId)) continue;
      const rebuilt = surveyMarkerRenderEntry(id, record, normalizeColor);
      if (rebuilt) { entries.push(rebuilt); placed.add(id); }
    }
    if (entries.length > 0) next[page] = entries;
  }
  for (const id of ids) {
    if (placed.has(id)) continue;
    const record = markers?.[id];
    if (!record || (selectedModuleId && record.moduleId !== selectedModuleId)) continue;
    const rebuilt = surveyMarkerRenderEntry(id, record, normalizeColor);
    if (!rebuilt) continue;
    const page = String(record.pageNumber);
    next[page] = [...(next[page] || []), rebuilt];
  }
  return next;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Markers a marquee catches — the same window / crossing rule as marks:
 * window (drag right) = the marker's box wholly inside, crossing (drag
 * left) = touching. `members` = [{ id, box }].
 */
export function resolveSurveyMarkerMarqueeHits(members, marqueeRect, direction) {
  if (!marqueeRect) return [];
  const hits = [];
  for (const member of Array.isArray(members) ? members : []) {
    const bounds = boxWorldBounds(member?.box);
    if (!bounds) continue;
    const hit = direction === 'crossing'
      ? isBBoxOverlapping(marqueeRect, bounds)
      : isBBoxFullyContained(marqueeRect, bounds);
    if (hit) hits.push(String(member.id));
  }
  return hits;
}

/** Markers a lasso catches (window / crossing / fence, as for marks). */
export function resolveSurveyMarkerLassoHits(members, lassoPolygon, mode = 'window') {
  const normalizedMode = ['crossing', 'fence'].includes(mode) ? mode : 'window';
  const polygon = normalizedMode === 'fence'
    ? normalizeLassoTrail(lassoPolygon)
    : normalizeLassoPolygon(lassoPolygon);
  if (!polygon) return [];
  const hits = [];
  for (const member of Array.isArray(members) ? members : []) {
    const geometry = surveyMarkerLassoGeometry(member?.box);
    if (!geometry) continue;
    const hit = normalizedMode === 'window'
      ? isGeometryFullyInsideLasso(geometry, polygon)
      : doesGeometryCrossLasso(geometry, polygon, { fenceOnly: normalizedMode === 'fence' });
    if (hit) hits.push(String(member.id));
  }
  return hits;
}

/** 'replace' | 'add' | 'subtract' applied to a Set of ids (new Set out). */
export function applySelectionOp(current, hits, op) {
  const base = current instanceof Set ? current : new Set(current || []);
  if (op === 'add') return new Set([...base, ...hits]);
  if (op === 'subtract') {
    const next = new Set(base);
    hits.forEach((id) => next.delete(id));
    return next;
  }
  return new Set(hits);
}
