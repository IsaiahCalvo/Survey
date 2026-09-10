import { createDetachedYDoc } from '../../../src/lib/collab/ydocRegistry.js';
import { materializeAnnotationGenerationStateForOpen }
  from '../../../src/services/annotationGenerationState.js';
import * as Y from 'yjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_UPDATE_BYTES = 16 * 1024 * 1024;
const MAX_READER_REPLAY_BYTES = 64 * 1024 * 1024;
const MAX_FINAL_STATE_BYTES = 64 * 1024 * 1024;
const MAX_STORED_CHECKPOINT_BYTES = 64 * 1024 * 1024;
const MAX_AGGREGATE_INPUT_BYTES = MAX_READER_REPLAY_BYTES + MAX_UPDATE_BYTES;
const MAX_TAIL_PAGES = 1_000;
const TAIL_PAGE_LIMIT = 1_000;
const MAX_TAIL_ROWS = MAX_TAIL_PAGES * TAIL_PAGE_LIMIT;

const INPUT_KEYS = ['actorUserId', 'checkpointPolicy', 'clientSeq', 'contentModelVersion',
  'documentId', 'generationId', 'signal', 'update', 'writerId'];
const INPUT_REQUIRED_KEYS = ['actorUserId', 'clientSeq', 'contentModelVersion', 'documentId',
  'generationId', 'update', 'writerId'];
const RECEIPT_KEYS = ['actorUserId', 'clientSeq', 'contentModelVersion', 'documentId',
  'generationId', 'seq', 'update', 'writerId'];
const CHECKPOINT_RESULT_KEYS = ['actorUserId', 'baseSeq', 'checkpoint', 'contentModelVersion',
  'documentId', 'generationId', 'head'];
const CHECKPOINT_KEYS = ['atSeq', 'encodingVersion', 'snapshot', 'snapshotSha256',
  'writerEpoch', 'writerId'];
const TAIL_PAGE_KEYS = ['actorUserId', 'contentModelVersion', 'documentId', 'generationId',
  'hasMore', 'rows', 'throughSeq'];
const TAIL_ROW_KEYS = ['actorUserId', 'clientSeq', 'seq', 'update', 'writerId'];

function admissionError(code, reason = null) {
  const error = Object.assign(new Error(code), { code });
  if (reason !== null) error.reason = reason;
  if (code === 'ANNOTATION_AGGREGATE_WORK_LIMIT') error.maintenanceNeeded = true;
  return error;
}

function fail(code, reason = null) {
  throw admissionError(code, reason);
}

function captureObject(value, requiredKeys, allowedKeys, code = 'ANNOTATION_AGGREGATE_PROTOCOL') {
  if (value === null || typeof value !== 'object'
    || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some(key => !Object.hasOwn(descriptors, key))) fail(code);
  const owned = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(code);
    owned[key] = descriptor.value;
  }
  return owned;
}

function captureArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail('ANNOTATION_AGGREGATE_PROTOCOL');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, 'length')) {
    fail('ANNOTATION_AGGREGATE_PROTOCOL');
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('ANNOTATION_AGGREGATE_PROTOCOL');
    }
    result.push(descriptor.value);
  }
  return result;
}

function uuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function writer(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 512;
}

function decimal(value, { positive = false } = {}) {
  if (!['string', 'number', 'bigint'].includes(typeof value)) {
    fail('ANNOTATION_AGGREGATE_INPUT');
  }
  let normalized;
  try {
    normalized = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    fail('ANNOTATION_AGGREGATE_INPUT');
  }
  if ((typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
    || (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value))
    || normalized < (positive ? 1n : 0n)
    || normalized > 9223372036854775807n) fail('ANNOTATION_AGGREGATE_INPUT');
  return normalized.toString();
}

function ownBytes(value, code = 'ANNOTATION_AGGREGATE_INPUT') {
  if (!(value instanceof Uint8Array)) fail(code);
  return new Uint8Array(value);
}

function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function protocolDecimal(value, options) {
  if (typeof value !== 'string') fail('ANNOTATION_AGGREGATE_PROTOCOL');
  try { return decimal(value, options); }
  catch { fail('ANNOTATION_AGGREGATE_PROTOCOL'); }
}

