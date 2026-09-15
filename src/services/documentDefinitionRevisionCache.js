import {
  validateDocumentDefinitionRevisionPreview,
  validateDocumentDefinitionRevisionReviewV2,
  validateDocumentDefinitionRevisionReceipt,
} from './documentDefinitionRevisionClient.js';

export const DOCUMENT_DEFINITION_REVISION_CACHE_DB_NAME = 'survey-document-definition-revisions-v1';
export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
export const MAX_REVIEW_BYTES = 16 * 1024 * 1024;

const RECEIPTS = 'receipts';
const INTENTS = 'intents';
const CURRENT = 'current';
const SCOPE_REVISION = 'scopeRevision';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_REVISION = 9007199254740991;
const fail = (code, message) => Object.assign(new Error(message), { code });
const check = (value, code = 'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
  message = 'The saved document definition revision is invalid.') => {
  if (!value) throw fail(code, message);
};
const uuid = value => typeof value === 'string' && UUID.test(value);
const sha = value => typeof value === 'string' && SHA256.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 1 && value <= MAX_REVISION;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);
const bytes = value => new TextEncoder().encode(stable(value)).byteLength;
const SEMANTIC_KINDS = new Set(['module', 'category', 'checklistItem', 'entity']);

function combinedArchives(current, added) {
  const values = [...current, ...added];
  check(values.every(value => exact(value, ['kind', 'id'])
    && SEMANTIC_KINDS.has(value.kind) && typeof value.id === 'string'
    && value.id.length >= 1 && value.id.length <= 128));
  const unique = new Map(values.map(value => [JSON.stringify([value.kind, value.id]), value]));
  return [...unique.values()];
}

function validOptions(dbName, timeoutMs, maxReceiptBytes, maxReviewBytes) {
  return typeof dbName === 'string' && dbName.length > 0 && dbName.length <= 512
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000
    && Number.isSafeInteger(maxReceiptBytes) && maxReceiptBytes > 0
    && Number.isSafeInteger(maxReviewBytes) && maxReviewBytes > 0;
}

