// Tests for the business-Graph single-cell Row ID writer + queue drain
// (PLAN.md Amendment 2026-06-08(b) step 3; HANDOFF item 3a/3c, Graph side).
//
// Drives the REAL modules (writer, drain, queue, capability classifier) with a
// fake Microsoft Graph client at the request boundary and an in-memory
// localStorage. Covers: drive-scoped single-cell PATCH + read-back, idempotent
// re-drain, stale-locator refusal, verify-mismatch re-queue+stop, 409/locked
// retry-later, 401 token-expiry (queue intact), the LIVE_WRITEBACK_ENABLED
// dormancy proof (zero Graph calls), eligibility refusal, batch cap, and the
// per-flush session lifecycle.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  rowIdCellAddress,
  classifyGraphWritebackError,
  readRowIdCell,
  writeRowIdCellVerified,
  drainRowIdWritebackQueue,
  DRAIN_MAX_PER_PASS
} from '../rowIdGraphWriteback.js';
import { classifyExcelCapability, LIVE_WRITEBACK_ENABLED } from '../excelCapability.js';
import { enqueueWriteback, listWriteback, countWriteback, queueKey } from '../rowIdWritebackQueue.js';
import { rowIdWritebackMessage } from '../excelSyncStatus.js';
import { applyWritebackVerification } from '../excelIdentityRecord.js';

// ---------------------------------------------------------------------------
// Fakes (request boundary only — everything else is the real code)

/**
 * A fake Graph client simulating ONE workbook's cells. Records every call
 * (path, method, headers, body) and lets tests program failures and a
 * "PATCH doesn't stick" mode for read-back mismatches.
 */
function makeWorkbookGraph({ cells = {}, patchSticks = true, errors = {} } = {}) {
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
    const builder = {
      select() { return builder; },
      header(name, value) { call.headers[name] = value; return builder; },
      async get() {
        call.method = 'GET';
        if (errors.get) throw errors.get;
        const key = cellKey(path);
        if (key) return { values: [[state.cells[key] ?? '']] };
        return { value: [] };
      },
      async post(body) {
        call.method = 'POST';
        call.body = body;
        if (path.endsWith('/workbook/createSession')) {
          if (errors.createSession) throw errors.createSession;
          return { id: 'SESS-NEW' };
        }
        return {};
      },
      async patch(body) {
        call.method = 'PATCH';
        call.body = body;
        if (errors.patch) throw errors.patch;
        const key = cellKey(path);
        if (key && patchSticks) state.cells[key] = body.values[0][0];
        return { ok: true };
      }
    };
    return builder;
  };
  return { client: { api }, calls, state };
}

/** Minimal in-memory localStorage. */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); }
  };
}

// Real classifier verdicts — business (eligible) and personal (never eligible).
const businessCapability = () => classifyExcelCapability({
  template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
  tenantId: 'a11ce000-1111-2222-3333-444455556666',
  isMicrosoftConnected: true,
  driveType: 'business'
});
const personalCapability = () => classifyExcelCapability({
  template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
  tenantId: '9188040d-6c67-4c5b-b112-36a304b66dad',
  isMicrosoftConnected: true,
  driveType: 'personal'
});

const DOC = 'pdf-1:doc';
const FILE = 'F1';
const DRIVE = 'DRV9';
const TOKEN_1 = 'v1.k1.doc.scope.m1.sig1';
const TOKEN_2 = 'v1.k1.doc.scope.m2.sig2';

const seedEntry = (storage, overrides = {}) => {
  const entry = {
    markerId: 'm1',
    scope: 'mod:cat',
    sheetName: 'Sheet1',
    rowLocator: 7,
    expectedOldCellValue: '',
    newToken: TOKEN_1,
    workbookId: FILE,
    createdAt: '2026-06-09T00:00:00.000Z',
    ...overrides
  };
  assert.ok(enqueueWriteback(DOC, entry, storage));
  return entry;
};

const patchCalls = (calls) => calls.filter((c) => c.method === 'PATCH');
const entryByMarker = (storage, markerId) =>
  listWriteback(DOC, storage).find((e) => e.markerId === markerId);

// ---------------------------------------------------------------------------
// Writer mechanics

