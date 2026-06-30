/**
 * counterRenumberSavePolicy.js — decides whether counter annotations must be
 * renumbered on save, and preserves existing counter numbering when they must not.
 *
 * Exports shouldRenumberCountersForSave (classifies a save by source/action and
 * local-history diff), preserveExistingCountersOnPage (restores prior
 * displayNumber/seriesStart on counters not intentionally changed), and
 * summarizeCounterRenumberEffect. Used by the save pipeline to keep counter
 * series numbering stable across non-numbering edits.
 */
import { deepClone } from './deepClone.js';

function getCounterId(counter) {
  return counter?.data?.id
    || counter?.data?.annoId
    || counter?.id
    || counter?.annotationId
    || counter?.pdfAnnotationId
    || null;
}

function isCounter(annotation) {
  return annotation?.data?.type === 'counter';
}

function counterSeriesChanged(before, after) {
  if (!isCounter(before) || !isCounter(after)) return false;
  return before.data?.seriesId !== after.data?.seriesId
    || before.data?.seriesStart !== after.data?.seriesStart;
}

function withoutCounterNumbering(annotation) {
  if (!isCounter(annotation)) return annotation;
  const clone = deepClone(annotation);
  if (clone.data && typeof clone.data === 'object') {
    delete clone.data.displayNumber;
    delete clone.data.seriesStart;
  }
  return clone;
}

function counterHasNonNumberingChange(before, after) {
  if (!isCounter(before) || !isCounter(after)) return false;
  return JSON.stringify(withoutCounterNumbering(before)) !== JSON.stringify(withoutCounterNumbering(after));
}

function actionCreatesOrDeletesCounter(action) {
  if (!action || typeof action !== 'object') return false;
  if (action.type === 'fabric:create' || action.type === 'fabric:delete') {
    return isCounter(action.annotation);
  }
  if (action.type !== 'fabric:batch') return false;
  return (action.created || []).some((entry) => isCounter(entry?.annotation))
    || (action.deleted || []).some((entry) => isCounter(entry?.annotation));
}

function actionChangesCounterSeries(action) {
  if (!action || typeof action !== 'object') return false;
  if (action.type === 'fabric:update') {
    return counterSeriesChanged(action.before, action.after);
  }
  if (action.type !== 'fabric:batch') return false;
  return (action.updated || []).some((entry) => counterSeriesChanged(entry?.before, entry?.after));
}

function getActionChangeStats(action) {
  const stats = {
    touchesCounter: false,
    touchesNonCounter: false,
  };
  if (!action || typeof action !== 'object') return stats;

  const visit = (annotation) => {
    if (!annotation) return;
    if (isCounter(annotation)) stats.touchesCounter = true;
    else stats.touchesNonCounter = true;
  };

  if (action.type === 'fabric:create' || action.type === 'fabric:delete') {
    visit(action.annotation);
    return stats;
  }

  if (action.type === 'fabric:update') {
    visit(action.before);
    visit(action.after);
    return stats;
  }

  if (action.type === 'fabric:batch') {
    for (const entry of action.created || []) visit(entry?.annotation);
    for (const entry of action.deleted || []) visit(entry?.annotation);
    for (const entry of action.updated || []) {
      visit(entry?.before);
      visit(entry?.after);
    }
  }

  return stats;
}

function getIntentionalCounterChangeIds(action) {
  if (!action || typeof action !== 'object') return [];
  const ids = [];
  const addIfIntentional = (id, before, after) => {
    if (!id || !counterHasNonNumberingChange(before, after)) return;
    ids.push(id);
  };

  if (action.type === 'fabric:update') {
    addIfIntentional(action.annotationId, action.before, action.after);
  } else if (action.type === 'fabric:batch') {
    for (const entry of action.updated || []) {
      addIfIntentional(entry?.id, entry?.before, entry?.after);
    }
  }

  return [...new Set(ids)];
}

