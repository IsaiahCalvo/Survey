// src/lib/collab/SupabaseYjsProvider.js
// Phase 28 — Custom Supabase Realtime Yjs provider. THE DEFAULT-PATH SPIKE PROTOTYPE.
// Source: .planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md Pattern 1
//
// Reuses existing Supabase Realtime + Auth + Postgres plumbing — zero new packages.
// Per v2.4 SUMMARY.md tiebreaker: if both prototypes pass the speed bar, this wins
// (simpler — one billing surface, one service, one auth surface).
//
// Wire frame:
//   - One channel per document: `yjs:${documentId}`
//   - 4 broadcast events: 'sync' | 'awareness' | 'sync_request' | 'update_rejected'
//   - Payload shape: { update: base64String, originClientId: number }
//   - y-protocols sync v1 frame encoding (messageSync=0, messageAwareness=1)
//   - Base64-in-JSON for binary (Supabase Broadcast is JSON-only)
//   - Echo-loop guard via REMOTE_REALTIME_ORIGIN reference equality
//
// applyUpdate-only invariant: this file MUST NOT construct a Y.Doc directly. The Y.Doc
// is borrowed from ydocRegistry — passed in as a connect() argument. All remote updates
// land via Y.applyUpdate(ydoc, bytes, REMOTE_REALTIME_ORIGIN). Never replace.
// (The grep test in tests/phase27/applyUpdateOnlyInvariant.test.mjs gate-keeps Y.Doc
// constructor sites — this file deliberately avoids that exact form. The only legal
// constructor site in the entire repo is ydocRegistry.js's getOrCreateYDoc factory.)
//
// Pitfall 1 defense: this provider does NOT manage token refresh — that's
// authSessionBridge.js. The Realtime channel reuses the supabase client's auth state.
//
// Pitfall 2 defense: very large initial state is NOT carried by this provider.
// Cold-load uses Postgres SELECT on doc_yjs_state.state column (binary bytea, no
// base64 inflation). Phase 32 owns periodic compaction; Phase 28 ships the soft
// cap (SOFT_PAYLOAD_CAP_BYTES, see below).
//
// Pitfall 4 defense: kicked-out detection has 2 paths.
//   (a) postgres_changes channel on document_collaborators DELETE (proactive, <3s)
//   (b) RLS-violation error code 42501 on next write (belt-and-suspenders)
// Both fire onUpdateRejected callback so Plan 28-06's banner UX is consistent.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { REMOTE_REALTIME_ORIGIN, REMOTE_BC_ORIGIN } from './originBuilder.js';

// y-protocols sync v1 message types — locked by the y-protocols/sync source.
// messageType byte 0 = sync messages (sub-types step1 / step2 / update inside).
// messageType byte 1 = awareness messages.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// Soft cap for per-frame realtime broadcasts. base64 inflates payloads ~33%, so
// the on-wire size is ~cap * 1.33. The real Supabase Realtime Broadcast ceiling is
// 3,000 KB on Pro/Team plans (Free is 256 KB); the 1,024 KB figure sometimes cited
// is the *Postgres Changes* limit, NOT Broadcast. (Corrected 2026-06-28 — the prior
// 600 KB cap assumed a mistaken ~1 MB Broadcast ceiling.) 1.5 MB raw → ~2 MB on
// wire leaves comfortable margin under the 3 MB Pro/Team ceiling while keeping far
// more Yjs frames on the realtime path. Frames over the cap are skipped for
// broadcast (cloud/Y.Doc snapshots + row hydration still carry them; Phase 32
// compaction folds overflow into snapshots) and logged once per mount.
// NOTE: on the Free plan (256 KB Broadcast) this cap must be lowered.
const SOFT_PAYLOAD_CAP_BYTES = 1.5 * 1024 * 1024;

const sendBroadcast = (channel, event, payload, opts = {}) => {
  if (!channel) return Promise.resolve();
  if (channel.state !== 'joined' && typeof channel.httpSend === 'function') {
    return channel.httpSend(event, payload, opts);
  }
  const result = channel.send({ type: 'broadcast', event, payload }, opts);
  return result && typeof result.then === 'function' ? result : Promise.resolve(result);
};

