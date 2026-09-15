// SERVER PRIVATE. Node-host composition for the disabled page-replacement route.
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createDocumentReplacementExecutor } from './documentReplacementExecutor.js';
import { captureReplacementJson } from './documentReplacementInput.js';
import { createDocumentReplacementRequestHandler } from './documentReplacementRequest.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BODY_LIMIT = 16 * 1024;
const RESPONSE_LIMIT = 16 * 1024;
const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const uuid = value => typeof value === 'string' && UUID.test(value);
const response = (status, code, message) => new Response(JSON.stringify({ error: { code, message } }), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const unavailable = () => response(503, 'unavailable', 'Checked document replacement is not enabled.');
const invalid = () => response(400, 'invalid_request', 'Invalid document replacement request.');
const busy = () => response(503, 'replacement_busy', 'The checked document replacement worker is busy.');

function captureBody(body) {
  let parsed;
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (raw.byteLength > BODY_LIMIT) throw new Error('body');
    parsed = JSON.parse(raw.toString('utf8'));
  } else parsed = body;
  const captured = captureReplacementJson(parsed, { maxBytes: BODY_LIMIT }).value;
  const json = JSON.stringify(captured);
  if (Buffer.byteLength(json) > BODY_LIMIT) throw new Error('body');
  return { captured, json };
}

function clientFactory(createClient, fetchImpl, url, key, signal, token = null) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => fetchImpl(input, { ...init, signal }) } });
}

