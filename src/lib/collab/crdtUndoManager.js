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
// Pitfall 8 mitigation (attributed undoManager origin):
//   Yjs must own the undo()/redo() transaction so it can populate the opposite
//   history stack for nested annotation Y.Maps. userUndo/userRedo temporarily
//   stamp attribution fields on the UndoManager itself; Yjs uses that same
//   object as transaction.origin and observers still see local-undo/local-redo.

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
const undoReconcileStateByManager = new WeakMap();

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
    return a.every((value, index) => shallowEqual(value, b[index]));
  }
  if (Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key)
      && shallowEqual(a[key], b[key]),
  );
}

function getResurrectedAnnotationIds(ydoc, transaction) {
  const annotations = ydoc.getMap('annotations');
  const events = transaction?.changedParentTypes?.get?.(annotations);
  if (!Array.isArray(events)) return [];

  const annotationIds = new Set();
  for (const event of events) {
    if (event?.target !== annotations) continue;
    event?.changes?.keys?.forEach?.((change, annotationId) => {
      if (change?.action === 'add' && annotations.has(annotationId)) {
        annotationIds.add(annotationId);
      }
    });
  }
  return [...annotationIds];
}

function getDeletedAnnotationIds(ydoc, transaction) {
  const annotations = ydoc.getMap('annotations');
  const events = transaction?.changedParentTypes?.get?.(annotations);
  if (!Array.isArray(events)) return [];

  const annotationIds = new Set();
  for (const event of events) {
    if (event?.target !== annotations) continue;
    event?.changes?.keys?.forEach?.((change, annotationId) => {
      if (change?.action === 'delete' && !annotations.has(annotationId)) {
        annotationIds.add(annotationId);
      }
    });
  }
  return [...annotationIds];
}

function getChangedRootMapIds(transaction, rootMap) {
  const events = transaction?.changedParentTypes?.get?.(rootMap);
  if (!Array.isArray(events)) return [];
  const ids = new Set();
  for (const event of events) {
    if (event?.target === rootMap) {
      event?.changes?.keys?.forEach?.((_change, key) => ids.add(key));
    } else {
      const attachment = event?.target?._item;
      if (attachment?.parent === rootMap && attachment.parentSub != null) {
        ids.add(attachment.parentSub);
        continue;
      }
      const path = getYEventPath(event);
      if (path[0] != null) ids.add(path[0]);
    }
  }
  return [...ids];
}

function reconcileResurrectedAnnotations(ydoc, annotationIds) {
  if (!Array.isArray(annotationIds) || annotationIds.length === 0) return;
  const annotations = ydoc.getMap('annotations');
  const latestFabricById = ydoc.getMap('__annotationLatestFabric');
  if (!annotations || !latestFabricById || latestFabricById.size === 0) return;

  const pending = [];
  for (const annoId of annotationIds) {
    const annotationMap = annotations.get(annoId);
    const latestFabric = latestFabricById.get(annoId);
    if (!latestFabric || typeof annotationMap?.get !== 'function') continue;
    const fabricMap = annotationMap.get('fabric');
    if (!fabricMap || typeof fabricMap.get !== 'function') continue;
    for (const key of Object.keys(latestFabric)) {
      if (!shallowEqual(fabricMap.get(key), latestFabric[key])) {
        pending.push({ fabricMap, key, value: latestFabric[key] });
      }
    }
  }

  if (pending.length === 0) return;
  ydoc.transact(() => {
    for (const { fabricMap, key, value } of pending) {
      fabricMap.set(key, value);
    }
  }, { source: 'crdt-resurrection-reconcile' });
}

function yMapHasForeignOwner(ownerMap, localUserId) {
  if (!ownerMap) return false;
  let hasForeignOwner = false;
  try {
    ownerMap.forEach?.((ownerId) => {
      if (ownerId != null && ownerId !== localUserId) {
        hasForeignOwner = true;
      }
    });
  } catch (_) {
    // Fall through to plain-object compatibility below.
  }
  if (hasForeignOwner) return true;
  if (typeof ownerMap === 'object' && typeof ownerMap.forEach !== 'function') {
    return Object.values(ownerMap).some(
      (ownerId) => ownerId != null && ownerId !== localUserId,
    );
  }
  return false;
}

