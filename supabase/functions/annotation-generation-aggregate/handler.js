import { admitAnnotationGenerationAggregate } from '../_shared/annotationGenerationAggregateAdmission.js';
import { Buffer } from 'node:buffer';

export const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const QUERY_KEYS = ['client_id', 'client_seq', 'content_model_version', 'document_id', 'generation_id'];
const QUERY_V2_KEYS = [...QUERY_KEYS, 'receipt_version'];
const MAX_TRANSPORT_BYTES = 64 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const PROBE_MISSING_KEYS = ['actor_user_id', 'client_id', 'client_seq', 'content_model_version',
  'document_id', 'generation_id', 'status', 'version'];
const PROBE_ACCEPTED_KEYS = ['accepted', 'actor_user_id', 'client_id', 'client_seq',
  'content_model_version', 'data_sha256', 'document_id', 'generation_id', 'seq', 'status', 'version'];
const PROBE_V2_ACCEPTED_KEYS = ['accepted', 'actor_user_id', 'client_id', 'client_seq',
  'content_model_version', 'current_generation_id', 'data_sha256', 'document_id', 'generation_id',
  'is_current', 'seq', 'status', 'version'];
const CHECKPOINT_ENVELOPE_KEYS = ['actor_user_id', 'base_seq', 'checkpoint',
  'content_model_version', 'document_id', 'generation_id', 'head', 'version'];
const CHECKPOINT_KEYS = ['at_seq', 'encoding_version', 'snapshot', 'snapshot_sha256',
  'writer_epoch', 'writer_id'];
const TAIL_KEYS = ['content_model_version', 'document_id', 'generation_id', 'has_more',
  'rows', 'through_seq', 'version'];
const TAIL_ROW_KEYS = ['actor_user_id', 'client_id', 'client_seq', 'data', 'seq'];
const COMMIT_KEYS = ['accepted', 'actor_user_id', 'checkpoint', 'checkpoint_stored',
  'client_id', 'client_seq', 'content_model_version', 'data_sha256', 'document_id',
  'generation_id', 'seq', 'status', 'version'];
const COMMIT_V2_KEYS = ['accepted', 'actor_user_id', 'checkpoint', 'checkpoint_stored',
  'client_id', 'client_seq', 'content_model_version', 'current_generation_id', 'data_sha256',
  'document_id', 'generation_id', 'is_current', 'seq', 'status', 'version'];
const COMMIT_CHECKPOINT_KEYS = ['at_seq', 'encoding_version', 'snapshot_sha256',
  'writer_epoch', 'writer_id'];
const WORK_REASONS = new Set(['aggregate-input-bytes', 'checkpoint-expanded-bytes',
  'checkpoint-output-bytes', 'checkpoint-stored-bytes', 'gzip-runtime', 'tail-pages', 'tail-rows']);

/** @returns {never} */
const fail = (code, reason = null) => {
  const error = Object.assign(new Error(code), { code });
  if (reason !== null) error.reason = reason;
  throw error;
};
const check = (condition, code = 'invalid_broker_response') => { if (!condition) fail(code); };
const uuid = value => typeof value === 'string' && UUID.test(value);
const writer = value => typeof value === 'string' && value.length >= 1 && value.length <= 512;
const decimal = (value, positive = false) => typeof value === 'string' && value.length <= 19
  && DECIMAL.test(value)
  && BigInt(value) <= 9223372036854775807n && (!positive || BigInt(value) > 0n);
const response = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function exactObject(value, keys) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string')
    || [...ownKeys].sort().some((key, index) => key !== keys[index])) return null;
  if (keys.some(key => !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) {
    return null;
  }
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function exactArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result.push(descriptor.value);
  }
  return result;
}

