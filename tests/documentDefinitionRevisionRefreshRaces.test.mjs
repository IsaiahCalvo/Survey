import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useDocumentDefinitionRevisions } from '../src/hooks/useDocumentDefinitionRevisions.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const DOCUMENT = '33333333-3333-4333-8333-333333333333';
const GENERATION = '44444444-4444-4444-8444-444444444444';
const TEMPLATE = '55555555-5555-4555-8555-555555555555';
const OPERATION = '66666666-6666-4666-8666-666666666666';
const FILE = Object.freeze({ id: DOCUMENT });
const BUNDLE = Object.freeze({ pdfGenerationId: GENERATION });

const receipt = (revision, operationId = null) => Object.freeze({
  status: 'accepted', version: 1, documentId: DOCUMENT,
  definitionRevision: revision, definitionDigest: String(revision).repeat(64),
  surveyDefinition: Object.freeze({ source: Object.freeze({ templateId: TEMPLATE }), modules: Object.freeze([]) }),
  entityCatalog: Object.freeze({ source: Object.freeze({ templateId: TEMPLATE }), entities: Object.freeze([]) }),
  archivedSemanticIds: Object.freeze([]),
  review: Object.freeze({ reviewedAt: '2026-09-15T12:00:00Z', operationId,
    requestSha256: operationId ? 'a'.repeat(64) : null }),
});

const installDom = () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
};

const waitFor = async (check, message) => {
  for (let i = 0; i < 60; i += 1) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
    if (check()) return;
  }
  assert.fail(message);
};

const cacheWith = (current, intent = null) => ({
  intent,
  current,
  getIntent: async function getIntent() { return this.intent; },
  getCurrentReceipt: async function getCurrentReceipt() { return this.current; },
  putCurrentReceipt: async function putCurrentReceipt(_actor, _document, value) {
    this.current = value; return value;
  },
  putReceipt: async () => {},
  finishIntent: async function finishIntent() { this.intent = null; return true; },
  cancelIntent: async function cancelIntent() { this.intent = null; return true; },
  reserveIntent: async function reserveIntent(_actor, _document, review) {
    this.intent ||= { phase: 'pending', revision: 1, operationId: OPERATION,
      requestSha256: 'a'.repeat(64), review };
    return { row: this.intent, created: true };
  },
  markDispatched: async function markDispatched() {
    this.intent = { ...this.intent, phase: 'dispatched', revision: 2 };
    return this.intent;
  },
  getReceipt: async () => null,
});

async function mountHook(t, options) {
  const restore = installDom();
  let latest;
  function Probe() {
    latest = useDocumentDefinitionRevisions({ enabled: true, file: FILE,
      checkedBundle: BUNDLE, actorUserId: ACTOR, owner: true, ...options });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe)));
  return () => latest;
}

test('a synchronous subscribed hint waits for initial dispatched-intent recovery', async t => {
  const first = receipt(1);
  const second = receipt(2, OPERATION);
  const review = Object.freeze({ status: 'reviewed', version: 1, actorUserId: ACTOR,
    documentId: DOCUMENT, currentReceipt: first,
    wire: Object.freeze({ surveyDefinition: second.surveyDefinition,
      entityCatalog: second.entityCatalog,
      review: Object.freeze({ operationId: OPERATION, requestSha256: 'a'.repeat(64),
        archivedSemanticIds: Object.freeze([]) }) }), expectedArchivedSemanticIds: Object.freeze([]) });
  const cache = cacheWith(first, { phase: 'dispatched', revision: 2,
    operationId: OPERATION, requestSha256: 'a'.repeat(64), review });
  let serverCurrent = first;
  let applies = 0;
  let finishes = 0;
  let reads = 0;
  const originalFinish = cache.finishIntent;
  cache.finishIntent = async function finishIntent(...args) {
    finishes++; return originalFinish.apply(this, args);
  };
  const client = {
    subscribeCurrent: ({ onInvalidate }) => { onInvalidate(); return () => {}; },
    readCurrent: async () => { reads++; return serverCurrent; },
    apply: async () => { applies++; serverCurrent = second; return second; },
  };
  const latest = await mountHook(t, { client, cache });
  await waitFor(() => latest()?.currentReceipt?.definitionRevision === 2,
    'initial recovery did not publish the accepted operation');
  assert.equal(applies, 1);
  assert.equal(finishes, 1);
  assert.equal(reads, 3, 'the joined hint adds one trailing read after the two recovery reads');
  assert.equal(cache.intent, null);
});

