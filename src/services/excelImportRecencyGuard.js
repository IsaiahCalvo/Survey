// src/services/excelImportRecencyGuard.js
//
// The stale / export-clock guard (PLAN.md open item 9; STAGE1-IDENTITY-PLAN.md
// "Step 0 — stale / recency gate"): an OLDER Excel workbook must never silently
// overwrite newer in-app Survey Marker work.
//
// The clock already exists on both sides — every export writes the same ISO
// stamp into the workbook's very-hidden `_SurveyMetadata` sheet
// (`export_timestamp`) AND into each written marker's identity record
// (`excelSync.lastExportId`). This module compares the two at import time:
//
//   workbook stamp  <  app's latest export stamp  →  the file predates the
//   app's newest export (a restored / outdated copy) → 'stale-workbook'.
//
// Verdict semantics (consumed by the import executors in PDFViewer):
//   - current:              proceed as normal.
//   - stale-workbook:       AUTO imports refuse outright (no writes); a MANUAL
//                           pull asks the user first, and even an accepted
//                           stale import never deletes anything.
//   - missing-export-clock: the workbook carries no readable stamp (foreign or
//                           hand-built file). Recency is untrusted → AUTO
//                           imports refuse; a manual pull may proceed (Step 0:
//                           "the user may still accept a manual import").
//   - no-app-clock:         the app has never exported this survey, so there is
//                           nothing to be stale against → guard abstains.
//
// Both stamps are written by THIS app from the SAME clock during one export
// pass, so comparing them is skew-free for current exports. A small tolerance
// absorbs the few seconds of write-skew in workbooks produced by older app
// versions (which stamped the metadata sheet and the identity records with two
// separate Date reads).
//
// Pure module: no React, no ExcelJS import (the workbook reader is duck-typed),
// no wall-clock reads — fully unit-testable.

export const RECENCY = Object.freeze({
  CURRENT: 'current',
  STALE_WORKBOOK: 'stale-workbook',
  MISSING_EXPORT_CLOCK: 'missing-export-clock',
  NO_APP_CLOCK: 'no-app-clock'
});

// Absorbs legacy two-Date-reads write skew within one export; far below any
// real "restored an old copy" gap.
export const RECENCY_TOLERANCE_MS = 120000;

const META_SHEET_NAME = '_SurveyMetadata';
const META_STAMP_KEY = 'export_timestamp';
const META_SCAN_ROWS = 10; // the stamp lives at A3/B3; scan a few rows to be safe

const parseStampMs = (stamp) => {
  if (stamp == null) return null;
  if (stamp instanceof Date) {
    const ms = stamp.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const text = String(stamp).trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Read the export stamp out of a loaded ExcelJS workbook's `_SurveyMetadata`
 * sheet. Duck-typed (only `getWorksheet` + `getCell` are used) so tests can
 * pass a stub. Returns the stamp as an ISO-ish string, or null when the sheet,
 * row, or value is missing/unreadable.
 */
export const readWorkbookExportStamp = (workbook) => {
  try {
    const sheet = workbook?.getWorksheet?.(META_SHEET_NAME);
    if (!sheet) return null;
    for (let rowNum = 1; rowNum <= META_SCAN_ROWS; rowNum += 1) {
      const key = sheet.getCell?.(`A${rowNum}`)?.value;
      if (key != null && String(key).trim() === META_STAMP_KEY) {
        const value = sheet.getCell(`B${rowNum}`)?.value;
        if (value == null) return null;
        if (value instanceof Date) return value.toISOString();
        const text = String(value).trim();
        return text || null;
      }
    }
    return null;
  } catch {
    return null; // unreadable metadata is the same as no clock
  }
};

/**
 * The app side of the clock: the newest export stamp any Survey Marker carries.
 * Prefers the identity record's `lastExportId` (same string the workbook got);
 * falls back to the export ack's `exportedAt`. Returns the winning stamp string
 * or null when nothing was ever exported.
 */
export const latestAppExportStamp = (surveyMarkers) => {
  let bestMs = null;
  let bestStamp = null;
  for (const marker of Object.values(surveyMarkers || {})) {
    if (!marker || typeof marker !== 'object') continue;
    for (const candidate of [marker.excelSync?.lastExportId, marker.exportedAt]) {
      const ms = parseStampMs(candidate);
      if (ms != null && (bestMs == null || ms > bestMs)) {
        bestMs = ms;
        bestStamp = String(candidate);
      }
    }
  }
  return bestStamp;
};

/**
 * Compare the workbook's export stamp against the app's latest export stamp.
 * @returns {{verdict: string, blocksAutoImport: boolean, needsManualConfirm: boolean,
 *            workbookExportStamp: string|null, appExportStamp: string|null}}
 */
export const classifyWorkbookRecency = ({
  workbookExportStamp = null,
  appExportStamp = null,
  toleranceMs = RECENCY_TOLERANCE_MS
} = {}) => {
  const appMs = parseStampMs(appExportStamp);
  const wbMs = parseStampMs(workbookExportStamp);

  let verdict;
  if (appMs == null) {
    verdict = RECENCY.NO_APP_CLOCK; // never exported → nothing to be stale against
  } else if (wbMs == null) {
    verdict = RECENCY.MISSING_EXPORT_CLOCK;
  } else if (wbMs + toleranceMs < appMs) {
    verdict = RECENCY.STALE_WORKBOOK;
  } else {
    verdict = RECENCY.CURRENT;
  }

  return {
    verdict,
    blocksAutoImport: verdict === RECENCY.STALE_WORKBOOK || verdict === RECENCY.MISSING_EXPORT_CLOCK,
    needsManualConfirm: verdict === RECENCY.STALE_WORKBOOK,
    workbookExportStamp: wbMs == null ? null : new Date(wbMs).toISOString(),
    appExportStamp: appMs == null ? null : new Date(appMs).toISOString()
  };
};

// Plain-English surfaces (the user reads these — keep them developer-free).
export const staleAutoSkipMessage = (verdict) =>
  verdict === RECENCY.MISSING_EXPORT_CLOCK
    ? 'Excel file has no sync stamp — auto-sync skipped. Pull from Excel to import it.'
    : 'Excel file looks older than your latest export — auto-sync skipped. Pull from Excel to review it.';

export const staleManualConfirmText = () =>
  'This Excel file appears OLDER than your latest export from the app — it may be a restored or outdated copy.\n\n' +
  'Importing will change items back to the older values in this file. Nothing will be deleted, and rows that need attention will be flagged for review.\n\n' +
  'Import anyway?';