function hexBytes(value) {
  check(typeof value === 'string' && value.length > 2 && value.length <= 2 + 2 * MAX_TRANSPORT_BYTES
    && value.length % 2 === 0 && /^\\x[0-9a-f]+$/.test(value));
  return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function live(signal) {
  if (signal.aborted) fail('request_aborted');
}

function call(operation, signal) {
  live(signal);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(Object.assign(new Error('request_aborted'), { code: 'request_aborted' }));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => { live(signal); return operation(); }).then(
      value => {
        try { live(signal); resolve(value); } catch (error) { reject(error); }
      },
      error => reject(error),
    ).finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function readBody(request, signal) {
  const stated = request.headers.get('Content-Length');
  if (stated !== null) {
    check(decimal(stated), 'invalid_request');
    if (BigInt(stated) > BigInt(MAX_TRANSPORT_BYTES)) fail('transport_limit');
  }
  const reader = request.body?.getReader();
  check(reader, 'invalid_request');
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const item = await call(() => reader.read(), signal);
      if (item.done) break;
      check(item.value instanceof Uint8Array, 'invalid_request');
      length += item.value.byteLength;
      if (length > MAX_TRANSPORT_BYTES) fail('transport_limit');
      chunks.push(new Uint8Array(item.value));
    }
  } finally {
    try { void reader.cancel().catch(() => {}); } catch { /* body already ended */ }
    try { reader.releaseLock(); } catch { /* aborted read */ }
  }
  check(length > 0 && (stated === null || BigInt(stated) === BigInt(length)), 'invalid_request');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function requestIdentity(request) {
  let url;
  try { url = new URL(request.url); } catch { fail('invalid_request'); }
  const keys = [...url.searchParams.keys()];
  const receiptVersions = url.searchParams.getAll('receipt_version');
  const receiptVersion = receiptVersions.length === 0 ? 1
    : receiptVersions.length === 1 && receiptVersions[0] === '2' ? 2 : null;
  const expectedKeys = receiptVersion === 2 ? QUERY_V2_KEYS : QUERY_KEYS;
  check(receiptVersion !== null && keys.length === expectedKeys.length
    && expectedKeys.every(key => url.searchParams.getAll(key).length === 1)
    && keys.every(key => expectedKeys.includes(key)), 'invalid_request');
  const documentId = url.searchParams.get('document_id');
  const generationId = url.searchParams.get('generation_id');
  const model = url.searchParams.get('content_model_version');
  const contentModelVersion = model === '2' ? 2 : null;
  const writerId = url.searchParams.get('client_id');
  const clientSeq = url.searchParams.get('client_seq');
  check(uuid(documentId) && uuid(generationId) && contentModelVersion === 2
    && writer(writerId) && decimal(clientSeq, true), 'invalid_request');
  return Object.freeze({
    identity: Object.freeze({ documentId, generationId, contentModelVersion, writerId, clientSeq }),
    receiptVersion,
  });
}

function checkedScope(value, identity, actor, receiptVersion = 1) {
  check(value.version === receiptVersion && value.document_id === identity.documentId
    && value.generation_id === identity.generationId && value.content_model_version === 2
    && value.actor_user_id === actor);
}

function checkedCurrent(value, identity, receiptVersion) {
  if (receiptVersion === 1) return null;
  check((value.current_generation_id === null || uuid(value.current_generation_id))
    && typeof value.is_current === 'boolean'
    && value.is_current === (value.current_generation_id === identity.generationId));
  return Object.freeze({ currentGenerationId: value.current_generation_id,
    isCurrent: value.is_current });
}

function checkedProbe(value, identity, actor, update, updateSha256, receiptVersion = 1) {
  const status = value?.status;
  const keys = status === 'missing' ? PROBE_MISSING_KEYS
    : status === 'accepted' ? (receiptVersion === 2
      ? PROBE_V2_ACCEPTED_KEYS : PROBE_ACCEPTED_KEYS) : [];
  const owned = exactObject(value, keys);
  check(owned);
  checkedScope(owned, identity, actor, receiptVersion);
  check(owned.client_id === identity.writerId && owned.client_seq === identity.clientSeq);
  if (status === 'missing') return Object.freeze({ receipt: null, current: null });
  check(owned.accepted === true && decimal(owned.seq, true)
    && owned.data_sha256 === updateSha256 && SHA256.test(owned.data_sha256));
  return Object.freeze({
    receipt: { documentId: identity.documentId, generationId: identity.generationId,
      actorUserId: actor, contentModelVersion: 2, writerId: identity.writerId,
      clientSeq: identity.clientSeq, seq: owned.seq, update: new Uint8Array(update) },
    current: checkedCurrent(owned, identity, receiptVersion),
    updateSha256: owned.data_sha256,
  });
}

