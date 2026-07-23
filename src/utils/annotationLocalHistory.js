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
import {
  getAnnotationStorageKey,
  setAnnotationStorageKey,
} from './annotationStorageIdentity.js';

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
  if (!userId) return true;
  const authorId = getAnnotationHistoryAuthorId(annotation);
  return !authorId || authorId === userId;
}

function cloneJson(value) {
  return deepClone(value);
}

function cloneAnnotationWithStorageKey(annotation, storageKey) {
  return setAnnotationStorageKey(cloneJson(annotation), storageKey);
}

function getObjects(page) {
  return Array.isArray(page?.objects) ? page.objects : [];
}

function buildIdMap(objects) {
  const map = new Map();
  objects.forEach((obj, index) => {
    const id = getAnnotationHistoryId(obj);
    if (!id) return;
    map.set(id, { obj, index });
  });
  return map;
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function buildHistoryRecords(objects) {
  const occurrences = new Map();
  return objects.map((obj, index) => {
    const stableId = getAnnotationHistoryId(obj);
    const occurrence = stableId ? (occurrences.get(stableId) || 0) : null;
    if (stableId) occurrences.set(stableId, occurrence + 1);
    return {
      obj,
      index,
      stableId,
      occurrence,
      id: stableId || `index:${index}`,
      storageKey: getAnnotationStorageKey(obj),
    };
  });
}

function pairRecordsByStableId(previousRecords, nextRecords, stableId, preferOccurrenceOrder = false) {
  const previous = previousRecords.filter((entry) => entry.stableId === stableId);
  const next = nextRecords.filter((entry) => entry.stableId === stableId);
  if (preferOccurrenceOrder) {
    const sharedCount = Math.min(previous.length, next.length);
    const unchangedPairs = [];
    const updatedPairs = [];
    for (let index = 0; index < sharedCount; index += 1) {
      const pair = { before: previous[index], after: next[index] };
      if (sameJson(pair.before.obj, pair.after.obj)) unchangedPairs.push(pair);
      else updatedPairs.push(pair);
    }
    return {
      unchangedPairs,
      updatedPairs,
      deleted: previous.slice(sharedCount),
      created: next.slice(sharedCount),
    };
  }
  const lcs = Array.from(
    { length: previous.length + 1 },
    () => Array(next.length + 1).fill(0),
  );
  for (let beforeIndex = previous.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = next.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lcs[beforeIndex][afterIndex] = sameJson(
        previous[beforeIndex].obj,
        next[afterIndex].obj,
      )
        ? 1 + lcs[beforeIndex + 1][afterIndex + 1]
        : Math.max(
          lcs[beforeIndex + 1][afterIndex],
          lcs[beforeIndex][afterIndex + 1],
        );
    }
  }

  const unchangedPairs = [];
  const unmatchedPrevious = [];
  const unmatchedNext = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < previous.length && afterIndex < next.length) {
    if (sameJson(previous[beforeIndex].obj, next[afterIndex].obj)) {
      unchangedPairs.push({
        before: previous[beforeIndex],
        after: next[afterIndex],
      });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (lcs[beforeIndex + 1][afterIndex] >= lcs[beforeIndex][afterIndex + 1]) {
      unmatchedPrevious.push(previous[beforeIndex]);
      beforeIndex += 1;
    } else {
      unmatchedNext.push(next[afterIndex]);
      afterIndex += 1;
    }
  }
  unmatchedPrevious.push(...previous.slice(beforeIndex));
  unmatchedNext.push(...next.slice(afterIndex));
  const updateCount = Math.min(unmatchedPrevious.length, unmatchedNext.length);
  const updatedPairs = [];
  for (let index = 0; index < updateCount; index += 1) {
    updatedPairs.push({
      before: unmatchedPrevious[index],
      after: unmatchedNext[index],
    });
  }

  return {
    unchangedPairs,
    updatedPairs,
    deleted: unmatchedPrevious.slice(updateCount),
    created: unmatchedNext.slice(updateCount),
  };
}

