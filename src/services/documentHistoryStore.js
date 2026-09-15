import { computeContentSha256 } from './contentHash.js';

// This final scoped schema uses a fresh database. The earlier in-flight draft
// stays untouched; it was never a supported migration source.
const DB_NAME = 'survey-document-history-v2-scoped';
const DB_VERSION = 2;
const ROWS = 'rows';
const META = 'meta';
const EVICTION = 'eviction';
const SCOPE_DOCUMENT = 'scopeDocument';
const SCOPE_DOCUMENT_TIME = 'scopeDocumentTime';
const SCOPE_SYNC_SAVED = 'scopeSyncSaved';
const SAVED_AT = 'savedAt';
const GLOBAL_META_KEY = 'global';
const DEFAULT_TIMEOUT_MS = 5000;
export const DOCUMENT_HISTORY_CONFIRMED_BUDGET_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_HISTORY_PROTECTED_LIMIT_BYTES = 64 * 1024 * 1024;

const fail = (code, message) => Object.assign(new Error(message), { code });
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const timestamp = value => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value ?? null;
};
const CLIENT_FIELDS = ['document_id', 'user_id', 'client_event_id', 'event_type', 'source',
  'page_number', 'annotation_id', 'summary', 'payload', 'is_undoable', 'is_checkpoint', 'occurred_at'];
const SERVER_DEFAULTS = { payload: {}, is_undoable: true, is_checkpoint: false };

export function canonicalDocumentHistoryRow(row) {
  if (!row || typeof row !== 'object' || !row.document_id || !row.client_event_id) return null;
  return Object.fromEntries(CLIENT_FIELDS.map(key => [key, key === 'occurred_at'
    ? timestamp(row[key] ?? row.created_at)
    : row[key] ?? SERVER_DEFAULTS[key] ?? null]));
}

const encodeBytes = value => new TextEncoder().encode(stable(value)).byteLength;
const digestRow = async row => computeContentSha256(new TextEncoder().encode(stable(row)));
const rowKey = (scopeKey, documentId, clientEventId) => [scopeKey, documentId, clientEventId];
const replayToken = row => ({ scopeKey: row.scopeKey, documentId: row.documentId,
  clientEventId: row.clientEventId, revision: row.revision, rowDigest: row.rowDigest });
const exactToken = (row, token) => Boolean(row && token
  && row.scopeKey === token.scopeKey && row.documentId === token.documentId
  && row.clientEventId === token.clientEventId && row.revision === token.revision
  && row.rowDigest === token.rowDigest);
const isAccountScope = scopeKey => typeof scopeKey === 'string'
  && scopeKey.startsWith('account:') && scopeKey.length > 'account:'.length;
const encodeReplayCursor = key => `v1:${JSON.stringify(key)}`;
const decodeReplayCursor = cursor => {
  if (cursor == null) return null;
  if (typeof cursor !== 'string' || !cursor.startsWith('v1:')) {
    throw fail('DOCUMENT_HISTORY_STORE_INVALID', 'The history replay cursor is invalid.');
  }
  try {
    const key = JSON.parse(cursor.slice(3));
    if (!Array.isArray(key) || key.length !== 5 || key[1] !== 'pending') throw new Error('invalid');
    return key;
  } catch {
    throw fail('DOCUMENT_HISTORY_STORE_INVALID', 'The history replay cursor is invalid.');
  }
};
const scopeMetaKey = scopeKey => `scope:${scopeKey}`;
const emptyGlobal = () => ({ key: GLOBAL_META_KEY, protectedBytes: 0, confirmedBytes: 0 });
const emptyScope = scopeKey => ({ key: scopeMetaKey(scopeKey), scopeKey, pendingCount: 0,
  protectedBytes: 0, confirmedBytes: 0, lastErrorCode: null });
const requestValue = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || fail('DOCUMENT_HISTORY_STORE_UNAVAILABLE', 'Local history storage failed.'));
});

