// src/lib/collab/permissionScope.js
// Phase 35 Plan 02 — Pure-JS permission helpers for the per-user delete authority model.
//
// Goal-backward acceptance criteria this module satisfies:
//   - AC: "non-owner viewing another user's annotations sees them locked from interaction"
//     → canModify returns false for foreign authors when viewer is not the document owner.
//   - AC: "owner editing or transforming another user's annotation succeeds without prompt"
//     → canModify returns true for any annotation when viewer is the document owner.
//   - AC: "marquee/eraser only catch the user's own marks for collaborators"
//     → filterByAuthor drops foreign-author marks for collaborator role.
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
import { isManagedLocalEditingContext } from '../../utils/managedLocalEditingContext.js';

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
 * Whether the viewer is allowed to modify (select / edit / transform / erase / delete)
 * the given annotation.
 *
 * Owner role is the cheap path (single equality check on viewerId vs documentOwnerId)
 * and short-circuits before any annotation lookup — checked first so the owner's
 * full-document hot path stays branch-free.
 *
 * Accepts the canonical destructured options shape locked by the Plan 35-01 test
 * scaffold (tests/phase35/permissionScope.test.mjs):
 *   canModify({ viewerId, documentOwnerId, annotation })
 *
 * @param {{ annotation: object, viewerId: string|null|undefined, documentOwnerId: string|null|undefined }} args
 * @returns {boolean}
 */
export function canModify({ annotation, viewerId, documentOwnerId, localDocumentContext }) {
  if (isManagedLocalEditingContext(localDocumentContext)) return annotation != null && annotation.locked !== true;
  // Owner can modify anything — short-circuit before reading the annotation.
  if (isOwner(viewerId, documentOwnerId)) return true;
  // Non-owner: must be the author of this specific annotation.
  const authorId = getAnnotationAuthorId(annotation);
  if (typeof authorId !== 'string' || typeof viewerId !== 'string') return false;
  return authorId === viewerId;
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
  localDocumentContext,
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
  return canModify({ annotation, viewerId, documentOwnerId, localDocumentContext });
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
  localDocumentContext,
}) {
  if (
    !Array.isArray(annotationIds)
    || !Array.isArray(annotations)
    || (!isManagedLocalEditingContext(localDocumentContext) && (
      typeof viewerId !== 'string' || viewerId.length === 0
      || typeof documentOwnerId !== 'string' || documentOwnerId.length === 0
    ))
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
      localDocumentContext,
    });
  });
}

/**
 * Whether an authenticated write-capable session may request deletion.
 * Read-only viewers are stopped by ReadOnlyGate before delete handlers run.
 * Foreign-author deletes are allowed through here so the shared bulk-delete
 * planner can require an explicit cross-author confirmation.
 *
 * @param {{ annotation: object, viewerId: string|null|undefined, documentOwnerId: string|null|undefined }} args
 * @returns {boolean}
 */
export function canDelete({ annotation, viewerId, documentOwnerId, localDocumentContext }) {
  if (annotation == null) return false;
  if (isManagedLocalEditingContext(localDocumentContext)) return annotation.locked !== true;
  return (
    typeof viewerId === 'string' &&
    viewerId.length > 0 &&
    typeof documentOwnerId === 'string' &&
    documentOwnerId.length > 0
  );
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
 * Whether the viewer is allowed to modify (delete / edit) the given Survey
 * Marker. Thin adapter over the canModify semantics with the marker-specific
 * author resolution above — identical owner override and identical FAIL-CLOSED
 * treatment of unresolvable authors: a non-owner may never touch a marker whose
 * author cannot be resolved. (The old inline PDFViewer chain failed OPEN on a
 * missing author and had no document-owner override.)
 *
 * @param {{ surveyMarker: object, viewerId: string|null|undefined, documentOwnerId: string|null|undefined }} args
 * @returns {boolean}
 */
export function canModifySurveyMarker({ surveyMarker, viewerId, documentOwnerId, localDocumentContext }) {
  if (isManagedLocalEditingContext(localDocumentContext)) return surveyMarker != null && surveyMarker.locked !== true;
  // Owner can modify anything — same short-circuit as canModify.
  if (isOwner(viewerId, documentOwnerId)) return true;
  // Non-owner: must be the author of this specific marker; unresolvable
  // author denies (fail closed), matching canModify's string checks.
  const authorId = getSurveyMarkerAuthorId(surveyMarker);
  if (typeof authorId !== 'string' || typeof viewerId !== 'string') return false;
  return authorId === viewerId;
}

export function canCommitSurveyMarkerErase({
  surveyMarker,
  viewerId,
  documentOwnerId,
  localDocumentContext,
}) {
  if (isManagedLocalEditingContext(localDocumentContext)) {
    return canModifySurveyMarker({ surveyMarker, viewerId, documentOwnerId, localDocumentContext });
  }
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
 * Filter an annotations array down to the marks the viewer is permitted to interact with.
 *
 * UX comment: owner-mode returns the input array reference UNCHANGED. filterByAuthor
 * runs on every render of the SVG layer — for the dominant single-user-owner session
 * a per-render filter copy would defeat React reference-equality memoization
 * downstream and cause unnecessary re-renders of every annotation. Owner mode is the
 * hot path; reference identity matters more than allocation cleanliness.
 *
 * Accepts the canonical destructured options shape locked by the Plan 35-01 test
 * scaffold (tests/phase35/permissionScope.test.mjs):
 *   filterByAuthor({ viewerId, documentOwnerId, annotations })
 *
 * @param {{ annotations: Array<object>, viewerId: string|null|undefined, documentOwnerId: string|null|undefined }} args
 * @returns {Array<object>}  // owner-role: same reference; collaborator-role: filtered new array
 */
export function filterByAuthor({ annotations, viewerId, documentOwnerId, localDocumentContext }) {
  if (!Array.isArray(annotations)) return [];
  // Owner hot path — identity return preserves React memoization downstream.
  if (isOwner(viewerId, documentOwnerId)) return annotations;
  // Collaborator path — keep only the viewer's own marks.
  return annotations.filter((a) =>
    canModify({ annotation: a, viewerId, documentOwnerId, localDocumentContext }),
  );
}
