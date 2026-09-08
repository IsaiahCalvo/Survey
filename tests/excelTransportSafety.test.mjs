import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbookSession, updateCellRange, getWorksheets, refreshWorkbookSession } from '../src/services/excelSessionService.js';
import { readRowIdCell, writeRowIdCellVerified, drainRowIdWritebackQueue } from '../src/services/rowIdGraphWriteback.js';
import { getFileById, getFileETag, downloadExcelFile, uploadFileContentById, listDriveItems } from '../src/services/excelGraphService.js';
import { enqueueWriteback, listWriteback } from '../src/services/rowIdWritebackQueue.js';
import { Client } from '@microsoft/microsoft-graph-client';

function graph(respond) {
  const calls = [];
  return { calls, client: { api(path) {
    const call = { path, headers: {} };
    calls.push(call);
    const builder = {
      header(name, value) { call.headers[name] = value; return builder; },
      select() { return builder; },
      filter() { return builder; },
      get() { return respond({ ...call, method: 'GET' }); },
      post(body) { return respond({ ...call, method: 'POST', body }); },
      patch(body) { return respond({ ...call, method: 'PATCH', body }); },
      put(body) { return respond({ ...call, method: 'PUT', body }); },
    };
    return builder;
  } } };
}

test('session failure keeps Graph status, code, and Retry-After for caller decisions', async () => {
  const original = Object.assign(new Error('expired'), { statusCode: 401, code: 'InvalidAuthenticationToken', headers: { 'Retry-After': '12' } });
  const h = graph(async () => { throw original; });
  await assert.rejects(createWorkbookSession(h.client, 'file'), (error) => {
    assert.equal(error.statusCode, 401);
    assert.equal(error.code, original.code);
    assert.equal(error.headers['Retry-After'], '12');
    return true;
  });
  assert.equal(h.calls.length, 1, 'session creation is never blindly retried');
});

test('worksheet names with quotes remain a single escaped OData name', async () => {
  const h = graph(async () => ({}));
  await updateCellRange(h.client, 'file', 'session', "Owner's Plan", 'A1', [['safe']]);
  assert.equal(decodeURIComponent(h.calls[0].path), "/me/drive/items/file/workbook/worksheets('Owner''s Plan')/range(address='A1')");
});

test('all worksheet pages load and keep the session header', async () => {
  const next = 'https://graph.microsoft.com/v1.0/me/drive/items/file/workbook/worksheets?$skiptoken=next';
  const h = graph(async ({ path }) => path === next ? { value: [{ id: 'b' }] } : { value: [{ id: 'a' }], '@odata.nextLink': next });
  assert.deepEqual(await getWorksheets(h.client, 'file', 'session'), [{ id: 'a' }, { id: 'b' }]);
  assert.ok(h.calls.every((call) => call.headers['workbook-session-id'] === 'session'));
});

test('refresh uses the documented lightweight refreshSession endpoint', async () => {
  const h = graph(async () => undefined);
  await refreshWorkbookSession(h.client, 'file', 'session', 'drive');
  assert.equal(h.calls[0].path, '/drives/drive/items/file/workbook/refreshSession');
});

test('malformed Row ID read fails closed instead of treating it as an empty cell', async () => {
  const h = graph(async () => ({}));
  await assert.rejects(readRowIdCell(h.client, { fileId: 'file', sheetName: 'Sheet1', rowNumber: 2 }), /cell|range|values/i);
});

test('read-back of an older entry must not clear its newer queued replacement', async () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  const old = { markerId: 'm', sheetName: 'Sheet1', rowLocator: 2, newToken: 'old', expectedOldCellValue: '', workbookId: 'file' };
  enqueueWriteback('doc', old, storage);
  let reads = 0;
  const h = graph(async ({ method }) => {
    if (method === 'PATCH') return {};
    reads++;
    if (reads === 1) return { values: [['']] };
    enqueueWriteback('doc', { ...old, newToken: 'new', rowLocator: 3 }, storage);
    return { values: [['old']] };
  });
  const result = await drainRowIdWritebackQueue({ graphClient: h.client, documentId: 'doc', fileId: 'file', sessionId: 'session',
    capability: { liveWritebackEligible: true }, liveWritebackEnabled: true, storage });
  assert.equal(listWriteback('doc', storage)[0]?.newToken, 'new');
  assert.deepEqual(result.markerUpdates, [], 'old verification cannot mark the new work synced');
});

