import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import * as Y from 'yjs';
import { syncByPageToDoc, docToByPage } from '../src/services/annotationDocStore.js';
import { materializeAnnotationGenerationState } from '../src/services/annotationGenerationState.js';
import { prepareDocumentFirstGenerationAdoption as prepare } from '../src/services/documentFirstGenerationAdoptionTransform.js';

const id = n => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const b64 = bytes => Buffer.from(bytes).toString('base64');
const actor = id(1), documentId = id(2);
const pdf = await PDFDocument.create();
pdf.addPage([612, 792]);
const pdfBytes = new Uint8Array(await pdf.save());

function fixture({ snapshot = true, sidecar = null } = {}) {
  const sourceId = id(3), adoptionOperationId = id(4), candidateOperationId = id(5);
  const archiveOperationIds = [id(6), id(7)];
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [{ type: 'rect', pageNumber: 1,
    data: { id: 'kept', pageNumber: 1, excel_file_id: 'private-book', excelRowIndex: 12 },
    meta: { authorId: actor }, template_id: id(90) }] } });
  doc.getMap('annoMeta').set('futurePrivate', { token: 'must-not-survive' });
  doc.getMap('annoMeta').set('currentPage', 1);
  const state = b64(Y.encodeStateAsUpdate(doc)); doc.destroy();
  const descriptor = { bucket_id: 'documents', path: `${actor}/legacy.pdf`, id: id(8),
    version: id(9), byte_length: String(pdfBytes.byteLength) };
  const sources = {
    annotation_snapshot: snapshot ? { document_id: documentId, at_seq: '0', writer_epoch: '1',
      encoding_version: 1, snapshot_base64: state } : null,
    annotation_updates: [], document_annotations: [], doc_yjs_state: null, doc_yjs_updates: [],
    survey_sessions: [{ id: id(30), document_id: documentId, user_id: actor,
      template_id: id(31), excel_file_id: 'private-book' }],
    survey_items: [{ id: id(32), session_id: id(30), page_number: 1,
      annotation_id: 'kept', excel_row_index: 12 }],
    generation_baseline: null, generation_snapshot: null, generation_updates: [],
  };
  const sidecarBytes = sidecar == null ? null : new TextEncoder().encode(JSON.stringify(sidecar));
  const sidecarDescriptor = sidecarBytes == null ? null : { bucket_id: 'documents', path: `${actor}/legacy_data.json`,
    id: id(10), version: id(11), byte_length: String(sidecarBytes.byteLength) };
  const payload = { semantic: { version: 2, content_model_version: 1, document_id: documentId,
    generation_id: null, wal_head: '0', document: { id: documentId, user_id: actor, annotations: {},
      page_count: 1, current_page: 1, zoom_level: 2, template_id: id(31), excel_file_id: 'private-book' },
    sources, source_object: descriptor, sidecar_objects: sidecarDescriptor ? [sidecarDescriptor] : [],
    connector_consumed: { head: [], ops: [] } } };
  const proofObjects = [{ ...descriptor, kind: 'pdf', content_sha256: sha(pdfBytes) },
    ...(sidecarDescriptor ? [{ ...sidecarDescriptor, kind: 'sidecar', content_sha256: sha(sidecarBytes) }] : [])];
  const expires = new Date(Date.now() + 60_000).toISOString();
  const proof = { version: 2, content_model_version: 1, source_id: sourceId, actor_user_id: actor,
    document_id: documentId, generation_id: null, source_sql_sha256: 'b'.repeat(64), expires_at: expires,
    state: 'verified', objects: proofObjects, verified_at: new Date(Date.now() - 1000).toISOString() };
  const envelope = { version: 2, content_model_version: 1, source_id: sourceId, actor_user_id: actor,
    document_id: documentId, generation_id: null, source_sql_sha256: proof.source_sql_sha256,
    body_sha256: 'c'.repeat(64), wal_head: '0', expires_at: expires, source_bytes: proof, payload };
  const objects = [{ id: descriptor.id, version: descriptor.version, bytes: pdfBytes },
    ...(sidecarDescriptor ? [{ id: sidecarDescriptor.id, version: sidecarDescriptor.version, bytes: sidecarBytes }] : [])];
  return { actorUserId: actor, documentId, adoptionOperationId, sourceId, candidateOperationId,
    archiveOperationIds, envelope, objects };
}

