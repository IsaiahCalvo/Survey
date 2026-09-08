import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { openAnnotationDoc, __test } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function backend() {
  const cloud = { actor: 'actor-a', log: [], snapshot: null, tailGate: null,
    tailEntered: null, failTail: false, appendGate: null, sessionHook: null };
  const authListeners = new Set();
  cloud.switchActor = actor => {
    cloud.actor = actor;
    for (const listener of authListeners) listener('SIGNED_IN', {
      user: { id: actor }, access_token: 'fixture-token',
    });
  };
  cloud.auth = { onAuthStateChange(callback) {
    authListeners.add(callback);
    return { data: { subscription: { unsubscribe() { authListeners.delete(callback); } } } };
  }, async getSession() {
    await cloud.sessionHook?.();
    return { data: { session: { user: { id: cloud.actor }, access_token: 'fixture-token' } } };
  } };
  function request(run) {
    const builder = { setHeader() { return builder; }, then(resolve, reject) {
      return Promise.resolve().then(run).then(resolve, reject);
    } };
    return builder;
  }
  cloud.from = table => {
    let after = null;
    const builder = request(async () => {
      if (table === 'annotation_snapshots') return { data: cloud.snapshot, error: null };
      if (after === null) return { data: null, error: null };
      cloud.tailEntered?.resolve();
      await cloud.tailGate?.promise;
      if (cloud.failTail) return { data: null, error: { message: 'offline fixture' } };
      return { data: cloud.log.filter(row => row.seq > after).slice(0, 1000), error: null };
    });
    for (const name of ['select', 'eq', 'order', 'limit', 'maybeSingle']) builder[name] = () => builder;
    builder.gt = (_field, value) => { after = Number(value); return builder; };
    return builder;
  };
  cloud.rpc = (name, args) => request(async () => {
    if (name === 'append_annotation_update') {
      await cloud.appendGate?.promise;
      const seq = Math.max(0, ...cloud.log.map(row => row.seq)) + 1;
      cloud.log.push({ seq, data: args.p_data, client_id: args.p_client_id,
        client_seq: args.p_client_seq, actor_user_id: cloud.actor });
      return { data: { seq }, error: null };
    }
    assert.equal(name, 'store_annotation_snapshot');
    return { data: { accepted: true }, error: null };
  });
  cloud.channel = () => ({ on(_event, _filter, callback) {
    cloud.realtime = callback; return this;
  }, subscribe(callback) { cloud.status = callback; return this; } });
  cloud.removeChannel = async () => {};
  return cloud;
}

function remote(cloud, seq, label = 'Saved', doc = new Y.Doc()) {
  doc.getMap('annoMeta').set('label', label);
  cloud.log.push({ seq, data: __test.bytesToPgHex(Y.encodeStateAsUpdate(doc)),
    client_id: 'other-device', client_seq: seq, actor_user_id: 'actor-b' });
  return doc;
}

async function open(t, { cloud = backend(), realtime = false } = {}) {
  const outbox = createMemoryAnnotationOutbox();
  const handle = await openAnnotationDoc({ documentId: crypto.randomUUID(),
    actorUserId: 'actor-a', supabase: cloud, doc: new Y.Doc(), outboxStore: outbox,
    enableLocal: false, enableRealtime: realtime, snapshotRetryDelayMs: 0 });
  t.after(async () => {
    cloud.actor = 'actor-a'; cloud.sessionHook = null; cloud.failTail = false;
    cloud.tailGate?.resolve(); cloud.appendGate?.resolve();
    await handle.destroy();
  });
  return { handle, cloud, outbox };
}

test('accepted capture reads the fresh ordered tail and returns owned immutable state', async t => {
  const { handle, cloud } = await open(t);
  remote(cloud, 7);
  const capture = await handle.captureAcceptedAnnotationState();
  assert.equal(capture.documentId, handle.documentId);
  assert.equal(capture.actorUserId, 'actor-a');
  assert.equal(capture.coveredSeq, 7);
  assert.equal(capture.annotationState.annoMeta.label, 'Saved');
  assert.ok(Object.isFrozen(capture.annotationState.annoMeta));
  assert.equal(await handle.revalidateAcceptedAnnotationCapture(capture), true);
  assert.equal(await handle.revalidateAcceptedAnnotationCapture({ ...capture }), false);
});

