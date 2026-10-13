import {
  buildEraseIntent,
  classifyEraseObjectKind,
  cloneForIntent,
  createEraseStorageKeyResolver,
  getEraseObjectId,
  shallowCopyObject,
} from './annotationEraseTransaction.js';
import { renumberCounters } from './counterNumbering.js';
import { markEditedImportedPdfAnnotationsOnPage } from '../viewerShared.js';
import { setAnnotationStorageKey } from './annotationStorageIdentity.js';
import {
  counterSeriesKey,
  counterSeriesMembershipSnapshot,
} from './counterSeriesMembership.js';
import {
  MAX_ERASE_DELETE_HISTORY_OBJECTS,
} from './annotationEraseLimits.js';

export { MAX_ERASE_DELETE_HISTORY_EFFECT_BYTES } from './annotationEraseLimits.js';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function valuesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function batchDeleteHistoryMutations(mutations) {
  const batches = [];
  for (let index = 0; index < mutations.length; index += MAX_ERASE_DELETE_HISTORY_OBJECTS) {
    batches.push(
      mutations.slice(index, index + MAX_ERASE_DELETE_HISTORY_OBJECTS),
    );
  }
  return batches;
}

function targetPageNumber(intent, target) {
  return Number(target?.pageNumber ?? intent?.pageNumber);
}

function pageObjectRecords(page, pageNumber) {
  const objects = Array.isArray(page?.objects) ? page.objects : [];
  const resolveStorageKey = createEraseStorageKeyResolver(pageNumber);
  return objects.map((object, index) => ({
    object,
    index,
    storageKey: String(resolveStorageKey(object)),
  }));
}

function findTargetIndex(records, target) {
  const exact = records.find((record) => record.storageKey === String(target.storageKey));
  if (exact) return exact.index;
  const fallbackIndex = Number(target.index);
  if (
    Number.isInteger(fallbackIndex)
    && fallbackIndex >= 0
    && fallbackIndex < records.length
  ) {
    return fallbackIndex;
  }
  return -1;
}

// `deep`: clone every page first (the counter-renumber path mutates objects
// in place). Otherwise the result shares the input's untouched objects, which
// nothing downstream mutates.
function applyTargetsToPages(annotationsByPage, intent, { deep = true } = {}) {
  const afterByPage = deep
    ? (clone(annotationsByPage || {}) || {})
    : { ...(annotationsByPage || {}) };
  const byPage = new Map();
  for (const target of intent?.targets || []) {
    const pageNumber = targetPageNumber(intent, target);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) continue;
    if (!byPage.has(pageNumber)) byPage.set(pageNumber, []);
    byPage.get(pageNumber).push(target);
  }

  for (const [pageNumber, targets] of byPage) {
    const pageKey = String(pageNumber);
    const page = afterByPage[pageKey] || afterByPage[pageNumber] || { objects: [] };
    const records = pageObjectRecords(page, pageNumber);
    const objects = [...records.map((record) => record.object)];
    const deletes = [];
    for (const target of targets) {
      const index = findTargetIndex(records, target);
      if (index < 0) {
        throw new Error(`erase commit plan cannot resolve ${target.storageKey}`);
      }
      if (target.operation === 'delete') {
        deletes.push(index);
      } else {
        // Shallow path: the intent's deep-frozen survivor is shared (nothing
        // here mutates it; renumbering, which does, takes the deep path).
        objects[index] = setAnnotationStorageKey(
          deep ? clone(target.after) : cloneForIntent(target.after),
          String(target.storageKey),
        );
      }
    }
    [...new Set(deletes)]
      .sort((left, right) => right - left)
      .forEach((index) => objects.splice(index, 1));
    afterByPage[pageKey] = { ...page, objects };
  }
  return afterByPage;
}

function touchedPagesCopy(annotationsByPage, pageNumbers) {
  const copy = {};
  for (const pageNumber of pageNumbers) {
    const pageKey = String(pageNumber);
    const page = annotationsByPage?.[pageKey];
    if (!page) continue;
    copy[pageKey] = Array.isArray(page.objects)
      ? { ...page, objects: page.objects.map(shallowCopyObject) }
      : { ...page };
  }
  return copy;
}

