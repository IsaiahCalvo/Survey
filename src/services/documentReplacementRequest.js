// SERVER PRIVATE. This composes existing checked source, upload, worker,
// journal, and publication modules. It is not mounted by the app or any host.
import { handleDocumentGenerationSource } from '../../supabase/functions/document-generation-source/handler.js';
import { handleDocumentGenerationSourceBytes } from '../../supabase/functions/document-generation-source-bytes/handler.js';
import {
  handleDocumentGenerationUpload,
  hashGenerationUploadStream,
} from '../../supabase/functions/document-generation-upload/handler.js';
import { captureReplacementJson } from './documentReplacementInput.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const SEQ = /^(0|[1-9][0-9]{0,18})$/;
const MAX_SEQ = 9223372036854775807n;
const DEFINITION_REVISION = /^[1-9][0-9]{0,15}$/;
const MAX_DEFINITION_REVISION = 9007199254740991n;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_PRIVATE_JSON_BYTES = 64 * 1024 * 1024;
const MAX_HANDLER_JSON_BYTES = 20 * 1024 * 1024;
const TIMER_LIMIT = 2147483647;
const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

const messages = Object.freeze({
  DOCUMENT_REPLACEMENT_REQUEST_INPUT: 'The document replacement handler configuration is invalid.',
  invalid_request: 'Invalid document replacement request.',
  unauthorized: 'Sign in again before changing this document.',
  unavailable: 'Checked document replacement is not enabled.',
  replacement_busy: 'The checked document replacement worker is busy.',
  replacement_conflict: 'This replacement intent cannot be resumed. Keep the same IDs and inspect its saved state.',
  replacement_expired: 'This replacement request expired before it was published.',
  unsupported_source: 'This document has source files that this replacement path does not support.',
  legacy_entity_adoption_required: "Review and adopt this document's entity list before replacing pages.",
  invalid_receipt: 'The server did not confirm the exact document replacement state.',
  replacement_unconfirmed: 'The replacement result is not confirmed. Retry with the same IDs before making another change.',
  replacement_failed: 'The document replacement could not be completed.',
});

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => plain(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const uuid = value => typeof value === 'string' && UUID.test(value);
const seq = value => typeof value === 'string' && SEQ.test(value) && BigInt(value) <= MAX_SEQ;
const sameJson = (a, b) => {
  const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : plain(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
      : JSON.stringify(value);
  return stable(a) === stable(b);
};
const fail = code => Object.assign(new Error(messages[code]), { code });
const check = (value, code = 'invalid_receipt') => { if (!value) throw fail(code); };
const response = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

class ConfirmedFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function publicIntent(intent) {
  return Object.freeze({
    document_id: intent.documentId,
    source_id: intent.sourceId,
    candidate_operation_id: intent.candidateOperationId,
    archive_operation_ids: Object.freeze([...intent.archiveOperationIds]),
    ...(intent.definitionRevision ? {
      definition_revision: intent.definitionRevision,
      definition_digest: intent.definitionDigest,
    } : {}),
  });
}

function errorResponse(code, intent, terminal = null) {
  const statuses = {
    invalid_request: 400,
    unauthorized: 401,
    unavailable: 503,
    replacement_busy: 503,
    replacement_conflict: 409,
    replacement_expired: 409,
    unsupported_source: 409,
    legacy_entity_adoption_required: 409,
    invalid_receipt: 502,
    replacement_unconfirmed: 503,
    replacement_failed: 502,
  };
  return response(statuses[code], {
    error: { code, message: messages[code] },
    ...(intent && code === 'replacement_unconfirmed' ? { intent: publicIntent(intent) } : {}),
    ...(terminal ? { terminal } : {}),
  });
}

function operation(value) {
  check(plain(value), 'invalid_request');
  const integer = number => Number.isSafeInteger(number) && number > 0;
  const types = {
    move: ['type', 'from', 'to'],
    reorder: ['type', 'from', 'to'],
    insert: ['type', 'afterPage'],
    delete: ['type', 'page'],
    rotate: ['type', 'page', 'delta'],
    copy: ['type', 'source', 'afterPage'],
    duplicate: ['type', 'page'],
  };
  const fields = types[value.type];
  check(fields && exactKeys(value, fields), 'invalid_request');
  for (const field of fields) if (field !== 'type' && field !== 'delta') check(integer(value[field]), 'invalid_request');
  if (value.type === 'rotate') check(Number.isSafeInteger(value.delta) && value.delta % 90 === 0, 'invalid_request');
  check(Buffer.byteLength(JSON.stringify(value)) <= 8192, 'invalid_request');
  return value;
}

async function readBody(request, signal, run, track, { allowTwoArchives = false,
  definitionBinding = false } = {}) {
  const reader = request.body?.getReader();
  check(reader, 'invalid_request');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw fail('replacement_failed');
      const { done, value } = await run(() => reader.read());
      if (done) break;
      size += value.byteLength;
      check(size <= MAX_BODY_BYTES, 'invalid_request');
      chunks.push(value);
    }
  } finally {
    try {
      const canceled = track(() => reader.cancel());
      canceled.then(() => { try { reader.releaseLock(); } catch { /* pending read */ } },
        () => { try { reader.releaseLock(); } catch { /* pending read */ } });
    } catch { /* closed request */ }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail('invalid_request'); }
  check(exactKeys(value, ['document_id', 'generation_id', 'wal_head', 'operation', 'source_id',
    'candidate_operation_id', 'archive_operation_ids',
    ...(definitionBinding ? ['definition_revision', 'definition_digest'] : [])]), 'invalid_request');
  check(uuid(value.document_id) && (value.generation_id === null || uuid(value.generation_id))
    && seq(value.wal_head) && uuid(value.source_id) && uuid(value.candidate_operation_id)
    && Array.isArray(value.archive_operation_ids)
    && (value.archive_operation_ids.length === 1 || (allowTwoArchives && value.archive_operation_ids.length === 2))
    && value.archive_operation_ids.every(uuid)
    && new Set(value.archive_operation_ids).size === value.archive_operation_ids.length
    && !value.archive_operation_ids.includes(value.candidate_operation_id)
    && (!definitionBinding || (typeof value.definition_revision === 'string'
      && DEFINITION_REVISION.test(value.definition_revision)
      && BigInt(value.definition_revision) <= MAX_DEFINITION_REVISION
      && typeof value.definition_digest === 'string'
      && SHA.test(value.definition_digest))), 'invalid_request');
  return Object.freeze({
    documentId: value.document_id,
    generationId: value.generation_id,
    walHead: value.wal_head,
    operation: Object.freeze(operation(value.operation)),
    sourceId: value.source_id,
    candidateOperationId: value.candidate_operation_id,
    archiveOperationIds: Object.freeze([...value.archive_operation_ids]),
    ...(definitionBinding ? { definitionRevision: value.definition_revision,
      definitionDigest: value.definition_digest } : {}),
  });
}

