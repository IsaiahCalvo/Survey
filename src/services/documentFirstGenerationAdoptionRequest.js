// SERVER PRIVATE. This is the strict bearer-bound HTTP shell. Its injected
// preview and publish workflows own source-byte proof and upload composition.
import { validateDocumentFirstGenerationAdoptionReceipt } from './documentFirstGenerationAdoption.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const uuid = value => typeof value === 'string' && UUID.test(value);
const sha = value => typeof value === 'string' && SHA.test(value);
const fail = code => Object.assign(new Error(code), { code });
const check = (value, code = 'invalid_request') => { if (!value) throw fail(code); };
const response = (status, body) => new Response(JSON.stringify(body), { status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function body(request, signal) {
  const reader = request.body?.getReader(); check(reader);
  const chunks = []; let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw fail('temporarily_unavailable');
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength; check(size <= 8192); chunks.push(value);
    }
  } finally {
    try { void reader.cancel().catch(() => {}); } catch { /* closed */ }
    try { reader.releaseLock(); } catch { /* pending abort */ }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail('invalid_request'); }
}

function parse(value) {
  check(plain(value) && ['preview', 'confirm', 'status', 'publish'].includes(value.action));
  if (value.action === 'preview') {
    check(exact(value, ['action', 'document_id', 'adoption_operation_id', 'source_id',
      'candidate_operation_id', 'archive_operation_ids'])
      && [value.document_id, value.adoption_operation_id, value.source_id,
        value.candidate_operation_id].every(uuid)
      && Array.isArray(value.archive_operation_ids) && value.archive_operation_ids.length === 2
      && value.archive_operation_ids.every(uuid)
      && new Set([value.adoption_operation_id, value.source_id, value.candidate_operation_id,
        ...value.archive_operation_ids]).size === 5);
  } else if (value.action === 'status') {
    check(exact(value, ['action', 'adoption_operation_id']) && uuid(value.adoption_operation_id));
  } else check(exact(value, ['action', 'adoption_operation_id', 'review_sha256'])
    && uuid(value.adoption_operation_id) && sha(value.review_sha256));
  return value;
}

const ERROR = Object.freeze({
  invalid_request: [400, 'invalid_request'], unauthorized: [401, 'unauthorized'],
  forbidden: [403, 'forbidden'], adoption_conflict: [409, 'adoption_conflict'],
  stale_review: [409, 'stale_review'], legacy_entity_adoption_required: [409, 'legacy_entity_adoption_required'],
  survey_definition_required: [409, 'survey_definition_required'], adoption_expired: [410, 'adoption_expired'],
  temporarily_unavailable: [503, 'temporarily_unavailable'], internal_error: [500, 'internal_error'],
});
function mapped(error) {
  const code = error?.code;
  if (ERROR[code]) return code;
  if (code === '42501') return 'forbidden';
  if (code === 'SG004') return 'legacy_entity_adoption_required';
  if (['23505', '23514', '40001', '55P03', 'SG001', 'SG002', 'SG003'].includes(code)) return 'adoption_conflict';
  return 'internal_error';
}

export function createDocumentFirstGenerationAdoptionRequestHandler(options = {}) {
  check(plain(options) && Object.keys(options).every(key => ['enabled', 'getUser', 'preview', 'confirm',
    'status', 'publish', 'timeoutMs'].includes(key)), 'internal_error');
  const { enabled = false, getUser, preview, confirm, status, publish, timeoutMs = 300000 } = options;
  check(typeof enabled === 'boolean' && [getUser, preview, confirm, status, publish].every(fn => typeof fn === 'function')
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2147483647, 'internal_error');
  return async request => {
    if (!(request instanceof Request)) return response(400, { error: { code: 'invalid_request' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return response(405, { error: { code: 'method_not_allowed' } });
    if (!enabled) return response(503, { error: { code: 'temporarily_unavailable' } });
    const controller = new AbortController(), abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    try {
      const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
      check(token && token.length <= 16384, 'unauthorized');
      const input = parse(await body(request, controller.signal));
      const actor = (await getUser(token, controller.signal))?.id;
      check(uuid(actor), 'unauthorized');
      const work = { actorUserId: actor, accessToken: token, input, signal: controller.signal };
      const raw = await ({ preview, confirm, status, publish })[input.action](work);
      const receipt = validateDocumentFirstGenerationAdoptionReceipt(raw, {
        actorUserId: actor, adoptionOperationId: input.adoption_operation_id,
        ...(input.document_id ? { documentId: input.document_id, sourceId: input.source_id,
          candidateOperationId: input.candidate_operation_id,
          archiveOperationIds: input.archive_operation_ids } : {}),
      });
      return response(200, receipt);
    } catch (error) {
      const code = controller.signal.aborted ? 'temporarily_unavailable' : mapped(error);
      const [statusCode, safe] = ERROR[code];
      return response(statusCode, { error: { code: safe } });
    } finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', abort);
    }
  };
}
