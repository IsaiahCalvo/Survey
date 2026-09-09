// SERVER PRIVATE. Never import into browser routes or return this plan to users.
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { mutateLoadedPdfPagesWithIdentity } from '../utils/pdfPageMutation.js';
import { transformDocumentGenerationSource } from './documentGenerationTransform.js';
import { copyReplacementJson as copyJson } from './documentReplacementInput.js';

const PDF_LIMIT = 256 * 1024 * 1024, SOURCE_LIMIT = 16 * 1024 * 1024;
const PLAN_LIMIT = 64 * 1024 * 1024, PAGE_LIMIT = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const validId = value => typeof value === 'string' && UUID.test(value);
const validHash = value => typeof value === 'string' && HASH.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, fields) => object(value) && Object.keys(value).sort().join(',') === fields.split(',').sort().join(',');
const fail = () => { throw new Error('The complete document replacement could not be prepared.'); };
const check = value => { if (!value) fail(); };
const seq = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const b64 = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}

/** Pure, bounded worker preparation, NOT authority or a publication receipt.
 * envelope MUST come directly from the trusted transform-source RPC, never a
 * browser. That SQL RPC verifies Postgres-jsonb digests; JSON.stringify cannot
 * reproduce that format. Here matching receipts bind those digests and the
 * exact current verified PDF bytes, not the document's original-import hash.
 * Copies all input before the first await. Limits: source JSON 16 MiB/depth64,
 * source/candidate PDF 256 MiB, 10000 pages, plan64 MiB/checkpoint bytes16 MiB.
 * Parsing happens locally; these bounds are not a CPU/memory sandbox for PDFs.
 * SQL publication must recheck source/frontier/access atomically. Retain this
 * exact plan, bytes and operationId for uncertain publication; do not regenerate
 * a plan or invent a new operation to recover a lost success response.
 */
