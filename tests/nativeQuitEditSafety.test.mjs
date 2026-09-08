import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useNativeQuitSave } from '../src/hooks/useNativeQuitSave.js';
import { verifyLegacyQuitBackups } from '../src/services/legacyQuitBackups.js';
import { trackPendingEraseCommit, deferUntilEraseCommitsFinish } from '../src/utils/pendingEraseCommits.js';

test('mounted native hook commits focused field blur before reading the snapshot and cancels inert state', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const replies = [];
  let receive;
  window.electronAPI = { onBeforeQuit: callback => { receive = callback; return () => {}; }, notifySaveComplete: value => replies.push(value) };
  const file = {};
  let saved;
  function Probe() {
    const [value, setValue] = useState('old');
    const { register } = useNativeQuitSave([{ id: 'tab', file }]);
    useEffect(() => register('tab', { saveLocal: async () => { saved = value; return { saved: true, revision: value }; }, getRevision: () => value }), [register, value]);
    return React.createElement('input', { defaultValue: 'old', onBlur: event => setValue(event.target.value) });
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  await act(async () => root.render(React.createElement(Probe)));
  const input = document.querySelector('input');
  // React was imported before JSDOM and selects its legacy input polyfill.
  input.attachEvent = () => {}; input.detachEvent = () => {};
  input.focus(); input.value = 'just typed';
  await act(async () => receive({ quitAttemptId: 1, generation: 1, phase: 'prepare' }));
  assert.equal(saved, 'just typed');
  assert.equal(replies.at(-1).saved, true);
  assert.equal(document.documentElement.inert, true);
  await act(async () => receive({ quitAttemptId: 1, generation: 1, phase: 'cancel' }));
  assert.notEqual(document.documentElement.inert, true);
  const overlay = document.createElement('div'); overlay.dataset.textEditOverlay = 'true'; document.body.append(overlay);
  await act(async () => receive({ quitAttemptId: 2, generation: 1, phase: 'prepare' }));
  assert.equal(replies.at(-1).saved, false);
  assert.match(replies.at(-1).reason, /Finish/);
  overlay.remove();
  await act(async () => receive({ quitAttemptId: 2, generation: 1, phase: 'cancel' }));
  document.dispatchEvent(new window.Event('pointerdown'));
  await act(async () => receive({ quitAttemptId: 3, generation: 1, phase: 'prepare' }));
  assert.equal(replies.at(-1).saved, false);
});

test('actual viewer readiness gate vetoes tracked erase work and unfinished tool sessions', async () => {
  const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('const getQuitSaveBlockReason = () => {');
  const end = source.indexOf('\n  const saveLocalBeforeQuit', start);
  const block = source.slice(start + 'const getQuitSaveBlockReason = '.length, end).replace(/;\s*$/, '');
  const scope = { editingAnnotation: null, richTextEditor: null, showRegionSelection: false, pendingSurveyMarker: null,
    textToolDragRef: { current: null }, counterDragRef: { current: null }, activeTool: 'pan', deferUntilEraseCommitsFinish,
    toolPreferencesSaveError: null, pdfFile: {}, documentLocked: true };
  const gate = new Function(...Object.keys(scope), `return (${block});`)(...Object.values(scope));
  assert.equal(gate(), null);
  let finish;
  const pending = trackPendingEraseCommit(new Promise(resolve => { finish = resolve; }));
  assert.match(gate(), /Finish drawing/);
  finish(); await pending; await Promise.resolve();
  assert.equal(gate(), null);
  const idlePenGate = new Function(...Object.keys(scope), `return (${block});`)(...Object.values({ ...scope, activeTool: 'pen' }));
  assert.match(idlePenGate(), /switch to Pan/, 'explicit conservative limit: finish and leave an untracked drawing tool');
});

test('legacy quit receipts verify restored formats and fail closed for missing or stale bytes', () => {
  const state = { pdfId: 'local', cloudBacked: false, items: [], annotations: [], surveyMarkers: [], callouts: [],
    pageNames: {}, bookmarks: [], spaces: [], activeSpaceId: null, pageTransformations: {} };
  const entries = new Map([
    ['pdfData_local', JSON.stringify({ items: [], annotations: [] })],
    ['pdfSidebar_local', JSON.stringify({ pageNames: {}, bookmarks: [], spaces: [], activeSpaceId: null, pageTransformations: {} })],
    ['surveyMarkers_local', '[]'], ['callouts_local', '[]'],
  ]);
  const storage = { getItem: key => entries.get(key) ?? null };
  assert.equal(verifyLegacyQuitBackups({ ...state, storage }), true);
  entries.set('surveyMarkers_local', '[{"id":"newer"}]');
  assert.equal(verifyLegacyQuitBackups({ ...state, storage }), false);
  assert.equal(verifyLegacyQuitBackups({ ...state, cloudBacked: true, storage }), true);
  entries.delete('pdfData_local');
  assert.equal(verifyLegacyQuitBackups({ ...state, storage }), false);
});