function parseIndexSelector(id) {
  const match = /^index:(\d+)$/.exec(String(id));
  return match ? Number(match[1]) : null;
}

function pairIdlessChangedRecords({
  previousRecords,
  nextRecords,
  deletedIds,
  changedIds,
  createdIds,
}) {
  const deletedPreviousIndexes = new Set(
    deletedIds.map(parseIndexSelector).filter(Number.isInteger),
  );
  const changedPreviousIndexes = new Set(
    changedIds.map(parseIndexSelector).filter(Number.isInteger),
  );
  const createdNextIndexes = new Set(
    createdIds.map(parseIndexSelector).filter(Number.isInteger),
  );
  const previousIdless = previousRecords.filter((record) => !record.stableId);
  const nextIdless = nextRecords.filter((record) => !record.stableId);
  const previousSurvivors = previousIdless.filter(
    (record) => !deletedPreviousIndexes.has(record.index),
  );
  const nextExisting = nextIdless.filter(
    (record) => !createdNextIndexes.has(record.index),
  );

  const pairs = new Map();
  previousSurvivors.forEach((before, survivorIndex) => {
    if (!changedPreviousIndexes.has(before.index)) return;
    const after = nextExisting[survivorIndex] || null;
    if (!after) return;
    pairs.set(before.index, { before, after });
  });
  return pairs;
}

