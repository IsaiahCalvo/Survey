import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { runActorBoundDatabaseMutation } from '../src/services/actorBoundDatabaseMutation.js';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
const actor = 'aa300000-0000-4000-8000-000000000001';
const creator = 'aa300000-0000-4000-8000-000000000002';
const documentId = 'aa300000-0000-4000-8000-000000000003';
const empty = [];
const noop = () => {};
const noUI = () => null;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function loadDashboard(modules) {
  const key = `__catalogDashboard${crypto.randomUUID().replaceAll('-', '')}`;
  globalThis[key] = modules;
  let transformed = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm,
    (_all, bindings, specifier) => {
      const name = specifier.split('/').at(-1).replace(/\.(jsx|js)$/, '');
      const value = `globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}]`;
      if (!modules[name]) modules[name] = new Proxy({ default: noUI }, {
        get: (target, property) => target[property] || noop,
      });
      if (bindings.startsWith('* as ')) return `const ${bindings.slice(5)} = ${value};`;
      if (bindings.startsWith('{')) return `const ${bindings.replace(/\bas\b/g, ':')} = ${value};`;
      return `const ${bindings} = ${value}.default;`;
    }).replace(/^import ['"][^'"]+\.css['"];?$/gm, '').replaceAll('import.meta.env', '({DEV:false})');
  const output = await transformWithOxc(transformed, 'Dashboard.jsx', { lang: 'jsx' });
  const code = output.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const loaded = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  delete globalThis[key];
  return loaded;
}

async function mount(t, { role = 'owner', roleGate = null } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test/' });
  const restore = [];
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, File: dom.window.File, Blob: dom.window.Blob,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restore.push(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  const catalogRow = { id: documentId, user_id: creator, project_id: null, name: null,
    name_truncated: null, file_size: '42', page_count: null,
    created_at: null, updated_at: '2026-09-14T12:00:00Z', locked_at: null };
  const state = { hub: null, hookOptions: [], roleCalls: [], lockCalls: [], downloads: 0,
    acquired: [], created: [], docs: null, sessionActor: actor, authListeners: new Set() };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: state.sessionActor }, access_token: 'token-a' } }, error: null }),
      onAuthStateChange(callback) {
        state.authListeners.add(callback);
        return { data: { subscription: { unsubscribe: () => state.authListeners.delete(callback) } } };
      },
    },
    rpc(name, params) {
      const builder = {
        setHeader: () => builder, abortSignal: () => builder, retry: () => builder,
        then(resolve, reject) {
          if (name === 'get_my_document_role') {
            state.roleCalls.push(params.doc_id);
            return Promise.resolve(roleGate?.promise).then(() => ({ data: role, error: null })).then(resolve, reject);
          }
          state.lockCalls.push(params.doc_id);
          return Promise.resolve({ data: { locked_at: 'now' }, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const hooks = { projects: empty, templates: empty, initialLoading: false, refetch: async () => empty };
  const documentHookResult = { documents: [catalogRow], initialLoading: false, refetch: async () => [catalogRow],
    createDocument: async input => { state.created.push(input); return { ...input, user_id: actor }; },
    updateDocument: async () => catalogRow, deleteDocument: noop };
  const documentsHook = (_projectId, options) => {
    state.hookOptions.push(options);
    return documentHookResult;
  };
  const SurveyHub = props => { state.hub = props; return null; };
  const Dashboard = await loadDashboard({
    react: React, SurveyHub: { default: SurveyHub },
    AuthContext: { useAuth: () => ({ user: { id: actor, email: 'actor@test' }, isAuthenticated: true, features: {} }) },
    MSGraphContext: { useMSGraph: () => ({}) },
    useDatabase: { useDocuments: documentsHook, useProjects: () => hooks, useTemplates: () => hooks,
      useStorage: () => ({ uploadDocument: async () => `${actor}/copy.pdf`,
        downloadDocument: async () => { state.downloads++; throw new Error('raw storage forbidden'); } }) },
    localDocumentStore: { listLocalDocuments: async () => [] },
    localDocumentDraftStore: { listLocalDocumentDrafts: async () => [] },
    localDocumentState: { createLocalDocumentStateReader: noop },
    useSubscriptionLimits: { useSubscriptionLimits: () => ({}) },
    useProjectUploadRecovery: { useProjectUploadRecovery: () => ({ busy: false, rows: [] }) },
    useDocumentUploadRecovery: { useDocumentUploadRecovery: () => ({ busy: false, rows: [], isCurrent: () => true }) },
    dialogPrompts: { useConfirmDialog: () => [async () => true, null], usePromptDialog: () => [async () => '', null] },
    hubInitialLoadingState: { resolveHubInitialLoading: () => ({}) },
    actorBoundDatabaseMutation: { runActorBoundDatabaseMutation },
    documentLockService: { lockDocument: async id => { state.lockCalls.push(id); return { data: { locked_at: 'now' }, error: null }; },
      unlockDocument: async () => assert.fail('unexpected unlock') },
    compensatingBatch: { runCompensatingBatch: async (items, operation) => { for (const item of items) await operation(item); },
      retryCompensatingCleanup: noop },
    supabaseClient: { supabase },
  });
  function App() {
    const [docs, setDocs] = useState([{ id: 'temp-1', name: 'Untitled PDF', size: 42 }]);
    state.docs = docs;
    return React.createElement(Dashboard, { catalogEnabled: true, documents: docs, setDocuments: setDocs,
      entities: empty, isActive: true, onShowAuthModal: noop, onDocumentSelect: noop,
      onOpenCloudDocument: noop,
      onAcquireCloudDocumentForAction: async input => {
        state.acquired.push(input);
        return { actorUserId: actor, documentId, name: 'Full source title.pdf',
          blob: new Blob(['%PDF-copy'], { type: 'application/pdf' }) };
      } });
  }
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(App)));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close(); restore.reverse().forEach(undo => undo());
  });
  return state;
}

