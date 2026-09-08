// src/services/rowIdGraphWriteback.js
//
// The business-Graph SINGLE-CELL Row ID writer + queue drain (PLAN.md Amendment
// 2026-06-08(b) step 3, HANDOFF item 3a/3c — Graph side).
//
// This is the NEW dedicated column-A patch writer the Amendment requires. It is
// deliberately NOT the existing whole-sheet `updateCellRange` caller in the export
// executor and NOT any full-file upload path (both are forbidden as Row ID flush
// paths — Codex R1). It writes EXACTLY ONE cell per call, under the drive-scoped
// workbook-session machinery, and every write is READ-BACK verified before the
// caller may clear the marker's pending state.
//
// Safety rules implemented here (the Amendment's text governs):
//   - PRE-CHECK before writing: the target cell must still hold the queue entry's
//     `expectedOldCellValue` (or already hold the token — idempotent re-drain).
//     Anything else means the row moved/sorted since the entry was queued
//     ("row locator instability") → do NOT write, keep the entry queued. We never
//     overwrite a value we cannot account for.
//   - READ-BACK after writing: the entry is cleared ONLY when the cell reads back
//     equal to the assigned token. A mismatch re-queues and STOPS the drain —
//     never a hot loop, never a destroyed queue entry.
//   - The drain runs ONLY when the capability classifier proves business-graph
//     eligibility AND the LIVE_WRITEBACK_ENABLED master gate is on. The gate is
//     OFF in production (excelCapability.js) until validated on a real Business
//     M365 account, so this module ships WIRED BUT DORMANT. Tests inject
//     `liveWritebackEnabled: true` to prove the active path; production callers
//     must NEVER pass that option.
//   - Errors abort the pass with the queue intact: 401/auth → surface reconnect;
//     409/423/locked → retry on a later pass; anything else → retry later.
//
// NO local-file writes live here — the local/personal "Excel closed" flush
// lives in rowIdLocalWriteback.js with its own multi-signal safety rules.

import { LIVE_WRITEBACK_ENABLED } from './excelCapability.js';
import {
  workbookItemBase,
  encodeGraphString,
  withWorkbookWrite,
  withoutGraphWriteRetry,
  createWorkbookSession,
  closeWorkbookSession
} from './excelSessionService.js';
import {
  listWriteback,
  enqueueWriteback,
  clearWriteback,
  countWriteback
} from './rowIdWritebackQueue.js';

// The app owns column A ("Row ID", hidden, text-formatted). The user never edits
// it, which is what makes a targeted single-cell PATCH non-conflicting in a live
// co-authored workbook.
export const ROW_ID_COLUMN = 'A';

// Per-pass batch cap. Each cell costs 3 Graph calls (pre-check GET, PATCH,
// read-back GET); 10 cells ≈ 30 calls under one session — bounded and polite.
// The remainder stays queued and is reported so the caller can log/schedule it.
export const DRAIN_MAX_PER_PASS = 10;

/** 'A<row>' for a positive integer 1-based row; null for anything else. */
export const rowIdCellAddress = (rowNumber) =>
  Number.isInteger(rowNumber) && rowNumber > 0 ? `${ROW_ID_COLUMN}${rowNumber}` : null;

/** Cells compare as trimmed strings; null/undefined/blank are all "empty". */
const normalizeCellValue = (value) => (value === null || value === undefined ? '' : String(value).trim());

/** Graph path for one column-A cell of one sheet, drive-scoped. */
const cellRangePath = (fileId, driveId, sheetName, address) =>
  `${workbookItemBase(fileId, driveId)}/workbook/worksheets('${encodeGraphString(sheetName)}')/range(address='${address}')`;

/**
 * Classify a Graph error for drain flow control.
 * @returns {'auth-expired'|'locked'|'error'}
 */
export const classifyGraphWritebackError = (error) => {
  const status = error?.statusCode ?? error?.status ?? null;
  const code = typeof error?.code === 'string' ? error.code : '';
  if (status === 401 || /InvalidAuthenticationToken|TokenExpired|unauthenticated/i.test(code)) {
    return 'auth-expired';
  }
  // Status codes 409/423 carry the lock semantics; the code regex is exact-match
  // on known Graph lock codes only — a loose /conflict/ substring would
  // misclassify unrelated 4xx/5xx codes or message words as 'locked'.
  if (status === 409 || status === 423 || /^(resourceLocked|lockMismatch|editConflict)$/i.test(code)) {
    return 'locked';
  }
  return 'error';
};

