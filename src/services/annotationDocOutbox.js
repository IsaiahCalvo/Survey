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

// compactAccepted's snapshot may be a function: the caller's full-document
// encode then runs only when a compaction actually happens (every
// COMPACT_AFTER_DELTAS accepted rows), not after every accepted row. A big
// import is dozens of rows (w26, 2026-09-24); encoding a 17 MB document after
// each one was seconds of wasted work.
function resolveAcceptedSnapshot(acceptedSnapshot) {
  return typeof acceptedSnapshot === 'function' ? acceptedSnapshot() : acceptedSnapshot;
}

function sameBytes(left, right) {
  if (left == null || right == null) return left == null && right == null;
  const a = left instanceof Uint8Array ? left : new Uint8Array(left);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right);
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

// Open speed (w29, 2026-09-24): compaction options.
//
// `covered` = { token, checkpointUpdate, recordKeys } describes what the
// caller's accepted state is KNOWN to contain: the checkpoint it loaded or
// last wrote (by `token`; `checkpointUpdate` bytes only for a checkpoint
// saved before tokens existed) and the accepted record keys already applied
// to it. When the store still holds that checkpoint (or none) and no record
// outside those keys, merging would give back the accepted state itself, so
// it is stored as-is instead of merging two ~20 MB updates. Anything else
// (another tab compacted or added records) takes the full merge as before.
//
// `identity` (a value, or a function called right after the accepted state
// is encoded) names the cloud snapshot row the stored checkpoint is known to
// contain: { atSeq, writerId, writerEpoch }. An open whose cloud snapshot row
// still has that identity can skip downloading it (annotationDocSync). A
// MERGED checkpoint keeps the previous identity unless a new one is given
// (the merge contains the previous checkpoint). A checkpoint stored as-is
// carries only the identity given with it (review A, w29).
//
// `token` names the checkpoint this compaction writes. The caller may use it
// as its next `covered.token` only when `outcome.merged` is false: a merged
// checkpoint can hold content (another tab's) its accepted state lacks.
//
// `onlyIfCovered`: store only via the as-is path; when that does not apply,
// do nothing and return false (no ~20 MB merge on the main thread).
//
// `outcome` (optional object) is filled with { merged } when a checkpoint is
// written.
function checkpointCovered(checkpoint, covered) {
  if (!checkpoint) return true;
  if (checkpoint.token != null) return checkpoint.token === covered.token;
  return covered.checkpointUpdate != null && sameBytes(checkpoint.update, covered.checkpointUpdate);
}

function compactionPlan(checkpoint, acceptedSnapshot, records, options = {}) {
  const resolved = resolveAcceptedSnapshot(acceptedSnapshot);
  const resolvedIdentity = typeof options.identity === 'function'
    ? options.identity()
    : options.identity;
  const identity = normalizeSnapshotIdentity(resolvedIdentity)
    || normalizeSnapshotIdentity(checkpoint?.snapshotIdentity);
  const token = options.token || newCheckpointToken();
  const covered = options.covered;
  if (
    resolved
    && covered
    && checkpointCovered(checkpoint, covered)
    && records.every((record) => covered.recordKeys?.has?.(record.key))
  ) {
    return {
      update: cloneBytes(resolved),
      identity: normalizeSnapshotIdentity(resolvedIdentity),
      token,
      merged: false,
    };
  }
  if (options.onlyIfCovered) return { skip: true };
  const updates = [
    checkpoint?.update,
    resolved,
    ...records.map((record) => record.update),
  ].filter(Boolean).map(cloneBytes);
  if (!updates.length) return { update: null, identity, token, merged: false };
  return { update: Y.mergeUpdates(updates), identity, token, merged: true };
}

export function normalizeSnapshotIdentity(identity) {
  if (!identity || identity.atSeq == null) return null;
  const atSeq = Number(identity.atSeq);
  const writerEpoch = Number(identity.writerEpoch);
  if (!Number.isFinite(atSeq) || !Number.isFinite(writerEpoch)) return null;
  return {
    atSeq,
    writerId: identity.writerId == null ? null : String(identity.writerId),
    writerEpoch,
  };
}

function newCheckpointToken() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

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

async function openDatabase(indexedDb, timeoutMs) {
  const request = indexedDb.open(DB_NAME, DB_VERSION);
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
        checkpointToken: checkpoint?.token ?? null,
        snapshotIdentity: normalizeSnapshotIdentity(checkpoint?.snapshotIdentity),
      };
    },
    async compactAccepted(
      documentId,
      actorUserId,
      acceptedSnapshot,
      force = false,
      expectedIncarnation = 0,
      options = {},
    ) {
      if ((Number(expectedIncarnation) || 0) !== (incarnations.get(documentId) || 0)) {
        throw staleIncarnationError(documentId);
      }
      const scopeKey = actorScopeKey(documentId, actorUserId);
      const records = listStore(accepted, documentId, actorUserId);
      if (!force && records.length < COMPACT_AFTER_DELTAS) return false;
      const plan = compactionPlan(
        checkpoints.get(scopeKey),
        acceptedSnapshot,
        records,
        options || {},
      );
      if (plan.skip) return false;
      const { update, identity, token } = plan;
      if (options?.outcome) options.outcome.merged = plan.merged;
      checkpoints.set(scopeKey, {
        scopeKey,
        update: update || Y.mergeUpdates([]),
        token,
        snapshotIdentity: identity,
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
} = {}) {
  if (!indexedDb?.open) {
    sharedMemoryAnnotationOutbox ??= createMemoryAnnotationOutbox();
    return sharedMemoryAnnotationOutbox;
  }
  const db = await openDatabase(indexedDb, timeoutMs);
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
    async list(documentId, actorUserId) {
      return list(PENDING_STORE, documentId, actorUserId);
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
            checkpointToken: checkpoint?.token ?? null,
            snapshotIdentity: normalizeSnapshotIdentity(checkpoint?.snapshotIdentity),
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
      options = {},
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
          const plan = compactionPlan(
            checkpoint,
            acceptedSnapshot,
            records,
            options || {},
          );
          if (plan.skip) return false;
          const { update, identity, token } = plan;
          if (update && options?.outcome) options.outcome.merged = plan.merged;
          if (update) {
            await requestResult(stores[CHECKPOINT_STORE].put({
              scopeKey,
              update,
              token,
              snapshotIdentity: identity,
              acceptedKeys: [
                ...new Set([
                  ...(checkpoint?.acceptedKeys || []),
                  ...records.map((record) => record.key),
                ]),
              ],
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