export async function prepareDocumentGenerationReplacement(input) {
  try {
    check(object(input));
    const { actorUserId, documentId, sourceId, operationId } = input;
    check([actorUserId, documentId, sourceId, operationId].every(validId));
    const envelope = copyJson(input.envelope), operation = copyJson(input.operation);
    check(keys(envelope, 'version,source_id,actor_user_id,document_id,generation_id,source_sql_sha256,body_sha256,wal_head,expires_at,source_bytes,payload'));
    check(envelope.version === 1 && envelope.actor_user_id === actorUserId && envelope.document_id === documentId
      && envelope.source_id === sourceId && (envelope.generation_id === null || validId(envelope.generation_id))
      && validHash(envelope.source_sql_sha256) && validHash(envelope.body_sha256) && seq(envelope.wal_head));
    check(typeof envelope.expires_at === 'string');
    const expiry = Date.parse(envelope.expires_at), started = performance.now(), life = expiry - Date.now();
    const unexpired = () => check(Number.isFinite(expiry) && life > 0 && Date.now() < expiry && performance.now() - started < life);
    unexpired();
    const proof = envelope.source_bytes, payload = envelope.payload, semantic = payload?.semantic;
    check(keys(proof, 'version,source_id,actor_user_id,document_id,generation_id,source_sql_sha256,expires_at,state,objects,verified_at'));
    check(proof.version === 1 && proof.state === 'verified'
      && ['source_id','actor_user_id','document_id','generation_id','source_sql_sha256','expires_at'].every(key => proof[key] === envelope[key])
      && typeof proof.verified_at === 'string' && Number.isFinite(Date.parse(proof.verified_at)) && Date.parse(proof.verified_at) < expiry);
    check(object(semantic) && semantic.version === 1 && semantic.document_id === documentId
      && semantic.generation_id === envelope.generation_id && semantic.wal_head === envelope.wal_head
      && semantic.document?.id === documentId && validId(semantic.document.user_id));
    check(Array.isArray(semantic.sidecar_objects) && semantic.sidecar_objects.length === 0
      && keys(semantic.document.annotations, ''));
    check(Array.isArray(proof.objects) && proof.objects.length === 1);
    const descriptor = semantic.source_object, attested = proof.objects[0];
    check(keys(descriptor, 'bucket_id,path,id,version,byte_length')
      && keys(attested, 'bucket_id,path,id,version,byte_length,kind,content_sha256'));
    check(descriptor.bucket_id === 'documents' && validId(descriptor.id) && validId(descriptor.version)
      && typeof descriptor.path === 'string' && descriptor.path.length > 0 && descriptor.path.length <= 2048
      && !/[\u0000-\u001f\u007f]/.test(descriptor.path)
      && seq(descriptor.byte_length) && BigInt(descriptor.byte_length) > 0n && BigInt(descriptor.byte_length) <= BigInt(PDF_LIMIT)
      && Object.keys(descriptor).every(key => descriptor[key] === attested[key])
      && attested.kind === 'pdf' && validHash(attested.content_sha256));
    const objects = input.objects;
    check(Array.isArray(objects) && objects.length === 1);
    const supplied = objects[0];
    check(keys(supplied, 'id,version,bytes') && supplied.id === descriptor.id && supplied.version === descriptor.version);
    const bytes = supplied.bytes;
    check(bytes instanceof Uint8Array);
    const proto = Object.getPrototypeOf(Uint8Array.prototype);
    const length = Object.getOwnPropertyDescriptor(proto, 'byteLength').get.call(bytes);
    const buffer = Object.getOwnPropertyDescriptor(proto, 'buffer').get.call(bytes);
    check(buffer instanceof ArrayBuffer && length === Number(descriptor.byte_length) && length <= PDF_LIMIT);
    const owned = new Uint8Array(length); Uint8Array.prototype.set.call(owned, bytes);
    check(hash(owned) === attested.content_sha256);
    check(object(operation) && ['move','reorder','insert','delete','rotate','copy','duplicate'].includes(operation.type));
    check(Buffer.byteLength(JSON.stringify(payload)) <= SOURCE_LIMIT);
    unexpired();
    const pdf = await PDFDocument.load(owned); unexpired();
    const pageCount = pdf.getPageCount();
    check(pageCount > 0 && pageCount <= PAGE_LIMIT);
    const expectedCount = pageCount + (['insert','copy','duplicate'].includes(operation.type) ? 1 : operation.type === 'delete' ? -1 : 0);
    check(expectedCount > 0 && expectedCount <= PAGE_LIMIT);
    const pageSizes = pdf.getPages().map(page => page.getSize());
    check(pageSizes.every(size => Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0));
    const mutation = await mutateLoadedPdfPagesWithIdentity(pdf, operation); unexpired();
    check(mutation.bytes.byteLength > 0 && mutation.bytes.byteLength <= PDF_LIMIT);
    const transformed = await transformDocumentGenerationSource({ sourcePayload: payload, sidecars: [], operationId,
      operation, pageCount, pageSizes, copiedWidgets: mutation.copiedWidgets });
    unexpired();
    const c = transformed.legacyCheckpoint;
    check(transformed.baselineUpdate.byteLength + c.state.byteLength + c.stateVector.byteLength <= SOURCE_LIMIT);
    const plan = { version: 1, operationId: transformed.operationId, source: transformed.source,
      operation: transformed.operation, projection: transformed.projection, baseline_base64: b64(transformed.baselineUpdate),
      legacy: { documentId: c.documentId, encodingVersion: c.encodingVersion, throughSeq: c.throughSeq,
        state_base64: b64(c.state), state_vector_base64: b64(c.stateVector) } };
    check(Buffer.byteLength(JSON.stringify(plan)) <= PLAN_LIMIT);
    const candidate = { bytes: mutation.bytes, contentSha256: hash(mutation.bytes),
      byteLength: String(mutation.bytes.byteLength), pageCount: expectedCount };
    freeze(plan); unexpired();
    return Object.freeze({ candidate: Object.freeze(candidate), plan });
  } catch {
    throw Object.assign(new Error('The complete document replacement could not be prepared.'),
      { code: 'DOCUMENT_GENERATION_REPLACEMENT_INVALID' });
  }
}
