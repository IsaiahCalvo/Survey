import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import * as Y from 'yjs';
import { syncByPageToDoc, docToByPage } from '../src/services/annotationDocStore.js';
import { prepareDocumentGenerationReplacement as prepare } from '../src/services/documentGenerationReplacement.js';

const id = n => `87000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const b64 = bytes => Buffer.from(bytes).toString('base64');
const pdf = await PDFDocument.create();
for (const size of [[612,792],[420,600],[500,700]]) pdf.addPage(size);
const original = await pdf.save();
const invalid = error => {
  assert.equal(error.code, 'DOCUMENT_GENERATION_REPLACEMENT_INVALID');
  assert.equal(error.message, 'The complete document replacement could not be prepared.');
  assert.deepEqual(Object.keys(error), ['code']); return true;
};
function fixture(generated = false) {
  const actorUserId = id(1), documentId = id(2), sourceId = id(3), operationId = id(4), generation = generated ? id(5) : null;
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 2: { objects: [{ type: 'rect', pageNumber: 2, left: 10, top: 20, width: 30, height: 40,
    data: { id: 'mark', pageNumber: 2 }, meta: { authorId: actorUserId } }] } });
  doc.getMap('annoMeta').set('futureFeature', { text: 'Preserved' });
  const state = b64(Y.encodeStateAsUpdate(doc)); doc.destroy();
  const wal = '9007199254740993', expires = new Date(Date.now() + 60000).toISOString();
  const descriptor = { bucket_id: 'documents', path: `${actorUserId}/source.pdf`, id: id(6), version: id(7), byte_length: String(original.byteLength) };
  const snapshot = { document_id: documentId, at_seq: wal, writer_epoch: '1', encoding_version: 1, snapshot_base64: state };
  const sources = { annotation_snapshot: generated ? null : snapshot, annotation_updates: [], document_annotations: [],
    doc_yjs_state: null, doc_yjs_updates: [], survey_sessions: [], survey_items: [], generation_snapshot: null, generation_updates: [],
    generation_baseline: generated ? { document_id: documentId, generation_id: generation, base_seq: wal,
      baseline_encoding_version: 1, baseline_snapshot_base64: state } : null };
  const payload = { semantic: { version: 1, document_id: documentId, generation_id: generation, wal_head: wal,
    document: { id: documentId, user_id: actorUserId, annotations: {}, page_count: 3, current_page: 2,
      content_sha256: 'a'.repeat(64), file_path: descriptor.path, file_size: descriptor.byte_length },
    sources, source_object: descriptor, sidecar_objects: [], connector_consumed: { head: [], ops: [] } },
  connector_history: { audit: [{ private: 'preserved' }] }, wal_history: { legacy: [], generation: [] } };
  const proof = { version: 1, actor_user_id: actorUserId, document_id: documentId, source_id: sourceId,
    generation_id: generation, source_sql_sha256: 'b'.repeat(64), expires_at: expires, state: 'verified',
    objects: [{ ...descriptor, kind: 'pdf', content_sha256: hash(original) }], verified_at: new Date(Date.now() - 1000).toISOString() };
  const envelope = { version: 1, actor_user_id: actorUserId, document_id: documentId, source_id: sourceId,
    generation_id: generation, source_sql_sha256: proof.source_sql_sha256, body_sha256: 'c'.repeat(64),
    wal_head: wal, expires_at: expires, source_bytes: proof, payload };
  return { actorUserId, documentId, sourceId, operationId, envelope,
    operation: { type: 'move', from: 2, to: 1 }, objects: [{ id: descriptor.id, version: descriptor.version, bytes: new Uint8Array(original) }] };
}

for (const [operation, pages, markerPages, widths] of [
  [{ type: 'move', from: 2, to: 1 }, 3, [1], [420,612,500]],
  [{ type: 'reorder', from: 2, to: 3 }, 3, [3], [612,500,420]],
  [{ type: 'insert', afterPage: 1 }, 4, [3], [612,612,420,500]],
  [{ type: 'delete', page: 2 }, 2, [], [612,500]],
  [{ type: 'rotate', page: 2, delta: 90 }, 3, [2], [612,420,500]],
  [{ type: 'copy', source: 2, afterPage: 3 }, 4, [2,4], [612,420,500,420]],
  [{ type: 'duplicate', page: 2 }, 4, [2,3], [612,420,420,500]],
]) test(`${operation.type}: real PDF bytes and Yjs plan agree while import hash stays untouched`, async () => {
  const input = fixture(); input.operation = operation;
  const result = await prepare(input), actualPdf = await PDFDocument.load(result.candidate.bytes);
  assert.equal(actualPdf.getPageCount(), pages); assert.equal(result.candidate.pageCount, pages);
  assert.deepEqual(actualPdf.getPages().map(page => page.getWidth()), widths);
  assert.deepEqual(actualPdf.getPages().map(page => page.getRotation().angle),
    widths.map((_, index) => operation.type === 'rotate' && index === 1 ? 90 : 0));
  assert.equal(result.candidate.byteLength, String(result.candidate.bytes.byteLength));
  assert.equal(result.candidate.contentSha256, hash(result.candidate.bytes));
  assert.equal(result.plan.projection.document.content_sha256, 'a'.repeat(64));
  assert.deepEqual(Object.keys(result.plan).sort(), ['version','operationId','source','operation','projection','baseline_base64','legacy'].sort());
  assert.equal(result.plan.operationId, input.operationId); assert.equal(result.plan.source.walHead, '9007199254740993');
  const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(result.plan.baseline_base64, 'base64'));
  assert.deepEqual(Object.keys(docToByPage(doc)).map(Number), markerPages);
  assert.equal(doc.getMap('annoMeta').get('futureFeature').text, 'Preserved'); doc.destroy();
  assert.equal(Object.isFrozen(result.plan), true); assert.equal(Object.isFrozen(result.plan.projection.document), true);
  assert.equal(result.plan.legacy.documentId, input.documentId); assert.equal(result.plan.legacy.encodingVersion, 1);
});

test('preparation parses once while delegating to the real PDF parser and mutation', async () => {
  const originalLoad = PDFDocument.load; let loads = 0;
  PDFDocument.load = function (...args) { loads++; return originalLoad.apply(this, args); };
  let result;
  try {
    result = await prepare(fixture());
    assert.equal(loads, 1);
  } finally { PDFDocument.load = originalLoad; }
  const saved = await originalLoad.call(PDFDocument, result.candidate.bytes);
  assert.deepEqual(saved.getPages().map(page => page.getWidth()), [420,612,500]);
});

test('generated source preserves exact generation and full tail frontier', async () => {
  const input = fixture(true), semantic = input.envelope.payload.semantic;
  const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(semantic.sources.generation_baseline.baseline_snapshot_base64, 'base64'));
  const vector = Y.encodeStateVector(doc); doc.getMap('annoMeta').set('tail', { text: 'latest' });
  semantic.wal_head = input.envelope.wal_head = '9007199254740994';
  semantic.sources.generation_updates = [{ document_id: input.documentId, generation_id: semantic.generation_id,
    seq: semantic.wal_head, client_seq: '1', data_base64: b64(Y.encodeStateAsUpdate(doc, vector)) }]; doc.destroy();
  const result = await prepare(input);
  assert.equal(result.plan.source.generationId, id(5)); assert.equal(result.plan.source.walHead, semantic.wal_head);
  assert.equal(result.plan.projection.modern.annoMeta.tail.text, 'latest');
});

test('input bytes, operation, and nested captured state are owned before any await', async () => {
  const input = fixture(), before = structuredClone(input);
  const pending = prepare(input);
  input.objects[0].bytes.fill(0); input.operation.to = 3;
  input.envelope.payload.semantic.document.content_sha256 = 'd'.repeat(64);
  input.envelope.payload.semantic.sources.annotation_snapshot.snapshot_base64 = 'AAAA';
  const result = await pending;
  assert.equal(result.plan.operation.to, 1); assert.equal(result.plan.projection.document.content_sha256, 'a'.repeat(64));
  assert.equal((await PDFDocument.load(result.candidate.bytes)).getPage(0).getWidth(), 420);
  const other = await prepare(before);
  assert.deepEqual(result.plan, other.plan);
});

test('wrong actor/source/document/generation/frontier/digest/version receipts fail closed', async () => {
  for (const mutate of [
    i => { i.actorUserId = id(20); }, i => { i.documentId = id(20); }, i => { i.sourceId = id(20); },
    i => { i.envelope.version = 2; }, i => { i.envelope.source_bytes.version = 2; },
    i => { i.envelope.source_bytes.generation_id = id(20); }, i => { i.envelope.payload.semantic.generation_id = id(20); },
    i => { i.envelope.wal_head = '9007199254740994'; }, i => { i.envelope.source_bytes.source_sql_sha256 = 'd'.repeat(64); },
    i => { i.envelope.body_sha256 = 'not-a-hash'; }, i => { i.envelope.source_bytes.state = 'verifying'; },
    i => { i.envelope.body_sha256 = ['c'.repeat(64)]; },
    i => { i.envelope.payload.semantic.source_object.version = id(20); },
    i => { i.objects[0].version = id(20); }, i => { i.objects[0].id = id(20); },
  ]) { const input = fixture(); mutate(input); await assert.rejects(prepare(input), invalid); }
});

test('current proof hash and native length reject corrupt bytes, not original-import digest', async () => {
  for (const mutate of [
    i => { i.objects[0].bytes[0] ^= 1; },
    i => { i.objects[0].bytes = i.objects[0].bytes.subarray(1); },
    i => { i.envelope.source_bytes.objects[0].content_sha256 = i.envelope.payload.semantic.document.content_sha256; },
    i => { const bytes = new Uint8Array(original.length + 1); bytes.set(original); Object.defineProperty(bytes, 'byteLength', { value: original.length }); i.objects[0].bytes = bytes; },
  ]) { const input = fixture(); mutate(input); await assert.rejects(prepare(input), invalid); }
});

test('sidecars, incomplete object set, unsupported source lanes and malformed PDF never drop state', async () => {
  for (const mutate of [
    i => { i.envelope.payload.semantic.sidecar_objects = [{ path: 'sidecar' }]; },
    i => { i.envelope.payload.semantic.document.annotations = { old: 'must preserve' }; },
    i => { i.objects = []; }, i => { i.objects.push(i.objects[0]); },
    i => { i.envelope.source_bytes.objects = []; },
    i => { delete i.envelope.payload.semantic.sources.annotation_updates; },
    i => { i.operation = { type: 'replace' }; }, i => { i.operation = { type: 'move', from: 100, to: 1 }; },
    i => { const bytes = new Uint8Array(original.length); i.objects[0].bytes = bytes; i.envelope.source_bytes.objects[0].content_sha256 = hash(bytes); },
  ]) { const input = fixture(); mutate(input); await assert.rejects(prepare(input), invalid); }
});

test('expired source fails before work and expiration during computation cannot return a candidate', async () => {
  const old = fixture(); old.envelope.expires_at = old.envelope.source_bytes.expires_at = new Date(Date.now() - 1).toISOString();
  await assert.rejects(prepare(old), invalid);
  const input = fixture(), now = Date.now, expires = Date.parse(input.envelope.expires_at); let calls = 0;
  Date.now = () => ++calls >= 4 ? expires + 1 : now();
  try { await assert.rejects(prepare(input), invalid); } finally { Date.now = now; }
});

test('JSON depth, getters, cycles and hostile exceptions produce only fixed safe errors', async () => {
  for (const mutate of [
    i => { i.envelope.payload.cycle = i.envelope; },
    i => { let value = {}; for (let n = 0; n < 66; n++) value = { nested: value }; i.envelope.payload.deep = value; },
    i => { Object.defineProperty(i.envelope.payload, 'unknown', { enumerable: true, get() { throw Object.assign(new Error('secret'), { code: 'secret' }); } }); },
    i => { Object.defineProperty(i, 'envelope', { get() { throw Object.assign(new Error('secret'), { code: 'secret' }); } }); },
  ]) { const input = fixture(); mutate(input); await assert.rejects(prepare(input), invalid); }
});

test('worker byte bounds and shared mutable buffers fail before PDF parsing', async () => {
  for (const mutate of [
    i => { i.envelope.payload.semantic.source_object.byte_length = i.envelope.source_bytes.objects[0].byte_length = '268435457'; },
    i => { i.envelope.payload.semantic.source_object.byte_length = i.envelope.source_bytes.objects[0].byte_length = '0'; },
    i => { i.envelope.payload.semantic.source_object.byte_length = i.envelope.source_bytes.objects[0].byte_length = '01'; },
    i => { const shared = new Uint8Array(new SharedArrayBuffer(original.length)); shared.set(original); i.objects[0].bytes = shared; },
    i => { i.envelope.payload.large = 'x'.repeat(16 * 1024 * 1024); },
  ]) { const input = fixture(); mutate(input); await assert.rejects(prepare(input), invalid); }
});
