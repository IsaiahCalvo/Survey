import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const sourceUrl = new URL('../src/hooks/useDatabase.js', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const start = source.indexOf('export const useDocuments =');
const end = source.indexOf('// TEMPLATES HOOKS', start);
assert.ok(start >= 0 && end > start);
const hookSource = source.slice(start, end);
const mutationImports = [...source.matchAll(/import\s+\{[^}]+\}\s+from\s+(['"])([^'"]*(?:actorBoundDatabaseMutation|libraryMutationState|libraryMutationRunner)\.js)\1;/g)]
  .map(([statement, , path]) => statement.replace(path, new URL(path, sourceUrl).href)).join('\n');
let sequence = 0;
const id = n => `a0300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-09-14T12:00:00.000000+00:00';
const row = (n, actor, projectId = null) => ({
  id: id(n), user_id: actor, project_id: projectId, name: `Document ${n}`,
  name_truncated: false, file_size: String(9007199254740000n + BigInt(n)), page_count: n,
  created_at: stamp, updated_at: stamp, locked_at: null,
});

async function mount(t, { count = 201, projectId = null, probes = 1, failAfter = null, guest = false,
  catalogEnabled = true } = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  const prior = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const instance = ++sequence;
  const actor = guest ? null : id(900 + instance);
  const rows = Array.from({ length: count }, (_, index) => row(index + 1, actor || id(999), index % 2 ? projectId : null));
  const state = { actor, rows, rpc: [], rawReads: [], mutations: [], listeners: new Set(), authListeners: new Set(), latest: [] };
  state.supabase = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: state.actor }, access_token: `token-${state.actor}` } }, error: null }),
      onAuthStateChange(callback) {
        state.authListeners.add(callback);
        return { data: { subscription: { unsubscribe: () => state.authListeners.delete(callback) } } };
      },
    },
    rpc(name, params) {
      const call = { name, params };
      state.rpc.push(call);
      const builder = {
        setHeader(header, value) { call.header = [header, value]; return builder; },
        abortSignal(signal) { call.signal = signal; return builder; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (failAfter !== null && params.p_after_id === failAfter) {
              return { error: { code: '42501', message: 'private detail' } };
            }
            const matching = state.rows.filter(item => (!params.p_after_id || item.id > params.p_after_id)
              && (!params.p_project_id || item.project_id === params.p_project_id));
            const pageRows = matching.slice(0, params.p_limit);
            const hasMore = matching.length > params.p_limit;
            return { data: { version: 1, actor_user_id: state.actor, rows: pageRows,
              has_more: hasMore, next_cursor: hasMore ? pageRows.at(-1).id : null } };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
    from(table) {
      state.rawReads.push(table);
      let operation = 'read';
      let values = null;
      let targetId = null;
      const builder = {
        select: () => builder,
        eq: (column, value) => { if (column === 'id') targetId = value; return builder; },
        is: () => builder, in: () => builder,
        order: () => builder, limit: () => builder, gt: () => builder,
        insert: (value) => { operation = 'insert'; values = value; targetId = value.id; return builder; },
        update: (value) => { operation = 'update'; values = value; return builder; },
        single: () => builder, maybeSingle: () => builder,
        setHeader: () => builder, abortSignal: () => builder, retry: () => builder,
        then(resolve, reject) {
          if (operation === 'read') {
            const data = state.lookupRow || (targetId ? null
              : table === 'documents' ? state.rows.filter(item => !projectId || item.project_id === projectId) : []);
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          }
          const priorRow = state.rows.find(item => item.id === targetId) || {};
          const result = {
            ...priorRow,
            id: targetId,
            user_id: state.actor,
            project_id: null,
            name: values?.name || priorRow.name || 'Created document',
            file_size: 42,
            page_count: 2,
            created_at: stamp,
            updated_at: stamp,
            locked_at: null,
            file_path: `${state.actor}/private.pdf`,
            content_sha256: 'a'.repeat(64),
            archived: false,
            user_archived_at: null,
            ...values,
          };
          state.mutations.push({ operation, result });
          return Promise.resolve({ data: result, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const key = `__catalogUseDocuments${sequence}`;
  globalThis[key] = state;
  const moduleSource = `
    ${mutationImports}
    import { useState, useEffect, useCallback, useRef } from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};
    import { coalesceRead } from ${JSON.stringify(new URL('../src/hooks/requestCoalescer.js', import.meta.url).href)};
    import { isScopedRequestCurrent } from ${JSON.stringify(new URL('../src/hooks/scopedRequestGuard.js', import.meta.url).href)};
    import { readLibraryRows, readLibraryIdChunks, sortLibraryRows } from ${JSON.stringify(new URL('../src/hooks/libraryPagination.js', import.meta.url).href)};
    import { createDocumentCatalogReader } from ${JSON.stringify(new URL('../src/services/documentCatalogReader.js', import.meta.url).href)};
    const state = globalThis[${JSON.stringify(key)}];
    const supabase = state.supabase;
    const useAuth = () => ({ user: state.actor ? { id: state.actor } : null, tier: 'pro' });
    const isSupabaseAvailable = () => true;
    const buildDocumentProvenance = () => ({});
    const isSupabaseNotFoundError = () => false;
    const subscribeLibraryChange = listener => { state.listeners.add(listener); return () => state.listeners.delete(listener); };
    ${hookSource}
  `;
  const { useDocuments } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}#${sequence}`);
  function Probe({ index }) {
    state.latest[index] = useDocuments(projectId, { catalogEnabled });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(React.Fragment, null,
    ...Array.from({ length: probes }, (_, index) => React.createElement(Probe, { index, key: index })))));
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    await act(async () => root.unmount());
    assert.equal(state.authListeners.size, 0);
    dom.window.close();
    delete globalThis[key];
    for (const [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
  t.after(cleanup);
  state.cleanup = cleanup;
  return state;
}

test('catalog mode publishes all bounded pages once across matching hook consumers and never reads raw tables', async (t) => {
  const state = await mount(t, { probes: 2 });
  assert.equal(state.latest[0].documents.length, 201);
  assert.equal(state.latest[1].documents.length, 201);
  assert.equal(state.rpc.length, 2, 'two keyset pages serve both initial consumers');
  assert.deepEqual(state.rpc.map(call => call.params.p_after_id), [null, id(200)]);
  assert.ok(state.rpc.every(call => call.name === 'list_document_catalog'
    && call.header?.[0] === 'Authorization' && call.signal.aborted));
  assert.deepEqual(state.rawReads, [], 'listing makes no per-row or raw metadata reads');
  assert.equal(state.latest[0].documents[0].file_size, '9007199254740001');
});

test('catalog project filters stay server-side and optional catalog fields remain exact', async (t) => {
  const projectId = id(800);
  const state = await mount(t, { count: 6, projectId });
  assert.equal(state.rpc.length, 1);
  assert.equal(state.rpc[0].params.p_project_id, projectId);
  assert.deepEqual(state.latest[0].documents.map(item => item.id), [id(2), id(4), id(6)]);
  assert.ok(state.latest[0].documents.every(item => item.project_id === projectId));
  assert.deepEqual(state.rawReads, []);
});

test('a small catalog is one bounded request across matching hook consumers', async (t) => {
  const signed = await mount(t, { count: 10, probes: 2 });
  assert.equal(signed.rpc.length, 1);
  assert.deepEqual(signed.rawReads, []);
});

test('small legacy and catalog reads report their distinct request and payload shapes', async (t) => {
  const legacy = await mount(t, { count: 10, probes: 2, catalogEnabled: false });
  assert.equal(legacy.rpc.length, 0);
  assert.deepEqual(legacy.rawReads.sort(), ['document_collaborators', 'documents']);
  assert.equal(legacy.latest[0].documents.length, 10);
  await legacy.cleanup();

  const catalog = await mount(t, { count: 10, probes: 2 });
  assert.equal(catalog.rpc.length, 1);
  assert.deepEqual(catalog.rawReads, []);
  assert.deepEqual(Object.keys(catalog.latest[0].documents[0]).sort(), [
    'created_at', 'file_size', 'id', 'locked_at', 'name', 'name_truncated',
    'page_count', 'project_id', 'updated_at', 'user_id',
  ]);
  assert.equal('file_path' in catalog.latest[0].documents[0], false);
});

test('guest mode starts no catalog or raw read', async (t) => {
  const guest = await mount(t, { count: 10, guest: true });
  assert.deepEqual(guest.latest[0].documents, []);
  assert.deepEqual(guest.rpc, []);
  assert.deepEqual(guest.rawReads, []);
});

test('a later catalog page error publishes no partial list and never falls back to raw queries', async (t) => {
  const state = await mount(t, { failAfter: id(200) });
  assert.equal(state.rpc.length, 2);
  assert.deepEqual(state.latest[0].documents, []);
  assert.match(state.latest[0].error || '', /complete document list could not be loaded/i);
  assert.deepEqual(state.rawReads, []);
});

test('catalog-mode create, dedup, and update returns keep raw receipts but publish only catalog fields', async (t) => {
  const state = await mount(t, { count: 2 });
  const allowed = ['id', 'user_id', 'project_id', 'name', 'name_truncated', 'file_size',
    'page_count', 'created_at', 'updated_at', 'locked_at'].sort();
  const assertCatalogState = idValue => {
    const visible = state.latest[0].documents.find(item => item.id === idValue);
    assert.ok(visible);
    assert.deepEqual(Object.keys(visible).sort(), allowed);
    assert.equal(visible.file_size, '42');
    assert.equal('file_path' in visible, false);
  };

  const updated = await act(async () => state.latest[0].updateDocument(id(1), { name: 'Renamed' }));
  assert.equal(updated.file_path, `${state.actor}/private.pdf`, 'mutation caller retains its raw receipt');
  assertCatalogState(id(1));

  const createdId = id(700);
  const created = await act(async () => state.latest[0].createDocument({ id: createdId, name: 'Created' }));
  assert.equal(created.file_path, `${state.actor}/private.pdf`);
  assertCatalogState(createdId);

  const dedupId = id(701);
  state.lookupRow = { ...state.mutations.at(-1).result, id: dedupId, name: 'Dedup winner' };
  const dedup = await act(async () => state.latest[0].createDocument({ name: 'Incoming', content_sha256: 'b'.repeat(64) }));
  assert.equal(dedup.id, dedupId);
  assertCatalogState(dedupId);
});
