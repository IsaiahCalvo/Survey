import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { saveAnnotationsByPage } from '../src/viewerShared.js';

const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const callbackStart = viewerSource.indexOf('const handleSaveDocument = useCallback(');
const callbackEnd = viewerSource.indexOf('\n  }, [pdfId, pdfFile, annotationsByPage', callbackStart);
assert.ok(callbackStart >= 0 && callbackEnd > callbackStart, 'test the real viewer save callback');
const callbackSource = viewerSource.slice(
  callbackStart + 'const handleSaveDocument = useCallback('.length,
  callbackEnd + '\n  }'.length,
);
const quitStart = viewerSource.indexOf('const saveLocalBeforeQuit = async (');
const quitEnd = viewerSource.indexOf('\n  const quitCloseChecksRef =', quitStart);
assert.ok(quitStart >= 0 && quitEnd > quitStart, 'test the real viewer quit handler');
const quitSource = viewerSource.slice(quitStart + 'const saveLocalBeforeQuit = '.length, quitEnd).replace(/;\s*$/, '');

const dirtyMarker = viewerSource.indexOf('// Mark annotations as dirty when they change');
const dirtyStart = viewerSource.indexOf('useEffect(', dirtyMarker);
const dirtyEnd = viewerSource.indexOf('\n  }, [pdfId, annotationsByPage', dirtyStart);
assert.ok(dirtyMarker >= 0 && dirtyStart > dirtyMarker && dirtyEnd > dirtyStart);
const dirtyEffectSource = viewerSource.slice(dirtyStart + 'useEffect('.length, dirtyEnd + '\n  }'.length);

test('mounted dirty tracking preserves last-object deletions and clears an undo to the saved snapshot', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const originals = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const saved = { 1: { objects: [{ id: 'last-object' }] } };
  const notifications = [];
  const onUnsavedAnnotationsChange = (...args) => notifications.push(args);
  let updatePages;
  function DirtyProbe() {
    const [pages, setPages] = useState(saved);
    const [dirty, setDirty] = useState(false);
    const savedRef = useRef(saved);
    updatePages = setPages;
    const scope = {
      pdfId: 'local-pdf', tabId: 'inactive-local-tab', annotationsByPage: pages,
      savedAnnotationsByPageRef: savedRef, setHasUnsavedAnnotations: setDirty,
      onUnsavedAnnotationsChange,
    };
    const effect = new Function(...Object.keys(scope), `return (${dirtyEffectSource});`)(...Object.values(scope));
    useEffect(effect, [pages]);
    return React.createElement('output', null, String(dirty));
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await act(async () => root.render(React.createElement(DirtyProbe)));
  assert.equal(document.querySelector('output').textContent, 'false', 'hydrated saved annotations start clean');
  await act(async () => updatePages({}));
  assert.equal(document.querySelector('output').textContent, 'true', 'removing the last page is an unsaved edit');
  assert.deepEqual(notifications.at(-1), [true, 'inactive-local-tab'], 'dirty state belongs to this tab, not the active tab');
  await act(async () => updatePages(saved));
  assert.equal(document.querySelector('output').textContent, 'false', 'undoing to saved content clears dirty');
  assert.deepEqual(notifications.at(-1), [false, 'inactive-local-tab']);
});

function storageHarness(t, error = null) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map([
    ['annotationsByPage_other-local-doc', '{"offline":"only copy"}'],
    ['annotationsByPage_current', '{"previous":"recoverable copy"}'],
    ['appPreference', 'keep'],
  ]);
  let writes = 0;
  const removed = [];
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return entries.size; },
      key: (index) => [...entries.keys()][index],
      getItem: (key) => entries.get(key) ?? null,
      setItem(key, value) {
        writes += 1;
        if (error) throw error;
        entries.set(key, value);
      },
      removeItem(key) { removed.push(key); entries.delete(key); },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  return { entries, removed, writes: () => writes };
}

