import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { JSDOM } from 'jsdom';
import { isManagedLocalDocument } from '../src/services/localDocumentState.js';
import { createPageMutationFile } from '../src/utils/pageMutationFile.js';

const source = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) {
    if (child && typeof child === 'object') { const result = find(child, predicate); if (result) return result; }
  }
  return null;
}
function actualHandler(name, scope) {
  const node = find(tree, node => node.type === 'VariableDeclarator' && node.id.name === name);
  const callback = node.init.type === 'CallExpression' ? node.init.arguments[0] : node.init;
  return Function(...Object.keys(scope), `return (${source.slice(callback.start, callback.end)});`)(...Object.values(scope));
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const cloudFile = () => Object.assign(new Blob(['original']), { id: 'document-a', name: 'plan.pdf', supabaseFilePath: 'owner/document-a.pdf' });
const localId = 'local:8ad364a5-786f-470f-858d-253c52bff3bd';
const managedFile = () => Object.assign(new Blob(['original']), { storageMode: 'local', localId,
  _surveyPdfId: localId, localRevision: 3, name: 'local.pdf' });
function harness({ file = cloudFile(), actor = 'actor-a', tabActor = actor,
  localDocumentFileReplacer = null } = {}) {
  const next = Object.assign(new Blob(['replacement']), Object.fromEntries(Object.keys(file).map(key => [key, file[key]])));
  const state = { tabs: [{ id: 'tab-a', file, actorUserId: tabActor }], selected: file,
    documents: [{ id: file.id, size: file.size }], writes: [], toasts: [], prepare: 0, queued: [], beforeFlush: null };
  const scope = { actorUserId: actor };
  const deps = {
    documentOpenScope: scope, documentOpenScopeRef: { current: scope },
    closeViewRef: { current: { tabs: state.tabs, activeTabId: 'tab-a' } },
    fileReplacementMountRef: { current: {} }, pendingFileReplacementsRef: { current: new Map() },
    pendingTabClosesRef: { current: new Set() }, isManagedLocalDocument,
    replaceDocument: async (...args) => { state.writes.push(['cloud', ...args]); if (state.pending) await state.pending.promise; },
    replaceLocalDocument: async (...args) => { state.writes.push(['local', ...args]); if (state.pending) await state.pending.promise; return { revision: 4 }; },
    localDocumentFileReplacer,
    setTabs: update => state.queued.push(() => { state.tabs = update(state.tabs); deps.closeViewRef.current = { ...deps.closeViewRef.current, tabs: state.tabs }; }),
    setSelectedPDF: update => state.queued.push(() => { state.selected = typeof update === 'function' ? update(state.selected) : update; }),
    setDocuments: update => state.queued.push(() => { state.documents = update(state.documents); }),
    flushSync: run => { run(); state.beforeFlush?.(); while (state.queued.length) state.queued.shift()(); },
    HOME_TAB_ID: 'home-tab', prepareTabClose: async () => { state.prepare++; return { saved: true }; },
    showToast: (...args) => state.toasts.push(args), setActiveTabId() {}, setCurrentView() {},
  };
  const update = actualHandler('handleUpdatePDFFile', deps);
  const close = actualHandler('handleTabClose', deps);
  return { state, deps, file, next, update, close,
    replaceTab(patch) { state.tabs = state.tabs.map(tab => ({ ...tab, ...patch })); deps.closeViewRef.current.tabs = state.tabs; } };
}

test('actual cloud replacement binds source path and updates only its live tab after persistence', async () => {
  const h = harness(); assert.equal(await h.update(h.next, 'tab-a', h.file), h.next);
  assert.equal(h.state.writes.length, 1); assert.equal(h.state.writes[0][2], 'owner/document-a.pdf');
  assert.equal(h.state.tabs[0].file, h.next); assert.equal(h.state.selected, h.next);
  assert.equal(h.state.documents[0].file_size, h.next.size); assert.equal(h.deps.pendingFileReplacementsRef.current.size, 0);
});

test('managed local replacement preserves expected revision and canonical state, including guest-opened files', async () => {
  const h = harness({ file: managedFile(), tabActor: null }); h.next._localDocumentState = { version: 1 };
  assert.equal(await h.update(h.next, 'tab-a', h.file), h.next);
  assert.deepEqual(h.state.writes[0].slice(0, 2), ['local', localId]);
  assert.deepEqual(h.state.writes[0][3], { expectedRevision: 3, state: h.next._localDocumentState });
  assert.equal(h.next.localRevision, 4); assert.equal(h.file.localRevision, 3);
});

test('managed local replacement uses the injected file replacer with full state and no cloud write', async () => {
  const calls = [];
  const state = { version: 1, pdfId: localId, entries: {
    [`annotationsByPage_${localId}`]: '{"1":{"objects":[{"id":"kept"}]}}',
    [`entityCatalog_${localId}`]: '{"status":"accepted"}',
  } };
  const injected = async (...args) => { calls.push(args); return { revision: 9 }; };
  const h = harness({ file: managedFile(), tabActor: null, localDocumentFileReplacer: injected });
  h.next._localDocumentState = state;
  assert.equal(await h.update(h.next, 'tab-a', h.file), h.next);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], localId);
  assert.equal(calls[0][1], h.next);
  assert.deepEqual(calls[0][2], { expectedRevision: 3, state });
  assert.equal(h.next.localRevision, 9);
  assert.deepEqual(h.next._localDocumentState, state);
  assert.deepEqual(h.state.writes, [], 'neither default local storage nor cloud storage is called');
});

