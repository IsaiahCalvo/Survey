import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { coalesceRead, clearCoalescedReads } from '../src/hooks/requestCoalescer.js';
import { readLibraryRows, readLibraryIdChunks, sortLibraryRows } from '../src/hooks/libraryPagination.js';
import { isScopedRequestCurrent } from '../src/hooks/scopedRequestGuard.js';

// Actual hook bodies + actual paging and shared-read lifecycle. Only auth,
// database transport and the event source are local external ports. No writes,
// live accounts, cloud services or Microsoft integration are used.
const source = await readFile(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
const tree = parse(source, { sourceType: 'module' });
const names = { projects: 'useProjects', documents: 'useDocuments', templates: 'useTemplates' };
const bodies = Object.fromEntries(Object.entries(names).map(([kind, name]) => {
  const declaration = tree.program.body.find(node => node.type === 'ExportNamedDeclaration'
    && node.declaration?.declarations?.some(item => item.id.name === name));
  const node = declaration?.declaration.declarations.find(item => item.id.name === name)?.init;
  assert.ok(node, `Execute the real ${name} export`);
  return [kind, source.slice(node.start, node.end)];
}));
const tick = () => new Promise(setImmediate);
const uuid = n => `b0100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let serial = 100;

async function mount(t, kind, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://offline-library.invalid' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const state = { actor: Object.hasOwn(options, 'actor') ? options.actor : { id: uuid(++serial) },
    rows: options.rows || [{ id: uuid(1), name: 'Complete A', created_at: '2026-09-01T00:00:00Z' }],
    reads: [], renders: [], listeners: new Set(), busRecords: [], hold: options.hold ?? false, error: null,
    memberships: options.memberships || [], onRead: null };
  const client = { from(table) {
    const call = { table, filters: [], ids: null, signal: null, abortedBeforeSettle: false, settled: false };
    const builder = {
      select(fields) { call.fields = fields; return builder; },
      eq(key, value) { call.filters.push(['eq', key, value]); return builder; },
      is(key, value) { call.filters.push(['is', key, value]); return builder; },
      in(key, ids) { call.ids = [...ids]; call.filters.push(['in', key, [...ids]]); return builder; },
      order(key) { call.cursorColumn = key; return builder; },
      limit(limit) { call.limit = limit; return builder; },
      gt(key, value) { call.after = value; assert.equal(key, call.cursorColumn); return builder; },
      abortSignal(signal) { call.signal = signal; return builder; },
      then(resolve, reject) {
        assert.equal(call.started, undefined, 'Transport builder is consumed once'); call.started = true;
        state.reads.push(call);
        const membership = table.endsWith('_collaborators');
        const inputRows = membership ? state.memberships : state.rows;
        const rows = inputRows.filter(row => (!call.ids || call.ids.includes(row.id))
          && (call.after == null || row[call.cursorColumn] > call.after))
          .sort((a, b) => a[call.cursorColumn].localeCompare(b[call.cursorColumn])).slice(0, call.limit);
        call.result = { data: rows.map(row => ({ ...row })), error: state.error };
        const pending = new Promise(done => {
          const onAbort = () => { if (!call.settled) call.abortedBeforeSettle = true; };
          call.signal?.addEventListener('abort', onAbort);
          call.resolve = (result = call.result) => { if (call.settled) return; call.settled = true;
            call.signal?.removeEventListener('abort', onAbort); done(result); };
          if (call.signal?.aborted) onAbort();
        });
        const hold = typeof state.hold === 'function' ? state.hold(call) : state.hold;
        state.onRead?.(call);
        if (!hold) call.resolve();
        return pending.then(resolve, reject);
      },
    };
    return builder;
  } };
  const ports = { ...React, supabase: client, useAuth: () => ({ user: state.actor, tier: 'developer' }),
    isSupabaseAvailable: () => true, coalesceRead, readLibraryRows, readLibraryIdChunks, sortLibraryRows, isScopedRequestCurrent,
    subscribeLibraryChange(callback) {
      const record = { callback, removed: false }; state.busRecords.push(record); state.listeners.add(callback);
      return () => { record.removed = true; state.listeners.delete(callback); };
    } };
  const useLibrary = new Function(...Object.keys(ports), `return (${bodies[kind]});`)(...Object.values(ports));
  const latest = new Map();
  function Probe({ consumer, settings }) {
    const value = kind === 'documents' ? useLibrary(settings?.projectId ?? null, { enabled: settings?.enabled ?? true })
      : kind === 'templates' ? useLibrary(settings) : useLibrary();
    latest.set(consumer, value); state.renders.push({ consumer, value }); return null;
  }
  let consumers = options.consumers || [{ key: 'a', settings: options.settings }], mounted = true;
  const root = createRoot(dom.window.document.getElementById('root'));
  const render = async (next = consumers) => { consumers = next;
    await act(async () => { root.render(consumers.map(({ key, settings }) => React.createElement(Probe, { key, consumer: key, settings }))); await tick(); }); };
  const settle = async (calls = state.reads.filter(call => !call.settled)) => {
    await act(async () => { for (const call of calls) call.resolve(); await tick(); });
  };
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => { root.unmount(); await tick(); }); } };
  t.after(async () => {
    await unmount(); await settle(); clearCoalescedReads(); dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  await render();
  return { state, latest, render, settle, unmount,
    value: key => latest.get(key || 'a'),
    refetch: async key => { let promise; await act(async () => { promise = latest.get(key || 'a').refetch(); promise.catch(() => {}); await tick(); }); return { promise }; },
    notify: async callbacks => { await act(async () => { for (const callback of callbacks || [...state.listeners]) callback(); await tick(); }); },
  };
}

for (const kind of ['documents', 'templates']) {
  test(`${kind}: one shared boot consumer can leave while the other completes`, async t => {
    const h = await mount(t, kind, { hold: true, consumers: [{ key: 'a' }, { key: 'b' }] });
    assert.equal(h.state.reads.length, kind === 'documents' ? 2 : 1, 'One shared initial sweep');
    const held = [...h.state.reads];
    assert.ok(held.every(call => call.signal instanceof AbortSignal), 'Actual paging forwards transport signals');
    await h.render([{ key: 'b' }]);
    assert.ok(held.every(call => !call.signal.aborted), 'Remaining consumer keeps the shared transport alive');
    await h.settle(held);
    assert.equal(h.value('b')[kind][0].name, 'Complete A');
    assert.equal(h.value('b').loading, false);
    assert.equal(h.value('b').initialLoading, false);
    assert.equal(h.value('b').error, null);
  });
  test(`${kind}: the final shared boot consumer leaving aborts the held transport`, async t => {
    const h = await mount(t, kind, { hold: true, consumers: [{ key: 'a' }, { key: 'b' }] });
    const held = [...h.state.reads];
    await h.render([{ key: 'b' }]);
    assert.ok(held.every(call => !call.signal.aborted));
    await h.unmount();
    assert.ok(held.every(call => call.signal.aborted && call.abortedBeforeSettle), 'No consumer means no live shared request');
    const count = h.state.reads.length;
    await h.settle(held);
    assert.equal(h.state.reads.length, count, 'Late completion starts no follow-up page');
  });
  test(`${kind}: one consumer's fresh refresh leaves its peer's older shared boot intact`, async t => {
    const h = await mount(t, kind, { hold: true, consumers: [{ key: 'a' }, { key: 'b' }] });
    const boot = [...h.state.reads];
    h.state.rows = [{ id: uuid(10), name: 'Explicit fresh snapshot' }]; const fresh = await h.refetch('a');
    const newer = h.state.reads.slice(boot.length);
    assert.ok(boot.every(call => !call.signal.aborted), 'Peer still owns the shared read');
    assert.equal(newer.length, kind === 'documents' ? 2 : 1);
    await h.settle(newer); assert.equal((await fresh.promise)[0].name, 'Explicit fresh snapshot');
    await h.settle(boot);
    assert.equal(h.value('a')[kind][0].name, 'Explicit fresh snapshot');
    assert.equal(h.value('b')[kind][0].name, 'Complete A');
    assert.equal(h.value('a').error, null); assert.equal(h.value('b').error, null);
  });
}

for (const kind of ['projects', 'documents', 'templates']) {
  test(`${kind}: refresh cancels the superseded sweep and unmount cancels its replacement`, async t => {
    const h = await mount(t, kind, { hold: true });
    const boot = [...h.state.reads], first = await h.refetch();
    assert.ok(boot.every(call => call.signal.aborted && call.abortedBeforeSettle));
    const next = h.state.reads.slice(boot.length);
    assert.equal(next.length, kind === 'templates' ? 1 : 2, 'Explicit refresh starts a fresh sweep');
    assert.ok(next.every(call => !call.signal.aborted));
    await h.unmount();
    assert.ok(next.every(call => call.signal.aborted && call.abortedBeforeSettle));
    assert.deepEqual(await first.promise, [], 'Canceled refetch never publishes old rows');
    await h.settle();
  });
  test(`${kind}: actor A-B-A retires old refetch and bus callbacks without new I/O`, async t => {
    const h = await mount(t, kind, { hold: true }), actorA = h.state.actor;
    const old = [...h.state.reads], oldRefetch = h.value().refetch, oldBus = [...h.state.listeners];
    h.state.actor = { id: uuid(++serial) }; await h.render();
    h.state.actor = actorA; h.state.rows = [{ id: uuid(3), name: 'Fresh A return' }]; await h.render();
    const current = h.state.reads.filter(call => !call.signal.aborted);
    assert.ok(old.every(call => call.signal.aborted));
    const before = h.state.reads.length;
    await act(async () => { assert.deepEqual(await oldRefetch(), []); for (const callback of oldBus) callback(); await tick(); });
    assert.equal(h.state.reads.length, before, 'A returned actor string cannot revive an older open scope');
    await h.settle(current); await h.settle();
    assert.deepEqual(h.value()[kind].map(row => row.name), ['Fresh A return']);
    assert.equal(h.value().error, null);
  });
  test(`${kind}: same-scope failed refresh keeps its last complete library`, async t => {
    const h = await mount(t, kind), before = h.value()[kind];
    assert.equal(before[0].name, 'Complete A');
    h.state.error = new Error('Owned fixture offline');
    const failed = await h.refetch(); await assert.rejects(failed.promise, /Owned fixture offline/);
    assert.equal(h.value()[kind], before);
    assert.equal(h.value().error, 'Owned fixture offline');
    assert.equal(h.value().loading, false);
    assert.equal(h.value().initialLoading, false);
  });
  test(`${kind}: first new-actor and signed-out renders hide the retired rows and error`, async t => {
    const h = await mount(t, kind);
    h.state.error = new Error('Old actor failure'); const failed = await h.refetch(); await assert.rejects(failed.promise);
    h.state.error = null; h.state.hold = true; h.state.actor = { id: uuid(++serial) };
    let before = h.state.renders.length; await h.render();
    let first = h.state.renders[before].value;
    assert.deepEqual(first[kind], []); assert.equal(first.error, null);
    assert.equal(first.loading, true); assert.equal(first.initialLoading, true);
    assert.deepEqual(h.value()[kind], [], 'Rows stay hidden while new scope waits');
    const held = h.state.reads.filter(call => !call.settled);
    h.state.actor = null; before = h.state.renders.length; await h.render();
    first = h.state.renders[before].value;
    assert.deepEqual(first[kind], []); assert.equal(first.error, null);
    assert.equal(first.loading, false); assert.equal(first.initialLoading, false);
    assert.ok(held.every(call => call.signal.aborted));
    await h.settle(); assert.deepEqual(h.value()[kind], []);
  });
  test(`${kind}: retained refetch and removed event callbacks are inert after unmount`, async t => {
    const h = await mount(t, kind), refetch = h.value().refetch, callbacks = [...h.state.listeners];
    await h.unmount(); const before = h.state.reads.length;
    await act(async () => { assert.deepEqual(await refetch(), []); for (const callback of callbacks) callback(); await tick(); });
    assert.equal(h.state.reads.length, before);
    assert.equal(h.state.listeners.size, 0);
  });
  test(`${kind}: same-actor session object refresh does not reload or replace its bus subscription`, async t => {
    const h = await mount(t, kind), before = h.state.reads.length, bus = [...h.state.listeners], rows = h.value()[kind];
    h.state.actor = { ...h.state.actor, refreshed: true }; await h.render();
    assert.equal(h.state.reads.length, before); assert.deepEqual([...h.state.listeners], bus);
    assert.equal(h.value()[kind], rows);
  });
}

for (const kind of ['documents', 'projects']) {
  test(`${kind}: an old held membership page cannot start ID chunks after actor change`, async t => {
    const key = kind === 'documents' ? 'document_id' : 'project_id';
    const h = await mount(t, kind, { rows: [], memberships: [{ [key]: uuid(50) }], hold: call => call.table.endsWith('_collaborators') });
    const old = h.state.reads.find(call => call.table.endsWith('_collaborators'));
    assert.ok(old && !old.settled);
    h.state.memberships = []; h.state.hold = false; h.state.actor = { id: uuid(++serial) }; await h.render();
    const before = h.state.reads.length; assert.equal(old.signal.aborted, true);
    await h.settle([old]);
    assert.equal(h.state.reads.length, before);
    assert.equal(h.state.reads.some(call => call.ids), false, 'Canceled membership cannot feed a new document/project lookup');
    assert.deepEqual(h.value()[kind], []); assert.equal(h.value().error, null);
  });
  test(`${kind}: ID-chunk requests receive cancellation and never fetch the next chunk after unmount`, async t => {
    const key = kind === 'documents' ? 'document_id' : 'project_id';
    const h = await mount(t, kind, { rows: [], memberships: Array.from({ length: 101 }, (_, n) => ({ [key]: uuid(1000 + n) })),
      hold: call => call.ids !== null });
    const chunk = h.state.reads.find(call => call.ids);
    assert.equal(chunk.ids.length, 100); assert.ok(chunk.signal instanceof AbortSignal);
    assert.ok(h.state.reads.every(call => call.signal instanceof AbortSignal));
    await h.unmount(); assert.equal(chunk.signal.aborted, true);
    const before = h.state.reads.length; await h.settle([chunk]); assert.equal(h.state.reads.length, before);
    assert.equal(h.state.reads.filter(call => call.ids).length, 1);
  });
}

for (const transition of ['project', 'enabled']) {
  test(`documents: ${transition} A-B-A blocks old callbacks and preserves the new scoped read`, async t => {
    const settings = { projectId: uuid(70), enabled: true }, h = await mount(t, 'documents', { hold: true, settings });
    const oldRefetch = h.value().refetch, oldBus = [...h.state.listeners], old = [...h.state.reads];
    const other = transition === 'project' ? { ...settings, projectId: uuid(71) } : { ...settings, enabled: false };
    let before = h.state.renders.length; await h.render([{ key: 'a', settings: other }]);
    let first = h.state.renders[before].value;
    assert.deepEqual(first.documents, []); assert.equal(first.error, null);
    if (transition === 'enabled') { assert.equal(first.loading, false); assert.equal(first.initialLoading, false); }
    h.state.rows = [{ id: uuid(4), name: 'Current scope only' }]; await h.render([{ key: 'a', settings }]);
    assert.ok(old.every(call => call.signal.aborted));
    before = h.state.reads.length;
    await act(async () => { assert.deepEqual(await oldRefetch(), []); for (const callback of oldBus) callback(); await tick(); });
    assert.equal(h.state.reads.length, before);
    await h.settle(); assert.deepEqual(h.value().documents.map(row => row.name), ['Current scope only']);
    const owned = h.state.reads.filter(call => call.table === 'documents' && !call.ids).at(-1);
    assert.ok(owned.filters.some(([operation, key, value]) => operation === 'eq' && key === 'project_id' && value === settings.projectId));
  });
}

test('templates: autoLoad false stays read-free until explicit fresh refetch, which is still cancellable', async t => {
  const h = await mount(t, 'templates', { settings: { autoLoad: false } });
  assert.equal(h.state.reads.length, 0); assert.equal(h.state.listeners.size, 0);
  const first = await h.refetch(); assert.equal((await first.promise)[0].name, 'Complete A');
  h.state.rows = [{ id: uuid(8), name: 'Fresh explicit read' }];
  const second = await h.refetch(); assert.equal((await second.promise)[0].name, 'Fresh explicit read');
  assert.equal(h.state.reads.length, 2);
  h.state.hold = true; const pending = await h.refetch(), held = h.state.reads.at(-1);
  h.state.rows = [{ id: uuid(11), name: 'Other consumer boot' }];
  await h.render([{ key: 'a', settings: { autoLoad: false } }, { key: 'b' }]);
  const peerBoot = h.state.reads.at(-1);
  assert.notEqual(peerBoot, held);
  h.state.rows = [{ id: uuid(12), name: 'Reactivation after explicit read' }];
  const before = h.state.reads.length;
  await h.render([{ key: 'a', settings: { autoLoad: true } }, { key: 'b' }]);
  assert.equal(h.state.reads.length, before + 1, 'Prior explicit work counts as a read; reactivation must not join another boot');
  const reactivated = h.state.reads.at(-1);
  assert.equal(held.signal.aborted, true); assert.equal(peerBoot.signal.aborted, false);
  assert.deepEqual(await pending.promise, []);
  await h.settle([reactivated, peerBoot]);
  assert.equal(h.value('a').templates[0].name, 'Reactivation after explicit read');
  assert.equal(h.value('b').templates[0].name, 'Other consumer boot');
  const last = await h.refetch(), lastHeld = h.state.reads.at(-1);
  await h.unmount(); assert.equal(lastHeld.signal.aborted, true); assert.deepEqual(await last.promise, []);
});

test('templates: autoLoad A-B-A cannot revive old boot or removed bus callbacks', async t => {
  const h = await mount(t, 'templates', { hold: true });
  const refetch = h.value().refetch, callbacks = [...h.state.listeners], old = h.state.reads[0];
  await h.render([{ key: 'a', settings: { autoLoad: false } }]);
  assert.equal(old.signal.aborted, true); assert.equal(h.state.listeners.size, 0);
  h.state.rows = [{ id: uuid(9), name: 'Reenabled' }]; await h.render([{ key: 'a', settings: { autoLoad: true } }]);
  const before = h.state.reads.length;
  await act(async () => { assert.deepEqual(await refetch(), []); for (const callback of callbacks) callback(); await tick(); });
  assert.equal(h.state.reads.length, before);
  await h.settle(); assert.equal(h.value().templates[0].name, 'Reenabled');
});

for (const kind of ['documents', 'templates']) {
  test(`${kind}: anonymous mounts share their first signed-in read without using the retired guest scope`, async t => {
    const h = await mount(t, kind, { actor: null, hold: true, consumers: [{ key: 'a' }, { key: 'b' }] });
    assert.equal(h.state.reads.length, 0); assert.equal(h.state.listeners.size, 0);
    const stale = h.value('a').refetch;
    h.state.actor = { id: uuid(++serial) }; await h.render();
    assert.equal(h.state.reads.length, kind === 'documents' ? 2 : 1, 'First actual auth load shares one sweep');
    const before = h.state.reads.length;
    await act(async () => assert.deepEqual(await stale(), []));
    assert.equal(h.state.reads.length, before);
    await h.settle();
    assert.equal(h.value('a')[kind][0].name, 'Complete A');
    assert.equal(h.value('b')[kind][0].name, 'Complete A');
    assert.equal(h.value('a').initialLoading, false); assert.equal(h.value('b').initialLoading, false);
  });
  test(`${kind}: first enable after read-free disabled mounts shares one initial sweep`, async t => {
    const settings = kind === 'documents' ? { enabled: false } : { autoLoad: false };
    const h = await mount(t, kind, { hold: true, consumers: [{ key: 'a', settings }, { key: 'b', settings }] });
    assert.equal(h.state.reads.length, 0); assert.equal(h.state.listeners.size, 0);
    await h.render([{ key: 'a' }, { key: 'b' }]);
    assert.equal(h.state.reads.length, kind === 'documents' ? 2 : 1, 'Mounting disabled must not spend the initial shared read');
    const held = [...h.state.reads];
    await h.render([{ key: 'b' }]); assert.ok(held.every(call => !call.signal.aborted));
    await h.settle(held); assert.equal(h.value('b')[kind][0].name, 'Complete A');
  });
}