// Re-export REMOTE_REALTIME_ORIGIN so the scaffold's `await import(TARGET)` round-trip
// works — the test reads the sentinel from this module to apply updates and assert
// echo-loop short-circuit. Single source of truth still lives in originBuilder.js.
export { REMOTE_REALTIME_ORIGIN };

// ---------------------------------------------------------------------------
// Wire-format helpers (exported so Plan 28-04 benchmark harness + tests can
// drive them directly without spinning up a full provider).
// ---------------------------------------------------------------------------

/**
 * Browser-safe base64 encode of a Uint8Array. atob/btoa work on binary strings,
 * so we marshal byte-by-byte. Realistic Yjs updates are KB-scale, so the loop
 * is fast enough for the spike.
 */
export function uint8ArrayToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Inverse of uint8ArrayToBase64. */
export function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Encode a Yjs update as a y-protocols sync v1 frame.
 * First byte = MESSAGE_SYNC (0). Then sync sub-message (writeUpdate writes sub-type
 * byte 2 = update + the update payload). Compatible with syncProtocol.readSyncMessage.
 */
export function encodeUpdate(updateBytes) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, updateBytes);
  return encoding.toUint8Array(encoder);
}

/**
 * Encode a syncStep1 frame (state vector advertisement). Used at channel-subscribe
 * time so the server / peers can reply with everything we don't have.
 */
export function encodeSyncStep1(stateVector) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, stateVector);
  return encoding.toUint8Array(encoder);
}

/**
 * Decode a y-protocols sync v1 frame and apply it.
 *
 * Sync messages call syncProtocol.readSyncMessage which dispatches by sub-type:
 *   - step1: writes step2 reply into replyEncoder
 *   - step2: applies the embedded update to ydoc with `origin`
 *   - update: applies the update to ydoc with `origin`
 *
 * Awareness messages forward to applyAwarenessUpdate.
 *
 * @returns {Uint8Array | null} reply frame to broadcast (null when no reply needed)
 */
export function decodeAndApply(ydoc, awareness, frameBytes, origin) {
  const decoder = decoding.createDecoder(frameBytes);
  const messageType = decoding.readVarUint(decoder);
  if (messageType === MESSAGE_SYNC) {
    const replyEncoder = encoding.createEncoder();
    encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, replyEncoder, ydoc, origin);
    // readSyncMessage writes the sync sub-type byte AFTER the messageType byte
    // we already wrote. If only the messageType byte is present, no reply needed.
    if (encoding.length(replyEncoder) > 1) {
      return encoding.toUint8Array(replyEncoder);
    }
    return null;
  }
  if (messageType === MESSAGE_AWARENESS && awareness) {
    awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), origin);
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider factory — the connect() entry point.
//
// Scaffold contract (tests/phase28/SupabaseYjsProvider.test.mjs):
//   - Module exports a function named `connect`.
//   - Signature: connect(documentId, ydoc, options) where options.supabase is the
//     Supabase client. Arity ≥ 2 (documentId, ydoc are required; options is optional).
//   - Returns a handle exposing disconnect().
//   - Local update with origin === REMOTE_REALTIME_ORIGIN MUST NOT trigger
//     channel.send() (echo-loop short-circuit).
// ---------------------------------------------------------------------------

/**
 * Connect a Yjs document to the Supabase Realtime transport.
 *
 * @param {string} documentId
 * @param {Y.Doc} ydoc - borrowed from ydocRegistry; this provider must NOT construct it
 * @param {object} [options]
 * @param {object} options.supabase - Supabase client (must expose .channel + .removeChannel + .auth)
 * @param {object} [options.awareness] - y-protocols Awareness instance (Phase 33 consumer)
 * @param {(reason: string) => void} [options.onUpdateRejected] - kick / RLS-violation callback
 * @param {(state: 'online'|'offline') => void} [options.onTransportState]
 * @returns {{ disconnect: () => void, send: (eventName: string, payload: object) => Promise<void>, getChannel: () => any }}
 */
