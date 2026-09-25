// src/services/excelExportAck.js
//
// Export-acknowledgment metadata. When a survey is successfully exported to its
// linked Excel workbook, every marker that was written is stamped with an
// `exportedAt` timestamp (and, when available, the file's `exportAckEtag`). This
// is the durable record of "this marker was actually received by Excel."
//
// It is the prerequisite for the received-only delete rule (PLAN.md Amendment
// #1): Excel may later delete only a marker it previously received — a marker
// the app made but never successfully exported (no `exportedAt`) can never be
// erased by a missing Excel row. The actual delete enablement waits for Stage 2
// (recoverable tombstones); this slice only lands the trustworthy signal.
//
// These fields are sync bookkeeping, not user content, so they are excluded from
// the Excel-sync dirty fingerprint (see excelSyncDirtyState.js) — stamping them
// must never make a freshly-synced survey look unsynced again.

// `excelSync` is the durable per-marker identity record stamped at export
// (excelIdentityRecord.js) — fingerprints + last-export id used by the import
// matcher. Like the ack timestamp it is sync bookkeeping, not user content, so it
// is stripped from the dirty fingerprint: stamping it must never make a freshly
// synced survey read as having pending changes again.
export const EXPORT_ACK_FIELDS = Object.freeze(['exportedAt', 'exportAckEtag', 'excelSync']);

/**
 * Return a new survey-marker map with every marker stamped as exported.
 *
 * @param {object} surveyMarkers  keyed marker map
 * @param {{ exportedAt: string, eTag?: string|null }} opts  exportedAt is required
 *        (callers pass an ISO timestamp; this module does not read the clock so it
 *        stays deterministic/testable)
 * @returns {object}  a new map; original is not mutated
 */
export function stampExportAck(surveyMarkers, { exportedAt, eTag = null } = {}) {
  const out = {};
  if (!surveyMarkers || typeof surveyMarkers !== 'object') return out;
  for (const [key, marker] of Object.entries(surveyMarkers)) {
    out[key] = { ...marker, exportedAt, exportAckEtag: eTag };
  }
  return out;
}

/**
 * True when a marker has been successfully exported to Excel at least once
 * (and is therefore eligible, later, for an Excel-origin delete).
 *
 * @param {object} marker
 * @returns {boolean}
 */
export function wasReceivedByExcel(marker) {
  return Boolean(marker && marker.exportedAt);
}

// An upload acknowledges the captured export, not edits made while it was in
// flight. Keep current content, never revive deleted markers or stamp new ones.
export function mergeExportAck(currentMarkers, exportedMarkers, { exportedAt, identityRecords = {} }) {
  const next = { ...currentMarkers };
  for (const key of Object.keys(exportedMarkers || {})) {
    if (!next[key]) continue;
    next[key] = { ...next[key], exportedAt, exportAckEtag: null };
    if (identityRecords?.[key]) next[key].excelSync = identityRecords[key];
  }
  return next;
}

export function excelExportScope(documentScope, template) {
  return JSON.stringify([documentScope, template?.supabaseId || template?.id || null,
    template?.linkedExcelPath || null, template?.oneDriveFileId || null,
    template?.sharePointDriveId || null]);
}
