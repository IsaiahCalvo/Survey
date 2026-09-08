import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalDocumentStore } from '../src/services/localDocumentStore.js';
import { buildLocalDocumentState } from '../src/services/localDocumentState.js';
import { snapshotLocalPdfBlob } from '../src/services/localPdfByteSnapshot.js';

const nativeRead = Blob.prototype.arrayBuffer;
const nativeStream = Blob.prototype.stream;
const pdf = (text = 'original', name = 'plan.pdf') => new File([`%PDF-1.7\n${text}\n%%EOF`], name, { type: 'application/pdf' });
const snapshot = pdfId => buildLocalDocumentState({ pdfId, annotationsByPage: { 1: { objects: [{ id: 'saved-mark' }] } },
  pageNames: { 1: 'Saved page' }, regionOverlayDisabled: { region: true } });
function storeFor(t, factory = new IDBFactory(), options = {}) {
  const store = createLocalDocumentStore({ indexedDB: factory, ...options }); t.after(() => store.close()); return store;
}
function observeReads(t, read = nativeRead) {
  const sizes = []; const previous = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer');
  const previousStream = Object.getOwnPropertyDescriptor(Blob.prototype, 'stream');
  Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, writable: true, value: function () {
    sizes.push(this.size); return read.call(this);
  } });
  Object.defineProperty(Blob.prototype, 'stream', { configurable: true, writable: true, value: function () {
    const stream = nativeStream.call(this);
    return { cancel: (...args) => stream.cancel(...args), getReader(options) {
      assert.deepEqual(options, { mode: 'byob' });
      const reader = stream.getReader(options);
      return {
        cancel: (...args) => reader.cancel(...args), releaseLock: () => reader.releaseLock(),
        async read(view) {
          assert.equal(view.byteLength, 1024 * 1024, 'every source read requests a bounded buffer');
          const result = await reader.read(view);
          if (!result.value?.byteLength) return result;
          sizes.push(result.value.byteLength);
          const bytes = await read.call(new Blob([result.value]));
          return { value: new Uint8Array(bytes), done: result.done };
        },
      };
    } };
  } });
  const restore = () => {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', previous);
    Object.defineProperty(Blob.prototype, 'stream', previousStream);
  };
  t.after(restore); return { sizes, restore };
}

test('16MiB import, recovery copy and page replacement read owned chunks at most 1MiB before exact cold reopen', async t => {
  const factory = new IDBFactory(); const store = storeFor(t, factory);
  const bytes = new Uint8Array(16 * 1024 * 1024); bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  bytes[bytes.length - 1] = 77;
  const file = new File([bytes], 'large.pdf', { type: 'application/pdf' });
  const reads = observeReads(t);
  const imported = await store.importLocalDocument(file);
  const state = snapshot(imported.localId);
  await store.saveLocalDocumentState(imported.localId, state, { expectedRevision: 1 });
  const copied = await store.importLocalDocumentCopy(file, state);
  const next = bytes.slice(); next[next.length - 1] = 99;
  await store.replaceLocalDocument(imported.localId, new File([next], 'replacement.pdf'), { expectedRevision: 2, state });
  assert.deepEqual(reads.sizes, Array(48).fill(1024 * 1024));
  assert.equal(reads.sizes.reduce((sum, size) => sum + size, 0), 3 * bytes.length, 'read every source byte exactly once, without a separate header read');
  reads.restore(); store.close();
  const cold = storeFor(t, factory);
  const reopened = await cold.openLocalDocument(imported.localId);
  assert.deepEqual(new Uint8Array(await nativeRead.call(reopened)), next);
  assert.deepEqual(reopened._localDocumentState, state);
  const copy = await cold.openLocalDocument(copied.localId);
  assert.deepEqual(new Uint8Array(await nativeRead.call(copy)), bytes);
  assert.equal(Object.keys(copy._localDocumentState.entries).length, 6);
  for (const [key, value] of Object.entries(state.entries)) {
    assert.equal(copy._localDocumentState.entries[key.slice(0, -state.pdfId.length) + copied.localId], value);
  }
});

