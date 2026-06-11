// src/services/annotationTrashHistory.js
//
// KAL-313 Phase 2 — Trash / History / Restore: shapes, ink, text, callouts,
// regions, and bulk deletes.
//
// Pure + storage-agnostic so every function is unit-testable without React or
// Supabase.  PDFViewer.jsx imports only what it needs; the rest stay here.
//
// Design reference: .planning/excel-addin-model/TRASH-ALL-TYPES-DESIGN.md
// Isaiah's decisions (2026-06-11):
//   OQ-1: callout parallel branch ships NOW (deleted at KAL-81 unification).
//   OQ-2: delete-audit rows are immutable (trigger blocks owner DELETE).
//   OQ-3: 50-object soft cap per bulk row; batchId splitting beyond 50.
//   OQ-4: greyed-out + "its space was deleted — restore the space first".

import { invertAnnotationHistoryAction } from '../utils/annotationLocalHistory.js';

// ─── Annotation type labels ────────────────────────────────────────────────

function labelFabricType(fabricType) {
  const t = String(fabricType || '').toLowerCase();
  if (t === 'path') return 'pen stroke';
  if (t === 'textbox' || t === 'i-text') return 'text';
  if (t === 'rect') return 'rectangle';
  if (t === 'circle') return 'circle';
  if (t === 'line') return 'line';
  if (t === 'polygon') return 'polygon';
  if (t === 'polyline') return 'polyline';
  return 'annotation';
}

function labelFromAnnotation(annotation) {
  const fabricType = annotation?.type || annotation?.data?.type || '';
  return labelFabricType(fabricType);
}

// ─── Slice 2: Standard annotation (shape / ink / text) ────────────────────

/**
 * Build the restoreAction for a single fabric:delete history action.
 * The restore action is the inverse: fabric:create with the full annotation.
 *
 * @param {object} deleteAction  fabric:delete history action from annotationLocalHistory
 * @returns {object|null}
 */
export function buildAnnotationRestoreAction(deleteAction) {
  if (!deleteAction || deleteAction.type !== 'fabric:delete') return null;
  return invertAnnotationHistoryAction(deleteAction);
}

/**
 * Build a document-history row for a single annotation deletion.
 *
 * @param {object} args
 * @param {object} args.deleteAction    fabric:delete history action
 * @param {string} args.documentId
 * @param {string|null} [args.userId]
 * @param {string} [args.actorName]
 * @param {string} args.deletedAt       ISO timestamp
 * @returns {object|null}  row for recordDocumentHistoryEvent, or null if invalid
 */
export function buildAnnotationDeleteHistoryRow({
  deleteAction,
  documentId,
  userId = null,
  actorName = 'Someone',
  deletedAt,
}) {
  if (!deleteAction || deleteAction.type !== 'fabric:delete') return null;
  if (!documentId) return null;

  const annotationId = deleteAction.annotationId || null;
  const pageNumber = deleteAction.pageNumber != null ? Number(deleteAction.pageNumber) : null;
  const annotation = deleteAction.annotation || null;
  const label = labelFromAnnotation(annotation);
  const pageSuffix = Number.isFinite(pageNumber) ? ` on page ${pageNumber}` : '';
  const restoreAction = buildAnnotationRestoreAction(deleteAction);

  const clientEventId = [
    'annotation-delete',
    annotationId || 'unknown',
    deletedAt,
  ].join(':');

  return {
    id: clientEventId,
    document_id: documentId,
    user_id: userId,
    client_event_id: clientEventId,
    event_type: 'annotation_deleted',
    source: 'annotation-trash',
    page_number: Number.isFinite(pageNumber) ? pageNumber : null,
    annotation_id: annotationId,
    summary: `${actorName} deleted ${label === 'annotation' ? 'an annotation' : `a ${label}`}${pageSuffix}`,
    payload: {
      actionType: 'delete',
      rawActionType: 'annotation_deleted',
      annotationId,
      pageNumber,
      deletedBy: userId,
      restoreAction,
    },
    is_undoable: true,
    is_checkpoint: false,
    occurred_at: deletedAt,
    created_at: deletedAt,
  };
}

/** True when a history restoreAction targets a standard annotation. */
export function isAnnotationRestoreAction(restoreAction) {
  return Boolean(
    restoreAction &&
    restoreAction.type === 'fabric:create' &&
    restoreAction.annotationId &&
    restoreAction.pageNumber != null,
  );
}

// ─── Slice 3: Callout (parallel branch — deleted at KAL-81 unification) ───

/**
 * Build the restoreAction for a callout deletion.
 *
 * @param {object} callout  the full callout object at delete time
 * @returns {object}
 */