test('catalog Dashboard keeps sparse rows safe and uses catalog mode for both list roles', async t => {
  const state = await mount(t);
  assert.ok(state.hookOptions.length >= 2);
  assert.ok(state.hookOptions.every(options => options.catalogEnabled === true));
  assert.equal(state.hub.documents[0].name, 'Untitled PDF');
  assert.equal(state.hub.documents[0].catalogName, null);
  assert.equal(state.hub.documents[0].nameTruncated, null);
  assert.equal(state.docs.filter(item => item.id.startsWith('temp-')).length, 0,
    'safe integer temp size and decimal catalog size match without Number coercion');
});

test('catalog lock checks effective owner role instead of document creator', async t => {
  const state = await mount(t, { role: 'owner' });
  await act(async () => state.hub.onLockDocument(state.hub.documents[0]));
  assert.deepEqual(state.roleCalls, [documentId]);
  assert.deepEqual(state.lockCalls, [documentId]);
});

test('catalog lock fails closed for a non-owner even when the catalog creator matches no authority rule', async t => {
  const state = await mount(t, { role: 'editor' });
  await act(async () => state.hub.onLockDocument(state.hub.documents[0]));
  assert.deepEqual(state.roleCalls, [documentId]);
  assert.deepEqual(state.lockCalls, []);
});

test('catalog lock sends no mutation after a delayed A to B to A auth change', async t => {
  const gate = deferred();
  const state = await mount(t, { roleGate: gate });
  const pending = state.hub.onLockDocument(state.hub.documents[0]);
  await new Promise(setImmediate);
  state.sessionActor = creator;
  for (const listener of state.authListeners) listener('SIGNED_IN', { user: { id: creator } });
  state.sessionActor = actor;
  for (const listener of state.authListeners) listener('SIGNED_IN', { user: { id: actor } });
  gate.resolve();
  await act(async () => pending);
  assert.deepEqual(state.roleCalls, [documentId]);
  assert.deepEqual(state.lockCalls, []);
});

test('catalog copy acquires the current checked PDF and full title only on the explicit action', async t => {
  const state = await mount(t);
  assert.deepEqual(state.acquired, []);
  await act(async () => state.hub.onDuplicateDocuments([state.hub.documents[0]]));
  assert.deepEqual(state.acquired, [{ documentId }]);
  assert.equal(state.downloads, 0);
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].name, 'Full source title (Copy).pdf');
  assert.equal(state.created[0].file_size, 9);
});
