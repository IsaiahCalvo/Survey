import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useDocumentDefinitionRevisions } from '../src/hooks/useDocumentDefinitionRevisions.js';

const ACTOR_A = '11111111-1111-4111-8111-111111111111';
const ACTOR_B = '22222222-2222-4222-8222-222222222222';
const ACTOR_C = '77777777-7777-4777-8777-777777777777';
const DOCUMENT_A = '33333333-3333-4333-8333-333333333333';
const DOCUMENT_B = '88888888-8888-4888-8888-888888888888';
const GENERATION_A = '44444444-4444-4444-8444-444444444444';
const GENERATION_B = '99999999-9999-4999-8999-999999999999';
const TEMPLATE_ID = '55555555-5555-4555-8555-555555555555';
const OPERATION_ID = '66666666-6666-4666-8666-666666666666';
const FILE_A = Object.freeze({ id: DOCUMENT_A });
const FILE_B = Object.freeze({ id: DOCUMENT_B });
const BUNDLE_A = Object.freeze({ pdfGenerationId: GENERATION_A });
const BUNDLE_B = Object.freeze({ pdfGenerationId: GENERATION_B });

const receipt = (documentId, revision, label, operationId = null) => Object.freeze({
  status: 'accepted', version: 1, documentId,
  definitionRevision: revision, definitionDigest: String(revision).repeat(64),
  surveyDefinition: Object.freeze({ source: Object.freeze({ templateId: TEMPLATE_ID }),
    modules: Object.freeze([{ id: 'module', name: label, categories: [] }]) }),
  entityCatalog: Object.freeze({ source: Object.freeze({ templateId: TEMPLATE_ID }),
    entities: Object.freeze([{ id: 'entity', name: label }]) }),
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
  for (let i = 0; i < 50; i += 1) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
    if (check()) return;
  }
  assert.fail(message);
};

const createCache = () => {
  const current = new Map();
  const receipts = new Map();
  const intents = new Map();
  const key = (actorUserId, documentId) => `${actorUserId}:${documentId}`;
  return {
    current,
    getIntent: async (actorUserId, documentId) => intents.get(key(actorUserId, documentId)) || null,
    getCurrentReceipt: async (actorUserId, documentId) => current.get(key(actorUserId, documentId)) || null,
    putCurrentReceipt: async (actorUserId, documentId, value) => {
      current.set(key(actorUserId, documentId), value);
      return value;
    },
    putReceipt: async (actorUserId, documentId, value) => {
      receipts.set(`${key(actorUserId, documentId)}:${value.definitionRevision}`, value);
      return value;
    },
    getReceipt: async (actorUserId, documentId, revision) =>
      receipts.get(`${key(actorUserId, documentId)}:${revision}`) || null,
    reserveIntent: async (actorUserId, documentId, review) => {
      const scope = key(actorUserId, documentId);
      let row = intents.get(scope);
      if (!row) {
        row = { phase: 'pending', revision: 1,
          operationId: review.wire.review.operationId,
          requestSha256: review.wire.review.requestSha256, review };
        intents.set(scope, row);
      }
      return { row, created: true };
    },
    markDispatched: async (actorUserId, documentId) => {
      const scope = key(actorUserId, documentId);
      const row = { ...intents.get(scope), phase: 'dispatched', revision: 2 };
      intents.set(scope, row);
      return row;
    },
    finishIntent: async (actorUserId, documentId) => {
      intents.delete(key(actorUserId, documentId));
      return true;
    },
    cancelIntent: async (actorUserId, documentId) => {
      intents.delete(key(actorUserId, documentId));
      return true;
    },
  };
};

const createServer = entries => {
  const current = new Map(entries);
  const subscriptions = [];
  const reads = new Map();
  const readCurrent = async documentId => {
    reads.set(documentId, (reads.get(documentId) || 0) + 1);
    return current.get(documentId);
  };
  const subscribeCurrent = ({ documentId, signal, onInvalidate }) => {
    const subscription = { documentId, signal, onInvalidate, active: true };
    subscriptions.push(subscription);
    const dispose = () => { subscription.active = false; };
    signal?.addEventListener('abort', dispose, { once: true });
    return dispose;
  };
  const publish = (documentId, next) => {
    current.set(documentId, next);
    for (const subscription of subscriptions) {
      if (subscription.active && subscription.documentId === documentId) subscription.onInvalidate();
    }
  };
  return { current, subscriptions, reads, readCurrent, subscribeCurrent, publish };
};