test('rowIdCellAddress accepts only positive integer rows', () => {
  assert.equal(rowIdCellAddress(7), 'A7');
  assert.equal(rowIdCellAddress(1), 'A1');
  for (const bad of [0, -3, 1.5, '7', null, undefined, NaN]) {
    assert.equal(rowIdCellAddress(bad), null, `expected null for ${bad}`);
  }
});

test('writer PATCHes exactly one drive-scoped column-A cell under the session and read-back verifies', async () => {
  const { client, calls, state } = makeWorkbookGraph({ cells: { 'Sheet1!A7': '' } });
  const result = await writeRowIdCellVerified(client, {
    fileId: FILE, driveId: DRIVE, sessionId: 'S1',
    sheetName: 'Sheet1', rowNumber: 7, token: TOKEN_1, expectedOldCellValue: ''
  });

  assert.equal(result.outcome, 'verified');
  assert.equal(result.wrote, true);
  assert.equal(state.cells['Sheet1!A7'], TOKEN_1);

  const patches = patchCalls(calls);
  assert.equal(patches.length, 1, 'exactly ONE cell PATCH');
  assert.equal(patches[0].path, `/drives/${DRIVE}/items/${FILE}/workbook/worksheets('Sheet1')/range(address='A7')`);
  assert.deepEqual(patches[0].body, { values: [[TOKEN_1]] }); // a 1x1 range — single cell
  // Every call (pre-check GET, PATCH, read-back GET) carries the session header
  // and is drive-scoped — never /me/drive when a driveId is supplied.
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.headers['workbook-session-id'], 'S1');
    assert.ok(call.path.startsWith(`/drives/${DRIVE}/`), `unexpected path ${call.path}`);
  }
});

test('writer without driveId targets /me/drive (OneDrive for Business own drive)', async () => {
  const { client, calls } = makeWorkbookGraph({ cells: { 'Sheet1!A7': '' } });
  const result = await writeRowIdCellVerified(client, {
    fileId: FILE, sessionId: 'S1', sheetName: 'Sheet1', rowNumber: 7, token: TOKEN_1
  });
  assert.equal(result.outcome, 'verified');
  assert.ok(calls.every((c) => c.path.startsWith(`/me/drive/items/${FILE}/`)));
});

test('writer is idempotent: cell already holds the token → verified with NO write', async () => {
  const { client, calls } = makeWorkbookGraph({ cells: { 'Sheet1!A7': TOKEN_1 } });
  const result = await writeRowIdCellVerified(client, {
    fileId: FILE, sessionId: 'S1', sheetName: 'Sheet1', rowNumber: 7, token: TOKEN_1, expectedOldCellValue: ''
  });
  assert.equal(result.outcome, 'verified');
  assert.equal(result.wrote, false);
  assert.equal(patchCalls(calls).length, 0);
});

test('writer refuses a stale locator: unexpected current value → NO write, ever', async () => {
  const { client, calls } = makeWorkbookGraph({ cells: { 'Sheet1!A7': 'someone-elses-token' } });
  const result = await writeRowIdCellVerified(client, {
    fileId: FILE, sessionId: 'S1', sheetName: 'Sheet1', rowNumber: 7, token: TOKEN_1, expectedOldCellValue: ''
  });
  assert.equal(result.outcome, 'stale-locator');
  assert.equal(result.wrote, false);
  assert.equal(result.cellValue, 'someone-elses-token');
  assert.equal(patchCalls(calls).length, 0, 'must never overwrite an unaccounted value');
});

test('writer reports verify-mismatch when the read-back differs from the token', async () => {
  const { client } = makeWorkbookGraph({ cells: { 'Sheet1!A7': '' }, patchSticks: false });
  const result = await writeRowIdCellVerified(client, {
    fileId: FILE, sessionId: 'S1', sheetName: 'Sheet1', rowNumber: 7, token: TOKEN_1, expectedOldCellValue: ''
  });
  assert.equal(result.outcome, 'verify-mismatch');
  assert.equal(result.wrote, true);
});

test('readRowIdCell normalizes blank/null cells to the empty string', async () => {
  const { client } = makeWorkbookGraph({ cells: { 'Sheet1!A7': null } });
  assert.equal(await readRowIdCell(client, { fileId: FILE, sheetName: 'Sheet1', rowNumber: 7 }), '');
});

