import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { PDFDocument } from 'pdf-lib';
import { getDocumentOpenKey, isSameDocumentTab } from '../src/utils/documentTabIdentity.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { prepareCheckedDocumentOpen } from '../src/services/checkedDocumentOpen.js';

const require = createRequire(import.meta.url);
const shellSource = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const dashboardSource = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
const actor = 'ca000000-0000-4000-8000-000000000001';
const documentId = 'ca000000-0000-4000-8000-000000000002';
const generation = 'ca000000-0000-4000-8000-000000000003';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const row = (patch = {}) => ({ id: documentId, user_id: actor, project_id: null, name: 'Plan.pdf',
  file_path: `${actor}/original-import.pdf`, file_size: 11, content_sha256: 'a'.repeat(64), ...patch });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);

async function checkedIssue() {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const path = `${actor}/_generations/${generation}.pdf`;
  const manifest = { version: 1, actor_user_id: actor, document_id: documentId, generation_id: generation,
    document: { id: documentId, user_id: actor, project_id: null, name: 'Checked.pdf', file_path: path, file_size: String(bytes.length) },
    pdf: { bucket_id: 'documents', path, id: 'ca000000-0000-4000-8000-000000000004',
      version: 'ca000000-0000-4000-8000-000000000005', byte_length: String(bytes.length), content_sha256: hash(bytes) },
    publication: { operation_id: 'ca000000-0000-4000-8000-000000000006', generation_id: generation,
      published_at: '2026-09-09T00:00:00Z', wal_head: '0' },
    annotations: { version: 2, document_id: documentId, generation_id: generation, wal_head: '0',
      snapshot: { at_seq: '0', snapshot: '\\x0000', encoding_version: 1, writer_id: null, writer_epoch: '0' },
      snapshot_sha256: hash(new Uint8Array([0, 0])) } };
  const reader = createDocumentGenerationReader({ getActorUserId: () => actor,
    request: async (_name, params) => {
      const data = structuredClone(manifest);
      if (!params.p_include_snapshot) { data.annotations.snapshot = null; data.annotations.snapshot_sha256 = null; }
      return { data };
    }, download: async () => new Blob([bytes]) });
  return reader.open({ documentId, actorUserId: actor, pdfGenerationId: generation });
}

function extract(source, start, end, ports) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `execute current ${start}`);
  const name = start.match(/const (\w+)/)?.[1];
  return Function(...Object.keys(ports), `${source.slice(from, to)}\nreturn ${name};`)(...Object.values(ports));
}

function shellHarness({ enabled = true, actorUserId = actor, scopeObject, tabs = [], documents = [row()], acquisition,
  download, scopeRef, mountRef, pendingMap, prepareChecked } = {}) {
  const scope = scopeObject || { actorUserId };
  const ref = scopeRef || { current: scope };
  if (!scopeRef) ref.current = scope;
  const mounted = mountRef || { current: {} };
  const state = { tabs, selected: tabs[0]?.file || null, active: tabs[0]?.id || null,
    view: tabs.length ? 'viewer' : 'dashboard', loading: false, acquisitions: 0, downloads: 0 };
  const openingPdfsRef = { current: new Set() };
  const closeViewRef = { current: { tabs: state.tabs } };
  const set = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const base = () => { closeViewRef.current = { tabs: state.tabs }; return ({ tabs: state.tabs, selectedPDF: state.selected, documents,
    documentOpenScope: scope, documentOpenScopeRef: ref, openingPdfsRef,
    closeViewRef,
    getDocumentOpenKey, isSameDocumentTab,
    prepareCheckedDocumentOpen: prepareChecked || prepareCheckedDocumentOpen,
    checkedPageStructureStorage: null,
    readLocalCheckedPageStructure: () => ({ items: {}, annotations: {}, pageNames: {}, bookmarks: [],
      pageTransformations: {}, activeSpaceId: null, regionOverlayDisabled: {} }),
    generateTabId: () => `tab-${state.tabs.length + 1}`, setTabs: set('tabs'),
    setSelectedPDF: set('selected'), setActiveTabId: set('active'), setCurrentView: set('view'),
    setIsLoading: set('loading'), setTimeout: callback => callback(),
  }); };
  const activate = document => extract(shellSource, 'const handleActivateOpenDocument =', '\n  const handleDocumentSelect =', base())(document);
  const select = (...args) => extract(shellSource, 'const handleDocumentSelect =', '\n  const handleOpenCloudDocument =', base())(...args);
  const acquisitionObject = acquisition || { openCurrent: async () => assert.fail('unexpected acquisition') };
  const ports = { ...base(), CHECKED_DOCUMENT_OPEN_ENABLED: enabled,
    handleActivateOpenDocument: activate, handleDocumentSelect: select,
    documentOpenMountRef: mounted,
    pendingCloudDocumentOpensRef: { current: pendingMap || new Map() },
    checkedDocumentAcquisitionRef: { current: { scope, acquisition: { openCurrent: async input => {
      state.acquisitions++; return acquisitionObject.openCurrent(input);
    } } } },
    downloadFromStorage: async path => { state.downloads++; return download ? download(path) : new Blob(['legacy-download']); },
    fetch: globalThis.fetch, File, Blob,
  };
  const open = extract(shellSource, 'const handleOpenCloudDocument =', '\n  // DEV-ONLY: Auto-open test PDF', ports);
  return { state, scope, ref, ports, open, select, activate };
}

