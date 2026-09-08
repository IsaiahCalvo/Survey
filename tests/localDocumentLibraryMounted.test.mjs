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
const empty = [];
const noop = () => {};
const noUI = () => null;
async function load(fileName, modules) {
  const file = new URL(`../src/${fileName}`, import.meta.url);
  const key = `__localLibraryTest${crypto.randomUUID().replaceAll('-', '')}`;
  globalThis[key] = modules;
  let source = await readFile(file, 'utf8');
  source = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm, (_all, bindings, specifier) => {
    const name = specifier.split('/').at(-1).replace(/\.(jsx|js)$/, '');
    const value = `globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}]`;
    if (!modules[name]) modules[name] = new Proxy({ default: noUI }, { get: (target, name) => target[name] || noop });
    if (bindings.startsWith('* as ')) return `const ${bindings.slice(5)} = ${value};`;
    if (bindings.startsWith('{')) return `const ${bindings.replace(/\bas\b/g, ':')} = ${value};`;
    return `const ${bindings} = ${value}.default;`;
  }).replace(/^import ['"][^'"]+\.css['"];?$/gm, '').replaceAll('import.meta.env', '({DEV:false})');
  const output = await transformWithOxc(source, file.pathname, { lang: 'jsx' });
  const code = output.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  delete globalThis[key];
  return module.default;
}

async function mount(t, { user = null, rows = [], listOverride = null, isActive = true } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' });
  const restore = [];
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restore.push(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  const state = { user, rows, cloudRows: empty, lists: 0, imports: [], opens: [], selected: [], auth: 0,
    cloudWrites: 0, importError: null, listOverride, openError: null, cloudPassed: [], restored: [], restoreError: null,
    isActive, activeLists: 0, maxActiveLists: 0 };
  const managed = new File(['%PDF-managed'], 'managed.pdf', { type: 'application/pdf' });
  Object.assign(managed, { localId: 'local-a', _surveyPdfId: 'local-a', storageMode: 'local', localRevision: 1 });
  const store = {
    async listLocalDocuments() {
      state.lists++; state.activeLists++; state.maxActiveLists = Math.max(state.maxActiveLists, state.activeLists);
      try { return state.listOverride ? await state.listOverride(state.lists) : [...state.rows]; }
      finally { state.activeLists--; }
    },
    async importLocalDocument(file) {
      state.imports.push(file); if (state.importError) throw state.importError;
      const row = { id: 'local-a', localId: 'local-a', name: file.name, storageMode: 'local', size: file.size, revision: 1 };
      state.rows = [row]; return row;
    },
    async openLocalDocument(id) { state.opens.push(id); if (state.openError) throw state.openError; return managed; },
  };
  const shell = ({ children, actions }) => React.createElement('main', null, actions, children);
  const SurveyHub = await load('home/SurveyHub.jsx', {
    react: React,
    HubShell: { HubShell: shell, HubChromeContext: React.createContext(null) },
    DocumentsLedger: { default: props => {
      state.cloudPassed.push(props.documents);
      return React.createElement('div', null, props.storageSwitch,
        React.createElement('button', { onClick: props.onUpload }, 'Cloud Upload'));
    } },
  });
  const cloudWrite = () => { state.cloudWrites++; throw new Error('cloud write forbidden'); };
  const projectHooks = { projects: empty, templates: empty, initialLoading: false, refetch: noop };
  const Dashboard = await load('Dashboard.jsx', {
    react: React, SurveyHub: { default: SurveyHub }, localDocumentStore: store,
    localDocumentState: { createLocalDocumentStateReader: file => {
      if (state.restoreError) throw state.restoreError; state.restored.push(file);
    } },
    AuthContext: { useAuth: () => ({ user: state.user, isAuthenticated: !!state.user, features: {} }) },
    MSGraphContext: { useMSGraph: () => ({}) },
    useDatabase: {
      useDocuments: () => ({ documents: state.cloudRows, initialLoading: false, refetch: noop, createDocument: cloudWrite }),
      useProjects: () => projectHooks, useTemplates: () => projectHooks,
      useStorage: () => ({ uploadDocument: cloudWrite, downloadDocument: cloudWrite }),
    },
    useSubscriptionLimits: { useSubscriptionLimits: () => ({}) },
    useProjectUploadRecovery: { useProjectUploadRecovery: () => ({ busy: false, rows: [] }) },
    dialogPrompts: { useConfirmDialog: () => [noop, null], usePromptDialog: () => [noop, null] },
    hubInitialLoadingState: { resolveHubInitialLoading: () => ({}) },
    supabaseClient: { supabase: { from: cloudWrite } },
  });
  let bump;
  function App() {
    const [docs, setDocs] = useState([]); const [, setVersion] = useState(0); bump = () => setVersion(v => v + 1);
    return React.createElement(Dashboard, { documents: docs, setDocuments: setDocs, entities: empty, isActive: state.isActive,
      onDocumentSelect: (...args) => state.selected.push(args), onShowAuthModal: () => state.auth++ });
  }
  const root = createRoot(document.getElementById('root'));
  let mounted = true;
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
  t.after(async () => { await unmount(); dom.window.close(); restore.reverse().forEach(fn => fn()); });
  await act(async () => root.render(React.createElement(App)));
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label);
    assert.ok(button, `button ${label}`);
    await act(async () => button.click());
  };
  return { state, managed, click, unmount, render: async () => act(async () => bump()),
    pick: async file => {
      const input = document.querySelector('input[data-local-pdf-input]'); assert.ok(input, 'separate local picker');
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    },
  };
}