function rpcParams(intent) {
  return {
    p_actor: intent.actorUserId,
    p_source: intent.sourceId,
    p_candidate: intent.candidateOperationId,
    p_archives: [...intent.archiveOperationIds],
    p_expected_generation: intent.generationId,
    p_expected_wal_head: intent.walHead,
    p_operation: intent.operation,
    ...(intent.definitionRevision ? {
      p_expected_definition_revision: intent.definitionRevision,
      p_expected_definition_digest: intent.definitionDigest,
    } : {}),
  };
}

function publication(value, intent, policy = null) {
  const sidecar = policy?.legacySidecarArchiveVersion === 1;
  const definition = policy?.definitionBindingVersion === 1;
  check(exactKeys(value, ['version', ...(policy ? ['content_model_version', 'aggregate_admission_version'] : []),
    ...(sidecar ? ['offered_archive_operation_ids', 'used_archive_operation_ids', 'legacy_sidecar_migration'] : []),
    ...(definition ? ['definition_revision', 'definition_digest'] : []),
    'operation_id', 'document_id', 'actor_user_id', 'source_id',
    'generation_id', 'previous_generation_id', 'plan_sha256', 'wal_head', 'published_at']));
  check(value.version === (definition ? 5 : sidecar ? 4 : policy ? 3 : 1)
    && (!policy || (value.content_model_version === 2 && value.aggregate_admission_version === 1))
    && (!definition || (value.definition_revision === intent.definitionRevision
      && value.definition_digest === intent.definitionDigest))
    && value.operation_id === intent.candidateOperationId
    && value.document_id === intent.documentId && value.actor_user_id === intent.actorUserId
    && value.source_id === intent.sourceId && uuid(value.generation_id)
    && value.generation_id !== value.previous_generation_id
    && value.previous_generation_id === intent.generationId && SHA.test(value.plan_sha256)
    && value.wal_head === intent.walHead && typeof value.published_at === 'string'
    && Number.isFinite(Date.parse(value.published_at)));
  if (sidecar) check(sameJson(value.offered_archive_operation_ids, intent.archiveOperationIds)
    && Array.isArray(value.used_archive_operation_ids) && value.used_archive_operation_ids.length >= 1
    && value.used_archive_operation_ids.length <= intent.archiveOperationIds.length
    && sameJson(value.used_archive_operation_ids,
      intent.archiveOperationIds.slice(0, value.used_archive_operation_ids.length))
    && (value.legacy_sidecar_migration === null
      || (exactKeys(value.legacy_sidecar_migration, ['version', 'state', 'source_generation_id'])
        && value.legacy_sidecar_migration.version === 1 && value.legacy_sidecar_migration.state === 'archived'
        && uuid(value.legacy_sidecar_migration.source_generation_id))));
  return Object.freeze({
    version: definition ? 5 : sidecar ? 4 : policy ? 3 : 1,
    ...(policy ? { content_model_version: 2, aggregate_admission_version: 1 } : {}),
    state: 'published',
    document_id: intent.documentId,
    source_id: intent.sourceId,
    candidate_operation_id: intent.candidateOperationId,
    archive_operation_ids: Object.freeze([...intent.archiveOperationIds]),
    ...(definition ? { definition_revision: intent.definitionRevision,
      definition_digest: intent.definitionDigest } : {}),
    ...(sidecar ? { offered_archive_operation_ids: Object.freeze([...value.offered_archive_operation_ids]),
      used_archive_operation_ids: Object.freeze([...value.used_archive_operation_ids]),
      legacy_sidecar_migration: value.legacy_sidecar_migration === null ? null
        : Object.freeze({ ...value.legacy_sidecar_migration }) } : {}),
    previous_generation_id: intent.generationId,
    generation_id: value.generation_id,
    wal_head: intent.walHead,
    published_at: value.published_at,
  });
}

