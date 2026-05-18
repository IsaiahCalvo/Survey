// src/lib/collab/crdtAnnotationBridge.js
// Phase 29 — Pure-module Fabric ↔ Y.Doc bridge. No React, no Fabric instance imports.
//
// Sources:
//   .planning/phases/29-fabric-yjs-binding-per-user-undo/29-RESEARCH.md Example 1 (lines 519-624)
//   .planning/phases/29-fabric-yjs-binding-per-user-undo/29-RESEARCH.md Patterns 1, 2 (lines 162-220)
//   .planning/phases/29-fabric-yjs-binding-per-user-undo/29-CONTEXT.md "Bridge mechanics" (lines 92-99)
//
// Echo-loop defense in depth (Pitfall 4):
//   1. Origin tag with source: 'local-fabric' — Y observers downstream short-circuit on this.
//   2. Module-scoped applyingRemote belt — Fabric object:modified handler short-circuits if mid-apply.
//   3. Microtask reset (Promise.resolve().then) — never the macrotask scheduler that
//      is the simple-sync verify-wait bug pattern from RESEARCH.md anti-patterns (Pitfall 8).
//
// Identity contract (Pitfall 6):
//   Bridge looks up Fabric objects via Map<annoId, FabricObject> registry passed by caller.
//   Bridge NEVER calls canvas.getObjects().find(...) — O(1) lookup only.
//
// UNDO-03 invariant:
//   meta.authorId / meta.deviceId / meta.createdAt are written ONCE on CREATE, never on EDIT.
//   Y.UndoManager.undo() of a Y.Map.delete() automatically restores ALL nested keys including
//   these three — no special tombstone handling needed.
//
// Pure-module discipline (CLAUDE.md Always-Protected list):
//   - NO React imports. NO Fabric instance imports. NO src/components/* imports.
//   - Only `import * as Y from 'yjs'` is allowed.
//   - Caller (Plan 29-05 FabricEditCanvas waiver) imports from this module; this module
//     never reaches into UI code. Keeps the bridge unit-testable in pure Node.

import * as Y from 'yjs';

const UNDO_BOUNDARY_REGISTRY_KEY = '__surveyCrdtUndoBoundaryRegistry';

function stopUndoCaptureForDoc(ydoc) {
  const managers = globalThis?.[UNDO_BOUNDARY_REGISTRY_KEY]?.get?.(ydoc);
  if (!managers) return;
  for (const manager of managers) {
    if (typeof manager?.stopCapturing === 'function') {
      manager.stopCapturing();
    }
  }
}

// --- Module-scoped applyingRemote belt ---------------------------------------
//
// UX comment: this flag is the SECONDARY defense against the echo loop. The
// PRIMARY defense is the origin-tag short-circuit in downstream observers
// (Plan 29-04 useAnnotationsCRDT). The belt protects against Fabric.js 5.5.2
// firing object:modified during a programmatic obj.set() inside
// applyYUpdateToFabric — without this, a remote update would synchronously
// trigger a local commit that re-broadcasts the same change.
//
// Reset MUST run via microtask (Promise.resolve().then). Macrotask schedulers
// are the simple-sync verify-wait bug pattern from RESEARCH.md anti-patterns
// (Pitfall 8) — they let unrelated code interleave between the apply and the
// reset, breaking the "true for the duration of the apply, false afterward"
// invariant.
let applyingRemote = false;

/**
 * Caller (FabricEditCanvas object:modified handler) reads this synchronously
 * to short-circuit local commit work when a remote apply is in flight.
 *
 *   canvas.on('object:modified', (e) => {
 *     if (isApplyingRemote()) return;
 *     applyFabricCommit(...);
 *   });
 *
 * @returns {boolean}
 */
export const isApplyingRemote = () => applyingRemote;

// --- Internals ---------------------------------------------------------------

/**
 * Shallow-equality check for primitive values + flat objects + arrays.
 *
 * UX comment: bridge skips fabricYMap.set() when the new value matches the
 * stored Y.Map value to avoid generating no-op Yjs updates that consume
 * bandwidth and force unnecessary observer fires. Important under pen-stroke
 * load where object:modified can fire at 60 Hz with most properties unchanged.
 */
function shallowEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * CUSTOM_PROPS that toObject() must serialize so Y.Doc round-trip preserves them.
 * Mirrors src/components/FabricEditCanvas.jsx CUSTOM_PROPS (line 65) so the bridge
 * round-trip is byte-identical to the existing local-edit serialization shape.
 *
 * UX comment: 'data' carries the annoId AND type-specific metadata (highlightId,
 * pdfAnnotationId, etc.); 'strokeUniform' is the CLAUDE.md mathematical invariant
 * that keeps strokes scaling correctly across SVG ↔ Fabric rasterization. Losing
 * either would corrupt the annotation on first remote sync.
 */
const FABRIC_CUSTOM_PROPS = [
  'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'highlightId', 'needsEntity',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType', 'pdfInkRenderMode',
];

/**
 * Serialize a Fabric.js object to a plain JSON snapshot for Y.Doc storage.
 *
 * UX comment: prefers toObject() over toJSON() because Fabric.js 5.5.2's
 * toJSON() internally calls toObject(propertiesToInclude) and adds nothing
 * we need; tests stub toObject() directly. Defensive fallback to toJSON()
 * for any future Fabric API drift.
 */
function serializeFabricObject(fabricObject) {
  if (typeof fabricObject?.toObject === 'function') {
    return fabricObject.toObject(FABRIC_CUSTOM_PROPS);
  }
  if (typeof fabricObject?.toJSON === 'function') {
    return fabricObject.toJSON(FABRIC_CUSTOM_PROPS);
  }
  // Last-resort plain copy — should never hit this with real Fabric objects.
  return { ...fabricObject };
}

/**
 * Read a Y.Map (or Y.Map-like fixture) into a plain object snapshot.
 *
 * UX comment: production Yjs exposes Y.Map.toJSON() which returns a deep plain
 * object. Tests sometimes inject plain objects via the fake Y.Map's set(), so
 * we fall through three shapes: real toJSON, iterable entries(), or the value
 * itself if it's already a plain object. Belt-and-suspenders for Pitfall 4
 * (echo loop) without binding the bridge to a single Y.Map shape.
 */
function snapshotYMapLike(yMapLike) {
  if (yMapLike == null) return null;
  if (typeof yMapLike.toJSON === 'function') {
    try { return yMapLike.toJSON(); } catch (_) { /* fall through */ }
  }
  if (typeof yMapLike.entries === 'function') {
    const out = {};
    try {
      for (const [k, v] of yMapLike.entries()) out[k] = v;
      return out;
    } catch (_) { /* fall through */ }
  }
  if (typeof yMapLike === 'object') return { ...yMapLike };
  return null;
}

function writePlainObjectToYMap(target, values) {
  if (!target || !values) return;
  for (const key of Object.keys(values)) {
    const prev = typeof target.get === 'function' ? target.get(key) : undefined;
    if (shallowEqual(prev, values[key])) continue;
    target.set(key, values[key]);
  }
}

function getCalloutAuthorId(callout) {
  return callout?.meta?.authorId
    || callout?.authorId
    || callout?.data?.authorId
    || callout?.data?.userId
    || null;
}

function getCalloutId(callout) {
  return callout?.id || callout?.highlightId || callout?.data?.id || null;
}

function cloneCalloutForYDoc(callout, id) {
  const out = { ...(callout || {}) };
  out.id = out.id || id;
  if (out.highlightId == null && id) out.highlightId = id;
  return out;
}

// --- Public API --------------------------------------------------------------

/**
 * Apply a Fabric edit (object:modified after move/scale/rotate/color-change OR
 * a brand-new annotation create) to Y.Doc. Same code path serves both EDIT and
 * CREATE — the isCreate branch handles seeding meta + sub-Y.Maps when the
 * annoId is unknown.
 *
 * Pre-conditions (caller responsibility):
 *  - fabricObject.data?.id (or .annoId) is a stable uuid (Pitfall 6)
 *  - originPayload is a memoized frozen object from Plan 29-03 getLocalFabricOrigin
 *    so reference equality holds with Y.UndoManager.trackedOrigins
 *  - ctx provides {userId, deviceId} for meta writes
 *
 * Mid-drag cancel: if fabricObject.__dragCancelled === true, returns immediately
 * without writing. Plan 29-05's FabricEditCanvas waiver sets this flag on Cmd+Z
 * while pointer is down.
 *
 * @param {Y.Doc}  ydoc
 * @param {Y.Map}  yMapAnnotations  // ydoc.getMap('annotations')
 * @param {object} fabricObject
 * @param {object} originPayload    // memoized {source: 'local-fabric', userId, deviceId, sessionId, clientID}
 * @param {{userId: string, deviceId: string, sessionId?: string, clientID?: number}} ctx
 */
