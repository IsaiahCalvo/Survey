// src/lib/collab/crdtUndoManager.js
// Phase 29 — Per-user Y.UndoManager wrapper. Pure module. No React, no Fabric.
//
// Sources:
//   .planning/phases/29-fabric-yjs-binding-per-user-undo/29-RESEARCH.md Example 2 (lines 626-703)
//   .planning/phases/29-fabric-yjs-binding-per-user-undo/29-RESEARCH.md Pattern 5 (lines 294-365)
//   .planning/phases/29-fabric-yjs-binding-per-user-undo/29-CONTEXT.md "Undo history scope" (lines 40-44)
//   Yjs source verified: src/utils/UndoManager.js afterTransactionHandler — trackedOrigins.has() is reference equality.
//
// Pitfall 7 mitigation (per-user undo erasing collaborator work):
//   Y.UndoManager.trackedOrigins is a Set checked via reference equality.
//   We memoize one frozen origin object PER userId. The same reference is passed to:
//     1. UndoManager construction — single Set member seeded with the memoized origin
//     2. Every ydoc.transact(fn, origin) call from the bridge
//   This is the entire mitigation. Anti-pattern: rebuilding the origin object per call
//   would break trackedOrigins.has(newOrigin) === false and silently disable undo scoping.
//
// clientID anti-pattern (Pitfall context-sensitive):
//   Yjs assigns a per-session numeric id on Y.Doc construction — changes on every
//   doc reconstruct + per tab. Using that field as the trackedOrigins key would break
//   undo across reload + multi-tab. userId (Supabase auth.uid()) is stable; it is the
//   correct undo-scope identity. The per-session numeric id still appears IN the
//   origin payload for activity log attribution but is NOT the undo-scoping field.
//
// Pitfall 8 mitigation (origin wrap on undoManager.undo()):
//   undoManager.undo() runs inside ydoc.transact with a 'local-undo' source. This origin
//   is NOT in trackedOrigins, so the undo transaction itself does not get pushed onto the
//   undo stack as a NEW op (correct: undoing an undo is redo(), not "track the undo").
//   The 'local-undo' source surfaces in the activity log via Phase 33 doc_yjs_updates row.

import * as Y from 'yjs';

/**
 * Per-userId memoization of the frozen origin object.
 *
 * REQUIRED for Y.UndoManager.trackedOrigins.has(origin) reference equality.
 * Plan 29-02 bridge calls THIS function to get the origin it passes to ydoc.transact;
 * Plan 29-03 createUndoManager calls THIS function to seed trackedOrigins.
 * Same reference at both sites — reference equality holds — undo scoping works.
 *
 * Module-scoped Map: same module instance across all import sites = same memoization
 * scope. Plan 29-04 (App.jsx Cmd+Z handler) and Plan 29-05 (FabricEditCanvas object:modified
 * + eraser swipe + per-word boundary) both share this cache.
 */
const memoizedOriginByUser = new Map();

/**
 * Build (or return memoized) frozen origin object for a given user.
 *
 * Reference equality holds across all calls with the same userId. This IS the
 * mitigation for Pitfall 7 — the bridge and the undo manager MUST receive the
 * same reference for trackedOrigins to filter correctly.
 *
 * UX rationale (CONTEXT.md): same userId → same memoized origin → trackedOrigins
 * matches → user A pressing Cmd+Z reverses A's work only, never collaborator B's.
 * Pitfall 7 is the canonical "per-user undo silently broken" failure mode this
 * memoization defends against.
 *
 * @param {{userId: string, deviceId?: string, sessionId?: string, clientID?: number}} args
 * @returns {Readonly<{source: 'local-fabric', userId: string, deviceId?: string, sessionId?: string, clientID?: number}>}
 */
export function getLocalFabricOrigin({ userId, deviceId, sessionId, clientID }) {
  let origin = memoizedOriginByUser.get(userId);
  if (!origin) {
    origin = Object.freeze({
      source: 'local-fabric',
      userId,
      deviceId,
      sessionId,
      clientID,
    });
    memoizedOriginByUser.set(userId, origin);
  }
  return origin;
}

