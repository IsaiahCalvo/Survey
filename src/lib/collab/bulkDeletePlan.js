// src/lib/collab/bulkDeletePlan.js
// Phase 35 Plan 02 — Bulk-delete planner. Emits one of four modes the modal
// layer (Plan 35-04) branches on:
//
//   'collaborator-all-mine'  → simple-count modal: "Delete all N of your annotations?"
//   'owner-cross-author'     → per-author breakdown modal: "Delete N? K yours, M from P people"
//   'owner-own-only'         → NO modal — falls through to single-delete path (owner deleting
//                                only own marks is no different from a non-owner doing same)
//   'no-op'                  → eligible candidate set is empty (nothing to delete)
//
// Modal copy contract is locked in 35-CONTEXT.md "Confirmation modal — collaborator's
// 'delete all of mine'" + "Confirmation modal — owner's 'delete everyone's'" sections.
// This module is the categorizer — the modal layer reads `mode`/`count`/`byAuthor` to
// pick the right copy variant.
//
// Single source of truth for ownership: imports from permissionScope. No per-call-site
// fallback drift — one resolution chain everywhere.

// @ts-check

import { isOwner, getAnnotationAuthorId, canModify } from './permissionScope.js';

/**
 * @typedef {object} ByAuthorEntry
 * @property {string} name
 * @property {number} count
 *
 * @typedef {object} BulkDeletePlan
 * @property {'collaborator-all-mine'|'owner-cross-author'|'owner-own-only'|'no-op'} mode
 * @property {number} count
 * @property {string[]} ownIds
 * @property {string[]} foreignIds
 * @property {Record<string, ByAuthorEntry>} [byAuthor]
 */

/**
 * Resolve a display name for an annotation's author. UX comment: name resolution
 * chain prefers `data.authorName` (the field the annotation was tagged with at
 * create time), then falls back to `data.lastEditorName` (in case a downstream
 * edit re-stamped the editor identity), then to `meta.authorName` /
 * `meta.lastEditorName` for the Phase 29 CRDT-side fields. 'Unknown' is the
 * last-resort label so the modal layer never has to render `undefined`.
 *
 * @param {object} annotation
 * @returns {string}
 */
function nameFromAnnotation(annotation) {
  if (annotation == null) return 'Unknown';
  return (
    annotation?.data?.authorName ??
    annotation?.data?.lastEditorName ??
    annotation?.meta?.authorName ??
    annotation?.meta?.lastEditorName ??
    'Unknown'
  );
}

/**
 * Build the bulk-delete plan for a given selection.
 *
 * Implementation order (matches Plan 35-02 spec):
 *   1. Index annotations by id (single pass).
 *   2. Defensive filter: drop candidate ids the viewer cannot modify (selection
 *      scope should already have filtered these upstream — this is the belt
 *      that catches anything that slipped through, e.g. a stale SVG selection
 *      layer leaking foreign ids).
 *   3. Empty after filter → 'no-op'.
 *   4. Partition into ownIds / foreignIds.
 *   5. Non-owner viewer → 'collaborator-all-mine' (canModify already enforced
 *      ownIds-only above, so foreignIds is structurally empty).
 *   6. Owner with no foreign marks → 'owner-own-only' (no modal; modal layer
 *      falls through to single-delete path).
 *   7. Owner with foreign marks → 'owner-cross-author' with byAuthor breakdown.
 *
 * Pure function — never mutates inputs (no .sort, no .splice on candidateIds /
 * annotations).
 *
 * @param {object} args
 * @param {string[]} args.candidateIds
 * @param {object[]} args.annotations
 * @param {string} args.viewerId
 * @param {string} args.documentOwnerId
 * @returns {BulkDeletePlan}
 */
export function buildBulkDeletePlan({
  candidateIds,
  annotations,
  viewerId,
  documentOwnerId,
}) {
  const safeCandidates = Array.isArray(candidateIds) ? candidateIds : [];
  const safeAnnotations = Array.isArray(annotations) ? annotations : [];

  // Step 1: index for O(1) lookup.
  const byId = new Map();
  for (const a of safeAnnotations) {
    if (a && a.id != null) byId.set(a.id, a);
  }

  // Step 2: defensive filter — anything that slipped past selection scope is
  // dropped here. Unknown ids (not in byId) are silently skipped.
  const eligible = [];
  for (const id of safeCandidates) {
    const a = byId.get(id);
    if (!a) continue;
    if (canModify({ annotation: a, viewerId, documentOwnerId })) {
      eligible.push(a);
    }
  }

  // Step 3: empty selection → no-op.
  if (eligible.length === 0) {
    return { mode: 'no-op', count: 0, ownIds: [], foreignIds: [] };
  }

  // Step 4: partition by authorship.
  const ownIds = [];
  const foreignIds = [];
  for (const a of eligible) {
    const authorId = getAnnotationAuthorId(a);
    if (authorId === viewerId) {
      ownIds.push(a.id);
    } else {
      foreignIds.push(a.id);
    }
  }

  const count = ownIds.length + foreignIds.length;

  // Step 5: collaborator role — canModify already guaranteed foreignIds is empty.
  if (!isOwner(viewerId, documentOwnerId)) {
    return {
      mode: 'collaborator-all-mine',
      count,
      ownIds,
      foreignIds: [],
    };
  }

  // Step 6: owner with only own marks — fall through to single-delete path
  // (no modal — owner deleting their own marks needs no extra confirmation).
  if (foreignIds.length === 0) {
    return {
      mode: 'owner-own-only',
      count,
      ownIds,
      foreignIds: [],
    };
  }

  // Step 7: owner with cross-author selection — build byAuthor breakdown.
  // The breakdown is "from other people" — owner's own marks are counted in
  // ownIds and do NOT appear as a byAuthor entry (matches modal copy: "12
  // yours, 35 from 3 other people").
  /** @type {Record<string, ByAuthorEntry>} */
  const byAuthor = {};
  for (const a of eligible) {
    const authorId = getAnnotationAuthorId(a);
    if (authorId === viewerId) continue; // owner's own marks excluded
    if (authorId == null) continue; // defensive: unattributed marks not grouped
    if (!byAuthor[authorId]) {
      byAuthor[authorId] = { name: nameFromAnnotation(a), count: 0 };
    }
    byAuthor[authorId].count += 1;
  }

  return {
    mode: 'owner-cross-author',
    count,
    ownIds,
    foreignIds,
    byAuthor,
  };
}