export function applyFabricCommit(ydoc, yMapAnnotations, fabricObject, originPayload, ctx) {
  // UX comment: mid-drag cancel short-circuit. If the user pressed Cmd+Z while
  // their pointer is still down on a shape they were dragging, FabricEditCanvas
  // sets __dragCancelled before releasing pointer. The bridge MUST honor this
  // flag — otherwise the in-flight drag commit would land in Y.Doc AFTER the
  // undo-restore put the original position back, producing a phantom revert.
  if (fabricObject?.__dragCancelled === true) return;

  const annoId = fabricObject?.data?.id ?? fabricObject?.data?.annoId;
  if (!annoId) {
    // UX comment: missing annoId is a contract bug (every Fabric annotation must
    // carry one), but we drop instead of throw so a single malformed object
    // doesn't crash the entire edit canvas. Console.warn surfaces the issue
    // for debugging without breaking user flow.
    console.warn('[crdtAnnotationBridge] applyFabricCommit: fabricObject without stable annoId — dropped');
    return;
  }

  const fabricJson = serializeFabricObject(fabricObject);
  const pageNumber = fabricObject?.pageNumber;

  ydoc.transact(() => {
    if (fabricJson && typeof ydoc.getMap === 'function') {
      const latestFabricById = ydoc.getMap('__annotationLatestFabric');
      latestFabricById.set(annoId, fabricJson);
    }

    // Resolve or allocate the per-annotation Y.Map. Production Y.Map.get returns
    // undefined for missing keys; allocate a real Y.Map and attach. Test fakes
    // sometimes auto-vivify on get — in that case the returned object is the
    // fixture's own sub-fake and we reuse it directly so per-property set()
    // calls land on the fixture's tracking surface.
    let annoYMap = yMapAnnotations.get(annoId);
    if (!annoYMap) {
      annoYMap = new Y.Map();
      yMapAnnotations.set(annoId, annoYMap);
    }

    // Resolve or allocate the fabric sub-Y.Map (per-property bag).
    let fabricYMap = typeof annoYMap.get === 'function' ? annoYMap.get('fabric') : undefined;
    if (!fabricYMap) {
      fabricYMap = new Y.Map();
      annoYMap.set('fabric', fabricYMap);
    }

    // Resolve or allocate the meta sub-Y.Map (attribution + timestamps).
    let metaYMap = typeof annoYMap.get === 'function' ? annoYMap.get('meta') : undefined;
    if (!metaYMap) {
      metaYMap = new Y.Map();
      annoYMap.set('meta', metaYMap);
    }

    // CREATE detection: meta.authorId is the canonical "have we seen this
    // annoId before" signal. If it's already set, we're on the EDIT path and
    // MUST NOT overwrite the CREATE-only meta keys (UNDO-03 invariant).
    const existingAuthorId = typeof metaYMap.get === 'function' ? metaYMap.get('authorId') : undefined;
    const isCreate = existingAuthorId == null;

    if (isCreate) {
      // Top-level annotation metadata — id/type/pageNumber identify the
      // annotation independent of its Fabric serialization. These are
      // logically write-once (id never changes; type and pageNumber are
      // stable for an annotation's lifetime), so we only set them on CREATE.
      annoYMap.set('id', annoId);
      if (fabricJson?.type !== undefined) annoYMap.set('type', fabricJson.type);
      if (pageNumber !== undefined) annoYMap.set('pageNumber', pageNumber);

      // CREATE-only meta keys — UNDO-03 invariant. These are the "tombstone"
      // attribution that survives delete-undo resurrection: when a remote
      // user deletes this annotation and the original creator undoes the
      // delete, Y.UndoManager.undo() restores the entire Y.Map subtree
      // including these keys, so authorId remains the original creator.
      metaYMap.set('authorId', ctx?.userId);
      metaYMap.set('deviceId', ctx?.deviceId);
      metaYMap.set('createdAt', Date.now());
    }

    // Per-property writes — DO NOT clear-and-set. Each set() is one mergeable
    // op for COLLAB-03 LWW. If A changes fill and B changes left in the same
    // window, both survive sync because Y.Map merges per-key, not per-Map.
    writePlainObjectToYMap(fabricYMap, fabricJson);

    // EDIT-path meta — overwritten on every commit. meta.updatedAt is for
    // human display only (e.g. "edited 2 min ago" tooltips); Yjs internal
    // logical clock is what determines convergence (Y.Map per-key LWW). Do
    // NOT use updatedAt to break ties — it would be vulnerable to clock skew
    // across devices. AUTH-03 server_ts (Postgres NOW()) is the audit clock.
    metaYMap.set('updatedAt', Date.now());
    metaYMap.set('lastEditorId', ctx?.userId);
  }, originPayload);
}