test('a forbidden refresh never presents cached data as an accepted offline head', async t => {
  const first = receipt(1);
  const cache = cacheWith(first);
  let invalidate;
  let reads = 0;
  const client = {
    subscribeCurrent: input => { invalidate = input.onInvalidate; return () => {}; },
    readCurrent: async () => {
      reads++;
      if (reads === 1) return first;
      throw Object.assign(new Error('forbidden'), { code: 'DOCUMENT_DEFINITION_REVISION_FORBIDDEN' });
    },
  };
  const latest = await mountHook(t, { client, cache });
  await waitFor(() => latest()?.mode === 'accepted', 'initial head did not load');
  await act(async () => invalidate());
  await waitFor(() => latest()?.mode === 'unknown', 'forbidden refresh did not fail closed');
  assert.equal(latest().currentReceipt, null);
  assert.equal(latest().online, false);
  assert.match(latest().error, /no longer have access/i);
});

test('an invalidation blocks a retained owner callback before React rerenders', async t => {
  const first = receipt(1);
  const cache = cacheWith(first);
  let invalidate;
  let resolveRefresh;
  let reads = 0;
  let previews = 0;
  const client = {
    subscribeCurrent: input => { invalidate = input.onInvalidate; return () => {}; },
    readCurrent: async () => {
      reads++;
      if (reads === 1) return first;
      return new Promise(resolve => { resolveRefresh = resolve; });
    },
    preview: async () => { previews++; assert.fail('refresh-pending preview reached the server'); },
  };
  const latest = await mountHook(t, { client, cache });
  await waitFor(() => latest()?.canReview === true, 'owner did not become ready');
  const retainedRequest = latest().requestReview;
  await act(async () => {
    invalidate();
    await assert.rejects(retainedRequest({ id: TEMPLATE, modules: [], entities: [] }),
      /Finish the saved definition check/);
  });
  assert.equal(previews, 0);
  await waitFor(() => typeof resolveRefresh === 'function', 'refresh did not start');
  resolveRefresh(first);
  await waitFor(() => latest()?.canReview === true, 'owner did not unblock after verified refresh');
});

test('a hint during an in-flight refresh keeps mutations blocked through the trailing read', async t => {
  const first = receipt(1);
  const second = receipt(2);
  const third = receipt(3);
  const cache = cacheWith(first);
  let invalidate;
  let reads = 0;
  const pendingReads = [];
  const client = {
    subscribeCurrent: input => { invalidate = input.onInvalidate; return () => {}; },
    readCurrent: async () => {
      reads++;
      if (reads === 1) return first;
      return new Promise(resolve => pendingReads.push(resolve));
    },
  };
  const latest = await mountHook(t, { client, cache });
  await waitFor(() => latest()?.canReview === true, 'owner did not become ready');
  await act(async () => invalidate());
  await waitFor(() => pendingReads.length === 1, 'first refresh did not start');
  await act(async () => invalidate());
  await act(async () => pendingReads[0](second));
  await waitFor(() => pendingReads.length === 2, 'trailing refresh did not start');
  assert.equal(latest().mutationsBlocked, true,
    'a settled first read cannot unblock edits while its trailing read is pending');
  await act(async () => pendingReads[1](third));
  await waitFor(() => latest()?.currentReceipt?.definitionRevision === 3
    && latest().mutationsBlocked === false, 'final verified head did not unblock edits');
  assert.equal(reads, 3);
});

