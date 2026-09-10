import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import * as Y from 'yjs';
import { useAnnotationDoc } from '../src/hooks/useAnnotationDoc.js';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { purgeAnnotationDoc } from '../src/services/annotationDocSync.js';
import {
  buildEraseIntent,
  ERASE_OUTBOX_MAP,
} from '../src/utils/annotationEraseTransaction.js';

const pdf = () => new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await act(async () => { await wait(5); });
  }
  assert.fail(message);
}

// The fixture has no real auth service. This adapter issues a privately branded
// checked bundle for B while keeping every stored row and effect owned by A.
function mappedActorClient(client, actorUserId) {
  const accessToken = `fixture-token-${actorUserId}`;
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
    rpc(name, params) { return wrap(client.rpc(name, params)); },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: actorUserId }, access_token: accessToken } }, error: null }),
      onAuthStateChange(callback) {
        const subscription = { unsubscribe() {} };
        queueMicrotask(() => callback?.('SIGNED_IN', { user: { id: actorUserId }, access_token: accessToken }));
        return { data: { subscription } };
      },
    },
    realtime: { async setAuth(token) {
      if (token !== accessToken) throw new Error('Mapped fixture realtime auth rejected.');
    } },
    from: (...args) => client.from(...args),
    channel: (...args) => client.channel(...args),
    removeChannel: (...args) => client.removeChannel(...args),
    getChannels: (...args) => client.getChannels(...args),
  });
}

async function issueCheckedActorBundle(backend, actorUserId) {
  const client = mappedActorClient(backend.client, actorUserId);
  const reader = createDocumentGenerationReader({
    request: (name, params) => client.rpc(name, params),
    getActorUserId: () => actorUserId,
    download: async () => pdf(),
  });
  const checkedBundle = await reader.open({ documentId: backend.ids.documentId,
    actorUserId, pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 });
  return { client, checkedBundle };
}

