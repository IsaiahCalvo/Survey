// src/services/highlightSyncDiff.js
//
// Pure diff helper extracted from documentAnnotationService.js so unit tests
// can import it under `node --test` without triggering the supabaseClient
// module load (which uses Vite-only path resolution).
//
// Bug 2 fix (2026-04-30): the legacy highlight sync push path historically
// only upserted, never deleted. When a user erased part of a highlight on
// Mac, the local copy disappeared but the cloud row stayed put — Windows
// kept rendering the stale highlight because no DELETE event ever fired.
// This helper computes the deleted-IDs set so the push path can call
// deleteAnnotations() before the upsert.

/**
 * Returns the highlight IDs that exist in `priorAnnotations` but are missing
 * from `currentAnnotations`. Used by the legacy highlight sync push path to
 * detect erases / removals so DELETE events propagate to peers.
 *
 * Returns an empty array when no prior state is provided (first sync) or when
 * nothing has been removed.
 *
 * @param {object|null|undefined} priorAnnotations  Last-synced highlightAnnotations dict
 * @param {object|null|undefined} currentAnnotations  Current highlightAnnotations dict
 * @returns {string[]}  Highlight IDs that were removed since the prior sync
 */
export function diffDeletedHighlightIds(priorAnnotations, currentAnnotations) {
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
