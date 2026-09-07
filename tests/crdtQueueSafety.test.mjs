import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, readQueue, drainQueue } from '../src/lib/collab/crdtDualWriteQueue.js';
import { createQueueRetryHandlers } from '../src/lib/collab/crdtQueueRetryHandlers.js';
import * as Y from 'yjs';

function fixture(t) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => prior ? Object.defineProperty(globalThis, 'localStorage', prior) : delete globalThis.localStorage);
  return { storage, values };
}
const add = (annoId, version, documentId = 'doc-a') => enqueue({
  userId: 'user-a', annoId, side: 'legacy', payload: { version, opts: { documentId } },
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('drain preserves re-edits and new annotations queued during its request', async (t) => {
  fixture(t);
  add('a', 1);
  const gate = deferred();
  const started = deferred();
  const pending = drainQueue({ userId: 'user-a', documentId: 'doc-a', retryLegacyWrite: async () => {
    started.resolve(); await gate.promise;
  } });
  await started.promise;
  add('a', 2);
  add('b', 1);
  gate.resolve();
  await pending;
  assert.equal(readQueue('user-a').a.payload.version, 2);
  assert.equal(readQueue('user-a').b.payload.version, 1);
});

test('failed old request cannot add retry counts to a newer replacement', async (t) => {
  fixture(t);
  add('a', 1);
  const gate = deferred();
  const started = deferred();
  const pending = drainQueue({ userId: 'user-a', documentId: 'doc-a', retryLegacyWrite: async () => {
    started.resolve(); await gate.promise; throw new Error('offline');
  } });
  await started.promise;
  add('a', 2);
  gate.resolve();
  await pending;
  assert.equal(readQueue('user-a').a.payload.version, 2);
  assert.equal(readQueue('user-a').a.attempts, 0);
});

test('a later entry edited during an earlier retry sends only its newest value', async (t) => {
  fixture(t);
  add('a', 1); add('b', 1);
  const sent = [];
  await drainQueue({ userId: 'user-a', documentId: 'doc-a', retryLegacyWrite: async (payload) => {
    sent.push(payload.version);
    if (sent.length === 1) add('b', 2);
  } });
  assert.deepEqual(sent, [1, 2]);
  assert.deepEqual(readQueue('user-a'), {});
});

test('a different browser tab holding the drain lock prevents duplicate retry', async (t) => {
  fixture(t);
  add('a', 1);
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let lockOptions;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: async (_name, options, callback) => { lockOptions = options; return callback(null); },
  } } });
  t.after(() => prior ? Object.defineProperty(globalThis, 'navigator', prior) : delete globalThis.navigator);
  const result = await drainQueue({ userId: 'user-a', documentId: 'doc-a', retryLegacyWrite: async () => assert.fail('busy lock') });
  assert.equal(result.skippedBusy, true);
  assert.equal(lockOptions.ifAvailable, true);
  assert.ok(readQueue('user-a').a);
});

test('overlapping drains do not duplicate the same outbound request', async (t) => {
  fixture(t);
  add('a', 1);
  const gate = deferred();
  const started = deferred();
  let requests = 0;
  const args = { userId: 'user-a', documentId: 'doc-a', retryLegacyWrite: async () => {
    requests++; started.resolve(); await gate.promise;
  } };
  const first = drainQueue(args);
  await started.promise;
  const second = drainQueue(args);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(requests, 1);
});

test('a document drains only its own work and leaves old unscoped work intact', async (t) => {
  fixture(t);
  add('a', 1, 'doc-a');
  add('b', 1, 'doc-b');
  enqueue({ userId: 'user-a', annoId: 'unknown', side: 'legacy', payload: {} });
  const seen = [];
  await drainQueue({ userId: 'user-a', documentId: 'doc-a', retryLegacyWrite: async (payload) => {
    seen.push(payload.opts.documentId);
  } });
  assert.deepEqual(seen, ['doc-a']);
  assert.deepEqual(Object.keys(readQueue('user-a')).sort(), ['b', 'unknown']);
});

test('local storage quota errors are surfaced, not reported as a durable enqueue', (t) => {
  const { storage } = fixture(t);
  storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  assert.throws(() => add('a', 1), { code: 'DUAL_WRITE_STORAGE_FAILED' });
});