test('capture revalidation rejects new accepted edits and a different handle', async t => {
  const { handle, cloud } = await open(t);
  const doc = remote(cloud, 1);
  const capture = await handle.captureAcceptedAnnotationState();
  const other = await open(t);
  assert.equal(await other.handle.revalidateAcceptedAnnotationCapture(capture), false);
  remote(cloud, 2, 'Changed', doc);
  assert.equal(await handle.revalidateAcceptedAnnotationCapture(capture), false);
  assert.equal(handle.getMeta('label'), 'Changed');
});

test('capture rejects unsent edits rather than waiting on their cloud write', async t => {
  const { handle, cloud } = await open(t);
  cloud.appendGate = deferred();
  handle.setMeta('label', 'Unsent');
  await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_CAPTURE_NOT_READY' });
});

test('failed tail read cannot issue a capture despite an idle queue', async t => {
  const { handle, cloud } = await open(t);
  assert.equal(handle.getSyncStatus().queueSize, 0);
  cloud.failTail = true;
  await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_CAPTURE_NOT_READY' });
});

test('account switch during a tail read rejects the stale result', async t => {
  const { handle, cloud } = await open(t);
  cloud.tailGate = deferred(); cloud.tailEntered = deferred();
  const capture = handle.captureAcceptedAnnotationState();
  await cloud.tailEntered.promise;
  cloud.actor = 'actor-b'; cloud.tailGate.resolve();
  await assert.rejects(capture, { code: 'ANNOTATION_ACTOR_MISMATCH' });
});

test('closing a handle invalidates its capture and any in-flight capture', async t => {
  const { handle, cloud } = await open(t);
  const capture = await handle.captureAcceptedAnnotationState();
  cloud.tailGate = deferred(); cloud.tailEntered = deferred();
  const pending = handle.captureAcceptedAnnotationState();
  await cloud.tailEntered.promise;
  const close = handle.destroy(); cloud.tailGate.resolve();
  await assert.rejects(pending, { code: 'ANNOTATION_HANDLE_CLOSED' });
  await close;
  assert.equal(await handle.revalidateAcceptedAnnotationCapture(capture), false);
});

test('in-place live JSON mutation without a Yjs event is neither accepted nor current', async t => {
  const { handle, cloud } = await open(t);
  const doc = new Y.Doc();
  doc.getMap('annoMeta').set('settings', { color: 'blue' });
  remote(cloud, 1, 'Saved', doc);
  const capture = await handle.captureAcceptedAnnotationState();
  const revision = handle.getLocalRevision();
  handle.doc.getMap('annoMeta').get('settings').color = 'red';
  assert.equal(handle.getLocalRevision(), revision);
  assert.equal(await handle.revalidateAcceptedAnnotationCapture(capture), false);
  await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_CAPTURE_NOT_READY' });
  assert.equal(capture.annotationState.annoMeta.settings.color, 'blue');
});

test('a different-context hard deletion invalidates a capture', async t => {
  const { handle, outbox } = await open(t);
  const capture = await handle.captureAcceptedAnnotationState();
  await outbox.deleteDocument(handle.documentId);
  assert.equal(await handle.revalidateAcceptedAnnotationCapture(capture), false);
  await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_DOCUMENT_DELETED' });
});

for (const revalidate of [false, true]) test(`deletion during final session check rejects ${revalidate ? 'revalidation' : 'capture'}`, async t => {
  const { handle, cloud, outbox } = await open(t);
  const previous = await handle.captureAcceptedAnnotationState();
  let sessions = 0;
  cloud.sessionHook = async () => {
    // Capture's initial session, tail request session, post-tail session, final session.
    if (++sessions === 4) await outbox.deleteDocument(handle.documentId);
  };
  if (revalidate) assert.equal(await handle.revalidateAcceptedAnnotationCapture(previous), false);
  else await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_DOCUMENT_DELETED' });
  assert.equal(sessions, 4);
});

test('account change during the final local incarnation read invalidates capture', async t => {
  const { handle, cloud, outbox } = await open(t);
  const read = outbox.assertScopeCurrent.bind(outbox);
  outbox.assertScopeCurrent = async (...args) => {
    await read(...args);
    cloud.switchActor('actor-b');
  };
  await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_ACTOR_MISMATCH' });
  outbox.assertScopeCurrent = read;
});