function annotationHasForeignFabricOwner(ydoc, annotationId, localUserId) {
  const ownersById = ydoc.getMap('__annotationFabricFieldOwners');
  const ownerMap = ownersById.get(annotationId);
  if (ownerMap) {
    return yMapHasForeignOwner(ownerMap, localUserId);
  }

  // Backward-compatible fallback for annotations edited before the field-owner
  // map existed. It is deliberately narrower than the field map: new commits
  // always use exact changed-key ownership.
  const annotationMap = ydoc.getMap('annotations').get(annotationId);
  const lastEditorId = annotationMap?.get?.('meta')?.get?.('lastEditorId');
  return lastEditorId != null && lastEditorId !== localUserId;
}

function getAnnotationItemRole(
  item,
  annotations,
  fabricOwnersById,
  latestFabricFieldsById,
) {
  if (!item || !annotations) return null;
  if (item.parent === annotations && item.parentSub != null) {
    return { annotationId: item.parentSub, role: 'annotation-container' };
  }
  if (item.parent === fabricOwnersById && item.parentSub != null) {
    return { annotationId: item.parentSub, role: 'owner-container' };
  }
  if (item.parent === latestFabricFieldsById && item.parentSub != null) {
    return { annotationId: item.parentSub, role: 'latest-fields-container' };
  }
  const ownerAttachment = item.parent?._item;
  if (
    ownerAttachment?.parent === fabricOwnersById
    && ownerAttachment.parentSub != null
  ) {
    return {
      annotationId: ownerAttachment.parentSub,
      role: 'owner-field',
    };
  }
  if (
    ownerAttachment?.parent === latestFabricFieldsById
    && ownerAttachment.parentSub != null
  ) {
    return {
      annotationId: ownerAttachment.parentSub,
      role: 'latest-field',
    };
  }

  const directParent = item.parent;
  const annotationAttachment = directParent?._item;
  if (
    annotationAttachment?.parent === annotations
    && annotationAttachment.parentSub != null
    && (item.parentSub === 'fabric' || item.parentSub === 'meta')
  ) {
    return {
      annotationId: annotationAttachment.parentSub,
      role: `${item.parentSub}-container`,
    };
  }
  return null;
}

function snapshotAnnotationForReconcile(ydoc, annotationId) {
  const live = ydoc.getMap('annotations').get(annotationId);
  if (typeof live?.toJSON === 'function') {
    try {
      return live.toJSON();
    } catch (_) {
      // Fall through to the out-of-scope coherent snapshot.
    }
  }
  return ydoc.getMap('__annotationLatestSnapshot').get(annotationId) || null;
}

function setMissingPlainFields(targetMap, values) {
  if (!targetMap || !values || typeof values !== 'object') return;
  for (const [key, value] of Object.entries(values)) {
    if (!targetMap.has(key)) {
      targetMap.set(key, value);
    }
  }
}

function reconcileProtectedUndoCreate(ydoc, protectedSnapshots) {
  if (!(protectedSnapshots instanceof Map) || protectedSnapshots.size === 0) return;
  const annotations = ydoc.getMap('annotations');

  ydoc.transact(() => {
    const latestSnapshots = ydoc.getMap('__annotationLatestSnapshot');
    for (const [annotationId, snapshot] of protectedSnapshots) {
      if (!snapshot || typeof snapshot !== 'object') continue;

      let annotationMap = annotations.get(annotationId);
      if (!annotationMap) {
        annotationMap = new Y.Map();
        annotations.set(annotationId, annotationMap);
      }

      for (const [key, value] of Object.entries(snapshot)) {
        if (key === 'fabric' || key === 'meta') continue;
        if (!annotationMap.has(key)) {
          annotationMap.set(key, value);
        }
      }

      for (const nestedKey of ['fabric', 'meta']) {
        const nestedValues = snapshot[nestedKey];
        if (!nestedValues || typeof nestedValues !== 'object') continue;
        let nestedMap = annotationMap.get(nestedKey);
        if (!nestedMap || typeof nestedMap.has !== 'function') {
          nestedMap = new Y.Map();
          annotationMap.set(nestedKey, nestedMap);
        }
        // Never overwrite a surviving value: it may be collaborator-owned and
        // newer than the creator's pre-undo snapshot.
        setMissingPlainFields(nestedMap, nestedValues);
      }
      latestSnapshots.set(annotationId, annotationMap.toJSON());
    }
  }, { source: 'crdt-undo-create-reconcile' });
}