export function createDocumentReplacementServiceAdapters({ url, anonKey, serviceKey,
  createClient = createSupabaseClient, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (![url, anonKey, serviceKey].every(value => typeof value === 'string' && value.length > 0)
    || typeof createClient !== 'function' || typeof fetchImpl !== 'function')
    throw new Error('Invalid document replacement server configuration.');
  const caller = (token, signal) => clientFactory(createClient, fetchImpl, url, anonKey, signal, token);
  const admin = signal => clientFactory(createClient, fetchImpl, url, serviceKey, signal);
  const rpcResult = (connection, name, params) => connection.rpc(name, params);
  const rpcData = async (connection, name, params) => {
    const { data, error } = await rpcResult(connection, name, params);
    if (error) throw error;
    return data;
  };
  const sourceRpc = (name, actor, sourceId, signal, extra = {}) => rpcData(admin(signal), name,
    { p_actor_user_id: actor, p_source_id: sourceId, ...extra });
  const uploadRpc = (connection, name, params) => rpcData(connection, name, params);
  const openStream = async (path, signal) => {
    if (typeof path !== 'string' || path.length < 1 || path.length > 2048
      || path.split('/').some(segment => !segment || segment === '.' || segment === '..'))
      throw new Error('Invalid document storage path.');
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const target = new URL(`/storage/v1/object/authenticated/documents/${encoded}`, url);
    const result = await fetchImpl(target, { method: 'GET', redirect: 'error', cache: 'no-store', signal,
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Cache-Control': 'no-cache' } });
    if (!result.ok || !(result.body instanceof ReadableStream)) {
      try { void result.body?.cancel().catch(() => {}); } catch { /* failed responses own no usable bytes */ }
      throw new Error('Invalid document storage response.');
    }
    return result.body;
  };
  const privateNames = Object.freeze({
    read_document_generation_replacement_v5: 'read_document_generation_replacement_service_v5',
    prepare_document_generation_replacement_v5: 'prepare_document_generation_replacement_service_v5',
    publish_document_generation_v5: 'publish_document_generation_service_v5',
    read_document_generation_transform_source_v2: 'read_document_generation_transform_source_service_v2',
  });
  const mapPrivateParams = (name, value) => {
    if (!plain(value)) throw new Error('Invalid private RPC request.');
    if (name === 'read_document_generation_transform_source_v2') return {
      p_actor_user_id: value.p_actor_user_id, p_source_id: value.p_source_id,
      p_content_model_version: value.p_content_model_version,
    };
    const base = {
      p_actor_user_id: value.p_actor, p_source_id: value.p_source,
      p_candidate_operation_id: value.p_candidate, p_archive_operation_ids: value.p_archives,
      ...(name === 'read_document_generation_replacement_v5' ? { p_document_id: value.p_document } : {}),
      ...(name !== 'publish_document_generation_v5' ? {
        p_expected_generation_id: value.p_expected_generation,
        p_expected_wal_head: value.p_expected_wal_head, p_operation: value.p_operation,
      } : {}),
      ...(name !== 'read_document_generation_replacement_v5' ? { p_plan: value.p_plan } : {}),
      p_expected_definition_revision: value.p_expected_definition_revision,
      p_expected_definition_digest: value.p_expected_definition_digest,
    };
    return base;
  };
  const getUser = async (token, signal) => {
    const { data, error } = await caller(token, signal).auth.getUser(token);
    return error ? null : data?.user ?? null;
  };
  const resolveSourceContentModelVersion = async (input, signal) => {
    if (!plain(input)) throw new Error('Invalid source model request.');
    const data = await rpcData(admin(signal),
      'resolve_document_generation_replacement_source_model_service_v1', {
        p_actor_user_id: input.actorUserId, p_document_id: input.documentId,
        p_source_id: input.sourceId, p_candidate_operation_id: input.candidateOperationId,
        p_expected_generation_id: input.expectedGenerationId,
      });
    if (![1, 2].includes(data)) throw new Error('Invalid source model receipt.');
    return data;
  };
  const serviceClients = {
    source: {
      begin: (actor, input, signal) => sourceRpc('begin_document_generation_source', actor, input.source_id,
        signal, { p_document_id: input.document_id, p_generation_id: input.generation_id }),
      get: (actor, input, signal) => sourceRpc('get_document_generation_source', actor, input.source_id, signal),
      cancel: (actor, input, signal) => sourceRpc('cancel_document_generation_source', actor, input.source_id, signal),
      beginV2: (actor, input, model, signal) => sourceRpc('begin_document_generation_source_v2', actor,
        input.source_id, signal, { p_document_id: input.document_id, p_generation_id: input.generation_id,
          p_content_model_version: model }),
      getV2: (actor, input, model, signal) => sourceRpc('get_document_generation_source_v2', actor,
        input.source_id, signal, { p_content_model_version: model }),
    },
    sourceBytes: {
      get: (actor, sourceId, signal) => sourceRpc('get_document_generation_source_bytes', actor, sourceId, signal),
      claim: (actor, sourceId, claimId, signal) => sourceRpc('claim_document_generation_source_bytes', actor,
        sourceId, signal, { p_claim_id: claimId }),
      record: (actor, sourceId, claimId, objects, signal) => sourceRpc('record_document_generation_source_bytes',
        actor, sourceId, signal, { p_claim_id: claimId, p_objects: objects }),
      release: (actor, sourceId, claimId, signal) => sourceRpc('release_document_generation_source_bytes', actor,
        sourceId, signal, { p_claim_id: claimId }),
      getV2: (actor, sourceId, model, signal) => sourceRpc('get_document_generation_source_bytes_service_v2', actor,
        sourceId, signal, { p_content_model_version: model }),
      claimV2: (actor, sourceId, claimId, model, signal) => sourceRpc('claim_document_generation_source_bytes_v2',
        actor, sourceId, signal, { p_claim_id: claimId, p_content_model_version: model }),
      recordV2: (actor, sourceId, claimId, objects, model, signal) => sourceRpc(
        'record_document_generation_source_bytes_v2', actor, sourceId, signal,
        { p_claim_id: claimId, p_objects: objects, p_content_model_version: model }),
      openStream: (object, signal) => openStream(object.path, signal),
    },
    upload: {
      beginV2: (token, input, signal) => uploadRpc(caller(token, signal), 'begin_document_generation_upload_v2', {
        p_source_id: input.source_id, p_operation_id: input.operation_id, p_purpose: input.purpose,
        p_content_sha256: input.content_sha256, p_byte_length: input.byte_length }),
      beginV3: (token, input, model, signal) => uploadRpc(caller(token, signal), 'begin_document_generation_upload_v3', {
        p_source_id: input.source_id, p_operation_id: input.operation_id, p_purpose: input.purpose,
        p_content_sha256: input.content_sha256, p_byte_length: input.byte_length,
        p_content_model_version: model }),
      beginArchive: (token, input, signal) => uploadRpc(caller(token, signal),
        'begin_document_generation_source_archive', { p_source_id: input.source_id,
          p_operation_id: input.operation_id, p_source_object_id: input.source_object_id }),
      beginArchiveV2: (token, input, model, signal) => uploadRpc(caller(token, signal),
        'begin_document_generation_source_archive_v2', { p_source_id: input.source_id,
          p_operation_id: input.operation_id, p_source_object_id: input.source_object_id,
          p_content_model_version: model }),
      get: (token, operationId, signal) => uploadRpc(caller(token, signal), 'get_document_generation_upload',
        { p_operation_id: operationId }),
      mint: async (path, signal) => {
        const { data, error } = await admin(signal).storage.from('documents')
          .createSignedUploadUrl(path, { upsert: false });
        if (error) throw error;
        return data;
      },
      claim: (actor, operationId, claimId, signal) => uploadRpc(admin(signal),
        'claim_document_generation_upload_verification', { p_actor_user_id: actor,
          p_operation_id: operationId, p_claim_id: claimId }),
      openStream,
      record: (actor, operationId, claimId, objectId, objectVersion, contentSha256, byteLength, signal) =>
        uploadRpc(admin(signal), 'record_document_generation_upload_verification', {
          p_actor_user_id: actor, p_operation_id: operationId, p_claim_id: claimId,
          p_object_id: objectId, p_object_version: objectVersion,
          p_content_sha256: contentSha256, p_byte_length: byteLength }),
      release: (actor, operationId, claimId, signal) => uploadRpc(admin(signal),
        'release_document_generation_upload_verification', { p_actor_user_id: actor,
          p_operation_id: operationId, p_claim_id: claimId }),
      reject: (actor, operationId, claimId, objectId, objectVersion, contentSha256, byteLength, signal) =>
        uploadRpc(admin(signal), 'reject_document_generation_upload_verification', {
          p_actor_user_id: actor, p_operation_id: operationId, p_claim_id: claimId,
          p_object_id: objectId, p_object_version: objectVersion,
          p_content_sha256: contentSha256, p_byte_length: byteLength }),
    },
  };
  return Object.freeze({ getUser, resolveSourceContentModelVersion,
    privateRpc: (name, params, { signal }) => {
      const publicName = privateNames[name];
      if (!publicName) return Promise.reject(new Error('Private RPC is not exposed.'));
      return rpcResult(admin(signal), publicName, mapPrivateParams(name, params));
    },
    putSignedUpload: async (upload, blob, { signal }) => {
      const { data, error } = await admin(signal).storage.from('documents')
        .uploadToSignedUrl(upload.path, upload.token, blob, { upsert: false });
      if (error) throw error;
      return data;
    },
    serviceClients: Object.freeze(serviceClients) });
}

export function createDocumentReplacementNodeServer({ enabled = false, adapters,
  createAdapters, executor, timeoutMs = 120000 } = {}) {
  let active = false, closed = false, ownedExecutor = null, resolvedAdapters = adapters ?? null;
  const getAdapters = () => {
    if (!resolvedAdapters) resolvedAdapters = createAdapters();
    return resolvedAdapters;
  };
  const getExecutor = () => {
    if (!ownedExecutor) ownedExecutor = executor ?? createDocumentReplacementExecutor({
      maxConcurrent: 1, maxQueued: 0, timeoutMs });
    return ownedExecutor;
  };
  const handlerFor = (model, token, actor, service) => createDocumentReplacementRequestHandler({ enabled: true,
    getUser: async received => received === token ? { id: actor } : null,
    serviceClients: service.serviceClients, privateRpc: service.privateRpc,
    putSignedUpload: service.putSignedUpload, executor: getExecutor(), timeoutMs,
    maxConcurrent: 1, aggregateAdmissionVersion: 1, sourceContentModelVersion: model,
    legacySidecarArchiveVersion: 1, definitionBindingVersion: 1 });
  return Object.freeze({
    async handle({ authorization, body, signal } = {}) {
      if (!enabled || closed) return unavailable();
      if (active) return busy();
      active = true;
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timer = setTimeout(abort, timeoutMs);
      const bounded = promise => new Promise((resolve, reject) => {
        if (controller.signal.aborted) { reject(new Error('aborted')); return; }
        const onAbort = () => reject(new Error('aborted'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then(resolve, reject)
          .finally(() => controller.signal.removeEventListener('abort', onAbort));
      });
      try {
        if (!(signal instanceof AbortSignal)) return invalid();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        if (controller.signal.aborted) return response(502, 'replacement_failed',
          'The document replacement could not be completed.');
        const token = typeof authorization === 'string'
          ? authorization.match(/^Bearer ([^\s]+)$/i)?.[1] : null;
        if (!token || token.length > 16384) return response(401, 'unauthorized',
          'Sign in again before changing this document.');
        let captured;
        try { captured = captureBody(body); } catch { return invalid(); }
        const value = captured.captured, service = getAdapters();
        const user = await bounded(service.getUser(token, controller.signal));
        if (!uuid(user?.id)) return response(401, 'unauthorized',
          'Sign in again before changing this document.');
        if (![value.document_id, value.source_id, value.candidate_operation_id,
          value.generation_id].every(uuid)) return invalid();
        const model = await bounded(service.resolveSourceContentModelVersion({ actorUserId: user.id,
          documentId: value.document_id, sourceId: value.source_id,
          candidateOperationId: value.candidate_operation_id,
          expectedGenerationId: value.generation_id }, controller.signal));
        if (![1, 2].includes(model)) return invalid();
        if (controller.signal.aborted) throw new Error('aborted');
        const request = new Request('https://replacement.invalid/api/document-replacement', {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: captured.json, signal: controller.signal });
        const result = await handlerFor(model, token, user.id, service)(request);
        const text = await result.text();
        if (Buffer.byteLength(text) > RESPONSE_LIMIT) return response(502, 'invalid_receipt',
          'The server did not confirm the exact document replacement state.');
        return new Response(text, { status: result.status, headers: result.headers });
      } catch {
        return response(502, 'replacement_failed', 'The document replacement could not be completed.');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', abort);
        active = false;
      }
    },
    async close() {
      closed = true;
      if (ownedExecutor) await ownedExecutor.close();
    },
  });
}