function recordsAcrossPages(annotationsByPage) {
  const records = new Map();
  for (const [pageKey, page] of Object.entries(annotationsByPage || {})) {
    const pageNumber = Number(pageKey);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) continue;
    for (const record of pageObjectRecords(page, pageNumber)) {
      records.set(record.storageKey, {
        ...record,
        pageNumber,
      });
    }
  }
  return records;
}

/**
 * Add every deterministic mutation the ordinary save pipeline previously
 * derived after an erase: imported-native edit stamps and counter renumbering.
 * The returned intent carries those changes into the same Y.Doc transaction.
 */
export function prepareEraseIntentForCommit({
  intent,
  annotationsByPage,
  userId = null,
  includeDeleteHistory = false,
} = {}) {
  if (!intent?.mutationId || !Array.isArray(intent.targets)) {
    throw new TypeError('intent must be built by buildEraseIntent');
  }

  const touchedPageNumbers = new Set(
    intent.targets
      .map((target) => targetPageNumber(intent, target))
      .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0),
  );
  const deletedCounter = intent.targets.some(
    (target) => target.operation === 'delete' && target.before?.data?.type === 'counter',
  );
  // Test plan 68 (2026-10-06): this used to deep-clone EVERY page twice per
  // erase (~0.6 s of main thread on a document with ~3,000 imported marks).
  // Only a counter delete needs the whole document (renumbering spans pages
  // and mutates objects); otherwise only the touched pages take part, as
  // shallow object copies shared by the before and after page (the after
  // page replaces the targets with fresh clones; nothing mutates the rest).
  const beforeByPage = deletedCounter
    ? (clone(annotationsByPage || {}) || {})
    : touchedPagesCopy(annotationsByPage, touchedPageNumbers);
  let afterByPage = applyTargetsToPages(beforeByPage, intent, { deep: deletedCounter });

  for (const pageNumber of touchedPageNumbers) {
    const pageKey = String(pageNumber);
    const beforePage = beforeByPage[pageKey] || beforeByPage[pageNumber] || { objects: [] };
    const afterPage = afterByPage[pageKey] || afterByPage[pageNumber] || { objects: [] };
    const afterRecords = pageObjectRecords(afterPage, pageNumber);
    const markedPage = markEditedImportedPdfAnnotationsOnPage(
      afterPage,
      beforePage,
      {
        source: 'eraser:commit',
        userId,
        pageNumber,
      },
    );
    (markedPage?.objects || []).forEach((object, index) => {
      const storageKey = afterRecords[index]?.storageKey;
      if (storageKey) setAnnotationStorageKey(object, storageKey);
    });
    afterByPage[pageKey] = markedPage;
  }

  const affectedCounterSeries = new Set(intent.targets
    .filter((target) => target.operation === 'delete' && target.before?.data?.type === 'counter')
    .map((target) => counterSeriesKey(target.before)));
  const counterSeriesPreconditions = affectedCounterSeries.size > 0
    ? counterSeriesMembershipSnapshot(beforeByPage, affectedCounterSeries)
    : [];
  if (deletedCounter) {
    afterByPage = renumberCounters(afterByPage);
  }

  const beforeRecords = recordsAcrossPages(beforeByPage);
  const afterRecords = recordsAcrossPages(afterByPage);
  const targetByStorageKey = new Map(
    intent.targets.map((target) => [String(target.storageKey), target]),
  );
  const targets = intent.targets.map((target) => {
    if (target.operation !== 'replace') return target;
    const after = afterRecords.get(String(target.storageKey))?.object;
    if (!after) throw new Error(`erase commit plan lost replacement ${target.storageKey}`);
    return {
      ...target,
      after,
      pageNumber: targetPageNumber(intent, target),
    };
  });

  if (deletedCounter) {
    for (const [storageKey, beforeRecord] of beforeRecords) {
      if (targetByStorageKey.has(storageKey)) continue;
      const afterRecord = afterRecords.get(storageKey);
      if (
        beforeRecord.object?.data?.type !== 'counter'
        || afterRecord?.object?.data?.type !== 'counter'
        || valuesMatch(beforeRecord.object, afterRecord.object)
      ) continue;
      targets.push({
        domain: 'page-object',
        storageKey,
        kind: 'counter',
        operation: 'replace',
        cause: 'counter-renumber',
        pageNumber: beforeRecord.pageNumber,
        index: beforeRecord.index,
        before: beforeRecord.object,
        after: afterRecord.object,
      });
    }
  }

  const sideEffects = [...(intent.sideEffects || [])];
  if (includeDeleteHistory) {
    const historyTargets = targets
      .filter((target) => target.operation === 'delete')
      .sort((left, right) => (
        targetPageNumber(intent, left) - targetPageNumber(intent, right)
        || String(left.storageKey).localeCompare(String(right.storageKey))
        || Number(left.index ?? 0) - Number(right.index ?? 0)
      ));
    const hasDeleteHistory = sideEffects.some(
      (effect) => (
        effect?.type === 'annotation-delete-history'
        && (
          String(effect?.payload?.mutationId || '') === String(intent.mutationId)
          || String(effect?.targetKey) === String(intent.mutationId)
        )
      ),
    );
    if (historyTargets.length > 0 && !hasDeleteHistory) {
      const mutations = historyTargets.map((target) => ({
        domain: target.domain,
        kind: target.kind,
        operation: target.operation,
        cause: target.cause || null,
        pageNumber: targetPageNumber(intent, target),
        index: target.index ?? null,
        storageKey: String(target.storageKey),
        annotationId: (
          getEraseObjectId(target.after)
          || getEraseObjectId(target.before)
        ),
        before: clone(target.before),
        ...(target.operation === 'replace' ? { after: clone(target.after) } : {}),
      }));
      const batches = batchDeleteHistoryMutations(mutations);
      batches.forEach((batch, batchIndex) => {
        sideEffects.push({
          type: 'annotation-delete-history',
          targetKey: `${intent.mutationId}:delete-history:${batchIndex + 1}-of-${batches.length}`,
          payload: {
            mutationId: intent.mutationId,
            batchIndex,
            batchTotal: batches.length,
            gestureTotalCount: mutations.length,
            mutations: batch,
          },
        });
      });
    }
  }

  const sideEffectPriority = {
    'legacy-marker-delete': 0,
    trash: 1,
    history: 2,
    'annotation-delete-history': 2,
    'excel-delete': 3,
  };
  sideEffects.sort(
    (left, right) => (
      (sideEffectPriority[left?.type] ?? 2)
      - (sideEffectPriority[right?.type] ?? 2)
    ),
  );

  const changedIds = targets
    .filter((target) => target.operation === 'replace')
    .map((target) => getEraseObjectId(target.after) || getEraseObjectId(target.before))
    .filter(Boolean);
  return buildEraseIntent({
    mutationId: intent.mutationId,
    pageNumber: intent.pageNumber,
    renderer: intent.renderer,
    gesture: intent.gesture,
    targets,
    sideEffects,
    diagnostics: {
      ...(intent.diagnostics || {}),
      finalChangedAnnotationIds: [...new Set(changedIds)],
      changedObjectsCount: targets.length,
      ...(counterSeriesPreconditions.length > 0 ? { counterSeriesPreconditions } : {}),
    },
    presentationRevision: intent.presentationRevision,
  });
}

/**
 * Convert one delete-only eraser History effect into the inverse create
 * actions stored by the Revisions panel. Partial geometry and derived counter
 * renumbering remain exact in local Cmd+Z/Redo, but are intentionally excluded
 * from immutable delete History rows.
 */
export function buildAnnotationEraseDeleteHistoryRestoreActions(effect) {
  if (effect?.type !== 'annotation-delete-history') return [];
  const mutations = Array.isArray(effect?.payload?.mutations)
    ? effect.payload.mutations
    : [];
  return mutations.filter((mutation) => mutation?.operation === 'delete').map((mutation) => {
    const annotationId = mutation.annotationId || mutation.storageKey;
    const common = {
      pageNumber: mutation.pageNumber,
      annotationId,
      storageKey: mutation.storageKey,
      index: mutation.index ?? null,
    };
    const restoreAction = {
      type: 'fabric:create',
      ...common,
      ...(mutation.eraseDeleteLane ? {} : { annotation: clone(mutation.before) }),
      ...(mutation.eraseDeleteLane
        ? { eraseDeleteLane: clone(mutation.eraseDeleteLane) }
        : {}),
    };
    return {
      annotationId,
      pageNumber: mutation.pageNumber,
      restoreAction,
    };
  });
}
