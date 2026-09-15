// Metadata capture only. This route cannot verify, overwrite, or publish PDF bytes.
const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuid = value => typeof value === 'string' && UUID.test(value);
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value)
  && BigInt(value) <= 9223372036854775807n;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => Object.assign(new Error(code), { code });
const check = (condition, code = 'invalid_receipt') => { if (!condition) throw fail(code); };
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const live = signal => check(!signal.aborted, 'capture_pending');

// Bound even dependencies that ignore cancellation. Never start a later call
// after a timeout; an uncertain begin must be resumed with the same source ID.
function call(operation, signal) {
  live(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(fail('capture_pending'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { live(signal); return operation(); })
      .then(value => { live(signal); return value; }).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

function storageObject(value) {
  if (value === null) return null;
  check(object(value) && value.bucket_id === 'documents' && typeof value.path === 'string'
    && value.path.length > 0 && uuid(value.id) && (value.version === null || uuid(value.version))
    && (value.byte_length === null || decimal(value.byte_length)));
  // Legacy paths are opaque metadata, not URL fragments or generated paths.
  return pick(value, ['bucket_id', 'path', 'id', 'version', 'byte_length']);
}

function visibleCapture(value, actor, documentId, generationId) {
  check(object(value) && value.scope === 'sql-metadata-only'
    && object(value.document) && value.document.id === documentId && object(value.sources)
    && object(value.compare));
  const source = value.sources;
  const arrayKeys = ['annotation_updates', 'document_annotations', 'doc_yjs_updates',
    'survey_sessions', 'survey_items'];
  for (const key of arrayKeys) check(Array.isArray(source[key]) && source[key].every(object));
  for (const key of ['annotation_snapshot', 'doc_yjs_state']) {
    check(source[key] === null || object(source[key]));
  }
  // SQL owns the permission check. Fail closed if its visible projection ever
  // includes another person's private survey instead of forwarding that body.
  const sessions = new Set();
  for (const session of source.survey_sessions) {
    check(uuid(session.id) && session.user_id === actor && session.document_id === documentId);
    sessions.add(session.id);
  }
  check(source.survey_items.every(item => sessions.has(item.session_id)));
  for (const key of ['annotation_updates', 'document_annotations', 'doc_yjs_updates']) {
    check(source[key].every(row => row.document_id === documentId));
  }
  for (const key of ['annotation_snapshot', 'doc_yjs_state']) {
    check(source[key] === null || source[key].document_id === documentId);
  }
  const generation = source.active_generation;
  check(generationId === null ? generation === null : object(generation));
  if (generation !== null) {
    const sameScope = row => object(row) && row.document_id === documentId && row.generation_id === generationId;
    check(sameScope(generation.baseline) && decimal(generation.baseline.base_seq)
      && typeof generation.baseline.baseline_snapshot_base64 === 'string'
      && (generation.snapshot === null || (sameScope(generation.snapshot)
        && decimal(generation.snapshot.at_seq) && decimal(generation.snapshot.writer_epoch)
        && typeof generation.snapshot.snapshot_base64 === 'string'))
      && Array.isArray(generation.updates) && generation.updates.every(row => sameScope(row)
        && decimal(row.seq) && decimal(row.client_seq) && typeof row.data_base64 === 'string'));
  }
  const compareKeys = ['wal_head', 'covered_head'];
  check(compareKeys.every(key => decimal(value.compare[key])));
  return { document: value.document,
    sources: { ...pick(source, [...arrayKeys, 'annotation_snapshot', 'doc_yjs_state']),
      active_generation: generation === null ? null : pick(generation, ['baseline', 'snapshot', 'updates']) },
    compare: pick(value.compare, compareKeys), scope: 'sql-metadata-only' };
}

function descriptor(value, actor, input, contentModelVersion = null) {
  check(object(value) && value.version === (contentModelVersion === null ? 1 : 2)
    && (contentModelVersion === null || value.content_model_version === contentModelVersion)
    && value.source_id === input.source_id
    && value.actor_user_id === actor && uuid(value.document_id)
    && (value.generation_id === null || uuid(value.generation_id))
    && ['captured', 'expired', 'canceled'].includes(value.state)
    && value.source_byte_state === 'unverified'
    && typeof value.source_sql_sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.source_sql_sha256)
    && decimal(value.wal_head) && typeof value.expires_at === 'string'
    && Number.isFinite(Date.parse(value.expires_at)) && Array.isArray(value.sidecar_objects));
  if (input.action === 'begin') check(value.document_id === input.document_id
    && value.generation_id === input.generation_id);
  if (input.action === 'cancel') check(['canceled', 'expired'].includes(value.state));
  if (value.state !== 'captured') check(value.visible_capture === null
    && value.source_object === null && value.sidecar_objects.length === 0);
  const visible = value.state === 'captured'
    ? visibleCapture(value.visible_capture, actor, value.document_id, value.generation_id) : null;
  if (visible) check(visible.compare.wal_head === value.wal_head);
  return { ...pick(value, ['version', ...(contentModelVersion === null ? [] : ['content_model_version']),
    'source_id', 'actor_user_id', 'document_id', 'generation_id',
    'state', 'source_byte_state', 'source_sql_sha256', 'wal_head', 'expires_at']),
    source_object: storageObject(value.source_object),
    sidecar_objects: value.sidecar_objects.map(storageObject), visible_capture: visible };
}

const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const errors = {
  invalid_request: [400, 'Invalid source request.'],
  unauthorized: [401, 'Sign in again before capturing a document source.'],
  unavailable: [503, 'Document source capture is not enabled.'],
  capture_pending: [503, 'Capture is not confirmed. Resume this same source ID before retrying.'],
  invalid_receipt: [502, 'The server did not confirm the exact source capture.'],
  '42501': [403, 'This source capture is not permitted.'],
  '40001': [409, 'The document changed or is busy. Resume this source ID before retrying.'],
  '55P03': [409, 'The document is busy. Resume this source ID before retrying.'],
  '23514': [409, 'This source capture cannot accept the requested change.'],
  '23505': [409, 'This source ID already belongs to a different capture.'],
  SG001: [409, 'The document generation changed. Prepare a fresh source after loading it.'],
  SG002: [409, 'The document generation changed. Prepare a fresh source after loading it.'],
  SG003: [409, 'The replacement source model does not match its saved intent.'],
  '54000': [409, 'This document exceeds the bounded source capture limit.'],
};

export async function handleDocumentGenerationSource(request, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return response(405, { error: { code: 'method_not_allowed' } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(30000, deps.timeoutMs ?? 30000)));
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const signal = controller.signal;
  try {
    check(deps.enabled === true, 'unavailable');
    const contentModelVersion = deps.contentModelVersion ?? null;
    check(contentModelVersion === null || [1, 2].includes(contentModelVersion), 'unavailable');
    const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    check(token && token.length <= 16384, 'unauthorized');
    const actor = (await call(() => deps.getUser(token, signal), signal))?.id;
    check(uuid(actor), 'unauthorized');
    const reader = request.body?.getReader();
    check(reader, 'invalid_request');
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await call(() => reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        check(size <= 8192, 'invalid_request');
        chunks.push(value);
      }
    } finally {
      try { void reader.cancel().catch(() => {}); } catch { /* closed reader */ }
      try { reader.releaseLock(); } catch { /* pending read after deadline */ }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let input;
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw fail('invalid_request'); }
    check(object(input) && ['begin', 'get', 'cancel'].includes(input.action) && uuid(input.source_id), 'invalid_request');
    const keys = input.action === 'begin'
      ? ['action', 'source_id', 'document_id', 'generation_id'] : ['action', 'source_id'];
    check(Object.keys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key)), 'invalid_request');
    if (input.action === 'begin') check(uuid(input.document_id)
      && (input.generation_id === null || uuid(input.generation_id)), 'invalid_request');
    const method = contentModelVersion !== null && input.action !== 'cancel'
      ? `${input.action}V2` : input.action;
    check(typeof deps[method] === 'function'
      && !(contentModelVersion !== null && input.action === 'cancel'), 'unavailable');
    const result = await call(() => contentModelVersion === null
      ? deps[method](actor, input, signal)
      : deps[method](actor, input, contentModelVersion, signal), signal);
    return response(200, { source: descriptor(result, actor, input, contentModelVersion) });
  } catch (error) {
    const code = Object.hasOwn(errors, error?.code) ? error.code : 'capture_pending';
    const [status, message] = errors[code];
    return response(status, { error: { code, message } });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}