test('classifyGraphWritebackError: 401/token → auth-expired, 409/423 → locked, else error', () => {
  assert.equal(classifyGraphWritebackError({ statusCode: 401 }), 'auth-expired');
  assert.equal(classifyGraphWritebackError({ code: 'InvalidAuthenticationToken' }), 'auth-expired');
  assert.equal(classifyGraphWritebackError({ statusCode: 409 }), 'locked');
  assert.equal(classifyGraphWritebackError({ statusCode: 423 }), 'locked');
  assert.equal(classifyGraphWritebackError({ code: 'resourceLocked' }), 'locked');
  assert.equal(classifyGraphWritebackError({ code: 'editConflict' }), 'locked');
  // Exact-match codes only: a code merely CONTAINING 'conflict'/'locked' is NOT
  // a resource lock (status 409/423 still classifies independently).
  assert.equal(classifyGraphWritebackError({ code: 'mergeConflictInSharedDrive' }), 'error');
  assert.equal(classifyGraphWritebackError({ statusCode: 500 }), 'error');
  assert.equal(classifyGraphWritebackError(new Error('boom')), 'error');
});

// ---------------------------------------------------------------------------
// Drain — gating (the dormancy contract)

test('DORMANT BY DEFAULT: master gate off → zero Graph calls, queue intact, no marker updates', async () => {
  // No liveWritebackEnabled override — exactly how production calls it.
  assert.equal(LIVE_WRITEBACK_ENABLED, false, 'precondition: the in-code master gate is OFF');
  const storage = makeStorage();
  seedEntry(storage);
  const { client, calls } = makeWorkbookGraph();

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, driveId: DRIVE,
    sessionId: 'S1', capability: businessCapability(), storage
  });

  assert.equal(result.status, 'gate-off');
  assert.equal(calls.length, 0, 'gate-off must make ZERO Graph calls');
  assert.equal(countWriteback(DOC, storage), 1);
  assert.equal(entryByMarker(storage, 'm1').retryState, 'pending');
  assert.deepEqual(result.markerUpdates, []);
});

test('not business-graph eligible (personal) → refused even with the gate on; zero Graph calls', async () => {
  const storage = makeStorage();
  seedEntry(storage);
  const { client, calls } = makeWorkbookGraph();

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, sessionId: 'S1',
    capability: personalCapability(), storage,
    liveWritebackEnabled: true // even force-on, eligibility still refuses
  });

  assert.equal(result.status, 'not-eligible');
  assert.equal(result.reason, 'consumer-tenant'); // classifier checks the MSA tenant before driveType
  assert.equal(calls.length, 0);
  assert.equal(countWriteback(DOC, storage), 1);
});

test('empty queue → status empty, zero Graph calls', async () => {
  const { client, calls } = makeWorkbookGraph();
  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, sessionId: 'S1',
    capability: businessCapability(), storage: makeStorage(), liveWritebackEnabled: true
  });
  assert.equal(result.status, 'empty');
  assert.equal(calls.length, 0);
});

test('entries stamped for a DIFFERENT workbook are left untouched (and alone they read as empty)', async () => {
  const storage = makeStorage();
  seedEntry(storage, { workbookId: 'OTHER-FILE' });
  const { client, calls } = makeWorkbookGraph();
  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, sessionId: 'S1',
    capability: businessCapability(), storage, liveWritebackEnabled: true
  });
  assert.equal(result.status, 'empty');
  assert.equal(calls.length, 0);
  assert.equal(countWriteback(DOC, storage), 1);
  assert.equal(result.remaining, 1, 'foreign-workbook entry still counted as queued');
});

// ---------------------------------------------------------------------------
// Drain — the happy path and the marker transitions

