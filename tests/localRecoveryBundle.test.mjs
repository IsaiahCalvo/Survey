import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalRecoveryBundle, parseLocalRecoveryBundle, LOCAL_RECOVERY_BUNDLE_HEADER_BYTES,
  LOCAL_RECOVERY_BUNDLE_MAX_MANIFEST_BYTES, LOCAL_RECOVERY_BUNDLE_MAX_BYTES } from '../src/services/localRecoveryBundle.js';
import { buildLocalDocumentState, createLocalDocumentStateReader } from '../src/services/localDocumentState.js';
import { createLocalDocumentStore, LOCAL_DOCUMENT_MAX_BYTES, LOCAL_DOCUMENT_MAX_STATE_BYTES } from '../src/services/localDocumentStore.js';
import { LOCAL_PDF_HASH_CHUNK_BYTES } from '../src/services/localPdfByteFingerprint.js';

const sourceId = 'local:00000000-0000-4000-8000-000000000001';
const pdfText = '%PDF-1.7\noriginal bytes\n%%EOF';
function input() {
  const file = new File([pdfText], 'plan.pdf', { type: 'application/pdf' });
  const timestamp = '2026-09-08T12:00:00.000Z';
  return { file, metadata: { sessionId: '00000000-0000-4000-8000-000000000002', writerId: '00000000-0000-4000-8000-000000000003',
    fileId: '00000000-0000-4000-8000-000000000004', sourceLocalId: sourceId, baseCanonicalRevision: 4,
    name: file.name, size: file.size, type: file.type, created_at: timestamp, updated_at: timestamp, sequence: 7 },
  state: buildLocalDocumentState({ pdfId: sourceId,
    annotationsByPage: { 1: { objects: [{ id: 'mark', type: 'line', authorId: 'original-author', x: 5 }] } },
    items: { counter: { value: 42 } }, annotations: { measurement: { length: 9 } }, surveyMarkers: { marker: { pageNumber: 1 } },
    callouts: [{ id: 'callout', text: 'Keep all state', pageNumber: 1 }], pageNames: { 1: 'Ground floor' },
    bookmarks: [{ id: 'bookmark', page: 1, name: 'Start' }], spaces: [{ id: 'space', name: 'Office' }], activeSpaceId: 'space',
    pageTransformations: { 1: { rotation: 90 } }, regionOverlayDisabled: { room: true } }) };
}
const code = expected => error => error?.code === expected;
async function pieces(bundle) {
  const header = new Uint8Array(await bundle.slice(0, 64).arrayBuffer());
  const length = new DataView(header.buffer).getUint32(20, true);
  const manifest = JSON.parse(await bundle.slice(64, 64 + length).text());
  return { header, manifest, pdf: bundle.slice(64 + length) };
}
async function changedManifest(bundle, change, rawText) {
  const { header, manifest, pdf } = await pieces(bundle);
  change?.(manifest);
  const bytes = rawText instanceof Uint8Array ? rawText : new TextEncoder().encode(rawText ?? JSON.stringify(manifest));
  new DataView(header.buffer).setUint32(20, bytes.length, true);
  header.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), 32);
  return new Blob([header, bytes, pdf]);
}

test('round trip preserves original PDF and all six entries without source identity on the restored File', async () => {
  const original = input();
  const bundle = await createLocalRecoveryBundle(original);
  assert.ok(bundle instanceof Blob);
  assert.equal(bundle.type, 'application/octet-stream');
  const restored = await parseLocalRecoveryBundle(bundle);
  assert.equal(await restored.file.text(), pdfText);
  assert.equal(restored.file.name, original.file.name);
  assert.equal(restored.file.type, 'application/pdf');
  assert.deepEqual(restored.state, original.state);
  assert.deepEqual(restored.metadata, original.metadata);
  assert.equal(Object.keys(restored.state.entries).length, 6);
  for (const key of ['id', 'localId', '_surveyPdfId', 'storageMode', 'localRevision', 'filePath', 'user_id']) {
    assert.equal(Object.hasOwn(restored.file, key), false, key);
  }
});

