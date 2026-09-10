import { captureTemplateSurveyDefinitionPreview,
  validateDocumentSurveyDefinition } from './documentSurveyDefinition.js';

export const DOCUMENT_SURVEY_DEFINITION_ADOPTION_DB_NAME = 'survey-document-definition-adoptions-v1';
const INTENTS = 'intents';
const DEFINITIONS = 'definitions';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const fail = (code, message) => Object.assign(new Error(message), { code });
const check = value => {
  if (!value) throw fail('DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_INVALID',
    'The saved survey-definition adoption is invalid.');
};
const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);

function copyRow(value, actorUserId, documentId) {
  check(value && Object.keys(value).sort().join('|') === [
    'actorUserId', 'documentId', 'operationId', 'phase', 'preview', 'requestSha256', 'revision', 'version',
  ].sort().join('|'));
  check(value.version === 1 && value.actorUserId === actorUserId && value.documentId === documentId
    && UUID.test(actorUserId || '') && UUID.test(documentId || '') && UUID.test(value.operationId || '')
    && SHA256.test(value.requestSha256 || '') && ['pending', 'dispatched'].includes(value.phase)
    && Number.isSafeInteger(value.revision) && value.revision > 0);
  return structuredClone({ ...value,
    preview: captureTemplateSurveyDefinitionPreview(value.preview, documentId) });
}

function copyAcceptedRow(value, actorUserId, documentId) {
  check(value && Object.keys(value).sort().join('|') === [
    'actorUserId', 'definition', 'documentId',
  ].sort().join('|'));
  check(value.actorUserId === actorUserId && value.documentId === documentId
    && UUID.test(actorUserId || '') && UUID.test(documentId || ''));
  const definition = validateDocumentSurveyDefinition(value.definition, documentId);
  check(definition.status === 'accepted');
  return structuredClone(definition);
}

