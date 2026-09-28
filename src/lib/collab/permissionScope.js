// src/lib/collab/permissionScope.js
// Phase 35 Plan 02 — Pure-JS permission helpers for the per-user delete authority model.
//
// RULED 2026-09-28 owner: open editing + lock (supersedes the Phase 35
// author-only rule and the 2026-07-17 cross-author confirm):
//   - anyone who can edit may move / resize / restyle / cut / delete / erase
//     ANY mark (other people's and Survey Markers included) with no pop-up
//     and no block — safety is Undo, History (restore anything deleted) and
//     the lock;
//   - a user-locked mark (`lockedBy`) refuses all of that for everyone; its
//     author or the document owner unlocks it first (canToggleLock);
//   - locked marks stay selectable and visible (canSelect).
//
// Resolution chain rationale (Phase 29 bridge):
//   The Phase 29 CRDT bridge (src/lib/collab/crdtAnnotationBridge.js lines 222-245) writes
//   meta.authorId on CREATE as the canonical write-once tombstone-attribution field. Some
//   pre-Phase-29 fixtures and the test scaffolds put authorId at the top level OR inside
//   data — we resolve through the canonical chain so every downstream surface
//   (selection scope, eraser, marquee, bulk-delete planner) reads ownership from one
//   source of truth, with no per-call-site fallback drift:
//
//     annotation.meta.authorId   // Phase 29 CRDT-side, preferred
//       ?? annotation.authorId    // top-level (test fixtures + some legacy paths)
//       ?? annotation.data.authorId // pre-Phase-29 fabric data field
//       ?? annotation.data.userId   // pre-v2.4 fallback (some imports)
//       ?? null
//
// Pure-JS module — zero React, zero DOM, zero browser globals. Node `--test`-friendly,
// matching the Phase 14 buildCalloutRenderSpec / Phase 15 lineDragMath precedent.

// @ts-check

/**
 * @param {string|null|undefined} userId
 * @param {string|null|undefined} documentOwnerId
 * @returns {boolean}
 */
export function isOwner(userId, documentOwnerId) {
  return (
    typeof userId === 'string' &&
    typeof documentOwnerId === 'string' &&
    userId.length > 0 &&
    userId === documentOwnerId
  );
}

/**
 * Resolve cloud ownership without manufacturing authority from the viewer.
 * Only an explicit local-only file (no document id) may treat its opener as
 * owner; a registered cloud document with missing owner metadata stays
 * unresolved so destructive paths fail closed.
 */
export function resolveDocumentOwnerId({
  documentId,
  documentOwnerId,
  viewerId,
}) {
  if (typeof documentOwnerId === 'string' && documentOwnerId.length > 0) {
    return documentOwnerId;
  }
  const isLocalOnly = documentId == null || String(documentId).trim().length === 0;
  return isLocalOnly && typeof viewerId === 'string' && viewerId.length > 0
    ? viewerId
    : null;
}

/**
 * Resolve annotation authorId via the canonical Phase 29 chain.
 * meta.authorId (CRDT-side, preferred)
 *   > top-level authorId (test fixtures + legacy)
 *   > data.authorId (legacy fabric field)
 *   > data.userId (pre-v2.4 fallback)
 *
 * @param {object|null|undefined} annotation
 * @returns {string|null}
 */
export function getAnnotationAuthorId(annotation) {
  if (annotation == null) return null;
  return (
    annotation?.meta?.authorId ??
    annotation?.authorId ??
    annotation?.data?.authorId ??
    annotation?.data?.userId ??
    null
  );
}

/**
 * RULED 2026-09-28 owner: open editing + lock.
 *
 * The user lock. A mark is user-locked when it carries `lockedBy` (the id of
 * the person who locked it). Where the stamp lives per type:
 *   - ordinary marks (shapes, ink, text, counters, stamps): `data.lockedBy`
 *   - callouts: `lockedBy` on the callout record, mirrored onto the projected
 *     group as `data.lockedBy` (and inside `data.legacyCallout`)
 *   - Survey Markers: `lockedBy` on the marker record (mirrored into the
 *     Supabase row's annotation_data.lockedBy)
 * This is NOT the older `locked === true` / lockMovementX flags: those mark
 * system-fixed objects (imports, text markup) and also keep a mark out of
 * area selection. A user-locked mark stays selectable and visible.
 *
 * @param {object|null|undefined} mark
 * @returns {string|null}
 */