test('gate on (test-injected): drains all entries, read-back verifies, clears queue, emits marker updates', async () => {
  const storage = makeStorage();
  seedEntry(storage, { markerId: 'm1', rowLocator: 7, newToken: TOKEN_1 });
  seedEntry(storage, { markerId: 'm2', rowLocator: 9, newToken: TOKEN_2, sheetName: 'Sheet2' });
  const { client, calls, state } = makeWorkbookGraph({
    cells: { 'Sheet1!A7': '', 'Sheet2!A9': '' }
  });

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, driveId: DRIVE,
    sessionId: 'S-LIVE', capability: businessCapability(), storage,
    liveWritebackEnabled: true
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.attempted, 2);
  assert.equal(result.verified, 2);
  assert.equal(result.requeued, 0);
  assert.equal(result.remaining, 0);
  assert.equal(countWriteback(DOC, storage), 0, 'queue cleared only after read-back');
  assert.equal(state.cells['Sheet1!A7'], TOKEN_1);
  assert.equal(state.cells['Sheet2!A9'], TOKEN_2);
  assert.deepEqual(result.markerUpdates, [
    { markerId: 'm1', assignedToken: TOKEN_1, pendingRowIdWriteback: false },
    { markerId: 'm2', assignedToken: TOKEN_2, pendingRowIdWriteback: false }
  ]);
  // Caller-provided session is reused (no create/close) and stamped on every call.
  assert.ok(!calls.some((c) => c.path.endsWith('/createSession')));
  assert.ok(!calls.some((c) => c.path.endsWith('/closeSession')));
  assert.ok(calls.every((c) => c.headers['workbook-session-id'] === 'S-LIVE'));
  assert.ok(calls.every((c) => c.path.startsWith(`/drives/${DRIVE}/`)));
  // Only single-cell PATCHes — one per entry, 1x1 ranges.
  const patches = patchCalls(calls);
  assert.equal(patches.length, 2);
  assert.ok(patches.every((p) => p.body.values.length === 1 && p.body.values[0].length === 1));
});

test('no caller session → drain creates a per-flush session and ALWAYS closes it', async () => {
  const storage = makeStorage();
  seedEntry(storage);
  const { client, calls } = makeWorkbookGraph({ cells: { 'Sheet1!A7': '' } });

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, driveId: DRIVE,
    capability: businessCapability(), storage, liveWritebackEnabled: true
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.verified, 1);
  assert.ok(calls.some((c) => c.path === `/drives/${DRIVE}/items/${FILE}/workbook/createSession`));
  const close = calls.find((c) => c.path.endsWith('/closeSession'));
  assert.ok(close, 'per-flush session must be closed');
  assert.equal(close.headers['workbook-session-id'], 'SESS-NEW');
});

test('session creation failing 403 → session-unavailable, queue intact', async () => {
  const storage = makeStorage();
  seedEntry(storage);
  const err = Object.assign(new Error('denied'), { statusCode: 403 });
  const { client } = makeWorkbookGraph({ errors: { createSession: err } });

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE,
    capability: businessCapability(), storage, liveWritebackEnabled: true
  });

  assert.equal(result.status, 'session-unavailable');
  assert.equal(countWriteback(DOC, storage), 1);
});

test('applyWritebackVerification flips pendingRowIdWriteback off only on markers with an excelSync record', () => {
  const markers = {
    m1: { pageNumber: 1, excelSync: { assignedToken: null, pendingRowIdWriteback: true, fullRowFingerprint: 'fp' } },
    m2: { pageNumber: 2 }, // no record — must be left alone, never fabricated
    m3: { pageNumber: 3, excelSync: { assignedToken: 'keep', pendingRowIdWriteback: true } }
  };
  const out = applyWritebackVerification(markers, [
    { markerId: 'm1', assignedToken: TOKEN_1, pendingRowIdWriteback: false },
    { markerId: 'm2', assignedToken: TOKEN_2, pendingRowIdWriteback: false }
  ]);
  assert.notEqual(out, markers);
  assert.equal(out.m1.excelSync.assignedToken, TOKEN_1);
  assert.equal(out.m1.excelSync.pendingRowIdWriteback, false);
  assert.equal(out.m1.excelSync.fullRowFingerprint, 'fp', 'rest of the record preserved');
  assert.equal(out.m2, markers.m2, 'marker without a record untouched');
  assert.equal(out.m3, markers.m3, 'marker not in the updates untouched');
  // No-op inputs return the same instance (cheap for setState).
  assert.equal(applyWritebackVerification(markers, []), markers);
  assert.equal(applyWritebackVerification(markers, [{ markerId: 'ghost', assignedToken: 'x' }]), markers);
});

