import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useDocumentDefinitionRevisions } from '../src/hooks/useDocumentDefinitionRevisions.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
const GENERATION_ID = '44444444-4444-4444-8444-444444444444';
const TEMPLATE_ID = '55555555-5555-4555-8555-555555555555';
const OPERATION_ID = '66666666-6666-4666-8666-666666666666';
const FILE = Object.freeze({ id: DOCUMENT_ID });
const CHECKED_BUNDLE = Object.freeze({ pdfGenerationId: GENERATION_ID });
const SELECTION = Object.freeze({ id: TEMPLATE_ID,
  modules: Object.freeze([]), entities: Object.freeze([]) });

const receipt = (revision, label, operationId = null) => Object.freeze({
  status: 'accepted', version: 1, documentId: DOCUMENT_ID,
  definitionRevision: revision, definitionDigest: String(revision).repeat(64),
  surveyDefinition: Object.freeze({ source: Object.freeze({ templateId: TEMPLATE_ID }),
    modules: Object.freeze([{ id: 'module', name: label, categories: [] }]) }),
  entityCatalog: Object.freeze({ source: Object.freeze({ templateId: TEMPLATE_ID }),
    entities: Object.freeze([{ id: 'entity', name: label }]) }),
  archivedSemanticIds: Object.freeze([]),
  review: Object.freeze({ reviewedAt: '2026-09-15T12:00:00Z', operationId,
    requestSha256: operationId ? 'a'.repeat(64) : null }),
});

const reviewed = (currentReceipt, acceptedReceipt) => Object.freeze({
  status: 'reviewed', version: 1, actorUserId: ACTOR, documentId: DOCUMENT_ID,
  currentReceipt,
  wire: Object.freeze({ surveyDefinition: acceptedReceipt.surveyDefinition,
    entityCatalog: acceptedReceipt.entityCatalog,
    review: Object.freeze({ operationId: OPERATION_ID, requestSha256: 'a'.repeat(64),
      archivedSemanticIds: Object.freeze([]) }) }),
  expectedArchivedSemanticIds: Object.freeze([]),
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
  for (let i = 0; i < 50; i += 1) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
    if (check()) return;
  }
  assert.fail(message);
};

const mountHook = async (t, options) => {
  const restore = installDom();
  let latest;
  function Probe() {
    latest = useDocumentDefinitionRevisions({ enabled: true, file: FILE,
      checkedBundle: CHECKED_BUNDLE, actorUserId: ACTOR, ...options });
    return React.createElement('output', null,
      `${latest.mode}:${latest.currentReceipt?.definitionRevision || 0}`);
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe)));
  return { latest: () => latest };
};

const createCache = ({ currentReceipt = null, initialIntent = null, events = [] } = {}) => {
  let current = currentReceipt;
  let intent = initialIntent;
  return {
    current: () => current,
    intent: () => intent,
    getIntent: async () => { events.push('get-intent'); return intent; },
    getCurrentReceipt: async () => { events.push('get-cache'); return current; },
    putCurrentReceipt: async (_actor, _document, value) => {
      events.push(`put-current-${value.definitionRevision}`);
      current = value;
      return value;
    },
    putReceipt: async (_actor, _document, value) => {
      events.push(`put-receipt-${value.definitionRevision}`);
      return value;
    },
    getReceipt: async () => null,
    reserveIntent: async (_actor, _document, review) => {
      events.push('reserve-intent');
      intent ||= { phase: 'pending', revision: 1, operationId: OPERATION_ID,
        requestSha256: 'a'.repeat(64), review };
      return { row: intent, created: true };
    },
    markDispatched: async () => {
      events.push('mark-dispatched');
      intent = { ...intent, phase: 'dispatched', revision: intent.revision + 1 };
      return intent;
    },
    finishIntent: async () => { events.push('finish-intent'); intent = null; return true; },
    cancelIntent: async () => { events.push('cancel-intent'); intent = null; return true; },
  };
};

