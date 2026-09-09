import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { prepareCheckedDocumentOpen } from '../src/services/checkedDocumentOpen.js';
import { getDocumentOpenKey, isSameDocumentTab } from '../src/utils/documentTabIdentity.js';
import { isStorageFileNotFoundError } from '../src/utils/storageErrors.js';

// Run the actual application handlers and routing component. Only transport,
// React child providers and UI state ports are local; no authenticated I/O.
const shell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
const id = n => `cd000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), documentId = id(2), generation = id(3);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = new TextEncoder().encode('%PDF-1.7\nverified original bytes\n');
async function issue({ actorUserId = actor, pdfGenerationId = generation } = {}) {
  const path = `${actorUserId}/_generations/${pdfGenerationId}.pdf`;
  const manifest = { version: 1, actor_user_id: actorUserId, document_id: documentId, generation_id: pdfGenerationId,
    document: { id: documentId, user_id: actorUserId, project_id: null, name: 'Verified plan.pdf', file_path: path, file_size: String(bytes.length) },
    pdf: { bucket_id: 'documents', path, id: id(4), version: id(5), byte_length: String(bytes.length), content_sha256: hash(bytes) },
    publication: { operation_id: id(6), generation_id: pdfGenerationId, published_at: '2026-09-09T00:00:00Z', wal_head: '0' },
    annotations: { version: 2, document_id: documentId, generation_id: pdfGenerationId, wal_head: '0',
      snapshot: { at_seq: '0', snapshot: '\\x0000', encoding_version: 1, writer_id: null, writer_epoch: '0' },
      snapshot_sha256: hash(new Uint8Array([0, 0])) } };
  const reader = createDocumentGenerationReader({ getActorUserId: () => actorUserId,
    request: async (name, params) => { assert.equal(name, 'read_document_generation_open');
      const data = structuredClone(manifest);
      if (!params.p_include_snapshot) { data.annotations.snapshot = null; data.annotations.snapshot_sha256 = null; }
      return { data }; }, download: async () => new Blob([bytes]) });
  return reader.open({ documentId, actorUserId, pdfGenerationId });
}
function extract(source, name, end, ports) {
  const start = source.indexOf(`const ${name} =`), finish = source.indexOf(end, start);
  assert.ok(start >= 0 && finish > start, `Execute current ${name}`);
  return Function(...Object.keys(ports), `${source.slice(start, finish)}\nreturn ${name};`)(...Object.values(ports));
}
function handlerHarness(initial = []) {
  const scope = { actorUserId: actor }, ref = { current: scope }, opening = { current: new Set() };
  const state = { tabs: initial, selected: null, active: null, view: null, loading: false };
  const closeViewRef = { current: { tabs: state.tabs } };
  const changes = [], timers = [];
  let serial = 0;
  const set = name => value => { changes.push(name); state[name] = typeof value === 'function' ? value(state[name]) : value; };
  const ports = () => { closeViewRef.current = { tabs: state.tabs }; return ({ tabs: state.tabs, selectedPDF: state.selected, documentOpenScope: scope, documentOpenScopeRef: ref,
    closeViewRef,
    openingPdfsRef: opening, prepareCheckedDocumentOpen, getDocumentOpenKey, isSameDocumentTab,
    setTabs: set('tabs'), setSelectedPDF: set('selected'), setActiveTabId: set('active'), setCurrentView: set('view'), setIsLoading: set('loading'),
    generateTabId: () => `tab-${++serial}`, setTimeout: callback => { timers.push(callback); } }); };
  return { state, changes, ref, opening,
    select: (...args) => extract(shell, 'handleDocumentSelect', '  // DEV-ONLY: Auto-open test PDF', ports())(...args),
    staleSelect: () => extract(shell, 'handleDocumentSelect', '  // DEV-ONLY: Auto-open test PDF', ports()),
    activate: (doc, documents = [{ id: documentId }]) => extract(shell, 'handleActivateOpenDocument', '\n  const handleDocumentSelect =', { ...ports(), documents })(doc),
    settle: () => { for (const timer of timers.splice(0)) timer(); },
  };
}

test('actual select builds checked tab only from verified bytes and retains the original bundle', async () => {
  const bundle = await issue(), h = handlerHarness();
  const wrongFile = Object.assign(new File(['WRONG'], 'wrong.pdf'), { id: id(99), user_id: id(98) });
  h.select(wrongFile, '/wrong/local/path.pdf', bundle);
  const tab = h.state.tabs[0];
  assert.equal(tab.checkedBundle, bundle);
  assert.notEqual(tab.file, wrongFile);
  assert.equal(await tab.file.text(), new TextDecoder().decode(bytes));
  assert.equal(tab.file.id, documentId);
  assert.equal(tab.file.pdfGenerationId, generation);
  assert.equal(tab.file.name, bundle.document.name);
  assert.equal(tab.file.supabaseFilePath, bundle.pdf.path);
  assert.equal(tab.filePath, null);
  assert.equal(tab.actorUserId, actor);
  assert.equal(h.state.selected, tab.file);
  assert.equal(h.state.active, tab.id);
});

for (const flag of [null, '__pdfLoadFailed', '__rewrittenForParse']) {
  test(`same-generation select keeps unsaved file and first bundle (${flag || 'healthy'})`, async () => {
    const first = await issue(), fresh = await issue(), h = handlerHarness();
    h.select(null, null, first); h.settle();
    const tab = h.state.tabs[0], original = tab.file;
    original.unsavedAnnotationDraft = { owned: true };
    if (flag) original[flag] = true;
    h.select(new File(['new bytes'], 'new.pdf'), null, fresh);
    assert.equal(h.state.tabs.length, 1);
    if (flag) {
      assert.notEqual(h.state.tabs[0], tab);
      assert.notEqual(h.state.tabs[0].file, original);
      assert.equal(h.state.tabs[0].checkedBundle, fresh);
      assert.equal(h.state.selected, h.state.tabs[0].file);
    } else {
      assert.equal(h.state.tabs[0], tab);
      assert.equal(tab.file, original);
      assert.equal(tab.checkedBundle, first);
      assert.equal(h.state.selected, original);
    }
    assert.equal(original.unsavedAnnotationDraft.owned, true);
  });
}

test('different generations open distinct tabs without replacing the prior unsaved tab', async () => {
  const first = await issue(), second = await issue({ pdfGenerationId: id(30) }), h = handlerHarness();
  h.select(null, null, first); h.settle();
  const old = h.state.tabs[0]; old.file.unsavedAnnotationDraft = 'keep';
  h.select(old.file, null, second);
  assert.equal(h.state.tabs.length, 2);
  assert.equal(h.state.tabs[0], old);
  assert.equal(old.checkedBundle, first);
  assert.equal(old.file.unsavedAnnotationDraft, 'keep');
  assert.equal(h.state.tabs[1].checkedBundle, second);
  assert.equal(h.state.tabs[1].file.pdfGenerationId, id(30));
  assert.notEqual(h.state.active, old.id);
});

test('wrong actor, forged bundle and generation marker without bundle fail before any state change', async () => {
  const valid = await issue(), other = await issue({ actorUserId: id(80) });
  for (const [file, bundle] of [[null, other], [null, { ...valid }], [{ id: documentId, pdfGenerationId: generation }, null]]) {
    const h = handlerHarness();
    assert.throws(() => h.select(file, null, bundle), { code: 'DOCUMENT_OPEN_INPUT' });
    assert.deepEqual(h.changes, []);
    assert.equal(h.opening.current.size, 0);
    assert.deepEqual(h.state.tabs, []);
  }
});

test('retired actor scope ignores even genuine checked opens before changing state', async () => {
  const bundle = await issue(), h = handlerHarness(), stale = h.staleSelect();
  h.ref.current = { actorUserId: actor };
  stale(null, null, bundle);
  assert.deepEqual(h.changes, []);
  assert.deepEqual(h.state.tabs, []);
});

test('raw list and deep-link reopens activate the checked tab without downgrading it', async () => {
  const bundle = await issue(), h = handlerHarness();
  h.select(null, null, bundle); h.settle();
  const tab = h.state.tabs[0]; tab.file.unsavedAnnotationDraft = 'keep';
  const raw = { id: documentId, name: 'list name.pdf', file_path: 'wrong/legacy.pdf' };
  h.select(raw, raw.file_path);
  assert.equal(h.state.tabs.length, 1);
  assert.equal(h.state.tabs[0], tab);
  assert.equal(h.state.selected, tab.file);
  assert.equal(tab.checkedBundle, bundle);
  let downloads = 0, newOpens = 0;
  const scope = { actorUserId: actor };
  const click = extract(dashboard, 'handleDocumentClick', '\n  useEffect(() => {', {
    documentOpenScope: scope, documentOpenScopeRef: { current: scope },
    onOpenCloudDocument: async doc => {
      if (h.activate(doc) !== true) throw new Error('Activation rejected');
      return true;
    },
    downloadFromStorage: async () => { downloads++; throw new Error('Unexpected download'); },
    onDocumentSelect: () => { newOpens++; },
    console: { log() {}, error() {} }, performance: { now: () => 0 }, isStorageFileNotFoundError,
    showToast: () => assert.fail('Activation must not fail'),
  });
  await click(raw);
  assert.equal(downloads, 0);
  assert.equal(newOpens, 0);
  assert.equal(tab.file.unsavedAnnotationDraft, 'keep');
  assert.equal(h.activate(raw, []), false, 'An unlisted document is not an activation grant');
});

const require = createRequire(import.meta.url);
async function mountedRouter(t, tab) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' }), restore = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const calls = { legacy: [], checked: [], childMounts: 0, childUnmounts: 0, child: [] };
  const callback = () => {}, client = {}, closeDocument = () => {};
  function Legacy(props) { calls.legacy.push(props); return props.children; }
  function Checked(props) { calls.checked.push(props); return props.children({ checkedBundle: props.checkedBundle, onGenerationSession: callback }); }
  function Child(props) { calls.child.push(props); React.useEffect(() => { calls.childMounts++; return () => { calls.childUnmounts++; }; }, []);
    return React.createElement('span', { 'data-testid': 'child' }, 'viewer'); }
  const key = `__checkedTabRoute_${crypto.randomUUID().replaceAll('-', '')}`;
  globalThis[key] = { react: { default: React }, 'YDocProvider.jsx': { default: Legacy },
    'GeneratedDocumentProvider.jsx': { HookOwnedGeneratedDocumentProvider: Checked }, 'supabaseClient.js': { supabase: client } };
  let Component;
  try {
    const file = new URL('../src/components/collab/DocumentTabProvider.jsx', import.meta.url);
    const source = (await readFile(file, 'utf8')).replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm, (_match, binding, specifier) => {
      const name = specifier.split('/').at(-1), value = `globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}]`;
      assert.ok(globalThis[key][name], `Unexpected route dependency ${specifier}`);
      return binding.trim().startsWith('{') ? `const ${binding.trim()} = ${value};` : `const ${binding.trim()} = ${value}.default;`;
    });
    const compiled = await transformWithOxc(source, file.pathname, { lang: 'jsx' });
    const code = compiled.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
    Component = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  } finally { delete globalThis[key]; }
  const root = createRoot(dom.window.document.getElementById('root'));
  let props = { tab, currentActorUserId: actor, isActive: true, closeDocument, client,
    children: child => React.createElement(Child, child) };
  const render = async patch => { props = { ...props, ...patch }; await act(async () => root.render(React.createElement(Component, props))); };
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const undo of restore.reverse()) undo(); });
  await render({});
  return { calls, render, dom, callback, client, closeDocument };
}

test('mounted checked route skips legacy even while pending and keeps its child mounted across activation', async t => {
  const bundle = await issue(), prepared = prepareCheckedDocumentOpen(bundle, actor);
  const h = await mountedRouter(t, { file: prepared.file, checkedBundle: bundle, actorUserId: actor });
  assert.equal(h.calls.legacy.length, 0);
  assert.equal(h.calls.childMounts, 1);
  assert.equal(h.calls.child.at(-1).checkedBundle, bundle);
  assert.equal(h.calls.child.at(-1).onGenerationSession, h.callback);
  assert.equal(h.calls.checked[0].client, h.client);
  assert.equal(h.calls.checked[0].closeDocument, h.closeDocument);
  assert.equal(h.calls.checked[0].currentActorUserId, actor);
  await h.render({ isActive: false });
  assert.equal(h.calls.checked.at(-1).isActive, false);
  await h.render({ isActive: true });
  assert.equal(h.calls.childMounts, 1);
  assert.equal(h.calls.childUnmounts, 0);
  assert.equal(h.calls.legacy.length, 0);
});

test('mounted legacy route keeps its exact scope and passes no generated callback', async t => {
  const file = { id: documentId }, h = await mountedRouter(t, { file, actorUserId: actor });
  assert.equal(h.calls.checked.length, 0);
  assert.equal(h.calls.legacy.length, 1);
  const props = h.calls.legacy[0];
  assert.equal(props.docId, documentId);
  assert.equal(props.actorUserId, actor);
  assert.equal(props.currentActorUserId, actor);
  assert.equal(props.closeDocument, h.closeDocument);
  assert.equal(props.isActive, true);
  assert.equal(h.calls.child.at(-1).checkedBundle, null);
  assert.equal(h.calls.child.at(-1).onGenerationSession, null);
});

test('mounted generation-marked tab without a checked bundle fails closed with no child or provider', async t => {
  const h = await mountedRouter(t, { file: { id: documentId, pdfGenerationId: generation }, actorUserId: actor });
  assert.match(h.dom.window.document.querySelector('[role="alert"]').textContent, /verified open/);
  assert.equal(h.calls.checked.length, 0);
  assert.equal(h.calls.legacy.length, 0);
  assert.equal(h.calls.childMounts, 0);
});
