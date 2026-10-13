/**
 * excelSyncDirtyState.js — computes a fingerprint of the template's Excel-sync
 * identity plus survey markers to detect pending changes against a baseline.
 *
 * Exports computeExcelSyncFingerprint (FNV-1a hash of template link identity +
 * surveyMarkers) and computeHasPendingExcelSyncChanges (true when a linked Excel
 * exists and the current hash differs from baselineHash). Used to drive the
 * Excel-link dirty/save state.
 * Part of the separate survey-marker pipeline — see docs/ANNOTATION-CONTRACT.md.
 */
import { EXPORT_ACK_FIELDS } from '../services/excelExportAck.js';

// Export-acknowledgment fields are sync bookkeeping, not user content. Strip them
// before hashing so stamping a marker as "exported" never makes a freshly-synced
// survey read as having pending changes again.
const stripAckFields = (surveyMarkers = {}) => {
  const out = {};
  for (const [key, marker] of Object.entries(surveyMarkers || {})) {
    if (!marker || typeof marker !== 'object') {
      out[key] = marker;
      continue;
    }
    const copy = { ...marker };
    for (const field of EXPORT_ACK_FIELDS) delete copy[field];
    // w53: a marker's place in its page's stacking order (surveyMarkerFamily
    // .js `stack`) is canvas-only — never an Excel column — so restacking a
    // Survey Marker must not make the linked workbook read "not synced".
    delete copy.stack;
    // Owner ruling 2026-09-28: the user lock and the "picked up by Cut" flag
    // are canvas-only too — not Excel columns.
    delete copy.lockedBy;
    delete copy.unplacedByCut;
    out[key] = copy;
  }
  return out;
};

const hashString = (value = '') => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const getTemplateSyncIdentity = (template) => ({
  templateId: template?.supabaseId || template?.id || null,
  linkedExcelPath: template?.linkedExcelPath || null,
  oneDriveApiPath: template?.oneDriveApiPath || null,
  oneDriveFileId: template?.oneDriveFileId || null
});

export const computeExcelSyncFingerprint = (template, surveyMarkers = {}) => {
  const payload = {
    template: getTemplateSyncIdentity(template),
    surveyMarkers: stripAckFields(surveyMarkers)
  };
  const serialized = JSON.stringify(payload);
  return {
    hash: hashString(serialized),
    serialized
  };
};

export const computeHasPendingExcelSyncChanges = ({
  template,
  surveyMarkers,
  baselineHash
}) => {
  if (!template?.linkedExcelPath) {
    return false;
  }

  if (!baselineHash) {
    return true;
  }

  const current = computeExcelSyncFingerprint(template, surveyMarkers);
  return current.hash !== baselineHash;
};