function checkedScope(value, identity) {
  if (value.documentId !== identity.documentId
    || value.generationId !== identity.generationId
    || value.actorUserId !== identity.actorUserId
    || value.contentModelVersion !== 2) fail('ANNOTATION_AGGREGATE_PROTOCOL');
}

function checkedWriterPair(writerId, writerEpoch) {
  const epoch = protocolDecimal(writerEpoch);
  if ((writerId === null && epoch !== '0') || (writerId !== null && (!writer(writerId) || epoch === '0'))) {
    fail('ANNOTATION_AGGREGATE_PROTOCOL');
  }
  return { writerId, writerEpoch: epoch };
}

async function readGzipBounded(bytes, maximum, signal) {
  if (typeof DecompressionStream !== 'function') fail('ANNOTATION_AGGREGATE_WORK_LIMIT', 'gzip-runtime');
  let stream;
  try { stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')); }
  catch { fail('ANNOTATION_AGGREGATE_STATE'); }
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      live(signal);
      let item;
      try { item = await reader.read(); } catch { fail('ANNOTATION_AGGREGATE_STATE'); }
      live(signal);
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maximum) fail('ANNOTATION_AGGREGATE_WORK_LIMIT', 'checkpoint-expanded-bytes');
      chunks.push(new Uint8Array(item.value));
    }
  } finally {
    try { await reader.cancel(); } catch { /* stream already closed */ }
    try { reader.releaseLock(); } catch { /* pending read */ }
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

async function gzipBounded(bytes, maximum, signal) {
  if (typeof CompressionStream !== 'function') return null;
  const reader = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')).getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      live(signal);
      const item = await reader.read();
      live(signal);
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maximum) return null;
      chunks.push(new Uint8Array(item.value));
    }
  } finally {
    try { await reader.cancel(); } catch { /* stream already closed */ }
    try { reader.releaseLock(); } catch { /* pending read */ }
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function applyChecked(doc, bytes) {
  try { Y.applyUpdate(doc, bytes); } catch { fail('ANNOTATION_AGGREGATE_STATE'); }
}

function requireCompleteModel2(doc) {
  if (doc.store.pendingStructs || doc.store.pendingDs) fail('ANNOTATION_AGGREGATE_STATE');
  for (const structs of doc.store.clients.values()) {
    if (structs.some(struct => struct?.constructor?.name === 'Skip')) {
      fail('ANNOTATION_AGGREGATE_STATE');
    }
  }
  try { materializeAnnotationGenerationStateForOpen(doc, 2); }
  catch { fail('ANNOTATION_AGGREGATE_STATE'); }
}

async function checkedAcceptedReceipt(receiptValue, identity, update, signal, expectedSeq = null) {
  const receipt = captureObject(
    receiptValue,
    RECEIPT_KEYS,
    RECEIPT_KEYS,
    'ANNOTATION_AGGREGATE_PROTOCOL',
  );
  const receiptUpdate = ownBytes(receipt.update, 'ANNOTATION_AGGREGATE_PROTOCOL');
  const receiptSeq = protocolDecimal(receipt.seq, { positive: true });
  if (receipt.documentId !== identity.documentId
    || receipt.generationId !== identity.generationId
    || receipt.actorUserId !== identity.actorUserId
    || receipt.contentModelVersion !== 2
    || receipt.writerId !== identity.writerId
    || typeof receipt.clientSeq !== 'string' || receipt.clientSeq !== identity.clientSeq) {
    fail('ANNOTATION_AGGREGATE_PROTOCOL');
  }
  if (expectedSeq !== null && receiptSeq !== expectedSeq) {
    fail('ANNOTATION_AGGREGATE_STATE');
  }
  if (!sameBytes(receiptUpdate, update)) fail('23505');
  const updateSha256 = await sha256(update);
  live(signal);
  return Object.freeze({
    kind: 'accepted-retry',
    receipt: Object.freeze({
      seq: receiptSeq,
      actorUserId: identity.actorUserId,
      writerId: identity.writerId,
      clientSeq: identity.clientSeq,
      updateSha256,
    }),
  });
}

function live(signal) {
  if (signal?.aborted) fail('ANNOTATION_AGGREGATE_ABORTED');
}

function limit(value, maximum) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail('ANNOTATION_AGGREGATE_INPUT');
  }
  return value;
}

