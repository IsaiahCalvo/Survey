// src/lib/collab/bulkDeletePlan.js
// Bulk-delete planner.
//
// RULED 2026-09-28 owner: open editing + lock. Anyone who can edit deletes
// ANY mark — their own or someone else's — with NO pop-up and NO "Deleted –
// Undo" toast; safety is Undo, History (restore anything deleted) and the
// user lock. The Phase 35 / 2026-07-17 confirm modes
// ('collaborator-all-mine', 'collaborator-cross-author',
// 'owner-cross-author', 'owner-own-only') are gone. The planner now emits:
//
//   'direct' → delete the eligible ids now (no modal, no toast)
//   'no-op'  → nothing eligible (empty selection, unknown ids, or every
//              candidate is user-locked)
//
// It still partitions ownIds / foreignIds and builds the byAuthor breakdown:
// callers log them and the History rows / diagnostics read them, but they
// never decide whether a confirmation appears.
//
// Single source of truth for eligibility: permissionScope.canDelete (open
// editing, user-locked marks refused).

// @ts-check

import { isOwner, getAnnotationAuthorId, canDelete } from './permissionScope.js';

/**
 * @typedef {object} ByAuthorEntry
 * @property {string} name
 * @property {number} count
 *
 * @typedef {object} BulkDeletePlan
 * @property {'direct'|'no-op'} mode
 * @property {number} count
 * @property {string[]} ownIds
 * @property {string[]} foreignIds
 * @property {string[]} lockedIds   candidates refused because they are user-locked
 * @property {Record<string, ByAuthorEntry>} [byAuthor]
 */

/**
 * Resolve a display name for an annotation's author. Roster-first: the
 * caller-supplied `resolveAuthorName` (authorId → live display name) wins
 * because ids are stable while display names change; then the legacy
 * annotation-carried name fields; 'Unknown' last.
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
 *   1. Index annotations by id (top-level id, else data.id for projected
 *      callout groups).
 *   2. Keep the candidates the viewer may delete (canDelete: open editing,
 *      user-locked marks refused). Unknown ids are skipped.
 *   3. Nothing left → 'no-op'; otherwise 'direct'.
 *
 * Pure function — never mutates inputs.
 *
 * @param {object} args
 * @param {string[]} args.candidateIds
 * @param {object[]} args.annotations
 * @param {string} args.viewerId
 * @param {string} args.documentOwnerId
 * @param {((authorId: string) => string|null|undefined)|null} [args.resolveAuthorName]
 * @returns {BulkDeletePlan}
 */
export function buildBulkDeletePlan({
  candidateIds,
  annotations,
  viewerId,
  documentOwnerId,
  resolveAuthorName = null,
}) {
  const safeCandidates = Array.isArray(candidateIds) ? candidateIds : [];
  const safeAnnotations = Array.isArray(annotations) ? annotations : [];

  const byId = new Map();
  for (const a of safeAnnotations) {
    if (!a) continue;
    if (a.id != null) byId.set(a.id, a);
    else if (a.data?.id != null) byId.set(a.data.id, a);
  }

  const eligible = [];
  const lockedIds = [];
  for (const id of safeCandidates) {
    const a = byId.get(id);
    if (!a) continue;
    if (canDelete({ annotation: a, viewerId, documentOwnerId })) {
      eligible.push({ id, annotation: a });
    } else {
      lockedIds.push(id);
    }
  }

  if (eligible.length === 0) {
    return { mode: 'no-op', count: 0, ownIds: [], foreignIds: [], lockedIds };
  }

  // Informational partition. Unattributed marks count as the document
  // owner's own (pre-sharing legacy marks and imports).
  const viewerIsOwner = isOwner(viewerId, documentOwnerId);
  const ownIds = [];
  const foreignIds = [];
  /** @type {Record<string, ByAuthorEntry>} */
  const byAuthor = {};
  for (const { id, annotation: a } of eligible) {
    const authorId = getAnnotationAuthorId(a);
    if (authorId === viewerId || (viewerIsOwner && authorId == null)) {
      ownIds.push(id);
      continue;
    }
    foreignIds.push(id);
    if (authorId == null) continue;
    if (!byAuthor[authorId]) {
      byAuthor[authorId] = { name: nameFromAnnotation(a, authorId, resolveAuthorName), count: 0 };
    }
    byAuthor[authorId].count += 1;
  }

  return {
    mode: 'direct',
    count: ownIds.length + foreignIds.length,
    ownIds,
    foreignIds,
    lockedIds,
    byAuthor,
  };
}