for (const error of [
  Object.assign(new Error('full'), { name: 'QuotaExceededError', code: 22 }),
  Object.assign(new Error('blocked'), { name: 'SecurityError' }),
]) {
  test(`failed ${error.name} write preserves every document and reports failure`, (t) => {
    const h = storageHarness(t, error);
    const previous = new Map(h.entries);
    const result = saveAnnotationsByPage('current', { 1: { objects: [{ id: 'new-edit' }] } });
    assert.deepEqual(h.entries, previous, 'never evict another document or its previous saved edits');
    assert.deepEqual(h.removed, []);
    assert.equal(h.writes(), 1, 'do not retry by deleting authoritative edits');
    assert.equal(result, false);
  });
}

test('successful local write reports success and saves an empty-page deletion', (t) => {
  const h = storageHarness(t);
  assert.equal(saveAnnotationsByPage('current', {}), true);
  assert.equal(h.entries.get('annotationsByPage_current'), '{}');
  assert.equal(h.entries.get('annotationsByPage_other-local-doc'), '{"offline":"only copy"}');
});

test('serialization failure returns false before touching saved edits', (t) => {
  const h = storageHarness(t);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(saveAnnotationsByPage('current', cyclic), false);
  assert.equal(h.writes(), 0);
  assert.equal(h.entries.get('annotationsByPage_current'), '{"previous":"recoverable copy"}');
});

test('missing document identity cannot report a saved backup', (t) => {
  const h = storageHarness(t);
  assert.equal(saveAnnotationsByPage(null, {}), false);
  assert.equal(h.writes(), 0);
});

test('an unserializable snapshot cannot replace a valid saved backup with undefined', (t) => {
  const h = storageHarness(t);
  assert.equal(saveAnnotationsByPage('current', undefined), false);
  assert.equal(h.writes(), 0);
  assert.equal(h.entries.get('annotationsByPage_current'), '{"previous":"recoverable copy"}');
});

function saveCallbackHarness({ localSaved, cloud = false, flushError = null, overrides = {} } = {}) {
  const state = { dirty: true, notifications: [], toasts: [], logs: [], cloudWrites: 0, flushes: 0 };
  const previous = { 1: { objects: [{ id: 'previous' }] } };
  const next = { 1: { objects: [{ id: 'latest' }] } };
  const savedRef = { current: previous };
  const pdfFile = overrides.pdfFile || { id: 'cloud-doc' };
  const user = overrides.user || { id: 'owner' };
  const scope = {
    pdfId: 'current', pdfFile, tabId: 'tab-current',
    saveDocumentScopeRef: { current: { pdfId: overrides.pdfId || 'current', pdfFile, actorUserId: user.id } },
    annotationsByPage: next, callouts: [], surveyMarkers: {}, spaces: [], selectedTemplate: null,
    annotationsByPageRef: { current: overrides.annotationsByPage || next },
    flushPendingFormFieldsRef: { current: () => {} },
    user, features: { cloudSync: cloud },
    document: { body: { getAttribute: () => null } },
    summarizeAnnotationCountsForSaveExport: () => ({ byType: {} }),
    saveAnnotationsByPage: () => localSaved,
    savedAnnotationsByPageRef: savedRef,
    setHasUnsavedAnnotations: (dirty) => { state.dirty = dirty; },
    onUnsavedAnnotationsChange: (...args) => state.notifications.push(args),
    saveSurveyDataToSupabase: async () => { state.cloudWrites += 1; },
    cloudSyncForceFlush: async () => { state.flushes += 1; if (flushError) throw flushError; },
    showToast: (...args) => state.toasts.push(args),
    console: { log: (line) => state.logs.push(line), warn: () => {}, error: () => {} },
    EXCEL_AUTOMATIC_WRITEBACK_ENABLED: false,
    ...overrides,
  };
  const save = new Function(...Object.keys(scope), `return (${callbackSource});`)(...Object.values(scope));
  return {
    state, savedRef, previous, next, save,
    complete: () => JSON.parse(state.logs.find((line) => line.startsWith('[PDFSaveExport] action complete '))
      .slice('[PDFSaveExport] action complete '.length)),
  };
}

