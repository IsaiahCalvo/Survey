import * as Y from 'yjs';
import { getLegacyYDocScopeKey } from './legacyYDocScope.js';
import { createDetachedYDoc } from './ydocRegistry.js';

export const LEGACY_CLOSE_SNAPSHOT_ORIGIN = Object.freeze({ source: 'legacy-close-snapshot' });

function closeError(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

/**
 * Persist an exact caller-captured full v1 update in the existing scoped store.
 * The caller owns the writer lock and must validate the sender/request before
 * calling. This is local persistence, not server acceptance or actor attribution.
 *
 * Applying the update intentionally changes this Y.Doc even if storage fails.
 * Never roll back the CRDT on failure: keep close blocked and allow a retry.
 * No database opening, source deletion, compaction, or memory-only fallback.
 */
export async function appendLegacyYDocCloseSnapshot({
  ydoc, documentId, actorUserId, snapshot, db, signal,
  isCurrent = () => true, timeoutMs = 5000,
}) {
  const scopeKey = getLegacyYDocScopeKey(documentId, actorUserId);
  if (!ydoc || ydoc.guid !== scopeKey || db?.name !== scopeKey) {
    throw closeError('LEGACY_CLOSE_SCOPE_MISMATCH', 'The close snapshot does not match this document and account.');
  }
  if (typeof isCurrent !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw closeError('LEGACY_CLOSE_INVALID_OPTIONS', 'A bounded timeout and current-scope check are required.');
  }
  const assertCurrent = () => {
    if (signal?.aborted) throw closeError('LEGACY_CLOSE_ABORTED', 'The local close save was canceled.');
    if (ydoc.isDestroyed || ydoc.guid !== scopeKey || db.name !== scopeKey || !isCurrent()) {
      throw closeError('LEGACY_CLOSE_STALE', 'The document or close attempt changed during the local save.');
    }
  };
  assertCurrent();
  let update;
  try {
    if (!(snapshot instanceof Uint8Array) && !(snapshot instanceof ArrayBuffer)) throw new TypeError('v1 binary update required');
    update = snapshot instanceof ArrayBuffer ? new Uint8Array(snapshot.slice(0)) : new Uint8Array(snapshot);
    Y.decodeUpdate(update);
  } catch (error) {
    throw closeError('LEGACY_CLOSE_INVALID_UPDATE', 'The close snapshot is not a valid Yjs v1 update.', error);
  }
  // The live doc must include the bytes before they enter the log; otherwise
  // y-indexeddb's next full-state compaction could replace them with older state.
  Y.applyUpdate(ydoc, update, LEGACY_CLOSE_SNAPSHOT_ORIGIN);
  assertCurrent();

  await new Promise((resolve, reject) => {
    let tx;
    let request;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', canceled);
      ydoc.off('destroy', destroyed);
      tx?.removeEventListener('complete', completed);
      tx?.removeEventListener('abort', failed);
      tx?.removeEventListener('error', failed);
      request?.removeEventListener('success', requestSucceeded);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      // An expired/canceled attempt must not append later when its queued
      // transaction finally runs. A finished transaction cannot be rolled back.
      try { tx?.abort(); } catch { /* already completed or aborted */ }
      cleanup();
      reject(error);
    };
    const canceled = () => fail(closeError('LEGACY_CLOSE_ABORTED', 'The local close save was canceled.'));
    const destroyed = () => fail(closeError('LEGACY_CLOSE_STALE', 'The document closed during the local save.'));
    const failed = () => fail(closeError('LEGACY_CLOSE_STORAGE_FAILED', 'The local close save transaction failed.', tx?.error));
    const requestSucceeded = () => {
      try { assertCurrent(); } catch (error) { fail(error); }
      // Request success is not a disk receipt. Wait for transaction complete.
    };
    const completed = () => {
      if (settled) return;
      try { assertCurrent(); } catch (error) { fail(error); return; }
      settled = true;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => fail(closeError('LEGACY_CLOSE_TIMEOUT', 'The local close save timed out.')), timeoutMs);
    signal?.addEventListener('abort', canceled, { once: true });
    ydoc.on('destroy', destroyed);
    try {
      assertCurrent();
      tx = db.transaction('updates', 'readwrite');
      tx.addEventListener('complete', completed);
      tx.addEventListener('abort', failed);
      tx.addEventListener('error', failed);
      request = tx.objectStore('updates').add(update);
      request.addEventListener('success', requestSucceeded);
    } catch (error) {
      fail(error.code?.startsWith?.('LEGACY_CLOSE_') ? error
        : closeError('LEGACY_CLOSE_STORAGE_FAILED', 'The local close save could not start.', error));
    }
  });
  assertCurrent();
  return Object.freeze({ locallyDurable: true, documentId, actorUserId, scopeKey,
    update: new Uint8Array(update) });
}

/** Fresh existing-only proof. Reconstruct arbitrary roots and pending Yjs bytes
 * in a caller-independent scratch doc; applying the expected snapshot must add
 * nothing to the full encoded state. Never use a live doc as the recovery base.
 */
