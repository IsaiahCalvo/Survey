import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';
import { docToByPage, syncByPageToDoc } from '../src/services/annotationDocStore.js';
import {
  initializeSurveyCrdtV2,
  materializeSurveyCrdtV2,
  updateSurveyMarkersV2,
  updateSurveySpacesV2,
} from '../src/services/documentSurveyCrdtV2.js';

const require = createRequire(import.meta.url);
const hookUrl = new URL('../src/hooks/useAnnotationDoc.js', import.meta.url);
const actorA = '72000000-0000-4000-8000-000000000001';
const actorB = '72000000-0000-4000-8000-000000000002';
const docA = '72000000-0000-4000-8000-000000000003';
const docB = '72000000-0000-4000-8000-000000000004';
const generationA = '72000000-0000-4000-8000-000000000005';
const generationB = '72000000-0000-4000-8000-000000000006';
const bundle = (generation = generationA) => Object.freeze({
  documentId: docA, actorUserId: actorA, pdfGenerationId: generation,
  contentModelVersion: 2,
});
let idSequence = 0;
const createId = () => `72000000-0000-4000-8000-${String(++idSequence).padStart(12, '0')}`;
const marker = (note = 'base') => ({
  annotationId: 'marker', pageNumber: 1,
  bounds: { x: 1, y: 2, width: 3, height: 4 }, note,
});
const page = id => ({ 1: { objects: [{ type: 'rect', data: { id } }] } });

