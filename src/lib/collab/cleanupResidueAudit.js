// src/lib/collab/cleanupResidueAudit.js
// Phase 35 Plan 02 — Cross-session brake-residue audit.
//
// Goal: detect annotations the 2026-04-27 wipe brake suppressed in earlier
// sessions — rows that survived in the cloud despite a legitimate local
// delete. The owner sees a one-shot "Clean up" banner; collaborators never
// see it (they have no authority over residue from other users, and their
// own residue is the document owner's call to clean up since the cloud row
// already lives under the owner's document).
//
// Heuristic (locked by Plan 35-01 tests/phase35/cleanupResidueAudit.test.mjs):
//   For each cloud annotation:
//     - authored by the viewer (getAnnotationAuthorId === viewerId), AND
//     - lastEditedAt strictly OLDER than the most recent local
//       user-deleted-set entry's deletedAt timestamp,
//   it is suspected residue. The strict-less-than cutoff means a cloud row
//   edited at the same instant as the most recent delete attempt is NOT
//   counted (boundary case in test #4: lastEditedAt === 5000 with most-recent
//   deletedAt also 5000 → not residue, treated as "edited at-or-after the
//   delete attempt, so legitimate").
//
//   The semantic this captures: anything authored by viewer that hasn't been
//   touched since their last local-delete attempt is brake-suppressed
//   leftover. Anything authored by the viewer and edited AFTER their most
//   recent delete attempt is legitimate work — they edited it after the
//   delete, so they clearly intend to keep it.
//
// UX note: this helper is intentionally browser-agnostic. The
// `userDeletedFabricIds` payload that informs `localUserDeletedSet` is read
// from local storage by the caller (Plan 35-05's banner mount), NOT by this
// module — so this stays Node `--test`-friendly and we can grow the test
// surface without stubbing browser-global storage APIs.
//
// Sticky-per-document dismissal: the caller passes a Set of documentIds the
// owner has previously dismissed the banner on. This module just checks
// membership; persistence is the caller's job.

// @ts-check

import { getAnnotationAuthorId } from './permissionScope.js';

/**
 * @typedef {object} LocalDeletedEntry
 * @property {string} id
 * @property {number} deletedAt   // epoch milliseconds
 */

/**
 * @param {object} args
 * @param {Array<object>} args.cloudAnnotations
 * @param {string} args.viewerId
 * @param {boolean} args.isViewerOwner               // pre-computed by caller via permissionScope.isOwner
 * @param {Set<string>} args.dismissedDocIds         // sticky banner-dismiss persistence
 * @param {string} [args.documentId]                 // for sticky-dismissal lookup
 * @param {Array<LocalDeletedEntry>} [args.localUserDeletedSet]
 * @returns {{ residueIds: string[], count: number }}
 */
export function auditResidue({
  cloudAnnotations,
  viewerId,
  isViewerOwner,
  dismissedDocIds,
  documentId,
  localUserDeletedSet,
}) {
  // Defensive guards — any required input missing → empty audit.
  if (!Array.isArray(cloudAnnotations)) {
    return { residueIds: [], count: 0 };
  }
  if (typeof viewerId !== 'string' || viewerId.length === 0) {
    return { residueIds: [], count: 0 };
  }

  // Collaborators never see the banner (CONTEXT.md decision).
  if (!isViewerOwner) {
    return { residueIds: [], count: 0 };
  }

  // Sticky dismissal — owner has dismissed for this document, never resurface.
  if (
    dismissedDocIds &&
    typeof dismissedDocIds.has === 'function' &&
    typeof documentId === 'string' &&
    dismissedDocIds.has(documentId)
  ) {
    return { residueIds: [], count: 0 };
  }

  // No local-delete history → nothing to audit (the brake never had a chance
  // to suppress anything for this user on this document).
  if (!Array.isArray(localUserDeletedSet) || localUserDeletedSet.length === 0) {
    return { residueIds: [], count: 0 };
  }

  // Find the most-recent local-delete timestamp. Anything authored by viewer
  // with lastEditedAt strictly LESS THAN this cutoff is residue.
  let cutoff = -Infinity;
  for (const entry of localUserDeletedSet) {
    if (entry && typeof entry.deletedAt === 'number' && entry.deletedAt > cutoff) {
      cutoff = entry.deletedAt;
    }
  }
  if (cutoff === -Infinity) {
    // No usable timestamps in the local set → cannot determine residue.
    return { residueIds: [], count: 0 };
  }

  // Walk the cloud snapshot and collect residue ids.
  /** @type {string[]} */
  const residueIds = [];
  for (const a of cloudAnnotations) {
    if (a == null || typeof a.id !== 'string') continue;
    const authorId = getAnnotationAuthorId(a);
    if (authorId !== viewerId) continue;
    const lastEditedAt = typeof a.lastEditedAt === 'number' ? a.lastEditedAt : null;
    if (lastEditedAt == null) continue;
    // Strict less-than: boundary case (===) is treated as "edited at-or-after
    // the delete attempt", so NOT residue (matches test #4).
    if (lastEditedAt < cutoff) {
      residueIds.push(a.id);
    }
  }

  return { residueIds, count: residueIds.length };
}
