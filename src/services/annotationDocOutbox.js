import * as Y from 'yjs';

const DB_NAME = 'survey-annotation-outbox-v2';
const DB_VERSION = 3;
const PENDING_STORE = 'pending';
const ACCEPTED_STORE = 'accepted';
const QUARANTINE_STORE = 'quarantined';
const CHECKPOINT_STORE = 'acceptedCheckpoints';
const INCARNATION_STORE = 'documentIncarnations';
const REQUEST_TIMEOUT_MS = 10_000;
const COMPACT_AFTER_DELTAS = 40;

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
  };
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

export function createMemoryAnnotationOutbox() {
  const pending = new Map();
  const accepted = new Map();
  const quarantined = new Map();
  const checkpoints = new Map();
  const incarnations = new Map();

  const listStore = (store, documentId, actorUserId) => {
    const scopeKey = actorScopeKey(documentId, actorUserId);
    return [...store.values()]
      .filter((record) => record.scopeKey === scopeKey)
      .sort((left, right) => (
        (left.ordinal || 0) - (right.ordinal || 0)
        || String(left.key).localeCompare(String(right.key))
      ))
      .map(cloneRecord);
  };

  return {
    storageKind: 'memory',
    async list(documentId, actorUserId) {
      return listStore(pending, documentId, actorUserId);
    },
    async getDocumentIncarnation(documentId) {
      return incarnations.get(documentId) || 0;
    },
    async put(record) {
      const normalized = normalizePendingRecord(record);
      if ((Number(normalized.incarnation) || 0) !== (incarnations.get(record.documentId) || 0)) {
        throw staleIncarnationError(record.documentId);
      }
      pending.set(normalized.key, normalized);
    },
    async delete(key, expectedIncarnation = null) {
      const record = pending.get(key);
      if (
        record
        && expectedIncarnation != null
        && (Number(record.incarnation) || 0) !== (Number(expectedIncarnation) || 0)
      ) return;
      pending.delete(key);
    },
    async deleteMany(keys, expectedIncarnation = null) {
      for (const key of keys) {
        const record = pending.get(key);
        if (
          record
          && expectedIncarnation != null
          && (Number(record.incarnation) || 0) !== (Number(expectedIncarnation) || 0)
        ) continue;
        pending.delete(key);
      }
    },
    async markRejected(keys, expectedIncarnation = null) {
      for (const key of keys) {
        const record = pending.get(key);
        if (
          record
          && expectedIncarnation != null
          && (Number(record.incarnation) || 0) !== (Number(expectedIncarnation) || 0)
        ) continue;
        if (record) {
          const rejected = { ...record, status: 'rejected' };
          pending.set(key, rejected);
          quarantined.set(key, rejected);
        }
      }
    },
    async listQuarantined(documentId, actorUserId) {
      return listStore(quarantined, documentId, actorUserId);
    },
    async deleteFromOrdinal(
      documentId,
      actorUserId,
      writerId,
      ordinal,
      expectedIncarnation = null,
    ) {
      const scopeKey = actorScopeKey(documentId, actorUserId);
      for (const [key, record] of pending) {
        if (
          record.scopeKey === scopeKey
          && record.writerId === writerId
          && record.ordinal >= ordinal
          && (
            expectedIncarnation == null
            || (Number(record.incarnation) || 0) === (Number(expectedIncarnation) || 0)
          )
        ) pending.delete(key);
      }
    },
    async settleAccepted(record) {
      const normalized = normalizePendingRecord({ ...record, status: 'accepted' });
      if ((Number(normalized.incarnation) || 0) !== (incarnations.get(record.documentId) || 0)) {
        throw staleIncarnationError(record.documentId);
      }
      accepted.set(normalized.key, normalized);
      pending.delete(normalized.key);
    },
    async loadCleanState(documentId, actorUserId) {
      const scopeKey = actorScopeKey(documentId, actorUserId);
      const checkpoint = checkpoints.get(scopeKey);
      return {
        checkpointUpdate: cloneBytes(checkpoint?.update),
        acceptedKeys: [...(checkpoint?.acceptedKeys || [])],
        records: listStore(accepted, documentId, actorUserId),
      };
    },
    async compactAccepted(
      documentId,
      actorUserId,
      acceptedSnapshot,
      force = false,
      expectedIncarnation = 0,
    ) {
      if ((Number(expectedIncarnation) || 0) !== (incarnations.get(documentId) || 0)) {
        throw staleIncarnationError(documentId);
      }
      const scopeKey = actorScopeKey(documentId, actorUserId);
      const records = listStore(accepted, documentId, actorUserId);
      if (!force && records.length < COMPACT_AFTER_DELTAS) return false;
      const updates = [
        checkpoints.get(scopeKey)?.update,
        acceptedSnapshot,
        ...records.map((record) => record.update),
      ].filter(Boolean).map(cloneBytes);
      checkpoints.set(scopeKey, {
        scopeKey,
        update: Y.mergeUpdates(updates),
        acceptedKeys: [
          ...new Set([
            ...(checkpoints.get(scopeKey)?.acceptedKeys || []),
            ...records.map((record) => record.key),
          ]),
        ],
      });
      for (const record of records) accepted.delete(record.key);
      return true;
    },
    async deleteScope(documentId, actorUserId, expectedIncarnation = 0) {
      if ((Number(expectedIncarnation) || 0) !== (incarnations.get(documentId) || 0)) {
        throw staleIncarnationError(documentId);
      }
      const scopeKey = actorScopeKey(documentId, actorUserId);
      for (const store of [pending, accepted, quarantined]) {
        for (const [key, record] of store) {
          if (record.scopeKey === scopeKey) store.delete(key);
        }
      }
      checkpoints.delete(scopeKey);
    },
    async deleteDocument(documentId) {
      incarnations.set(documentId, (incarnations.get(documentId) || 0) + 1);
      for (const store of [pending, accepted, quarantined]) {
        for (const [key, record] of store) {
          if (record.documentId === documentId) store.delete(key);
        }
      }
      for (const key of checkpoints.keys()) {
        if (key.startsWith(`${documentId}\u0000`)) checkpoints.delete(key);
      }
    },
    async close() {},
  };
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

  const run = (storeNames, mode, operation) => {
    if (closing) return Promise.reject(new Error('annotation outbox is closing'));
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = db.transaction(names, mode);
    activeTransactions.add(transaction);
    const completion = transactionCompletion(transaction, timeoutMs);
    const task = (async () => {
      try {
        const stores = Object.fromEntries(
          names.map((name) => [name, transaction.objectStore(name)]),
        );
        const value = await operation(stores, transaction);
        await completion;
        return value;
      } catch (error) {
        try { transaction.abort(); } catch { /* transaction already closed */ }
        await completion.catch(() => {});
        throw error;
      } finally {
        activeTransactions.delete(transaction);
      }
    })();
    inFlight.add(task);
    task.finally(() => inFlight.delete(task)).catch(() => {});
    return task;
  };

  const list = async (storeName, documentId, actorUserId) => run(
    storeName,
    'readonly',
    async (stores, transaction) => {
      const scopeKey = actorScopeKey(documentId, actorUserId);
      const rows = await requestResult(
        stores[storeName].index('scopeKey').getAll(scopeKey),
        transaction,
        timeoutMs,
      );
      return rows
        .sort((left, right) => (
          (left.ordinal || 0) - (right.ordinal || 0)
          || String(left.key).localeCompare(String(right.key))
        ))
        .map(cloneRecord);
    },
  );

  return {
    storageKind: 'indexeddb',
    async readLocalStateFresh(documentId, actorUserId, expectedIncarnation) {
      // A retired viewer's original connection is closed. Revalidate through
      // a read-only fresh connection without creating a missing database.
      const fresh = await createAnnotationOutbox({ indexedDb, timeoutMs, existingOnly: true });
      try {
        const state = await fresh.readLocalState(documentId, actorUserId, expectedIncarnation);
        if (await fresh.getDocumentIncarnation(documentId) !== expectedIncarnation) {
          throw staleIncarnationError(documentId);
        }
        return state;
      } finally {
        await fresh.close();
      }
    },
    async list(documentId, actorUserId) {
      return list(PENDING_STORE, documentId, actorUserId);
    },
    async readLocalState(documentId, actorUserId, expectedIncarnation) {
      const scopeKey = actorScopeKey(documentId, actorUserId);
      return run(
        [CHECKPOINT_STORE, ACCEPTED_STORE, PENDING_STORE, QUARANTINE_STORE, INCARNATION_STORE],
        'readonly',
        async (stores, transaction) => {
          // One transaction sees pending-to-accepted moves and compaction as
          // whole operations. Separate reads could miss an entry between them.
          const [incarnationRow, checkpoint, accepted, pending, quarantined] = await Promise.all([
            requestResult(stores[INCARNATION_STORE].get(documentId), transaction, timeoutMs),
            requestResult(stores[CHECKPOINT_STORE].get(scopeKey), transaction, timeoutMs),
            ...[ACCEPTED_STORE, PENDING_STORE, QUARANTINE_STORE].map((name) => (
              requestResult(stores[name].index('scopeKey').getAll(scopeKey), transaction, timeoutMs)
            )),
          ]);
          const incarnation = Number(incarnationRow?.incarnation) || 0;
          if (incarnation !== expectedIncarnation) throw staleIncarnationError(documentId);
          return {
            documentId, actorUserId, incarnation,
            checkpointUpdate: cloneBytes(checkpoint?.update),
            acceptedKeys: [...(checkpoint?.acceptedKeys || [])],
            accepted: accepted.map(cloneRecord),
            pending: pending.map(cloneRecord),
            quarantined: quarantined.map(cloneRecord),
          };
        },
      );
    },
    async getDocumentIncarnation(documentId) {
      return run(
        INCARNATION_STORE,
        'readonly',
        async (stores, transaction) => {
          const row = await requestResult(
            stores[INCARNATION_STORE].get(documentId),
            transaction,
            timeoutMs,
          );
          return Number(row?.incarnation) || 0;
        },
      );
    },
    async put(record) {
      const normalized = normalizePendingRecord(record);
      await run(
        [PENDING_STORE, INCARNATION_STORE],
        'readwrite',
        async (stores, transaction) => {
          const current = await requestResult(
            stores[INCARNATION_STORE].get(record.documentId),
            transaction,
            timeoutMs,
          );
          if ((Number(normalized.incarnation) || 0) !== (Number(current?.incarnation) || 0)) {
            throw staleIncarnationError(record.documentId);
          }
          await requestResult(stores[PENDING_STORE].put(normalized), transaction);
        },
      );
    },
    async delete(key, expectedIncarnation = null) {
      await run(PENDING_STORE, 'readwrite', async (stores, transaction) => {
        const record = await requestResult(
          stores[PENDING_STORE].get(key),
          transaction,
        );
        if (
          record
          && expectedIncarnation != null
          && (Number(record.incarnation) || 0) !== (Number(expectedIncarnation) || 0)
        ) return;
        await requestResult(stores[PENDING_STORE].delete(key), transaction);
      });
    },
    async deleteMany(keys, expectedIncarnation = null) {
      if (!keys?.length) return;
      await run(PENDING_STORE, 'readwrite', async (stores, transaction) => {
        for (const key of keys) {
          const record = await requestResult(
            stores[PENDING_STORE].get(key),
            transaction,
          );
          if (
            record
            && expectedIncarnation != null
            && (Number(record.incarnation) || 0) !== (Number(expectedIncarnation) || 0)
          ) continue;
          await requestResult(stores[PENDING_STORE].delete(key), transaction);
        }
      });
    },
    async markRejected(keys, expectedIncarnation = null) {
      if (!keys?.length) return;
      await run(
        [PENDING_STORE, QUARANTINE_STORE],
        'readwrite',
        async (stores, transaction) => {
          for (const key of keys) {
            const record = await requestResult(
              stores[PENDING_STORE].get(key),
              transaction,
              timeoutMs,
            );
            if (!record) continue;
            if (
              expectedIncarnation != null
              && (Number(record.incarnation) || 0) !== (Number(expectedIncarnation) || 0)
            ) continue;
            const rejected = { ...record, status: 'rejected' };
            await requestResult(
              stores[PENDING_STORE].put(rejected),
              transaction,
              timeoutMs,
            );
            await requestResult(
              stores[QUARANTINE_STORE].put(rejected),
              transaction,
              timeoutMs,
            );
          }
        },
      );
    },
    async listQuarantined(documentId, actorUserId) {
      return list(QUARANTINE_STORE, documentId, actorUserId);
    },
    async deleteFromOrdinal(
      documentId,
      actorUserId,
      writerId,
      ordinal,
      expectedIncarnation = null,
    ) {
      const scopeKey = actorScopeKey(documentId, actorUserId);
      await run(PENDING_STORE, 'readwrite', async (stores, transaction) => {
        const rows = await requestResult(
          stores[PENDING_STORE].index('scopeKey').getAll(scopeKey),
          transaction,
          timeoutMs,
        );
        await Promise.all(rows
          .filter((record) => (
            record.writerId === writerId
            && record.ordinal >= ordinal
            && (
              expectedIncarnation == null
              || (Number(record.incarnation) || 0) === (Number(expectedIncarnation) || 0)
            )
          ))
          .map((record) => requestResult(
            stores[PENDING_STORE].delete(record.key),
            transaction,
            timeoutMs,
          )));
      });
    },
    async settleAccepted(record) {
      const normalized = normalizePendingRecord({ ...record, status: 'accepted' });
      await run(
        [PENDING_STORE, ACCEPTED_STORE, INCARNATION_STORE],
        'readwrite',
        async (stores, transaction) => {
          const current = await requestResult(
            stores[INCARNATION_STORE].get(record.documentId),
            transaction,
          );
          if ((Number(normalized.incarnation) || 0) !== (Number(current?.incarnation) || 0)) {
            throw staleIncarnationError(record.documentId);
          }
          await requestResult(stores[ACCEPTED_STORE].put(normalized), transaction);
          await requestResult(stores[PENDING_STORE].delete(normalized.key), transaction);
        },
      );
    },
    async loadCleanState(documentId, actorUserId) {
      const scopeKey = actorScopeKey(documentId, actorUserId);
      return run(
        [CHECKPOINT_STORE, ACCEPTED_STORE],
        'readonly',
        async (stores, transaction) => {
          const [checkpoint, records] = await Promise.all([
            requestResult(stores[CHECKPOINT_STORE].get(scopeKey), transaction),
            requestResult(
              stores[ACCEPTED_STORE].index('scopeKey').getAll(scopeKey),
              transaction,
            ),
          ]);
          return {
            checkpointUpdate: cloneBytes(checkpoint?.update),
            acceptedKeys: [...(checkpoint?.acceptedKeys || [])],
            records: records
              .sort((left, right) => (
                (left.ordinal || 0) - (right.ordinal || 0)
                || String(left.key).localeCompare(String(right.key))
              ))
              .map(cloneRecord),
          };
        },
      );
    },
    async compactAccepted(
      documentId,
      actorUserId,
      acceptedSnapshot,
      force = false,
      expectedIncarnation = 0,
    ) {
      const scopeKey = actorScopeKey(documentId, actorUserId);
      return run(
        [CHECKPOINT_STORE, ACCEPTED_STORE, INCARNATION_STORE],
        'readwrite',
        async (stores, transaction) => {
          const [incarnation, checkpoint, records] = await Promise.all([
            requestResult(
              stores[INCARNATION_STORE].get(documentId),
              transaction,
            ),
            requestResult(stores[CHECKPOINT_STORE].get(scopeKey), transaction),
            requestResult(
              stores[ACCEPTED_STORE].index('scopeKey').getAll(scopeKey),
              transaction,
            ),
          ]);
          if (
            (Number(expectedIncarnation) || 0)
            !== (Number(incarnation?.incarnation) || 0)
          ) throw staleIncarnationError(documentId);
          if (!force && records.length < COMPACT_AFTER_DELTAS) return false;
          const updates = [
            checkpoint?.update,
            acceptedSnapshot,
            ...records.map((record) => record.update),
          ].filter(Boolean).map(cloneBytes);
          if (updates.length) {
            const update = Y.mergeUpdates(updates);
            const acceptedKeys = [...new Set([
              ...(checkpoint?.acceptedKeys || []),
              ...records.map((record) => record.key),
            ])];
            const previousUpdate = cloneBytes(checkpoint?.update);
            if (records.length === 0 && previousUpdate
              && previousUpdate.length === update.length
              && previousUpdate.every((byte, index) => byte === update[index])
              && (checkpoint.acceptedKeys || []).length === acceptedKeys.length
              && acceptedKeys.every((key, index) => checkpoint.acceptedKeys[index] === key)) {
              // Keep the incarnation check and transaction completion above/
              // below, but do not put identical checkpoint bytes on clean close.
              return false;
            }
            await requestResult(stores[CHECKPOINT_STORE].put({
              scopeKey,
              update,
              acceptedKeys,
            }), transaction);
          }
          await Promise.all(records.map((record) => requestResult(
            stores[ACCEPTED_STORE].delete(record.key),
            transaction,
          )));
          return true;
        },
      );
    },
    async deleteScope(documentId, actorUserId, expectedIncarnation = 0) {
      const scopeKey = actorScopeKey(documentId, actorUserId);
      await run(
        [
          PENDING_STORE,
          ACCEPTED_STORE,
          QUARANTINE_STORE,
          CHECKPOINT_STORE,
          INCARNATION_STORE,
        ],
        'readwrite',
        async (stores, transaction) => {
          const incarnation = await requestResult(
            stores[INCARNATION_STORE].get(documentId),
            transaction,
          );
          if (
            (Number(expectedIncarnation) || 0)
            !== (Number(incarnation?.incarnation) || 0)
          ) throw staleIncarnationError(documentId);
          for (const name of [PENDING_STORE, ACCEPTED_STORE, QUARANTINE_STORE]) {
            const rows = await requestResult(
              stores[name].index('scopeKey').getAll(scopeKey),
              transaction,
            );
            await Promise.all(rows.map((record) => requestResult(
              stores[name].delete(record.key),
              transaction,
            )));
          }
          await requestResult(stores[CHECKPOINT_STORE].delete(scopeKey), transaction);
        },
      );
    },
    async deleteDocument(documentId) {
      await run(
        [
          PENDING_STORE,
          ACCEPTED_STORE,
          QUARANTINE_STORE,
          CHECKPOINT_STORE,
          INCARNATION_STORE,
        ],
        'readwrite',
        async (stores, transaction) => {
          const current = await requestResult(
            stores[INCARNATION_STORE].get(documentId),
            transaction,
          );
          await requestResult(stores[INCARNATION_STORE].put({
            documentId,
            incarnation: (Number(current?.incarnation) || 0) + 1,
          }), transaction);
          for (const name of [PENDING_STORE, ACCEPTED_STORE, QUARANTINE_STORE]) {
            const rows = await requestResult(stores[name].getAll(), transaction);
            await Promise.all(rows
              .filter((record) => record.documentId === documentId)
              .map((record) => requestResult(
                stores[name].delete(record.key),
                transaction,
              )));
          }
          const checkpoints = await requestResult(
            stores[CHECKPOINT_STORE].getAll(),
            transaction,
          );
          await Promise.all(checkpoints
            .filter((record) => record.scopeKey.startsWith(`${documentId}\u0000`))
            .map((record) => requestResult(
              stores[CHECKPOINT_STORE].delete(record.scopeKey),
              transaction,
            )));
        },
      );
    },
    async close() {
      closing = true;
      if (inFlight.size > 0) {
        let timer;
        await Promise.race([
          Promise.allSettled([...inFlight]),
          new Promise((resolve) => {
            timer = setTimeout(() => {
              for (const transaction of activeTransactions) {
                try { transaction.abort(); } catch { /* already closed */ }
              }
              resolve();
            }, timeoutMs);
          }),
        ]);
        if (timer) clearTimeout(timer);
        await Promise.allSettled([...inFlight]);
      }
      db.close();
    },
  };
}