test('manual Save flushes pending form input before reading its latest snapshot', async () => {
  const latest = { 1: { objects: [{ type: 'form-field', data: { value: 'just typed' } }] } };
  const pagesRef = { current: {} };
  let flushed = 0;
  let written;
  let counted;
  const h = saveCallbackHarness({ overrides: {
    annotationsByPageRef: pagesRef,
    flushPendingFormFieldsRef: { current: () => { flushed++; pagesRef.current = latest; } },
    saveAnnotationsByPage: (_id, snapshot) => { written = snapshot; return true; },
    summarizeAnnotationCountsForSaveExport: snapshot => { counted = snapshot; return { byType: {} }; },
  } });
  await h.save();
  assert.equal(flushed, 1);
  assert.equal(written, latest);
  assert.equal(counted, latest);
  assert.deepEqual(h.savedRef.current, latest);
  assert.equal(h.state.dirty, false);
});

test('locked manual Save never flushes queued form edits or writes a snapshot', async () => {
  const h = saveCallbackHarness({ overrides: {
    document: { body: { getAttribute: () => 'true' } },
    flushPendingFormFieldsRef: { current: () => { throw new Error('locked form flush'); } },
    saveAnnotationsByPage: () => { throw new Error('locked snapshot write'); },
  } });
  assert.equal(await h.save(), true);
  assert.equal(h.state.logs.length, 0);
  assert.equal(h.state.notifications.length, 0);
});

for (const changed of ['pdfId', 'pdfFile', 'actorUserId']) {
  test(`an old retained Save callback cannot flush or write after ${changed} changes`, async () => {
    const pdfFile = { id: 'cloud-doc' };
    const current = { pdfId: 'current', pdfFile, actorUserId: 'owner' };
    const scopeRef = { current };
    const h = saveCallbackHarness({ overrides: {
      pdfFile, saveDocumentScopeRef: scopeRef,
      flushPendingFormFieldsRef: { current: () => { throw new Error('retired callback flushed new fields'); } },
      saveAnnotationsByPage: () => { throw new Error('retired callback wrote a snapshot'); },
    } });
    scopeRef.current = { ...current, [changed]: changed === 'pdfFile' ? { id: 'cloud-doc' } : 'different' };
    assert.equal(await h.save(), false);
    assert.equal(h.state.logs.length, 0, 'reject before entering the save action');
    assert.equal(h.state.notifications.length, 0);
  });
}

for (const silent of [false, true]) {
  test(`failed local save retains dirty state and shows an error (silent=${silent})`, async () => {
    const h = saveCallbackHarness({ localSaved: false });
    await h.save(silent);
    assert.equal(h.state.dirty, true);
    assert.equal(h.savedRef.current, h.previous);
    assert.ok(h.state.notifications.every(([dirty]) => dirty !== false));
    assert.equal(h.complete().localBackupSaved, false);
    assert.equal(h.state.toasts.length, 1, 'auto-save failure must not be silent');
    assert.equal(h.state.toasts[0][1], 'error');
  });
}

test('local storage failure does not prevent the existing cloud save attempt', async () => {
  const h = saveCallbackHarness({ localSaved: false, cloud: true });
  await h.save();
  assert.equal(h.state.cloudWrites, 1);
  assert.equal(h.state.flushes, 1);
  assert.equal(h.state.dirty, true, 'local durability remains unconfirmed even when cloud flush resolves');
  assert.equal(h.complete().localBackupSaved, false);
  assert.equal(h.complete().supabaseAnnotationSaveRan, true);
});

test('successful local backup still clears dirty state if cloud flush fails', async () => {
  const h = saveCallbackHarness({ localSaved: true, cloud: true, flushError: new Error('offline') });
  await h.save();
  assert.equal(h.state.dirty, false);
  assert.deepEqual(h.savedRef.current, h.next);
  assert.deepEqual(h.state.notifications, [[false, 'tab-current']]);
  assert.equal(h.complete().localBackupSaved, true);
  assert.equal(h.complete().supabaseAnnotationSaveRan, false);
  assert.equal(h.complete().supabaseAnnotationSaveError, 'offline');
  assert.deepEqual(h.state.toasts, []);
});