test('real File subclasses and named Blobs bypass instance and subclass read/slice overrides', async t => {
  const store = storeFor(t);
  class SourceFile extends File {
    arrayBuffer() { assert.fail('subclass read must not run'); }
    slice() { assert.fail('subclass slice must not run'); }
    stream() { assert.fail('subclass stream must not run'); }
  }
  const source = new SourceFile(['%PDF-1.7\nsubclass bytes'], 'subclass.pdf');
  const named = new Blob(['%PDF-1.7\nnamed Blob bytes']); named.name = 'named.pdf';
  named.arrayBuffer = () => assert.fail('instance read must not run');
  named.slice = () => assert.fail('instance slice must not run');
  named.stream = () => assert.fail('instance stream must not run');
  for (const file of [source, named]) {
    const manifest = await store.importLocalDocument(file);
    const reopened = await store.openLocalDocument(manifest.localId);
    assert.equal(await reopened.text(), await Blob.prototype.text.call(file));
    assert.equal(reopened.name, file.name);
  }
});

test('fake files and declared/native size mismatches fail before database access', async t => {
  let opens = 0; const store = storeFor(t, { open() { opens++; throw new Error('must not open'); } });
  const wrongSize = pdf(); Object.defineProperty(wrongSize, 'size', { value: wrongSize.size + 1 });
  const oversized = new Blob(['%PDF-1.7']); oversized.name = 'oversized.pdf';
  Object.defineProperty(oversized, 'size', { value: 1 });
  const forged = Object.create(Blob.prototype); Object.defineProperties(forged, { name: { value: 'forged.pdf' }, size: { value: 9 } });
  const bad = [
    { name: 'fake.pdf', size: 9, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7\n').buffer },
    wrongSize, oversized, forged,
  ];
  for (const file of bad) await assert.rejects(store.importLocalDocument(file), { code: 'invalid-input' });
  assert.equal(opens, 0);
});

test('name, native bytes and replacement state are retained before the header await', async t => {
  const store = storeFor(t); const original = await store.importLocalDocument(pdf());
  const state = snapshot(original.localId); const expected = structuredClone(state);
  const replacement = pdf('replacement bytes'); let release;
  const reads = observeReads(t, function () { const retained = this; return new Promise(resolve => {
    release = async () => resolve(await nativeRead.call(retained));
  }); });
  const pending = store.replaceLocalDocument(original.localId, replacement, { expectedRevision: 1, state });
  await new Promise(resolve => setImmediate(resolve));
  Object.defineProperty(replacement, 'name', { value: 'wrong later name.pdf' });
  Object.defineProperty(replacement, 'size', { value: 1 });
  replacement.arrayBuffer = () => assert.fail('late replacement read');
  state.entries[`annotationsByPage_${original.localId}`] = '{}';
  await release(); const saved = await pending; reads.restore();
  assert.equal(saved.name, 'plan.pdf');
  const reopened = await store.openLocalDocument(original.localId);
  assert.equal(await reopened.text(), '%PDF-1.7\nreplacement bytes\n%%EOF');
  assert.deepEqual(reopened._localDocumentState, expected);
});

test('stalled header read times out without writing and cannot commit when it resolves late', async t => {
  const factory = new IDBFactory(); const store = storeFor(t, factory, { timeoutMs: 20 });
  const original = await store.importLocalDocument(pdf()); const state = snapshot(original.localId);
  await store.saveLocalDocumentState(original.localId, state, { expectedRevision: 1 });
  let release;
  const reads = observeReads(t, function () { const retained = this; return new Promise(resolve => {
    release = async () => resolve(await nativeRead.call(retained));
  }); });
  await assert.rejects(store.replaceLocalDocument(original.localId, pdf('late bytes'), { expectedRevision: 2, state }), { code: 'timed-out' });
  await release(); reads.restore();
  await new Promise(resolve => setImmediate(resolve));
  const reopened = await store.openLocalDocument(original.localId);
  assert.equal(reopened.localRevision, 2); assert.deepEqual(reopened._localDocumentState, state);
  assert.match(await reopened.text(), /original/);
});

test('close cancels pending header preparation without opening a database or allowing a late import', async t => {
  const factory = new IDBFactory(); const store = storeFor(t, factory); let release;
  const reads = observeReads(t, function () { const retained = this; return new Promise(resolve => {
    release = async () => resolve(await nativeRead.call(retained));
  }); });
  const pending = store.importLocalDocument(pdf());
  await new Promise(resolve => setImmediate(resolve));
  store.close();
  await assert.rejects(pending, { code: 'closed' });
  await release(); reads.restore();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await factory.databases(), []);
});