function transactionDone(tx, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => {
      try { tx.abort(); } catch { /* already ended */ }
      finish(fail('DOCUMENT_HISTORY_STORE_TIMEOUT', 'Local history storage timed out.'));
    }, timeoutMs);
    tx.oncomplete = () => finish();
    tx.onabort = () => finish(tx.error || fail('DOCUMENT_HISTORY_STORE_UNAVAILABLE', 'Local history storage did not commit.'));
    tx.onerror = () => {};
  });
}

export function createDocumentHistoryStore({ indexedDB = globalThis.indexedDB, dbName = DB_NAME,
  timeoutMs = DEFAULT_TIMEOUT_MS, confirmedBudgetBytes = DOCUMENT_HISTORY_CONFIRMED_BUDGET_BYTES,
  protectedLimitBytes = DOCUMENT_HISTORY_PROTECTED_LIMIT_BYTES,
  BroadcastChannel: Channel = globalThis.BroadcastChannel,
  IDBKeyRange: KeyRange = globalThis.IDBKeyRange } = {}) {
  if (!indexedDB?.open || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
    || !Number.isSafeInteger(confirmedBudgetBytes) || confirmedBudgetBytes < 0
    || !Number.isSafeInteger(protectedLimitBytes) || protectedLimitBytes < 1 || !KeyRange?.bound) {
    throw fail('DOCUMENT_HISTORY_STORE_INVALID', 'Local history storage settings are invalid.');
  }
  let dbPromise;
  let closed = false;
  let writeClock = 0;
  const listeners = new Map();
  let channel = null;
  const notify = (scopeKey, broadcast = true) => {
    for (const listener of listeners.get(scopeKey) || []) {
      try { listener(); } catch { /* listener owns errors */ }
    }
    if (broadcast) {
      try { channel?.postMessage({ scopeKey }); } catch { /* polling remains available */ }
    }
  };
  try {
    channel = typeof Channel === 'function' ? new Channel(`${dbName}:changes`) : null;
    if (channel) channel.onmessage = event => notify(event?.data?.scopeKey, false);
  } catch { channel = null; }

  const open = () => {
    if (closed) return Promise.reject(fail('DOCUMENT_HISTORY_STORE_CLOSED', 'Local history storage is closed.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const finish = (error, db) => {
        if (settled) { db?.close(); return; }
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(db);
      };
      const timer = setTimeout(() => finish(fail('DOCUMENT_HISTORY_STORE_TIMEOUT', 'Opening local history storage timed out.')), timeoutMs);
      try { request = indexedDB.open(dbName, DB_VERSION); } catch (error) { finish(error); return; }
      request.onblocked = () => finish(fail('DOCUMENT_HISTORY_STORE_UNAVAILABLE', 'Local history storage is blocked.'));
      request.onerror = () => finish(request.error || fail('DOCUMENT_HISTORY_STORE_UNAVAILABLE', 'Local history storage could not open.'));
      request.onupgradeneeded = () => {
        const db = request.result;
        const rows = db.objectStoreNames.contains(ROWS)
          ? request.transaction.objectStore(ROWS)
          : db.createObjectStore(ROWS, { keyPath: ['scopeKey', 'documentId', 'clientEventId'] });
        if (!rows.indexNames.contains(SCOPE_DOCUMENT)) rows.createIndex(SCOPE_DOCUMENT, ['scopeKey', 'documentId']);
        if (!rows.indexNames.contains(SCOPE_DOCUMENT_TIME)) {
          rows.createIndex(SCOPE_DOCUMENT_TIME, ['scopeKey', 'documentId', 'occurredAt', 'savedAt']);
        }
        if (!rows.indexNames.contains(SCOPE_SYNC_SAVED)) {
          rows.createIndex(SCOPE_SYNC_SAVED,
            ['scopeKey', 'syncState', 'savedAt', 'documentId', 'clientEventId']);
        }
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(EVICTION)) {
          const eviction = db.createObjectStore(EVICTION, { keyPath: ['scopeKey', 'documentId', 'clientEventId'] });
          eviction.createIndex(SAVED_AT, 'savedAt');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (closed) { db.close(); finish(fail('DOCUMENT_HISTORY_STORE_CLOSED', 'Local history storage is closed.')); return; }
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        finish(null, db);
      };
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  };

  const write = async work => {
    const db = await open();
    const tx = db.transaction([ROWS, META, EVICTION], 'readwrite');
    const done = transactionDone(tx, timeoutMs);
    const changedScopes = new Set();
    let result;
    let cause;
    try {
      result = await work({ rows: tx.objectStore(ROWS), meta: tx.objectStore(META),
        eviction: tx.objectStore(EVICTION), changedScopes });
    } catch (error) {
      cause = error;
      try { tx.abort(); } catch { /* transaction ended */ }
    }
    try { await done; } catch (error) { throw cause || error; }
    for (const scopeKey of changedScopes) notify(scopeKey);
    return result;
  };

  const loadCounters = async (meta, scopeKey) => {
    const [global, scope] = await Promise.all([
      requestValue(meta.get(GLOBAL_META_KEY)), requestValue(meta.get(scopeMetaKey(scopeKey))),
    ]);
    return { global: global || emptyGlobal(), scope: scope || emptyScope(scopeKey) };
  };
  const removeFromCounters = (global, scope, row) => {
    if (row.syncState === 'pending') {
      global.protectedBytes -= row.bytes;
      scope.protectedBytes -= row.bytes;
      scope.pendingCount -= 1;
    } else {
      global.confirmedBytes -= row.bytes;
      scope.confirmedBytes -= row.bytes;
    }
  };
  const addToCounters = (global, scope, row) => {
    if (row.syncState === 'pending') {
      global.protectedBytes += row.bytes;
      scope.protectedBytes += row.bytes;
      scope.pendingCount += 1;
    } else {
      global.confirmedBytes += row.bytes;
      scope.confirmedBytes += row.bytes;
    }
  };
  const nextSavedAt = () => Date.now() * 1000 + (++writeClock % 1000);
  const measureSaved = saved => {
    let bytes = saved.bytes || 0;
    for (let i = 0; i < 3; i += 1) {
      const measured = { ...saved, bytes };
      const evictionBytes = saved.syncState === 'confirmed' ? encodeBytes({ scopeKey: saved.scopeKey,
        documentId: saved.documentId, clientEventId: saved.clientEventId,
        savedAt: saved.savedAt, bytes }) : 0;
      bytes = encodeBytes(measured) + evictionBytes;
    }
    return bytes;
  };
  const makeSaved = ({ scopeKey, canonical, rowDigest, revision, syncState }) => {
    const saved = { version: 2, scopeKey, documentId: canonical.document_id,
      clientEventId: canonical.client_event_id, revision, rowDigest, syncState,
      occurredAt: canonical.occurred_at || '', savedAt: nextSavedAt(), bytes: 0, row: canonical,
      ...(syncState === 'pending' ? { attemptCount: 0 } : {}) };
    // Count the full row envelope and, for evictable rows, its compact eviction entry.
    saved.bytes = measureSaved(saved);
    return saved;
  };
  const evictionRecord = row => ({ scopeKey: row.scopeKey, documentId: row.documentId,
    clientEventId: row.clientEventId, savedAt: row.savedAt, bytes: row.bytes });

  const pruneConfirmed = async (ports, global, knownScopes, notifyEvictions) => {
    if (global.confirmedBytes <= confirmedBudgetBytes) return;
    // This reads compact eviction metadata only. It never clones stored payloads.
    const candidates = await requestValue(ports.eviction.index(SAVED_AT).getAll());
    for (const candidate of candidates) {
      if (global.confirmedBytes <= confirmedBudgetBytes) break;
      let scope = knownScopes.get(candidate.scopeKey);
      if (!scope) {
        scope = await requestValue(ports.meta.get(scopeMetaKey(candidate.scopeKey))) || emptyScope(candidate.scopeKey);
        knownScopes.set(candidate.scopeKey, scope);
      }
      ports.rows.delete(rowKey(candidate.scopeKey, candidate.documentId, candidate.clientEventId));
      ports.eviction.delete(rowKey(candidate.scopeKey, candidate.documentId, candidate.clientEventId));
      global.confirmedBytes -= candidate.bytes;
      scope.confirmedBytes -= candidate.bytes;
      if (notifyEvictions) ports.changedScopes.add(candidate.scopeKey);
    }
  };

  const cacheBatch = async (scopeKey, cloudRows) => {
    const canonicalRows = new Map();
    for (const row of cloudRows || []) {
      const canonical = canonicalDocumentHistoryRow(row);
      if (canonical) canonicalRows.set(`${canonical.document_id}\0${canonical.client_event_id}`, canonical);
    }
    if (!scopeKey || canonicalRows.size === 0) return false;
    const digested = await Promise.all([...canonicalRows.values()].map(async canonical =>
      ({ canonical, rowDigest: await digestRow(canonical) })));
    return write(async ports => {
      const counters = await loadCounters(ports.meta, scopeKey);
      const knownScopes = new Map([[scopeKey, counters.scope]]);
      let changed = false;
      let confirmedPending = false;
      for (const { canonical, rowDigest } of digested) {
        const key = rowKey(scopeKey, canonical.document_id, canonical.client_event_id);
        const prior = await requestValue(ports.rows.get(key));
        if (prior?.syncState === 'pending' && prior.rowDigest !== rowDigest) continue;
        if (prior?.syncState === 'confirmed' && prior.rowDigest === rowDigest) continue;
        const saved = makeSaved({ scopeKey, canonical, rowDigest,
          revision: (prior?.revision || 0) + 1, syncState: 'confirmed' });
        if (!prior && saved.bytes > confirmedBudgetBytes) continue;
        if (prior) {
          confirmedPending ||= prior.syncState === 'pending';
          removeFromCounters(counters.global, counters.scope, prior);
        }
        addToCounters(counters.global, counters.scope, saved);
        ports.rows.put(saved);
        ports.eviction.put(evictionRecord(saved));
        changed = true;
      }
      if (!changed) return false;
      await pruneConfirmed(ports, counters.global, knownScopes, false);
      ports.meta.put(counters.global);
      for (const scope of knownScopes.values()) ports.meta.put(scope);
      if (confirmedPending) ports.changedScopes.add(scopeKey);
      return true;
    });
  };

  return Object.freeze({
    async admitPending(scopeKey, row) {
      const canonical = canonicalDocumentHistoryRow(row);
      if (!scopeKey || !canonical) throw fail('DOCUMENT_HISTORY_LOCAL_ADMISSION_FAILED', 'This history event could not be saved locally.');
      const rowDigest = await digestRow(canonical);
      const outcome = await write(async ports => {
        const key = rowKey(scopeKey, canonical.document_id, canonical.client_event_id);
        const [prior, counters] = await Promise.all([
          requestValue(ports.rows.get(key)), loadCounters(ports.meta, scopeKey),
        ]);
        if (prior?.rowDigest === rowDigest) {
          if (prior.syncState === 'pending' && prior.permanent !== true
            && (prior.retryAt != null || prior.lastReplayErrorCode != null || (prior.attemptCount || 0) > 0)) {
            const reset = { ...prior, attemptCount: 0 };
            delete reset.retryAt;
            delete reset.permanent;
            delete reset.lastReplayErrorCode;
            reset.bytes = measureSaved(reset);
            const delta = reset.bytes - prior.bytes;
            counters.global.protectedBytes += delta;
            counters.scope.protectedBytes += delta;
            ports.rows.put(reset);
            ports.meta.put(counters.global);
            ports.meta.put(counters.scope);
            return { token: replayToken(reset), row: reset.row, created: false };
          }
          return { token: replayToken(prior), row: prior.row, created: false };
        }
        if (prior) {
          if (counters.scope.lastErrorCode !== 'DOCUMENT_HISTORY_EVENT_CONFLICT') {
            counters.scope.lastErrorCode = 'DOCUMENT_HISTORY_EVENT_CONFLICT';
            ports.meta.put(counters.scope);
            ports.changedScopes.add(scopeKey);
          }
          return { failure: 'DOCUMENT_HISTORY_EVENT_CONFLICT' };
        }
        const saved = makeSaved({ scopeKey, canonical, rowDigest,
          revision: (prior?.revision || 0) + 1, syncState: 'pending' });
        const protectedBytes = counters.global.protectedBytes - (prior?.syncState === 'pending' ? prior.bytes : 0) + saved.bytes;
        if (protectedBytes > protectedLimitBytes) {
          if (counters.scope.lastErrorCode !== 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED') {
            counters.scope.lastErrorCode = 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED';
            ports.meta.put(counters.scope);
            ports.changedScopes.add(scopeKey);
          }
          return { failure: 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED' };
        }
        if (prior) removeFromCounters(counters.global, counters.scope, prior);
        addToCounters(counters.global, counters.scope, saved);
        counters.scope.lastErrorCode = null;
        ports.rows.put(saved);
        ports.eviction.delete(key);
        ports.meta.put(counters.global);
        ports.meta.put(counters.scope);
        ports.changedScopes.add(scopeKey);
        return { token: replayToken(saved), row: saved.row, created: true };
      });
      if (outcome?.failure) throw fail(outcome.failure, outcome.failure === 'DOCUMENT_HISTORY_EVENT_CONFLICT'
        ? 'A different history event already uses this event id.' : 'Local protected history is full.');
      return outcome;
    },

    async listPending(scopeKey, { limit = 25, cursor = null, now = Date.now(), includePermanent = false } = {}) {
      if (!isAccountScope(scopeKey)) return { items: [], nextCursor: null, nextRetryAt: null };
      const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
      const replayNow = Number(now);
      if (!Number.isFinite(replayNow) || replayNow < 0 || typeof includePermanent !== 'boolean') {
        throw fail('DOCUMENT_HISTORY_STORE_INVALID', 'The history replay time is invalid.');
      }
      const cursorKey = decodeReplayCursor(cursor);
      if (cursorKey && cursorKey[0] !== scopeKey) {
        throw fail('DOCUMENT_HISTORY_STORE_INVALID', 'The history replay cursor is invalid.');
      }
      const db = await open();
      const tx = db.transaction(ROWS, 'readonly');
      const done = transactionDone(tx, timeoutMs);
      const lower = cursorKey || [scopeKey, 'pending', 0, '', ''];
      const upper = [scopeKey, 'pending', Number.MAX_SAFE_INTEGER, '\uffff', '\uffff'];
      const range = KeyRange.bound(lower, upper, cursorKey != null, false);
      const request = tx.objectStore(ROWS).index(SCOPE_SYNC_SAVED).openCursor(range, 'next');
      const items = [];
      let scanned = 0;
      let lastKey = null;
      let nextRetryAt = null;
      request.onsuccess = () => {
        const pendingCursor = request.result;
        if (!pendingCursor || scanned >= safeLimit) return;
        const saved = pendingCursor.value;
        scanned += 1;
        lastKey = pendingCursor.key;
        if (saved.permanent === true && includePermanent) {
          items.push({ row: structuredClone(saved.row), token: replayToken(saved),
            attemptCount: Number(saved.attemptCount) || 0 });
        } else if (saved.permanent !== true) {
          const retryAt = Number(saved.retryAt || 0);
          if (retryAt <= replayNow) {
            items.push({ row: structuredClone(saved.row), token: replayToken(saved),
              attemptCount: Number(saved.attemptCount) || 0 });
          } else {
            nextRetryAt = nextRetryAt == null ? retryAt : Math.min(nextRetryAt, retryAt);
          }
        }
        if (scanned < safeLimit) pendingCursor.continue();
      };
      await done;
      return { items, nextCursor: scanned === safeLimit && lastKey ? encodeReplayCursor(lastKey) : null,
        nextRetryAt };
    },

    async getPending(token, { includePermanent = false } = {}) {
      if (!isAccountScope(token?.scopeKey)) return null;
      if (typeof includePermanent !== 'boolean') {
        throw fail('DOCUMENT_HISTORY_STORE_INVALID', 'The history replay read is invalid.');
      }
      const db = await open();
      const tx = db.transaction(ROWS, 'readonly');
      const done = transactionDone(tx, timeoutMs);
      const current = await requestValue(tx.objectStore(ROWS).get(
        rowKey(token.scopeKey, token.documentId, token.clientEventId),
      ));
      await done;
      if (!exactToken(current, token) || current.syncState !== 'pending'
        || (current.permanent === true && !includePermanent)) return null;
      return { row: structuredClone(current.row), token: replayToken(current),
        attemptCount: Number(current.attemptCount) || 0 };
    },

    async deferPending(token, { errorCode, retryAt = null, permanent = false } = {}) {
      if (!isAccountScope(token?.scopeKey) || typeof errorCode !== 'string' || !errorCode
        || typeof permanent !== 'boolean'
        || (retryAt != null && (!Number.isFinite(Number(retryAt)) || Number(retryAt) < 0))) {
        throw fail('DOCUMENT_HISTORY_STORE_INVALID', 'The history replay deferral is invalid.');
      }
      return write(async ports => {
        const key = rowKey(token.scopeKey, token.documentId, token.clientEventId);
        const [current, counters] = await Promise.all([
          requestValue(ports.rows.get(key)), loadCounters(ports.meta, token.scopeKey),
        ]);
        if (!exactToken(current, token) || current.syncState !== 'pending') return 'stale';
        const next = { ...current, lastReplayErrorCode: errorCode,
          permanent, ...(permanent ? {} : { retryAt: Number(retryAt || 0),
            attemptCount: (Number(current.attemptCount) || 0) + 1 }) };
        if (permanent) delete next.retryAt;
        next.bytes = measureSaved(next);
        const delta = next.bytes - current.bytes;
        if (counters.global.protectedBytes + delta > protectedLimitBytes) {
          throw fail('DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED', 'Local protected history is full.');
        }
        counters.global.protectedBytes += delta;
        counters.scope.protectedBytes += delta;
        ports.rows.put(next);
        ports.meta.put(counters.global);
        ports.meta.put(counters.scope);
        return 'updated';
      });
    },

    async setScopeError(scopeKey, errorCode) {
      if (!isAccountScope(scopeKey)
        || (errorCode !== null && (typeof errorCode !== 'string' || !errorCode))) return false;
      return write(async ports => {
        const scope = await requestValue(ports.meta.get(scopeMetaKey(scopeKey))) || emptyScope(scopeKey);
        if (scope.lastErrorCode === errorCode) return false;
        scope.lastErrorCode = errorCode;
        ports.meta.put(scope);
        ports.changedScopes.add(scopeKey);
        return true;
      });
    },

    async confirm(token, cloudRow) {
      const canonical = canonicalDocumentHistoryRow(cloudRow);
      if (!token?.scopeKey || !canonical) return false;
      const cloudDigest = await digestRow(canonical);
      return write(async ports => {
        const key = rowKey(token.scopeKey, token.documentId, token.clientEventId);
        const [current, counters] = await Promise.all([
          requestValue(ports.rows.get(key)), loadCounters(ports.meta, token.scopeKey),
        ]);
        if (!exactToken(current, token)
          || cloudDigest !== token.rowDigest) return false;
        if (current.syncState === 'confirmed') return true;
        removeFromCounters(counters.global, counters.scope, current);
        const next = makeSaved({ scopeKey: current.scopeKey, canonical: current.row,
          rowDigest: current.rowDigest, revision: current.revision, syncState: 'confirmed' });
        addToCounters(counters.global, counters.scope, next);
        ports.rows.put(next);
        ports.eviction.put(evictionRecord(next));
        const knownScopes = new Map([[token.scopeKey, counters.scope]]);
        await pruneConfirmed(ports, counters.global, knownScopes, true);
        ports.meta.put(counters.global);
        for (const scope of knownScopes.values()) ports.meta.put(scope);
        ports.changedScopes.add(token.scopeKey);
        return true;
      });
    },

    cacheConfirmed(scopeKey, row) { return cacheBatch(scopeKey, [row]); },
    cacheConfirmedBatch(scopeKey, rows) { return cacheBatch(scopeKey, rows); },

    async list(scopeKey, documentId, limit = 500) {
      if (!scopeKey || !documentId) return [];
      const safeLimit = Math.max(1, Math.min(500, Number(limit) || 500));
      const db = await open();
      const tx = db.transaction(ROWS, 'readonly');
      const done = transactionDone(tx, timeoutMs);
      const request = tx.objectStore(ROWS).index(SCOPE_DOCUMENT_TIME).openCursor(
        KeyRange.bound([scopeKey, documentId, '', 0],
          [scopeKey, documentId, '\uffff', Number.MAX_SAFE_INTEGER]), 'prev');
      const values = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || values.length >= safeLimit) return;
        values.push(cursor.value);
        cursor.continue();
      };
      await done;
      return values.map(value => ({ ...structuredClone(value.row),
        __local: true, __syncState: value.syncState }));
    },

    async status(scopeKey) {
      if (!scopeKey) return { available: false, pendingCount: 0, protectedBytes: 0,
        globalProtectedBytes: 0, protectedLimitBytes, protectedFull: false,
        confirmedCacheBytes: 0, errorCode: 'DOCUMENT_HISTORY_SCOPE_REQUIRED' };
      try {
        const db = await open();
        const tx = db.transaction(META, 'readonly');
        const done = transactionDone(tx, timeoutMs);
        const [scope, global] = await Promise.all([
          requestValue(tx.objectStore(META).get(scopeMetaKey(scopeKey))),
          requestValue(tx.objectStore(META).get(GLOBAL_META_KEY)),
        ]);
        await done;
        const scoped = scope || emptyScope(scopeKey);
        const globalStats = global || emptyGlobal();
        return { available: true, pendingCount: scoped.pendingCount, protectedBytes: scoped.protectedBytes,
          globalProtectedBytes: globalStats.protectedBytes, protectedLimitBytes,
          protectedFull: globalStats.protectedBytes >= protectedLimitBytes,
          confirmedCacheBytes: scoped.confirmedBytes, errorCode: scoped.lastErrorCode || null };
      } catch (error) {
        return { available: false, pendingCount: 0, protectedBytes: 0, globalProtectedBytes: 0,
          protectedLimitBytes, protectedFull: false, confirmedCacheBytes: 0,
          errorCode: error?.code || 'DOCUMENT_HISTORY_STORE_UNAVAILABLE' };
      }
    },

    subscribe(scopeKey, listener) {
      if (!scopeKey || typeof listener !== 'function' || closed) return () => {};
      const set = listeners.get(scopeKey) || new Set();
      set.add(listener);
      listeners.set(scopeKey, set);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        set.delete(listener);
        if (!set.size) listeners.delete(scopeKey);
      };
    },

    close() {
      closed = true;
      dbPromise?.then(db => db.close()).catch(() => {});
      dbPromise = null;
      listeners.clear();
      try { channel?.close(); } catch { /* already closed */ }
    },
  });
}

let defaultStore;
export const getDocumentHistoryStore = () => (defaultStore ||= createDocumentHistoryStore());
