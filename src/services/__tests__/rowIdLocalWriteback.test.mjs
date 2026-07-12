// Tests for the LOCAL-file "Excel is closed" Row ID flush
// (PLAN.md Amendment 2026-06-08(b) step 3; HANDOFF item 3b).
//
// Drives the REAL modules (flush, queue, recency guard, lock-file path math,
// identity-record stamping, status vocabulary) with REAL exceljs workbooks held
// behind an in-memory fs facade — no Graph, no Electron, fully headless.
// Covers: closed+clean flush with read-back verify + queue drain + identity
// updates + stamp refresh + non-column-A preservation; Excel-open refusal (lock
// sentinel via fileExists AND via the listDir fallback); export-clock drift
// refusal; verify-mismatch re-queue; mtime drift during the flush window;
// fail-closed unknown open-state; idempotent already-token clearing;
// stale-locator refusal; foreign-entry scoping; and the shared banner wording.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import {
  drainRowIdWritebackQueueLocal,
  detectExcelOpenState,
  normalizeWorkbookCellValue
} from '../rowIdLocalWriteback.js';
import { enqueueWriteback, listWriteback, countWriteback } from '../rowIdWritebackQueue.js';
import { readWorkbookExportStamp } from '../excelImportRecencyGuard.js';
import { rowIdWritebackMessage, syncMessageTone, SYNC_TONE } from '../excelSyncStatus.js';
import { applyWritebackVerification } from '../excelIdentityRecord.js';

// ---------------------------------------------------------------------------
// Fixtures

const DOC = 'doc-1:pdf-1';
const FILE = '/Users/u/Documents/Survey.xlsx';
const LOCK = '/Users/u/Documents/~$Survey.xlsx';
const SHEET = 'Kitchen - Module A';
const STAMP = '2026-06-09T10:00:00.000Z';
const TOKEN_3 = 'v1.k1.doc.scope.m3.sig3';
const TOKEN_4 = 'v1.k1.doc.scope.m4.sig4';

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k)
  };
}