function planBinding(value, intent, policy = null) {
  const sidecar = policy?.legacySidecarArchiveVersion === 1;
  check(exactKeys(value, ['version', ...(policy ? ['contentModelVersion', 'aggregateAdmissionVersion'] : []),
    ...(sidecar ? ['legacySidecarArchive'] : []),
    'operationId', 'source', 'operation', 'projection',
    'baseline_base64', 'legacy']) && value.version === (sidecar ? 4 : policy ? 3 : 1)
    && (!policy || (value.contentModelVersion === 2 && value.aggregateAdmissionVersion === 1))
    && value.operationId === intent.candidateOperationId && sameJson(value.operation, intent.operation));
  if (sidecar) check(value.legacySidecarArchive === null
    || (exactKeys(value.legacySidecarArchive, ['version', 'sourceObjectId', 'entities'])
      && value.legacySidecarArchive.version === 1 && uuid(value.legacySidecarArchive.sourceObjectId)
      && ['absent', 'accepted-catalog'].includes(value.legacySidecarArchive.entities)));
  check(exactKeys(value.source, ['documentId', 'generationId', ...(policy ? ['contentModelVersion'] : []),
    'walHead', 'sourceObject'])
    && value.source.documentId === intent.documentId && value.source.generationId === intent.generationId
    && value.source.walHead === intent.walHead
    && (!policy || value.source.contentModelVersion === policy.sourceContentModelVersion));
  return value;
}

function journal(value, intent, policy = null) {
  const sidecar = policy?.legacySidecarArchiveVersion === 1;
  const definition = policy?.definitionBindingVersion === 1;
  check(exactKeys(value, ['version', ...(policy ? ['aggregate_admission_version'] : []),
    ...(definition ? ['definition_revision', 'definition_digest'] : []),
    'state', 'actor_user_id', 'document_id', 'source_id',
    'candidate_operation_id', ...(sidecar ? ['offered_archive_operation_ids', 'used_archive_operation_ids'] : ['archive_operation_ids']),
    'expected_generation_id', 'expected_wal_head',
    'prepared_at', 'expires_at', 'plan', 'publication']));
  check(value.version === (definition ? 5 : sidecar ? 4 : policy ? 3 : 1)
    && (!policy || value.aggregate_admission_version === 1)
    && (!definition || (value.definition_revision === intent.definitionRevision
      && value.definition_digest === intent.definitionDigest))
    && ['missing', 'untracked', 'prepared', 'published', 'expired'].includes(value.state));
  if (value.actor_user_id !== intent.actorUserId || value.source_id !== intent.sourceId
    || value.candidate_operation_id !== intent.candidateOperationId
    || !sameJson(sidecar ? value.offered_archive_operation_ids : value.archive_operation_ids, intent.archiveOperationIds)
    || value.expected_generation_id !== intent.generationId || value.expected_wal_head !== intent.walHead) {
    throw new ConfirmedFailure('replacement_conflict');
  }
  if (sidecar) check(value.used_archive_operation_ids === null
    || (Array.isArray(value.used_archive_operation_ids) && value.used_archive_operation_ids.length >= 1
      && value.used_archive_operation_ids.length <= intent.archiveOperationIds.length
      && sameJson(value.used_archive_operation_ids,
        intent.archiveOperationIds.slice(0, value.used_archive_operation_ids.length))));
  if (value.state === 'missing') check(value.document_id === null && value.plan === null && value.publication === null);
  else check(value.document_id === intent.documentId);
  if (['prepared', 'published', 'expired'].includes(value.state)) {
    check(typeof value.prepared_at === 'string' && Number.isFinite(Date.parse(value.prepared_at))
      && typeof value.expires_at === 'string' && Number.isFinite(Date.parse(value.expires_at)));
  }
  if (value.state === 'prepared') check(Date.parse(value.expires_at) > Date.now()
    && value.publication === null && plain(planBinding(value.plan, intent, policy)));
  if (value.state === 'published') check(value.plan === null && plain(value.publication));
  if (['untracked', 'expired'].includes(value.state)) check(value.plan === null && value.publication === null);
  return value;
}

function expiredTerminal(value, intent, policy = null) {
  check(value.state === 'expired' && value.document_id === intent.documentId);
  return Object.freeze({
    version: policy?.definitionBindingVersion === 1 ? 5
      : policy?.legacySidecarArchiveVersion === 1 ? 4 : policy ? 3 : 1,
    ...(policy ? { aggregate_admission_version: 1 } : {}),
    state: 'expired',
    actor_user_id: intent.actorUserId,
    document_id: intent.documentId,
    source_id: intent.sourceId,
    candidate_operation_id: intent.candidateOperationId,
    archive_operation_ids: Object.freeze([...intent.archiveOperationIds]),
    ...(policy?.definitionBindingVersion === 1 ? {
      definition_revision: intent.definitionRevision,
      definition_digest: intent.definitionDigest,
    } : {}),
    ...(policy?.legacySidecarArchiveVersion === 1 ? {
      offered_archive_operation_ids: Object.freeze([...intent.archiveOperationIds]),
      used_archive_operation_ids: value.used_archive_operation_ids === null ? null
        : Object.freeze([...value.used_archive_operation_ids]),
    } : {}),
    expected_generation_id: intent.generationId,
    expected_wal_head: intent.walHead,
    operation: intent.operation,
    prepared_at: value.prepared_at,
    expires_at: value.expires_at,
  });
}

