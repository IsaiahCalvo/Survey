// INTEGRATION: classifier → gate → verify probe → drain/flush, driven TOGETHER
// (PLAN.md Amendment 2026-06-08(b); HANDOFF items 2+3, slice 5).
//
// The unit suites prove each module alone; this file proves the seams. Every
// scenario drives the REAL production modules end-to-end —
//   liveSyncEligibility (with the real excelGraphService.getDriveType probe)
//   → liveSyncVerification (with its real excelSessionService deps)
//   → rowIdGraphWriteback.drainRowIdWritebackQueue / rowIdLocalWriteback
//   → rowIdWritebackQueue + excelIdentityRecord + excelSyncStatus
// — with ONLY the boundaries faked: one fake Graph client per scenario that
// records every call (so we can assert what Microsoft would have SEEN), an
// in-memory localStorage, and an in-memory fs facade holding REAL exceljs
// workbook bytes for the local flush.
//
// Scenarios (the slice-5 contract):
//   1. ELIGIBLE BUSINESS file end-to-end: probe passes → drain runs → tokens
//      verified-written, single-cell PATCHes only, never a full-file upload.
//   2. PERSONAL file: the gate stays closed and the Graph mock saw NOTHING
//      (zero calls for a consumer tenant; one read-only GET when the drive
//      itself had to prove it's personal) — and zero write calls, ever.
//   3. LOCAL file with Excel OPEN: flush deferred, queue intact, file bytes
//      untouched; the moment Excel releases the file the SAME drain lands the
//      tokens with read-back verification.
//   4. TOKEN EXPIRY MID-DRAIN: reconnect surfaced through the shared
//      vocabulary, the un-flushed queue entry survives byte-for-byte, and the
//      cell that was never confirmed is never written — no data loss.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import {
  LIVE_SYNC_GATE_REASON,
  evaluateLiveSyncGate,
  resolveLiveSyncEligibility
} from '../src/services/liveSyncEligibility.js';
import { runLiveSyncVerification } from '../src/services/liveSyncVerification.js';
import { drainRowIdWritebackQueue } from '../src/services/rowIdGraphWriteback.js';
import { drainRowIdWritebackQueueLocal } from '../src/services/rowIdLocalWriteback.js';
import { EXCEL_CAPABILITY, LIVE_WRITEBACK_ENABLED } from '../src/services/excelCapability.js';
import { enqueueWriteback, listWriteback, countWriteback } from '../src/services/rowIdWritebackQueue.js';
import {
  SYNC_TONE,
  liveSyncVerifyStatus,
  rowIdWritebackMessage,
  syncMessageTone
} from '../src/services/excelSyncStatus.js';
import { applyWritebackVerification } from '../src/services/excelIdentityRecord.js';
import { excelLockFilePath } from '../src/services/excelLockFile.js';

// ---------------------------------------------------------------------------
// Shared fixtures

const DOC = 'pdf-int:doc';
const FILE = 'file-int-1';
const DRIVE = 'drv-biz';
const STAMP = '2026-06-09T12:00:00.000Z';
const NOW = '2026-06-10T09:00:00.000Z';
const TOKEN_7 = 'v1.k1.doc.scope.m7.sig7';
const TOKEN_9 = 'v1.k1.doc.scope.m9.sig9';

const WORK_TENANT = '11111111-2222-3333-4444-555555555555';
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const businessTemplate = {
  linkedExcelPath: '/Surveys/Site.xlsx',
  oneDriveApiPath: '/Surveys/Site.xlsx',
  isOneDrive: true,
  isSharePoint: true,
  sharePointDriveId: DRIVE
};
const personalTemplate = {
  linkedExcelPath: '/Surveys/Site.xlsx',
  oneDriveApiPath: '/Surveys/Site.xlsx',
  isOneDrive: true
};
const localTemplate = { linkedExcelPath: '/Users/u/Documents/Survey.xlsx', isOneDrive: false };

const workMainSignals = () => ({ tenantId: WORK_TENANT, custody: 'main' });

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

