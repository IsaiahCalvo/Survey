import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';
import {
  syncByPageToDoc, docToByPage, setMetaValue, getMetaValue,
  syncSurveyMarkersToDoc, docToSurveyMarkers,
} from '../src/services/annotationDocStore.js';

const require = createRequire(import.meta.url);
const hookUrl = new URL('../src/hooks/useAnnotationDoc.js', import.meta.url);
let sequence = 0;
const mark = (id = 'mark', left = 1) => ({ 1: { objects: [{ type: 'rect', left, top: 2,
  width: 3, height: 4, data: { id } }] } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
};

function createHandle(state, args) {
  const doc = new Y.Doc();
  const local = { sealed: false, revision: 0, flushes: [], close: null, backend: deferred(),
    purged: false, currencyChecks: [], revalidations: [], autoRevalidate: true };
  const issued = new WeakMap();
  const docBytes = () => Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  doc.on('update', () => { local.revision++; });
  const writerId = `writer-${state.handles.length + 1}`;
  const receipt = () => {
    const value = { locallyDurable: true, documentId: args.documentId,
      actorUserId: args.actorUserId, incarnation: 1, writerId, revision: local.revision };
    issued.set(value, docBytes());
    return value;
  };
  const writable = () => assert.equal(local.sealed, false, 'a sealed writer cannot capture later edits');
  const handle = {
    documentId: args.documentId, writerId, clientId: 'test-client', doc, local,
    getByPage: () => docToByPage(doc),
    getMeta: (key) => getMetaValue(doc, key),
    getSurveyMarkers: () => docToSurveyMarkers(doc),
    getDeletedPdfAnnotations: () => [],
    applyByPage(value) { writable(); state.events.push(`capture:${writerId}`); return syncByPageToDoc(doc, value); },
    setMeta(key, value) { writable(); return setMetaValue(doc, key, value); },
    applySurveyMarkers(value) { writable(); return syncSurveyMarkersToDoc(doc, value); },
    onChange: () => () => {},
    onSyncStatus: () => () => {},
    onHistoryQuarantine: () => () => {},
    getSyncStatus: () => ({ stage: 'idle', healthy: true, queueSize: 0 }),
    getLocalRevision: () => local.revision,
    isLocalReceiptCurrent(value) {
      local.currencyChecks.push(value);
      return !local.purged && issued.has(value) && issued.get(value) === docBytes();
    },
    revalidateLocalReceipt(value) {
      const pending = { ...deferred(), receipt: value };
      local.revalidations.push(pending);
      if (local.autoRevalidate) {
        if (handle.isLocalReceiptCurrent(value)) pending.resolve(value);
        else pending.reject(new Error('local receipt no longer exists'));
      }
      return pending.promise;
    },
    flushLocalDurability(options) {
      writable();
      const pending = { ...deferred(), receipt: receipt(), options,
        byPage: structuredClone(docToByPage(doc)), spaces: structuredClone(getMetaValue(doc, 'spaces')),
        markers: structuredClone(docToSurveyMarkers(doc)) };
      local.flushes.push(pending);
      state.events.push(`local-flush:${writerId}`);
      return pending.promise;
    },
    getLocalCloseReceipt: () => local.close?.promise ?? null,
    destroy() {
      if (!local.sealed) {
        local.sealed = true;
        state.events.push(`seal:${writerId}`);
        local.close = { ...deferred(), receipt: receipt() };
      }
      return local.backend.promise;
    },
    drain() { state.backendCalls++; return local.backend.promise; },
    flushSnapshot() { state.backendCalls++; return local.backend.promise; },
  };
  state.handles.push(handle);
  return handle;
}

async function mount(t, { enabled = true, deferredOpen = false, initial = {} } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const state = { handles: [], opens: [], events: [], backendCalls: 0,
    props: { enabled, documentId: 'document-a', userId: 'actor-a' },
    supabase: {}, layoutEnsure: false, ensurePromise: null, view: null,
    layoutCheckReceipt: null, currentInLayout: null };
  state.openAnnotationDoc = (args) => {
    state.events.push(`open:${args.documentId}:${args.actorUserId}`);
    const pending = { ...deferred(), args, handle: createHandle(state, args) };
    state.opens.push(pending);
    if (!deferredOpen) pending.resolve(pending.handle);
    return pending.promise;
  };
  const key = `__annotationLocalDurability${++sequence}`;
  globalThis[key] = state;
  const originalSource = await readFile(hookUrl, 'utf8');
  let source = originalSource
    .replace(/import\s+\{\s*supabase\s*\}\s+from\s+['"]\.\.\/supabaseClient\.js['"];?/, `const supabase = globalThis[${JSON.stringify(key)}].supabase;`)
    .replace(/import\s+\{\s*openAnnotationDoc\s*,\s*getClientId\s*\}\s+from\s+['"]\.\.\/services\/annotationDocSync\.js['"];?/, `const openAnnotationDoc = globalThis[${JSON.stringify(key)}].openAnnotationDoc; const getClientId = () => 'test-client';`);
  assert.notEqual(source, originalSource, 'replace the external open/client boundaries, not the hook');
  source = source.replace(/from\s+(['"])([^'"]+)\1/g, (_all, _quote, specifier) => {
    const url = specifier.startsWith('.') ? new URL(specifier, hookUrl).href : pathToFileURL(require.resolve(specifier)).href;
    return `from ${JSON.stringify(url)}`;
  });
  const { useAnnotationDoc } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let latest, edit;
  function Probe(props) {
    const [byPage, setAnnotationsByPage] = useState(initial.byPage || {});
    const [spaces, setSpaces] = useState(initial.spaces || []);
    const [surveyMarkers, setSurveyMarkers] = useState(initial.markers || {});
    state.view = { byPage, spaces, markers: surveyMarkers };
    latest = useAnnotationDoc({ ...props, annotationsByPage: byPage, setAnnotationsByPage,
      spaces, setSpaces, surveyMarkers, setSurveyMarkers, docRole: null });
    edit = (next) => {
      if ('byPage' in next) setAnnotationsByPage(next.byPage);
      if ('spaces' in next) setSpaces(next.spaces);
      if ('markers' in next) setSurveyMarkers(next.markers);
    };
    useLayoutEffect(() => {
      if (state.layoutCheckReceipt) {
        state.currentInLayout = latest.isLocalDurabilityCurrent(state.layoutCheckReceipt);
        state.layoutCheckReceipt = null;
      }
      if (!state.layoutEnsure) return;
      state.layoutEnsure = false;
      // Call before the hook's passive capture effects: local Save itself must
      // capture the current render, not only yesterday's completed effects.
      try { state.ensurePromise = Promise.resolve(latest.ensureLocalDurability()); }
      catch (error) { state.ensurePromise = Promise.reject(error); }
      state.ensurePromise.catch(() => {});
    });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const render = async (patch = {}) => {
    state.props = { ...state.props, ...patch };
    await act(async () => root.render(React.createElement(Probe, { ...state.props, key: state.props.mountKey })));
  };
  await render();
  t.after(async () => {
    await act(async () => root.unmount());
    for (const handle of state.handles) {
      handle.local.close?.resolve(handle.local.close.receipt);
      handle.local.backend.resolve();
      handle.doc.destroy();
    }
    delete globalThis[key];
    dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    state, render, latest: () => latest,
    async edit(next, { ensure = false, checkReceipt = null } = {}) {
      await act(async () => {
        state.layoutEnsure = ensure;
        state.layoutCheckReceipt = checkReceipt;
        edit(next);
      });
      return state.ensurePromise ? { promise: state.ensurePromise } : {};
    },
    async beginEnsure(callback = latest.ensureLocalDurability) {
      assert.equal(typeof callback, 'function', 'the public hook exposes ensureLocalDurability');
      let promise;
      await act(async () => { promise = callback(); promise.catch(() => {}); });
      return { promise };
    },
  };
}

test('active local Save captures current annotations, spaces, and markers without waiting for backend work', async (t) => {
  const h = await mount(t);
  const next = { byPage: mark(), spaces: [{ id: 'space-a', name: 'Floor 1' }], markers: { marker: { id: 'marker', name: 'Door' } } };
  const { promise } = await h.edit(next, { ensure: true });
  const handle = h.state.handles[0];
  const pending = handle.local.flushes.at(-1);
  assert.ok(pending, 'local flush must be requested');
  assert.equal(pending.byPage[1].objects[0].data.id, 'mark');
  assert.deepEqual(pending.spaces, next.spaces);
  assert.deepEqual(pending.markers, next.markers);
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  await act(async () => {});
  assert.equal(settled, false, 'healthy idle status is not a local receipt');
  pending.resolve(pending.receipt);
  const receipt = await promise;
  assert.equal(receipt.locallyDurable, true);
  assert.equal(receipt.documentId, 'document-a');
  assert.equal(receipt.actorUserId, 'actor-a');
  assert.equal(typeof receipt.viewSignature, 'string');
  assert.equal(h.state.backendCalls, 0);
});

test('receipt currency forwards the exact service-issued object, not the flat hook wrapper', async (t) => {
  const h = await mount(t);
  const { promise } = await h.beginEnsure();
  const handle = h.state.handles[0];
  const pending = handle.local.flushes.at(-1);
  pending.resolve(pending.receipt);
  const receipt = await promise;
  assert.equal(typeof h.latest().isLocalDurabilityCurrent, 'function');
  assert.notEqual(receipt, pending.receipt);
  assert.equal(h.latest().isLocalDurabilityCurrent(receipt), true);
  assert.equal(handle.local.currencyChecks.at(-1), pending.receipt);
  assert.equal(h.latest().isLocalDurabilityCurrent({ ...receipt }), false, 'copied fields are not an issued proof');
});

for (const change of [{ userId: 'actor-b' }, { documentId: 'document-b' }, { mountKey: 'new-hook' }]) {
  test(`receipt currency rejects another ${Object.keys(change)[0]} surface and its retired callback`, async (t) => {
    const h = await mount(t);
    const oldCheck = h.latest().isLocalDurabilityCurrent;
    const { promise } = await h.beginEnsure();
    const pending = h.state.handles[0].local.flushes.at(-1);
    pending.resolve(pending.receipt);
    const receipt = await promise;
    assert.equal(oldCheck(receipt), true);
    await h.render(change);
    assert.equal(h.latest().isLocalDurabilityCurrent(receipt), false);
    assert.equal(oldCheck(receipt), false, 'retired callbacks must not authorize a new surface');
  });
}

for (const change of ['document bytes', 'purge token']) {
  test(`receipt currency rejects changed ${change} even without a React render`, async (t) => {
    const h = await mount(t);
    const { promise } = await h.beginEnsure();
    const handle = h.state.handles[0];
    const pending = handle.local.flushes.at(-1);
    pending.resolve(pending.receipt);
    const receipt = await promise;
    assert.equal(h.latest().isLocalDurabilityCurrent(receipt), true);
    if (change === 'document bytes') syncByPageToDoc(handle.doc, mark('remote-change', 80));
    else handle.local.purged = true;
    assert.equal(h.latest().isLocalDurabilityCurrent(receipt), false);
  });
}

test('receipt currency rejects a new UI view before passive effects copy it to the document', async (t) => {
  const h = await mount(t, { initial: { byPage: mark() } });
  const { promise } = await h.beginEnsure();
  const pending = h.state.handles[0].local.flushes.at(-1);
  pending.resolve(pending.receipt);
  const receipt = await promise;
  assert.equal(h.latest().isLocalDurabilityCurrent(receipt), true);
  await h.edit({ byPage: mark('mark', 200) }, { checkReceipt: receipt });
  assert.equal(h.state.currentInLayout, false, 'rendered edits must invalidate proof before document capture');
});

test('inactive retained proof remains current through full teardown when the view and document do not change', async (t) => {
  const h = await mount(t, { initial: { byPage: mark() } });
  const handle = h.state.handles[0];
  await h.render({ enabled: false });
  const { promise } = await h.beginEnsure();
  handle.local.close.resolve(handle.local.close.receipt);
  const receipt = await promise;
  assert.equal(h.latest().isLocalDurabilityCurrent(receipt), true);
  assert.equal(handle.local.currencyChecks.at(-1), handle.local.close.receipt);
  handle.local.backend.resolve();
  await act(async () => { await handle.local.backend.promise; handle.doc.destroy(); });
  assert.equal(h.latest().isLocalDurabilityCurrent(receipt), true, 'teardown alone does not erase a durable proof');
  syncByPageToDoc(handle.doc, mark('changed-after-teardown'));
  assert.equal(h.latest().isLocalDurabilityCurrent(receipt), false, 'retired doc byte changes still invalidate proof');
});

test('inactive retained proof cannot survive a local service purge', async (t) => {
  const h = await mount(t);
  const handle = h.state.handles[0];
  await h.render({ enabled: false });
  const { promise } = await h.beginEnsure();
  handle.local.close.resolve(handle.local.close.receipt);
  const receipt = await promise;
  assert.equal(h.latest().isLocalDurabilityCurrent(receipt), true);
  handle.local.purged = true;
  assert.equal(h.latest().isLocalDurabilityCurrent(receipt), false);
});

test('inactive Save waits for a fresh local read and forwards the exact close receipt without backend work', async (t) => {
  const h = await mount(t);
  const handle = h.state.handles[0];
  handle.local.autoRevalidate = false;
  await h.render({ enabled: false });
  handle.local.close.resolve(handle.local.close.receipt);
  const { promise } = await h.beginEnsure();
  const fresh = handle.local.revalidations.at(-1);
  assert.ok(fresh, 'a cached close receipt requires a fresh local read');
  assert.equal(fresh.receipt, handle.local.close.receipt);
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  await act(async () => {});
  assert.equal(settled, false, 'cached currency alone cannot acknowledge an inactive Save');
  fresh.resolve(fresh.receipt);
  assert.equal((await promise).locallyDurable, true);
  assert.equal(h.state.backendCalls, 0);
});

for (const failure of ['purge', 'read failure', 'missing receipt']) {
  test(`inactive fresh revalidation rejects ${failure}`, async (t) => {
    const h = await mount(t);
    const handle = h.state.handles[0];
    handle.local.autoRevalidate = false;
    await h.render({ enabled: false });
    handle.local.close.resolve(handle.local.close.receipt);
    const { promise } = await h.beginEnsure();
    const fresh = handle.local.revalidations.at(-1);
    assert.ok(fresh);
    if (failure === 'missing receipt') fresh.resolve(null);
    else fresh.reject(new Error(failure === 'purge' ? 'stored incarnation was purged' : 'IndexedDB read failed'));
    await assert.rejects(promise);
    assert.equal(h.state.backendCalls, 0);
  });
}

for (const change of ['actor', 'view']) {
  test(`inactive fresh revalidation cannot acknowledge a changed ${change} during the local read`, async (t) => {
    const h = await mount(t);
    const handle = h.state.handles[0];
    handle.local.autoRevalidate = false;
    await h.render({ enabled: false });
    handle.local.close.resolve(handle.local.close.receipt);
    const { promise } = await h.beginEnsure();
    const fresh = handle.local.revalidations.at(-1);
    assert.ok(fresh);
    if (change === 'actor') await h.render({ userId: 'actor-b' });
    else await h.edit({ byPage: mark('edited-while-inactive') });
    fresh.resolve(fresh.receipt);
    await assert.rejects(promise);
  });
}

test('local Save captures the deletion of the last annotation, space, and marker', async (t) => {
  const h = await mount(t, { initial: { byPage: mark(), spaces: [{ id: 'space-a' }], markers: { marker: { id: 'marker' } } } });
  const { promise } = await h.edit({ byPage: {}, spaces: [], markers: {} }, { ensure: true });
  const pending = h.state.handles[0].local.flushes.at(-1);
  assert.ok(pending);
  assert.deepEqual(pending.byPage, {});
  assert.deepEqual(pending.spaces, []);
  assert.deepEqual(pending.markers, {});
  pending.resolve(pending.receipt);
  assert.equal((await promise).locallyDurable, true);
});

test('inactive Save uses a retained local close receipt without waiting for full teardown', async (t) => {
  const h = await mount(t, { initial: { byPage: mark() } });
  const old = h.state.handles[0];
  await h.render({ enabled: false });
  assert.equal(old.local.sealed, true);
  const { promise } = await h.beginEnsure();
  let settled = false;
  promise.finally(() => { settled = true; }).catch(() => {});
  await act(async () => {});
  assert.equal(settled, false);
  old.local.close.resolve(old.local.close.receipt);
  assert.equal((await promise).locallyDurable, true);
  assert.equal(h.state.backendCalls, 0);
});

for (const change of [{ userId: 'actor-b' }, { documentId: 'document-b' }]) {
  test(`old ${Object.keys(change)[0]} completion and callback cannot acknowledge a new surface`, async (t) => {
    const h = await mount(t);
    const oldCallback = h.latest().ensureLocalDurability;
    const { promise } = await h.beginEnsure(oldCallback);
    const pending = h.state.handles[0].local.flushes.at(-1);
    await h.render(change);
    pending.resolve(pending.receipt);
    await assert.rejects(promise);
    const { promise: stale } = await h.beginEnsure(oldCallback);
    await assert.rejects(stale);
    assert.equal(h.state.handles[1].local.flushes.length, 0, 'old callbacks cannot save the new account/document');
  });
}

test('an edit during the local receipt wait rejects the earlier snapshot', async (t) => {
  const h = await mount(t, { initial: { byPage: mark() } });
  const { promise } = await h.beginEnsure();
  const pending = h.state.handles[0].local.flushes.at(-1);
  await h.edit({ byPage: mark('mark', 99) });
  pending.resolve(pending.receipt);
  await assert.rejects(promise);
});

test('activation cannot acknowledge before hydration even when status is healthy', async (t) => {
  const h = await mount(t, { deferredOpen: true });
  const { promise } = await h.beginEnsure();
  await assert.rejects(promise);
  assert.equal(h.state.handles[0].local.flushes.length, 0);
});

for (const failure of ['missing', 'failed', 'wrong actor', 'wrong document', 'wrong revision', 'wrong writer']) {
  test(`a ${failure} local receipt cannot acknowledge durability`, async (t) => {
    const h = await mount(t);
    const { promise } = await h.beginEnsure();
    const pending = h.state.handles[0].local.flushes.at(-1);
    if (failure === 'failed') pending.reject(new Error('local transaction failed'));
    else pending.resolve(failure === 'missing' ? null : {
      ...pending.receipt,
      ...(failure === 'wrong actor' ? { actorUserId: 'another-actor' } : {}),
      ...(failure === 'wrong document' ? { documentId: 'another-document' } : {}),
      ...(failure === 'wrong revision' ? { revision: pending.receipt.revision + 1 } : {}),
      ...(failure === 'wrong writer' ? { writerId: 'another-writer' } : {}),
    });
    await assert.rejects(promise);
  });
}

test('an initially inactive hook cannot invent a local receipt from idle status', async (t) => {
  const h = await mount(t, { enabled: false });
  assert.equal(h.latest().status.stage, 'idle');
  const { promise } = await h.beginEnsure();
  await assert.rejects(promise);
  assert.equal(h.state.handles.length, 0);
});

for (const failure of ['missing', 'failed']) {
  test(`a ${failure} retained local-close receipt cannot acknowledge inactive durability`, async (t) => {
    const h = await mount(t);
    const old = h.state.handles[0];
    if (failure === 'missing') old.getLocalCloseReceipt = () => null;
    await h.render({ enabled: false });
    const { promise } = await h.beginEnsure();
    if (failure === 'failed') old.local.close.reject(new Error('local close failed'));
    await assert.rejects(promise);
  });
}

test('fast reactivation seals the old writer before opening a new one', async (t) => {
  const h = await mount(t);
  const old = h.state.handles[0];
  await h.render({ enabled: false });
  await h.render({ enabled: true });
  assert.equal(old.local.sealed, true);
  const seal = h.state.events.indexOf('seal:writer-1');
  const reopen = h.state.events.findLastIndex((event) => event === 'open:document-a:actor-a');
  assert.ok(seal >= 0 && reopen > seal);
  assert.equal(h.state.handles.length, 2, 'new open does not wait for the old backend teardown');
  const { promise } = await h.beginEnsure();
  old.local.close.resolve(old.local.close.receipt);
  const current = h.state.handles[1].local.flushes.at(-1);
  assert.ok(current);
  current.resolve(current.receipt);
  assert.equal((await promise).writerId, 'writer-2');
});
