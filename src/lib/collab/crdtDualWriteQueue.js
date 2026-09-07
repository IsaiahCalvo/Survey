// src/lib/collab/crdtDualWriteQueue.js
//
// Phase 30 - Migration Phase A - Dual-Write Era - Retry Queue
//
// CONTEXT.md `<decisions>` "Half-failed save (one of the two writes lands, the other doesn't)":
//
//   - Default: silent retry queue. Every new annotation lands locally first (IndexedDB
//     via Y.Doc). The two outbound writes (legacy document_annotations insert + CRDT
//     update sync) each have their own retry path. If one fails, the other still
//     succeeds; the failed side queues and retries silently in the background.
//
//   - 30-second silence threshold. The queue retries silently for roughly 30 seconds.
//     If still stuck, a banner surfaces.
//
//   - Editing stays fully unblocked. New edits ride the same queue.
//
//   - Queue survives app close. Pending entries persist to localStorage and replay
//     automatically when the app re-opens.
//
//   - Re-edit while queued: latest version wins. Queue holds only the most recent
//     version of each annotation (no stale-write replay, no out-of-order writes).
//
//   - Quarantine after ~10 retries. Specific annotation cannot sync after roughly 10
//     attempts -> small inline marker "didn't save, please try redrawing" on the
//     annotation, retries stop for THAT annotation, rest of queue keeps moving.
//
// Pitfall 30-5 (queue starvation by quarantined entry): drain loop SKIPS quarantined
// entries. Non-quarantined entries continue draining successfully past the bad item.
//
// Pitfall 30-6 (stale queue replay after kill switch flip): drainQueue's first line
// is `if (!isCRDTEnabled()) return;` - silent skip. Queue stays in localStorage, ready
// to resume if the kill-switch flips back. Banner gates on the same flag.
//
// NO_DIFF_DELETE_OK: this module never removes from any store to "match" another. The
// only `delete queue[annoId]` calls in this file run AFTER a successful retry (the
// missing-side write succeeded; that entry no longer needs retrying). Scanned by the
// architectural invariant gate. // NO_DIFF_DELETE_OK: docstring reference to the gate.

import { isCRDTEnabled } from './crdtFeatureFlag.js';

// Storage key shape: per-user (queue is local; one user's stuck queue is invisible to
// other collaborators on the same document - CONTEXT.md "the queue is local to the
// user's session"). Key includes userId so multi-account-on-same-device is clean.
const STORAGE_KEY_PREFIX = 'crdt_dual_write_queue:';
export const STORAGE_FAILURE_EVENT = 'survey:dual-write-storage-error';
const activeDrains = new Set();

// Quarantine after this many failed attempts. CONTEXT.md "~10 retries"; Plan 30-01
// test 4 hand-crafts attempts=9 and expects quarantine on the next attempt.
export const QUARANTINE_THRESHOLD = 10;

// Banner trigger threshold. CONTEXT.md "30-second silence threshold"; Plan 30-01
// test 6 hand-crafts queuedAt = Date.now() - 31_000.
export const STUCK_THRESHOLD_MS = 30_000;

// Exponential backoff in ms - index by attempt count, capped at the last entry.
// Plan 30-01 test 3 hand-crafts attempts=1 + lastAttemptAt = Date.now() - 2_000
// and expects retry to be eligible.
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