/**
 * ONE fake Graph client for the whole pipeline: answers the read-only drive
 * probe, path→id resolution, the workbook session lifecycle, worksheet/range
 * reads AND single-cell Row ID reads/patches over an in-memory cell map.
 * Records every call (path, method, headers, body). PUT (a full-file upload)
 * always throws — nothing in this pipeline may ever attempt one.
 */
function makeGraph({
  driveType = 'business',
  fileId = FILE,
  cells = {},
  sheets = ['Sheet1', '_SurveyMetadata'],
  stamp = STAMP,
  errors = {} // { driveProbe, createSession, cellGet: {'Sheet!A7': err}, cellPatch: {...} }
} = {}) {
  const calls = [];
  const state = { cells: { ...cells } };
  const rangeRe = /\/workbook\/worksheets\('([^']+)'\)\/range\(address='([^']+)'\)$/;
  const cellKey = (path) => {
    const m = path.match(rangeRe);
    return m ? `${decodeURIComponent(m[1])}!${m[2]}` : null;
  };
  const api = (path) => {
    const call = { path, method: null, headers: {}, body: undefined };
    calls.push(call);
    const chain = {
      select() { return chain; },
      header(name, value) { call.headers[name] = value; return chain; },
      async get() {
        call.method = 'GET';
        if (path === '/me/drive' || /^\/drives\/[^/]+$/.test(path)) {
          if (errors.driveProbe) throw errors.driveProbe;
          return { driveType };
        }
        // SINGLE-FILE SCOPE: any '/root:' path resolution returns THE one
        // fixture file id. Never share one makeGraph instance across a
        // two-linked-file scenario — build a second instance instead.
        if (path.includes('/root:')) return { id: fileId };
        if (path.endsWith('/workbook/worksheets')) {
          return { value: sheets.map((name, i) => ({ id: `w${i}`, name, position: i })) };
        }
        if (path.includes('/usedRange')) {
          if (path.includes("worksheets('_SurveyMetadata')")) {
            return {
              values: [['template_id', 'tpl-1'], ['version', '2'], ['export_timestamp', stamp]],
              address: '_SurveyMetadata!A1:B3'
            };
          }
          return { values: [['Row ID', 'Item']], address: 'Sheet1!A1:B1' };
        }
        const key = cellKey(path);
        if (key) {
          if (errors.cellGet?.[key]) throw errors.cellGet[key];
          return { values: [[state.cells[key] ?? '']] };
        }
        throw new Error(`unexpected GET ${path}`);
      },
      async post(body) {
        call.method = 'POST';
        call.body = body;
        if (path.endsWith('/workbook/createSession')) {
          if (errors.createSession) throw errors.createSession;
          return { id: 'sess-int' };
        }
        if (path.endsWith('/workbook/closeSession')) return {};
        throw new Error(`unexpected POST ${path}`);
      },
      async patch(body) {
        call.method = 'PATCH';
        call.body = body;
        const key = cellKey(path);
        if (errors.cellPatch?.[key]) throw errors.cellPatch[key];
        if (key) state.cells[key] = body.values[0][0];
        return { ok: true };
      },
      async put(body) {
        call.method = 'PUT';
        call.body = body;
        throw new Error(`INTEGRATION INVARIANT BROKEN: full-file upload attempted (PUT ${path})`);
      }
    };
    return chain;
  };
  return { client: { api }, calls, state };
}

const isDriveProbe = (c) => c.path === '/me/drive' || /^\/drives\/[^/]+$/.test(c.path);
const writeShaped = (calls) => calls.filter((c) => c.method === 'PATCH' || c.method === 'PUT');
const entryByMarker = (storage, markerId) =>
  listWriteback(DOC, storage).find((e) => e.markerId === markerId);

const seedGraphEntries = (storage) => {
  enqueueWriteback(DOC, {
    markerId: 'm7', scope: 'mod:cat', sheetName: 'Sheet1', rowLocator: 7,
    expectedOldCellValue: '', newToken: TOKEN_7, workbookId: FILE, createdAt: STAMP
  }, storage);
  enqueueWriteback(DOC, {
    markerId: 'm9', scope: 'mod:cat', sheetName: 'Sheet1', rowLocator: 9,
    expectedOldCellValue: '', newToken: TOKEN_9, workbookId: FILE, createdAt: STAMP
  }, storage);
};