function prepareProtectedCreateSnapshots(ydoc, undoManager, localUserId) {
  const state = undoReconcileStateByManager.get(undoManager);
  const stackItem = undoManager?.undoStack?.[undoManager.undoStack.length - 1];
  const createdAnnotationIds = stackItem?.meta?.get?.('createdAnnotationIds');
  if (!Array.isArray(createdAnnotationIds)) return [];
  if (!state) return createdAnnotationIds;

  const annotations = ydoc.getMap('annotations');
  for (const annotationId of createdAnnotationIds) {
    state.creatorUndoInProgressIds.add(annotationId);
  }
  for (const annotationId of createdAnnotationIds) {
    if (!annotationHasForeignFabricOwner(ydoc, annotationId, localUserId)) continue;
    const snapshot = snapshotAnnotationForReconcile(ydoc, annotationId);
    if (snapshot) state.protectedSnapshots.set(annotationId, snapshot);
  }
  return createdAnnotationIds;
}

function markUndoneCreates(ydoc, createdAnnotationIds, ctx) {
  if (!Array.isArray(createdAnnotationIds) || createdAnnotationIds.length === 0) return;
  const annotations = ydoc.getMap('annotations');
  const missingIds = createdAnnotationIds.filter(
    (annotationId) => !annotations.has(annotationId),
  );
  if (missingIds.length === 0) return;

  ydoc.transact(() => {
    const markers = ydoc.getMap('__annotationUndoCreateMarkers');
    for (const annotationId of missingIds) {
      markers.set(annotationId, {
        creatorId: ctx.userId,
        deviceId: ctx.deviceId,
        undoneAt: Date.now(),
      });
    }
  }, { source: 'crdt-undo-create-marker', userId: ctx.userId });
}