function sourceDescriptor(value, intent, policy = null) {
  check(exactKeys(value, ['version', ...(policy ? ['content_model_version'] : []),
    'source_id', 'actor_user_id', 'document_id', 'generation_id',
    'state', 'source_byte_state', 'source_sql_sha256', 'wal_head', 'expires_at', 'source_object',
    'sidecar_objects', 'visible_capture']));
  check(value.version === (policy ? 2 : 1)
    && (!policy || value.content_model_version === policy.sourceContentModelVersion)
    && value.source_id === intent.sourceId && value.actor_user_id === intent.actorUserId
    && value.document_id === intent.documentId && value.generation_id === intent.generationId
    && value.wal_head === intent.walHead && value.state === 'captured'
    && value.source_byte_state === 'unverified' && SHA.test(value.source_sql_sha256)
    && typeof value.expires_at === 'string' && Date.parse(value.expires_at) > Date.now()
    && plain(value.source_object) && Array.isArray(value.sidecar_objects));
  check(value.sidecar_objects.length <= (policy?.legacySidecarArchiveVersion === 1 ? 1 : 0), 'unsupported_source');
  if (value.sidecar_objects.length) check(intent.generationId !== null);
  return value;
}

function attestation(value, intent, source, policy = null) {
  check(exactKeys(value, ['version', ...(policy ? ['content_model_version'] : []),
    'source_id', 'actor_user_id', 'document_id', 'generation_id',
    'source_sql_sha256', 'expires_at', 'state', 'verified_at', 'objects']));
  check(value.version === (policy ? 2 : 1) && value.state === 'verified'
    && (!policy || value.content_model_version === policy.sourceContentModelVersion)
    && value.source_id === intent.sourceId
    && value.actor_user_id === intent.actorUserId && value.document_id === intent.documentId
    && value.generation_id === intent.generationId && value.source_sql_sha256 === source.source_sql_sha256
    && Array.isArray(value.objects)
    && value.objects.length === 1 + source.sidecar_objects.length
    && value.objects.every(plain));
  const object = value.objects[0];
  check(exactKeys(object, ['kind', 'bucket_id', 'path', 'id', 'version', 'byte_length', 'content_sha256'])
    && object.kind === 'pdf' && object.bucket_id === 'documents' && uuid(object.id) && uuid(object.version)
    && typeof object.path === 'string' && object.path.length > 0 && seq(object.byte_length)
    && BigInt(object.byte_length) > 0n && BigInt(object.byte_length) <= BigInt(MAX_SOURCE_BYTES)
    && SHA.test(object.content_sha256)
    && ['bucket_id', 'path', 'id', 'version', 'byte_length'].every(key => source.source_object[key] === object[key]));
  if (source.sidecar_objects.length === 1) {
    const sidecar = value.objects[1], descriptor = source.sidecar_objects[0];
    check(exactKeys(sidecar, ['kind', 'bucket_id', 'path', 'id', 'version', 'byte_length', 'content_sha256'])
      && sidecar.kind === 'sidecar' && sidecar.bucket_id === 'documents' && uuid(sidecar.id) && uuid(sidecar.version)
      && seq(sidecar.byte_length) && BigInt(sidecar.byte_length) > 0n && BigInt(sidecar.byte_length) <= 16777216n
      && SHA.test(sidecar.content_sha256)
      && ['bucket_id', 'path', 'id', 'version', 'byte_length'].every(key => descriptor[key] === sidecar[key]));
  }
  return value.objects;
}

function envelope(value, intent, objects, policy = null) {
  const captured = captureReplacementJson(value, { maxBytes: MAX_PRIVATE_JSON_BYTES }).value;
  check(exactKeys(captured, ['version', ...(policy ? ['content_model_version'] : []),
    'source_id', 'actor_user_id', 'document_id', 'generation_id',
    'source_sql_sha256', 'body_sha256', 'wal_head', 'expires_at', 'source_bytes', 'payload']));
  check(captured.version === (policy ? 2 : 1)
    && (!policy || (captured.content_model_version === policy.sourceContentModelVersion
      && captured.source_bytes?.content_model_version === policy.sourceContentModelVersion
      && captured.payload?.semantic?.content_model_version === policy.sourceContentModelVersion))
    && captured.source_id === intent.sourceId
    && captured.actor_user_id === intent.actorUserId && captured.document_id === intent.documentId
    && captured.generation_id === intent.generationId && captured.wal_head === intent.walHead
    && captured.source_bytes?.state === 'verified' && captured.source_bytes?.objects?.length === objects.length
    && objects.every((object, index) => ['id', 'version', 'byte_length', 'content_sha256']
      .every(key => captured.source_bytes.objects[index][key] === object[key])));
  return captured;
}

