// src/services/rowIdLocalWriteback.js
//
// The LOCAL-file "Excel is closed" Row ID flush (PLAN.md Amendment 2026-06-08(b)
// step 3, HANDOFF item 3b) — the local counterpart of rowIdGraphWriteback.js.
//
// A local .xlsx must NEVER be written while desktop Excel has it open (macOS
// Excel autosave silently clobbers a write-under-open — research-verified, see
// the capability matrix). So queued Row IDs flush to a local workbook only when
// the Amendment's multi-signal "Excel is closed" judgment passes, and every
// refusal leaves the queue intact. The three signals, mapped to this module:
//
//   SIGNAL 1 — the `~$file.xlsx` owner/lock sentinel (excelLockFile.js), checked
//              BEFORE reading and re-checked immediately before the write.
//              Unlike the manual-export path (which falls through to the user's
//              own explicit write on probe errors), an undeterminable open-state
//              here FAILS CLOSED: the flush is opportunistic, so "uncertain"
//              means "wait for a manual export" (Amendment: "failing to manual
//              export when uncertain").
//   SIGNAL 2 — file mtime+size stability across the whole read→modify→write
//              window (any concurrent writer aborts the flush before we write).
//   SIGNAL 3 — the write/readback probe: the flush itself re-reads the file
//              after writing and clears an entry ONLY when its cell reads back
//              equal to the assigned token (Codex R1).
//
// The export-clock guard is reused as the drift rail (same rail the auto-import
// executors use): the workbook's `_SurveyMetadata` export stamp is classified
// against the app's latest export stamp via classifyWorkbookRecency, and any
// verdict that would block an auto-import (stale workbook, missing clock while
// the app has one) refuses the flush outright — we never write into a file we
// would refuse to ingest.
//
// The write itself is SURGICAL: the existing workbook is loaded with exceljs
// (NEVER the rebuild exporter — an export is a whole-file replacement and the
// Amendment forbids treating it as a flush when unsafe), only column-A cells
// with a verified precondition are changed (cell still holds the queue entry's
// expectedOldCellValue, or already holds the token — idempotent), plus the
// `_SurveyMetadata` export stamp when one already exists. exceljs re-serializes
// the container on save — the same class of write every app export performs —
// which is why the lock sentinel + stamp guard + mtime stability MUST all pass
// first. Cells we cannot account for are refused per entry ('stale-locator',
// re-queued for the alias slice to re-locate) and are never overwritten.
//
// Result shape mirrors drainRowIdWritebackQueue (rowIdGraphWriteback.js) so the
// same UI vocabulary (excelSyncStatus.rowIdWritebackMessage) and identity-record
// stamping (excelIdentityRecord.applyWritebackVerification) serve both drains.
//
// This module is renderer-agnostic: every filesystem touch goes through an
// injected `fs` facade (window.electronAPI in production; in-memory fakes in
// tests). No Graph calls, no React, no direct fs/electron imports.

import { excelLockFilePath, isOwnerFileFor, parentDir } from './excelLockFile.js';
import {
  classifyWorkbookRecency,
  readWorkbookExportStamp,
  META_SHEET_NAME,
  META_STAMP_KEY,
  META_SCAN_ROWS
} from './excelImportRecencyGuard.js';
import { rowIdCellAddress, resolveEntryRowNumber } from './rowIdGraphWriteback.js';
import {
  listWriteback,
  enqueueWriteback,
  clearWriteback,
  countWriteback
} from './rowIdWritebackQueue.js';

const REQUIRED_FS_METHODS = ['fileExists', 'listDir', 'readFile', 'writeFile', 'getFileStats'];

/**
 * Normalize an exceljs cell value for token comparison. Plain strings trim;
 * blank/null/undefined are all ''. Rich text flattens to its concatenated text;
 * a formula compares by its cached result. Anything else (dates, unknown cell
 * objects) stringifies — which will simply fail the precondition and refuse the
 * write, the safe outcome for a cell we cannot account for.
 */
