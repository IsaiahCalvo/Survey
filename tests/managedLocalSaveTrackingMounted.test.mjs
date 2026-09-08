import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { buildLocalDocumentState } from '../src/services/localDocumentState.js';
import { useManagedLocalSaveTracking, useManagedLocalAutoSave } from '../src/hooks/useManagedLocalSaveTracking.js';
import { useManagedLocalDraftTracking } from '../src/hooks/useManagedLocalDraftTracking.js';
import { createLocalDocumentDraftStore } from '../src/services/localDocumentDraftStore.js';

const localId = 'local:00000000-0000-4000-8000-000000000001';
const fileFor = () => ({ localId, _surveyPdfId: localId, storageMode: 'local' });
const snapshot = fields => buildLocalDocumentState({ pdfId: localId, ...fields });

async function mount(t, Component) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const restore = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); restore.reverse().forEach(fn => fn()); });
  await act(async () => root.render(React.createElement(Component)));
}

test('cold-open waits for PDF import before its first baseline but never rebases later edits', async t => {
  const rect = { type: 'rect', pdfAnnotationId: '44R' };
  const path = { type: 'path', pdfAnnotationId: '46R' };
  const form = { type: 'form-field', data: { id: 'form-field:1:31R', value: 'Saved field' } };
  const canonical = snapshot({ annotationsByPage: { 1: { objects: [rect, path, form] } } });
  const file = { ...fileFor(), _localDocumentState: canonical };
  let api, update;
  function Harness() {
    const [view, setView] = useState({ hydrated: false, objects: [rect, path, form] }); update = setView;
    api = useManagedLocalSaveTracking({ file, pdfId: localId, hydrated: view.hydrated,
      snapshot: snapshot({ annotationsByPage: { 1: { objects: view.objects } } }) });
    return null;
  }
  await mount(t, Harness);
  assert.equal(api.ready, false, 'PDF import still owns the initial non-interactive load');
  await act(async () => update({ hydrated: false, objects: [form, rect, path] }));
  assert.equal(api.ready, false);
  await act(async () => update({ hydrated: true, objects: [form, rect, path] }));
  assert.equal(api.ready, true);
  assert.equal(api.dirty, false, 'native import ordering is part of the initial loaded state');
  const edited = { ...form, data: { ...form.data, value: 'New user edit' } };
  await act(async () => update({ hydrated: true, objects: [edited, rect, path] }));
  assert.equal(api.dirty, true);
  await act(async () => update({ hydrated: false, objects: [edited, rect, path] }));
  await act(async () => update({ hydrated: true, objects: [edited, rect, path] }));
  assert.equal(api.dirty, true, 'later loading transitions cannot hide unsaved edits');
});

test('full local tracking starts clean after sidebar hydration and tracks metadata plus last deletions', async t => {
  const file = fileFor();
  let api, edit;
  function Harness() {
    const [fields, setFields] = useState({});
    useEffect(() => setFields({ bookmarks: [{ id: 'loaded' }] }), []);
    edit = setFields;
    api = useManagedLocalSaveTracking({ file, pdfId: localId, snapshot: snapshot(fields) });
    return null;
  }
  await mount(t, Harness);
  assert.equal(api.ready, true);
  assert.equal(api.dirty, false, 'loaded sidebar metadata is not a new edit');
  for (const [key, value] of Object.entries({
    annotationsByPage: { 1: { objects: [{ id: 'new' }] } }, items: { item: {} }, annotations: { legacy: {} },
    surveyMarkers: { 1: [{ id: 'marker' }] }, callouts: [{ id: 'callout', text: 'New' }],
    pageNames: { 1: 'Updated' }, bookmarks: [],
    spaces: [{ id: 'space' }], activeSpaceId: 'space', pageTransformations: { 1: { rotation: 90 } },
    regionOverlayDisabled: new Map([['region', true]]),
    deletedPdfAnnotations: [{ pageNumber: 1, pdfAnnotationId: '44R' }],
  })) {
    await act(async () => edit({ bookmarks: [{ id: 'loaded' }], [key]: value }));
    assert.equal(api.dirty, true, `${key} changes count as unsaved`);
    await act(async () => edit({ bookmarks: [{ id: 'loaded' }] }));
    assert.equal(api.dirty, false, 'undo to saved full state clears dirty');
  }
});

