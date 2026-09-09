import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { createDocumentPdfSource } from '../src/services/documentPdfSource.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';

const id = n => `99000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), documentId = id(2), generationId = id(3), owner = id(4);
const bytes = new TextEncoder().encode('%PDF-checked-source');
const sha = value => createHash('sha256').update(value).digest('hex');
const current = () => true;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function issued() {
  const doc = new Y.Doc(); doc.getMap('annotations').set('a', 'checked');
  const update = Y.encodeStateAsUpdate(doc); doc.destroy();
  const path = `${owner}/_generations/${documentId}/${generationId}.pdf`;
  const reader = createDocumentGenerationReader({
    getActorUserId: () => actor,
    download: async () => new Blob([bytes], { type: 'application/pdf' }),
    request: async (name, params) => {
      assert.equal(name, 'read_document_generation_open');
      return { data: { version: 1, actor_user_id: actor, document_id: documentId, generation_id: generationId,
        document: { id: documentId, user_id: owner, project_id: null, name: 'Checked PDF', file_path: path, file_size: String(bytes.length) },
        pdf: { bucket_id: 'documents', path, id: id(5), version: id(6), byte_length: String(bytes.length), content_sha256: sha(bytes) },
        publication: { operation_id: id(7), generation_id: generationId, published_at: '2026-09-09T00:00:00Z', wal_head: '0' },
        annotations: { version: 2, document_id: documentId, generation_id: generationId, wal_head: '0',
          snapshot_sha256: params.p_include_snapshot ? sha(update) : null,
          snapshot: params.p_include_snapshot ? { at_seq: '0', snapshot: `\\x${Buffer.from(update).toString('hex')}`,
            encoding_version: 1, writer_id: null, writer_epoch: '0' } : null } } };
    },
  });
  return reader.open({ documentId, actorUserId: actor });
}

test('local File and Blob read themselves without a download', async () => {
  for (const file of [new Blob([bytes]), new File([bytes], 'local.pdf', { type: 'application/pdf' })]) {
    let downloads = 0;
    const source = createDocumentPdfSource({ file, isCurrent: current, download: async () => { downloads++; } });
    assert.equal(Object.isFrozen(source), true);
    assert.deepEqual(new Uint8Array(await source.readBytes()), bytes);
    assert.equal(downloads, 0);
  }
});

test('legacy path downloads once, coalesces concurrent loads, and returns distinct buffers', async () => {
  let downloads = 0;
  const pending = deferred();
  const source = createDocumentPdfSource({ file: { filePath: 'owner/file.pdf' }, isCurrent: current,
    download: path => { assert.equal(path, 'owner/file.pdf'); downloads++; return pending.promise; } });
  const first = source.readBytes(), second = source.readBytes();
  await Promise.resolve(); assert.equal(downloads, 1);
  pending.resolve(new Blob([bytes]));
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(new Uint8Array(a), bytes); assert.deepEqual(new Uint8Array(b), bytes); assert.notEqual(a, b);
  assert.deepEqual(new Uint8Array(await source.readBytes()), bytes); assert.equal(downloads, 1);
});

test('transferred parse buffers do not detach cached source bytes or trigger downloads', async () => {
  for (const file of [new File([bytes], 'local.pdf'), { filePath: 'owner/file.pdf' }]) {
    let downloads = 0;
    const source = createDocumentPdfSource({ file, isCurrent: current, download: async () => { downloads++; return new Blob([bytes]); } });
    const first = await source.readBytes(); structuredClone(first, { transfer: [first] });
    assert.equal(first.byteLength, 0);
    assert.deepEqual(new Uint8Array(await source.readBytes()), bytes);
    assert.equal(downloads, file instanceof Blob ? 0 : 1);
  }
});

test('failed path downloads retain their original error and remain retryable', async () => {
  let downloads = 0; const failure = Object.assign(new Error('Temporary download failure'), { status: 503 });
  const source = createDocumentPdfSource({ file: { filePath: 'owner/file.pdf' }, isCurrent: current,
    download: async () => { if (++downloads === 1) throw failure; return new Blob([bytes]); } });
  const first = source.readBytes(), second = source.readBytes();
  await assert.rejects(first, error => error === failure); await assert.rejects(second, error => error === failure);
  assert.deepEqual(new Uint8Array(await source.readBytes()), bytes); assert.equal(downloads, 2);
});

test('an invalid download result is not cached', async () => {
  let downloads = 0;
  const source = createDocumentPdfSource({ file: { filePath: 'owner/file.pdf' }, isCurrent: current,
    download: async () => ++downloads === 1 ? null : new Blob([bytes]) });
  await assert.rejects(source.readBytes(), /Failed to download PDF/);
  assert.deepEqual(new Uint8Array(await source.readBytes()), bytes); assert.equal(downloads, 2);
});

test('parse byte-read failure keeps the successfully downloaded Blob for retry', async () => {
  let downloads = 0, reads = 0;
  const blob = new Blob([bytes]);
  const failure = new Error('Temporary device read failure');
  blob.arrayBuffer = async () => { if (++reads === 1) throw failure; return Blob.prototype.arrayBuffer.call(blob); };
  const source = createDocumentPdfSource({ file: { filePath: 'owner/file.pdf' }, isCurrent: current,
    download: async () => { downloads++; return blob; } });
  await assert.rejects(source.readBytes(), error => error === failure);
  assert.deepEqual(new Uint8Array(await source.readBytes()), bytes); assert.equal(downloads, 1);
});

test('checked source uses only the issued immutable PDF, never file bytes or raw path', async () => {
  const checkedBundle = await issued(); let rawReads = 0, downloads = 0;
  const file = { id: documentId, pdfGenerationId: generationId, filePath: 'untrusted/path.pdf',
    arrayBuffer: async () => { rawReads++; return new Uint8Array([0]).buffer; } };
  checkedBundle.pdfBlob.arrayBuffer = async () => { throw new Error('Public method was replaced'); };
  const source = createDocumentPdfSource({ file, checkedBundle, actorUserId: actor, isCurrent: current,
    download: async () => { downloads++; throw new Error('Unchecked fallback'); } });
  const first = await source.readBytes(); assert.deepEqual(new Uint8Array(first), bytes);
  structuredClone(first, { transfer: [first] });
  assert.deepEqual(new Uint8Array(await source.readBytes()), bytes);
  assert.equal(rawReads, 0); assert.equal(downloads, 0);
});

test('forged or wrong-scope checked bundles fail synchronously before any PDF I/O', async () => {
  const checkedBundle = await issued(); let reads = 0;
  const base = { file: { id: documentId, arrayBuffer: () => { reads++; } }, checkedBundle,
    actorUserId: actor, isCurrent: current, download: () => { reads++; } };
  for (const change of [
    { checkedBundle: { ...checkedBundle } }, { checkedBundle: false }, { checkedBundle: {} },
    { file: { id: id(91) } }, { actorUserId: id(91) }, { actorUserId: null },
    { file: { id: documentId, pdfGenerationId: id(91) } },
  ]) assert.throws(() => createDocumentPdfSource({ ...base, ...change }), { code: 'DOCUMENT_OPEN_INPUT' });
  assert.equal(reads, 0);
});

test('changed checked file identity rejects before reading or returning bytes', async () => {
  const checkedBundle = await issued(), file = { id: documentId };
  const source = createDocumentPdfSource({ file, checkedBundle, actorUserId: actor, isCurrent: current });
  file.id = id(91); await assert.rejects(source.readBytes(), { code: 'DOCUMENT_OPEN_INPUT' });
  file.id = documentId; file.pdfGenerationId = id(91);
  await assert.rejects(source.readBytes(), { code: 'DOCUMENT_OPEN_INPUT' });
});

test('stale scopes fail at creation and before every source read without I/O', async () => {
  let reads = 0, active = true;
  const options = { file: { filePath: 'owner/a.pdf' }, isCurrent: () => active, download: () => { reads++; } };
  const source = createDocumentPdfSource(options); active = false;
  assert.throws(() => createDocumentPdfSource(options), { code: 'DOCUMENT_OPEN_ABORTED' });
  await assert.rejects(source.readBytes(), { code: 'DOCUMENT_OPEN_ABORTED' }); assert.equal(reads, 0);
});

test('a stale download cannot be returned or installed in the retry cache', async () => {
  let active = true, downloads = 0; const pending = deferred();
  const source = createDocumentPdfSource({ file: { filePath: 'owner/a.pdf' }, isCurrent: () => active,
    download: () => ++downloads === 1 ? pending.promise : Promise.resolve(new Blob([bytes])) });
  const result = source.readBytes(); await Promise.resolve(); active = false;
  pending.resolve(new Blob([bytes]));
  await assert.rejects(result, { code: 'DOCUMENT_OPEN_ABORTED' });
  active = true; assert.deepEqual(new Uint8Array(await source.readBytes()), bytes); assert.equal(downloads, 2);
});

test('staleness during Blob.arrayBuffer prevents returning a late result', async () => {
  let active = true; const pending = deferred(), started = deferred();
  const file = new Blob([bytes]);
  file.arrayBuffer = () => { started.resolve(); return pending.promise; };
  const source = createDocumentPdfSource({ file, isCurrent: () => active });
  const result = source.readBytes(); await started.promise; active = false;
  pending.resolve(bytes.slice().buffer);
  await assert.rejects(result, { code: 'DOCUMENT_OPEN_ABORTED' });
});

test('invalid legacy sources do not invoke download', () => {
  let downloads = 0;
  for (const file of [null, {}, { file_path: 'not-the-legacy-field.pdf' }, { arrayBuffer: async () => bytes.buffer }]) {
    assert.throws(() => createDocumentPdfSource({ file, isCurrent: current, download: () => { downloads++; } }), { code: 'DOCUMENT_OPEN_INPUT' });
  }
  assert.throws(() => createDocumentPdfSource({ file: new Blob([bytes]) }), { code: 'DOCUMENT_OPEN_INPUT' });
  assert.equal(downloads, 0);
});
