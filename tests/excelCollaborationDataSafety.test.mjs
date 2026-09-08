import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeExportAck, stampExportAck, excelExportScope } from '../src/services/excelExportAck.js';
import { applyMarkerIdentityRecords } from '../src/services/excelIdentityRecord.js';
import { computeExcelSyncFingerprint, computeHasPendingExcelSyncChanges } from '../src/utils/excelSyncDirtyState.js';
import { excelBaselineScope, saveBaseline, loadBaseline } from '../src/services/excelSyncBaselineStore.js';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
function extract(start, end, deps, result) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return Function(...Object.keys(deps), `${source.slice(a, b)}; return ${result};`)(...Object.values(deps));
}
const template = { id: 't1', linkedExcelPath: '/book.xlsx' };

test('export receipt keeps concurrent edits, new rows, and deletes intact', () => {
  const exported = { a: { name: 'old' }, removed: { name: 'deleted' } };
  const current = { a: { name: 'new' }, added: { name: 'added' } };
  const merged = mergeExportAck(current, exported, { exportedAt: 'now', identityRecords: { a: { row: 2 } } });
  assert.equal(merged.a.name, 'new');
  assert.equal(merged.a.exportedAt, 'now');
  assert.equal(merged.added.exportedAt, undefined);
  assert.equal(merged.removed, undefined);
  assert.equal(current.a.exportedAt, undefined);
});

test('actual export acknowledgment stores exported baseline, not edits made during upload', () => {
  const exported = { a: { name: 'old' } };
  let current = { a: { name: 'new' }, added: { name: 'added' } };
  let baseline, pending;
  const pdfIdRef = { current: 'scope' };
  const scopeRef = { current: excelExportScope('scope', template) };
  const ack = extract('const markExcelExportSynced =', '  // Stage 2: restore a deleted', {
    useCallback: fn => fn, surveyMarkers: exported, selectedTemplate: template,
    excelBaselineId: 'scope', pdfIdRef, excelExportScope, excelExportScopeRef: scopeRef,
    stampExportAck, mergeExportAck, applyMarkerIdentityRecords, computeHasPendingExcelSyncChanges,
    surveyMarkersRef: { current },
    setSurveyMarkers: fn => { current = fn(current); },
    setHasPendingExcelSyncChanges: value => { pending = value; },
    markExcelSyncCheckpoint: (t, markers) => { baseline = computeExcelSyncFingerprint(t, markers).hash; return baseline; },
  }, 'markExcelExportSynced');
  ack(template);
  assert.equal(baseline, computeExcelSyncFingerprint(template, exported).hash);
  assert.equal(pending, true);
  assert.equal(current.a.name, 'new');
  assert.equal(current.added.exportedAt, undefined);
  scopeRef.current = excelExportScope('scope', { ...template, id: 'other-template' });
  assert.equal(ack(template), null, 'another template cannot receive the old receipt');
  scopeRef.current = excelExportScope('scope', { ...template, oneDriveFileId: 'other-workbook' });
  assert.equal(ack(template), null, 'another workbook cannot receive the old receipt');
  pdfIdRef.current = 'other-account';
  assert.equal(ack(template), null, 'retired document/account cannot receive the receipt');
});

test('same-name cloud documents and different accounts cannot share a sync baseline', () => {
  const map = new Map();
  const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  const a = excelBaselineScope('cloud-a', 'same-name-size', 'alice');
  saveBaseline(a, 't1', 'synced', storage);
  assert.equal(loadBaseline(a, 't1', storage), 'synced');
  for (const scope of [excelBaselineScope('cloud-b', 'same-name-size', 'alice'), excelBaselineScope('cloud-a', 'same-name-size', 'bob'), 'same-name-size']) {
    assert.equal(loadBaseline(scope, 't1', storage), null);
  }
});