export async function verifyLegacyYDocCloseSnapshot({
  documentId, actorUserId, snapshot, indexedDB, signal,
  isCurrent = () => true, timeoutMs = 5000,
}) {
  const scopeKey = getLegacyYDocScopeKey(documentId, actorUserId);
  if (typeof isCurrent !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw closeError('LEGACY_CLOSE_INVALID_OPTIONS', 'A bounded timeout and current-scope check are required.');
  }
  const deadline = performance.now() + timeoutMs;
  const assertCurrent = () => {
    if (signal?.aborted) throw closeError('LEGACY_CLOSE_ABORTED', 'The local close verification was canceled.');
    let current;
    try { current = isCurrent(); } catch (error) {
      throw closeError('LEGACY_CLOSE_STALE', 'The close scope could not be checked.', error);
    }
    if (!current) throw closeError('LEGACY_CLOSE_STALE', 'The document or close attempt changed during verification.');
    if (performance.now() >= deadline) throw closeError('LEGACY_CLOSE_TIMEOUT', 'The local close verification timed out.');
  };
  assertCurrent();
  let expected;
  try {
    if (!(snapshot instanceof Uint8Array) && !(snapshot instanceof ArrayBuffer)) throw new TypeError('v1 binary update required');
    expected = snapshot instanceof ArrayBuffer ? new Uint8Array(snapshot.slice(0)) : new Uint8Array(snapshot);
    Y.decodeUpdate(expected);
  } catch (error) {
    throw closeError('LEGACY_CLOSE_INVALID_UPDATE', 'The close snapshot is not a valid Yjs v1 update.', error);
  }
  assertCurrent();
  return new Promise((resolve, reject) => {
    let db;
    let tx;
    let scratch;
    let settled = false;
    let missing = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', canceled);
      if (error) { try { tx?.abort(); } catch { /* read transaction already closed */ } }
      try { scratch?.destroy(); } catch { /* detached scratch only */ }
      try { db?.close(); } catch { /* already closed */ }
      if (error) reject(error);
      else resolve(Object.freeze({ locallyDurable: true, documentId, actorUserId, scopeKey,
        update: new Uint8Array(expected) }));
    };
    const canceled = () => finish(closeError('LEGACY_CLOSE_ABORTED', 'The local close verification was canceled.'));
    const storageFailed = error => finish(closeError('LEGACY_CLOSE_STORAGE_FAILED', 'Stored local close bytes could not be read.', error));
    const timer = setTimeout(() => finish(closeError('LEGACY_CLOSE_TIMEOUT', 'The local close verification timed out.')),
      Math.max(0, deadline - performance.now()));
    signal?.addEventListener('abort', canceled, { once: true });
    try {
      assertCurrent();
      // A restricted browser getter can throw; keep it inside this error boundary.
      const factory = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
      if (typeof factory?.open !== 'function') throw new Error('IndexedDB unavailable');
      const request = factory.open(scopeKey);
      request.onupgradeneeded = () => {
        // A missing database must stay absent, including a late upgrade after
        // cancellation or timeout. Abort creation and wait for its error event.
        missing = true;
        try { request.transaction.abort(); } catch (error) { storageFailed(error); }
      };
      request.onblocked = () => finish(closeError('LEGACY_CLOSE_STORAGE_BLOCKED', 'The saved local database is blocked.'));
      request.onerror = () => missing
        ? finish(closeError('LEGACY_CLOSE_INCOMPLETE', 'The saved local database is missing.'))
        : storageFailed(request.error);
      request.onsuccess = () => {
        if (settled) { try { request.result.close(); } catch { /* late result */ } return; }
        db = request.result;
        try {
          assertCurrent();
          if (db.name !== scopeKey) throw closeError('LEGACY_CLOSE_SCOPE_MISMATCH', 'The opened database does not match this account scope.');
          db.onversionchange = () => finish(closeError('LEGACY_CLOSE_STALE', 'The saved local database changed during verification.'));
          tx = db.transaction('updates', 'readonly');
          let rows;
          const read = tx.objectStore('updates').getAll();
          read.onsuccess = () => { rows = read.result; };
          read.onerror = () => storageFailed(read.error);
          tx.onabort = tx.onerror = () => storageFailed(tx.error);
          tx.oncomplete = () => {
            if (settled) return;
            try {
              assertCurrent();
              scratch = createDetachedYDoc(`legacy-close-verify:${scopeKey}`);
              for (const row of rows) {
                assertCurrent();
                try {
                  if (!(row instanceof Uint8Array) && !(row instanceof ArrayBuffer)) throw new TypeError('Stored v1 binary update required');
                  const bytes = row instanceof ArrayBuffer ? new Uint8Array(row) : row;
                  Y.decodeUpdate(bytes);
                  Y.applyUpdate(scratch, bytes);
                } catch (error) {
                  throw closeError('LEGACY_CLOSE_INVALID_UPDATE', 'Stored local close bytes contain an invalid update.', error);
                }
              }
              // Timers cannot interrupt synchronous Yjs processing. Recheck the
              // monotonic clock around encoding/apply; do not claim a hard CPU cap.
              assertCurrent();
              const before = Y.encodeStateAsUpdate(scratch);
              assertCurrent();
              Y.applyUpdate(scratch, expected);
              const after = Y.encodeStateAsUpdate(scratch);
              assertCurrent();
              if (before.length !== after.length || !before.every((byte, index) => byte === after[index])) {
                throw closeError('LEGACY_CLOSE_INCOMPLETE', 'Stored local bytes do not cover the close snapshot.');
              }
              finish();
            } catch (error) { finish(error); }
          };
        } catch (error) {
          if (error.code?.startsWith?.('LEGACY_CLOSE_')) finish(error); else storageFailed(error);
        }
      };
    } catch (error) {
      if (error.code?.startsWith?.('LEGACY_CLOSE_')) finish(error); else storageFailed(error);
    }
  });
}
