/**
 * documentHistoryService supabase error paths via mocked client.
 * Requires --experimental-test-module-mocks.
 */
import { mock, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const state = {
  upsertError: { code: '42P01', message: 'relation document_history_events does not exist' },
  selectError: null,
  rows: [],
};

function makeSupabaseMock() {
  const chain = {};
  for (const name of ['from', 'upsert', 'select', 'eq', 'order', 'limit', 'in']) {
    chain[name] = () => chain;
  }
  chain.then = (resolve, reject) => {
    // Detect upsert vs select by last call is hard; prefer upsertError when set for write path.
    // recordDocumentHistoryEvent awaits upsert chain; list awaits select chain.
    // Both use thenable — use a flag flipped by method names.
    const err = chain.__mode === 'select' ? state.selectError : state.upsertError;
    if (err) return Promise.resolve({ data: null, error: err }).then(resolve, reject);
    return Promise.resolve({ data: state.rows, error: null }).then(resolve, reject);
  };
  const origFrom = chain.from;
  chain.from = (...args) => {
    chain.__mode = 'write';
    return origFrom(...args);
  };
  const origSelect = chain.select;
  chain.select = (...args) => {
    chain.__mode = 'select';
    return origSelect(...args);
  };
  const origUpsert = chain.upsert;
  chain.upsert = (...args) => {
    chain.__mode = 'upsert';
    return origUpsert(...args);
  };
  return chain;
}

const supabaseUrl = pathToFileURL(resolve('src/supabaseClient.js')).href;
const client = makeSupabaseMock();

before(() => {
  mock.module(supabaseUrl, {
    namedExports: {
      supabase: client,
      isSupabaseAvailable: () => true,
      isAuthRefreshTokenError: () => false,
      clearSupabaseAuthStorage: () => {},
      recoverSupabaseAuthSession: async () => null,
      getSupabaseSession: async () => null,
      getAuthSnapshot: async () => ({ session: null, user: null }),
      isSchemaError: () => false,
      isConnectedServicesAvailable: () => false,
      setConnectedServicesAvailable: () => {},
    },
  });
});

test('recordDocumentHistoryEvent swallows missing-table and surfaces other errors', async () => {
  const {
    buildHistoryEventRowFromDebugEvent,
    recordDocumentHistoryEvent,
    listDocumentHistoryEvents,
  } = await import('../src/services/documentHistoryService.js');

  globalThis.window = {
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); },
    },
    dispatchEvent() { return true; },
  };
  try {
    const row = buildHistoryEventRowFromDebugEvent({
      type: 'local_annotation_history_added',
      checkpointId: 900,
      actionType: 'create',
      annotationType: 'path',
      annotationId: 'hist-1',
      pageNumber: 1,
    }, { documentId: 'doc-hist', user: { id: 'u1', email: 'a@b.c' } });

    state.upsertError = { code: '42P01', message: 'relation document_history_events does not exist' };
    const recorded = await recordDocumentHistoryEvent(row);
    assert.equal(recorded.error, null);

    state.upsertError = { code: '42501', message: 'permission denied' };
    const recorded2 = await recordDocumentHistoryEvent({
      ...row,
      client_event_id: `${row.client_event_id}:perm`,
    });
    assert.ok(recorded2.error);

    state.upsertError = null;
    state.selectError = null;
    state.rows = [];
    const listed = await listDocumentHistoryEvents('doc-hist', { limit: 5 });
    assert.ok(Array.isArray(listed));
  } finally {
    delete globalThis.window;
  }
});

test('listDocumentHistoryEvents rethrows non-missing-table errors', async () => {
  const { listDocumentHistoryEvents } = await import('../src/services/documentHistoryService.js');
  globalThis.window = {
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); },
    },
  };
  try {
    state.selectError = { code: '42501', message: 'permission denied for table' };
    await assert.rejects(
      () => listDocumentHistoryEvents('doc-hist-perm', { limit: 3 }),
      (err) => err?.code === '42501' || /permission/i.test(String(err?.message || err)),
    );
  } finally {
    state.selectError = null;
    delete globalThis.window;
  }
});
