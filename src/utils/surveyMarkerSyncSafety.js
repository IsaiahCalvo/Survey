export function shouldRunSurveyMarkerSync({
  documentSyncEnabled = false,
  hasDocumentId = false,
  hasUserId = false,
  syncBlocked = false,
  currentCount = 0,
  priorCount = 0,
  hydrationReady = true,
} = {}) {
  if (!hasDocumentId || !hasUserId || !documentSyncEnabled || syncBlocked) {
    return { run: false, reason: 'sync-disabled' };
  }
  if (!hydrationReady && currentCount === 0 && priorCount > 0) {
    return { run: false, reason: 'hydrate-empty-delete-guard' };
  }
  if (currentCount === 0 && priorCount === 0) {
    return { run: false, reason: 'empty-unchanged' };
  }
  return { run: true, reason: 'changed-or-delete-after-hydrate' };
}