function checkedCheckpoint(value, identity, actor) {
  const owned = exactObject(value, CHECKPOINT_ENVELOPE_KEYS);
  check(owned);
  checkedScope(owned, identity, actor);
  check(decimal(owned.head) && decimal(owned.base_seq));
  const checkpoint = exactObject(owned.checkpoint, CHECKPOINT_KEYS);
  check(checkpoint && decimal(checkpoint.at_seq) && decimal(checkpoint.writer_epoch)
    && [1, 2].includes(checkpoint.encoding_version)
    && typeof checkpoint.snapshot_sha256 === 'string' && SHA256.test(checkpoint.snapshot_sha256)
    && (checkpoint.writer_id === null || writer(checkpoint.writer_id)));
  return { documentId: identity.documentId, generationId: identity.generationId,
    actorUserId: actor, contentModelVersion: 2, head: owned.head, baseSeq: owned.base_seq,
    checkpoint: { atSeq: checkpoint.at_seq, writerId: checkpoint.writer_id,
      writerEpoch: checkpoint.writer_epoch, encodingVersion: checkpoint.encoding_version,
      snapshotSha256: checkpoint.snapshot_sha256, snapshot: hexBytes(checkpoint.snapshot) } };
}

function checkedTail(value, identity, actor, requested) {
  const owned = exactObject(value, TAIL_KEYS);
  check(owned && owned.version === 3 && owned.document_id === identity.documentId
    && owned.generation_id === identity.generationId && owned.content_model_version === 2
    && decimal(owned.through_seq) && owned.through_seq === requested.throughSeq
    && Number.isSafeInteger(requested.limit) && requested.limit > 0
    && typeof owned.has_more === 'boolean');
  check(Array.isArray(owned.rows) && Object.getPrototypeOf(owned.rows) === Array.prototype
    && owned.rows.length <= requested.limit);
  const rows = exactArray(owned.rows);
  check(rows);
  const captured = rows.map(value => {
    const row = exactObject(value, TAIL_ROW_KEYS);
    check(row && decimal(row.seq, true) && uuid(row.actor_user_id) && writer(row.client_id)
      && decimal(row.client_seq, true) && typeof row.data === 'string'
      && row.data.length > 2 && row.data.length <= 2 + 2 * MAX_TRANSPORT_BYTES
      && row.data.length % 2 === 0);
    return { row, byteLength: (row.data.length - 2) / 2 };
  });
  const pageBytes = captured.reduce((total, item) => total + item.byteLength, 0);
  check(pageBytes <= 16 * 1024 * 1024
    || (captured.length === 1 && captured[0].byteLength <= MAX_TRANSPORT_BYTES));
  return { documentId: identity.documentId, generationId: identity.generationId,
    actorUserId: actor, contentModelVersion: 2, throughSeq: owned.through_seq,
    hasMore: owned.has_more, rows: captured.map(({ row }) => {
      check(/^\\x[0-9a-f]+$/.test(row.data));
      return { seq: row.seq, actorUserId: row.actor_user_id, writerId: row.client_id,
        clientSeq: row.client_seq, update: hexBytes(row.data) };
    }) };
}

