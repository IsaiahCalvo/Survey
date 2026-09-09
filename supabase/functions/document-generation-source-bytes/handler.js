import { hashGenerationUploadStream } from '../document-generation-upload/handler.js';

const CORS = Object.freeze({ 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const uuid = value => typeof value === 'string' && UUID.test(value);
const sha = value => typeof value === 'string' && SHA.test(value);
const size = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const fail = code => Object.assign(new Error(code), { code });
const check = (value, code = 'invalid_receipt') => { if (!value) throw fail(code); };
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const live = signal => check(!signal.aborted, 'verification_pending');
function call(operation, signal) {
  live(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(fail('verification_pending'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { live(signal); return operation(); })
      .then(value => { live(signal); return value; }).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

// storage-js interpolates this argument into a URL and strips leading slashes.
// Encode the *raw object name*, not an already-encoded URL. Reject any name
// WHATWG URL would normalize to another object (notably dot segments).
export function encodeSourceObjectPath(path) {
  check(typeof path === 'string' && path.length > 0, 'invalid_source_path');
  let encoded;
  try {
    encoded = path.split('/').map(encodeURIComponent).join('/')
      .replace(/^\/+/, leading => encodeURIComponent(leading));
    const prefix = '/object/documents/';
    const url = new URL(`https://source.invalid${prefix}${encoded}`);
    check(url.pathname.startsWith(prefix) && !url.search && !url.hash
      && decodeURIComponent(url.pathname.slice(prefix.length)) === path, 'invalid_source_path');
  } catch { throw fail('invalid_source_path'); }
  return encoded;
}

const IDENTITY = ['version', 'source_id', 'actor_user_id', 'document_id', 'generation_id',
  'source_sql_sha256', 'expires_at'];
const OBJECT = ['kind', 'bucket_id', 'path', 'id', 'version', 'byte_length'];
function descriptor(value, actor, sourceId) {
  check(value && value.version === 1 && value.source_id === sourceId && value.actor_user_id === actor
    && uuid(value.document_id) && (value.generation_id === null || uuid(value.generation_id))
    && sha(value.source_sql_sha256) && timestamp(value.expires_at)
    && ['unverified', 'verifying', 'verified', 'expired', 'canceled'].includes(value.state)
    && Array.isArray(value.objects));
  if (['expired', 'canceled'].includes(value.state)) {
    check(value.objects.length === 0 && value.verified_at === null);
    return value;
  }
  check(value.objects.length > 0 && value.objects.length <= 16);
  const paths = new Set(), ids = new Set();
  for (const [index, object] of value.objects.entries()) {
    check(object && object.kind === (index === 0 ? 'pdf' : 'sidecar') && object.bucket_id === 'documents'
      && typeof object.path === 'string' && object.path.length > 0 && uuid(object.id) && uuid(object.version)
      && size(object.byte_length) && !paths.has(object.path) && !ids.has(object.id)
      && (value.state === 'verified' ? sha(object.content_sha256) : object.content_sha256 === null));
    paths.add(object.path); ids.add(object.id);
  }
  check(value.state === 'verified' ? timestamp(value.verified_at) : value.verified_at === null);
  return value;
}
function sameSource(a, b) {
  check(IDENTITY.every(key => a[key] === b[key]) && a.objects.length === b.objects.length
    && a.objects.every((object, index) => OBJECT.every(key => object[key] === b.objects[index][key])));
}
const publicDescriptor = value => ({ ...pick(value, [...IDENTITY, 'state', 'verified_at']),
  objects: value.objects.map(object => pick(object, [...OBJECT, 'content_sha256'])) });
const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const errors = {
  invalid_request: [400, 'Invalid source verification request.'],
  unauthorized: [401, 'Sign in again before verifying this source.'],
  unavailable: [503, 'Source byte verification is not enabled.'],
  verification_pending: [503, 'Verification is not confirmed. Resume this same source ID.'],
  invalid_receipt: [502, 'The server did not confirm the exact source bytes.'],
  invalid_source_path: [409, 'This source path cannot be read exactly by this verifier. Your document was kept.'],
  invalid_object: [409, 'The complete source object is not available for verification.'],
  byte_mismatch: [409, 'The source stream does not match the captured byte length. Your document was kept.'],
  source_unavailable: [409, 'This source capture is no longer active. Your document was kept.'],
  '42501': [403, 'This source verification is not permitted.'],
  '40001': [409, 'This source is busy or changed. Resume this source ID before retrying.'],
  '55P03': [409, 'This source is busy. Resume this source ID before retrying.'],
  '23514': [409, 'The source no longer matches this capture. Your document was kept.'],
  '54000': [409, 'This source exceeds the bounded verification workflow.'],
  SG001: [409, 'The document generation changed. Load it before preparing a new source.'],
  SG002: [409, 'The document generation changed. Load it before preparing a new source.'],
};

async function input(request, signal) {
  const reader = request.body?.getReader();
  check(reader, 'invalid_request');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await call(() => reader.read(), signal);
      if (done) break;
      length += value.byteLength; check(length <= 8192, 'invalid_request'); chunks.push(value);
    }
  } finally {
    try { void reader.cancel().catch(() => {}); } catch { /* closed */ }
    try { reader.releaseLock(); } catch { /* pending read after abort */ }
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail('invalid_request'); }
  check(body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).length === 2 && ['get', 'verify'].includes(body.action)
    && uuid(body.source_id), 'invalid_request');
  return body;
}

// No upload, deletion, metadata-derived hash, or active-document publication.
// Every captured object must finish streaming before one checked SQL receipt.
export async function handleDocumentGenerationSourceBytes(request, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return response(405, { error: { code: 'method_not_allowed' } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(110000, deps.timeoutMs ?? 110000)));
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const signal = controller.signal;
  let claim = null, recordStarted = false;
  let leaseTimer;
  try {
    check(deps.enabled === true, 'unavailable');
    const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    check(token && token.length <= 16384, 'unauthorized');
    const actor = (await call(() => deps.getUser(token, signal), signal))?.id;
    check(uuid(actor), 'unauthorized');
    const body = await input(request, signal), sourceId = body.source_id;
    const prepared = descriptor(await call(() => deps.get(actor, sourceId, signal), signal), actor, sourceId);
    if (body.action === 'get' || prepared.state === 'verified') {
      return response(200, { attestation: publicDescriptor(prepared) });
    }
    check(!['expired', 'canceled'].includes(prepared.state), 'source_unavailable');
    check(Date.parse(prepared.expires_at) > Date.now(), 'source_unavailable');
    for (const object of prepared.objects) encodeSourceObjectPath(object.path);
    const claimId = (deps.newId ?? (() => crypto.randomUUID()))(); check(uuid(claimId));
    const target = descriptor(await call(() => deps.claim(actor, sourceId, claimId, signal), signal), actor, sourceId);
    sameSource(prepared, target);
    if (target.state === 'verified') return response(200, { attestation: publicDescriptor(target) });
    check(target.state === 'verifying' && target.verification_claim_id === claimId
      && timestamp(target.verification_claim_expires_at));
    claim = { actor, sourceId, claimId };
    const leaseDeadline = Math.min(Date.parse(target.expires_at), Date.parse(target.verification_claim_expires_at));
    const leaseLive = () => {
      if (Date.now() >= leaseDeadline) controller.abort();
      live(signal);
    };
    leaseLive();
    leaseTimer = setTimeout(() => controller.abort(), Math.min(110000, leaseDeadline - Date.now()));
    const objects = [];
    for (const object of target.objects) {
      leaseLive();
      const stream = await call(() => deps.openStream(pick(object, OBJECT), signal), signal);
      const proof = await hashGenerationUploadStream(stream, { byteLength: object.byte_length, signal });
      objects.push({ ...pick(object, OBJECT), content_sha256: proof.contentSha256 });
    }
    leaseLive();
    recordStarted = true;
    const confirmed = descriptor(await call(() => deps.record(actor, sourceId, claimId, objects, signal), signal), actor, sourceId);
    sameSource(target, confirmed);
    check(confirmed.state === 'verified' && confirmed.objects.every((object, index) => object.content_sha256 === objects[index].content_sha256));
    return response(200, { attestation: publicDescriptor(confirmed) });
  } catch (error) {
    if (claim && !recordStarted && !signal.aborted) {
      try { await call(() => deps.release(claim.actor, claim.sourceId, claim.claimId, signal), signal); }
      catch { /* bounded lease expiry still permits later recovery */ }
    }
    const code = Object.hasOwn(errors, error?.code) ? error.code : 'verification_pending';
    const [status, message] = errors[code];
    return response(status, { error: { code, message } });
  } finally {
    clearTimeout(timer); clearTimeout(leaseTimer); request.signal.removeEventListener('abort', abort);
  }
}