async function mountedLifecycle(t) {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const checkedBundle = await backend.read();
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
  let latest = null;
  let view = null;
  const calls = [];
  let releaseFirst;
  let firstHasStarted = false;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const consumers = {
    A: async effect => {
      calls.push(`A-old:${effect.type}`);
      if (effect.type === 'trash') {
        firstHasStarted = true;
        await firstGate;
      }
    },
    B: async effect => { calls.push(`B:${effect.type}`); },
    A2: async effect => { calls.push(`A-new:${effect.type}`); },
  };
  const sessions = [];
  const state = {
    documentId: backend.ids.documentId,
    userId: backend.ids.actorUserId,
    enabled: true,
    checkedBundle,
    annotationDocClient: backend.client,
    consumer: consumers.A,
  };
  function Probe(props) {
    const [annotationsByPage, setAnnotationsByPage] = useState({});
    const [spaces, setSpaces] = useState([]);
    const [surveyMarkers, setSurveyMarkers] = useState({});
    view = { annotationsByPage, spaces, surveyMarkers };
    latest = useAnnotationDoc({ ...props, annotationsByPage, setAnnotationsByPage,
      spaces, setSpaces, surveyMarkers, setSurveyMarkers,
      pageSizesRef: { current: {} }, docRole: 'owner',
      eraseEffectConsumer: props.consumer,
      onGenerationSession: session => sessions.push(session) });
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  const render = async patch => {
    Object.assign(state, patch);
    await act(async () => { root.render(React.createElement(Probe, state)); });
  };
  let live = true;
  const unmount = async () => {
    if (!live) return;
    live = false;
    await act(async () => { root.unmount(); });
  };
  await render({});
  await until(() => latest?.initialHydration?.ready, 'hook did not hydrate');
  t.after(async () => {
    releaseFirst();
    await unmount();
    await Promise.allSettled(sessions.map(session => session.handle.destroy()));
    await purgeAnnotationDoc(backend.ids.documentId);
    backend.destroy();
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { backend, checkedBundle, state, consumers, calls, sessions, render, unmount,
    get latest() { return latest; }, get view() { return view; },
    get firstHasStarted() { return firstHasStarted; }, releaseFirst };
}

async function startTwoEffectErase(h, mutationId) {
  const markerId = 'fixture-marker-left';
  const expectedMarker = h.view.surveyMarkers[markerId];
  assert.ok(expectedMarker);
  await act(async () => {
    const result = await h.latest.commitEraseIntent(buildEraseIntent({
      mutationId, pageNumber: 1, renderer: 'svg',
      gesture: { points: [{ x: 80, y: 100 }], radius: 10, mode: 'whole' },
      surveyMarkerTargets: [{ markerId, expectedMarker }],
      sideEffects: [
        { type: 'trash', targetKey: markerId,
          payload: { before: structuredClone(expectedMarker) } },
        { type: 'history', targetKey: markerId,
          payload: { before: structuredClone(expectedMarker) } },
      ],
    }), { permissionContext: { mode: 'registered', viewerId: h.state.userId,
      documentOwnerId: h.state.userId }, validateSurveyTarget: () => true });
    assert.equal(result.status, 'committed');
  });
  await until(() => h.firstHasStarted, 'first erase effect did not start');
}

async function durableEntry(backend, mutationId) {
  const bundle = await backend.read();
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bundle.annotationUpdate);
    return structuredClone(doc.getMap(ERASE_OUTBOX_MAP).get(mutationId));
  } finally { doc.destroy(); }
}

for (const lifecycle of ['disable', 'unmount', 'document-switch']) {
  test(`${lifecycle} during a held accepted effect keeps its ack and blocks the next effect`, async t => {
    const h = await mountedLifecycle(t);
    const mutationId = `hook-${lifecycle}-held-effect`;
    await startTwoEffectErase(h, mutationId);
    const oldHandle = h.sessions[0].handle;
    if (lifecycle === 'disable') await h.render({ enabled: false, consumer: h.consumers.B });
    else if (lifecycle === 'unmount') await h.unmount();
    else await h.render({ documentId: '7a000000-0000-4000-8000-000000000003',
      pdfGenerationId: null, checkedBundle: null, consumer: h.consumers.B });
    h.releaseFirst();
    await act(async () => { await oldHandle.destroy(); });
    await until(async () => (await durableEntry(h.backend, mutationId))
      ?.acknowledgedEffectKeys?.length === 1, 'completed effect acknowledgement was not durable');
    assert.deepEqual(h.calls, ['A-old:trash']);
    const entry = await durableEntry(h.backend, mutationId);
    assert.equal(entry.status, 'pending');
    assert.equal(entry.acknowledgedEffectKeys.length, 1);
    assert.equal(entry.acknowledgedEffectKeys[0], entry.effects[0].idempotencyKey);
    assert.deepEqual(h.calls, ['A-old:trash']);
  });
}

test('a live handle sends its next effect to the latest same-scope consumer', async t => {
  const h = await mountedLifecycle(t);
  const mutationId = 'hook-live-consumer-replacement';
  await startTwoEffectErase(h, mutationId);
  await h.render({ consumer: h.consumers.A2 });
  assert.equal(h.sessions.length, 1, 'a callback-only change must not replace the handle');
  h.releaseFirst();
  await until(() => h.calls.includes('A-new:history'), 'the current consumer did not receive effect 2');
  await until(async () => (await durableEntry(h.backend, mutationId))?.status === 'acknowledged',
    'the live replacement consumer did not durably acknowledge the entry');
  assert.deepEqual(h.calls, ['A-old:trash', 'A-new:history']);
});

test('A to B to A cannot route an old held drain into either replacement consumer', async t => {
  const h = await mountedLifecycle(t);
  const mutationId = 'hook-account-aba-held-effect';
  await startTwoEffectErase(h, mutationId);
  const oldHandle = h.sessions[0].handle;
  const actorB = '7a000000-0000-4000-8000-000000000002';
  const actorBOpen = await issueCheckedActorBundle(h.backend, actorB);
  const headBeforeB = h.backend.inspect().walHead;
  await h.render({ userId: actorB, checkedBundle: actorBOpen.checkedBundle,
    annotationDocClient: actorBOpen.client, consumer: h.consumers.B });
  await until(() => h.sessions.length >= 2, 'replacement B handle did not become ready');
  assert.equal(h.backend.inspect().walHead, headBeforeB, 'B hydration must not write A state');
  assert.equal(h.calls.some(call => call.startsWith('B:')), false,
    'B must not execute A-owned pending effects');
  await h.render({ userId: h.backend.ids.actorUserId,
    checkedBundle: h.checkedBundle, annotationDocClient: h.backend.client,
    consumer: h.consumers.A2 });
  await until(() => h.sessions.length >= 3, 'replacement A handle did not become ready');
  await until(() => h.calls.includes('A-new:history'),
    'replacement A did not complete its valid same-actor recovery');
  const callsBeforeOldRelease = [...h.calls];
  h.releaseFirst();
  await act(async () => { await oldHandle.destroy(); });
  assert.deepEqual(h.calls, callsBeforeOldRelease,
    'the retired old drain must not invoke the replacement consumer');
  await h.unmount();
  await act(async () => { await Promise.all(h.sessions.map(session => session.handle.destroy())); });
  await until(async () => {
    try { return (await durableEntry(h.backend, mutationId))?.status === 'acknowledged'; }
    catch { return false; }
  }, 'the replacement A acknowledgement did not remain in checked cloud state');
});
