import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';
import { syncByPageToDoc, docToByPage, setMetaValue, getMetaValue, syncSurveyMarkersToDoc, docToSurveyMarkers, repairStackedInkDuplicates } from '../src/services/annotationDocStore.js';

const require = createRequire(import.meta.url);
const hookUrl = new URL('../src/hooks/useAnnotationDoc.js', import.meta.url);
const bundle = (generation = 'generation-a') => Object.freeze({ documentId: 'document-a', actorUserId: 'actor-a', pdfGenerationId: generation });
const mark = id => ({ 1: { objects: [{ type: 'rect', left: 1, top: 2, width: 3, height: 4, data: { id } }] } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); promise.catch(() => {}); return { promise, resolve, reject }; };
async function mount(t, { checkedBundle = bundle(), initial = {}, stored = {}, deferOpen = false,
  docRole = 'owner', strictMode = false, handleStatus = null } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://annotation.test' });
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const state = { props: { documentId: 'document-a', userId: 'actor-a', enabled: true, checkedBundle, docRole }, handles: [], opens: [],
    stored, deferOpen, handleStatus, layout: null, view: null, renderViews: [], eraseEffects: [], quarantine: [], publications: [] };
  state.props.onGenerationSession = value => state.publications.push(value);
  const makeHandle = args => {
    const doc = new Y.Doc(); const seed = state.stored;
    if (seed.byPage) syncByPageToDoc(doc, seed.byPage);
    if (seed.spaces) setMetaValue(doc, 'spaces', seed.spaces);
    if (seed.markers) syncSurveyMarkersToDoc(doc, seed.markers);
    if (seed.calloutsList) setMetaValue(doc, 'calloutsList', seed.calloutsList);
    let revision = 0; const issued = new WeakSet();
    const h = { doc, args, documentId: args.documentId, pdfGenerationId: args.pdfGenerationId ?? null,
      writerId: `writer-${state.handles.length}`, captures: [], repairs: 0, destroys: 0, backend: [], erases: [],
      getByPage: () => docToByPage(doc), getMeta: key => getMetaValue(doc, key), getSurveyMarkers: () => docToSurveyMarkers(doc),
      getSurveyState: () => ({ version: 2, surveyMarkers: docToSurveyMarkers(doc),
        spaces: getMetaValue(doc, 'spaces') || [] }),
      getDeletedPdfAnnotations: () => ['deleted-old'], getLocalRevision: () => revision,
      verifyRenderedSurveyState: value => { h.verifies = (h.verifies || 0) + 1;
        return JSON.stringify(value) === JSON.stringify({ byPage: docToByPage(doc),
          spaces: getMetaValue(doc, 'spaces') || [], surveyMarkers: docToSurveyMarkers(doc) }); },
      getSyncStatus: () => h.status || ({ stage: 'idle', healthy: true, queueSize: 7 }),
      onSyncStatus: listener => { h.sync = listener; return () => {}; },
      onHistoryQuarantine: listener => { h.quarantine = listener; return () => {}; },
      onChange: listener => { h.change = listener; return () => {}; },
      repairStackedInkDuplicates: () => { h.repairs++; return repairStackedInkDuplicates(doc); },
      applyByPage: value => { h.captures.push(['pages', structuredClone(value)]); return syncByPageToDoc(doc, value); },
      setMeta: (key, value) => { h.captures.push([key, structuredClone(value)]); return setMetaValue(doc, key, value); },
      applySurveyMarkers: value => { h.captures.push(['markers', structuredClone(value)]); return syncSurveyMarkersToDoc(doc, value); },
      isLocalReceiptCurrent: value => issued.has(value) && value.revision === revision,
      revalidateLocalReceipt: async value => value,
      flushLocalDurability: async options => { h.flushOptions = options; return receipt(); },
      getLocalCloseReceipt: () => receipt(), destroy: async () => { h.destroys++; },
      drain: async () => { h.backend.push('drain'); if (h.heldDrain) await h.heldDrain.promise; },
      flushSnapshot: async () => { h.backend.push('snapshot'); if (h.flushError) throw h.flushError; return true; },
      setEraseEffectConsumer: consumer => { h.consumerCalls = (h.consumerCalls || 0) + 1;
        if (h.consumerError) throw h.consumerError;
        h.consumer = consumer; h.consumerDrains = (h.consumerDrains || 0) + 1; },
      applyEraserMutation: (...args) => { h.erases.push(args); return { objects: [] }; },
      commitEraseIntent: async () => { h.erases.push('intent'); if (h.heldErase) return h.heldErase.promise; return { status: 'noop', historyQuarantineGeneration: 0 }; },
      applyEraseHistoryTransition: () => { h.erases.push('history'); return { status: 'noop' }; },
      restoreEraseDeletion: () => { h.erases.push('restore'); return { status: 'noop' }; },
      getHistoryQuarantineGeneration: () => 0,
    };
    h.status = state.handleStatus;
    if (state.handleStatus?.errorCode === 'ANNOTATION_GENERATION_CAPACITY') h.contentModelVersion = 2;
    const receipt = () => { const value = { locallyDurable: true, documentId: args.documentId, actorUserId: args.actorUserId,
      ...(args.pdfGenerationId == null ? {} : { pdfGenerationId: args.pdfGenerationId }), writerId: h.writerId, revision }; issued.add(value); return value; };
    doc.on('update', () => { revision++; }); state.handles.push(h); return h;
  };
  state.openAnnotationDoc = args => {
    const pending = { ...deferred(), args, handle: makeHandle(args) }; state.opens.push(pending);
    if (!state.deferOpen) pending.resolve(pending.handle); return pending.promise;
  };
  const key = `__checkedAnnotation${crypto.randomUUID()}`; globalThis[key] = state;
  let source = await readFile(hookUrl, 'utf8');
  source = source.replace(/import\s+\{\s*supabase\s*\}\s+from\s+['"]\.\.\/supabaseClient\.js['"];?/, 'const supabase = {};')
    .replace(/import\s+\{\s*openAnnotationDoc\s*,\s*getClientId\s*\}\s+from\s+['"]\.\.\/services\/annotationDocSync\.js['"];?/, `const openAnnotationDoc = globalThis[${JSON.stringify(key)}].openAnnotationDoc; const getClientId = () => 'test-client';`);
  source = source.replace(/from\s+(['"])([^'"]+)\1/g, (_all, _quote, specifier) => `from ${JSON.stringify(specifier.startsWith('.') ? new URL(specifier, hookUrl).href : pathToFileURL(require.resolve(specifier)).href)}`);
  const { useAnnotationDoc } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let latest, edit;
  function Probe(props) {
    const [annotationsByPage, setAnnotationsByPage] = useState(initial.byPage || {});
    const [spaces, setSpaces] = useState(initial.spaces || []);
    const [surveyMarkers, setSurveyMarkers] = useState(initial.markers || {});
    state.view = { byPage: annotationsByPage, spaces, markers: surveyMarkers };
    latest = useAnnotationDoc({ ...props, annotationsByPage, setAnnotationsByPage, spaces, setSpaces, surveyMarkers, setSurveyMarkers,
      pageSizesRef: { current: {} }, eraseEffectConsumer: (...args) => state.eraseEffects.push(args),
      onHistoryQuarantine: event => state.quarantine.push(event) });
    state.renderViews.push({ hydration: latest.initialHydration, status: latest.status, queueSize: latest.queueSize, deleted: latest.deletedPdfAnnotations });
    edit = next => { if (next.byPage) setAnnotationsByPage(next.byPage); if (next.spaces) setSpaces(next.spaces); if (next.markers) setSurveyMarkers(next.markers); };
    useLayoutEffect(() => { const callback = state.layout; state.layout = null; callback?.(latest); });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const render = async patch => { state.props = { ...state.props, ...patch }; await act(async () => root.render(
    strictMode ? React.createElement(React.StrictMode, null, React.createElement(Probe, state.props)) : React.createElement(Probe, state.props))); };
  let unmounted = false;
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()); } };
  await render();
  t.after(async () => { await unmount(); for (const h of state.handles) h.doc.destroy(); dom.window.close(); delete globalThis[key];
    for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; } });
  return { state, render, unmount, latest: () => latest, edit: async next => act(async () => edit(next)) };
}

test('checked bundle and generation reach open; an empty checked document replaces every previous view kind', async t => {
  const checked = bundle(); const h = await mount(t, { checkedBundle: checked,
    initial: { byPage: mark('old'), spaces: [{ id: 'old-space' }], markers: { old: { id: 'old' } } } });
  assert.equal(h.state.opens[0].args.checkedBundle, checked); assert.equal(h.state.opens[0].args.pdfGenerationId, checked.pdfGenerationId);
  assert.deepEqual(h.state.view, { byPage: {}, spaces: [], markers: {} });
  assert.deepEqual(h.state.handles[0].getByPage(), {}); assert.deepEqual(h.state.handles[0].getSurveyMarkers(), {});
  assert.equal(h.state.handles[0].repairs, 1, 'repair inspects only the checked current handle');
  assert.deepEqual(h.latest().initialHydration, { ready: true, source: 'checked-generation', count: 0,
    documentId: 'document-a', pdfGenerationId: checked.pdfGenerationId, embeddedImportAllowed: false });
});

test('capacity status survives listener and failed manual flush without a stuck syncing state', async t => {
  const h = await mount(t), handle = h.state.handles[0];
  const capacity = { stage: 'error', healthy: false, queueSize: 1,
    error: 'This document reached its cloud save limit.', errorCode: 'ANNOTATION_GENERATION_CAPACITY' };
  await act(async () => handle.sync(capacity));
  assert.deepEqual(h.latest().status, capacity); assert.equal(h.latest().queueSize, 1);
  handle.status = capacity;
  handle.flushError = Object.assign(new Error(capacity.error), { code: capacity.errorCode });
  await act(async () => assert.rejects(h.latest().forceFlush(), { code: capacity.errorCode }));
  assert.deepEqual(h.latest().status, capacity); assert.equal(h.latest().queueSize, 1);
});

test('capacity-blocked checked handle still proves local durability and closes without mutation calls', async t => {
  const h = await mount(t), handle = h.state.handles[0]; let mutations = 0;
  const blocked = () => { mutations++; throw Object.assign(new Error('capacity'),
    { code: 'ANNOTATION_GENERATION_CAPACITY' }); };
  handle.applyByPage = blocked; handle.setMeta = blocked; handle.applySurveyMarkers = blocked;
  handle.status = { stage: 'error', healthy: false, queueSize: 1,
    error: 'This document reached its cloud save limit.', errorCode: 'ANNOTATION_GENERATION_CAPACITY' };
  const receipt = await h.latest().ensureLocalDurability();
  assert.equal(receipt.locallyDurable, true); assert.equal(mutations, 0); assert.ok(handle.verifies >= 1);
  await h.unmount(); assert.equal(mutations, 0); assert.equal(handle.destroys, 1); assert.ok(handle.verifies >= 2);
});

test('cold capacity hydration mounts exact recovered model2 state with zero mutation calls', async t => {
  const recovered = { byPage: mark('recovered'), spaces: [{ id: 'recovered-space' }],
    markers: { recovered: { annotationId: 'recovered', pageNumber: 1 } } };
  const capacity = { stage: 'error', healthy: false, queueSize: 2,
    error: 'This document reached its cloud save limit.', errorCode: 'ANNOTATION_GENERATION_CAPACITY' };
  const h = await mount(t, { stored: recovered, handleStatus: capacity });
  const handle = h.state.handles[0];
  assert.deepEqual(h.state.view, recovered); assert.deepEqual(handle.captures, []);
  assert.equal((await h.latest().ensureLocalDurability()).locallyDurable, true);
  assert.deepEqual(handle.captures, []); assert.deepEqual(h.latest().status, capacity);
});

test('cold capacity hydration replaces stale React projections from the current local handle without writes', async t => {
  const recovered = { byPage: mark('current'), spaces: [{ id: 'current-space' }],
    markers: { current: { annotationId: 'current', pageNumber: 1 } } };
  const stale = { byPage: mark('stale'), spaces: [{ id: 'stale-space' }],
    markers: { stale: { annotationId: 'stale', pageNumber: 1 } } };
  const capacity = { stage: 'error', healthy: false, queueSize: 2,
    error: 'This document reached its cloud save limit.', errorCode: 'ANNOTATION_GENERATION_CAPACITY' };
  const h = await mount(t, { stored: recovered, initial: stale, handleStatus: capacity });
  const handle = h.state.handles[0];
  assert.deepEqual(h.state.view, recovered); assert.deepEqual(handle.captures, []);
  assert.equal((await h.latest().ensureLocalDurability()).locallyDurable, true);
  assert.deepEqual(handle.captures, []); assert.deepEqual(h.latest().status, capacity);
});

test('cold capacity mount skips erase consumer install and drain while keeping recovered effects and status', async t => {
  const capacity = { stage: 'error', healthy: false, queueSize: 2,
    error: 'This document reached its cloud save limit.', errorCode: 'ANNOTATION_GENERATION_CAPACITY' };
  const recovered = { byPage: mark('capacity-consumer'), spaces: [], markers: {} };
  const h = await mount(t, { stored: recovered, handleStatus: capacity });
  const handle = h.state.handles[0]; handle.pendingEffects = [{ mutationId: 'kept-effect' }];
  assert.equal(handle.consumerCalls || 0, 0); assert.equal(handle.consumerDrains || 0, 0);
  assert.deepEqual(handle.pendingEffects, [{ mutationId: 'kept-effect' }]);
  assert.deepEqual(h.state.view, recovered); assert.deepEqual(h.latest().status, capacity);
  assert.equal(h.latest().queueSize, 2);
});

test('erase consumer capacity race is caught but unrelated install errors still fail', async t => {
  const h = await mount(t), handle = h.state.handles[0];
  handle.consumerCalls = 0; handle.consumerDrains = 0;
  handle.consumerError = Object.assign(new Error('capacity'), { code: 'ANNOTATION_GENERATION_CAPACITY' });
  await h.render({ docRole: 'editor' });
  assert.equal(handle.consumerCalls, 1); assert.equal(handle.consumerDrains, 0);
  assert.deepEqual(h.state.view, { byPage: {}, spaces: [], markers: {} });
  handle.consumerError = Object.assign(new Error('unexpected install failure'), { code: 'OTHER' });
  await assert.rejects(h.render({ docRole: 'owner' }), /unexpected install failure/);
});

test('partly populated checked document clears other kinds rather than seeding old React state', async t => {
  const h = await mount(t, { stored: { spaces: [{ id: 'new-space' }] }, initial: { byPage: mark('old'), markers: { old: { id: 'old' } } } });
  assert.deepEqual(h.state.view, { byPage: {}, spaces: [{ id: 'new-space' }], markers: {} });
  assert.equal(h.state.handles[0].captures.some(([, value]) => JSON.stringify(value).includes('old')), false);
});

for (const change of ['actor', 'generation', 'bundle']) test(`${change} change fences old handles and receipts in the first layout render`, async t => {
  const h = await mount(t); const old = h.latest(); const handle = h.state.handles[0]; const receipt = await old.ensureLocalDurability();
  const erases = handle.erases.length; const backend = handle.backend.length; const promises = [];
  h.state.layout = next => {
    assert.equal(next.initialHydration.ready, false); assert.equal(next.queueSize, 0); assert.deepEqual(next.deletedPdfAnnotations, []);
    assert.equal(next.isLocalDurabilityCurrent(receipt), false); assert.equal(old.isLocalDurabilityCurrent(receipt), false);
    assert.equal(old.metaSet('leak', 'old'), false); assert.equal(next.metaGet('spaces'), undefined);
    assert.equal(old.commitEraserMutation({ eraserMutation: { id: 'old' } }), null);
    assert.equal(old.applyEraseHistoryTransition({}, 'undo').status, 'conflict'); assert.equal(old.restoreEraseDeletion([]).status, 'conflict');
    promises.push(old.forceFlush()); promises.push(old.commitEraseIntent({ mutationId: 'old' }).then(result => assert.equal(result.status, 'cancelled')));
    promises.push(assert.rejects(old.ensureLocalDurability(), { code: 'ANNOTATION_LOCAL_SCOPE_CHANGED' }));
    assert.equal(handle.erases.length, erases); assert.equal(handle.backend.length, backend);
  };
  const patch = change === 'actor' ? { userId: 'actor-b' } : { checkedBundle: bundle(change === 'generation' ? 'generation-b' : 'generation-a') };
  await h.render(patch); await Promise.all(promises);
  assert.equal(h.state.opens.length, 2); assert.equal(handle.destroys, 1); assert.equal(getMetaValue(handle.doc, 'leak'), undefined);
});

test('empty successor does not inherit old page presentation, annotations, spaces or survey markers', async t => {
  const h = await mount(t, { stored: { byPage: mark('first'), spaces: [{ id: 'first' }], markers: { first: { id: 'first' } } } });
  h.state.stored = {}; await h.render({ checkedBundle: bundle('generation-b') });
  assert.deepEqual(h.state.view, { byPage: {}, spaces: [], markers: {} });
  const next = h.state.handles[1]; assert.equal(next.captures.some(([, value]) => JSON.stringify(value).includes('first')), false);
});

test('a cancelled old open is destroyed and cannot hydrate the successor', async t => {
  const h = await mount(t, { deferOpen: true, stored: { byPage: mark('old') } });
  const old = h.state.opens[0]; h.state.stored = {}; await h.render({ checkedBundle: bundle('generation-b') });
  const next = h.state.opens[1]; assert.ok(next, 'bundle replacement opens a new generation');
  await act(async () => { next.resolve(next.handle); await next.promise; });
  await act(async () => { old.resolve(old.handle); await old.promise; });
  assert.equal(old.handle.destroys, 1); assert.equal(next.handle.destroys, 0); assert.deepEqual(h.state.view.byPage, {});
});

test('in-flight old flush and erase results cannot dispatch a snapshot or update a successor', async t => {
  const h = await mount(t); const old = h.latest(); const handle = h.state.handles[0];
  handle.heldDrain = deferred(); handle.heldErase = deferred(); let flush, erase;
  await act(async () => { flush = old.forceFlush(); erase = old.commitEraseIntent({ mutationId: 'old' }); });
  await h.render({ checkedBundle: bundle('generation-b') });
  await act(async () => { handle.heldDrain.resolve(); handle.heldErase.resolve({ status: 'committed', byPage: mark('late'), historyQuarantineGeneration: 0 }); await flush; });
  assert.equal((await erase).status, 'cancelled'); assert.deepEqual(handle.backend, ['drain']); assert.deepEqual(h.state.view.byPage, {});
});

test('checked remote empty state clears missing spaces and permits current-handle repair', async t => {
  const h = await mount(t, { stored: { spaces: [{ id: 'old-space' }], markers: { old: { id: 'old' } } } });
  const handle = h.state.handles[0]; setMetaValue(handle.doc, 'spaces', undefined); syncSurveyMarkersToDoc(handle.doc, {});
  await act(async () => handle.change({}));
  assert.deepEqual(h.state.view, { byPage: {}, spaces: [], markers: {} }); assert.equal(handle.repairs, 2);
});

test('legacy open still seeds existing React views and omits checked open options', async t => {
  const h = await mount(t, { checkedBundle: null, initial: { byPage: mark('legacy'), spaces: [{ id: 'legacy' }], markers: { legacy: { id: 'legacy' } } } });
  assert.equal('checkedBundle' in h.state.opens[0].args, false); assert.equal('pdfGenerationId' in h.state.opens[0].args, false);
  assert.equal(h.state.handles[0].getByPage()[1].objects[0].data.id, 'legacy');
});

test('empty checked hydration creates no metadata seed writes', async t => {
  const h = await mount(t);
  assert.equal(h.state.handles[0].getMeta('spaces'), undefined);
  assert.equal(h.state.handles[0].getLocalRevision(), 0);
});

test('checked hydration neither migrates nor projects old calloutsList metadata', async t => {
  const calloutsList = [{ id: 'legacy-meta', pageNumber: 1, text: 'old callout' }];
  const h = await mount(t, { stored: { calloutsList } });
  assert.deepEqual(h.state.handles[0].getMeta('calloutsList'), calloutsList);
  assert.deepEqual(h.state.view.byPage, {});
});

test('local receipt from another generation is rejected even with matching actor, writer and revision', async t => {
  const h = await mount(t); const handle = h.state.handles[0]; const flush = handle.flushLocalDurability;
  handle.flushLocalDurability = async options => ({ ...await flush(options), pdfGenerationId: 'another-generation' });
  handle.isLocalReceiptCurrent = () => true;
  await assert.rejects(h.latest().ensureLocalDurability(), { code: 'ANNOTATION_LOCAL_UNVERIFIED' });
});

test('old handle observers and erase consumer are fenced before successor effects', async t => {
  const h = await mount(t); const handle = h.state.handles[0];
  h.state.layout = () => {
    handle.change(mark('late')); handle.sync({ stage: 'error', error: 'old error', queueSize: 99 }); handle.quarantine({ old: true });
    assert.throws(() => handle.consumer('late'), { code: 'ANNOTATION_LOCAL_SCOPE_CHANGED' });
    assert.throws(() => handle.args.eraseEffectConsumer('late'), { code: 'ANNOTATION_LOCAL_SCOPE_CHANGED' });
  };
  await h.render({ checkedBundle: bundle('generation-b') });
  assert.deepEqual(h.state.eraseEffects, []); assert.deepEqual(h.state.quarantine, []); assert.deepEqual(h.state.view.byPage, {});
  assert.equal(h.latest().status.error, null);
});

const duplicateInk = () => ({ 1: { objects: ['ink-a', 'ink-b'].map(id => ({
  type: 'path', path: [['M', 0, 0], ['L', 10, 10]], paperEraserGeometry: 'v1', data: { id },
})) } });

test('checked initial repair removes only current-generation duplicate ink without importing prior view', async t => {
  const h = await mount(t, { stored: { byPage: duplicateInk() }, initial: { byPage: mark('previous') } });
  assert.equal(h.state.handles[0].getByPage()[1].objects.length, 1);
  assert.equal(h.state.view.byPage[1].objects.length, 1);
  assert.equal(h.state.handles[0].captures.some(([, value]) => JSON.stringify(value).includes('previous')), false);
});

test('checked remote repair runs only after a confirmed writable role, including late role resolution', async t => {
  const h = await mount(t, { docRole: 'viewer', stored: { byPage: duplicateInk() } });
  const handle = h.state.handles[0];
  assert.equal(handle.repairs, 0); assert.equal(handle.getByPage()[1].objects.length, 2);
  await h.render({ docRole: 'editor' });
  assert.equal(handle.repairs, 1); assert.equal(handle.getByPage()[1].objects.length, 1);
  syncByPageToDoc(handle.doc, duplicateInk());
  await act(async () => handle.change(handle.getByPage()));
  assert.equal(handle.repairs, 2); assert.equal(h.state.view.byPage[1].objects.length, 1);
});

test('checked same-generation remote state preserves active eraser presentation but next generation does not', async t => {
  const h = await mount(t);
  await h.edit({ byPage: { 1: { objects: [], eraserPresentationRevision: 'current-erase' } } });
  await act(async () => h.state.handles[0].change({}));
  assert.equal(h.state.view.byPage[1].eraserPresentationRevision, 'current-erase');
  await h.render({ checkedBundle: bundle('generation-b') });
  assert.deepEqual(h.state.view.byPage, {});
});

test('checked hydration publishes the exact bundle and handle once; callback changes do not reopen', async t => {
  const h = await mount(t);
  assert.deepEqual(h.state.publications, [{ checkedBundle: h.state.props.checkedBundle, handle: h.state.handles[0] }]);
  const replacements = [];
  await h.render({ onGenerationSession: value => replacements.push(value) });
  assert.equal(h.state.opens.length, 1); assert.deepEqual(replacements, []);
});

test('hide retains published sealed handle and a fresh local close proof; next open replaces it', async t => {
  const h = await mount(t); const handle = h.state.handles[0];
  await h.edit({ byPage: mark('last-edit') }); await h.render({ enabled: false });
  assert.equal(handle.destroys, 1); assert.equal(handle.getByPage()[1].objects[0].data.id, 'last-edit');
  assert.equal(h.state.publications.length, 1); assert.equal(h.state.publications[0].handle, handle);
  const receipt = await h.latest().ensureLocalDurability(); assert.equal(h.latest().isLocalDurabilityCurrent(receipt), true);
  await h.render({ enabled: true });
  assert.equal(h.state.publications.length, 2); assert.equal(h.state.publications[1].handle, h.state.handles[1]);
  assert.equal(h.latest().isLocalDurabilityCurrent(receipt), false);
});

test('legacy opens never publish generation sessions', async t => {
  const h = await mount(t, { checkedBundle: null }); assert.deepEqual(h.state.publications, []);
});

test('failed and unmounted pending checked opens never publish', async t => {
  const h = await mount(t, { deferOpen: true }); const failed = h.state.opens[0];
  await act(async () => { failed.reject(new Error('open failed')); await failed.promise.catch(() => {}); });
  assert.deepEqual(h.state.publications, []);
  await h.render({ checkedBundle: bundle('generation-b') }); const pending = h.state.opens[1];
  await h.unmount(); await act(async () => { pending.resolve(pending.handle); await pending.promise; });
  assert.deepEqual(h.state.publications, []); assert.equal(pending.handle.destroys, 1);
});

for (const change of ['actor', 'bundle']) test(`${change} A-B-A pending opens publish only the latest open, even with the original bundle object`, async t => {
  const checked = bundle(); const h = await mount(t, { checkedBundle: checked, deferOpen: true });
  const first = h.state.opens[0];
  await h.render(change === 'actor' ? { userId: 'actor-b' } : { checkedBundle: bundle('generation-b') });
  const middle = h.state.opens[1];
  await h.render({ userId: 'actor-a', checkedBundle: checked }); const last = h.state.opens[2];
  await act(async () => { first.resolve(first.handle); middle.resolve(middle.handle); await Promise.all([first.promise, middle.promise]); });
  assert.deepEqual(h.state.publications, []); assert.equal(first.handle.destroys, 1); assert.equal(middle.handle.destroys, 1);
  const latestCallback = [];
  await h.render({ onGenerationSession: value => latestCallback.push(value) });
  await act(async () => { last.resolve(last.handle); await last.promise; });
  assert.deepEqual(latestCallback, [{ checkedBundle: checked, handle: last.handle }]); assert.equal(h.state.opens.length, 3);
});

test('StrictMode replay publishes only the usable surviving checked writer', async t => {
  const h = await mount(t, { strictMode: true });
  assert.equal(h.state.opens.length, 2); assert.equal(h.state.handles[0].destroys, 1);
  assert.deepEqual(h.state.publications, [{ checkedBundle: h.state.props.checkedBundle, handle: h.state.handles[1] }]);
  await h.edit({ byPage: mark('strict-edit') });
  const receipt = await h.latest().ensureLocalDurability(); assert.equal(h.latest().isLocalDurabilityCurrent(receipt), true);
  await h.unmount(); assert.equal(h.state.handles[1].destroys, 1); assert.equal(h.state.publications.length, 1);
});

for (const failure of ['throw', 'reject']) test(`generation observer ${failure} cannot take ownership or prevent local save`, async t => {
  const h = await mount(t, { deferOpen: true });
  await h.render({ onGenerationSession: () => {
    if (failure === 'throw') throw new Error('observer failed');
    return Promise.reject(new Error('observer failed'));
  } });
  const pending = h.state.opens[0];
  await act(async () => { pending.resolve(pending.handle); await pending.promise; });
  assert.equal(h.latest().initialHydration.ready, true); assert.equal(pending.handle.destroys, 0);
  const receipt = await h.latest().ensureLocalDurability(); assert.equal(h.latest().isLocalDurabilityCurrent(receipt), true);
  await h.unmount(); assert.equal(pending.handle.destroys, 1);
});