function checkedLimits(value = {}) {
  const owned = captureObject(value, [], [
    'maxAggregateInputBytes', 'maxFinalStateBytes', 'maxReaderReplayBytes',
    'maxStoredCheckpointBytes', 'maxTailPages', 'maxTailRows', 'maxUpdateBytes',
    'tailPageLimit',
  ], 'ANNOTATION_AGGREGATE_INPUT');
  return Object.freeze({
    maxUpdateBytes: limit(owned.maxUpdateBytes, MAX_UPDATE_BYTES),
    maxReaderReplayBytes: limit(owned.maxReaderReplayBytes, MAX_READER_REPLAY_BYTES),
    maxFinalStateBytes: limit(owned.maxFinalStateBytes, MAX_FINAL_STATE_BYTES),
    maxStoredCheckpointBytes: limit(
      owned.maxStoredCheckpointBytes,
      MAX_STORED_CHECKPOINT_BYTES,
    ),
    maxAggregateInputBytes: limit(owned.maxAggregateInputBytes, MAX_AGGREGATE_INPUT_BYTES),
    tailPageLimit: limit(owned.tailPageLimit, TAIL_PAGE_LIMIT),
    maxTailPages: limit(owned.maxTailPages, MAX_TAIL_PAGES),
    maxTailRows: limit(owned.maxTailRows, MAX_TAIL_ROWS),
  });
}

/**
 * Rebuild and check one proposed model-2 WAL append from trusted, fixed-head
 * storage reads. This module does not commit. Its result is consumed by a
 * private SQL compare-and-swap which repeats the receipt lookup and scope lock.
 *
 * Byte and row bounds limit deterministic input work. Yjs decode/apply/encode
 * remain synchronous and are not a hard JavaScript heap or wall-time bound;
 * deployment still needs worker isolation and limits.
 */