test('malformed queue cannot be overwritten by a new enqueue', (t) => {
  const { values } = fixture(t);
  values.set('crdt_dual_write_queue:user-a', '{broken');
  assert.throws(() => add('a', 1), { code: 'DUAL_WRITE_STORAGE_FAILED' });
  assert.equal(values.get('crdt_dual_write_queue:user-a'), '{broken');
});

test('queue strips live Y.Doc context while keeping retry data durable', (t) => {
  fixture(t);
  const circular = {}; circular.self = circular;
  enqueue({ userId: 'user-a', annoId: 'a', side: 'crdt', payload: {
    fabricObj: { type: 'rect', data: { id: 'a' } },
    opts: { documentId: 'doc-a', userId: 'user-a', ydoc: circular, yMapAnnotations: circular },
  } });
  assert.equal(readQueue('user-a').a.payload.opts.documentId, 'doc-a');
  assert.equal(readQueue('user-a').a.payload.opts.ydoc, undefined);
});

test('legacy delete retries call delete, never upsert, and retain failed deletes', async (t) => {
  fixture(t);
  const payload = { op: 'delete', documentId: 'doc-a', annoId: 'a', opts: { userId: 'user-a' } };
  enqueue({ userId: 'user-a', annoId: 'a', side: 'legacy', payload });
  let requests = 0;
  const handlers = createQueueRetryHandlers({
    documentId: 'doc-a', userId: 'user-a',
    upsertAnnotation: async () => assert.fail('delete must not upsert'),
    deleteAnnotation: async (docId, annoId) => {
      assert.equal(docId, 'doc-a'); assert.equal(annoId, 'a'); requests++;
      return requests === 1 ? { error: new Error('offline') } : { error: null };
    },
  });
  await drainQueue({ userId: 'user-a', documentId: 'doc-a', ...handlers });
  assert.equal(readQueue('user-a').a.attempts, 1);
  // A fresh module caller receives the same durable deletion intent.
  await handlers.retryLegacyWrite(readQueue('user-a').a.payload);
  assert.equal(requests, 2);
});

test('CRDT queued delete applies to its mounted document only', async (t) => {
  fixture(t);
  const docA = new Y.Doc(); const docB = new Y.Doc();
  t.after(() => { docA.destroy(); docB.destroy(); });
  docA.getMap('annotations').set('a', { test: true });
  docB.getMap('annotations').set('a', { test: true });
  const payload = { op: 'delete', documentId: 'doc-a', annoId: 'a', opts: { userId: 'user-a' } };
  const handlers = createQueueRetryHandlers({ documentId: 'doc-a', userId: 'user-a', ydoc: docA });
  await assert.rejects(handlers.retryCrdtWrite({ ...payload, documentId: 'doc-b' }), /document mismatch/);
  await assert.rejects(handlers.retryCrdtWrite({ ...payload, opts: { userId: 'user-b' } }), /user mismatch/);
  await handlers.retryCrdtWrite(payload);
  assert.equal(docA.getMap('annotations').has('a'), false);
  assert.equal(docB.getMap('annotations').has('a'), true);
});

test('quota error during acknowledgement keeps the sent entry persisted', async (t) => {
  const { storage } = fixture(t);
  add('a', 1);
  await assert.rejects(drainQueue({ userId: 'user-a', documentId: 'doc-a', retryLegacyWrite: async () => {
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  } }), { code: 'DUAL_WRITE_STORAGE_FAILED' });
  assert.equal(readQueue('user-a').a.payload.version, 1);
});

test('closing a mounted document stops further retry requests', async (t) => {
  fixture(t);
  add('a', 1); add('b', 1);
  let mounted = true;
  let requests = 0;
  await drainQueue({ userId: 'user-a', documentId: 'doc-a', shouldContinue: () => mounted,
    retryLegacyWrite: async () => { requests++; mounted = false; },
  });
  assert.equal(requests, 1);
  assert.equal(readQueue('user-a').b.payload.version, 1);
});

test('write failure emits a scoped storage warning for the mounted banner', (t) => {
  const { storage } = fixture(t);
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const window = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  t.after(() => prior ? Object.defineProperty(globalThis, 'window', prior) : delete globalThis.window);
  let detail;
  window.addEventListener('survey:dual-write-storage-error', (event) => { detail = event.detail; });
  storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  assert.throws(() => add('a', 1));
  assert.equal(detail.userId, 'user-a');
  assert.equal(detail.code, 'quota_exceeded');
});