export function createDocumentDefinitionRevisionCache({ indexedDB,
  dbName = DOCUMENT_DEFINITION_REVISION_CACHE_DB_NAME,
  timeoutMs = 10_000,
  maxReceiptBytes = MAX_RECEIPT_BYTES,
  maxReviewBytes = MAX_REVIEW_BYTES,
} = {}) {
  check(validOptions(dbName, timeoutMs, maxReceiptBytes, maxReviewBytes));
  let connection = null;
  let opening = null;
  let closed = false;

  const active = () => check(!closed, 'DOCUMENT_DEFINITION_REVISION_CACHE_CLOSED',
    'The saved document definition revision cache is closed.');
  const database = () => {
    active();
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    const factory = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
    check(factory?.open, 'DOCUMENT_DEFINITION_REVISION_CACHE_UNAVAILABLE',
      'Saved document definition revisions are not available.');
    opening = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const finish = (problem, db) => {
        if (settled) { db?.close(); return; }
        settled = true;
        clearTimeout(timer);
        problem ? reject(problem) : resolve(db);
      };
      const timer = setTimeout(() => finish(fail('DOCUMENT_DEFINITION_REVISION_CACHE_UNAVAILABLE',
        'Opening saved document definition revisions timed out.')), timeoutMs);
      try { request = factory.open(dbName, 1); }
      catch (problem) { finish(problem); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RECEIPTS)) {
          const receipts = db.createObjectStore(RECEIPTS, {
            keyPath: ['actorUserId', 'documentId', 'definitionRevision', 'definitionDigest'],
          });
          receipts.createIndex(SCOPE_REVISION,
            ['actorUserId', 'documentId', 'definitionRevision'], { unique:true });
        }
        if (!db.objectStoreNames.contains(INTENTS)) {
          db.createObjectStore(INTENTS, { keyPath:['actorUserId', 'documentId'] });
        }
        if (!db.objectStoreNames.contains(CURRENT)) {
          db.createObjectStore(CURRENT, { keyPath:['actorUserId', 'documentId'] });
        }
      };
      request.onblocked = () => finish(fail('DOCUMENT_DEFINITION_REVISION_CACHE_UNAVAILABLE',
        'Saved document definition revisions are blocked.'));
      request.onerror = () => finish(request.error || fail(
        'DOCUMENT_DEFINITION_REVISION_CACHE_UNAVAILABLE',
        'Saved document definition revisions could not be opened.'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled || closed) {
          db.close();
          finish(fail('DOCUMENT_DEFINITION_REVISION_CACHE_CLOSED',
            'The saved document definition revision cache is closed.'), db);
          return;
        }
        connection = db;
        db.onversionchange = () => { db.close(); if (connection === db) connection = null; };
        db.onclose = () => { if (connection === db) connection = null; };
        finish(null, db);
      };
    }).finally(() => { opening = null; });
    return opening;
  };

  async function transact(storeName, mode, run) {
    const db = await database();
    active();
    return new Promise((resolve, reject) => {
      let tx;
      let result;
      let cause;
      let settled = false;
      const finish = problem => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        problem ? reject(problem) : resolve(result);
      };
      const storeNames = Array.isArray(storeName) ? storeName : [storeName];
      try { tx = db.transaction(storeNames, mode); }
      catch (problem) { reject(problem); return; }
      const timer = setTimeout(() => {
        cause = fail('DOCUMENT_DEFINITION_REVISION_CACHE_UNAVAILABLE',
          'Saved document definition revision storage timed out.');
        try { tx.abort(); } catch { finish(cause); }
      }, timeoutMs);
      tx.oncomplete = () => finish();
      tx.onabort = () => finish(cause || tx.error || fail(
        'DOCUMENT_DEFINITION_REVISION_CACHE_UNAVAILABLE',
        'Saved document definition revision storage did not commit.'));
      tx.onerror = event => { cause ||= event.target?.error || tx.error; };
      try {
        const stores = Array.isArray(storeName)
          ? Object.fromEntries(storeNames.map(name => [name, tx.objectStore(name)]))
          : tx.objectStore(storeName);
        run(stores, value => { result = value; }, problem => {
          cause = problem;
          try { tx.abort(); } catch { finish(problem); }
        });
      } catch (problem) {
        cause = problem;
        try { tx.abort(); } catch { finish(problem); }
      }
    });
  }

  const receiptRow = async (value, actorUserId, documentId) => {
    check(exact(value, ['actorUserId', 'documentId', 'definitionRevision',
      'definitionDigest', 'receipt']) && value.actorUserId === actorUserId
      && value.documentId === documentId && uuid(actorUserId) && uuid(documentId));
    const owned = await validateDocumentDefinitionRevisionReceipt(
      structuredClone(value.receipt), documentId);
    check(value.definitionRevision === owned.definitionRevision
      && value.definitionDigest === owned.definitionDigest
      && bytes({ actorUserId, documentId, definitionRevision:owned.definitionRevision,
        definitionDigest:owned.definitionDigest, receipt:owned }) <= maxReceiptBytes,
    'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
    'The saved document definition revision exceeds its byte limit.');
    return structuredClone({ actorUserId, documentId,
      definitionRevision:owned.definitionRevision,
      definitionDigest:owned.definitionDigest, receipt:owned });
  };

  const reviewValue = async (value, actorUserId, documentId) => {
    check(exact(value, ['status', 'version', 'actorUserId', 'documentId',
      'currentReceipt', 'wire', 'expectedArchivedSemanticIds'])
      && value.status === 'reviewed' && [1, 2].includes(value.version)
      && value.actorUserId === actorUserId && value.documentId === documentId
      && uuid(actorUserId) && uuid(documentId));
    if (value.version === 2) {
      try {
        return structuredClone(await validateDocumentDefinitionRevisionReviewV2(
          value, documentId));
      } catch (error) {
        if (error?.code?.startsWith?.('DOCUMENT_DEFINITION_REVISION_')) {
          throw fail('DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
            'The saved document definition review does not match its current revision.');
        }
        throw error;
      }
    }
    const currentReceipt = await validateDocumentDefinitionRevisionReceipt(value.currentReceipt, documentId);
    const wire = validateDocumentDefinitionRevisionPreview(value.wire, documentId);
    check(wire.status === 'preview');
    const expectedArchivedSemanticIds = combinedArchives(
      currentReceipt.archivedSemanticIds, wire.review.archivedSemanticIds);
    check(wire.current.definitionRevision === currentReceipt.definitionRevision
      && wire.current.definitionDigest === currentReceipt.definitionDigest
      && stable(value.expectedArchivedSemanticIds) === stable(expectedArchivedSemanticIds),
    'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
    'The saved document definition review does not match its current revision.');
    return structuredClone({ status:'reviewed', version:value.version, actorUserId, documentId,
      currentReceipt, wire, expectedArchivedSemanticIds });
  };

  const intentRow = async (value, actorUserId, documentId) => {
    check(exact(value, ['version', 'revision', 'actorUserId', 'documentId', 'phase',
      'operationId', 'requestSha256', 'review'])
      && value.version === 1 && revision(value.revision)
      && value.actorUserId === actorUserId && value.documentId === documentId
      && ['pending', 'dispatched'].includes(value.phase)
      && uuid(value.operationId) && sha(value.requestSha256));
    const review = await reviewValue(value.review, actorUserId, documentId);
    check(value.operationId === review.wire.review.operationId
      && value.requestSha256 === review.wire.review.requestSha256);
    const owned = structuredClone({ version:1, revision:value.revision, actorUserId,
      documentId, phase:value.phase, operationId:value.operationId,
      requestSha256:value.requestSha256, review });
    check(bytes(owned) <= maxReviewBytes,
      'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
      'The saved document definition review exceeds its byte limit.');
    return owned;
  };

  const conflict = value => check(value, 'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT',
    'The saved document definition apply intent changed.');

  const replaceIntent = async (actorUserId, documentId, current, next) => {
    const owned = await intentRow(next, actorUserId, documentId);
    await transact(INTENTS, 'readwrite', (store, done, abort) => {
      const request = store.get([actorUserId, documentId]);
      request.onsuccess = () => {
        try {
          conflict(request.result && stable(request.result) === stable(current));
          store.put(owned);
          done(true);
        } catch (problem) { abort(problem); }
      };
    });
    return owned;
  };

  const removeIntent = async (actorUserId, documentId, current) => transact(
    INTENTS, 'readwrite', (store, done, abort) => {
      const request = store.get([actorUserId, documentId]);
      request.onsuccess = () => {
        try {
          conflict(request.result && stable(request.result) === stable(current));
          store.delete([actorUserId, documentId]);
          done(true);
        } catch (problem) { abort(problem); }
      };
    });

  const getIntent = async (actorUserId, documentId) => {
    check(uuid(actorUserId) && uuid(documentId));
    const raw = await transact(INTENTS, 'readonly', (store, done) => {
      const request = store.get([actorUserId, documentId]);
      request.onsuccess = () => done(request.result || null);
    });
    return raw ? intentRow(raw, actorUserId, documentId) : null;
  };

  const currentPointer = (value, actorUserId, documentId) => {
    check(exact(value, ['actorUserId', 'documentId', 'definitionRevision',
      'definitionDigest']) && value.actorUserId === actorUserId
      && value.documentId === documentId && uuid(actorUserId) && uuid(documentId)
      && revision(value.definitionRevision) && sha(value.definitionDigest));
    return structuredClone(value);
  };

  const getReceipt = async (actorUserId, documentId, definitionRevision,
    definitionDigest) => {
    check(uuid(actorUserId) && uuid(documentId) && revision(definitionRevision)
      && sha(definitionDigest));
    const raw = await transact(RECEIPTS, 'readonly', (store, done) => {
      const request = store.get([actorUserId, documentId, definitionRevision, definitionDigest]);
      request.onsuccess = () => done(request.result || null);
    });
    if (!raw) return null;
    return (await receiptRow(raw, actorUserId, documentId)).receipt;
  };

  return Object.freeze({
    getReceipt,
    async putReceipt(actorUserId, documentId, receipt) {
      check(uuid(actorUserId) && uuid(documentId));
      const input = structuredClone(receipt);
      const owned = await validateDocumentDefinitionRevisionReceipt(input, documentId);
      const next = await receiptRow({ actorUserId, documentId,
        definitionRevision:owned.definitionRevision,
        definitionDigest:owned.definitionDigest, receipt:owned }, actorUserId, documentId);
      return transact(RECEIPTS, 'readwrite', (store, done, abort) => {
        const request = store.index(SCOPE_REVISION).get(
          [actorUserId, documentId, owned.definitionRevision]);
        request.onsuccess = () => {
          try {
            if (request.result) {
              check(request.result.definitionDigest === owned.definitionDigest
                && stable(request.result) === stable(next),
              'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT',
              'The saved document definition revision conflicts with an immutable receipt.');
              done(structuredClone(owned));
              return;
            }
            store.add(next);
            done(structuredClone(owned));
          } catch (problem) { abort(problem); }
        };
      });
    },
    async getCurrentReceipt(actorUserId, documentId) {
      check(uuid(actorUserId) && uuid(documentId));
      const raw = await transact(CURRENT, 'readonly', (store, done) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => done(request.result || null);
      });
      if (!raw) return null;
      const pointer = currentPointer(raw, actorUserId, documentId);
      const receipt = await getReceipt(actorUserId, documentId,
        pointer.definitionRevision, pointer.definitionDigest);
      check(receipt, 'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
        'The saved current document definition receipt is missing.');
      return receipt;
    },
    async putCurrentReceipt(actorUserId, documentId, receipt) {
      check(uuid(actorUserId) && uuid(documentId));
      const input = structuredClone(receipt);
      const owned = await validateDocumentDefinitionRevisionReceipt(input, documentId);
      const nextReceipt = await receiptRow({ actorUserId, documentId,
        definitionRevision:owned.definitionRevision,
        definitionDigest:owned.definitionDigest, receipt:owned }, actorUserId, documentId);
      const nextPointer = currentPointer({ actorUserId, documentId,
        definitionRevision:owned.definitionRevision,
        definitionDigest:owned.definitionDigest }, actorUserId, documentId);
      return transact([RECEIPTS, CURRENT], 'readwrite', (stores, done, abort) => {
        const receiptRequest = stores[RECEIPTS].index(SCOPE_REVISION).get(
          [actorUserId, documentId, owned.definitionRevision]);
        receiptRequest.onsuccess = () => {
          const pointerRequest = stores[CURRENT].get([actorUserId, documentId]);
          pointerRequest.onsuccess = () => {
            try {
              if (receiptRequest.result) {
                check(receiptRequest.result.definitionDigest === owned.definitionDigest
                  && stable(receiptRequest.result) === stable(nextReceipt),
                'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT',
                'The saved document definition revision conflicts with an immutable receipt.');
              }
              if (pointerRequest.result) {
                const prior = currentPointer(pointerRequest.result, actorUserId, documentId);
                check(prior.definitionRevision < owned.definitionRevision
                  || (prior.definitionRevision === owned.definitionRevision
                    && prior.definitionDigest === owned.definitionDigest),
                'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT',
                'The saved current document definition cannot move back.');
              }
              if (!receiptRequest.result) stores[RECEIPTS].add(nextReceipt);
              stores[CURRENT].put(nextPointer);
              done(structuredClone(owned));
            } catch (problem) { abort(problem); }
          };
        };
      });
    },
    getIntent,
    async reserveIntent(actorUserId, documentId, review) {
      check(uuid(actorUserId) && uuid(documentId));
      const input = structuredClone(review);
      const ownedReview = await reviewValue(input, actorUserId, documentId);
      const next = await intentRow({ version:1, revision:1, actorUserId, documentId,
        phase:'pending', operationId:ownedReview.wire.review.operationId,
        requestSha256:ownedReview.wire.review.requestSha256, review:ownedReview },
      actorUserId, documentId);
      const result = await transact(INTENTS, 'readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            if (request.result) {
              check(request.result.actorUserId === actorUserId
                && request.result.documentId === documentId
                && request.result.operationId === next.operationId
                && request.result.requestSha256 === next.requestSha256
                && stable(request.result.review) === stable(next.review),
                'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT',
                'A different document definition review is already saved.');
              done({ row:structuredClone(request.result), created:false });
              return;
            }
            store.add(next);
            done({ row:structuredClone(next), created:true });
          } catch (problem) { abort(problem); }
        };
      });
      return { row:await intentRow(result.row, actorUserId, documentId),
        created:result.created };
    },
    async markDispatched(actorUserId, documentId, rowRevision, operationId) {
      check(uuid(actorUserId) && uuid(documentId) && revision(rowRevision)
        && uuid(operationId));
      const current = await getIntent(actorUserId, documentId);
      conflict(current && current.operationId === operationId);
      if (current.phase === 'dispatched') return current;
      conflict(current.phase === 'pending' && current.revision === rowRevision);
      try {
        return await replaceIntent(actorUserId, documentId, current, {
          ...current, phase:'dispatched', revision:current.revision + 1,
        });
      } catch (problem) {
        if (problem?.code !== 'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT') throw problem;
        const winner = await getIntent(actorUserId, documentId);
        conflict(winner && winner.phase === 'dispatched'
          && winner.operationId === operationId
          && winner.requestSha256 === current.requestSha256
          && stable(winner.review) === stable(current.review));
        return winner;
      }
    },
    async finishIntent(actorUserId, documentId, rowRevision, operationId, requestSha256) {
      check(uuid(actorUserId) && uuid(documentId) && revision(rowRevision)
        && uuid(operationId) && sha(requestSha256));
      const current = await getIntent(actorUserId, documentId);
      conflict(current && current.phase === 'dispatched' && current.revision === rowRevision
        && current.operationId === operationId && current.requestSha256 === requestSha256);
      return removeIntent(actorUserId, documentId, current);
    },
    async cancelIntent(actorUserId, documentId, rowRevision, operationId) {
      check(uuid(actorUserId) && uuid(documentId) && revision(rowRevision)
        && uuid(operationId));
      const current = await getIntent(actorUserId, documentId);
      conflict(current && current.phase === 'pending' && current.revision === rowRevision
        && current.operationId === operationId);
      return removeIntent(actorUserId, documentId, current);
    },
    close() { closed = true; connection?.close(); connection = null; },
  });
}

let defaultCache;
export const getDocumentDefinitionRevisionCache = () => (defaultCache
  ||= createDocumentDefinitionRevisionCache());
export default getDocumentDefinitionRevisionCache;