test('flag-on edited legacy open uses exact acquired bytes despite stale import size and hash', async () => {
  const currentBytes = 'edited PDF bytes are longer than import';
  const h = shellHarness({ acquisition: { openCurrent: async () => ({ mode: 'legacy', actorUserId: actor,
    documentId, document: row({ file_size: 11, content_sha256: 'a'.repeat(64) }),
    blob: new Blob([currentBytes]), checkedBundle: null }) } });
  const ignoredHint = new File(['old upload hint'], 'old.pdf');
  await h.open(row(), { legacyFile: ignoredHint, nativePath: '/old/native.pdf' });
  assert.equal(h.state.acquisitions, 1); assert.equal(h.state.downloads, 0);
  assert.equal(h.state.tabs.length, 1); assert.equal(await h.state.tabs[0].file.text(), currentBytes);
  assert.equal(h.state.tabs[0].checkedBundle, null); assert.equal(h.state.tabs[0].file.id, documentId);
  assert.equal(h.state.tabs[0].filePath, null, 'stale native path is not paired with acquired cloud bytes');
});

test('flag-on checked open installs only the exact acquired bundle', async () => {
  const bundle = await checkedIssue();
  const h = shellHarness({ acquisition: { openCurrent: async () => ({ mode: 'checked', actorUserId: actor,
    documentId, checkedBundle: bundle }) } });
  await h.open(row(), { legacyFile: new File(['wrong'], 'wrong.pdf') });
  assert.equal(h.state.tabs.length, 1); assert.equal(h.state.tabs[0].checkedBundle, bundle);
  assert.equal(h.state.tabs[0].file.pdfGenerationId, generation); assert.equal(h.state.downloads, 0);
});

test('flag-off upload hint opens confirmed bytes and reused files need no mode RPC or download', async () => {
  for (const nativePath of ['/picked/plan.pdf', undefined]) {
    const h = shellHarness({ enabled: false });
    const confirmed = new Blob([nativePath ? 'new upload' : 'reused current']);
    await h.open(row(), { legacyFile: confirmed, nativePath });
    assert.equal(await h.state.tabs[0].file.text(), nativePath ? 'new upload' : 'reused current');
    assert.equal(h.state.tabs[0].filePath, nativePath || null);
    assert.equal(h.state.acquisitions, 0); assert.equal(h.state.downloads, 0);
  }
});