export const normalizeWorkbookCellValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && !(value instanceof Date)) {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => (part && part.text != null ? String(part.text) : '')).join('').trim();
    }
    if ('result' in value || 'formula' in value) {
      return value.result == null ? '' : String(value.result).trim();
    }
  }
  return String(value).trim();
};

/**
 * SIGNAL 1 — is the workbook open in desktop Excel right now?
 * Primary probe: the exact `~$<file>` lock path. Fallback: list the parent
 * directory and match the owner file for THIS workbook only (a stray
 * `~$Budget.xlsx` next door must not block). Probe failures return 'unknown' —
 * the caller fails CLOSED on anything but 'closed'.
 * @returns {Promise<'open'|'closed'|'unknown'>}
 */
export async function detectExcelOpenState(fsApi, filePath) {
  const lockPath = excelLockFilePath(filePath);
  if (!lockPath) return 'unknown';
  try {
    if (await fsApi.fileExists(lockPath)) return 'open';
  } catch {
    // fall through to the directory listing
  }
  try {
    const entries = await fsApi.listDir(parentDir(filePath));
    if (!Array.isArray(entries)) return 'unknown';
    return entries.some((name) => isOwnerFileFor(name, filePath)) ? 'open' : 'closed';
  } catch {
    return 'unknown';
  }
}

/** SIGNAL 2 — an opaque mtime+size signature; null when it cannot be read. */
const statSignature = async (fsApi, filePath) => {
  try {
    const stats = await fsApi.getFileStats(filePath);
    if (!stats || stats.isFile === false) return null;
    const mtime = stats.mtime ?? stats.mtimeMs ?? null;
    if (mtime == null) return null;
    return `${mtime}|${stats.size ?? ''}`;
  } catch {
    return null;
  }
};

/** Refresh the existing `_SurveyMetadata` export stamp; returns the stamp or null. */
const refreshExportStamp = (workbook, stamp) => {
  const sheet = workbook.getWorksheet?.(META_SHEET_NAME);
  if (!sheet) return null;
  for (let rowNum = 1; rowNum <= META_SCAN_ROWS; rowNum += 1) {
    const key = sheet.getCell(`A${rowNum}`)?.value;
    if (key != null && String(key).trim() === META_STAMP_KEY) {
      sheet.getCell(`B${rowNum}`).value = stamp;
      return stamp;
    }
  }
  return null; // no stamp row → nothing to refresh (only reachable when the app has no clock either)
};

/**
 * Drain this document's Row ID writeback queue into a LOCAL workbook — the
 * "Excel is closed" flush of Amendment (b) step 3. Triggered opportunistically
 * (after an app export through the safe local path, and after a watcher-driven
 * ingest settles); every refusal path leaves the queue intact and the file
 * untouched.
 *
 * Gating order (zero filesystem calls until a real flush is possible):
 *   1. no documentId → 'no-document'; no entries for THIS workbook → 'empty'
 *   2. missing filePath / fs facade → 'not-ready'
 *   3. lock sentinel says open → 'excel-open'; undeterminable → 'unsafe-unknown'
 *   4. unreadable stats → 'unsafe-unknown'
 *   5. export-clock guard refuses (stale / missing stamp) → 'workbook-drifted'
 *   6. file changed between read and write → 'drifted-during-flush'
 *
 * Per entry: precondition check against the freshly-read workbook (already
 * token → idempotent confirm; expectedOldCellValue → write; anything else →
 * 'stale-locator' re-queue, never overwritten). One buffered write covers all
 * eligible cells; the READ-BACK then re-reads the file from disk and clears
 * ONLY read-back-confirmed entries. Mismatches re-queue ('verify-failed') and
 * the pass reports 'stopped-verify-mismatch'. Nothing is ever deleted from the
 * workbook, and a queue entry is never dropped without verification.
 *
 * @param {object} params
 * @param {string} params.documentId       rowIdWritebackQueue scope (the PDF document id)
 * @param {string} params.filePath         absolute path of the linked LOCAL workbook
 * @param {string|null} [params.appExportStamp]  latestAppExportStamp(surveyMarkers)
 * @param {object} params.fs               { fileExists, listDir, readFile, writeFile,
 *                                           getFileStats } — window.electronAPI in prod
 * @param {object} [params.storage]        injectable localStorage (tests)
 * @param {function} [params.now]          ISO timestamp source (stamp + lastAttemptAt)
 * @returns {Promise<{status:string, attempted:number, verified:number, requeued:number,
 *           skipped:number, remaining:number, markerUpdates:Array, wrote:boolean,
 *           flushStamp:?string, reason?:string, errorMessage?:string}>}
 */
