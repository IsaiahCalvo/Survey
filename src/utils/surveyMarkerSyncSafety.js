/**
 * surveyMarkerSyncSafety.js — guard that decides whether a Survey Marker sync may run.
 *
 * Exports shouldRunSurveyMarkerSync({...}), a pure predicate returning {run, reason}.
 * Blocks sync when doc/user/sync prerequisites are missing, and adds a
 * hydrate-empty-delete-guard so an un-hydrated empty state never deletes prior markers.
 * Part of the separate survey-marker pipeline — see docs/ANNOTATION-CONTRACT.md.
 */
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
