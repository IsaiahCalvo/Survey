import * as Y from 'yjs';
import { normalizeAnnotationSequence } from './annotationSequence.js';
import { computeContentSha256 } from './contentHash.js';

const DB_NAME = 'survey-annotation-outbox-v2';
const DB_VERSION = 4;
const RETIRED_STORE = 'retiredScopes';
const PENDING_STORE = 'pending';
const ACCEPTED_STORE = 'accepted';
const QUARANTINE_STORE = 'quarantined';
const CHECKPOINT_STORE = 'acceptedCheckpoints';
const INCARNATION_STORE = 'documentIncarnations';
const REQUEST_TIMEOUT_MS = 10_000;
const COMPACT_AFTER_DELTAS = 40;
const ACCEPTED_RECEIPT_PROOF_VERSION = 1;
const ACCEPTED_RECEIPT_PROOF_MIN_SAVINGS_BYTES = 256;
const RECEIPT_PROOF_REQUIRED = 'ANNOTATION_ACCEPTED_RECEIPT_PROOF_REQUIRED';
const GENERATED_RECEIPT_FIELDS = [
  'key', 'scopeKey', 'pdfGenerationId', 'contentModelVersion', 'documentId',
  'actorUserId', 'incarnation', 'ordinal', 'writerId', 'clientSeq', 'editEpoch',
  'publishAfterAcceptance', 'historyTag', 'status', 'dependsOn', 'update',
  'checkpointUpdate',
];
const GENERATED_RECEIPT_METADATA_FIELDS = GENERATED_RECEIPT_FIELDS.filter(
  key => key !== 'update' && key !== 'checkpointUpdate',
);

function actorScopeKey(documentId, actorUserId) {
  return `${documentId}\u0000${actorUserId}`;
}

function cloneBytes(value) {
  return value == null ? null : new Uint8Array(value);
}

function cloneRecord(record) {
  return {
    ...record,
    update: cloneBytes(record.update),
    ...(record.checkpointUpdate == null ? {} : { checkpointUpdate: cloneBytes(record.checkpointUpdate) }),
    ...(record.dependsOn == null ? {} : { dependsOn: [...record.dependsOn] }),
  };
}

function cloneReceiptProof(proof) {
  return proof && structuredClone(proof);
}

function sortedReceiptProofs(proofs = []) {
  return [...proofs].sort((left, right) => String(left.key).localeCompare(String(right.key)))
    .map(cloneReceiptProof);
}

function acceptedReceiptProofCandidate(record) {
  const keys = Object.keys(record || {}).filter(key => key !== 'seq').sort();
  if (!record || keys.join('|') !== [...GENERATED_RECEIPT_FIELDS].sort().join('|')
    || !(record.update instanceof Uint8Array)
    || !(record.checkpointUpdate instanceof Uint8Array)) return null;
  let metadata = {};
  for (const key of GENERATED_RECEIPT_METADATA_FIELDS) {
    Object.defineProperty(metadata, key, {
      value: record[key], enumerable: true, configurable: true, writable: true,
    });
  }
  try { metadata = structuredClone(metadata); } catch { return null; }
  const proof = {
    version: ACCEPTED_RECEIPT_PROOF_VERSION,
    key: record.key,
    metadata,
    updateSha256: '0'.repeat(64),
    updateByteLength: record.update.length,
    checkpointUpdateSha256: '0'.repeat(64),
    checkpointUpdateByteLength: record.checkpointUpdate.length,
    seq: normalizedAcceptedSequence(record),
  };
  try {
    const checked = checkedReceiptProofs({ scopeKey: record.scopeKey,
      acceptedKeys: [record.key], acceptedReceiptProofs: [proof] })[0];
    const encoder = new TextEncoder();
    const fullBytes = record.update.length + record.checkpointUpdate.length;
    const proofBytes = encoder.encode(JSON.stringify(checked)).length
      + encoder.encode(JSON.stringify(record.key)).length;
    return { metadata, fullBytes, proofBytes };
  } catch { return null; }
}

async function acceptedReceiptProof(record) {
  const candidate = acceptedReceiptProofCandidate(record);
  if (!candidate) return null;
  const update = cloneBytes(record.update);
  const checkpointUpdate = cloneBytes(record.checkpointUpdate);
  const [updateSha256, checkpointUpdateSha256] = await Promise.all([
    computeContentSha256(update),
    computeContentSha256(checkpointUpdate),
  ]);
  const proof = {
    version: ACCEPTED_RECEIPT_PROOF_VERSION,
    key: record.key,
    metadata: candidate.metadata,
    updateSha256,
    updateByteLength: update.length,
    checkpointUpdateSha256,
    checkpointUpdateByteLength: checkpointUpdate.length,
    seq: normalizedAcceptedSequence(record),
  };
  try {
    return checkedReceiptProofs({ scopeKey: record.scopeKey,
      acceptedKeys: [record.key], acceptedReceiptProofs: [proof] })[0];
  } catch { return null; }
}

function sameReceiptProofBase(left, right) {
  return left?.version === ACCEPTED_RECEIPT_PROOF_VERSION
    && right?.version === ACCEPTED_RECEIPT_PROOF_VERSION
    && ['key', 'updateSha256', 'updateByteLength',
      'checkpointUpdateSha256', 'checkpointUpdateByteLength']
      .every(key => left[key] === right[key])
    && sameReceiptValue(left.metadata, right.metadata);
}

function receiptProofSequence(proof) {
  if (proof.seq === null) return null;
  return normalizedAcceptedSequence({ seq: proof.seq });
}