/** A real .xlsx buffer: hidden metadata stamp + one survey sheet. */
async function makeWorkbookBuffer({
  stamp = STAMP,
  rows = [
    ['Row ID', 'Item', 'Notes'],
    ['', 'Sink', 'note-2'],
    ['', 'Stove', 'note-3'],
    ['', 'Fridge', 'note-4']
  ]
} = {}) {
  const workbook = new ExcelJS.Workbook();
  if (stamp != null) {
    const meta = workbook.addWorksheet('_SurveyMetadata', { state: 'veryHidden' });
    meta.getCell('A3').value = 'export_timestamp';
    meta.getCell('B3').value = stamp;
  }
  const sheet = workbook.addWorksheet(SHEET);
  rows.forEach((row) => sheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function loadSheetCell(buffer, sheetName, address) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.getWorksheet(sheetName)?.getCell(address)?.value ?? null;
}

/**
 * In-memory fs facade matching the window.electronAPI subset the flush uses.
 * Tracks calls; mtime bumps on every write (like a real fs). `tamper` lets a
 * test corrupt the read-back; `failures` programs probe errors.
 */
function makeFakeFs({ files = {}, lockExists = false, dirEntries = null, failures = {} } = {}) {
  const state = {
    files: new Map(Object.entries(files)),
    mtime: '2026-06-09T10:05:00.000Z',
    writes: [],
    reads: 0,
    tamper: null
  };
  return {
    state,
    fileExists: async (p) => {
      if (failures.fileExists) throw new Error('fileExists boom');
      if (p === LOCK) return lockExists;
      return state.files.has(p);
    },
    listDir: async () => {
      if (failures.listDir) throw new Error('listDir boom');
      if (dirEntries) return dirEntries;
      return [...state.files.keys()].map((p) => p.split('/').pop()).concat(lockExists ? ['~$Survey.xlsx'] : []);
    },
    getFileStats: async (p) => {
      if (failures.getFileStats) return null;
      if (!state.files.has(p)) return null;
      return { mtime: state.mtime, size: state.files.get(p).length, isFile: true, isDirectory: false };
    },
    readFile: async (p) => {
      state.reads += 1;
      const data = state.files.get(p);
      if (!data) throw new Error(`ENOENT: ${p}`);
      return state.tamper ? state.tamper(data, state.reads) : data;
    },
    writeFile: async (p, data) => {
      if (failures.writeFile) throw new Error('writeFile boom');
      const buf = Buffer.from(data);
      state.files.set(p, buf);
      state.writes.push({ path: p, data: buf });
      state.mtime = '2026-06-09T10:06:00.000Z';
      return true;
    }
  };
}

function enqueueDefaults(storage) {
  // Row 3 and row 4 carry blank Row IDs awaiting their tokens (header is row 1).
  enqueueWriteback(DOC, {
    markerId: 'm3', scope: 'mod:cat', sheetName: SHEET, rowLocator: 3,
    expectedOldCellValue: '', newToken: TOKEN_3, path: FILE, createdAt: STAMP
  }, storage);
  enqueueWriteback(DOC, {
    markerId: 'm4', scope: 'mod:cat', sheetName: SHEET, rowLocator: { rowNumber: 4 },
    expectedOldCellValue: '', newToken: TOKEN_4, path: FILE, createdAt: STAMP
  }, storage);
}

const drain = (fs, storage, overrides = {}) =>
  drainRowIdWritebackQueueLocal({
    documentId: DOC,
    filePath: FILE,
    appExportStamp: STAMP,
    fs,
    storage,
    now: () => '2026-06-09T11:00:00.000Z',
    ...overrides
  });

// ---------------------------------------------------------------------------
// The happy path: Excel closed, file clean → flush + verify + queue empty

test('closed+clean: writes column A, read-back verifies, queue empties, identity records update', async () => {
  const storage = makeStorage();
  enqueueDefaults(storage);
  const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() } });

  const result = await drain(fs, storage);

  assert.equal(result.status, 'completed');
  assert.equal(result.attempted, 2);
  assert.equal(result.verified, 2);
  assert.equal(result.requeued, 0);
  assert.equal(result.wrote, true);
  assert.equal(result.remaining, 0);
  assert.equal(countWriteback(DOC, storage), 0);

  // The tokens really landed in column A of the file on "disk".
  const written = fs.state.files.get(FILE);
  assert.equal(await loadSheetCell(written, SHEET, 'A3'), TOKEN_3);
  assert.equal(await loadSheetCell(written, SHEET, 'A4'), TOKEN_4);

  // Surgical: non-column-A content and the header row are preserved.
  assert.equal(await loadSheetCell(written, SHEET, 'B3'), 'Stove');
  assert.equal(await loadSheetCell(written, SHEET, 'C4'), 'note-4');
  assert.equal(await loadSheetCell(written, SHEET, 'A1'), 'Row ID');

  // The export stamp was refreshed forward to the flush time.
  const verifyWb = new ExcelJS.Workbook();
  await verifyWb.xlsx.load(written);
  assert.equal(result.flushStamp, '2026-06-09T11:00:00.000Z');
  assert.equal(readWorkbookExportStamp(verifyWb), result.flushStamp);

  // markerUpdates stamp identity records: pendingRowIdWriteback flips false.
  assert.deepEqual(
    result.markerUpdates.map((u) => u.markerId).sort(),
    ['m3', 'm4']
  );
  const markers = {
    m3: { id: 'm3', excelSync: { assignedToken: null, pendingRowIdWriteback: true } },
    m4: { id: 'm4', excelSync: { assignedToken: null, pendingRowIdWriteback: true } }
  };
  const updated = applyWritebackVerification(markers, result.markerUpdates);
  assert.equal(updated.m3.excelSync.pendingRowIdWriteback, false);
  assert.equal(updated.m3.excelSync.assignedToken, TOKEN_3);
  assert.equal(updated.m4.excelSync.pendingRowIdWriteback, false);

  // Banner wording comes from the shared vocabulary and reads as success.
  const message = rowIdWritebackMessage(result);
  assert.equal(message, '2 Row IDs synced to Excel');
  assert.equal(syncMessageTone(message), SYNC_TONE.SUCCESS);
});

// ---------------------------------------------------------------------------
// Excel open → no write, queue intact, "close Excel" status