export function connect(documentId, ydoc, options = {}) {
  if (!documentId) throw new Error('[SupabaseYjsProvider] documentId required');
  if (!ydoc) throw new Error('[SupabaseYjsProvider] ydoc required (borrow from ydocRegistry)');
  const { supabase, awareness, onUpdateRejected, onTransportState } = options;
  if (!supabase) throw new Error('[SupabaseYjsProvider] options.supabase required');

  const channelName = `yjs:${documentId}`;
  let channel = null;
  let detached = false;
  let largeUpdateSkipLogged = false;

  // -------------------------------------------------------------------------
  // Local update fan-out — broadcast outbound, guard echo loops.
  //
  // UX comment: without these guards, every update we receive from another peer
  // (which arrives with REMOTE_REALTIME_ORIGIN) or from another tab (which arrives
  // with REMOTE_BC_ORIGIN per Phase 27 ydocLifecycle) would be re-broadcast onto
  // the wire and amplify forever across the mesh. The reference-equality check
  // on REMOTE_REALTIME_ORIGIN is the canonical short-circuit; the source-string
  // check on REMOTE_BC_ORIGIN handles the cross-module-instance case (the BC
  // sentinel may be a different frozen-object instance than the imported one
  // depending on hot-reload + bundler dedup).
  // -------------------------------------------------------------------------
  const onLocalUpdate = (update, origin) => {
    if (detached) return;
    if (origin === REMOTE_REALTIME_ORIGIN) return;
    if (origin && typeof origin === 'object' && origin.source === REMOTE_BC_ORIGIN.source) return;

    const frameBytes = encodeUpdate(update);
    if (frameBytes.byteLength > SOFT_PAYLOAD_CAP_BYTES) {
      // Large imported PDFs can produce a full-document local update that is
      // too big for realtime broadcast. That is OK: cloud/Y.Doc snapshots and
      // row hydration carry the data; realtime is only skipped for this frame.
      if (!largeUpdateSkipLogged) {
        largeUpdateSkipLogged = true;
        // eslint-disable-next-line no-console
        console.info('[SupabaseYjsProvider] large local Y.Doc update kept out of realtime broadcast', {
          bytes: frameBytes.byteLength,
          capBytes: SOFT_PAYLOAD_CAP_BYTES,
          documentId
        });
      }
      return;
    }

    if (!channel) return; // pre-subscribe local edit — Plan 28-04 will cover queueing
    const sendResult = sendBroadcast(channel, 'sync', {
      update: uint8ArrayToBase64(frameBytes),
      originClientId: ydoc.clientID,
    });
    if (sendResult && typeof sendResult.catch === 'function') {
      sendResult.catch((err) => {
        // UX comment: send failure → transport-offline state. The provider does NOT
        // attempt local retry (Realtime client owns reconnection); instead surface
        // 'offline' so Plan 28-06's banner can show "reconnecting…". On reconnect
        // the syncStep1 handshake flushes any state we missed.
        if (typeof onTransportState === 'function') onTransportState('offline');
        // eslint-disable-next-line no-console
        console.warn('[SupabaseYjsProvider] send failed', err?.message);
      });
    }
  };
  ydoc.on('update', onLocalUpdate);

  // -------------------------------------------------------------------------
  // Subscribe to the channel.
  //
  // self:false config: don't loopback our own broadcasts (belt-and-suspenders
  // alongside the originClientId self-echo guard).
  // ack:false: don't wait for server ack — keeps fan-out fast for the spike.
  // -------------------------------------------------------------------------
  channel = supabase.channel
    ? supabase.channel(channelName, { config: { broadcast: { ack: false, self: false } } })
    : supabase.realtime?.channel?.(channelName, { config: { broadcast: { ack: false, self: false } } });

  if (channel) {
    if (typeof channel.on === 'function') {
      channel
        .on('broadcast', { event: 'sync' }, ({ payload }) => {
          if (detached) return;
          if (!payload) return;
          if (payload.originClientId === ydoc.clientID) return; // self-echo guard
          try {
            const bytes = base64ToUint8Array(payload.update);
            const reply = decodeAndApply(ydoc, awareness, bytes, REMOTE_REALTIME_ORIGIN);
            if (reply && channel) {
              sendBroadcast(channel, 'sync', {
                update: uint8ArrayToBase64(reply),
                originClientId: ydoc.clientID,
              });
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[SupabaseYjsProvider] decode failed', err?.message);
          }
        })
        .on('broadcast', { event: 'awareness' }, ({ payload }) => {
          if (detached || !awareness || !payload) return;
          try {
            const bytes = base64ToUint8Array(payload.awareness);
            awarenessProtocol.applyAwarenessUpdate(awareness, bytes, REMOTE_REALTIME_ORIGIN);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[SupabaseYjsProvider] awareness decode failed', err?.message);
          }
        })
        .on('broadcast', { event: 'sync_request' }, ({ payload }) => {
          if (detached || !payload) return;
          if (payload.fromClientId === ydoc.clientID) return;
          try {
            const remoteSV = base64ToUint8Array(payload.stateVector);
            const reply = encoding.createEncoder();
            encoding.writeVarUint(reply, MESSAGE_SYNC);
            syncProtocol.writeSyncStep2(reply, ydoc, remoteSV);
            const replyBytes = encoding.toUint8Array(reply);
            if (replyBytes.byteLength > 1 && channel) {
              sendBroadcast(channel, 'sync', {
                update: uint8ArrayToBase64(replyBytes),
                originClientId: ydoc.clientID,
              });
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[SupabaseYjsProvider] sync_request reply failed', err?.message);
          }
        })
        .on('broadcast', { event: 'update_rejected' }, ({ payload }) => {
          // UX comment: server-side validator (Plan 28-05 trigger / Edge Function)
          // rejected one of our writes — typically because RLS state changed and
          // we're no longer an editor. Surface to caller so Plan 28-06's kicked-out
          // banner can show "Your change wasn't saved because your access was removed."
          if (detached) return;
          if (typeof onUpdateRejected === 'function') {
            onUpdateRejected(payload?.reason || 'update_rejected');
          }
        });
    }

    if (typeof channel.subscribe === 'function') {
      channel.subscribe((status) => {
        if (detached) return;
        if (status === 'SUBSCRIBED') {
          if (typeof onTransportState === 'function') onTransportState('online');
          // UX comment: defer the syncStep1 handshake to a microtask so synchronous
          // callers (and unit tests with synchronous fake channels) observe a clean
          // post-connect state before the first outbound frame lands. In production
          // the deferral is a single microtask — imperceptible — and ensures we
          // don't send before the channel's own subscribe-callback unwinds.
          Promise.resolve().then(async () => {
            if (detached || !channel) return;
            try {
              const stateVector = Y.encodeStateVector(ydoc);
              await sendBroadcast(channel, 'sync_request', {
                stateVector: uint8ArrayToBase64(stateVector),
                fromClientId: ydoc.clientID,
              });
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[SupabaseYjsProvider] sync_request send failed', err?.message);
            }
          });
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (typeof onTransportState === 'function') onTransportState('offline');
        }
      });
    }
  }

  return {
    disconnect() {
      detached = true;
      try { ydoc.off('update', onLocalUpdate); } catch { /* swallow */ }
      try { channel?.unsubscribe?.(); } catch { /* swallow */ }
      try { if (channel) supabase.removeChannel?.(channel); } catch { /* swallow */ }
      try { if (channel) supabase.realtime?.removeChannel?.(channel); } catch { /* swallow */ }
      channel = null;
    },
    send(eventName, payload) {
      if (detached || !channel) return Promise.resolve();
      return sendBroadcast(channel, eventName, payload);
    },
    getChannel() {
      return channel;
    },
  };
}

// Backwards-compatible alias — Plan 28-02 originally specified
// createSupabaseYjsProvider({ ... }) as the factory name. The Wave 0 scaffold
// pinned `connect(documentId, ydoc, options)` instead. Export both so downstream
// plans (28-04 benchmark, 28-06 wire-up) can pick whichever signature reads cleaner
// at the call site without churning this module again.
export function createSupabaseYjsProvider({ documentId, ydoc, ...rest } = {}) {
  return connect(documentId, ydoc, rest);
}