test('parsed recovery restores through the actual atomic new-identity import path', async () => {
  const original = input();
  const recovered = await parseLocalRecoveryBundle(await createLocalRecoveryBundle(original));
  const store = createLocalDocumentStore({ indexedDB: new IDBFactory() });
  try {
    const manifest = await store.importLocalDocumentCopy(recovered.file, recovered.state);
    assert.notEqual(manifest.localId, sourceId);
    const file = await store.openLocalDocument(manifest.localId);
    assert.equal(await file.text(), pdfText);
    const reader = createLocalDocumentStateReader(file);
    for (const [key, value] of Object.entries(original.state.entries)) {
      assert.equal(reader.getItem(key.slice(0, -sourceId.length) + manifest.localId), value);
    }
    assert.equal((await store.listLocalDocuments()).length, 1);
    assert.equal(recovered.state.pdfId, sourceId);
  } finally { store.close(); }
});

test('create snapshots metadata/state before awaits and uses native Blob bytes despite overridden methods', async () => {
  const original = input();
  const expected = structuredClone({ metadata: original.metadata, state: original.state });
  original.file.arrayBuffer = () => assert.fail('instance arrayBuffer must not run');
  original.file.slice = () => assert.fail('instance slice must not run');
  const pending = createLocalRecoveryBundle(original);
  original.metadata.name = 'wrong.pdf'; original.metadata.sequence++;
  original.state.entries[`pdfSidebar_${sourceId}`] = '{}';
  original.state.pdfId = 'wrong';
  const bundle = await pending;
  bundle.arrayBuffer = () => assert.fail('whole bundle read must not run');
  bundle.slice = () => assert.fail('instance bundle slice must not run');
  const recovered = await parseLocalRecoveryBundle(bundle);
  assert.deepEqual(recovered.metadata, expected.metadata);
  assert.deepEqual(recovered.state, expected.state);
  assert.equal(await recovered.file.text(), pdfText);
});

test('PDF verification reads at most one 1 MiB chunk, not a full PDF or bundle buffer', async t => {
  const original = input();
  original.file = new File(['%PDF-1.7\n', new Uint8Array(3 * LOCAL_PDF_HASH_CHUNK_BYTES), '\n%%EOF'], 'large.pdf', { type: 'application/pdf' });
  original.metadata.name = original.file.name; original.metadata.size = original.file.size;
  const read = Blob.prototype.arrayBuffer;
  const sizes = [];
  t.mock.method(Blob.prototype, 'arrayBuffer', function () { sizes.push(this.size); assert.ok(this.size <= LOCAL_PDF_HASH_CHUNK_BYTES); return read.call(this); });
  const restored = await parseLocalRecoveryBundle(await createLocalRecoveryBundle(original));
  assert.equal(restored.file.size, original.file.size);
  assert.ok(sizes.filter(size => size === LOCAL_PDF_HASH_CHUNK_BYTES).length >= 6);
});

test('export and parse perform no IndexedDB work', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { assert.fail('bundle processing must not access IndexedDB'); } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'indexedDB', descriptor) : delete globalThis.indexedDB);
  await parseLocalRecoveryBundle(await createLocalRecoveryBundle(input()));
});

test('parse owns the exact streamed PDF before verification and does not retain mutable read buffers', async t => {
  const original = input();
  const bundle = await createLocalRecoveryBundle(original);
  const buffers = [];
  const read = ReadableStreamBYOBReader.prototype.read;
  t.mock.method(ReadableStreamBYOBReader.prototype, 'read', async function (...args) {
    assert.ok(args[0].byteLength <= 1024 * 1024);
    const result = await read.apply(this, args);
    if (result.value?.byteLength) buffers.push(result.value);
    return result;
  });
  const parsed = await parseLocalRecoveryBundle(bundle);
  assert.equal(buffers.reduce((total, bytes) => total + bytes.byteLength, 0), original.file.size);
  for (const bytes of buffers) bytes.fill(0);
  assert.equal(await parsed.file.text(), await original.file.text());
  assert.deepEqual(parsed.state, original.state);
});

