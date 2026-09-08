// src/lib/collab/ydocLifecycle.js
// Phase 27 - Web Locks election + IndexeddbPersistence + BroadcastChannel handoff.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md Pattern 2 + Code Examples
// Defends Pitfall 2 (yjs/y-indexeddb#25 multi-tab corruption).
//
// IMPORTANT: This file MUST NOT construct a Y.Doc directly. The ydoc is passed in
// from ydocRegistry.getOrCreateYDoc(). The applyUpdateOnlyInvariant.test.mjs
// grep-asserts this — the only allowed Y.Doc constructor site is ydocRegistry.js.
// Any cross-tab updates are merged via Y.applyUpdate, never by replacing the doc.
//
// Phase 28 extension: the onStorageState channel codes expand beyond the Phase 27
// set. The Phase 27 codes (`'ok' | 'quota_exceeded' | 'invalid_state' |
// 'version_mismatch' | 'blocked'`) come from this file via attachStorageFailureDetector.
// Phase 28 adds four new codes that plumb through the SAME onStorageState callback
// signature so YDocProvider's banner gating logic continues to work unchanged:
//
//   - 'transport_offline'    — emitted by SupabaseYjsProvider's onTransportState
//                              callback (wired in YDocProvider.jsx)
//   - 'transport_online'     — provider reconnected; YDocProvider clears the
//                              transport-side banner by re-emitting code 'ok'
//   - 'permission_revoked'   — emitted by provider's onUpdateRejected callback
//                              when reason === 'permission_revoked' or starts
//                              with 'authentication_failed'
//   - 'login_expiry_failure' — emitted by authSessionBridge's onSignedOut hook
//                              (mounted inside YDocProvider per Plan 28-06
//                              Blocker 1 fix — keeps App.jsx untouched)
//
// No code change is required in this file for Phase 28: the existing
// onStorageState callback already accepts an arbitrary `code` string. This
// header documents the channel-extension contract so future readers see the
// full set of codes flowing through one callback rather than parallel surfaces.

import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { attachStorageFailureDetector } from './storageFailureDetector.js';
import { getLegacyYDocScopeKey } from './legacyYDocScope.js';
import { createLegacyYDocCloseCoordinator } from './legacyYDocCloseCoordinator.js';

// Origin tag for BroadcastChannel-applied updates.
// Locked by 27-RESEARCH.md Pattern 2: Phase 29 observers can short-circuit echo loops
// by checking `origin === REMOTE_BC_ORIGIN`. Object.freeze prevents accidental mutation.
const REMOTE_BC_ORIGIN = Object.freeze({ source: 'remote-bc' });

/**
 * Wire Web Locks election + IndexeddbPersistence + BroadcastChannel for a Y.Doc.
 * MUST be called once per YDocProvider mount.
 *
 * @param {Y.Doc} ydoc - Y.Doc from ydocRegistry.getOrCreateYDoc(documentId)
 * @param {string} documentId
 * @param {object} options
 * @param {(state: {code: string, role: 'leader'|'loser'|'follower'|'unknown', error?: Error}) => void} options.onStorageState
 * @param {string} [options.actorUserId] - Opt in to actor-isolated storage and local state exchange.
 * @param {(role: 'follower'|'leader') => void} [options.onRoleChange] - Scoped election changes, without polling.
 * @returns {{ detach: () => (Promise<void>|void), role: () => 'leader'|'loser'|'follower'|'unknown' }}
 */