test('flag-off document File with wrong identity is cloned and rebound to the captured row', async () => {
  const hinted = Object.assign(new File(['hint bytes'], 'hint.pdf'), {
    id: 'wrong-id', user_id: 'wrong-owner', filePath: 'wrong/path.pdf',
  });
  const h = shellHarness({ enabled: false });
  await h.open(row({ file: hinted }));
  const opened = h.state.tabs[0].file;
  assert.notEqual(opened, hinted);
  assert.equal(opened.id, documentId); assert.equal(opened.user_id, actor);
  assert.equal(opened.supabaseFilePath, `${actor}/original-import.pdf`);
  assert.equal(await opened.text(), 'hint bytes');
  assert.equal(h.state.acquisitions, 0); assert.equal(h.state.downloads, 0);
});

test('flag-off pre-migration cloud row uses legacy storage without a mode RPC', async () => {
  const h = shellHarness({ enabled: false, download: async path => {
    assert.equal(path, row().file_path); return new Blob(['pre-migration']);
  } });
  await h.open(row());
  assert.equal(h.state.acquisitions, 0); assert.equal(h.state.downloads, 1);
  assert.equal(await h.state.tabs[0].file.text(), 'pre-migration');
});

test('healthy legacy and checked tabs activate with zero network even from stale catalog rows', async () => {
  for (const checked of [false, true]) {
    const file = Object.assign(new File(['unsaved local work'], 'open.pdf'), { id: documentId });
    const tab = { id: 'existing', actorUserId: actor, file, checkedBundle: checked ? { marker: 'kept' } : null };
    const h = shellHarness({ tabs: [tab], documents: [row({ name: 'stale-list-name.pdf', file_path: 'stale/path.pdf' })] });
    await h.open(row({ name: 'stale-list-name.pdf', file_path: 'stale/path.pdf' }));
    assert.equal(h.state.tabs[0], tab); assert.equal(h.state.selected, file);
    assert.equal(await file.text(), 'unsaved local work');
    assert.equal(h.state.acquisitions, 0); assert.equal(h.state.downloads, 0);
  }
});

test('failed legacy tab is replaced, but unversioned bytes cannot downgrade a failed checked tab', async () => {
  const failedLegacy = Object.assign(new File(['bad'], 'bad.pdf'), { id: documentId, __pdfLoadFailed: true });
  const legacyTab = { id: 'legacy', actorUserId: actor, file: failedLegacy, checkedBundle: null };
  const legacy = shellHarness({ tabs: [legacyTab], acquisition: { openCurrent: async () => ({ mode: 'legacy', actorUserId: actor,
    documentId, document: row(), blob: new Blob(['repaired legacy']), checkedBundle: null }) } });
  await legacy.open(row());
  assert.equal(legacy.state.tabs.length, 1); assert.equal(await legacy.state.tabs[0].file.text(), 'repaired legacy');

  const failedChecked = Object.assign(new File(['checked unsaved'], 'checked.pdf'), { id: documentId,
    pdfGenerationId: generation, __pdfLoadFailed: true });
  const checkedBundle = { marker: 'must-not-downgrade' };
  const checked = shellHarness({ tabs: [{ id: 'checked', actorUserId: actor, file: failedChecked, checkedBundle }] });
  const incoming = Object.assign(new File(['unversioned'], 'legacy.pdf'), { id: documentId });
  assert.equal(checked.select(incoming), true);
  assert.equal(checked.state.tabs[0].file, failedChecked);
  assert.equal(checked.state.tabs[0].checkedBundle, checkedBundle);
});

test('failed acquisition preserves the current tab and its local work', async () => {
  const current = Object.assign(new File(['local edits'], 'other.pdf'), { id: 'other-document' });
  const tab = { id: 'other', actorUserId: actor, file: current, checkedBundle: null };
  const h = shellHarness({ tabs: [tab], documents: [row(), { id: 'other-document' }],
    acquisition: { openCurrent: async () => { throw Object.assign(new Error('private RPC'), { code: '42501' }); } } });
  await assert.rejects(h.open(row()), { code: '42501' });
  assert.deepEqual(h.state.tabs, [tab]); assert.equal(h.state.selected, current);
  assert.equal(await current.text(), 'local edits');
});

