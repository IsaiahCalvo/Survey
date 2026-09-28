/**
 * annotationLocalHistory.js — pure undo/redo diff engine for Fabric annotations.
 *
 * Diffs previous vs next page object lists into history actions
 * (fabric:create/delete/update/batch), inverts them for undo
 * (invertAnnotationHistoryAction), filters by owner, and applies them back to an
 * annotations-by-page map. Keyed by getAnnotationHistoryId; supports both precise
 * (explicit changed/created/deleted ids) and full-diff builders.
 *
 * FIELD-LEVEL UPDATES (2026-09-23). An update entry keeps whole `before` /
 * `after` snapshots (owner filtering and the history log read them), but Undo
 * and Redo no longer paste a whole snapshot back. They write only the fields
 * that differ between `before` and `after` onto the object AS IT IS NOW, so a
 * collaborator's change to any other field of the same mark survives.
 *   - Fields are nested-aware: plain objects are walked key by key
 *     (data.legacyCallout.style.fontColor is a different field from
 *     ...style.fontSize); arrays (points, path, a group's objects),
 *     primitives and ATOMIC_FIELD_PATHS (a text markup's textRange /
 *     textRangeModel) are one field each. Linked groups (a text markup's range
 *     + drawn box; a point shape's points/path + position/size/transform) are
 *     written whole whenever any member changed.
 *   - A key the merge adds back keeps the snapshot's key order.
 *   - A gesture's release step is limited to what its own saves did
 *     (restrictAnnotationHistoryActionFields): updates carry `fields` (only
 *     diff paths overlapping them are applied), updates to marks it never
 *     wrote are dropped, and only creates/deletes its own saves made are kept
 *     — a drag's pre-drag baseline vs its release also contains whatever a
 *     collaborator changed mid-drag, on this mark or any other.
 *   - The shared store (annotationMarkStore.js, 2026-09-24) keeps every mark
 *     field by field and writes only the fields this diff reports, so a
 *     collaborator's edit to another field that is still in flight when you
 *     press Undo survives too.
 *   - Concurrency choice: if a collaborator changed the SAME field after your
 *     action, your Undo still puts that field back to your "before" value
 *     (plain last-writer-wins on that one field — the same rule Figma and
 *     Google Docs follow for a property you edited yourself).
 *   - An update whose mark was deleted by someone else is a no-op; Undo never
 *     brings a deleted mark back through an update entry.
 */
import { deepClone } from './deepClone.js';
import {
  SURVEY_MARKER_HISTORY_TYPE,
  invertSurveyMarkerHistoryAction,
} from './surveyMarkerFamily.js';

export function getAnnotationHistoryId(annotation) {
  return annotation?.data?.id
    || annotation?.data?.annoId
    || annotation?.id
    || annotation?.annotationId
    || annotation?.pdfAnnotationId
    || null;
}

function cloneJson(value) {
  return deepClone(value);
}

function cloneWithStorageKey(value, storageKey) {
  const clone = cloneJson(value);
  if (
    storageKey != null
    && clone
    && typeof clone === 'object'
    && !Array.isArray(clone)
  ) {
    const data = clone.data && typeof clone.data === 'object' && !Array.isArray(clone.data)
      ? clone.data
      : {};
    clone.data = { ...data, id: String(storageKey) };
  }
  return clone;
}

function getObjects(page) {
  return Array.isArray(page?.objects) ? page.objects : [];
}

function getCanonicalStorageKey(object) {
  const serializedId = object?.data?.id;
  if (serializedId == null || String(serializedId).length === 0) return null;
  return String(serializedId);
}

function buildIdMap(objects) {
  const map = new Map();
  const ambiguousKeys = new Set();
  objects.forEach((obj, index) => {
    const annotationId = getAnnotationHistoryId(obj);
    const storageKey = getCanonicalStorageKey(obj);
    if (!storageKey || ambiguousKeys.has(storageKey)) return;
    if (map.has(storageKey)) {
      map.delete(storageKey);
      ambiguousKeys.add(storageKey);
      return;
    }
    map.set(storageKey, { obj, index, storageKey, annotationId });
  });
  return { map, ambiguousKeys };
}

function buildComparableIdMaps(previousObjects, nextObjects) {
  const previous = buildIdMap(previousObjects);
  const next = buildIdMap(nextObjects);
  const ambiguousKeys = new Set([
    ...previous.ambiguousKeys,
    ...next.ambiguousKeys,
  ]);
  for (const key of ambiguousKeys) {
    previous.map.delete(key);
    next.map.delete(key);
  }
  return {
    previousById: previous.map,
    nextById: next.map,
  };
}