// ---------------------------------------------------------------------------
// Scenario 1 — eligible business file, end-to-end

test('BUSINESS END-TO-END: probe proves eligibility, verify passes, drain lands verified single-cell tokens', async () => {
  const storage = makeStorage();
  const cache = new Map(); // slice-1's caller-owned per-drive driveType cache
  const graph = makeGraph({ cells: { 'Sheet1!A7': '', 'Sheet1!A9': '' } });

  // 1. CLASSIFIER → GATE: the real getDriveType probe proves business.
  const eligibility = await resolveLiveSyncEligibility({
    template: businessTemplate,
    graphClient: graph.client,
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    cache
  });
  assert.equal(eligibility.allowed, true);
  assert.equal(eligibility.reasonCode, LIVE_SYNC_GATE_REASON.ELIGIBLE);
  assert.equal(eligibility.driveType, 'business');
  assert.equal(eligibility.capability.kind, EXCEL_CAPABILITY.BUSINESS_GRAPH);
  assert.equal(eligibility.capability.liveWritebackEligible, true);
  assert.equal(graph.calls.filter(isDriveProbe).length, 1, 'exactly one read-only drive probe');
  assert.equal(cache.get(`drive:${DRIVE}`), 'business', 'probe result cached per drive');

  // 2. VERIFY PROBE: all six steps pass, reusing the cache (no second probe).
  const verification = await runLiveSyncVerification({
    template: businessTemplate,
    graphClient: graph.client,
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    driveTypeCache: cache,
    appExportStamp: STAMP
  });
  assert.equal(verification.ready, true);
  assert.equal(verification.verdictCode, 'ready');
  assert.equal(verification.failedStep, null);
  for (const step of verification.steps) assert.equal(step.status, 'pass', `step ${step.step} must pass`);
  assert.equal(liveSyncVerifyStatus('ready').tone, SYNC_TONE.SUCCESS);
  assert.equal(graph.calls.filter(isDriveProbe).length, 1, 'cache REUSED — still one drive probe total');
  assert.equal(writeShaped(graph.calls).length, 0, 'gate + verify made ZERO write-shaped calls');
  // VERIFY-phase session bookkeeping: runLiveSyncVerification gets no fileId,
  // so it resolves the path itself (the /root: GET) and opens ONE workbook
  // session. If it is ever refactored to accept a fileId directly, THIS is the
  // assertion to revisit — not the drain-phase delta below.
  const sessionsOpenedByVerify = graph.calls.filter((c) => c.path.endsWith('/workbook/createSession')).length;
  assert.equal(sessionsOpenedByVerify, 1, 'the verify probe opened exactly one workbook session');

  // 3. PRODUCTION POSTURE: without the test-only injection the drain is dormant.
  assert.equal(LIVE_WRITEBACK_ENABLED, false, 'master gate is OFF in the shipped code');
  seedGraphEntries(storage);
  const callsBeforeDormant = graph.calls.length;
  const dormant = await drainRowIdWritebackQueue({
    graphClient: graph.client, documentId: DOC, fileId: FILE, driveId: DRIVE,
    capability: eligibility.capability, storage
  });
  assert.equal(dormant.status, 'gate-off');
  assert.equal(graph.calls.length, callsBeforeDormant, 'dormant drain makes zero Graph calls');
  assert.equal(countWriteback(DOC, storage), 2, 'queue untouched while dormant');

  // 4. DRAIN with the gate test-injected ON: per-flush session, verified writes.
  const drain = await drainRowIdWritebackQueue({
    graphClient: graph.client, documentId: DOC, fileId: FILE, driveId: DRIVE,
    capability: eligibility.capability, storage,
    liveWritebackEnabled: true, // TEST-ONLY injection — production never passes this
    now: () => NOW
  });
  assert.equal(drain.status, 'completed');
  assert.equal(drain.attempted, 2);
  assert.equal(drain.verified, 2);
  assert.equal(drain.requeued, 0);
  assert.equal(drain.remaining, 0);
  assert.equal(countWriteback(DOC, storage), 0, 'queue cleared only after read-back verification');
  assert.equal(graph.state.cells['Sheet1!A7'], TOKEN_7, 'token really landed in the cell');
  assert.equal(graph.state.cells['Sheet1!A9'], TOKEN_9);

  // Marker identity records flip pendingRowIdWriteback off via the shared helper.
  const markers = {
    m7: { id: 'm7', excelSync: { assignedToken: null, pendingRowIdWriteback: true } },
    m9: { id: 'm9', excelSync: { assignedToken: null, pendingRowIdWriteback: true } }
  };
  const stamped = applyWritebackVerification(markers, drain.markerUpdates);
  assert.equal(stamped.m7.excelSync.assignedToken, TOKEN_7);
  assert.equal(stamped.m7.excelSync.pendingRowIdWriteback, false);
  assert.equal(stamped.m9.excelSync.pendingRowIdWriteback, false);

  // Per-flush session lifecycle, annotated by phase: one verify session
  // (asserted above) + exactly one MORE opened by the drain; every session
  // opened was also closed.
  const sessionsOpenedTotal = graph.calls.filter((c) => c.path.endsWith('/workbook/createSession')).length;
  assert.equal(sessionsOpenedTotal - sessionsOpenedByVerify, 1,
    'the drain opened exactly one per-flush session');
  assert.equal(graph.calls.filter((c) => c.path.endsWith('/workbook/closeSession')).length, sessionsOpenedTotal,
    'every session opened was closed');

  // THE WHOLE-LEDGER INVARIANTS — across classifier, gate, verify AND drain:
  const patches = writeShaped(graph.calls);
  assert.equal(patches.length, 2, 'exactly one PATCH per queued Row ID — nothing else wrote');
  assert.ok(
    patches.every((p) => p.method === 'PATCH'
      && p.body.values.length === 1 && p.body.values[0].length === 1
      && /range\(address='A\d+'\)$/.test(p.path)),
    'every write is a 1x1 column-A cell PATCH — never a sheet range, never a file'
  );
  assert.ok(graph.calls.every((c) => c.method !== 'PUT' && !c.path.includes('/content')),
    'no full-file upload path was ever touched');
  assert.ok(graph.calls.every((c) => c.path === '/me/drive' || c.path.startsWith(`/drives/${DRIVE}`) || c.path.includes('/root:')),
    'every workbook call is drive-scoped to the linked SharePoint drive');

  // The shared banner vocabulary reports it honestly.
  const message = rowIdWritebackMessage(drain);
  assert.equal(message, '2 Row IDs synced to Excel');
  assert.equal(syncMessageTone(message), SYNC_TONE.SUCCESS);
});

