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

async function readBody(request, signal, run, track) {
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
    'candidate_operation_id', 'archive_operation_ids']), 'invalid_request');
  check(uuid(value.document_id) && (value.generation_id === null || uuid(value.generation_id))
    && seq(value.wal_head) && uuid(value.source_id) && uuid(value.candidate_operation_id)
    && Array.isArray(value.archive_operation_ids) && value.archive_operation_ids.length === 1
    && uuid(value.archive_operation_ids[0])
    && value.archive_operation_ids[0] !== value.candidate_operation_id, 'invalid_request');
  return Object.freeze({
    documentId: value.document_id,
    generationId: value.generation_id,
    walHead: value.wal_head,
    operation: Object.freeze(operation(value.operation)),
    sourceId: value.source_id,
    candidateOperationId: value.candidate_operation_id,
    archiveOperationIds: Object.freeze([...value.archive_operation_ids]),
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
  };
}

function publication(value, intent) {
  check(exactKeys(value, ['version', 'operation_id', 'document_id', 'actor_user_id', 'source_id',
    'generation_id', 'previous_generation_id', 'plan_sha256', 'wal_head', 'published_at']));
  check(value.version === 1 && value.operation_id === intent.candidateOperationId
    && value.document_id === intent.documentId && value.actor_user_id === intent.actorUserId
    && value.source_id === intent.sourceId && uuid(value.generation_id)
    && value.generation_id !== value.previous_generation_id
    && value.previous_generation_id === intent.generationId && SHA.test(value.plan_sha256)
    && value.wal_head === intent.walHead && typeof value.published_at === 'string'
    && Number.isFinite(Date.parse(value.published_at)));
  return Object.freeze({
    version: 1,
    state: 'published',
    document_id: intent.documentId,
    source_id: intent.sourceId,
    candidate_operation_id: intent.candidateOperationId,
    archive_operation_ids: Object.freeze([...intent.archiveOperationIds]),
    previous_generation_id: intent.generationId,
    generation_id: value.generation_id,
    wal_head: intent.walHead,
    published_at: value.published_at,
  });
}

function planBinding(value, intent) {
  check(exactKeys(value, ['version', 'operationId', 'source', 'operation', 'projection',
    'baseline_base64', 'legacy']) && value.version === 1
    && value.operationId === intent.candidateOperationId && sameJson(value.operation, intent.operation));
  check(exactKeys(value.source, ['documentId', 'generationId', 'walHead', 'sourceObject'])
    && value.source.documentId === intent.documentId && value.source.generationId === intent.generationId
    && value.source.walHead === intent.walHead);
  return value;
}

function journal(value, intent) {
  check(exactKeys(value, ['version', 'state', 'actor_user_id', 'document_id', 'source_id',
    'candidate_operation_id', 'archive_operation_ids', 'expected_generation_id', 'expected_wal_head',
    'prepared_at', 'expires_at', 'plan', 'publication']));
  check(value.version === 1 && ['missing', 'untracked', 'prepared', 'published', 'expired'].includes(value.state));
  if (value.actor_user_id !== intent.actorUserId || value.source_id !== intent.sourceId
    || value.candidate_operation_id !== intent.candidateOperationId
    || !sameJson(value.archive_operation_ids, intent.archiveOperationIds)
    || value.expected_generation_id !== intent.generationId || value.expected_wal_head !== intent.walHead) {
    throw new ConfirmedFailure('replacement_conflict');
  }
  if (value.state === 'missing') check(value.document_id === null && value.plan === null && value.publication === null);
  else check(value.document_id === intent.documentId);
  if (['prepared', 'published', 'expired'].includes(value.state)) {
    check(typeof value.prepared_at === 'string' && Number.isFinite(Date.parse(value.prepared_at))
      && typeof value.expires_at === 'string' && Number.isFinite(Date.parse(value.expires_at)));
  }
  if (value.state === 'prepared') check(Date.parse(value.expires_at) > Date.now()
    && value.publication === null && plain(planBinding(value.plan, intent)));
  if (value.state === 'published') check(value.plan === null && plain(value.publication));
  if (['untracked', 'expired'].includes(value.state)) check(value.plan === null && value.publication === null);
  return value;
}