function checkedReceiptProofs(checkpoint, expectedScopeKey = checkpoint?.scopeKey) {
  const proofs = checkpoint?.acceptedReceiptProofs;
  if (proofs == null) return [];
  if (!Array.isArray(proofs)) throw scopeError('Accepted annotation receipt proofs are invalid');
  const acceptedKeys = new Set(checkpoint?.acceptedKeys || []);
  const seen = new Set();
  for (const proof of proofs) {
    const keys = Object.keys(proof || {}).sort().join('|');
    if (keys !== ['checkpointUpdateByteLength', 'checkpointUpdateSha256', 'key', 'metadata',
      'seq', 'updateByteLength', 'updateSha256', 'version'].sort().join('|')
      || proof.version !== ACCEPTED_RECEIPT_PROOF_VERSION
      || typeof proof.key !== 'string' || !acceptedKeys.has(proof.key) || seen.has(proof.key)
      || !/^[0-9a-f]{64}$/.test(proof.updateSha256 || '')
      || !Number.isSafeInteger(proof.updateByteLength) || proof.updateByteLength < 0
      || !/^[0-9a-f]{64}$/.test(proof.checkpointUpdateSha256 || '')
      || !Number.isSafeInteger(proof.checkpointUpdateByteLength)
      || proof.checkpointUpdateByteLength < 0
      || !proof.metadata || typeof proof.metadata !== 'object' || Array.isArray(proof.metadata)
      || Object.keys(proof.metadata).sort().join('|') !== [...GENERATED_RECEIPT_METADATA_FIELDS].sort().join('|')
      || proof.metadata.key !== proof.key
      || proof.metadata.status !== 'accepted'
      || proof.metadata.contentModelVersion !== 2
      || proof.metadata.scopeKey !== expectedScopeKey
      || proof.metadata.scopeKey !== generationScopeKey(
        proof.metadata.documentId, proof.metadata.actorUserId, proof.metadata,
      )
      || proof.metadata.key !== annotationOutboxRecordKey(proof.metadata)
      || !Number.isSafeInteger(proof.metadata.incarnation) || proof.metadata.incarnation < 0
      || !Number.isSafeInteger(proof.metadata.ordinal) || proof.metadata.ordinal < 0
      || !Number.isSafeInteger(proof.metadata.clientSeq) || proof.metadata.clientSeq <= 0
      || !Number.isSafeInteger(proof.metadata.editEpoch) || proof.metadata.editEpoch < 0
      || typeof proof.metadata.writerId !== 'string' || !proof.metadata.writerId
      || typeof proof.metadata.publishAfterAcceptance !== 'boolean'
      || !Array.isArray(proof.metadata.dependsOn)
      || proof.metadata.dependsOn.some(key => typeof key !== 'string'
        || !key.startsWith(proof.metadata.scopeKey + '\u0000'))
      || !sameReceiptValue(proof.metadata.dependsOn,
        [...new Set(proof.metadata.dependsOn)].sort())
      || !(proof.metadata.historyTag === null || (
        proof.metadata.historyTag && typeof proof.metadata.historyTag === 'object'
        && !Array.isArray(proof.metadata.historyTag)
        && Object.keys(proof.metadata.historyTag).sort().join('|') === 'historyKind|mutationId'
        && typeof proof.metadata.historyTag.historyKind === 'string'
        && typeof proof.metadata.historyTag.mutationId === 'string'
      ))) {
      throw scopeError('Accepted annotation receipt proofs are invalid');
    }
    receiptProofSequence(proof);
    seen.add(proof.key);
  }
  return sortedReceiptProofs(proofs);
}

function checkedReceiptConflicts(checkpoint, expectedScopeKey = checkpoint?.scopeKey) {
  const conflicts = checkpoint?.acceptedReceiptConflicts;
  if (conflicts == null) return [];
  if (!Array.isArray(conflicts)) throw scopeError('Accepted annotation receipt conflicts are invalid');
  const seen = new Set();
  return conflicts.map(conflict => {
    if (Object.keys(conflict || {}).sort().join('|') !== 'key|kind|version'
      || conflict.version !== 1 || conflict.kind !== 'ambiguous-23505'
      || typeof conflict.key !== 'string' || !conflict.key.startsWith(expectedScopeKey + '\u0000')
      || seen.has(conflict.key)) throw scopeError('Accepted annotation receipt conflicts are invalid');
    seen.add(conflict.key);
    return { ...conflict };
  }).sort((left, right) => left.key.localeCompare(right.key));
}

function assertConflictEvidence(conflicts, acceptedProofs, acceptedRecords) {
  const proofByKey = new Map((acceptedProofs || []).map(proof => [proof.key, proof]));
  const recordByKey = new Map((acceptedRecords || []).map(record => [record.key, record]));
  if (conflicts.some(conflict => {
    const proof = proofByKey.get(conflict.key);
    const record = recordByKey.get(conflict.key);
    return (!proof && !record)
      || (proof && receiptProofSequence(proof) !== null)
      || (record && normalizedAcceptedSequence(record) !== null);
  })) {
    throw scopeError('Accepted annotation receipt conflict has no durable evidence');
  }
}

function assertOneAcceptedEvidenceForm(acceptedKeys, acceptedRecords) {
  const compacted = new Set(acceptedKeys || []);
  if ((acceptedRecords || []).some(record => compacted.has(record.key))) {
    throw scopeError('Accepted annotation receipt has conflicting durable evidence');
  }
}

function sameReceiptProofs(left = [], right = []) {
  return left.length === right.length && left.every((proof, index) => (
    sameReceiptValue(proof, right[index])
  ));
}

function staleIncarnationError(documentId) {
  const error = new Error(`annotation document ${documentId} incarnation is stale`);
  error.code = 'ANNOTATION_DOCUMENT_DELETED';
  return error;
}

function requestResult(request, transaction, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      try { transaction?.abort(); } catch { /* transaction already closed */ }
      const error = new Error('IndexedDB request timed out');
      error.code = 'ETIMEDOUT';
      finish(reject, error);
    }, timeoutMs);
    request.onsuccess = () => finish(resolve, request.result);
    request.onerror = () => finish(
      reject,
      request.error || new Error('IndexedDB request failed'),
    );
  });
}

function transactionCompletion(transaction, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      try { transaction.abort(); } catch { /* transaction already closed */ }
      const error = new Error('IndexedDB transaction timed out');
      error.code = 'ETIMEDOUT';
      finish(reject, error);
    }, timeoutMs);
    transaction.oncomplete = () => finish(resolve);
    transaction.onerror = () => finish(
      reject,
      transaction.error || new Error('IndexedDB transaction failed'),
    );
    transaction.onabort = () => finish(
      reject,
      transaction.error || new Error('IndexedDB transaction aborted'),
    );
  });
}

async function openDatabase(indexedDb, timeoutMs, existingOnly = false) {
  const request = existingOnly ? indexedDb.open(DB_NAME) : indexedDb.open(DB_NAME, DB_VERSION);
  const db = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      const error = new Error('IndexedDB open timed out');
      error.code = 'ETIMEDOUT';
      finish(reject, error);
    }, timeoutMs);
    request.onblocked = () => {
      const error = new Error('IndexedDB open blocked');
      error.code = 'IDB_BLOCKED';
      finish(reject, error);
    };
    request.onerror = () => finish(
      reject,
      request.error || new Error('IndexedDB open failed'),
    );
    request.onupgradeneeded = () => {
      if (existingOnly) {
        request.transaction.abort();
        const error = new Error('Persistent annotation database is missing');
        error.code = 'ANNOTATION_LOCAL_STORAGE_UNAVAILABLE';
        finish(reject, error);
        return;
      }
      const opened = request.result;
      for (const name of [PENDING_STORE, ACCEPTED_STORE, QUARANTINE_STORE]) {
        if (!opened.objectStoreNames.contains(name)) {
          const store = opened.createObjectStore(name, { keyPath: 'key' });
          store.createIndex('scopeKey', 'scopeKey', { unique: false });
        }
      }
      if (!opened.objectStoreNames.contains(CHECKPOINT_STORE)) {
        opened.createObjectStore(CHECKPOINT_STORE, { keyPath: 'scopeKey' });
      }
      if (!opened.objectStoreNames.contains(INCARNATION_STORE)) {
        opened.createObjectStore(INCARNATION_STORE, { keyPath: 'documentId' });
      }
      if (!opened.objectStoreNames.contains(RETIRED_STORE)) {
        opened.createObjectStore(RETIRED_STORE, { keyPath: 'scopeKey' });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        try { request.result?.close(); } catch { /* late blocked/open result */ }
        return;
      }
      finish(resolve, request.result);
    };
  });
  db.onversionchange = () => db.close();
  return db;
}