test('mutating a caller row during flag-off download cannot pair old bytes with new identity metadata', async () => {
  const gate = deferred(), document = row();
  const h = shellHarness({ enabled: false, download: async () => gate.promise });
  const pending = h.open(document); await tick();
  Object.assign(document, { id: 'mutated-id', name: 'mutated.pdf', project_id: 'mutated-project', file_path: 'mutated/path.pdf' });
  gate.resolve(new Blob(['bytes for original row']));
  await pending;
  assert.equal(h.state.tabs[0].file.id, documentId);
  assert.equal(h.state.tabs[0].file.name, 'Plan.pdf');
  assert.equal(h.state.tabs[0].file.supabaseFilePath, `${actor}/original-import.pdf`);
  assert.equal(await h.state.tabs[0].file.text(), 'bytes for original row');
});

test('A-to-B and A-to-B-to-A pending opens never bind bytes to the wrong account', async () => {
  for (const returnToA of [false, true]) {
    const gate = deferred(), ref = { current: null }, mountRef = { current: {} }, pendingMap = new Map();
    const old = shellHarness({ scopeRef: ref, mountRef, pendingMap, acquisition: { openCurrent: () => gate.promise } });
    ref.current = old.scope;
    const opening = old.open(row()); await tick();
    ref.current = { actorUserId: 'ca000000-0000-4000-8000-000000000099' };
    if (returnToA) {
      const fresh = shellHarness({ scopeRef: ref, mountRef, pendingMap, acquisition: { openCurrent: async () => ({
        mode: 'legacy', actorUserId: actor, documentId, document: row(), blob: new Blob(['fresh A']), checkedBundle: null,
      }) } });
      ref.current = fresh.scope;
      await fresh.open(row());
      assert.equal(await fresh.state.tabs[0].file.text(), 'fresh A');
      assert.equal(fresh.state.acquisitions, 1);
    }
    gate.resolve({ mode: 'legacy', actorUserId: actor, documentId, document: row(), blob: new Blob(['old A']), checkedBundle: null });
    await assert.rejects(opening);
    assert.equal(old.state.tabs.length, 0);
  }
});

test('a retained cloud-open callback rejects after unmount without activation or network', async () => {
  const mountRef = { current: {} };
  const h = shellHarness({ mountRef });
  mountRef.current = null;
  await assert.rejects(h.open(row()), { code: 'DOCUMENT_OPEN_INPUT' });
  assert.equal(h.state.acquisitions, 0); assert.equal(h.state.downloads, 0);
  assert.equal(h.state.tabs.length, 0);
});

test('a retired mount token cannot reuse its pending open after a fresh setup', async () => {
  const scope = { actorUserId: actor }, scopeRef = { current: scope }, mountRef = { current: {} }, pendingMap = new Map();
  const oldGate = deferred();
  const old = shellHarness({ enabled: false, scopeObject: scope, scopeRef, mountRef, pendingMap,
    download: () => oldGate.promise });
  const oldOpen = old.open(row()); await tick();
  mountRef.current = {};
  const fresh = shellHarness({ enabled: false, scopeObject: scope, scopeRef, mountRef, pendingMap,
    download: async () => new Blob(['fresh mount']) });
  await fresh.open(row());
  assert.equal(await fresh.state.tabs[0].file.text(), 'fresh mount');
  assert.equal(fresh.state.downloads, 1, 'new mount starts its own open');
  oldGate.resolve(new Blob(['retired mount']));
  await assert.rejects(oldOpen);
  assert.equal(old.state.tabs.length, 0);
});

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) {
    const result = find(child, predicate); if (result) return result;
  }
  return null;
}

