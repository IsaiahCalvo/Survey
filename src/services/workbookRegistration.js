// workbookRegistration.js — KAL-307: server-minted workbook registration.
//
// Governing spec: PLAN-EXCEL-SECURITY-V1.md step 1.
//
// Responsibilities:
//   • registerWorkbook()   — calls kal307_register_workbook RPC; returns the
//                            server-minted { workbookId, syncToken } pair.
//                            The raw syncToken is returned ONCE and must be
//                            embedded in the workbook by the caller immediately.
//                            It must NEVER be logged, stored in localStorage,
//                            or kept in memory beyond the export operation.
//   • detectLegacyWorkbook() — inspects _SurveyMetadata cells to determine
//                              whether a workbook pre-dates registration.
//                              Returns a status string the import path can read.
//                              Does NOT build the full preflight/quarantine UX
//                              (that ships with slice 2's gate flip).
//
// PDFViewer.jsx calls registerWorkbook() at export time (minimal diff — no
// logic lives in PDFViewer itself).  The token is embedded into cells
// A5/B5 (workbook_id) and A6/B6 (sync_token) on the _SurveyMetadata sheet.

import { supabase } from '../supabaseClient.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cell addresses on the _SurveyMetadata sheet used to embed workbook identity. */
export const WORKBOOK_REGISTRATION_CELLS = {
  WORKBOOK_ID_LABEL: 'A5',
  WORKBOOK_ID_VALUE: 'B5',
  SYNC_TOKEN_LABEL:  'A6',
  SYNC_TOKEN_VALUE:  'B6',
};

/** Status values returned by detectLegacyWorkbook(). */
export const WORKBOOK_REGISTRATION_STATUS = {
  /** Workbook carries registration metadata — it was exported by a V1+ build. */
  REGISTERED: 'registered',
  /** Workbook has no registration metadata — it is a legacy pre-V1 export. */
  UNREGISTERED_LEGACY: 'unregistered-legacy',
  /** Could not determine registration status (e.g. no _SurveyMetadata sheet). */
  UNKNOWN: 'unknown',
};

// ---------------------------------------------------------------------------
// registerWorkbook
// ---------------------------------------------------------------------------

/**
 * Calls the kal307_register_workbook Postgres RPC to mint a server-side
 * workbook registration.  Returns { workbookId, syncToken }.
 *
 * SECURITY CONTRACT:
 *   • syncToken is the RAW token, returned ONCE by the server.
 *   • Embed it in the workbook immediately and discard the reference.
 *   • Never log, store in localStorage, or keep in state beyond the export.
 *
 * @param {{
 *   documentId:      string,   — Supabase document UUID
 *   templateId:      string,   — template supabaseId / local id
 *   graphDriveId?:   string|null,  — sharePointDriveId (business exports)
 *   graphItemId?:    string|null,  — oneDriveFileId   (business exports)
 *   capabilityTier?: 'local'|'personal'|'business',
 *   supabaseClient?: object,   — override for tests (default: module-level supabase)
 * }} opts
 * @returns {Promise<{ workbookId: string, syncToken: string }>}
 * @throws if the RPC fails or returns no data
 */
export async function registerWorkbook({
  documentId,
  templateId,
  graphDriveId  = null,
  graphItemId   = null,
  capabilityTier = 'local',
  supabaseClient,
}) {
  if (!documentId) throw new Error('registerWorkbook: documentId required');
  if (!templateId) throw new Error('registerWorkbook: templateId required');

  const client = supabaseClient ?? supabase;
  if (!client) throw new Error('registerWorkbook: Supabase client not available');

  const { data, error } = await client.rpc('kal307_register_workbook', {
    p_document_id:     documentId,
    p_template_id:     templateId,
    p_graph_drive_id:  graphDriveId  ?? null,
    p_graph_item_id:   graphItemId   ?? null,
    p_capability_tier: capabilityTier,
  });

  if (error) {
    const err = new Error(`registerWorkbook: ${error.message}`);
    err.code     = error.code;
    err.details  = error.details;
    err.hint     = error.hint;
    throw err;
  }

  // Supabase returns RPC TABLE results as an array; we expect exactly one row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.workbook_id || !row?.sync_token) {
    throw new Error('registerWorkbook: RPC returned unexpected shape — missing workbook_id or sync_token');
  }

  return {
    workbookId: row.workbook_id,
    syncToken:  row.sync_token,
  };
}

