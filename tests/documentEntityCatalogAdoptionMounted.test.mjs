import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { transformWithOxc } from 'vite';
import { useDocumentEntityCatalog } from '../src/hooks/useDocumentEntityCatalog.js';
import { createDocumentEntityAdoptionIntentStore } from '../src/services/documentEntityAdoptionIntentStore.js';
import { documentEntityAdoptionIdentity } from '../src/services/documentEntityCatalog.js';
import {
  buildLocalDocumentState,
  createLocalDocumentStateReader,
  isManagedLocalDocument,
} from '../src/services/localDocumentState.js';
import { createLocalDocumentStore } from '../src/services/localDocumentStore.js';
import { deriveCalloutsFromByPage } from '../src/utils/calloutAnnotationBridge.js';

const require = createRequire(import.meta.url);
const noticeUrl = new URL('../src/components/DocumentEntityCatalogAdoptionNotice.jsx', import.meta.url);
const noticeSource = (await transformWithOxc(await readFile(noticeUrl, 'utf8'), noticeUrl.pathname, {
  lang: 'jsx',
})).code
  .replace('"react"', JSON.stringify(pathToFileURL(require.resolve('react')).href))
  .replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const DocumentEntityCatalogAdoptionNotice = (await import(`data:text/javascript;base64,${Buffer.from(
  noticeSource,
).toString('base64')}`)).default;
const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const exportColorStart = viewerSource.indexOf('const entityId = actualSurveyMarker?.entityId || moduleData.entityId;');
const exportColorEnd = viewerSource.indexOf('\n\n              row.push(values.notes)', exportColorStart);
assert.ok(exportColorStart > 0 && exportColorEnd > exportColorStart, 'test the real Excel export color fallback');
const exportColor = new Function('actualSurveyMarker', 'moduleData', 'entities', 'getHexFromColor',
  `${viewerSource.slice(exportColorStart, exportColorEnd)}\nreturn entityColor;`);
const localPersistStart = viewerSource.indexOf('  const captureManagedLocalSnapshot = (file, snapshot) =>');
const localPersistEnd = viewerSource.indexOf('  const handleSaveDocument = useCallback(', localPersistStart);
assert.ok(localPersistStart > 0 && localPersistEnd > localPersistStart,
  'test the real managed-local save queue');
const actualLocalPersistence = scope => new Function(...Object.keys(scope),
  `${viewerSource.slice(localPersistStart, localPersistEnd)}\nreturn { captureManagedLocalSnapshot, persistManagedLocalSnapshot };`)(
  ...Object.values(scope));
const pagePersistStart = viewerSource.indexOf('  const persistPageMutationFile = useCallback(');
const pagePersistEnd = viewerSource.indexOf('  const checkedReplacementSessionRef = useRef(', pagePersistStart);
assert.ok(pagePersistStart > 0 && pagePersistEnd > pagePersistStart,
  'test the real managed-local page mutation persistence');
const actualPageMutationPersistence = scope => new Function(...Object.keys(scope),
  `${viewerSource.slice(pagePersistStart, pagePersistEnd)}\nreturn persistPageMutationFile;`)(
  ...Object.values(scope));

