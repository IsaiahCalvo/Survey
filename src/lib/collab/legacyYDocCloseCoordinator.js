import * as Y from 'yjs';
import { getLegacyYDocScopeKey } from './legacyYDocScope.js';
import { appendLegacyYDocCloseSnapshot, verifyLegacyYDocCloseSnapshot } from './legacyYDocCloseProof.js';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_PENDING = 8;
const MAX_REMOTE = 32;
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function sameBytes(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
async function digest(bytes) {
  if (!globalThis.crypto?.subtle) throw failure('LOCAL_CLOSE_UNAVAILABLE', 'Secure local save checks are unavailable');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Close proof only. Keep all lifecycles attached until every required receipt
 * is current. Timeouts reject the close; they never release a writer's lock.
 */
export function createLegacyYDocCloseCoordinator({
  ydoc, documentId, actorUserId, senderId, send, sendCancellation = fields => send('close-cancel', fields), getRole, getDatabase,
  isCurrent, appendSnapshot = appendLegacyYDocCloseSnapshot, verifySnapshot = verifyLegacyYDocCloseSnapshot,
}) {
  const scopeKey = getLegacyYDocScopeKey(documentId, actorUserId);
  const pending = new Map();
  const remote = new Map();
  const receipts = new WeakMap();
  const terminalRemote = new Set();
  let disposed = false;
  let sequence = 0;
  let storageGeneration = 0;
  let watchedDatabase = null;
  const current = () => {
    try { return !disposed && !ydoc.isDestroyed && !!isCurrent(); } catch { return false; }
  };
  const cancelled = () => failure('LOCAL_CLOSE_CANCELLED', 'Local save check was cancelled');
  const sendSafe = (type, fields) => {
    try { if (current()) { send(type, fields); return true; } } catch { /* caller retains its snapshot */ }
    return false;
  };

  function isLocalCloseReceiptCurrent(receipt) {
    const saved = receipt && receipts.get(receipt);
    return !!saved && current() && ydoc.guid === scopeKey && saved.generation === storageGeneration && sameBytes(saved.snapshot, Y.encodeStateAsUpdate(ydoc));
  }
  // The synchronous guard only checks live state. A final close decision also
  // needs this fresh read: a suspended tab can miss a storage-change broadcast.
  async function validateLocalCloseReceipt(receipt, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive safe integer');
    if (signal?.aborted) throw cancelled();
    if (!isLocalCloseReceiptCurrent(receipt)) throw failure('LOCAL_CLOSE_STALE', 'The local save receipt is no longer current');
    const saved = receipts.get(receipt);
    await verifySnapshot({ documentId, actorUserId, snapshot: new Uint8Array(saved.snapshot),
      // Verification checks this once per stored update. Do not encode the
      // whole live doc on every row; exact-byte checks bracket the awaited read.
      timeoutMs, signal, isCurrent: () => current() && ydoc.guid === scopeKey
        && saved.generation === storageGeneration,
    });
    if (signal?.aborted) throw cancelled();
    if (!isLocalCloseReceiptCurrent(receipt)) throw failure('LOCAL_CLOSE_STALE', 'The document changed during its final local save check');
    return true;
  }
  function finish(request, error) {
    if (!pending.has(request.id)) return;
    pending.delete(request.id);
    clearTimeout(request.timer);
    request.signal?.removeEventListener('abort', request.onAbort);
    if (error) {
      request.controller.abort();
      // Cancellation contains no document bytes and is allowed during teardown,
      // after data-bearing sends have already been sealed by the lifecycle.
      try { sendCancellation({ requestId: request.id }); } catch { /* remote deadline still bounds queued work */ }
      request.reject(error);
      return;
    }
    if (!current() || request.signal?.aborted) { request.reject(cancelled()); return; }
    if (!sameBytes(request.snapshot, Y.encodeStateAsUpdate(ydoc))) {
      request.reject(failure('LOCAL_CLOSE_STALE', 'The document changed during its local save check'));
      return;
    }
    const receipt = Object.freeze({ documentId, actorUserId, scopeKey, savedAt: Date.now() });
    receipts.set(receipt, { snapshot: request.snapshot, generation: storageGeneration });
    request.resolve(receipt);
  }
  function runLocal(request) {
    if (request.started || !pending.has(request.id) || getRole() !== 'leader' || !getDatabase()) return;
    request.started = true;
    appendSnapshot({ ydoc, documentId, actorUserId, snapshot: request.snapshot,
      db: getDatabase(), signal: request.controller.signal,
      isCurrent: () => current() && pending.has(request.id), timeoutMs: request.timeoutMs,
    }).then(() => finish(request), error => finish(request, error));
  }
  function prepareLocalClose({ timeoutMs = DEFAULT_TIMEOUT_MS, signal, readOnly = false } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new TypeError('timeoutMs must be a positive safe integer'));
    }
    if (!current() || signal?.aborted) return Promise.reject(cancelled());
    if (ydoc.guid !== scopeKey) return Promise.reject(failure('LOCAL_CLOSE_SCOPE_MISMATCH', 'The local document does not match this account scope'));
    if (pending.size >= MAX_PENDING) return Promise.reject(failure('LOCAL_CLOSE_BUSY', 'Too many local save checks'));
    const id = `${senderId}:${++sequence}`;
    const snapshot = new Uint8Array(Y.encodeStateAsUpdate(ydoc));
    return new Promise((resolve, reject) => {
      const request = { id, snapshot, signal, timeoutMs, resolve, reject, controller: new AbortController() };
      request.onAbort = () => finish(request, cancelled());
      request.timer = setTimeout(() => finish(request,
        failure('LOCAL_CLOSE_TIMEOUT', 'Local storage did not confirm this save in time')), timeoutMs);
      pending.set(id, request);
      signal?.addEventListener('abort', request.onAbort, { once: true });
      if (signal?.aborted) { request.onAbort(); return; }
      if (readOnly) {
        // A locked document may prove existing storage, but must not append a
        // snapshot or ask another tab to write on its behalf.
        request.started = true;
        Promise.resolve().then(() => verifySnapshot({ documentId, actorUserId, snapshot: new Uint8Array(snapshot),
          timeoutMs, signal: request.controller.signal,
          isCurrent: () => current() && pending.has(id) && ydoc.guid === scopeKey,
        })).then(() => finish(request), error => finish(request, error));
        return;
      }
      digest(snapshot).then(hash => {
        if (!pending.has(id) || !current()) return;
        request.hash = hash;
        if (getRole() === 'leader') runLocal(request);
        else if (!sendSafe('close-request', { requestId: id, snapshot, snapshotHash: hash, timeoutMs })) {
          finish(request, failure('LOCAL_CLOSE_TRANSPORT_FAILED', 'The local save request could not be sent'));
        }
      }, error => finish(request, error));
    });
  }
  function endRemote(job) {
    if (remote.get(job.key) !== job) return;
    remote.delete(job.key);
    terminalRemote.add(job.key);
    if (terminalRemote.size > 512) terminalRemote.delete(terminalRemote.values().next().value);
    clearTimeout(job.timer);
    job.controller.abort();
  }
  async function runRemote(job) {
    if (job.started || remote.get(job.key) !== job || getRole() !== 'leader' || !getDatabase()) return;
    job.started = true;
    try {
      const hash = await digest(job.snapshot);
      if (!current() || remote.get(job.key) !== job) return;
      if (hash !== job.hash) throw failure('LOCAL_CLOSE_INVALID', 'Local save snapshot did not match its request');
      await appendSnapshot({ ydoc, documentId, actorUserId, snapshot: job.snapshot,
        db: getDatabase(), signal: job.controller.signal,
        isCurrent: () => current() && remote.get(job.key) === job, timeoutMs: job.timeoutMs,
      });
      if (current() && remote.get(job.key) === job) {
        sendSafe('close-ack', { recipientId: job.senderId, requestId: job.id, snapshotHash: hash });
      }
    } catch (error) {
      if (current() && remote.get(job.key) === job) {
        sendSafe('close-error', { recipientId: job.senderId, requestId: job.id,
          snapshotHash: job.hash, errorCode: error?.code || 'LOCAL_CLOSE_STORAGE_FAILED' });
      }
    } finally { endRemote(job); }
  }
  function receive(message) {
    if (!message?.type?.startsWith('close-')) return false;
    if (!current() || message.protocol !== 'legacy-yjs' || message.version !== 1
      || !Number.isSafeInteger(message.sequence) || message.sequence <= 0
      || message.documentId !== documentId || message.actorUserId !== actorUserId
      || typeof message.senderId !== 'string' || !message.senderId || message.senderId === senderId
      || (message.recipientId !== undefined && message.recipientId !== senderId)
      || (message.type !== 'close-storage-changed' && (typeof message.requestId !== 'string' || !message.requestId))) return true;
    if (message.type === 'close-storage-changed') { invalidateStorage(false); return true; }
    if (message.type === 'close-ack' || message.type === 'close-error') {
      const request = pending.get(message.requestId);
      if (!request || message.recipientId !== senderId || !request.hash || message.snapshotHash !== request.hash) return true;
      finish(request, message.type === 'close-error'
        ? failure('LOCAL_CLOSE_STORAGE_FAILED', 'The local writer could not confirm this save') : null);
      return true;
    }
    const key = JSON.stringify([message.senderId, message.requestId]);
    if (message.type === 'close-cancel') { const job = remote.get(key); if (job) endRemote(job); return true; }
    if (message.type !== 'close-request' || getRole() !== 'leader' || remote.has(key) || terminalRemote.has(key) || remote.size >= MAX_REMOTE) return true;
    if (!(message.snapshot instanceof Uint8Array) || !/^[a-f0-9]{64}$/.test(message.snapshotHash)
      || !Number.isSafeInteger(message.timeoutMs) || message.timeoutMs <= 0) return true;
    const job = { key, id: message.requestId, senderId: message.senderId,
      snapshot: new Uint8Array(message.snapshot), hash: message.snapshotHash,
      timeoutMs: Math.min(message.timeoutMs, DEFAULT_TIMEOUT_MS), controller: new AbortController(),
    };
    job.timer = setTimeout(() => endRemote(job), job.timeoutMs);
    remote.set(key, job);
    void runRemote(job);
    return true;
  }
  function invalidateStorage(broadcast = true) {
    storageGeneration++;
    for (const request of pending.values()) finish(request, failure('LOCAL_CLOSE_STORAGE_CHANGED', 'Local storage changed during the save check'));
    for (const job of remote.values()) endRemote(job);
    if (broadcast) sendSafe('close-storage-changed', {});
  }
  const onStorageChanged = () => invalidateStorage();
  function watchDatabase() {
    const db = getDatabase();
    if (!db || db === watchedDatabase) return;
    watchedDatabase?.removeEventListener('versionchange', onStorageChanged);
    watchedDatabase?.removeEventListener('close', onStorageChanged);
    watchedDatabase = db;
    db.addEventListener('versionchange', onStorageChanged);
    db.addEventListener('close', onStorageChanged);
  }
  return Object.freeze({
    prepareLocalClose, isLocalCloseReceiptCurrent, validateLocalCloseReceipt, receive,
    onReady() {
      watchDatabase();
      for (const request of pending.values()) if (request.hash) runLocal(request);
      for (const job of remote.values()) void runRemote(job);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const request of pending.values()) finish(request, cancelled());
      for (const job of remote.values()) endRemote(job);
      watchedDatabase?.removeEventListener('versionchange', onStorageChanged);
      watchedDatabase?.removeEventListener('close', onStorageChanged);
      terminalRemote.clear();
    },
  });
}