test('signed-out local import opens only the committed managed File and never enters cloud actions', async t => {
  const h = await mount(t);
  assert.ok(document.body.textContent.includes('On this device'));
  const incoming = new File(['%PDF-original'], 'local.pdf', { type: 'application/pdf' });
  incoming.path = '/private/original.pdf'; incoming.id = 'must-not-use';
  await h.pick(incoming);
  assert.equal(h.state.imports.length, 1);
  assert.deepEqual(h.state.opens, ['local-a']);
  assert.strictEqual(h.state.selected[0][0], h.managed);
  assert.deepEqual(h.state.restored, [h.managed]);
  assert.equal(h.state.selected[0][1], null);
  assert.equal(h.state.selected[0][0].id, undefined);
  assert.equal(h.state.cloudWrites, 0); assert.equal(h.state.auth, 0);
  assert.ok(document.body.textContent.includes('local.pdf'));
});

test('metadata stays device-owned through cloud refresh and account changes without reading file bytes', async t => {
  const row = { localId: 'local-a', id: 'local-a', storageMode: 'local', name: 'saved.pdf', size: 1024 };
  const h = await mount(t, { rows: [row] });
  assert.ok(document.body.textContent.includes('saved.pdf'));
  assert.deepEqual(h.state.opens, []);
  h.state.user = { id: 'cloud-user', email: 'user@example.test' }; h.state.cloudRows = [{ id: 'cloud-doc', name: 'cloud.pdf' }];
  await h.render();
  await h.click('Cloud');
  assert.ok(h.state.cloudPassed.every(rows => rows.every(row => row.storageMode !== 'local')));
  await h.click('On this device');
  assert.ok(document.body.textContent.includes('saved.pdf'));
  h.state.user = null; h.state.cloudRows = []; await h.render();
  assert.ok(document.body.textContent.includes('saved.pdf'));
  assert.equal(h.state.cloudWrites, 0); assert.deepEqual(h.state.opens, []);
  await h.click('Open');
  assert.deepEqual(h.state.opens, ['local-a']);
  assert.strictEqual(h.state.selected[0][0], h.managed);
});

test('quota failure is visible and cannot open an uncommitted picker file', async t => {
  const h = await mount(t); h.state.importError = new DOMException('Device storage is full', 'QuotaExceededError');
  await h.pick(new File(['%PDF'], 'full.pdf', { type: 'application/pdf' }));
  assert.match(document.querySelector('[role="alert"]').textContent, /Device storage is full/);
  assert.deepEqual(h.state.opens, []); assert.deepEqual(h.state.selected, []);
  assert.equal(h.state.cloudWrites, 0);
});

test('state restoration failure is visible and never opens a stale annotation view', async t => {
  const h = await mount(t); h.state.restoreError = new Error('Cannot restore saved annotation state');
  await h.pick(new File(['%PDF'], 'saved.pdf', { type: 'application/pdf' }));
  assert.match(document.querySelector('[role="alert"]').textContent, /Cannot restore saved annotation state/);
  assert.deepEqual(h.state.selected, []);
  assert.ok(document.body.textContent.includes('saved.pdf'), 'committed copy remains recoverable in the local list');
});

test('native local picker saves a managed copy and never forwards the original path', async t => {
  const h = await mount(t);
  window.electronAPI = { openFile: async () => ({ canceled: false, data: [37, 80, 68, 70], fileName: 'native.pdf', filePath: '/original/private.pdf' }) };
  await h.click('Open local PDF');
  assert.equal(h.state.imports[0].name, 'native.pdf');
  assert.equal(h.state.imports[0].path, undefined);
  assert.equal(h.state.imports[0].id, undefined);
  assert.equal(h.state.selected[0][1], null);
  assert.strictEqual(h.state.selected[0][0], h.managed);
  assert.equal(h.state.auth, 0); assert.equal(h.state.cloudWrites, 0);
});

test('cloud Upload remains separate and still requires sign-in', async t => {
  const h = await mount(t);
  await h.click('Cloud'); await h.click('Cloud Upload');
  const input = document.querySelector('input[type="file"]:not([data-local-pdf-input]):not([multiple])');
  Object.defineProperty(input, 'files', { value: [new File(['%PDF'], 'cloud.pdf', { type: 'application/pdf' })] });
  await act(async () => input.dispatchEvent(new window.Event('change', { bubbles: true })));
  assert.equal(h.state.auth, 1); assert.equal(h.state.imports.length, 0);
  assert.equal(h.state.cloudWrites, 0); assert.deepEqual(h.state.selected, []);
});

