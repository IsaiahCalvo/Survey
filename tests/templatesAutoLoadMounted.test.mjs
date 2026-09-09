import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { coalesceRead } from '../src/hooks/requestCoalescer.js';
import { readLibraryRows, sortLibraryRows } from '../src/hooks/libraryPagination.js';
import { isScopedRequestCurrent } from '../src/hooks/scopedRequestGuard.js';

const source = await readFile(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
const mutationHelpers = Object.assign({}, ...await Promise.all([...source.matchAll(/import\s+\{[^}]+\}\s+from\s+(['"])([^'"]*(?:actorBoundDatabaseMutation|libraryMutationState|libraryMutationRunner)\.js)\1;/g)]
  .map(([, , path]) => import(new URL(path, new URL('../src/hooks/useDatabase.js', import.meta.url)).href))));
const hook = source.slice(source.indexOf('export const useTemplates ='), source.indexOf('// TEMPLATE UTILITY FUNCTIONS'))
  .replace('export const useTemplates =', 'const useTemplates =');
const tick = () => new Promise(setImmediate);
let sequence = 0;
async function mount(t, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://offline-fixture.invalid' });
  const prior = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const state = { user: { id: `template-auto-${++sequence}` }, rows: [{ id: 'a', name: 'A' }], reads: [], writes: [], listeners: new Set(), subscriptions: 0, unsubscriptions: 0, renders: [], defer: !!options.defer, error: null };
  state.authListeners = new Set();
  const client = { auth: {
    getSession: async () => ({ data: { session: state.user ? { user: state.user, access_token: `token-${state.user.id}` } : null }, error: null }),
    onAuthStateChange(callback) { state.authListeners.add(callback); return { data: { subscription: { unsubscribe: () => state.authListeners.delete(callback) } } }; },
  }, from(table) {
    const call = { table, filters: [], operation: 'read' };
    const finish = () => {
      if (call.operation !== 'read') { state.writes.push(call); return Promise.resolve({ data: { id: call.id || 'saved', ...call.data }, error: state.writeError }); }
      const result = { data: [...state.rows], error: state.error }; state.reads.push(call);
      if (state.defer) return new Promise(resolve => { call.resolve = resolve; call.result = result; });
      return Promise.resolve(result);
    };
    const query = { select: () => query, order: () => query, limit: () => query, is: () => query,
      eq: (key, value) => { call.filters.push([key, value]); if (key === 'id') call.id = value; return query; },
      insert: data => { call.operation = 'insert'; call.data = data; return query; },
      update: data => { call.operation = 'update'; call.data = data; return query; },
      delete: () => { call.operation = 'delete'; return query; },
      single: () => query, maybeSingle: () => query,
      setHeader: () => query, abortSignal: () => query, retry: () => query,
      then: (resolve, reject) => finish().then(resolve, reject) };
    return query;
  } };
  const dependencies = { ...React, ...mutationHelpers, supabase: client, useAuth: () => ({ user: state.user }), isSupabaseAvailable: () => true,
    coalesceRead, readLibraryRows, sortLibraryRows, isScopedRequestCurrent,
    subscribeLibraryChange: fn => { state.subscriptions++; state.listeners.add(fn); return () => { state.unsubscriptions++; state.listeners.delete(fn); }; } };
  const useTemplates = new Function(...Object.keys(dependencies), `${hook}\nreturn useTemplates;`)(...Object.values(dependencies));
  const latest = [];
  function Probe({ settings, index }) { latest[index] = useTemplates(settings); state.renders.push({ index, value: latest[index] }); return null; }
  let settings = options.settings || [undefined];
  const root = createRoot(document.getElementById('root')); let mounted = true;
  const render = async (next = settings) => { settings = next; await act(async () => root.render(settings.map((value, index) => React.createElement(Probe, { key: index, settings: value, index })))); };
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
  t.after(async () => {
    await unmount();
    await act(async () => { for (const read of state.reads) read.resolve?.(read.result); await tick(); });
    dom.window.close();
    for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  await render();
  return { state, latest, render, unmount, notify: () => act(async () => { for (const fn of state.listeners) fn(); await tick(); }),
    resolve: read => act(async () => { read.resolve(read.result); await tick(); }) };
}

test('disabled mutation/refetch-only consumers make no mount or event reads', async t => {
  const h = await mount(t, { settings: [{ autoLoad: false }, { autoLoad: false }] });
  assert.equal(h.state.reads.length, 0); assert.equal(h.state.listeners.size, 0);
  for (const value of h.latest) { assert.equal(value.loading, false); assert.equal(value.initialLoading, false); }
  await h.notify(); assert.equal(h.state.reads.length, 0);
});

test('one Dashboard plus AppShell and three viewer consumers use only one event sweep', async t => {
  const h = await mount(t, { settings: [undefined, ...Array.from({ length: 4 }, () => ({ autoLoad: false }))] });
  assert.equal(h.state.reads.length, 1); assert.equal(h.state.listeners.size, 1);
  await h.notify(); assert.equal(h.state.reads.length, 2);
});

test('default consumers keep boot coalescing and library refresh behavior', async t => {
  const h = await mount(t, { settings: [undefined, undefined] });
  assert.equal(h.state.reads.length, 1); assert.equal(h.state.listeners.size, 2);
  await h.notify(); assert.equal(h.state.reads.length, 3);
});

test('disabled explicit refetch stays fresh and rejects visible errors without dropping last good rows', async t => {
  const h = await mount(t, { settings: [{ autoLoad: false }] });
  await act(async () => { assert.equal((await h.latest[0].refetch())[0].name, 'A'); });
  h.state.rows = [{ id: 'b', name: 'B' }];
  await act(async () => { assert.equal((await h.latest[0].refetch())[0].name, 'B'); });
  const previous = h.latest[0].templates; h.state.error = new Error('offline');
  await act(async () => assert.rejects(h.latest[0].refetch(), /offline/));
  assert.equal(h.state.reads.length, 3); assert.equal(h.latest[0].error, 'offline'); assert.equal(h.latest[0].loading, false);
  assert.strictEqual(h.latest[0].templates, previous);
});

test('disabling retires a held automatic read; enabling starts fresh, not the retired coalesced sweep', async t => {
  const h = await mount(t, { defer: true }); const old = h.state.reads[0];
  await h.render([{ autoLoad: false }]); assert.equal(h.state.listeners.size, 0);
  h.state.rows = [{ id: 'b', name: 'B' }]; await h.render([{ autoLoad: true }]);
  assert.equal(h.state.reads.length, 2);
  assert.equal(h.latest[0].initialLoading, true, 'reenabled scope is not loaded until its fresh read completes');
  await h.resolve(h.state.reads[1]); await h.resolve(old);
  assert.deepEqual(h.latest[0].templates.map(row => row.id), ['b']);
  assert.equal(h.latest[0].initialLoading, false);
});

test('a delayed read cannot populate a disabled hook or clear its state', async t => {
  const h = await mount(t, { defer: true }); const old = h.state.reads[0];
  await h.render([{ autoLoad: false }]); await h.resolve(old);
  assert.deepEqual(h.latest[0].templates, []); assert.equal(h.latest[0].loading, false); assert.equal(h.latest[0].initialLoading, false);
});

test('account switch and same-actor return reject old results and retained refetch callbacks', async t => {
  const h = await mount(t, { defer: true }); const old = h.state.reads[0]; const oldRefetch = h.latest[0].refetch; const actor = h.state.user;
  h.state.user = { id: 'different-actor' }; await h.render();
  h.state.user = actor; h.state.rows = [{ id: 'b', name: 'B' }]; await h.render();
  assert.equal(h.state.reads.length, 3);
  await h.resolve(h.state.reads[2]); await h.resolve(old); await h.resolve(h.state.reads[1]);
  assert.deepEqual(h.latest[0].templates.map(row => row.id), ['b']);
  await act(async () => assert.deepEqual(await oldRefetch(), [])); assert.equal(h.state.reads.length, 3);
});

test('unmount retires explicit reads and callbacks without state publication', async t => {
  const h = await mount(t, { settings: [{ autoLoad: false }], defer: true }); const refetch = h.latest[0].refetch;
  let promise; await act(async () => { promise = refetch(); await tick(); }); const read = h.state.reads[0];
  await h.unmount(); await h.resolve(read); assert.deepEqual(await promise, []);
  assert.deepEqual(await refetch(), []); assert.equal(h.state.reads.length, 1); assert.equal(h.state.listeners.size, 0);
});

test('disabled mode preserves create/update/delete requests and mutation failures', async t => {
  const h = await mount(t, { settings: [{ autoLoad: false }] });
  await act(async () => {
    assert.equal((await h.latest[0].createTemplate({ name: 'Created' })).name, 'Created');
    assert.equal((await h.latest[0].updateTemplate('saved', { name: 'Updated' })).name, 'Updated');
    await h.latest[0].deleteTemplate('saved');
  });
  assert.deepEqual(h.state.writes.map(write => write.operation), ['insert', 'update', 'delete']); assert.equal(h.state.reads.length, 0);
  h.state.writeError = new Error('write denied');
  await act(async () => assert.rejects(h.latest[0].createTemplate({ name: 'Denied' }), { code: 'DATABASE_MUTATION_FAILED' }));
  assert.equal(h.latest[0].error, 'The database change could not be confirmed.');
});

test('explicit refresh bypasses a held boot read and older completion cannot replace it', async t => {
  const h = await mount(t, { defer: true }); const old = h.state.reads[0];
  h.state.rows = [{ id: 'b', name: 'Fresh' }];
  let fresh; await act(async () => { fresh = h.latest[0].refetch(); await tick(); });
  assert.equal(h.state.reads.length, 2); await h.resolve(h.state.reads[1]);
  assert.equal((await fresh)[0].name, 'Fresh'); await h.resolve(old);
  assert.equal(h.latest[0].templates[0].name, 'Fresh');
});

test('disabled account changes and signout stay read-free and discard held explicit results', async t => {
  const h = await mount(t, { settings: [{ autoLoad: false }], defer: true });
  let pending; await act(async () => { pending = h.latest[0].refetch(); await tick(); });
  h.state.user = { id: 'new-disabled-actor' }; await h.render(); await h.resolve(h.state.reads[0]);
  assert.deepEqual(await pending, []); assert.deepEqual(h.latest[0].templates, []);
  h.state.user = null; await h.render(); await h.notify();
  assert.equal(h.state.reads.length, 1); assert.equal(h.state.listeners.size, 0);
  assert.equal(h.latest[0].loading, false); assert.equal(h.latest[0].initialLoading, false);
  await act(async () => assert.deepEqual(await h.latest[0].refetch(), []));
});

test('mutation-only viewer and refetch-only shell opt out while Dashboard keeps full library', async () => {
  const viewer = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const shell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  const dashboard = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /\{ updateTemplate: updateSupabaseTemplate, createTemplate: createSupabaseTemplate \} = useTemplates\(\{ autoLoad: false \}\)/);
  assert.match(shell, /\{ refetch: refetchTemplates \} = useTemplates\(\{ autoLoad: false \}\)/);
  assert.match(dashboard, /\} = useTemplates\(\)/);
});

test('five full consumers issue five event reads; opting four out reduces the next event to one', async t => {
  const h = await mount(t, { settings: Array(5).fill(undefined) });
  assert.equal(h.state.reads.length, 1); await h.notify(); assert.equal(h.state.reads.length, 6);
  await h.render([undefined, ...Array.from({ length: 4 }, () => ({ autoLoad: false }))]);
  assert.equal(h.state.reads.length, 6); await h.notify(); assert.equal(h.state.reads.length, 7);
});

test('same actor object re-emission adds no read or subscription; true actor change reloads', async t => {
  const h = await mount(t); const listener = [...h.state.listeners][0];
  h.state.user = { ...h.state.user, refreshed: true }; await h.render();
  assert.equal(h.state.reads.length, 1); assert.equal(h.state.subscriptions, 1); assert.equal(h.state.unsubscriptions, 0);
  assert.strictEqual([...h.state.listeners][0], listener);
  h.state.user = { id: 'new-template-actor' }; await h.render();
  assert.equal(h.state.reads.length, 2); assert.equal(h.state.subscriptions, 2); assert.equal(h.state.unsubscriptions, 1);
  assert.deepEqual(h.state.reads[1].filters, [['user_id', 'new-template-actor']]);
});

test('the first disabled render hides retired rows, error and loading before passive effects', async t => {
  const h = await mount(t); assert.equal(h.latest[0].templates.length, 1);
  h.state.error = new Error('old library failure'); await act(async () => assert.rejects(h.latest[0].refetch(), /old library failure/));
  let start = h.state.renders.length; await h.render([{ autoLoad: false }]);
  let first = h.state.renders[start].value;
  assert.deepEqual(first.templates, []); assert.equal(first.error, null); assert.equal(first.loading, false); assert.equal(first.initialLoading, false);
  h.state.error = null; await h.render([{ autoLoad: true }]); h.state.defer = true;
  let pending; await act(async () => { pending = h.latest[0].refetch(); await tick(); });
  assert.equal(h.latest[0].loading, true); start = h.state.renders.length;
  await h.render([{ autoLoad: false }]); first = h.state.renders[start].value;
  assert.deepEqual(first.templates, []); assert.equal(first.loading, false);
  await h.resolve(h.state.reads.at(-1)); assert.deepEqual(await pending, []);
});

test('the first new-actor render hides old rows and reports a fresh initial load', async t => {
  const h = await mount(t); assert.equal(h.latest[0].templates[0].id, 'a');
  h.state.defer = true; h.state.user = { id: 'next-actor' }; const start = h.state.renders.length;
  await h.render(); const first = h.state.renders[start].value;
  assert.deepEqual(first.templates, []); assert.equal(first.error, null); assert.equal(first.loading, true); assert.equal(first.initialLoading, true);
  assert.deepEqual(h.latest[0].templates, [], 'old rows must stay hidden while new actor read waits');
  h.state.reads.at(-1).result = { data: [{ id: 'b', name: 'New actor' }], error: null };
  await h.resolve(h.state.reads.at(-1)); assert.equal(h.latest[0].templates[0].id, 'b');
});

test('stable listener keeps the new scope last good rows when a later event refresh fails', async t => {
  const h = await mount(t); h.state.user = { id: 'new-actor-library' }; h.state.rows = [{ id: 'b', name: 'New actor' }];
  await h.render(); const rows = h.latest[0].templates;
  h.state.error = new Error('later refresh failed'); await h.notify();
  assert.strictEqual(h.latest[0].templates, rows); assert.equal(h.latest[0].error, 'later refresh failed');
});