test('retiring the legacy scope invalidates an old capture without deleting the document', async t => {
  const { handle, outbox } = await open(t);
  const capture = await handle.captureAcceptedAnnotationState();
  await outbox.retireScope(handle.documentId, 'actor-a', 0, {
    replacementGenerationId: '50000000-0000-4000-8000-000000000001',
    reason: 'cloud-generation-replaced',
  });
  assert.equal(await outbox.getDocumentIncarnation(handle.documentId), 0);
  assert.equal(await handle.revalidateAcceptedAnnotationCapture(capture), false);
  await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_PDF_GENERATION_RETIRED' });
});

test('a local edit during catch-up cannot become an accepted capture', async t => {
  const { handle, cloud } = await open(t);
  cloud.tailGate = deferred(); cloud.tailEntered = deferred(); cloud.appendGate = deferred();
  const capture = handle.captureAcceptedAnnotationState();
  await cloud.tailEntered.promise;
  handle.setMeta('label', 'New unsent edit');
  cloud.tailGate.resolve();
  await assert.rejects(capture, { code: 'ANNOTATION_CAPTURE_NOT_READY' });
});

test('a realtime row above the ordered tail frontier cannot be captured', async t => {
  const { handle, cloud } = await open(t, { realtime: true });
  await cloud.status('SUBSCRIBED');
  let sessions = 0;
  cloud.sessionHook = () => {
    if (++sessions === 3) {
      const doc = remote(cloud, 5, 'Later realtime row');
      const row = cloud.log.pop();
      cloud.realtime({ new: row });
      doc.destroy();
    }
  };
  await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_CAPTURE_NOT_READY' });
});

test('accepted local writes can be captured after they settle', async t => {
  const { handle } = await open(t);
  handle.setMeta('label', 'Accepted local edit');
  await handle.drain();
  const capture = await handle.captureAcceptedAnnotationState();
  assert.equal(capture.annotationState.annoMeta.label, 'Accepted local edit');
  assert.equal(capture.coveredSeq, 1);
});

test('snapshot tuple and tail coverage are kept separate', async t => {
  const cloud = backend();
  const doc = new Y.Doc(); doc.getMap('annoMeta').set('label', 'Snapshot');
  cloud.snapshot = { snapshot: __test.bytesToPgHex(Y.encodeStateAsUpdate(doc)), at_seq: 8,
    encoding_version: 1, writer_id: 'snapshot-writer', writer_epoch: 3 };
  const { handle } = await open(t, { cloud });
  remote(cloud, 11, 'Tail', doc);
  const capture = await handle.captureAcceptedAnnotationState();
  assert.deepEqual(capture.snapshotBase, { atSeq: 8, writerId: 'snapshot-writer', writerEpoch: 3 });
  assert.equal(capture.coveredSeq, 11);
  assert.equal(capture.annotationState.annoMeta.label, 'Tail');
});

test('snapshot chain changing during the final session check invalidates capture', async t => {
  const { handle, cloud } = await open(t);
  let sessions = 0;
  cloud.sessionHook = async () => {
    if (++sessions === 4) {
      cloud.sessionHook = null;
      await handle.flushSnapshot();
    }
  };
  await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_CAPTURE_NOT_READY' });
});

test('accepted unknown maps must not silently vanish from captured state', async t => {
  const { handle, cloud } = await open(t);
  const doc = new Y.Doc(); doc.getMap('future-map').set('important', { value: 1 });
  remote(cloud, 1, 'Saved', doc);
  await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_GENERATION_STATE_INVALID' });
});

test('accepted but unresolved Yjs history cannot issue a capture', async t => {
  const { handle, cloud } = await open(t);
  const doc = new Y.Doc(); doc.getMap('annoMeta').set('label', 'Missing predecessor');
  const baseline = Y.encodeStateVector(doc);
  doc.getMap('annoMeta').set('label', 'Dependent update');
  cloud.log.push({ seq: 2, data: __test.bytesToPgHex(Y.encodeStateAsUpdate(doc, baseline)),
    client_id: 'other-device', client_seq: 2, actor_user_id: 'actor-b' });
  await assert.rejects(handle.captureAcceptedAnnotationState(), { code: 'ANNOTATION_GENERATION_STATE_INVALID' });
});
