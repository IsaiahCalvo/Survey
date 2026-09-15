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
const mutationImports = [...source.matchAll(/import\s+\{[^}]+\}\s+from\s+(['"])([^'"]*(?:actorBoundDatabaseMutation|libraryMutationState|libraryMutationRunner)\.js)\1;/g)]
  .map(([statement, , path]) => statement.replace(path, new URL(path, new URL('../src/hooks/useDatabase.js', import.meta.url)).href)).join('\n');
const section = (start, end) => source.slice(source.indexOf(start), end ? source.indexOf(end, source.indexOf(start)) : undefined);
const hookSource = [
  section('export const useProjects =', '// DOCUMENTS HOOKS'),
  section('export const useDocuments =', '// TEMPLATES HOOKS'),
  section('export const useTemplates =', '// TEMPLATE UTILITY FUNCTIONS'),
  section('export const useConnectedServices =', '// DOCUMENT TOOL PREFERENCES HOOKS'),
  section('const DEFAULT_TOOL_PREFERENCES ='),
].join('\n');
let sequence = 0;

async function mount(t, hookName, { deferredReads = false, deferredPreferenceReads = false, args = [], tablesForUser } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const state = {
    user: { id: `hook-race-${++sequence}` },
    rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    listeners: new Set(), reads: [], metadataReads: [], writes: [], invalidations: [],
    timers: new Map(), timerId: 0, readError: null, writeError: null, queryLog: [],
    sessionReads: [], writeReplies: [], authListeners: new Set(),
    deferPreferenceReads: deferredPreferenceReads,
  };
  state.tables = tablesForUser?.(state.user.id);
  state.supabase = {
    auth: {
      onAuthStateChange(callback) {
        state.authListeners.add(callback);
        return { data: { subscription: { unsubscribe: () => state.authListeners.delete(callback) } } };
      },
      getSession() {
        const actor = state.authUser === undefined ? state.user : state.authUser;
        const result = { data: { session: actor ? { user: actor, access_token: `token-${actor.id}` } : null }, error: null };
        if (state.deferSession) return new Promise((resolve) => state.sessionReads.push({ result, resolve }));
        state.sessionReads.push({ result });
        return Promise.resolve(result);
      },
    },
    from(table) {
      let operation = 'read';
      let data;
      let id;
      let orderColumn, pageLimit, cursor;
      const filters = [];
      const headers = {};
      const settle = () => {
        if (operation !== 'read') {
          state.writes.push({ table, operation, id, data, headers });
          if (state.deferWrites) return new Promise((resolve) => state.writeReplies.push(resolve));
          return Promise.resolve({ data: state.zeroWrite ? null : { id, ...data }, error: state.writeError });
        }
        let rows = table.endsWith('_collaborators') ? [] : state.rows;
        if (state.tables) {
          rows = (state.tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
          if (orderColumn) rows = [...rows].sort((a, b) => String(a[orderColumn]).localeCompare(String(b[orderColumn])));
          rows = rows.slice(0, Math.min(pageLimit ?? 1000, 1000));
        }
        state.queryLog.push({ table, orderColumn, pageLimit, cursor });
        const result = { data: rows, error: state.readError || state.failPage?.(table, cursor) };
        if (deferredReads) return new Promise((resolve) => state.reads.push({ table, resolve }));
        return Promise.resolve(result);
      };
      const builder = {
        setHeader: (name, value) => { headers[name] = value; return builder; },
        abortSignal: () => builder,
        retry: () => builder,
        select: () => builder,
        is: (column, value) => { filters.push((row) => row[column] === value); return builder; },
        order: (column) => { orderColumn = column; return builder; },
        in: (column, values) => { filters.push((row) => values.includes(row[column])); return builder; },
        eq: (column, value) => { if (column === 'id') id = value; filters.push((row) => row[column] === value); return builder; },
        limit: (count) => { pageLimit = count; return builder; },
        gt: (column, value) => { cursor = value; filters.push((row) => row[column] > value); return builder; },
        insert: (row) => { operation = 'insert'; data = row; return builder; },
        upsert: (row) => { operation = 'upsert'; data = row; return builder; },
        update: (row) => { operation = 'update'; data = row; return builder; },
        delete: () => { operation = 'delete'; return builder; },
        single: () => builder,
        maybeSingle: () => builder,
        then: (resolve, reject) => settle().then(resolve, reject),
      };
      return builder;
    },
  };
  const key = `__dataHookStateRace${sequence}`;
  globalThis[key] = state;
  const moduleSource = `
    ${mutationImports}
    import { useState, useEffect, useCallback, useRef } from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};
    import { coalesceRead } from ${JSON.stringify(new URL('../src/hooks/requestCoalescer.js', import.meta.url).href)};
    import { isScopedRequestCurrent } from ${JSON.stringify(new URL('../src/hooks/scopedRequestGuard.js', import.meta.url).href)};
    import { readLibraryRows, readLibraryIdChunks, sortLibraryRows } from ${JSON.stringify(new URL('../src/hooks/libraryPagination.js', import.meta.url).href)};
    import { randomUUID } from ${JSON.stringify(new URL('../src/utils/randomUUIDPolyfill.js', import.meta.url).href)};
    import { queueToolPreferenceWrite } from ${JSON.stringify(new URL('../src/hooks/toolPreferenceWriteQueue.js', import.meta.url).href)};
    const state = globalThis[${JSON.stringify(key)}];
    const supabase = state.supabase;
    const useAuth = () => ({ user: state.user });
    const isSupabaseAvailable = () => true;
    const isConnectedServicesAvailable = () => true;
    const setConnectedServicesAvailable = () => {};
    const isSchemaError = () => false;
    const buildDocumentProvenance = () => ({});
    const isSupabaseNotFoundError = () => false;
    const subscribeLibraryChange = (listener) => { state.listeners.add(listener); return () => state.listeners.delete(listener); };
    const resolveDocumentMetadata = (id) => new Promise((resolve) => state.metadataReads.push({ id, resolve }));
    const invalidateDocumentMetadata = (id) => state.invalidations.push(id);
    const resolveDocumentToolPreferenceScope = ({ actorUserId, documentId, supabaseDocId }) => !documentId ? null
      : supabaseDocId ? (actorUserId ? { kind: 'account-cloud', actorUserId, documentId, supabaseDocId } : null)
        : actorUserId ? { kind: 'account-local', actorUserId, documentId, supabaseDocId: null }
          : { kind: 'device-local', deviceScopeId: 'device-local', documentId, supabaseDocId: null };
    const documentToolPreferenceScopeKey = (scope) => scope ? JSON.stringify(scope) : null;
    const preferenceRecords = new Map();
    const documentToolPreferences = {
      snapshot(scope) { return preferenceRecords.get(documentToolPreferenceScopeKey(scope)) || { preferences: null, revision: 0, pending: false, errorCode: null }; },
      admit(scope, preferences) {
        const value = { preferences, revision: 0, pending: scope.kind === 'account-cloud', errorCode: null };
        preferenceRecords.set(documentToolPreferenceScopeKey(scope), value);
        return { snapshot: value, draft: value.pending ? {} : null };
      },
      flush(scope, options) {
        state.preferenceFlushes ||= []; state.preferenceFlushes.push({ scope, signal: options?.signal });
        if (state.preferenceFlushError) {
          const current = this.snapshot(scope);
          preferenceRecords.set(documentToolPreferenceScopeKey(scope), { ...current, conflict: true });
          return Promise.reject(state.preferenceFlushError);
        }
        return Promise.resolve(this.snapshot(scope));
      },
      refresh(scope) {
        const fallback = this.snapshot(scope);
        if (!state.deferPreferenceReads) return Promise.resolve(fallback);
        return new Promise(resolve => { (state.preferenceReads ||= []).push({ scope, resolve }); });
      },
      subscribe() { return () => {}; },
      resolveConflict(scope, choice) {
        const current = this.snapshot(scope);
        const next = { ...current, conflict: false, pending: choice === 'keep' };
        preferenceRecords.set(documentToolPreferenceScopeKey(scope), next);
        return next;
      },
    };
    const setTimeout = (callback) => { const id = ++state.timerId; state.timers.set(id, () => { state.timers.delete(id); return callback(); }); return id; };
    const clearTimeout = (id) => state.timers.delete(id);
    ${hookSource}
  `;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
  let latest;
  function Probe({ args }) { latest = mod[hookName](...args); return null; }
  let root = createRoot(document.getElementById('root'));
  const render = async (nextArgs = args) => act(async () => root.render(React.createElement(Probe, { args: nextArgs })));
  let unmounted = false;
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await act(async () => root.unmount());
  };
  await render();
  t.after(async () => {
    await unmount();
    delete globalThis[key];
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.localStorage;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const remount = async () => {
    await unmount();
    root = createRoot(document.getElementById('root'));
    unmounted = false;
    await render();
  };
  return { state, render, unmount, remount, latest: () => latest };
}

for (const [hook, entity, rows] of [['useProjects', 'Project', 'projects'], ['useTemplates', 'Template', 'templates']]) {
  test(`${hook} preserves concurrent creates, updates, and deletes`, async (t) => {
    const h = await mount(t, hook);
    await act(async () => {
      await Promise.all([
        h.latest()[`create${entity}`]({ id: 'c', name: 'C' }),
        h.latest()[`create${entity}`]({ id: 'd', name: 'D' }),
      ]);
    });
    assert.deepEqual(h.latest()[rows].map((row) => row.id).sort(), ['a', 'b', 'c', 'd']);
    await act(async () => {
      await Promise.all([
        h.latest()[`update${entity}`]('a', { name: 'A2' }),
        h.latest()[`update${entity}`]('b', { name: 'B2' }),
      ]);
    });
    assert.equal(h.latest()[rows].find((row) => row.id === 'a').name, 'A2');
    assert.equal(h.latest()[rows].find((row) => row.id === 'b').name, 'B2');
    await act(async () => {
      await Promise.all([h.latest()[`delete${entity}`]('c'), h.latest()[`delete${entity}`]('d')]);
    });
    assert.deepEqual(h.latest()[rows].map((row) => row.id).sort(), ['a', 'b']);
  });
}

test('template library event consumes read rejection while keeping error visible', async (t) => {
  const h = await mount(t, 'useTemplates');
  h.state.readError = { message: 'offline' };
  await act(async () => { for (const listener of h.state.listeners) listener(); });
  assert.equal(h.latest().error, 'offline');
  assert.equal(h.latest().loading, false);
  await act(async () => assert.rejects(h.latest().refetch(), { message: 'offline' }));
});

test('connected service account switch and sign-out discard old responses and rows', async (t) => {
  const h = await mount(t, 'useConnectedServices', { deferredReads: true });
  h.state.user = { id: 'other-user' };
  await h.render();
  await act(async () => h.state.reads[1].resolve({ data: [{ service_name: 'google', account_email: 'other@example.test' }] }));
  await act(async () => h.state.reads[0].resolve({ data: [{ service_name: 'microsoft', account_email: 'old@example.test' }] }));
  assert.deepEqual(Object.keys(h.latest().services), ['google']);
  h.state.user = null;
  await h.render();
  assert.deepEqual(h.latest().services, {});
  assert.equal(h.latest().loading, false);
});

test('connected service refetch uses latest request, not last response', async (t) => {
  const h = await mount(t, 'useConnectedServices', { deferredReads: true });
  let newer;
  await act(async () => { newer = h.latest().refetch(); });
  await act(async () => {
    h.state.reads[1].resolve({ data: [{ service_name: 'google' }] });
    await newer;
  });
  await act(async () => h.state.reads[0].resolve({ data: [{ service_name: 'old' }] }));
  assert.deepEqual(Object.keys(h.latest().services), ['google']);
});


test('tool preferences hide the prior account on the first switched render and ignore its delayed read', async (t) => {
  const h = await mount(t, 'useDocumentToolPreferences', { args: ['a', 'cloud-a'], deferredPreferenceReads: true });
  await act(async () => h.latest().updateToolPreference('pen', { strokeColor: 'red' }));
  h.state.user = { id: 'other-user' };
  await h.render();
  assert.equal(h.latest().getToolPreference('pen').strokeColor, '#ff0000');
  h.state.user = { id: 'third-user' };
  await h.render();
  await act(async () => h.state.preferenceReads.at(-2).resolve({ preferences: { pen: { strokeColor: 'blue' } }, errorCode: null }));
  assert.equal(h.latest().getToolPreference('pen').strokeColor, '#ff0000');
  await act(async () => h.state.preferenceReads.at(-1).resolve({ preferences: { pen: { strokeColor: 'green' } }, errorCode: null }));
  assert.equal(h.latest().getToolPreference('pen').strokeColor, 'green');
});

test('tool preferences ignore a delayed read for a previously open document', async (t) => {
  const h = await mount(t, 'useDocumentToolPreferences', { args: ['a', 'cloud-a'], deferredPreferenceReads: true });
  await h.render(['b', 'cloud-b']);
  await act(async () => h.state.preferenceReads[1].resolve({ preferences: { pen: { strokeColor: 'blue' } }, errorCode: null }));
  await act(async () => h.state.preferenceReads[0].resolve({ preferences: { pen: { strokeColor: 'red' } }, errorCode: null }));
  assert.equal(h.latest().getToolPreference('pen').strokeColor, 'blue');
});

test('local edit beats an earlier cloud read and schedules one scoped flush', async (t) => {
  const h = await mount(t, 'useDocumentToolPreferences', { args: ['a', 'cloud-a'], deferredPreferenceReads: true });
  await act(async () => h.latest().updateToolPreference('pen', { strokeColor: 'green' }));
  await act(async () => h.state.preferenceReads[0].resolve({ preferences: { pen: { strokeColor: 'red' } }, errorCode: null }));
  assert.equal(h.latest().getToolPreference('pen').strokeColor, 'green');
  await act(async () => { for (const callback of h.state.timers.values()) await callback(); });
  assert.equal(h.state.preferenceFlushes.length, 1);
  assert.equal(h.state.preferenceFlushes[0].scope.supabaseDocId, 'cloud-a');
});

for (const change of ['account', 'document', 'close']) {
  test(`tool preference debounce stops after ${change} change`, async (t) => {
    const h = await mount(t, 'useDocumentToolPreferences', { args: ['a', 'cloud-a'] });
    await act(async () => h.latest().updateToolPreference('pen', { strokeColor: 'green' }));
    const queued = [...h.state.timers.values()];
    if (change === 'account') { h.state.user = { id: 'other-actor' }; await h.render(); }
    else if (change === 'document') await h.render(['b', 'cloud-b']);
    else await h.unmount();
    assert.equal(h.state.timers.size, 0);
    await act(async () => { for (const callback of queued) await callback(); });
    assert.deepEqual(h.state.preferenceFlushes || [], []);
  });
}

test('signed managed-local preferences stay actor scoped and never schedule cloud work', async (t) => {
  const h = await mount(t, 'useDocumentToolPreferences', { args: ['local-a', null] });
  await act(async () => h.latest().updateToolPreference('pen', { strokeColor: 'green' }));
  assert.equal(h.latest().getToolPreference('pen').strokeColor, 'green');
  assert.equal(h.state.timers.size, 0);
  assert.deepEqual(h.state.preferenceFlushes || [], []);
});

test('tool preference scope cleanup aborts its queued lock or network work', async (t) => {
  const h = await mount(t, 'useDocumentToolPreferences', { args: ['a', 'cloud-a'] });
  await act(async () => h.latest().updateToolPreference('pen', { strokeColor: 'green' }));
  await act(async () => { for (const callback of h.state.timers.values()) await callback(); });
  const oldSignal = h.state.preferenceFlushes[0].signal;
  assert.equal(oldSignal.aborted, false);
  await h.render(['b', 'cloud-b']);
  assert.equal(oldSignal.aborted, true);
});

test('a rejected flush publishes its conflict marker and both real hook actions resolve it', async (t) => {
  const h = await mount(t, 'useDocumentToolPreferences', { args: ['a', 'cloud-a'] });
  h.state.preferenceFlushError = Object.assign(new Error('Choose which defaults to use.'), { code: '40001' });
  await act(async () => h.latest().updateToolPreference('pen', { strokeColor: 'green' }));
  await act(async () => { for (const callback of h.state.timers.values()) await callback(); });
  assert.equal(h.latest().preferenceConflict, true);
  await act(async () => h.latest().useSavedToolPreferences());
  assert.equal(h.latest().preferenceConflict, false);
  h.state.preferenceFlushError = null;
  await act(async () => h.latest().updateToolPreference('pen', { strokeColor: 'blue' }));
  h.state.preferenceFlushError = Object.assign(new Error('Choose which defaults to use.'), { code: '40001' });
  await act(async () => { for (const callback of h.state.timers.values()) await callback(); });
  assert.equal(h.latest().preferenceConflict, true);
  await act(async () => h.latest().keepShownToolPreferences());
  assert.equal(h.latest().preferenceConflict, false);
});

for (const [hook, table, memberColumn] of [
  ['useDocuments', 'documents', 'document_id'],
  ['useProjects', 'projects', 'project_id'],
]) {
  test(`${hook} loads over 1000 owned and shared rows without losing filters or ordering`, async (t) => {
    const membershipTable = table === 'documents' ? 'document_collaborators' : 'project_collaborators';
    const h = await mount(t, hook, {
      tablesForUser(userId) {
        const row = (id, owner = userId) => ({ id, user_id: owner, archived: false, user_archived_at: null,
          updated_at: '2026-09-07', created_at: '2026-09-07' });
        const owned = Array.from({ length: 1003 }, (_, i) => row(`o${String(i).padStart(4, '0')}`));
        const shared = Array.from({ length: 1003 }, (_, i) => row(`s${String(i).padStart(4, '0')}`, 'owner'));
        const hidden = { ...row('z-hidden'), user_archived_at: '2026-09-01' };
        return {
          [table]: [...owned, ...shared, hidden, row('z-not-shared', 'someone-else')],
          [membershipTable]: [...shared, owned[0], hidden].map((record) => ({ [memberColumn]: record.id, user_id: userId, status: 'active' })),
        };
      },
    });
    assert.equal(h.latest()[table].length, 2006);
    assert.equal(new Set(h.latest()[table].map((row) => row.id)).size, 2006);
    assert.equal(h.latest()[table][0].id, 'o0000');
    assert.equal(h.latest()[table].at(-1).id, 's1002');
    assert.ok(!h.latest()[table].some((row) => row.id.startsWith('z')));
    assert.ok(h.state.queryLog.every((query) => query.pageLimit === 500));
    assert.ok(h.state.queryLog.some((query) => query.table === membershipTable && query.cursor));
    const before = h.latest()[table];
    h.state.failPage = (queryTable, cursor) => queryTable === table && cursor ? new Error('later page offline') : null;
    await act(async () => assert.rejects(h.latest().refetch(), /later page offline/));
    assert.equal(h.latest()[table], before, 'do not publish the incomplete replacement');
    assert.equal(h.latest().loading, false);
  });

  test(`${hook} keeps shared rows and reports failed membership refreshes until a complete retry`, async (t) => {
    const membershipTable = table === 'documents' ? 'document_collaborators' : 'project_collaborators';
    const h = await mount(t, hook, {
      tablesForUser(userId) {
        const row = (id, owner = userId) => ({ id, user_id: owner, archived: false, user_archived_at: null,
          updated_at: '2026-09-07', created_at: '2026-09-07' });
        const shared = Array.from({ length: 501 }, (_, i) => row(`s${String(i).padStart(4, '0')}`, 'owner'));
        return {
          [table]: [row('owned'), ...shared],
          [membershipTable]: shared.map((record) => ({ [memberColumn]: record.id, user_id: userId, status: 'active' })),
        };
      },
    });
    const completeRows = h.latest()[table];
    assert.equal(completeRows.length, 502);
    for (const laterPage of [false, true]) {
      h.state.failPage = (queryTable, cursor) => queryTable === membershipTable && (!laterPage || cursor)
        ? new Error('membership offline') : null;
      await act(async () => assert.rejects(h.latest().refetch(), /membership offline/));
      assert.equal(h.latest()[table], completeRows, 'a failed membership read must not hide shared files');
      assert.equal(h.latest().error, 'membership offline');
      assert.equal(h.latest().loading, false);
    }
    h.state.failPage = null;
    // An actual successful membership removal must still remove the shared item.
    h.state.tables[membershipTable] = h.state.tables[membershipTable].slice(1);
    await act(async () => h.latest().refetch());
    assert.equal(h.latest().error, null);
    assert.equal(h.latest()[table].length, 501);
    assert.ok(!h.latest()[table].some((row) => row.id === 's0000'));
  });
}

test('templates paginate beyond 1000 rows and retain last complete state on error', async (t) => {
  const h = await mount(t, 'useTemplates', {
    tablesForUser(userId) {
      return { templates: Array.from({ length: 1203 }, (_, i) => ({
        id: String(i).padStart(4, '0'), user_id: userId, user_archived_at: null, created_at: '2026-09-07',
      })) };
    },
  });
  assert.equal(h.latest().templates.length, 1203);
  assert.deepEqual(h.state.queryLog.map((query) => query.cursor), [undefined, '0499', '0999']);
  const before = h.latest().templates;
  h.state.failPage = (_table, cursor) => cursor ? new Error('offline') : null;
  await act(async () => assert.rejects(h.latest().refetch(), /offline/));
  assert.equal(h.latest().templates, before);
});