test('Excel open (lock sentinel) refuses: no write, queue intact', async () => {
  const storage = makeStorage();
  enqueueDefaults(storage);
  const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() }, lockExists: true });

  const result = await drain(fs, storage);

  assert.equal(result.status, 'excel-open');
  assert.equal(result.wrote, false);
  assert.equal(fs.state.writes.length, 0);
  assert.equal(fs.state.reads, 0); // refused before even reading the workbook
  assert.equal(countWriteback(DOC, storage), 2);

  const message = rowIdWritebackMessage(result);
  assert.equal(message, 'Close Excel to finish writing Row IDs — they stay queued until safe');
  assert.equal(syncMessageTone(message), SYNC_TONE.WARN);
});

test('Excel open via the listDir fallback also refuses', async () => {
  const storage = makeStorage();
  enqueueDefaults(storage);
  // fileExists probe errors, but the directory listing shows THIS workbook's owner file.
  const fs = makeFakeFs({
    files: { [FILE]: await makeWorkbookBuffer() },
    dirEntries: ['Survey.xlsx', '~$survey.XLSX'], // case-insensitive owner match
    failures: { fileExists: true }
  });

  const result = await drain(fs, storage);
  assert.equal(result.status, 'excel-open');
  assert.equal(fs.state.writes.length, 0);
  assert.equal(countWriteback(DOC, storage), 2);
});

test('a stray owner file for a DIFFERENT workbook does not block the flush', async () => {
  const storage = makeStorage();
  enqueueDefaults(storage);
  const fs = makeFakeFs({
    files: { [FILE]: await makeWorkbookBuffer() },
    dirEntries: ['Survey.xlsx', '~$Budget.xlsx']
  });
  const result = await drain(fs, storage);
  assert.equal(result.status, 'completed');
  assert.equal(result.verified, 2);
});

test('undeterminable open-state FAILS CLOSED (unsafe-unknown), no write', async () => {
  const storage = makeStorage();
  enqueueDefaults(storage);
  const fs = makeFakeFs({
    files: { [FILE]: await makeWorkbookBuffer() },
    failures: { fileExists: true, listDir: true }
  });

  const result = await drain(fs, storage);

  assert.equal(result.status, 'unsafe-unknown');
  assert.equal(fs.state.writes.length, 0);
  assert.equal(countWriteback(DOC, storage), 2);
  assert.equal(syncMessageTone(rowIdWritebackMessage(result)), SYNC_TONE.WARN);
});

// ---------------------------------------------------------------------------
// Export-clock drift → abort, queue intact

test('workbook stamp OLDER than the app stamp refuses (workbook-drifted), queue intact', async () => {
  const storage = makeStorage();
  enqueueDefaults(storage);
  const fs = makeFakeFs({
    files: { [FILE]: await makeWorkbookBuffer({ stamp: '2026-06-01T00:00:00.000Z' }) }
  });

  const result = await drain(fs, storage, { appExportStamp: STAMP });

  assert.equal(result.status, 'workbook-drifted');
  assert.equal(result.reason, 'stale-workbook');
  assert.equal(result.wrote, false);
  assert.equal(fs.state.writes.length, 0);
  assert.equal(countWriteback(DOC, storage), 2);
  assert.equal(
    rowIdWritebackMessage(result),
    'The Excel file changed outside the app — Row IDs stay queued until safe'
  );
  assert.equal(syncMessageTone(rowIdWritebackMessage(result)), SYNC_TONE.WARN);
});

test('workbook with NO stamp while the app has a clock refuses (same rail as auto-import)', async () => {
  const storage = makeStorage();
  enqueueDefaults(storage);
  const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer({ stamp: null }) } });

  const result = await drain(fs, storage, { appExportStamp: STAMP });
  assert.equal(result.status, 'workbook-drifted');
  assert.equal(result.reason, 'missing-export-clock');
  assert.equal(fs.state.writes.length, 0);
  assert.equal(countWriteback(DOC, storage), 2);
});

test('file mutated between read and write aborts (drifted-during-flush), nothing written', async () => {
  const storage = makeStorage();
  enqueueDefaults(storage);
  const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() } });
  // Simulate a concurrent writer: mtime moves after our baseline stat.
  const realRead = fs.readFile;
  fs.readFile = async (p) => {
    const data = await realRead(p);
    fs.state.mtime = '2026-06-09T10:05:30.000Z'; // changed AFTER the baseline stat
    return data;
  };

  const result = await drain(fs, storage);

  assert.equal(result.status, 'drifted-during-flush');
  assert.equal(result.wrote, false);
  assert.equal(fs.state.writes.length, 0);
  assert.equal(countWriteback(DOC, storage), 2);
});

