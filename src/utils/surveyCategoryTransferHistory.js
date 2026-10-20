import { templateFingerprint } from './surveyTemplateBinding.js';

export function surveyCategoryTransferCheckpoint(id, checkpointId, now = new Date()) {
  return {
    state: { surveyCategoryTransferStep: id },
    meta: { checkpointId, createdAt: now.toISOString(), reason: 'survey-marker:category-move', context: { surveyCategoryTransferId: id }, summary: { mode: 'survey-category-transfer' }, delta: null, snapshotHash: `survey-category:${id}`, snapshotBytes: 0 },
  };
}
export function surveyCategoryTransferStepId(meta) { return meta?.reason === 'survey-marker:category-move' ? meta.context?.surveyCategoryTransferId || null : null; }

// Undo changes only the fields this transfer changed. Answers, notes, media,
// geometry and another category's markers remain current. A concurrent scope
// edit conflicts; a newer global definition is kept as the global definition.
export function planSurveyCategoryTransferRestore({ transfer, direction, markers, items, latestTemplate }) {
  if (!transfer || !['undo', 'redo'].includes(direction)) return { ok: false, reason: 'missing-transfer' };
  const from = direction === 'undo' ? transfer.after : transfer.before;
  const to = direction === 'undo' ? transfer.before : transfer.after;
  const nextMarkers = { ...(markers || {}) };
  for (const id of transfer.markerIds) {
    const marker = nextMarkers[id];
    if (!marker) continue; // A later remote deletion remains deleted.
    if (marker.moduleId !== from.moduleId) return { ok: false, reason: 'marker-scope-changed' };
    nextMarkers[id] = { ...marker, moduleId: to.moduleId, ...(marker.spaceId === from.moduleId ? { spaceId: to.moduleId } : {}) };
  }
  const nextItems = { ...(items || {}) };
  for (const scope of transfer.itemScopes || []) {
    const item = nextItems[scope.id];
    if (!item) continue;
    if (scope.sourceKey && scope.destinationKey) {
      const fromKey = direction === 'undo' ? scope.destinationKey : scope.sourceKey;
      const toKey = direction === 'undo' ? scope.sourceKey : scope.destinationKey;
      if (direction === 'redo' && Object.hasOwn(item, scope.destinationKey)) return { ok: false, reason: 'item-scope-changed' };
      const restored = { ...item };
      if (item[fromKey]) restored[toKey] = { ...(item[toKey] || {}), ...item[fromKey] };
      if (direction === 'undo' && !Object.hasOwn(scope.before, scope.destinationKey)) delete restored[scope.destinationKey];
      nextItems[scope.id] = restored;
      continue;
    }
    const expected = direction === 'undo' ? scope.after : scope.before;
    const target = direction === 'undo' ? scope.before : scope.after;
    for (const key of scope.keys) if (JSON.stringify(item[key]) !== JSON.stringify(expected[key])) return { ok: false, reason: 'item-scope-changed' };
    const restored = { ...item };
    for (const key of scope.keys) {
      if (Object.hasOwn(target, key)) restored[key] = target[key];
      else delete restored[key];
    }
    nextItems[scope.id] = restored;
  }
  return {
    ok: true, template: to.template, moduleId: to.moduleId, categoryId: to.categoryId,
    markers: nextMarkers, items: nextItems,
    writeGlobalTemplate: Boolean(latestTemplate && templateFingerprint(latestTemplate) === templateFingerprint(from.template)),
  };
}
