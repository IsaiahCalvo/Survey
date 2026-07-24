export const ERASE_TRANSITION_HISTORY_KIND = 'erase-transition';
export const ERASE_TRANSITION_HISTORY_LIMIT = 50;

const mutationIdFromMeta = (meta) => (
  meta?.context?.eraseHistoryTransition?.mutationId
  || meta?.context?.mutationId
  || null
);

export function createEraseTransitionHistorySentinel(mutationId) {
  const normalizedMutationId = String(mutationId || '').trim();
  if (!normalizedMutationId) {
    throw new TypeError('erase transition mutationId is required');
  }
  return Object.freeze({
    kind: ERASE_TRANSITION_HISTORY_KIND,
    mutationId: normalizedMutationId,
  });
}

export function isEraseTransitionHistorySentinel(value) {
  return Boolean(
    value
    && value.kind === ERASE_TRANSITION_HISTORY_KIND
    && typeof value.mutationId === 'string'
    && value.mutationId.length > 0,
  );
}

export function claimHistoryQuarantineEvent(
  handledKeys,
  event,
  limit = 100,
) {
  if (!(handledKeys instanceof Set)) {
    throw new TypeError('handledKeys must be a Set');
  }
  const key = String(event?.dedupeKey || '').trim();
  if (!key) return true;
  if (handledKeys.has(key)) return false;
  handledKeys.add(key);
  const normalizedLimit = Math.max(1, Number(limit) || 100);
  while (handledKeys.size > normalizedLimit) {
    const oldestKey = handledKeys.values().next().value;
    handledKeys.delete(oldestKey);
  }
  return true;
}

export function createEraseTransitionHistoryMeta({
  checkpointId,
  context,
  createdAt = new Date().toISOString(),
  reason = 'eraser:gesture',
} = {}) {
  const mutationId = String(
    context?.eraseHistoryTransition?.mutationId
    || context?.mutationId
    || '',
  ).trim();
  if (!mutationId) {
    throw new TypeError('erase transition mutationId is required');
  }
  const sentinel = createEraseTransitionHistorySentinel(mutationId);
  return {
    checkpointId,
    createdAt,
    reason,
    context: context || null,
    summary: {
      mode: ERASE_TRANSITION_HISTORY_KIND,
      mutationId,
      targetCount: Number(context?.targetCount) || 0,
    },
    delta: {
      changedPagesCount: Number.isFinite(Number(context?.pageNumber)) ? 1 : 0,
      changedPagesPreview: Number.isFinite(Number(context?.pageNumber))
        ? [String(context.pageNumber)]
        : [],
    },
    snapshotHash: `${ERASE_TRANSITION_HISTORY_KIND}:${mutationId}`,
    snapshotBytes: JSON.stringify(sentinel).length,
  };
}

export function appendLegacyHistoryCheckpoint({
  undoHistory = [],
  undoMeta = [],
  entry,
  meta,
  limit = ERASE_TRANSITION_HISTORY_LIMIT,
} = {}) {
  const normalizedLimit = Math.max(1, Number(limit) || ERASE_TRANSITION_HISTORY_LIMIT);
  return {
    undoHistory: [...undoHistory, entry].slice(-normalizedLimit),
    undoMeta: [...undoMeta, meta].slice(-normalizedLimit),
    redoHistory: [],
    redoMeta: [],
  };
}

export function moveLegacyHistoryCheckpoint({
  direction,
  undoHistory = [],
  undoMeta = [],
  redoHistory = [],
  redoMeta = [],
  limit = ERASE_TRANSITION_HISTORY_LIMIT,
} = {}) {
  const normalizedLimit = Math.max(1, Number(limit) || ERASE_TRANSITION_HISTORY_LIMIT);
  if (direction === 'undo') {
    if (undoHistory.length === 0 || undoMeta.length === 0) return null;
    const entry = undoHistory[undoHistory.length - 1];
    const meta = undoMeta[undoMeta.length - 1];
    return {
      entry,
      meta,
      undoHistory: undoHistory.slice(0, -1),
      undoMeta: undoMeta.slice(0, -1),
      redoHistory: [entry, ...redoHistory].slice(0, normalizedLimit),
      redoMeta: [meta, ...redoMeta].slice(0, normalizedLimit),
    };
  }
  if (direction === 'redo') {
    if (redoHistory.length === 0 || redoMeta.length === 0) return null;
    const entry = redoHistory[0];
    const meta = redoMeta[0];
    return {
      entry,
      meta,
      undoHistory: [...undoHistory, entry].slice(-normalizedLimit),
      undoMeta: [...undoMeta, meta].slice(-normalizedLimit),
      redoHistory: redoHistory.slice(1),
      redoMeta: redoMeta.slice(1),
    };
  }
  throw new TypeError('direction must be undo or redo');
}