export function createDocumentSurveyDefinitionAdoptionIntentStore({ indexedDB,
  dbName = DOCUMENT_SURVEY_DEFINITION_ADOPTION_DB_NAME, timeoutMs = 10_000 } = {}) {
  check(typeof dbName === 'string' && dbName.length > 0 && dbName.length <= 512
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000);
  let connection = null;
  let opening = null;
  let closed = false;
  const active = () => {
    if (closed) throw fail('DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_CLOSED',
      'The saved survey-definition adoption is closed.');
  };
  const database = () => {
    active();
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    const factory = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
    check(factory?.open);
    opening = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const finish = (error, db) => {
        if (settled) { db?.close(); return; }
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(db);
      };
      const timer = setTimeout(() => finish(fail('DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_UNAVAILABLE',
        'Opening saved survey-definition adoption timed out.')), timeoutMs);
      try { request = factory.open(dbName, 1); } catch (error) { finish(error); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(INTENTS)) {
          request.result.createObjectStore(INTENTS, { keyPath: ['actorUserId', 'documentId'] });
        }
        if (!request.result.objectStoreNames.contains(DEFINITIONS)) {
          request.result.createObjectStore(DEFINITIONS, { keyPath: ['actorUserId', 'documentId'] });
        }
      };
      request.onblocked = () => finish(fail('DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_UNAVAILABLE',
        'Saved survey-definition adoption is blocked.'));
      request.onerror = () => finish(request.error || fail('DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_UNAVAILABLE',
        'Saved survey-definition adoption could not be opened.'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled || closed) {
          db.close();
          finish(fail('DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_CLOSED',
            'The saved survey-definition adoption is closed.'), db);
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

  async function transact(mode, run, storeName = INTENTS) {
    const db = await database();
    active();
    return new Promise((resolve, reject) => {
      let tx;
      let result;
      let cause;
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(result);
      };
      try { tx = db.transaction(storeName, mode); } catch (error) { reject(error); return; }
      const timer = setTimeout(() => {
        cause = fail('DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_UNAVAILABLE',
          'Saved survey-definition adoption timed out.');
        try { tx.abort(); } catch { finish(cause); }
      }, timeoutMs);
      tx.oncomplete = () => finish();
      tx.onabort = () => finish(cause || tx.error || fail(
        'DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_UNAVAILABLE',
        'Saved survey-definition adoption did not commit.'));
      tx.onerror = event => { cause ||= event.target?.error || tx.error; };
      try {
        run(tx.objectStore(storeName), value => { result = value; }, error => {
          cause = error;
          try { tx.abort(); } catch { finish(error); }
        });
      } catch (error) {
        cause = error;
        try { tx.abort(); } catch { finish(error); }
      }
    });
  }

  return Object.freeze({
    async get(actorUserId, documentId) {
      check(UUID.test(actorUserId || '') && UUID.test(documentId || ''));
      return transact('readonly', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try { done(request.result ? copyRow(request.result, actorUserId, documentId) : null); }
          catch (error) { abort(error); }
        };
      });
    },
    async getAccepted(actorUserId, documentId) {
      check(UUID.test(actorUserId || '') && UUID.test(documentId || ''));
      return transact('readonly', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            done(request.result ? copyAcceptedRow(request.result, actorUserId, documentId) : null);
          } catch (error) { abort(error); }
        };
      }, DEFINITIONS);
    },
    async putAccepted(actorUserId, documentId, definition) {
      check(UUID.test(actorUserId || '') && UUID.test(documentId || ''));
      const accepted = validateDocumentSurveyDefinition(definition, documentId);
      check(accepted.status === 'accepted');
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            if (request.result) {
              const prior = copyAcceptedRow(request.result, actorUserId, documentId);
              check(stable(prior) === stable(accepted));
              done(prior);
              return;
            }
            store.add({ actorUserId, documentId, definition: accepted });
            done(accepted);
          } catch (error) { abort(error); }
        };
      }, DEFINITIONS);
    },
    async reserve(actorUserId, documentId, input) {
      check(UUID.test(actorUserId || '') && UUID.test(documentId || '')
        && UUID.test(input?.operationId || '') && SHA256.test(input?.requestSha256 || ''));
      const preview = captureTemplateSurveyDefinitionPreview(input.preview, documentId);
      const operationId = input.operationId;
      const requestSha256 = input.requestSha256;
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            if (request.result) {
              const row = copyRow(request.result, actorUserId, documentId);
              check(row.operationId === operationId && row.requestSha256 === requestSha256
                && stable(row.preview) === stable(preview));
              done({ row, created: false });
              return;
            }
            const row = copyRow({ version: 1, revision: 1, actorUserId, documentId,
              operationId, requestSha256,
              phase: 'pending', preview }, actorUserId, documentId);
            store.add(row);
            done({ row, created: true });
          } catch (error) { abort(error); }
        };
      });
    },
    async markDispatched(actorUserId, documentId, revision, operationId) {
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            const row = copyRow(request.result, actorUserId, documentId);
            check(row.operationId === operationId);
            if (row.phase === 'dispatched') { done(row); return; }
            check(row.phase === 'pending' && row.revision === revision);
            row.phase = 'dispatched';
            row.revision++;
            store.put(row);
            done(copyRow(row, actorUserId, documentId));
          } catch (error) { abort(error); }
        };
      });
    },
    async finish(actorUserId, documentId, revision, operationId, requestSha256) {
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            const row = copyRow(request.result, actorUserId, documentId);
            check(row.phase === 'dispatched' && row.revision === revision
              && row.operationId === operationId && row.requestSha256 === requestSha256);
            store.delete([actorUserId, documentId]);
            done(true);
          } catch (error) { abort(error); }
        };
      });
    },
    close() { closed = true; connection?.close(); connection = null; },
  });
}

let defaultStore;
export const getDocumentSurveyDefinitionAdoptionIntentStore = () => (defaultStore
  ||= createDocumentSurveyDefinitionAdoptionIntentStore());