test('invalid, failed or wrong-length header reads preserve the committed bytes/state/revision', async t => {
  const factory = new IDBFactory(); const store = storeFor(t, factory);
  const original = await store.importLocalDocument(pdf()); const state = snapshot(original.localId);
  await store.saveLocalDocumentState(original.localId, state, { expectedRevision: 1 });
  await assert.rejects(store.replaceLocalDocument(original.localId, new File(['bad PDF'], 'bad.pdf'), { expectedRevision: 2, state }), { code: 'invalid-input' });
  for (const read of [() => Promise.reject(new Error('source read failed')), () => Promise.resolve(new ArrayBuffer(0))]) {
    const reads = observeReads(t, read);
    await assert.rejects(store.replaceLocalDocument(original.localId, pdf('bad read'), { expectedRevision: 2, state }));
    reads.restore();
  }
  const reopened = await store.openLocalDocument(original.localId);
  assert.equal(reopened.localRevision, 2); assert.deepEqual(reopened._localDocumentState, state);
  assert.equal(await reopened.text(), await pdf().text());
});

test('prepared chunks own their bytes before database open and commit', async t => {
  const factory = new IDBFactory(); const returnedBuffers = []; let opens = 0;
  const source = new Uint8Array(3 * 1024 * 1024 + 17);
  source.set(new TextEncoder().encode('%PDF-1.7\n'));
  source[source.length - 1] = 91;
  const expected = source.slice(); const file = new File([source], 'owned.pdf');
  const reads = observeReads(t, async function () {
    const bytes = await nativeRead.call(this); returnedBuffers.push(bytes); return bytes;
  });
  const store = storeFor(t, { open(...args) {
    opens++;
    assert.equal(returnedBuffers.length, 4, 'all source reads finish before database access');
    for (const bytes of returnedBuffers) new Uint8Array(bytes).fill(0);
    source.fill(0);
    return factory.open(...args);
  } });
  const imported = await store.importLocalDocument(file);
  assert.equal(opens, 1); reads.restore(); store.close();
  const cold = storeFor(t, factory);
  const reopened = await cold.openLocalDocument(imported.localId);
  assert.deepEqual(new Uint8Array(await nativeRead.call(reopened)), expected,
    'neither source buffers nor returned read buffers remain the stored source');
});

for (const operation of ['timeout', 'close']) {
  test(`${operation} during a later chunk stops all following reads and database writes`, async t => {
    const factory = new IDBFactory(); const store = storeFor(t, factory, { timeoutMs: operation === 'timeout' ? 30 : 10_000 });
    const source = new Uint8Array(3 * 1024 * 1024); source.set(new TextEncoder().encode('%PDF-1.7\n'));
    let count = 0; let release; let secondStarted;
    const second = new Promise(resolve => { secondStarted = resolve; });
    const reads = observeReads(t, function () {
      count++;
      if (count !== 2) return nativeRead.call(this);
      const retained = this;
      secondStarted();
      return new Promise(resolve => { release = async () => resolve(await nativeRead.call(retained)); });
    });
    const pending = store.importLocalDocument(new File([source], 'interrupted.pdf'));
    const rejected = assert.rejects(pending, { code: operation === 'timeout' ? 'timed-out' : 'closed' });
    await second;
    if (operation === 'close') store.close();
    await rejected;
    await release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(count, 2, 'late completion must not start another chunk');
    assert.deepEqual(await factory.databases(), [], 'no late import is persisted');
    reads.restore();
  });
}