test('an open collaborator follows owner publishes and coalesces an invalidation burst', async t => {
  const restore = installDom();
  const initial = receipt(DOCUMENT_A, 1, 'Initial');
  const accepted = receipt(DOCUMENT_A, 2, 'Owner published', OPERATION_ID);
  const server = createServer([[DOCUMENT_A, initial]]);
  const ownerCache = createCache();
  const collaboratorCache = createCache();
  const ownerClient = {
    readCurrent: ({ documentId }) => server.readCurrent(documentId),
    preview: async ({ documentId, operationId }) => Object.freeze({
      status: 'reviewed', version: 1, actorUserId: ACTOR_A, documentId,
      currentReceipt: server.current.get(documentId),
      wire: Object.freeze({ surveyDefinition: accepted.surveyDefinition,
        entityCatalog: accepted.entityCatalog,
        review: Object.freeze({ operationId, requestSha256: 'a'.repeat(64),
          archivedSemanticIds: Object.freeze([]) }) }),
      expectedArchivedSemanticIds: Object.freeze([]),
    }),
    apply: async () => {
      server.publish(DOCUMENT_A, accepted);
      return accepted;
    },
    readRevision: async () => assert.fail('historical read is not part of this flow'),
  };
  const collaboratorClient = {
    readCurrent: ({ documentId }) => server.readCurrent(documentId),
    subscribeCurrent: server.subscribeCurrent,
    preview: async () => assert.fail('a collaborator must not preview'),
    apply: async () => assert.fail('a collaborator must not apply'),
    readRevision: async () => assert.fail('historical read is not part of this flow'),
  };
  let owner;
  let collaborator;
  let collaboratorMounts = 0;
  function OwnerProbe() {
    owner = useDocumentDefinitionRevisions({ enabled: true,
      file: FILE_A, checkedBundle: BUNDLE_A,
      actorUserId: ACTOR_A, owner: true, client: ownerClient, cache: ownerCache,
      createOperationId: () => OPERATION_ID });
    return null;
  }
  function CollaboratorProbe() {
    collaborator = useDocumentDefinitionRevisions({ enabled: true,
      file: FILE_A, checkedBundle: BUNDLE_A,
      actorUserId: ACTOR_B, owner: false, client: collaboratorClient, cache: collaboratorCache });
    React.useEffect(() => { collaboratorMounts += 1; }, []);
    return React.createElement('output', { 'data-collaborator-revision': true },
      collaborator.currentReceipt?.definitionRevision || 0);
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(OwnerProbe), React.createElement(CollaboratorProbe))));
  await waitFor(() => owner?.currentReceipt?.definitionRevision === 1
    && collaborator?.currentReceipt?.definitionRevision === 1, 'both open actors did not load revision 1');

  await act(async () => owner.requestReview({ id: TEMPLATE_ID, modules: [], entities: [] }));
  await act(async () => owner.applyReview());
  await waitFor(() => collaborator?.currentReceipt?.definitionRevision === 2,
    'the open collaborator did not refresh after the owner published revision 2');
  assert.equal(collaboratorMounts, 1, 'the collaborator converges without reopening the document');
  assert.equal(document.querySelector('[data-collaborator-revision]').textContent, '2');
  assert.equal(collaboratorCache.current.get(`${ACTOR_B}:${DOCUMENT_A}`)?.definitionRevision, 2,
    'the collaborator caches the verified current head');

  const readsBeforeBurst = server.reads.get(DOCUMENT_A);
  const third = receipt(DOCUMENT_A, 3, 'Later publish');
  server.current.set(DOCUMENT_A, third);
  await act(async () => {
    for (let i = 0; i < 20; i += 1) {
      for (const subscription of server.subscriptions) {
        if (subscription.active && subscription.documentId === DOCUMENT_A) subscription.onInvalidate();
      }
    }
  });
  await waitFor(() => collaborator?.currentReceipt?.definitionRevision === 3,
    'the collaborator did not refresh after a burst of revision hints');
  assert.equal(server.reads.get(DOCUMENT_A), readsBeforeBurst + 1,
    'a same-turn invalidation burst shares one verified-current read');
});

test('a retained invalidation callback cannot refresh an old actor or document scope', async t => {
  const restore = installDom();
  const server = createServer([
    [DOCUMENT_A, receipt(DOCUMENT_A, 1, 'First document')],
    [DOCUMENT_B, receipt(DOCUMENT_B, 7, 'Second document')],
  ]);
  const cache = createCache();
  const client = {
    readCurrent: ({ documentId }) => server.readCurrent(documentId),
    subscribeCurrent: server.subscribeCurrent,
  };
  let latest;
  function Probe({ actorUserId, file, checkedBundle }) {
    const documentId = file.id;
    latest = useDocumentDefinitionRevisions({ enabled: true,
      file, checkedBundle,
      actorUserId, owner: false, client, cache,
      isCurrent: scope => scope.actorUserId === actorUserId && scope.documentId === documentId });
    return React.createElement('output', null, latest.currentReceipt?.definitionRevision || 0);
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe, {
    actorUserId: ACTOR_B, file: FILE_A, checkedBundle: BUNDLE_A,
  })));
  await waitFor(() => latest?.currentReceipt?.definitionRevision === 1,
    'the first collaborator scope did not load');
  await waitFor(() => server.subscriptions.length === 1,
    'the hook did not subscribe the first collaborator scope');
  const retired = server.subscriptions[0];

  await act(async () => root.render(React.createElement(Probe, {
    actorUserId: ACTOR_C, file: FILE_B, checkedBundle: BUNDLE_B,
  })));
  await waitFor(() => latest?.currentReceipt?.definitionRevision === 7,
    'the replacement collaborator scope did not load');
  await waitFor(() => server.subscriptions.length === 2,
    'the hook did not subscribe the replacement collaborator scope');
  assert.equal(retired.signal.aborted, true);
  const oldReads = server.reads.get(DOCUMENT_A);
  server.current.set(DOCUMENT_A, receipt(DOCUMENT_A, 2, 'Retired document update'));
  await act(async () => {
    retired.onInvalidate();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(server.reads.get(DOCUMENT_A), oldReads,
    'a retained callback cannot read through the retired actor and document scope');
  assert.equal(latest.currentReceipt.definitionRevision, 7);
  assert.equal(document.querySelector('output').textContent, '7');
});
