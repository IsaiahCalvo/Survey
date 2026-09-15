import { validateDocumentFirstGenerationAdoptionReceipt } from './documentFirstGenerationAdoption.js';

export const DOCUMENT_FIRST_GENERATION_ADOPTION_DB_NAME = 'survey-document-first-generation-adoptions-v1';
const STORE = 'intents';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHASES = new Set(['reserved', 'review', 'consent', 'confirmed', 'published']);
const uuid = value => typeof value === 'string' && UUID.test(value);
const fail = (code = 'DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_INVALID') => Object.assign(
  new Error('The saved document upgrade could not be verified. Its data was kept.'), { code });
const check = (value, code) => { if (!value) throw fail(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);
const REVIEW_IDENTITY_KEYS = ['actor_user_id', 'owner_user_id', 'document_id',
  'adoption_operation_id', 'source_id', 'candidate_operation_id',
  'offered_archive_operation_ids', 'used_archive_operation_ids', 'review_sha256',
  'source_sql_sha256', 'wal_head', 'objects', 'canonical_annotations', 'entity_catalog',
  'survey_definition', 'expires_at'];
const sameReview = (left, right) => REVIEW_IDENTITY_KEYS.every(key => (
  stable(left?.[key]) === stable(right?.[key])
));

function ids(value) {
  check(exact(value, ['adoptionOperationId', 'sourceId', 'candidateOperationId', 'archiveOperationIds'])
    && [value.adoptionOperationId, value.sourceId, value.candidateOperationId].every(uuid)
    && Array.isArray(value.archiveOperationIds) && value.archiveOperationIds.length === 2
    && value.archiveOperationIds.every(uuid)
    && new Set([value.adoptionOperationId, value.sourceId, value.candidateOperationId,
      ...value.archiveOperationIds]).size === 5);
  return Object.freeze({ adoptionOperationId: value.adoptionOperationId, sourceId: value.sourceId,
    candidateOperationId: value.candidateOperationId,
    archiveOperationIds: Object.freeze([...value.archiveOperationIds]) });
}

function row(value, actorUserId, documentId) {
  check(exact(value, ['version', 'revision', 'actorUserId', 'documentId', 'phase', 'ids',
    'receipt', 'consentedReviewSha256', 'createdAt', 'updatedAt'])
    && value.version === 1 && Number.isSafeInteger(value.revision) && value.revision > 0
    && value.actorUserId === actorUserId && value.documentId === documentId
    && uuid(actorUserId) && uuid(documentId) && PHASES.has(value.phase)
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)));
  const identity = ids(value.ids);
  let receipt = null;
  if (value.phase === 'reserved') check(value.receipt === null && value.consentedReviewSha256 === null);
  else {
    receipt = validateDocumentFirstGenerationAdoptionReceipt(value.receipt, {
      actorUserId, documentId, adoptionOperationId: identity.adoptionOperationId,
      sourceId: identity.sourceId, candidateOperationId: identity.candidateOperationId,
      archiveOperationIds: identity.archiveOperationIds,
    });
    check(receipt.state !== 'missing');
    if (value.phase === 'review') check(receipt.state === 'review' && value.consentedReviewSha256 === null);
    else {
      check(typeof value.consentedReviewSha256 === 'string'
        && value.consentedReviewSha256 === receipt.review_sha256);
      if (value.phase === 'consent') check(receipt.state === 'review');
      if (value.phase === 'confirmed') check(receipt.state === 'confirmed');
      if (value.phase === 'published') check(receipt.state === 'published');
    }
  }
  return structuredClone({ ...value, ids: identity, receipt });
}

