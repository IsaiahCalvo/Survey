import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createDocumentHistoryStore } from '../src/services/documentHistoryStore.js';
import { computeContentSha256 } from '../src/services/contentHash.js';

const row = (id, changes = {}) => ({ document_id: 'doc-1', user_id: 'author-1',
  client_event_id: id, event_type: 'edit', source: 'local', page_number: 1,
  annotation_id: id, summary: `edit ${id}`, payload: {}, is_undoable: true,
  is_checkpoint: false, occurred_at: '2026-09-14T12:00:00.000Z', ...changes });
const store = (options = {}) => createDocumentHistoryStore({ indexedDB: new IDBFactory(),
  IDBKeyRange, dbName: `history-test-${Math.random()}`, BroadcastChannel: null, ...options });

const openRequest = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const stableFixture = value => Array.isArray(value) ? `[${value.map(stableFixture).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableFixture(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const fixtureDigest = value => computeContentSha256(new TextEncoder().encode(stableFixture(value)));

async function populatedV1(indexedDB, dbName, { closeOnVersionChange = true } = {}) {
  const request = indexedDB.open(dbName, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    const rows = db.createObjectStore('rows', { keyPath: ['scopeKey', 'documentId', 'clientEventId'] });
    rows.createIndex('scopeDocument', ['scopeKey', 'documentId']);
    rows.createIndex('scopeDocumentTime', ['scopeKey', 'documentId', 'occurredAt', 'savedAt']);
    db.createObjectStore('meta', { keyPath: 'key' });
    const eviction = db.createObjectStore('eviction', { keyPath: ['scopeKey', 'documentId', 'clientEventId'] });
    eviction.createIndex('savedAt', 'savedAt');
  };
  const db = await openRequest(request);
  let versionChanges = 0;
  db.onversionchange = () => { versionChanges += 1; if (closeOnVersionChange) db.close(); };
  const pendingRow = row('v1-pending');
  const confirmedRow = row('v1-confirmed');
  const pendingDigest = await fixtureDigest(pendingRow);
  const confirmedDigest = await fixtureDigest(confirmedRow);
  const tx = db.transaction(['rows', 'meta', 'eviction'], 'readwrite');
  tx.objectStore('rows').put({ version: 2, scopeKey: 'account:a', documentId: 'doc-1',
    clientEventId: 'v1-pending', revision: 1, rowDigest: pendingDigest, syncState: 'pending',
    occurredAt: pendingRow.occurred_at, savedAt: 10, bytes: 600, row: pendingRow });
  tx.objectStore('rows').put({ version: 2, scopeKey: 'account:a', documentId: 'doc-1',
    clientEventId: 'v1-confirmed', revision: 1, rowDigest: confirmedDigest, syncState: 'confirmed',
    occurredAt: confirmedRow.occurred_at, savedAt: 20, bytes: 400, row: confirmedRow });
  tx.objectStore('meta').put({ key: 'global', protectedBytes: 600, confirmedBytes: 400 });
  tx.objectStore('meta').put({ key: 'scope:account:a', scopeKey: 'account:a', pendingCount: 1,
    protectedBytes: 600, confirmedBytes: 400, lastErrorCode: null });
  tx.objectStore('eviction').put({ scopeKey: 'account:a', documentId: 'doc-1',
    clientEventId: 'v1-confirmed', savedAt: 20, bytes: 400 });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return { db, pendingRow, pendingToken: { scopeKey: 'account:a', documentId: 'doc-1',
    clientEventId: 'v1-pending', revision: 1, rowDigest: pendingDigest },
  getVersionChanges: () => versionChanges };
}

test('account and guest scopes stay separate from event authors', async () => {
  const history = store();
  try {
    await history.admitPending('account:a', row('one', { user_id: 'collaborator' }));
    await history.admitPending('account:b', row('two', { user_id: 'collaborator' }));
    await history.admitPending('guest:device-local', row('guest', { user_id: null }));
    assert.deepEqual((await history.list('account:a', 'doc-1')).map(value => value.client_event_id), ['one']);
    assert.deepEqual((await history.list('account:b', 'doc-1')).map(value => value.client_event_id), ['two']);
    assert.deepEqual((await history.list('guest:device-local', 'doc-1')).map(value => value.client_event_id), ['guest']);
  } finally { history.close(); }
});

test('exact retry keeps its token and a conflicting payload cannot replace the first committed event', async () => {
  const history = store();
  try {
    const first = await history.admitPending('account:a', row('same'));
    const retry = await history.admitPending('account:a', { ...row('same'), id: 'server-default',
      created_at: '2026-09-14T12:00:00+00:00' });
    assert.deepEqual(retry.token, first.token);
    await assert.rejects(history.admitPending('account:a', row('same', { summary: 'different' })),
      { code: 'DOCUMENT_HISTORY_EVENT_CONFLICT' });
    assert.equal((await history.list('account:a', 'doc-1'))[0].summary, 'edit same');
    assert.equal(await history.confirm(first.token, { ...row('same'), id: 'cloud-id',
      occurred_at: '2026-09-14T12:00:00+00:00', created_at: '2026-09-14T12:00:01Z' }), true);
    assert.equal((await history.list('account:a', 'doc-1'))[0].__syncState, 'confirmed');
  } finally { history.close(); }
});

test('concurrent different payloads for one event key admit exactly one immutable winner', async () => {
  const history = store();
  try {
    const results = await Promise.allSettled([
      history.admitPending('account:a', row('race', { summary: 'first' })),
      history.admitPending('account:a', row('race', { summary: 'second' })),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(results.find(result => result.status === 'rejected').reason.code,
      'DOCUMENT_HISTORY_EVENT_CONFLICT');
    const saved = (await history.list('account:a', 'doc-1'))[0];
    assert.ok(saved.summary === 'first' || saved.summary === 'second');
  } finally { history.close(); }
});

test('exact acknowledgement ignores server identity and normalizes database defaults', async () => {
  const history = store();
  const client = { document_id: 'doc-1', user_id: 'actor', client_event_id: 'defaults',
    event_type: 'edit', summary: 'defaults', occurred_at: '2026-09-14T12:00:00Z' };
  try {
    const admitted = await history.admitPending('account:a', client);
    assert.equal(await history.confirm(admitted.token, { ...client, id: 'server-id', payload: {},
      is_undoable: true, is_checkpoint: false, source: null, page_number: null, annotation_id: null,
      occurred_at: '2026-09-14T12:00:00+00:00', created_at: '2026-09-14T12:00:01Z' }), true);
  } finally { history.close(); }
});

test('global confirmed budget evicts old cache across accounts but never pending sole copies', async () => {
  const history = store({ confirmedBudgetBytes: 1500, protectedLimitBytes: 10_000 });
  try {
    const pending = await history.admitPending('account:a', row('pending', { payload: { restoreAction: { id: 1 } } }));
    await history.cacheConfirmed('account:a', row('cache-a', { summary: 'a'.repeat(300) }));
    await history.cacheConfirmed('account:b', row('cache-b', { summary: 'b'.repeat(300) }));
    assert.equal((await history.list('account:a', 'doc-1')).some(value => value.client_event_id === 'pending'), true);
    assert.equal((await history.list('account:a', 'doc-1')).some(value => value.client_event_id === 'cache-a'), false);
    assert.equal((await history.list('account:b', 'doc-1')).some(value => value.client_event_id === 'cache-b'), true);
    assert.equal(await history.confirm(pending.token, row('pending', { payload: { restoreAction: { id: 1 } } })), true);
  } finally { history.close(); }
});

test('protected admission cap fails clearly without deleting the prior pending row', async () => {
  const history = store({ confirmedBudgetBytes: 0, protectedLimitBytes: 650 });
  try {
    await history.admitPending('account:a', row('kept', { summary: 'x'.repeat(100) }));
    await assert.rejects(history.admitPending('account:b', row('rejected', { summary: 'y'.repeat(400) })),
      { code: 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED' });
    assert.deepEqual((await history.list('account:a', 'doc-1')).map(value => value.client_event_id), ['kept']);
  } finally { history.close(); }
});

test('subscriptions fire only after committed changes and no-op confirms stay quiet', async () => {
  const history = store(); let a = 0, b = 0;
  const offA = history.subscribe('account:a', () => { a++; });
  const offB = history.subscribe('account:b', () => { b++; });
  try {
    const admitted = await history.admitPending('account:a', row('notify'));
    assert.deepEqual([a, b], [1, 0]);
    assert.equal(await history.confirm({ ...admitted.token, revision: 99 }, row('notify')), false);
    assert.equal(a, 1);
    assert.equal(await history.confirm(admitted.token, row('notify')), true);
    assert.equal(a, 2);
    assert.equal(await history.confirm(admitted.token, row('notify')), true);
    assert.equal(a, 2);
    offA(); await history.cacheConfirmed('account:a', row('later')); assert.equal(a, 2);
  } finally { offA(); offB(); history.close(); }
});

test('protected-cap failure commits one scoped status signal without claiming the row was stored', async () => {
  const history = store({ protectedLimitBytes: 700 });
  let notices = 0;
  const off = history.subscribe('account:a', () => { notices++; });
  try {
    await history.admitPending('account:a', row('kept', { summary: 'x'.repeat(100) }));
    const beforeFailure = notices;
    await assert.rejects(history.admitPending('account:a', row('rejected', { summary: 'y'.repeat(500) })),
      { code: 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED' });
    assert.equal(notices, beforeFailure + 1);
    assert.equal((await history.list('account:a', 'doc-1')).some(value => value.client_event_id === 'rejected'), false);
    const status = await history.status('account:a');
    assert.equal(status.errorCode, 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED');
    assert.equal(status.protectedLimitBytes, 700);
    assert.equal(status.globalProtectedBytes, status.protectedBytes);
  } finally { off(); history.close(); }
});

test('repeated over-budget cloud batches stay notification-quiet', async () => {
  const history = store({ confirmedBudgetBytes: 1500 });
  let notices = 0;
  const off = history.subscribe('account:a', () => { notices++; });
  const cloudRows = [row('cloud-a', { summary: 'a'.repeat(300) }), row('cloud-b', { summary: 'b'.repeat(300) })];
  try {
    assert.equal(await history.cacheConfirmedBatch('account:a', cloudRows), true);
    assert.equal(await history.cacheConfirmedBatch('account:a', cloudRows), true);
    assert.equal(notices, 0);
    assert.ok((await history.status('account:a')).confirmedCacheBytes <= 1500);
  } finally { off(); history.close(); }
});

test('document reads return only the requested newest rows', async () => {
  const history = store({ protectedLimitBytes: 100_000 });
  try {
    for (let index = 0; index < 12; index += 1) {
      await history.admitPending('account:a', row(`ordered-${index}`, {
        occurred_at: `2026-09-14T12:${String(index).padStart(2, '0')}:00Z`,
      }));
    }
    assert.deepEqual((await history.list('account:a', 'doc-1', 3)).map(value => value.client_event_id),
      ['ordered-11', 'ordered-10', 'ordered-9']);
  } finally { history.close(); }
});

test('account replay is bounded, cursor-driven, FIFO, and never enumerates guest or confirmed rows', async () => {
  const history = store({ protectedLimitBytes: 100_000 });
  try {
    const one = await history.admitPending('account:a', row('one'));
    const poison = await history.admitPending('account:a', row('poison'));
    await history.admitPending('account:a', row('three'));
    await history.admitPending('guest:device-local', row('guest'));
    await history.cacheConfirmed('account:a', row('confirmed'));
    assert.equal(await history.deferPending(poison.token, {
      errorCode: 'BAD_ROW', permanent: true,
    }), 'updated');

    const first = await history.listPending('account:a', { limit: 2, now: 100 });
    assert.deepEqual(first.items.map(item => item.row.client_event_id), ['one']);
    assert.equal(first.items[0].attemptCount, 0);
    assert.deepEqual(first.items[0].token, one.token);
    assert.equal(typeof first.nextCursor, 'string');
    const second = await history.listPending('account:a', { limit: 2, cursor: first.nextCursor, now: 100 });
    assert.deepEqual(second.items.map(item => item.row.client_event_id), ['three']);
    assert.deepEqual(await history.listPending('guest:device-local'), {
      items: [], nextCursor: null, nextRetryAt: null,
    });
  } finally { history.close(); }
});

test('transient deferral updates protected bytes, exact retry clears it, and stale tokens cannot mutate it', async () => {
  const history = store({ protectedLimitBytes: 100_000 });
  try {
    const admitted = await history.admitPending('account:a', row('retry'));
    const before = await history.status('account:a');
    assert.equal(await history.deferPending(admitted.token, {
      errorCode: 'NETWORK', retryAt: 500, permanent: false,
    }), 'updated');
    const after = await history.status('account:a');
    assert.ok(after.protectedBytes > before.protectedBytes);
    assert.ok(after.globalProtectedBytes > before.globalProtectedBytes);
    const waiting = await history.listPending('account:a', { now: 499 });
    assert.deepEqual(waiting.items, []);
    assert.equal(waiting.nextRetryAt, 500);
    const due = await history.listPending('account:a', { now: 500 });
    assert.equal(due.items[0].attemptCount, 1);
    assert.deepEqual(await history.getPending(due.items[0].token), due.items[0]);
    assert.equal(await history.getPending({ ...due.items[0].token, revision: 99 }), null);
    assert.equal(await history.deferPending({ ...admitted.token, revision: 2 }, {
      errorCode: 'LATE', retryAt: 900,
    }), 'stale');
    const retry = await history.admitPending('account:a', row('retry'));
    assert.deepEqual(retry.token, admitted.token);
    assert.equal((await history.listPending('account:a', { now: 0 })).items[0].attemptCount, 0);
    assert.equal((await history.status('account:a')).protectedBytes, before.protectedBytes);
  } finally { history.close(); }
});

test('permanent deferral survives exact admission retry and confirm remains the exact sole-copy acknowledgement', async () => {
  const history = store({ protectedLimitBytes: 100_000 });
  try {
    const admitted = await history.admitPending('account:a', row('permanent'));
    assert.equal(await history.deferPending(admitted.token, { errorCode: 'DENIED', permanent: true }), 'updated');
    await history.admitPending('account:a', row('permanent'));
    assert.deepEqual((await history.listPending('account:a', { now: Number.MAX_SAFE_INTEGER })).items, []);
    const explicitRetry = await history.listPending('account:a', {
      now: Number.MAX_SAFE_INTEGER, includePermanent: true,
    });
    assert.deepEqual(explicitRetry.items.map(item => item.row.client_event_id), ['permanent']);
    assert.equal(await history.getPending(admitted.token), null);
    assert.deepEqual(
      await history.getPending(admitted.token, { includePermanent: true }),
      explicitRetry.items[0],
    );
    assert.equal(await history.confirm({ ...admitted.token, rowDigest: 'wrong' }, row('permanent')), false);
    assert.equal((await history.list('account:a', 'doc-1'))[0].__syncState, 'pending');
    assert.equal(await history.confirm(admitted.token, row('permanent')), true);
    assert.equal((await history.list('account:a', 'doc-1'))[0].__syncState, 'confirmed');
  } finally { history.close(); }
});

test('retry metadata that would exceed the protected cap leaves the pending row and counters unchanged', async () => {
  const history = store({ protectedLimitBytes: 650 });
  try {
    const admitted = await history.admitPending('account:a', row('cap', { summary: 'x'.repeat(100) }));
    const before = await history.status('account:a');
    await assert.rejects(history.deferPending(admitted.token, {
      errorCode: 'E'.repeat(500), retryAt: 500,
    }), { code: 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED' });
    assert.deepEqual(await history.status('account:a'), before);
    assert.equal((await history.listPending('account:a', { now: 0 })).items.length, 1);
  } finally { history.close(); }
});

test('scope replay errors notify once per change without touching pending payloads', async () => {
  const history = store();
  let notices = 0;
  const off = history.subscribe('account:a', () => { notices += 1; });
  try {
    const admitted = await history.admitPending('account:a', row('lock-missing'));
    const afterAdmission = notices;
    assert.equal(await history.setScopeError('account:a', 'DOCUMENT_HISTORY_WEB_LOCKS_UNAVAILABLE'), true);
    assert.equal(notices, afterAdmission + 1);
    assert.equal(await history.setScopeError('account:a', 'DOCUMENT_HISTORY_WEB_LOCKS_UNAVAILABLE'), false);
    assert.equal(notices, afterAdmission + 1);
    assert.deepEqual((await history.getPending(admitted.token)).row, row('lock-missing'));
    assert.equal((await history.status('account:a')).errorCode, 'DOCUMENT_HISTORY_WEB_LOCKS_UNAVAILABLE');
    assert.equal(await history.setScopeError('account:a', null), true);
    assert.equal((await history.status('account:a')).errorCode, null);
    assert.equal(notices, afterAdmission + 2);
    assert.equal(await history.setScopeError('account:a', null), false);
    assert.equal(await history.setScopeError('guest:device-local', 'SHOULD_NOT_WRITE'), false);
  } finally { off(); history.close(); }
});

test('v1 upgrade adds replay access in place and preserves pending, confirmed, counters, and eviction data', async () => {
  const indexedDB = new IDBFactory();
  const dbName = `history-v1-upgrade-${Math.random()}`;
  const legacy = await populatedV1(indexedDB, dbName);
  const history = createDocumentHistoryStore({ indexedDB, IDBKeyRange, dbName, BroadcastChannel: null,
    confirmedBudgetBytes: 700 });
  try {
    const pending = await history.listPending('account:a');
    assert.deepEqual(pending.items.map(item => item.row.client_event_id), ['v1-pending']);
    assert.deepEqual((await history.list('account:a', 'doc-1')).map(item => [item.client_event_id, item.__syncState]),
      [['v1-confirmed', 'confirmed'], ['v1-pending', 'pending']]);
    assert.deepEqual(await history.status('account:a'), { available: true, pendingCount: 1,
      protectedBytes: 600, globalProtectedBytes: 600, protectedLimitBytes: 64 * 1024 * 1024,
      protectedFull: false, confirmedCacheBytes: 400, errorCode: null });
    assert.equal(legacy.getVersionChanges(), 1);
    assert.equal(await history.confirm(legacy.pendingToken, legacy.pendingRow), true,
      'the v1 pending row remains confirmable by its original exact token');
    assert.deepEqual((await history.list('account:a', 'doc-1')).map(item => [item.client_event_id, item.__syncState]),
      [['v1-pending', 'confirmed']], 'the preserved v1 eviction record prunes the older confirmed row');
  } finally { history.close(); legacy.db.close(); }
});

test('a v1 connection that does not close keeps the v2 upgrade blocked and fails clearly', async () => {
  const indexedDB = new IDBFactory();
  const dbName = `history-v1-blocked-${Math.random()}`;
  const legacy = await populatedV1(indexedDB, dbName, { closeOnVersionChange: false });
  const history = createDocumentHistoryStore({ indexedDB, IDBKeyRange, dbName, BroadcastChannel: null });
  try {
    await assert.rejects(history.listPending('account:a'), { code: 'DOCUMENT_HISTORY_STORE_UNAVAILABLE' });
    assert.equal(legacy.getVersionChanges(), 1);
  } finally { history.close(); legacy.db.close(); }
});
