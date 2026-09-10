import { computeContentSha256 } from './contentHash.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POSITIVE_INT64 = /^[1-9][0-9]{0,18}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_INT64 = 9223372036854775807n;
const MAX_UPDATE_BYTES = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;
const INPUT_KEYS = ['actorUserId', 'clientSeq', 'contentModelVersion', 'documentId',
  'generationId', 'signal', 'update', 'writerId'];
const REQUIRED_INPUT_KEYS = INPUT_KEYS.filter(key => key !== 'signal');
const RESULT_KEYS = ['actor_user_id', 'client_id', 'client_seq', 'content_model_version',
  'data_sha256', 'document_id', 'generation_id', 'seq', 'status', 'version'];
const RESULT_V2_KEYS = ['actor_user_id', 'client_id', 'client_seq', 'content_model_version',
  'current_generation_id', 'data_sha256', 'document_id', 'generation_id', 'is_current',
  'seq', 'status', 'version'];
const ERROR_KEYS = ['code', 'message'];
const ERROR_REASON_KEYS = ['code', 'message', 'reason'];
const WORK_REASONS = new Set(['aggregate-input-bytes', 'checkpoint-expanded-bytes',
  'checkpoint-output-bytes', 'checkpoint-stored-bytes', 'gzip-runtime', 'tail-pages', 'tail-rows']);
const ERROR_MAP = Object.freeze({
  invalid_request: [400, 'ANNOTATION_AGGREGATE_PROTOCOL'],
  unauthorized: [401, 'ANNOTATION_ACTOR_MISMATCH'],
  unavailable: [503, 'ANNOTATION_AGGREGATE_UNAVAILABLE'],
  transport_limit: [413, 'ANNOTATION_AGGREGATE_TRANSPORT_LIMIT'],
  request_aborted: [503, 'ANNOTATION_AGGREGATE_UNCONFIRMED'],
  not_permitted: [403, '42501'],
  generation_changed: [409, 'SG002'],
  receipt_conflict: [409, '23505'],
  aggregate_changed: [409, '40001'],
  maintenance_required: [409, 'ANNOTATION_AGGREGATE_WORK_LIMIT'],
  annotation_generation_capacity: [409, 'SG004'],
  invalid_broker_response: [502, 'ANNOTATION_AGGREGATE_UNCONFIRMED'],
  unconfirmed: [502, 'ANNOTATION_AGGREGATE_UNCONFIRMED'],
});
const INTERNAL_ERRORS = new WeakSet();

function transportError(code, reason = null) {
  const error = Object.assign(new Error(code), { code });
  if (reason !== null) error.reason = reason;
  INTERNAL_ERRORS.add(error);
  return error;
}

function fail(code, reason = null) {
  throw transportError(code, reason);
}

function check(value, code = 'ANNOTATION_AGGREGATE_PROTOCOL') {
  if (!value) fail(code);
}