const id = n => `b1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorA = id(1);
const actorB = id(2);
const docA = id(3);
const docB = id(4);
const templateId = id(5);
const updatedAt = '2026-09-09T12:00:00.000Z';
const digest = 'a'.repeat(64);
const entity = (entityId, name, color = '#112233') => ({ id: entityId, name, color,
  opacity: 0.7, borderColor: '#445566', borderOpacity: 0.5, matchFill: false });
const template = (name, entities) => ({ id: templateId, name, updatedAt, entities });
const unadopted = documentId => ({ status: 'unadopted', version: 1, documentId });
const preview = (documentId, entities) => ({ status: 'preview', version: 1, documentId,
  source: { templateId, templateUpdatedAt: updatedAt, entitiesSha256: digest }, entities });
const accepted = (documentId, entities, seed = {
  operationId: id(80), requestSha256: 'b'.repeat(64),
}) => ({ status: 'accepted', version: 1, documentId, catalogRevision: 1,
  source: { templateId, templateUpdatedAt: updatedAt, entitiesSha256: digest }, seed, entities });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const waitFor = async predicate => {
  for (let tries = 0; tries < 100; tries++) {
    if (predicate()) return;
    await act(async () => new Promise(resolve => setImmediate(resolve)));
  }
  assert.fail('mounted catalog state did not settle');
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

function Probe({ input, report }) {
  const value = useDocumentEntityCatalog(input);
  report(value);
  return null;
}

test('real review notice lists the frozen preview and needs an explicit confirm click', async t => {
  const root = mounted(t);
  const reviewed = { kind: 'cloud', templateName: 'Reviewed template',
    preview: preview(docA, [entity('owner', 'Owner')]) };
  let confirms = 0;
  let cancels = 0;
  await act(async () => root.render(React.createElement(DocumentEntityCatalogAdoptionNotice, {
    review: reviewed, onConfirm: () => { confirms++; }, onCancel: () => { cancels++; },
  })));
  assert.match(document.body.textContent, /Later template edits will not change it/);
  assert.match(document.body.textContent, /Owner/);
  assert.equal(confirms, 0);
  const buttons = [...document.querySelectorAll('button')];
  await act(async () => buttons.find(button => /Use for this document/.test(button.textContent)).click());
  assert.equal(confirms, 1);
  await act(async () => buttons.find(button => /Keep current choices/.test(button.textContent)).click());
  assert.equal(cancels, 1);
});

test('actual Excel export fallback keeps stored marker module color ahead of a changed template candidate', () => {
  const marker = Object.freeze({ id: 'mark-1', entityId: 'old-id' });
  const before = structuredClone(marker);
  const color = exportColor(marker, { entityId: 'old-id', entityColor: '#112233' },
    [{ id: 'old-id', color: '#abcdef' }], value => value);
  assert.equal(color, '#112233');
  assert.deepEqual(marker, before, 'export fallback never rewrites the historical marker snapshot');
});

test('a legacy marker with no color uses the legacy template list, not a later adopted-list color', () => {
  const marker = Object.freeze({ id: 'mark-legacy', entityId: 'same-id' });
  const legacyEntities = [entity('same-id', 'Legacy', '#112233')];
  const adoptedEntities = [entity('same-id', 'Adopted', '#abcdef')];
  assert.equal(exportColor(marker, { entityId: 'same-id' }, legacyEntities, value => value), '#112233');
  assert.equal(exportColor(marker, { entityId: 'same-id' }, adoptedEntities, value => value), '#abcdef',
    'the caller must pass the legacy list for an unadopted marker without a stored color');
});

test('flag-off cloud and raw files expose old template choices with zero RPC or durable-store work', async t => {
  const root = mounted(t);
  const legacy = [entity('legacy', 'Legacy')];
  let latest;
  let work = 0;
  const cloudClient = new Proxy({}, { get: () => async () => { work++; } });
  const adoptionStore = new Proxy({}, { get: () => async () => { work++; } });
  const render = file => act(async () => root.render(React.createElement(Probe, {
    input: { enabled: false, file, actorUserId: actorA, template: template('Legacy', legacy),
      cloudClient, adoptionStore }, report: value => { latest = value; },
  })));
  await render({ id: docA, pdfGenerationId: id(6) });
  assert.equal(latest.mode, 'legacy');
  assert.deepEqual(latest.entities, legacy);
  await render(new File(['raw'], 'raw.pdf', { type: 'application/pdf' }));
  assert.equal(latest.mode, 'legacy');
  assert.deepEqual(latest.entities, legacy);
  assert.equal(work, 0);
});

test('actual managed-local queue retains adopted catalog and newest annotations across an overlapping save', async () => {
  const localId = `local:${id(30)}`;
  const file = { localId, localRevision: 1 };
  const catalog = await (await import('../src/services/documentEntityCatalog.js'))
    .captureManagedLocalEntityCatalog({ localId, template: template('Local', [entity('member', 'Member')]) });
  const pendingManagedEntityCatalog = { file, localId, catalog };
  const pendingManagedEntityCatalogRef = { current: pendingManagedEntityCatalog };
  const managedLocalStateRef = { current: { items: {}, annotations: {}, deletedPdfAnnotations: [],
    callouts: [], pageNames: {}, bookmarks: [], activeSpaceId: null, pageTransformations: {},
    regionOverlayDisabled: {}, entityCatalog: catalog } };
  const saves = [];
  const first = deferred();
  const persistEntityCatalogRef = { current: null };
  const annotationsByPageRef = { current: { 1: { objects: [{ id: 'before' }] } } };
  const helpers = actualLocalPersistence({ entityCatalog: { mode: 'accepted', busy: false },
    pendingManagedEntityCatalog,
    pendingManagedEntityCatalogRef, buildLocalDocumentState, managedLocalStateRef,
    surveyMarkersRef: { current: {} }, spacesRef: { current: [] },
    managedLocalWritesRef: { current: new WeakMap() },
    saveDocumentScopeRef: { current: { pdfFile: file, pdfId: localId, actorUserId: actorA,
      managedLocalReady: true } }, managedLocalPageMutationRef: { current: false },
    annotationsByPageRef, persistEntityCatalogRef,
    managedEntityCatalogReadyRef: { current: { file, ready: true } },
    saveManagedLocalState: async (_localId, state, { expectedRevision }) => {
      saves.push(structuredClone(state));
      if (saves.length === 1) await first.promise;
      assert.equal(expectedRevision, file.localRevision);
      return { revision: expectedRevision + 1 };
    },
  });
  const adoption = persistEntityCatalogRef.current(file, catalog);
  annotationsByPageRef.current = { 1: { objects: [{ id: 'newest' }] } };
  const newestState = helpers.captureManagedLocalSnapshot(file, annotationsByPageRef.current);
  const normalSave = helpers.persistManagedLocalSnapshot(file, annotationsByPageRef.current, newestState);
  first.resolve();
  await Promise.all([adoption, normalSave]);
  assert.equal(saves.length, 2);
  const finalEntries = saves[1].entries;
  assert.deepEqual(JSON.parse(finalEntries[`annotationsByPage_${localId}`]), annotationsByPageRef.current);
  assert.deepEqual(JSON.parse(finalEntries[`entityCatalog_${localId}`]), catalog);
  assert.equal(file.localRevision, 3);
});

test('an explicit adoption queues behind an older normal save and becomes the final durable state', async () => {
  const localId = `local:${id(34)}`;
  const file = { localId, localRevision: 5 };
  const catalog = await (await import('../src/services/documentEntityCatalog.js'))
    .captureManagedLocalEntityCatalog({ localId,
      template: template('Local', [entity('accepted', 'Accepted')]) });
  const first = deferred();
  const saves = [];
  const persistEntityCatalogRef = { current: null };
  const annotationsByPageRef = { current: { 1: { objects: [{ id: 'adoption-view' }] } } };
  const sharedState = { items: {}, annotations: {}, deletedPdfAnnotations: [], callouts: [],
    pageNames: {}, bookmarks: [], activeSpaceId: null, pageTransformations: {},
    regionOverlayDisabled: {}, entityCatalog: null };
  const helpers = actualLocalPersistence({ entityCatalog: { mode: 'legacy', busy: false, catalog: null },
    pendingManagedEntityCatalog: null, pendingManagedEntityCatalogRef: { current: null },
    managedEntityCatalogReadyRef: { current: { file, ready: true } }, buildLocalDocumentState,
    managedLocalStateRef: { current: sharedState }, surveyMarkersRef: { current: {} },
    spacesRef: { current: [] }, managedLocalWritesRef: { current: new WeakMap() },
    saveDocumentScopeRef: { current: { pdfFile: file, pdfId: localId, actorUserId: actorA,
      managedLocalReady: true } }, managedLocalPageMutationRef: { current: false },
    annotationsByPageRef, persistEntityCatalogRef,
    saveManagedLocalState: async (_id, state, { expectedRevision }) => {
      saves.push(structuredClone(state));
      if (saves.length === 1) await first.promise;
      return { revision: expectedRevision + 1 };
    },
  });
  const oldState = buildLocalDocumentState({ ...sharedState, pdfId: localId,
    annotationsByPage: { 1: { objects: [{ id: 'old-save' }] } } });
  const normal = helpers.persistManagedLocalSnapshot(file,
    { 1: { objects: [{ id: 'old-save' }] } }, oldState);
  const adoption = persistEntityCatalogRef.current(file, catalog);
  first.resolve();
  await Promise.all([normal, adoption]);
  assert.equal(saves.length, 2);
  assert.equal(saves[0].entries[`entityCatalog_${localId}`], undefined);
  assert.deepEqual(JSON.parse(saves[1].entries[`entityCatalog_${localId}`]), catalog);
  assert.deepEqual(JSON.parse(saves[1].entries[`annotationsByPage_${localId}`]),
    annotationsByPageRef.current);
  assert.equal(file.localRevision, 7);
});

test('actual page mutation persistence carries the accepted catalog into reopen state', async () => {
  const localId = `local:${id(35)}`;
  const catalog = await (await import('../src/services/documentEntityCatalog.js'))
    .captureManagedLocalEntityCatalog({ localId,
      template: template('Local', [entity('page-member', 'Page Member')]) });
  const file = { storageMode: 'local', localId, _surveyPdfId: localId };
  let updated = null;
  const persistPageMutationFile = actualPageMutationPersistence({ useCallback: fn => fn,
    isManagedLocalDocument, entityCatalog: { mode: 'accepted', busy: false, catalog },
    buildLocalDocumentState, deriveCalloutsFromByPage,
    onUpdatePDFFile: value => { updated = value; }, tabId: 'tab-a' });
  persistPageMutationFile(file, { items: {}, annotations: {}, deletedPdfAnnotations: [],
    annotationsByPage: { 3: { objects: [{ id: 'page-edit' }] } }, pageNames: {}, bookmarks: [],
    activeSpaceId: null, pageTransformations: {}, regionOverlayDisabled: {} });
  assert.equal(updated, file);
  const reopened = createLocalDocumentStateReader(file);
  assert.deepEqual(JSON.parse(reopened.getItem(`entityCatalog_${localId}`)), catalog);
  assert.deepEqual(JSON.parse(reopened.getItem(`annotationsByPage_${localId}`)),
    { 3: { objects: [{ id: 'page-edit' }] } });
});

test('actual managed-local save never carries a pending catalog across an A-to-B document switch', () => {
  const localIdA = `local:${id(31)}`;
  const localIdB = `local:${id(32)}`;
  const fileA = { localId: localIdA, localRevision: 1 };
  const fileB = { localId: localIdB, localRevision: 4 };
  const catalogA = { status: 'accepted', version: 1, documentId: localIdA,
    catalogRevision: 1, source: { templateId, templateUpdatedAt: updatedAt, entitiesSha256: digest },
    entities: [entity('member-a', 'Member A')] };
  const stalePending = { file: fileA, localId: localIdA, catalog: catalogA };
  const annotationsB = { 2: { objects: [{ id: 'new-b' }] } };
  const helpers = actualLocalPersistence({ entityCatalog: { mode: 'legacy', busy: false, catalog: null },
    pendingManagedEntityCatalog: null,
    pendingManagedEntityCatalogRef: { current: stalePending }, buildLocalDocumentState,
    managedLocalStateRef: { current: { items: {}, annotations: {}, deletedPdfAnnotations: [],
      callouts: [], pageNames: {}, bookmarks: [], activeSpaceId: null, pageTransformations: {},
      regionOverlayDisabled: {}, entityCatalog: null } },
    surveyMarkersRef: { current: {} }, spacesRef: { current: [] },
    managedLocalWritesRef: { current: new WeakMap() },
    saveDocumentScopeRef: { current: { pdfFile: fileB, pdfId: localIdB, actorUserId: actorA,
      managedLocalReady: true } }, managedLocalPageMutationRef: { current: false },
    annotationsByPageRef: { current: annotationsB }, persistEntityCatalogRef: { current: null },
    managedEntityCatalogReadyRef: { current: { file: fileB, ready: true } },
    saveManagedLocalState: async () => assert.fail('capture alone must not write'),
  });
  const stateB = helpers.captureManagedLocalSnapshot(fileB, annotationsB);
  assert.equal(Object.keys(stateB.entries).length, 6);
  assert.equal(stateB.entries[`entityCatalog_${localIdB}`], undefined);
  assert.equal(stateB.entries[`entityCatalog_${localIdA}`], undefined);
  assert.deepEqual(JSON.parse(stateB.entries[`annotationsByPage_${localIdB}`]), annotationsB);
});

test('failed catalog adoption cannot leak its pending catalog through a normal queued save', async () => {
  const localId = `local:${id(33)}`;
  const file = { localId, localRevision: 2 };
  const catalog = await (await import('../src/services/documentEntityCatalog.js'))
    .captureManagedLocalEntityCatalog({ localId,
      template: template('Local', [entity('pending', 'Pending')]) });
  const pendingManagedEntityCatalog = { file, localId, catalog };
  const writes = [];
  const helpers = actualLocalPersistence({ entityCatalog: { mode: 'legacy', busy: true, catalog: null },
    pendingManagedEntityCatalog, pendingManagedEntityCatalogRef: { current: pendingManagedEntityCatalog },
    buildLocalDocumentState, managedLocalStateRef: { current: { items: {}, annotations: {},
      deletedPdfAnnotations: [], callouts: [], pageNames: {}, bookmarks: [], activeSpaceId: null,
      pageTransformations: {}, regionOverlayDisabled: {}, entityCatalog: catalog } },
    surveyMarkersRef: { current: {} }, spacesRef: { current: [] },
    managedLocalWritesRef: { current: new WeakMap() },
    saveDocumentScopeRef: { current: { pdfFile: file, pdfId: localId, actorUserId: actorA,
      managedLocalReady: true } }, managedLocalPageMutationRef: { current: false },
    annotationsByPageRef: { current: { 1: { objects: [{ id: 'dirty' }] } } },
    persistEntityCatalogRef: { current: null },
    managedEntityCatalogReadyRef: { current: { file, ready: true } },
    saveManagedLocalState: async (_id, state) => {
      writes.push(state);
      throw new Error('disk full');
    },
  });
  const adoptionState = buildLocalDocumentState({ pdfId: localId,
    annotationsByPage: { 1: { objects: [{ id: 'dirty' }] } }, entityCatalog: catalog });
  await assert.rejects(helpers.persistManagedLocalSnapshot(file,
    { 1: { objects: [{ id: 'dirty' }] } }, adoptionState, true), /disk full/);
  assert.throws(() => helpers.captureManagedLocalSnapshot(file,
    { 1: { objects: [{ id: 'newer-dirty' }] } }), /must finish before saving/);
  assert.equal(writes.length, 1, 'only the explicit adoption write may contain the pending catalog');
  assert.ok(writes[0].entries[`entityCatalog_${localId}`]);
});

test('open never adopts, stable renders do not refetch, and later template edits do not change an accepted tab list', async t => {
  const root = mounted(t);
  const legacy = [entity('legacy', 'Legacy')];
  const members = [entity('member', 'Member')];
  const calls = [];
  const cloudClient = {
    read: async ({ documentId }) => { calls.push(['read', documentId]); return accepted(documentId, members); },
    preview: async () => assert.fail('open must not preview or seed'),
    adopt: async () => assert.fail('open must not adopt'),
  };
  let latest;
  const file = { id: docA, pdfGenerationId: id(6) };
  const stableCurrent = () => true;
  const render = async selectedTemplate => act(async () => root.render(React.createElement(Probe, {
    input: { enabled: true, file, actorUserId: actorA, template: selectedTemplate,
      cloudClient, isCurrent: stableCurrent },
    report: value => { latest = value; },
  })));
  await render(template('Original', legacy));
  await waitFor(() => latest.mode === 'accepted');
  assert.equal(latest.mode, 'accepted');
  assert.deepEqual(latest.entities, members);
  assert.deepEqual(calls, [['read', docA]]);
  await render(template('Edited', [entity('changed', 'Changed', '#abcdef')]));
  assert.deepEqual(latest.entities, members, 'accepted document members do not follow template edits');
  assert.deepEqual(calls, [['read', docA]], 'a stable rerender does not restart the catalog read');
});

test('a failed refresh keeps the last verified accepted list instead of exposing legacy template entities', async t => {
  const root = mounted(t);
  const members = [entity('member', 'Member')];
  const legacy = [entity('legacy', 'Legacy')];
  const adoptionStore = createDocumentEntityAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => adoptionStore.close());
  await adoptionStore.putAccepted(actorA, docA, accepted(docA, members));
  let latest;
  await act(async () => root.render(React.createElement(Probe, {
    input: { enabled: true, file: { id: docA, pdfGenerationId: id(6) }, actorUserId: actorA,
      template: template('Legacy', legacy), adoptionStore,
      cloudClient: { read: async () => { throw new Error('offline'); } } },
    report: value => { latest = value; },
  })));
  await waitFor(() => latest.mode === 'accepted' && /offline/.test(latest.error));
  assert.equal(latest.mode, 'accepted');
  assert.deepEqual(latest.entities, members);
  assert.match(latest.error, /offline/);
});

test('StrictMode read incarnations cannot let the first retired request replace the live result', async t => {
  const root = mounted(t);
  const gates = [];
  const cloudClient = { read: () => {
    const gate = deferred(); gates.push(gate); return gate.promise;
  } };
  let latest;
  await act(async () => root.render(React.createElement(React.StrictMode, null,
    React.createElement(Probe, {
      input: { enabled: true, file: { id: docA, pdfGenerationId: id(6) }, actorUserId: actorA,
        template: template('Legacy', [entity('legacy', 'Legacy')]), cloudClient },
      report: value => { latest = value; },
    }))));
  assert.equal(gates.length, 2, 'StrictMode starts a distinct replacement read');
  await act(async () => gates[0].resolve(accepted(docA, [entity('retired', 'Retired')])));
  assert.notEqual(latest.entities[0]?.id, 'retired');
  await act(async () => gates[1].resolve(accepted(docA, [entity('live', 'Live')])));
  await waitFor(() => latest.mode === 'accepted');
  assert.equal(latest.entities[0].id, 'live');
});

test('an authoritative different-seed result is not masked by an older accepted cache', async t => {
  const root = mounted(t);
  const adoptionStore = createDocumentEntityAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => adoptionStore.close());
  const reviewed = preview(docA, [entity('reviewed', 'Reviewed')]);
  const intendedOperation = id(81);
  const identity = await documentEntityAdoptionIdentity(reviewed, intendedOperation);
  await adoptionStore.reserve(actorA, docA, { preview: reviewed,
    operationId: intendedOperation, requestSha256: identity.requestSha256 });
  const oldCache = accepted(docA, [entity('old-cache', 'Old Cache')], {
    operationId: id(82), requestSha256: 'd'.repeat(64),
  });
  await adoptionStore.putAccepted(actorA, docA, oldCache);
  const otherSeed = accepted(docA, [entity('other', 'Other')], {
    operationId: id(83), requestSha256: 'e'.repeat(64),
  });
  let latest;
  const cloudClient = {
    read: async () => otherSeed,
    adopt: async () => { throw Object.assign(new Error('catalog already adopted'), {
      code: 'DOCUMENT_ENTITY_CATALOG_CONFLICT',
    }); },
  };
  await act(async () => root.render(React.createElement(Probe, {
    input: { enabled: true, file: { id: docA, pdfGenerationId: id(6) }, actorUserId: actorA,
      template: template('Legacy', [entity('legacy', 'Legacy')]), cloudClient, adoptionStore },
    report: value => { latest = value; },
  })));
  await waitFor(() => /already adopted/.test(latest.error));
  assert.equal(latest.mode, 'unknown');
  assert.deepEqual(latest.entities, []);
});

test('two tabs stay isolated and an actor A-B-A switch never exposes or applies the first A result', async t => {
  const root = mounted(t);
  const gates = [];
  const cloudClient = { read: ({ documentId }) => {
    const gate = deferred(); gates.push({ documentId, gate }); return gate.promise;
  } };
  const seen = [];
  const fileA = { id: docA, pdfGenerationId: id(6) };
  const fileB = { id: docB, pdfGenerationId: id(7) };
  const legacy = template('Legacy', [entity('legacy', 'Legacy')]);
  let actor = actorA;
  const draw = async () => act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(Probe, { input: { enabled: true, file: fileA, actorUserId: actor,
      template: legacy, cloudClient }, report: value => seen.push({ actor, tab: 'A', value }) }),
    React.createElement(Probe, { input: { enabled: true, file: fileB, actorUserId: actor,
      template: legacy, cloudClient }, report: value => seen.push({ actor, tab: 'B', value }) }),
  )));
  await draw();
  actor = actorB; await draw();
  actor = actorA; await draw();
  const oldA = gates[0];
  await act(async () => oldA.gate.resolve(accepted(oldA.documentId, [entity('stale', 'Stale')])));
  assert.equal(seen.at(-2).value.entities.some(item => item.id === 'stale'), false);
  assert.equal(seen.at(-1).value.entities.some(item => item.id === 'stale'), false);
  const newest = gates.slice(-2);
  await act(async () => {
    newest[0].gate.resolve(accepted(docA, [entity('tab-a', 'Tab A')]));
    newest[1].gate.resolve(accepted(docB, [entity('tab-b', 'Tab B')]));
  });
  const finalA = [...seen].reverse().find(row => row.tab === 'A').value;
  const finalB = [...seen].reverse().find(row => row.tab === 'B').value;
  assert.equal(finalA.entities[0].id, 'tab-a');
  assert.equal(finalB.entities[0].id, 'tab-b');
});

test('retired callbacks cannot start RPCs and an account switch during failed adopt cannot run recovery read', async t => {
  const root = mounted(t);
  const members = [entity('member', 'Member')];
  let latest;
  const calls = [];
  const adoptGate = deferred();
  const adoptionStore = createDocumentEntityAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => adoptionStore.close());
  const cloudClient = {
    read: async ({ documentId }) => { calls.push(['read', documentId]); return unadopted(documentId); },
    preview: async ({ documentId }) => { calls.push(['preview', documentId]); return preview(documentId, members); },
    adopt: async ({ preview: value }) => { calls.push(['adopt', value.documentId]); return adoptGate.promise; },
  };
  let actor = actorA;
  const file = { id: docA, pdfGenerationId: id(6) };
  const selectedTemplate = template('Original', [entity('legacy', 'Legacy')]);
  const draw = async () => act(async () => root.render(React.createElement(Probe, {
    input: { enabled: true, file, actorUserId: actor, template: selectedTemplate,
      cloudClient, adoptionStore },
    report: value => { latest = value; },
  })));
  await draw();
  await waitFor(() => latest.mode === 'legacy');
  await act(async () => latest.requestAdoption());
  const retiredRequest = latest.requestAdoption;
  let confirm;
  act(() => { confirm = latest.confirmAdoption(); });
  await waitFor(() => calls.some(([name]) => name === 'adopt'));
  actor = actorB;
  await draw();
  await act(async () => {
    adoptGate.reject(new Error('reply lost'));
    await assert.rejects(confirm);
  });
  assert.equal(calls.filter(([name]) => name === 'read').length, 2,
    'only each actor open may read; stale failed adoption must not recover into the new actor');
  await act(async () => root.render(null));
  const before = calls.length;
  await assert.rejects(retiredRequest());
  assert.equal(calls.length, before, 'a retained unmounted callback cannot start a preview RPC');
});

test('account switch while intent reserve waits cannot dispatch or adopt the retired operation', async t => {
  const root = mounted(t);
  const reserveGate = deferred();
  let reserves = 0;
  let dispatches = 0;
  let adopts = 0;
  const adoptionStore = {
    get: async () => null,
    getAccepted: async () => null,
    reserve: async () => { reserves++; return reserveGate.promise; },
    markDispatched: async () => { dispatches++; assert.fail('retired reserve must not dispatch'); },
    putAccepted: async () => assert.fail('retired reserve must not cache'),
    finish: async () => assert.fail('retired reserve must not finish'),
  };
  const cloudClient = {
    read: async ({ documentId }) => unadopted(documentId),
    preview: async ({ documentId }) => preview(documentId, [entity('member', 'Member')]),
    adopt: async () => { adopts++; assert.fail('retired reserve must not adopt'); },
  };
  let actor = actorA;
  let latest;
  const file = { id: docA, pdfGenerationId: id(6) };
  const selectedTemplate = template('Original', [entity('legacy', 'Legacy')]);
  const draw = async () => act(async () => root.render(React.createElement(Probe, {
    input: { enabled: true, file, actorUserId: actor, template: selectedTemplate,
      cloudClient, adoptionStore }, report: value => { latest = value; },
  })));
  await draw();
  await waitFor(() => latest.mode === 'legacy');
  await act(async () => latest.requestAdoption());
  let confirm;
  act(() => { confirm = latest.confirmAdoption(); });
  await waitFor(() => reserves === 1);
  actor = actorB;
  await draw();
  await act(async () => {
    reserveGate.resolve({ row: { phase: 'pending', revision: 1, operationId: id(90),
      requestSha256: 'c'.repeat(64) }, created: true });
    await assert.rejects(confirm, /document or account changed/i);
  });
  assert.equal(dispatches, 0);
  assert.equal(adopts, 0);
});

test('managed-local adoption commits before display, reloads by stable localId, and failed persistence keeps legacy active with no RPC', async t => {
  const root = mounted(t);
  const localStore = createLocalDocumentStore({ indexedDB: new IDBFactory() });
  t.after(() => localStore.close());
  const imported = await localStore.importLocalDocument(new File(['%PDF-1.7\n%%EOF'], 'local.pdf', {
    type: 'application/pdf',
  }));
  const localId = imported.localId;
  await localStore.saveLocalDocumentState(localId, buildLocalDocumentState({ pdfId: localId }), {
    expectedRevision: 1,
  });
  let file = await localStore.openLocalDocument(localId);
  const legacy = [entity('legacy', 'Legacy')];
  const selectedTemplate = template('Local', [entity('local', 'Local')]);
  let latest;
  let rpcCalls = 0;
  let fail = true;
  const cloudClient = { read: async () => { rpcCalls++; }, preview: async () => { rpcCalls++; }, adopt: async () => { rpcCalls++; } };
  const readManagedLocal = value => {
    const raw = createLocalDocumentStateReader(value).getItem(`entityCatalog_${localId}`);
    return raw ? JSON.parse(raw) : null;
  };
  const persistManagedLocal = async (ownedFile, catalog) => {
    assert.equal(ownedFile.localId, localId);
    assert.equal(ownedFile.localRevision, 2);
    const state = buildLocalDocumentState({ pdfId: localId, entityCatalog: catalog });
    await localStore.saveLocalDocumentState(localId, state, {
      expectedRevision: fail ? 1 : ownedFile.localRevision,
    });
    file = await localStore.openLocalDocument(localId);
  };
  const draw = async () => act(async () => root.render(React.createElement(Probe, {
    input: { enabled: true, file, actorUserId: actorA, template: { ...selectedTemplate, entities: legacy },
      cloudClient, readManagedLocal, persistManagedLocal }, report: value => { latest = value; },
  })));
  await draw();
  await act(async () => latest.requestAdoption(selectedTemplate));
  await act(async () => assert.rejects(latest.confirmAdoption(), { code: 'revision-conflict' }));
  assert.equal(latest.mode, 'legacy');
  assert.deepEqual(latest.entities, legacy);
  assert.equal(rpcCalls, 0);
  assert.equal(Object.keys((await localStore.openLocalDocument(localId))._localDocumentState.entries).length, 6,
    'failed CAS leaves the prior durable list untouched');
  fail = false;
  await act(async () => latest.confirmAdoption());
  assert.equal(latest.mode, 'accepted');
  assert.equal(latest.entities[0].id, 'local');
  assert.equal(file.localRevision, 3);
  assert.equal(Object.keys(file._localDocumentState.entries).length, 7);
  assert.ok(file._localDocumentState.entries[`entityCatalog_${localId}`]);

  await act(async () => root.render(React.createElement(Probe, { key: 'cold-reload',
    input: { enabled: true, file, actorUserId: actorA, template: { ...selectedTemplate, entities: legacy },
      cloudClient, readManagedLocal, persistManagedLocal }, report: value => { latest = value; },
  })));
  assert.equal(latest.mode, 'accepted');
  assert.equal(latest.entities[0].id, 'local');
  assert.equal(rpcCalls, 0);

  const untouched = buildLocalDocumentState({ pdfId: `local:${id(21)}` });
  assert.equal(Object.keys(untouched.entries).length, 6, 'legacy local saves keep the exact six-key shape');
});

test('an unreadable saved local catalog blocks adoption and save state instead of stripping its seventh entry', async t => {
  const root = mounted(t);
  const localId = `local:${id(40)}`;
  const state = buildLocalDocumentState({ pdfId: localId });
  state.entries[`entityCatalog_${localId}`] = JSON.stringify(null);
  const file = { storageMode: 'local', localId, _surveyPdfId: localId, localRevision: 7,
    _localDocumentState: state };
  const readManagedLocal = value => {
    const raw = createLocalDocumentStateReader(value).getItem(`entityCatalog_${localId}`);
    return raw ? JSON.parse(raw) : null;
  };
  let latest;
  await act(async () => root.render(React.createElement(Probe, {
    input: { enabled: true, file, actorUserId: actorA,
      template: template('Legacy', [entity('legacy', 'Legacy')]), readManagedLocal,
      persistManagedLocal: async () => assert.fail('corrupt catalog must not be replaced') },
    report: value => { latest = value; },
  })));
  assert.equal(latest.mode, 'unknown');
  assert.deepEqual(latest.entities, []);
  assert.match(latest.error, /saved|invalid|catalog/i);
  await assert.rejects(latest.requestAdoption(), /saved|invalid|catalog/i);
  assert.equal(Object.keys(file._localDocumentState.entries).length, 7);
});
