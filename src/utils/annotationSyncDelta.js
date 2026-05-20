function getFabricAnnotationId(obj) {
  return obj?.annotationId
    || obj?.id
    || obj?.data?.id
    || obj?.data?.annoId
    || obj?.pdfAnnotationId
    || null;
}

function getCalloutId(callout) {
  return callout?.id || callout?.annotationId || null;
}

function fingerprint(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (_e) {
    return null;
  }
}

function countFabricObjects(byPage) {
  let count = 0;
  for (const page of Object.values(byPage || {})) {
    if (Array.isArray(page?.objects)) count += page.objects.length;
  }
  return count;
}

export function isExplicitFabricDeleteAction(fabricAction = null) {
  if (!fabricAction || typeof fabricAction !== 'object') return false;
  const deletedIds = Array.isArray(fabricAction.deletedIds)
    ? fabricAction.deletedIds.filter(Boolean)
    : [];
  if (deletedIds.length === 0) return false;
  const source = String(fabricAction.source || '').toLowerCase();
  const action = String(fabricAction.action || '').toLowerCase();
  return action.includes('delete') || source.includes('delete') || (source === 'object:modified' && action === 'delete');
}

export function resolveFabricDeletedIds({
  preciseFabricCommit = null,
  fabricAction = null,
  detectedDeletedIds = [],
} = {}) {
  if (Array.isArray(preciseFabricCommit?.deletedIds)) {
    return {
      deletedIds: [...new Set(preciseFabricCommit.deletedIds.filter(Boolean))],
      source: 'precise-fabric-commit',
      explicit: true,
    };
  }
  if (isExplicitFabricDeleteAction(fabricAction)) {
    return {
      deletedIds: [...new Set(fabricAction.deletedIds.filter(Boolean))],
      source: 'fabric-save-action',
      explicit: true,
    };
  }
  return {
    deletedIds: [...new Set((detectedDeletedIds || []).filter(Boolean))],
    source: 'diff',
    explicit: false,
  };
}

export function shouldSuppressStaleCacheShrink({
  deletedIds = [],
  priorObjectCount = 0,
  cutoverTs = null,
  hasYDoc = false,
  explicitDelete = false,
} = {}) {
  const deleteCount = Array.isArray(deletedIds) ? deletedIds.length : 0;
  const priorTotal = Number(priorObjectCount) || 0;
  const shrinkRatio = priorTotal > 0 ? deleteCount / priorTotal : 0;
  return (
    !explicitDelete
    && deleteCount > 50
    && Boolean(cutoverTs)
    && Boolean(hasYDoc)
    && shrinkRatio >= 0.5
  );
}

function byPageWithObjectsForIds(currentByPage, wantedIds) {
  const wanted = new Set((wantedIds || []).filter(Boolean));
  if (wanted.size === 0) return {};
  const out = {};
  for (const [pageKey, page] of Object.entries(currentByPage || {})) {
    if (!Array.isArray(page?.objects)) continue;
    for (const obj of page.objects) {
      const id = getFabricAnnotationId(obj);
      if (!id || !wanted.has(id)) continue;
      if (!out[pageKey]) out[pageKey] = { ...page, objects: [] };
      out[pageKey].objects.push(obj);
    }
  }
  return out;
}