test('adoption keeps exact PDF bytes and emits a narrow deterministic model 2 baseline', async () => {
  const input = fixture(), before = structuredClone(input.envelope);
  const first = await prepare(input), second = await prepare(input);
  assert.deepEqual(first.candidate.bytes, pdfBytes);
  assert.equal(first.candidate.contentSha256, sha(pdfBytes));
  assert.equal(first.candidate.byteLength, String(pdfBytes.byteLength));
  assert.equal(first.plan.version, 3);
  assert.equal(first.plan.contentModelVersion, 2);
  assert.equal(first.plan.aggregateAdmissionVersion, 1);
  assert.equal(first.plan.source.generationId, null);
  assert.equal(first.plan.source.contentModelVersion, 1);
  assert.deepEqual(first.canonicalAnnotations, { version: 1, policy: 'legacy-sql-v1', through_seq: '0',
    baseline_sha256: sha(Buffer.from(first.plan.baseline_base64, 'base64')),
    contributors: ['annotation-snapshot'] });
  assert.equal(first.sidecarEntityPolicy, 'absent');
  assert.equal(first.plan.baseline_base64, second.plan.baseline_base64);
  assert.deepEqual(input.envelope, before);
  assert.deepEqual(first.plan.projection.surveySessions,
    input.envelope.payload.semantic.sources.survey_sessions);
  assert.deepEqual(first.plan.projection.surveyItems,
    input.envelope.payload.semantic.sources.survey_items);
  assert.deepEqual(first.plan.projection.sidecars, []);
  assert.deepEqual(first.plan.projection.legacyYjs.meta, {});
  const checked = new Y.Doc();
  Y.applyUpdate(checked, Buffer.from(first.plan.baseline_base64, 'base64'));
  const state = materializeAnnotationGenerationState(checked, 2);
  checked.destroy();
  assert.equal(state.annotationsByPage[1].objects[0].data.id, 'kept');
  const encoded = JSON.stringify(state);
  for (const canary of ['private-book', 'must-not-survive', 'excel_file_id', 'excelRowIndex',
    'template_id', 'futurePrivate', 'currentPage']) assert.equal(encoded.includes(canary), false, canary);
});

test('an explicit empty snapshot is authoritative and cannot revive a stale SQL row', async () => {
  const input = fixture();
  const empty = new Y.Doc();
  input.envelope.payload.semantic.sources.annotation_snapshot.snapshot_base64 = b64(Y.encodeStateAsUpdate(empty));
  empty.destroy();
  input.envelope.payload.semantic.sources.document_annotations = [{ id: id(40), document_id: documentId,
    annotation_id: 'stale', annotation_type: 'rect', page_number: 1,
    annotation_data: { type: 'rect', pageNumber: 1, data: { id: 'stale', pageNumber: 1 } } }];
  await assert.rejects(prepare(input), { code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_INVALID' });
});

test('fallback uses SQL and legacy Yjs annotations only when snapshot and WAL are absent', async () => {
  const input = fixture({ snapshot: false }), sources = input.envelope.payload.semantic.sources;
  sources.document_annotations = [{ id: id(40), document_id: documentId, annotation_id: 'row-mark',
    annotation_type: 'rect', page_number: 1,
    annotation_data: { type: 'rect', pageNumber: 1, data: { id: 'row-mark', pageNumber: 1 } } }];
  const legacy = new Y.Doc(), record = new Y.Map(), fabric = new Y.Map(), meta = new Y.Map();
  const mark = { type: 'circle', pageNumber: 1, data: { id: 'legacy-mark', pageNumber: 1 } };
  for (const [key, value] of Object.entries(mark)) fabric.set(key, value);
  meta.set('authorId', actor); record.set('id', 'legacy-mark'); record.set('type', 'circle');
  record.set('pageNumber', 1); record.set('fabric', fabric); record.set('meta', meta);
  legacy.getMap('annotations').set('legacy-mark', record);
  legacy.getMap('meta').set('privateToken', 'must-not-survive');
  sources.doc_yjs_state = { document_id: documentId, through_seq: '7', encoding_version: 1,
    state_base64: b64(Y.encodeStateAsUpdate(legacy)) }; legacy.destroy();
  const result = await prepare(input);
  assert.deepEqual(result.canonicalAnnotations.contributors,
    ['document-annotations', 'legacy-yjs-annotations']);
  assert.equal(result.plan.projection.legacyYjs.meta.privateToken, 'must-not-survive',
    'the existing private legacy SQL projection remains byte-semantic data, not checked baseline data');
  const checked = new Y.Doc(); Y.applyUpdate(checked, Buffer.from(result.plan.baseline_base64, 'base64'));
  assert.deepEqual(Object.values(docToByPage(checked)).flatMap(page => page.objects).map(item => item.data.id).sort(),
    ['legacy-mark', 'row-mark']);
  assert.equal(JSON.stringify(materializeAnnotationGenerationState(checked, 2)).includes('privateToken'), false);
  checked.destroy();
});

test('sidecar content is archive-only and nonempty entities require accepted-catalog policy', async () => {
  const result = await prepare(fixture({ sidecar: { version: 1, entities: [{ id: 'entity' }],
    annotationsByPage: { 1: { objects: [{ type: 'rect', data: { id: 'sidecar-only' } }] } },
    currentPage: 1, zoomLevel: 4, templateId: id(80) } }));
  assert.equal(result.sidecarEntityPolicy, 'accepted-catalog');
  assert.equal(JSON.stringify(result.plan).includes('sidecar-only'), false);
  assert.deepEqual(result.plan.projection.sidecars, []);
});
