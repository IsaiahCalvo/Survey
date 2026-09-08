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

import { isOwner, getAnnotationAuthorId, canDelete } from './permissionScope.js';
import { isManagedLocalEditingContext } from '../../utils/managedLocalEditingContext.js';

/**
 * @typedef {object} ByAuthorEntry
 * @property {string} name
 * @property {number} count
 *
 * @typedef {object} BulkDeletePlan
 * @property {'collaborator-all-mine'|'collaborator-cross-author'|'owner-cross-author'|'owner-own-only'|'no-op'} mode
 * @property {number} count
 * @property {string[]} ownIds
 * @property {string[]} foreignIds
 * @property {Record<string, ByAuthorEntry>} [byAuthor]
 */

/**
 * Resolve a display name for an annotation's author. UX comment: name
 * resolution is ROSTER-FIRST — the caller-supplied `resolveAuthorName`
 * (authorId → live display name, e.g. the document presence roster PDFViewer
 * threads in) wins because ids are stable while display names change, and
 * because callouts (and in practice most shapes) never persist a name field
 * at all — only the stable authorId. The annotation-carried fields are the
 * legacy fallback chain: `data.authorName` (stamped at create time by old
 * paths), then `data.lastEditorName`, then `meta.authorName` /
 * `meta.lastEditorName` for the Phase 29 CRDT-side fields. 'Unknown' is the
 * last-resort label so the modal layer never has to render `undefined` —
 * unattributed marks keep that label regardless of type.
 *
 * @param {object} annotation
 * @param {string|null} [authorId]
 * @param {((authorId: string) => string|null|undefined)|null} [resolveAuthorName]
 * @returns {string}
 */
function nameFromAnnotation(annotation, authorId = null, resolveAuthorName = null) {
  if (authorId != null && typeof resolveAuthorName === 'function') {
    let rosterName = null;
    try {
      rosterName = resolveAuthorName(authorId);
    } catch {
      rosterName = null; // resolver failures never break plan building
    }
    if (typeof rosterName === 'string' && rosterName.length > 0) return rosterName;
  }
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
 * @param {((authorId: string) => string|null|undefined)|null} [args.resolveAuthorName]
 *   Optional authorId → display-name lookup (roster layer). See
 *   nameFromAnnotation for the precedence contract. Omitting it preserves the
 *   legacy annotation-field-only resolution exactly.
 * @returns {BulkDeletePlan}
 */
export function buildBulkDeletePlan({
  candidateIds,
  annotations,
  viewerId,
  documentOwnerId,
  localDocumentContext,
  resolveAuthorName = null,
}) {
  const safeCandidates = Array.isArray(candidateIds) ? candidateIds : [];
  const safeAnnotations = Array.isArray(annotations) ? annotations : [];

  // Step 1: index for O(1) lookup. Fabric rows carry a top-level `id` once
  // synced; projected callout groups (R2.2 — calloutToAnnotationObject) carry
  // their id ONLY at `data.id`, so fall back to it. Top-level id wins when both
  // exist (they are the same row id for synced shapes).
  const byId = new Map();
  for (const a of safeAnnotations) {
    if (!a) continue;
    if (a.id != null) byId.set(a.id, a);
    else if (a.data?.id != null) byId.set(a.data.id, a);
  }

  // Step 2: defensive filter — anything that slipped past selection scope is
  // dropped here. Unknown ids (not in byId) are silently skipped. Track the
  // CANDIDATE id alongside the annotation: projected callout groups have no
  // top-level `a.id`, so partitioning below must not read `a.id` directly.
  const eligible = [];
  for (const id of safeCandidates) {
    const a = byId.get(id);
    if (!a) continue;
    if (canDelete({ annotation: a, viewerId, documentOwnerId, localDocumentContext })) {
      eligible.push({ id, annotation: a });
    }
  }

  // Step 3: empty selection → no-op.
  if (eligible.length === 0) {
    return { mode: 'no-op', count: 0, ownIds: [], foreignIds: [] };
  }
  if (isManagedLocalEditingContext(localDocumentContext)) {
    // This profile owns the local file, not the annotations' cloud authors.
    // Reuse the direct-delete mode without changing any author metadata.
    return { mode: 'owner-own-only', count: eligible.length,
      ownIds: eligible.map(entry => entry.id), foreignIds: [] };
  }

  // Step 4: partition by authorship.
  // 2026-05-04 — When the viewer is the document owner, treat unattributed
  // annotations (authorId === null) as the viewer's own. Pre-sharing
  // legacy annotations and PDF imports that predate the authorId field
  // arrive with no attribution; the owner of the doc is the only person
  // who could have created them locally on a non-shared file. Without
  // this, solo-doc owners get the cross-author confirmation modal on
  // every delete because the planner classifies unattributed marks as
  // "from another user."
  const viewerIsOwner = isOwner(viewerId, documentOwnerId);
  const ownIds = [];
  const foreignIds = [];
  for (const { id, annotation: a } of eligible) {
    const authorId = getAnnotationAuthorId(a);
    if (authorId === viewerId || (viewerIsOwner && authorId == null)) {
      ownIds.push(id);
    } else {
      foreignIds.push(id);
    }
  }

  const count = ownIds.length + foreignIds.length;

  // Step 5: collaborators can delete foreign marks only through the explicit
  // cross-author confirmation mode. Read-only viewers never reach this layer.
  if (!isOwner(viewerId, documentOwnerId)) {
    if (foreignIds.length > 0) {
      const byAuthor = {};
      for (const { annotation: a } of eligible) {
        const authorId = getAnnotationAuthorId(a);
        if (authorId == null || authorId === viewerId) continue;
        if (!byAuthor[authorId]) {
          byAuthor[authorId] = { name: nameFromAnnotation(a, authorId, resolveAuthorName), count: 0 };
        }
        byAuthor[authorId].count += 1;
      }
      return {
        mode: 'collaborator-cross-author',
        count,
        ownIds,
        foreignIds,
        byAuthor,
      };
    }
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
  for (const { annotation: a } of eligible) {
    const authorId = getAnnotationAuthorId(a);
    if (authorId === viewerId) continue; // owner's own marks excluded
    if (authorId == null) continue; // defensive: unattributed marks not grouped
    if (!byAuthor[authorId]) {
      byAuthor[authorId] = { name: nameFromAnnotation(a, authorId, resolveAuthorName), count: 0 };
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