// ---------------------------------------------------------------------------
// embedRegistrationIntoMetaSheet
// ---------------------------------------------------------------------------

/**
 * Writes workbookId and syncToken into the _SurveyMetadata sheet of an
 * ExcelJS Worksheet object.  Called by the export handler after registerWorkbook().
 *
 * SECURITY: syncToken must NOT be retained by the caller after this call.
 *
 * @param {object}  metaSheet  — ExcelJS Worksheet for _SurveyMetadata
 * @param {string}  workbookId
 * @param {string}  syncToken
 */
export function embedRegistrationIntoMetaSheet(metaSheet, workbookId, syncToken) {
  const c = WORKBOOK_REGISTRATION_CELLS;
  metaSheet.getCell(c.WORKBOOK_ID_LABEL).value = 'workbook_id';
  metaSheet.getCell(c.WORKBOOK_ID_VALUE).value  = workbookId;
  metaSheet.getCell(c.SYNC_TOKEN_LABEL).value   = 'sync_token';
  metaSheet.getCell(c.SYNC_TOKEN_VALUE).value   = syncToken;
}

// ---------------------------------------------------------------------------
// detectLegacyWorkbook
// ---------------------------------------------------------------------------

/**
 * Inspects a parsed _SurveyMetadata sheet (or a flat key→value map) to
 * determine whether a workbook pre-dates V1 registration.
 *
 * Does NOT build the full preflight/quarantine UX — that lands with slice 2's
 * gate flip.  Returns a status string the import path can read today.
 *
 * @param {{
 *   workbookId?: string|null,
 *   syncToken?:  string|null,
 * }|null} metadataValues — values read from _SurveyMetadata cells B5/B6,
 *                           or null/undefined if the sheet was missing entirely.
 * @returns {'registered'|'unregistered-legacy'|'unknown'}
 */
export function detectLegacyWorkbook(metadataValues) {
  if (metadataValues == null) {
    return WORKBOOK_REGISTRATION_STATUS.UNKNOWN;
  }

  const hasWorkbookId = typeof metadataValues.workbookId === 'string'
    && metadataValues.workbookId.startsWith('wb_')
    && metadataValues.workbookId.length > 4;

  const hasSyncToken = typeof metadataValues.syncToken === 'string'
    && metadataValues.syncToken.startsWith('st_')
    && metadataValues.syncToken.length > 4;

  if (hasWorkbookId && hasSyncToken) {
    return WORKBOOK_REGISTRATION_STATUS.REGISTERED;
  }

  // Either the metadata sheet was present but had no registration cells,
  // or the cells were present but malformed — treat as legacy.
  // TODO (slice 2): when the gate flip lands, route this status into the
  //   preflight/quarantine UX (one-time re-export/re-link prompt).
  return WORKBOOK_REGISTRATION_STATUS.UNREGISTERED_LEGACY;
}

// ---------------------------------------------------------------------------
// readRegistrationFromMetaSheet
// ---------------------------------------------------------------------------

/**
 * Reads workbookId and syncToken from _SurveyMetadata cell values.
 * Used by the import path (and detectLegacyWorkbook) to inspect an
 * already-parsed sheet.
 *
 * @param {object|null} metaSheetValues — object with cell address keys,
 *   e.g. from ExcelJS sheet.getCell('B5').value, or a plain {B5, B6} map.
 *   Accepts either { B5: ..., B6: ... } (cell-address style) or a pre-parsed
 *   { workbook_id: ..., sync_token: ... } flat map.
 * @returns {{ workbookId: string|null, syncToken: string|null }}
 */
export function readRegistrationFromMetaSheet(metaSheetValues) {
  if (!metaSheetValues) return { workbookId: null, syncToken: null };

  // Support the flat parsed style the import path already uses for other cells.
  const workbookId = metaSheetValues.workbook_id
    ?? metaSheetValues.workbookId
    ?? metaSheetValues[WORKBOOK_REGISTRATION_CELLS.WORKBOOK_ID_VALUE]
    ?? null;

  const syncToken = metaSheetValues.sync_token
    ?? metaSheetValues.syncToken
    ?? metaSheetValues[WORKBOOK_REGISTRATION_CELLS.SYNC_TOKEN_VALUE]
    ?? null;

  return {
    workbookId: typeof workbookId === 'string' ? workbookId : null,
    syncToken:  typeof syncToken  === 'string' ? syncToken  : null,
  };
}