function preciseEntry(record, annotationKey) {
  return {
    id: record.id,
    stableId: record.stableId,
    occurrence: record.occurrence,
    index: record.index,
    storageKey: record.storageKey,
    [annotationKey]: record.obj,
  };
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
  const previousRecords = buildHistoryRecords(previousObjects);
  const nextRecords = buildHistoryRecords(nextObjects);
  const deleteSet = normalizeIdList(deletedIds);
  const deleteSetLookup = new Set(deleteSet);
  const changeSet = normalizeIdList(changedIds);
  const changeSetLookup = new Set(changeSet);
  const createSet = normalizeIdList(createdIds).filter((id) => !deleteSetLookup.has(id));
  const deletedStorageSet = normalizeIdList(deletedStorageKeys);
  const deletedStorageLookup = new Set(deletedStorageSet);
  const changedStorageSet = normalizeIdList(changedStorageKeys)
    .filter((key) => !deletedStorageLookup.has(key));
  const createdStorageSet = normalizeIdList(createdStorageKeys)
    .filter((key) => !deletedStorageLookup.has(key));
  const recordByStorageKey = (records, key) => records.find(
    (record) => record.storageKey === String(key),
  ) || null;

  const pairCache = new Map();
  const getPairs = (id) => {
    if (!pairCache.has(id)) {
      pairCache.set(
        id,
        pairRecordsByStableId(previousRecords, nextRecords, id, changeSetLookup.has(id)),
      );
    }
    return pairCache.get(id);
  };
  const getIndexRecord = (records, id) => {
    const index = parseIndexSelector(id);
    if (!Number.isInteger(index)) return null;
    const record = records[index] || null;
    return record && !record.stableId ? record : null;
  };
  const idlessChangedPairs = pairIdlessChangedRecords({
    previousRecords,
    nextRecords,
    deletedIds: deleteSet,
    changedIds: changeSet,
    createdIds: createSet,
  });

  const created = createdStorageSet.length > 0
    ? createdStorageSet.flatMap((storageKey) => {
      const record = recordByStorageKey(nextRecords, storageKey);
      return record ? [{
        ...preciseEntry(record, 'after'),
        afterIndex: record.index,
        afterOccurrence: record.occurrence,
      }] : [];
    })
    : createSet.flatMap((id) => {
    const indexed = getIndexRecord(nextRecords, id);
    const records = indexed ? [indexed] : getPairs(id).created;
    return records.map((record) => ({
      ...preciseEntry(record, 'after'),
      afterIndex: record.index,
      afterOccurrence: record.occurrence,
    }));
  });
  const deleted = deletedStorageSet.length > 0
    ? deletedStorageSet.flatMap((storageKey) => {
      const record = recordByStorageKey(previousRecords, storageKey);
      return record ? [{
        ...preciseEntry(record, 'before'),
        beforeIndex: record.index,
        beforeOccurrence: record.occurrence,
        targetSnapshotCount: previousRecords.filter(
          (candidate) => sameJson(candidate.obj, record.obj),
        ).length,
      }] : [];
    })
    : deleteSet.flatMap((id) => {
    const indexed = getIndexRecord(previousRecords, id);
    const records = indexed ? [indexed] : getPairs(id).deleted;
    return records.map((record) => ({
      ...preciseEntry(record, 'before'),
      beforeIndex: record.index,
      beforeOccurrence: record.occurrence,
      targetSnapshotCount: previousRecords.filter(
        (candidate) => sameJson(candidate.obj, record.obj),
      ).length,
    }));
  });
  const updated = changedStorageSet.length > 0
    ? changedStorageSet.flatMap((storageKey) => {
      const before = recordByStorageKey(previousRecords, storageKey);
      const after = recordByStorageKey(nextRecords, storageKey);
      if (!before || !after || sameJson(before.obj, after.obj)) return [];
      return [{
        id: before.id,
        storageKey: before.storageKey,
        stableId: before.stableId,
        occurrence: before.occurrence,
        index: before.index,
        beforeIndex: before.index,
        afterIndex: after.index,
        beforeOccurrence: before.occurrence,
        afterOccurrence: after.occurrence,
        before: before.obj,
        after: after.obj,
      }];
    })
    : changeSet.flatMap((id) => {
    const beforeAtIndex = getIndexRecord(previousRecords, id);
    if (beforeAtIndex) {
      const pair = idlessChangedPairs.get(beforeAtIndex.index);
      if (!pair || sameJson(pair.before.obj, pair.after.obj)) return [];
      return [{
        id: beforeAtIndex.id,
        storageKey: beforeAtIndex.storageKey,
        stableId: null,
        occurrence: null,
        index: beforeAtIndex.index,
        beforeIndex: beforeAtIndex.index,
        afterIndex: pair.after.index,
        before: pair.before.obj,
        after: pair.after.obj,
      }];
    }
    return getPairs(id).updatedPairs.map(({ before, after }) => ({
      id: before.id,
      storageKey: before.storageKey,
      stableId: before.stableId,
      occurrence: before.occurrence,
      index: before.index,
      beforeIndex: before.index,
      afterIndex: after.index,
      beforeOccurrence: before.occurrence,
      afterOccurrence: after.occurrence,
      before: before.obj,
      after: after.obj,
    }));
  });

  if (created.length === 0 && deleted.length === 0 && updated.length === 0) {
    return null;
  }

  if (created.length === 1 && deleted.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:create',
      pageNumber,
      annotationId: created[0].id,
      annotation: cloneJson(created[0].after),
      storageKey: created[0].storageKey,
      stableId: created[0].stableId,
      occurrence: created[0].occurrence,
      index: created[0].index,
      afterIndex: created[0].afterIndex,
      afterOccurrence: created[0].afterOccurrence,
    };
  }

  if (deleted.length === 1 && created.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:delete',
      pageNumber,
      annotationId: deleted[0].id,
      annotation: cloneJson(deleted[0].before),
      storageKey: deleted[0].storageKey,
      stableId: deleted[0].stableId,
      occurrence: deleted[0].occurrence,
      index: deleted[0].index,
      beforeIndex: deleted[0].beforeIndex,
      beforeOccurrence: deleted[0].beforeOccurrence,
      targetSnapshotCount: deleted[0].targetSnapshotCount,
    };
  }

  if (updated.length === 1 && created.length === 0 && deleted.length === 0) {
    return {
      type: 'fabric:update',
      pageNumber,
      annotationId: updated[0].id,
      storageKey: updated[0].storageKey,
      stableId: updated[0].stableId,
      occurrence: updated[0].occurrence,
      index: updated[0].index,
      beforeIndex: updated[0].beforeIndex,
      afterIndex: updated[0].afterIndex,
      beforeOccurrence: updated[0].beforeOccurrence,
      afterOccurrence: updated[0].afterOccurrence,
      before: cloneJson(updated[0].before),
      after: cloneJson(updated[0].after),
    };
  }

  return {
    type: 'fabric:batch',
    pageNumber,
    created: created.map((entry) => ({
      id: entry.id,
      storageKey: entry.storageKey,
      stableId: entry.stableId,
      occurrence: entry.occurrence,
      annotation: cloneJson(entry.after),
      index: entry.index,
      afterIndex: entry.afterIndex,
      afterOccurrence: entry.afterOccurrence,
    })),
    deleted: deleted.map((entry) => ({
      id: entry.id,
      storageKey: entry.storageKey,
      stableId: entry.stableId,
      occurrence: entry.occurrence,
      annotation: cloneJson(entry.before),
      index: entry.index,
      beforeIndex: entry.beforeIndex,
      beforeOccurrence: entry.beforeOccurrence,
      targetSnapshotCount: entry.targetSnapshotCount,
    })),
    updated: updated.map((entry) => ({
      id: entry.id,
      storageKey: entry.storageKey,
      stableId: entry.stableId,
      occurrence: entry.occurrence,
      index: entry.index,
      beforeIndex: entry.beforeIndex,
      afterIndex: entry.afterIndex,
      beforeOccurrence: entry.beforeOccurrence,
      afterOccurrence: entry.afterOccurrence,
      before: cloneJson(entry.before),
      after: cloneJson(entry.after),
    })),
  };
}

