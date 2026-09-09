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

// Real hooks, paging and mutation helpers; only auth, database transport and
// the library event source use local external ports. No cloud or real tokens.
const source = await readFile(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
const tree = parse(source, { sourceType: 'module' });
const hookNames = { projects: 'useProjects', documents: 'useDocuments', templates: 'useTemplates' };
const bodies = Object.fromEntries(Object.entries(hookNames).map(([kind, name]) => {
  const declaration = tree.program.body.find(node => node.type === 'ExportNamedDeclaration'
    && node.declaration?.declarations?.some(item => item.id.name === name));
  const node = declaration?.declaration.declarations.find(item => item.id.name === name)?.init;
  assert.ok(node, `Exercise actual ${name}`);
  return [kind, source.slice(node.start, node.end)];
}));
// Load real newly added hook dependencies from their actual import declarations.
const mutationPorts = {};
for (const node of tree.program.body.filter(node => node.type === 'ImportDeclaration'
  && /[Mm]utation|[Rr]econcil/.test(node.source.value))) {
  const module = await import(new URL(node.source.value, new URL('../src/hooks/useDatabase.js', import.meta.url)));
  for (const specifier of node.specifiers) mutationPorts[specifier.local.name] = module[specifier.imported?.name || 'default'];
}
const tick = () => new Promise(setImmediate);
const uuid = n => `c0100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, name = `Row ${n}`) => ({ id: uuid(n), name, created_at: '2026-09-09T00:00:00Z' });
const scopeChanged = error => error?.code === 'DATABASE_MUTATION_SCOPE_CHANGED';
let serial = 100;

async function mount(t, kind, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://offline-library-mutations.invalid' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const actor = { id: uuid(++serial) };
  const state = { actor, sessionActor: actor, rows: options.rows || [row(1)], calls: [], authCalls: [],
    authListeners: new Set(), libraryListeners: new Set(), hold: options.hold || (() => false),
    response: options.response || null, sessionPort: null, renders: [] };
  const session = () => state.sessionActor ? { user: state.sessionActor, access_token: `local-fixture-token:${state.sessionActor.id}` } : null;
  const makeBuilder = (table, operation = 'read', payload) => {
    const call = { table, operation, payload, filters: [], headers: {}, signal: null, retry: null, settled: false };
    const builder = {
      select(fields) { call.fields = fields; return builder; },
      insert(data) { call.operation = 'insert'; call.payload = data; return builder; },
      update(data) { call.operation = 'update'; call.payload = data; return builder; },
      delete() { call.operation = 'delete'; return builder; },
      eq(key, value) { call.filters.push([key, value]); return builder; },
      is(key, value) { call.filters.push([key, value]); return builder; },
      in(key, value) { call.filters.push([key, value]); return builder; },
      order(key) { call.order = key; return builder; },
      limit(value) { call.limit = value; return builder; },
      gt(key, value) { call.after = [key, value]; return builder; },
      single() { call.single = true; return builder; },
      maybeSingle() { call.single = true; call.maybeSingle = true; return builder; },
      setHeader(key, value) { call.headers[key.toLowerCase()] = value; return builder; },
      abortSignal(signal) { call.signal = signal; return builder; },
      retry(value) { call.retry = value; return builder; },
      then(resolve, reject) {
        assert.equal(call.started, undefined, 'A request builder must be consumed only once'); call.started = true;
        call.ambientActor = state.sessionActor?.id; state.calls.push(call);
        const id = call.filters.find(([key]) => key === 'id')?.[1];
        const fallback = call.operation === 'rpc' ? { data: call.payload.p_templates.map((item, i) => ({ ...row(i + 20), ...item, id: item.supabase_id || uuid(i + 20) })), error: null }
          : call.operation !== 'read' ? { data: { ...row(90), ...call.payload, id: id || call.payload?.id || uuid(90) }, error: null }
            : call.single ? { data: null, error: null }
              : { data: table.endsWith('_collaborators') ? [] : state.rows.filter(item => !call.after || item[call.after[0]] > call.after[1]).map(item => ({ ...item })), error: null };
        call.result = state.response?.(call) ?? fallback;
        const pending = new Promise(done => { call.resolve = (result = call.result) => { if (call.settled) return; call.settled = true; done(result); }; });
        if (!state.hold(call)) call.resolve();
        return pending.then(resolve, reject);
      },
    };
    return builder;
  };
  const client = { from: table => makeBuilder(table), rpc: (name, payload) => makeBuilder(name, 'rpc', payload),
    auth: {
      async getSession() { state.authCalls.push('getSession'); return state.sessionPort ? state.sessionPort() : { data: { session: session() }, error: null }; },
      onAuthStateChange(callback) { state.authListeners.add(callback); return { data: { subscription: { unsubscribe() { state.authListeners.delete(callback); } } } }; },
    },
  };
  const ports = { ...React, ...mutationPorts, supabase: client, useAuth: () => ({ user: state.actor, tier: 'developer' }),
    isSupabaseAvailable: () => true, coalesceRead, readLibraryRows, readLibraryIdChunks, sortLibraryRows, isScopedRequestCurrent,
    buildDocumentProvenance: () => ({ uploaded_from_platform: 'web' }),
    isSupabaseNotFoundError: error => error?.code === 'PGRST116',
    subscribeLibraryChange(callback) { state.libraryListeners.add(callback); return () => state.libraryListeners.delete(callback); },
  };
  const useLibrary = new Function(...Object.keys(ports), `return (${bodies[kind]});`)(...Object.values(ports));
  let latest, settings = options.settings, mounted = true;
  function Probe() {
    latest = kind === 'documents' ? useLibrary(settings?.projectId ?? null, { enabled: settings?.enabled ?? true })
      : kind === 'templates' ? useLibrary(settings) : useLibrary();
    state.renders.push(latest); return null;
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  const render = async (next = settings) => { settings = next; await act(async () => { root.render(React.createElement(Probe)); await tick(); }); };
  const settle = async (calls = state.calls.filter(call => !call.settled)) => { await act(async () => { for (const call of calls) call.resolve(); await tick(); }); };
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => { root.unmount(); await tick(); }); } };
  t.after(async () => { await unmount(); await settle(); clearCoalescedReads(); dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  await render();
  return { state, client, render, settle, unmount, value: () => latest,
    async switchActor(next, { notify = true } = {}) { state.actor = next; state.sessionActor = next;
      if (notify) for (const callback of [...state.authListeners]) callback(next ? 'SIGNED_IN' : 'SIGNED_OUT', session());
      await render();
    },
    async start(callback) { let promise; await act(async () => { promise = callback(); promise.catch(() => {}); await tick(); }); return { promise: promise.then(value => ({ value }), error => ({ error })) }; },
  };
}

test('templates: a retired actor callback starts no mutation request after A-B-A', async t => {
  const h = await mount(t, 'templates', { settings: { autoLoad: false } });
  const old = h.value().replaceTemplates, actorA = h.state.actor;
  await h.switchActor({ id: uuid(++serial) }); await h.switchActor(actorA);
  const before = h.state.calls.length;
  await act(async () => assert.rejects(old([]), scopeChanged));
  assert.equal(h.state.calls.length, before);
});

const singular = { projects: 'Project', documents: 'Document', templates: 'Template' };
const mutationCalls = (kind, value) => [
  () => value[`create${singular[kind]}`]({ name: 'Created' }),
  () => value[`update${singular[kind]}`](uuid(1), { name: 'Changed' }),
  () => value[`delete${singular[kind]}`](uuid(1)),
  ...(kind === 'templates' ? [() => value.replaceTemplates([])] : []),
  ...(kind === 'documents' ? [() => value.updateLastOpened(uuid(1))] : []),
];
const mutationOnly = kind => kind === 'documents' ? { enabled: false } : kind === 'templates' ? { autoLoad: false } : undefined;
const listRequest = call => call.operation === 'read' && !call.single;

for (const kind of Object.keys(hookNames)) {
  test(`${kind}: all retained mutations reject actor A-B-A and unmount before new transport`, async t => {
    const h = await mount(t, kind, { settings: mutationOnly(kind) });
    const callbacks = mutationCalls(kind, h.value()), actorA = h.state.actor;
    await h.switchActor({ id: uuid(++serial) }); await h.switchActor(actorA);
    const before = h.state.calls.length;
    await act(async () => { for (const callback of callbacks) await assert.rejects(callback(), scopeChanged); });
    assert.equal(h.state.calls.length, before);
    const current = mutationCalls(kind, h.value()); await h.unmount();
    await act(async () => { for (const callback of current) await assert.rejects(callback(), scopeChanged); });
    assert.equal(h.state.calls.length, before);
    assert.equal(h.state.authListeners.size, 0);
  });

  for (const failed of [false, true]) {
    test(`${kind}: late ${failed ? 'failure' : 'success'} from actor A never publishes rows, errors or a successful result to B`, async t => {
      const h = await mount(t, kind, { settings: mutationOnly(kind), hold: call => call.operation === 'insert' });
      const pending = await h.start(() => h.value()[`create${singular[kind]}`]({ name: 'A-only' }));
      const write = h.state.calls.find(call => call.operation === 'insert'); assert.ok(write);
      assert.equal(write.headers.authorization, `Bearer local-fixture-token:${h.state.actor.id}`);
      assert.equal(write.retry, false); assert.ok(write.signal instanceof AbortSignal);
      h.state.rows = [row(7, 'B complete')]; await h.switchActor({ id: uuid(++serial) });
      const before = h.value()[kind];
      await act(async () => {
        write.resolve(failed ? { data: null, error: { code: '42501', message: 'A secret failure' } }
          : { data: { ...row(90, 'A-only'), user_id: uuid(999) }, error: null });
        await tick();
      });
      const result = await pending.promise;
      assert.ok(scopeChanged(result.error)); assert.equal(result.value, undefined);
      assert.equal(result.error.mayHaveCommitted, true);
      assert.deepEqual(h.value()[kind], before); assert.equal(h.value().error, null);
      assert.ok(write.signal.aborted); assert.equal(h.state.authListeners.size, 0);
    });
  }

  test(`${kind}: stored auth changes before dispatch without a React render and no new actor write starts`, async t => {
    const h = await mount(t, kind, { settings: mutationOnly(kind) });
    let resolveSession;
    h.state.sessionPort = () => new Promise(resolve => { resolveSession = resolve; });
    const before = h.state.calls.length;
    const pending = await h.start(() => h.value()[`create${singular[kind]}`]({ name: 'Not B' }));
    assert.equal(typeof resolveSession, 'function');
    h.state.sessionActor = { id: uuid(++serial) };
    await act(async () => { resolveSession({ data: { session: { user: h.state.sessionActor, access_token: 'local-B-token' } }, error: null }); await tick(); });
    const result = await pending.promise;
    assert.ok(scopeChanged(result.error)); assert.equal(result.error.mayHaveCommitted, false);
    assert.equal(h.state.calls.length, before); assert.equal(h.state.authListeners.size, 0);
  });

  test(`${kind}: acknowledged create, update and delete survive an older list while unknown rows and returned read data stay complete`, async t => {
    const h = await mount(t, kind, { rows: [row(1, 'Unknown retained'), row(2, 'Before update'), row(3, 'Before delete')], hold: listRequest });
    const pending = await h.start(() => h.value().refetch());
    const oldReads = h.state.calls.filter(call => listRequest(call) && !call.signal.aborted);
    assert.ok(oldReads.length > 0);
    await act(async () => {
      await h.value()[`create${singular[kind]}`]({ name: 'New acknowledged' });
      await h.value()[`update${singular[kind]}`](uuid(2), { name: 'Updated acknowledged' });
      await h.value()[`delete${singular[kind]}`](uuid(3));
    });
    assert.ok(oldReads.every(call => !call.signal.aborted), 'Do not discard the only source of unseen rows');
    await h.settle(oldReads);
    const result = await pending.promise; assert.equal(result.error, undefined);
    const expected = [[uuid(1), 'Unknown retained'], [uuid(2), 'Updated acknowledged'], [uuid(90), 'New acknowledged']];
    const values = rows => rows.map(item => [item.id, item.name]).sort(([a], [b]) => a.localeCompare(b));
    assert.deepEqual(values(h.value()[kind]), expected);
    assert.deepEqual(values(result.value), expected);
    assert.equal(h.value().loading, false); assert.equal(h.value().initialLoading, false);
  });
}

for (const [kind, initial, middle] of [
  ['documents', { projectId: uuid(4), enabled: false }, { projectId: uuid(5), enabled: false }],
  ['documents', { enabled: false }, { enabled: true }],
  ['templates', { autoLoad: false }, { autoLoad: true }],
]) {
  test(`${kind}: retained ${initial.projectId ? 'project' : 'read-mode'} callback rejects after scope A-B-A`, async t => {
    const h = await mount(t, kind, { settings: initial }); const callbacks = mutationCalls(kind, h.value());
    await h.render(middle); await h.render(initial); const before = h.state.calls.length;
    await act(async () => { for (const callback of callbacks) await assert.rejects(callback(), scopeChanged); });
    assert.equal(h.state.calls.length, before);
  });
}

for (const kind of ['documents', 'templates']) {
  test(`${kind}: current mutation-only mode still permits create, update and delete without library reads`, async t => {
    const h = await mount(t, kind, { settings: mutationOnly(kind) });
    await act(async () => {
      const saved = await h.value()[`create${singular[kind]}`]({ name: 'Saved disabled' }); assert.equal(saved.name, 'Saved disabled');
      const updated = await h.value()[`update${singular[kind]}`](saved.id, { name: 'Updated disabled' }); assert.equal(updated.name, 'Updated disabled');
      await h.value()[`delete${singular[kind]}`](saved.id);
    });
    assert.equal(h.state.calls.filter(listRequest).length, 0);
    assert.deepEqual(h.value()[kind], []); assert.equal(h.state.authListeners.size, 0);
  });
}

for (const outcome of ['revive', 'insert', 'conflict-retry']) {
  for (const silentSession of [false, true]) {
  test(`documents: ${silentSession ? 'stored-session drift' : 'actor change'} during ${outcome} lookup prevents every later stage`, async t => {
    const h = await mount(t, 'documents', { settings: { enabled: false },
      hold: call => outcome === 'conflict-retry' ? call.operation === 'insert' : call.maybeSingle,
      response: call => call.maybeSingle ? { data: outcome === 'revive' ? { ...row(11), archived: true } : null, error: null }
        : call.operation === 'insert' && outcome === 'conflict-retry' ? { data: null, error: { code: '23505' } } : null,
    });
    const pending = await h.start(() => h.value().createDocument({ name: 'Dedup', content_sha256: 'hash-fixture' }));
    const held = h.state.calls.filter(call => !call.settled); assert.equal(held.length, 1);
    const before = h.state.calls.length;
    if (silentSession) h.state.sessionActor = { id: uuid(++serial) };
    else await h.switchActor({ id: uuid(++serial) });
    await h.settle(held);
    const result = await pending.promise; assert.ok(scopeChanged(result.error)); assert.equal(result.value, undefined);
    assert.equal(h.state.calls.length, before, 'No revive, insert or retry after the operation loses its actor');
    assert.deepEqual(h.value().documents, []);
    if (!silentSession) assert.equal(h.value().error, null);
    assert.equal(result.error.mayHaveCommitted, outcome === 'conflict-retry');
  });
  }
}

test('templates: an acknowledged whole-set replacement supersedes an older list and composes with later changes', async t => {
  const h = await mount(t, 'templates', { rows: [row(1, 'Must disappear')], hold: listRequest });
  const pending = await h.start(() => h.value().refetch());
  const old = h.state.calls.filter(call => listRequest(call) && !call.signal.aborted);
  await act(async () => {
    await h.value().replaceTemplates([{ supabase_id: uuid(20), name: 'Snapshot', config: {} }]);
    await h.value().createTemplate({ name: 'After snapshot' });
    await h.value().updateTemplate(uuid(20), { name: 'Snapshot updated' });
  });
  await h.settle(old); const result = await pending.promise;
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value.map(item => item.name).sort(), ['After snapshot', 'Snapshot updated']);
  assert.deepEqual(h.value().templates, result.value);
});

for (const kind of Object.keys(hookNames)) {
  test(`${kind}: mutable create input is captured before held authentication and cannot alter the write intent`, async t => {
    const h = await mount(t, kind, { settings: mutationOnly(kind) });
    let resolveSession;
    h.state.sessionPort = () => new Promise(resolve => { resolveSession = resolve; });
    const input = { name: 'Original intent', config: { modules: [{ name: 'Original nested' }] } };
    const pending = await h.start(() => h.value()[`create${singular[kind]}`](input));
    input.name = 'Changed after call'; input.config.modules[0].name = 'Changed nested';
    h.state.sessionPort = null;
    await act(async () => { resolveSession({ data: { session: { user: h.state.actor, access_token: `local-fixture-token:${h.state.actor.id}` } }, error: null }); await tick(); });
    const result = await pending.promise; assert.equal(result.error, undefined);
    const write = h.state.calls.find(call => call.operation === 'insert'); assert.ok(write);
    assert.equal(write.payload.name, 'Original intent'); assert.equal(write.payload.config.modules[0].name, 'Original nested');
    assert.equal(result.value.name, 'Original intent');
    assert.equal(h.value()[kind][0].config.modules[0].name, 'Original nested');
  });

  test(`${kind}: malformed acknowledged rows reject without poisoning a complete list or claiming no remote commit`, async t => {
    const h = await mount(t, kind, { response: call => call.operation === 'insert' ? { data: { name: 'Missing row identity' }, error: null } : null });
    const before = h.value()[kind];
    const pending = await h.start(() => h.value()[`create${singular[kind]}`]({ name: 'Requested' }));
    const result = await pending.promise;
    assert.ok(result.error, 'An id-less server row must not become successful caller data');
    assert.equal(result.value, undefined); assert.equal(result.error.mayHaveCommitted, true);
    assert.deepEqual(h.value()[kind], before);
  });
}

test('templates: a malformed whole-set response preserves the prior set and reports an unconfirmed dispatched write', async t => {
  const h = await mount(t, 'templates', { response: call => call.operation === 'rpc' ? { data: [{ name: 'Missing row identity' }], error: null } : null });
  const before = h.value().templates;
  const pending = await h.start(() => h.value().replaceTemplates([{ supabase_id: uuid(20), name: 'Valid input', config: {} }]));
  const result = await pending.promise;
  assert.ok(result.error); assert.equal(result.value, undefined); assert.equal(result.error.mayHaveCommitted, true);
  assert.deepEqual(h.value().templates, before);
});

test('templates: mutating a returned row cannot change the pending read journal or the visible acknowledged value', async t => {
  const h = await mount(t, 'templates', { rows: [row(1, 'Retained')], hold: listRequest });
  const pending = await h.start(() => h.value().refetch());
  const old = h.state.calls.filter(call => listRequest(call) && !call.signal.aborted);
  let saved;
  await act(async () => { saved = await h.value().createTemplate({ name: 'Acknowledged', config: { modules: ['Original'] } }); });
  saved.name = 'Mutated return'; saved.config.modules[0] = 'Mutated nested return';
  assert.equal(h.value().templates[0].name, 'Acknowledged');
  assert.deepEqual(h.value().templates[0].config.modules, ['Original']);
  await h.settle(old); const result = await pending.promise;
  const acknowledged = result.value.find(item => item.id === saved.id);
  assert.equal(acknowledged.name, 'Acknowledged'); assert.deepEqual(acknowledged.config.modules, ['Original']);
});

for (const kind of Object.keys(hookNames)) {
  test(`${kind}: input conversion cannot impersonate a trusted transport error or leak its message`, async t => {
    const h = await mount(t, kind, { settings: mutationOnly(kind) });
    const before = h.value()[kind], callCount = h.state.calls.length, authCount = h.state.authCalls.length;
    const untrusted = Object.assign(new Error('Raw input-only private fixture detail'), { code: 'CUSTOM' });
    const pending = await h.start(() => h.value()[`create${singular[kind]}`]({
      name: 'Never dispatched', toJSON() { throw untrusted; },
    }));
    const result = await pending.promise;
    assert.equal(result.value, undefined); assert.notStrictEqual(result.error, untrusted);
    assert.equal(result.error.code, 'DATABASE_MUTATION_INPUT'); assert.equal(result.error.mayHaveCommitted, false);
    assert.equal(result.error.message, 'The database change could not be confirmed.');
    assert.equal(h.value().error, 'The database change could not be confirmed.');
    assert.equal(h.state.calls.length, callCount); assert.equal(h.state.authCalls.length, authCount);
    assert.deepEqual(h.value()[kind], before); assert.equal(h.state.authListeners.size, 0);
  });

  test(`${kind}: an update reply for another row rejects without replacing that row or claiming rollback`, async t => {
    const h = await mount(t, kind, { rows: [row(1, 'Unrelated original'), row(2, 'Requested original')],
      response: call => call.operation === 'update' ? { data: row(1, 'Wrong-row reply'), error: null } : null,
    });
    const before = h.value()[kind];
    const pending = await h.start(() => h.value()[`update${singular[kind]}`](uuid(2), { name: 'Intended update' }));
    const result = await pending.promise;
    assert.equal(result.value, undefined); assert.equal(result.error?.code, 'DATABASE_MUTATION_FAILED');
    assert.equal(result.error.mayHaveCommitted, true);
    const writes = h.state.calls.filter(call => call.operation === 'update'); assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].filters, [['id', uuid(2)]]);
    assert.deepEqual(h.value()[kind], before);
  });
}