test('a synchronous subscription hint waits for full dispatched-intent recovery and adds one read', async t => {
  const events = [];
  const first = receipt(1, 'Before recovery');
  const accepted = receipt(2, 'Recovered publish', OPERATION_ID);
  const review = reviewed(first, accepted);
  const dispatched = { phase: 'dispatched', revision: 2, operationId: OPERATION_ID,
    requestSha256: 'a'.repeat(64), review };
  const cache = createCache({ currentReceipt: first, initialIntent: dispatched, events });
  let serverCurrent = first;
  let reads = 0;
  let applies = 0;
  let subscriptions = 0;
  const client = {
    readCurrent: async () => {
      reads += 1;
      events.push(`read-${reads}`);
      return serverCurrent;
    },
    apply: async () => {
      applies += 1;
      events.push('apply');
      serverCurrent = accepted;
      return accepted;
    },
    subscribeCurrent: ({ signal, onInvalidate }) => {
      subscriptions += 1;
      events.push('subscribe');
      assert.equal(signal.aborted, false);
      onInvalidate();
      return () => events.push('dispose');
    },
  };
  const mounted = await mountHook(t, { owner: true, client, cache });
  await waitFor(() => mounted.latest()?.currentReceipt?.definitionRevision === 2
    && reads >= 3, 'initial recovery or its one queued refresh did not finish');
  for (let i = 0; i < 5; i += 1) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  }

  assert.equal(applies, 1, 'the dispatched operation is recovered once');
  assert.equal(events.filter(event => event === 'finish-intent').length, 1,
    'the dispatched proof is finished once');
  assert.equal(subscriptions, 1);
  assert.equal(reads, 3,
    'startup, post-apply proof, and one trailing subscription refresh are the only reads');
  assert.ok(events.indexOf('finish-intent') < events.indexOf('read-3'),
    'the synchronous subscription hint waits until dispatched recovery is durable');
  assert.equal(cache.intent(), null);
  assert.equal(document.querySelector('output').textContent, 'accepted:2');
});

for (const [code, message] of [
  ['DOCUMENT_DEFINITION_REVISION_FORBIDDEN', /no longer have access/i],
  ['DOCUMENT_DEFINITION_REVISION_INTEGRITY', /could not be verified/i],
]) {
  test(`a ${code} refresh clears the last authorized accepted head`, async t => {
    const first = receipt(1, 'Authorized before invalidation');
    const cache = createCache();
    let reads = 0;
    let invalidate;
    const client = {
      readCurrent: async () => {
        reads += 1;
        if (reads === 1) return first;
        throw Object.assign(new Error('refresh rejected'), { code });
      },
      subscribeCurrent: ({ onInvalidate }) => { invalidate = onInvalidate; return () => {}; },
    };
    const mounted = await mountHook(t, { owner: false, client, cache });
    await waitFor(() => mounted.latest()?.currentReceipt?.definitionRevision === 1
      && typeof invalidate === 'function', 'the accepted head and subscription did not become ready');

    await act(async () => invalidate());
    await waitFor(() => reads === 2 && mounted.latest()?.mode === 'unknown',
      `${code} did not remove the accepted head`);
    assert.equal(mounted.latest().currentReceipt, null);
    assert.equal(mounted.latest().modules.length, 0);
    assert.equal(mounted.latest().online, false);
    assert.equal(mounted.latest().recoveryBlocked, true);
    assert.match(mounted.latest().error, message);
    assert.equal(cache.current()?.definitionRevision, 1,
      'the old verified cache may remain durable but must not stay authorized on screen');
    assert.equal(document.querySelector('output').textContent, 'unknown:0');
  });
}

test('retained owner mutation callbacks reject in the invalidation tick before React rerenders', async t => {
  const first = receipt(1, 'Current');
  const accepted = receipt(2, 'Would publish', OPERATION_ID);
  const review = reviewed(first, accepted);
  const cache = createCache();
  let invalidate;
  let previews = 0;
  let applies = 0;
  const client = {
    readCurrent: async () => first,
    subscribeCurrent: ({ onInvalidate }) => { invalidate = onInvalidate; return () => {}; },
    preview: async () => { previews += 1; return review; },
    apply: async () => { applies += 1; return accepted; },
  };
  const mounted = await mountHook(t, { owner: true, client, cache,
    createOperationId: () => OPERATION_ID });
  await waitFor(() => mounted.latest()?.currentReceipt?.definitionRevision === 1
    && typeof invalidate === 'function', 'the owner head and subscription did not become ready');
  await act(async () => mounted.latest().requestReview(SELECTION));
  await waitFor(() => mounted.latest()?.review === review, 'the owner review did not become ready');
  const retainedRequestReview = mounted.latest().requestReview;
  const retainedApplyReview = mounted.latest().applyReview;

  let requestAttempt;
  let applyAttempt;
  await act(async () => {
    invalidate();
    requestAttempt = retainedRequestReview(SELECTION);
    applyAttempt = retainedApplyReview();
    await Promise.all([
      assert.rejects(requestAttempt, /Finish the saved definition check/i),
      assert.rejects(applyAttempt, /Finish the saved definition check/i),
    ]);
  });
  assert.equal(previews, 1, 'the retained request callback sends no second preview');
  assert.equal(applies, 0, 'the retained apply callback sends no write');
});