export function buildAnnotationHistoryAction({ pageNumber, previousPage, nextPage }) {
  const previousObjects = getObjects(previousPage);
  const nextObjects = getObjects(nextPage);
  const previousById = buildIdMap(previousObjects);
  const nextById = buildIdMap(nextObjects);

  const created = [];
  const deleted = [];
  const updated = [];

  for (const [id, entry] of nextById.entries()) {
    const before = previousById.get(id);
    if (!before) {
      created.push({ id, after: entry.obj });
    } else if (!sameJson(before.obj, entry.obj)) {
      updated.push({ id, before: before.obj, after: entry.obj });
    }
  }

  for (const [id, entry] of previousById.entries()) {
    if (!nextById.has(id)) {
      deleted.push({ id, before: entry.obj });
    }
  }

  if (created.length === 1 && deleted.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:create',
      pageNumber,
      annotationId: created[0].id,
      annotation: cloneJson(created[0].after),
      index: nextById.get(created[0].id)?.index ?? null,
    };
  }

  if (deleted.length === 1 && created.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:delete',
      pageNumber,
      annotationId: deleted[0].id,
      annotation: cloneJson(deleted[0].before),
      index: previousById.get(deleted[0].id)?.index ?? null,
    };
  }

  if (updated.length === 1 && created.length === 0 && deleted.length === 0) {
    return {
      type: 'fabric:update',
      pageNumber,
      annotationId: updated[0].id,
      before: cloneJson(updated[0].before),
      after: cloneJson(updated[0].after),
    };
  }

  const changeCount = created.length + deleted.length + updated.length;
  if (changeCount > 1) {
    return {
      type: 'fabric:batch',
      pageNumber,
      created: created.map((entry) => ({
        id: entry.id,
        annotation: cloneJson(entry.after),
        index: nextById.get(entry.id)?.index ?? null,
      })),
      deleted: deleted.map((entry) => ({
        id: entry.id,
        annotation: cloneJson(entry.before),
        index: previousById.get(entry.id)?.index ?? null,
      })),
      updated: updated.map((entry) => ({
        id: entry.id,
        before: cloneJson(entry.before),
        after: cloneJson(entry.after),
      })),
    };
  }

  return null;
}