function expiredTerminal(value, intent) {
  check(value.state === 'expired' && value.document_id === intent.documentId);
  return Object.freeze({
    version: 1,
    state: 'expired',
    actor_user_id: intent.actorUserId,
    document_id: intent.documentId,
    source_id: intent.sourceId,
    candidate_operation_id: intent.candidateOperationId,
    archive_operation_ids: Object.freeze([...intent.archiveOperationIds]),
    expected_generation_id: intent.generationId,
    expected_wal_head: intent.walHead,
    operation: intent.operation,
    prepared_at: value.prepared_at,
    expires_at: value.expires_at,
  });
}

function sourceDescriptor(value, intent) {
  check(exactKeys(value, ['version', 'source_id', 'actor_user_id', 'document_id', 'generation_id',
    'state', 'source_byte_state', 'source_sql_sha256', 'wal_head', 'expires_at', 'source_object',
    'sidecar_objects', 'visible_capture']));
  check(value.version === 1 && value.source_id === intent.sourceId && value.actor_user_id === intent.actorUserId
    && value.document_id === intent.documentId && value.generation_id === intent.generationId
    && value.wal_head === intent.walHead && value.state === 'captured'
    && value.source_byte_state === 'unverified' && SHA.test(value.source_sql_sha256)
    && typeof value.expires_at === 'string' && Date.parse(value.expires_at) > Date.now()
    && plain(value.source_object) && Array.isArray(value.sidecar_objects));
  check(value.sidecar_objects.length === 0, 'unsupported_source');
  return value;
}

function attestation(value, intent, source) {
  check(exactKeys(value, ['version', 'source_id', 'actor_user_id', 'document_id', 'generation_id',
    'source_sql_sha256', 'expires_at', 'state', 'verified_at', 'objects']));
  check(value.version === 1 && value.state === 'verified' && value.source_id === intent.sourceId
    && value.actor_user_id === intent.actorUserId && value.document_id === intent.documentId
    && value.generation_id === intent.generationId && value.source_sql_sha256 === source.source_sql_sha256
    && Array.isArray(value.objects) && value.objects.length === 1 && plain(value.objects[0]));
  const object = value.objects[0];
  check(exactKeys(object, ['kind', 'bucket_id', 'path', 'id', 'version', 'byte_length', 'content_sha256'])
    && object.kind === 'pdf' && object.bucket_id === 'documents' && uuid(object.id) && uuid(object.version)
    && typeof object.path === 'string' && object.path.length > 0 && seq(object.byte_length)
    && BigInt(object.byte_length) > 0n && BigInt(object.byte_length) <= BigInt(MAX_SOURCE_BYTES)
    && SHA.test(object.content_sha256)
    && ['bucket_id', 'path', 'id', 'version', 'byte_length'].every(key => source.source_object[key] === object[key]));
  return object;
}

function envelope(value, intent, object) {
  const captured = captureReplacementJson(value, { maxBytes: MAX_PRIVATE_JSON_BYTES }).value;
  check(exactKeys(captured, ['version', 'source_id', 'actor_user_id', 'document_id', 'generation_id',
    'source_sql_sha256', 'body_sha256', 'wal_head', 'expires_at', 'source_bytes', 'payload']));
  check(captured.version === 1 && captured.source_id === intent.sourceId
    && captured.actor_user_id === intent.actorUserId && captured.document_id === intent.documentId
    && captured.generation_id === intent.generationId && captured.wal_head === intent.walHead
    && captured.source_bytes?.state === 'verified' && captured.source_bytes?.objects?.length === 1
    && ['id', 'version', 'byte_length', 'content_sha256'].every(key => captured.source_bytes.objects[0][key] === object[key]));
  return captured;
}