test('rejects bad magic, version/reserved fields, truncated bytes and appended bytes', async () => {
  const bundle = await createLocalRecoveryBundle(input());
  for (const [offset, value, expected] of [[0, 0, 'invalid-recovery-format'], [16, 2, 'unsupported-recovery-version'], [28, 1, 'unsupported-recovery-version']]) {
    const { header } = await pieces(bundle); header[offset] = value;
    await assert.rejects(parseLocalRecoveryBundle(new Blob([header, bundle.slice(64)])), code(expected));
  }
  for (const bad of [bundle.slice(0, 10), bundle.slice(0, bundle.size - 1), new Blob([bundle, 'x'])]) {
    await assert.rejects(parseLocalRecoveryBundle(bad), code('invalid-recovery-size'));
  }
});

test('rejects manifest/PDF integrity changes even when PDF length is unchanged', async () => {
  const bundle = await createLocalRecoveryBundle(input());
  const { header, pdf } = await pieces(bundle);
  const manifestBytes = new Uint8Array(await bundle.slice(64, bundle.size - pdf.size).arrayBuffer());
  manifestBytes[30] ^= 1;
  await assert.rejects(parseLocalRecoveryBundle(new Blob([header, manifestBytes, pdf])), code('recovery-integrity-failed'));
  const changedPdf = new Blob(['%PDF-1.7\nchanged! bytes\n%%EOF']);
  assert.equal(changedPdf.size, pdf.size);
  await assert.rejects(parseLocalRecoveryBundle(new Blob([bundle.slice(0, bundle.size - pdf.size), changedPdf])), code('recovery-integrity-failed'));
});

test('rejects invalid UTF-8, malformed/duplicate JSON and unsupported manifest fields', async () => {
  const bundle = await createLocalRecoveryBundle(input());
  for (const raw of [new Uint8Array([0xff, 0xfe]), '{', '{"version":1,"version":2}']) {
    await assert.rejects(parseLocalRecoveryBundle(await changedManifest(bundle, null, raw)), code('invalid-recovery-json'));
  }
  await assert.rejects(parseLocalRecoveryBundle(await changedManifest(bundle, manifest => { manifest.extra = 'unsupported'; })), code('invalid-recovery-format'));
  await assert.rejects(parseLocalRecoveryBundle(await changedManifest(bundle, manifest => { manifest.version = 2; })), code('invalid-recovery-format'));
});

test('rejects unsafe object keys in manifest and in nested serialized state entries', async () => {
  const bundle = await createLocalRecoveryBundle(input());
  const polluted = await changedManifest(bundle, manifest => { Object.defineProperty(manifest.metadata, '__proto__', { value: { polluted: true }, enumerable: true }); });
  await assert.rejects(parseLocalRecoveryBundle(polluted), code('unsafe-recovery-key'));
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const original = input();
    original.state.entries[`annotationsByPage_${sourceId}`] = `{"1":{"${key}":{"polluted":true}}}`;
    await assert.rejects(createLocalRecoveryBundle(original), code('unsafe-recovery-key'));
    const bad = await changedManifest(bundle, manifest => { manifest.state.entries[`annotationsByPage_${sourceId}`] = original.state.entries[`annotationsByPage_${sourceId}`]; });
    await assert.rejects(parseLocalRecoveryBundle(bad), code('unsafe-recovery-key'));
  }
  assert.equal({}.polluted, undefined);
});

test('rejects missing/wrong state entries, source IDs and unexpected identity bindings', async () => {
  const bundle = await createLocalRecoveryBundle(input());
  for (const change of [
    manifest => { delete manifest.state.entries[`pdfSidebar_${sourceId}`]; },
    manifest => { manifest.state.entries[`callouts_${sourceId}`] = '{}'; },
    manifest => { manifest.state.pdfId = 'local:00000000-0000-4000-8000-000000000009'; },
    manifest => { manifest.metadata.user_id = 'wrong-owner'; },
    manifest => { manifest.state.filePath = '/overwrite/source.pdf'; },
  ]) await assert.rejects(parseLocalRecoveryBundle(await changedManifest(bundle, change)));
});

