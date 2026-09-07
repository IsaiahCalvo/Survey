import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act, useRef, useState } from 'react';
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
const quitStart = viewerSource.indexOf('const handleBeforeQuit = async (');
const quitEnd = viewerSource.indexOf('\n\n    const removeListener', quitStart);
assert.ok(quitStart >= 0 && quitEnd > quitStart, 'test the real viewer quit handler');
const quitSource = viewerSource.slice(quitStart + 'const handleBeforeQuit = '.length, quitEnd).replace(/;\s*$/, '');

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
  const scope = {
    pdfId: 'current', pdfFile: { id: 'cloud-doc' }, tabId: 'tab-current',
    annotationsByPage: next, callouts: [], surveyMarkers: {}, spaces: [], selectedTemplate: null,
    user: { id: 'owner' }, features: { cloudSync: cloud },
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

function quitHarness({ dirty = true, save } = {}) {
  const results = [];
  const window = { electronAPI: { notifySaveComplete: (result) => results.push(result) } };
  const quit = new Function('window', 'hasUnsavedAnnotations', 'handleSaveDocument', 'console',
    `return (${quitSource});`)(window, dirty, save, { error() {} });
  return { quit, results };
}

test('quit reports a failed local save before a pending cloud flush finishes', async () => {
  let finishFlush;
  const flush = new Promise((resolve) => { finishFlush = resolve; });
  const h = saveCallbackHarness({ localSaved: false, cloud: true, overrides: {
    cloudSyncForceFlush: () => flush,
  } });
  const q = quitHarness({ save: h.save });
  const pendingQuit = q.quit({ quitAttemptId: 17 });
  assert.deepEqual(q.results, [{ saved: false, quitAttemptId: 17 }], 'veto quit before waiting for the network');
  finishFlush();
  await pendingQuit;
  assert.ok(q.results.every((result) => result.saved === false && result.quitAttemptId === 17));
});

test('quit sends failure if the save throws, and true only for a confirmed save', async () => {
  const failed = quitHarness({ save: async () => { throw new Error('storage blocked'); } });
  await failed.quit({ quitAttemptId: 18 });
  assert.deepEqual(failed.results, [{ saved: false, quitAttemptId: 18 }]);
  const saved = quitHarness({ save: async () => true });
  await saved.quit({ quitAttemptId: 19 });
  assert.deepEqual(saved.results, [{ saved: true, quitAttemptId: 19 }]);
  const unknown = quitHarness({ save: async () => undefined });
  await unknown.quit({ quitAttemptId: 20 });
  assert.deepEqual(unknown.results, [{ saved: false, quitAttemptId: 20 }]);
});

test('clean viewers acknowledge quit without issuing another save', async () => {
  const q = quitHarness({ dirty: false, save: () => { throw new Error('must not run'); } });
  await q.quit({ quitAttemptId: 21 });
  assert.deepEqual(q.results, [{ saved: true, quitAttemptId: 21 }]);
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