async function mount(t, { docRole = 'owner' } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey-v2.test' });
  const prior = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const state = {
    props: { documentId: docA, userId: actorA, enabled: true, checkedBundle: bundle(), docRole },
    handles: [], latest: null, view: null, setView: null,
  };
  const makeHandle = args => {
    const doc = new Y.Doc();
    initializeSurveyCrdtV2(doc, { surveyMarkers: { marker: marker() }, spaces: [], createId });
    syncByPageToDoc(doc, page('seeded'));
    const handle = {
      doc, args, documentId: args.documentId, pdfGenerationId: args.pdfGenerationId,
      writerId: 'writer',
      contentModelVersion: 2, legacyMarkerWrites: 0, pageWrites: 0, surveyWrites: 0,
      eraseWrites: 0, historyWrites: 0, restoreWrites: 0,
      getByPage: () => docToByPage(doc),
      getSurveyState: () => materializeSurveyCrdtV2(doc),
      getDeletedPdfAnnotations: () => [],
      getSyncStatus: () => ({ stage: 'idle', healthy: true, queueSize: 0 }),
      onSyncStatus: callback => { handle.sync = callback; return () => {}; },
      onHistoryQuarantine: callback => { handle.quarantine = callback; return () => {}; },
      onChange: callback => { handle.change = callback; return () => {}; },
      repairStackedInkDuplicates: () => ({ changed: false }),
      applyByPage: value => {
        const result = syncByPageToDoc(doc, value);
        if (result.added + result.updated + result.removed > 0) handle.pageWrites += 1;
        return result;
      },
      applySurveyMarkers: () => { handle.legacyMarkerWrites += 1; throw new Error('legacy write'); },
      updateSurveyMarkers: updater => {
        handle.surveyWrites += 1;
        return updateSurveyMarkersV2(doc, updater, { createId });
      },
      updateSurveySpaces: updater => updateSurveySpacesV2(doc, updater, { createId }),
      setEraseEffectConsumer: () => {}, destroy: async () => {}, drain: async () => {},
      flushSnapshot: async () => true, getLocalRevision: () => 0,
      flushLocalDurability: async () => ({ locallyDurable: true, documentId: args.documentId,
        actorUserId: args.actorUserId, pdfGenerationId: args.pdfGenerationId,
        writerId: 'writer', revision: 0 }),
      isLocalReceiptCurrent: () => true, revalidateLocalReceipt: async value => value,
      getLocalCloseReceipt: () => null, getMeta: () => undefined, setMeta: () => {},
      applyEraserMutation: () => ({ objects: [] }),
      commitEraseIntent: async () => { handle.eraseWrites += 1;
        return { status: 'noop', historyQuarantineGeneration: 0 }; },
      applyEraseHistoryTransition: () => { handle.historyWrites += 1; return { status: 'noop' }; },
      restoreEraseDeletion: () => { handle.restoreWrites += 1; return { status: 'noop' }; },
      getHistoryQuarantineGeneration: () => 0,
    };
    state.handles.push(handle);
    return handle;
  };
  state.openAnnotationDoc = async args => makeHandle(args);
  const key = `__surveyV2Hook${crypto.randomUUID()}`;
  globalThis[key] = state;
  let source = await readFile(hookUrl, 'utf8');
  source = source
    .replace(/import\s+\{\s*supabase\s*\}\s+from\s+['"]\.\.\/supabaseClient\.js['"];?/,
      'const supabase = {};')
    .replace(/import\s+\{\s*openAnnotationDoc\s*,\s*getClientId\s*\}\s+from\s+['"]\.\.\/services\/annotationDocSync\.js['"];?/,
      `const openAnnotationDoc = globalThis[${JSON.stringify(key)}].openAnnotationDoc; const getClientId = () => 'test-client';`)
    .replace(/from\s+(['"])([^'"]+)\1/g, (_all, _quote, specifier) => `from ${JSON.stringify(
      specifier.startsWith('.') ? new URL(specifier, hookUrl).href
        : pathToFileURL(require.resolve(specifier)).href,
    )}`);
  const { useAnnotationDoc } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  function Probe(props) {
    const [annotationsByPage, setAnnotationsByPage] = useState({});
    const [spaces, setSpaces] = useState([]);
    const [surveyMarkers, setSurveyMarkers] = useState({});
    state.view = { annotationsByPage, spaces, surveyMarkers };
    state.setView = { setAnnotationsByPage, setSpaces, setSurveyMarkers };
    state.latest = useAnnotationDoc({ ...props, annotationsByPage, setAnnotationsByPage,
      spaces, setSpaces, surveyMarkers, setSurveyMarkers, pageSizesRef: { current: {} } });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const render = async patch => {
    state.props = { ...state.props, ...patch };
    await act(async () => root.render(React.createElement(Probe, state.props)));
  };
  let live = true;
  const unmount = async () => { if (live) { live = false; await act(async () => root.unmount()); } };
  await render();
  t.after(async () => {
    await unmount();
    state.handles.forEach(handle => handle.doc.destroy());
    dom.window.close(); delete globalThis[key];
    for (const [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  return { state, render, unmount };
}

test('model-2 hydration stays read-only, uses latest remote state, and captures ordinary pages', async t => {
  const h = await mount(t);
  const handle = h.state.handles[0];
  assert.equal(handle.legacyMarkerWrites, 0);
  assert.equal(h.state.view.surveyMarkers.marker.note, 'base');
  assert.equal(handle.getByPage()[1].objects[0].data.id, 'seeded');
  assert.equal(h.state.view.annotationsByPage[1].objects[0].data.id, 'seeded');
  assert.equal(handle.pageWrites, 0, 'pre-hydration React state cannot clear the checked baseline');

  updateSurveyMarkersV2(handle.doc, current => ({
    ...current, marker: { ...current.marker, note: 'remote' },
  }), { createId });
  await act(async () => handle.change(handle.getByPage()));
  let calls = 0;
  await act(async () => h.state.latest.updateSurveyMarkers(current => {
    calls += 1;
    assert.equal(current.marker.note, 'remote');
    return { ...current, marker: { ...current.marker, checklistResponses: { check: { selection: 'Y' } } } };
  }));
  assert.equal(calls, 1);
  assert.equal(handle.surveyWrites, 1);
  assert.equal(handle.legacyMarkerWrites, 0);

  const pageWritesBeforeEdit = handle.pageWrites;
  await act(async () => h.state.setView.setAnnotationsByPage(page('ordinary')));
  assert.ok(handle.pageWrites > pageWritesBeforeEdit);
  assert.equal(handle.getByPage()[1].objects[0].data.id, 'ordinary');
});

test('viewer, unresolved, and downgraded roles reject before evaluating a survey updater', async t => {
  const h = await mount(t, { docRole: 'viewer' });
  for (const role of ['viewer', null]) {
    await h.render({ docRole: role });
    let calls = 0;
    assert.throws(() => h.state.latest.updateSurveyMarkers(() => { calls += 1; return {}; }), {
      code: 'ANNOTATION_DOCUMENT_READ_ONLY',
    });
    assert.equal(calls, 0);
  }
  await h.render({ docRole: 'editor' });
  const retained = h.state.latest.updateSurveyMarkers;
  await h.render({ docRole: 'viewer' });
  let calls = 0;
  assert.throws(() => retained(() => { calls += 1; return {}; }), {
    code: 'ANNOTATION_DOCUMENT_READ_ONLY',
  });
  assert.equal(calls, 0);
});

test('model-2 erase rejects viewer and later role downgrade before the handle writes', async t => {
  const h = await mount(t, { docRole: 'editor' });
  const handle = h.state.handles[0];
  const retained = h.state.latest.commitEraseIntent;
  await h.render({ docRole: 'viewer' });
  assert.equal((await retained({ mutationId: 'erase-role' })).reason, 'read-only');
  assert.equal(handle.eraseWrites, 0);
});

test('document lock retires model-2 erase, history, and restore before handle writes', async t => {
  const h = await mount(t, { docRole: 'editor' });
  const handle = h.state.handles[0];
  const erase = h.state.latest.commitEraseIntent;
  const history = h.state.latest.applyEraseHistoryTransition;
  const restore = h.state.latest.restoreEraseDeletion;
  await h.render({ documentLocked: true });
  assert.equal((await erase({ mutationId: 'locked-erase' })).reason, 'document-locked');
  assert.equal(history({ version: 1, mutationId: 'locked-history' }, 'undo').reason, 'document-locked');
  assert.equal(restore([{ type: 'surveyMarker' }]).reason, 'document-locked');
  assert.deepEqual([handle.eraseWrites, handle.historyWrites, handle.restoreWrites], [0, 0, 0]);
});

for (const change of ['actor', 'document', 'bundle', 'unmount']) {
  test(`${change} retirement rejects a retained model-2 updater before evaluation`, async t => {
    const h = await mount(t);
    const retained = h.state.latest.updateSurveyMarkers;
    if (change === 'actor') await h.render({ userId: actorB });
    if (change === 'document') await h.render({ documentId: docB });
    if (change === 'bundle') await h.render({ checkedBundle: bundle(generationB) });
    if (change === 'unmount') await h.unmount();
    let calls = 0;
    assert.throws(() => retained(() => { calls += 1; return {}; }), {
      code: 'ANNOTATION_LOCAL_NOT_READY',
    });
    assert.equal(calls, 0);
  });
}

test('client replacement retires callbacks and local receipts before the new open', async t => {
  const h = await mount(t);
  const clientA = { id: 'client-a' };
  const clientB = { id: 'client-b' };
  await h.render({ annotationDocClient: clientA });
  const retained = h.state.latest.updateSurveyMarkers;
  let receipt;
  await act(async () => {
    await Promise.resolve();
    receipt = await h.state.latest.ensureLocalDurability();
  });
  assert.equal(h.state.handles.at(-1).args.supabase, clientA);
  await h.render({ annotationDocClient: clientB });
  assert.equal(h.state.handles.at(-1).args.supabase, clientB);
  let calls = 0;
  assert.throws(() => retained(() => { calls += 1; return {}; }), {
    code: 'ANNOTATION_LOCAL_NOT_READY',
  });
  assert.equal(calls, 0);
  assert.equal(h.state.latest.isLocalDurabilityCurrent(receipt), false);
});
