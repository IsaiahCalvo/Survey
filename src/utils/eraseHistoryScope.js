import {
  createAnnotationStorageKeyResolver,
  getAnnotationStorageKey,
  setAnnotationStorageKey,
} from './annotationStorageIdentity.js';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function getAnnotationId(object) {
  return (
    object?.data?.id
    ?? object?.data?.annoId
    ?? object?.id
    ?? object?.annotationId
    ?? object?.pdfAnnotationId
    ?? null
  );
}

function valuesMatch(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function resolvePageRecords(page, pageNumber) {
  const resolveStorageKey = createAnnotationStorageKeyResolver();
  return (Array.isArray(page?.objects) ? page.objects : []).map((object, index) => {
    const storageKey = String(resolveStorageKey(object, pageNumber, getAnnotationId(object)));
    return { object, index, storageKey };
  });
}

function findRecord(records, target) {
  const exact = records.find((record) => record.storageKey === String(target.storageKey));
  if (exact) return exact;
  const annotationId = target.annotationId == null ? null : String(target.annotationId);
  if (annotationId) {
    const matching = records.filter(
      (record) => String(getAnnotationId(record.object)) === annotationId,
    );
    if (matching.length === 1) return matching[0];
  }
  const index = Number(target.index);
  if (Number.isInteger(index) && index >= 0 && index < records.length) {
    const candidate = records[index];
    if (!annotationId || String(getAnnotationId(candidate.object)) === annotationId) {
      return candidate;
    }
  }
  return null;
}

export function buildEraseHistoryScopeTargets(intent) {
  return (intent?.targets || []).map((target) => ({
    domain: target.domain,
    storageKey: String(target.storageKey),
    pageNumber: Number(target.pageNumber ?? intent?.pageNumber),
    index: Number.isInteger(target.index) ? target.index : null,
    annotationId: getAnnotationId(target.before) || getAnnotationId(target.after),
    operation: target.operation,
    before: clone(target.before),
    ...(target.after === undefined ? {} : { after: clone(target.after) }),
  }));
}

/**
 * Merge only one eraser gesture's lanes from targetSnapshot into the current
 * document. Unrelated objects/markers added or edited after the erase remain
 * untouched, including collaborator work.
 */
export function scopeEraseHistorySnapshot({
  currentSnapshot,
  targetSnapshot,
  targets,
} = {}) {
  const next = clone(currentSnapshot || {}) || {};
  const target = targetSnapshot || {};
  const scopedTargets = Array.isArray(targets) ? targets : [];
  const pageTargets = scopedTargets.filter(
    (entry) => Number.isInteger(entry?.pageNumber),
  );
  const byPage = new Map();
  for (const entry of pageTargets) {
    if (!byPage.has(entry.pageNumber)) byPage.set(entry.pageNumber, []);
    byPage.get(entry.pageNumber).push(entry);
  }

  const annotationsByPage = { ...(next.annotationsByPage || {}) };
  const allowedTargetKeys = new Set();
  for (const [pageNumber, entries] of byPage) {
    const pageKey = String(pageNumber);
    const currentPage = annotationsByPage[pageKey]
      || annotationsByPage[pageNumber]
      || { objects: [] };
    const targetPage = target.annotationsByPage?.[pageKey]
      || target.annotationsByPage?.[pageNumber]
      || { objects: [] };
    const currentRecords = resolvePageRecords(currentPage, pageNumber);
    const targetRecords = resolvePageRecords(targetPage, pageNumber);
    const transitions = entries.map((entry) => {
      const currentRecord = findRecord(currentRecords, entry);
      const targetRecord = findRecord(targetRecords, entry);
      const desired = targetRecord?.object;
      let expectedCurrent;
      if (entry.operation === 'delete') {
        expectedCurrent = desired === undefined ? entry.before : undefined;
      } else if (valuesMatch(desired, entry.before)) {
        expectedCurrent = entry.after;
      } else if (valuesMatch(desired, entry.after)) {
        expectedCurrent = entry.before;
      } else {
        return { entry, currentRecord, targetRecord, allowed: false };
      }
      const allowed = expectedCurrent === undefined
        ? currentRecord == null
        : currentRecord != null && valuesMatch(currentRecord.object, expectedCurrent);
      return { entry, currentRecord, targetRecord, allowed };
    });
    const selectedCurrent = new Set(
      transitions
        .filter((transition) => transition.allowed && transition.currentRecord)
        .map((transition) => transition.currentRecord),
    );
    transitions
      .filter((transition) => transition.allowed)
      .forEach((transition) => allowedTargetKeys.add(String(transition.entry.storageKey)));
    const objects = currentRecords
      .filter((record) => !selectedCurrent.has(record))
      .map((record) => record.object);
    const targetInsertions = transitions
      .filter((transition) => transition.allowed && transition.targetRecord)
      .map(({ entry, targetRecord: record }) => ({ entry, record }))
      .filter(Boolean)
      .sort((left, right) => left.record.index - right.record.index);
    for (const { entry, record } of targetInsertions) {
      const object = clone(record.object);
      setAnnotationStorageKey(object, entry.storageKey);
      const index = Math.max(0, Math.min(record.index, objects.length));
      objects.splice(index, 0, object);
    }
    annotationsByPage[pageKey] = { ...currentPage, objects };
  }
  next.annotationsByPage = annotationsByPage;

  const calloutTargets = scopedTargets.filter(
    (entry) => entry?.domain === 'callout'
      && allowedTargetKeys.has(String(entry.storageKey)),
  );
  if (calloutTargets.length > 0 && Array.isArray(next.callouts)) {
    const targetCallouts = Array.isArray(target.callouts) ? target.callouts : [];
    const targetIds = new Set(
      calloutTargets
        .map((entry) => String(entry.annotationId ?? entry.storageKey))
        .filter(Boolean),
    );
    const callouts = next.callouts.filter(
      (callout) => !targetIds.has(String(callout?.id ?? callout?.annotationId)),
    );
    for (const callout of targetCallouts) {
      if (targetIds.has(String(callout?.id ?? callout?.annotationId))) {
        callouts.push(clone(callout));
      }
    }
    next.callouts = callouts;
  }
  return next;
}
