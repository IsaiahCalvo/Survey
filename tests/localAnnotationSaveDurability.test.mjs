import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { saveAnnotationsByPage } from '../src/viewerShared.js';
import { buildLocalDocumentState, isManagedLocalDocument } from '../src/services/localDocumentState.js';
import { useManagedLocalSaveTracking } from '../src/hooks/useManagedLocalSaveTracking.js';

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
const quitGateStart = viewerSource.indexOf('const getQuitSaveBlockReason = ');
const quitGateEnd = viewerSource.indexOf('  const saveLocalBeforeQuit = ', quitGateStart);
assert.ok(quitGateStart > 0 && quitGateEnd > quitGateStart);
const quitGateSource = viewerSource.slice(quitGateStart + 'const getQuitSaveBlockReason = '.length, quitGateEnd).replace(/;\s*$/, '');

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
      pdfFile: {}, isManagedLocalDocument,
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
    surveyDefinition: { mode: 'legacy', busy: false, definition: null },
    checkedLegacySidecarRetired: false,
    document: { body: { getAttribute: () => null } },
    summarizeAnnotationCountsForSaveExport: () => ({ byType: {} }),
    saveAnnotationsByPage: () => localSaved,
    isManagedLocalDocument,
    managedLocalDraftTracking: { flush: async () => null },
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

test('a proved archived sidecar stops mutable cloud writes while an unmarked checked document keeps them', async () => {
  const unmarked = saveCallbackHarness({ localSaved: true, cloud: true });
  assert.equal(await unmarked.save(), true);
  assert.equal(unmarked.state.cloudWrites, 1, 'null migration marker preserves the legacy write');

  const archived = saveCallbackHarness({ localSaved: true, cloud: true,
    overrides: { checkedLegacySidecarRetired: true } });
  assert.equal(await archived.save(), true);
  assert.equal(archived.state.cloudWrites, 0, 'proved generation archive owns recovery bytes');
  assert.equal(archived.state.flushes, 1, 'canonical annotation flush remains enabled');
});

function managedLocalHelpers(file, write) {
  const stateRef = { current: { pageNames: { 1: 'First' } } };
  const start = viewerSource.indexOf('const captureManagedLocalSnapshot = ');
  const end = viewerSource.indexOf('  const handleSaveDocument = ', start);
  assert.ok(start > 0 && end > start, 'use the real full-state capture and persistence helpers');
  const scope = { managedLocalStateRef: stateRef, buildLocalDocumentState,
    entityCatalog: { mode: 'legacy', busy: false, catalog: null },
    pendingManagedEntityCatalog: null, pendingManagedEntityCatalogRef: { current: null },
    managedEntityCatalogReadyRef: { current: { file, ready: true } },
    surveyDefinition: { mode: 'legacy', busy: false, definition: null },
    pendingManagedSurveyDefinition: null, pendingManagedSurveyDefinitionRef: { current: null },
    managedSurveyDefinitionReadyRef: { current: { file, ready: true } },
    managedLocalWritesRef: { current: new WeakMap() },
    managedLocalPageMutationRef: { current: false },
    saveDocumentScopeRef: { current: { pdfFile: file, pdfId: file.localId, actorUserId: 'owner', managedLocalReady: true } },
    surveyMarkersRef: { current: {} }, spacesRef: { current: [] },
    annotationsByPageRef: { current: {} }, persistEntityCatalogRef: { current: null },
    persistSurveyDefinitionRef: { current: null },
    saveManagedLocalState: write };
  const helpers = new Function(...Object.keys(scope), `${viewerSource.slice(start, end)}
    return { captureManagedLocalSnapshot, persistManagedLocalSnapshot };`)(...Object.values(scope));
  return { ...helpers, stateRef, saveDocumentScopeRef: scope.saveDocumentScopeRef,
    managedLocalPageMutationRef: scope.managedLocalPageMutationRef };
}