/**
 * Construct a Y.UndoManager scoped to the local user's transactions.
 *
 * History is fresh per Y.Doc mount (CONTEXT.md decision: no cross-session persistence) —
 * this is automatic because UndoManager state lives entirely in the Y.Doc reference and
 * gets garbage-collected when the Y.Doc is destroyed.
 *
 * History capped at 100 actions (CONTEXT.md decision matching Figma defaults). Oldest
 * actions drop when cap is hit. Implemented via stack-item-added listener that shifts
 * undoStack manually — Y.UndoManager has no native cap option.
 *
 * UX rationale (CONTEXT.md): 100-entry cap matches Figma defaults; bounded memory; the
 * oldest-out pattern is what users expect from desktop apps — recent actions remain
 * available, ancient ones drop off the end. captureTimeout default 500ms collapses
 * rapid input bursts (drag, fast typing) into a single undo step; Plan 29-05 fires
 * undoManager.stopCapturing() at whitespace text:changed events to force a per-word
 * boundary even within the 500ms window.
 *
 * @param {object} args
 * @param {Y.Doc} args.ydoc
 * @param {string} args.userId
 * @param {string} [args.deviceId]
 * @param {string} [args.sessionId]
 * @param {number} [args.clientID]
 * @param {number} [args.captureTimeout=500] - Yjs default; CONTEXT.md per-word/text uses higher value via stopCapturing
 * @param {number} [args.historyCap=100]
 * @returns {{ undoManager: Y.UndoManager, origin: Readonly<object>, dispose: () => void }}
 */
export function createUndoManager({ ydoc, userId, deviceId, sessionId, clientID, captureTimeout = 500, historyCap = 100 }) {
  const origin = getLocalFabricOrigin({ userId, deviceId, sessionId, clientID });
  const undoManager = new Y.UndoManager(
    [ydoc.getMap('annotations'), ydoc.getMap('callouts')],
    {
      // Reference equality (Pitfall 7): the SAME memoized object reference is the
      // single Set member, AND the same reference is what the bridge passes as the
      // origin slot to ydoc.transact. Set.has() checks identity — rebuilding a
      // fresh frozen object with the same shape would silently disable undo scoping.
      trackedOrigins: new Set([origin]),
      captureTimeout,
    },
  );

  // History cap: trim oldest when stack-item-added fires and undoStack > cap.
  // UX rationale (CONTEXT.md): matches Figma defaults; bounded memory; oldest-out is the
  // pattern users expect from desktop apps — recent actions remain available, ancient ones drop.
  const onStackItemAdded = () => {
    while (undoManager.undoStack.length > historyCap) {
      undoManager.undoStack.shift();
    }
  };
  undoManager.on('stack-item-added', onStackItemAdded);

  // dispose lets Plan 29-04's YDocProvider effect clean up cleanly when the Y.Doc
  // unmounts (PDF tab close / app shutdown). Idempotent: calling twice after the
  // Y.UndoManager destroy is a no-op because the listener is already detached.
  const dispose = () => {
    undoManager.off('stack-item-added', onStackItemAdded);
    undoManager.destroy();
  };

  return { undoManager, origin, dispose };
}

/**
 * User-pressed Cmd+Z (or Home-tab Undo button or Electron Edit > Undo menu item).
 *
 * Wraps undoManager.undo() in ydoc.transact with a 'local-undo' source. This origin is
 * NOT in trackedOrigins so the undo transaction itself does not get pushed onto the
 * undo stack — pressing Cmd+Z again pops the NEXT item, not "the undo of the undo"
 * (that is what redo() does).
 *
 * UX rationale (CONTEXT.md, Pitfall 8): activity log (Phase 33) reads the origin
 * payload from doc_yjs_updates.origin column. 'local-undo' tells Phase 33's audit
 * "user X undid an action at time T on device D" — without the wrap, the undo
 * shows up as an anonymous structural change with no attribution.
 *
 * @param {Y.Doc} ydoc
 * @param {Y.UndoManager} undoManager
 * @param {{userId: string, deviceId: string, sessionId: string, clientID: number}} ctx
 */
export function userUndo(ydoc, undoManager, ctx) {
  ydoc.transact(() => undoManager.undo(), {
    source: 'local-undo',
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    sessionId: ctx.sessionId,
    clientID: ctx.clientID,
    ts: Date.now(),
  });
}

/**
 * User-pressed Cmd+Shift+Z (or Ctrl+Y / Home-tab Redo button / Electron Edit > Redo).
 *
 * Same wrap pattern as userUndo, with 'local-redo' source. Pitfall 8 mitigation parity —
 * the redo transaction is attributable in the Phase 33 activity log, and 'local-redo'
 * is NOT in trackedOrigins so the redo itself doesn't push a new undo entry.
 *
 * @param {Y.Doc} ydoc
 * @param {Y.UndoManager} undoManager
 * @param {{userId: string, deviceId: string, sessionId: string, clientID: number}} ctx
 */
export function userRedo(ydoc, undoManager, ctx) {
  ydoc.transact(() => undoManager.redo(), {
    source: 'local-redo',
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    sessionId: ctx.sessionId,
    clientID: ctx.clientID,
    ts: Date.now(),
  });
}