/**
 * Explicit CREATE entry point for new-annotation flows that need to seed the
 * Y.Map before any Fabric edits occur (e.g., paste, import, restore-from-toast).
 *
 * UX comment: same code path as applyFabricCommit — the isCreate branch handles
 * seeding. Exposed as a separate name so call sites read clearly: "I am
 * creating a new annotation" vs. "I am committing an edit". No behavioral
 * difference; both produce one transact().
 */
export function applyFabricCreate(ydoc, yMapAnnotations, fabricObject, originPayload, ctx) {
  applyFabricCommit(ydoc, yMapAnnotations, fabricObject, originPayload, ctx);
}

/**
 * Apply a delete to Y.Doc. Y.UndoManager.undo() of this delete automatically
 * restores the entire Y.Map value including meta.{authorId, deviceId, createdAt}
 * — UNDO-03 satisfied without special tombstone handling.
 *
 * @param {Y.Doc}  ydoc
 * @param {Y.Map}  yMapAnnotations
 * @param {string} annoId
 * @param {object} originPayload
 */
export function applyFabricDelete(ydoc, yMapAnnotations, annoId, originPayload) {
  if (!annoId) {
    console.warn('[crdtAnnotationBridge] applyFabricDelete: missing annoId — dropped');
    return;
  }
  stopUndoCaptureForDoc(ydoc);
  ydoc.transact(() => {
    yMapAnnotations.delete(annoId);
  }, originPayload);
}

/**
 * Apply a callout create/edit to ydoc.getMap('callouts').
 *
 * Callouts are not Fabric annotations in App state; they live in the separate
 * callouts[] slice. The reload path for cutover-sealed documents must therefore
 * read and write the dedicated callouts Y.Map instead of relying on Supabase
 * rows or the Fabric annotations Y.Map.
 */
export function applyCalloutCommit(ydoc, yMapCallouts, callout, originPayload, ctx) {
  const calloutId = getCalloutId(callout);
  if (!calloutId) {
    console.warn('[crdtAnnotationBridge] applyCalloutCommit: callout without stable id — dropped');
    return;
  }
  const pageNumber = callout?.pageNumber ?? callout?.page_number ?? 1;
  const calloutSnapshot = cloneCalloutForYDoc(callout, calloutId);

  ydoc.transact(() => {
    let calloutYMap = yMapCallouts.get(calloutId);
    if (!calloutYMap) {
      calloutYMap = new Y.Map();
      yMapCallouts.set(calloutId, calloutYMap);
    }

    let dataYMap = typeof calloutYMap.get === 'function' ? calloutYMap.get('callout') : undefined;
    if (!dataYMap) {
      dataYMap = new Y.Map();
      calloutYMap.set('callout', dataYMap);
    }

    let metaYMap = typeof calloutYMap.get === 'function' ? calloutYMap.get('meta') : undefined;
    if (!metaYMap) {
      metaYMap = new Y.Map();
      calloutYMap.set('meta', metaYMap);
    }

    const existingAuthorId = typeof metaYMap.get === 'function' ? metaYMap.get('authorId') : undefined;
    const isCreate = existingAuthorId == null;

    if (isCreate) {
      calloutYMap.set('id', calloutId);
      calloutYMap.set('type', 'callout');
      calloutYMap.set('pageNumber', pageNumber);
      metaYMap.set('authorId', getCalloutAuthorId(callout) || ctx?.userId);
      metaYMap.set('deviceId', ctx?.deviceId);
      metaYMap.set('createdAt', Date.now());
    } else if (pageNumber !== undefined && calloutYMap.get('pageNumber') !== pageNumber) {
      calloutYMap.set('pageNumber', pageNumber);
    }

    writePlainObjectToYMap(dataYMap, calloutSnapshot);
    metaYMap.set('updatedAt', Date.now());
    metaYMap.set('lastEditorId', ctx?.userId);
  }, originPayload);
}

export function applyCalloutDelete(ydoc, yMapCallouts, calloutId, originPayload) {
  if (!calloutId) {
    console.warn('[crdtAnnotationBridge] applyCalloutDelete: missing calloutId — dropped');
    return;
  }
  stopUndoCaptureForDoc(ydoc);
  ydoc.transact(() => {
    yMapCallouts.delete(calloutId);
  }, originPayload);
}

