import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const empty = [], noop = () => {}, noUI = () => null;
async function load(name, modules) {
  const file = new URL(`../src/${name}`, import.meta.url);
  const key = `__recoveryLibrary${crypto.randomUUID().replaceAll('-', '')}`;
  globalThis[key] = modules;
  let source = await readFile(file, 'utf8');
  source = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm, (_all, bindings, specifier) => {
    const name = specifier.split('/').at(-1).replace(/\.(jsx|js)$/, '');
    const value = `globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}]`;
    if (!modules[name]) modules[name] = new Proxy({ default: noUI }, { get: (target, key) => target[key] || noop });
    if (bindings.startsWith('* as ')) return `const ${bindings.slice(5)} = ${value};`;
    if (bindings.startsWith('{')) return `const ${bindings.replace(/\bas\b/g, ':')} = ${value};`;
    return `const ${bindings} = ${value}.default;`;
  }).replace(/^import ['"][^'"]+\.css['"];?$/gm, '').replaceAll('import.meta.env', '({DEV:false})');
  const output = await transformWithOxc(source, file.pathname, { lang: 'jsx' });
  const code = output.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const result = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  delete globalThis[key]; return result.default;
}

async function mount(t, { listOverride = null, isActive = true, initialTab = null } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' });
  const restore = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const row = { sessionId: 'session-a', sequence: 4, name: 'Plans.pdf', size: 1024, updatedAt: '2026-09-08T12:00:00Z' };
  if (initialTab) localStorage.setItem('survey-hub-tab', initialTab);
  const state = { rows: [row], lists: 0, reads: [], imports: [], opens: [], discarded: [], selected: [],
    user: null, confirmAnswer: false, confirmations: [], importError: null, readError: null,
    discardError: null, listOverride, readOverride: null, cloudCalls: 0, isActive };
  const file = new File(['%PDF-draft'], row.name, { type: 'application/pdf' });
  file.id = 'never-copy-binding'; file.path = '/private/original.pdf';
  const savedState = { version: 1, pdfId: 'source-local-id', entries: { retained: 'unchanged' } };
  const managed = new File(['%PDF-copy'], 'Plans (recovered).pdf', { type: 'application/pdf' });
  Object.assign(managed, { localId: 'new-local-id', _surveyPdfId: 'new-local-id', storageMode: 'local' });
  const draftStore = {
    async listLocalDocumentDrafts() { state.lists++; return state.listOverride ? state.listOverride() : [...state.rows]; },
    async readLocalDocumentDraft(...args) {
      state.reads.push(args); if (state.readError) throw state.readError;
      if (state.readOverride) return state.readOverride();
      return { metadata: { ...row }, file, state: savedState };
    },
    async discardLocalDocumentDraft(...args) {
      state.discarded.push(args); if (state.discardError) throw state.discardError; state.rows = [];
    },
  };
  const store = {
    async listLocalDocuments() { return []; },
    async importLocalDocumentCopy(...args) {
      state.imports.push(args); if (state.importError) throw state.importError;
      return { id: managed.localId, localId: managed.localId, name: managed.name, size: managed.size, storageMode: 'local' };
    },
    async openLocalDocument(id) { state.opens.push(id); return state.openOverride ? state.openOverride() : managed; },
  };
  const SurveyHub = await load('home/SurveyHub.jsx', { react: React,
    HubShell: { HubShell: ({ children, actions }) => React.createElement('main', null, actions, children), HubChromeContext: React.createContext(null) },
    DocumentsLedger: { default: props => React.createElement('div', null, props.storageSwitch, 'Cloud list') },
  });
  const forbidden = () => { state.cloudCalls++; throw new Error('Cloud forbidden'); };
  const hooks = { projects: empty, templates: empty, initialLoading: false, refetch: noop };
  const Dashboard = await load('Dashboard.jsx', { react: React, SurveyHub: { default: SurveyHub },
    localDocumentStore: store, localDocumentDraftStore: draftStore,
    localDocumentState: { createLocalDocumentStateReader: noop },
    AuthContext: { useAuth: () => ({ user: state.user, isAuthenticated: !!state.user, features: {} }) },
    MSGraphContext: { useMSGraph: () => ({}) },
    useDatabase: { useDocuments: () => ({ documents: empty, initialLoading: false, refetch: noop, createDocument: forbidden }),
      useProjects: () => hooks, useTemplates: () => hooks, useStorage: () => ({ uploadDocument: forbidden, downloadDocument: forbidden }) },
    useSubscriptionLimits: { useSubscriptionLimits: () => ({}) },
    dialogPrompts: { useConfirmDialog: () => [async options => { state.confirmations.push(options); return state.confirmAnswer; }, null], usePromptDialog: () => [noop, null] },
    hubInitialLoadingState: { resolveHubInitialLoading: () => ({}) }, supabaseClient: { supabase: { from: forbidden } },
  });
  let bump;
  function App() {
    const [docs, setDocs] = useState([]); const [, update] = useState(0); bump = () => update(v => v + 1);
    return React.createElement(Dashboard, { documents: docs, setDocuments: setDocs, entities: empty, isActive: state.isActive,
      onDocumentSelect: (...args) => state.selected.push(args) });
  }
  const root = createRoot(document.getElementById('root'));
  let unmounted = false;
  const unmount = async () => { if (!unmounted) { await act(async () => root.unmount()); unmounted = true; } };
  t.after(async () => { await unmount(); dom.window.close(); restore.reverse().forEach(fn => fn()); });
  await act(async () => root.render(React.createElement(App)));
  return { state, row, file, savedState, managed, unmount,
    render: async () => act(async () => bump()),
    event: async name => act(async () => window.dispatchEvent(new dom.window.Event(name))),
    click: async label => { const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label);
      assert.ok(el, `button ${label}`); await act(async () => el.click()); },
  };
}

