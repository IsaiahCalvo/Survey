import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import * as Y from 'yjs';
import { useAnnotationDoc } from '../src/hooks/useAnnotationDoc.js';
import { purgeAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { materializeSurveyCrdtV2 } from '../src/services/documentSurveyCrdtV2.js';
import { handleAnnotationGenerationAggregate } from '../supabase/functions/annotation-generation-aggregate/handler.js';

const pdf = () => new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = bytes => `\\x${Buffer.from(bytes).toString('hex')}`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await act(async () => { await wait(5); });
  }
  assert.fail(message);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function within(promise, message, timeoutMs = 1500) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function aggregateServer(backend, {
  actor = backend.ids.actorUserId,
  accessToken = 'fixture-local-token',
} = {}) {
  const receipts = new Map();
  const calls = [];
  const generation = backend.ids.generationId;
  const receiptKey = value => `${value.writerId}\0${value.clientSeq}`;
  const missing = value => ({
    version: 2,
    status: 'missing',
    document_id: backend.ids.documentId,
    generation_id: generation,
    content_model_version: 2,
    actor_user_id: actor,
    client_id: value.writerId,
    client_seq: value.clientSeq,
  });
  const accepted = (value, receipt) => ({
    version: 2,
    status: 'accepted',
    accepted: true,
    document_id: backend.ids.documentId,
    generation_id: generation,
    content_model_version: 2,
    actor_user_id: actor,
    client_id: value.writerId,
    client_seq: value.clientSeq,
    seq: receipt.seq,
    data_sha256: receipt.dataSha256,
    current_generation_id: generation,
    is_current: true,
  });
  const deps = {
    runtimeVerified: true,
    timeoutMs: 2000,
    getUser: async token => {
      assert.equal(token, accessToken);
      return { id: actor };
    },
    probe: async () => { throw new Error('v1 probe forbidden'); },
    commit: async () => { throw new Error('v1 commit forbidden'); },
    probeV2: async (_actor, value) => {
      const receipt = receipts.get(receiptKey(value));
      return receipt ? accepted(value, receipt) : missing(value);
    },
    readFixedCheckpoint: async () => {
      const result = await backend.client.rpc('read_annotation_snapshot_v3', {
        p_document_id: backend.ids.documentId,
        p_generation_id: generation,
        p_content_model_version: 2,
      });
      const checkpoint = result.data.snapshot;
      return {
        version: 1,
        actor_user_id: actor,
        document_id: backend.ids.documentId,
        generation_id: generation,
        content_model_version: 2,
        head: result.data.wal_head,
        base_seq: '0',
        checkpoint: {
          at_seq: checkpoint.at_seq,
          writer_id: checkpoint.writer_id,
          writer_epoch: checkpoint.writer_epoch,
          encoding_version: checkpoint.encoding_version,
          snapshot_sha256: sha(Buffer.from(checkpoint.snapshot.slice(2), 'hex')),
          snapshot: checkpoint.snapshot,
        },
      };
    },
    readFixedTailPage: async (_token, page) => {
      const result = await backend.client.rpc('read_annotation_updates_v3', {
        p_document_id: backend.ids.documentId,
        p_generation_id: generation,
        p_content_model_version: 2,
        p_after_seq: page.afterSeq,
        p_through_seq: page.throughSeq,
        p_limit: page.limit,
      });
      return result.data;
    },
    commitV2: async (_actor, value) => {
      const result = await backend.client.rpc('append_annotation_update_v3', {
        p_document_id: backend.ids.documentId,
        p_generation_id: generation,
        p_content_model_version: 2,
        p_client_id: value.writerId,
        p_client_seq: value.clientSeq,
        p_data: hex(value.update),
      });
      const receipt = { seq: result.data.seq, dataSha256: sha(value.update) };
      receipts.set(receiptKey(value), receipt);
      return {
        ...accepted(value, receipt),
        checkpoint_stored: value.checkpoint !== null,
        checkpoint: value.checkpoint ? {
          at_seq: value.checkpoint.atSeq,
          writer_id: 'survey-private-aggregate-v1',
          writer_epoch: '1',
          encoding_version: value.checkpoint.encodingVersion,
          snapshot_sha256: value.checkpoint.snapshotSha256,
        } : null,
      };
    },
  };
  return {
    calls,
    async request(call) {
      calls.push({
        functionName: call.functionName,
        authorization: call.headers.Authorization,
        body: new Uint8Array(await call.body.arrayBuffer()),
      });
      return handleAnnotationGenerationAggregate(new Request(
        `https://edge.invalid/functions/v1/${call.functionName}`,
        { method: 'POST', headers: call.headers, body: call.body, signal: call.signal },
      ), deps);
    },
  };
}