// ---------------------------------------------------------------------------
// Scenario 2 — personal file: gate closed, the mock saw NOTHING

test('PERSONAL FILE (consumer tenant): refused with ZERO Graph calls; drain stays closed even forced', async () => {
  const storage = makeStorage();
  seedGraphEntries(storage);
  const graph = makeGraph();

  // CLASSIFIER → GATE: a consumer (MSA) tenant is a terminal personal proof —
  // no probe, no retry, nothing for Graph to see.
  const eligibility = await resolveLiveSyncEligibility({
    template: personalTemplate,
    graphClient: graph.client,
    isMicrosoftConnected: true,
    getAuthSignals: () => ({ tenantId: CONSUMER_TENANT, custody: 'main' }),
    cache: new Map()
  });
  assert.equal(eligibility.allowed, false);
  assert.equal(eligibility.reasonCode, LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);
  assert.equal(eligibility.retryable, false);
  assert.equal(eligibility.capability.liveWritebackEligible, false);
  assert.equal(graph.calls.length, 0, 'terminal personal refusal probes NOTHING');

  // DRAIN: even with the master gate force-injected on, eligibility refuses first.
  const result = await drainRowIdWritebackQueue({
    graphClient: graph.client, documentId: DOC, fileId: FILE,
    capability: eligibility.capability, storage,
    liveWritebackEnabled: true
  });
  assert.equal(result.status, 'not-eligible');
  assert.equal(result.reason, 'consumer-tenant');
  assert.equal(result.verified, 0);
  assert.equal(graph.calls.length, 0, 'the Graph mock saw NOTHING — zero reads, zero writes');
  assert.equal(countWriteback(DOC, storage), 2, 'queue fully intact');
  assert.equal(entryByMarker(storage, 'm7').retryState, 'pending');
  assert.equal(entryByMarker(storage, 'm9').retryState, 'pending');
  assert.equal(rowIdWritebackMessage(result), null, 'silent — rows stay safely queued');
});

