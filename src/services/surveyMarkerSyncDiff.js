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
import { wasReceivedByExcel } from './excelExportAck.js';

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

/**
 * A survey marker is "placed" once it has a page number AND non-empty bounds —
 * i.e. the user has physically located it on the PDF. Excel is attribute-only
 * (answers/name/note/entity) and must NEVER destroy a placed marker, so the
 * import deletion-detection path uses this to exclude placed markers.
 *
 * @param {object|null|undefined} ann  A survey marker record
 * @returns {boolean}  true when the marker has been placed on a page
 */
export function isPlacedSurveyMarker(ann) {
  if (!ann || typeof ann !== 'object') return false;
  // Owner ruling 2026-09-28: a survey item picked up by Cut (its box is on
  // the clipboard, waiting for Paste) keeps the placed-marker protection, and
  // a user-locked item is never deleted by anyone — an import included.
  if (ann.unplacedByCut === true) return true;
  if (typeof ann.lockedBy === 'string' && ann.lockedBy) return true;
  if (ann.pageNumber == null) return false;
  const b = ann.bounds;
  return b != null && typeof b === 'object' && Object.keys(b).length > 0;
}

/**
 * Stage 0 import guard. Given the current survey markers and the set of item
 * names present in Excel per scope, returns the markers an import would remove
 * (present in the app, absent from Excel's scope) — EXCLUDING:
 *   - any placed marker (Excel can never destroy a placed marker or touch geometry);
 *   - any marker the app made but never successfully exported to Excel
 *     (no `exportedAt`) — Excel can only delete what it actually received
 *     (PLAN.md Amendment #1), so app work Excel never got is never erased by a
 *     missing row;
 *   - any id in `protectedIds`.
 * This only ever NARROWS the deletion set versus a naive name-absence diff.
 *
 * @param {object} surveyMarkers  keyed map of survey markers
 * @param {Record<string, Set<string>>} excelItemsByScope  `${moduleId}-${categoryId}` -> Set of item names in Excel
 * @param {{ protectedIds?: Iterable<string> }} [opts]
 * @returns {Array<{ key: string, ann: object }>}  markers safe to delete via import
 */
export function computeImportDeletionCandidates(surveyMarkers, excelItemsByScope, opts = {}) {
  const out = [];
  if (!surveyMarkers || typeof surveyMarkers !== 'object') return out;
  if (!excelItemsByScope || typeof excelItemsByScope !== 'object') return out;
  const protectedSet =
    opts.protectedIds instanceof Set ? opts.protectedIds : new Set(opts.protectedIds || []);
  for (const [key, ann] of Object.entries(surveyMarkers)) {
    const annModuleId = ann.moduleId || ann.spaceId;
    const scopeKey = `${annModuleId}-${ann.categoryId}`;
    if (!excelItemsByScope[scopeKey]) continue;
    const itemName = ann.name?.toString().trim();
    if (!itemName || excelItemsByScope[scopeKey].has(itemName)) continue;
    if (isPlacedSurveyMarker(ann)) continue; // Stage 0: never destroy a placed marker via import
    if (!wasReceivedByExcel(ann)) continue; // Amendment #1: never erase app work Excel never received
    if (protectedSet.has(key)) continue;
    out.push({ key, ann });
  }
  return out;
}