function mappedActorClient(client, actorUserId, { realtimeControl = null } = {}) {
  const accessToken = `fixture-token-${actorUserId}`;
  const rpcCalls = [];
  const transform = result => {
    if (!result?.data || typeof result.data !== 'object' || Array.isArray(result.data)) return result;
    return { ...result, data: { ...result.data, actor_user_id: actorUserId } };
  };
  const wrap = source => {
    const value = {
      setHeader(name, headerValue) { source.setHeader?.(name, headerValue); return value; },
      abortSignal(signal) { source.abortSignal?.(signal); return value; },
      select(...args) { source.select?.(...args); return value; },
      eq(...args) { source.eq?.(...args); return value; },
      is(...args) { source.is?.(...args); return value; },
      maybeSingle(...args) { source.maybeSingle?.(...args); return value; },
      then(resolve, reject) { return Promise.resolve(source).then(transform).then(resolve, reject); },
    };
    return value;
  };
  return Object.freeze({
    rpcCalls,
    rpc(name, params) {
      rpcCalls.push({ name, params });
      if (realtimeControl?.armed && name === 'read_annotation_snapshot_v3') {
        const source = client.rpc(name, params);
        return wrap(Promise.resolve(source).then(async result => {
          realtimeControl.readStarted.resolve({ params, result });
          await realtimeControl.readRelease.promise;
          realtimeControl.readDelivered.resolve();
          return result;
        }));
      }
      return wrap(client.rpc(name, params));
    },
    auth: {
      getSession: async () => ({ data: { session: {
        user: { id: actorUserId }, access_token: accessToken,
      } }, error: null }),
      onAuthStateChange(callback) {
        const subscription = { unsubscribe() {} };
        queueMicrotask(() => callback?.('SIGNED_IN', {
          user: { id: actorUserId }, access_token: accessToken,
        }));
        return { data: { subscription } };
      },
    },
    realtime: { async setAuth(token) { assert.equal(token, accessToken); } },
    from: (...args) => client.from(...args),
    ...(realtimeControl ? {
      channel() {
        const channel = {
          on() { return channel; },
          subscribe(callback) {
            realtimeControl.triggerSubscribed = () => callback?.('SUBSCRIBED');
            return channel;
          },
          async unsubscribe() { return 'ok'; },
        };
        return channel;
      },
      removeChannel: async channel => channel.unsubscribe(),
    } : {
      channel: (...args) => client.channel(...args),
      removeChannel: (...args) => client.removeChannel(...args),
    }),
    getChannels: (...args) => client.getChannels(...args),
  });
}

async function checkedActorBundle(backend, actorUserId, options) {
  const client = mappedActorClient(backend.client, actorUserId, options);
  const reader = createDocumentGenerationReader({
    request: (name, params) => client.rpc(name, params),
    getActorUserId: () => actorUserId,
    download: async () => pdf(),
  });
  const checkedBundle = await reader.open({
    documentId: backend.ids.documentId,
    actorUserId,
    pdfGenerationId: backend.ids.generationId,
    contentModelVersion: 2,
  });
  return { client, checkedBundle };
}

async function readSurveyState(backend) {
  const bundle = await backend.read();
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bundle.annotationUpdate);
    return materializeSurveyCrdtV2(doc);
  } finally {
    doc.destroy();
  }
}

