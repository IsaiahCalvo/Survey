import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { useDocumentSurveyDefinition } from '../src/hooks/useDocumentSurveyDefinition.js';
import { documentSurveyDefinitionAdoptionIdentity }
  from '../src/services/documentSurveyDefinition.js';
import { createDocumentSurveyDefinitionAdoptionIntentStore }
  from '../src/services/documentSurveyDefinitionAdoptionIntentStore.js';

const id = n => `d6000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorA = id(1), actorB = id(2), documentId = id(3), templateId = id(4);
const operationId = id(5);
const modules = Object.freeze([{ id: 'module', name: 'Walls', categories: Object.freeze([
  { id: 'category', name: 'General', checklist: Object.freeze([{ id: 'check', text: 'Installed' }]) },
]) }]);
const source = Object.freeze({ templateId, templateUpdatedAt: '2026-09-09T12:00:00Z',
  structureSha256: 'a'.repeat(64) });
const preview = Object.freeze({ status: 'preview', version: 1, documentId, source, modules });
const accepted = (seed = { operationId, requestSha256: 'b'.repeat(64) }) => Object.freeze({
  status: 'accepted', version: 1, documentId, definitionRevision: 1, source, seed, modules,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function mounted(t) {
  const dom = new JSDOM('<div id="root"></div>');
  const prior = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of [...prior].reverse()) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return root;
}

const waitFor = async predicate => {
  for (let tries = 0; tries < 100; tries++) {
    if (predicate()) return;
    await act(async () => new Promise(resolve => setImmediate(resolve)));
  }
  assert.fail('mounted survey-definition state did not settle');
};

function Probe({ input, report }) {
  const value = useDocumentSurveyDefinition(input);
  report(value);
  return null;
}

test('intent store owns caller input before IndexedDB opens and keeps exact actor scope', async t => {
  const indexedDB = new IDBFactory();
  const store = createDocumentSurveyDefinitionAdoptionIntentStore({ indexedDB });
  t.after(() => store.close());
  const identity = await documentSurveyDefinitionAdoptionIdentity(preview, operationId);
  const input = { preview, operationId, requestSha256: identity.requestSha256 };
  const saving = store.reserve(actorA, documentId, input);
  input.operationId = id(90);
  input.requestSha256 = 'f'.repeat(64);
  const reserved = await saving;
  assert.equal(reserved.row.operationId, operationId);
  assert.equal(reserved.row.requestSha256, identity.requestSha256);
  assert.equal(await store.get(actorB, documentId), null);
  const dispatched = await store.markDispatched(actorA, documentId,
    reserved.row.revision, reserved.row.operationId);
  assert.equal(dispatched.phase, 'dispatched');
  assert.equal(await store.finish(actorA, documentId, dispatched.revision,
    dispatched.operationId, dispatched.requestSha256), true);
});

test('accepted cache is immutable and survives a new store instance', async t => {
  const indexedDB = new IDBFactory();
  const first = createDocumentSurveyDefinitionAdoptionIntentStore({ indexedDB });
  const value = accepted();
  await first.putAccepted(actorA, documentId, value);
  assert.deepEqual(await first.putAccepted(actorA, documentId, value), value);
  const conflicting = accepted({ operationId: id(91), requestSha256: 'e'.repeat(64) });
  await assert.rejects(first.putAccepted(actorA, documentId, conflicting), {
    code: 'DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_INVALID',
  });
  first.close();
  const reopened = createDocumentSurveyDefinitionAdoptionIntentStore({ indexedDB });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.getAccepted(actorA, documentId), value);
  assert.equal(await reopened.getAccepted(actorB, documentId), null);
});

test('managed-local accepted definition hydrates while disabled and adoption stays blocked', async t => {
  const root = mounted(t);
  const localId = `local:${id(20)}`;
  const localDefinition = { status: 'accepted', version: 1, documentId: localId,
    definitionRevision: 1, sourceTemplateId: 'local-template', sourceTemplateUpdatedAt: null,
    sourceStructureSha256: 'c'.repeat(64), modules };
  const file = { storageMode: 'local', localId, _surveyPdfId: localId };
  let latest;
  await act(async () => root.render(React.createElement(Probe, { input: {
    enabled: false, file, readManagedLocal: () => localDefinition,
    cloudClient: { read: () => assert.fail('local open must not call cloud') },
  }, report: value => { latest = value; } })));
  assert.equal(latest.mode, 'accepted');
  assert.deepEqual(latest.modules, modules);
  await assert.rejects(latest.requestAdoption({ id: 'template', modules }),
    /not enabled/);
});

test('restart reconciles one dispatched intent and clears it only after accepted cache', async t => {
  const root = mounted(t);
  const store = createDocumentSurveyDefinitionAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const identity = await documentSurveyDefinitionAdoptionIdentity(preview, operationId);
  const { row } = await store.reserve(actorA, documentId, { preview, operationId,
    requestSha256: identity.requestSha256 });
  const dispatched = await store.markDispatched(actorA, documentId, row.revision, operationId);
  const result = accepted({ operationId, requestSha256: identity.requestSha256 });
  const calls = [];
  let latest;
  await act(async () => root.render(React.createElement(Probe, { input: {
    enabled: true, file: { id: documentId, pdfGenerationId: id(30) }, actorUserId: actorA,
    adoptionStore: store, cloudClient: {
      read: async () => { calls.push('read'); return calls.length === 1
        ? { status: 'unadopted', version: 1, documentId } : result; },
      adopt: async ({ operationId: sent }) => { calls.push(`adopt:${sent}`); return result; },
    },
  }, report: value => { latest = value; } })));
  await waitFor(() => latest?.mode === 'accepted');
  assert.deepEqual(calls, ['read', `adopt:${operationId}`]);
  assert.equal(await store.get(actorA, documentId), null);
  assert.deepEqual(await store.getAccepted(actorA, documentId), result);
  assert.equal(dispatched.revision, 2);
});

test('scope switch suppresses a late read and forbidden refresh does not expose cache', async t => {
  const root = mounted(t);
  const store = createDocumentSurveyDefinitionAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  await store.putAccepted(actorA, documentId, accepted());
  const late = deferred();
  let latest;
  const report = value => { latest = value; };
  await act(async () => root.render(React.createElement(Probe, { input: {
    enabled: true, file: { id: documentId, pdfGenerationId: id(31) }, actorUserId: actorA,
    adoptionStore: store, cloudClient: { read: () => late.promise },
  }, report })));
  await act(async () => root.render(React.createElement(Probe, { input: {
    enabled: true, file: { id: id(40), pdfGenerationId: id(41) }, actorUserId: actorB,
    adoptionStore: store, cloudClient: { read: async () => {
      throw Object.assign(new Error('private server text'), { code: 'DOCUMENT_SURVEY_DEFINITION_FORBIDDEN' });
    } },
  }, report })));
  late.resolve(accepted());
  await waitFor(() => latest?.error);
  assert.equal(latest.mode, 'unknown');
  assert.equal(latest.definition, null);
  assert.doesNotMatch(latest.error, /private server text/);
});

test('same-scope retained actions cannot replace an immutable local definition or revive a canceled review', async t => {
  const root = mounted(t);
  const localId = `local:${id(50)}`;
  const file = { storageMode: 'local', localId, _surveyPdfId: localId };
  const firstTemplate = { id: 'template-one', name: 'First', modules };
  const secondTemplate = { id: 'template-two', name: 'Second', modules };
  const writes = [];
  let latest;
  const report = value => { latest = value; };
  const input = { enabled: true, file, readManagedLocal: () => null,
    persistManagedLocal: async (_file, definition) => { writes.push(definition); } };
  await act(async () => root.render(React.createElement(Probe, { input, report })));
  await assert.rejects(latest.requestAdoption({ id: 'linked-template', modules,
    config: { linkedExcelPath: '/linked/workbook.xlsx' } }), /Linked Excel/);
  await act(async () => { await latest.requestAdoption(firstTemplate); });
  const canceledConfirm = latest.confirmAdoption;
  await act(async () => { assert.equal(latest.cancelAdoption(), true); });
  await act(async () => { await latest.requestAdoption(secondTemplate); });
  await assert.rejects(canceledConfirm(), /Review this survey definition again/);
  assert.equal(writes.length, 0);
  const retainedRequest = latest.requestAdoption;
  await act(async () => { await latest.confirmAdoption(); });
  assert.equal(latest.mode, 'accepted');
  assert.equal(writes.length, 1);
  await assert.rejects(retainedRequest(firstTemplate), /already has a survey definition/);
  const retainedConfirm = latest.confirmAdoption;
  await assert.rejects(retainedConfirm(), /Review this survey definition again/);
  assert.equal(writes.length, 1);
});

test('unmount aborts an in-flight preview and retained callbacks stay retired', async t => {
  const root = mounted(t);
  const started = deferred();
  let previewSignal;
  let latest;
  await act(async () => root.render(React.createElement(Probe, { input: {
    enabled: true, file: { id: documentId, pdfGenerationId: id(60) }, actorUserId: actorA,
    adoptionStore: { get: async () => null, getAccepted: async () => null },
    cloudClient: {
      read: async () => ({ status: 'unadopted', version: 1, documentId }),
      preview: ({ signal }) => { previewSignal = signal; return started.promise; },
    },
  }, report: value => { latest = value; } })));
  await waitFor(() => latest?.mode === 'legacy');
  let request;
  await act(async () => {
    request = latest.requestAdoption({ id: templateId, supabaseId: templateId,
      name: 'Template', modules });
    await new Promise(resolve => setImmediate(resolve));
  });
  await waitFor(() => previewSignal);
  await act(async () => root.unmount());
  assert.equal(previewSignal.aborted, true);
  started.resolve(preview);
  await assert.rejects(request, /document or account changed/i);
  await assert.rejects(latest.requestAdoption(), /document or template changed/i);
});

test('forbidden refresh suppresses same-scope cache while transient failure keeps it', async t => {
  const root = mounted(t);
  const store = createDocumentSurveyDefinitionAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const cached = accepted();
  await store.putAccepted(actorA, documentId, cached);
  let latest;
  const report = value => { latest = value; };
  const file = { id: documentId, pdfGenerationId: id(70) };
  await act(async () => root.render(React.createElement(Probe, { input: {
    enabled: true, file, actorUserId: actorA, adoptionStore: store,
    cloudClient: { read: async () => {
      throw Object.assign(new Error('offline detail'), {
        code: 'DOCUMENT_SURVEY_DEFINITION_UNAVAILABLE',
      });
    } },
  }, report })));
  await waitFor(() => latest?.mode === 'accepted' && latest.error);
  assert.deepEqual(latest.definition, cached);
  assert.equal(latest.error, 'The document survey definition could not be loaded.');

  await act(async () => root.render(React.createElement(Probe, { input: {
    enabled: true, file: { ...file }, actorUserId: actorA, adoptionStore: store,
    cloudClient: { read: async () => {
      throw Object.assign(new Error('private server text'), {
        code: 'DOCUMENT_SURVEY_DEFINITION_FORBIDDEN',
      });
    } },
  }, report })));
  await waitFor(() => latest?.mode === 'unknown' && latest.error);
  assert.equal(latest.definition, null);
  assert.equal(latest.error, 'You no longer have access to this document survey definition.');
});