test('PERSONAL FILE (probed drive): one read-only GET proves personal; zero write-shaped calls ever', async () => {
  const storage = makeStorage();
  seedGraphEntries(storage);
  // Work tenant claims, but the drive itself answers 'personal' (e.g. MSA OneDrive).
  const graph = makeGraph({ driveType: 'personal' });

  const eligibility = await resolveLiveSyncEligibility({
    template: personalTemplate,
    graphClient: graph.client,
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    cache: new Map()
  });
  assert.equal(eligibility.allowed, false);
  assert.equal(eligibility.reasonCode, LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);
  assert.equal(eligibility.driveType, 'personal');
  assert.equal(graph.calls.length, 1, 'exactly the one read-only drive probe');
  assert.equal(graph.calls[0].method, 'GET');
  assert.equal(graph.calls[0].path, '/me/drive');

  const result = await drainRowIdWritebackQueue({
    graphClient: graph.client, documentId: DOC, fileId: FILE,
    capability: eligibility.capability, storage,
    liveWritebackEnabled: true
  });
  assert.equal(result.status, 'not-eligible');
  assert.equal(result.reason, 'personal-drivetype');
  assert.equal(graph.calls.length, 1, 'the drain added no Graph traffic at all');
  assert.equal(writeShaped(graph.calls).length, 0, 'personal NEVER gets a write path');
  assert.equal(countWriteback(DOC, storage), 2);
});

// ---------------------------------------------------------------------------
// Scenario 3 — local file, Excel open: defer; Excel closed: flush + verify

const LOCAL_FILE = '/Users/u/Documents/Survey.xlsx';
// Derived from the PRODUCTION lock-path function so the fake fs's sentinel can
// never silently drift from what detectExcelOpenState actually checks.
const LOCAL_LOCK = excelLockFilePath(LOCAL_FILE);
const LOCAL_SHEET = 'Kitchen - Module A';
const TOKEN_3 = 'v1.k1.doc.scope.m3.sig3';
const TOKEN_4 = 'v1.k1.doc.scope.m4.sig4';

async function makeLocalWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const meta = workbook.addWorksheet('_SurveyMetadata', { state: 'veryHidden' });
  meta.getCell('A3').value = 'export_timestamp';
  meta.getCell('B3').value = STAMP;
  const sheet = workbook.addWorksheet(LOCAL_SHEET);
  sheet.addRow(['Row ID', 'Item', 'Notes']);
  sheet.addRow(['', 'Sink', 'note-2']);
  sheet.addRow(['', 'Stove', 'note-3']);
  sheet.addRow(['', 'Fridge', 'note-4']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function loadSheetCell(buffer, sheetName, address) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.getWorksheet(sheetName)?.getCell(address)?.value ?? null;
}

/** In-memory fs facade with a MUTABLE Excel lock sentinel (Excel open/closed). */
function makeFakeFs({ files = {}, lockExists = false } = {}) {
  const state = {
    files: new Map(Object.entries(files)),
    lockExists,
    mtime: '2026-06-10T08:00:00.000Z',
    writes: []
  };
  return {
    state,
    fileExists: async (p) => (p === LOCAL_LOCK ? state.lockExists : state.files.has(p)),
    listDir: async () =>
      [...state.files.keys()].map((p) => p.split('/').pop())
        .concat(state.lockExists ? [LOCAL_LOCK.split('/').pop()] : []),
    getFileStats: async (p) => (state.files.has(p)
      ? { mtime: state.mtime, size: state.files.get(p).length, isFile: true, isDirectory: false }
      : null),
    readFile: async (p) => {
      const data = state.files.get(p);
      if (!data) throw new Error(`ENOENT: ${p}`);
      return data;
    },
    writeFile: async (p, data) => {
      const buf = Buffer.from(data);
      state.files.set(p, buf);
      state.writes.push({ path: p });
      state.mtime = '2026-06-10T08:30:00.000Z';
      return true;
    }
  };
}