test('signed-out recovery list reads metadata only; recovering creates and opens a separate copy while retaining the source', async t => {
  const h = await mount(t);
  assert.match(document.body.textContent, /Recovery copies/);
  assert.match(document.body.textContent, /Saved session snapshots/);
  assert.equal(h.state.reads.length, 0); assert.equal(h.state.imports.length, 0);
  await h.click('Recover as copy');
  assert.deepEqual(h.state.reads, [['session-a', { expectedSequence: 4 }]]);
  const [file, snapshot] = h.state.imports[0];
  assert.equal(file.name, 'Plans (recovered).pdf'); assert.equal(file.id, undefined); assert.equal(file.path, undefined);
  assert.equal(await file.text(), await h.file.text());
  assert.equal(snapshot, h.savedState, 'snapshot stays separate from the new File bindings');
  assert.deepEqual(h.state.opens, ['new-local-id']); assert.equal(h.state.selected[0][0], h.managed);
  assert.deepEqual(h.state.discarded, []); assert.equal(h.state.rows.length, 1); assert.equal(h.state.cloudCalls, 0);
});

test('discard requires a named snapshot-only confirmation and deletes only the displayed sequence', async t => {
  const h = await mount(t);
  await h.click('Discard');
  assert.equal(h.state.confirmations.length, 1);
  assert.match(h.state.confirmations[0].message, /Plans\.pdf/);
  assert.match(h.state.confirmations[0].message, /removes only this snapshot/);
  assert.match(h.state.confirmations[0].message, /original document and other copies stay unchanged/);
  assert.deepEqual(h.state.discarded, [], 'Cancel preserves the recovery snapshot');
  h.state.confirmAnswer = true;
  await h.click('Discard');
  assert.deepEqual(h.state.discarded, [['session-a', { expectedSequence: 4 }]]);
  assert.equal(h.state.reads.length, 0); assert.equal(h.state.imports.length, 0);
  assert.match(document.body.textContent, /No recovery copies/);
});

test('a newer session snapshot blocks stale discard and refreshes the metadata without removing it', async t => {
  const h = await mount(t);
  h.state.rows = [{ ...h.row, sequence: 5, name: 'Newer snapshot.pdf' }];
  h.state.confirmAnswer = true;
  h.state.discardError = new Error('The snapshot changed; refresh and retry.');
  await h.click('Discard');
  assert.deepEqual(h.state.discarded, [['session-a', { expectedSequence: 4 }]]);
  assert.match(document.querySelector('[role="alert"]').textContent, /snapshot changed/);
  assert.match(document.body.textContent, /Newer snapshot\.pdf/);
  assert.equal(h.state.rows.length, 1); assert.equal(h.state.imports.length, 0);
});

for (const failure of ['read', 'copy']) {
  test(`${failure} failure is visible, preserves the source, and cannot open a false recovered file`, async t => {
    const h = await mount(t);
    if (failure === 'read') h.state.readError = new Error('Snapshot sequence changed');
    else h.state.importError = new DOMException('Device storage is full', 'QuotaExceededError');
    await h.click('Recover as copy');
    assert.match(document.querySelector('[role="alert"]').textContent, failure === 'read' ? /sequence changed/ : /storage is full/);
    assert.deepEqual(h.state.opens, []); assert.deepEqual(h.state.selected, []);
    assert.deepEqual(h.state.discarded, []); assert.equal(h.state.rows.length, 1);
    assert.equal(h.state.cloudCalls, 0);
  });
}

test('recovery refresh is device-owned, metadata-only, and the section is absent from the cloud view', async t => {
  const h = await mount(t);
  const initialLists = h.state.lists;
  h.state.rows = [{ ...h.row, sequence: 5, name: 'Fresh snapshot.pdf' }];
  await h.event('local-document-draft-changed');
  await h.event('focus');
  assert.equal(h.state.lists, initialLists + 2);
  assert.match(document.body.textContent, /Fresh snapshot/);
  h.state.user = { id: 'another-account' }; await h.render(); await h.click('Cloud');
  assert.equal(document.querySelector('[aria-label="Recovery copies"]'), null);
  await h.click('On this device');
  assert.match(document.body.textContent, /Fresh snapshot/);
  assert.deepEqual(h.state.reads, []); assert.deepEqual(h.state.imports, []); assert.equal(h.state.cloudCalls, 0);
});