export function createDocumentFirstGenerationAdoptionIntentStore({ indexedDB,
  dbName = DOCUMENT_FIRST_GENERATION_ADOPTION_DB_NAME, timeoutMs = 10_000 } = {}) {
  check(typeof dbName === 'string' && dbName.length > 0 && dbName.length <= 512
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000);
  let connection = null, opening = null, closed = false;
  const database = () => {
    check(!closed, 'DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_CLOSED');
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    const factory = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
    check(factory?.open, 'DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_UNAVAILABLE');
    opening = new Promise((resolve, reject) => {
      let request, settled = false;
      const finish = (problem, db) => {
        if (settled) { db?.close(); return; }
        settled = true; clearTimeout(timer); problem ? reject(problem) : resolve(db);
      };
      const timer = setTimeout(() => finish(fail('DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_UNAVAILABLE')),
        timeoutMs);
      try { request = factory.open(dbName, 1); } catch (problem) { finish(problem); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: ['actorUserId', 'documentId'] });
        }
      };
      request.onblocked = () => finish(fail('DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_UNAVAILABLE'));
      request.onerror = () => finish(request.error || fail('DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_UNAVAILABLE'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled || closed) { db.close(); finish(fail('DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_CLOSED'), db); return; }
        connection = db;
        db.onversionchange = () => { db.close(); if (connection === db) connection = null; };
        db.onclose = () => { if (connection === db) connection = null; };
        finish(null, db);
      };
    }).finally(() => { opening = null; });
    return opening;
  };
  async function transact(mode, run) {
    const db = await database();
    return new Promise((resolve, reject) => {
      let tx, result, cause, settled = false;
      const finish = problem => {
        if (settled) return; settled = true; clearTimeout(timer);
        problem ? reject(problem) : resolve(result);
      };
      try { tx = db.transaction(STORE, mode); } catch (problem) { reject(problem); return; }
      const timer = setTimeout(() => {
        cause = fail('DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_UNAVAILABLE');
        try { tx.abort(); } catch { finish(cause); }
      }, timeoutMs);
      tx.oncomplete = () => finish();
      tx.onabort = () => finish(cause || tx.error || fail('DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_UNAVAILABLE'));
      tx.onerror = event => { cause ||= event.target?.error || tx.error; };
      try { run(tx.objectStore(STORE), value => { result = value; }, problem => {
        cause = problem; try { tx.abort(); } catch { finish(problem); }
      }); } catch (problem) { cause = problem; try { tx.abort(); } catch { finish(problem); } }
    });
  }
  const get = async (actorUserId, documentId) => {
    check(uuid(actorUserId) && uuid(documentId));
    return transact('readonly', (store, done, abort) => {
      const request = store.get([actorUserId, documentId]);
      request.onsuccess = () => {
        try { done(request.result ? row(request.result, actorUserId, documentId) : null); }
        catch (problem) { abort(problem); }
      };
    });
  };
  const update = async (actorUserId, documentId, expectedRevision, transform) => {
    check(uuid(actorUserId) && uuid(documentId) && Number.isSafeInteger(expectedRevision)
      && expectedRevision > 0 && typeof transform === 'function');
    return transact('readwrite', (store, done, abort) => {
      const request = store.get([actorUserId, documentId]);
      request.onsuccess = () => {
        try {
          const current = row(request.result, actorUserId, documentId);
          check(current.revision === expectedRevision);
          const next = row({ ...transform(current), revision: current.revision + 1,
            updatedAt: new Date().toISOString() }, actorUserId, documentId);
          store.put(next); done(next);
        } catch (problem) { abort(problem); }
      };
    });
  };
  return Object.freeze({
    get,
    async reserve(actorUserId, documentId, identity) {
      const owned = ids(identity);
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            if (request.result) { done({ row: row(request.result, actorUserId, documentId), created: false }); return; }
            const now = new Date().toISOString();
            const next = row({ version: 1, revision: 1, actorUserId, documentId,
              phase: 'reserved', ids: owned, receipt: null, consentedReviewSha256: null,
              createdAt: now, updatedAt: now }, actorUserId, documentId);
            store.add(next); done({ row: next, created: true });
          } catch (problem) { abort(problem); }
        };
      });
    },
    putReview(actorUserId, documentId, revision, receipt) {
      return update(actorUserId, documentId, revision, current => {
        const next = validateDocumentFirstGenerationAdoptionReceipt(receipt, {
          actorUserId, documentId, adoptionOperationId: current.ids.adoptionOperationId,
          sourceId: current.ids.sourceId, candidateOperationId: current.ids.candidateOperationId,
          archiveOperationIds: current.ids.archiveOperationIds,
        });
        check(next.state === 'review');
        return { ...current, phase: 'review', receipt: next };
      });
    },
    markConsent(actorUserId, documentId, revision, reviewSha256) {
      return update(actorUserId, documentId, revision, current => {
        check(current.phase === 'review' && current.receipt.review_sha256 === reviewSha256);
        return { ...current, phase: 'consent', consentedReviewSha256: reviewSha256 };
      });
    },
    putConfirmed(actorUserId, documentId, revision, receipt) {
      return update(actorUserId, documentId, revision, current => {
        const next = validateDocumentFirstGenerationAdoptionReceipt(receipt, {
          actorUserId, documentId, adoptionOperationId: current.ids.adoptionOperationId,
          sourceId: current.ids.sourceId, candidateOperationId: current.ids.candidateOperationId,
          archiveOperationIds: current.ids.archiveOperationIds,
        });
        check(current.phase === 'consent' && next.state === 'confirmed'
          && next.review_sha256 === current.consentedReviewSha256
          && sameReview(current.receipt, next));
        return { ...current, phase: 'confirmed', receipt: next };
      });
    },
    putPublished(actorUserId, documentId, revision, receipt) {
      return update(actorUserId, documentId, revision, current => {
        const next = validateDocumentFirstGenerationAdoptionReceipt(receipt, {
          actorUserId, documentId, adoptionOperationId: current.ids.adoptionOperationId,
          sourceId: current.ids.sourceId, candidateOperationId: current.ids.candidateOperationId,
          archiveOperationIds: current.ids.archiveOperationIds,
        });
        check(['consent', 'confirmed'].includes(current.phase) && next.state === 'published'
          && next.review_sha256 === current.consentedReviewSha256
          && sameReview(current.receipt, next));
        return { ...current, phase: 'published', receipt: next };
      });
    },
    async finish(actorUserId, documentId, revision, adoptionOperationId) {
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            const current = row(request.result, actorUserId, documentId);
            check(current.phase === 'published' && current.revision === revision
              && current.ids.adoptionOperationId === adoptionOperationId);
            store.delete([actorUserId, documentId]); done(true);
          } catch (problem) { abort(problem); }
        };
      });
    },
    close() { closed = true; connection?.close(); connection = null; },
  });
}

let defaultStore;
export const getDocumentFirstGenerationAdoptionIntentStore = () => (defaultStore
  ||= createDocumentFirstGenerationAdoptionIntentStore());