function normalizePendingRecord(record) {
  if (!record?.documentId || !record?.actorUserId || !record?.key) {
    throw new Error('outbox record requires documentId, actorUserId, and key');
  }
  return {
    ...cloneRecord(record),
    scopeKey: actorScopeKey(record.documentId, record.actorUserId),
  };
}

// Both implementations share transaction-level scope rules. Memory is not
// durable; only IndexedDB transaction completion is a persistent receipt.
function scopeError(message = 'Annotation outbox scope does not match') {
  return Object.assign(new Error(message), { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
}

function pdfGeneration(options) {
  const value = options?.pdfGenerationId;
  if (value == null) return null;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw scopeError('pdfGenerationId must be a canonical UUID or null');
  }
  return value;
}

function contentModel(options) {
  const value = options?.contentModelVersion;
  if (value == null) return 1;
  if (value !== 1 && value !== 2) throw scopeError('contentModelVersion must be 1 or 2');
  return value;
}

function legacyGenerationScopeKey(documentId, actorUserId, options) {
  const generation = pdfGeneration(options);
  if (generation == null) return actorScopeKey(documentId, actorUserId);
  if (!documentId || !actorUserId || [documentId, actorUserId].some(value => typeof value !== 'string' || value.includes('\u0000'))) {
    throw scopeError('Generated outbox scope requires exact document and actor IDs');
  }
  return actorScopeKey(documentId, actorUserId) + '\u0000pdf-generation\u0000' + generation;
}

function generationScopeKey(documentId, actorUserId, options) {
  const scopeKey = legacyGenerationScopeKey(documentId, actorUserId, options);
  return pdfGeneration(options) != null && contentModel(options) === 2
    ? scopeKey + '\u0000content-model\u0000' + String(contentModel(options)) : scopeKey;
}

/** Null/absent generation retains the historical key byte-for-byte. */
export function annotationOutboxRecordKey({ documentId, actorUserId, writerId, clientSeq,
  pdfGenerationId, contentModelVersion }) {
  const scopeKey = generationScopeKey(documentId, actorUserId, { pdfGenerationId, contentModelVersion });
  if (pdfGenerationId != null && (
    typeof writerId !== 'string' || !writerId || writerId.includes('\u0000')
    || !Number.isSafeInteger(clientSeq) || clientSeq < 0
  )) throw scopeError('Generated outbox key requires an exact writer and sequence');
  return [scopeKey, writerId, clientSeq].join('\u0000');
}

function normalizedRecord(record) {
  const normalized = normalizePendingRecord(record);
  const generation = pdfGeneration(record);
  normalized.scopeKey = generationScopeKey(record.documentId, record.actorUserId, record);
  if (generation != null) {
    if (contentModel(record) === 2 && record.contentModelVersion !== 2) throw scopeError();
    requireIncarnation(record.incarnation);
    if (record.key !== annotationOutboxRecordKey(record)) throw scopeError();
    if (record.dependsOn != null && (!Array.isArray(record.dependsOn)
      || record.dependsOn.some(key => typeof key !== 'string' || !key.startsWith(normalized.scopeKey + '\u0000')))) {
      throw scopeError('Outbox dependencies cannot cross PDF generations');
    }
  }
  return normalized;
}

function retiredError(marker, evidence = {}) {
  return Object.assign(new Error('Annotation PDF generation is retired; saved edits require recovery review'), {
    code: 'ANNOTATION_PDF_GENERATION_RETIRED',
    pdfGenerationId: marker.pdfGenerationId,
    replacementGenerationId: marker.replacementGenerationId,
    ...evidence,
  });
}

function assertKeyScope(record, options) {
  const generation = pdfGeneration(options);
  if (!record) return;
  if (generation !== pdfGeneration(record) || contentModel(options) !== contentModel(record)
    || (options?.documentId != null && options.documentId !== record.documentId)
    || (options?.actorUserId != null && options.actorUserId !== record.actorUserId)
    || (generation != null && (!options?.documentId || !options?.actorUserId))) throw scopeError();
}

function requireIncarnation(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw scopeError('An exact document incarnation is required');
}

function sameBytes(left, right) {
  return left?.length === right?.length && [...(left || [])].every((byte, index) => byte === right[index]);
}

function assertSameEvidence(existing, record) {
  if (!existing) return;
  if (['key', 'documentId', 'actorUserId', 'writerId', 'clientSeq', 'ordinal'].some(key => existing[key] !== record[key])
    || (Number(existing.incarnation) || 0) !== (Number(record.incarnation) || 0)
    || pdfGeneration(existing) !== pdfGeneration(record)
    || contentModel(existing) !== contentModel(record)
    || !sameBytes(existing.update, record.update)
    || (existing.checkpointUpdate != null && !sameBytes(existing.checkpointUpdate, record.checkpointUpdate))
    || JSON.stringify(existing.dependsOn || []) !== JSON.stringify(record.dependsOn || [])) {
    throw scopeError('An outbox identity cannot replace saved annotation bytes or dependencies');
  }
}

function sameReceiptValue(left, right) {
  if (left === right) return true;
  if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    return ArrayBuffer.isView(left) && ArrayBuffer.isView(right) && sameBytes(left, right);
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  const keys = Object.keys(left).sort(), otherKeys = Object.keys(right).sort();
  return keys.length === otherKeys.length && keys.every((key, index) => key === otherKeys[index] && sameReceiptValue(left[key], right[key]));
}

function normalizedAcceptedSequence(record) {
  if (!Object.hasOwn(record, 'seq')) return null;
  let value;
  try { value = normalizeAnnotationSequence(record.seq); }
  catch { throw scopeError('Accepted annotation sequence is invalid'); }
  if (value === 0) throw scopeError('Accepted annotation sequence must be positive');
  return value;
}

function acceptedReceiptResolution(existing, incoming) {
  const existingSequence = normalizedAcceptedSequence(existing);
  const incomingSequence = normalizedAcceptedSequence(incoming);
  const existingBase = { ...existing }, incomingBase = { ...incoming };
  delete existingBase.seq; delete incomingBase.seq;
  if (!sameReceiptValue(existingBase, incomingBase)
    || (existingSequence !== null && incomingSequence !== null
      && existingSequence !== incomingSequence)) {
    throw scopeError('An accepted annotation receipt is immutable');
  }
  return {
    sequence: existingSequence ?? incomingSequence,
    enrich: existingSequence === null && incomingSequence !== null,
  };
}

function quarantineRecord(record) {
  return { ...cloneRecord(record), originalStatus: record.originalStatus ?? record.status, status: 'generation-retired' };
}

const ALL_STORES = [PENDING_STORE, ACCEPTED_STORE, QUARANTINE_STORE, CHECKPOINT_STORE, INCARNATION_STORE, RETIRED_STORE];
const sortedRecords = records => records.sort((left, right) => (
  (left.ordinal || 0) - (right.ordinal || 0) || String(left.key).localeCompare(String(right.key))
)).map(cloneRecord);

function buildOutbox({ storageKind, run, close, readFresh }) {
  const incarnation = async (stores, documentId, expected) => {
    const current = Number((await stores[INCARNATION_STORE].get(documentId))?.incarnation) || 0;
    if (expected != null && current !== (Number(expected) || 0)) throw staleIncarnationError(documentId);
    return current;
  };
  const markerFor = (stores, scopeKey) => stores[RETIRED_STORE].get(scopeKey);
  const assertOpen = async (stores, scopeKey) => {
    const marker = await markerFor(stores, scopeKey);
    if (marker) throw retiredError(marker);
  };
  const assertNoOtherModelEvidence = async (stores, documentId, actorUserId, options) => {
    if (pdfGeneration(options) == null) return;
    const legacyKey = legacyGenerationScopeKey(documentId, actorUserId, options);
    const otherKey = contentModel(options) === 2 ? legacyKey
      : legacyKey + '\u0000content-model\u00002';
    const rows = await Promise.all([PENDING_STORE, ACCEPTED_STORE, QUARANTINE_STORE]
      .map(name => stores[name].hasAny(otherKey)));
    const [checkpoint, retired] = await Promise.all([
      stores[CHECKPOINT_STORE].get(otherKey), stores[RETIRED_STORE].get(otherKey),
    ]);
    if (rows.some(Boolean) || checkpoint || retired) {
      throw scopeError('Saved annotations use another content model');
    }
  };
  const scopedRead = (storeName, documentId, actorUserId, options) => {
    const scopeKey = generationScopeKey(documentId, actorUserId, options);
    return run(ALL_STORES, 'readonly', async stores => {
      await assertNoOtherModelEvidence(stores, documentId, actorUserId, options);
      await assertOpen(stores, scopeKey);
      return sortedRecords(await stores[storeName].getAll(scopeKey));
    });
  };
  const localState = (documentId, actorUserId, expectedIncarnation, options, retiredOnly = false) => {
    const scopeKey = generationScopeKey(documentId, actorUserId, options);
    return run(ALL_STORES, 'readonly', async stores => {
      await assertNoOtherModelEvidence(stores, documentId, actorUserId, options);
      const current = await incarnation(stores, documentId, expectedIncarnation);
      const marker = await markerFor(stores, scopeKey);
      if (retiredOnly && !marker) throw scopeError('The requested annotation scope is not retired');
      if (!retiredOnly && marker) throw retiredError(marker);
      const checkpoint = await stores[CHECKPOINT_STORE].get(scopeKey);
      const [accepted, pending, quarantined] = await Promise.all(
        [ACCEPTED_STORE, PENDING_STORE, QUARANTINE_STORE].map(name => stores[name].getAll(scopeKey)),
      );
      const acceptedKeys = [...(checkpoint?.acceptedKeys || [])];
      const acceptedReceiptProofs = checkedReceiptProofs(checkpoint, scopeKey);
      const acceptedReceiptConflicts = checkedReceiptConflicts(checkpoint, scopeKey);
      assertOneAcceptedEvidenceForm(acceptedKeys, accepted);
      assertConflictEvidence(acceptedReceiptConflicts, acceptedReceiptProofs, accepted);
      return {
        documentId, actorUserId, incarnation: current,
        ...(pdfGeneration(options) == null ? {} : { pdfGenerationId: pdfGeneration(options) }),
        ...(retiredOnly ? { retirement: { ...marker } } : {}),
        checkpointUpdate: cloneBytes(checkpoint?.update), acceptedKeys,
        acceptedReceiptProofs, acceptedReceiptConflicts,
        accepted: sortedRecords(accepted), pending: sortedRecords(pending), quarantined: sortedRecords(quarantined),
      };
    });
  };
  const mutateKeys = (keys, expectedIncarnation, options, reject = false) => {
    if (pdfGeneration(options) != null) {
      requireIncarnation(expectedIncarnation);
      generationScopeKey(options?.documentId, options?.actorUserId, options);
    }
    if (!keys?.length) return Promise.resolve();
    return run(ALL_STORES, 'readwrite', async stores => {
      await assertNoOtherModelEvidence(stores, options?.documentId, options?.actorUserId, options);
      if (pdfGeneration(options) != null) await incarnation(stores, options.documentId, expectedIncarnation);
      const records = await Promise.all(keys.map(key => stores[PENDING_STORE].get(key)));
      for (let index = 0; index < keys.length; index += 1) {
        const evidence = records[index] || await stores[QUARANTINE_STORE].get(keys[index])
          || await stores[ACCEPTED_STORE].get(keys[index]);
        assertKeyScope(evidence, options);
        if (evidence) await assertOpen(stores, evidence.scopeKey);
      }
      if (options?.documentId && options?.actorUserId) {
        await assertOpen(stores, generationScopeKey(options.documentId, options.actorUserId, options));
      }
      for (const record of records) {
        if (!record || (expectedIncarnation != null
          && (Number(record.incarnation) || 0) !== (Number(expectedIncarnation) || 0))) continue;
        if (reject) {
          const rejected = { ...record, status: 'rejected' };
          await stores[PENDING_STORE].put(rejected);
          await stores[QUARANTINE_STORE].put(rejected);
        } else await stores[PENDING_STORE].delete(record.key);
      }
    });
  };
  const api = {
    storageKind,
    async list(documentId, actorUserId, options) { return scopedRead(PENDING_STORE, documentId, actorUserId, options); },
    async listQuarantined(documentId, actorUserId, options) { return scopedRead(QUARANTINE_STORE, documentId, actorUserId, options); },
    async readLocalState(documentId, actorUserId, expectedIncarnation, options) {
      return localState(documentId, actorUserId, expectedIncarnation, options);
    },
    async readRetiredScope(documentId, actorUserId, expectedIncarnation, options) {
      return localState(documentId, actorUserId, expectedIncarnation, options, true);
    },
    async getDocumentIncarnation(documentId) {
      return run([INCARNATION_STORE], 'readonly', stores => incarnation(stores, documentId));
    },
    async assertScopeCurrent(documentId, actorUserId, expectedIncarnation, options) {
      const scopeKey = generationScopeKey(documentId, actorUserId, options);
      if (pdfGeneration(options) != null) requireIncarnation(expectedIncarnation);
      return run(ALL_STORES, 'readonly', async stores => {
        await assertNoOtherModelEvidence(stores, documentId, actorUserId, options);
        await incarnation(stores, documentId, expectedIncarnation);
        await assertOpen(stores, scopeKey);
      });
    },
    async put(record) {
      const normalized = normalizedRecord(record);
      const marker = await run(ALL_STORES, 'readwrite', async stores => {
        await assertNoOtherModelEvidence(stores, record.documentId, record.actorUserId, record);
        await incarnation(stores, record.documentId, Number(record.incarnation) || 0);
        const retired = await markerFor(stores, normalized.scopeKey);
        let quarantined, accepted;
        for (const name of [PENDING_STORE, ACCEPTED_STORE, QUARANTINE_STORE]) {
          const existing = await stores[name].get(record.key);
          if (existing && existing.scopeKey !== normalized.scopeKey) throw scopeError();
          if (pdfGeneration(record) != null || retired) assertSameEvidence(existing, normalized);
          if (name === QUARANTINE_STORE) quarantined = existing;
          if (name === ACCEPTED_STORE) accepted = existing;
        }
        if (pdfGeneration(record) != null || retired) {
          const checkpoint = await stores[CHECKPOINT_STORE].get(normalized.scopeKey);
          if (checkpoint?.acceptedKeys?.includes(record.key)) throw scopeError('A compacted annotation identity cannot be put again');
        }
        if (retired) await stores[QUARANTINE_STORE].put(quarantineRecord(quarantined || normalized));
        else if (!accepted || pdfGeneration(record) == null) await stores[PENDING_STORE].put(normalized);
        return retired;
      });
      // Throw after commit: queued old edits must survive without authorizing replay.
      if (marker) throw retiredError(marker, { evidenceSaved: true });
    },
    async delete(key, expectedIncarnation = null, options) { return mutateKeys([key], expectedIncarnation, options); },
    async deleteMany(keys, expectedIncarnation = null, options) { return mutateKeys(keys, expectedIncarnation, options); },
    async markRejected(keys, expectedIncarnation = null, options) { return mutateKeys(keys, expectedIncarnation, options, true); },
    async deleteFromOrdinal(documentId, actorUserId, writerId, ordinal, expectedIncarnation = null, options) {
      const scopeKey = generationScopeKey(documentId, actorUserId, options);
      if (pdfGeneration(options) != null) requireIncarnation(expectedIncarnation);
      return run(ALL_STORES, 'readwrite', async stores => {
        await assertNoOtherModelEvidence(stores, documentId, actorUserId, options);
        if (pdfGeneration(options) != null) await incarnation(stores, documentId, expectedIncarnation);
        await assertOpen(stores, scopeKey);
        for (const record of await stores[PENDING_STORE].getAll(scopeKey)) {
          if (record.writerId === writerId && record.ordinal >= ordinal
            && (expectedIncarnation == null || (Number(record.incarnation) || 0) === (Number(expectedIncarnation) || 0))) {
            await stores[PENDING_STORE].delete(record.key);
          }
        }
      });
    },
    async settleAccepted(record, settlement = {}) {
      const acceptedRecord = { ...record, status: 'accepted' };
      if (pdfGeneration(record) != null) {
        const sequence = normalizedAcceptedSequence(record);
        if (sequence === null) delete acceptedRecord.seq;
        else acceptedRecord.seq = sequence;
      }
      const normalized = normalizedRecord(acceptedRecord);
      const settle = incomingProof => run(ALL_STORES, 'readwrite', async stores => {
        await assertNoOtherModelEvidence(stores, record.documentId, record.actorUserId, record);
        await incarnation(stores, record.documentId, Number(record.incarnation) || 0);
        const retired = await markerFor(stores, normalized.scopeKey);
        if (pdfGeneration(record) != null || retired) {
          const checkpoint = await stores[CHECKPOINT_STORE].get(normalized.scopeKey);
          if (checkpoint?.acceptedKeys?.includes(record.key)) {
            const proofs = checkedReceiptProofs(checkpoint);
            const conflicts = checkedReceiptConflicts(checkpoint);
            const existingProof = proofs.find(proof => proof.key === record.key);
            // Historical acceptedKeys intentionally carry no per-receipt proof.
            // Keep their old one-way fence rather than inferring evidence.
            if (!existingProof) {
              throw scopeError('A compacted annotation identity cannot be settled again');
            }
            if (!incomingProof) throw Object.assign(new Error('Accepted receipt proof required'), {
              code: RECEIPT_PROOF_REQUIRED,
            });
            if (!sameReceiptProofBase(existingProof, incomingProof)) {
              throw scopeError('A compacted annotation identity cannot be settled again');
            }
            const existingSequence = receiptProofSequence(existingProof);
            const incomingSequence = receiptProofSequence(incomingProof);
            if (existingSequence !== null && incomingSequence !== null
              && existingSequence !== incomingSequence) {
              throw scopeError('An accepted annotation receipt is immutable');
            }
            if (settlement?.receiptConflict === true) {
              if (incomingSequence !== null) {
                throw scopeError('A conflict report cannot supply an annotation receipt sequence');
              }
              if (existingSequence !== null) {
                if (conflicts.some(item => item.key === record.key)) {
                  await stores[CHECKPOINT_STORE].put({ ...checkpoint,
                    acceptedReceiptConflicts: conflicts.filter(item => item.key !== record.key) });
                }
                return { ...(retired ? { retired } : {}), receiptVerified: true, seq: existingSequence };
              }
              const acceptedReceiptConflicts = [...conflicts.filter(item => item.key !== record.key),
                { version: 1, key: record.key, kind: 'ambiguous-23505' }]
                .sort((left, right) => left.key.localeCompare(right.key));
              await stores[CHECKPOINT_STORE].put({ ...checkpoint, acceptedReceiptConflicts });
            } else if (incomingSequence !== null) {
              const acceptedReceiptProofs = existingSequence === null
                ? proofs.map(proof => proof.key === record.key
                  ? { ...proof, seq: incomingSequence } : proof)
                : proofs;
              await stores[CHECKPOINT_STORE].put({ ...checkpoint, acceptedReceiptProofs,
                acceptedReceiptConflicts: conflicts.filter(item => item.key !== record.key) });
            }
            return { retired };
          }
        }
        let known = false, accepted;
        for (const name of [PENDING_STORE, ACCEPTED_STORE, QUARANTINE_STORE]) {
          const existing = await stores[name].get(record.key);
          if (existing && existing.scopeKey !== normalized.scopeKey) throw scopeError();
          if (existing) known = true;
          if (pdfGeneration(record) != null || retired) assertSameEvidence(existing, normalized);
          if (name === ACCEPTED_STORE) accepted = existing;
        }
        if (accepted && (pdfGeneration(record) != null || retired)) {
          if (pdfGeneration(record) != null) {
            const resolution = acceptedReceiptResolution(accepted, normalized);
            const existingSequence = normalizedAcceptedSequence(accepted);
            const incomingSequence = normalizedAcceptedSequence(normalized);
            const checkpoint = await stores[CHECKPOINT_STORE].get(normalized.scopeKey);
            const conflicts = checkedReceiptConflicts(checkpoint);
            if (settlement?.receiptConflict === true) {
              if (incomingSequence !== null) {
                throw scopeError('A conflict report cannot supply an annotation receipt sequence');
              }
              if (existingSequence !== null) {
                if (conflicts.some(item => item.key === record.key)) {
                  await stores[CHECKPOINT_STORE].put({ ...checkpoint,
                    acceptedReceiptConflicts: conflicts.filter(item => item.key !== record.key) });
                }
                return { ...(retired ? { retired } : {}), receiptVerified: true, seq: existingSequence };
              }
              const acceptedReceiptConflicts = [...conflicts.filter(item => item.key !== record.key),
                { version: 1, key: record.key, kind: 'ambiguous-23505' }]
                .sort((left, right) => left.key.localeCompare(right.key));
              await stores[CHECKPOINT_STORE].put({ ...(checkpoint || { scopeKey: normalized.scopeKey }),
                acceptedReceiptConflicts });
            } else {
              if (resolution.enrich) {
                await stores[ACCEPTED_STORE].put({ ...accepted, seq: resolution.sequence });
              }
              if (conflicts.some(item => item.key === record.key)) {
                await stores[CHECKPOINT_STORE].put({ ...checkpoint,
                  acceptedReceiptConflicts: conflicts.filter(item => item.key !== record.key) });
              }
            }
          } else if (!sameReceiptValue(accepted, normalized)) {
            throw scopeError('An accepted annotation receipt is immutable');
          }
          return { retired };
        }
        if (settlement?.receiptConflict === true) {
          throw scopeError('Only exact accepted evidence can record an ambiguous WAL result');
        }
        if (pdfGeneration(record) != null || retired) {
          if (retired && !known) {
            throw scopeError('Unknown retired annotation receipt');
          }
        }
        await stores[ACCEPTED_STORE].put(normalized);
        await stores[PENDING_STORE].delete(normalized.key);
        return { retired };
      });
      let outcome;
      try { outcome = await settle(null); }
      catch (error) {
        if (error?.code !== RECEIPT_PROOF_REQUIRED) throw error;
        const incomingProof = await acceptedReceiptProof(normalized);
        if (!incomingProof) throw scopeError('A compacted annotation identity cannot be settled again');
        outcome = await settle(incomingProof);
      }
      if (outcome?.retired) {
        throw retiredError(outcome.retired, { evidenceSaved: true, acceptedEvidenceSaved: true });
      }
      return outcome;
    },
    async loadCleanState(documentId, actorUserId, options) {
      const scopeKey = generationScopeKey(documentId, actorUserId, options);
      return run(ALL_STORES, 'readonly', async stores => {
        await assertNoOtherModelEvidence(stores, documentId, actorUserId, options);
        await assertOpen(stores, scopeKey);
        const checkpoint = await stores[CHECKPOINT_STORE].get(scopeKey);
        const records = sortedRecords(await stores[ACCEPTED_STORE].getAll(scopeKey));
        const acceptedKeys = [...(checkpoint?.acceptedKeys || [])];
        const acceptedReceiptProofs = checkedReceiptProofs(checkpoint, scopeKey);
        const acceptedReceiptConflicts = checkedReceiptConflicts(checkpoint, scopeKey);
        assertOneAcceptedEvidenceForm(acceptedKeys, records);
        assertConflictEvidence(acceptedReceiptConflicts, acceptedReceiptProofs, records);
        return { checkpointUpdate: cloneBytes(checkpoint?.update), acceptedKeys,
          acceptedReceiptProofs, acceptedReceiptConflicts, records };
      });
    },
    async compactAccepted(documentId, actorUserId, acceptedSnapshot, force = false, expectedIncarnation = 0, options) {
      const scopeKey = generationScopeKey(documentId, actorUserId, options);
      if (pdfGeneration(options) != null && contentModel(options) === 2) {
        const firstPass = await run(ALL_STORES, 'readwrite', async stores => {
          await assertNoOtherModelEvidence(stores, documentId, actorUserId, options);
          await incarnation(stores, documentId, expectedIncarnation);
          await assertOpen(stores, scopeKey);
          const checkpoint = await stores[CHECKPOINT_STORE].get(scopeKey);
          const records = sortedRecords(await stores[ACCEPTED_STORE].getAll(scopeKey));
          const existingProofs = checkedReceiptProofs(checkpoint, scopeKey);
          const existingConflicts = checkedReceiptConflicts(checkpoint, scopeKey);
          const sequenceKnown = [];
          const proofCandidates = [];
          for (const record of records) {
            if (normalizedAcceptedSequence(record) !== null) sequenceKnown.push(record);
            else {
              const candidate = acceptedReceiptProofCandidate(record);
              if (candidate && candidate.fullBytes >= candidate.proofBytes
                + ACCEPTED_RECEIPT_PROOF_MIN_SAVINGS_BYTES) proofCandidates.push(record);
            }
          }
          if (!force && sequenceKnown.length + proofCandidates.length < COMPACT_AFTER_DELTAS) {
            return { changed: false, proofCandidates: [] };
          }
          const updates = [checkpoint?.update, acceptedSnapshot,
            ...records.map(record => record.update)].filter(Boolean).map(cloneBytes);
          let changed = false;
          if (updates.length) {
            const update = Y.mergeUpdates(updates);
            const acceptedKeys = [...new Set([
              ...(checkpoint?.acceptedKeys || []), ...sequenceKnown.map(record => record.key),
            ])];
            const sameCheckpoint = checkpoint?.update && sameBytes(checkpoint.update, update)
              && (checkpoint.acceptedKeys || []).length === acceptedKeys.length
              && acceptedKeys.every((key, index) => checkpoint.acceptedKeys[index] === key);
            if (sequenceKnown.length || !sameCheckpoint) {
              await stores[CHECKPOINT_STORE].put({ scopeKey, update, acceptedKeys,
                acceptedReceiptProofs: existingProofs,
                acceptedReceiptConflicts: existingConflicts });
              changed = true;
            }
          }
          for (const record of sequenceKnown) await stores[ACCEPTED_STORE].delete(record.key);
          return { changed, proofCandidates: proofCandidates.map(cloneRecord) };
        });
        const scannedProofs = new Map();
        for (const record of firstPass.proofCandidates) {
          const proof = await acceptedReceiptProof(record);
          if (proof) scannedProofs.set(record.key, proof);
        }
        if (!scannedProofs.size) return firstPass.changed;
        const proofChanged = await run(ALL_STORES, 'readwrite', async stores => {
          await assertNoOtherModelEvidence(stores, documentId, actorUserId, options);
          await incarnation(stores, documentId, expectedIncarnation);
          await assertOpen(stores, scopeKey);
          const checkpoint = await stores[CHECKPOINT_STORE].get(scopeKey);
          const records = sortedRecords(await stores[ACCEPTED_STORE].getAll(scopeKey));
          const existingProofs = checkedReceiptProofs(checkpoint, scopeKey);
          const existingConflicts = checkedReceiptConflicts(checkpoint, scopeKey);
          const scannedByKey = new Map(firstPass.proofCandidates.map(record => [record.key, record]));
          const compactableRecords = records.filter(record => {
            const scanned = scannedByKey.get(record.key);
            return scanned && sameReceiptValue(scanned, record)
              && normalizedAcceptedSequence(record) === null && scannedProofs.has(record.key);
          });
          if (!compactableRecords.length) return false;
          const update = Y.mergeUpdates([checkpoint?.update, acceptedSnapshot,
            ...records.map(record => record.update)].filter(Boolean).map(cloneBytes));
          const acceptedKeys = [...new Set([...(checkpoint?.acceptedKeys || []),
            ...compactableRecords.map(record => record.key)])];
          const proofByKey = new Map(existingProofs.map(proof => [proof.key, proof]));
          for (const record of compactableRecords) {
            const proof = scannedProofs.get(record.key);
            const existing = proofByKey.get(record.key);
            if (existing && !sameReceiptValue(existing, proof)) {
              throw scopeError('An accepted annotation receipt proof cannot change');
            }
            proofByKey.set(record.key, proof);
          }
          await stores[CHECKPOINT_STORE].put({ scopeKey, update, acceptedKeys,
            acceptedReceiptProofs: sortedReceiptProofs([...proofByKey.values()]),
            acceptedReceiptConflicts: existingConflicts });
          for (const record of compactableRecords) await stores[ACCEPTED_STORE].delete(record.key);
          return true;
        });
        return firstPass.changed || proofChanged;
      }
      return run(ALL_STORES, 'readwrite', async stores => {
        await assertNoOtherModelEvidence(stores, documentId, actorUserId, options);
        await incarnation(stores, documentId, expectedIncarnation);
        await assertOpen(stores, scopeKey);
        const checkpoint = await stores[CHECKPOINT_STORE].get(scopeKey);
        const records = sortedRecords(await stores[ACCEPTED_STORE].getAll(scopeKey));
        const existingProofs = checkedReceiptProofs(checkpoint);
        const existingConflicts = checkedReceiptConflicts(checkpoint);
        const compactableRecords = pdfGeneration(options) == null
          ? records : records.filter(record => normalizedAcceptedSequence(record) !== null);
        if (!force && compactableRecords.length < COMPACT_AFTER_DELTAS) return false;
        const updates = [checkpoint?.update, acceptedSnapshot, ...records.map(record => record.update)].filter(Boolean).map(cloneBytes);
        if (updates.length) {
          const update = Y.mergeUpdates(updates);
          const acceptedKeys = [...new Set([
            ...(checkpoint?.acceptedKeys || []),
            ...compactableRecords.map(record => record.key),
          ])];
          const proofByKey = new Map(existingProofs.map(proof => [proof.key, proof]));
          const acceptedReceiptProofs = sortedReceiptProofs([...proofByKey.values()]);
          if (!compactableRecords.length && checkpoint?.update && sameBytes(checkpoint.update, update)
            && (checkpoint.acceptedKeys || []).length === acceptedKeys.length
            && acceptedKeys.every((key, index) => checkpoint.acceptedKeys[index] === key)
            && sameReceiptProofs(existingProofs, acceptedReceiptProofs)) return false;
          await stores[CHECKPOINT_STORE].put({ scopeKey, update, acceptedKeys, acceptedReceiptProofs,
            acceptedReceiptConflicts: existingConflicts });
        }
        for (const record of compactableRecords) await stores[ACCEPTED_STORE].delete(record.key);
        return true;
      });
    },
    async retireScope(documentId, actorUserId, expectedIncarnation, options = {}) {
      requireIncarnation(expectedIncarnation);
      const scopeKey = generationScopeKey(documentId, actorUserId, options);
      const replacementGenerationId = pdfGeneration({ pdfGenerationId: options.replacementGenerationId });
      if (!replacementGenerationId || replacementGenerationId === pdfGeneration(options)
        || options.reason !== 'cloud-generation-replaced' || expectedIncarnation == null) throw scopeError('Invalid PDF generation retirement');
      return run(ALL_STORES, 'readwrite', async stores => {
        await assertNoOtherModelEvidence(stores, documentId, actorUserId, options);
        const current = await incarnation(stores, documentId, expectedIncarnation);
        const previous = await markerFor(stores, scopeKey);
        if (previous) {
          if (previous.incarnation !== current || previous.replacementGenerationId !== replacementGenerationId
            || previous.reason !== options.reason) throw scopeError('Conflicting PDF generation retirement');
          return { ...previous };
        }
        const marker = { scopeKey, documentId, actorUserId, incarnation: current,
          pdfGenerationId: pdfGeneration(options), replacementGenerationId, reason: options.reason, retiredAt: Date.now() };
        await stores[RETIRED_STORE].put(marker);
        for (const record of await stores[PENDING_STORE].getAll(scopeKey)) {
          const existing = await stores[QUARANTINE_STORE].get(record.key);
          if (existing) assertSameEvidence(existing, record);
          await stores[QUARANTINE_STORE].put(quarantineRecord(existing || record));
          await stores[PENDING_STORE].delete(record.key);
        }
        // Accepted rows/checkpoint bytes and keys remain exact old-scope evidence.
        return { ...marker };
      });
    },
    async deleteScope(documentId, actorUserId, expectedIncarnation, options) {
      const scopeKey = generationScopeKey(documentId, actorUserId, options);
      if (pdfGeneration(options) != null) requireIncarnation(expectedIncarnation);
      return run(ALL_STORES, 'readwrite', async stores => {
        await assertNoOtherModelEvidence(stores, documentId, actorUserId, options);
        await incarnation(stores, documentId, expectedIncarnation ?? 0);
        await assertOpen(stores, scopeKey);
        for (const name of [PENDING_STORE, ACCEPTED_STORE, QUARANTINE_STORE]) {
          for (const record of await stores[name].getAll(scopeKey)) await stores[name].delete(record.key);
        }
        await stores[CHECKPOINT_STORE].delete(scopeKey);
      });
    },
    async deleteDocument(documentId) {
      return run(ALL_STORES, 'readwrite', async stores => {
        const current = await incarnation(stores, documentId);
        await stores[INCARNATION_STORE].put({ documentId, incarnation: current + 1 });
        for (const name of [PENDING_STORE, ACCEPTED_STORE, QUARANTINE_STORE]) {
          for (const record of await stores[name].getAll()) {
            if (record.documentId === documentId) await stores[name].delete(record.key);
          }
        }
        for (const name of [CHECKPOINT_STORE, RETIRED_STORE]) {
          for (const record of await stores[name].getAll()) {
            if (record.scopeKey.startsWith(documentId + '\u0000')) await stores[name].delete(record.scopeKey);
          }
        }
      });
    },
    close,
  };
  if (readFresh) api.readLocalStateFresh = readFresh;
  return api;
}

export function createMemoryAnnotationOutbox() {
  const maps = Object.fromEntries(ALL_STORES.map(name => [name, new Map()]));
  let chain = Promise.resolve();
  const run = (names, mode, operation) => {
    const task = chain.then(async () => {
      // Record only changed entries for rollback; never copy the full pending
      // journal for each edit when IndexedDB is unavailable.
      const undo = new Map();
      const remember = (name, key) => {
        if (mode !== 'readwrite') throw new Error('Read-only annotation transaction');
        if (!undo.has(name)) undo.set(name, new Map());
        if (!undo.get(name).has(key)) undo.get(name).set(key, { had: maps[name].has(key), value: maps[name].get(key) });
      };
      const stores = Object.fromEntries(names.map(name => [name, {
        async get(key) { return structuredClone(maps[name].get(key)); },
        async put(record) {
          const key = [CHECKPOINT_STORE, RETIRED_STORE].includes(name) ? record.scopeKey
            : name === INCARNATION_STORE ? record.documentId : record.key;
          remember(name, key);
          maps[name].set(key, structuredClone(record));
        },
        async delete(key) { remember(name, key); maps[name].delete(key); },
        async getAll(scopeKey) {
          return [...maps[name].values()].filter(record => scopeKey === undefined || record.scopeKey === scopeKey).map(record => structuredClone(record));
        },
        async hasAny(scopeKey) {
          return [...maps[name].values()].some(record => record.scopeKey === scopeKey);
        },
      }]));
      try { return await operation(stores); } catch (error) {
        for (const [name, records] of undo) for (const [key, previous] of records) {
          if (previous.had) maps[name].set(key, previous.value);
          else maps[name].delete(key);
        }
        throw error;
      }
    });
    chain = task.catch(() => {});
    return task;
  };
  return buildOutbox({ storageKind: 'memory', run, close: async () => {} });
}

let sharedMemoryAnnotationOutbox = null;

export async function createAnnotationOutbox({
  indexedDb = globalThis.indexedDB,
  timeoutMs = REQUEST_TIMEOUT_MS,
  existingOnly = false,
} = {}) {
  if (!indexedDb?.open) {
    sharedMemoryAnnotationOutbox ??= createMemoryAnnotationOutbox();
    return sharedMemoryAnnotationOutbox;
  }
  const db = await openDatabase(indexedDb, timeoutMs, existingOnly);
  const activeTransactions = new Set();
  const inFlight = new Set();
  let closing = false;
  const run = (names, mode, operation) => {
    if (closing) return Promise.reject(new Error('annotation outbox is closing'));
    const transaction = db.transaction(names, mode);
    activeTransactions.add(transaction);
    const completion = transactionCompletion(transaction, timeoutMs);
    const task = (async () => {
      try {
        const stores = Object.fromEntries(names.map(name => {
          const store = transaction.objectStore(name);
          return [name, {
            get: key => requestResult(store.get(key), transaction, timeoutMs),
            put: record => requestResult(store.put(record), transaction, timeoutMs),
            delete: key => requestResult(store.delete(key), transaction, timeoutMs),
            getAll: scopeKey => requestResult(scopeKey === undefined ? store.getAll()
              : store.index('scopeKey').getAll(scopeKey), transaction, timeoutMs),
            hasAny: scopeKey => {
              const index = store.index('scopeKey');
              return typeof index.count === 'function'
                ? requestResult(index.count(scopeKey), transaction, timeoutMs).then(count => count > 0)
                : requestResult(index.getAll(scopeKey), transaction, timeoutMs).then(rows => rows.length > 0);
            },
          }];
        }));
        const value = await operation(stores);
        await completion;
        return value;
      } catch (error) {
        try { transaction.abort(); } catch { /* transaction already closed */ }
        await completion.catch(() => {});
        throw error;
      } finally { activeTransactions.delete(transaction); }
    })();
    inFlight.add(task);
    task.finally(() => inFlight.delete(task)).catch(() => {});
    return task;
  };
  return buildOutbox({
    storageKind: 'indexeddb', run,
    async readFresh(documentId, actorUserId, expectedIncarnation, options) {
      const fresh = await createAnnotationOutbox({ indexedDb, timeoutMs, existingOnly: true });
      try {
        const state = await fresh.readLocalState(documentId, actorUserId, expectedIncarnation, options);
        await fresh.assertScopeCurrent(documentId, actorUserId, expectedIncarnation, options);
        return state;
      } finally { await fresh.close(); }
    },
    async close() {
      closing = true;
      if (inFlight.size > 0) {
        let timer;
        await Promise.race([Promise.allSettled([...inFlight]), new Promise(resolve => {
          timer = setTimeout(() => {
            for (const transaction of activeTransactions) {
              try { transaction.abort(); } catch { /* already closed */ }
            }
            resolve();
          }, timeoutMs);
        })]);
        if (timer) clearTimeout(timer);
        await Promise.allSettled([...inFlight]);
      }
      db.close();
    },
  });
}