test('sheet writes and Row ID read-check-write cycles are sequential per workbook', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let reads = 0;
  const h = graph(async ({ method }) => {
    if (method === 'PATCH') return pending;
    reads++;
    return { values: [['token']] };
  });
  const first = updateCellRange(h.client, 'file', 'session', 'Sheet1', 'B1', [['first']]);
  const second = writeRowIdCellVerified(h.client, { fileId: 'file', sessionId: 'session', sheetName: 'Sheet1', rowNumber: 2, token: 'token' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 0, 'pre-check waits until the earlier sheet write settles');
  release({});
  await first;
  assert.equal((await second).outcome, 'verified');
});

test('SharePoint file metadata, ETags, download metadata, and uploads use the supplied drive', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }));
  const h = graph(async () => ({ id: 'file', eTag: 'tag', '@microsoft.graph.downloadUrl': 'https://example.test/download' }));
  await getFileById(h.client, 'file', 'drive');
  await getFileETag(h.client, 'file', 'drive');
  await downloadExcelFile(h.client, 'file', 'drive');
  await uploadFileContentById(h.client, 'file', new Uint8Array([1, 2]), 'drive');
  assert.ok(h.calls.every((call) => call.path.startsWith('/drives/drive/items/file')));
});

test('collection paging refuses repeated or untrusted next links', async () => {
  for (const next of ['https://evil.example/steal', 'https://graph.microsoft.com/v1.0/me/drive/items/file/workbook/worksheets?$skiptoken=repeat']) {
    const h = graph(async () => ({ value: [], '@odata.nextLink': next }));
    await assert.rejects(getWorksheets(h.client, 'file', 'session'), /Untrusted|repeated/);
    assert.ok(h.calls.length <= 2);
  }
});

test('folder paging fails rather than returning a partial list after a later Graph error', async () => {
  const error = Object.assign(new Error('throttled'), { statusCode: 429, headers: { 'Retry-After': '30' } });
  const next = 'https://graph.microsoft.com/v1.0/drives/drive/items/root/children?$skiptoken=next';
  const h = graph(async ({ path }) => {
    if (path === next) throw error;
    return { value: [{ id: 'first' }], '@odata.nextLink': next };
  });
  await assert.rejects(listDriveItems(h.client, 'drive'), (failure) => failure.statusCode === 429 && failure.headers['Retry-After'] === '30');
  assert.equal(h.calls.length, 2, 'no automatic retry after throttling');
});

test('Retry-After blocks queued writes without replaying them, then permits a later explicit write', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const error = Object.assign(new Error('throttled'), { statusCode: 429, headers: { 'Retry-After': '30' } });
  let attempts = 0;
  const h = graph(async () => { attempts++; if (attempts === 1) throw error; return {}; });
  const outcomes = await Promise.allSettled([
    updateCellRange(h.client, 'file', 'session', 'Sheet1', 'A1', [[1]]),
    updateCellRange(h.client, 'file', 'session', 'Sheet1', 'A2', [[2]]),
  ]);
  assert.ok(outcomes.every((outcome) => outcome.status === 'rejected' && outcome.reason.statusCode === 429));
  assert.equal(attempts, 1);
  t.mock.timers.tick(30_001);
  await updateCellRange(h.client, 'file', 'session', 'Sheet1', 'A2', [[2]]);
  assert.equal(attempts, 2);
});