test('mounted deletion-only edit becomes dirty and durable recovery records undo without changing PDF bytes', async t => {
  const file = Object.assign(new File(['%PDF-1.7\noriginal native annotation bytes'], 'native.pdf'), fileFor(), { localRevision: 1 });
  const store = createLocalDocumentDraftStore({ indexedDB: new IDBFactory() });
  const captures = [];
  let writers = 0, tracking, recovery, edit;
  const createWriter = ownedFile => {
    writers++;
    const writer = store.createWriter(ownedFile);
    return { capture: state => { captures.push(state); return writer.capture(state); }, seal: () => writer.seal() };
  };
  function Harness() {
    const [deletedPdfAnnotations, setDeleted] = useState([]); edit = setDeleted;
    const current = snapshot({ annotationsByPage: {}, deletedPdfAnnotations });
    tracking = useManagedLocalSaveTracking({ file, pdfId: localId, snapshot: current });
    recovery = useManagedLocalDraftTracking({ file, snapshot: current, ready: tracking.ready, dirty: tracking.dirty, createWriter });
    return null;
  }
  await mount(t, Harness);
  // mount registered its cleanup first, so it seals before this store closes.
  t.after(async () => { await new Promise(resolve => setImmediate(resolve)); store.close(); });
  assert.equal(tracking.ready, true);
  assert.equal(tracking.dirty, false);
  assert.equal(writers, 0, 'clean native hydration does not create recovery bytes');
  const deleted = [{ pageNumber: 1, pdfAnnotationId: '44R', pdfAnnotationType: 'Square',
    pdfNativeAnnotationIdentity: { rect: [1, 2, 30, 40], contents: 'native mark' } }];
  await act(async () => edit(deleted));
  assert.equal(tracking.dirty, true, 'no object-list change is needed to mark a native deletion dirty');
  await act(async () => { await recovery.flush(); });
  let [row] = await store.listDrafts();
  const firstSequence = row.sequence;
  const first = await store.readDraft(row.sessionId, { expectedSequence: row.sequence });
  assert.deepEqual(JSON.parse(first.state.entries[`pdfData_${localId}`]).deletedPdfAnnotations, deleted);
  assert.equal(await first.file.text(), await file.text());
  await act(async () => edit([]));
  assert.equal(tracking.dirty, false, 'undo returns to the saved baseline');
  await act(async () => { await recovery.flush(); });
  [row] = await store.listDrafts();
  assert.ok(row.sequence > firstSequence, 'undo supersedes the already committed deletion recovery');
  const undone = await store.readDraft(row.sessionId, { expectedSequence: row.sequence });
  assert.deepEqual(JSON.parse(undone.state.entries[`pdfData_${localId}`]).deletedPdfAnnotations, []);
  assert.equal(await undone.file.text(), await file.text());
  assert.equal(writers, 1);
  assert.equal(captures.length, 2);
  assert.equal(captures[0].entries[`annotationsByPage_${localId}`], captures[1].entries[`annotationsByPage_${localId}`]);
  assert.equal(file._localDocumentState, undefined, 'recovery never pretends to be canonical Save');
});

test('a late snapshot acknowledgement keeps newer metadata dirty and rejects retired files', async t => {
  let file = fileFor(), api, edit;
  function Harness() {
    const [fields, setFields] = useState({}); edit = setFields;
    api = useManagedLocalSaveTracking({ file, pdfId: localId, snapshot: snapshot(fields) });
    return null;
  }
  await mount(t, Harness);
  const saved = snapshot({ pageNames: { 1: 'First' } });
  await act(async () => edit({ pageNames: { 1: 'Newer' } }));
  let acknowledged;
  await act(async () => { acknowledged = api.markSaved(file, saved, snapshot({ pageNames: { 1: 'Newer' } })); });
  assert.equal(acknowledged, false);
  assert.equal(api.dirty, true);
  await act(async () => edit({ pageNames: { 1: 'First' } }));
  assert.equal(api.dirty, false, 'committed older snapshot remains the undo baseline');
  const retired = file;
  file = { ...file, _localDocumentState: saved };
  await act(async () => edit({ pageNames: { 1: 'First' } }));
  assert.equal(api.markSaved(retired, snapshot({}), snapshot({})), false);
});

test('managed local autosave keeps one deadline across edits, reads the latest callback, and skips overlapping saves', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const file = fileFor();
  let edit, release, calls = [];
  function Harness() {
    const [version, setVersion] = useState(0); edit = setVersion;
    useManagedLocalAutoSave({ file, enabled: true, save: async silent => {
      calls.push([version, silent]); await new Promise(resolve => { release = resolve; });
    } });
    return null;
  }
  await mount(t, Harness);
  for (let i = 1; i <= 5; i++) {
    await act(async () => { t.mock.timers.tick(5000); edit(i); });
  }
  await act(async () => t.mock.timers.tick(5000));
  assert.deepEqual(calls, [[5, true]], 'steady edits do not postpone the first 30-second save');
  await act(async () => t.mock.timers.tick(30000));
  assert.equal(calls.length, 1, 'a slow save cannot start overlapping transactions');
  await act(async () => release());
  await act(async () => t.mock.timers.tick(30000));
  assert.equal(calls.length, 2);
  await act(async () => release());
});
