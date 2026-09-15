// SERVER PRIVATE. This converts a verified null-generation capture into the
// narrow checked-state plan used for first adoption. Raw source bytes remain in
// the separate immutable archives; this plan must never be sent to a browser.
import * as Y from 'yjs';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { createDetachedYDoc } from '../lib/collab/ydocRegistry.js';
import { syncByPageToDoc, deletedPdfAnnotationStorageKey } from './annotationDocStore.js';
import { materializeAnnotationGenerationState } from './annotationGenerationState.js';
import { initializeSurveyCrdtV2 } from './documentSurveyCrdtV2.js';
import { transformDocumentGenerationSource } from './documentGenerationTransform.js';
import { copyReplacementJson as copyJson } from './documentReplacementInput.js';
import { EXPORT_ACK_FIELDS } from './excelExportAck.js';

const PDF_LIMIT = 256 * 1024 * 1024, SIDECAR_LIMIT = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;
const PRIVATE_FIELDS = new Set([...EXPORT_ACK_FIELDS, 'excelFileId', 'excel_file_id',
  'excelRowIndex', 'excel_row_index', 'templateId', 'template_id', 'surveySessionId',
  'survey_session_id', 'sessionId', 'session_id', 'currentPage', 'current_page',
  'zoomLevel', 'zoom_level', 'activeSpaceId', 'active_space_id', 'selectedTool', 'activeTool']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => object(value)
  && Object.keys(value).sort().join('|') === [...fields].sort().join('|');
const uuid = value => typeof value === 'string' && UUID.test(value);
const decimal = value => typeof value === 'string' && DECIMAL.test(value)
  && BigInt(value) <= 9223372036854775807n;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const b64 = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const fail = () => { throw Object.assign(new Error('The first checked generation could not be prepared.'),
  { code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_INVALID' }); };
const check = value => { if (!value) fail(); };

function freeze(value) {
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

function ownedBytes(value, expectedLength, expectedHash, limit) {
  check(value instanceof Uint8Array);
  const proto = Object.getPrototypeOf(Uint8Array.prototype);
  const length = Object.getOwnPropertyDescriptor(proto, 'byteLength').get.call(value);
  const buffer = Object.getOwnPropertyDescriptor(proto, 'buffer').get.call(value);
  check(buffer instanceof ArrayBuffer && length === Number(expectedLength) && length > 0 && length <= limit);
  const result = new Uint8Array(length); Uint8Array.prototype.set.call(result, value);
  check(hash(result) === expectedHash); return result;
}

function stripPrivate(value, ancestors = new Set()) {
  if (value === null || typeof value !== 'object') return value;
  check(!ancestors.has(value)); ancestors.add(value);
  const result = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    if (!PRIVATE_FIELDS.has(key)) Object.defineProperty(result, key, {
      value: stripPrivate(item, ancestors), enumerable: true, writable: true, configurable: true,
    });
  }
  ancestors.delete(value); return result;
}

function deterministicId(seed, sequence) {
  const hex = createHash('sha256').update(`${seed}\u0000survey\u0000${sequence}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function acceptedSurveyDefinition(semantic) {
  const value = semantic.survey_definition ?? semantic.accepted_survey_definition ?? null;
  return object(value) && value.status === 'accepted' && decimal(value.revision)
    && typeof value.content_sha256 === 'string' && HASH.test(value.content_sha256);
}

function buildCheckedState(transformed, seed) {
  const modern = transformed.projection.modern;
  const annotationsByPage = stripPrivate(modern.annotationsByPage);
  const surveyMarkers = stripPrivate(modern.surveyMarkers);
  const spaces = stripPrivate(modern.spaces ?? []);
  const deletedPdfAnnotations = stripPrivate(modern.deletedPdfAnnotations);
  const doc = createDetachedYDoc();
  try {
    doc.clientID = createHash('sha256').update(seed).digest().readUInt32BE(0) || 1;
    syncByPageToDoc(doc, annotationsByPage, { origin: 'first-generation-adoption' });
    let sequence = 0;
    initializeSurveyCrdtV2(doc, { surveyMarkers, spaces, origin: 'first-generation-adoption',
      createId: () => deterministicId(seed, ++sequence) });
    for (const value of deletedPdfAnnotations) doc.getMap('deletedPdfAnnotations')
      .set(deletedPdfAnnotationStorageKey(value.pageNumber, value.pdfAnnotationId), value);
    const baseline = Y.encodeStateAsUpdate(doc);
    const materialized = copyJson(materializeAnnotationGenerationState(doc, 2));
    check(Object.keys(materialized.annoMeta).length === 0);
    return { baseline, materialized };
  } finally { doc.destroy(); }
}

/** Prepare byte-identical PDF adoption and a privacy-minimal model-2 plan.
 * The source envelope and byte proof must come from the trusted server capture;
 * SQL still rechecks access, source digest, WAL head, definitions and storage
 * objects inside the short publish transaction.
 */
export async function prepareDocumentFirstGenerationAdoption(input) {
  try {
    check(object(input));
    const { actorUserId, documentId, adoptionOperationId, sourceId,
      candidateOperationId, archiveOperationIds } = input;
    check([actorUserId, documentId, adoptionOperationId, sourceId, candidateOperationId].every(uuid)
      && Array.isArray(archiveOperationIds) && archiveOperationIds.length === 2
      && archiveOperationIds.every(uuid)
      && new Set([adoptionOperationId, sourceId, candidateOperationId, ...archiveOperationIds]).size === 5);
    const envelope = copyJson(input.envelope);
    check(exact(envelope, ['version', 'content_model_version', 'source_id', 'actor_user_id', 'document_id',
      'generation_id', 'source_sql_sha256', 'body_sha256', 'wal_head', 'expires_at', 'source_bytes', 'payload'])
      && envelope.version === 2 && envelope.content_model_version === 1 && envelope.source_id === sourceId
      && envelope.actor_user_id === actorUserId && envelope.document_id === documentId
      && envelope.generation_id === null && HASH.test(envelope.source_sql_sha256)
      && HASH.test(envelope.body_sha256) && decimal(envelope.wal_head));
    const expiry = Date.parse(envelope.expires_at);
    check(Number.isFinite(expiry) && expiry > Date.now());
    const proof = envelope.source_bytes, semantic = envelope.payload?.semantic;
    check(exact(proof, ['version', 'content_model_version', 'source_id', 'actor_user_id', 'document_id',
      'generation_id', 'source_sql_sha256', 'expires_at', 'state', 'objects', 'verified_at'])
      && proof.version === 2 && proof.content_model_version === 1 && proof.state === 'verified'
      && ['source_id', 'actor_user_id', 'document_id', 'generation_id', 'source_sql_sha256', 'expires_at']
        .every(key => proof[key] === envelope[key])
      && Number.isFinite(Date.parse(proof.verified_at)) && Date.parse(proof.verified_at) < expiry
      && object(semantic) && semantic.version === 2 && semantic.content_model_version === 1
      && semantic.document_id === documentId && semantic.generation_id === null
      && semantic.wal_head === envelope.wal_head && semantic.document?.id === documentId
      && Array.isArray(semantic.sidecar_objects) && semantic.sidecar_objects.length <= 1
      && Array.isArray(proof.objects) && proof.objects.length === 1 + semantic.sidecar_objects.length);
    const supplied = input.objects;
    check(Array.isArray(supplied) && supplied.length === proof.objects.length);
    const descriptor = semantic.source_object, attestedPdf = proof.objects[0];
    check(exact(descriptor, ['bucket_id', 'path', 'id', 'version', 'byte_length'])
      && exact(attestedPdf, ['bucket_id', 'path', 'id', 'version', 'byte_length', 'kind', 'content_sha256'])
      && descriptor.bucket_id === 'documents' && uuid(descriptor.id) && uuid(descriptor.version)
      && decimal(descriptor.byte_length) && attestedPdf.kind === 'pdf' && HASH.test(attestedPdf.content_sha256)
      && Object.keys(descriptor).every(key => descriptor[key] === attestedPdf[key])
      && exact(supplied[0], ['id', 'version', 'bytes']) && supplied[0].id === descriptor.id
      && supplied[0].version === descriptor.version);
    const pdfBytes = ownedBytes(supplied[0].bytes, descriptor.byte_length, attestedPdf.content_sha256, PDF_LIMIT);
    let sidecarEntityPolicy = 'absent';
    if (semantic.sidecar_objects.length === 1) {
      const sidecarDescriptor = semantic.sidecar_objects[0], attested = proof.objects[1], given = supplied[1];
      check(exact(sidecarDescriptor, ['bucket_id', 'path', 'id', 'version', 'byte_length'])
        && exact(attested, ['bucket_id', 'path', 'id', 'version', 'byte_length', 'kind', 'content_sha256'])
        && sidecarDescriptor.bucket_id === 'documents' && uuid(sidecarDescriptor.id) && uuid(sidecarDescriptor.version)
        && decimal(sidecarDescriptor.byte_length) && attested.kind === 'sidecar' && HASH.test(attested.content_sha256)
        && Object.keys(sidecarDescriptor).every(key => sidecarDescriptor[key] === attested[key])
        && exact(given, ['id', 'version', 'bytes']) && given.id === sidecarDescriptor.id
        && given.version === sidecarDescriptor.version);
      const bytes = ownedBytes(given.bytes, sidecarDescriptor.byte_length, attested.content_sha256, SIDECAR_LIMIT);
      let sidecar;
      try { sidecar = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(); }
      check(object(sidecar) && sidecar.version === 1);
      const entities = Object.hasOwn(sidecar, 'entities') ? sidecar.entities : [];
      check(Array.isArray(entities) && entities.length <= 256 && entities.every(object));
      if (entities.length) sidecarEntityPolicy = 'accepted-catalog';
    }
    const loaded = await PDFDocument.load(pdfBytes);
    const pageCount = loaded.getPageCount();
    check(pageCount > 0 && pageCount <= 10000);
    const pageSizes = loaded.getPages().map(page => page.getSize());
    check(pageSizes.every(size => Number.isFinite(size.width) && size.width > 0
      && Number.isFinite(size.height) && size.height > 0));
    const payload = copyJson(envelope.payload), sources = payload.semantic.sources;
    check(object(sources) && Array.isArray(sources.annotation_updates)
      && Array.isArray(sources.document_annotations) && Array.isArray(sources.doc_yjs_updates));
    payload.semantic.sidecar_objects = [];
    sources.survey_sessions = [];
    sources.survey_items = [];
    const operation = { type: 'rotate', page: 1, delta: 0 };
    const transformed = await transformDocumentGenerationSource({ sourcePayload: payload, sidecars: [],
      operationId: candidateOperationId, operation, pageCount, pageSizes,
      copiedWidgets: [], targetContentModelVersion: 2 });
    const canonical = buildCheckedState(transformed, candidateOperationId);
    if (Object.keys(canonical.materialized.surveyMarkers).length) check(acceptedSurveyDefinition(semantic));
    const primary = sources.annotation_snapshot !== null || sources.annotation_updates.length > 0;
    const contributors = primary
      ? [...(sources.annotation_snapshot !== null ? ['annotation-snapshot'] : []),
        ...(sources.annotation_updates.length ? ['annotation-wal'] : [])]
      : [...(sources.document_annotations.length ? ['document-annotations'] : []),
        ...(Object.keys(transformed.projection.legacyYjs.annotations).length
          || Object.keys(transformed.projection.legacyYjs.callouts).length ? ['legacy-yjs-annotations'] : [])];
    const baselineSha256 = hash(canonical.baseline);
    const projection = { ...transformed.projection,
      document: copyJson(semantic.document),
      modern: canonical.materialized,
      documentAnnotations: copyJson(sources.document_annotations),
      legacyYjs: copyJson(transformed.projection.legacyYjs),
      surveySessions: copyJson(semantic.sources.survey_sessions),
      surveyItems: copyJson(semantic.sources.survey_items), sidecars: [] };
    const checkpoint = transformed.legacyCheckpoint;
    const legacy = { documentId: checkpoint.documentId, encodingVersion: checkpoint.encodingVersion,
      throughSeq: checkpoint.throughSeq, state_base64: b64(checkpoint.state),
      state_vector_base64: b64(checkpoint.stateVector) };
    const plan = { version: 3, contentModelVersion: 2, aggregateAdmissionVersion: 1,
      operationId: candidateOperationId,
      source: { ...transformed.source, generationId: null, contentModelVersion: 1 },
      operation, projection, baseline_base64: b64(canonical.baseline), legacy };
    check(Buffer.byteLength(JSON.stringify(plan)) <= 64 * 1024 * 1024);
    const candidate = { operationId: candidateOperationId, bytes: pdfBytes,
      contentSha256: hash(pdfBytes), byteLength: String(pdfBytes.byteLength), pageCount };
    const canonicalAnnotations = { version: 1, policy: 'legacy-sql-v1', through_seq: envelope.wal_head,
      baseline_sha256: baselineSha256, contributors };
    freeze(plan); freeze(canonicalAnnotations);
    return Object.freeze({ candidate: Object.freeze(candidate), plan, canonicalAnnotations,
      sidecarEntityPolicy });
  } catch (error) {
    if (error?.code === 'DOCUMENT_FIRST_GENERATION_ADOPTION_INVALID') throw error;
    fail();
  }
}
