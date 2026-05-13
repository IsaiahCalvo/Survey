export function getHistoryOrder(entry) {
  const meta = entry?.__historyMeta || entry;
  if (!meta || typeof meta !== 'object') return -1;
  if (Number.isFinite(Number(meta.checkpointId))) return Number(meta.checkpointId);
  const parsed = Date.parse(meta.createdAt || meta.timestamp || '');
  return Number.isFinite(parsed) ? parsed : -1;
}

export function shouldUndoLocalBeforeLegacy(localAction, legacyMeta) {
  if (!localAction) return false;
  if (!legacyMeta) return true;
  return getHistoryOrder(localAction) >= getHistoryOrder(legacyMeta);
}

export function shouldRedoLocalBeforeLegacy(localAction, legacyMeta) {
  if (!localAction) return false;
  if (!legacyMeta) return true;
  return getHistoryOrder(localAction) <= getHistoryOrder(legacyMeta);
}