// ---------------------------------------------------------------------------
// Read-back verification

test('verify mismatch re-queues (verify-failed) and reports stopped-verify-mismatch', async () => {
  const storage = makeStorage();
  enqueueDefaults(storage);
  const cleanBuffer = await makeWorkbookBuffer();
  const fs = makeFakeFs({ files: { [FILE]: cleanBuffer } });
  // The write "succeeds" but the read-back sees the ORIGINAL file (as if some
  // other process clobbered our write) — neither token can be confirmed.
  fs.state.tamper = (data, readCount) => (readCount >= 2 ? cleanBuffer : data);

  const result = await drain(fs, storage);

  assert.equal(result.status, 'stopped-verify-mismatch');
  assert.equal(result.wrote, true);
  assert.equal(result.verified, 0);
  assert.equal(result.requeued, 2);
  assert.equal(result.markerUpdates.length, 0);
  assert.equal(countWriteback(DOC, storage), 2);
  const entries = listWriteback(DOC, storage);
  assert.ok(entries.every((e) => e.retryState === 'verify-failed'));
  assert.ok(entries.every((e) => e.lastAttemptAt === '2026-06-09T11:00:00.000Z'));
  assert.equal(syncMessageTone(rowIdWritebackMessage(result)), SYNC_TONE.WARN);
});