test('real local persistence shares identical overlapping saves and queues changed full snapshots with fresh owned revision', async () => {
  const localId = 'local:00000000-0000-4000-8000-000000000001';
  const file = { localId, localRevision: 1 };
  const writes = [], releases = [];
  const helpers = managedLocalHelpers(file, async (_id, state, { expectedRevision }) => {
    writes.push({ state, expectedRevision });
    await new Promise(resolve => releases.push(resolve));
    return { revision: expectedRevision + 1 };
  });
  const first = helpers.persistManagedLocalSnapshot(file, {});
  const duplicate = helpers.persistManagedLocalSnapshot(file, {});
  assert.equal(first, duplicate, 'one actual transaction for two equivalent Save routes');
  helpers.stateRef.current = { pageNames: { 1: 'Newer' } };
  const changed = helpers.persistManagedLocalSnapshot(file, {});
  assert.equal(writes.length, 1);
  releases.shift()(); await first;
  await Promise.resolve(); await Promise.resolve();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].expectedRevision, 2);
  assert.equal(JSON.parse(writes[1].state.entries[`pdfSidebar_${localId}`]).pageNames[1], 'Newer');
  releases.shift()(); await changed;
  assert.equal(file.localRevision, 3);
});

test('queued local persistence rejects retired file scope before a second transaction', async () => {
  const localId = 'local:00000000-0000-4000-8000-000000000001';
  const file = { localId, localRevision: 1 };
  let release, count = 0;
  const helpers = managedLocalHelpers(file, async () => {
    count++; await new Promise(resolve => { release = resolve; }); return { revision: 2 };
  });
  const first = helpers.persistManagedLocalSnapshot(file, {});
  helpers.stateRef.current = { pageNames: { 1: 'Newer' } };
  const queued = helpers.persistManagedLocalSnapshot(file, {});
  const rejection = assert.rejects(queued, /document changed before saving/);
  helpers.saveDocumentScopeRef.current = { ...helpers.saveDocumentScopeRef.current, pdfFile: { ...file } };
  release(); await first; await rejection;
  assert.equal(count, 1);
});

test('an external CAS conflict never advances local revision or turns a queued retry into a successful overwrite', async () => {
  const localId = 'local:00000000-0000-4000-8000-000000000001';
  const file = { localId, localRevision: 1 };
  const expected = [];
  const helpers = managedLocalHelpers(file, async (_id, _state, options) => {
    expected.push(options.expectedRevision); throw new Error('revision-conflict');
  });
  const first = helpers.persistManagedLocalSnapshot(file, {});
  const firstRejection = assert.rejects(first, /revision-conflict/);
  helpers.stateRef.current = { pageNames: { 1: 'Newer' } };
  const queued = helpers.persistManagedLocalSnapshot(file, {});
  await Promise.all([firstRejection, assert.rejects(queued, /revision-conflict/)]);
  assert.deepEqual(expected, [1, 1]);
  assert.equal(file.localRevision, 1);
  assert.equal(file._localDocumentState, undefined);
});

test('a queued local save waits for a page action to finish before it can be retried', async () => {
  const localId = 'local:00000000-0000-4000-8000-000000000001';
  const file = { localId, localRevision: 1 };
  let release, count = 0;
  const helpers = managedLocalHelpers(file, async () => {
    count++; await new Promise(resolve => { release = resolve; }); return { revision: 2 };
  });
  const first = helpers.persistManagedLocalSnapshot(file, {});
  helpers.stateRef.current = { pageNames: { 1: 'Newer' } };
  const queued = helpers.persistManagedLocalSnapshot(file, {});
  const rejected = assert.rejects(queued, /page action is still saving/);
  helpers.managedLocalPageMutationRef.current = true;
  release(); await first; await rejected;
  assert.equal(count, 1);
});