export function getMarkLockedBy(mark) {
  if (mark == null) return null;
  // (A Survey Marker's lock is its top-level `lockedBy` only — a copy inside
  // a row projection's annotationData is never read, so Unlock always wins.)
  const candidates = [
    mark?.data?.lockedBy,
    mark?.lockedBy,
    mark?.data?.legacyCallout?.lockedBy,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * @param {object|null|undefined} mark
 * @returns {boolean}
 */
export function isUserLocked(mark) {
  return getMarkLockedBy(mark) != null;
}

/**
 * Whether the viewer may lock or unlock this mark: its author or the
 * document owner (unattributed legacy marks: the owner only). Everyone else
 * sees the lock but cannot change it. Pass `surveyMarker` for a Survey Marker
 * (its author lives in different fields), `annotation` for everything else.
 *
 * @param {{ annotation?: object, surveyMarker?: object, viewerId: string|null|undefined, documentOwnerId: string|null|undefined }} args
 * @returns {boolean}
 */
export function canToggleLock({ annotation, surveyMarker, viewerId, documentOwnerId }) {
  if (typeof viewerId !== 'string' || viewerId.length === 0) return false;
  if (annotation == null && surveyMarker == null) return false;
  if (isOwner(viewerId, documentOwnerId)) return true;
  // A Survey Marker's lock right follows its creator stamp only — never the
  // last editor (lastModifiedBy), who under open editing can be anyone.
  const authorId = surveyMarker != null
    ? (surveyMarker?.userId ?? surveyMarker?.annotationData?.userId ?? null)
    : getAnnotationAuthorId(annotation);
  return typeof authorId === 'string' && authorId === viewerId;
}

/**
 * Whether the viewer may move / resize / restyle / cut / delete / erase the
 * given annotation.
 *
 * RULED 2026-09-28 owner: open editing + lock. Anyone who can edit the
 * document may change ANY mark — their own, other people's, unattributed
 * legacy marks — with no confirmation and no block. Viewers never get here
 * (ReadOnlyGate stops them upstream; the server refuses their writes).
 *
 * Checks, in order:
 *   1. a user-locked mark is refused for everyone — its author or the
 *      document owner unlocks it first (canToggleLock);
 *   2. the viewer must be known;
 *   3. the document owner id must be known (a registered cloud document whose
 *      owner metadata has not loaded stays fail-closed), EXCEPT for the
 *      viewer's own marks, which stay editable in that window as before.
 *
 * Accepts the canonical destructured options shape:
 *   canModify({ viewerId, documentOwnerId, annotation })
 *
 * @param {{ annotation: object, viewerId: string|null|undefined, documentOwnerId: string|null|undefined }} args
 * @returns {boolean}
 */
export function canModify({ annotation, viewerId, documentOwnerId }) {
  if (annotation == null) return false;
  if (isUserLocked(annotation)) return false;
  if (typeof viewerId !== 'string' || viewerId.length === 0) return false;
  if (typeof documentOwnerId === 'string' && documentOwnerId.length > 0) return true;
  // Owner metadata not loaded yet: only the viewer's own marks.
  const authorId = getAnnotationAuthorId(annotation);
  return typeof authorId === 'string' && authorId === viewerId;
}

/**
 * Whether the viewer may SELECT the mark (click, marquee, lasso). Every mark —
 * user-locked ones included — is selectable by an authenticated edit session;
 * what the selection may then DO is decided by canModify / canDelete.
 *
 * @param {{ annotation: object, viewerId: string|null|undefined, documentOwnerId: string|null|undefined }} args
 * @returns {boolean}
 */
export function canSelect({ annotation, viewerId, documentOwnerId }) {
  if (annotation == null) return false;
  return (
    typeof viewerId === 'string' &&
    viewerId.length > 0 &&
    typeof documentOwnerId === 'string' &&
    documentOwnerId.length > 0
  );
}

/**
 * Legacy Fabric canvases can carry `annotationId` on both Survey Marker
 * projections and ordinary annotations. Only IDs present in the canonical
 * Survey Marker source may use the marker permission callback; every other
 * object stays in the normal annotation ownership lane.
 *
 * @param {{
 *   annotation: object,
 *   knownSurveyMarkerIds: Set<string>,
 *   canEraseSurveyMarker: ((annotationId: string) => boolean)|null|undefined,
 *   viewerId: string|null|undefined,
 *   documentOwnerId: string|null|undefined
 * }} args
 * @returns {boolean}
 */
export function canEraseCanvasAnnotation({
  annotation,
  knownSurveyMarkerIds,
  canEraseSurveyMarker,
  viewerId,
  documentOwnerId,
}) {
  if (annotation == null || annotation.locked === true) return false;
  const annotationId = annotation.annotationId;
  const isKnownSurveyMarker = (
    typeof annotationId === 'string'
    && annotationId.length > 0
    && knownSurveyMarkerIds instanceof Set
    && knownSurveyMarkerIds.has(annotationId)
  );
  if (isKnownSurveyMarker) {
    try {
      return typeof canEraseSurveyMarker === 'function'
        && canEraseSurveyMarker(annotationId) === true;
    } catch {
      return false;
    }
  }
  const canonicalId = annotation?.data?.id;
  if (
    canonicalId == null
    || String(canonicalId).length === 0
  ) {
    return false;
  }
  return canModify({ annotation, viewerId, documentOwnerId });
}

/**
 * Revalidate a callout eraser commit against the live model. Preview hit lists
 * are advisory: stale/forged ids, locked callouts, and unresolved identity are
 * dropped here before the destructive callback runs.
 */
export function filterEraserCommitIds({
  annotationIds,
  annotations,
  viewerId,
  documentOwnerId,
}) {
  if (
    !Array.isArray(annotationIds)
    || !Array.isArray(annotations)
    || typeof viewerId !== 'string'
    || viewerId.length === 0
    || typeof documentOwnerId !== 'string'
    || documentOwnerId.length === 0
  ) {
    return [];
  }
  const byId = new Map(
    annotations
      .filter((annotation) => annotation?.id != null)
      .map((annotation) => [String(annotation.id), annotation]),
  );
  return annotationIds.filter((annotationId) => {
    const annotation = byId.get(String(annotationId));
    return annotation?.locked !== true && canModify({
      annotation,
      viewerId,
      documentOwnerId,
    });
  });
}

/**
 * Whether the viewer may delete the mark. RULED 2026-09-28 owner: open
 * editing + lock — the same rule as canModify: any editor, any author, no
 * confirmation; a user-locked mark is refused until unlocked. Read-only
 * viewers are stopped by ReadOnlyGate before delete handlers run. (Selection
 * uses canSelect, which admits locked marks.)
 *
 * @param {{ annotation: object, viewerId: string|null|undefined, documentOwnerId: string|null|undefined }} args
 * @returns {boolean}
 */
export function canDelete({ annotation, viewerId, documentOwnerId }) {
  return canModify({ annotation, viewerId, documentOwnerId });
}

/**
 * Resolve a Survey Marker's authorId. Survey Markers are the historical fork of
 * the annotation shape and stamp their author in different fields than fabric
 * annotations (they never carry meta.authorId / data.authorId), so this maps
 * the marker fields into the same single-source-of-truth resolution the
 * canonical getAnnotationAuthorId chain provides:
 *
 *   surveyMarker.userId                  // primary author stamp on create
 *     ?? surveyMarker.annotationData.userId // Supabase row projection
 *     ?? surveyMarker.lastModifiedBy        // legacy/edited markers
 *     ?? null
 *
 * @param {object|null|undefined} surveyMarker
 * @returns {string|null}
 */
export function getSurveyMarkerAuthorId(surveyMarker) {
  if (surveyMarker == null) return null;
  return (
    surveyMarker?.userId ??
    surveyMarker?.annotationData?.userId ??
    surveyMarker?.lastModifiedBy ??
    null
  );
}

/**
 * Whether the viewer may move / resize / cut / delete / erase the given
 * Survey Marker. RULED 2026-09-28 owner: open editing + lock — the same rule
 * as canModify: any editor, any author (the old other-user block is gone); a
 * user-locked marker is refused until its author or the document owner
 * unlocks it. While the document owner id is unknown, only the viewer's own
 * markers (marker-specific author chain above) stay editable.
 *
 * @param {{ surveyMarker: object, viewerId: string|null|undefined, documentOwnerId: string|null|undefined }} args
 * @returns {boolean}
 */
export function canModifySurveyMarker({ surveyMarker, viewerId, documentOwnerId }) {
  if (surveyMarker == null) return false;
  if (isUserLocked(surveyMarker)) return false;
  if (typeof viewerId !== 'string' || viewerId.length === 0) return false;
  if (typeof documentOwnerId === 'string' && documentOwnerId.length > 0) return true;
  const authorId = getSurveyMarkerAuthorId(surveyMarker);
  return typeof authorId === 'string' && authorId === viewerId;
}

export function canCommitSurveyMarkerErase({
  surveyMarker,
  viewerId,
  documentOwnerId,
}) {
  if (
    typeof viewerId !== 'string'
    || viewerId.length === 0
    || typeof documentOwnerId !== 'string'
    || documentOwnerId.length === 0
  ) {
    return false;
  }
  return canModifySurveyMarker({ surveyMarker, viewerId, documentOwnerId });
}

/**
 * Filter an annotations array down to the marks the viewer may change.
 * RULED 2026-09-28 owner: open editing + lock — that is every mark that is
 * not user-locked, whoever drew it. Returns the input array reference
 * UNCHANGED when nothing is dropped (the common case) so React memoization
 * downstream keeps its identity.
 *
 *   filterByAuthor({ viewerId, documentOwnerId, annotations })
 *
 * @param {{ annotations: Array<object>, viewerId: string|null|undefined, documentOwnerId: string|null|undefined }} args
 * @returns {Array<object>}
 */
export function filterByAuthor({ annotations, viewerId, documentOwnerId }) {
  if (!Array.isArray(annotations)) return [];
  const kept = annotations.filter((a) =>
    canModify({ annotation: a, viewerId, documentOwnerId }),
  );
  return kept.length === annotations.length ? annotations : kept;
}
