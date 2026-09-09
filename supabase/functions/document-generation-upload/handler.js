import { createHash } from 'node:crypto';

export const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const fail = (code) => Object.assign(new Error(code), { code });
const requireValue = (value, code = 'invalid_request') => { if (!value) throw fail(code); };
const uuid = value => typeof value === 'string' && UUID.test(value);
const size = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n;
const live = signal => { if (signal?.aborted) throw fail('verification_pending'); };

// A dependency can ignore AbortSignal. Bound the caller's wait too, and check
// before starting every later phase so a late result cannot authorize a write.
function call(operation, signal) {
  live(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(fail('verification_pending'));
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { live(signal); return operation(); }).then(
      value => { live(signal); return value; },
    ).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
  });
}

/** Complete, streaming byte proof. No Blob/arrayBuffer, payload aggregation,
 * metadata checksum, prefix hash, or partial-success receipt. Works in Node
 * and Deno so a longer-lived verifier can use the same implementation. */
export async function hashGenerationUploadStream(stream, { byteLength, signal } = {}) {
  requireValue(size(byteLength) && typeof stream?.getReader === 'function', 'invalid_object');
  const expected = BigInt(byteLength);
  const hash = createHash('sha256');
  const reader = stream.getReader();
  let count = 0n;
  let complete = false;
  try {
    for (;;) {
      const { value, done } = await call(() => reader.read(), signal);
      if (done) break;
      requireValue(value instanceof Uint8Array, 'invalid_object');
      count += BigInt(value.byteLength);
      requireValue(count <= expected, 'byte_mismatch');
      hash.update(value);
    }
    requireValue(count === expected, 'byte_mismatch');
    live(signal);
    complete = true;
    return { contentSha256: hash.digest('hex'), byteLength: count.toString() };
  } finally {
    // Cancellation itself may hang; a deadline cannot await that indefinitely.
    if (!complete) { try { void reader.cancel().catch(() => {}); } catch { /* pending read already ended */ } }
    try { reader.releaseLock(); } catch { /* an aborted read may still own its lock */ }
    hash.destroy();
  }
}

function descriptor(value, actor, operationId) {
  requireValue(value && value.version === 1 && value.actor_user_id === actor
    && value.operation_id === operationId && uuid(operationId)
    && uuid(value.document_id) && uuid(value.generation_id) && uuid(value.owner_user_id)
    && SHA.test(value.content_sha256) && SHA.test(value.source_sql_sha256)
    && size(value.byte_length) && ['reserved', 'verified', 'rejected', 'canceled'].includes(value.state)
    && typeof value.expires_at === 'string' && Number.isFinite(Date.parse(value.expires_at))
    && (value.verified_at === null || (typeof value.verified_at === 'string'
      && Number.isFinite(Date.parse(value.verified_at)))), 'invalid_receipt');
  requireValue(value.path === `${value.owner_user_id}/_generations/${value.document_id}/${value.generation_id}/${operationId}.pdf`, 'invalid_receipt');
  if (value.object !== null) {
    requireValue(value.object && uuid(value.object.id)
      && (value.object.version === null || uuid(value.object.version))
      && (value.object.byte_length === null || size(value.object.byte_length)), 'invalid_receipt');
  }
  if (value.state === 'verified') {
    requireValue(uuid(value.object?.version) && value.object.byte_length === value.byte_length
      && typeof value.verified_at === 'string' && Number.isFinite(Date.parse(value.verified_at)), 'invalid_receipt');
  }
  if (value.rejection != null) {
    const rejected = value.rejection;
    requireValue(['rejected', 'canceled'].includes(value.state) && rejected.reason === 'sha256_mismatch'
      && typeof rejected.observed_sha256 === 'string' && SHA.test(rejected.observed_sha256)
      && rejected.observed_sha256 !== value.content_sha256 && rejected.byte_length === value.byte_length
      && uuid(rejected.object?.id) && uuid(rejected.object?.version)
      && typeof rejected.rejected_at === 'string' && Number.isFinite(Date.parse(rejected.rejected_at))
      && value.verified_at === null, 'invalid_receipt');
  }
  if (value.state === 'rejected') {
    requireValue(value.rejection && value.object?.id === value.rejection.object.id
      && value.object.version === value.rejection.object.version
      && value.object.byte_length === value.byte_length, 'invalid_receipt');
  }
  return value;
}