test('read-back IO failure: written entries re-queue, but cells confirmed BEFORE the write still clear', async () => {
  const storage = makeStorage();
  // m3's cell already holds its token on disk (idempotent, needsWrite:false);
  // m4's cell is blank and needs the write.
  enqueueDefaults(storage);
  const fs = makeFakeFs({
    files: {
      [FILE]: await makeWorkbookBuffer({
        rows: [
          ['Row ID', 'Item', 'Notes'],
          ['', 'Sink', 'note-2'],
          [TOKEN_3, 'Stove', 'note-3'],
          ['', 'Fridge', 'note-4']
        ]
      })
    }
  });
  // The write succeeds but the confirming re-read throws (read #1 = the load).
  let readCount = 0;
  const realRead = fs.readFile;
  fs.readFile = async (p) => {
    readCount += 1;
    if (readCount >= 2) throw new Error('EIO: read-back boom');
    return realRead(p);
  };

  const result = await drain(fs, storage);

  assert.equal(result.status, 'stopped-verify-mismatch');
  assert.equal(result.wrote, true);
  assert.equal(result.errorMessage, 'EIO: read-back boom');
  // m3 was proven on disk by the pre-write read → clears with its identity update.
  assert.equal(result.verified, 1);
  assert.deepEqual(result.markerUpdates, [
    { markerId: 'm3', assignedToken: TOKEN_3, pendingRowIdWriteback: false }
  ]);
  // m4's written cell could not be confirmed → re-queued, never dropped.
  assert.equal(result.requeued, 1);
  assert.equal(countWriteback(DOC, storage), 1);
  const [entry] = listWriteback(DOC, storage);
  assert.equal(entry.markerId, 'm4');
  assert.equal(entry.retryState, 'verify-failed');
  assert.equal(entry.lastAttemptAt, '2026-06-09T11:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Per-entry preconditions

test('cell already holding the token clears WITHOUT writing (idempotent re-drain)', async () => {
  const storage = makeStorage();
  enqueueWriteback(DOC, {
    markerId: 'm3', scope: 'mod:cat', sheetName: SHEET, rowLocator: 3,
    expectedOldCellValue: '', newToken: TOKEN_3, path: FILE
  }, storage);
  const fs = makeFakeFs({
    files: {
      [FILE]: await makeWorkbookBuffer({
        rows: [
          ['Row ID', 'Item', 'Notes'],
          ['', 'Sink', 'note-2'],
          [TOKEN_3, 'Stove', 'note-3']
        ]
      })
    }
  });

  const result = await drain(fs, storage);

  assert.equal(result.status, 'completed');
  assert.equal(result.verified, 1);
  assert.equal(result.wrote, false);
  assert.equal(fs.state.writes.length, 0); // no write was needed
  assert.equal(countWriteback(DOC, storage), 0);
  assert.deepEqual(result.markerUpdates, [
    { markerId: 'm3', assignedToken: TOKEN_3, pendingRowIdWriteback: false }
  ]);
});

test('a cell holding an unaccountable value is NEVER overwritten (stale-locator re-queue)', async () => {
  const storage = makeStorage();
  enqueueWriteback(DOC, {
    markerId: 'm3', scope: 'mod:cat', sheetName: SHEET, rowLocator: 3,
    expectedOldCellValue: '', newToken: TOKEN_3, path: FILE
  }, storage);
  const fs = makeFakeFs({
    files: {
      [FILE]: await makeWorkbookBuffer({
        rows: [
          ['Row ID', 'Item', 'Notes'],
          ['', 'Sink', 'note-2'],
          ['v1.someone.elses.token', 'Stove', 'note-3'] // row moved/sorted since queueing
        ]
      })
    }
  });

  const result = await drain(fs, storage);

  assert.equal(result.status, 'completed');
  assert.equal(result.verified, 0);
  assert.equal(result.requeued, 1);
  assert.equal(fs.state.writes.length, 0);
  const [entry] = listWriteback(DOC, storage);
  assert.equal(entry.retryState, 'stale-locator');
  // The foreign value is untouched on disk.
  assert.equal(await loadSheetCell(fs.state.files.get(FILE), SHEET, 'A3'), 'v1.someone.elses.token');
  // remaining>0 surfaces the queued-until-safe wording.
  assert.equal(rowIdWritebackMessage(result), '1 Row ID queued until safe');
});

test('missing sheet re-queues as stale-locator; malformed entry re-queues as invalid-entry', async () => {
  const storage = makeStorage();
  enqueueWriteback(DOC, {
    markerId: 'gone', scope: 'mod:cat', sheetName: 'Deleted Sheet', rowLocator: 3,
    expectedOldCellValue: '', newToken: TOKEN_3, path: FILE
  }, storage);
  enqueueWriteback(DOC, {
    markerId: 'bad', scope: 'mod:cat', sheetName: SHEET, rowLocator: 0, // invalid row
    expectedOldCellValue: '', newToken: TOKEN_4, path: FILE
  }, storage);
  const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() } });

  const result = await drain(fs, storage);

  assert.equal(result.status, 'completed');
  assert.equal(result.requeued, 1);
  assert.equal(result.skipped, 1);
  assert.equal(fs.state.writes.length, 0);
  const states = Object.fromEntries(listWriteback(DOC, storage).map((e) => [e.markerId, e.retryState]));
  assert.equal(states.gone, 'stale-locator');
  assert.equal(states.bad, 'invalid-entry');
});

// ---------------------------------------------------------------------------
// Scoping + gating

test('entries for OTHER workbooks (different path / Graph workbookId) are untouched', async () => {
  const storage = makeStorage();
  enqueueWriteback(DOC, {
    markerId: 'other-file', sheetName: SHEET, rowLocator: 3,
    expectedOldCellValue: '', newToken: TOKEN_3, path: '/elsewhere/Other.xlsx'
  }, storage);
  enqueueWriteback(DOC, {
    markerId: 'graph-entry', sheetName: SHEET, rowLocator: 4,
    expectedOldCellValue: '', newToken: TOKEN_4, workbookId: 'graph-item-1'
  }, storage);
  const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() } });

  const result = await drain(fs, storage);

  // Nothing matched this workbook → 'empty', zero filesystem calls.
  assert.equal(result.status, 'empty');
  assert.equal(fs.state.reads, 0);
  assert.equal(fs.state.writes.length, 0);
  assert.equal(countWriteback(DOC, storage), 2);
  assert.equal(result.remaining, 2);
  assert.equal(rowIdWritebackMessage(result), null); // nothing the surveyor needs to see
});