test('failed durable queue acknowledgement never marks a Row ID synced', async () => {
  const map = new Map();
  let fail = false;
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { if (fail) throw new Error('quota'); map.set(key, value); } };
  enqueueWriteback('doc', { markerId: 'm', sheetName: 'Sheet1', rowLocator: 2, newToken: 'token', workbookId: 'file' }, storage);
  fail = true;
  const h = graph(async () => ({ values: [['token']] }));
  const result = await drainRowIdWritebackQueue({ graphClient: h.client, documentId: 'doc', fileId: 'file', sessionId: 'session',
    capability: { liveWritebackEligible: true }, liveWritebackEnabled: true, storage });
  assert.equal(result.status, 'stopped-error');
  assert.deepEqual(result.markerUpdates, []);
  assert.equal(listWriteback('doc', storage).length, 1);
});

test('real Graph SDK does not replay session creation or workbook writes on 503', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: 'serviceUnavailable', message: 'uncertain outcome' } }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '0' } });
  });
  const client = Client.init({ authProvider: (done) => done(null, 'local-test-token') });
  await assert.rejects(createWorkbookSession(client, 'file'), (error) => error.statusCode === 503);
  assert.equal(calls, 1);
  await assert.rejects(updateCellRange(client, 'file', 'session', 'Sheet1', 'A1', [[1]]), (error) => error.statusCode === 503);
  assert.equal(calls, 2);
  await assert.rejects(uploadFileContentById(client, 'file', new Uint8Array([1])), (error) => error.statusCode === 503);
  assert.equal(calls, 3);
});

test('real Graph SDK receives only canonical trusted continuation URLs', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(calls.length === 1
      ? { value: [], '@odata.nextLink': 'evil.example/v1.0/https://cursor' }
      : { value: [] }), { headers: { 'Content-Type': 'application/json' } });
  });
  const client = Client.init({ authProvider: (done) => done(null, 'local-test-token') });
  await getWorksheets(client, 'file', 'session');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => new URL(url).origin === 'https://graph.microsoft.com'));
});

test('Graph continuation rejects nonstandard trusted-host ports', async () => {
  const h = graph(async () => ({ value: [], '@odata.nextLink': 'https://graph.microsoft.com:8443/v1.0/cursor' }));
  await assert.rejects(getWorksheets(h.client, 'file', 'session'), /Untrusted/);
  assert.equal(h.calls.length, 1);
});

for (const replaceAt of ['workbook-lock', 'precheck-read']) {
  test(`Row ID replacement during ${replaceAt} prevents the old cell write`, async () => {
    const map = new Map();
    const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
    const old = { markerId: 'm', sheetName: 'Sheet1', rowLocator: 2, newToken: 'old', workbookId: 'file' };
    enqueueWriteback('doc', old, storage);
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const writes = [];
    let reads = 0;
    const h = graph(async ({ method, path }) => {
      if (method === 'PATCH') { writes.push(path); return path.includes('B1') ? blocked : {}; }
      reads++;
      if (replaceAt === 'precheck-read') await blocked;
      return { values: [['']] };
    });
    const prior = replaceAt === 'workbook-lock'
      ? updateCellRange(h.client, 'file', 'session', 'Sheet1', 'B1', [[1]]) : Promise.resolve();
    const drain = drainRowIdWritebackQueue({ graphClient: h.client, documentId: 'doc', fileId: 'file', sessionId: 'session',
      capability: { liveWritebackEligible: true }, liveWritebackEnabled: true, storage });
    await new Promise((resolve) => setImmediate(resolve));
    enqueueWriteback('doc', { ...old, newToken: 'new', rowLocator: 3 }, storage);
    release({});
    await prior;
    const result = await drain;
    assert.ok(writes.every((path) => path.includes('B1')), 'obsolete Row ID must never PATCH');
    if (replaceAt === 'workbook-lock') assert.equal(reads, 0, 'obsolete work skips the precheck too');
    assert.equal(listWriteback('doc', storage)[0].newToken, 'new');
    assert.deepEqual(result.markerUpdates, []);
  });
}