test('actual session export stops on a failed sheet before whole-workbook acknowledgment', async () => {
  const calls = [];
  const a = source.indexOf('// Update each worksheet via session API');
  const b = source.indexOf('              } else {\n                // Fall back to full file upload', a);
  assert.ok(a >= 0 && b > a);
  const write = Function('workbook', 'updateCellRange', 'graphClient', 'oneDriveFileId', 'excelSessionId', 'selectedTemplate', `const assertCurrentExport = () => {}; return (async()=>{${source.slice(a,b)}})();`);
  const sheet = name => ({ name, rowCount: 1, columnCount: 1, getCell: () => ({ value: 'test' }) });
  await assert.rejects(write({ worksheets: ['first','failed','later'].map(sheet) }, async (...args) => {
    calls.push(args[3]);
    assert.equal(args[6], 'team-drive');
    if (args[3] === 'failed') throw new Error('conflict');
  }, {}, 'file', 'session', { sharePointDriveId: 'team-drive' }), /conflict/);
  assert.deepEqual(calls, ['first', 'failed']);
});

test('actual push helper never reports success or acknowledges a disabled write', async () => {
  const toasts = [];
  const push = extract('const pushToExcelWithRetry =', '  const pushToExcelWithRetryRef', {
    useCallback: fn => fn, selectedTemplate: template,
    handleExportSurveyToExcel: async () => false,
    showToast: (...args) => toasts.push(args), isFileLocked: () => false,
    console: { error() {} },
  }, 'pushToExcelWithRetry');
  await assert.rejects(push(true, { throwOnFailure: true }), { code: 'EXCEL_SYNC_NOT_WRITTEN' });
  assert.equal(toasts.length, 0);
});

function mountPoll({ fallback = true, getMetadata, getSheets, getRange } = {}) {
  let cleanup, tick;
  const ref = { current: null }, etag = { current: 'old' }, data = { current: { stale: 1 } };
  const imports = [];
  extract('  // Poll for Excel changes when live sync is active', '  // Live sync push to Excel', {
    useEffect: fn => { cleanup = fn(); }, liveSyncEnabled: true, oneDriveFileId: 'file',
    graphClient: {}, liveSyncStatus: 'connected', excelSessionId: fallback ? null : 'session',
    useFallbackSync: fallback, liveSyncPollRef: ref, lastKnownETagRef: etag, lastPollDataRef: data,
    excelPollScopeRef: { current: null },
    selectedTemplate: { sharePointDriveId: 'team-drive' },
    isInteractionPerfWindowActive: () => false, emitPdfDebugEvent() {},
    getFileETag: getMetadata, getWorksheets: getSheets, getUsedRange: getRange,
    handleAutoSyncFromExcel: () => imports.push(true),
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
    console: { warn() {}, error() {} },
  }, 'undefined');
  return { cleanup, tick, imports, etag, data };
}

test('actual slow polling uses one request and ignores a reply after cleanup', async () => {
  let release, calls = 0;
  const poll = mountPoll({ getMetadata: async (client, file, drive) => {
    calls++;
    assert.equal(drive, 'team-drive');
    return new Promise(resolve => { release = resolve; });
  } });
  await poll.tick(); await poll.tick();
  assert.equal(calls, 1);
  poll.cleanup(); release({ eTag: 'new' }); await turn();
  assert.equal(poll.etag.current, 'old');
  assert.deepEqual(poll.imports, []);
  await poll.tick(); assert.equal(calls, 1);
});

test('actual worksheet poll drops old-workbook replies and resets prior sheet state', async () => {
  let release, rangeCalls = 0;
  const poll = mountPoll({ fallback: false,
    getSheets: () => new Promise(resolve => { release = resolve; }),
    getRange: async () => { rangeCalls++; return { values: [] }; },
  });
  assert.deepEqual(poll.data.current, {});
  poll.cleanup(); release([{ name: 'sheet' }]); await turn();
  assert.equal(rangeCalls, 0);
});