function exactObject(value, keys) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string')
    || [...ownKeys].sort().some((key, index) => key !== keys[index])) return null;
  if (keys.some(key => !descriptors[key]?.enumerable
    || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function exactInput(value) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string')
    || keys.some(key => !INPUT_KEYS.includes(key))
    || REQUIRED_INPUT_KEYS.some(key => !keys.includes(key))
    || keys.some(key => !descriptors[key]?.enumerable
      || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

const uuid = value => typeof value === 'string' && UUID.test(value);
function wellFormedString(value) {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

const writer = value => wellFormedString(value) && value.length >= 1 && value.length <= 512;
const positiveInt64 = value => typeof value === 'string' && POSITIVE_INT64.test(value)
  && BigInt(value) <= MAX_INT64;

function assertLive(signal) {
  if (signal?.aborted) fail('ANNOTATION_AGGREGATE_UNCONFIRMED');
}

function call(operation, signal) {
  assertLive(signal);
  if (!signal) return Promise.resolve().then(operation);
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted);
      reject(transportError('ANNOTATION_AGGREGATE_UNCONFIRMED'));
    };
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => { assertLive(signal); return operation(); }).then(
      value => {
        try {
          assertLive(signal);
          resolve(value);
        } catch (error) {
          if (value instanceof Response) {
            try { void value.body?.cancel().catch(() => {}); } catch { /* late body already ended */ }
          }
          reject(error);
        }
      },
      reject,
    ).finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function readBoundedResponse(response, signal) {
  check(response instanceof Response);
  const reader = response.body?.getReader();
  check(reader);
  const chunks = [];
  let length = 0;
  let stated = null;
  try {
    const contentType = response.headers.get('content-type');
    check(typeof contentType === 'string'
      && contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json');
    stated = response.headers.get('content-length');
    if (stated !== null) {
      check(stated.length <= 19 && /^(0|[1-9][0-9]*)$/.test(stated));
      check(BigInt(stated) <= BigInt(MAX_RESPONSE_BYTES));
    }
    for (;;) {
      assertLive(signal);
      const item = await call(() => reader.read(), signal);
      assertLive(signal);
      if (item.done) break;
      check(item.value instanceof Uint8Array);
      length += item.value.byteLength;
      check(length <= MAX_RESPONSE_BYTES);
      chunks.push(new Uint8Array(item.value));
    }
  } finally {
    try { void reader.cancel().catch(() => {}); } catch { /* body already ended */ }
    try { reader.releaseLock(); } catch { /* aborted body */ }
  }
  check(stated === null || BigInt(stated) === BigInt(length));
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('ANNOTATION_AGGREGATE_PROTOCOL'); }
  try { return JSON.parse(text); } catch { fail('ANNOTATION_AGGREGATE_PROTOCOL'); }
}

function checkedError(response, body) {
  const top = exactObject(body, ['error']);
  check(top);
  const code = top.error?.code;
  const detail = code === 'maintenance_required'
    ? (exactObject(top.error, ERROR_REASON_KEYS) || exactObject(top.error, ERROR_KEYS))
    : exactObject(top.error, ERROR_KEYS);
  check(detail && typeof detail.code === 'string' && typeof detail.message === 'string');
  const mapped = ERROR_MAP[detail.code];
  check(mapped && response.status === mapped[0]);
  if (detail.code === 'maintenance_required') {
    check(detail.reason === undefined || WORK_REASONS.has(detail.reason));
    fail(mapped[1], detail.reason ?? null);
  }
  fail(mapped[1]);
}

function checkedReceipt(body, identity, updateSha256, receiptVersion) {
  const top = exactObject(body, ['result']);
  check(top);
  const receipt = exactObject(top.result, receiptVersion === 2 ? RESULT_V2_KEYS : RESULT_KEYS);
  check(receipt && receipt.version === receiptVersion && receipt.status === 'accepted'
    && receipt.document_id === identity.documentId
    && receipt.generation_id === identity.generationId
    && receipt.content_model_version === 2
    && receipt.actor_user_id === identity.actorUserId
    && receipt.client_id === identity.writerId
    && receipt.client_seq === identity.clientSeq
    && positiveInt64(receipt.seq)
    && typeof receipt.data_sha256 === 'string' && SHA256.test(receipt.data_sha256)
    && receipt.data_sha256 === updateSha256);
  if (receiptVersion === 2) {
    check((receipt.current_generation_id === null || uuid(receipt.current_generation_id))
      && typeof receipt.is_current === 'boolean'
      && receipt.is_current === (receipt.current_generation_id === identity.generationId));
  }
  return Object.freeze({ documentId: identity.documentId, generationId: identity.generationId,
    contentModelVersion: 2, actorUserId: identity.actorUserId, writerId: identity.writerId,
    clientSeq: identity.clientSeq, seq: receipt.seq, updateSha256,
    ...(receiptVersion === 2 ? { currentGenerationId: receipt.current_generation_id,
      isCurrent: receipt.is_current } : {}),
  });
}

/**
 * Creates a portable, default-off client for the checked aggregate handler.
 * The injected request adapter owns the captured bearer-token lifetime and any
 * request deadline. A successful result proves only that these exact bytes were
 * accepted. Version 2 also returns locked current-generation observation, not
 * present access authority. This client has no legacy write fallback.
 */
export function createAnnotationGenerationAggregateTransport(options) {
  const ownedOptions = exactObject(options, ['request'])
    || exactObject(options, ['receiptVersion', 'request']);
  check(ownedOptions && typeof ownedOptions.request === 'function');
  const request = ownedOptions.request;
  const receiptVersion = Object.hasOwn(ownedOptions, 'receiptVersion')
    ? ownedOptions.receiptVersion : 1;
  check(receiptVersion === 1 || receiptVersion === 2);

  return Object.freeze({
    async submit(value) {
      const raw = exactInput(value);
      check(raw && uuid(raw.documentId) && uuid(raw.generationId) && uuid(raw.actorUserId)
        && raw.contentModelVersion === 2 && writer(raw.writerId) && positiveInt64(raw.clientSeq)
        && ArrayBuffer.isView(raw.update) && raw.update instanceof Uint8Array
        && raw.update.byteLength > 0
        && raw.update.byteLength <= MAX_UPDATE_BYTES
        && (raw.signal === undefined || raw.signal instanceof AbortSignal));
      const identity = Object.freeze({ documentId: raw.documentId, generationId: raw.generationId,
        contentModelVersion: 2, actorUserId: raw.actorUserId, writerId: raw.writerId,
        clientSeq: raw.clientSeq });
      const signal = raw.signal;
      const requestBody = new Blob([raw.update], { type: 'application/octet-stream' });
      assertLive(signal);
      let updateSha256;
      try {
        updateSha256 = await computeContentSha256(new Uint8Array(await requestBody.arrayBuffer()));
      } catch (error) {
        if (INTERNAL_ERRORS.has(error)
          && error.code === 'ANNOTATION_AGGREGATE_UNCONFIRMED') throw error;
        fail('ANNOTATION_AGGREGATE_UNCONFIRMED');
      }
      assertLive(signal);
      const params = new URLSearchParams();
      params.set('document_id', identity.documentId);
      params.set('generation_id', identity.generationId);
      params.set('content_model_version', '2');
      params.set('client_id', identity.writerId);
      params.set('client_seq', identity.clientSeq);
      if (receiptVersion === 2) params.set('receipt_version', '2');
      const headers = Object.freeze({ 'Content-Type': 'application/octet-stream' });
      let response;
      try {
        response = await call(() => request(Object.freeze({
          functionName: `annotation-generation-aggregate?${params}`,
          body: requestBody, headers, signal,
        })), signal);
      } catch {
        fail('ANNOTATION_AGGREGATE_UNCONFIRMED');
      }
      assertLive(signal);
      let responseBody;
      try {
        responseBody = await readBoundedResponse(response, signal);
      } catch (error) {
        if (INTERNAL_ERRORS.has(error)
          && (error.code === 'ANNOTATION_AGGREGATE_PROTOCOL'
            || error.code === 'ANNOTATION_AGGREGATE_UNCONFIRMED')) throw error;
        fail('ANNOTATION_AGGREGATE_UNCONFIRMED');
      }
      assertLive(signal);
      if (response.status !== 200) checkedError(response, responseBody);
      check(response.status === 200);
      return checkedReceipt(responseBody, identity, updateSha256, receiptVersion);
    },
  });
}
