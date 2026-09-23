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
 *     ...style.fontSize); arrays (points, path, a group's objects) and
 *     primitives are one field each.
 *   - An entry may carry `fields` (a list of paths) when the action's
 *     before/after diff can hold more than the user's own edit — a drag's
 *     pre-drag baseline vs its release also contains whatever a collaborator
 *     changed mid-drag. Only diff paths that overlap `fields` are applied.
 *   - Concurrency choice: if a collaborator changed the SAME field after your
 *     action, your Undo still puts that field back to your "before" value
 *     (plain last-writer-wins on that one field — the same rule Figma and
 *     Google Docs follow for a property you edited yourself).
 *   - An update whose mark was deleted by someone else is a no-op; Undo never
 *     brings a deleted mark back through an update entry.
 */
import { deepClone } from './deepClone.js';

export function getAnnotationHistoryId(annotation) {
  return annotation?.data?.id
    || annotation?.data?.annoId
    || annotation?.id
    || annotation?.annotationId
    || annotation?.pdfAnnotationId
    || null;
}

function getAnnotationHistoryAuthorId(annotation) {
  return annotation?.meta?.authorId
    || annotation?.__meta?.authorId
    || annotation?.authorId
    || annotation?.data?.authorId
    || annotation?.data?.userId
    || null;
}

function isOwnAnnotation(annotation, userId) {
  const authorId = getAnnotationHistoryAuthorId(annotation);
  return Boolean(userId) && authorId === userId;
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

function hasField(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined;
}

/**
 * Field-level diff of two annotation snapshots. Returns one entry per changed
 * leaf field: { path: string[], before, after, hadBefore, hasAfter }.
 * Plain objects are walked key by key; arrays and primitives are leaves (an
 * ink path or a polygon's points change as one unit). Two non-object
 * snapshots compare as one whole-value entry with path [].
 */
export function diffAnnotationFields(before, after, prefix = []) {
  if (!isPlainRecord(before) || !isPlainRecord(after)) {
    if (sameJson(before, after)) return [];
    return [{
      path: prefix,
      before: before === undefined ? undefined : cloneJson(before),
      after: after === undefined ? undefined : cloneJson(after),
      hadBefore: before !== undefined,
      hasAfter: after !== undefined,
    }];
  }
  const changes = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const hadBefore = hasField(before, key);
    const hasAfter = hasField(after, key);
    if (!hadBefore && !hasAfter) continue;
    const left = hadBefore ? before[key] : undefined;
    const right = hasAfter ? after[key] : undefined;
    if (hadBefore && hasAfter && isPlainRecord(left) && isPlainRecord(right)) {
      changes.push(...diffAnnotationFields(left, right, [...prefix, key]));
      continue;
    }
    if (hadBefore === hasAfter && sameJson(left, right)) continue;
    changes.push({
      path: [...prefix, key],
      before: hadBefore ? cloneJson(left) : undefined,
      after: hasAfter ? cloneJson(right) : undefined,
      hadBefore,
      hasAfter,
    });
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

function setFieldAtPath(root, path, value, present) {
  if (path.length === 0) return present ? cloneJson(value) : root;
  const out = isPlainRecord(root) ? { ...root } : {};
  let cursor = out;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const next = cursor[key];
    if (!isPlainRecord(next)) {
      // Nothing to remove under a branch that no longer exists.
      if (!present) return out;
      cursor[key] = {};
    } else {
      cursor[key] = { ...next };
    }
    cursor = cursor[key];
  }
  const leaf = path[path.length - 1];
  if (present) cursor[leaf] = cloneJson(value);
  else delete cursor[leaf];
  return out;
}

/**
 * Write the fields an update changed (before -> after, optionally limited to
 * `fields`) onto `current`, leaving every other field of `current` as it is.
 * With no concurrent change (`current` equals `before`) the result equals
 * `after`, so single-user Undo/Redo is unchanged.
 */
export function mergeAnnotationUpdateOntoCurrent(current, before, after, fields = null) {
  const changes = restrictFieldChanges(diffAnnotationFields(before, after), fields);
  return changes.reduce(
    (object, change) => setFieldAtPath(object, change.path, change.after, change.hasAfter),
    current,
  );
}

/**
 * Field paths each object's save changed, accumulated into `touches`
 * (Map<storageKey, Map<pathKey, path>>). A gesture (live-preview frames plus
 * its release) calls this once per save so its single undo step can be limited
 * to the fields the gesture itself wrote, not whatever else differs between
 * its pre-gesture baseline and its release.
 */
export function collectAnnotationFieldTouches(previousPage, nextPage, touches = new Map()) {
  const { previousById, nextById } = buildComparableIdMaps(
    getObjects(previousPage),
    getObjects(nextPage),
  );
  for (const [storageKey, entry] of nextById.entries()) {
    const previous = previousById.get(storageKey);
    if (!previous || previous.obj === entry.obj) continue;
    const changes = diffAnnotationFields(previous.obj, entry.obj);
    if (changes.length === 0) continue;
    const paths = touches.get(storageKey) || new Map();
    changes.forEach((change) => paths.set(JSON.stringify(change.path), change.path));
    touches.set(storageKey, paths);
  }
  return touches;
}

function fieldsForEntry(entry, touches) {
  const key = entry?.storageKey ?? entry?.id;
  if (key == null || !touches.has(String(key))) return null;
  return [...touches.get(String(key)).values()];
}

/**
 * Limit an action's update entries to the fields in `touches`. Entries for
 * objects with no recorded touches keep their full diff (conservative: the
 * change may have come through a path that does not report touches). An
 * update whose limited diff is empty is dropped; an action left with nothing
 * returns null. Creates and deletes are untouched.
 */
export function restrictAnnotationHistoryActionFields(action, touches) {
  if (!action || !(touches instanceof Map) || touches.size === 0) return action;
  const limit = (entry) => {
    const fields = fieldsForEntry(entry, touches);
    if (!fields) return entry;
    const changes = restrictFieldChanges(diffAnnotationFields(entry.before, entry.after), fields);
    return changes.length > 0 ? { ...entry, fields } : null;
  };
  if (action.type === 'fabric:update') return limit(action);
  if (action.type === 'fabric:batch') {
    const updated = (action.updated || []).map(limit).filter(Boolean);
    if (
      updated.length === 0
      && (action.created || []).length === 0
      && (action.deleted || []).length === 0
    ) return null;
    return { ...action, updated };
  }
  return action;
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

  return null;
}

export function invertAnnotationHistoryAction(action) {
  if (!action || typeof action !== 'object') return null;
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

export function filterAnnotationHistoryActionByOwner(action, userId, documentOwnerId = null) {
  if (!action || typeof action !== 'object') return null;
  if (typeof userId !== 'string' || userId.length === 0) return null;
  if (
    typeof documentOwnerId === 'string'
    && documentOwnerId.length > 0
    && userId === documentOwnerId
  ) {
    return action;
  }

  if (action.type === 'fabric:document-batch') {
    if (action.confirmedCrossAuthorDelete === true) {
      return cloneJson(action);
    }
    const requested = Array.isArray(action.actions) ? action.actions : [];
    const actions = requested.map((child) => (
      filterAnnotationHistoryActionByOwner(child, userId, documentOwnerId)
    ));
    // Cross-page destructive actions are atomic. If any page contains an
    // annotation outside the viewer's history scope, fail the whole action
    // instead of producing a partial undo that cannot restore the series.
    const mutationCount = (child) => {
      if (!child) return 0;
      if (child.type === 'fabric:batch') {
        return (child.created?.length || 0)
          + (child.deleted?.length || 0)
          + (child.updated?.length || 0);
      }
      if (child.type === 'fabric:document-batch') {
        return (child.actions || []).reduce((sum, nested) => sum + mutationCount(nested), 0);
      }
      return ['fabric:create', 'fabric:delete', 'fabric:update'].includes(child.type) ? 1 : 0;
    };
    if (
      requested.length === 0
      || actions.some((child, index) => (
        !child || mutationCount(child) !== mutationCount(requested[index])
      ))
    ) return null;
    return {
      ...action,
      actions: actions.map((child) => cloneJson(child)),
    };
  }

  if (action.type === 'fabric:create' || action.type === 'fabric:delete') {
    return isOwnAnnotation(action.annotation, userId) ? action : null;
  }

  if (action.type === 'fabric:update') {
    return isOwnAnnotation(action.before, userId) && isOwnAnnotation(action.after, userId)
      ? action
      : null;
  }

  if (action.type === 'fabric:batch') {
    const created = (action.created || []).filter((entry) => isOwnAnnotation(entry.annotation, userId));
    const deleted = (action.deleted || []).filter((entry) => isOwnAnnotation(entry.annotation, userId));
    const updated = (action.updated || []).filter((entry) => (
      isOwnAnnotation(entry.before, userId) && isOwnAnnotation(entry.after, userId)
    ));

    if (created.length === 0 && deleted.length === 0 && updated.length === 0) return null;

    return {
      ...action,
      created: cloneEntries(created),
      deleted: cloneEntries(deleted),
      updated: cloneEntries(updated),
    };
  }

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
  if (action.type === 'fabric:create') {
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