export function buildFabricSyncDelta({
  currentByPage,
  priorByPage,
  changedIds = null,
  deletedIds = null,
  actionType = 'unknown',
} = {}) {
  const currentIds = new Set();
  const currentById = new Map();
  const currentFingerprintById = new Map();
  let currentIdlessCount = 0;

  for (const page of Object.values(currentByPage || {})) {
    if (!Array.isArray(page?.objects)) continue;
    for (const obj of page.objects) {
      const id = getFabricAnnotationId(obj);
      if (!id) {
        currentIdlessCount++;
        continue;
      }
      currentIds.add(id);
      currentById.set(id, obj);
      currentFingerprintById.set(id, fingerprint(obj));
    }
  }

  const priorFingerprintById = new Map();
  const detectedDeletedIds = [];
  for (const page of Object.values(priorByPage || {})) {
    if (!Array.isArray(page?.objects)) continue;
    for (const obj of page.objects) {
      const id = getFabricAnnotationId(obj);
      if (!id) continue;
      priorFingerprintById.set(id, fingerprint(obj));
      if (!currentIds.has(id)) detectedDeletedIds.push(id);
    }
  }

  const finalDeletedIds = Array.isArray(deletedIds)
    ? [...new Set(deletedIds.filter(Boolean))]
    : [...new Set(detectedDeletedIds)];

  let finalChangedIds;
  if (Array.isArray(changedIds)) {
    finalChangedIds = [...new Set(changedIds.filter((id) => id && currentById.has(id)))];
  } else {
    finalChangedIds = [];
    for (const [id, currentFingerprint] of currentFingerprintById.entries()) {
      if (priorFingerprintById.get(id) !== currentFingerprint) finalChangedIds.push(id);
    }
  }

  let fullFanOutReason = null;
  const currentCount = countFabricObjects(currentByPage);
  const priorCount = countFabricObjects(priorByPage);
  if (currentIdlessCount > 0 && currentCount !== priorCount) {
    fullFanOutReason = 'current-state-has-idless-objects';
  }

  const upsertByPage = fullFanOutReason
    ? (currentByPage || {})
    : byPageWithObjectsForIds(currentByPage, finalChangedIds);
  const changedCount = countFabricObjects(upsertByPage);

  return {
    actionType,
    upsertByPage,
    changedIds: finalChangedIds,
    deletedIds: finalDeletedIds,
    changedCount,
    deletedCount: finalDeletedIds.length,
    dispatchedCount: changedCount + finalDeletedIds.length,
    supabaseUpsertCount: changedCount,
    yDocUpdateCount: changedCount,
    fullFanOutReason,
  };
}

export function buildCalloutSyncDelta({
  currentCallouts,
  priorCallouts,
  changedIds = null,
  deletedIds = null,
  actionType = 'unknown',
} = {}) {
  const currentById = new Map();
  const currentFingerprintById = new Map();
  let idlessCount = 0;
  for (const callout of currentCallouts || []) {
    const id = getCalloutId(callout);
    if (!id) {
      idlessCount++;
      continue;
    }
    currentById.set(id, callout);
    currentFingerprintById.set(id, fingerprint(callout));
  }

  const priorFingerprintById = new Map();
  const detectedDeletedIds = [];
  for (const callout of priorCallouts || []) {
    const id = getCalloutId(callout);
    if (!id) continue;
    priorFingerprintById.set(id, fingerprint(callout));
    if (!currentById.has(id)) detectedDeletedIds.push(id);
  }

  const finalDeletedIds = Array.isArray(deletedIds)
    ? [...new Set(deletedIds.filter(Boolean))]
    : [...new Set(detectedDeletedIds)];

  let finalChangedIds;
  if (Array.isArray(changedIds)) {
    finalChangedIds = [...new Set(changedIds.filter((id) => id && currentById.has(id)))];
  } else {
    finalChangedIds = [];
    for (const [id, currentFingerprint] of currentFingerprintById.entries()) {
      if (priorFingerprintById.get(id) !== currentFingerprint) finalChangedIds.push(id);
    }
  }

  const fullFanOutReason = idlessCount > 0 ? 'current-callouts-have-idless-objects' : null;
  const upsertCallouts = fullFanOutReason
    ? [...(currentCallouts || [])]
    : finalChangedIds.map((id) => currentById.get(id)).filter(Boolean);

  return {
    actionType,
    upsertCallouts,
    changedIds: finalChangedIds,
    deletedIds: finalDeletedIds,
    changedCount: upsertCallouts.length,
    deletedCount: finalDeletedIds.length,
    dispatchedCount: upsertCallouts.length + finalDeletedIds.length,
    supabaseUpsertCount: upsertCallouts.length,
    yDocUpdateCount: upsertCallouts.length,
    fullFanOutReason,
  };
}