test('late startup metadata cannot hide an import and store notifications refresh metadata only', async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = await mount(t, { listOverride: () => pending });
  await h.pick(new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));
  await act(async () => resolve([]));
  assert.ok(document.body.textContent.includes('new.pdf'));
  assert.equal(document.body.textContent.includes('Loading local files'), false);
  h.state.listOverride = null; h.state.rows = [{ ...h.state.rows[0], name: 'updated.pdf', revision: 2 }];
  await act(async () => window.dispatchEvent(new window.Event('local-document-store-changed')));
  assert.ok(document.body.textContent.includes('updated.pdf'));
  assert.deepEqual(h.state.opens, ['local-a'], 'refresh does not open or read bytes');
});

test('hidden Home and initial cloud view invalidate events without local metadata scans', async t => {
  const h = await mount(t, { isActive: false, user: { id: 'cloud-user' } });
  assert.equal(h.state.lists, 0);
  await act(async () => {
    window.dispatchEvent(new window.Event('focus'));
    window.dispatchEvent(new window.Event('local-document-store-changed'));
  });
  assert.equal(h.state.lists, 0);
  h.state.isActive = true; await h.render();
  assert.equal(h.state.lists, 0, 'visible cloud view does not scan local storage');
  await h.click('On this device');
  assert.equal(h.state.lists, 1);
  await h.click('Cloud');
  await act(async () => window.dispatchEvent(new window.Event('local-document-store-changed')));
  assert.equal(h.state.lists, 1);
  await h.click('On this device');
  assert.equal(h.state.lists, 2, 'reopened local view gets a fresh list');
});

test('same-turn events share one scan and events during a scan produce one trailing latest scan', async t => {
  const h = await mount(t);
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  h.state.listOverride = () => pending;
  const before = h.state.lists;
  await act(async () => {
    for (let i = 0; i < 8; i++) window.dispatchEvent(new window.Event('local-document-store-changed'));
  });
  assert.equal(h.state.lists, before + 1);
  await act(async () => {
    for (let i = 0; i < 8; i++) window.dispatchEvent(new window.Event('focus'));
  });
  assert.equal(h.state.lists, before + 1);
  h.state.listOverride = null;
  h.state.rows = [{ localId: 'latest', name: 'latest.pdf', storageMode: 'local', size: 1024 }];
  await act(async () => finish([{ localId: 'stale', name: 'stale.pdf', storageMode: 'local', size: 1024 }]));
  assert.equal(h.state.lists, before + 2);
  assert.equal(h.state.maxActiveLists, 1);
  assert.match(document.body.textContent, /latest.pdf/);
  assert.doesNotMatch(document.body.textContent, /stale.pdf/);
  assert.deepEqual(h.state.opens, []);
});

test('hide and reopen while a read is pending ignores that result and starts one fresh scan', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await mount(t, { listOverride: () => pending });
  assert.equal(h.state.lists, 1);
  h.state.isActive = false; await h.render();
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  h.state.isActive = true; await h.render();
  assert.equal(h.state.lists, 1);
  h.state.listOverride = null;
  h.state.rows = [{ localId: 'reopened', name: 'reopened.pdf', storageMode: 'local', size: 1024 }];
  await act(async () => finish([{ localId: 'old', name: 'old.pdf', storageMode: 'local', size: 1024 }]));
  assert.equal(h.state.lists, 2);
  assert.equal(h.state.maxActiveLists, 1);
  assert.match(document.body.textContent, /reopened.pdf/);
  assert.doesNotMatch(document.body.textContent, /old.pdf/);
});

test('a failed latest scan retains visible rows and explicit retry clears the error', async t => {
  const row = { localId: 'kept', name: 'kept.pdf', storageMode: 'local', size: 1024 };
  const h = await mount(t, { rows: [row] });
  h.state.listOverride = () => { throw new Error('Storage temporarily unavailable'); };
  await act(async () => window.dispatchEvent(new window.Event('local-document-store-changed')));
  assert.match(document.body.textContent, /kept.pdf/);
  assert.match(document.body.textContent, /Storage temporarily unavailable/);
  h.state.listOverride = null;
  await h.click('Refresh local files');
  assert.match(document.body.textContent, /kept.pdf/);
  assert.doesNotMatch(document.body.textContent, /Storage temporarily unavailable/);
});

test('unmount during a queued refresh prevents a trailing scan and stale result publication', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await mount(t, { listOverride: () => pending });
  await act(async () => window.dispatchEvent(new window.Event('local-document-store-changed')));
  await h.unmount();
  await act(async () => finish([]));
  assert.equal(h.state.lists, 1);
  assert.equal(h.state.maxActiveLists, 1);
  assert.equal(h.state.cloudWrites, 0);
});
