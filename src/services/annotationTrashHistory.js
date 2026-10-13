// src/services/annotationTrashHistory.js
//
// KAL-313 Phase 2 — Trash / History / Restore: shapes, ink, text, callouts,
// regions, bulk deletes, and spaces.
//
// Pure + storage-agnostic so every function is unit-testable without React or
// Supabase.  PDFViewer.jsx imports only what it needs; the rest stay here.
//
// Design reference: .planning/excel-addin-model/TRASH-ALL-TYPES-DESIGN.md
// Isaiah's decisions (2026-06-11):
//   OQ-1: callout parallel branch ships NOW (deleted at KAL-81 unification).
//   OQ-2: delete-audit rows are immutable (trigger blocks owner DELETE).
//   OQ-3: 50-object soft cap per bulk row; batchId splitting beyond 50.
//   OQ-4 SUPERSEDED: CONFIRM-CASCADE — when space restore record exists,
//         keep Restore enabled and offer "Restore both?" confirm; greyed-out
//         only when no space record is available (aged out / never journaled).

import { invertAnnotationHistoryAction } from '../utils/annotationLocalHistory.js';
import { projectAnnotationForHistoryPreview } from '../utils/historyPreviewAnnotation.js';
import { MAX_ERASE_DELETE_HISTORY_OBJECTS } from '../utils/annotationEraseLimits.js';

// ─── Annotation type labels ────────────────────────────────────────────────

function labelFabricType(fabricType) {
  const t = String(fabricType || '').toLowerCase();
  if (t === 'path') return 'pen stroke';
  if (t === 'textbox' || t === 'i-text') return 'text';
  if (t === 'rect') return 'rectangle';
  if (t === 'circle') return 'circle';
  if (t === 'ellipse') return 'ellipse';
  if (t === 'line') return 'line';
  if (t === 'arrow') return 'arrow';
  if (t === 'counter') return 'counter';
  if (t === 'polygon') return 'polygon';
  if (t === 'polyline') return 'polyline';
  return 'annotation';
}