function checkedCommit(value, identity, actor, updateSha256, admitted, receiptVersion = 1) {
  const owned = exactObject(value, receiptVersion === 2 ? COMMIT_V2_KEYS : COMMIT_KEYS);
  check(owned);
  checkedScope(owned, identity, actor, receiptVersion);
  check(owned.status === 'accepted' && owned.accepted === true
    && owned.client_id === identity.writerId && owned.client_seq === identity.clientSeq
    && decimal(owned.seq, true)
    && owned.data_sha256 === updateSha256 && SHA256.test(owned.data_sha256)
    && typeof owned.checkpoint_stored === 'boolean');
  if (!owned.checkpoint_stored) {
    check(owned.checkpoint === null);
    return { result: receiptResult({ seq: owned.seq, updateSha256: owned.data_sha256 },
      identity, actor, receiptVersion, checkedCurrent(owned, identity, receiptVersion)),
      needsReceiptProof: admitted.checkpoint !== null
        || owned.seq !== admitted.nextSeq };
  }
  check(admitted.checkpoint !== null && owned.seq === admitted.nextSeq);
  {
    const checkpoint = exactObject(owned.checkpoint, COMMIT_CHECKPOINT_KEYS);
    check(checkpoint && checkpoint.at_seq === admitted.checkpoint.atSeq
      && checkpoint.writer_id === 'survey-private-aggregate-v1'
      && checkpoint.writer_epoch === (BigInt(admitted.sourceCheckpoint.writerEpoch) + 1n).toString()
      && checkpoint.encoding_version === admitted.checkpoint.encodingVersion
      && checkpoint.snapshot_sha256 === admitted.checkpoint.snapshotSha256);
  }
  return { result: receiptResult({ seq: owned.seq, updateSha256: owned.data_sha256 },
    identity, actor, receiptVersion, checkedCurrent(owned, identity, receiptVersion)),
    needsReceiptProof: false };
}

function receiptResult(receipt, identity, actor, receiptVersion = 1, current = null) {
  check(receiptVersion === 1 || (current && typeof current.isCurrent === 'boolean'));
  return { version: receiptVersion, status: 'accepted', document_id: identity.documentId,
    generation_id: identity.generationId, content_model_version: 2, actor_user_id: actor,
    client_id: identity.writerId, client_seq: identity.clientSeq, seq: receipt.seq,
    data_sha256: receipt.updateSha256,
    ...(receiptVersion === 2 ? { current_generation_id: current.currentGenerationId,
      is_current: current.isCurrent } : {}),
  };
}

const ERRORS = Object.freeze({
  invalid_request: [400, 'Invalid aggregate update request.'],
  unauthorized: [401, 'Sign in again before saving this update.'],
  unavailable: [503, 'Checked aggregate writes are not enabled in this runtime.'],
  transport_limit: [413, 'This update exceeds the supported request transport limit.'],
  request_aborted: [503, 'The update result is not confirmed. Retry this same update receipt.'],
  not_permitted: [403, 'This document does not permit this update.'],
  generation_changed: [409, 'The PDF generation changed. Keep this update for recovery.'],
  receipt_conflict: [409, 'This update receipt belongs to different bytes.'],
  aggregate_changed: [409, 'The document changed during validation. Retry this same update.'],
  maintenance_required: [409, 'This document needs checked maintenance before more cloud writes.'],
  annotation_generation_capacity: [409, 'This document reached the checked cloud-save limit.'],
  invalid_broker_response: [502, 'The server did not confirm the checked update.'],
  unconfirmed: [502, 'The update result is not confirmed. Retry this same update receipt.'],
});

function publicError(error) {
  let code = 'unconfirmed';
  if (Object.hasOwn(ERRORS, error?.code)) code = error.code;
  else if (error?.code === '42501') code = 'not_permitted';
  else if (['SG001', 'SG002', 'SG003'].includes(error?.code)) code = 'generation_changed';
  else if (error?.code === '23505') code = 'receipt_conflict';
  else if (error?.code === 'SG004') code = 'annotation_generation_capacity';
  else if (error?.code === 'ANNOTATION_AGGREGATE_WORK_LIMIT') code = 'maintenance_required';
  else if (error?.code === 'ANNOTATION_AGGREGATE_ABORTED') code = 'request_aborted';
  const [status, message] = ERRORS[code];
  const reason = code === 'maintenance_required' && WORK_REASONS.has(error?.reason)
    ? error.reason : null;
  return response(status, { error: { code, message, ...(reason ? { reason } : {}) } });
}

/**
 * Authenticate and orchestrate one private aggregate admission. This handler
 * does not make an Edge runtime safe for 64 MiB Yjs work: synchronous decode,
 * apply and encode still require a separately proved worker resource contract.
 */