function uploadReceipt(value, intent, operationId, kind, object) {
  check(plain(value) && value.operation_id === operationId && value.actor_user_id === intent.actorUserId
    && value.document_id === intent.documentId && value.source_id === intent.sourceId
    && value.expected_source_generation_id === intent.generationId
    && ['reserved', 'verified'].includes(value.state));
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
    'putSignedUpload', 'executor', 'timeoutMs', 'maxConcurrent'].includes(key)),
  'DOCUMENT_REPLACEMENT_REQUEST_INPUT');
  const { enabled = false, getUser, serviceClients, privateRpc, putSignedUpload, executor,
    timeoutMs = 300000, maxConcurrent = 1 } = options;
  check(typeof enabled === 'boolean' && typeof getUser === 'function' && plain(serviceClients)
    && plain(serviceClients.source) && plain(serviceClients.sourceBytes) && plain(serviceClients.upload)
    && typeof privateRpc === 'function' && typeof putSignedUpload === 'function'
    && plain(executor) && typeof executor.prepare === 'function'
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= TIMER_LIMIT
    && Number.isSafeInteger(maxConcurrent) && maxConcurrent >= 1 && maxConcurrent <= 16,
  'DOCUMENT_REPLACEMENT_REQUEST_INPUT');
  const functions = (value, keys) => keys.every(key => typeof value[key] === 'function');
  check(functions(serviceClients.source, ['begin', 'get', 'cancel'])
    && functions(serviceClients.sourceBytes, ['get', 'claim', 'openStream', 'record', 'release'])
    && functions(serviceClients.upload, ['beginV2', 'beginArchive', 'get', 'mint', 'claim',
      'openStream', 'record', 'release', 'reject']), 'DOCUMENT_REPLACEMENT_REQUEST_INPUT');

  const active = new Set();
  const release = job => {
    if (job.returned && job.pending.size === 0) {
      if (job.sourceCapture?.bytes instanceof Uint8Array) job.sourceCapture.bytes.fill(0);
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
      intent = await readBody(request, controller.signal, call, operationToRun => job.track(operationToRun));
      const actor = (await call(() => getUser(token, controller.signal)))?.id;
      check(uuid(actor), 'unauthorized');
      intent = Object.freeze({ ...intent, actorUserId: actor });
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
      const publish = async privatePlan => publication(await rpc('publish_document_generation', {
        p_actor: actor,
        p_source: intent.sourceId,
        p_candidate: intent.candidateOperationId,
        p_archives: [...intent.archiveOperationIds],
        p_plan: privatePlan,
      }, true), intent);

      const first = journal(await rpc('read_document_generation_replacement', rpcParams(intent)), intent);
      if (first.state === 'published') return response(200, { replacement: publication(first.publication, intent) });
      if (first.state === 'prepared') return response(200, { replacement: await publish(planBinding(first.plan, intent)) });
      if (first.state === 'expired') {
        return errorResponse('replacement_expired', intent, expiredTerminal(first, intent));
      }
      if (first.state === 'untracked') {
        throw new ConfirmedFailure('replacement_conflict');
      }

      const sourceResult = await invoke(handleDocumentGenerationSource, {
        action: 'begin',
        source_id: intent.sourceId,
        document_id: intent.documentId,
        generation_id: intent.generationId,
      }, serviceClients.source, true);
      const source = sourceDescriptor(sourceResult?.source, intent);
      let captured = null;
      const sourceBytesDeps = {
        ...serviceClients.sourceBytes,
        async openStream(descriptor, signal) {
          check(captured === null && descriptor?.kind === 'pdf' && seq(descriptor.byte_length)
            && BigInt(descriptor.byte_length) > 0n
            && BigInt(descriptor.byte_length) <= BigInt(MAX_SOURCE_BYTES));
          const length = Number(descriptor.byte_length);
          captured = { bytes: new Uint8Array(length), offset: 0, descriptor };
          job.sourceCapture = captured;
          try {
            const stream = await job.track(() => serviceClients.sourceBytes.openStream(descriptor, signal));
            return trackedReadable(stream, job, captured);
          } catch (error) {
            wipe(captured.bytes);
            captured = null;
            job.sourceCapture = null;
            throw error;
          }
        },
      };
      const verifiedResult = await invoke(handleDocumentGenerationSourceBytes,
        { action: 'verify', source_id: intent.sourceId }, sourceBytesDeps, true);
      const sourceObject = attestation(verifiedResult?.attestation, intent, source);
      if (captured === null) {
        const length = Number(sourceObject.byte_length);
        captured = { bytes: new Uint8Array(length), offset: 0, descriptor: sourceObject };
        job.sourceCapture = captured;
        try {
          const original = await call(() => serviceClients.sourceBytes.openStream(sourceObject, controller.signal));
          const proof = await call(() => hashGenerationUploadStream(
            trackedReadable(original, job, captured), { byteLength: sourceObject.byte_length, signal: controller.signal }));
          check(proof.byteLength === sourceObject.byte_length && proof.contentSha256 === sourceObject.content_sha256);
        } catch (error) {
          wipe(captured.bytes);
          captured = null;
          job.sourceCapture = null;
          throw error;
        }
      }
      check(captured.offset === captured.bytes.length && captured.descriptor.id === sourceObject.id
        && captured.descriptor.version === sourceObject.version);
      const trustedEnvelope = envelope(await rpc('read_document_generation_transform_source', {
        p_actor_user_id: actor,
        p_source_id: intent.sourceId,
      }), intent, sourceObject);

      const uploadStreamDeps = {
        ...serviceClients.upload,
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
        let receipt = uploadReceipt(begun?.operation, intent, body.operation_id, kind, expectedObject);
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
          receipt = uploadReceipt(checked?.operation, intent, body.operation_id, kind, expectedObject);
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
        // The concrete executor owns this input synchronously before its first
        // await. Request admission keeps the capture live until its actual
        // promise settles, including after an early abort response.
        objects: [{ id: sourceObject.id, version: sourceObject.version, bytes: captured.bytes }],
      }, { signal: controller.signal }));
      prepared = await wait(executorWork);
      check(exactKeys(prepared, ['candidate', 'plan']) && plain(prepared.candidate)
        && prepared.candidate.bytes instanceof Uint8Array && SHA.test(prepared.candidate.contentSha256)
        && seq(prepared.candidate.byteLength) && prepared.candidate.bytes.byteLength === Number(prepared.candidate.byteLength));
      planBinding(prepared.plan, intent);
      let sourceBlob = new Blob([captured.bytes], { type: 'application/pdf' });
      wipe(captured.bytes);
      captured = null;
      job.sourceCapture = null;
      await stage({
        action: 'begin-archive',
        operation_id: intent.archiveOperationIds[0],
        source_id: intent.sourceId,
        source_object_id: sourceObject.id,
      }, sourceBlob, 'archive', sourceObject);
      sourceBlob = null;
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

      const committed = journal(await rpc('prepare_document_generation_replacement', {
        ...rpcParams(intent),
        p_plan: prepared.plan,
      }, true), intent);
      if (committed.state === 'published') return response(200, { replacement: publication(committed.publication, intent) });
      check(committed.state === 'prepared' && sameJson(committed.plan, prepared.plan));
      return response(200, { replacement: await publish(planBinding(committed.plan, intent)) });
    } catch (error) {
      if (error instanceof ConfirmedFailure) {
        if (['capture_pending', 'verification_pending', 'upload_unconfirmed'].includes(error.code)) {
          return errorResponse('replacement_unconfirmed', intent);
        }
        if (['replacement_conflict', 'untracked', 'expired', 'source_unavailable', 'byte_mismatch', 'canceled', '23505', '23514',
          '40001', '55P03', 'SG001', 'SG002', '42501'].includes(error.code)) {
          return errorResponse('replacement_conflict');
        }
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