/**
 * Read one Row ID cell (column A) of one sheet. Read-only; used for the
 * pre-check and the read-back verification.
 * @returns {Promise<string>} the cell's value, normalized ('' when empty)
 */
export async function readRowIdCell(graphClient, { fileId, driveId, sessionId, sheetName, rowNumber }) {
  const address = rowIdCellAddress(rowNumber);
  if (!graphClient || !fileId || !sheetName || !address) {
    throw new Error('readRowIdCell: missing graphClient/fileId/sheetName/rowNumber');
  }
  const requestBuilder = graphClient.api(cellRangePath(fileId, driveId, sheetName, address));
  if (sessionId) requestBuilder.header('workbook-session-id', sessionId);
  const response = await requestBuilder.select('values').get();
  const rows = response?.values;
  if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]) || rows[0].length !== 1) {
    throw new Error('Invalid Row ID cell values; refusing to treat an unread cell as blank');
  }
  return normalizeCellValue(rows[0][0]);
}

/**
 * Write ONE marker's assigned Row ID token into its column-A cell, with
 * pre-check and read-back verification. Never touches any other cell.
 *
 * Outcomes (Graph errors are thrown, not returned — the drain classifies them):
 *   - 'verified'        the cell now provably equals the token (either it already
 *                       did — idempotent — or we wrote it and read it back).
 *   - 'stale-locator'   the cell holds neither the token nor the expected old
 *                       value: the row moved/sorted since queueing. NOT written.
 *   - 'verify-mismatch' we wrote, but the read-back differs (concurrent editor /
 *                       eventual consistency). The caller must keep the entry.
 *
 * @returns {Promise<{outcome:string, wrote:boolean, cellValue:string}>}
 */
export async function writeRowIdCellVerified(
  graphClient, options
) {
  if (!graphClient) throw new Error('writeRowIdCellVerified: missing graphClient');
  return withWorkbookWrite(graphClient, options?.fileId, options?.driveId, () => writeRowIdCellVerifiedNow(graphClient, options));
}

async function writeRowIdCellVerifiedNow(
  graphClient,
  { fileId, driveId, sessionId, sheetName, rowNumber, token, expectedOldCellValue = '', isCurrent = () => true }
) {
  const address = rowIdCellAddress(rowNumber);
  const newToken = normalizeCellValue(token);
  if (!graphClient || !fileId || !sheetName || !address || !newToken) {
    throw new Error('writeRowIdCellVerified: missing graphClient/fileId/sheetName/rowNumber/token');
  }

  // Recheck inside the workbook lock: a queued entry can be replaced while a
  // prior workbook request runs, or while our pre-check is in flight.
  if (!isCurrent()) return { outcome: 'superseded', wrote: false, cellValue: null };
  // PRE-CHECK — never write a cell we cannot account for.
  const before = await readRowIdCell(graphClient, { fileId, driveId, sessionId, sheetName, rowNumber });
  if (!isCurrent()) return { outcome: 'superseded', wrote: false, cellValue: before };
  if (before === newToken) {
    return { outcome: 'verified', wrote: false, cellValue: before }; // already landed (re-drain)
  }
  if (before !== normalizeCellValue(expectedOldCellValue)) {
    return { outcome: 'stale-locator', wrote: false, cellValue: before };
  }

  // The single-cell PATCH (a 1x1 range), under the workbook session when given.
  const requestBuilder = graphClient.api(cellRangePath(fileId, driveId, sheetName, address));
  if (sessionId) requestBuilder.header('workbook-session-id', sessionId);
  await withoutGraphWriteRetry(requestBuilder).patch({ values: [[newToken]] });

  // READ-BACK — the only thing that may clear pendingRowIdWriteback (Codex R1).
  const after = await readRowIdCell(graphClient, { fileId, driveId, sessionId, sheetName, rowNumber });
  if (after === newToken) {
    return { outcome: 'verified', wrote: true, cellValue: after };
  }
  return { outcome: 'verify-mismatch', wrote: true, cellValue: after };
}