export async function drainRowIdWritebackQueueLocal({
  documentId = null,
  filePath = null,
  appExportStamp = null,
  fs: fsApi = null,
  storage = undefined,
  now = () => new Date().toISOString()
} = {}) {
  const result = {
    status: 'completed',
    attempted: 0,
    verified: 0,
    requeued: 0,
    skipped: 0,
    remaining: 0,
    markerUpdates: [],
    wrote: false,
    flushStamp: null
  };
  const finish = (status, extra = {}) => {
    result.status = status;
    result.remaining = documentId ? countWriteback(documentId, storage) : 0;
    return Object.assign(result, extra);
  };

  if (!documentId) return finish('no-document');

  // Entries for THIS workbook only: an entry stamped with a path must match the
  // linked path exactly; an entry carrying a Graph workbookId belongs to the
  // business-Graph drain. Foreign entries stay queued, untouched.
  const allEntries = listWriteback(documentId, storage);
  const entries = allEntries.filter((e) => (e?.path ? e.path === filePath : !e?.workbookId));
  if (entries.length === 0) return finish('empty');

  const fsReady = fsApi && REQUIRED_FS_METHODS.every((k) => typeof fsApi[k] === 'function');
  if (!filePath || !fsReady) return finish('not-ready');

  // SIGNAL 1 — fail CLOSED on anything but a provably-closed Excel.
  const openState = await detectExcelOpenState(fsApi, filePath);
  if (openState === 'open') return finish('excel-open');
  if (openState !== 'closed') return finish('unsafe-unknown');

  // SIGNAL 2 baseline — unreadable stats means we cannot judge stability.
  const statBefore = await statSignature(fsApi, filePath);
  if (!statBefore) return finish('unsafe-unknown');

  let ExcelJS;
  let workbook;
  try {
    const fileData = await fsApi.readFile(filePath);
    ExcelJS = (await import('exceljs')).default;
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileData);
  } catch (err) {
    return finish('stopped-error', { errorMessage: err?.message });
  }

  // Export-clock drift rail — the SAME verdict the auto-import executors obey.
  // A workbook we would refuse to ingest is a workbook we refuse to write.
  const recency = classifyWorkbookRecency({
    workbookExportStamp: readWorkbookExportStamp(workbook),
    appExportStamp
  });
  if (recency.blocksAutoImport) return finish('workbook-drifted', { reason: recency.verdict });

  // Plan every cell op against the freshly-read workbook. Nothing mutates yet.
  const planned = []; // { entry, token, sheetName, address, needsWrite }
  for (const entry of entries) {
    const rowNumber = resolveEntryRowNumber(entry);
    const token = entry?.newToken == null ? '' : String(entry.newToken).trim();
    if (!entry?.markerId || !entry?.sheetName || !rowNumber || !token) {
      // Malformed entry: visible state change, never deleted, file untouched.
      enqueueWriteback(documentId, { ...entry, retryState: 'invalid-entry', lastAttemptAt: now() }, storage);
      result.skipped += 1;
      continue;
    }
    result.attempted += 1;
    const address = rowIdCellAddress(rowNumber);
    const sheet = workbook.getWorksheet(entry.sheetName);
    const current = sheet ? normalizeWorkbookCellValue(sheet.getCell(address).value) : null;
    if (current === token) {
      planned.push({ entry, token, sheetName: entry.sheetName, address, needsWrite: false });
      continue;
    }
    const expectedOld = normalizeWorkbookCellValue(entry.expectedOldCellValue ?? '');
    if (sheet && current === expectedOld) {
      planned.push({ entry, token, sheetName: entry.sheetName, address, needsWrite: true });
      continue;
    }
    // Sheet missing or the cell holds a value we cannot account for: the row
    // moved/sorted/edited since queueing. Never overwritten — re-queued for the
    // alias slice to re-locate.
    enqueueWriteback(documentId, { ...entry, retryState: 'stale-locator', lastAttemptAt: now() }, storage);
    result.requeued += 1;
  }

  const toWrite = planned.filter((p) => p.needsWrite);

  if (toWrite.length === 0) {
    // Nothing to write. Cells that already hold their token were just read from
    // disk — that read IS the read-back evidence — so those entries clear now.
    for (const p of planned) {
      clearWriteback(documentId, p.entry.markerId, storage);
      result.verified += 1;
      result.markerUpdates.push({ markerId: p.entry.markerId, assignedToken: p.token, pendingRowIdWriteback: false });
    }
    return finish('completed');
  }

  try {
    for (const p of toWrite) {
      const cell = workbook.getWorksheet(p.sheetName).getCell(p.address);
      cell.value = p.token;
      cell.numFmt = '@'; // Row ID column is text-formatted; keep the cell that way
    }
    // Refresh the export stamp (an app write of the linked workbook keeps the
    // export clock current; the stamp only ever moves FORWARD so subsequent
    // ingests classify as current, never stale).
    const flushStamp = refreshExportStamp(workbook, now());
    const outBuffer = await workbook.xlsx.writeBuffer();

    // Last-moment re-checks to shrink the race window. Both abort BEFORE the
    // write with the queue fully intact.
    const reOpenState = await detectExcelOpenState(fsApi, filePath);
    if (reOpenState !== 'closed') {
      return finish(reOpenState === 'open' ? 'excel-open' : 'unsafe-unknown');
    }
    const statNow = await statSignature(fsApi, filePath);
    if (!statNow || statNow !== statBefore) return finish('drifted-during-flush');

    await fsApi.writeFile(filePath, outBuffer);
    result.wrote = true;
    result.flushStamp = flushStamp;
  } catch (err) {
    return finish('stopped-error', { errorMessage: err?.message });
  }

  // SIGNAL 3 / READ-BACK — re-read the file from disk; ONLY a confirmed cell
  // match clears an entry (Codex R1). A failed re-read keeps everything queued.
  let verifyWorkbook;
  try {
    const verifyData = await fsApi.readFile(filePath);
    verifyWorkbook = new ExcelJS.Workbook();
    await verifyWorkbook.xlsx.load(verifyData);
  } catch (err) {
    // The write landed but the confirming re-read failed. Entries whose cells
    // ALREADY held their token before the write (needsWrite: false) were proven
    // by the pre-write disk read — and the buffer we just wrote carried those
    // cells through unchanged — so they clear on that evidence rather than
    // alarming the surveyor about tokens that were never in doubt. Cells we
    // actually wrote cannot be confirmed and re-queue ('verify-failed').
    for (const p of planned) {
      if (p.needsWrite) {
        enqueueWriteback(documentId, { ...p.entry, retryState: 'verify-failed', lastAttemptAt: now() }, storage);
        result.requeued += 1;
      } else {
        clearWriteback(documentId, p.entry.markerId, storage);
        result.verified += 1;
        result.markerUpdates.push({ markerId: p.entry.markerId, assignedToken: p.token, pendingRowIdWriteback: false });
      }
    }
    return finish('stopped-verify-mismatch', { errorMessage: err?.message });
  }

  let mismatched = 0;
  for (const p of planned) {
    const sheet = verifyWorkbook.getWorksheet(p.sheetName);
    const after = sheet ? normalizeWorkbookCellValue(sheet.getCell(p.address).value) : null;
    if (after === p.token) {
      clearWriteback(documentId, p.entry.markerId, storage);
      result.verified += 1;
      result.markerUpdates.push({ markerId: p.entry.markerId, assignedToken: p.token, pendingRowIdWriteback: false });
    } else {
      enqueueWriteback(documentId, { ...p.entry, retryState: 'verify-failed', lastAttemptAt: now() }, storage);
      result.requeued += 1;
      mismatched += 1;
    }
  }
  return finish(mismatched > 0 ? 'stopped-verify-mismatch' : 'completed');
}