function requestedStorageKeys(map, storageKeys, annotationIds) {
  const explicitKeys = normalizeIdList(storageKeys).filter((key) => map.has(key));
  const requestedIds = normalizeIdList(annotationIds);
  if (explicitKeys.length > 0) {
    // Gesture diagnostics carry both complete annotation-id lists and the
    // subset whose materialized objects exposed durable storage keys. Merge
    // the id-only remainder only when the id list proves it describes the
    // same gesture by covering every explicit key. Otherwise the explicit
    // selectors win: legacy/stale parallel id lists must never cross-wire a
    // different canonical annotation.
    const requestedIdSet = new Set(requestedIds);
    const coversEveryExplicitKey = explicitKeys.every((key) => {
      const entry = map.get(key);
      return requestedIdSet.has(key)
        || (entry?.annotationId != null && requestedIdSet.has(entry.annotationId));
    });
    if (!coversEveryExplicitKey) {
      const explicitKeySet = new Set(explicitKeys);
      return [...map.keys()].filter((key) => explicitKeySet.has(key));
    }

    const selected = new Set(explicitKeys);
    for (const entry of map.values()) {
      if (
        !selected.has(entry.storageKey)
        && requestedIdSet.has(entry.annotationId)
      ) {
        selected.add(entry.storageKey);
      }
    }
    return [...map.keys()].filter((key) => selected.has(key));
  }
  const requestedIdSet = new Set(requestedIds);
  return [...map.values()]
    .filter((entry) => requestedIdSet.has(entry.annotationId))
    .map((entry) => entry.storageKey);
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function cloneEntries(entries) {
  return entries.map((entry) => cloneJson(entry));
}

function normalizeIdList(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const out = [];
  ids.forEach((id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function isPlainRecord(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasField(record, key) {
  return hasOwn(record, key) && record[key] !== undefined;
}

function samePath(left, right) {
  return left.length === right.length
    && left.every((segment, index) => String(segment) === String(right[index]));
}

// Plain objects that must still travel as ONE field: a text markup's character
// range and its text-layer model describe one selection and are never merged
// key by key (a half-restored range would point at different characters).
const ATOMIC_FIELD_PATHS = [
  ['data', 'textRange'],
  ['data', 'textRangeModel'],
];

// Linked fields: when any one of a group differs, Undo/Redo writes the WHOLE
// group from the snapshot, because the values only make sense together.
//  - Text markups: the drawn box (left/top/width/height) and data.quads are
//    computed from the same selection as data.selectedText / textRange.
//  - Point-based shapes (polygon, polyline, ink path, line): a vertex edit or
//    move rewrites points/path together with left/top/size/pathOffset (and a
//    rotated one its transform), so restoring only some of them would bend or
//    shift the shape.
// Rects, ellipses, text boxes and callouts have independent geometry fields
// (a move is left/top, a resize width/height/scale) and are not grouped.
const TEXT_MARKUP_LINKED_FIELDS = [
  ['left'], ['top'], ['width'], ['height'],
  ['data', 'quads'], ['data', 'selectedText'], ['data', 'textRange'], ['data', 'textRangeModel'],
];
const POINT_GEOMETRY_LINKED_FIELDS = [
  'left', 'top', 'width', 'height', 'points', 'path', 'pathOffset',
  'x1', 'y1', 'x2', 'y2', 'scaleX', 'scaleY', 'angle', 'flipX', 'flipY',
].map((key) => [key]);
const POINT_GEOMETRY_TYPES = new Set(['polygon', 'polyline', 'path', 'line']);

/**
 * The linked field group an annotation's fields belong to, or null. The shared
 * store (annotationMarkStore.js) keeps each group as ONE stored value so two
 * people's concurrent edits can never leave half of one group and half of
 * another; Undo/Redo writes the same group whole. One definition for both.
 * Returns { name, paths } with name 'textMarkup' | 'pointGeometry'.
 */
export function getAnnotationLinkedFieldGroup(object) {
  if (!isPlainRecord(object)) return null;
  if (object.data?.type === 'text-markup' || Array.isArray(object.data?.quads)) {
    return { name: 'textMarkup', paths: TEXT_MARKUP_LINKED_FIELDS };
  }
  if (POINT_GEOMETRY_TYPES.has(String(object.type || '').toLowerCase())) {
    return { name: 'pointGeometry', paths: POINT_GEOMETRY_LINKED_FIELDS };
  }
  return null;
}

/** Paths whose plain-object value is one field (never merged key by key). */
export const ANNOTATION_ATOMIC_FIELD_PATHS = ATOMIC_FIELD_PATHS;

function linkedFieldGroupsFor(before, after) {
  const probe = isPlainRecord(after) ? after : before;
  const group = getAnnotationLinkedFieldGroup(probe);
  return group ? [group.paths] : [];
}

function readAtPath(record, path) {
  let cursor = record;
  for (const key of path) {
    if (!isPlainRecord(cursor) || !hasField(cursor, key)) return { present: false, value: undefined };
    cursor = cursor[key];
  }
  return { present: true, value: cursor };
}

function diffFieldsRecursive(before, after, prefix, changes) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const hadBefore = hasField(before, key);
    const hasAfter = hasField(after, key);
    if (!hadBefore && !hasAfter) continue;
    const path = [...prefix, key];
    const left = hadBefore ? before[key] : undefined;
    const right = hasAfter ? after[key] : undefined;
    if (
      hadBefore && hasAfter
      && isPlainRecord(left) && isPlainRecord(right)
      && !ATOMIC_FIELD_PATHS.some((atomic) => samePath(atomic, path))
    ) {
      diffFieldsRecursive(left, right, path, changes);
      continue;
    }
    if (hadBefore === hasAfter && sameJson(left, right)) continue;
    changes.push({
      path,
      before: hadBefore ? cloneJson(left) : undefined,
      after: hasAfter ? cloneJson(right) : undefined,
      hadBefore,
      hasAfter,
    });
  }
  return changes;
}

/**
 * Field-level diff of two annotation snapshots. Returns one entry per changed
 * leaf field: { path: string[], before, after, hadBefore, hasAfter }.
 * Plain objects are walked key by key; arrays, primitives and the
 * ATOMIC_FIELD_PATHS are leaves (an ink path or a polygon's points change as
 * one unit). When any field of a linked group changed, every field of that
 * group is listed (see linkedFieldGroupsFor). Two non-object snapshots
 * compare as one whole-value entry with path [].
 */
export function diffAnnotationFields(before, after) {
  if (!isPlainRecord(before) || !isPlainRecord(after)) {
    if (sameJson(before, after)) return [];
    return [{
      path: [],
      before: before === undefined ? undefined : cloneJson(before),
      after: after === undefined ? undefined : cloneJson(after),
      hadBefore: before !== undefined,
      hasAfter: after !== undefined,
    }];
  }
  const changes = diffFieldsRecursive(before, after, [], []);
  for (const group of linkedFieldGroupsFor(before, after)) {
    const touchesGroup = changes.some((change) => (
      group.some((path) => pathsOverlap(path, change.path))
    ));
    if (!touchesGroup) continue;
    for (const path of group) {
      if (changes.some((change) => samePath(change.path, path))) continue;
      const left = readAtPath(before, path);
      const right = readAtPath(after, path);
      if (!left.present && !right.present) continue;
      changes.push({
        path: [...path],
        before: left.present ? cloneJson(left.value) : undefined,
        after: right.present ? cloneJson(right.value) : undefined,
        hadBefore: left.present,
        hasAfter: right.present,
      });
    }
  }
  return changes;
}

function pathsOverlap(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (String(left[index]) !== String(right[index])) return false;
  }
  return true;
}

function restrictFieldChanges(changes, fields) {
  if (!Array.isArray(fields)) return changes;
  const paths = fields.filter(Array.isArray);
  return changes.filter((change) => paths.some((path) => pathsOverlap(path, change.path)));
}

// A key that the merge ADDS back (it had been removed) is put where the
// snapshot has it, not at the end: string fingerprints of the object (the
// save pipeline's history hashes, sameJson) are key-order sensitive, and an
// order-only difference would otherwise read as a change later.
function orderKeysLike(record, template) {
  if (!isPlainRecord(template)) return record;
  const out = {};
  Object.keys(template).forEach((key) => {
    if (hasOwn(record, key)) out[key] = record[key];
  });
  Object.keys(record).forEach((key) => {
    if (!hasOwn(out, key)) out[key] = record[key];
  });
  return out;
}

function setFieldAtPath(node, path, value, present, template) {
  if (path.length === 0) return present ? cloneJson(value) : node;
  const [key, ...rest] = path;
  const base = isPlainRecord(node) ? node : {};
  if (rest.length === 0 && !present) {
    if (!hasOwn(base, key)) return node;
    const { [key]: _removed, ...others } = base;
    return others;
  }
  let child;
  if (rest.length === 0) {
    child = cloneJson(value);
  } else {
    const next = base[key];
    // Nothing to remove under a branch that no longer exists.
    if (!isPlainRecord(next) && !present) return node;
    child = setFieldAtPath(
      isPlainRecord(next) ? next : {},
      rest,
      value,
      present,
      isPlainRecord(template) ? template[key] : undefined,
    );
  }
  const existed = hasOwn(base, key);
  const out = { ...base, [key]: child };
  return existed ? out : orderKeysLike(out, template);
}

/**
 * Write the fields an update changed (before -> after, optionally limited to
 * `fields`) onto `current`, leaving every other field of `current` as it is.
 * With no concurrent change (`current` equals `before`) the result equals
 * `after` (key order included), so single-user Undo/Redo is unchanged.
 */
export function mergeAnnotationUpdateOntoCurrent(current, before, after, fields = null) {
  const changes = restrictFieldChanges(diffAnnotationFields(before, after), fields);
  return changes.reduce(
    (object, change) => setFieldAtPath(object, change.path, change.after, change.hasAfter, after),
    current,
  );
}

/**
 * What one gesture's own saves did on one page: the fields they wrote per
 * object (fields: Map<storageKey, Map<pathKey, path>>) and the objects they
 * created / deleted. A gesture (live-preview frames plus its release) records
 * every save so its single undo step can be limited to its own work, never
 * whatever else differs between its pre-gesture baseline and its release.
 */
export function createGestureTouchRecord() {
  return { fields: new Map(), created: new Set(), deleted: new Set() };
}

function entryStorageKey(entry) {
  const key = entry?.storageKey ?? entry?.id;
  return key == null ? null : String(key);
}

function actionEntries(action) {
  if (!action || typeof action !== 'object') return { created: [], deleted: [], updated: [] };
  if (action.type === 'fabric:create') return { created: [action], deleted: [], updated: [] };
  if (action.type === 'fabric:delete') return { created: [], deleted: [action], updated: [] };
  if (action.type === 'fabric:update') return { created: [], deleted: [], updated: [action] };
  if (action.type === 'fabric:batch') {
    return {
      created: action.created || [],
      deleted: action.deleted || [],
      updated: action.updated || [],
    };
  }
  return { created: [], deleted: [], updated: [] };
}

/**
 * Record one save's own diff (an action built from the page just before that
 * save to the page it wrote) into a gesture's touch record. Reusing the save's
 * already-built action keeps a drag frame from re-comparing every mark; only
 * the objects that changed are diffed field by field.
 */
export function recordGestureTouchesFromAction(action, record = createGestureTouchRecord()) {
  const { created, deleted, updated } = actionEntries(action);
  created.forEach((entry) => {
    const key = entryStorageKey(entry);
    if (key) record.created.add(key);
  });
  deleted.forEach((entry) => {
    const key = entryStorageKey(entry);
    if (key) record.deleted.add(key);
  });
  updated.forEach((entry) => {
    const key = entryStorageKey(entry);
    if (!key) return;
    const changes = diffAnnotationFields(entry.before, entry.after);
    if (changes.length === 0) return;
    const paths = record.fields.get(key) || new Map();
    changes.forEach((change) => paths.set(JSON.stringify(change.path), change.path));
    record.fields.set(key, paths);
  });
  return record;
}

/** Record the diff between two pages (one save) into a gesture touch record. */
export function collectAnnotationFieldTouches(previousPage, nextPage, record = createGestureTouchRecord()) {
  return recordGestureTouchesFromAction(
    buildAnnotationHistoryAction({ pageNumber: 0, previousPage, nextPage }),
    record,
  );
}

/**
 * End a page's live-preview gesture: forget its pre-gesture baseline and its
 * touch record (pageKey null = every page). A one-shot write that saves as a
 * preview frame (checkpointPolicy 'skip' — the embedded-PDF import, the
 * counter-series delete) must call this, or the NEXT ordinary save on that
 * page diffs from before the write and records the write's marks as its own
 * creates — undoing that edit would then delete them.
 */
export function endPagePreviewGesture(previewBaselines, gestureTouches, pageKey = null) {
  if (pageKey == null) {
    previewBaselines?.clear?.();
    gestureTouches?.clear?.();
    return;
  }
  previewBaselines?.delete?.(String(pageKey));
  gestureTouches?.delete?.(String(pageKey));
}

function shapeHistoryAction(pageNumber, created, deleted, updated) {
  const total = created.length + deleted.length + updated.length;
  if (total === 0) return null;
  if (total === 1) {
    const [entry, type] = created.length
      ? [created[0], 'fabric:create']
      : deleted.length
        ? [deleted[0], 'fabric:delete']
        : [updated[0], 'fabric:update'];
    const base = {
      type,
      pageNumber,
      annotationId: entry.annotationId || entry.id || entry.storageKey,
      storageKey: entry.storageKey ?? entry.id,
      index: entry.index ?? null,
    };
    return type === 'fabric:update'
      ? {
        ...base,
        before: entry.before,
        after: entry.after,
        ...(Array.isArray(entry.fields) ? { fields: entry.fields } : {}),
      }
      : { ...base, annotation: entry.annotation };
  }
  return { type: 'fabric:batch', pageNumber, created, deleted, updated };
}

/**
 * Limit a gesture's release step to what the gesture's own saves did
 * (`record` from createGestureTouchRecord / recordGestureTouchesFromAction):
 *  - an update keeps only the fields the gesture wrote (`fields`), and is
 *    dropped when it wrote none of them or they ended where they began;
 *  - a create / delete is kept only when one of the gesture's saves made it,
 *    so a mark a collaborator added or removed mid-drag is never deleted or
 *    brought back by our Undo.
 * Returns null when nothing of the gesture's own is left (e.g. a drag dropped
 * back where it started while someone else edited the page).
 */
export function restrictAnnotationHistoryActionFields(action, record) {
  if (!action || !record || !(record.fields instanceof Map)) return action;
  // w52: no gesture reorders marks; an order change seen at its release is a
  // collaborator's reorder that landed meanwhile — never this user's step.
  if (action.type === 'fabric:reorder') return null;
  if (action.type !== 'fabric:update' && action.type !== 'fabric:batch'
    && action.type !== 'fabric:create' && action.type !== 'fabric:delete') return action;
  const entries = actionEntries(action);
  const created = entries.created.filter((entry) => record.created.has(entryStorageKey(entry)));
  const deleted = entries.deleted.filter((entry) => record.deleted.has(entryStorageKey(entry)));
  const updated = entries.updated
    .map((entry) => {
      const key = entryStorageKey(entry);
      // Deleted and re-added (same id) within this gesture: the whole mark is
      // the gesture's own work, so its full change stays in the step.
      if (record.created.has(key) && record.deleted.has(key)) return entry;
      const paths = record.fields.get(key);
      if (!paths || paths.size === 0) return null;
      const fields = [...paths.values()];
      const changes = restrictFieldChanges(diffAnnotationFields(entry.before, entry.after), fields);
      return changes.length > 0 ? { ...entry, fields } : null;
    })
    .filter(Boolean);
  if (
    action.type !== 'fabric:batch'
    && created.length + deleted.length + updated.length === 1
  ) {
    return updated.length === 1 ? updated[0] : action;
  }
  return shapeHistoryAction(action.pageNumber, created, deleted, updated);
}

export function buildPreciseAnnotationHistoryAction({
  pageNumber,
  previousPage,
  nextPage,
  deletedIds = [],
  changedIds = [],
  createdIds = [],
  deletedStorageKeys = [],
  changedStorageKeys = [],
  createdStorageKeys = [],
}) {
  const previousObjects = getObjects(previousPage);
  const nextObjects = getObjects(nextPage);
  const { previousById, nextById } = buildComparableIdMaps(
    previousObjects,
    nextObjects,
  );
  const deleteSet = requestedStorageKeys(previousById, deletedStorageKeys, deletedIds);
  const deleteSetLookup = new Set(deleteSet);
  const changeSet = requestedStorageKeys(nextById, changedStorageKeys, changedIds)
    .filter((id) => !deleteSetLookup.has(id));
  const createSet = requestedStorageKeys(nextById, createdStorageKeys, createdIds)
    .filter((id) => !deleteSetLookup.has(id));

  const created = createSet
    .map((id) => {
      const entry = nextById.get(id);
      return entry ? { id, annotationId: entry.annotationId, after: entry.obj } : null;
    })
    .filter(Boolean);
  const deleted = deleteSet
    .map((id) => {
      const entry = previousById.get(id);
      return entry ? { id, annotationId: entry.annotationId, before: entry.obj } : null;
    })
    .filter(Boolean);
  const updated = changeSet
    .map((id) => {
      const before = previousById.get(id);
      const after = nextById.get(id);
      if (!before || !after || sameJson(before.obj, after.obj)) return null;
      return { id, annotationId: after.annotationId, before: before.obj, after: after.obj };
    })
    .filter(Boolean);

  if (created.length === 0 && deleted.length === 0 && updated.length === 0) {
    return null;
  }

  if (created.length === 1 && deleted.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:create',
      pageNumber,
      annotationId: created[0].annotationId || created[0].id,
      storageKey: created[0].id,
      annotation: cloneJson(created[0].after),
      index: nextById.get(created[0].id)?.index ?? null,
    };
  }

  if (deleted.length === 1 && created.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:delete',
      pageNumber,
      annotationId: deleted[0].annotationId || deleted[0].id,
      storageKey: deleted[0].id,
      annotation: cloneJson(deleted[0].before),
      index: previousById.get(deleted[0].id)?.index ?? null,
    };
  }

  if (updated.length === 1 && created.length === 0 && deleted.length === 0) {
    return {
      type: 'fabric:update',
      pageNumber,
      annotationId: updated[0].annotationId || updated[0].id,
      storageKey: updated[0].id,
      before: cloneJson(updated[0].before),
      after: cloneJson(updated[0].after),
      index: nextById.get(updated[0].id)?.index ?? null,
    };
  }

  return {
    type: 'fabric:batch',
    pageNumber,
    created: created.map((entry) => ({
      id: entry.id,
      annotationId: entry.annotationId,
      storageKey: entry.id,
      annotation: cloneJson(entry.after),
      index: nextById.get(entry.id)?.index ?? null,
    })),
    deleted: deleted.map((entry) => ({
      id: entry.id,
      annotationId: entry.annotationId,
      storageKey: entry.id,
      annotation: cloneJson(entry.before),
      index: previousById.get(entry.id)?.index ?? null,
    })),
    updated: updated.map((entry) => ({
      id: entry.id,
      annotationId: entry.annotationId,
      storageKey: entry.id,
      before: cloneJson(entry.before),
      after: cloneJson(entry.after),
      index: nextById.get(entry.id)?.index ?? null,
    })),
  };
}