export function buildCalloutRestoreAction(callout) {
  return {
    type: 'callout',
    calloutId: callout?.id,
    pageNumber: callout?.pageNumber ?? null,
    callout,
  };
}

/**
 * Build a document-history row for a callout deletion.
 *
 * @param {object} args
 * @param {object} args.callout         the full callout object being deleted
 * @param {string} args.documentId
 * @param {string|null} [args.userId]
 * @param {string} [args.actorName]
 * @param {string} args.deletedAt
 * @returns {object|null}
 */
export function buildCalloutDeleteHistoryRow({
  callout,
  documentId,
  userId = null,
  actorName = 'Someone',
  deletedAt,
}) {
  if (!callout || !callout.id) return null;
  if (!documentId) return null;

  const pageNumber = callout.pageNumber != null ? Number(callout.pageNumber) : null;
  const pageSuffix = Number.isFinite(pageNumber) ? ` on page ${pageNumber}` : '';
  const restoreAction = buildCalloutRestoreAction(callout);

  const clientEventId = [
    'callout-delete',
    callout.id,
    deletedAt,
  ].join(':');

  return {
    id: clientEventId,
    document_id: documentId,
    user_id: userId,
    client_event_id: clientEventId,
    event_type: 'callout_deleted',
    source: 'callout-trash',
    page_number: Number.isFinite(pageNumber) ? pageNumber : null,
    annotation_id: callout.id,
    summary: `${actorName} deleted a callout${pageSuffix}`,
    payload: {
      actionType: 'delete',
      rawActionType: 'callout_deleted',
      calloutId: callout.id,
      pageNumber,
      deletedBy: userId,
      restoreAction,
    },
    is_undoable: true,
    is_checkpoint: false,
    occurred_at: deletedAt,
    created_at: deletedAt,
  };
}

/** True when a history restoreAction targets a callout. */
export function isCalloutRestoreAction(restoreAction) {
  return Boolean(
    restoreAction &&
    restoreAction.type === 'callout' &&
    restoreAction.calloutId &&
    restoreAction.callout,
  );
}

/**
 * Apply a callout restore: re-insert the callout into the live callouts array.
 * Returns the next callouts array, or null if already present (idempotent).
 *
 * @param {object[]} callouts       current callouts array
 * @param {object}   restoreAction  callout restoreAction from the history row
 * @param {object}   [opts]
 * @param {string}   [opts.restoredAt]  ISO timestamp
 * @returns {{ callouts: object[], callout: object } | null}
 */
export function applyCalloutRestore(callouts, restoreAction, { restoredAt } = {}) {
  if (!isCalloutRestoreAction(restoreAction)) return null;
  const { callout } = restoreAction;
  const safeCallouts = Array.isArray(callouts) ? callouts : [];
  // Idempotent: already present → no-op.
  if (safeCallouts.some((c) => c.id === callout.id)) {
    return null; // caller treats as restore-noop
  }
  const restored = { ...callout, restoredAt: restoredAt || new Date().toISOString() };
  return {
    callouts: [...safeCallouts, restored],
    callout: restored,
  };
}

// ─── Slice 4: Region ───────────────────────────────────────────────────────

/**
 * Build the restoreAction for a region deletion.
 *
 * @param {object} args
 * @param {object} args.region      the full region object at delete time
 * @param {string} args.spaceId     UUID of the parent space
 * @param {string} args.spaceName   display name of the parent space (for History label)
 * @returns {object}
 */
export function buildRegionRestoreAction({ region, spaceId, spaceName }) {
  return {
    type: 'region',
    regionId: region?.regionId,
    pageNumber: region?.pageId != null ? Number(region.pageId) : null,
    spaceId,
    spaceName,
    region,
  };
}

/**
 * Build a document-history row for a region deletion.
 *
 * @param {object} args
 * @param {object} args.region       full region object being deleted
 * @param {string} args.spaceId
 * @param {string} args.spaceName
 * @param {string} args.documentId
 * @param {string|null} [args.userId]
 * @param {string} [args.actorName]
 * @param {string} args.deletedAt
 * @returns {object|null}
 */