async function model1CheckedBundle(backend) {
  const baseline = new Y.Doc();
  const update = Y.encodeStateAsUpdate(baseline);
  baseline.destroy();
  const pdfBlob = pdf();
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const path = `${backend.ids.actorUserId}/_generations/model1-hook-fixture.pdf`;
  const envelope = includeSnapshot => ({
    version: 3,
    actor_user_id: backend.ids.actorUserId,
    document_id: backend.ids.documentId,
    generation_id: backend.ids.generationId,
    content_model_version: 1,
    document: {
      id: backend.ids.documentId,
      user_id: backend.ids.actorUserId,
      project_id: null,
      name: 'Model 1 hook fixture.pdf',
      file_path: path,
      file_size: String(pdfBytes.length),
    },
    pdf: {
      bucket_id: 'documents',
      path,
      id: '7b000000-0000-4000-8000-000000000001',
      version: '7b000000-0000-4000-8000-000000000002',
      byte_length: String(pdfBytes.length),
      content_sha256: sha(pdfBytes),
    },
    publication: {
      operation_id: '7b000000-0000-4000-8000-000000000003',
      generation_id: backend.ids.generationId,
      published_at: '2026-09-10T00:00:00.000Z',
      wal_head: '0',
    },
    annotations: {
      version: 3,
      document_id: backend.ids.documentId,
      generation_id: backend.ids.generationId,
      content_model_version: 1,
      wal_head: '0',
      snapshot: includeSnapshot ? {
        at_seq: '0',
        snapshot: hex(update),
        encoding_version: 1,
        writer_id: null,
        writer_epoch: '0',
      } : null,
      snapshot_sha256: includeSnapshot ? sha(update) : null,
    },
  });
  const reader = createDocumentGenerationReader({
    getActorUserId: () => backend.ids.actorUserId,
    download: async () => pdfBlob,
    request: async (name, params) => {
      assert.equal(name, 'read_document_generation_open_v3');
      return { data: envelope(params.p_include_snapshot) };
    },
  });
  return reader.open({
    documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId,
    contentModelVersion: 1,
  });
}

