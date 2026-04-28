// src/lib/collab/originBuilder.js
// Phase 28 — Origin payload factory for Yjs transactions. AUTH-01 + AUTH-02 data path.
// Source: .planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md Pattern 3
//
// UX/architecture rationale: every ydoc.transact(fn, origin) call carries this payload
// so server-side attribution (who / which device / when) and per-user undo
// (Phase 29 Y.UndoManager.trackedOrigins) both read the same identity from the origin
// reference. Phase 33 activity-log writes consume the same shape verbatim.
//
// IMPORTANT: serverTs is NOT set client-side. Postgres column server_ts TIMESTAMPTZ NOT NULL
// DEFAULT NOW() owns it (Phase 27 schema, locked by 27-03-PLAN.md). The client never
// fabricates timestamps — AUTH-03 is a schema-level enforcement, not a convention.
//
// REMOTE_REALTIME_ORIGIN is the identity-comparable reference for transport-layer
// remote updates. It mirrors REMOTE_BC_ORIGIN from ydocLifecycle.js (cross-tab updates).
// Phase 29 observers + the Phase 28 SupabaseYjsProvider both short-circuit echo loops
// by checking origin === REMOTE_REALTIME_ORIGIN. Object.freeze prevents accidental mutation.
//
// REMOTE_BC_ORIGIN is re-exported here so transport layers and tests have a single
// import point for all CRDT-layer origin sentinels. The canonical instance still lives
// in ydocLifecycle.js — both modules use the same `{ source: 'remote-bc' }` shape so
// reference equality holds across module boundaries (frozen object literal, no shared
// reference required for the test contract — the source string is what the echo guard
// reads in SupabaseYjsProvider via the typeof-object string-tag check).

// UX comment: source: 'remote-bc' is the BroadcastChannel cross-tab origin tag.
// SupabaseYjsProvider's echo guard checks origin?.source === 'remote-bc' so that
// updates that arrived from another tab (via Phase 27's BroadcastChannel) do not
// get re-broadcast onto the Supabase Realtime wire — that would amplify every
// edit by N tabs * M peers and melt the channel.
export const REMOTE_BC_ORIGIN = Object.freeze({ source: 'remote-bc' });

// UX comment: source: 'remote-realtime' is the Supabase Realtime transport origin tag.
// Provider attaches this to every remote update applied via Y.applyUpdate so the local
// update listener can short-circuit and skip re-broadcasting. Without this short-circuit,
// every received update bounces back out and meshes amplify into infinite send loops.
export const REMOTE_REALTIME_ORIGIN = Object.freeze({ source: 'remote-realtime' });

/**
 * Build the canonical origin payload for a local Yjs transaction.
 *
 * Every `ydoc.transact(fn, origin)` in v2.4 carries this exact shape so:
 *   - Phase 28 transport providers attribute updates to a user + device
 *   - Phase 29 per-user undo (Y.UndoManager.trackedOrigins) filters by userId
 *   - Phase 33 activity log writes (server-side trigger) read userId/deviceId/sessionId
 *
 * Defensive against partial wiring during boot — missing keys land as undefined,
 * never throw, so a half-initialized provider can still produce a valid origin.
 *
 * @param {object} args
 * @param {string} [args.userId]    - Supabase auth.uid(); server overrides via trigger (Pattern 5)
 * @param {string} [args.deviceId]  - os.hostname() on Electron, stable per-browser-install id on web
 * @param {string} [args.sessionId] - per-Y.Doc-mount; resets on document re-open
 * @param {number} [args.clientID]  - ydoc.clientID — Yjs causality identity
 * @returns {Readonly<{source:'local',userId?:string,deviceId?:string,sessionId?:string,clientID?:number}>}
 */
export function buildOrigin({ userId, deviceId, sessionId, clientID } = {}) {
  return Object.freeze({
    source: 'local',
    userId,
    deviceId,
    sessionId,
    clientID,
    // serverTs intentionally absent — Postgres DEFAULT NOW() column owns it.
  });
}