test('deep link clears its query only after the central cloud open succeeds', async () => {
  const ast = parse(shellSource, { sourceType: 'module', plugins: ['jsx'] });
  const effect = find(ast, node => node.type === 'CallExpression' && node.callee.name === 'useEffect'
    && shellSource.slice(node.start, node.end).includes('const deepLinkDocumentId = deepLinkDocumentIdRef.current;')).arguments[0];
  for (const outcome of ['success', 'failure', 'stale']) {
    const scope = { actorUserId: actor }, ref = { current: scope }, state = { history: [], toasts: [] };
    const gate = deferred();
    const ports = { documents: [row()], documentOpenScope: scope, documentOpenScopeRef: ref,
      deepLinkDocumentIdRef: { current: documentId }, handleDocumentSelect: () => assert.fail('non-DEV deep link bypassed cloud opener'),
      handleOpenCloudDocument: () => gate.promise, showToast: (...args) => state.toasts.push(args), File,
      window: { location: { href: `https://survey.test/app?docId=${documentId}&panel=notes#saved` },
        history: { state: { nav: 1 }, replaceState: (...args) => state.history.push(args) } } };
    const callback = Function(...Object.keys(ports), `return (${shellSource.slice(effect.start, effect.end).replaceAll('import.meta.env.DEV', 'false')});`)(...Object.values(ports));
    const cleanup = callback();
    if (outcome === 'stale') ref.current = { actorUserId: actor };
    outcome === 'failure' ? gate.reject(new Error('private failure')) : gate.resolve(true);
    await tick(); await tick();
    assert.equal(ports.deepLinkDocumentIdRef.current, outcome === 'success' ? null : documentId);
    assert.equal(state.history.length, outcome === 'success' ? 1 : 0);
    if (outcome === 'failure') assert.equal(state.toasts.length, 1);
    cleanup?.();
  }
});

test('no-ID and DEV files stay on local selection paths with no cloud open', async () => {
  const selected = [], cloudOpens = [];
  const scope = { actorUserId: actor };
  const localClick = extract(dashboardSource, 'const handleDocumentClick =', '\n  useEffect(() => {', {
    documentOpenScope: scope, documentOpenScopeRef: { current: scope },
    onOpenCloudDocument: async document => cloudOpens.push(document),
    onDocumentSelect: file => selected.push(file),
    downloadFromStorage: async () => assert.fail('local File downloaded from cloud'),
    showToast: () => assert.fail('local File open failed'),
    console: { log() {}, error() {} }, performance: { now: () => 0 }, File, fetch: globalThis.fetch,
  });
  const localFile = new File(['local'], 'local.pdf');
  await localClick({ file: localFile, name: localFile.name });

  const ast = parse(shellSource, { sourceType: 'module', plugins: ['jsx'] });
  const devEffect = find(ast, node => node.type === 'CallExpression' && node.callee.name === 'useEffect'
    && shellSource.slice(node.start, node.end).includes('window.__devTestPdf')).arguments[0];
  const devFile = new File(['dev'], 'dev.pdf');
  const devWindow = { __devTestPdf: devFile };
  const callback = Function('window', 'handleDocumentSelect', 'devInitialCheckedBundle',
    `return (${shellSource.slice(devEffect.start, devEffect.end).replaceAll('import.meta.env.DEV', 'true')});`)(
      devWindow, file => selected.push(file), null,
    );
  callback();

  assert.deepEqual(selected, [localFile, devFile]);
  assert.equal(devWindow.__devTestPdf, null);
  assert.deepEqual(cloudOpens, []);
});

test('DEV issued checked open uses the central checked selector before the raw PDF seam', () => {
  const ast = parse(shellSource, { sourceType: 'module', plugins: ['jsx'] });
  const devEffect = find(ast, node => node.type === 'CallExpression' && node.callee.name === 'useEffect'
    && shellSource.slice(node.start, node.end).includes('window.__devTestPdf')).arguments[0];
  const checkedBundle = Object.freeze({ fixture: 'issued-bundle-identity' });
  const rawFile = new File(['dev'], 'dev.pdf');
  const devWindow = { __devTestPdf: rawFile };
  const calls = [];
  const callback = Function('window', 'handleDocumentSelect', 'devInitialCheckedBundle',
    `return (${shellSource.slice(devEffect.start, devEffect.end).replaceAll('import.meta.env.DEV', 'true')});`)(
      devWindow, (...args) => calls.push(args), checkedBundle,
    );
  callback();
  assert.deepEqual(calls, [[null, null, checkedBundle]]);
  assert.equal(devWindow.__devTestPdf, rawFile);
});