test('LOCAL FILE: gate refuses live sync honestly; flush defers while Excel is open, lands once it closes', async () => {
  // The live-sync gate has nothing to offer a local file — the queue path does.
  const gate = evaluateLiveSyncGate({ template: localTemplate, isMicrosoftConnected: false });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reasonCode, LIVE_SYNC_GATE_REASON.LOCAL_FILE);
  assert.equal(gate.capability.kind, EXCEL_CAPABILITY.LOCAL);

  const storage = makeStorage();
  enqueueWriteback(DOC, {
    markerId: 'm3', scope: 'mod:cat', sheetName: LOCAL_SHEET, rowLocator: 3,
    expectedOldCellValue: '', newToken: TOKEN_3, path: LOCAL_FILE, createdAt: STAMP
  }, storage);
  enqueueWriteback(DOC, {
    markerId: 'm4', scope: 'mod:cat', sheetName: LOCAL_SHEET, rowLocator: { rowNumber: 4 },
    expectedOldCellValue: '', newToken: TOKEN_4, path: LOCAL_FILE, createdAt: STAMP
  }, storage);

  const fs = makeFakeFs({ files: { [LOCAL_FILE]: await makeLocalWorkbookBuffer() }, lockExists: true });
  const bytesBefore = fs.state.files.get(LOCAL_FILE);
  const drainLocal = () => drainRowIdWritebackQueueLocal({
    documentId: DOC, filePath: LOCAL_FILE, appExportStamp: STAMP,
    fs, storage, now: () => NOW
  });

  // EXCEL OPEN (the ~$ sentinel is present): flush DEFERRED, everything intact.
  const deferred = await drainLocal();
  assert.equal(deferred.status, 'excel-open');
  assert.equal(deferred.wrote, false);
  assert.equal(deferred.verified, 0);
  assert.equal(fs.state.writes.length, 0, 'never writes under an open file');
  assert.equal(fs.state.files.get(LOCAL_FILE), bytesBefore, 'workbook bytes byte-identical');
  assert.equal(countWriteback(DOC, storage), 2, 'queue fully intact');
  assert.equal(entryByMarker(storage, 'm3').retryState, 'pending');
  assert.equal(entryByMarker(storage, 'm4').retryState, 'pending');
  const deferMessage = rowIdWritebackMessage(deferred);
  assert.match(deferMessage, /Close Excel/);
  assert.equal(syncMessageTone(deferMessage), SYNC_TONE.WARN);

  // EXCEL CLOSES (sentinel disappears): the SAME drain now flushes + verifies.
  fs.state.lockExists = false;
  const flushed = await drainLocal();
  assert.equal(flushed.status, 'completed');
  assert.equal(flushed.wrote, true);
  assert.equal(flushed.verified, 2);
  assert.equal(flushed.requeued, 0);
  assert.equal(countWriteback(DOC, storage), 0, 'queue drained only after read-back');

  // Tokens really landed in column A on "disk"; everything else preserved.
  const written = fs.state.files.get(LOCAL_FILE);
  assert.equal(await loadSheetCell(written, LOCAL_SHEET, 'A3'), TOKEN_3);
  assert.equal(await loadSheetCell(written, LOCAL_SHEET, 'A4'), TOKEN_4);
  assert.equal(await loadSheetCell(written, LOCAL_SHEET, 'B3'), 'Stove');
  assert.equal(await loadSheetCell(written, LOCAL_SHEET, 'C4'), 'note-4');
  assert.equal(await loadSheetCell(written, LOCAL_SHEET, 'A1'), 'Row ID');

  // Identity records flip via the same helper both drains share.
  const markers = {
    m3: { id: 'm3', excelSync: { assignedToken: null, pendingRowIdWriteback: true } },
    m4: { id: 'm4', excelSync: { assignedToken: null, pendingRowIdWriteback: true } }
  };
  const stamped = applyWritebackVerification(markers, flushed.markerUpdates);
  assert.equal(stamped.m3.excelSync.assignedToken, TOKEN_3);
  assert.equal(stamped.m4.excelSync.pendingRowIdWriteback, false);

  const message = rowIdWritebackMessage(flushed);
  assert.equal(message, '2 Row IDs synced to Excel');
  assert.equal(syncMessageTone(message), SYNC_TONE.SUCCESS);
});