test('queued local persistence cannot start after PDF hydration becomes incomplete', async () => {
  const localId = 'local:00000000-0000-4000-8000-000000000001';
  const file = { localId, localRevision: 1 };
  let release, count = 0;
  const helpers = managedLocalHelpers(file, async () => {
    count++;
    if (count === 1) await new Promise(resolve => { release = resolve; });
    return { revision: 2 };
  });
  const first = helpers.persistManagedLocalSnapshot(file, {});
  helpers.stateRef.current = { pageNames: { 1: 'Newer' } };
  const queued = helpers.persistManagedLocalSnapshot(file, {});
  const rejection = assert.rejects(queued, /still loading/);
  helpers.saveDocumentScopeRef.current.managedLocalReady = false;
  release(); await first; await rejection;
  assert.equal(count, 1);
});

test('mounted managed Save stays clean when a focused form flush commits React state after capture', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const originals = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const localId = 'local:00000000-0000-4000-8000-000000000001';
  const file = { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 };
  const helpers = managedLocalHelpers(file, async () => ({ revision: 2 }));
  helpers.stateRef.current = {};
  const latest = { 1: { objects: [{ type: 'form-field', data: { value: 'just typed' } }] } };
  let api, h;
  function Harness() {
    const [pages, setPages] = useState({});
    const pagesRef = useRef(pages); pagesRef.current = pages;
    api = useManagedLocalSaveTracking({ file, pdfId: localId,
      snapshot: buildLocalDocumentState({ pdfId: localId, annotationsByPage: pages }) });
    h = saveCallbackHarness({ overrides: { ...helpers, pdfId: localId, pdfFile: file,
      annotationsByPageRef: pagesRef, managedLocalSaveTracking: api, managedLocalPageMutationRef: { current: false },
      flushPendingFormFieldsRef: { current: () => { pagesRef.current = latest; setPages(latest); } },
    } });
    return null;
  }
  await act(async () => root.render(React.createElement(Harness)));
  let saved;
  await act(async () => { saved = await h.save(); });
  assert.equal(saved, true);
  assert.equal(api.dirty, false, 'the next React render matches the exact committed full-state snapshot');
  assert.deepEqual(JSON.parse(file._localDocumentState.entries[`annotationsByPage_${localId}`]), latest);
});