export function buildAnnotationHistoryAction({ pageNumber, previousPage, nextPage }) {
  const previousObjects = getObjects(previousPage);
  const nextObjects = getObjects(nextPage);
  const { previousById, nextById } = buildComparableIdMaps(
    previousObjects,
    nextObjects,
  );

  const created = [];
  const deleted = [];
  const updated = [];

  for (const [id, entry] of nextById.entries()) {
    const before = previousById.get(id);
    if (!before) {
      created.push({ id, annotationId: entry.annotationId, after: entry.obj });
    } else if (!sameJson(before.obj, entry.obj)) {
      updated.push({ id, annotationId: entry.annotationId, before: before.obj, after: entry.obj });
    }
  }

  for (const [id, entry] of previousById.entries()) {
    if (!nextById.has(id)) {
      deleted.push({ id, annotationId: entry.annotationId, before: entry.obj });
    }
  }

  if (created.length === 1 && deleted.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:create',
      pageNumber,
      annotationId: created[0].annotationId || created[0].id,
      storageKey: created[0].id,
      annotation: cloneJson(created[0].after),
      index: nextById.get(created[0].id)?.index ?? null,
    };
  }

  if (deleted.length === 1 && created.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:delete',
      pageNumber,
      annotationId: deleted[0].annotationId || deleted[0].id,
      storageKey: deleted[0].id,
      annotation: cloneJson(deleted[0].before),
      index: previousById.get(deleted[0].id)?.index ?? null,
    };
  }

  if (updated.length === 1 && created.length === 0 && deleted.length === 0) {
    return {
      type: 'fabric:update',
      pageNumber,
      annotationId: updated[0].annotationId || updated[0].id,
      storageKey: updated[0].id,
      before: cloneJson(updated[0].before),
      after: cloneJson(updated[0].after),
      index: nextById.get(updated[0].id)?.index ?? null,
    };
  }

  const changeCount = created.length + deleted.length + updated.length;
  if (changeCount > 1) {
    return {
      type: 'fabric:batch',
      pageNumber,
      created: created.map((entry) => ({
        id: entry.id,
        annotationId: entry.annotationId,
        storageKey: entry.id,
        annotation: cloneJson(entry.after),
        index: nextById.get(entry.id)?.index ?? null,
      })),
      deleted: deleted.map((entry) => ({
        id: entry.id,
        annotationId: entry.annotationId,
        storageKey: entry.id,
        annotation: cloneJson(entry.before),
        index: previousById.get(entry.id)?.index ?? null,
      })),
      updated: updated.map((entry) => ({
        id: entry.id,
        annotationId: entry.annotationId,
        storageKey: entry.id,
        before: cloneJson(entry.before),
        after: cloneJson(entry.after),
        index: nextById.get(entry.id)?.index ?? null,
      })),
    };
  }

  return buildReorderHistoryAction(pageNumber, previousById, nextById);
}

