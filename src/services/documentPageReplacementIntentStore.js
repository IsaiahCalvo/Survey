import { randomUUID } from '../utils/randomUUIDPolyfill.js';
import { captureCheckedPageStructure } from './checkedPageStructure.js';

export const DOCUMENT_PAGE_REPLACEMENT_DB_NAME = 'survey-document-page-replacements-v1';

const STORE = 'intents';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEQ = /^(0|[1-9][0-9]{0,18})$/;
const PHASES = new Set(['pending', 'dispatched', 'published', 'expired']);
const fail = (code, message) => Object.assign(new Error(message), { code });
const check = (value, code = 'DOCUMENT_PAGE_REPLACEMENT_STORE_INVALID') => {
  if (!value) throw fail(code, code === 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED'
    ? 'A prior page change must be resolved before another can start.'
    : 'The saved page replacement intent is invalid.');
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const uuid = value => typeof value === 'string' && UUID.test(value);
const seq = value => typeof value === 'string' && SEQ.test(value)
  && BigInt(value) <= 9223372036854775807n;
const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value)
      ? `[${value.map(stable).join(',')}]`
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);

function operation(value) {
  const fields = {
    move: ['type', 'from', 'to'], reorder: ['type', 'from', 'to'],
    insert: ['type', 'afterPage'], delete: ['type', 'page'],
    rotate: ['type', 'page', 'delta'], copy: ['type', 'source', 'afterPage'],
    duplicate: ['type', 'page'],
  }[value?.type];
  check(fields && exact(value, fields));
  for (const field of fields) {
    if (field === 'type') continue;
    if (field === 'delta') check(Number.isSafeInteger(value[field]) && value[field] % 90 === 0);
    else check(Number.isSafeInteger(value[field]) && value[field] > 0);
  }
  return structuredClone(value);
}

function published(value, body) {
  const v4 = value?.version === 4;
  check(body.archive_operation_ids.length === 1 || v4);
  check(exact(value, ['version', ...(v4
    ? ['content_model_version', 'aggregate_admission_version', 'offered_archive_operation_ids',
      'used_archive_operation_ids', 'legacy_sidecar_migration'] : []),
  'state', 'document_id', 'source_id', 'candidate_operation_id', 'archive_operation_ids',
  'previous_generation_id', 'generation_id', 'wal_head', 'published_at']));
  check(value.version === (v4 ? 4 : 1) && value.state === 'published' && value.document_id === body.document_id
    && value.source_id === body.source_id && value.candidate_operation_id === body.candidate_operation_id
    && stable(value.archive_operation_ids) === stable(body.archive_operation_ids)
    && value.previous_generation_id === body.generation_id && uuid(value.generation_id)
    && value.generation_id !== value.previous_generation_id && value.wal_head === body.wal_head
    && typeof value.published_at === 'string' && Number.isFinite(Date.parse(value.published_at)));
  if (v4) check(value.content_model_version === 2 && value.aggregate_admission_version === 1
    && stable(value.offered_archive_operation_ids) === stable(body.archive_operation_ids)
    && Array.isArray(value.used_archive_operation_ids)
    && [1, 2].includes(value.used_archive_operation_ids.length)
    && stable(value.used_archive_operation_ids)
      === stable(body.archive_operation_ids.slice(0, value.used_archive_operation_ids.length))
    && (value.legacy_sidecar_migration === null
      || (exact(value.legacy_sidecar_migration, ['version', 'state', 'source_generation_id'])
        && value.legacy_sidecar_migration.version === 1
        && value.legacy_sidecar_migration.state === 'archived'
        && uuid(value.legacy_sidecar_migration.source_generation_id))));
  return structuredClone(value);
}

function terminal(value, body, actorUserId) {
  const v4 = value?.version === 4;
  check(body.archive_operation_ids.length === 1 || v4);
  check(exact(value, ['version', ...(v4 ? ['aggregate_admission_version',
    'offered_archive_operation_ids', 'used_archive_operation_ids'] : []),
  'state', 'actor_user_id', 'document_id', 'source_id',
    'candidate_operation_id', 'archive_operation_ids', 'expected_generation_id',
    'expected_wal_head', 'operation', 'prepared_at', 'expires_at']));
  check(value.version === (v4 ? 4 : 1) && value.state === 'expired' && value.actor_user_id === actorUserId
    && value.document_id === body.document_id && value.source_id === body.source_id
    && value.candidate_operation_id === body.candidate_operation_id
    && stable(value.archive_operation_ids) === stable(body.archive_operation_ids)
    && value.expected_generation_id === body.generation_id
    && value.expected_wal_head === body.wal_head
    && stable(operation(value.operation)) === stable(body.operation)
    && typeof value.prepared_at === 'string' && Number.isFinite(Date.parse(value.prepared_at))
    && typeof value.expires_at === 'string' && Number.isFinite(Date.parse(value.expires_at)));
  if (v4) check(value.aggregate_admission_version === 1
    && stable(value.offered_archive_operation_ids) === stable(body.archive_operation_ids)
    && (value.used_archive_operation_ids === null
      || (Array.isArray(value.used_archive_operation_ids)
        && value.used_archive_operation_ids.length >= 1
        && value.used_archive_operation_ids.length <= body.archive_operation_ids.length
        && stable(value.used_archive_operation_ids)
          === stable(body.archive_operation_ids.slice(0, value.used_archive_operation_ids.length)))));
  return structuredClone(value);
}