const IMMUTABLE = ['operation_id', 'actor_user_id', 'document_id', 'generation_id', 'owner_user_id',
  'path', 'content_sha256', 'byte_length', 'source_sql_sha256', 'expires_at'];
function sameOperation(a, b) {
  requireValue(IMMUTABLE.every(key => a[key] === b[key]), 'invalid_receipt');
}
function publicDescriptor(value) {
  // Do not return private verification leases or future private RPC fields.
  return { ...Object.fromEntries(['version', ...IMMUTABLE, 'state', 'verified_at'].map(key => [key, value[key]])),
    object: value.object === null ? null : { id: value.object.id, version: value.object.version,
      byte_length: value.object.byte_length },
    rejection: value.rejection == null ? null : { reason: value.rejection.reason,
      observed_sha256: value.rejection.observed_sha256, byte_length: value.rejection.byte_length,
      rejected_at: value.rejection.rejected_at,
      object: { id: value.rejection.object.id, version: value.rejection.object.version } } };
}
const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const errors = {
  invalid_request: [400, 'Invalid upload request.'], unauthorized: [401, 'Sign in again before uploading.'],
  unavailable: [503, 'Verified generation uploads are not enabled.'],
  verification_pending: [503, 'Verification is not confirmed. Resume this same operation before retrying.'],
  byte_mismatch: [422, 'Uploaded bytes do not match this operation. Cancel it before preparing a different file.'],
  invalid_object: [409, 'The exact completed upload is not available for verification.'],
  invalid_receipt: [502, 'The server did not confirm the exact upload operation.'],
  canceled: [409, 'This upload operation was canceled.'],
  '42501': [403, 'This upload operation is not permitted.'],
  '40001': [409, 'This upload operation is busy or changed. Resume it before retrying.'],
  '55P03': [409, 'This upload operation is busy. Resume it before retrying.'],
  '23514': [409, 'This upload operation cannot accept the requested change.'],
  '54000': [409, 'This document needs a larger verified-publication workflow.'],
};
const rejectedResponse = operation => response(422, { operation: publicDescriptor(operation),
  error: { code: 'byte_mismatch', message: errors.byte_mismatch[1] } });

/** Authenticated staging only; never activates a document or removes bytes.
 * Provider compatibility must be verified by the operator before enabling.
 * A timeout leaves a durable pending operation, not a false success. */