// ---------------------------------------------------------------------------
// Drain — failure flows (re-queue, stop, never destroy)

test('verify-mismatch: re-queues as verify-failed and STOPS — later entries untouched', async () => {
  const storage = makeStorage();
  seedEntry(storage, { markerId: 'm1', rowLocator: 7, newToken: TOKEN_1 });
  seedEntry(storage, { markerId: 'm2', rowLocator: 9, newToken: TOKEN_2 });
  // PATCH never sticks → first entry read-back mismatches.
  const { client, calls } = makeWorkbookGraph({ cells: { 'Sheet1!A7': '', 'Sheet1!A9': '' }, patchSticks: false });

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, sessionId: 'S1',
    capability: businessCapability(), storage, liveWritebackEnabled: true,
    now: () => '2026-06-09T01:02:03.000Z'
  });

  assert.equal(result.status, 'stopped-verify-mismatch');
  assert.equal(result.attempted, 1, 'stopped after the first entry');
  assert.equal(result.verified, 0);
  assert.equal(result.requeued, 1);
  assert.equal(result.remaining, 2, 'nothing deleted');
  const m1 = entryByMarker(storage, 'm1');
  assert.equal(m1.retryState, 'verify-failed');
  assert.equal(m1.lastAttemptAt, '2026-06-09T01:02:03.000Z');
  assert.equal(m1.newToken, TOKEN_1, 'entry payload preserved');
  assert.equal(entryByMarker(storage, 'm2').retryState, 'pending', 'second entry untouched');
  assert.ok(!calls.some((c) => c.path.includes("address='A9'")), 'no Graph traffic for the second entry');
});

test('409 locked: re-queues as retry-later and stops with the queue intact', async () => {
  const storage = makeStorage();
  seedEntry(storage);
  const err = Object.assign(new Error('resource locked'), { statusCode: 409 });
  const { client } = makeWorkbookGraph({ cells: { 'Sheet1!A7': '' }, errors: { patch: err } });

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, sessionId: 'S1',
    capability: businessCapability(), storage, liveWritebackEnabled: true
  });

  assert.equal(result.status, 'stopped-locked');
  assert.equal(result.requeued, 1);
  assert.equal(countWriteback(DOC, storage), 1);
  assert.equal(entryByMarker(storage, 'm1').retryState, 'retry-later');
});

test('401 token expiry: aborts with auth-expired, entry EXACTLY as it was', async () => {
  const storage = makeStorage();
  seedEntry(storage);
  const before = entryByMarker(storage, 'm1');
  const err = Object.assign(new Error('token expired'), { statusCode: 401, code: 'InvalidAuthenticationToken' });
  const { client } = makeWorkbookGraph({ errors: { get: err } });

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, sessionId: 'S1',
    capability: businessCapability(), storage, liveWritebackEnabled: true
  });

  assert.equal(result.status, 'auth-expired');
  assert.equal(result.verified, 0);
  assert.equal(countWriteback(DOC, storage), 1);
  assert.deepEqual(entryByMarker(storage, 'm1'), before, 'entry untouched on auth failure');
});

test('stale locator: re-queues as stale-locator and CONTINUES to the next entry', async () => {
  const storage = makeStorage();
  seedEntry(storage, { markerId: 'm1', rowLocator: 7, newToken: TOKEN_1 });
  seedEntry(storage, { markerId: 'm2', rowLocator: 9, newToken: TOKEN_2 });
  // m1's cell holds an unexpected value (row moved); m2's is clean.
  const { client, state } = makeWorkbookGraph({ cells: { 'Sheet1!A7': 'moved-row-value', 'Sheet1!A9': '' } });

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, sessionId: 'S1',
    capability: businessCapability(), storage, liveWritebackEnabled: true
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.requeued, 1);
  assert.equal(result.verified, 1);
  assert.equal(state.cells['Sheet1!A7'], 'moved-row-value', 'stale cell NEVER overwritten');
  assert.equal(state.cells['Sheet1!A9'], TOKEN_2);
  assert.equal(entryByMarker(storage, 'm1').retryState, 'stale-locator');
  assert.equal(entryByMarker(storage, 'm2'), undefined, 'verified entry cleared');
});