// w52 (2026-09-28): an order-only change (Bring to front / forward, Send
// backward / to back) is its own Undo step. Before, nothing but the order
// changed, so the save built no step and Cmd+Z undid the PREVIOUS edit
// instead. The step holds only storage keys: Undo/Redo put exactly those
// marks back into their old relative order in the slots they occupy now, so
// a mark a collaborator added or removed meanwhile is never moved or revived.
function orderedKeys(byId) {
  return [...byId.values()]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.storageKey);
}

function buildReorderHistoryAction(pageNumber, previousById, nextById) {
  if (previousById.size < 2 || previousById.size !== nextById.size) return null;
  const beforeOrder = orderedKeys(previousById);
  const afterOrder = orderedKeys(nextById);
  if (!afterOrder.every((key) => previousById.has(key))) return null;
  if (beforeOrder.every((key, index) => key === afterOrder[index])) return null;
  return { type: 'fabric:reorder', pageNumber, beforeOrder, afterOrder };
}

// Put the marks named in `order` into that relative order, inside the slots
// those marks occupy now. Marks not named (or no longer present) stay put.
function applyStackOrder(objects, order) {
  const wanted = (Array.isArray(order) ? order : []).map(String);
  const rank = new Map(wanted.map((key, index) => [key, index]));
  const slots = [];
  const moving = [];
  objects.forEach((object, index) => {
    const key = getCanonicalStorageKey(object);
    if (key != null && rank.has(key)) {
      slots.push(index);
      moving.push(object);
    }
  });
  if (moving.length < 2) return objects;
  moving.sort((left, right) => rank.get(getCanonicalStorageKey(left)) - rank.get(getCanonicalStorageKey(right)));
  if (moving.every((object, index) => object === objects[slots[index]])) return objects;
  const next = objects.slice();
  slots.forEach((slot, index) => { next[slot] = moving[index]; });
  return next;
}

