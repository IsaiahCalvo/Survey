import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readPendingChangeset, writePendingChangeset, clearPendingChangeset, fingerprintPendingWorksheets } from '../src/services/excelSyncPendingChangeset.js';
import { excelExportScope } from '../src/services/excelExportAck.js';
import { withExcelSyncLock } from '../src/services/excelSyncLock.js';

const source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const start = source.indexOf('const runServerExcelSync = useCallback(');
const end = source.indexOf('// Helper: Execute the actual Excel import', start);
assert.ok(start >= 0 && end > start);

function testLocks() {
  const pending = new Map();
  return { request(name, _options, task) {
    const result = (pending.get(name) || Promise.resolve()).catch(() => {}).then(task);
    pending.set(name, result);
    return result;
  } };
}

function callback({ failStorage = false, submit, fetchError = null, fetchOps = null, locks = testLocks() } = {}) {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { if (failStorage) throw new Error('quota'); values.set(key, value); },
    removeItem: key => values.delete(key),
  };
  const state = { submissions: [], toasts: [], reads: 0, enqueued: 0 };
  state.scopeRef = { current: excelExportScope('baseline-a-doc', { id: 'template' }) };
  const dependencies = {
    useCallback: fn => fn,
    excelBaselineId: 'baseline-a-doc', excelExportScope, excelExportScopeRef: state.scopeRef,
    pdfFile: { id: 'doc', name: 'plan.pdf' }, pdfId: 'local-plan', surveyMarkers: {}, surveyMarkersRef: { current: {} },
    readRegistrationFromMetaSheet: meta => ({ workbookId: meta.workbook_id, syncToken: meta.sync_token }),
    readPendingChangeset: descriptor => readPendingChangeset(descriptor, storage),
    writePendingChangeset: descriptor => writePendingChangeset(descriptor, storage),
    clearPendingChangeset: descriptor => clearPendingChangeset(descriptor, storage),
    fingerprintPendingWorksheets,
    withExcelSyncLock: (scope, task) => withExcelSyncLock(scope, task, { locks }),
    showToast: (...args) => state.toasts.push(args), supabase: {},
    buildAppValuesByMarkerId: () => ({}),
    submitChangeSet: async args => {
      const saved = readPendingChangeset(args, storage);
      assert.equal(saved?.clientChangeSetId, args.clientChangeSetId, 'retry ID must be durable before network submission');
      state.submissions.push(args.clientChangeSetId);
      if (submit) return submit(args, state);
      return { error: null, outcomes: [], writebackJobs: [] };
    },
    readFrontier: () => 0,
    fetchSince: async () => { state.reads++; return fetchOps ? fetchOps() : { ops: [], error: fetchError }; },
    excelSyncMetaGetStable: () => null, excelSyncMetaSetStable() {}, makeMaterializeAccessors: () => ({}),
    materializeAcceptedOps: async () => {}, ackMaterialization: async () => {},
    setPendingImportReview() {}, setPendingImportBatchHold() {}, isWholeChangeSetHeld: () => false,
    enqueueWriteback() { state.enqueued++; }, console: { error() {} },
  };
  const run = Function(...Object.keys(dependencies), `${source.slice(start, end)}\nreturn runServerExcelSync;`)(...Object.values(dependencies));
  return { run: (worksheets = []) => run(worksheets, { id: 'template' }, { workbookId: 'workbook', syncToken: 'test-only' }), state, storage,
    pending: () => readPendingChangeset({ documentId: 'doc', templateId: 'template', workbookId: 'workbook' }, storage) };
}

test('actual callback keeps a lost-response ID and replays it on the next sync', async () => {
  const h = callback({ submit: async (_args, state) => {
    if (state.submissions.length === 1) throw new Error('response lost after commit');
    return { error: null, outcomes: [], writebackJobs: [], replayed: true };
  } });
  assert.equal(await h.run(), true);
  const pendingId = h.pending().clientChangeSetId;
  assert.equal(await h.run(), true);
  assert.deepEqual(h.state.submissions, [pendingId, pendingId]);
  assert.equal(h.pending(), null);
});

test('actual callback refuses remote submission when retry metadata cannot be saved', async () => {
  const h = callback({ failStorage: true });
  assert.equal(await h.run(), true);
  assert.equal(h.state.submissions.length, 0);
  assert.match(h.state.toasts[0][0], /retry record/);
});

test('actual callback preserves the attempt and does not claim completion on fetch failure', async () => {
  const h = callback({ fetchError: 'offline' });
  await h.run();
  assert.ok(h.pending());
  assert.equal(h.state.toasts.some(([message]) => message.startsWith('Excel sync complete.')), false);
  assert.match(h.state.toasts.at(-1)[0], /could not be loaded/);
});