export async function handleAnnotationGenerationAggregate(request, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return response(405, { error: { code: 'method_not_allowed' } });
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Math.min(110_000, deps?.timeoutMs ?? 110_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const signal = controller.signal;
  try {
    check(deps?.runtimeVerified === true, 'unavailable');
    check(request.headers.get('Content-Type')?.toLowerCase() === 'application/octet-stream',
      'invalid_request');
    const requested = requestIdentity(request);
    const { identity, receiptVersion } = requested;
    const tokenMatch = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i);
    const token = tokenMatch?.[1];
    check(token && token.length <= 16_384, 'unauthorized');
    const user = await call(() => deps.getUser(token, signal), signal);
    const actor = user?.id;
    check(uuid(actor), 'unauthorized');
    const update = await readBody(request, signal);
    live(signal);
    const updateSha256 = await sha256(update);
    live(signal);
    const probe = receiptVersion === 2 ? deps.probeV2 : deps.probe;
    const commit = receiptVersion === 2 ? deps.commitV2 : deps.commit;
    check(typeof probe === 'function' && typeof commit === 'function');

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        let latestReceiptCurrent = null;
        let latestReceiptSha256 = null;
        let latestReceiptSeq = null;
        const lookupReceipt = async () => {
          const checked = checkedProbe(
            await call(() => probe.call(deps, actor, {
              ...identity, update: new Uint8Array(update),
            }, signal), signal),
            identity, actor, update, updateSha256, receiptVersion,
          );
          latestReceiptCurrent = checked.current;
          latestReceiptSha256 = checked.updateSha256 ?? null;
          latestReceiptSeq = checked.receipt?.seq ?? null;
          return checked.receipt;
        };
        const adapter = {
          lookupReceipt,
          readFixedCheckpoint: async () => checkedCheckpoint(
            await call(() => deps.readFixedCheckpoint(actor, {
              documentId: identity.documentId, generationId: identity.generationId,
              contentModelVersion: 2,
            }, signal), signal), identity, actor,
          ),
          readFixedTailPage: async page => checkedTail(
            await call(() => deps.readFixedTailPage(token, {
              documentId: identity.documentId, generationId: identity.generationId,
              contentModelVersion: 2, afterSeq: page.afterSeq,
              throughSeq: page.throughSeq, limit: page.limit,
            }, signal), signal), identity, actor, page,
          ),
        };
        const admitted = await admitAnnotationGenerationAggregate({
          ...identity, actorUserId: actor, update,
          checkpointPolicy: 'when-reader-limit', signal,
        }, adapter);
        live(signal);
        if (admitted.kind === 'accepted-retry') {
          check(latestReceiptSeq === admitted.receipt.seq
            && latestReceiptSha256 === admitted.receipt.updateSha256);
          return response(200, { result: receiptResult(admitted.receipt, identity, actor,
            receiptVersion, latestReceiptCurrent) });
        }
        const committed = await call(() => commit.call(deps, actor, {
          ...identity, update: new Uint8Array(admitted.update), expectedHead: admitted.expectedHead,
          sourceCheckpoint: { ...admitted.sourceCheckpoint },
          checkpoint: admitted.checkpoint === null ? null : {
            ...admitted.checkpoint, bytes: new Uint8Array(admitted.checkpoint.bytes),
          },
        }, signal), signal);
        live(signal);
        const checked = checkedCommit(committed, identity, actor, updateSha256, admitted,
          receiptVersion);
        if (checked.needsReceiptProof) {
          const receipt = await lookupReceipt();
          check(receipt !== null && receipt.seq === checked.result.seq);
          return response(200, { result: receiptResult({ ...receipt,
            updateSha256: latestReceiptSha256 }, identity, actor,
            receiptVersion, latestReceiptCurrent) });
        }
        return response(200, { result: checked.result });
      } catch (error) {
        if (error?.code === '40001' && attempt < MAX_ATTEMPTS) continue;
        if (error?.code === '40001') fail('aggregate_changed');
        throw error;
      }
    }
    fail('aggregate_changed');
  } catch (error) {
    return publicError(error);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}