test('preserves managed display names as provenance, never as output paths or identity', async () => {
  for (const name of ['Floor plan', 'Étage 漢字 📐', 'CON.pdf', 'Plan: ground floor', '../plan.pdf', 'dir\\plan.pdf', 'plan\u0000.pdf', 'plan.txt']) {
    const original = input(); original.metadata.name = name;
    const recovered = await parseLocalRecoveryBundle(await createLocalRecoveryBundle(original));
    assert.equal(recovered.metadata.name, name);
    assert.equal(recovered.file.name, name);
    assert.equal(await recovered.file.text(), pdfText);
    for (const key of ['path', 'filePath', 'id', 'localId', '_surveyPdfId', 'storageMode']) {
      assert.equal(Object.hasOwn(recovered.file, key), false, `${name}: ${key}`);
    }
  }
});

test('rejects invalid managed display names and metadata/PDF size mismatch', async () => {
  for (const name of ['', '   ', 'x'.repeat(1025), null]) {
    const original = input(); original.metadata.name = name;
    await assert.rejects(createLocalRecoveryBundle(original), code('invalid-recovery-filename'));
  }
  const original = input(); original.metadata.size++;
  await assert.rejects(createLocalRecoveryBundle(original), code('recovery-size-mismatch'));
  const bundle = await createLocalRecoveryBundle(input());
  await assert.rejects(parseLocalRecoveryBundle(await changedManifest(bundle, manifest => { manifest.metadata.size++; })), code('recovery-size-mismatch'));
});

test('uses authoritative PDF/state caps and rejects oversized declarations before payload reads', async () => {
  assert.equal(LOCAL_RECOVERY_BUNDLE_MAX_BYTES, LOCAL_RECOVERY_BUNDLE_HEADER_BYTES + LOCAL_RECOVERY_BUNDLE_MAX_MANIFEST_BYTES + LOCAL_DOCUMENT_MAX_BYTES);
  assert.equal(LOCAL_RECOVERY_BUNDLE_MAX_MANIFEST_BYTES, LOCAL_DOCUMENT_MAX_STATE_BYTES + 16 * 1024);
  const bundle = await createLocalRecoveryBundle(input());
  for (const [offset, value] of [[20, LOCAL_RECOVERY_BUNDLE_MAX_MANIFEST_BYTES + 1], [24, LOCAL_DOCUMENT_MAX_BYTES + 1]]) {
    const { header } = await pieces(bundle); new DataView(header.buffer).setUint32(offset, value, true);
    await assert.rejects(parseLocalRecoveryBundle(new Blob([header, bundle.slice(64)])), code('invalid-recovery-size'));
  }
  const original = input(); original.metadata.size = LOCAL_DOCUMENT_MAX_BYTES + 1;
  await assert.rejects(createLocalRecoveryBundle(original), code('invalid-recovery-metadata'));
});

test('rejects non-PDF content and complex nested state without changing the source', async () => {
  const original = input();
  original.file = new File(['not a PDF'], 'plan.pdf', { type: 'application/pdf' }); original.metadata.size = original.file.size;
  await assert.rejects(createLocalRecoveryBundle(original), code('invalid-recovery-pdf'));
  const deep = input(); deep.state.entries[`annotationsByPage_${sourceId}`] = '{"child":'.repeat(105) + '{}' + '}'.repeat(105);
  await assert.rejects(createLocalRecoveryBundle(deep), code('invalid-recovery-state'));
});

test('cancellation and bounded timeout reject without late results', async t => {
  await assert.rejects(createLocalRecoveryBundle(input(), { signal: AbortSignal.abort() }), code('recovery-canceled'));
  const bundle = await createLocalRecoveryBundle(input());
  await assert.rejects(parseLocalRecoveryBundle(bundle, { signal: AbortSignal.abort() }), code('recovery-canceled'));
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let resolve; let args;
  t.mock.method(crypto.subtle, 'digest', (...values) => { args = values; return new Promise(done => { resolve = done; }); });
  await assert.rejects(createLocalRecoveryBundle(input(), { timeoutMs: 20 }), /timed out/);
  resolve(await original(...args));
});