export function invertAnnotationHistoryAction(action) {
  if (!action || typeof action !== 'object') return null;
  // w53: a Survey Marker child of a family step (surveyMarkerFamily.js). The
  // viewer applies it to the marker store; pages are untouched.
  if (action.type === SURVEY_MARKER_HISTORY_TYPE) return invertSurveyMarkerHistoryAction(action);
  if (action.type === 'fabric:document-batch') {
    const actions = [...(action.actions || [])]
      .reverse()
      .map((child) => invertAnnotationHistoryAction(child))
      .filter(Boolean);
    return actions.length > 0
      ? {
        type: 'fabric:document-batch',
        actions,
        ...(action.confirmedCrossAuthorDelete === true
          ? { confirmedCrossAuthorDelete: true }
          : {}),
      }
      : null;
  }
  if (action.type === 'fabric:reorder') {
    return {
      type: 'fabric:reorder',
      pageNumber: action.pageNumber,
      beforeOrder: [...(action.afterOrder || [])],
      afterOrder: [...(action.beforeOrder || [])],
    };
  }
  if (action.type === 'fabric:create') {
    return {
      type: 'fabric:delete',
      pageNumber: action.pageNumber,
      annotationId: action.annotationId,
      storageKey: action.storageKey,
      annotation: cloneJson(action.annotation),
      index: action.index ?? null,
    };
  }
  if (action.type === 'fabric:delete') {
    return {
      type: 'fabric:create',
      pageNumber: action.pageNumber,
      annotationId: action.annotationId,
      storageKey: action.storageKey,
      annotation: cloneJson(action.annotation),
      index: action.index ?? null,
    };
  }
  if (action.type === 'fabric:update') {
    return {
      type: 'fabric:update',
      pageNumber: action.pageNumber,
      annotationId: action.annotationId,
      storageKey: action.storageKey,
      before: cloneJson(action.after),
      after: cloneJson(action.before),
      index: action.index ?? null,
      ...(Array.isArray(action.fields) ? { fields: cloneJson(action.fields) } : {}),
    };
  }
  if (action.type === 'fabric:batch') {
    return {
      type: 'fabric:batch',
      pageNumber: action.pageNumber,
      created: cloneEntries(action.deleted || []).map((entry) => ({
        id: entry.id,
        annotationId: entry.annotationId,
        storageKey: entry.storageKey,
        annotation: entry.annotation,
        index: entry.index ?? null,
      })),
      deleted: cloneEntries(action.created || []).map((entry) => ({
        id: entry.id,
        annotationId: entry.annotationId,
        storageKey: entry.storageKey,
        annotation: entry.annotation,
        index: entry.index ?? null,
      })),
      updated: cloneEntries(action.updated || []).map((entry) => ({
        id: entry.id,
        annotationId: entry.annotationId,
        storageKey: entry.storageKey,
        before: entry.after,
        after: entry.before,
        index: entry.index ?? null,
        ...(Array.isArray(entry.fields) ? { fields: entry.fields } : {}),
      })),
    };
  }
  return null;
}