function reconcileLateCollaboratorEdits(ydoc, annotationIds) {
  if (!(annotationIds instanceof Set) || annotationIds.size === 0) return;
  const annotations = ydoc.getMap('annotations');
  const ownersById = ydoc.getMap('__annotationFabricFieldOwners');
  const latestFabricFieldsById = ydoc.getMap('__annotationLatestFabricFields');
  const latestSnapshots = ydoc.getMap('__annotationLatestSnapshot');
  const undoCreateMarkers = ydoc.getMap('__annotationUndoCreateMarkers');
  const deletionTombstones = ydoc.getMap('__annotationDeletionTombstones');
  const pending = [];

  for (const annotationId of annotationIds) {
    const marker = undoCreateMarkers.get(annotationId);
    if (!marker) continue;
    if (deletionTombstones.has(annotationId)) {
      if (annotations.has(annotationId)) {
        pending.push({ annotationId, deleteAnnotation: true });
      }
      continue;
    }

    const snapshot = latestSnapshots.get(annotationId);
    if (!snapshot) continue;
    const creatorId = marker?.creatorId ?? snapshot?.meta?.authorId;
    if (!creatorId) continue;
    const ownerMap = ownersById.get(annotationId);
    if (!yMapHasForeignOwner(ownerMap, creatorId)) continue;
    pending.push({
      annotationId,
      creatorId,
      ownerMap,
      latestFabricFields: latestFabricFieldsById.get(annotationId),
      snapshot,
    });
  }

  if (pending.length === 0) return;
  ydoc.transact(() => {
    for (const entry of pending) {
      if (entry.deleteAnnotation) {
        annotations.delete(entry.annotationId);
        continue;
      }

      const {
        annotationId,
        creatorId,
        ownerMap,
        latestFabricFields,
        snapshot,
      } = entry;
      let annotationMap = annotations.get(annotationId);
      if (!annotationMap) {
        annotationMap = new Y.Map();
        annotations.set(annotationId, annotationMap);
      }

      for (const [key, value] of Object.entries(snapshot)) {
        if (key === 'fabric' || key === 'meta') continue;
        if (!annotationMap.has(key)) annotationMap.set(key, value);
      }

      for (const nestedKey of ['fabric', 'meta']) {
        const nestedValues = snapshot[nestedKey];
        if (!nestedValues || typeof nestedValues !== 'object') continue;
        let nestedMap = annotationMap.get(nestedKey);
        if (!nestedMap || typeof nestedMap.has !== 'function') {
          nestedMap = new Y.Map();
          annotationMap.set(nestedKey, nestedMap);
        }
        setMissingPlainFields(nestedMap, nestedValues);
      }

      const fabricMap = annotationMap.get('fabric');
      ownerMap?.forEach?.((ownerId, key) => {
        if (
          ownerId === creatorId
          || !latestFabricFields?.has?.(key)
        ) {
          return;
        }
        const latestValue = latestFabricFields.get(key);
        if (!shallowEqual(fabricMap.get(key), latestValue)) {
          fabricMap.set(key, latestValue);
        }
      });
    }
  }, { source: 'crdt-undo-create-reconcile' });
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
  const protectedSnapshots = new Map();
  const protectedDuringHistoryAction = new Set();
  const creatorUndoInProgressIds = new Set();
  const annotations = ydoc.getMap('annotations');
  const fabricOwnersById = ydoc.getMap('__annotationFabricFieldOwners');
  const deletionTombstones = ydoc.getMap('__annotationDeletionTombstones');
  const latestSnapshots = ydoc.getMap('__annotationLatestSnapshot');
  const latestFabricFields = ydoc.getMap('__annotationLatestFabricFields');
  const undoCreateMarkers = ydoc.getMap('__annotationUndoCreateMarkers');
  const undoManager = new Y.UndoManager(
    [
      annotations,
      ydoc.getMap('callouts'),
      fabricOwnersById,
      latestFabricFields,
      deletionTombstones,
    ],
    {
      // Reference equality (Pitfall 7): the SAME memoized object reference is the
      // single Set member, AND the same reference is what the bridge passes as the
      // origin slot to ydoc.transact. Set.has() checks identity — rebuilding a
      // fresh frozen object with the same shape would silently disable undo scoping.
      trackedOrigins: new Set([origin]),
      captureTimeout,
      deleteFilter: (item) => {
        const annotationItem = getAnnotationItemRole(
          item,
          annotations,
          fabricOwnersById,
          latestFabricFields,
        );
        // Keep the internal ownership container integrated even when it only
        // contains creator-owned fields. Its presence distinguishes an exact
        // "no collaborator data change" from the legacy lastEditor fallback
        // while the rest of the CREATE is being deleted.
        if (
          annotationItem?.role === 'owner-container'
          || annotationItem?.role === 'latest-fields-container'
        ) {
          return false;
        }
        if (
          (
            annotationItem?.role === 'owner-field'
            || annotationItem?.role === 'latest-field'
          )
          && creatorUndoInProgressIds.has(annotationItem.annotationId)
        ) {
          return false;
        }
        if (
          !annotationItem
          || !annotationHasForeignFabricOwner(
            ydoc,
            annotationItem.annotationId,
            userId,
          )
        ) {
          return true;
        }

        const { annotationId } = annotationItem;
        if (!protectedSnapshots.has(annotationId)) {
          const snapshot = ydoc
            .getMap('__annotationLatestSnapshot')
            .get(annotationId)
            || snapshotAnnotationForReconcile(ydoc, annotationId);
          if (snapshot) protectedSnapshots.set(annotationId, snapshot);
        }
        protectedDuringHistoryAction.add(annotationId);

        // Keep the shared parent and its nested map containers integrated.
        // Creator-owned leaf values may still be undone; the reconciliation
        // pass restores only missing values and never overwrites B-owned ones.
        return false;
      },
    },
  );
  undoReconcileStateByManager.set(undoManager, {
    protectedSnapshots,
    protectedDuringHistoryAction,
    creatorUndoInProgressIds,
  });

  // History cap: trim oldest when stack-item-added fires and undoStack > cap.
  // UX rationale (CONTEXT.md): matches Figma defaults; bounded memory; oldest-out is the
  // pattern users expect from desktop apps — recent actions remain available, ancient ones drop.
  const onStackItemAdded = (event = {}) => {
    try {
      event?.stackItem?.meta?.set?.('historySource', 'Yjs history');
      event?.stackItem?.meta?.set?.('historyDiagnostics', summarizeYjsStackEvent(ydoc, event));
      const existingCreatedIds = event?.stackItem?.meta?.get?.('createdAnnotationIds') || [];
      event?.stackItem?.meta?.set?.(
        'createdAnnotationIds',
        [
          ...new Set([
            ...existingCreatedIds,
            ...getResurrectedAnnotationIds(ydoc, event),
          ]),
        ],
      );
    } catch (_) {
      // diagnostics must never affect undo behavior
    }
    while (undoManager.undoStack.length > historyCap) {
      undoManager.undoStack.shift();
    }
  };
  undoManager.on('stack-item-added', onStackItemAdded);
  const onStackItemUpdated = (event = {}) => {
    try {
      const existingCreatedIds = event?.stackItem?.meta?.get?.('createdAnnotationIds') || [];
      event?.stackItem?.meta?.set?.(
        'createdAnnotationIds',
        [
          ...new Set([
            ...existingCreatedIds,
            ...getResurrectedAnnotationIds(ydoc, event),
          ]),
        ],
      );
    } catch (_) {
      // Reconciliation metadata must never affect history behavior.
    }
  };
  undoManager.on('stack-item-updated', onStackItemUpdated);
  const onAfterTransaction = (transaction) => {
    if (transaction.origin === undoManager || transaction.origin?.source === 'local-undo') {
      creatorUndoInProgressIds.clear();
      if (protectedDuringHistoryAction.size > 0) {
        const snapshotsToReconcile = new Map();
        for (const annotationId of protectedDuringHistoryAction) {
          const snapshot = protectedSnapshots.get(annotationId);
          if (snapshot) snapshotsToReconcile.set(annotationId, snapshot);
        }
        protectedDuringHistoryAction.clear();
        protectedSnapshots.clear();
        reconcileProtectedUndoCreate(ydoc, snapshotsToReconcile);
      }
      reconcileResurrectedAnnotations(
        ydoc,
        getResurrectedAnnotationIds(ydoc, transaction),
      );
    }

    if (transaction.origin?.source !== 'crdt-undo-create-reconcile') {
      reconcileLateCollaboratorEdits(
        ydoc,
        new Set([
          ...getDeletedAnnotationIds(ydoc, transaction),
          ...getChangedRootMapIds(transaction, fabricOwnersById),
          ...getChangedRootMapIds(transaction, latestSnapshots),
          ...getChangedRootMapIds(transaction, latestFabricFields),
          ...getChangedRootMapIds(transaction, undoCreateMarkers),
          ...getChangedRootMapIds(transaction, deletionTombstones),
        ]),
      );
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
    undoManager.off('stack-item-updated', onStackItemUpdated);
    undoReconcileStateByManager.delete(undoManager);
    undoManager.destroy();
  };

  return { undoManager, origin, dispose };
}

function runAttributedHistoryAction(undoManager, source, ctx, action) {
  const keys = ['source', 'userId', 'deviceId', 'sessionId', 'clientID', 'ts'];
  const previous = new Map(keys.map((key) => [
    key,
    {
      existed: Object.prototype.hasOwnProperty.call(undoManager, key),
      value: undoManager[key],
    },
  ]));
  const attribution = {
    source,
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    sessionId: ctx.sessionId,
    clientID: ctx.clientID,
    ts: Date.now(),
  };

  Object.assign(undoManager, attribution);
  try {
    action();
  } finally {
    for (const key of keys) {
      const prior = previous.get(key);
      if (prior.existed) {
        undoManager[key] = prior.value;
      } else {
        delete undoManager[key];
      }
    }
  }
}

/**
 * User-pressed Cmd+Z (or Home-tab Undo button or Electron Edit > Undo menu item).
 *
 * Lets Y.UndoManager own the transaction so edits inside nested annotation.fabric
 * Y.Maps move onto redoStack correctly. During the synchronous transaction, the
 * UndoManager instance carries local attribution fields. Yjs already uses that
 * same instance as transaction.origin, so observers retain the local-undo signal
 * without an outer transaction that would discard nested redo history.
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
  const createdAnnotationIds = prepareProtectedCreateSnapshots(
    ydoc,
    undoManager,
    ctx.userId,
  );
  runAttributedHistoryAction(
    undoManager,
    'local-undo',
    ctx,
    () => undoManager.undo(),
  );
  markUndoneCreates(ydoc, createdAnnotationIds, ctx);
}

/**
 * User-pressed Cmd+Shift+Z (or Ctrl+Y / Home-tab Redo button / Electron Edit > Redo).
 *
 * Same attributed UndoManager-origin pattern as userUndo, with local-redo.
 *
 * @param {Y.Doc} ydoc
 * @param {Y.UndoManager} undoManager
 * @param {{userId: string, deviceId: string, sessionId: string, clientID: number}} ctx
 */
export function userRedo(ydoc, undoManager, ctx) {
  runAttributedHistoryAction(
    undoManager,
    'local-redo',
    ctx,
    () => undoManager.redo(),
  );
}
