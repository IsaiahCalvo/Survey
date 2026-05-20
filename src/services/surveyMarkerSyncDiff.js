// src/services/surveyMarkerSyncDiff.js
//
// Pure diff helper extracted from documentAnnotationService.js so unit tests
// can import it under `node --test` without triggering the supabaseClient
// module load (which uses Vite-only path resolution).
//
// Bug 2 fix (2026-04-30): the legacy survey marker sync push path historically
// only upserted, never deleted. When a user erased part of a survey marker on
// Mac, the local copy disappeared but the cloud row stayed put — Windows
// kept rendering the stale survey marker because no DELETE event ever fired.
// This helper computes the deleted-IDs set so the push path can call
// deleteAnnotations() before the upsert.

/**
 * Returns the survey marker IDs that exist in `priorAnnotations` but are missing
 * from `currentAnnotations`. Used by the legacy survey marker sync push path to
 * detect erases / removals so DELETE events propagate to peers.
 *
 * Returns an empty array when no prior state is provided (first sync) or when
 * nothing has been removed.
 *
 * @param {object|null|undefined} priorAnnotations  Last-synced surveyMarkers dict
 * @param {object|null|undefined} currentAnnotations  Current surveyMarkers dict
 * @returns {string[]}  Survey marker IDs that were removed since the prior sync
 */
export function diffDeletedSurveyMarkerIds(priorAnnotations, currentAnnotations) {
  if (!priorAnnotations || typeof priorAnnotations !== 'object') return [];
  const priorIds = Object.keys(priorAnnotations);
  if (priorIds.length === 0) return [];
  const currentIds = new Set(
    currentAnnotations && typeof currentAnnotations === 'object'
      ? Object.keys(currentAnnotations)
      : [],
  );
  return priorIds.filter((id) => !currentIds.has(id));
}