test('invalidation bursts wait for an applying intent and coalesce after it settles', async t => {
  const first = receipt(1);
  const second = receipt(2, OPERATION);
  const review = Object.freeze({ status: 'reviewed', version: 1, actorUserId: ACTOR,
    documentId: DOCUMENT, currentReceipt: first,
    wire: Object.freeze({ surveyDefinition: second.surveyDefinition,
      entityCatalog: second.entityCatalog,
      review: Object.freeze({ operationId: OPERATION, requestSha256: 'a'.repeat(64),
        archivedSemanticIds: Object.freeze([]) }) }), expectedArchivedSemanticIds: Object.freeze([]) });
  const cache = cacheWith(first);
  let cancelled = 0;
  const originalCancel = cache.cancelIntent;
  cache.cancelIntent = async function cancelIntent(...args) {
    cancelled++; return originalCancel.apply(this, args);
  };
  let invalidate;
  let serverCurrent = first;
  let reads = 0;
  let applies = 0;
  let resolveApply;
  const client = {
    subscribeCurrent: input => { invalidate = input.onInvalidate; return () => {}; },
    readCurrent: async () => { reads++; return serverCurrent; },
    preview: async () => review,
    apply: async () => {
      applies++;
      return new Promise(resolve => { resolveApply = resolve; });
    },
  };
  const latest = await mountHook(t, { client, cache, createOperationId: () => OPERATION });
  await waitFor(() => latest()?.canReview === true, 'owner did not become ready');
  await act(async () => latest().requestReview({ id: TEMPLATE, modules: [], entities: [] }));
  let application;
  await act(async () => {
    application = latest().applyReview();
    await Promise.resolve();
  });
  await waitFor(() => typeof resolveApply === 'function', 'apply did not reach the server');
  await act(async () => {
    for (let i = 0; i < 20; i += 1) invalidate();
  });
  assert.equal(latest().mutationsBlocked, true);
  assert.equal(cache.intent?.phase, 'dispatched');
  serverCurrent = second;
  resolveApply(second);
  await act(async () => application);
  await waitFor(() => latest()?.currentReceipt?.definitionRevision === 2
    && latest().mutationsBlocked === false, 'apply and trailing refresh did not settle');
  assert.equal(applies, 1);
  assert.equal(cancelled, 0, 'a dispatched apply intent must never be cancelled by refresh');
  assert.equal(cache.intent, null);
  assert.equal(reads, 3, 'the burst schedules one read after the apply readback');
});

test('browser offline blocks edits without a read and online waits for a verified refresh', async t => {
  const first = receipt(1);
  const second = receipt(2);
  const cache = cacheWith(first);
  let reads = 0;
  let resolveReconnect;
  const client = {
    subscribeCurrent: () => () => {},
    readCurrent: async () => {
      reads++;
      if (reads === 1) return first;
      return new Promise(resolve => { resolveReconnect = resolve; });
    },
    preview: async () => assert.fail('offline retained request reached preview'),
  };
  const latest = await mountHook(t, { client, cache });
  await waitFor(() => latest()?.online === true, 'initial head did not load');
  const retainedRequest = latest().requestReview;
  await act(async () => {
    window.dispatchEvent(new window.Event('offline'));
    await assert.rejects(retainedRequest({ id: TEMPLATE, modules: [], entities: [] }),
      /Finish the saved definition check/);
  });
  assert.equal(reads, 1, 'offline detection must not make a network read');
  assert.equal(latest().online, false);
  assert.equal(latest().mutationsBlocked, true);
  await act(async () => window.dispatchEvent(new window.Event('online')));
  await waitFor(() => typeof resolveReconnect === 'function', 'online did not request a verified head');
  assert.equal(latest().mutationsBlocked, true);
  resolveReconnect(second);
  await waitFor(() => latest()?.currentReceipt?.definitionRevision === 2
    && latest().online === true && latest().mutationsBlocked === false,
  'verified reconnect did not restore editing');
  assert.equal(reads, 2);
});