export function invertAnnotationHistoryAction(action) {
  if (!action || typeof action !== 'object') return null;
  if (action.type === 'fabric:create') {
    return {
      type: 'fabric:delete',
      pageNumber: action.pageNumber,
      annotationId: action.annotationId,
      annotation: cloneJson(action.annotation),
      storageKey: action.storageKey ?? null,
      stableId: action.stableId ?? null,
      occurrence: action.afterOccurrence ?? action.occurrence ?? null,
      index: action.afterIndex ?? action.index ?? null,
      beforeIndex: action.afterIndex ?? action.index ?? null,
      beforeOccurrence: action.afterOccurrence ?? action.occurrence ?? null,
    };
  }
  if (action.type === 'fabric:delete') {
    return {
      type: 'fabric:create',
      pageNumber: action.pageNumber,
      annotationId: action.annotationId,
      annotation: cloneJson(action.annotation),
      storageKey: action.storageKey ?? null,
      stableId: action.stableId ?? null,
      occurrence: action.beforeOccurrence ?? action.occurrence ?? null,
      index: action.beforeIndex ?? action.index ?? null,
      afterIndex: action.beforeIndex ?? action.index ?? null,
      afterOccurrence: action.beforeOccurrence ?? action.occurrence ?? null,
      targetSnapshotCount: action.targetSnapshotCount,
      insertOccurrence: true,
    };
  }
  if (action.type === 'fabric:update') {
    return {
      type: 'fabric:update',
      pageNumber: action.pageNumber,
      annotationId: action.annotationId,
      storageKey: action.storageKey ?? null,
      stableId: action.stableId ?? null,
      occurrence: action.afterOccurrence ?? action.occurrence ?? null,
      index: action.afterIndex ?? action.index ?? null,
      beforeIndex: action.afterIndex ?? action.index ?? null,
      afterIndex: action.beforeIndex ?? action.index ?? null,
      beforeOccurrence: action.afterOccurrence ?? action.occurrence ?? null,
      afterOccurrence: action.beforeOccurrence ?? action.occurrence ?? null,
      before: cloneJson(action.after),
      after: cloneJson(action.before),
    };
  }
  if (action.type === 'fabric:batch') {
    return {
      type: 'fabric:batch',
      pageNumber: action.pageNumber,
      created: cloneEntries(action.deleted || []).map((entry) => ({
        id: entry.id,
        storageKey: entry.storageKey ?? null,
        stableId: entry.stableId ?? null,
        occurrence: entry.beforeOccurrence ?? entry.occurrence ?? null,
        annotation: entry.annotation,
        index: entry.beforeIndex ?? entry.index ?? null,
        afterIndex: entry.beforeIndex ?? entry.index ?? null,
        afterOccurrence: entry.beforeOccurrence ?? entry.occurrence ?? null,
        targetSnapshotCount: entry.targetSnapshotCount,
        insertOccurrence: true,
      })),
      deleted: cloneEntries(action.created || []).map((entry) => ({
        id: entry.id,
        storageKey: entry.storageKey ?? null,
        stableId: entry.stableId ?? null,
        occurrence: entry.afterOccurrence ?? entry.occurrence ?? null,
        annotation: entry.annotation,
        index: entry.afterIndex ?? entry.index ?? null,
        beforeIndex: entry.afterIndex ?? entry.index ?? null,
        beforeOccurrence: entry.afterOccurrence ?? entry.occurrence ?? null,
      })),
      updated: cloneEntries(action.updated || []).map((entry) => ({
        id: entry.id,
        storageKey: entry.storageKey ?? null,
        stableId: entry.stableId ?? null,
        occurrence: entry.afterOccurrence ?? entry.occurrence ?? null,
        index: entry.afterIndex ?? entry.index ?? null,
        beforeIndex: entry.afterIndex ?? entry.index ?? null,
        afterIndex: entry.beforeIndex ?? entry.index ?? null,
        beforeOccurrence: entry.afterOccurrence ?? entry.occurrence ?? null,
        afterOccurrence: entry.beforeOccurrence ?? entry.occurrence ?? null,
        before: entry.after,
        after: entry.before,
      })),
    };
  }
  return null;
}