test('unmanaged local replacement stays local and preserves its exact source identity', async () => {
  const file = Object.assign(new Blob(['local']), { name: 'local.pdf', _surveyPdfId: 'local-source' });
  const h = harness({ file, actor: null }); await h.update(h.next, 'tab-a', h.file);
  assert.deepEqual(h.state.writes, []); assert.equal(h.state.tabs[0].file, h.next);
});

test('real page factory adds the canonical identity to a plain dev/local File and preserves it on the second replacement', async () => {
  const original = new File(['%PDF-1.7\noriginal'], 'clickable-link-test.pdf', { type: 'application/pdf' });
  assert.equal(original._surveyPdfId, undefined);
  const h = harness({ file: original, actor: null });
  const first = createPageMutationFile(new Uint8Array([1, 2, 3]), original);
  const second = createPageMutationFile(new Uint8Array([4, 5, 6, 7]), first);
  assert.equal(first._surveyPdfId, `${original.name}-${original.size}`);
  assert.equal(await h.update(first, 'tab-a', original), first);
  assert.equal(h.state.tabs[0].file, first);
  assert.equal(await h.update(second, 'tab-a', first), second);
  assert.equal(second._surveyPdfId, first._surveyPdfId);
  assert.equal(h.state.tabs[0].file, second); assert.deepEqual(h.state.writes, []);
});

test('unmanaged local replacements still reject a different canonical identity', async () => {
  const original = new File(['original'], 'local.pdf', { type: 'application/pdf' });
  const h = harness({ file: original, actor: null });
  const replacement = createPageMutationFile(new Uint8Array([1]), original);
  replacement._surveyPdfId = 'another-local-file';
  await assert.rejects(h.update(replacement, 'tab-a', original), { code: 'PDF_REPLACEMENT_STALE' });
  assert.equal(h.state.tabs[0].file, original); assert.deepEqual(h.state.writes, []);
});

for (const change of ['missing-source', 'old-source', 'missing-tab', 'wrong-id', 'wrong-path', 'missing-path', 'other-path-alias', 'actor', 'signed-out', 'closed', 'unmounted']) {
  test(`${change} refuses before any replacement write`, async () => {
    const h = harness(); let target = 'tab-a', expected = h.file;
    if (change === 'missing-source') expected = undefined;
    if (change === 'old-source') expected = cloudFile();
    if (change === 'missing-tab') target = 'absent';
    if (change === 'wrong-id') h.next.id = 'other-document';
    if (change === 'wrong-path') h.next.supabaseFilePath = 'owner/other.pdf';
    if (change === 'missing-path') delete h.next.supabaseFilePath;
    if (change === 'other-path-alias') h.next.filePath = 'owner/other.pdf';
    if (change === 'actor') h.deps.documentOpenScopeRef.current = { actorUserId: 'actor-b' };
    if (change === 'signed-out') h.replaceTab({ actorUserId: 'actor-b' });
    if (change === 'closed') h.deps.closeViewRef.current.tabs = [];
    if (change === 'unmounted') h.deps.fileReplacementMountRef.current = null;
    await assert.rejects(h.update(h.next, target, expected), { code: 'PDF_REPLACEMENT_STALE' });
    assert.deepEqual(h.state.writes, []); assert.equal(h.state.selected, h.file);
  });
}

for (const surface of ['tab', 'source', 'replacement']) for (const key of ['checkedBundle', 'pdfGenerationId', 'pdf_generation_id']) {
  test(`${surface} ${key} refuses raw replacement before I/O`, async () => {
    const h = harness(); const target = surface === 'tab' ? h.state.tabs[0] : surface === 'source' ? h.file : h.next;
    target[key] = key === 'checkedBundle' ? {} : 'generation-a';
    await assert.rejects(h.update(h.next, 'tab-a', h.file), { code: 'PDF_REPLACEMENT_GENERATION' });
    assert.deepEqual(h.state.writes, []);
  });
}

for (const change of ['actor-aba', 'file', 'closed', 'unmounted', 'path', 'generation']) test(`${change} during write cannot publish a save success`, async () => {
  const h = harness(); h.state.pending = deferred(); const promise = h.update(h.next, 'tab-a', h.file);
  const rejection = assert.rejects(promise, { code: 'PDF_REPLACEMENT_STALE' });
  if (change === 'actor-aba') h.deps.documentOpenScopeRef.current = { actorUserId: 'actor-a' };
  if (change === 'file') h.replaceTab({ file: cloudFile() });
  if (change === 'closed') h.deps.closeViewRef.current.tabs = [];
  if (change === 'unmounted') h.deps.fileReplacementMountRef.current = null;
  if (change === 'path') h.file.supabaseFilePath = 'owner/changed.pdf';
  if (change === 'generation') h.replaceTab({ checkedBundle: {} });
  h.state.pending.resolve(); await rejection;
  assert.equal(h.state.writes.length, 1, 'an already dispatched write cannot be undone by a UI guard');
  assert.equal(h.state.selected, h.file); assert.equal(h.state.documents[0].size, h.file.size);
  assert.equal(h.deps.pendingFileReplacementsRef.current.size, 0);
});