test('actual incomplete-writeback retries reuse the durable ID and stop at the cap', async () => {
  const h = callback({ submit: async () => ({ error: null, tokenWritebackIncomplete: true }) });
  await h.run();
  assert.equal(h.state.submissions.length, 4);
  assert.equal(new Set(h.state.submissions).size, 1);
  assert.equal(h.pending().clientChangeSetId, h.state.submissions[0]);
  assert.equal(h.state.reads, 0);
});

test('changed worksheet rows cannot replay old row-ID jobs against new positions', async () => {
  const h = callback({ submit: async () => { throw new Error('response lost'); } });
  const worksheets = [{ sheetName: 'Sheet', jsonData: [Object.assign(['A'], { sheetRowNumber: 2 })] }];
  await h.run(worksheets);
  const before = h.pending();
  await h.run([{ sheetName: 'Sheet', jsonData: [Object.assign(['A'], { sheetRowNumber: 3 })] }]);
  assert.equal(h.state.submissions.length, 1, 'changed physical row blocks even when cell values match');
  assert.equal(h.state.enqueued, 0);
  assert.deepEqual(h.pending(), before);
  assert.match(h.state.toasts.at(-1)[0], /workbook changed/);
});

test('legacy pending attempt without a worksheet fingerprint blocks unsafe writeback replay', async () => {
  const h = callback();
  writePendingChangeset({ documentId: 'doc', templateId: 'template', workbookId: 'workbook', clientChangeSetId: 'legacy' }, h.storage);
  await h.run();
  assert.equal(h.state.submissions.length, 0);
  assert.equal(h.state.enqueued, 0);
  assert.equal(h.pending().clientChangeSetId, 'legacy');
  assert.match(h.state.toasts.at(-1)[0], /older unfinished/);
});

for (const [label, nextScope] of [
  ['account or document', excelExportScope('baseline-b-doc', { id: 'template' })],
  ['template', excelExportScope('baseline-a-doc', { id: 'other-template' })],
]) {
  test(`late submission after ${label} switch preserves old retry and does not apply or queue results`, async () => {
    let complete;
    const h = callback({ submit: () => new Promise(resolve => { complete = resolve; }) });
    const running = h.run();
    while (!complete) await new Promise(resolve => setTimeout(resolve, 0));
    h.state.scopeRef.current = nextScope;
    complete({ error: null, outcomes: [], writebackJobs: [{ markerAnnotationId: 'new', assignedToken: 'test' }] });
    assert.equal(await running, true);
    assert.ok(h.pending());
    assert.equal(h.state.reads, 0);
    assert.equal(h.state.enqueued, 0);
    assert.equal(h.state.toasts.length, 0);
  });
}

test('late fetched operations after a source switch never reach materialization', async () => {
  let complete;
  const h = callback({ fetchOps: () => new Promise(resolve => { complete = resolve; }) });
  const running = h.run();
  while (!complete) await new Promise(resolve => setTimeout(resolve, 0));
  h.state.scopeRef.current = 'different';
  complete({ ops: [{ op_uuid: 'old-document-op' }], error: null });
  assert.equal(await running, true);
  assert.ok(h.pending());
  assert.equal(h.state.enqueued, 0);
  assert.equal(h.state.toasts.length, 0);
});

test('concurrent registered attempts serialize through the shared Web Lock until cleanup finishes', async () => {
  let complete;
  const h = callback({ submit: (_args, state) => state.submissions.length === 1
    ? new Promise(resolve => { complete = resolve; })
    : Promise.resolve({ error: null, outcomes: [], writebackJobs: [] }) });
  const first = h.run();
  while (!complete) await new Promise(resolve => setTimeout(resolve, 0));
  const second = h.run();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.state.submissions.length, 1, 'second attempt cannot enter the pending-record transaction');
  complete({ error: null, outcomes: [], writebackJobs: [] });
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(h.state.submissions.length, 2);
  assert.notEqual(h.state.submissions[0], h.state.submissions[1], 'next attempt starts only after completed predecessor clears its record');
  assert.equal(h.pending(), null);
});

test('missing Web Locks fails closed without a pending mutation, RPC, or legacy fallback', async () => {
  const h = callback({ locks: null });
  assert.equal(await h.run(), true);
  assert.equal(h.state.submissions.length, 0);
  assert.equal(h.state.reads, 0);
  assert.equal(h.pending(), null);
  assert.match(h.state.toasts.at(-1)[0], /coordinate Excel sync across tabs/);
});

test('a queued attempt rechecks document scope when the Web Lock becomes available', async () => {
  let release;
  const locks = testLocks();
  const held = withExcelSyncLock({ documentId: 'doc', templateId: 'template', workbookId: 'workbook' },
    () => new Promise(resolve => { release = resolve; }), { locks });
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  const h = callback({ locks });
  const running = h.run();
  h.state.scopeRef.current = 'different';
  release();
  await held;
  assert.equal(await running, true);
  assert.equal(h.state.submissions.length, 0);
  assert.equal(h.pending(), null);
});
