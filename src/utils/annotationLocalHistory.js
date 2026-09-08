/**
 * annotationLocalHistory.js — pure undo/redo diff engine for Fabric annotations.
 *
 * Diffs previous vs next page object lists into history actions
 * (fabric:create/delete/update/batch), inverts them for undo
 * (invertAnnotationHistoryAction), filters by owner, and applies them back to an
 * annotations-by-page map. Keyed by getAnnotationHistoryId; supports both precise
 * (explicit changed/created/deleted ids) and full-diff builders.
 */
import { deepClone } from './deepClone.js';
import { isManagedLocalEditingContext } from './managedLocalEditingContext.js';

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
      })),
    };
  }
  return null;
}

export function filterAnnotationHistoryActionByOwner(action, userId, documentOwnerId = null, localDocumentContext = null) {
  if (!action || typeof action !== 'object') return null;
  // Device-local history has no cloud owner. As with cloud owner history,
  // Undo can restore a prior lock state; normal edit gates enforce locks.
  if (isManagedLocalEditingContext(localDocumentContext)) return action;
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

export function applyAnnotationHistoryAction(annotationsByPage, action) {
  if (!action || typeof action !== 'object') return annotationsByPage || {};
  if (action.type === 'fabric:document-batch') {
    return (action.actions || []).reduce(
      (current, child) => applyAnnotationHistoryAction(current, child),
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
    nextObjects = replaceAtStorageIndex(
      objects,
      targetIndex,
      action.after,
      action.storageKey,
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
      nextObjects = replaceAtStorageIndex(
        nextObjects,
        targetIndex,
        entry.after,
        entry.storageKey,
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