async function mountHook(t, {
  aggregateRequest,
  aggregateFactory,
  includeAggregateKey = true,
  checkedBundle: suppliedCheckedBundle,
} = {}) {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const checkedBundle = suppliedCheckedBundle === undefined
    ? await backend.read()
    : suppliedCheckedBundle;
  const aggregate = aggregateFactory?.(backend) || null;
  if (aggregate) aggregateRequest = aggregate.request;
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const previous = new Map();
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    indexedDB: new IDBFactory(),
    IDBKeyRange,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const appCalls = [];
  const annotationDocClient = {
    ...backend.client,
    rpc(name, params) {
      appCalls.push(name);
      return backend.client.rpc(name, params);
    },
  };
  const sessions = [];
  let latest;
  let renderedSurveyMarkers;
  const props = {
    documentId: backend.ids.documentId,
    userId: backend.ids.actorUserId,
    checkedBundle,
    enabled: true,
    annotationDocClient,
    docRole: 'owner',
    pageSizesRef: { current: {} },
    onGenerationSession: session => sessions.push(session),
  };
  if (includeAggregateKey) props.aggregateRequest = aggregateRequest;
  function Probe(current) {
    const [annotationsByPage, setAnnotationsByPage] = useState({});
    const [spaces, setSpaces] = useState([]);
    const [surveyMarkers, setSurveyMarkers] = useState({});
    renderedSurveyMarkers = surveyMarkers;
    latest = useAnnotationDoc({ ...current, annotationsByPage, setAnnotationsByPage,
      spaces, setSpaces, surveyMarkers, setSurveyMarkers });
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  const render = async patch => {
    Object.assign(props, patch);
    await act(async () => { root.render(React.createElement(Probe, props)); });
  };
  let live = true;
  const unmount = async () => {
    if (!live) return;
    live = false;
    await act(async () => { root.unmount(); });
  };
  await render({});
  t.after(async () => {
    await unmount();
    await Promise.allSettled(sessions.map(session => session.handle.destroy()));
    await purgeAnnotationDoc(backend.ids.documentId).catch(() => {});
    backend.destroy();
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    backend,
    checkedBundle,
    annotationDocClient,
    appCalls,
    props,
    sessions,
    aggregate,
    render,
    unmount,
    get latest() { return latest; },
    get renderedSurveyMarkers() { return renderedSurveyMarkers; },
  };
}

test('hook opt-in sends model 2 edits through strict aggregate transport only', async t => {
  const h = await mountHook(t, { aggregateFactory: aggregateServer });
  await until(() => h.latest?.initialHydration?.ready && h.sessions.length === 1,
    'aggregate hook did not hydrate');

  await act(async () => {
    h.latest.updateSurveyMarkers(markers => ({
      ...markers,
      'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'hook aggregate edit' },
    }));
  });
  await act(async () => { await h.latest.forceFlush(); });

  assert.equal(h.aggregate.calls.length, 1);
  assert.ok(h.aggregate.calls[0].body.length > 0);
  assert.equal(h.aggregate.calls[0].authorization, 'Bearer fixture-local-token');
  assert.equal(h.appCalls.includes('append_annotation_update_v3'), false);
  assert.equal(h.appCalls.includes('store_annotation_snapshot_v3'), false);
  assert.equal(h.backend.inspect().snapshotWrites, 0);
});

for (const variant of ['omitted', 'null']) {
  test(`hook ${variant} aggregate option keeps the default model 2 write path`, async t => {
    const h = await mountHook(t, {
      includeAggregateKey: variant !== 'omitted',
      aggregateRequest: null,
    });
    await until(() => h.latest?.initialHydration?.ready && h.sessions.length === 1,
      'default hook did not hydrate');
    await act(async () => {
      h.latest.updateSurveyMarkers(markers => ({
        ...markers,
        'fixture-marker-left': { ...markers['fixture-marker-left'], notes: `default-${variant}` },
      }));
    });
    await act(async () => { await h.latest.forceFlush(); });
    assert.equal(h.appCalls.includes('append_annotation_update_v3'), true);
    assert.equal(h.appCalls.includes('store_annotation_snapshot_v3'), true);
    assert.equal(h.backend.inspect().snapshotWrites, 1);
  });
}

for (const [label, config] of [
  ['invalid callback', { aggregateRequest: 'not-a-function' }],
  ['unchecked document', { aggregateRequest: async () => Response.json({}), checkedBundle: null }],
]) {
  test(`hook rejects aggregate opt-in for ${label} without publishing a session`, async t => {
    const h = await mountHook(t, config);
    await until(() => h.latest?.status?.errorCode === 'ANNOTATION_AGGREGATE_INPUT',
      'invalid aggregate option did not fail closed');
    assert.equal(h.sessions.length, 0);
    assert.equal(h.appCalls.includes('append_annotation_update_v3'), false);
    assert.equal(h.appCalls.includes('store_annotation_snapshot_v3'), false);
  });
}

test('hook rejects aggregate opt-in for an actual checked model 1 bundle', async t => {
  let requests = 0;
  const h = await mountHook(t, { aggregateRequest: async () => { requests += 1; } });
  await until(() => h.sessions.length === 1, 'initial checked model 2 handle did not hydrate');
  const checkedModel1 = await model1CheckedBundle(h.backend);
  await h.render({ checkedBundle: checkedModel1 });
  await until(() => h.latest?.status?.errorCode === 'ANNOTATION_AGGREGATE_INPUT',
    'checked model 1 aggregate opt-in did not fail closed');
  assert.equal(requests, 0);
  assert.equal(h.sessions.length, 1, 'the model 1 attempt must not publish a replacement session');
  assert.throws(() => h.sessions[0].handle.setMeta('stale', true), { code: 'ANNOTATION_HANDLE_CLOSED' });
  await act(async () => { await h.sessions[0].handle.destroy(); });
});

test('aggregate callback add, replace, and remove retire only changed handle identities', async t => {
  const h = await mountHook(t, { aggregateRequest: null });
  await until(() => h.sessions.length === 1, 'default handle did not hydrate');
  const firstHandle = h.sessions[0].handle;
  const firstServer = aggregateServer(h.backend);
  await h.render({ aggregateRequest: firstServer.request });
  await until(() => h.sessions.length === 2 && h.latest?.initialHydration?.ready,
    'adding aggregate opt-in did not reopen the writer');
  assert.throws(() => firstHandle.setMeta('stale', true), { code: 'ANNOTATION_HANDLE_CLOSED' });

  const aggregateHandle = h.sessions[1].handle;
  await h.render({ aggregateRequest: firstServer.request });
  await act(async () => { await Promise.resolve(); });
  assert.equal(h.sessions.length, 2, 'an unchanged callback must keep its writer');
  const firstEnsureLocalDurability = h.latest.ensureLocalDurability;
  let firstAggregateReceipt;
  await act(async () => { firstAggregateReceipt = await firstEnsureLocalDurability(); });
  assert.equal(h.latest.isLocalDurabilityCurrent(firstAggregateReceipt), true);

  const secondServer = aggregateServer(h.backend);
  await h.render({ aggregateRequest: secondServer.request });
  await until(() => h.sessions.length === 3 && h.latest?.initialHydration?.ready,
    'a replacement callback did not reopen the writer');
  assert.throws(() => aggregateHandle.setMeta('stale', true), { code: 'ANNOTATION_HANDLE_CLOSED' });
  assert.equal(h.latest.isLocalDurabilityCurrent(firstAggregateReceipt), false,
    'a receipt from the replaced callback identity is not current');
  let replacedReceiptError;
  await act(async () => {
    try { await firstEnsureLocalDurability(); } catch (error) { replacedReceiptError = error; }
  });
  assert.equal(replacedReceiptError?.code, 'ANNOTATION_LOCAL_SCOPE_CHANGED');
  await act(async () => {
    h.latest.updateSurveyMarkers(markers => ({
      ...markers,
      'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'second adapter only' },
    }));
  });
  await act(async () => { await h.latest.forceFlush(); });
  assert.equal(firstServer.calls.length, 0);
  assert.equal(secondServer.calls.length, 1, 'the replacement writer uses only its own adapter');

  const secondHandle = h.sessions[2].handle;
  await h.render({ aggregateRequest: null });
  await until(() => h.sessions.length === 4 && h.latest?.initialHydration?.ready,
    'removing aggregate opt-in did not reopen the writer');
  assert.notStrictEqual(h.sessions[3].handle, secondHandle);
  assert.throws(() => secondHandle.setMeta('stale', true), { code: 'ANNOTATION_HANDLE_CLOSED' });
});

test('held synthetic actor A request settles only its own scope and cannot route through B then A replacements', async t => {
  const started = deferred();
  const release = deferred();
  const actorBReadStarted = deferred();
  const actorBReadRelease = deferred();
  const actorBReadDelivered = deferred();
  t.after(() => release.resolve());
  t.after(() => actorBReadRelease.resolve());
  let oldServer;
  const h = await mountHook(t, { aggregateFactory: backend => {
    oldServer = aggregateServer(backend);
    return {
      calls: oldServer.calls,
      async request(call) {
        assert.equal(Object.isFrozen(call.headers), true);
        assert.equal(call.headers.Authorization, 'Bearer fixture-local-token');
        started.resolve();
        await release.promise;
        return oldServer.request(call);
      },
    };
  } });
  await until(() => h.sessions.length === 1 && h.latest?.initialHydration?.ready,
    'actor A aggregate handle did not hydrate');
  const actorAHandle = h.sessions[0].handle;
  const oldEnsureLocalDurability = h.latest.ensureLocalDurability;
  const oldIsLocalDurabilityCurrent = h.latest.isLocalDurabilityCurrent;

  await act(async () => {
    h.latest.updateSurveyMarkers(markers => ({
      ...markers,
      'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'actor A held' },
    }));
  });
  await act(async () => {
    await within(started.promise, 'actor A aggregate request did not start');
  });
  let oldLocalReceipt;
  await act(async () => { oldLocalReceipt = await oldEnsureLocalDurability(); });
  assert.equal(oldIsLocalDurabilityCurrent(oldLocalReceipt), true);

  const actorB = '7c000000-0000-4000-8000-000000000002';
  // Synthetic actor B uses a real checked reader bundle. Its manual realtime
  // callback and held checked read separate old-handle projection from B catch-up.
  const actorBRealtime = {
    armed: false,
    readStarted: actorBReadStarted,
    readRelease: actorBReadRelease,
    readDelivered: actorBReadDelivered,
    triggerSubscribed: null,
  };
  const actorBOpen = await checkedActorBundle(h.backend, actorB, {
    realtimeControl: actorBRealtime,
  });
  const actorBServer = aggregateServer(h.backend, {
    actor: actorB,
    accessToken: `fixture-token-${actorB}`,
  });
  await h.render({
    userId: actorB,
    checkedBundle: actorBOpen.checkedBundle,
    annotationDocClient: actorBOpen.client,
    aggregateRequest: actorBServer.request,
  });
  await until(() => h.sessions.length === 2 && h.latest?.initialHydration?.ready,
    'actor B aggregate handle did not hydrate');
  assert.equal(h.sessions[1].handle.actorUserId, actorB);
  assert.equal(h.latest.isLocalDurabilityCurrent(oldLocalReceipt), false,
    'actor A local proof cannot validate the actor B scope');
  assert.equal(oldIsLocalDurabilityCurrent(oldLocalReceipt), false,
    'the captured actor A validator sees that its handle was retired');
  let retiredReceiptError;
  await act(async () => {
    try { await oldEnsureLocalDurability(); } catch (error) { retiredReceiptError = error; }
  });
  assert.equal(retiredReceiptError?.code, 'ANNOTATION_LOCAL_SCOPE_CHANGED');

  const actorBViewBeforeRelease = structuredClone(h.renderedSurveyMarkers);
  const actorBRevisionBeforeRelease = h.sessions[1].handle.getLocalRevision();
  actorBRealtime.armed = true;
  assert.equal(typeof actorBRealtime.triggerSubscribed, 'function');
  let heldActorBCatchup;
  await act(async () => {
    heldActorBCatchup = actorBRealtime.triggerSubscribed();
    await Promise.resolve();
  });
  assert.ok(heldActorBCatchup && typeof heldActorBCatchup.then === 'function');
  const firstActorBRead = await within(actorBReadStarted.promise,
    'actor B checked catch-up did not start');
  assert.equal(String(firstActorBRead.result.data.wal_head), '0',
    'the held actor B response is the checked H0 view from before actor A settles');

  await act(async () => {
    release.resolve();
    await actorAHandle.destroy();
  });
  assert.equal(oldServer.calls.length, 1, 'the retired actor A adapter cannot issue a second request');
  assert.equal(actorBServer.calls.length, 0);
  assert.deepEqual(h.renderedSurveyMarkers, actorBViewBeforeRelease,
    'the retired actor A reply cannot project into actor B React state');
  assert.equal(h.sessions[1].handle.getLocalRevision(), actorBRevisionBeforeRelease,
    'the retired actor A reply cannot advance actor B local revision');
  const actorAHead = h.backend.inspect().walHead;
  assert.ok(actorAHead > 0, 'actor A settled its accepted row in its own server scope');

  await act(async () => {
    actorBReadRelease.resolve();
    await within(actorBReadDelivered.promise, 'actor B did not receive its held H0 response');
    await heldActorBCatchup;
  });
  assert.deepEqual(h.renderedSurveyMarkers, actorBViewBeforeRelease,
    'the stale checked H0 response cannot introduce actor A into actor B');
  assert.equal(h.sessions[1].handle.getLocalRevision(), actorBRevisionBeforeRelease);

  await act(async () => { await actorBRealtime.triggerSubscribed(); });
  assert.equal(h.renderedSurveyMarkers?.['fixture-marker-left']?.notes, 'actor A held',
    'actor B applies actor A only through its fresh checked catch-up');
  assert.equal(actorBOpen.client.rpcCalls.some(call => (
    call.name === 'read_annotation_updates_v3'
      && call.params.p_through_seq === String(actorAHead)
  )), true, 'actor B only receives actor A through a checked tail read that covers its sequence');

  await act(async () => {
    h.latest.updateSurveyMarkers(markers => ({
      ...markers,
      'fixture-marker-right': { ...markers['fixture-marker-right'], notes: 'actor B current' },
    }));
  });
  await act(async () => { await h.latest.forceFlush(); });
  assert.equal(oldServer.calls.length, 1);
  assert.equal(actorBServer.calls.length, 1);
  assert.equal(actorBServer.calls[0].authorization, `Bearer fixture-token-${actorB}`);
  let afterActorB;
  await act(async () => { afterActorB = await readSurveyState(h.backend); });
  assert.equal(afterActorB.surveyMarkers['fixture-marker-left'].notes, 'actor A held');
  assert.equal(afterActorB.surveyMarkers['fixture-marker-right'].notes, 'actor B current');

  const actorAReplacement = aggregateServer(h.backend);
  await h.render({
    userId: h.backend.ids.actorUserId,
    checkedBundle: h.checkedBundle,
    annotationDocClient: h.annotationDocClient,
    aggregateRequest: actorAReplacement.request,
  });
  await until(() => h.sessions.length === 3 && h.latest?.initialHydration?.ready,
    'replacement actor A aggregate handle did not hydrate');
  assert.equal(h.sessions[2].handle.actorUserId, h.backend.ids.actorUserId);
  await act(async () => {
    h.latest.updateSurveyMarkers(markers => ({
      ...markers,
      'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'actor A replacement' },
    }));
  });
  await act(async () => { await h.latest.forceFlush(); });
  assert.equal(oldServer.calls.length, 1, 'the first actor A adapter stays retired after A/B/A');
  assert.equal(actorBServer.calls.length, 1, 'the actor B adapter stays retired after A/B/A');
  assert.equal(actorAReplacement.calls.length, 1);
  assert.equal(actorAReplacement.calls[0].authorization, 'Bearer fixture-local-token');
  let afterActorAReplacement;
  await act(async () => { afterActorAReplacement = await readSurveyState(h.backend); });
  assert.equal(afterActorAReplacement.surveyMarkers['fixture-marker-left'].notes,
    'actor A replacement');
  assert.equal(afterActorAReplacement.surveyMarkers['fixture-marker-right'].notes,
    'actor B current');
});
