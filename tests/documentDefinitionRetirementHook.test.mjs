import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useDocumentDefinitionRevisions } from '../src/hooks/useDocumentDefinitionRevisions.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const ACTOR_B = '22222222-2222-4222-8222-222222222222';
const DOCUMENT = '33333333-3333-4333-8333-333333333333';
const GENERATION = '44444444-4444-4444-8444-444444444444';
const OPERATION = '55555555-5555-4555-8555-555555555555';
const FILE = Object.freeze({ id:DOCUMENT });
const BUNDLE = Object.freeze({ pdfGenerationId:GENERATION });
const ROOTS = Object.freeze([{ kind:'module', id:'module' }]);

const receipt = (revision, archives = []) => Object.freeze({ status:'accepted', version:1,
  documentId:DOCUMENT, definitionRevision:revision, definitionDigest:String(revision).repeat(64),
  surveyDefinition:Object.freeze({ source:Object.freeze({ templateId:OPERATION }),
    modules:Object.freeze([{ id:'module', name:'Old label', categories:Object.freeze([]) }]) }),
  entityCatalog:Object.freeze({ source:Object.freeze({ templateId:OPERATION }),
    entities:Object.freeze([{ id:'entity', name:'Old entity', color:'#112233', opacity:0.5,
      borderColor:null, borderOpacity:null, matchFill:false }]) }),
  archivedSemanticIds:Object.freeze(archives),
  review:Object.freeze({ reviewedAt:'2026-09-15T12:00:00Z', operationId:null,
    requestSha256:null }) });

const installDom = () => {
  const dom = new JSDOM('<div id="root"></div>', { url:'https://survey.test' });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window:dom.window, document:dom.window.document,
    IS_REACT_ACT_ENVIRONMENT:true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable:true, writable:true, value });
  }
  return () => {
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
};
const waitFor = async (check, message = 'timed out') => {
  for (let count = 0; count < 40; count++) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
    if (check()) return;
  }
  assert.fail(message);
};

test('V2 discovery keeps null sides and creates no durable intent until final review', async t => {
  const restore = installDom();
  const current = receipt(1);
  const discovery = Object.freeze({ status:'retirement-required', version:2,
    documentId:DOCUMENT, current:Object.freeze({ definitionRevision:1,
      definitionDigest:current.definitionDigest }), sourceModes:Object.freeze({ survey:'keep', entity:'keep' }),
    removedRoots:Object.freeze([]), autoRetainedRoots:Object.freeze([]), review:null });
  const reviewed = Object.freeze({ status:'reviewed', version:2, actorUserId:ACTOR,
    documentId:DOCUMENT, currentReceipt:current,
    wire:Object.freeze({ review:Object.freeze({ operationId:OPERATION,
      requestSha256:'a'.repeat(64) }) }), expectedArchivedSemanticIds:Object.freeze([]) });
  const cacheCalls = [];
  const previewCalls = [];
  const cache = { getIntent:async () => null, getCurrentReceipt:async () => null,
    putCurrentReceipt:async (_actor, _document, value) => { cacheCalls.push('current'); return value; },
    reserveIntent:async (_actor, _document, value) => { cacheCalls.push('reserve');
      return { row:{ phase:'pending', review:value }, created:true }; } };
  const client = { readCurrent:async () => current,
    preview:async args => { previewCalls.push(args);
      return args.retiredSemanticRoots.length ? reviewed : discovery; } };
  let latest;
  function Probe() {
    latest = useDocumentDefinitionRevisions({ enabled:true, file:FILE, checkedBundle:BUNDLE,
      actorUserId:ACTOR, owner:true, client, cache, createOperationId:() => OPERATION });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe)));
  await waitFor(() => latest?.canReview === true);
  let result;
  await act(async () => { result = await latest.requestReview({ version:2,
    surveyTemplate:null, entityTemplate:null, retiredSemanticRoots:[] }); });
  assert.equal(result, discovery);
  assert.deepEqual(cacheCalls, ['current'], 'only initial verified head storage ran');
  assert.equal(latest.review, null);
  assert.equal(previewCalls[0].surveyTemplateId, null);
  assert.equal(previewCalls[0].entityTemplateId, null);
  await act(async () => { result = await latest.requestReview({ version:2,
    surveyTemplate:null, entityTemplate:null, retiredSemanticRoots:ROOTS }); });
  assert.equal(result, reviewed);
  assert.deepEqual(cacheCalls, ['current', 'current', 'reserve']);
  assert.equal(latest.review, reviewed);
});