function labelFromAnnotation(annotation) {
  // R2.2 Slice 4: callout deletes journal fabric-shaped rows (the projected
  // group object, type 'group' + data.type 'callout') through the shared bulk
  // path — keep the human summary saying "callout", not "annotation".
  if (annotation?.data?.type === 'callout') return 'callout';
  // w55: marks whose fabric type is generic (a group, a path) name themselves
  // by their own kind first, so an erased counter never reads "annotation".
  const ownKind = labelFabricType(annotation?.data?.annotationType || annotation?.data?.type || '');
  if (ownKind !== 'annotation') return ownKind;
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
    summary: `${actorName} deleted ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}${pageSuffix}`,
    payload: {
      actionType: 'delete',
      rawActionType: 'annotation_deleted',
      annotationId,
      pageNumber,
      deletedBy: userId,
      // Spotlight geometry for the History panel's "show where it was" glow —
      // the deleted object is gone from the DOM, so the row must carry it.
      // Outline ink is projected to a compact fabric-shaped preview.
      previewAnnotation: projectAnnotationForHistoryPreview(annotation),
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

/** True when a restore row carries any supported Fabric history action. */
export function isFabricAnnotationHistoryAction(restoreAction) {
  return Boolean(
    restoreAction
    && ['fabric:create', 'fabric:update', 'fabric:batch'].includes(restoreAction.type)
    && restoreAction.pageNumber != null,
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

/**
 * Apply a region restore against a spaces array (pure — KAL-313 follow-up).
 * Mirrors PDFViewer's plain region restore branch exactly so the live path is
 * node-testable: find the parent space, find/create the page entry, append the
 * region idempotently. The region object is appended UNCHANGED (rotation,
 * coordinates, sourceRegions all preserved).
 *
 * @param {object[]} spaces         current live spaces array
 * @param {object}   restoreAction  region restoreAction from the history row
 * @returns {{ status: 'invalid' }
 *         | { status: 'space-missing', spaceId: string }
 *         | { status: 'noop' }
 *         | { status: 'ok', assignedPages: object[], pageId: * }}
 */
export function applyRegionRestoreToSpaces(spaces, restoreAction) {
  if (!isRegionRestoreAction(restoreAction)) return { status: 'invalid' };
  const safeSpaces = Array.isArray(spaces) ? spaces : [];
  const { spaceId, region, pageNumber } = restoreAction;
  const targetSpace = safeSpaces.find((s) => s.id === spaceId);
  if (!targetSpace) return { status: 'space-missing', spaceId };
  const existingPages = Array.isArray(targetSpace.assignedPages) ? targetSpace.assignedPages : [];
  const pageId = region.pageId ?? pageNumber;
  const pageEntry = existingPages.find((p) => String(p.pageId) === String(pageId));
  if (pageEntry && (pageEntry.regions || []).some((r) => r.regionId === region.regionId)) {
    return { status: 'noop' };
  }
  const assignedPages = pageEntry
    ? existingPages.map((p) =>
        String(p.pageId) === String(pageId)
          ? { ...p, regions: [...(p.regions || []), region] }
          : p,
      )
    : [...existingPages, { pageId, regions: [region], wholePageIncluded: false }];
  return { status: 'ok', assignedPages, pageId };
}

// ─── Slice 5: Bulk delete ──────────────────────────────────────────────────

export const BULK_BATCH_SIZE = MAX_ERASE_DELETE_HISTORY_OBJECTS;

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

/** Build one delete-only Revisions row for the objects an eraser removed. */
export function buildAnnotationEraseDeleteHistoryRow({
  objectRestoreActions,
  totalCount,
  mutationId,
  documentId,
  userId = null,
  actorName = 'Someone',
  deletedAt,
  batchIndex = 0,
  batchTotal = 1,
  gestureTotalCount = totalCount,
}) {
  if (!Array.isArray(objectRestoreActions) || objectRestoreActions.length === 0) return null;
  if (!documentId || !mutationId) return null;
  const normalizedBatchIndex = Math.max(0, Number(batchIndex) || 0);
  const normalizedBatchTotal = Math.max(1, Number(batchTotal) || 1);
  const clientEventId = normalizedBatchTotal > 1
    ? `annotations-erase-delete:${mutationId}:${normalizedBatchIndex + 1}-of-${normalizedBatchTotal}`
    : `annotations-erase-delete:${mutationId}`;
  const batchSuffix = normalizedBatchTotal > 1
    ? ` (batch ${normalizedBatchIndex + 1}/${normalizedBatchTotal})`
    : '';
  return {
    id: clientEventId,
    document_id: documentId,
    user_id: userId,
    client_event_id: clientEventId,
    event_type: 'annotations_bulk_deleted',
    source: 'annotation-eraser',
    page_number: null,
    annotation_id: null,
    summary: `${actorName} deleted ${gestureTotalCount} annotation${gestureTotalCount !== 1 ? 's' : ''} with the eraser${batchSuffix}`,
    payload: {
      // Keep "delete" in the presentation fields so the existing Revisions
      // panel offers Restore for this compatible bulk event shape.
      actionType: 'bulk-delete',
      rawActionType: 'annotations_erase_deleted',
      count: totalCount,
      gestureTotalCount,
      mutationId,
      batchIndex: normalizedBatchIndex,
      batchTotal: normalizedBatchTotal,
      deletedBy: userId,
      objects: objectRestoreActions,
    },
    is_undoable: true,
    is_checkpoint: false,
    occurred_at: deletedAt,
    created_at: deletedAt,
  };
}

/** True when a history event is a bulk-delete row. */
export function isBulkAnnotationDeleteEvent(event) {
  return event?.event_type === 'annotations_bulk_deleted';
}

// ─── Slice 6: Space (prerequisite for region cascade restore) ─────────────────
//
// handleSpaceDelete in PDFViewer previously only wrote an addHistoryCheckpoint
// entry — no restoreAction, no space_deleted event_type, so the region restore
// handler had no space record to find when checking whether the parent space
// could be revived. This slice closes that gap.

/**
 * Build the restoreAction for a space deletion.
 *
 * @param {object} space  the full space object at delete time
 *                        { id, name, assignedPages: [...], ... }
 * @returns {object}
 */
export function buildSpaceRestoreAction(space) {
  return {
    type: 'space',
    spaceId: space?.id,
    spaceName: space?.name ?? null,
    space,
  };
}

/**
 * Build a document-history row for a space deletion.
 *
 * @param {object} args
 * @param {object} args.space          full space object being deleted
 * @param {string} args.documentId
 * @param {string|null} [args.userId]
 * @param {string} [args.actorName]
 * @param {string} args.deletedAt      ISO timestamp
 * @returns {object|null}
 */
export function buildSpaceDeleteHistoryRow({
  space,
  documentId,
  userId = null,
  actorName = 'Someone',
  deletedAt,
}) {
  if (!space || !space.id) return null;
  if (!documentId) return null;

  const spaceLabel = space.name ? `"${space.name}"` : 'a space';
  const restoreAction = buildSpaceRestoreAction(space);

  const clientEventId = [
    'space-delete',
    space.id,
    deletedAt,
  ].join(':');

  return {
    id: clientEventId,
    document_id: documentId,
    user_id: userId,
    client_event_id: clientEventId,
    event_type: 'space_deleted',
    source: 'space-trash',
    page_number: null,
    annotation_id: space.id,
    summary: `${actorName} deleted space ${spaceLabel}`,
    payload: {
      actionType: 'delete',
      rawActionType: 'space_deleted',
      spaceId: space.id,
      spaceName: space.name ?? null,
      deletedBy: userId,
      restoreAction,
    },
    is_undoable: true,
    is_checkpoint: false,
    occurred_at: deletedAt,
    created_at: deletedAt,
  };
}

/** True when a history restoreAction targets a space. */
export function isSpaceRestoreAction(restoreAction) {
  return Boolean(
    restoreAction &&
    restoreAction.type === 'space' &&
    restoreAction.spaceId &&
    restoreAction.space,
  );
}

/**
 * Apply a space restore: re-insert the deleted space into the live spaces
 * array exactly as captured at delete time (assignedPages, regions, name —
 * full object fidelity). Pure mirror of PDFViewer's handleRestoreSpace so the
 * standalone space restore path is node-testable.
 *
 * Idempotent: returns null when the space already exists (caller treats as
 * restore-noop / "already present").
 *
 * @param {object[]} spaces         current live spaces array
 * @param {object}   restoreAction  space restoreAction from the history row
 * @param {object}   [opts]
 * @param {string}   [opts.restoredAt]  ISO timestamp
 * @returns {{ spaces: object[], space: object } | null}
 */
export function applySpaceRestore(spaces, restoreAction, { restoredAt } = {}) {
  if (!isSpaceRestoreAction(restoreAction)) return null;
  const { spaceId, space } = restoreAction;
  const safeSpaces = Array.isArray(spaces) ? spaces : [];
  if (safeSpaces.some((s) => s.id === spaceId)) {
    return null; // caller treats as restore-noop / already present
  }
  const restored = { ...space, restoredAt: restoredAt || new Date().toISOString() };
  return {
    spaces: [...safeSpaces, restored],
    space: restored,
  };
}

// ─── Cascade decision helper ──────────────────────────────────────────────────
//
// Used by the region restore path to decide whether to:
//   'plain'   — space exists in live state, restore region directly
//   'cascade' — space is gone BUT a restorable space_deleted event exists;
//               caller should present "Restore both?" confirm
//   'blocked' — space is gone AND no restorable record available; show greyed-out

/**
 * Determine the cascade decision for restoring an orphaned region.
 *
 * @param {object} args
 * @param {string}   args.spaceId            the region's parent space ID
 * @param {object[]} args.liveSpaces         current live spaces array
 * @param {object[]} args.historyEvents      loaded history events from the panel
 * @returns {'plain' | 'cascade' | 'blocked'}
 */
export function resolveRegionRestoreCascade({ spaceId, liveSpaces, historyEvents }) {
  // Case 1: space still exists → plain restore
  if (Array.isArray(liveSpaces) && liveSpaces.some((s) => s.id === spaceId)) {
    return 'plain';
  }

  // Case 2: space gone — look for a restorable space_deleted event
  if (Array.isArray(historyEvents)) {
    const spaceRecord = historyEvents.find(
      (ev) =>
        ev.event_type === 'space_deleted' &&
        ev.payload?.restoreAction?.spaceId === spaceId &&
        isSpaceRestoreAction(ev.payload?.restoreAction),
    );
    if (spaceRecord) return 'cascade';
  }

  // Case 3: no restore record available
  return 'blocked';
}

// ─── History event subject labels ─────────────────────────────────────────────
//
// KAL-313 follow-up: RevisionsPanel previously rendered "Annotation: <id>" for
// ANY event with an annotation_id — including space_deleted (where the id is
// the space UUID) and region_deleted (region UUID). Label by event type.

/**
 * Human-readable subject line for a history event's expanded detail.
 * Returns null when there is nothing meaningful to show.
 *
 * @param {object} event  document-history event row
 * @returns {string|null}
 */
export function describeHistoryEventSubject(event) {
  if (!event) return null;
  const payload = event.payload || {};
  if (event.event_type === 'space_deleted') {
    const name = payload.spaceName ?? payload.restoreAction?.spaceName;
    if (name) return `Space: "${name}"`;
    const spaceId = payload.spaceId || event.annotation_id;
    return spaceId ? `Space: ${spaceId}` : 'Space';
  }
  if (event.event_type === 'region_deleted') {
    const spaceName = payload.spaceName ?? payload.restoreAction?.spaceName;
    return spaceName ? `Region in "${spaceName}"` : 'Region in a space';
  }
  if (event.event_type === 'annotations_bulk_deleted') return null;
  // w55: never show a raw id to the person reading History.
  return null;
}
