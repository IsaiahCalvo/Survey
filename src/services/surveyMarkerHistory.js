// src/services/surveyMarkerHistory.js
//
// Stage 2 MVP recovery surface: deleted Survey Markers show up in the existing
// document History panel as "Restorable deleted item" rows (no separate trash
// UI). A delete records a history event whose payload carries a `restoreAction`
// of type `surveyMarker` holding the full marker, so one click in History brings
// the marker back — panel row, checklist answers, name, notes, entity, page
// number, and PDF bounds — exactly as it was.
//
// After a restore the marker is treated as app-restored / pending sync: its
// `exportedAt` acknowledgment is cleared so the received-only import guard
// protects it from being immediately re-deleted just because the Excel row is
// still missing. It becomes eligible for Excel deletion again only after it has
// been successfully exported to Excel.
//
// Pure + storage-agnostic so it is unit-testable without React/Supabase.

import { wasReceivedByExcel } from './excelExportAck.js';

/**
 * Build the restore action embedded in a Survey Marker delete history event.
 * The full marker is kept (it is the compact restore payload — a single marker
 * is tiny). `pageNumber` is mirrored at the top level because the History panel
 * and the restore handler key off it.
 */
export function buildSurveyMarkerRestoreAction(markerId, marker) {
  return {
    type: 'surveyMarker',
    markerId,
    pageNumber: marker?.pageNumber ?? null,
    surveyMarker: marker,
  };
}

/**
 * Build a document-history row for a Survey Marker deletion. The summary
 * contains the word "deleted" so the panel renders it as a deleted item, and the
 * payload carries the restoreAction so the Restore button appears.
 *
 * @param {object} args
 * @param {string} args.markerId
 * @param {object} args.marker            the marker being deleted
 * @param {string} args.documentId
 * @param {string|null} [args.userId]
 * @param {string} [args.actorName]       display name for the summary
 * @param {string} [args.origin]          'app' (eraser/panel) or 'excel-import'
 * @param {string} args.deletedAt         ISO timestamp (caller provides the clock)
 * @returns {object} a row for recordDocumentHistoryEvent
 */
export function buildSurveyMarkerDeleteHistoryRow({
  markerId,
  marker,
  documentId,
  userId = null,
  actorName = 'Someone',
  origin = 'app',
  deletedAt,
}) {
  const pageNumber = marker?.pageNumber ?? null;
  const name = (typeof marker?.name === 'string' ? marker.name : String(marker?.name || '')).trim();
  const nameLabel = name ? ` "${name}"` : '';
  const viaExcel = origin === 'excel-import' ? ' (via Excel sync)' : '';
  const clientEventId = ['survey-marker-delete', markerId, deletedAt].join(':');
  return {
    id: clientEventId,
    document_id: documentId,
    user_id: userId,
    client_event_id: clientEventId,
    event_type: 'survey_marker_deleted',
    source: 'survey-marker',
    page_number: Number.isFinite(Number(pageNumber)) ? Number(pageNumber) : null,
    annotation_id: markerId,
    summary: `${actorName} deleted a Survey Marker${nameLabel}${viaExcel}`,
    payload: {
      actionType: 'delete',
      rawActionType: 'survey_marker_deleted',
      annotationType: 'surveyMarker',
      annotationId: markerId,
      pageNumber,
      origin,
      restoreAction: buildSurveyMarkerRestoreAction(markerId, marker),
    },
    is_undoable: true,
    is_checkpoint: false,
    occurred_at: deletedAt,
    created_at: deletedAt,
  };
}

/** True when a history restore action targets a Survey Marker. */
export function isSurveyMarkerRestoreAction(restoreAction) {
  return Boolean(
    restoreAction &&
    restoreAction.type === 'surveyMarker' &&
    restoreAction.markerId &&
    restoreAction.surveyMarker,
  );
}

/**
 * Apply a Survey Marker restore to the live marker map. Re-adds the full marker
 * and clears its export acknowledgment so it is treated as app-restored / pending
 * sync (protected from immediate Excel re-delete until re-exported). Returns a new
 * map; the input is not mutated.
 *
 * @returns {{ surveyMarkers: object, markerId: string, marker: object } | null}
 *          null when the restore action is not a valid Survey Marker restore.
 */
export function applySurveyMarkerRestore(surveyMarkers, restoreAction, { restoredAt } = {}) {
  if (!isSurveyMarkerRestoreAction(restoreAction)) return null;
  const { markerId, surveyMarker } = restoreAction;
  // w55: a marker that is already back (undo, a teammate, a second press) is
  // left exactly as it is now — restoring over it would put back delete-time
  // answers, name and notes and clear its Excel acknowledgment.
  const live = surveyMarkers?.[markerId];
  if (live && typeof live === 'object' && !live.deletedAt && !live.deleted) {
    return { surveyMarkers, markerId, marker: live, alreadyPresent: true };
  }
  // Clear the "received by Excel" stamp so the received-only import guard
  // protects the restored marker until it is exported again.
  const { exportedAt, exportAckEtag, ...rest } = surveyMarker || {};
  const restored = { ...rest, restoredAt: restoredAt || null };
  return {
    surveyMarkers: { ...(surveyMarkers || {}), [markerId]: restored },
    markerId,
    marker: restored,
  };
}

/** Convenience: is this restored marker currently protected from Excel delete? */
export function isProtectedFromExcelDelete(marker) {
  return !wasReceivedByExcel(marker);
}