// ---------------------------------------------------------------------------
// Scenario 4 — token expiry mid-drain: reconnect surfaced, queue intact

test('TOKEN EXPIRY MID-DRAIN: reconnect surfaced, unverified entry byte-identical, never-confirmed cell never written', async () => {
  const storage = makeStorage();
  seedGraphEntries(storage);
  const err401 = Object.assign(new Error('InvalidAuthenticationToken: token has expired'), {
    statusCode: 401,
    code: 'InvalidAuthenticationToken'
  });
  // m7's cell behaves; the token dies right before m9's pre-check read.
  const graph = makeGraph({
    cells: { 'Sheet1!A7': '', 'Sheet1!A9': '' },
    errors: { cellGet: { 'Sheet1!A9': err401 } }
  });

  const eligibility = await resolveLiveSyncEligibility({
    template: businessTemplate,
    graphClient: graph.client,
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    cache: new Map()
  });
  assert.equal(eligibility.allowed, true);
  const m9Before = entryByMarker(storage, 'm9');

  const result = await drainRowIdWritebackQueue({
    graphClient: graph.client, documentId: DOC, fileId: FILE, driveId: DRIVE,
    capability: eligibility.capability, storage,
    liveWritebackEnabled: true,
    now: () => NOW
  });

  assert.equal(result.status, 'auth-expired');
  assert.equal(result.verified, 1, 'work confirmed BEFORE the expiry is kept');
  assert.equal(graph.state.cells['Sheet1!A7'], TOKEN_7);
  assert.equal(entryByMarker(storage, 'm7'), undefined, 'verified entry cleared');
  assert.deepEqual(result.markerUpdates, [
    { markerId: 'm7', assignedToken: TOKEN_7, pendingRowIdWriteback: false }
  ]);

  // NO DATA LOSS: the unconfirmed entry survives EXACTLY as it was queued, and
  // its cell was never written after the token died.
  assert.equal(countWriteback(DOC, storage), 1);
  assert.deepEqual(entryByMarker(storage, 'm9'), m9Before, 'entry byte-identical — not even lastAttemptAt moved');
  assert.equal(graph.state.cells['Sheet1!A9'], '', 'never-confirmed cell never written');
  const failIdx = graph.calls.findIndex((c) => c.path.includes("address='A9'"));
  assert.ok(failIdx >= 0);
  assert.ok(graph.calls.slice(failIdx + 1).every((c) => c.method !== 'PATCH' && c.method !== 'PUT'),
    'zero writes after the expiry');
  assert.ok(graph.calls.some((c) => c.path.endsWith('/workbook/closeSession')),
    'the per-flush session is still closed on the abort path');

  // RECONNECT SURFACED through the shared vocabulary — never a silent fail.
  const message = rowIdWritebackMessage(result);
  assert.match(message, /Reconnect your Microsoft account/);
  assert.equal(syncMessageTone(message), SYNC_TONE.WARN);

  // The guided verify probe maps the same mid-probe expiry to the same verdict.
  const graph2 = makeGraph({ errors: { createSession: err401 } });
  const verification = await runLiveSyncVerification({
    template: businessTemplate,
    graphClient: graph2.client,
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    driveTypeCache: new Map(),
    appExportStamp: STAMP
  });
  assert.equal(verification.ready, false);
  assert.equal(verification.verdictCode, 'auth-expired');
  assert.match(liveSyncVerifyStatus('auth-expired').label, /reconnect your Microsoft account/i);
});
