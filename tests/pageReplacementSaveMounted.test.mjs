import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import React, { act, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { mutatePdfPagesWithIdentity } from '../src/utils/pdfPageMutation.js';
import { parse } from '@babel/parser';
import {
  createDocumentPageReplacementIntentStore,
} from '../src/services/documentPageReplacementIntentStore.js';
import { createDocumentPageReplacementClient } from '../src/services/documentPageReplacementClient.js';
import {
  checkedPageStructureKey,
  readCheckedPageStructure,
  saveCheckedPageStructure,
  transformCheckedPageStructure,
} from '../src/services/checkedPageStructure.js';

const id = n => `99100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorA = id(1);
const actorB = id(2);
const documentId = id(3);
const generationId = id(4);
const nextGenerationId = id(5);
const operation = () => ({ type: 'duplicate', page: 1 });
const localPageState = () => ({ items: {}, annotations: {}, pageNames: { 1: 'Private page' },
  bookmarks: [{ id: 'private-bookmark', pageNumber: 1 }],
  pageTransformations: {}, activeSpaceId: null,
  regionOverlayDisabled: new Map([['space-1-1', true]]) });
const reserveInput = changes => ({ operation: operation(), generationId, walHead: '17',
  localPageState: localPageState(), ...changes });
const require = createRequire(import.meta.url);
const appShellSource = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const appShellTree = parse(appShellSource, { sourceType: 'module', plugins: ['jsx'] });
const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const viewerTree = parse(viewerSource, { sourceType: 'module', plugins: ['jsx'] });
function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const result = findNode(child, predicate);
      if (result) return result;
    }
  }
  return null;
}
function actualEffect(source, tree, marker, scope) {
  const node = findNode(tree, candidate => candidate.type === 'CallExpression'
    && candidate.callee?.name === 'useEffect'
    && source.slice(candidate.start, candidate.end).includes(marker));
  assert.ok(node, `Missing production effect: ${marker}`);
  return Function(...Object.keys(scope), `return (${source.slice(
    node.arguments[0].start, node.arguments[0].end,
  )});`)(...Object.values(scope));
}
function actualHandler(source, tree, name, scope) {
  const node = findNode(tree, candidate => candidate.type === 'VariableDeclarator'
    && candidate.id?.name === name);
  assert.ok(node, `Missing production handler: ${name}`);
  const callback = node.init.type === 'CallExpression' ? node.init.arguments[0] : node.init;
  return Function(...Object.keys(scope), `return (${source.slice(callback.start, callback.end)});`)(
    ...Object.values(scope),
  );
}
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function publication(body, changes = {}) {
  return {
    version: 1,
    state: 'published',
    document_id: body.document_id,
    source_id: body.source_id,
    candidate_operation_id: body.candidate_operation_id,
    archive_operation_ids: [...body.archive_operation_ids],
    previous_generation_id: body.generation_id,
    generation_id: nextGenerationId,
    wal_head: body.wal_head,
    published_at: '2026-09-09T12:00:00.000Z',
    ...changes,
  };
}

test('real IndexedDB reserve fixes exact request IDs and cold reopen returns the same intent', async () => {
  const indexedDB = new IDBFactory();
  const first = createDocumentPageReplacementIntentStore({ indexedDB });
  const mutableOperation = operation();
  const { row: created, created: didCreate } = await first.reserve(actorA, documentId,
    reserveInput({ operation: mutableOperation }));
  mutableOperation.page = 99;
  assert.equal(didCreate, true);
  assert.equal(created.version, 1);
  assert.equal(created.revision, 1);
  assert.equal(created.phase, 'pending');
  assert.deepEqual(Object.keys(created.body).sort(), [
    'archive_operation_ids', 'candidate_operation_id', 'document_id',
    'generation_id', 'operation', 'source_id', 'wal_head',
  ]);
  assert.deepEqual(created.body.operation, operation());
  assert.equal(created.body.document_id, documentId);
  assert.equal(created.body.generation_id, generationId);
  assert.equal(created.body.wal_head, '17');
  assert.equal(new Set([
    created.body.source_id,
    created.body.candidate_operation_id,
    ...created.body.archive_operation_ids,
  ]).size, 3);

  const same = await first.reserve(actorA, documentId, reserveInput());
  assert.equal(same.created, false);
  assert.deepEqual(same.row, created, 'same intent must not mint replacement IDs');
  first.close();

  const cold = createDocumentPageReplacementIntentStore({ indexedDB });
  assert.deepEqual(await cold.get(actorA, documentId), created);
  assert.equal(await cold.get(actorB, documentId), null);
  const { row: otherActor } = await cold.reserve(actorB, documentId, reserveInput());
  assert.notEqual(otherActor.body.source_id, created.body.source_id);
  assert.deepEqual(await cold.get(actorA, documentId), created);
  cold.close();
});

test('unresolved intent rejects changed operation, generation, or frontier without changing saved IDs', async () => {
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  const { row: created } = await store.reserve(actorA, documentId, reserveInput());
  for (const changed of [
    reserveInput({ operation: { type: 'delete', page: 1 } }),
    reserveInput({ generationId: nextGenerationId }),
    reserveInput({ walHead: '18' }),
  ]) {
    await assert.rejects(store.reserve(actorA, documentId, changed), {
      code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED',
    });
    assert.deepEqual(await store.get(actorA, documentId), created);
  }
  store.close();
});

test('published receipt commits before cleanup and exact revision CAS protects recovery state', async () => {
  const indexedDB = new IDBFactory();
  const a = createDocumentPageReplacementIntentStore({ indexedDB });
  const b = createDocumentPageReplacementIntentStore({ indexedDB });
  const { row: created } = await a.reserve(actorA, documentId, reserveInput());
  const marked = await b.markPublished(
    actorA, documentId, created.revision, publication(created.body),
  );
  assert.equal(marked.phase, 'published');
  assert.equal(marked.revision, 2);
  assert.deepEqual((await a.get(actorA, documentId)).publication, publication(created.body));
  await assert.rejects(
    b.markPublished(actorA, documentId, marked.revision,
      publication(created.body, { generation_id: id(99) })),
    { code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED' },
  );
  assert.deepEqual((await a.get(actorA, documentId)).publication, publication(created.body));
  await assert.rejects(a.finish(actorA, documentId, 1), {
    code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED',
  });
  assert.equal((await a.get(actorA, documentId)).phase, 'published');
  assert.equal(await a.finish(actorA, documentId, 2), true);
  assert.equal(await b.get(actorA, documentId), null);
  a.close(); b.close();
});

test('concurrent same-intent reserve serializes to one fixed identity', async () => {
  const indexedDB = new IDBFactory();
  const a = createDocumentPageReplacementIntentStore({ indexedDB });
  const b = createDocumentPageReplacementIntentStore({ indexedDB });
  const leftState = { ...localPageState(), pageNames: { 1: 'left winner' } };
  const rightState = { ...localPageState(), pageNames: { 1: 'right winner' } };
  const [left, right] = await Promise.all([
    a.reserve(actorA, documentId, reserveInput({ localPageState: leftState })),
    b.reserve(actorA, documentId, reserveInput({ localPageState: rightState })),
  ]);
  assert.deepEqual(left.row, right.row);
  assert.deepEqual([left.created, right.created].sort(), [false, true]);
  assert.equal(left.row.revision, 1);
  assert.ok(['left winner', 'right winner'].includes(left.row.localPageState.pageNames[1]));
  const winner = left.created ? 'left winner' : 'right winner';
  assert.equal(left.row.localPageState.pageNames[1], winner);
  a.close(); b.close();
});

test('private page structure stays actor, document, and generation scoped while target remap is exact', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const source = localPageState();
  saveCheckedPageStructure({ storage, actorUserId: actorA, documentId, generationId, state: source });
  const transformed = transformCheckedPageStructure(source, operation());
  saveCheckedPageStructure({ storage, actorUserId: actorA, documentId,
    generationId: nextGenerationId, state: transformed });
  assert.equal(readCheckedPageStructure({ storage, actorUserId: actorA, documentId,
    generationId }).pageNames[1], 'Private page');
  const target = readCheckedPageStructure({ storage, actorUserId: actorA, documentId,
    generationId: nextGenerationId });
  assert.deepEqual(target.pageNames, { 1: 'Private page', 2: 'Private page' });
  assert.deepEqual(target.bookmarks[0].pageNumber, 1);
  assert.deepEqual(target.regionOverlayDisabled, { 'space-1-1': true, 'space-1-2': true });
  assert.deepEqual(readCheckedPageStructure({ storage, actorUserId: actorB, documentId,
    generationId: nextGenerationId }).pageNames, {});
  assert.deepEqual(readCheckedPageStructure({ storage, actorUserId: actorA, documentId,
    generationId: id(88) }).pageNames, {}, 'later generation gets no old one-step projection');
  assert.ok(memory.has(checkedPageStructureKey(actorA, documentId, generationId)));
});

test('checked rotation clears baked display angle but preserves private mirror state', () => {
  const source = { ...localPageState(), pageTransformations: {
    1: { rotation: 90, mirrorH: true, mirrorV: false },
  } };
  for (const delta of [180, 0]) {
    const target = transformCheckedPageStructure(source, { type: 'rotate', page: 1, delta });
    assert.deepEqual(target.pageTransformations[1], { rotation: 0, mirrorH: true, mirrorV: false });
  }
});

test('real PDF mutator bakes checked 90 degree local view plus clockwise or counterclockwise click', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 500]);
  const bytes = await pdf.save();
  const source = { ...localPageState(), pageTransformations: {
    1: { rotation: 90, mirrorH: true, mirrorV: false },
  } };
  for (const [delta, angle] of [[180, 180], [0, 0]]) {
    const operation = { type: 'rotate', page: 1, delta };
    const changed = await mutatePdfPagesWithIdentity(bytes, operation);
    const reopened = await PDFDocument.load(changed.bytes);
    assert.equal(reopened.getPage(0).getRotation().angle, angle);
    assert.deepEqual(transformCheckedPageStructure(source, operation).pageTransformations[1],
      { rotation: 0, mirrorH: true, mirrorV: false });
  }
});

function makeClient({ store, actor = actorA, current = () => true, transport,
  reacquire, events = [], token = 'local-test-token' } = {}) {
  return createDocumentPageReplacementClient({
    store,
    getActorUserId: () => actor,
    getAccessToken: async ({ actorUserId }) => {
      events.push('token');
      assert.equal(actorUserId, actor);
      return token;
    },
    isCurrent: scope => current(scope),
    transport: async input => {
      events.push('transport');
      return transport(input);
    },
    reacquire: async input => {
      events.push('reacquire');
      return reacquire(input);
    },
  });
}

const acceptedCapture = (changes = {}) => ({
  version: 1,
  actorUserId: actorA,
  documentId,
  pdfGenerationId: generationId,
  coveredSeq: 17,
  writerId: 'writer-fixture',
  annotationState: { pages: { 1: [{ id: 'accepted-mark' }] } },
  ...changes,
});

test('first checked page change captures accepted frontier before fixed request and installs only after durable receipt', async () => {
  const indexedDB = new IDBFactory();
  const store = createDocumentPageReplacementIntentStore({ indexedDB });
  const events = [];
  let sentBody;
  const checkedBundle = { pdfGenerationId: nextGenerationId, marker: 'exact-new-bundle' };
  const client = makeClient({ store, events,
    transport: async ({ body, accessToken }) => {
      events.push('server-publish');
      assert.equal(accessToken, 'local-test-token');
      sentBody = body;
      assert.equal((await store.get(actorA, documentId)).phase, 'dispatched');
      return new Response(JSON.stringify({ replacement: publication(body) }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    },
    reacquire: async ({ documentId: requested }) => {
      assert.equal(requested, documentId);
      assert.equal((await store.get(actorA, documentId)).phase, 'published');
      return { mode: 'checked', actorUserId: actorA, documentId, checkedBundle };
    },
  });
  const result = await client.replace({
    documentId,
    currentGenerationId: generationId,
    operation: operation(),
    localPageState: localPageState(),
    captureAccepted: async () => { events.push('capture'); return acceptedCapture(); },
    revalidateCapture: async capture => {
      events.push('revalidate');
      assert.equal(capture.annotationState.pages[1][0].id, 'accepted-mark');
      return true;
    },
    retireGeneration: async ({ replacementGenerationId }) => {
      events.push('retire'); assert.equal(replacementGenerationId, nextGenerationId);
    },
    persistSourceLocalState: async ({ generationId: sourceGeneration, localPageState: saved }) => {
      events.push('persist-source-local');
      assert.equal(sourceGeneration, generationId);
      assert.equal(saved.pageNames[1], 'Private page');
    },
    install: async ({ checkedBundle: installed, publication: receipt }) => {
      events.push('install');
      assert.equal(installed, checkedBundle);
      assert.equal(receipt.candidate_operation_id, sentBody.candidate_operation_id);
      assert.equal((await store.get(actorA, documentId)).phase, 'published');
      return true;
    },
  });
  assert.equal(result.checkedBundle, checkedBundle);
  assert.deepEqual(events, [
    'capture', 'revalidate', 'persist-source-local', 'token', 'transport', 'server-publish',
    'reacquire', 'retire', 'install',
  ]);
  assert.deepEqual(Object.keys(sentBody).sort(), [
    'archive_operation_ids', 'candidate_operation_id', 'document_id',
    'generation_id', 'operation', 'source_id', 'wal_head',
  ]);
  assert.equal(sentBody.wal_head, '17');
  assert.equal(await store.get(actorA, documentId), null, 'cleanup follows exact install');
  store.close();
});

test('uncertain response cold-reopens the same request IDs before any new capture', async () => {
  const indexedDB = new IDBFactory();
  const firstStore = createDocumentPageReplacementIntentStore({ indexedDB });
  let firstBody;
  const first = makeClient({ store: firstStore,
    transport: async ({ body }) => { firstBody = body; throw new Error('reply lost'); },
    reacquire: async () => assert.fail('uncertain response must not reopen'),
  });
  await assert.rejects(first.replace({
    documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
    captureAccepted: async () => acceptedCapture(),
    revalidateCapture: async () => true,
    retireGeneration: async () => {}, persistSourceLocalState: async () => {}, install: async () => true,
  }), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED' });
  assert.equal((await firstStore.get(actorA, documentId)).phase, 'dispatched');
  firstStore.close();

  const coldStore = createDocumentPageReplacementIntentStore({ indexedDB });
  let captures = 0;
  const cold = makeClient({ store: coldStore,
    transport: async ({ body }) => {
      assert.deepEqual(body, firstBody);
      return new Response(JSON.stringify({ replacement: publication(body) }));
    },
    reacquire: async () => ({ mode: 'checked', actorUserId: actorA, documentId,
      checkedBundle: { pdfGenerationId: nextGenerationId } }),
  });
  await cold.replace({
    documentId, currentGenerationId: generationId, operation: operation(),
    localPageState: { ...localPageState(), pageNames: { 1: 'stale viewer value' } },
    captureAccepted: async () => { captures++; return acceptedCapture({ coveredSeq: 99 }); },
    revalidateCapture: async () => { captures++; return false; },
    retireGeneration: async () => {}, persistSourceLocalState: async ({ localPageState: saved }) => {
      assert.equal(saved.pageNames[1], 'Private page');
    }, install: async () => true,
  });
  assert.equal(captures, 0, 'saved request resolves before stale current-frontier capture');
  assert.equal(await coldStore.get(actorA, documentId), null);
  coldStore.close();
});

test('changed page op resolves the saved exact request first without sending the new operation or IDs', async () => {
  const indexedDB = new IDBFactory();
  const store = createDocumentPageReplacementIntentStore({ indexedDB });
  const calls = [];
  const client = makeClient({ store,
    transport: async ({ body }) => {
      calls.push(body);
      return new Response(JSON.stringify({ error: { code: 'replacement_conflict' } }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      });
    },
    reacquire: async () => assert.fail('conflict must not reopen'),
  });
  const input = {
    documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
    captureAccepted: async () => acceptedCapture(), revalidateCapture: async () => true,
    retireGeneration: async () => {}, persistSourceLocalState: async () => {}, install: async () => true,
  };
  await assert.rejects(client.replace(input), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED' });
  const retained = await store.get(actorA, documentId);
  assert.equal(retained.phase, 'dispatched');
  await assert.rejects(client.replace({ ...input, operation: { type: 'delete', page: 1 } }), {
    code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED',
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0], 'retry sends the saved exact intent, not the new click');
  assert.deepEqual(await store.get(actorA, documentId), retained);
  store.close();
});

test('actor or tab retirement after remote reply cannot mark or install the old scope', async () => {
  for (const retirement of ['actor', 'tab']) {
    const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
    const gate = deferred();
    let actor = actorA;
    let mounted = true;
    let installs = 0;
    const client = createDocumentPageReplacementClient({
      store,
      getActorUserId: () => actor,
      getAccessToken: async () => 'local-test-token',
      isCurrent: ({ actorUserId, documentId: received }) => mounted
        && actorUserId === actor && received === documentId,
      transport: async ({ body }) => {
        await gate.promise;
        return new Response(JSON.stringify({ replacement: publication(body) }));
      },
      reacquire: async () => assert.fail('retired request must not reopen'),
    });
    const pending = client.replace({
      documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
      captureAccepted: async () => acceptedCapture(), revalidateCapture: async () => true,
      retireGeneration: async () => {}, persistSourceLocalState: async () => {},
      install: async () => { installs++; return true; },
    });
    while ((await store.get(actorA, documentId))?.phase !== 'dispatched') {
      await new Promise(resolve => setImmediate(resolve));
    }
    if (retirement === 'actor') actor = actorB;
    else mounted = false;
    gate.resolve();
    await assert.rejects(pending, { code: 'DOCUMENT_PAGE_REPLACEMENT_STALE' });
    assert.equal(installs, 0);
    assert.equal((await store.get(actorA, documentId)).phase, 'dispatched');
    store.close();
  }
});

test('accepted frontier movement discards a new pending intent so a fresh frontier can retry', async (t) => {
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const events = [];
  let sentBody = null;
  const client = makeClient({ store, events,
    transport: async ({ body }) => {
      sentBody = body;
      return new Response(JSON.stringify({ replacement: publication(body) }));
    },
    reacquire: async () => ({ mode: 'checked', actorUserId: actorA, documentId,
      checkedBundle: { pdfGenerationId: nextGenerationId } }),
  });
  await assert.rejects(client.replace({
    documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
    captureAccepted: async () => acceptedCapture(), revalidateCapture: async () => false,
    retireGeneration: async () => {}, persistSourceLocalState: async () => {}, install: async () => true,
  }), { code: 'DOCUMENT_PAGE_REPLACEMENT_STALE' });
  assert.deepEqual(events, []);
  assert.equal(await store.get(actorA, documentId), null);

  await client.replace({
    documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
    captureAccepted: async () => acceptedCapture({ coveredSeq: 18 }),
    revalidateCapture: async () => true,
    retireGeneration: async () => {}, persistSourceLocalState: async () => {}, install: async () => true,
  });
  assert.equal(sentBody.wal_head, '18');
  assert.equal(await store.get(actorA, documentId), null);
});

test('peer dispatch during stale cleanup retains the fixed intent and fails unresolved', async (t) => {
  const concrete = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => concrete.close());
  const store = {
    get: (...args) => concrete.get(...args),
    reserve: (...args) => concrete.reserve(...args),
    markDispatched: (...args) => concrete.markDispatched(...args),
    markPublished: (...args) => concrete.markPublished(...args),
    finish: (...args) => concrete.finish(...args),
    discardPending: async (actorUserId, receivedDocumentId, expectedRevision) => {
      await concrete.markDispatched(actorUserId, receivedDocumentId, expectedRevision);
      return concrete.discardPending(actorUserId, receivedDocumentId, expectedRevision);
    },
  };
  const client = makeClient({ store,
    transport: async () => assert.fail('stale creator must not dispatch'),
    reacquire: async () => assert.fail('stale creator must not reopen'),
  });
  await assert.rejects(client.replace({
    documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
    captureAccepted: async () => acceptedCapture(), revalidateCapture: async () => false,
    retireGeneration: async () => {}, persistSourceLocalState: async () => {}, install: async () => true,
  }), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED' });
  const retained = await concrete.get(actorA, documentId);
  assert.equal(retained.phase, 'dispatched');
  assert.equal(retained.revision, 2);
  assert.equal(retained.body.wal_head, '17');
});

test('finish failure leaves a published intent and retry clears it without render or transport', async () => {
  const indexedDB = new IDBFactory();
  const concrete = createDocumentPageReplacementIntentStore({ indexedDB });
  let failFinish = true;
  const store = {
    get: (...args) => concrete.get(...args), reserve: (...args) => concrete.reserve(...args),
    markDispatched: (...args) => concrete.markDispatched(...args),
    discardPending: (...args) => concrete.discardPending(...args),
    markPublished: (...args) => concrete.markPublished(...args),
    finish: (...args) => failFinish
      ? (failFinish = false, Promise.reject(new Error('IDB finish did not commit')))
      : concrete.finish(...args),
  };
  let captures = 0;
  let requests = 0;
  let installs = 0;
  const client = makeClient({ store,
    transport: async ({ body }) => {
      requests++;
      return new Response(JSON.stringify({ replacement: publication(body) }));
    },
    reacquire: async () => ({ mode: 'checked', actorUserId: actorA, documentId,
      checkedBundle: { pdfGenerationId: nextGenerationId } }),
  });
  const input = {
    documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
    captureAccepted: async () => { captures++; return acceptedCapture(); },
    revalidateCapture: async () => true, retireGeneration: async () => {}, persistSourceLocalState: async () => {},
    install: async () => { installs++; return true; },
  };
  await assert.rejects(client.replace(input), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
  assert.equal((await concrete.get(actorA, documentId)).phase, 'published');
  await client.replace(input);
  assert.equal(captures, 1);
  assert.equal(requests, 1);
  assert.equal(installs, 2, 'retry confirms exact checked install before clearing');
  assert.equal(await concrete.get(actorA, documentId), null);
  concrete.close();
});

test('caller mutation after replace cannot change the operation reserved before remote work', async () => {
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  const mutable = operation();
  let sent;
  const client = makeClient({ store,
    transport: async ({ body }) => {
      sent = body;
      return new Response(JSON.stringify({ replacement: publication(body) }));
    },
    reacquire: async () => ({ mode: 'checked', actorUserId: actorA, documentId,
      checkedBundle: { pdfGenerationId: nextGenerationId } }),
  });
  const pending = client.replace({
    documentId, currentGenerationId: generationId, operation: mutable, localPageState: localPageState(),
    captureAccepted: async () => acceptedCapture(), revalidateCapture: async () => true,
    retireGeneration: async () => {}, persistSourceLocalState: async () => {}, install: async () => true,
  });
  mutable.page = 9;
  await pending;
  assert.deepEqual(sent.operation, operation());
  store.close();
});

async function mountCheckedPageHook(t, { checked = true, provideReplacement = true } = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  const restore = [];
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restore.push(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key]);
  }
  const hookUrl = new URL('../src/hooks/usePageOperations.js', import.meta.url);
  const key = `__checkedPageHook_${crypto.randomUUID()}`;
  const state = { actor: actorA, calls: [], rawWrites: [], commits: [], toasts: [], view: {
    annotationsByPage: { 1: { objects: [{ id: 'local-later-edit' }] } },
    pageNames: { 1: 'Before replacement' }, pageTransformations: {}, bookmarks: [],
    spaces: [], regionOverlayDisabled: new Map(),
  } };
  globalThis[key] = state;
  let source = await readFile(hookUrl, 'utf8');
  source = source.replace("import { showToast } from '../utils/toast';",
    `const showToast = (...args) => globalThis[${JSON.stringify(key)}].toasts.push(args);`)
    .replace(/from\s+(['"])([^'"]+)\1/g, (_all, _quote, specifier) => `from ${JSON.stringify(
      specifier.startsWith('.') ? new URL(specifier, hookUrl).href : pathToFileURL(require.resolve(specifier)).href,
    )}`)
    .replace("import('../utils/pdfPageMutation.js')",
      `import(${JSON.stringify(new URL('../src/utils/pdfPageMutation.js', import.meta.url).href)})`);
  source = `const console = { error() {} };\n${source}`;
  const { usePageOperations } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let fixtureBytes = new TextEncoder().encode('not-read-by-checked-route');
  if (!checked) {
    const pdf = await PDFDocument.create(); pdf.addPage([612, 792]); fixtureBytes = await pdf.save();
  }
  const sourceFile = new File([fixtureBytes], 'checked.pdf', { type: 'application/pdf' });
  sourceFile.id = documentId;
  sourceFile.user_id = actorA;
  sourceFile.pdfGenerationId = generationId;
  sourceFile.arrayBuffer = async () => {
    if (checked) return assert.fail('checked branch must not mutate PDF bytes in the viewer');
    state.byteReads = (state.byteReads || 0) + 1;
    if (state.byteHold) await state.byteHold.promise;
    return fixtureBytes.buffer.slice(fixtureBytes.byteOffset, fixtureBytes.byteOffset + fixtureBytes.byteLength);
  };
  let api;
  let setActor;
  let setView;
  let setFile;
  let setChecked;
  function Probe() {
    const [actor, updateActor] = useState(state.actor);
    const [view, updateView] = useState(state.view);
    const [file, updateFile] = useState(sourceFile);
    const [checkedDocument, updateChecked] = useState(checked);
    const viewRef = useRef(view);
    viewRef.current = view;
    state.actor = actor; state.view = view;
    setActor = updateActor; setView = updateView;
    api = usePageOperations({
      pdfFile: file,
      actorUserId: actor,
      checkedDocument,
      onUpdatePDFFile: async value => { state.rawWrites.push(value); return true; },
      onReplaceCheckedPages: provideReplacement ? async input => {
        state.calls.push(input);
        if (state.hold) await state.hold.promise;
        return true;
      } : null,
      captureAcceptedState: async () => acceptedCapture(),
      revalidateAcceptedState: async () => true,
      retirePdfGeneration: async () => {},
      captureLocalPageState: () => viewRef.current,
      getPageState: useCallback(() => viewRef.current, []),
      commitPageState: next => { state.commits.push(next); updateView(next); },
      withMutation: run => run(),
      setPageNames() {}, setPageTransformations() {},
      setClipboardPage() {}, setClipboardType() {},
    });
    setFile = updateFile;
    setChecked = updateChecked;
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Probe)));
  t.after(async () => {
    state.hold?.resolve();
    await act(async () => root.unmount());
    dom.window.close(); delete globalThis[key]; restore.reverse().forEach(fn => fn());
  });
  return {
    state, api: () => api,
    actor: value => act(async () => setActor(value)),
    edit: value => act(async () => setView(value)),
    file: value => act(async () => setFile(value)),
    checked: value => act(async () => setChecked(value)),
  };
}

test('actual page hook sends checked operation before pdf-lib and leaves page graph to checked reopen', async t => {
  const h = await mountCheckedPageHook(t);
  assert.equal(await h.api().handleDuplicatePage(1), true);
  assert.equal(h.state.calls.length, 1);
  assert.deepEqual(h.state.calls[0].operation, operation());
  assert.equal(h.state.calls[0].expectedSourceFile.id, documentId);
  assert.equal(h.state.calls[0].localPageState.pageNames[1], 'Before replacement');
  assert.deepEqual(h.state.commits, [], 'old generation page graph is not projected before checked reopen');
  assert.equal(h.state.view.pageNames[1], 'Before replacement');
});

for (const [method, expectedDelta] of [
  ['handleRotatePageCW', 180],
  ['handleRotatePageCCW', 0],
]) test(`actual checked hook folds local 90 degree view into ${expectedDelta} degree physical request`, async t => {
  const h = await mountCheckedPageHook(t);
  await h.edit({ ...h.state.view, pageTransformations: {
    1: { rotation: 90, mirrorH: true, mirrorV: false },
  } });
  assert.equal(await h.api()[method](1), true);
  assert.deepEqual(h.state.calls[0].operation, { type: 'rotate', page: 1, delta: expectedDelta });
  assert.equal(h.state.calls[0].localPageState.pageTransformations[1].rotation, 90);
  assert.deepEqual(h.state.commits, []);
});

test('actual page hook keeps later edits and ignores an old actor result while checked save waits', async t => {
  const h = await mountCheckedPageHook(t);
  h.state.hold = deferred();
  let pending;
  await act(async () => { pending = h.api().handleDuplicatePage(1); });
  while (h.state.calls.length === 0) await new Promise(resolve => setImmediate(resolve));
  const edited = { ...h.state.view, pageNames: { 1: 'Edited while publishing' } };
  await h.edit(edited);
  await h.actor(actorB);
  await h.actor(actorA);
  h.state.hold.resolve();
  assert.equal(await pending, false);
  assert.equal(h.state.view.pageNames[1], 'Edited while publishing');
  assert.deepEqual(h.state.commits, []);
  assert.deepEqual(h.state.toasts, [], 'retired actor work stays silent');
});

test('actual checked hook accepts AppShell same-document generation swap before callback success', async t => {
  const h = await mountCheckedPageHook(t);
  h.state.hold = deferred();
  let pending;
  await act(async () => { pending = h.api().handleDuplicatePage(1); });
  while (h.state.calls.length === 0) await new Promise(resolve => setImmediate(resolve));
  const installed = Object.assign(new File(['new checked bytes'], 'checked.pdf', {
    type: 'application/pdf',
  }), { id: documentId, user_id: actorA, pdfGenerationId: nextGenerationId });
  await h.file(installed);
  h.state.hold.resolve();
  assert.equal(await pending, true);
  assert.deepEqual(h.state.toasts, []);
  assert.deepEqual(h.state.commits, []);
});

test('actual hook retires a queued legacy action when the same document enters checked mode', async t => {
  const h = await mountCheckedPageHook(t, { checked: false });
  h.state.byteHold = deferred();
  let pending;
  await act(async () => { pending = h.api().handleDuplicatePage(1); });
  while (!h.state.byteReads) await new Promise(resolve => setImmediate(resolve));
  await h.checked(true);
  h.state.byteHold.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(h.state.rawWrites, []);
  assert.deepEqual(h.state.commits, []);
  assert.deepEqual(h.state.toasts, []);
});

test('actual checked page hook fails closed with no callback and never falls through to raw PDF save', async t => {
  const h = await mountCheckedPageHook(t, { provideReplacement: false });
  assert.equal(await h.api().handleDuplicatePage(1), false);
  assert.deepEqual(h.state.calls, []);
  assert.deepEqual(h.state.commits, []);
  assert.match(h.state.toasts[0][0], /Checked page changes are not available/);
});

test('mounted AppShell page-replacement effect stays off even when checked open and transport are present', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  const pageReplacementClientRef = { current: { mustBeRetired: true } };
  const setup = actualEffect(appShellSource, appShellTree,
    'createDocumentPageReplacementClient', {
      pageReplacementClientRef,
      CHECKED_DOCUMENT_OPEN_ENABLED: true,
      checkedPageReplacementEnabled: false,
      documentOpenScope: { actorUserId: actorA },
      documentReplacementTransport: () => calls.push('transport'),
    });
  function Probe() {
    React.useEffect(setup, []);
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
  });
  await act(async () => root.render(React.createElement(Probe)));
  assert.equal(pageReplacementClientRef.current, null);
  assert.deepEqual(calls, []);
});

function memoryStorage({ failGeneration = null } = {}) {
  const values = new Map();
  return {
    values,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      if (failGeneration && key.endsWith(`:${failGeneration}`)) throw new Error('quota full');
      values.set(key, value);
    },
  };
}

function checkedInstallHarness(t, { targetGeneration = nextGenerationId, failGeneration = null } = {}) {
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const storage = memoryStorage({ failGeneration });
  const scope = { actorUserId: actorA };
  const mount = {};
  const oldBundle = { pdfGenerationId: generationId };
  const targetBundle = { pdfGenerationId: targetGeneration };
  const oldFile = { id: documentId, pdfGenerationId: generationId, name: 'checked.pdf' };
  const state = { tabs: [{ id: 'tab-a', actorUserId: actorA, file: oldFile, checkedBundle: oldBundle }],
    selected: oldFile, latest: localPageState(), retires: [], requests: 0 };
  const closeViewRef = { current: { tabs: state.tabs, activeTabId: 'tab-a' } };
  const client = createDocumentPageReplacementClient({
    store,
    getActorUserId: () => actorA,
    getAccessToken: async () => 'token',
    isCurrent: ({ actorUserId, documentId: received }) => actorUserId === actorA && received === documentId,
    transport: async ({ body }) => {
      state.requests++;
      return new Response(JSON.stringify({ replacement: publication(body) }));
    },
    reacquire: async () => {
      if (state.reacquireGate) await state.reacquireGate.promise;
      return { mode: 'checked', actorUserId: actorA, documentId, checkedBundle: targetBundle };
    },
  });
  const deps = {
    documentOpenScope: scope,
    documentOpenScopeRef: { current: scope },
    documentOpenMountRef: { current: mount },
    pageReplacementClientRef: { current: { scope, mount, client } },
    closeViewRef,
    checkedPageStructureStorage: storage,
    readLocalCheckedPageStructure: ({ actorUserId, documentId: received, generationId: receivedGeneration }) =>
      readCheckedPageStructure({ storage, actorUserId, documentId: received, generationId: receivedGeneration }),
    saveCheckedPageStructure,
    transformCheckedPageStructure,
    prepareCheckedDocumentOpen: (bundle) => ({
      file: { id: documentId, pdfGenerationId: bundle.pdfGenerationId, name: 'checked.pdf' },
    }),
    flushSync: run => run(),
    setTabs: update => {
      state.tabs = update(state.tabs);
      closeViewRef.current = { ...closeViewRef.current, tabs: state.tabs };
    },
    setSelectedPDF: update => { state.selected = typeof update === 'function' ? update(state.selected) : update; },
  };
  const handle = actualHandler(appShellSource, appShellTree, 'handleReplaceCheckedPages', deps);
  const input = {
    operation: operation(),
    localPageState: localPageState(),
    captureLocalPageState: () => state.latest,
    captureAccepted: async () => acceptedCapture(),
    revalidateCapture: async () => true,
    retireGeneration: async value => { state.retires.push(value); },
  };
  return { state, storage, store, oldFile, oldBundle, targetBundle, handle, input };
}

test('actual AppShell install re-captures a late old-generation private edit and swaps the same tab', async t => {
  const h = checkedInstallHarness(t);
  h.state.reacquireGate = deferred();
  const pending = h.handle(h.input, 'tab-a', h.oldFile, h.oldBundle);
  while ((await h.store.get(actorA, documentId))?.phase !== 'published') {
    await new Promise(resolve => setImmediate(resolve));
  }
  h.state.latest = { ...localPageState(), pageNames: { 1: 'Edited while server published' } };
  h.state.reacquireGate.resolve();
  assert.equal(await pending, true);
  assert.equal(h.state.tabs.length, 1);
  assert.equal(h.state.tabs[0].id, 'tab-a');
  assert.equal(h.state.tabs[0].checkedBundle, h.targetBundle);
  assert.equal(h.state.selected, h.state.tabs[0].file);
  assert.equal(readCheckedPageStructure({ storage: h.storage, actorUserId: actorA,
    documentId, generationId }).pageNames[1], 'Edited while server published');
  assert.deepEqual(readCheckedPageStructure({ storage: h.storage, actorUserId: actorA,
    documentId, generationId: nextGenerationId }).pageNames,
  { 1: 'Edited while server published', 2: 'Edited while server published' });
  assert.equal(await h.store.get(actorA, documentId), null);
});

test('actual AppShell target metadata quota failure keeps published intent and old tab', async t => {
  const h = checkedInstallHarness(t, { failGeneration: nextGenerationId });
  h.state.latest = { ...localPageState(), pageNames: { 1: 'Latest kept private edit' } };
  await assert.rejects(h.handle(h.input, 'tab-a', h.oldFile, h.oldBundle), {
    code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE',
  });
  assert.equal(h.state.tabs.length, 1);
  assert.equal(h.state.tabs[0].file, h.oldFile);
  assert.equal(h.state.tabs[0].checkedBundle, h.oldBundle);
  assert.equal(h.state.selected, h.oldFile);
  const retained = await h.store.get(actorA, documentId);
  assert.equal(retained.phase, 'published');
  assert.equal(readCheckedPageStructure({ storage: h.storage, actorUserId: actorA,
    documentId, generationId }).pageNames[1], 'Latest kept private edit');
});

test('mounted actual viewer save effect cannot write old or hybrid state before generation hydration', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const restore = [];
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restore.push(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key]);
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    restore.reverse().forEach(fn => fn());
  });
  const writes = [];
  let hydrate;
  const checkedBundle = { pdfGenerationId: nextGenerationId };
  const pdfFile = { id: documentId };
  const user = { id: actorA };
  const key = `${actorA}:${documentId}:${nextGenerationId}`;
  const old = { items: { old: true }, annotations: { old: true }, pageNames: { 1: 'A' },
    bookmarks: [{ id: 'A' }], pageTransformations: { 1: { rotation: 90 } },
    activeSpaceId: 'A', regionOverlayDisabled: new Map([['A', true]]) };
  const next = { items: { next: true }, annotations: { next: true }, pageNames: { 1: 'B' },
    bookmarks: [{ id: 'B' }], pageTransformations: {}, activeSpaceId: 'B',
    regionOverlayDisabled: new Map([['B', true]]) };
  function Probe() {
    const [state, setState] = useState(old);
    const [hydration, setHydration] = useState({ key: null, ready: false });
    hydrate = () => { setState(next); setHydration({ key, ready: true }); };
    const save = actualEffect(viewerSource, viewerTree, 'saveCheckedPageStructure', {
      checkedBundle, user, pdfFile,
      checkedPageStructureHydration: hydration,
      checkedPageStructureScopeKey: key,
      saveCheckedPageStructure: input => writes.push(input.state),
      items: state.items, annotations: state.annotations, pageNames: state.pageNames,
      bookmarks: state.bookmarks, pageTransformations: state.pageTransformations,
      activeSpaceId: state.activeSpaceId, regionOverlayDisabled: state.regionOverlayDisabled,
      console: { error: error => assert.fail(error) },
    });
    React.useEffect(save, [state, hydration]);
    return null;
  }
  await act(async () => root.render(React.createElement(Probe)));
  assert.deepEqual(writes, [], 'generation B cannot save generation A state before hydration is ready');
  await act(async () => hydrate());
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], next);

  const load = findNode(viewerTree, node => node.type === 'CallExpression'
    && node.callee?.name === 'useEffect'
    && node.arguments[1]?.elements?.some(entry => entry?.name === 'activePdfChangeIdentity'));
  const body = viewerSource.slice(load.arguments[0].start, load.arguments[0].end);
  const ready = body.lastIndexOf('setCheckedPageStructureHydration(');
  assert.ok(ready > body.indexOf('setItems('));
  assert.ok(ready > body.indexOf('setAnnotations('));
  assert.ok(ready > body.indexOf('setPageNames('));
  assert.ok(ready > body.indexOf('setBookmarks('));
  assert.ok(ready > body.indexOf('setPageTransformations('));
  assert.ok(ready > body.indexOf('setRegionOverlayDisabled('));
});