test('invalid entry (no rowLocator) is marked invalid-entry, skipped without Graph calls, drain continues', async () => {
  const storage = makeStorage();
  seedEntry(storage, { markerId: 'm1', rowLocator: undefined });
  seedEntry(storage, { markerId: 'm2', rowLocator: 9, newToken: TOKEN_2 });
  const { client, calls } = makeWorkbookGraph({ cells: { 'Sheet1!A9': '' } });

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, sessionId: 'S1',
    capability: businessCapability(), storage, liveWritebackEnabled: true
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.skipped, 1);
  assert.equal(result.verified, 1);
  assert.equal(entryByMarker(storage, 'm1').retryState, 'invalid-entry');
  assert.ok(!calls.some((c) => c.path.includes("address='A7'")));
});

// ---------------------------------------------------------------------------
// Drain — batch cap

test('batch cap: processes maxPerPass entries, reports the remainder still queued', async () => {
  const storage = makeStorage();
  seedEntry(storage, { markerId: 'm1', rowLocator: 1, newToken: 'tok1' });
  seedEntry(storage, { markerId: 'm2', rowLocator: 2, newToken: 'tok2' });
  seedEntry(storage, { markerId: 'm3', rowLocator: 3, newToken: 'tok3' });
  const { client } = makeWorkbookGraph({ cells: { 'Sheet1!A1': '', 'Sheet1!A2': '', 'Sheet1!A3': '' } });

  const result = await drainRowIdWritebackQueue({
    graphClient: client, documentId: DOC, fileId: FILE, sessionId: 'S1',
    capability: businessCapability(), storage, liveWritebackEnabled: true,
    maxPerPass: 1
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.attempted, 1);
  assert.equal(result.verified, 1);
  assert.equal(result.remaining, 2, 'remainder reported for the caller to log');
  assert.equal(countWriteback(DOC, storage), 2);
  assert.ok(Number.isInteger(DRAIN_MAX_PER_PASS) && DRAIN_MAX_PER_PASS > 0);
});

// ---------------------------------------------------------------------------
// Status vocabulary (excelSyncStatus) — plain-English banner strings

test('rowIdWritebackMessage: silent for dormant/no-op outcomes, honest words otherwise', () => {
  for (const silent of ['empty', 'gate-off', 'not-eligible', 'no-document', 'not-ready']) {
    assert.equal(rowIdWritebackMessage({ status: silent }), null, `${silent} must stay silent`);
  }
  assert.equal(rowIdWritebackMessage(null), null);

  assert.equal(rowIdWritebackMessage({ status: 'completed', verified: 1, remaining: 0 }), '1 Row ID synced to Excel');
  assert.equal(
    rowIdWritebackMessage({ status: 'completed', verified: 2, remaining: 3 }),
    '2 Row IDs synced to Excel · 3 still queued'
  );
  assert.equal(rowIdWritebackMessage({ status: 'completed', verified: 0, remaining: 2 }), '2 Row IDs queued until safe');
  assert.equal(rowIdWritebackMessage({ status: 'completed', verified: 0, remaining: 0 }), null);
  assert.match(rowIdWritebackMessage({ status: 'stopped-verify-mismatch' }), /queued until safe/);
  assert.match(rowIdWritebackMessage({ status: 'stopped-error' }), /queued until safe/);
  // A genuine file/IO error must read differently from a verify mismatch.
  assert.notEqual(
    rowIdWritebackMessage({ status: 'stopped-error' }),
    rowIdWritebackMessage({ status: 'stopped-verify-mismatch' })
  );
  assert.match(rowIdWritebackMessage({ status: 'stopped-locked' }), /queued until safe/);
  assert.match(rowIdWritebackMessage({ status: 'auth-expired' }), /Reconnect your Microsoft account/);
  assert.match(rowIdWritebackMessage({ status: 'session-unavailable' }), /queued until safe/);
});

test('queue storage round-trip sanity: drain mutations live under the documented key', async () => {
  const storage = makeStorage();
  seedEntry(storage);
  assert.equal(queueKey(DOC), `rowIdWritebackQueue:${DOC}`);
  assert.equal(JSON.parse(storage.getItem(queueKey(DOC))).m1.newToken, TOKEN_1);
});