test('a delayed startup list cannot replace a newer refresh and a read finishing after unmount cannot import', async t => {
  let finishList;
  const oldList = new Promise(resolve => { finishList = resolve; });
  const h = await mount(t, { listOverride: () => oldList });
  h.state.listOverride = null;
  await h.event('local-document-draft-changed');
  await act(async () => finishList([]));
  assert.match(document.body.textContent, /Plans\.pdf/);
  let finishRead;
  h.state.readOverride = () => new Promise(resolve => { finishRead = resolve; });
  await h.click('Recover as copy');
  await h.unmount();
  await act(async () => finishRead({ metadata: h.row, file: h.file, state: h.savedState }));
  assert.deepEqual(h.state.imports, []); assert.deepEqual(h.state.opens, []);
});

test('hidden Home defers all draft events and refreshes once on return; Cloud view also defers reads', async t => {
  const h = await mount(t, { isActive: false });
  assert.equal(h.state.lists, 0);
  for (let i = 0; i < 20; i++) await h.event('local-document-draft-changed');
  await h.event('focus');
  assert.equal(h.state.lists, 0);
  h.state.isActive = true; await h.render();
  assert.equal(h.state.lists, 1);
  await h.click('Cloud');
  await h.event('local-document-draft-changed'); await h.event('focus');
  assert.equal(h.state.lists, 1);
  await h.click('On this device');
  assert.equal(h.state.lists, 2);
});

test('other Hub views do not request recovery metadata', async t => {
  const h = await mount(t, { initialTab: 'projects' });
  assert.equal(h.state.lists, 0);
  await h.event('local-document-draft-changed'); await h.event('focus');
  assert.equal(h.state.lists, 0);
});

test('a burst shares one read and invalidations during a slow read fetch one trailing latest result', async t => {
  const h = await mount(t);
  const baseline = h.state.lists;
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  h.state.listOverride = () => slow;
  await act(async () => { for (let i = 0; i < 20; i++) window.dispatchEvent(new window.Event('local-document-draft-changed')); });
  assert.equal(h.state.lists, baseline + 1, 'same-turn events start one read');
  h.state.rows = [{ ...h.row, sequence: 5, name: 'Latest snapshot.pdf' }]; h.state.listOverride = null;
  await act(async () => { for (let i = 0; i < 20; i++) window.dispatchEvent(new window.Event('local-document-draft-changed')); });
  assert.equal(h.state.lists, baseline + 1, 'no concurrent reads');
  await act(async () => release([{ ...h.row, name: 'Obsolete snapshot.pdf' }]));
  assert.equal(h.state.lists, baseline + 2);
  assert.match(document.body.textContent, /Latest snapshot\.pdf/);
  assert.doesNotMatch(document.body.textContent, /Obsolete snapshot/);
});

test('a recovery read completing after Home is hidden cannot import or reopen its stale action', async t => {
  const h = await mount(t);
  let finish;
  h.state.readOverride = () => new Promise(resolve => { finish = resolve; });
  await h.click('Recover as copy');
  h.state.isActive = false; await h.render();
  h.state.isActive = true; await h.render();
  await act(async () => finish({ metadata: h.row, file: h.file, state: h.savedState }));
  assert.deepEqual(h.state.imports, []); assert.deepEqual(h.state.opens, []);
});

test('a recovery copy already committed cannot steal focus when its open finishes after leaving Home', async t => {
  const h = await mount(t);
  let finish;
  h.state.openOverride = () => new Promise(resolve => { finish = resolve; });
  await h.click('Recover as copy');
  assert.equal(h.state.imports.length, 1);
  h.state.isActive = false; await h.render();
  await act(async () => finish(h.managed));
  assert.deepEqual(h.state.selected, []);
  assert.deepEqual(h.state.discarded, [], 'neither the original snapshot nor the committed recovery copy is removed');
});

test('a pending list result is ignored after deactivation and only fresh metadata appears on return', async t => {
  const h = await mount(t);
  let finish;
  h.state.listOverride = () => new Promise(resolve => { finish = resolve; });
  await h.event('local-document-draft-changed');
  h.state.isActive = false; await h.render();
  const reads = h.state.lists;
  await act(async () => finish([{ ...h.row, name: 'Obsolete while hidden.pdf' }]));
  assert.doesNotMatch(document.body.textContent, /Obsolete while hidden/);
  assert.equal(h.state.lists, reads);
  h.state.rows = [{ ...h.row, name: 'Current after return.pdf' }]; h.state.listOverride = null;
  h.state.isActive = true; await h.render();
  assert.equal(h.state.lists, reads + 1);
  assert.match(document.body.textContent, /Current after return/);
});