export function attachLifecycle(ydoc, documentId, options) {
  if (!ydoc) throw new Error('[ydocLifecycle] ydoc is required');
  if (!documentId) throw new Error('[ydocLifecycle] documentId is required');
  // Explicit opt-in only. Never expose unscoped history through a new handshake
  // while the old store's actor is unknown. Recovery/rollout belongs to callers.
  if (Object.hasOwn(options || {}, 'actorUserId')) {
    return attachScopedLifecycle(ydoc, documentId, options);
  }
  const onStorageState = options?.onStorageState ?? (() => {});

  // SSR / non-browser env: bail out with a no-op handle.
  // UX: Node tests, SSR, and any non-browser context get a safe no-op without
  // crashing — Plan 27-05's <YDocProvider> mount can call attachLifecycle
  // unconditionally and the lifecycle layer self-disables when APIs are absent.
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.locks ||
    typeof BroadcastChannel === 'undefined'
  ) {
    return {
      detach: () => {},
      role: () => 'unknown',
    };
  }

  // Lock and channel naming: `y-doc-${documentId}` and `y-doc-bc-${documentId}`.
  // Per-doc names mean multiple PDFs open simultaneously each get their own
  // leader election + their own BroadcastChannel without cross-talk.
  const lockName = `y-doc-${documentId}`;
  const channelName = `y-doc-bc-${documentId}`;
  const bc = new BroadcastChannel(channelName);
  let persistence = null;
  let role = 'unknown';
  let storageDetectorHandle = null;
  let detached = false;
  const electionAbort = new AbortController();
  let releaseLock;
  const lockLifetime = new Promise((resolve) => { releaseLock = resolve; });

  // ----------------------------------------------------------------------
  // Loser-tab path: receive updates from leader via BroadcastChannel.
  // Apply via Y.applyUpdate (NEVER new Y.Doc - applyUpdate-only invariant).
  // UX: the loser tab is a fully-live read/write tab to the user — both tabs
  // edit the same doc, only the IDB write path is single-leader. This is the
  // "both tabs work like Google Docs" CONTEXT.md decision.
  // ----------------------------------------------------------------------
  bc.onmessage = (ev) => {
    if (detached) return;
    if (ev.data?.type === 'update' && ev.data.update) {
      Y.applyUpdate(ydoc, new Uint8Array(ev.data.update), REMOTE_BC_ORIGIN);
    }
  };

  // ----------------------------------------------------------------------
  // Local update fan-out: any update NOT from remote-bc origin gets broadcast.
  // Echo-loop guard: short-circuit when origin === REMOTE_BC_ORIGIN.
  // Without this guard, every received-then-applied update would re-broadcast
  // and bounce indefinitely between tabs.
  // ----------------------------------------------------------------------
  const onLocalUpdate = (update, origin) => {
    if (detached) return;
    if (origin === REMOTE_BC_ORIGIN) return; // received from BC, do not re-broadcast
    bc.postMessage({ type: 'update', update });
  };
  ydoc.on('update', onLocalUpdate);

  // ----------------------------------------------------------------------
  // Web Locks election. Hold the lock only while this mount owns persistence.
  // Resolving lockLifetime on detach allows the next mount to save offline.
  // The browser
  // auto-releases on tab process exit; another tab's queued request then
  // promotes itself by re-running navigator.locks.request inside its own attach.
  // UX: opening a second tab is silent leader handoff — second tab queues until
  // first closes, then becomes leader transparently. No user-visible flicker.
  // ----------------------------------------------------------------------
  const election = navigator.locks.request(lockName, { mode: 'exclusive', signal: electionAbort.signal }, async () => {
    if (detached) return;
    role = 'leader';

    try {
      persistence = new IndexeddbPersistence(documentId, ydoc);
      persistence.on('synced', () => {
        if (!detached) onStorageState({ code: 'ok', role: 'leader' });
      });

      // Compose with the shared storage failure detector for IDB error surfacing.
      // UX: when IDB is broken (quota, private browsing, version mismatch), the
      // banner copy in 27-UI-SPEC reads from these state events. CONTEXT.md
      // forbids silent fallback — every detector tick fires onStorageState.
      storageDetectorHandle = attachStorageFailureDetector({
        onState: (state) => {
          if (!detached) onStorageState({ ...state, role: 'leader' });
        },
      });

      await lockLifetime;
    } finally {
      // Close the old writer before another mount acquires this lock.
      try { await persistence?.destroy(); } catch { /* already torn down */ }
      try { storageDetectorHandle?.detach(); } catch { /* swallow */ }
    }
  }).catch((error) => {
    if (!detached) onStorageState({ code: 'invalid_state', role, error });
  });

  return {
    detach() {
      if (detached) return election;
      detached = true;
      try { ydoc.off('update', onLocalUpdate); } catch { /* swallow */ }
      try { bc.close(); } catch { /* swallow */ }
      try { storageDetectorHandle?.detach(); } catch { /* swallow */ }
      // Abort a queued election or release an acquired lock. The callback owns
      // persistence destruction so a replacement writer cannot overlap it.
      electionAbort.abort();
      releaseLock();
      return election;
    },
    role: () => role,
  };
}

const SCOPED_PROTOCOL = 'legacy-yjs';
const SCOPED_PROTOCOL_VERSION = 1;
const SYNC_RETRY_DELAYS_MS = [0, 250, 1000];
const MAX_RECENT_MESSAGES = 512;
const MAX_WAITING_PEERS = 128;

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function updateBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function hasUpdate(bytes) {
  // The canonical empty Yjs v1 update. Deletion-only updates must still travel.
  return !(bytes.length === 2 && bytes[0] === 0 && bytes[1] === 0);
}