export function materializeCalloutFromYMap(calloutYMap, fallbackId = null) {
  if (!calloutYMap || typeof calloutYMap.get !== 'function') return null;
  const dataYMap = calloutYMap.get('callout');
  let callout = null;
  if (dataYMap) {
    if (typeof dataYMap.toJSON === 'function') {
      try { callout = dataYMap.toJSON(); } catch (_e) { callout = null; }
    }
    if (!callout && typeof dataYMap.forEach === 'function') {
      callout = {};
      dataYMap.forEach((v, k) => { callout[k] = v; });
    }
  }
  if (!callout) return null;
  const id = calloutYMap.get('id') || fallbackId || callout.id || callout.highlightId;
  if (id && callout.id == null) callout.id = id;
  if (id && callout.highlightId == null) callout.highlightId = id;
  const pageNumber = calloutYMap.get('pageNumber');
  if (pageNumber != null && callout.pageNumber == null) callout.pageNumber = pageNumber;
  try {
    const metaYMap = calloutYMap.get('meta');
    if (metaYMap && typeof metaYMap.get === 'function') {
      const authorId = metaYMap.get('authorId');
      if (authorId) {
        callout.meta = { ...(callout.meta || {}), authorId: callout.meta?.authorId || authorId };
      }
      const lastEditorId = metaYMap.get('lastEditorId');
      if (lastEditorId) callout.lastEditorId = callout.lastEditorId || lastEditorId;
    }
  } catch (_e) { /* ignore */ }
  return callout;
}

/**
 * Apply a remote Y.Map snapshot to a locally-mounted Fabric edit-canvas object.
 *
 * Sets applyingRemote=true SYNCHRONOUSLY (so any Fabric object:modified that
 * fires during .set() reads true via isApplyingRemote() and short-circuits).
 * Resets in a microtask via Promise.resolve().then().
 *
 * MICROTASK reset (Promise.resolve().then) — never a macrotask scheduler — Pitfall 8.
 *
 * Registry contract (Pitfall 6): O(1) lookup via Map.get(annoId). If the
 * annotation isn't currently in the edit canvas, return silently — the SVG
 * display layer will pick up the change on its next observer-driven render.
 * NEVER call canvas.getObjects().find(...) here — that would be O(n) and
 * couple the bridge to Fabric's runtime instead of the registry abstraction.
 *
 * @param {Y.Map} yMapAnnotations
 * @param {string} annoId
 * @param {Map<string, object>} registry  // Plan 29-04 owns lifecycle
 */
export function applyYUpdateToFabric(yMapAnnotations, annoId, registry) {
  const obj = registry?.get(annoId);
  if (!obj) {
    // Not currently mounted in edit canvas. SVG layer reads on next render.
    return;
  }
  const annoYMap = yMapAnnotations?.get(annoId);
  if (!annoYMap) {
    // Remote delete. Plan 29-06 (FabricEditCanvas + remote-delete toast) owns
    // the cancel-active-edit + surface "Restore?" toast flow. Bridge stays out.
    return;
  }
  const fabricYMap = typeof annoYMap.get === 'function' ? annoYMap.get('fabric') : null;
  if (!fabricYMap) return;
  const fabricSnapshot = snapshotYMapLike(fabricYMap);
  if (!fabricSnapshot) return;

  // CRITICAL: raise the belt BEFORE calling .set so any synchronous
  // object:modified fired during the apply reads true and short-circuits.
  applyingRemote = true;
  try {
    if (typeof obj.set === 'function') {
      obj.set(fabricSnapshot);
    }
    if (typeof obj.setCoords === 'function') {
      obj.setCoords();
    }
    // Optional render trigger — Fabric.js requestRenderAll is missing on some
    // detached objects (mid-mount). Defensive optional-chain.
    if (obj.canvas && typeof obj.canvas.requestRenderAll === 'function') {
      obj.canvas.requestRenderAll();
    }
  } finally {
    // CRITICAL: microtask reset, NOT a macrotask scheduler. Macrotask is the
    // simple-sync verify-wait bug pattern (RESEARCH.md anti-patterns + Pitfall 8).
    // Microtask runs after the current synchronous frame completes but before
    // any browser repaint or async I/O — preserves the "raised for the
    // duration of one apply" semantic precisely.
    Promise.resolve().then(() => { applyingRemote = false; });
  }
}