function storageKey(userId) {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function getStorage() {
  // SSR / Node-test fallback. Tests inject globalThis.localStorage manually.
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function storageFailure(cause, userId) {
  const error = new Error('The sync retry queue could not be saved on this device.', { cause });
  error.code = 'DUAL_WRITE_STORAGE_FAILED';
  try {
    globalThis.window?.dispatchEvent(new CustomEvent(STORAGE_FAILURE_EVENT, {
      detail: { userId, error, code: cause?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'invalid_state' },
    }));
  } catch { /* no DOM in tests / SSR */ }
  return error;
}

function readQueueStrict(userId) {
  const storage = getStorage();
  if (!storage) throw new Error('Local storage is unavailable');
  const raw = storage.getItem(storageKey(userId));
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Sync retry queue is malformed');
  }
  return parsed;
}

export function queuedDocumentId(payload) {
  return payload?.documentId ?? payload?.opts?.documentId ?? null;
}

/**
 * Read the queue for a given user.
 * Returns an empty object on missing key, malformed JSON, or missing localStorage.
 */
export function readQueue(userId) {
  if (!userId) return {};
  try {
    return readQueueStrict(userId);
  } catch (_err) {
    // UI reads stay safe. Mutating paths use readQueueStrict and never overwrite
    // malformed data; their failure event exposes the problem to the user.
    return {};
  }
}

function writeQueue(userId, queue) {
  if (!userId) return;
  const storage = getStorage();
  if (!storage) throw new Error('Local storage is unavailable');
  storage.setItem(storageKey(userId), JSON.stringify(queue));
}

/**
 * Add an entry to the queue. Latest-version-wins: if an entry for the same annoId
 * already exists, REPLACE it (do NOT append). Preserves queuedAt and attempts from
 * the existing entry so the stuck threshold and quarantine counter survive re-edits.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.annoId - stable per-annotation UUID (== fabricObject.data.id)
 * @param {'legacy'|'crdt'} args.side - which side of the dual-write failed
 * @param {object} args.payload - serialized fabricObj + opts (everything to retry the call)
 */
export function enqueue({ userId, annoId, side, payload }) {
  if (!userId || !annoId || !side) return;
  try {
    const queue = readQueueStrict(userId);
    const existing = queue[annoId];
    // Only data belongs on disk. Live Y.Doc / Y.Map handles are cyclic and must
    // be supplied by the mounted document when retrying, not serialized here.
    const { ydoc: _ydoc, yMapAnnotations: _map, ...savedOpts } = payload?.opts ?? {};
    const retryPayload = payload?.opts ? { ...payload, opts: savedOpts } : payload;
    queue[annoId] = {
      annoId,
      side,
      payload: retryPayload,
      revision: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`,
      attempts: existing?.attempts ?? 0,
      queuedAt: existing?.queuedAt ?? Date.now(),
      lastAttemptAt: existing?.lastAttemptAt ?? null,
      quarantined: existing?.quarantined ?? false,
    };
    writeQueue(userId, queue);
  } catch (cause) {
    throw storageFailure(cause, userId);
  }
}

/**
 * One drain pass over the queue. Caller is responsible for scheduling (Plan 30-06's
 * YDocProvider mounts a setInterval; per-tab; on app boot replays automatically).
 *
 * Pitfall 30-6: first line is the kill-switch guard. Queue stays in localStorage,
 * ready to resume if the flag flips back ON.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {function} [args.retryLegacyWrite] - async (payload) => result; throws on failure
 * @param {function} [args.retryCrdtWrite] - async (payload) => result; throws on failure
 * @param {function} [args.onStuck] - called with { stuckCount } when any entry > STUCK_THRESHOLD_MS
 * @param {function} [args.onQuarantine] - called with { annoId } when an entry crosses QUARANTINE_THRESHOLD
 * @returns {Promise<{drained: number, quarantined: number, stuckCount: number, skippedKillSwitch: boolean}>}
 */
export async function drainQueue(args) {
  const { userId } = args;
  // Pitfall 30-6 fix: short-circuit when kill switch is OFF. Queue persists in
  // localStorage; resumes when flag flips back.
  if (!isCRDTEnabled()) {
    return { drained: 0, quarantined: 0, stuckCount: 0, skippedKillSwitch: true };
  }
  if (!userId) {
    return { drained: 0, quarantined: 0, stuckCount: 0, skippedKillSwitch: false };
  }

  // Every mounted PDF used to retry the same per-user queue once a second.
  // One pass per user at a time avoids duplicate writes during slow requests.
  if (activeDrains.has(userId)) {
    return { drained: 0, quarantined: 0, stuckCount: 0, skippedKillSwitch: false, skippedBusy: true };
  }
  activeDrains.add(userId);
  try {
    const locks = globalThis.navigator?.locks;
    if (locks?.request) {
      // Coordinate drainers in other browser tabs too. Skip rather than build
      // an unbounded wait queue from the one-second interval.
      return await locks.request(`crdt-dual-write:${userId}`, { ifAvailable: true }, (lock) => (
        lock ? drainQueuePass(args) : { drained: 0, quarantined: 0, stuckCount: 0, skippedKillSwitch: false, skippedBusy: true }
      ));
    }
    return await drainQueuePass(args);
  } catch (cause) {
    throw storageFailure(cause, userId);
  } finally {
    activeDrains.delete(userId);
  }
}

async function drainQueuePass({ userId, documentId, retryLegacyWrite, retryCrdtWrite, onStuck, onQuarantine, shouldContinue }) {
  if (!isCRDTEnabled()) return { drained: 0, quarantined: 0, stuckCount: 0, skippedKillSwitch: true };

  const queue = readQueueStrict(userId);
  const now = Date.now();
  let drained = 0;
  let newlyQuarantined = 0;
  let stuckCount = 0;

  for (const annoId of Object.keys(queue)) {
    if (shouldContinue && !shouldContinue()) break;
    // An earlier request may have taken seconds. Use the current version before
    // sending this item too, not only when acknowledging it afterwards.
    const entry = readQueueStrict(userId)[annoId];
    if (!entry || typeof entry !== 'object') continue;
    // Missing document identity is not safe to infer from whichever PDF is
    // open. Preserve old unscoped entries for recovery instead of replaying.
    if (documentId && queuedDocumentId(entry.payload) !== documentId) continue;
    const fingerprint = JSON.stringify(entry);

    // Stuck threshold: count any non-quarantined entry pending > 30s.
    if (!entry.quarantined && (now - entry.queuedAt) > STUCK_THRESHOLD_MS) {
      stuckCount++;
    }

    // Pitfall 30-5: skip quarantined entries - rest of queue keeps moving.
    if (entry.quarantined) continue;

    // Backoff gate: pick the next attempt window from BACKOFF_MS by attempts index;
    // capped at the last entry of the array. If we're inside the window, skip.
    const idx = Math.min(entry.attempts, BACKOFF_MS.length - 1);
    const backoff = BACKOFF_MS[idx];
    if (entry.lastAttemptAt && (now - entry.lastAttemptAt) < backoff) continue;

    // Try the missing-side write. The retry handlers are injected by the caller
    // (Plan 30-06 YDocProvider) - keeps this module pure (no Supabase / Yjs imports
    // at module top level beyond crdtFeatureFlag, which is itself pure).
    const retry = entry.side === 'legacy' ? retryLegacyWrite : entry.side === 'crdt' ? retryCrdtWrite : null;
    if (!retry) continue;
    let failure = null;
    try { await retry(entry.payload); } catch (error) { failure = error; }

    // Re-read after every awaited request. Only settle the exact version sent;
    // a newer edit or a different queued annotation must never be overwritten.
    const latest = readQueueStrict(userId);
    if (JSON.stringify(latest[annoId]) !== fingerprint) continue;
    if (!failure) {
      delete latest[annoId];
      writeQueue(userId, latest);
      drained++;
    } else {
      entry.attempts++;
      entry.lastAttemptAt = now;
      latest[annoId] = entry;
      if (entry.attempts >= QUARANTINE_THRESHOLD) {
        entry.quarantined = true;
        newlyQuarantined++;
      }
      writeQueue(userId, latest);
      if (entry.quarantined) {
        if (typeof onQuarantine === 'function') {
          try { onQuarantine({ annoId }); } catch (_e) { /* swallow listener errors */ }
        }
      }
    }
  }

  if (stuckCount > 0 && typeof onStuck === 'function') {
    try { onStuck({ stuckCount }); } catch (_e) { /* swallow */ }
  }

  return { drained, quarantined: newlyQuarantined, stuckCount, skippedKillSwitch: false };
}

/**
 * Read-only helper for the UI. Returns an array of annoIds that are currently
 * quarantined for the given user. Plan 30-05's <QuarantineMarkerOverlay> reads
 * this on every render to position markers next to the affected annotations.
 */
export function getQuarantinedAnnoIds(userId) {
  const queue = readQueue(userId);
  const ids = [];
  for (const annoId of Object.keys(queue)) {
    if (queue[annoId]?.quarantined) ids.push(annoId);
  }
  return ids;
}

/**
 * Read-only helper for the UI. Returns the count of non-quarantined entries that
 * have been pending > STUCK_THRESHOLD_MS. Plan 30-05's banner gate reads this on
 * a polling tick: stuckCount > 0 -> mount the sync_queue_stuck banner.
 */
export function getStuckCount(userId) {
  const queue = readQueue(userId);
  const now = Date.now();
  let count = 0;
  for (const annoId of Object.keys(queue)) {
    const entry = queue[annoId];
    if (!entry.quarantined && (now - entry.queuedAt) > STUCK_THRESHOLD_MS) count++;
  }
  return count;
}

/**
 * Read-only helper. Returns true if the queue has any non-quarantined entries for
 * the given user. Plan 30-05's TabBar dot reads this - the dot appears as soon as
 * ANY entry is pending (NOT only after the 30s stuck threshold). CONTEXT.md
 * "Document tile signal" says the indicator should appear when the queue has
 * stuck entries; we surface it eagerly so the user has the earliest possible signal.
 */
export function hasPendingForUser(userId) {
  const queue = readQueue(userId);
  for (const annoId of Object.keys(queue)) {
    if (!queue[annoId]?.quarantined) return true;
  }
  return false;
}

/**
 * Dev/test helper exposed on window: clear ALL persisted dual-write queues across
 * every user and clear the test-seam failure flags. Lets a tester paste a single
 * line in DevTools to escape "stuck banner won't go away" mode after running the
 * __crdtForceLegacyFail test seam. Not intended as a user-facing feature.
 *
 * UX: noisy console message so a user who pastes this knows what was cleared.
 */
function clearAllDualWriteQueuesAndFlags() {
  if (typeof window === 'undefined' || !window.localStorage) return { cleared: 0, flagsReset: 0 };
  let cleared = 0;
  const toRemove = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(STORAGE_KEY_PREFIX)) toRemove.push(key);
  }
  for (const key of toRemove) {
    window.localStorage.removeItem(key);
    cleared++;
  }
  let flagsReset = 0;
  if (window.__crdtForceLegacyFail) { delete window.__crdtForceLegacyFail; flagsReset++; }
  if (window.__crdtForceFailAnnoId) { delete window.__crdtForceFailAnnoId; flagsReset++; }
  console.warn(`[CRDT] Cleared ${cleared} dual-write queue(s); reset ${flagsReset} test-seam flag(s). Refresh the page to reset banner state.`);
  return { cleared, flagsReset };
}

if (typeof window !== 'undefined') {
  // Exposed for manual paste in DevTools — see clearAllDualWriteQueuesAndFlags above.
  window.__clearDualWriteQueue = clearAllDualWriteQueuesAndFlags;
}
