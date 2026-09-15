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
import { transformWithOxc } from 'vite';
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
const recoveryNoticeUrl = new URL('../src/components/PageReplacementRecoveryNotice.jsx', import.meta.url);
const recoveryNoticeSource = (await transformWithOxc(await readFile(recoveryNoticeUrl, 'utf8'),
  recoveryNoticeUrl.pathname, { lang: 'jsx' })).code
  .replace('"react"', JSON.stringify(pathToFileURL(require.resolve('react')).href))
  .replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const PageReplacementRecoveryNotice = (await import(`data:text/javascript;base64,${Buffer.from(
  recoveryNoticeSource,
).toString('base64')}`)).default;
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
function actualInitializer(source, tree, name, scope) {
  const node = findNode(tree, candidate => candidate.type === 'VariableDeclarator'
    && candidate.id?.name === name);
  assert.ok(node, `Missing production value: ${name}`);
  return Function(...Object.keys(scope), `return (${source.slice(node.init.start, node.init.end)});`)(
    ...Object.values(scope));
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

function expiredTerminal(body, changes = {}) {
  return {
    version: 1,
    state: 'expired',
    actor_user_id: actorA,
    document_id: body.document_id,
    source_id: body.source_id,
    candidate_operation_id: body.candidate_operation_id,
    archive_operation_ids: [...body.archive_operation_ids],
    expected_generation_id: body.generation_id,
    expected_wal_head: body.wal_head,
    operation: structuredClone(body.operation),
    prepared_at: '2026-09-09T10:00:00.000Z',
    expires_at: '2026-09-09T12:00:00.000Z',
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

test('real IndexedDB stores exact expiry proof and reset uses revision plus candidate CAS', async t => {
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  let { row } = await store.reserve(actorA, documentId, reserveInput());
  row = await store.markDispatched(actorA, documentId, row.revision);
  const terminal = expiredTerminal(row.body);
  const expired = await store.markExpired(actorA, documentId, row.revision, terminal);
  assert.equal(expired.phase, 'expired');
  assert.deepEqual(expired.terminal, terminal);
  assert.equal(expired.publication, null);

  await assert.rejects(store.resetExpired(actorA, documentId, expired.revision, id(90)), {
    code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED',
  });
  await assert.rejects(store.resetExpired(actorB, documentId, expired.revision,
    expired.body.candidate_operation_id));
  assert.deepEqual(await store.get(actorA, documentId), expired);
  await store.resetExpired(actorA, documentId, expired.revision,
    expired.body.candidate_operation_id);
  assert.equal(await store.get(actorA, documentId), null);
});

test('stale expiry reset cannot delete a same-revision new candidate after ABA', async t => {
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  let { row: first } = await store.reserve(actorA, documentId, reserveInput());
  first = await store.markDispatched(actorA, documentId, first.revision);
  const old = await store.markExpired(actorA, documentId, first.revision, expiredTerminal(first.body));
  await store.resetExpired(actorA, documentId, old.revision, old.body.candidate_operation_id);

  let { row: next } = await store.reserve(actorA, documentId, reserveInput());
  next = await store.markDispatched(actorA, documentId, next.revision);
  next = await store.markExpired(actorA, documentId, next.revision, expiredTerminal(next.body));
  assert.equal(next.revision, old.revision);
  assert.notEqual(next.body.candidate_operation_id, old.body.candidate_operation_id);
  await assert.rejects(store.resetExpired(actorA, documentId, old.revision,
    old.body.candidate_operation_id), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED' });
  assert.deepEqual(await store.get(actorA, documentId), next);
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
  reacquire, events = [], token = 'local-test-token', responseTimeoutMs } = {}) {
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
    ...(responseTimeoutMs === undefined ? {} : { responseTimeoutMs }),
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

const clientInput = (changes = {}) => ({
  documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
  captureAccepted: async () => acceptedCapture(), revalidateCapture: async () => true,
  retireGeneration: async () => {}, persistSourceLocalState: async () => {}, install: async () => true,
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

test('exact expired response is durably blocked before reopen and explicit reset mints no work', async t => {
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  let requests = 0;
  let reopens = 0;
  let captures = 0;
  let installs = 0;
  let sentBody;
  let expiredMode = true;
  const client = makeClient({ store,
    transport: async ({ body }) => {
      requests++;
      sentBody = body;
      return expiredMode ? new Response(JSON.stringify({
        error: { code: 'replacement_expired', message: 'The saved page request expired.' },
        terminal: expiredTerminal(body),
      }), { status: 409, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ replacement: publication(body) }));
    },
    reacquire: async () => { reopens++; return { mode: 'checked', actorUserId: actorA, documentId,
      checkedBundle: { pdfGenerationId: nextGenerationId } }; },
  });
  const input = {
    documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
    captureAccepted: async () => { captures++; return acceptedCapture(); }, revalidateCapture: async () => true,
    retireGeneration: async () => {}, persistSourceLocalState: async () => {},
    install: async () => { installs++; return true; },
  };
  let recovery;
  await assert.rejects(client.replace(input), error => {
    assert.equal(error.code, 'DOCUMENT_PAGE_REPLACEMENT_EXPIRED');
    recovery = error.recovery;
    return true;
  });
  const saved = await store.get(actorA, documentId);
  assert.equal(saved.phase, 'expired');
  assert.deepEqual(saved.terminal, expiredTerminal(sentBody));
  assert.deepEqual(recovery, { revision: saved.revision,
    candidateOperationId: sentBody.candidate_operation_id });
  assert.equal(requests, 1);
  assert.equal(reopens, 0);

  await assert.rejects(client.replace(input), { code: 'DOCUMENT_PAGE_REPLACEMENT_EXPIRED' });
  assert.equal(requests, 1, 'stored expiry blocks without another request');
  await client.resetExpired({ documentId, expectedRevision: recovery.revision,
    candidateOperationId: recovery.candidateOperationId });
  assert.equal(await store.get(actorA, documentId), null);
  assert.equal(requests, 1, 'reset does not retry or mint work');
  assert.equal(reopens, 0);
  expiredMode = false;
  const expiredIds = [saved.body.source_id, saved.body.candidate_operation_id,
    ...saved.body.archive_operation_ids];
  await client.replace(input);
  assert.equal(captures, 2, 'the next click uses one fresh accepted capture');
  assert.equal(requests, 2);
  assert.equal(reopens, 1);
  assert.equal(installs, 1);
  assert.equal(expiredIds.includes(sentBody.source_id), false);
  assert.equal(expiredIds.includes(sentBody.candidate_operation_id), false);
  assert.equal(expiredIds.includes(sentBody.archive_operation_ids[0]), false);
});

test('forged, mismatched, truncated, and oversized expiry replies never become reset authority', async t => {
  const variants = [
    body => expiredTerminal(body, { actor_user_id: actorB }),
    body => expiredTerminal(body, { document_id: id(40) }),
    body => expiredTerminal(body, { source_id: id(41) }),
    body => expiredTerminal(body, { candidate_operation_id: id(42) }),
    body => expiredTerminal(body, { archive_operation_ids: [id(43)] }),
    body => expiredTerminal(body, { expected_generation_id: id(44) }),
    body => expiredTerminal(body, { expected_wal_head: '18' }),
    body => expiredTerminal(body, { operation: { type: 'delete', page: 1 } }),
    body => ({ ...expiredTerminal(body), extra: true }),
  ];
  for (const makeTerminal of variants) {
    const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
    t.after(() => store.close());
    const client = makeClient({ store,
      transport: async ({ body }) => new Response(JSON.stringify({
        error: { code: 'replacement_expired', message: 'expired' }, terminal: makeTerminal(body),
      }), { status: 409 }),
      reacquire: async () => assert.fail('invalid proof must not reopen'),
    });
    await assert.rejects(client.replace({
      documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
      captureAccepted: async () => acceptedCapture(), revalidateCapture: async () => true,
      retireGeneration: async () => {}, persistSourceLocalState: async () => {}, install: async () => true,
    }), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
    assert.equal((await store.get(actorA, documentId)).phase, 'dispatched');
  }

  for (const raw of ['{"error":', JSON.stringify({ error: { code: 'replacement_expired' },
    terminal: { padding: 'x'.repeat(16 * 1024) } })]) {
    const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
    t.after(() => store.close());
    const client = makeClient({ store,
      transport: async () => new Response(raw, { status: 409 }),
      reacquire: async () => assert.fail('bad response must not reopen'),
    });
    await assert.rejects(client.replace({
      documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
      captureAccepted: async () => acceptedCapture(), revalidateCapture: async () => true,
      retireGeneration: async () => {}, persistSourceLocalState: async () => {}, install: async () => true,
    }), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
    assert.equal((await store.get(actorA, documentId)).phase, 'dispatched');
  }
});

test('expiry proof on the wrong HTTP status never marks or clears the dispatched intent', async t => {
  for (const status of [401, 500]) {
    const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
    t.after(() => store.close());
    const client = makeClient({ store,
      transport: async ({ body }) => new Response(JSON.stringify({
        error: { code: 'replacement_expired', message: 'expired' }, terminal: expiredTerminal(body),
      }), { status }),
      reacquire: async () => assert.fail('wrong-status proof must not reopen'),
    });
    await assert.rejects(client.replace(clientInput()), {
      code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE',
    });
    assert.equal((await store.get(actorA, documentId)).phase, 'dispatched');
  }
});

test('aborted, stalled, and oversized response bodies cannot persist expiry authority', async t => {
  const abort = new AbortController(); abort.abort();
  const cases = [
    { name: 'pre-aborted', signal: abort.signal,
      code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED',
      response: body => new Response(JSON.stringify({
        error: { code: 'replacement_expired', message: 'expired' }, terminal: expiredTerminal(body),
      }), { status: 409 }) },
    { name: 'stalled', responseTimeoutMs: 5,
      code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE',
      response: () => new Response(new ReadableStream({ pull() {} }), { status: 409 }) },
  ];
  for (const item of cases) {
    const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
    t.after(() => store.close());
    const client = makeClient({ store, responseTimeoutMs: item.responseTimeoutMs,
      transport: async ({ body }) => item.response(body),
      reacquire: async () => assert.fail(`${item.name} response must not reopen`),
    });
    await assert.rejects(client.replace(clientInput(item.signal ? { signal: item.signal } : {})),
      { code: item.code });
    assert.equal((await store.get(actorA, documentId)).phase, 'dispatched');
  }

  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  let canceled = 0;
  const client = makeClient({ store,
    transport: async () => new Response(new ReadableStream({ pull() {}, cancel() {
      canceled++; return Promise.reject(new Error('cancel detail'));
    } }), { status: 409, headers: { 'Content-Length': String(16 * 1024 + 1) } }),
    reacquire: async () => assert.fail('oversized response must not reopen'),
  });
  await assert.rejects(client.replace(clientInput()), {
    code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE',
  });
  assert.equal(canceled, 1);
  assert.equal((await store.get(actorA, documentId)).phase, 'dispatched');
});

test('abort after a valid expiry body starts but before it ends retains dispatched state', async t => {
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const abort = new AbortController();
  const hold = deferred();
  let canceled = 0;
  const client = makeClient({ store,
    transport: async ({ body }) => {
      const bytes = new TextEncoder().encode(JSON.stringify({
        error: { code: 'replacement_expired', message: 'expired' }, terminal: expiredTerminal(body),
      }));
      let sent = false;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(bytes.slice(0, bytes.length - 1)); },
        async pull(controller) {
          if (sent) return;
          sent = true;
          await hold.promise;
          controller.enqueue(bytes.slice(bytes.length - 1)); controller.close();
        },
        cancel() { canceled++; hold.resolve(); },
      }), { status: 409 });
    },
    reacquire: async () => assert.fail('aborted response must not reopen'),
  });
  const pending = client.replace(clientInput({ signal: abort.signal }));
  while ((await store.get(actorA, documentId))?.phase !== 'dispatched') {
    await new Promise(resolve => setImmediate(resolve));
  }
  abort.abort();
  await assert.rejects(pending, { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
  assert.equal(canceled, 1);
  assert.equal((await store.get(actorA, documentId)).phase, 'dispatched');
});

test('transport deadline releases the local key but late responses cannot mutate the saved intent', async t => {
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const late = deferred();
  const calls = [];
  let firstSignal;
  let canceled = 0;
  const client = makeClient({ store, responseTimeoutMs: 8,
    transport: async ({ body, signal }) => {
      calls.push(structuredClone(body));
      if (calls.length === 1) { firstSignal = signal; return late.promise; }
      return new Response(JSON.stringify({ error: { code: 'replacement_conflict' } }), { status: 409 });
    },
    reacquire: async () => assert.fail('timed-out transport must not reopen'),
  });
  await assert.rejects(client.replace(clientInput()), {
    code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED',
  });
  assert.equal(firstSignal.aborted, true);
  const retained = await store.get(actorA, documentId);
  assert.equal(retained.phase, 'dispatched');

  await assert.rejects(client.replace(clientInput()), {
    code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED',
  });
  assert.equal(calls.length, 2, 'deadline releases only the local in-process key');
  assert.deepEqual(calls[1], calls[0], 'retry keeps the durable exact IDs and body');
  late.resolve(new Response(new ReadableStream({ pull() {}, cancel() {
    canceled++; return Promise.reject(new Error('late cancel detail'));
  } }), { status: 409 }));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(canceled, 1);
  assert.deepEqual(await store.get(actorA, documentId), retained);
});

test('publication that wins before expiry persistence remains published and cannot be reset', async t => {
  const concrete = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => concrete.close());
  const store = {
    get: (...args) => concrete.get(...args), reserve: (...args) => concrete.reserve(...args),
    discardPending: (...args) => concrete.discardPending(...args),
    markDispatched: (...args) => concrete.markDispatched(...args),
    markPublished: (...args) => concrete.markPublished(...args),
    resetExpired: (...args) => concrete.resetExpired(...args), finish: (...args) => concrete.finish(...args),
    markExpired: async (actorUserId, receivedDocumentId, revision, terminal) => {
      const current = await concrete.get(actorUserId, receivedDocumentId);
      await concrete.markPublished(actorUserId, receivedDocumentId, revision, publication(current.body));
      return concrete.markExpired(actorUserId, receivedDocumentId, revision, terminal);
    },
  };
  const client = makeClient({ store,
    transport: async ({ body }) => new Response(JSON.stringify({
      error: { code: 'replacement_expired', message: 'expired' }, terminal: expiredTerminal(body),
    }), { status: 409 }),
    reacquire: async () => assert.fail('racing expiry response must not reopen'),
  });
  await assert.rejects(client.replace({
    documentId, currentGenerationId: generationId, operation: operation(), localPageState: localPageState(),
    captureAccepted: async () => acceptedCapture(), revalidateCapture: async () => true,
    retireGeneration: async () => {}, persistSourceLocalState: async () => {}, install: async () => true,
  }), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED' });
  const winner = await concrete.get(actorA, documentId);
  assert.equal(winner.phase, 'published');
  assert.equal(winner.terminal, null);
  await assert.rejects(client.resetExpired({ documentId, expectedRevision: winner.revision,
    candidateOperationId: winner.body.candidate_operation_id }), {
    code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED',
  });
  assert.deepEqual(await concrete.get(actorA, documentId), winner);
});

test('mounted recovery notice keeps blocked on cancel and clears only after explicit review', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const prior = { window: globalThis.window, document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    if (prior.window === undefined) delete globalThis.window; else globalThis.window = prior.window;
    if (prior.document === undefined) delete globalThis.document; else globalThis.document = prior.document;
    if (prior.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = prior.act;
  });
  const recovery = { actorUserId: actorA, documentId, tabId: 'tab-a', file: {}, checkedBundle: {},
    revision: 3, candidateOperationId: id(70) };
  const clears = [];
  function Host() {
    const [value, setValue] = useState(recovery);
    return React.createElement(PageReplacementRecoveryNotice, { recovery: value,
      onClear: async exact => { clears.push(exact); setValue(null); } });
  }
  await act(async () => root.render(React.createElement(Host)));
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
  assert.ok(button('Review reset'));
  await act(async () => button('Review reset').click());
  assert.ok(button('Keep blocked'));
  assert.ok(button('Clear expired request'));
  await act(async () => button('Keep blocked').click());
  assert.deepEqual(clears, []);
  assert.ok(button('Review reset'), 'cancel leaves the exact request blocked');
  await act(async () => button('Review reset').click());
  await act(async () => button('Clear expired request').click());
  assert.deepEqual(clears, [recovery]);
  assert.equal(document.querySelector('[data-page-replacement-recovery]'), null);
});

test('late clear failure for recovery A cannot mark replacement recovery B busy or failed', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const prior = { window: globalThis.window, document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    if (prior.window === undefined) delete globalThis.window; else globalThis.window = prior.window;
    if (prior.document === undefined) delete globalThis.document; else globalThis.document = prior.document;
    if (prior.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = prior.act;
  });
  const a = { actorUserId: actorA, documentId, candidateOperationId: id(70), revision: 3 };
  const b = { ...a, candidateOperationId: id(71) };
  const gate = deferred();
  let setRecovery;
  function Host() {
    const [recovery, update] = useState(a); setRecovery = update;
    return React.createElement(PageReplacementRecoveryNotice, { recovery,
      onClear: async () => gate.promise });
  }
  await act(async () => root.render(React.createElement(Host)));
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
  await act(async () => button('Review reset').click());
  await act(async () => button('Clear expired request').click());
  await act(async () => setRecovery(b));
  gate.reject(new Error('old clear failed'));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.ok(button('Review reset'), 'new recovery remains at its initial review step');
  assert.equal(document.querySelector('[role="alert"]'), null, 'old failure cannot label new recovery');
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
    markExpired: (...args) => concrete.markExpired(...args),
    resetExpired: (...args) => concrete.resetExpired(...args),
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
    markExpired: (...args) => concrete.markExpired(...args),
    resetExpired: (...args) => concrete.resetExpired(...args),
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
  const state = { tabs: [{ id: 'tab-a', actorUserId: actorA, file: oldFile, checkedBundle: oldBundle,
    viewState: { pageNum: 2, scale: 1.25, zoomMode: 'manual', scrollMode: 'continuous',
      scrollLeft: 0, scrollTop: 400 } }],
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
    checkedDocumentViewStateStorage: storage,
    readCheckedDocumentViewState: () => null,
    handleViewStateChange: () => {},
    showToast: () => {},
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
    setPageReplacementRecoveryByTab: update => {
      state.recovery = typeof update === 'function' ? update(state.recovery || {}) : update;
    },
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
  assert.equal(h.state.tabs[0].viewState, null);
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

test('actual AppShell reset handler clears only the exact live actor, tab, file, and bundle scope', async () => {
  const file = { id: documentId };
  const bundle = { pdfGenerationId: generationId };
  const scope = { actorUserId: actorA };
  const mount = {};
  const recovery = { actorUserId: actorA, documentId, tabId: 'tab-a', file, checkedBundle: bundle,
    revision: 3, candidateOperationId: id(70) };
  let recoveryByTab = { 'tab-a': recovery };
  const resets = [];
  const toasts = [];
  const base = {
    documentOpenScope: scope,
    documentOpenMountRef: { current: mount },
    documentOpenScopeRef: { current: scope },
    pageReplacementClientRef: { current: { scope, mount, client: {
      resetExpired: async value => { resets.push(value); },
    } } },
    pageReplacementRecoveryByTab: recoveryByTab,
    closeViewRef: { current: { tabs: [{ id: 'tab-a', actorUserId: actorA, file, checkedBundle: bundle }] } },
    setPageReplacementRecoveryByTab: update => { recoveryByTab = update(recoveryByTab); },
    showToast: (...args) => toasts.push(args),
  };
  const clear = actualHandler(appShellSource, appShellTree, 'handleClearExpiredPageReplacement', base);
  assert.equal(await clear(recovery), true);
  assert.deepEqual(resets, [{ documentId, expectedRevision: 3, candidateOperationId: id(70) }]);
  assert.deepEqual(recoveryByTab, {});
  assert.match(toasts[0][0], /No page change was run/);

  for (const mutate of [
    deps => { deps.documentOpenScope = { actorUserId: actorB }; },
    deps => { deps.documentOpenMountRef = { current: {} }; },
    deps => { deps.documentOpenScopeRef = { current: {} }; },
    deps => { deps.closeViewRef = { current: { tabs: [] } }; },
    deps => { deps.pageReplacementRecoveryByTab = {}; },
  ]) {
    const deps = { ...base, pageReplacementRecoveryByTab: { 'tab-a': recovery } };
    mutate(deps);
    const stale = actualHandler(appShellSource, appShellTree, 'handleClearExpiredPageReplacement', deps);
    await assert.rejects(stale(recovery), /expired request was kept/i);
  }
  assert.equal(resets.length, 1, 'stale callbacks never reach the client reset CAS');
});

test('actual AppShell render hides recovery from a stale actor, file, or checked bundle', () => {
  const file = {}, checkedBundle = {};
  const tab = { actorUserId: actorA, file, checkedBundle };
  const recovery = { actorUserId: actorA, file, checkedBundle };
  const visible = savedRecovery => actualInitializer(appShellSource, appShellTree,
    'visibleRecovery', { savedRecovery, tab });
  assert.equal(visible(recovery), recovery);
  assert.equal(visible({ ...recovery, actorUserId: actorB }), null);
  assert.equal(visible({ ...recovery, file: {} }), null);
  assert.equal(visible({ ...recovery, checkedBundle: {} }), null);
});

test('committed reset for a switched tab keeps its newer recovery and shows no stale toast', async () => {
  const oldFile = {}, oldBundle = {}, nextFile = {}, nextBundle = {};
  const scope = { actorUserId: actorA }, mount = {}, gate = deferred();
  const oldRecovery = { actorUserId: actorA, documentId, tabId: 'tab-a', file: oldFile,
    checkedBundle: oldBundle, revision: 3, candidateOperationId: id(70) };
  const nextRecovery = { ...oldRecovery, file: nextFile, checkedBundle: nextBundle,
    candidateOperationId: id(71) };
  let recoveryByTab = { 'tab-a': oldRecovery };
  const closeViewRef = { current: { tabs: [{ id: 'tab-a', actorUserId: actorA,
    file: oldFile, checkedBundle: oldBundle }] } };
  const toasts = [];
  const deps = {
    documentOpenScope: scope, documentOpenMountRef: { current: mount },
    documentOpenScopeRef: { current: scope }, pageReplacementRecoveryByTab: recoveryByTab,
    pageReplacementClientRef: { current: { scope, mount, client: {
      resetExpired: async () => gate.promise,
    } } }, closeViewRef,
    setPageReplacementRecoveryByTab: update => { recoveryByTab = update(recoveryByTab); },
    showToast: (...args) => toasts.push(args),
  };
  const clear = actualHandler(appShellSource, appShellTree, 'handleClearExpiredPageReplacement', deps);
  const pending = clear(oldRecovery);
  recoveryByTab = { 'tab-a': nextRecovery };
  closeViewRef.current = { tabs: [{ id: 'tab-a', actorUserId: actorA,
    file: nextFile, checkedBundle: nextBundle }] };
  gate.resolve();
  assert.equal(await pending, true);
  assert.equal(recoveryByTab['tab-a'], nextRecovery);
  assert.deepEqual(toasts, []);
});

test('actual confirmed tab close prunes only its exact expired recovery', async () => {
  const HOME_TAB_ID = 'home';
  const home = { id: HOME_TAB_ID, isHome: true };
  const oldFile = {}, nextFile = {};
  const oldTab = { id: 'tab-a', actorUserId: actorA, file: oldFile };
  const oldRecovery = { actorUserId: actorA, file: oldFile };
  const nextRecovery = { actorUserId: actorA, file: nextFile };
  async function run({ saved = true, switchWhileSaving = false } = {}) {
    let tabs = [home, oldTab];
    let recoveries = { 'tab-a': oldRecovery };
    const closeViewRef = { current: { tabs, activeTabId: HOME_TAB_ID } };
    const gate = deferred();
    const toasts = [];
    const scope = {
      HOME_TAB_ID, pendingFileReplacementsRef: { current: new Set() },
      pendingTabClosesRef: { current: new Set() }, closeViewRef,
      prepareTabClose: async () => { if (switchWhileSaving) await gate.promise; return saved
        ? { saved: true } : { saved: false, reason: 'kept open' }; },
      showToast: (...args) => toasts.push(args), flushSync: callback => callback(),
      setTabs: update => { tabs = update(tabs); },
      setPageReplacementRecoveryByTab: update => { recoveries = update(recoveries); },
      setActiveTabId: () => assert.fail('inactive close must not change active tab'),
      setSelectedPDF: () => assert.fail('inactive close must not change selected PDF'),
      setCurrentView: () => assert.fail('inactive close must not change view'),
    };
    const close = actualHandler(appShellSource, appShellTree, 'handleTabClose', scope);
    const pending = close('tab-a');
    if (switchWhileSaving) {
      tabs = [home, { ...oldTab, file: nextFile }];
      recoveries = { 'tab-a': nextRecovery };
      closeViewRef.current = { tabs, activeTabId: HOME_TAB_ID };
      gate.resolve();
    }
    await pending;
    return { tabs, recoveries, toasts };
  }
  const confirmed = await run();
  assert.deepEqual(confirmed.tabs, [home]);
  assert.deepEqual(confirmed.recoveries, {});
  const canceled = await run({ saved: false });
  assert.deepEqual(canceled.tabs, [home, oldTab]);
  assert.equal(canceled.recoveries['tab-a'], oldRecovery);
  assert.match(canceled.toasts[0][0], /kept open/);
  const switched = await run({ switchWhileSaving: true });
  assert.equal(switched.recoveries['tab-a'], nextRecovery);
  assert.equal(switched.tabs[1].file, nextFile);
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
