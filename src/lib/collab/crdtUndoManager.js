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
const UNDO_BOUNDARY_REGISTRY_KEY = '__surveyCrdtUndoBoundaryRegistry';

function getUndoBoundaryRegistry() {
  const root = globalThis;
  if (!root[UNDO_BOUNDARY_REGISTRY_KEY]) {
    root[UNDO_BOUNDARY_REGISTRY_KEY] = new WeakMap();
  }
  return root[UNDO_BOUNDARY_REGISTRY_KEY];
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }
  if (Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

function reconcileResurrectedAnnotations(ydoc) {
  const annotations = ydoc.getMap('annotations');
  const latestFabricById = ydoc.getMap('__annotationLatestFabric');
  if (!annotations || !latestFabricById || latestFabricById.size === 0) return;

  const pending = [];
  annotations.forEach((annotationMap, annoId) => {
    const latestFabric = latestFabricById.get(annoId);
    if (!latestFabric || typeof annotationMap?.get !== 'function') return;
    const fabricMap = annotationMap.get('fabric');
    if (!fabricMap || typeof fabricMap.get !== 'function') return;
    for (const key of Object.keys(latestFabric)) {
      if (!shallowEqual(fabricMap.get(key), latestFabric[key])) {
        pending.push({ fabricMap, key, value: latestFabric[key] });
      }
    }
  });

  if (pending.length === 0) return;
  ydoc.transact(() => {
    for (const { fabricMap, key, value } of pending) {
      fabricMap.set(key, value);
    }
  }, { source: 'crdt-resurrection-reconcile' });
}

function getYEventPath(event) {
  if (Array.isArray(event?.path)) return event.path;
  if (typeof event?.path === 'function') {
    try {
      const path = event.path();
      return Array.isArray(path) ? path : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function summarizeYjsStackEvent(ydoc, event) {
  const changes = [];
  const changedParentTypes = event?.changedParentTypes;
  if (!changedParentTypes || typeof changedParentTypes.forEach !== 'function') return changes;

  const annotationsMap = ydoc.getMap('annotations');
  const calloutsMap = ydoc.getMap('callouts');

  changedParentTypes.forEach((events) => {
    const list = Array.isArray(events) ? events : [];
    list.forEach((changeEvent) => {
      const target = changeEvent?.target;
      const path = getYEventPath(changeEvent);
      const parentStack =
        target === annotationsMap || path[0] === 'annotations'
          ? 'annotations'
          : target === calloutsMap || path[0] === 'callouts'
            ? 'callouts'
            : null;
      const changedKeys = [];
      try {
        changeEvent?.changes?.keys?.forEach?.((value, key) => {
          changedKeys.push({ key, action: value?.action || null });
        });
      } catch (_) {
        // diagnostics only
      }
      const firstChangedKey = changedKeys[0]?.key ?? null;
      const annotationId = target === annotationsMap || target === calloutsMap
        ? firstChangedKey
        : parentStack
          ? (path[0] === parentStack ? path[1] : null)
          : path[0] ?? null;
      const annotationMap = (() => {
        try {
          if (!annotationId) return null;
          if (target === annotationsMap || parentStack === 'annotations') {
            return annotationsMap.get(annotationId) || changeEvent?.changes?.keys?.get?.(annotationId)?.oldValue || null;
          }
          if (target === calloutsMap || parentStack === 'callouts') {
            return calloutsMap.get(annotationId) || changeEvent?.changes?.keys?.get?.(annotationId)?.oldValue || null;
          }
        } catch (_) {
          return null;
        }
        return null;
      })();
      const pageNumber = (() => {
        try {
          const parent = target === annotationsMap || target === calloutsMap ? annotationMap : target?.parent;
          return typeof parent?.get === 'function' ? parent.get('pageNumber') ?? null : null;
        } catch (_) {
          return null;
        }
      })();
      const yjsAction = changedKeys.find((entry) => entry.key === annotationId)?.action
        || (changedKeys.length === 1 ? changedKeys[0].action : null)
        || event?.type
        || null;
      changes.push({
        source: 'yjs',
        historySource: 'Yjs history',
        stack: event?.type === 'redo' ? 'yjsRedoStack' : 'yjsUndoStack',
        actionType: yjsAction,
        annotationType: parentStack === 'callouts'
          ? 'callout'
          : parentStack === 'annotations'
            ? (() => {
              try {
                const type = annotationMap?.get?.('type');
                const fabricType = annotationMap?.get?.('fabric')?.get?.('type');
                return type || fabricType || 'fabric';
              } catch (_) {
                return 'fabric';
              }
            })()
            : null,
        annotationId,
        pageNumber,
        path,
        changedKeys,
      });
    });
  });

  return changes.slice(0, 12);
}

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
  const onStackItemAdded = (event = {}) => {
    try {
      event?.stackItem?.meta?.set?.('historySource', 'Yjs history');
      event?.stackItem?.meta?.set?.('historyDiagnostics', summarizeYjsStackEvent(ydoc, event));
    } catch (_) {
      // diagnostics must never affect undo behavior
    }
    while (undoManager.undoStack.length > historyCap) {
      undoManager.undoStack.shift();
    }
  };
  undoManager.on('stack-item-added', onStackItemAdded);
  const onAfterTransaction = (transaction) => {
    if (transaction.origin === undoManager || transaction.origin?.source === 'local-undo') {
      reconcileResurrectedAnnotations(ydoc);
    }
  };
  ydoc.on('afterTransaction', onAfterTransaction);

  const boundaryRegistry = getUndoBoundaryRegistry();
  const registeredManagers = boundaryRegistry.get(ydoc) || new Set();
  registeredManagers.add(undoManager);
  boundaryRegistry.set(ydoc, registeredManagers);

  // dispose lets Plan 29-04's YDocProvider effect clean up cleanly when the Y.Doc
  // unmounts (PDF tab close / app shutdown). Idempotent: calling twice after the
  // Y.UndoManager destroy is a no-op because the listener is already detached.
  const dispose = () => {
    registeredManagers.delete(undoManager);
    if (registeredManagers.size === 0) {
      boundaryRegistry.delete(ydoc);
    }
    ydoc.off('afterTransaction', onAfterTransaction);
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