test('offline during a dispatched apply keeps its receipt but stays locked until reconnect verifies it', async t => {
  const first = receipt(1);
  const second = receipt(2, OPERATION);
  const review = Object.freeze({ status: 'reviewed', version: 1, actorUserId: ACTOR,
    documentId: DOCUMENT, currentReceipt: first,
    wire: Object.freeze({ surveyDefinition: second.surveyDefinition,
      entityCatalog: second.entityCatalog,
      review: Object.freeze({ operationId: OPERATION, requestSha256: 'a'.repeat(64),
        archivedSemanticIds: Object.freeze([]) }) }), expectedArchivedSemanticIds: Object.freeze([]) });
  const cache = cacheWith(first);
  let serverCurrent = first;
  let reads = 0;
  let resolveApply;
  const client = {
    subscribeCurrent: () => () => {},
    readCurrent: async () => { reads++; return serverCurrent; },
    preview: async () => review,
    apply: async () => new Promise(resolve => { resolveApply = resolve; }),
  };
  const latest = await mountHook(t, { client, cache, createOperationId: () => OPERATION });
  await waitFor(() => latest()?.canReview === true, 'owner did not become ready');
  await act(async () => latest().requestReview({ id: TEMPLATE, modules: [], entities: [] }));
  const retainedApply = latest().applyReview;
  let application;
  await act(async () => { application = retainedApply(); await Promise.resolve(); });
  await waitFor(() => typeof resolveApply === 'function' && cache.intent?.phase === 'dispatched',
    'apply did not become dispatched');
  await act(async () => window.dispatchEvent(new window.Event('offline')));
  assert.equal(reads, 1, 'offline itself must not read');
  serverCurrent = second;
  resolveApply(second);
  await act(async () => application);
  await waitFor(() => latest()?.currentReceipt?.definitionRevision === 2,
    'accepted apply receipt was not retained');
  assert.equal(cache.intent, null, 'confirmed apply intent should finish');
  assert.equal(latest().online, false);
  assert.equal(latest().mutationsBlocked, true);
  await act(async () => window.dispatchEvent(new window.Event('online')));
  await waitFor(() => latest()?.online === true && latest().mutationsBlocked === false,
    'reconnect did not verify and unlock the accepted receipt');
  assert.equal(reads, 3, 'one apply readback and one reconnect read follow the initial read');
});

test('an old initial read cannot clear a replacement client initial-read fence', async t => {
  const restore = installDom();
  const first = receipt(1);
  const second = receipt(2);
  const cache = cacheWith(first);
  let resolveOld;
  let resolveNew;
  const oldClient = { readCurrent: async () => new Promise(resolve => { resolveOld = resolve; }) };
  const newClient = { readCurrent: async () => new Promise(resolve => { resolveNew = resolve; }) };
  const readyClient = { readCurrent: async () => first };
  let latest;
  function Probe({ client }) {
    latest = useDocumentDefinitionRevisions({ enabled: true, file: FILE, checkedBundle: BUNDLE,
      actorUserId: ACTOR, owner: true, client, cache });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe, { client: readyClient })));
  await waitFor(() => latest?.mutationsBlocked === false, 'ready head did not load');
  await act(async () => root.render(React.createElement(Probe, { client: oldClient })));
  await waitFor(() => typeof resolveOld === 'function', 'old initial read did not start');
  assert.equal(latest.mutationsBlocked, true, 'a replacement initial read must fence the prior head');
  await act(async () => root.render(React.createElement(Probe, { client: newClient })));
  await waitFor(() => typeof resolveNew === 'function', 'replacement initial read did not start');
  resolveOld(first);
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(latest.mutationsBlocked, true,
    'the retired initial completion cannot clear the replacement read fence');
  resolveNew(second);
  await waitFor(() => latest?.currentReceipt?.definitionRevision === 2
    && latest.mutationsBlocked === false, 'replacement initial read did not publish');
});