test('available projections keep canonical labels and retained predicates fail on offline and refreshed retirement', async t => {
  const restore = installDom();
  const first = receipt(1);
  const second = receipt(2, [{ kind:'module', id:'module' }, { kind:'entity', id:'entity' }]);
  let server = first;
  let invalidate;
  const cache = { getIntent:async () => null, getCurrentReceipt:async () => null,
    putCurrentReceipt:async (_actor, _document, value) => value };
  const client = { readCurrent:async () => server,
    subscribeCurrent:({ onInvalidate }) => { invalidate = onInvalidate; return () => {}; } };
  let latest;
  function Probe() {
    latest = useDocumentDefinitionRevisions({ enabled:true, file:FILE, checkedBundle:BUNDLE,
      actorUserId:ACTOR, owner:true, client, cache });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe)));
  await waitFor(() => latest?.canReview === true && typeof invalidate === 'function');
  const retained = latest.isAvailable;
  assert.equal(retained('module', 'module'), true);
  assert.equal(latest.modules[0].name, 'Old label');
  await act(async () => window.dispatchEvent(new window.Event('offline')));
  assert.equal(retained('module', 'module'), false, 'offline must fence a retained predicate now');
  server = second;
  await act(async () => window.dispatchEvent(new window.Event('online')));
  await waitFor(() => latest?.currentReceipt?.definitionRevision === 2);
  assert.equal(retained('module', 'module'), false);
  assert.equal(retained('entity', 'entity'), false);
  assert.deepEqual(latest.availableModules, []);
  assert.deepEqual(latest.availableEntities, []);
  assert.equal(latest.modules[0].name, 'Old label', 'canonical labels remain present');
});

test('retained availability fails closed between a refreshed receipt and its render', async t => {
  const restore = installDom();
  const first = receipt(1);
  const second = receipt(2, [{ kind:'module', id:'module' }]);
  let server = first;
  let invalidate;
  let storedSecond;
  const secondStored = new Promise(resolve => { storedSecond = resolve; });
  const cache = { getIntent:async () => null, getCurrentReceipt:async () => null,
    putCurrentReceipt:async (_actor, _document, value) => {
      if (value === second) storedSecond();
      return value;
    } };
  const client = { readCurrent:async () => server,
    subscribeCurrent:({ onInvalidate }) => { invalidate = onInvalidate; return () => {}; } };
  let latest;
  function Probe() {
    latest = useDocumentDefinitionRevisions({ enabled:true, file:FILE, checkedBundle:BUNDLE,
      actorUserId:ACTOR, owner:true, client, cache });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe)));
  await waitFor(() => latest?.canReview === true && typeof invalidate === 'function');
  const retained = latest.isAvailable;
  server = second;
  await act(async () => {
    invalidate();
    await secondStored;
    await Promise.resolve();
    assert.equal(retained('module', 'module'), false,
      'receipt identity must fence the old projection before React commits');
  });
});

test('a delayed V2 discovery from an old actor scope creates no intent', async t => {
  const restore = installDom();
  const current = receipt(1);
  let resolvePreview;
  const cacheCalls = [];
  const cache = { getIntent:async () => null, getCurrentReceipt:async () => null,
    putCurrentReceipt:async () => current,
    reserveIntent:async () => { cacheCalls.push('reserve'); } };
  const client = { readCurrent:async () => current,
    preview:async () => new Promise(resolve => { resolvePreview = resolve; }) };
  let actor = ACTOR;
  let latest;
  function Probe() {
    latest = useDocumentDefinitionRevisions({ enabled:true, file:FILE, checkedBundle:BUNDLE,
      actorUserId:actor, owner:true, client, cache,
      isCurrent:value => value.actorUserId === actor });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe)));
  await waitFor(() => latest?.canReview === true);
  let pending;
  await act(async () => {
    pending = latest.requestReview({ version:2, surveyTemplate:null,
      entityTemplate:null, retiredSemanticRoots:[] });
    await Promise.resolve();
  });
  await waitFor(() => typeof resolvePreview === 'function');
  actor = ACTOR_B;
  await act(async () => root.render(React.createElement(Probe)));
  await act(async () => {
    resolvePreview({ status:'retirement-required', version:2 });
    await assert.rejects(pending, /document or account changed/i);
  });
  assert.deepEqual(cacheCalls, []);
});
