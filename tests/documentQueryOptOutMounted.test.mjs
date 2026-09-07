import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
const start = source.indexOf('export const useDocuments =');
const end = source.indexOf('// TEMPLATES HOOKS', start);
assert.ok(start >= 0 && end > start, 'load the real document hook');
const hookSource = source.slice(start, end);
let counter = 0;

async function mount(t, { enabled, deferredRead = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const state = {
    user: { id: `query-opt-out-${++counter}` },
    reads: [], updates: [], listeners: new Set(), pendingReads: [],
    rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  };
  state.supabase = {
    from(table) {
      let updates = null;
      let id = null;
      const settle = () => {
        if (updates) {
          state.updates.push({ table, id, updates });
          return Promise.resolve({ data: { id, ...updates }, error: null });
        }
        state.reads.push(table);
        const result = { data: table === 'documents' ? state.rows : [], error: null };
        if (deferredRead) return new Promise((resolve) => state.pendingReads.push(() => resolve(result)));
        return Promise.resolve(result);
      };
      const builder = {
        select: () => builder,
        eq: (column, value) => { if (column === 'id') id = value; return builder; },
        is: () => builder, order: () => builder, in: () => builder, limit: () => builder, gt: () => builder,
        update: (value) => { updates = value; return builder; },
        single: settle,
        then: (resolve, reject) => settle().then(resolve, reject),
      };
      return builder;
    },
  };
  const key = `__documentQueryOptOut${counter}`;
  globalThis[key] = state;
  const moduleSource = `
    import { useState, useEffect, useCallback, useRef } from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};
    import { coalesceRead } from ${JSON.stringify(new URL('../src/hooks/requestCoalescer.js', import.meta.url).href)};
    import { isScopedRequestCurrent } from ${JSON.stringify(new URL('../src/hooks/scopedRequestGuard.js', import.meta.url).href)};
    import { readLibraryRows, readLibraryIdChunks, sortLibraryRows } from ${JSON.stringify(new URL('../src/hooks/libraryPagination.js', import.meta.url).href)};
    const state = globalThis[${JSON.stringify(key)}];
    const supabase = state.supabase;
    const useAuth = () => ({ user: state.user, tier: 'pro' });
    const isSupabaseAvailable = () => true;
    const buildDocumentProvenance = () => ({});
    const isSupabaseNotFoundError = () => false;
    const subscribeLibraryChange = (listener) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    };
    ${hookSource}
  `;
  const { useDocuments } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
  let latest;
  function Probe({ enabled }) {
    latest = useDocuments(null, enabled === undefined ? undefined : { enabled });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const render = async (value) => {
    await act(async () => root.render(React.createElement(Probe, { enabled: value })));
  };
  await render(enabled);
  t.after(async () => {
    await act(async () => root.unmount());
    delete globalThis[key];
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return { state, latest: () => latest, render };
}

test('mutation-only document hooks never read or subscribe, but updates still work', async (t) => {
  const h = await mount(t, { enabled: false });
  assert.deepEqual(h.state.reads, []);
  assert.equal(h.state.listeners.size, 0);
  assert.equal(h.latest().loading, false);
  assert.equal(h.latest().initialLoading, false);
  await act(async () => {
    assert.deepEqual(await h.latest().refetch(), []);
    assert.deepEqual(await h.latest().updateDocument('a', { name: 'saved' }), { id: 'a', name: 'saved' });
  });
  assert.deepEqual(h.state.reads, []);
  assert.equal(h.state.updates.length, 1);
});

test('default callers keep library reads, refetches, and invalidation updates', async (t) => {
  const h = await mount(t);
  assert.deepEqual(h.state.reads, ['documents', 'document_collaborators']);
  assert.equal(h.state.listeners.size, 1);
  assert.deepEqual(h.latest().documents, h.state.rows);
  assert.equal(h.latest().initialLoading, false);
  await act(async () => { await h.latest().refetch(); });
  assert.equal(h.state.reads.length, 4);
  await act(async () => { for (const listener of h.state.listeners) listener(); });
  assert.equal(h.state.reads.length, 6);
});

test('disabling a query removes listeners and prevents a late response from filling state', async (t) => {
  const h = await mount(t, { enabled: true, deferredRead: true });
  assert.equal(h.state.pendingReads.length, 2);
  await h.render(false);
  assert.equal(h.state.listeners.size, 0);
  await act(async () => { h.state.pendingReads.splice(0).forEach((finish) => finish()); });
  assert.deepEqual(h.latest().documents, []);
  assert.equal(h.latest().loading, false);
  assert.equal(h.latest().initialLoading, false);
  await act(async () => { await h.latest().refetch(); });
  assert.equal(h.state.reads.length, 2);
  await h.render(true);
  assert.equal(h.state.listeners.size, 1);
  assert.equal(h.state.reads.length, 4);
  await act(async () => { h.state.pendingReads.splice(0).forEach((finish) => finish()); });
  assert.deepEqual(h.latest().documents, h.state.rows);
});

test('overlapping document updates retain both completed changes', async (t) => {
  const h = await mount(t);
  const update = h.latest().updateDocument;
  await act(async () => {
    await Promise.all([update('a', { name: 'saved A' }), update('b', { name: 'saved B' })]);
  });
  assert.deepEqual(h.latest().documents, [{ id: 'a', name: 'saved A' }, { id: 'b', name: 'saved B' }]);
});

test('PDFViewer opts out of the library query when taking only the update callback', async () => {
  const viewer = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /\{ updateDocument: updateSupabaseDocument \} = useDocuments\(null, \{ enabled: false \}\)/);
});