function quitHarness({ dirty = true, locked = false, cloud = false, save = async () => true,
  reason = null, ensure = async () => ({ locallyDurable: true }), proofCurrent = true } = {}) {
  const state = { dirty, revision: 'initial', writes: [], notifications: [], receiptCalls: 0, gates: [], proofCurrent };
  const snapshot = {};
  const savedRef = { current: { 1: { objects: [{ id: 'deleted' }] } } };
  const scope = {
    pdfId: 'local', pdfFile: cloud ? { id: 'cloud-document' } : {}, tabId: 'inactive-tab', documentLocked: locked,
    hasUnsavedAnnotations: dirty, annotationsByPageRef: { current: snapshot },
    getQuitSaveBlockReason: options => { state.gates.push(options); return reason; }, getQuitSaveRevision: () => state.revision,
    quitSaveHandlerRef: { current: { getRevision: () => cloud && !locked && !state.proofCurrent ? null : state.revision } },
    quitAnnotationReceiptRef: { current: null },
    ensureAnnotationLocalDurability: async () => { state.receiptCalls++; return ensure(); },
    isAnnotationLocalReceiptCurrent: receipt => state.proofCurrent && receipt?.locallyDurable === true,
    cloudSyncForceFlush: () => { throw new Error('native local receipt must not wait for the backend'); },
    saveAnnotationsByPage: async (...args) => { state.writes.push(args); return save(...args); },
    savedAnnotationsByPageRef: savedRef, setHasUnsavedAnnotations: value => { state.dirty = value; },
    onUnsavedAnnotationsChange: (...args) => state.notifications.push(args), showToast() {},
  };
  const quit = new Function(...Object.keys(scope), `return (${quitSource});`)(...Object.values(scope));
  return { quit, state, savedRef, snapshot };
}

test('native local save awaits acknowledgment and persists last-object deletion without a cloud dependency', async () => {
  let finish;
  const q = quitHarness({ save: () => new Promise(resolve => { finish = resolve; }) });
  let done = false;
  const result = q.quit().then(value => { done = true; return value; });
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(q.state.dirty, true);
  finish(true);
  assert.deepEqual(await result, { saved: true, revision: 'initial' });
  assert.equal(q.savedRef.current, q.snapshot);
  assert.deepEqual(q.state.writes, [['local', {}]]);
  assert.deepEqual(q.state.notifications, [[false, 'inactive-tab']]);
});

test('quit sends failure if the save throws, and true only for a confirmed save', async () => {
  const failed = quitHarness({ save: async () => { throw new Error('storage blocked'); } });
  assert.deepEqual(await failed.quit(), { saved: false });
  const saved = quitHarness({ save: async () => true });
  assert.deepEqual(await saved.quit(), { saved: true, revision: 'initial' });
  const unknown = quitHarness({ save: async () => undefined });
  assert.deepEqual(await unknown.quit(), { saved: false });
});

test('locked viewers issue zero writes, and only clean locked state can confirm', async () => {
  for (const dirty of [true, false]) {
    const q = quitHarness({ dirty, locked: true, cloud: true });
    assert.equal((await q.quit()).saved, !dirty);
    assert.equal(q.state.writes.length, 0);
    assert.equal(q.state.receiptCalls, 0, 'a locked cloud tab cannot write through receipt capture');
  }
});

test('native cloud close waits for a local receipt, without asking for backend completion', async () => {
  let finish;
  const q = quitHarness({ cloud: true, ensure: () => new Promise(resolve => { finish = resolve; }) });
  let done = false;
  const pending = q.quit().then(result => { done = true; return result; });
  await Promise.resolve();
  assert.equal(q.state.receiptCalls, 1);
  assert.equal(q.state.writes.length, 0);
  assert.equal(done, false);
  assert.deepEqual(q.state.gates[0], { requireLocalReceipt: false }, 'prepare may obtain its first proof');
  finish({ locallyDurable: true });
  assert.deepEqual(await pending, { saved: true, revision: 'initial' });
  assert.equal(q.state.writes.length, 1);
});