const noop = () => {};
const noUI = () => null;
async function loadDashboard(modules) {
  const key = `__cloudRoute${crypto.randomUUID().replaceAll('-', '')}`;
  globalThis[key] = modules;
  let source = dashboardSource.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm, (_all, bindings, specifier) => {
    const name = specifier.split('/').at(-1).replace(/\.(jsx|js)$/, '');
    const value = `globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}]`;
    if (!modules[name]) modules[name] = new Proxy({ default: noUI }, { get: (target, property) => target[property] || noop });
    if (bindings.startsWith('* as ')) return `const ${bindings.slice(5)} = ${value};`;
    if (bindings.startsWith('{')) return `const ${bindings.replace(/\bas\b/g, ':')} = ${value};`;
    return `const ${bindings} = ${value}.default;`;
  }).replace(/^import ['"][^'"]+\.css['"];?$/gm, '').replaceAll('import.meta.env', '({DEV:false})');
  const output = await transformWithOxc(source, 'Dashboard.jsx', { lang: 'jsx' });
  const code = output.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const loaded = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  delete globalThis[key]; return loaded;
}

test('mounted Dashboard sends cloud IDs only to the central callback and never downloads them itself', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test/' }), restore = [];
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restore.push(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  const state = { opens: [], downloads: 0, hub: null };
  const empty = [], cloudRow = row(), cloudRows = [cloudRow];
  const cloudFail = () => { state.downloads++; throw new Error('Dashboard cloud download forbidden'); };
  const recovery = { busy: false, rows: empty, isCurrent: () => true, refresh: noop, start: cloudFail, retry: cloudFail, discard: cloudFail };
  const hooks = { projects: empty, templates: empty, initialLoading: false, refetch: noop };
  const SurveyHub = props => { state.hub = props; return React.createElement('button', { onClick: () => props.onOpenDocument(cloudRow) }, 'Open cloud row'); };
  const Dashboard = await loadDashboard({ react: React, SurveyHub: { default: SurveyHub },
    localDocumentStore: { listLocalDocuments: async () => [], openLocalDocument: cloudFail },
    localDocumentState: { createLocalDocumentStateReader: noop },
    AuthContext: { useAuth: () => ({ user: { id: actor }, isAuthenticated: true, features: {} }) },
    MSGraphContext: { useMSGraph: () => ({}) },
    useDatabase: { useDocuments: () => ({ documents: cloudRows, initialLoading: false, refetch: noop }),
      useProjects: () => hooks, useTemplates: () => hooks,
      useStorage: () => ({ uploadDocument: cloudFail, downloadDocument: cloudFail }) },
    useSubscriptionLimits: { useSubscriptionLimits: () => ({}) },
    useProjectUploadRecovery: { useProjectUploadRecovery: () => ({ busy: false, rows: [] }) },
    useDocumentUploadRecovery: { useDocumentUploadRecovery: () => recovery },
    dialogPrompts: { useConfirmDialog: () => [noop, null], usePromptDialog: () => [noop, null] },
    hubInitialLoadingState: { resolveHubInitialLoading: () => ({}) }, supabaseClient: { supabase: {} },
  });
  function App() {
    const [documents, setDocuments] = useState([]);
    return React.createElement(Dashboard, { documents, setDocuments, entities: empty, isActive: true,
      onDocumentSelect: () => assert.fail('cloud row bypassed central callback'),
      onOpenCloudDocument: async document => { state.opens.push(document); return true; }, onShowAuthModal: noop });
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); restore.reverse().forEach(undo => undo()); });
  await act(async () => root.render(React.createElement(App)));
  await act(async () => document.querySelector('button').click());
  assert.deepEqual(state.opens, [cloudRow]); assert.equal(state.downloads, 0);
});