export async function handleDocumentGenerationUpload(request, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return response(405, { error: { code: 'method_not_allowed' } });
  const controller = new AbortController();
  const timeout = Math.min(110_000, Math.max(1, deps.timeoutMs ?? 110_000));
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const signal = controller.signal;
  let claim = null;
  let recordStarted = false;
  try {
    requireValue(deps.enabled === true, 'unavailable');
    const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    requireValue(token && token.length <= 16384, 'unauthorized');
    const actor = (await call(() => deps.getUser(token, signal), signal))?.id;
    requireValue(uuid(actor), 'unauthorized');
    const chunks = [];
    let bytes = 0;
    const reader = request.body?.getReader();
    requireValue(reader);
    try {
      for (;;) {
        const { done, value } = await call(() => reader.read(), signal);
        if (done) break;
        bytes += value.byteLength;
        requireValue(bytes <= 8192);
        chunks.push(value);
      }
    } finally {
      try { void reader.cancel().catch(() => {}); } catch { /* closed */ }
      try { reader.releaseLock(); } catch { /* pending abort */ }
    }
    const bodyBytes = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { bodyBytes.set(chunk, offset); offset += chunk.byteLength; }
    let input;
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes)); }
    catch { throw fail('invalid_request'); }
    requireValue(input && !Array.isArray(input) && typeof input === 'object');
    const { action, operation_id: operationId } = input;
    requireValue(['begin', 'get', 'verify', 'cancel'].includes(action) && uuid(operationId));
    const keys = action === 'begin'
      ? ['action', 'operation_id', 'document_id', 'content_sha256', 'byte_length'] : ['action', 'operation_id'];
    requireValue(Object.keys(input).every(key => keys.includes(key)));
    if (action === 'begin') {
      requireValue(uuid(input.document_id) && SHA.test(input.content_sha256) && size(input.byte_length));
      const prepared = descriptor(await call(() => deps.begin(token, input, signal), signal), actor, operationId);
      requireValue(prepared.document_id === input.document_id && prepared.content_sha256 === input.content_sha256
        && prepared.byte_length === input.byte_length, 'invalid_receipt');
      if (prepared.state === 'canceled') throw fail('canceled');
      let upload = null;
      if (prepared.state === 'reserved' && prepared.object === null) {
        upload = await call(() => deps.mint(prepared.path, signal), signal);
        requireValue(upload?.path === prepared.path && typeof upload.token === 'string' && upload.token.length > 0
          && typeof upload.signedUrl === 'string' && upload.signedUrl.length > 0, 'invalid_receipt');
      }
      // A revoke/cancel/upload may have landed while the provider minted a URL.
      const current = descriptor(await call(() => deps.get(token, operationId, signal), signal), actor, operationId);
      sameOperation(prepared, current);
      if (current.state === 'canceled') throw fail('canceled');
      return response(200, { operation: publicDescriptor(current),
        upload: current.state === 'reserved' && current.object === null ? upload : null });
    }
    if (action === 'cancel') {
      const canceled = descriptor(await call(() => deps.cancel(token, operationId, signal), signal), actor, operationId);
      requireValue(canceled.state === 'canceled', 'invalid_receipt');
      return response(200, { operation: publicDescriptor(canceled) });
    }
    const prepared = descriptor(await call(() => deps.get(token, operationId, signal), signal), actor, operationId);
    if (action === 'get' || prepared.state === 'verified') return response(200, { operation: publicDescriptor(prepared) });
    if (prepared.state === 'rejected') return rejectedResponse(prepared);
    if (prepared.state === 'canceled') throw fail('canceled');
    const claimId = (deps.newId ?? (() => crypto.randomUUID()))();
    requireValue(uuid(claimId), 'invalid_receipt');
    const target = descriptor(await call(() => deps.claim(actor, operationId, claimId, signal), signal), actor, operationId);
    sameOperation(prepared, target);
    if (target.state === 'verified') return response(200, { operation: publicDescriptor(target) });
    if (target.state === 'rejected') return rejectedResponse(target);
    requireValue(target.state === 'reserved' && target.verification_claim_id === claimId
      && uuid(target.object?.version) && target.object.byte_length === target.byte_length, 'invalid_object');
    claim = { actor, operationId, claimId };
    const stream = await call(() => deps.openStream(target.path, signal), signal);
    const proof = await hashGenerationUploadStream(stream, { byteLength: target.byte_length, signal });
    if (proof.contentSha256 !== target.content_sha256) {
      // Only our completed exact-length hash can establish this verdict. A
      // transport exception (even with this error code) is not byte proof.
      // Preserve the candidate for recovery; SQL expiry owns later cleanup.
      recordStarted = true;
      const rejected = descriptor(await call(() => deps.reject(actor, operationId, claimId,
        target.object.id, target.object.version, proof.contentSha256, proof.byteLength, signal), signal), actor, operationId);
      sameOperation(target, rejected);
      requireValue(rejected.state === 'rejected' && rejected.object.id === target.object.id
        && rejected.object.version === target.object.version
        && rejected.rejection.observed_sha256 === proof.contentSha256, 'invalid_receipt');
      return rejectedResponse(rejected);
    }
    // No provider call or metadata checksum can substitute for the complete
    // byte stream above. SQL rechecks the exact object/lease and current access.
    recordStarted = true;
    const confirmed = descriptor(await call(() => deps.record(actor, operationId, claimId,
      target.object.id, target.object.version, proof.contentSha256, proof.byteLength, signal), signal), actor, operationId);
    sameOperation(target, confirmed);
    requireValue(confirmed.state === 'verified' && confirmed.object.id === target.object.id
      && confirmed.object.version === target.object.version, 'invalid_receipt');
    return response(200, { operation: publicDescriptor(confirmed) });
  } catch (error) {
    // A lost success/rejection reply might mean it committed. Do not release its lease or
    // repeat bytes blindly; a later get/verify reconciles the same operation.
    if (claim && !recordStarted && !signal.aborted) {
      try { await call(() => deps.release(claim.actor, claim.operationId, claim.claimId, signal), signal); }
      catch { /* lease expiry still prevents a permanent lock */ }
    }
    const code = Object.hasOwn(errors, error?.code) ? error.code : 'upload_unconfirmed';
    const [status, message] = errors[code] ?? [502, 'The upload result is not confirmed. Resume the same operation.'];
    return response(status, { error: { code, message } });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}