/**
 * Which recorded steps a user may keep on (and replay from) their own Undo /
 * Redo stack.
 *
 * RULED 2026-09-28 owner: open editing + lock. Anyone who can edit may
 * change or delete ANY mark, and Undo is part of the safety net for exactly
 * those changes ("Safety = undo + History + Lock"). So a step is no longer
 * trimmed to the marks the user drew: moving, restyling or deleting a
 * colleague's mark is the user's own action and is undoable like any other.
 * Collaborators' concurrent edits stay safe because Undo writes back only the
 * fields the step changed onto each mark as it is now (field-level history).
 * Only an unknown viewer is refused. (`documentOwnerId` stays in the
 * signature for the existing call sites.)
 */
// eslint-disable-next-line no-unused-vars
export function filterAnnotationHistoryActionByOwner(action, userId, documentOwnerId = null) {
  if (!action || typeof action !== 'object') return null;
  if (typeof userId !== 'string' || userId.length === 0) return null;
  return action;
}

function findEntryObjectIndex(objects, entry, snapshot = null) {
  if (entry?.storageKey != null) {
    return objects.findIndex(
      (object) => getCanonicalStorageKey(object) === String(entry.storageKey),
    );
  }

  const targetId = entry?.annotationId
    || entry?.id
    || getAnnotationHistoryId(snapshot);
  if (Number.isInteger(entry?.index)) {
    const candidate = objects[entry.index];
    if (
      candidate
      && (!targetId || getAnnotationHistoryId(candidate) === targetId)
    ) return entry.index;
  }

  if (!targetId) return -1;
  const candidates = objects
    .map((object, index) => (getAnnotationHistoryId(object) === targetId ? index : -1))
    .filter((index) => index >= 0);
  return candidates.length === 1 ? candidates[0] : -1;
}