/**
 * 1-based row number out of a queue entry's rowLocator (number or {rowNumber}).
 * Exported so the local flush (rowIdLocalWriteback.js) resolves entries with
 * IDENTICAL semantics — the queue schema must never fork between the drains.
 */
export const resolveEntryRowNumber = (entry) => {
  const direct = entry?.rowLocator;
  if (Number.isInteger(direct) && direct > 0) return direct;
  const nested = direct?.rowNumber;
  if (Number.isInteger(nested) && nested > 0) return nested;
  return null;
};

/**
 * Drain this document's Row ID writeback queue through the business-Graph
 * single-cell writer — the ONLY safe live flush path (Amendment (b) step 3).
 *
 * Gating (all checks make ZERO Graph calls when they refuse):
 *   1. empty queue → 'empty'
 *   2. capability must be business-graph eligible (`liveWritebackEligible`) →
 *      otherwise 'not-eligible' (local/personal NEVER flush here)
 *   3. LIVE_WRITEBACK_ENABLED master gate → otherwise 'gate-off'.
 *      `liveWritebackEnabled` is a TEST-ONLY injection point so the active path
 *      is provable with mocks; production callers must not pass it, which keeps
 *      the drain wired-but-dormant until the user flips the gate after a live
 *      pass on a real Business M365 account.
 *
 * Per entry: pre-check → single-cell PATCH → read-back. Success clears the
 * queue entry and emits a marker update ({markerId, assignedToken,
 * pendingRowIdWriteback:false}) for the caller to stamp onto the marker's
 * identity record. A stale locator or invalid entry re-queues and CONTINUES
 * (entry-specific, nothing was written). A read-back mismatch or any Graph
 * error re-queues (or leaves intact) and STOPS the pass — never a hot loop,
 * never a deleted entry without verification.
 *
 * @param {object} params
 * @param {object} params.graphClient
 * @param {string} params.documentId   rowIdWritebackQueue scope (the PDF document id)
 * @param {string} params.fileId       Graph item id of the linked workbook
 * @param {string} [params.driveId]    SharePoint/Teams drive id (omit for /me/drive)
 * @param {string|null} [params.sessionId]  existing workbook session; when absent the
 *        drain creates a per-flush persistent session and always closes it
 * @param {object|null} params.capability   verdict from classifyExcelCapability
 * @param {object} [params.storage]    injectable localStorage (tests)
 * @param {number} [params.maxPerPass]
 * @param {boolean} [params.liveWritebackEnabled]  TEST-ONLY — see gating note
 * @param {function} [params.now]      ISO timestamp source for lastAttemptAt
 * @returns {Promise<{status:string, attempted:number, verified:number, requeued:number,
 *           skipped:number, remaining:number, markerUpdates:Array, reason?:string,
 *           errorMessage?:string}>}
 */