export function shouldRenumberCountersForSave({
  source,
  action,
  localHistoryAction,
} = {}) {
  const normalizedSource = typeof source === 'string' ? source : '';
  const normalizedAction = typeof action === 'string' ? action : '';
  const sourceOrActionIsCounterRelated = normalizedSource.includes('counter')
    || normalizedAction.includes('counter');
  const changeStats = getActionChangeStats(localHistoryAction);
  const intentionalCounterChangeIds = getIntentionalCounterChangeIds(localHistoryAction);

  if (actionCreatesOrDeletesCounter(localHistoryAction)) {
    return {
      shouldRenumber: true,
      shouldPreserveExistingCounters: false,
      intentionalCounterChangeIds: [],
      reason: 'counter-create-delete',
    };
  }

  if (actionChangesCounterSeries(localHistoryAction)) {
    return {
      shouldRenumber: true,
      shouldPreserveExistingCounters: false,
      intentionalCounterChangeIds: [],
      reason: 'counter-series-change',
    };
  }

  if (
    normalizedSource === 'counter:create'
    || normalizedSource === 'counter:delete'
    || normalizedAction === 'counter-create'
    || normalizedAction === 'counter-delete'
  ) {
    return {
      shouldRenumber: true,
      shouldPreserveExistingCounters: false,
      intentionalCounterChangeIds: [],
      reason: 'counter-source-create-delete',
    };
  }

  const shouldPreserveExistingCounters = !sourceOrActionIsCounterRelated
    && !(
      changeStats.touchesCounter
      && !changeStats.touchesNonCounter
    );

  return {
    shouldRenumber: false,
    shouldPreserveExistingCounters,
    intentionalCounterChangeIds,
    reason: normalizedSource || normalizedAction
      ? 'non-numbering-save'
      : 'unknown-save-without-counter-numbering-action',
  };
}

function preserveCounterNumberingFields(nextCounter, previousCounter) {
  if (!isCounter(nextCounter) || !isCounter(previousCounter)) return nextCounter;
  const nextData = nextCounter.data || {};
  const previousData = previousCounter.data || {};
  if (
    nextData.displayNumber === previousData.displayNumber
    && nextData.seriesStart === previousData.seriesStart
  ) {
    return nextCounter;
  }
  return {
    ...nextCounter,
    data: {
      ...nextData,
      displayNumber: previousData.displayNumber,
      seriesStart: previousData.seriesStart,
    },
  };
}

export function preserveExistingCountersOnPage(nextPage, previousPage, options = {}) {
  if (!nextPage || !Array.isArray(nextPage.objects) || !previousPage || !Array.isArray(previousPage.objects)) {
    return nextPage;
  }
  const intentionalCounterChangeIds = new Set(
    Array.isArray(options.intentionalCounterChangeIds)
      ? options.intentionalCounterChangeIds.filter(Boolean)
      : []
  );

  const previousCountersById = new Map();
  for (const obj of previousPage.objects) {
    if (!isCounter(obj)) continue;
    const id = getCounterId(obj);
    if (id) previousCountersById.set(id, obj);
  }
  if (previousCountersById.size === 0) return nextPage;

  let changed = false;
  const objects = nextPage.objects.map((obj) => {
    if (!isCounter(obj)) return obj;
    const id = getCounterId(obj);
    const previousCounter = id ? previousCountersById.get(id) : null;
    if (!previousCounter) return obj;
    if (JSON.stringify(previousCounter) === JSON.stringify(obj)) return obj;
    if (intentionalCounterChangeIds.has(id)) {
      const merged = preserveCounterNumberingFields(obj, previousCounter);
      if (merged !== obj) changed = true;
      return merged;
    }
    changed = true;
    return deepClone(previousCounter);
  });

  return changed ? { ...nextPage, objects } : nextPage;
}

export function summarizeCounterRenumberEffect(beforeByPage, afterByPage) {
  const beforeById = new Map();
  const afterById = new Map();

  for (const [pageKey, page] of Object.entries(beforeByPage || {})) {
    for (const obj of page?.objects || []) {
      if (!isCounter(obj)) continue;
      const id = getCounterId(obj);
      if (id) beforeById.set(id, { pageKey, serialized: JSON.stringify(obj) });
    }
  }

  for (const [pageKey, page] of Object.entries(afterByPage || {})) {
    for (const obj of page?.objects || []) {
      if (!isCounter(obj)) continue;
      const id = getCounterId(obj);
      if (id) afterById.set(id, { pageKey, serialized: JSON.stringify(obj) });
    }
  }

  const affectedCounterIds = [];
  for (const [id, after] of afterById.entries()) {
    const before = beforeById.get(id);
    if (!before || before.serialized !== after.serialized) {
      affectedCounterIds.push(id);
    }
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) affectedCounterIds.push(id);
  }

  return {
    affectedCounterIds,
    affectedCount: affectedCounterIds.length,
  };
}