test('preparation deadline covers all chunks rather than restarting after each successful read', async t => {
  const factory = new IDBFactory(); const store = storeFor(t, factory, { timeoutMs: 1000 });
  const source = new Uint8Array(3 * 1024 * 1024); source.set(new TextEncoder().encode('%PDF-1.7\n'));
  const now = Date.now; let elapsed = 0;
  Date.now = () => elapsed;
  t.after(() => { Date.now = now; });
  const reads = observeReads(t, async function () {
    const bytes = await nativeRead.call(this); elapsed += 600; return bytes;
  });
  await assert.rejects(store.importLocalDocument(new File([source], 'whole-deadline.pdf')), { code: 'timed-out' });
  assert.equal(reads.sizes.length, 2, 'two individually sub-deadline reads exceed the single operation budget');
  assert.deepEqual(await factory.databases(), []);
  Date.now = now; reads.restore();
});

for (const unsupported of ['no stream', 'no BYOB']) {
  test(`${unsupported} falls back to one native full read with owned bytes`, async t => {
    const previous = Object.getOwnPropertyDescriptor(Blob.prototype, 'stream');
    const previousRead = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer');
    t.after(() => {
      Object.defineProperty(Blob.prototype, 'stream', previous);
      Object.defineProperty(Blob.prototype, 'arrayBuffer', previousRead);
    });
    let canceled = 0; const sizes = []; let returned;
    Object.defineProperty(Blob.prototype, 'stream', { configurable: true, value: unsupported === 'no stream' ? undefined : function () {
      return { getReader() { throw new TypeError('BYOB unavailable'); }, cancel() { canceled++; return Promise.resolve(); } };
    } });
    Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value: async function () {
      sizes.push(this.size); returned = await nativeRead.call(this); return returned;
    } });
    const bytes = new Uint8Array(3 * 1024 * 1024 + 1); bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
    const source = new File([bytes], 'fallback.pdf');
    source.arrayBuffer = () => assert.fail('instance override must not run in fallback');
    const owned = await snapshotLocalPdfBlob(source);
    assert.deepEqual(sizes, [bytes.length], 'fallback has one source read, with an explicit full-buffer cost');
    assert.equal(canceled, unsupported === 'no BYOB' ? 1 : 0);
    new Uint8Array(returned).fill(0);
    assert.deepEqual(new Uint8Array(await nativeRead.call(owned)), bytes);
  });
}

test('successful stream data followed by a source error never retries the disk source via arrayBuffer', async t => {
  const previous = Object.getOwnPropertyDescriptor(Blob.prototype, 'stream');
  const previousRead = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer');
  t.after(() => {
    Object.defineProperty(Blob.prototype, 'stream', previous);
    Object.defineProperty(Blob.prototype, 'arrayBuffer', previousRead);
  });
  let reads = 0; let canceled = 0; let released = 0;
  const sourceError = new DOMException('The source changed', 'NotReadableError');
  Object.defineProperty(Blob.prototype, 'stream', { configurable: true, value: function () {
    return { getReader() { return {
      read: async () => { if (++reads === 1) return { value: new TextEncoder().encode('%PDF-'), done: false }; throw sourceError; },
      cancel: async () => { canceled++; }, releaseLock: () => { released++; },
    }; } };
  } });
  Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value: () => assert.fail('no source reopen after a stream error') });
  const factory = new IDBFactory(); const store = storeFor(t, factory);
  await assert.rejects(store.importLocalDocument(pdf()), error => error === sourceError);
  assert.equal(reads, 2); assert.equal(canceled, 1); assert.equal(released, 1);
  assert.deepEqual(await factory.databases(), []);
});