export function buildRegionDeleteHistoryRow({
  region,
  spaceId,
  spaceName,
  documentId,
  userId = null,
  actorName = 'Someone',
  deletedAt,
}) {
  if (!region || !region.regionId) return null;
  if (!documentId) return null;

  const pageNumber = region.pageId != null ? Number(region.pageId) : null;
  const pageSuffix = Number.isFinite(pageNumber) ? ` on page ${pageNumber}` : '';
  const spaceLabel = spaceName ? ` in "${spaceName}"` : '';
  const restoreAction = buildRegionRestoreAction({ region, spaceId, spaceName });

  const clientEventId = [
    'region-delete',
    region.regionId,
    deletedAt,
  ].join(':');

  return {
    id: clientEventId,
    document_id: documentId,
    user_id: userId,
    client_event_id: clientEventId,
    event_type: 'region_deleted',
    source: 'region-trash',
    page_number: Number.isFinite(pageNumber) ? pageNumber : null,
    annotation_id: region.regionId,
    summary: `${actorName} deleted a region${pageSuffix}${spaceLabel}`,
    payload: {
      actionType: 'delete',
      rawActionType: 'region_deleted',
      regionId: region.regionId,
      spaceId,
      spaceName,
      pageNumber,
      deletedBy: userId,
      restoreAction,
    },
    is_undoable: true,
    is_checkpoint: false,
    occurred_at: deletedAt,
    created_at: deletedAt,
  };
}

/** True when a history restoreAction targets a region. */
export function isRegionRestoreAction(restoreAction) {
  return Boolean(
    restoreAction &&
    restoreAction.type === 'region' &&
    restoreAction.regionId &&
    restoreAction.spaceId &&
    restoreAction.region,
  );
}

// ─── Slice 5: Bulk delete ──────────────────────────────────────────────────

const BULK_BATCH_SIZE = 50; // OQ-3: 50-object soft cap per row

/**
 * Build per-object restoreAction entries for a bulk delete operation.
 * Each entry carries the per-object restoreAction already built by the
 * per-type helpers above (or fabric:create for standard annotations).
 *
 * @param {object[]} objectRestoreActions  array of { annotationId, pageNumber, restoreAction }
 * @param {string}   batchId              shared identifier for rows in the same split
 * @returns {object[][]}  array of batches (each batch ≤ 50 objects)
 */
export function splitBulkRestoreActionsIntoBatches(objectRestoreActions, batchId) {
  const safe = Array.isArray(objectRestoreActions) ? objectRestoreActions : [];
  const batches = [];
  for (let i = 0; i < safe.length; i += BULK_BATCH_SIZE) {
    batches.push(safe.slice(i, i + BULK_BATCH_SIZE));
  }
  return batches;
}

/**
 * Build one or more document-history rows for a bulk annotation delete.
 * Returns an array of rows (one per batch if > 50 objects).
 *
 * @param {object} args
 * @param {object[]} args.objectRestoreActions  per-object { annotationId?, pageNumber?, restoreAction }
 * @param {number}  args.totalCount             total number of objects deleted
 * @param {string}  args.documentId
 * @param {string|null} [args.userId]
 * @param {string}  [args.actorName]
 * @param {string}  args.deletedAt
 * @returns {object[]}  rows for recordDocumentHistoryEvent
 */
export function buildBulkAnnotationDeleteHistoryRows({
  objectRestoreActions,
  totalCount,
  documentId,
  userId = null,
  actorName = 'Someone',
  deletedAt,
}) {
  if (!Array.isArray(objectRestoreActions) || objectRestoreActions.length === 0) return [];
  if (!documentId) return [];

  const batchId = ['bulk-delete', deletedAt, totalCount].join(':');
  const batches = splitBulkRestoreActionsIntoBatches(objectRestoreActions, batchId);

  return batches.map((batch, batchIndex) => {
    const suffix = batches.length > 1 ? ` (batch ${batchIndex + 1}/${batches.length})` : '';
    const clientEventId = [
      'annotations-bulk-delete',
      batchId,
      batchIndex,
    ].join(':');

    return {
      id: clientEventId,
      document_id: documentId,
      user_id: userId,
      client_event_id: clientEventId,
      event_type: 'annotations_bulk_deleted',
      source: 'annotation-trash',
      page_number: null,
      annotation_id: null,
      summary: `${actorName} deleted ${totalCount} annotation${totalCount !== 1 ? 's' : ''}${suffix}`,
      payload: {
        actionType: 'bulk-delete',
        rawActionType: 'annotations_bulk_deleted',
        count: totalCount,
        batchId,
        batchIndex,
        batchTotal: batches.length,
        deletedBy: userId,
        objects: batch,
      },
      is_undoable: true,
      is_checkpoint: false,
      occurred_at: deletedAt,
      created_at: deletedAt,
    };
  });
}

/** True when a history event is a bulk-delete row. */
export function isBulkAnnotationDeleteEvent(event) {
  return event?.event_type === 'annotations_bulk_deleted';
}