export async function drainRowIdWritebackQueue({
  graphClient = null,
  documentId = null,
  fileId = null,
  driveId = undefined,
  sessionId = null,
  capability = null,
  storage = undefined,
  maxPerPass = DRAIN_MAX_PER_PASS,
  liveWritebackEnabled = LIVE_WRITEBACK_ENABLED,
  now = () => new Date().toISOString()
} = {}) {
  const result = {
    status: 'completed',
    attempted: 0,
    verified: 0,
    requeued: 0,
    skipped: 0,
    remaining: 0,
    markerUpdates: []
  };
  const finish = (status, extra = {}) => {
    result.status = status;
    result.remaining = documentId ? countWriteback(documentId, storage) : 0;
    return Object.assign(result, extra);
  };

  if (!documentId) return finish('no-document');

  // Entries for THIS workbook only: entries stamped with a different workbookId
  // (future multi-link safety) are left untouched and simply stay queued.
  const allEntries = listWriteback(documentId, storage);
  const entries = allEntries.filter((e) => !e?.workbookId || e.workbookId === fileId);
  if (entries.length === 0) return finish('empty');

  if (!capability?.liveWritebackEligible) {
    return finish('not-eligible', { reason: capability?.reason || 'unknown' });
  }
  if (!liveWritebackEnabled) return finish('gate-off');
  if (!graphClient || !fileId) return finish('not-ready');

  // Per-flush session when the caller doesn't already hold one (Amendment:
  // sessions are created per flush, not held across idle time).
  let activeSessionId = sessionId;
  let ownSession = false;
  if (!activeSessionId) {
    try {
      const session = await createWorkbookSession(graphClient, fileId, true, driveId);
      activeSessionId = session.sessionId;
      ownSession = true;
    } catch (sessionErr) {
      const kind = classifyGraphWritebackError(sessionErr);
      return finish(kind === 'auth-expired' ? 'auth-expired' : 'session-unavailable', {
        errorMessage: sessionErr?.message
      });
    }
  }

  try {
    const batch = entries.slice(0, maxPerPass);
    for (const entry of batch) {
      const isCurrentEntry = () => {
        const current = listWriteback(documentId, storage).find((row) => row?.markerId === entry?.markerId);
        return current && JSON.stringify(current) === JSON.stringify(entry);
      };
      if (!isCurrentEntry()) { result.skipped += 1; continue; }
      const rowNumber = resolveEntryRowNumber(entry);
      const token = normalizeCellValue(entry?.newToken);
      if (!entry?.markerId || !entry?.sheetName || !rowNumber || !token) {
        // Malformed entry: visible state change, never deleted, no Graph call.
        enqueueWriteback(documentId, { ...entry, retryState: 'invalid-entry', lastAttemptAt: now() }, storage);
        result.skipped += 1;
        continue;
      }

      result.attempted += 1;
      try {
        const write = await writeRowIdCellVerified(graphClient, {
          fileId,
          driveId,
          sessionId: activeSessionId,
          sheetName: entry.sheetName,
          rowNumber,
          token,
          expectedOldCellValue: entry.expectedOldCellValue,
          isCurrent: isCurrentEntry
        });

        // Import/relink may replace this entry while Graph is in flight. An
        // older verification must neither clear nor overwrite that newer work.
        if (!isCurrentEntry()) { result.skipped += 1; continue; }

        if (write.outcome === 'verified') {
          // READ-BACK confirmed — the one condition that clears the entry.
          if (!clearWriteback(documentId, entry.markerId, storage)) {
            return finish('stopped-error', { errorMessage: 'Could not persist verified Row ID queue acknowledgement' });
          }
          result.verified += 1;
          result.markerUpdates.push({
            markerId: entry.markerId,
            assignedToken: token,
            pendingRowIdWriteback: false
          });
          continue;
        }

        if (write.outcome === 'stale-locator') {
          // Row moved/sorted since queueing; nothing was written. Entry-specific —
          // keep it queued (slice 3's alias refresh re-locates it) and continue.
          enqueueWriteback(documentId, { ...entry, retryState: 'stale-locator', lastAttemptAt: now() }, storage);
          result.requeued += 1;
          continue;
        }

        // verify-mismatch: we wrote but could not confirm. Re-queue and STOP —
        // something is interfering with the cell; do not loop hot.
        enqueueWriteback(documentId, { ...entry, retryState: 'verify-failed', lastAttemptAt: now() }, storage);
        result.requeued += 1;
        return finish('stopped-verify-mismatch');
      } catch (err) {
        if (!isCurrentEntry()) { result.skipped += 1; continue; }
        const kind = classifyGraphWritebackError(err);
        if (kind === 'auth-expired') {
          // Token died mid-pass: surface reconnect, leave the entry EXACTLY as
          // it was (it never reached a write-confirmable state).
          return finish('auth-expired', { errorMessage: err?.message });
        }
        enqueueWriteback(documentId, { ...entry, retryState: 'retry-later', lastAttemptAt: now() }, storage);
        result.requeued += 1;
        return finish(kind === 'locked' ? 'stopped-locked' : 'stopped-error', { errorMessage: err?.message });
      }
    }
    return finish('completed');
  } finally {
    if (ownSession && activeSessionId) {
      // Best-effort close; closeWorkbookSession never throws.
      await closeWorkbookSession(graphClient, fileId, activeSessionId, driveId);
    }
  }
}