export function filterAnnotationHistoryActionByOwner(action, userId) {
  if (!action || typeof action !== 'object' || !userId) return action || null;

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

function getEntryStableId(entry) {
  if (entry?.stableId) return entry.stableId;
  return getAnnotationHistoryId(entry?.annotation)
    || getAnnotationHistoryId(entry?.before)
    || getAnnotationHistoryId(entry?.after)
    || null;
}

function findEntryObjectIndex(objects, entry, snapshot, usedIndexes = new Set()) {
  if (entry?.storageKey != null) {
    const storageKey = String(entry.storageKey);
    return objects.findIndex((object, index) => (
      !usedIndexes.has(index)
      && getAnnotationStorageKey(object) === storageKey
    ));
  }
  const stableId = getEntryStableId(entry);
  if (stableId) {
    const candidates = [];
    objects.forEach((object, index) => {
      if (getAnnotationHistoryId(object) === stableId) candidates.push(index);
    });
    if (Number.isInteger(entry?.occurrence)) {
      const occurrenceIndex = candidates[entry.occurrence];
      return occurrenceIndex != null && !usedIndexes.has(occurrenceIndex)
        ? occurrenceIndex
        : -1;
    }
    const available = candidates.filter((index) => !usedIndexes.has(index));
    const exact = available.find((index) => !snapshot || sameJson(objects[index], snapshot));
    return exact ?? available[0] ?? -1;
  }

  if (Number.isInteger(entry?.index)) {
    return entry.index >= 0
      && entry.index < objects.length
      && !usedIndexes.has(entry.index)
      && !getAnnotationHistoryId(objects[entry.index])
      ? entry.index
      : -1;
  }
  return objects.findIndex((object, index) => (
    !usedIndexes.has(index)
    && !getAnnotationHistoryId(object)
    && (!snapshot || sameJson(object, snapshot))
  ));
}

function findExistingCreateIndex(objects, entry) {
  if (entry?.storageKey != null) {
    const storageKey = String(entry.storageKey);
    return objects.findIndex((object) => getAnnotationStorageKey(object) === storageKey);
  }
  if (
    entry?.insertOccurrence === true
    && Number.isInteger(entry.targetSnapshotCount)
  ) {
    const exactIndexes = [];
    objects.forEach((object, index) => {
      if (sameJson(object, entry.annotation)) exactIndexes.push(index);
    });
    if (exactIndexes.length < entry.targetSnapshotCount) return -1;
    const targetIndex = Number.isInteger(entry.index) ? entry.index : -1;
    return exactIndexes.includes(targetIndex) ? targetIndex : (exactIndexes[0] ?? -1);
  }
  const stableId = getEntryStableId(entry);
  if (stableId) {
    const candidates = [];
    objects.forEach((object, index) => {
      if (getAnnotationHistoryId(object) === stableId) candidates.push(index);
    });
    if (Number.isInteger(entry?.occurrence)) {
      return candidates[entry.occurrence] ?? -1;
    }
    return candidates[0] ?? -1;
  }
  return findEntryObjectIndex(objects, entry, entry?.annotation);
}

function insertAnnotationAtIndex(objects, annotation, index, storageKey = null) {
  const next = [...objects];
  const insertionIndex = Number.isInteger(index)
    ? Math.max(0, Math.min(index, next.length))
    : next.length;
  next.splice(
    insertionIndex,
    0,
    cloneAnnotationWithStorageKey(annotation, storageKey),
  );
  return next;
}

export function applyAnnotationHistoryAction(annotationsByPage, action) {
  if (!action || typeof action !== 'object') return annotationsByPage || {};
  const pageKey = String(action.pageNumber);
  const current = annotationsByPage || {};
  const page = current[pageKey] || current[action.pageNumber] || { objects: [] };
  const objects = getObjects(page);
  const targetId = action.annotationId || getAnnotationHistoryId(action.annotation) || getAnnotationHistoryId(action.after);

  if (action.type !== 'fabric:batch' && !targetId) return current;

  let nextObjects = objects;
  if (action.type === 'fabric:create') {
    const entry = {
      id: targetId,
      storageKey: action.storageKey,
      stableId: action.stableId,
      occurrence: action.afterOccurrence ?? action.occurrence,
      annotation: action.annotation,
      index: action.afterIndex ?? action.index,
      insertOccurrence: action.insertOccurrence,
      targetSnapshotCount: action.targetSnapshotCount,
    };
    const existingIndex = findExistingCreateIndex(objects, entry);
    if (existingIndex >= 0) {
      nextObjects = objects.map((object, index) => (
        index === existingIndex
          ? cloneAnnotationWithStorageKey(action.annotation, action.storageKey)
          : object
      ));
    } else {
      nextObjects = insertAnnotationAtIndex(
        objects,
        action.annotation,
        action.afterIndex ?? action.index,
        action.storageKey,
      );
    }
  } else if (action.type === 'fabric:delete') {
    const targetIndex = findEntryObjectIndex(objects, {
      id: targetId,
      storageKey: action.storageKey,
      stableId: action.stableId,
      occurrence: action.beforeOccurrence ?? action.occurrence,
      index: action.beforeIndex ?? action.index,
      annotation: action.annotation,
    }, action.annotation);
    nextObjects = targetIndex < 0
      ? objects
      : objects.filter((_, index) => index !== targetIndex);
  } else if (action.type === 'fabric:update') {
    const targetIndex = findEntryObjectIndex(objects, {
      id: targetId,
      storageKey: action.storageKey,
      stableId: action.stableId,
      occurrence: action.beforeOccurrence ?? action.occurrence,
      index: action.beforeIndex ?? action.index,
      before: action.before,
      after: action.after,
    }, action.before);
    nextObjects = targetIndex < 0
      ? objects
      : objects.map((object, index) => (
        index === targetIndex
          ? cloneAnnotationWithStorageKey(action.after, action.storageKey)
          : object
      ));
  } else if (action.type === 'fabric:batch') {
    const deletedIndexes = new Set();
    const usedSourceIndexes = new Set();
    for (const entry of action.deleted || []) {
      const sourceEntry = {
        ...entry,
        occurrence: entry.beforeOccurrence ?? entry.occurrence,
        index: entry.beforeIndex ?? entry.index,
      };
      const index = findEntryObjectIndex(objects, sourceEntry, entry.annotation, usedSourceIndexes);
      if (index >= 0) {
        deletedIndexes.add(index);
        usedSourceIndexes.add(index);
      }
    }

    const updatedByIndex = new Map();
    for (const entry of action.updated || []) {
      const sourceEntry = {
        ...entry,
        occurrence: entry.beforeOccurrence ?? entry.occurrence,
        index: entry.beforeIndex ?? entry.index,
      };
      const index = findEntryObjectIndex(objects, sourceEntry, entry.before, usedSourceIndexes);
      if (index < 0) continue;
      usedSourceIndexes.add(index);
      updatedByIndex.set(index, {
        after: entry.after,
        storageKey: entry.storageKey,
      });
    }
    nextObjects = objects.flatMap((object, index) => {
      if (deletedIndexes.has(index)) return [];
      const update = updatedByIndex.get(index);
      return [updatedByIndex.has(index)
        ? cloneAnnotationWithStorageKey(update.after, update.storageKey)
        : object];
    });

    const createdEntries = [...(action.created || [])].sort((left, right) => (
      (left.afterIndex ?? left.index ?? Number.MAX_SAFE_INTEGER)
      - (right.afterIndex ?? right.index ?? Number.MAX_SAFE_INTEGER)
    ));
    for (const entry of createdEntries) {
      const targetEntry = {
        ...entry,
        occurrence: entry.afterOccurrence ?? entry.occurrence,
        index: entry.afterIndex ?? entry.index,
      };
      const existingIndex = findExistingCreateIndex(nextObjects, targetEntry);
      if (existingIndex >= 0) {
        nextObjects = nextObjects.map((object, index) => (
          index === existingIndex
            ? cloneAnnotationWithStorageKey(entry.annotation, entry.storageKey)
            : object
        ));
        continue;
      }
      nextObjects = insertAnnotationAtIndex(
        nextObjects,
        entry.annotation,
        entry.afterIndex ?? entry.index,
        entry.storageKey,
      );
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
