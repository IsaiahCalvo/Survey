import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createDocumentHistoryStore } from '../src/services/documentHistoryStore.js';

const row = (id, changes = {}) => ({ document_id: 'doc-1', user_id: 'author-1',
  client_event_id: id, event_type: 'edit', source: 'local', page_number: 1,
  annotation_id: id, summary: `edit ${id}`, payload: {}, is_undoable: true,
  is_checkpoint: false, occurred_at: '2026-09-14T12:00:00.000Z', ...changes });
const store = (options = {}) => createDocumentHistoryStore({ indexedDB: new IDBFactory(),
  IDBKeyRange, dbName: `history-test-${Math.random()}`, BroadcastChannel: null, ...options });

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
