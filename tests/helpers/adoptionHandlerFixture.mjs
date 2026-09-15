import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import * as Y from 'yjs';
import { syncByPageToDoc } from '../../src/services/annotationDocStore.js';

export const adoptionId = n => `a6000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const adoptionSha = bytes => createHash('sha256').update(bytes).digest('hex');
const b64 = bytes => Buffer.from(bytes).toString('base64');
const stream = bytes => new ReadableStream({ start(controller) {
  const copy = bytes.slice();
  controller.enqueue(copy.slice(0, Math.max(1, Math.floor(copy.byteLength / 2))));
  controller.enqueue(copy.slice(Math.max(1, Math.floor(copy.byteLength / 2))));
  controller.close();
} });

export async function createAdoptionHandlerFixture() {
  const actorUserId = adoptionId(1), documentId = adoptionId(2), sourceId = adoptionId(3);
  const adoptionOperationId = adoptionId(4), candidateOperationId = adoptionId(5);
  const archiveOperationIds = [adoptionId(6), adoptionId(7)];
  const generationId = adoptionId(8), ownerUserId = actorUserId;
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const pdfBytes = new Uint8Array(await pdf.save());
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [{ type: 'rect', pageNumber: 1,
    data: { id: 'kept', pageNumber: 1, excel_file_id: 'private-book', excelRowIndex: 12 },
    meta: { authorId: actorUserId }, template_id: adoptionId(90) }] } });
  doc.getMap('annoMeta').set('futurePrivate', { token: 'must-not-survive' });
  doc.getMap('annoMeta').set('currentPage', 1);
  const state = b64(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  const descriptor = { bucket_id: 'documents', path: `${actorUserId}/legacy.pdf`, id: adoptionId(10),
    version: adoptionId(11), byte_length: String(pdfBytes.byteLength) };
  const sources = {
    annotation_snapshot: { document_id: documentId, at_seq: '0', writer_epoch: '1',
      encoding_version: 1, snapshot_base64: state },
    annotation_updates: [], document_annotations: [], doc_yjs_state: null, doc_yjs_updates: [],
    survey_sessions: [{ id: adoptionId(30), document_id: documentId, user_id: actorUserId,
      template_id: adoptionId(31), excel_file_id: 'private-book' }],
    survey_items: [{ id: adoptionId(32), session_id: adoptionId(30), page_number: 1,
      annotation_id: 'kept', excel_row_index: 12 }],
    generation_baseline: null, generation_snapshot: null, generation_updates: [],
  };
  const sourceSqlSha256 = 'b'.repeat(64);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const proofObject = { ...descriptor, kind: 'pdf', content_sha256: adoptionSha(pdfBytes) };
  const proof = { version: 2, content_model_version: 1, source_id: sourceId,
    actor_user_id: actorUserId, document_id: documentId, generation_id: null,
    source_sql_sha256: sourceSqlSha256, expires_at: expiresAt, state: 'verified',
    objects: [proofObject], verified_at: new Date(Date.now() - 1000).toISOString() };
  const semantic = { version: 2, content_model_version: 1, document_id: documentId,
    generation_id: null, wal_head: '0', document: { id: documentId, user_id: actorUserId,
      annotations: {}, page_count: 1, current_page: 1, zoom_level: 2,
      template_id: adoptionId(31), excel_file_id: 'private-book' },
    sources, source_object: descriptor, sidecar_objects: [],
    connector_consumed: { head: [], ops: [] } };
  const envelope = { version: 2, content_model_version: 1, source_id: sourceId,
    actor_user_id: actorUserId, document_id: documentId, generation_id: null,
    source_sql_sha256: sourceSqlSha256, body_sha256: 'c'.repeat(64), wal_head: '0',
    expires_at: expiresAt, source_bytes: proof, payload: { semantic } };

  const calls = { auth: [], rpc: [], source: [], sourceBytes: [], upload: [], puts: [] };
  let adoptionReceipt = { version: 1, state: 'missing', actor_user_id: actorUserId,
    adoption_operation_id: adoptionOperationId };
  let sourceByteState = 'unverified';
  const uploaded = new Map();
  const uploadOperations = new Map();
  let claimSequence = 60;

  const sourceReceipt = () => ({ version: 2, content_model_version: 1, source_id: sourceId,
    actor_user_id: actorUserId, document_id: documentId, generation_id: null, state: 'captured',
    source_byte_state: 'unverified', source_sql_sha256: sourceSqlSha256, wal_head: '0', expires_at: expiresAt,
    source_object: descriptor, sidecar_objects: [], visible_capture: { document: semantic.document,
      sources: { ...sources, active_generation: null }, compare: { wal_head: '0', covered_head: '0' },
      scope: 'sql-metadata-only' } });
  const sourceBytesReceipt = stateValue => ({ version: 2, content_model_version: 1,
    source_id: sourceId, actor_user_id: actorUserId, document_id: documentId, generation_id: null,
    source_sql_sha256: sourceSqlSha256, state: stateValue, expires_at: expiresAt,
    objects: [{ ...proofObject, content_sha256: stateValue === 'verified' ? proofObject.content_sha256 : null }],
    verified_at: stateValue === 'verified' ? proof.verified_at : null });
  const visibleObjects = [{ kind: 'pdf', byte_length: descriptor.byte_length,
    content_sha256: proofObject.content_sha256 }];
  const definitions = { status: 'absent', revision: null, content_sha256: null };
  const reviewReceipt = canonical => ({ version: 1, state: 'review', actor_user_id: actorUserId,
    owner_user_id: ownerUserId, document_id: documentId, adoption_operation_id: adoptionOperationId,
    source_id: sourceId, candidate_operation_id: candidateOperationId,
    offered_archive_operation_ids: [...archiveOperationIds], used_archive_operation_ids: [archiveOperationIds[0]],
    review_sha256: 'd'.repeat(64), source_sql_sha256: sourceSqlSha256, wal_head: '0',
    objects: visibleObjects, canonical_annotations: canonical, entity_catalog: definitions,
    survey_definition: definitions, expires_at: expiresAt });

  function uploadReceipt(operationId, changes = {}) {
    const archive = operationId === archiveOperationIds[0];
    const sourceObject = archive ? proofObject : null;
    const byteLength = archive ? proofObject.byte_length : String(pdfBytes.byteLength);
    const contentSha256 = archive ? proofObject.content_sha256 : adoptionSha(pdfBytes);
    return { version: archive ? 3 : 2, content_model_version: 1, operation_id: operationId,
      actor_user_id: actorUserId, document_id: documentId, generation_id: generationId,
      owner_user_id: ownerUserId, source_id: sourceId,
      purpose: archive ? 'source-object-archive' : 'candidate-pdf', expected_source_generation_id: null,
      ...(archive ? { archived_source_object_id: descriptor.id, source_object: sourceObject } : {}),
      path: `${ownerUserId}/_generations/${documentId}/${generationId}/${operationId}.${archive ? 'bin' : 'pdf'}`,
      content_sha256: contentSha256, byte_length: byteLength, source_sql_sha256: sourceSqlSha256,
      expires_at: expiresAt, state: 'reserved', upload_state: 'reserved', object: null,
      verified_at: null, rejection: null, ...changes };
  }
  const storeUpload = (operationId, receipt) => {
    uploadOperations.set(operationId, receipt);
    return receipt;
  };
  const traced = (group, name, fn) => (...args) => {
    calls[group].push({ name, args });
    return fn(...args);
  };
  const serviceClients = {
    source: {
      beginV2: traced('source', 'beginV2', async () => sourceReceipt()),
      getV2: traced('source', 'getV2', async () => sourceReceipt()),
    },
    sourceBytes: {
      newId: traced('sourceBytes', 'newId', () => adoptionId(++claimSequence)),
      getV2: traced('sourceBytes', 'getV2', async () => sourceBytesReceipt(sourceByteState)),
      claimV2: traced('sourceBytes', 'claimV2', async (_actor, _source, claimId) => ({
        ...sourceBytesReceipt('verifying'), verification_claim_id: claimId,
        verification_claim_expires_at: new Date(Date.now() + 30_000).toISOString(),
      })),
      openStream: traced('sourceBytes', 'openStream', async () => stream(pdfBytes)),
      recordV2: traced('sourceBytes', 'recordV2', async () => {
        sourceByteState = 'verified';
        return sourceBytesReceipt('verified');
      }),
      release: traced('sourceBytes', 'release', async () => ({ released: true })),
    },
    upload: {
      newId: traced('upload', 'newId', () => adoptionId(++claimSequence)),
      beginV3: traced('upload', 'beginV3', async (_token, input) => {
        const current = uploadOperations.get(input.operation_id);
        return current ?? storeUpload(input.operation_id, uploadReceipt(input.operation_id));
      }),
      beginArchiveV2: traced('upload', 'beginArchiveV2', async (_token, input) => {
        const current = uploadOperations.get(input.operation_id);
        return current ?? storeUpload(input.operation_id, uploadReceipt(input.operation_id));
      }),
      get: traced('upload', 'get', async (_token, operationId) => uploadOperations.get(operationId)),
      mint: traced('upload', 'mint', async path => ({ path, token: `upload-${uploaded.size}`,
        signedUrl: `https://storage.test/${encodeURIComponent(path)}` })),
      claim: traced('upload', 'claim', async (_actor, operationId, claimId) => {
        const current = uploadOperations.get(operationId);
        return { ...current, verification_claim_id: claimId };
      }),
      openStream: traced('upload', 'openStream', async path => stream(uploaded.get(path))),
      record: traced('upload', 'record', async (_actor, operationId) => {
        const current = uploadOperations.get(operationId);
        const verified = { ...current, state: 'verified', upload_state: 'verified',
          verified_at: new Date().toISOString() };
        storeUpload(operationId, verified);
        return verified;
      }),
      release: traced('upload', 'release', async () => ({ released: true })),
    },
  };

  async function privateRpc(name, params) {
    calls.rpc.push({ name, params });
    if (name === 'read_document_generation_transform_source_v2') return { data: structuredClone(envelope), error: null };
    if (name === 'read_document_first_generation_adoption_service_v1') return { data: structuredClone(adoptionReceipt), error: null };
    if (name === 'create_document_first_generation_adoption_review_service_v1') {
      adoptionReceipt = reviewReceipt(params.p_canonical_annotations);
      return { data: structuredClone(adoptionReceipt), error: null };
    }
    if (name === 'confirm_document_first_generation_adoption_service_v1') {
      adoptionReceipt = { ...adoptionReceipt, state: 'confirmed', confirmed_at: new Date().toISOString() };
      return { data: structuredClone(adoptionReceipt), error: null };
    }
    if (name === 'prepare_document_first_generation_adoption_service_v1') return { data: structuredClone(adoptionReceipt), error: null };
    if (name === 'publish_document_first_generation_adoption_service_v1') {
      adoptionReceipt = { ...adoptionReceipt, state: 'published', generation_id: generationId,
        content_model_version: 2, pdf: { byte_length: descriptor.byte_length,
          content_sha256: proofObject.content_sha256 },
        legacy_sidecar_migration: { version: 2, state: 'archived',
          origin: { mode: 'legacy', adoption_operation_id: adoptionOperationId } },
        published_at: new Date().toISOString() };
      return { data: structuredClone(adoptionReceipt), error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  }

  return {
    identity: { actorUserId, documentId, adoptionOperationId, sourceId,
      candidateOperationId, archiveOperationIds, generationId },
    envelope, pdfBytes, calls, uploadOperations,
    options: {
      enabled: true,
      getUser: async token => { calls.auth.push(token); return token === 'actor-token' ? { id: actorUserId } : null; },
      serviceClients,
      privateRpc,
      putSignedUpload: async (upload, blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        calls.puts.push({ upload, bytes });
        uploaded.set(upload.path, bytes);
        const [operationId, current] = [...uploadOperations].find(([, value]) => value.path === upload.path);
        storeUpload(operationId, { ...current, object: { id: adoptionId(++claimSequence),
          version: adoptionId(++claimSequence), byte_length: String(bytes.byteLength) } });
      },
    },
    request(body) {
      return new Request('https://edge.test/document-generation-adoption', { method: 'POST',
        headers: { Authorization: 'Bearer actor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify(body) });
    },
  };
}