test('short stream reads preserve a split header near byte 1000 and a final value with done', async t => {
  const previous = Object.getOwnPropertyDescriptor(Blob.prototype, 'stream');
  t.after(() => Object.defineProperty(Blob.prototype, 'stream', previous));
  const bytes = new Uint8Array(1031); bytes.set(new TextEncoder().encode('%PDF-1.7'), 1000); bytes[1030] = 72;
  const boundaries = [0, 1002, 1004, 1024, 1031]; let index = 0; let streams = 0; let released = 0;
  Object.defineProperty(Blob.prototype, 'stream', { configurable: true, value: function () {
    streams++;
    return { getReader({ mode }) {
      assert.equal(mode, 'byob');
      return {
        async read(view) {
          assert.equal(view.byteLength, 1024 * 1024);
          const value = bytes.slice(boundaries[index], boundaries[++index]);
          return { value, done: index === boundaries.length - 1 };
        },
        cancel: () => assert.fail('successful stream should not be canceled'), releaseLock: () => { released++; },
      };
    } };
  } });
  const owned = await snapshotLocalPdfBlob(new Blob([bytes]));
  assert.deepEqual(new Uint8Array(await nativeRead.call(owned)), bytes);
  assert.equal(streams, 1); assert.equal(index, 4); assert.equal(released, 1);
});

test('signal abort cancels/releases a stalled stream and ignores its late bytes', async t => {
  const previous = Object.getOwnPropertyDescriptor(Blob.prototype, 'stream');
  t.after(() => Object.defineProperty(Blob.prototype, 'stream', previous));
  let reads = 0; let canceled = 0; let released = 0; let resolveRead;
  Object.defineProperty(Blob.prototype, 'stream', { configurable: true, value: function () {
    return { getReader() { return {
      read() { reads++; return new Promise(resolve => { resolveRead = resolve; }); },
      cancel: async () => { canceled++; }, releaseLock: () => { released++; },
    }; } };
  } });
  const controller = new AbortController();
  const pending = snapshotLocalPdfBlob(pdf(), { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { code: 'aborted' });
  assert.equal(canceled, 1); assert.equal(released, 1);
  resolveRead({ value: new TextEncoder().encode('%PDF-1.7\nlate\n%%EOF'), done: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  await assert.rejects(snapshotLocalPdfBlob(pdf(), { signal: controller.signal }), { code: 'aborted' });
  assert.equal(reads, 1, 'already aborted requests never open a stream');
});

test('invalid PDF rejects once its header range is known, without reading the rest', async t => {
  const reads = observeReads(t);
  await assert.rejects(snapshotLocalPdfBlob(new Blob([new Uint8Array(3 * 1024 * 1024)])), { code: 'invalid-input' });
  assert.deepEqual(reads.sizes, [1024 * 1024]);
});

test('invalid or throwing signal subscriptions fail before source reads and clean up', async t => {
  const reads = observeReads(t);
  for (const signal of [{}, { aborted: false }, { aborted: 'false', addEventListener() {}, removeEventListener() {} }]) {
    await assert.rejects(snapshotLocalPdfBlob(pdf(), { signal }), TypeError);
  }
  let cleanup = 0; const subscribeError = new Error('subscribe failed');
  await assert.rejects(snapshotLocalPdfBlob(pdf(), { signal: {
    aborted: false, addEventListener() { throw subscribeError; }, removeEventListener() { cleanup++; throw new Error('cleanup failed'); },
  } }), error => error === subscribeError);
  assert.equal(cleanup, 1);
  assert.deepEqual(reads.sizes, []);
});