export function moveEraseTransitionHistoryCheckpointByMutationId({
  mutationId,
  direction = 'undo',
  undoHistory = [],
  undoMeta = [],
  redoHistory = [],
  redoMeta = [],
  limit = ERASE_TRANSITION_HISTORY_LIMIT,
} = {}) {
  const normalizedMutationId = String(mutationId || '').trim();
  if (!normalizedMutationId) return null;
  const sourceHistory = direction === 'undo'
    ? undoHistory
    : direction === 'redo'
    ? redoHistory
    : null;
  const sourceMeta = direction === 'undo'
    ? undoMeta
    : direction === 'redo'
    ? redoMeta
    : null;
  if (!sourceHistory || !sourceMeta) {
    throw new TypeError('direction must be undo or redo');
  }
  const index = sourceHistory.findIndex((entry, entryIndex) => {
    const candidateMutationId = isEraseTransitionHistorySentinel(entry)
      ? entry.mutationId
      : mutationIdFromMeta(sourceMeta[entryIndex]);
    return candidateMutationId === normalizedMutationId;
  });
  if (index < 0 || index >= sourceMeta.length) return null;

  const normalizedLimit = Math.max(1, Number(limit) || ERASE_TRANSITION_HISTORY_LIMIT);
  const entry = sourceHistory[index];
  const meta = sourceMeta[index];
  if (direction === 'redo') {
    return {
      entry,
      meta,
      undoHistory: [...undoHistory, entry].slice(-normalizedLimit),
      undoMeta: [...undoMeta, meta].slice(-normalizedLimit),
      redoHistory: redoHistory.filter((_, entryIndex) => entryIndex !== index),
      redoMeta: redoMeta.filter((_, entryIndex) => entryIndex !== index),
    };
  }
  return {
    entry,
    meta,
    undoHistory: undoHistory.filter((_, entryIndex) => entryIndex !== index),
    undoMeta: undoMeta.filter((_, entryIndex) => entryIndex !== index),
    redoHistory: [entry, ...redoHistory].slice(0, normalizedLimit),
    redoMeta: [meta, ...redoMeta].slice(0, normalizedLimit),
  };
}

export function quarantineLegacyHistoryCheckpoint({
  direction,
  undoHistory = [],
  undoMeta = [],
  redoHistory = [],
  redoMeta = [],
} = {}) {
  if (direction === 'undo') {
    return {
      undoHistory: undoHistory.slice(0, -1),
      undoMeta: undoMeta.slice(0, -1),
      redoHistory,
      redoMeta,
    };
  }
  if (direction === 'redo') {
    return {
      undoHistory,
      undoMeta,
      redoHistory: redoHistory.slice(1),
      redoMeta: redoMeta.slice(1),
    };
  }
  throw new TypeError('direction must be undo or redo');
}

function filterHistoryPairs(history, meta, mutationIds) {
  const nextHistory = [];
  const nextMeta = [];
  const count = Math.max(history.length, meta.length);
  for (let index = 0; index < count; index += 1) {
    const entry = history[index];
    const entryMeta = meta[index];
    const mutationId = isEraseTransitionHistorySentinel(entry)
      ? entry.mutationId
      : mutationIdFromMeta(entryMeta);
    if (mutationId && mutationIds.has(String(mutationId))) continue;
    if (index < history.length) nextHistory.push(entry);
    if (index < meta.length) nextMeta.push(entryMeta);
  }
  return { history: nextHistory, meta: nextMeta };
}

export function removeEraseTransitionHistoryCheckpoints({
  mutationIds,
  undoHistory = [],
  undoMeta = [],
  redoHistory = [],
  redoMeta = [],
} = {}) {
  const normalizedMutationIds = new Set(
    [...(mutationIds || [])]
      .map((mutationId) => String(mutationId || '').trim())
      .filter(Boolean),
  );
  if (normalizedMutationIds.size === 0) {
    return { undoHistory, undoMeta, redoHistory, redoMeta, removedCount: 0 };
  }
  const nextUndo = filterHistoryPairs(undoHistory, undoMeta, normalizedMutationIds);
  const nextRedo = filterHistoryPairs(redoHistory, redoMeta, normalizedMutationIds);
  return {
    undoHistory: nextUndo.history,
    undoMeta: nextUndo.meta,
    redoHistory: nextRedo.history,
    redoMeta: nextRedo.meta,
    removedCount: (
      undoHistory.length - nextUndo.history.length
      + redoHistory.length - nextRedo.history.length
    ),
  };
}