test('failed, missing, or stale local proof vetoes cloud quit before the legacy snapshot write', async () => {
  for (const options of [
    { ensure: async () => { throw new Error('offline local store failed'); } },
    { ensure: async () => undefined },
    { proofCurrent: false },
  ]) {
    const q = quitHarness({ cloud: true, ...options });
    assert.equal((await q.quit()).saved, false);
    assert.equal(q.state.writes.length, 0);
    assert.equal(q.state.dirty, true);
  }
});

test('a latest viewer edit during local receipt capture cannot acknowledge or clear dirty', async () => {
  let finish;
  const q = quitHarness({ cloud: true, ensure: () => new Promise(resolve => { finish = resolve; }) });
  const pending = q.quit();
  q.state.revision = 'newer-viewer-edit';
  finish({ locallyDurable: true });
  assert.equal((await pending).saved, false);
  assert.equal(q.state.writes.length, 0, 'changed viewer state cannot overwrite a local snapshot');
  assert.equal(q.state.dirty, true);
  assert.equal(q.state.notifications.length, 0);
});

test('receipt invalidation during the legacy write cannot acknowledge quit', async () => {
  let finish;
  const q = quitHarness({ cloud: true, save: () => new Promise(resolve => { finish = resolve; }) });
  const pending = q.quit();
  while (!finish) await Promise.resolve();
  q.state.proofCurrent = false;
  finish(true);
  assert.equal((await pending).saved, false);
  assert.equal(q.state.dirty, true);
  assert.equal(q.state.notifications.length, 0);
});

test('an edit or actor change during the async write cannot clear newer dirty state', async () => {
  let finish;
  const q = quitHarness({ save: () => new Promise(resolve => { finish = resolve; }) });
  const pending = q.quit();
  q.state.revision = 'newer';
  finish(true);
  assert.deepEqual(await pending, { saved: false });
  assert.equal(q.state.dirty, true);
  assert.equal(q.state.notifications.length, 0);
});

test('an unfinished edit or unverified backup vetoes before writing', async () => {
  const q = quitHarness({ reason: 'Finish editing' });
  assert.deepEqual(await q.quit(), { saved: false, reason: 'Finish editing' });
  assert.equal(q.state.writes.length, 0);
});

test('mounted Save keeps a quota failure visible and clears dirty only after a successful retry', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test', storageQuota: 512 });
  const original = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  localStorage.setItem('annotationsByPage_other-local-doc', '{"offline":"only copy"}');
  let setPages;
  function SaveProbe() {
    const [dirty, setDirty] = useState(true);
    const [toast, setToast] = useState('');
    const [pages, updatePages] = useState({ 1: { objects: [{ id: 'large', text: 'x'.repeat(1024) }] } });
    const savedRef = useRef({});
    setPages = updatePages;
    const { save } = saveCallbackHarness({ overrides: {
      annotationsByPage: pages,
      saveAnnotationsByPage,
      savedAnnotationsByPageRef: savedRef,
      setHasUnsavedAnnotations: setDirty,
      showToast: (message) => setToast(message),
    } });
    return React.createElement('div', null,
      React.createElement('button', { onClick: () => save() }, 'Save'),
      React.createElement('output', { 'data-testid': 'dirty' }, String(dirty)),
      React.createElement('div', { role: 'alert' }, toast));
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await act(async () => root.render(React.createElement(SaveProbe)));
  await act(async () => document.querySelector('button').click());
  assert.equal(document.querySelector('output').textContent, 'true');
  assert.match(document.querySelector('[role="alert"]').textContent, /Could not save a local copy/);
  assert.equal(localStorage.getItem('annotationsByPage_current'), null);
  assert.equal(localStorage.getItem('annotationsByPage_other-local-doc'), '{"offline":"only copy"}');
  await act(async () => setPages({ 1: { objects: [{ id: 'small' }] } }));
  await act(async () => document.querySelector('button').click());
  assert.equal(document.querySelector('output').textContent, 'false');
  assert.deepEqual(JSON.parse(localStorage.getItem('annotationsByPage_current')), { 1: { objects: [{ id: 'small' }] } });
  assert.equal(localStorage.getItem('annotationsByPage_other-local-doc'), '{"offline":"only copy"}');
});