test('switching active tabs during save updates the saved tab without replacing the new selection', async () => {
  const h = harness(); h.state.pending = deferred(); const promise = h.update(h.next, 'tab-a', h.file);
  const other = cloudFile(); h.deps.closeViewRef.current.activeTabId = 'tab-b'; h.state.selected = other;
  h.replaceTab({ viewState: { page: 2 } }); h.state.pending.resolve(); await promise;
  assert.equal(h.state.tabs[0].file, h.next); assert.equal(h.state.selected, other);
});

test('same-tab writes serialize and close refuses while persistence is pending', async () => {
  const h = harness(); h.state.pending = deferred(); const promise = h.update(h.next, 'tab-a', h.file);
  await assert.rejects(h.update(cloudFile(), 'tab-a', h.file), { code: 'PDF_REPLACEMENT_PENDING' });
  await h.close('tab-a'); assert.equal(h.state.prepare, 0); assert.equal(h.state.toasts.length, 1);
  h.state.pending.resolve(); await promise;
  await assert.rejects(h.update(cloudFile(), 'tab-a', h.file), { code: 'PDF_REPLACEMENT_STALE' });
  assert.equal(h.state.writes.length, 1);
});

test('replacement refuses while close already owns the tab', async () => {
  const h = harness(); h.deps.pendingTabClosesRef.current.add('tab-a');
  await assert.rejects(h.update(h.next, 'tab-a', h.file), { code: 'PDF_REPLACEMENT_PENDING' });
  assert.deepEqual(h.state.writes, []);
});

test('storage failure retains old file and releases the lease for an explicit retry', async () => {
  const h = harness({ file: managedFile() }); h.state.pending = deferred();
  const promise = h.update(h.next, 'tab-a', h.file); const failed = assert.rejects(promise, /revision conflict/);
  h.state.pending.reject(new Error('revision conflict')); await failed;
  assert.equal(h.next.localRevision, 3); assert.equal(h.state.tabs[0].file, h.file);
  h.state.pending = null; await h.update(h.next, 'tab-a', h.file); assert.equal(h.next.localRevision, 4);
});

test('queued setters recheck actor scope instead of publishing to the next account', async () => {
  const h = harness(); h.state.beforeFlush = () => { h.deps.documentOpenScopeRef.current = { actorUserId: 'actor-b' }; };
  await assert.rejects(h.update(h.next, 'tab-a', h.file), { code: 'PDF_REPLACEMENT_STALE' });
  assert.equal(h.state.tabs[0].file, h.file); assert.equal(h.state.selected, h.file);
  assert.equal(h.state.documents[0].size, h.file.size);
});

test('the actual mount effect retires old writes and installs a fresh StrictMode mount token', () => {
  const effect = find(tree, node => node.type === 'CallExpression' && node.callee.name === 'useLayoutEffect'
    && source.slice(node.start, node.end).includes('fileReplacementMountRef.current = mount'));
  assert.ok(effect); const ref = { current: null };
  const setup = Function('fileReplacementMountRef', `return (${source.slice(effect.arguments[0].start, effect.arguments[0].end)});`)(ref);
  const cleanup = setup(); const first = ref.current; cleanup(); assert.equal(ref.current, null);
  const finalCleanup = setup(); assert.notEqual(ref.current, first); cleanup(); assert.notEqual(ref.current, null); finalCleanup();
});

for (const local of [false, true]) test(`actual React commits ${local ? 'managed local' : 'cloud'} replacement before releasing its write lease`, async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const original = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const h = harness({ file: local ? managedFile() : cloudFile() }); let update, rendered;
  function Probe() {
    const [tabs, setTabs] = useState(h.state.tabs);
    const [selected, setSelectedPDF] = useState(h.file);
    const [documents, setDocuments] = useState(h.state.documents);
    h.deps.closeViewRef.current = { tabs, activeTabId: 'tab-a' };
    update = actualHandler('handleUpdatePDFFile', { ...h.deps, setTabs, setSelectedPDF, setDocuments, flushSync });
    rendered = { tabs, selected, documents };
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  await act(async () => root.render(React.createElement(Probe)));
  await act(async () => {
    assert.equal(await update(h.next, 'tab-a', h.file), h.next);
    assert.equal(rendered.tabs[0].file, h.next); assert.equal(rendered.selected, h.next);
    assert.equal(h.deps.closeViewRef.current.tabs[0].file, h.next);
    assert.equal(h.deps.pendingFileReplacementsRef.current.size, 0);
    await assert.rejects(update(h.next, 'tab-a', h.file), { code: 'PDF_REPLACEMENT_STALE' });
  });
  assert.equal(h.state.writes.length, 1);
  if (!local) assert.equal(rendered.documents[0].file_size, h.next.size);
});
