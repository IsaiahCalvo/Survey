// src/services/excelIdentityRecord.js
//
// The durable per-marker identity record stamped at EXPORT (STAGE1-IDENTITY-PLAN.md,
// "Export" step 2). When a Survey Marker is actually written as a row in the linked
// workbook, we record the fingerprints of the EXACT visible values that row carries,
// keyed by the marker id. On the next import, rowImportMatcher reads these records
// (its `stored` input) to recover a blank/lost Row ID by content and to detect which
// fields changed since the last export.
//
// Critical invariant: the fingerprints here MUST be computed from the same visible
// strings the importer will read back out of the cells (e.g. the formatted MM/DD/YYYY
// date string, the 'Y'/'N'/'N/A' selection). The caller passes the values exactly as
// written to the sheet so export-side and import-side fingerprints agree.
//
// These fields are sync bookkeeping, not user content, so `excelSync` is listed in
// excelExportAck.EXPORT_ACK_FIELDS and stripped from the Excel-sync dirty fingerprint —
// stamping a record must never make a freshly-synced survey read as unsynced again.

import { computeRowFingerprints } from './rowFingerprint.js';

export const IDENTITY_RECORD_VERSION = 'v1';

/**
 * Build one marker's identity record from the exact visible values written to its row.
 * @param {object} params
 * @param {{changedBy, changedDate, item, entity, notes, answers}} params.values
 *        answers: { [checklistItemId]: visibleSelection }
 * @param {string|null} [params.exportId]  id/clock of the export that wrote this row
 * @returns {Promise<{version, lastExportId, wasWrittenAsRow, identityVectorFingerprint,
 *           fullRowFingerprint, fieldFingerprints}>}
 */
export const buildMarkerIdentityRecord = async ({ values, exportId = null } = {}) => {
  const fp = await computeRowFingerprints(values || {});
  return {
    version: IDENTITY_RECORD_VERSION,
    lastExportId: exportId,
    wasWrittenAsRow: true,
    identityVectorFingerprint: fp.identityVectorFingerprint,
    fullRowFingerprint: fp.fullRowFingerprint,
    fieldFingerprints: fp.fieldFingerprints
  };
};

/**
 * Build identity records for many markers in parallel.
 * @param {object} params
 * @param {Array<{markerId:string, values:object}>} params.rows  one entry per written row
 * @param {string|null} [params.exportId]
 * @returns {Promise<Object<string, object>>}  keyed by markerId
 */
export const buildMarkerIdentityRecords = async ({ rows = [], exportId = null } = {}) => {
  const entries = await Promise.all(
    rows
      .filter((r) => r && r.markerId)
      .map(async (r) => [r.markerId, await buildMarkerIdentityRecord({ values: r.values, exportId })])
  );
  return Object.fromEntries(entries);
};

/**
 * Return a NEW survey-marker map with each marker's `excelSync` set from records.
 * Markers absent from `recordsByMarkerId` are returned unchanged. Pure — the input
 * map is not mutated.
 * @param {object} surveyMarkers  keyed marker map
 * @param {Object<string, object>} recordsByMarkerId
 * @returns {object} new keyed marker map
 */
export const applyMarkerIdentityRecords = (surveyMarkers = {}, recordsByMarkerId = {}) => {
  const out = {};
  for (const [key, marker] of Object.entries(surveyMarkers || {})) {
    if (marker && typeof marker === 'object' && recordsByMarkerId[key]) {
      out[key] = { ...marker, excelSync: recordsByMarkerId[key] };
    } else {
      out[key] = marker;
    }
  }
  return out;
};
