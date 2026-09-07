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
 * @param {(state: {code: string, role: 'leader'|'loser', error?: Error}) => void} options.onStorageState
 * @returns {{ detach: () => void, role: () => 'leader'|'loser'|'unknown' }}
 */
export function attachLifecycle(ydoc, documentId, options) {
  if (!ydoc) throw new Error('[ydocLifecycle] ydoc is required');
  if (!documentId) throw new Error('[ydocLifecycle] documentId is required');
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