for (const pendingRecovery of [false, true]) {
  test(`canonical Save succeeds while supplemental recovery ${pendingRecovery ? 'stays pending' : 'fails'}`, async () => {
    const localId = 'local:00000000-0000-4000-8000-000000000001';
    const file = { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 };
    let retries = 0;
    const helpers = managedLocalHelpers(file, async () => ({ revision: 2 }));
    const h = saveCallbackHarness({ overrides: {
      pdfId: localId, pdfFile: file, ...helpers,
      managedLocalPageMutationRef: { current: false },
      managedLocalSaveTracking: { ready: true, markSaved: () => true },
      managedLocalDraftTracking: { flush: () => {
        retries++;
        return pendingRecovery ? new Promise(() => {}) : Promise.reject(new Error('Recovery quota'));
      } },
    } });
    assert.equal(await h.save(true), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(retries, 1);
    assert.equal(file.localRevision, 2);
    assert.equal(h.state.dirty, false);
    assert.equal(h.state.cloudWrites, 0);
  });
}

for (const failed of [false, true]) {
  test(`managed Save ${failed ? 'keeps failed metadata dirty and visible' : 'does not clear metadata edited while the real write waits'}`, async () => {
    const localId = 'local:00000000-0000-4000-8000-000000000001';
    const file = { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 };
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let written;
    const helpers = managedLocalHelpers(file, async (_id, state) => {
      written = state; await gate;
      if (failed) throw new Error('Device quota exceeded');
      return { revision: 2 };
    });
    const acknowledgements = [];
    const h = saveCallbackHarness({ overrides: { pdfId: localId, pdfFile: file,
      ...helpers, managedLocalPageMutationRef: { current: false },
      managedLocalSaveTracking: { ready: true, markSaved: (_file, saved, current) => {
        acknowledgements.push([saved, current]); return JSON.stringify(saved) === JSON.stringify(current);
      } },
    } });
    const save = h.save(true);
    assert.ok(written, 'the real helper has captured the full metadata before waiting');
    helpers.stateRef.current = { pageNames: { 1: 'Newer edit' } };
    release();
    assert.equal(await save, false);
    assert.equal(h.state.dirty, true);
    assert.ok(h.state.notifications.every(([dirty]) => dirty));
    assert.equal(h.state.toasts.length, 1, 'auto-save cannot hide a failed or stale save');
    if (!failed) {
      assert.equal(file.localRevision, 2);
      assert.equal(JSON.parse(acknowledgements[0][0].entries[`pdfSidebar_${localId}`]).pageNames[1], 'First');
      assert.equal(JSON.parse(acknowledgements[0][1].entries[`pdfSidebar_${localId}`]).pageNames[1], 'Newer edit');
    } else {
      assert.equal(file.localRevision, 1);
      assert.equal(acknowledgements.length, 0);
    }
  });
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
  reason = null, ensure = async () => ({ locallyDurable: true }), proofCurrent = true, overrides = {} } = {}) {
  const state = { dirty, revision: 'initial', writes: [], notifications: [], receiptCalls: 0, gates: [], proofCurrent };
  const snapshot = {};
  const savedRef = { current: { 1: { objects: [{ id: 'deleted' }] } } };
  const scope = {
    pdfId: 'local', pdfFile: cloud ? { id: 'cloud-document' } : {}, tabId: 'inactive-tab', documentLocked: locked,
    isManagedLocalDocument,
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
    ...overrides,
  };
  const quit = new Function(...Object.keys(scope), `return (${quitSource});`)(...Object.values(scope));
  return { quit, state, savedRef, snapshot };
}

test('the real native quit preflight vetoes a managed PDF still importing before any snapshot write', async () => {
  const localId = 'local:00000000-0000-4000-8000-000000000001';
  const file = { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 };
  const scope = { pdfFile: file, isManagedLocalDocument,
    managedLocalPageMutationRef: { current: false }, managedLocalSaveTracking: { ready: false } };
  const getQuitSaveBlockReason = new Function(...Object.keys(scope), `return (${quitGateSource});`)(...Object.values(scope));
  let writes = 0;
  const q = quitHarness({ overrides: { pdfId: localId, pdfFile: file, getQuitSaveBlockReason,
    persistManagedLocalSnapshot: async () => { writes++; return true; },
  } });
  const result = await q.quit();
  assert.equal(result.saved, false);
  assert.match(result.reason, /still loading/);
  assert.equal(writes, 0);
  assert.equal(file.localRevision, 1);
  assert.deepEqual(q.state.notifications, []);
});

test('native managed save vetoes a metadata edit during persistence even when the older quit revision misses it', async () => {
  const localId = 'local:00000000-0000-4000-8000-000000000001';
  const file = { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 };
  let release;
  const helpers = managedLocalHelpers(file, async () => {
    await new Promise(resolve => { release = resolve; }); return { revision: 2 };
  });
  const acknowledgements = [];
  const q = quitHarness({ overrides: { ...helpers, pdfId: localId, pdfFile: file,
    managedLocalSaveTracking: { markSaved: (_file, saved, current) => {
      acknowledgements.push([saved, current]); return JSON.stringify(saved) === JSON.stringify(current);
    } },
  } });
  const pending = q.quit();
  helpers.stateRef.current = { callouts: [{ id: 'new-callout', text: 'Newer' }] };
  release();
  assert.deepEqual(await pending, { saved: false });
  assert.equal(q.state.revision, 'initial', 'the full-state check is independent of the older quit fingerprint');
  assert.equal(q.state.dirty, true);
  assert.deepEqual(q.state.notifications, []);
  assert.equal(acknowledgements.length, 1);
});

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