function validate(row, actorUserId, documentId) {
  if (object(row) && !Object.hasOwn(row, 'terminal')) row = { ...row, terminal: null };
  check(exact(row, ['version', 'revision', 'actorUserId', 'documentId', 'phase', 'body',
    'localPageState', 'publication', 'terminal', 'createdAt', 'updatedAt']));
  check(row.version === 1 && Number.isSafeInteger(row.revision) && row.revision > 0
    && row.actorUserId === actorUserId && row.documentId === documentId
    && uuid(actorUserId) && uuid(documentId) && PHASES.has(row.phase));
  const body = row.body;
  check(exact(body, ['document_id', 'generation_id', 'wal_head', 'operation', 'source_id',
    'candidate_operation_id', 'archive_operation_ids'])
    && body.document_id === documentId && uuid(body.generation_id) && seq(body.wal_head)
    && uuid(body.source_id) && uuid(body.candidate_operation_id)
    && Array.isArray(body.archive_operation_ids) && [1, 2].includes(body.archive_operation_ids.length)
    && body.archive_operation_ids.every(uuid)
    && new Set([body.source_id, body.candidate_operation_id, ...body.archive_operation_ids]).size
      === 2 + body.archive_operation_ids.length);
  operation(body.operation);
  captureCheckedPageStructure(row.localPageState);
  check(typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt))
    && typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)));
  if (row.phase === 'published') {
    published(row.publication, body); check(row.terminal === null);
  } else if (row.phase === 'expired') {
    check(row.publication === null); terminal(row.terminal, body, actorUserId);
  } else check(row.publication === null && row.terminal === null);
  return structuredClone(row);
}