/**
 * Actor-scoped, single-writer persistence with a local state-vector handshake.
 * No network authority is implied by BroadcastChannel: isolation is by exact
 * actor/document namespace and caller lifecycle, not by message secrecy.
 */
function attachScopedLifecycle(ydoc, documentId, options) {
  const actorUserId = options.actorUserId;
  const scopeKey = getLegacyYDocScopeKey(documentId, actorUserId);
  if (ydoc.isDestroyed) return { detach: () => {}, role: () => 'unknown' };
  if (
    typeof window === 'undefined' || typeof navigator === 'undefined'
    || !navigator.locks || typeof BroadcastChannel === 'undefined'
  ) return { detach: () => {}, role: () => 'unknown' };

  const onStorageState = options.onStorageState || (() => {});
  const onRoleChange = options.onRoleChange || (() => {});
  const senderId = globalThis.crypto?.randomUUID?.()
    || `peer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bc = new BroadcastChannel(`y-doc-bc-${scopeKey}`);
  const electionAbort = new AbortController();
  const waitingPeers = new Map();
  const seenMessages = new Set();
  const ownRequests = new Set();
  const retryTimers = new Set();
  let sequence = 0;
  let detached = false;
  let role = 'unknown';
  let hydrated = false;
  let persistence = null;
  let storageDetector = null;
  let releaseLock;
  const lifetime = new Promise((resolve) => { releaseLock = resolve; });
  let election;
  const closeCoordinator = createLegacyYDocCloseCoordinator({
    ydoc, documentId, actorUserId, senderId,
    send: post, sendCancellation: fields => post('close-cancel', fields, true), getRole: () => role,
    getDatabase: () => hydrated ? persistence?.db : null,
    isCurrent: () => !detached,
  });

  function setRole(next) {
    if (detached || role === next) return;
    role = next;
    onRoleChange(next);
  }
  function post(type, fields = {}, allowDetachedCancellation = false) {
    if (detached && !(allowDetachedCancellation && type === 'close-cancel')) return null;
    const message = {
      ...fields, protocol: SCOPED_PROTOCOL, version: SCOPED_PROTOCOL_VERSION,
      documentId, actorUserId, senderId, sequence: ++sequence, type,
    };
    try { bc.postMessage(message); } catch (error) {
      if (!detached) onStorageState({ code: 'invalid_state', role, error });
      return null;
    }
    return message.sequence;
  }
  function remember(set, value, limit) {
    set.add(value);
    if (set.size > limit) set.delete(set.values().next().value);
  }
  function clearRetries() {
    for (const timer of retryTimers) clearTimeout(timer);
    retryTimers.clear();
  }
  function requestSync() {
    if (detached) return;
    // Register before posting: synchronous test buses may answer immediately.
    const requestSequence = sequence + 1;
    remember(ownRequests, requestSequence, SYNC_RETRY_DELAYS_MS.length * 2);
    post('sync-request', { stateVector: Y.encodeStateVector(ydoc) });
  }
  function retrySync(force = false) {
    if (detached || (!force && retryTimers.size > 0)) return;
    clearRetries();
    for (const delay of SYNC_RETRY_DELAYS_MS) {
      if (delay === 0) { requestSync(); continue; }
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        requestSync();
      }, delay);
      retryTimers.add(timer);
    }
  }
  function replyTo(request) {
    if (detached) return;
    // A leader may have older history only on disk. Never answer from its
    // pre-hydration state; keep one latest request per waiting peer instead.
    if (role === 'leader' && !hydrated) {
      waitingPeers.set(request.senderId, request);
      if (waitingPeers.size > MAX_WAITING_PEERS) waitingPeers.delete(waitingPeers.keys().next().value);
      return;
    }
    post('sync-response', {
      recipientId: request.senderId, requestSequence: request.sequence,
      update: Y.encodeStateAsUpdate(ydoc, request.stateVector),
      stateVector: Y.encodeStateVector(ydoc),
    });
  }
  function receive(event) {
    if (detached) return;
    const message = event?.data;
    if (!message || message.protocol !== SCOPED_PROTOCOL || message.version !== SCOPED_PROTOCOL_VERSION
      || message.documentId !== documentId || message.actorUserId !== actorUserId
      || !isNonemptyString(message.senderId) || message.senderId === senderId
      || !Number.isSafeInteger(message.sequence) || message.sequence <= 0
      || (message.recipientId !== undefined && message.recipientId !== senderId)
      || !['sync-request', 'sync-response', 'update', 'close-request', 'close-ack', 'close-error', 'close-cancel', 'close-storage-changed'].includes(message.type)) return;
    if (closeCoordinator.receive(message)) return;
    if (message.type === 'sync-response' && (
      message.recipientId !== senderId || !ownRequests.has(message.requestSequence)
    )) return;
    const identity = JSON.stringify([message.senderId, message.sequence]);
    if (seenMessages.has(identity)) return;
    try {
      let stateVector;
      let update;
      if (message.type !== 'update') {
        stateVector = updateBytes(message.stateVector);
        if (!stateVector) return;
        Y.decodeStateVector(stateVector);
      }
      if (message.type !== 'sync-request') {
        update = updateBytes(message.update);
        if (!update) return;
        // Decode before mutating the doc, so malformed frames do not reach the
        // persistence observer. Repeated valid Yjs updates are idempotent too.
        Y.decodeUpdate(update);
      }
      remember(seenMessages, identity, MAX_RECENT_MESSAGES);
      if (message.type === 'sync-request') {
        replyTo({ ...message, stateVector });
        return;
      }
      Y.applyUpdate(ydoc, update, REMOTE_BC_ORIGIN);
      if (message.type === 'sync-response') {
        // The request only advertised a state vector. Send our missing bytes
        // back now, including edits made before this follower was attached.
        const missing = Y.encodeStateAsUpdate(ydoc, stateVector);
        if (hasUpdate(missing)) post('update', { recipientId: message.senderId, update: missing });
      }
    } catch { /* malformed input cannot end the local persistence lifecycle */ }
  }
  bc.onmessage = receive;
  const onLocalUpdate = (update, origin) => {
    if (detached || origin === REMOTE_BC_ORIGIN) return;
    post('update', { update });
  };
  ydoc.on('update', onLocalUpdate);
  const onWake = () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    retrySync();
  };
  window.addEventListener('focus', onWake);
  window.addEventListener('online', onWake);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onWake);
  // Permanent registry purge must retire channels, retries and lock ownership,
  // even if its provider has not yet received the React unmount cleanup.
  ydoc.on('destroy', detach);

  // A waiter is a follower, not an indefinitely unknown role. The lock promise
  // promotes it after the previous leader has closed its persistence handle.
  setRole('follower');
  election = navigator.locks.request(`y-doc-${scopeKey}`, {
    mode: 'exclusive', signal: electionAbort.signal,
  }, async () => {
    if (detached) return;
    setRole('leader');
    if (detached) return;
    hydrated = false;
    try {
      persistence = new IndexeddbPersistence(scopeKey, ydoc);
      persistence.on('synced', () => {
        if (detached) return;
        hydrated = true;
        onStorageState({ code: 'ok', role });
        for (const request of waitingPeers.values()) replyTo(request);
        waitingPeers.clear();
        retrySync(true);
        closeCoordinator.onReady();
      });
      storageDetector = attachStorageFailureDetector({
        onState: (state) => {
          if (!detached) onStorageState({ ...state, role });
        },
      });
      await lifetime;
    } finally {
      try { await persistence?.destroy(); } catch { /* preserve disk and memory */ }
      try { storageDetector?.detach(); } catch { /* best effort */ }
    }
  }).catch((error) => {
    if (!detached) onStorageState({ code: 'invalid_state', role, error });
  });
  retrySync();

  function detach() {
    if (detached) return election;
    detached = true;
    closeCoordinator.dispose();
    clearRetries();
    waitingPeers.clear();
    seenMessages.clear();
    ownRequests.clear();
    ydoc.off('update', onLocalUpdate);
    ydoc.off('destroy', detach);
    bc.onmessage = null;
    bc.close();
    window.removeEventListener('focus', onWake);
    window.removeEventListener('online', onWake);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onWake);
    storageDetector?.detach();
    electionAbort.abort();
    releaseLock();
    return election;
  }

  return {
    detach, role: () => role,
    prepareLocalClose: closeCoordinator.prepareLocalClose,
    isLocalCloseReceiptCurrent: closeCoordinator.isLocalCloseReceiptCurrent,
    validateLocalCloseReceipt: closeCoordinator.validateLocalCloseReceipt,
  };
}