test('empty queue and missing fs/filePath refuse cheaply', async () => {
  const storage = makeStorage();
  const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() } });
  assert.equal((await drain(fs, storage)).status, 'empty');

  enqueueDefaults(storage);
  assert.equal((await drain(null, storage)).status, 'not-ready');

  // A pathless (local default) entry still needs a filePath to flush; the
  // path-stamped entries simply scope out against a null path.
  enqueueWriteback(DOC, { markerId: 'm5', sheetName: SHEET, rowLocator: 5, newToken: TOKEN_3 }, storage);
  assert.equal((await drain(fs, storage, { filePath: null })).status, 'not-ready');

  assert.equal((await drainRowIdWritebackQueueLocal({ documentId: null })).status, 'no-document');
  assert.equal(countWriteback(DOC, storage), 3); // every refusal left the queue intact
});

// ---------------------------------------------------------------------------
// Helpers

test('detectExcelOpenState: open / closed / unknown', async () => {
  const open = makeFakeFs({ files: { [FILE]: Buffer.from('x') }, lockExists: true });
  assert.equal(await detectExcelOpenState(open, FILE), 'open');

  const closed = makeFakeFs({ files: { [FILE]: Buffer.from('x') } });
  assert.equal(await detectExcelOpenState(closed, FILE), 'closed');

  const broken = makeFakeFs({ files: { [FILE]: Buffer.from('x') }, failures: { fileExists: true, listDir: true } });
  assert.equal(await detectExcelOpenState(broken, FILE), 'unknown');
});

test('normalizeWorkbookCellValue: strings, blanks, rich text, formula results', () => {
  assert.equal(normalizeWorkbookCellValue(null), '');
  assert.equal(normalizeWorkbookCellValue(undefined), '');
  assert.equal(normalizeWorkbookCellValue('  tok  '), 'tok');
  assert.equal(normalizeWorkbookCellValue({ richText: [{ text: 'v1.' }, { text: 'abc' }] }), 'v1.abc');
  assert.equal(normalizeWorkbookCellValue({ formula: 'A1', result: 'tok' }), 'tok');
  assert.equal(normalizeWorkbookCellValue(42), '42');
});


test('statSignature / mid-flush refusal edges', async () => {
  const storage = makeStorage();
  enqueueDefaults(storage);

  // getFileStats throws → unsafe-unknown via statSignature catch
  {
    const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() } });
    const orig = fs.getFileStats;
    fs.getFileStats = async () => { throw new Error('stat boom'); };
    assert.equal((await drain(fs, storage)).status, 'unsafe-unknown');
    fs.getFileStats = orig;
  }

  // isFile false → null signature → unsafe-unknown
  {
    const storage2 = makeStorage();
    enqueueDefaults(storage2);
    const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() } });
    fs.getFileStats = async () => ({ mtime: 't', size: 1, isFile: false });
    assert.equal((await drain(fs, storage2)).status, 'unsafe-unknown');
  }

  // mtime missing → null signature
  {
    const storage3 = makeStorage();
    enqueueDefaults(storage3);
    const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() } });
    fs.getFileStats = async () => ({ size: 1, isFile: true });
    assert.equal((await drain(fs, storage3)).status, 'unsafe-unknown');
  }

  // readFile throws during load → stopped-error
  {
    const storage4 = makeStorage();
    enqueueDefaults(storage4);
    const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() } });
    fs.readFile = async () => { throw new Error('read boom'); };
    const result = await drain(fs, storage4);
    assert.equal(result.status, 'stopped-error');
    assert.match(result.errorMessage || '', /read boom/);
  }

  // lock appears between plan and write → excel-open mid-flush
  {
    const storage5 = makeStorage();
    enqueueDefaults(storage5);
    const fs = makeFakeFs({ files: { [FILE]: await makeWorkbookBuffer() } });
    let checks = 0;
    const origExists = fs.fileExists;
    fs.fileExists = async (p) => {
      checks += 1;
      if (p === LOCK && checks > 1) return true;
      return origExists(p);
    };
    assert.equal((await drain(fs, storage5)).status, 'excel-open');
    assert.equal(fs.state.writes.length, 0);
  }

  // writeFile throws after checks → stopped-error
  {
    const storage6 = makeStorage();
    enqueueDefaults(storage6);
    const fs = makeFakeFs({
      files: { [FILE]: await makeWorkbookBuffer() },
      failures: { writeFile: true },
    });
    const result = await drain(fs, storage6);
    assert.equal(result.status, 'stopped-error');
    assert.match(result.errorMessage || '', /writeFile boom/);
  }
});