export function createDocumentPageReplacementIntentStore({ indexedDB,
  dbName = DOCUMENT_PAGE_REPLACEMENT_DB_NAME, timeoutMs = 10_000 } = {}) {
  check(typeof dbName === 'string' && dbName.length > 0 && dbName.length <= 512
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000);
  let connection = null, opening = null, closed = false;
  const active = () => check(!closed, 'DOCUMENT_PAGE_REPLACEMENT_STORE_CLOSED');
  const database = () => {
    active();
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    const factory = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
    check(factory?.open, 'DOCUMENT_PAGE_REPLACEMENT_STORE_UNAVAILABLE');
    opening = new Promise((resolve, reject) => {
      const request = factory.open(dbName, 1);
      let settled = false;
      const finish = (error, db) => {
        if (settled) { db?.close(); return; }
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(db);
      };
      const timer = setTimeout(() => finish(fail('DOCUMENT_PAGE_REPLACEMENT_STORE_UNAVAILABLE',
        'The saved page replacement intent timed out.')), timeoutMs);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: ['actorUserId', 'documentId'] });
      };
      request.onblocked = () => finish(fail('DOCUMENT_PAGE_REPLACEMENT_STORE_UNAVAILABLE', 'The saved page replacement intent is blocked.'));
      request.onerror = () => finish(request.error || fail('DOCUMENT_PAGE_REPLACEMENT_STORE_UNAVAILABLE', 'The saved page replacement intent could not be opened.'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        if (closed) { finish(fail('DOCUMENT_PAGE_REPLACEMENT_STORE_CLOSED', 'The saved page replacement intent is closed.'), db); return; }
        connection = db;
        db.onversionchange = () => { db.close(); if (connection === db) connection = null; };
        db.onclose = () => { if (connection === db) connection = null; };
        finish(null, db);
      };
    }).finally(() => { opening = null; });
    return opening;
  };
  async function transact(mode, run) {
    const db = await database(); active();
    return new Promise((resolve, reject) => {
      let tx, value, cause, settled = false;
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      try { tx = db.transaction(STORE, mode); } catch (error) { reject(error); return; }
      const timer = setTimeout(() => {
        cause = fail('DOCUMENT_PAGE_REPLACEMENT_STORE_UNAVAILABLE', 'The saved page replacement intent timed out.');
        try { tx.abort(); } catch { finish(cause); }
      }, timeoutMs);
      tx.oncomplete = () => finish();
      tx.onabort = () => finish(cause || tx.error || fail('DOCUMENT_PAGE_REPLACEMENT_STORE_UNAVAILABLE', 'The saved page replacement intent did not commit.'));
      tx.onerror = event => { cause ||= event.target?.error || tx.error; };
      try { run(tx.objectStore(STORE), next => { value = next; }, error => { cause = error; try { tx.abort(); } catch { finish(error); } }); }
      catch (error) { cause = error; try { tx.abort(); } catch { finish(error); } }
    });
  }
  return {
    async reserve(actorUserId, documentId, input) {
      check(uuid(actorUserId) && uuid(documentId)
        && exact(input, ['operation', 'generationId', 'walHead', 'localPageState'])
        && uuid(input.generationId) && seq(input.walHead));
      const capturedOperation = operation(input.operation);
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            if (request.result) {
              const current = validate(request.result, actorUserId, documentId);
              check(current.body.generation_id === input.generationId
                && current.body.wal_head === input.walHead
                && stable(current.body.operation) === stable(capturedOperation),
              'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
              done({ row: current, created: false }); return;
            }
            const now = new Date().toISOString();
            const row = validate({ version: 1, revision: 1, actorUserId, documentId,
              phase: 'pending', publication: null, terminal: null, createdAt: now, updatedAt: now,
              localPageState: captureCheckedPageStructure(input.localPageState),
              body: { document_id: documentId, generation_id: input.generationId,
                wal_head: input.walHead, operation: capturedOperation,
                source_id: randomUUID(), candidate_operation_id: randomUUID(),
                // New intents offer one ordered archive id for the PDF and one
                // for the optional fixed legacy sidecar. The server consumes
                // the verified-object-count prefix. Version-1 rows with one id
                // remain valid and resumable for sidecar-free sources.
                archive_operation_ids: [randomUUID(), randomUUID()] } }, actorUserId, documentId);
            store.add(row); done({ row, created: true });
          } catch (error) { abort(error); }
        };
      });
    },
    async get(actorUserId, documentId) {
      check(uuid(actorUserId) && uuid(documentId));
      return transact('readonly', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try { done(request.result ? validate(request.result, actorUserId, documentId) : null); }
          catch (error) { abort(error); }
        };
      });
    },
    async markPublished(actorUserId, documentId, expectedRevision, publication) {
      check(Number.isSafeInteger(expectedRevision) && expectedRevision > 0);
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            const row = validate(request.result, actorUserId, documentId);
            const exactPublication = published(publication, row.body);
            if (row.phase === 'published') {
              check(stable(row.publication) === stable(exactPublication),
                'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
              done(row); return;
            }
            check(['pending', 'dispatched'].includes(row.phase)
              && row.revision === expectedRevision, 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
            row.phase = 'published'; row.publication = exactPublication;
            row.revision += 1; row.updatedAt = new Date().toISOString();
            validate(row, actorUserId, documentId); store.put(row); done(row);
          } catch (error) { abort(error); }
        };
      });
    },
    async markExpired(actorUserId, documentId, expectedRevision, receipt) {
      check(Number.isSafeInteger(expectedRevision) && expectedRevision > 0);
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            const row = validate(request.result, actorUserId, documentId);
            const exactTerminal = terminal(receipt, row.body, actorUserId);
            if (row.phase === 'expired') {
              check(stable(row.terminal) === stable(exactTerminal),
                'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
              done(row); return;
            }
            check(['pending', 'dispatched'].includes(row.phase)
              && row.revision === expectedRevision, 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
            row.phase = 'expired'; row.terminal = exactTerminal;
            row.revision += 1; row.updatedAt = new Date().toISOString();
            validate(row, actorUserId, documentId); store.put(row); done(row);
          } catch (error) { abort(error); }
        };
      });
    },
    async markDispatched(actorUserId, documentId, expectedRevision) {
      check(Number.isSafeInteger(expectedRevision) && expectedRevision > 0);
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            const row = validate(request.result, actorUserId, documentId);
            if (row.phase !== 'pending') { done(row); return; }
            check(row.revision === expectedRevision, 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
            row.phase = 'dispatched'; row.revision += 1; row.updatedAt = new Date().toISOString();
            validate(row, actorUserId, documentId); store.put(row); done(row);
          } catch (error) { abort(error); }
        };
      });
    },
    async discardPending(actorUserId, documentId, expectedRevision) {
      check(Number.isSafeInteger(expectedRevision) && expectedRevision > 0);
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            const row = validate(request.result, actorUserId, documentId);
            check(row.phase === 'pending' && row.revision === expectedRevision,
              'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
            store.delete([actorUserId, documentId]); done(true);
          } catch (error) { abort(error); }
        };
      });
    },
    async finish(actorUserId, documentId, expectedRevision) {
      check(Number.isSafeInteger(expectedRevision) && expectedRevision > 0);
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            const row = validate(request.result, actorUserId, documentId);
            check(row.phase === 'published' && row.revision === expectedRevision,
              'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
            store.delete([actorUserId, documentId]); done(true);
          } catch (error) { abort(error); }
        };
      });
    },
    async resetExpired(actorUserId, documentId, expectedRevision, candidateOperationId) {
      check(Number.isSafeInteger(expectedRevision) && expectedRevision > 0
        && uuid(candidateOperationId));
      return transact('readwrite', (store, done, abort) => {
        const request = store.get([actorUserId, documentId]);
        request.onsuccess = () => {
          try {
            const row = validate(request.result, actorUserId, documentId);
            check(row.phase === 'expired' && row.revision === expectedRevision
              && row.body.candidate_operation_id === candidateOperationId
              && row.terminal?.candidate_operation_id === candidateOperationId,
            'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
            store.delete([actorUserId, documentId]); done(true);
          } catch (error) { abort(error); }
        };
      });
    },
    close() { closed = true; connection?.close(); connection = null; },
  };
}