function replaceAtStorageIndex(objects, index, value, storageKey) {
  if (index < 0) return objects;
  return objects.map((object, objectIndex) => (
    objectIndex === index ? cloneWithStorageKey(value, storageKey) : object
  ));
}

// Field-level update of the object at `index` (see the file header). The
// optional `normalizeUpdatedObject(object, { pageNumber, entry })` hook lets
// the viewer rebuild derived data when the merge produced a state neither
// snapshot had (a callout's drawn children are re-projected from its
// data.legacyCallout, the callout's source of truth).
function applyFieldUpdateAt(objects, index, entry, pageNumber, options) {
  if (index < 0) return objects;
  let merged = mergeAnnotationUpdateOntoCurrent(
    objects[index],
    entry.before,
    entry.after,
    entry.fields,
  );
  if (
    typeof options?.normalizeUpdatedObject === 'function'
    && !sameJson(merged, entry.after)
  ) {
    merged = options.normalizeUpdatedObject(merged, { pageNumber, entry }) || merged;
  }
  return replaceAtStorageIndex(objects, index, merged, entry.storageKey);
}

export function applyAnnotationHistoryAction(annotationsByPage, action, options = {}) {
  if (!action || typeof action !== 'object') return annotationsByPage || {};
  // w53: Survey Marker changes live in their own store (applied by the
  // viewer, applySurveyMarkerHistoryAction); they never touch a page.
  if (action.type === SURVEY_MARKER_HISTORY_TYPE) return annotationsByPage || {};
  if (action.type === 'fabric:document-batch') {
    return (action.actions || []).reduce(
      (current, child) => applyAnnotationHistoryAction(current, child, options),
      annotationsByPage || {},
    );
  }
  const pageKey = String(action.pageNumber);
  const current = annotationsByPage || {};
  const page = current[pageKey] || current[action.pageNumber] || { objects: [] };
  const objects = getObjects(page);

  let nextObjects = objects;
  if (action.type === 'fabric:reorder') {
    nextObjects = applyStackOrder(objects, action.afterOrder);
  } else if (action.type === 'fabric:create') {
    const existingIndex = findEntryObjectIndex(objects, action, action.annotation);
    if (existingIndex >= 0) {
      nextObjects = replaceAtStorageIndex(
        objects,
        existingIndex,
        action.annotation,
        action.storageKey,
      );
    } else {
      nextObjects = [...objects];
      const index = Number.isInteger(action.index)
        ? Math.max(0, Math.min(action.index, nextObjects.length))
        : nextObjects.length;
      nextObjects.splice(index, 0, cloneWithStorageKey(action.annotation, action.storageKey));
    }
  } else if (action.type === 'fabric:delete') {
    const targetIndex = findEntryObjectIndex(objects, action, action.annotation);
    if (targetIndex >= 0) {
      nextObjects = objects.filter((_object, index) => index !== targetIndex);
    }
  } else if (action.type === 'fabric:update') {
    const targetIndex = findEntryObjectIndex(objects, action, action.before);
    nextObjects = applyFieldUpdateAt(
      objects,
      targetIndex,
      action,
      action.pageNumber,
      options,
    );
  } else if (action.type === 'fabric:batch') {
    for (const entry of action.deleted || []) {
      const targetIndex = findEntryObjectIndex(nextObjects, entry, entry.annotation);
      if (targetIndex >= 0) {
        nextObjects = nextObjects.filter((_object, index) => index !== targetIndex);
      }
    }
    for (const entry of action.updated || []) {
      const targetIndex = findEntryObjectIndex(nextObjects, entry, entry.before);
      nextObjects = applyFieldUpdateAt(
        nextObjects,
        targetIndex,
        entry,
        action.pageNumber,
        options,
      );
    }
    const createdEntries = [...(action.created || [])].sort((left, right) => {
      const leftIndex = Number.isInteger(left?.index) ? left.index : Number.MAX_SAFE_INTEGER;
      const rightIndex = Number.isInteger(right?.index) ? right.index : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
    for (const entry of createdEntries) {
      const existingIndex = findEntryObjectIndex(nextObjects, entry, entry.annotation);
      if (existingIndex >= 0) {
        nextObjects = replaceAtStorageIndex(
          nextObjects,
          existingIndex,
          entry.annotation,
          entry.storageKey,
        );
      } else {
        const index = Number.isInteger(entry.index)
          ? Math.max(0, Math.min(entry.index, nextObjects.length))
          : nextObjects.length;
        nextObjects = [...nextObjects];
        nextObjects.splice(
          index,
          0,
          cloneWithStorageKey(entry.annotation, entry.storageKey),
        );
      }
    }
  }

  return {
    ...current,
    [pageKey]: {
      ...page,
      objects: nextObjects,
    },
  };
}

/**
 * w55: a History-panel Restore brings back marks that are GONE. Applied as-is,
 * a restore action's `fabric:create` replaces a mark that is already there
 * (undo brought it back, a teammate restored it, the Restore was pressed
 * twice) with its delete-time copy, silently throwing away every edit made
 * since. This strips the creates whose mark is already on the page:
 *   - fabric:create            -> null when the mark exists
 *   - fabric:batch             -> without the present creates; null when every
 *                                 create was present (its deletes/updates were
 *                                 the other half of that same erase, so they
 *                                 must not run on their own either)
 *   - fabric:document-batch    -> each child the same way; null when none left
 * Anything else passes through unchanged.
 */
function isRestoreTargetPresent(objects, entry, snapshot) {
  if (entry?.storageKey != null
    && objects.some((object) => getCanonicalStorageKey(object) === String(entry.storageKey))) return true;
  const targetId = entry?.annotationId || entry?.id || getAnnotationHistoryId(snapshot);
  if (!targetId) return false;
  return objects.some((object) => getAnnotationHistoryId(object) === targetId);
}

export function dropAlreadyPresentRestoreTargets(annotationsByPage, action) {
  if (!action || typeof action !== 'object') return null;
  const current = annotationsByPage || {};
  const pageObjects = (pageNumber) => getObjects(current[String(pageNumber)] || current[pageNumber] || { objects: [] });
  if (action.type === 'fabric:document-batch') {
    const children = (action.actions || [])
      .map((child) => dropAlreadyPresentRestoreTargets(current, child))
      .filter(Boolean);
    return children.length > 0 ? { ...action, actions: children } : null;
  }
  if (action.type === 'fabric:create') {
    return isRestoreTargetPresent(pageObjects(action.pageNumber), action, action.annotation) ? null : action;
  }
  if (action.type === 'fabric:batch') {
    const created = Array.isArray(action.created) ? action.created : [];
    if (created.length === 0) return action;
    const objects = pageObjects(action.pageNumber);
    const missing = created.filter((entry) => !isRestoreTargetPresent(objects, entry, entry.annotation));
    if (missing.length === 0) return null;
    return missing.length === created.length ? action : { ...action, created: missing };
  }
  return action;
}