function uploadReceipt(value, intent, operationId, kind, object, policy = null, requireModel = false) {
  check(plain(value) && value.operation_id === operationId && value.actor_user_id === intent.actorUserId
    && value.document_id === intent.documentId && value.source_id === intent.sourceId
    && value.expected_source_generation_id === intent.generationId
    && ['reserved', 'verified'].includes(value.state));
  if (requireModel && policy) check(value.content_model_version === policy.sourceContentModelVersion);
  if (kind === 'candidate') {
    check(value.version === 2 && value.purpose === 'candidate-pdf');
  } else {
    check(value.version === 3 && value.purpose === 'source-object-archive'
      && value.archived_source_object_id === object.id && plain(value.source_object)
      && ['id', 'version', 'byte_length', 'content_sha256'].every(key => value.source_object[key] === object[key]));
  }
  return value;
}

function trackedReadable(stream, job, capture) {
  check(stream instanceof ReadableStream);
  const reader = stream.getReader();
  let done = false;
  const close = async reason => {
    if (done) return;
    done = true;
    try { await job.track(() => reader.cancel(reason)); } catch { /* provider cleanup is best effort */ }
    try { reader.releaseLock(); } catch { /* pending provider read */ }
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        const item = await job.track(() => reader.read());
        if (item.done) {
          done = true;
          try { reader.releaseLock(); } catch { /* complete read */ }
          if (capture) check(capture.offset === capture.bytes.length);
          controller.close();
          return;
        }
        check(item.value instanceof Uint8Array);
        if (capture) {
          check(capture.offset + item.value.byteLength <= capture.bytes.length);
          capture.bytes.set(item.value, capture.offset);
          capture.offset += item.value.byteLength;
        }
        controller.enqueue(item.value);
      } catch (error) {
        await close(error);
        controller.error(error);
      }
    },
    cancel: reason => job.track(() => close(reason)),
  });
}

function makeJob(active, release) {
  const pending = new Set();
  const job = {
    returned: false,
    sourceCapture: null,
    pending,
    track(operation) {
      let promise;
      try { promise = Promise.resolve().then(operation); } catch (error) { promise = Promise.reject(error); }
      pending.add(promise);
      promise.then(() => { pending.delete(promise); release(job); },
        () => { pending.delete(promise); release(job); });
      return promise;
    },
  };
  active.add(job);
  return job;
}

/**
 * Creates one unmounted private Request-to-Response handler. The injected
 * privateRpc adapter must make one committed remote request per call; in
 * particular prepare_document_generation_replacement must commit before its
 * promise resolves and before publish_document_generation starts.
 */