export async function admitAnnotationGenerationAggregate(input, adapter, limitOverrides = {}) {
  const owned = captureObject(
    input,
    INPUT_REQUIRED_KEYS,
    INPUT_KEYS,
    'ANNOTATION_AGGREGATE_INPUT',
  );
  if (!uuid(owned.documentId) || !uuid(owned.generationId) || !uuid(owned.actorUserId)
    || owned.contentModelVersion !== 2 || !writer(owned.writerId)
    || (owned.checkpointPolicy !== undefined
      && !['when-reader-limit', 'maintenance'].includes(owned.checkpointPolicy))
    || (owned.signal !== undefined && (owned.signal === null
      || typeof owned.signal !== 'object' || typeof owned.signal.aborted !== 'boolean'))
    || adapter === null || typeof adapter !== 'object'
    || typeof adapter.lookupReceipt !== 'function'
    || typeof adapter.readFixedCheckpoint !== 'function'
    || typeof adapter.readFixedTailPage !== 'function') {
    fail('ANNOTATION_AGGREGATE_INPUT');
  }
  const clientSeq = decimal(owned.clientSeq, { positive: true });
  const update = ownBytes(owned.update);
  const signal = owned.signal;
  const limits = checkedLimits(limitOverrides);
  const identity = Object.freeze({
    documentId: owned.documentId,
    generationId: owned.generationId,
    actorUserId: owned.actorUserId,
    contentModelVersion: 2,
    writerId: owned.writerId,
    clientSeq,
    signal,
  });
  live(signal);

  const receiptValue = await adapter.lookupReceipt(identity);
  live(signal);
  if (receiptValue !== null) {
    return checkedAcceptedReceipt(receiptValue, identity, update, signal);
  }

  if (update.length > limits.maxUpdateBytes) fail('SG004', 'update-bytes');

  const checkpointValue = await adapter.readFixedCheckpoint(Object.freeze({
    documentId: identity.documentId,
    generationId: identity.generationId,
    actorUserId: identity.actorUserId,
    contentModelVersion: 2,
    signal,
  }));
  live(signal);
  const fixed = captureObject(
    checkpointValue,
    CHECKPOINT_RESULT_KEYS,
    CHECKPOINT_RESULT_KEYS,
    'ANNOTATION_AGGREGATE_PROTOCOL',
  );
  checkedScope(fixed, identity);
  const head = protocolDecimal(fixed.head);
  const baseSeq = protocolDecimal(fixed.baseSeq);
  if (head === '9223372036854775807') fail('22003', 'sequence-exhausted');
  const checkpoint = captureObject(
    fixed.checkpoint,
    CHECKPOINT_KEYS,
    CHECKPOINT_KEYS,
    'ANNOTATION_AGGREGATE_PROTOCOL',
  );
  const atSeq = protocolDecimal(checkpoint.atSeq);
  if (BigInt(baseSeq) > BigInt(atSeq) || BigInt(atSeq) > BigInt(head)
    || ![1, 2].includes(checkpoint.encodingVersion)
    || typeof checkpoint.snapshotSha256 !== 'string' || !SHA256.test(checkpoint.snapshotSha256)) {
    fail('ANNOTATION_AGGREGATE_PROTOCOL');
  }
  const pair = checkedWriterPair(checkpoint.writerId, checkpoint.writerEpoch);
  const storedSnapshot = ownBytes(checkpoint.snapshot, 'ANNOTATION_AGGREGATE_PROTOCOL');
  if (storedSnapshot.length < 1) fail('ANNOTATION_AGGREGATE_STATE');
  if (storedSnapshot.length > limits.maxStoredCheckpointBytes) {
    fail('ANNOTATION_AGGREGATE_WORK_LIMIT', 'checkpoint-stored-bytes');
  }
  if (await sha256(storedSnapshot) !== checkpoint.snapshotSha256) {
    fail('ANNOTATION_AGGREGATE_STATE');
  }
  live(signal);
  const baseline = checkpoint.encodingVersion === 2
    ? await readGzipBounded(storedSnapshot, limits.maxFinalStateBytes, signal)
    : storedSnapshot;
  live(signal);
  let aggregateInputBytes = baseline.length + update.length;
  if (aggregateInputBytes > limits.maxAggregateInputBytes) {
    fail('ANNOTATION_AGGREGATE_WORK_LIMIT', 'aggregate-input-bytes');
  }

  const doc = createDetachedYDoc(`aggregate-admission:${identity.documentId}:${identity.generationId}`);
  let cursor = atSeq;
  let rawTailBytes = 0;
  let tailRows = 0;
  let tailPages = 0;
  const tailReceiptKeys = new Set();
  let racedReceiptSeq = null;
  try {
    applyChecked(doc, baseline);
    while (BigInt(cursor) < BigInt(head)) {
      if (tailPages >= limits.maxTailPages) {
        fail('ANNOTATION_AGGREGATE_WORK_LIMIT', 'tail-pages');
      }
      tailPages += 1;
      const pageValue = await adapter.readFixedTailPage(Object.freeze({
        documentId: identity.documentId,
        generationId: identity.generationId,
        actorUserId: identity.actorUserId,
        contentModelVersion: 2,
        afterSeq: cursor,
        throughSeq: head,
        limit: limits.tailPageLimit,
        signal,
      }));
      live(signal);
      const page = captureObject(
        pageValue,
        TAIL_PAGE_KEYS,
        TAIL_PAGE_KEYS,
        'ANNOTATION_AGGREGATE_PROTOCOL',
      );
      checkedScope(page, identity);
      if (page.throughSeq !== head || typeof page.hasMore !== 'boolean') {
        fail('ANNOTATION_AGGREGATE_PROTOCOL');
      }
      const rows = captureArray(page.rows);
      if (rows.length > limits.tailPageLimit || rows.length === 0) {
        fail('ANNOTATION_AGGREGATE_STATE');
      }
      for (const rowValue of rows) {
        const row = captureObject(
          rowValue,
          TAIL_ROW_KEYS,
          TAIL_ROW_KEYS,
          'ANNOTATION_AGGREGATE_PROTOCOL',
        );
        const seq = protocolDecimal(row.seq, { positive: true });
        if (BigInt(seq) !== BigInt(cursor) + 1n || BigInt(seq) > BigInt(head)
          || !uuid(row.actorUserId) || !writer(row.writerId)
          || typeof row.clientSeq !== 'string'
          || protocolDecimal(row.clientSeq, { positive: true }) !== row.clientSeq) {
          fail('ANNOTATION_AGGREGATE_STATE');
        }
        const rowUpdate = ownBytes(row.update, 'ANNOTATION_AGGREGATE_PROTOCOL');
        // The 16 MiB row limit applies only to this proposed new insert. Older
        // accepted rows remain readable while the aggregate work budget holds.
        if (rowUpdate.length < 1) fail('ANNOTATION_AGGREGATE_STATE');
        tailRows += 1;
        if (tailRows > limits.maxTailRows) fail('ANNOTATION_AGGREGATE_WORK_LIMIT', 'tail-rows');
        const receiptKey = JSON.stringify([row.actorUserId, row.writerId, row.clientSeq]);
        if (tailReceiptKeys.has(receiptKey)) fail('ANNOTATION_AGGREGATE_STATE');
        tailReceiptKeys.add(receiptKey);
        if (row.actorUserId === identity.actorUserId
          && row.writerId === identity.writerId && row.clientSeq === identity.clientSeq) {
          racedReceiptSeq = seq;
        }
        rawTailBytes += rowUpdate.length;
        aggregateInputBytes += rowUpdate.length;
        if (aggregateInputBytes > limits.maxAggregateInputBytes) {
          fail('ANNOTATION_AGGREGATE_WORK_LIMIT', 'aggregate-input-bytes');
        }
        applyChecked(doc, rowUpdate);
        cursor = seq;
      }
      if (BigInt(cursor) < BigInt(head) && !page.hasMore) fail('ANNOTATION_AGGREGATE_STATE');
      if (BigInt(cursor) === BigInt(head) && page.hasMore) fail('ANNOTATION_AGGREGATE_STATE');
    }
    if (cursor !== head) fail('ANNOTATION_AGGREGATE_STATE');
    if (racedReceiptSeq !== null) {
      // The initial probe missed, but the fixed tail observed the same receipt
      // key. Re-probe after every page/row check so a malformed later duplicate
      // cannot hide behind the race. The receipt remains the sole byte proof;
      // this raced path has already paid fixed-checkpoint/tail read bounds, but
      // must not depend on applying the proposal or encoding current state.
      const racedReceipt = await adapter.lookupReceipt(identity);
      live(signal);
      if (racedReceipt === null) fail('ANNOTATION_AGGREGATE_STATE');
      return checkedAcceptedReceipt(
        racedReceipt,
        identity,
        update,
        signal,
        racedReceiptSeq,
      );
    }
    applyChecked(doc, update);
    requireCompleteModel2(doc);
    const finalUpdate = new Uint8Array(Y.encodeStateAsUpdate(doc));
    if (finalUpdate.length > limits.maxFinalStateBytes) fail('SG004', 'final-state-bytes');
    const finalSha256 = await sha256(finalUpdate);
    live(signal);
    const nextSeq = (BigInt(head) + 1n).toString();
    const replayBytes = baseline.length + rawTailBytes + update.length;
    const checkpointReason = owned.checkpointPolicy === 'maintenance'
      ? 'maintenance'
      : replayBytes > limits.maxReaderReplayBytes ? 'reader-replay-limit' : null;
    let nextCheckpoint = null;
    if (checkpointReason !== null) {
      const compressed = await gzipBounded(finalUpdate, limits.maxStoredCheckpointBytes, signal);
      live(signal);
      const useCompressed = compressed !== null && compressed.length < finalUpdate.length;
      const checkpointBytes = useCompressed ? compressed : finalUpdate;
      if (checkpointBytes.length > limits.maxStoredCheckpointBytes) {
        fail('ANNOTATION_AGGREGATE_WORK_LIMIT', 'checkpoint-output-bytes');
      }
      nextCheckpoint = Object.freeze({
        reason: checkpointReason,
        atSeq: nextSeq,
        encodingVersion: useCompressed ? 2 : 1,
        bytes: checkpointBytes,
        snapshotSha256: await sha256(checkpointBytes),
      });
      live(signal);
    }
    return Object.freeze({
      kind: 'admitted',
      expectedHead: head,
      nextSeq,
      sourceCheckpoint: Object.freeze({
        documentId: identity.documentId,
        generationId: identity.generationId,
        contentModelVersion: 2,
        atSeq,
        writerId: pair.writerId,
        writerEpoch: pair.writerEpoch,
        encodingVersion: checkpoint.encodingVersion,
        snapshotSha256: checkpoint.snapshotSha256,
      }),
      update,
      finalState: Object.freeze({ byteLength: finalUpdate.length, sha256: finalSha256 }),
      checkpoint: nextCheckpoint,
    });
  } finally {
    try { doc.destroy(); } catch { /* detached work document */ }
  }
}