export function createDocumentReplacementRequestHandler(options = {}) {
  check(plain(options), 'DOCUMENT_REPLACEMENT_REQUEST_INPUT');
  check(Object.keys(options).every(key => ['enabled', 'getUser', 'serviceClients', 'privateRpc',
    'putSignedUpload', 'executor', 'timeoutMs', 'maxConcurrent', 'aggregateAdmissionVersion',
    'sourceContentModelVersion', 'legacySidecarArchiveVersion', 'definitionBindingVersion'].includes(key)),
  'DOCUMENT_REPLACEMENT_REQUEST_INPUT');
  const hasAggregatePolicy = Object.hasOwn(options, 'aggregateAdmissionVersion');
  const hasSourceModel = Object.hasOwn(options, 'sourceContentModelVersion');
  const { enabled = false, getUser, serviceClients, privateRpc, putSignedUpload, executor,
    timeoutMs = 300000, maxConcurrent = 1 } = options;
  const aggregateAdmissionVersion = hasAggregatePolicy ? options.aggregateAdmissionVersion : null;
  const sourceContentModelVersion = hasSourceModel ? options.sourceContentModelVersion : null;
  const legacySidecarArchiveVersion = options.legacySidecarArchiveVersion ?? null;
  const definitionBindingVersion = options.definitionBindingVersion ?? null;
  const policy = hasAggregatePolicy ? Object.freeze({ aggregateAdmissionVersion, sourceContentModelVersion,
    ...(legacySidecarArchiveVersion === 1 ? { legacySidecarArchiveVersion: 1 } : {}),
    ...(definitionBindingVersion === 1 ? { definitionBindingVersion: 1 } : {}) }) : null;
  check(typeof enabled === 'boolean' && typeof getUser === 'function' && plain(serviceClients)
    && plain(serviceClients.source) && plain(serviceClients.sourceBytes) && plain(serviceClients.upload)
    && typeof privateRpc === 'function' && typeof putSignedUpload === 'function'
    && plain(executor) && typeof executor.prepare === 'function'
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= TIMER_LIMIT
    && Number.isSafeInteger(maxConcurrent) && maxConcurrent >= 1 && maxConcurrent <= 16,
  'DOCUMENT_REPLACEMENT_REQUEST_INPUT');
  check(hasAggregatePolicy === hasSourceModel && (!hasAggregatePolicy
    || (aggregateAdmissionVersion === 1 && [1, 2].includes(sourceContentModelVersion))),
  'DOCUMENT_REPLACEMENT_REQUEST_INPUT');
  check(legacySidecarArchiveVersion === null || (legacySidecarArchiveVersion === 1 && hasAggregatePolicy),
    'DOCUMENT_REPLACEMENT_REQUEST_INPUT');
  check(definitionBindingVersion === null || (definitionBindingVersion === 1
    && legacySidecarArchiveVersion === 1 && hasAggregatePolicy), 'DOCUMENT_REPLACEMENT_REQUEST_INPUT');
  const functions = (value, keys) => keys.every(key => typeof value[key] === 'function');
  check(functions(serviceClients.source, ['begin', 'get', 'cancel'])
    && functions(serviceClients.sourceBytes, ['get', 'claim', 'openStream', 'record', 'release'])
    && functions(serviceClients.upload, ['beginV2', 'beginArchive', 'get', 'mint', 'claim',
      'openStream', 'record', 'release', 'reject'])
    && (!policy || (functions(serviceClients.source, ['beginV2', 'getV2'])
      && functions(serviceClients.sourceBytes, ['getV2', 'claimV2', 'recordV2'])
      && functions(serviceClients.upload, ['beginV3', 'beginArchiveV2']))),
  'DOCUMENT_REPLACEMENT_REQUEST_INPUT');

  const active = new Set();
  const release = job => {
    if (job.returned && job.pending.size === 0) {
      if (job.sourceCapture?.bytes instanceof Uint8Array) job.sourceCapture.bytes.fill(0);
      if (job.sourceCapture?.captures instanceof Map) for (const capture of job.sourceCapture.captures.values())
        capture.bytes?.fill(0);
      job.sourceCapture = null;
      active.delete(job);
    }
  };

  return async function handleDocumentReplacementRequest(request) {
    if (!(request instanceof Request)) return errorResponse('invalid_request');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return response(405, { error: { code: 'method_not_allowed' } });
    if (!enabled) return errorResponse('unavailable');
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    let intent;
    let job;
    let mutationStarted = false;
    const wipe = value => { if (value instanceof Uint8Array) value.fill(0); };
    try {
      const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
      check(token && token.length <= 16384, 'unauthorized');
      if (active.size >= maxConcurrent) return errorResponse('replacement_busy');
      job = makeJob(active, release);
      const wait = work => {
        if (controller.signal.aborted) return Promise.reject(fail(mutationStarted ? 'replacement_unconfirmed' : 'replacement_failed'));
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(fail(mutationStarted ? 'replacement_unconfirmed' : 'replacement_failed'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          work.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', onAbort));
        });
      };
      const call = operationToRun => wait(job.track(operationToRun));
      intent = await readBody(request, controller.signal, call, operationToRun => job.track(operationToRun), {
        allowTwoArchives: legacySidecarArchiveVersion === 1,
        definitionBinding: definitionBindingVersion === 1,
      });
      const actor = (await call(() => getUser(token, controller.signal)))?.id;
      check(uuid(actor), 'unauthorized');
      intent = Object.freeze({ ...intent, actorUserId: actor });
      check(legacySidecarArchiveVersion !== 1 || intent.generationId !== null, 'invalid_request');
      const actorUser = async received => received === token ? { id: actor } : null;
      const invoke = async (handler, body, deps, mutates = false) => {
        if (mutates) mutationStarted = true;
        const child = new Request('https://replacement.invalid/', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const result = await call(() => handler(child, { ...deps, enabled: true, getUser: actorUser }));
        const text = await call(() => result.text());
        check(Buffer.byteLength(text) <= MAX_HANDLER_JSON_BYTES);
        let parsed;
        try { parsed = JSON.parse(text); } catch { throw fail('invalid_receipt'); }
        if (!result.ok) throw new ConfirmedFailure(parsed?.error?.code ?? 'invalid_receipt');
        return parsed;
      };
      const rpc = async (name, params, mutates = false) => {
        if (mutates) mutationStarted = true;
        const result = await call(() => privateRpc(name, params, { signal: controller.signal }));
        check(plain(result) && Object.hasOwn(result, 'data') && Object.hasOwn(result, 'error'));
        if (result.error) throw new ConfirmedFailure(result.error.code ?? 'invalid_receipt');
        return captureReplacementJson(result.data, { maxBytes: MAX_PRIVATE_JSON_BYTES }).value;
      };
      const readReplacementRpc = policy?.definitionBindingVersion === 1
        ? 'read_document_generation_replacement_v5'
        : policy?.legacySidecarArchiveVersion === 1
        ? 'read_document_generation_replacement_v4'
        : policy ? 'read_document_generation_replacement_v3' : 'read_document_generation_replacement';
      const prepareReplacementRpc = policy?.definitionBindingVersion === 1
        ? 'prepare_document_generation_replacement_v5'
        : policy?.legacySidecarArchiveVersion === 1
        ? 'prepare_document_generation_replacement_v4'
        : policy ? 'prepare_document_generation_replacement_v3' : 'prepare_document_generation_replacement';
      const publishReplacementRpc = policy?.definitionBindingVersion === 1
        ? 'publish_document_generation_v5'
        : policy?.legacySidecarArchiveVersion === 1
        ? 'publish_document_generation_v4'
        : policy ? 'publish_document_generation_v3' : 'publish_document_generation';
      const publish = async privatePlan => publication(await rpc(publishReplacementRpc, {
        p_actor: actor,
        p_source: intent.sourceId,
        p_candidate: intent.candidateOperationId,
        p_archives: [...intent.archiveOperationIds],
        p_plan: privatePlan,
        ...(policy?.definitionBindingVersion === 1 ? {
          p_expected_definition_revision: intent.definitionRevision,
          p_expected_definition_digest: intent.definitionDigest,
        } : {}),
      }, true), intent, policy);

      const first = journal(await rpc(readReplacementRpc, {
        ...rpcParams(intent),
        ...(policy?.definitionBindingVersion === 1 ? { p_document: intent.documentId } : {}),
      }), intent, policy);
      if (first.state === 'published') return response(200, { replacement: publication(first.publication, intent, policy) });
      if (first.state === 'prepared') return response(200, { replacement: await publish(planBinding(first.plan, intent, policy)) });
      if (first.state === 'expired') {
        return errorResponse('replacement_expired', intent, expiredTerminal(first, intent, policy));
      }
      if (first.state === 'untracked') {
        throw new ConfirmedFailure('replacement_conflict');
      }
      check(!policy || intent.generationId !== null || policy.sourceContentModelVersion === 1, 'invalid_request');

      const sourceResult = await invoke(handleDocumentGenerationSource, {
        action: 'begin',
        source_id: intent.sourceId,
        document_id: intent.documentId,
        generation_id: intent.generationId,
      }, { ...serviceClients.source,
        contentModelVersion: policy ? policy.sourceContentModelVersion : null }, true);
      const source = sourceDescriptor(sourceResult?.source, intent, policy);
      const captures = new Map();
      const sourceBytesDeps = {
        ...serviceClients.sourceBytes,
        contentModelVersion: policy ? policy.sourceContentModelVersion : null,
        async openStream(descriptor, signal) {
          check(!captures.has(descriptor?.id) && ['pdf', 'sidecar'].includes(descriptor?.kind)
            && seq(descriptor.byte_length)
            && BigInt(descriptor.byte_length) > 0n
            && BigInt(descriptor.byte_length) <= BigInt(descriptor.kind === 'pdf' ? MAX_SOURCE_BYTES : 16777216));
          const length = Number(descriptor.byte_length);
          const captured = { bytes: new Uint8Array(length), offset: 0, descriptor };
          captures.set(descriptor.id, captured);
          job.sourceCapture = { captures };
          try {
            const stream = await job.track(() => serviceClients.sourceBytes.openStream(descriptor, signal));
            return trackedReadable(stream, job, captured);
          } catch (error) {
            wipe(captured.bytes); captures.delete(descriptor.id);
            throw error;
          }
        },
      };
      const verifiedResult = await invoke(handleDocumentGenerationSourceBytes,
        { action: 'verify', source_id: intent.sourceId }, sourceBytesDeps, true);
      const sourceObjects = attestation(verifiedResult?.attestation, intent, source, policy);
      check(intent.archiveOperationIds.length >= sourceObjects.length, 'invalid_request');
      for (const sourceObject of sourceObjects) if (!captures.has(sourceObject.id)) {
        const length = Number(sourceObject.byte_length), captured = { bytes: new Uint8Array(length), offset: 0, descriptor: sourceObject };
        captures.set(sourceObject.id, captured); job.sourceCapture = { captures };
        try {
          const original = await call(() => serviceClients.sourceBytes.openStream(sourceObject, controller.signal));
          const proof = await call(() => hashGenerationUploadStream(
            trackedReadable(original, job, captured), { byteLength: sourceObject.byte_length, signal: controller.signal }));
          check(proof.byteLength === sourceObject.byte_length && proof.contentSha256 === sourceObject.content_sha256);
        } catch (error) {
          wipe(captured.bytes); captures.delete(sourceObject.id);
          throw error;
        }
      }
      for (const sourceObject of sourceObjects) {
        const captured = captures.get(sourceObject.id);
        check(captured?.offset === captured?.bytes.length && captured.descriptor.version === sourceObject.version);
      }
      const trustedEnvelope = envelope(await rpc(policy
        ? 'read_document_generation_transform_source_v2' : 'read_document_generation_transform_source', {
        p_actor_user_id: actor,
        p_source_id: intent.sourceId,
        ...(policy ? { p_content_model_version: policy.sourceContentModelVersion } : {}),
      }), intent, sourceObjects, policy);

      const uploadStreamDeps = {
        ...serviceClients.upload,
        contentModelVersion: policy ? policy.sourceContentModelVersion : null,
        async openStream(path, signal) {
          const stream = await job.track(() => serviceClients.upload.openStream(path, signal));
          return trackedReadable(stream, job, null);
        },
      };
      const stage = async (body, blob, kind, expectedObject) => {
        const begun = await invoke(handleDocumentGenerationUpload, body, {
          ...uploadStreamDeps,
          sourceBoundEnabled: true,
          archiveEnabled: true,
        }, true);
        let receipt = uploadReceipt(begun?.operation, intent, body.operation_id, kind, expectedObject,
          policy, true);
        if (receipt.state === 'reserved' && receipt.object === null) {
          check(exactKeys(begun.upload, ['path', 'token', 'signedUrl']));
          mutationStarted = true;
          await call(() => putSignedUpload(begun.upload, blob, { signal: controller.signal }));
        }
        if (receipt.state !== 'verified') {
          const checked = await invoke(handleDocumentGenerationUpload,
            { action: 'verify', operation_id: body.operation_id }, {
              ...uploadStreamDeps,
              sourceBoundEnabled: true,
              archiveEnabled: true,
            }, true);
          receipt = uploadReceipt(checked?.operation, intent, body.operation_id, kind, expectedObject,
            policy, false);
        }
        check(receipt.state === 'verified');
        return receipt;
      };

      let prepared;
      const executorWork = job.track(() => executor.prepare({
        actorUserId: actor,
        documentId: intent.documentId,
        sourceId: intent.sourceId,
        operationId: intent.candidateOperationId,
        envelope: trustedEnvelope,
        operation: intent.operation,
        ...(policy ? { targetContentModelVersion: 2, aggregateAdmissionVersion: 1 } : {}),
        ...(policy?.legacySidecarArchiveVersion === 1 ? { legacySidecarArchiveVersion: 1 } : {}),
        // The concrete executor owns this input synchronously before its first
        // await. Request admission keeps the capture live until its actual
        // promise settles, including after an early abort response.
        objects: sourceObjects.map(sourceObject => ({ id: sourceObject.id, version: sourceObject.version,
          bytes: captures.get(sourceObject.id).bytes })),
      }, { signal: controller.signal }));
      prepared = await wait(executorWork);
      check(exactKeys(prepared, ['candidate', 'plan']) && plain(prepared.candidate)
        && prepared.candidate.bytes instanceof Uint8Array && SHA.test(prepared.candidate.contentSha256)
        && seq(prepared.candidate.byteLength) && prepared.candidate.bytes.byteLength === Number(prepared.candidate.byteLength));
      planBinding(prepared.plan, intent, policy);
      for (let index = 0; index < sourceObjects.length; index++) {
        const sourceObject = sourceObjects[index], captured = captures.get(sourceObject.id);
        let sourceBlob = new Blob([captured.bytes], { type: sourceObject.kind === 'pdf' ? 'application/pdf' : 'application/json' });
        wipe(captured.bytes); captures.delete(sourceObject.id);
        await stage({ action: 'begin-archive', operation_id: intent.archiveOperationIds[index],
          source_id: intent.sourceId, source_object_id: sourceObject.id }, sourceBlob, 'archive', sourceObject);
        sourceBlob = null;
      }
      job.sourceCapture = null;
      let candidateBlob = new Blob([prepared.candidate.bytes], { type: 'application/pdf' });
      wipe(prepared.candidate.bytes);
      await stage({
        action: 'begin',
        operation_id: intent.candidateOperationId,
        source_id: intent.sourceId,
        purpose: 'candidate-pdf',
        content_sha256: prepared.candidate.contentSha256,
        byte_length: prepared.candidate.byteLength,
      }, candidateBlob, 'candidate');
      candidateBlob = null;

      const committed = journal(await rpc(prepareReplacementRpc, {
        ...rpcParams(intent),
        p_plan: prepared.plan,
      }, true), intent, policy);
      if (committed.state === 'published') return response(200, { replacement: publication(committed.publication, intent, policy) });
      check(committed.state === 'prepared' && sameJson(committed.plan, prepared.plan));
      return response(200, { replacement: await publish(planBinding(committed.plan, intent, policy)) });
    } catch (error) {
      if (error instanceof ConfirmedFailure) {
        if (['capture_pending', 'verification_pending', 'upload_unconfirmed'].includes(error.code)) {
          return errorResponse('replacement_unconfirmed', intent);
        }
        if (['replacement_conflict', 'untracked', 'expired', 'source_unavailable', 'byte_mismatch', 'canceled', '23505', '23514',
          '40001', '55P03', 'SG001', 'SG002', 'SG003', '42501'].includes(error.code)) {
          return errorResponse('replacement_conflict');
        }
        if (error.code === 'SG004') return errorResponse('legacy_entity_adoption_required');
        if (error.code === 'unsupported_source') return errorResponse('unsupported_source');
        if (error.code === 'unauthorized') return errorResponse('unauthorized');
        if (error.code === 'unavailable') return errorResponse('unavailable');
        return errorResponse(mutationStarted ? 'replacement_unconfirmed' : 'invalid_receipt', intent);
      }
      if (error?.code === 'invalid_request') return errorResponse('invalid_request');
      if (error?.code === 'unauthorized') return errorResponse('unauthorized');
      if (error?.code === 'unsupported_source') return errorResponse('unsupported_source');
      if (error?.code === 'invalid_receipt') {
        return errorResponse(mutationStarted ? 'replacement_unconfirmed' : 'invalid_receipt', intent);
      }
      if (error?.code === 'replacement_failed' && !mutationStarted) return errorResponse('replacement_failed');
      return errorResponse(mutationStarted ? 'replacement_unconfirmed' : 'replacement_failed', intent);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      if (job) {
        job.returned = true;
        release(job);
      }
    }
  };
}
