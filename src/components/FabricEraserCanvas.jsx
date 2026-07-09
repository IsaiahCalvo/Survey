/**
 * FabricEraserCanvas
 *
 * Eraser Canvas component that loads ALL page annotations via enlivenObjects,
 * allows eraser strokes with boolean path subtraction via geometryEraser.js,
 * and commits erased results to SVG data per-gesture via onEraseCommit.
 *
 * Key behaviors:
 * - Container-aware sizing via setZoom(effectiveScale) so coordinates match SVG viewBox space
 * - Loading state: cursor 'wait' during enlivenObjects, then 'none' (App.jsx eraser circle overlay provides visual cursor)
 * - isLoadingRef mirrors isLoading state to avoid stale closure in mouse:down handler
 * - Each completed erase gesture serializes entire Canvas and commits via onEraseCommit
 * - Fully erased objects are removed from Canvas
 * - zoomGeneration prop change flushes in-progress erase gesture (EDIT-09)
 * - Pre-unmount commit flushes in-progress erase gesture on tool switch
 * - SVG layer is visibility:hidden while this component is mounted (handled by App.jsx)
 *
 * Phase 10 Plan 02: Eraser Canvas mount/unmount mechanism.
 */
import { memo, useState, useEffect, useRef } from 'react';
import { fabric } from '../utils/fabricCompat';
import { useFabricCanvas } from '../hooks/useFabricCanvas';
import { booleanErasePath } from '../utils/geometryEraser';
import { calculateCalloutConnection } from '../utils/calloutGeometry';
// Phase 35 Plan 03 — eraser hit-test gate (AC #2: non-owner eraser swipe
// across a foreign-author mark has no effect; owner short-circuits inside).
import { canModify } from '../lib/collab/permissionScope.js';
import {
  beginAnnotationGesture,
  markAnnotationPointerRelease,
  markAnnotationPreviewFrame,
} from '../utils/annotationPreviewDiag';
import {
  eraserStrokeTouchesObject,
  getEraserCandidateId,
  getEraserDeleteDiagnostics,
  getEraserStrokeBounds,
  sampleEraserStroke,
} from '../utils/eraserHitTest.js';
import { erasePathWithCapsules } from '../utils/inkEraser.js';

// Live-preview node ownership (module scope — survives unmount/remount and is
// shared across page instances). Each element an eraser gesture styles is
// owned by that gesture's sequence id; only the owner may clear it, so a
// detached grace-period clear can never wipe a newer gesture's styling.
const ERASER_PREVIEW_NODE_OWNERS = new Map(); // element -> gesture seq id
let ERASER_PREVIEW_GESTURE_SEQ = 0;

// Custom properties to include in object serialization (matches PAL / FabricDrawingCanvas pattern)
// UX 2026-04-25: 'tool' added so arrows survive an erase commit. Without it,
// Fabric's toJSON strips the 'tool' field that FabricDrawingCanvas sets when
// the user draws an arrow ('tool: arrow'). The SVG renderer reads obj.tool
// to decide whether to render the arrowhead — losing the field turns every
// arrow into a plain line on the next render.
const CUSTOM_PROPS = [
  'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'annotationId', 'needsEntity',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType', 'pdfInkRenderMode',
  'tool',
];

const FABRIC_ENLIVENABLE_TYPES = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'textbox',
  'i-text',
  'text',
  'group',
  'image',
  'triangle',
]);

const isFabricEnlivenableObject = (obj) => {
  const type = typeof obj?.type === 'string' ? obj.type.toLowerCase() : '';
  return FABRIC_ENLIVENABLE_TYPES.has(type);
};

const getLegacyCalloutPayload = (obj, fallbackPageNumber) => {
  const callout = obj?.callout || (obj?.type === 'callout' ? obj : null);
  if (!callout || typeof callout !== 'object' || !callout.id) return null;
  return {
    ...callout,
    pageNumber: callout.pageNumber ?? fallbackPageNumber,
  };
};

const distanceToSegment = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
  const projected = {
    x: start.x + t * dx,
    y: start.y + t * dy,
  };
  return Math.hypot(point.x - projected.x, point.y - projected.y);
};

const pointInRect = (point, rect, radius) => (
  point.x >= rect.x - radius &&
  point.x <= rect.x + rect.width + radius &&
  point.y >= rect.y - radius &&
  point.y <= rect.y + rect.height + radius
);

const getCalloutHitIds = ({ callouts, pageNumber, pageWidth, pageHeight, eraserPoints, eraserRadius }) => {
  if (!Array.isArray(callouts) || callouts.length === 0) return [];
  const hitIds = [];
  const lineTolerance = eraserRadius + 8;

  callouts.forEach((callout) => {
    if (!callout?.id || callout.pageNumber !== pageNumber || hitIds.includes(callout.id)) return;

    const textBox = {
      x: (callout.textBoxPosition?.x || 0) * pageWidth,
      y: (callout.textBoxPosition?.y || 0) * pageHeight,
      width: Math.max(18, (callout.textBoxWidth ?? 0.1) * pageWidth),
      height: Math.max(18, (callout.textBoxHeight ?? 0.05) * pageHeight),
    };
    const knee = {
      x: (callout.knee?.x || 0) * pageWidth,
      y: (callout.knee?.y || 0) * pageHeight,
    };
    const arrowTip = {
      x: (callout.arrowTip?.x || 0) * pageWidth,
      y: (callout.arrowTip?.y || 0) * pageHeight,
    };
    const connection = calculateCalloutConnection(
      textBox.x,
      textBox.y,
      textBox.width,
      textBox.height,
      knee,
      arrowTip,
      0
    );

    const hit = eraserPoints.some((point) => {
      if (pointInRect(point, textBox, eraserRadius)) return true;
      if (Math.hypot(point.x - arrowTip.x, point.y - arrowTip.y) <= lineTolerance) return true;
      if (Math.hypot(point.x - connection.effectiveKnee.x, point.y - connection.effectiveKnee.y) <= lineTolerance) return true;
      if (!connection.shouldHideLine1 && distanceToSegment(point, connection.line1Start, connection.effectiveKnee) <= lineTolerance) return true;
      return distanceToSegment(point, connection.line2Start, arrowTip) <= lineTolerance;
    });

    if (hit) hitIds.push(callout.id);
  });

  return hitIds;
};

const FabricEraserCanvas = memo(({
  pageNumber,
  pageWidth,
  pageHeight,
  annotations,
  callouts = [],
  onEraseCommit,
  onEraseCallout,
  onEraseTextMarkup,
  eraserMode = 'partial',
  eraserSize = 20,
  viewerScale,
  selectedSpaceId,
  activeSpaceId,
  spaces,
  zoomGeneration,
  // Phase 35 Plan 03 — per-user delete authority gate (boot-guarded; legacy
  // mount sites without these props fall through to today's behavior).
  viewerId,
  documentOwnerId,
}) => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [isLoading, setIsLoading] = useState(true);

  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------
  const canvasElRef = useRef(null);
  const containerRef = useRef(null);
  const mountedRef = useRef(true);
  const unsupportedAnnotationObjectsRef = useRef([]);

  // CRITICAL: Ref mirror of isLoading for use in mouse:down handler.
  // The mouse:down handler is bound in useEffect([]) and would capture the
  // initial isLoading=true state value forever due to stale closure.
  // The ref is always current.
  const isLoadingRef = useRef(true);

  const eraserPathRef = useRef([]);
  const isErasingRef = useRef(false);
  // Live erase feedback (2026-07-08): the drag itself shows its effect —
  // a destination-out trail cuts annotation pixels under the swath (partial
  // mode), and any object the gesture has touched fades to a ghost (both
  // modes; in partial that covers the non-stroke objects that will be
  // whole-removed on release). The durable result is still computed ONCE at
  // gesture end by applyEraserAndCommit — the preview never writes anything.
  const eraserTrailRef = useRef(null);
  const lastPreviewIndexRef = useRef(0);
  // Set by the mount effect; lets the window-blur safety net finish an
  // interrupted gesture (commit + visual restore) from outside the handlers.
  const finishGestureRef = useRef(null);
  // Set by the mount effect; re-runs the annotation loader when the
  // annotations prop changes EXTERNALLY (undo, collab) — a stale canvas
  // would otherwise hit-test and COMMIT against pre-undo state.
  const loadAnnotationsRef = useRef(null);
  const needsReloadRef = useRef(false);
  // Per-gesture bbox cache for the live-erase broad phase (C-3: one
  // getBoundingRect per object per GESTURE, not per mousemove).
  const gestureBBoxCacheRef = useRef(new Map());
  // Reload generation: a stale async enliven callback must never dump the
  // previous load's objects on top of a newer load.
  const loadGenRef = useRef(0);
  // Live partial erase (swept-capsule splitting, src/utils/inkEraser.js):
  // pre-gesture serialized snapshots of live-bitten strokes (the commit's
  // before/after diff needs the PRE-gesture state), and the before-jsons of
  // strokes fully erased mid-gesture (they are gone from the canvas by
  // commit time but must still count as deletions).
  const gestureBeforeJsonRef = useRef(new Map());
  const gestureRemovedRef = useRef([]);
  const eraserDiagGestureRef = useRef(null);

  // Closure-safe refs for props
  const annotationsRef = useRef(annotations);
  const calloutsRef = useRef(callouts);
  const onEraseCommitRef = useRef(onEraseCommit);
  const onEraseCalloutRef = useRef(onEraseCallout);
  const onEraseTextMarkupRef = useRef(onEraseTextMarkup);
  const eraserModeRef = useRef(eraserMode);
  const eraserSizeRef = useRef(eraserSize);
  const viewerScaleRef = useRef(viewerScale);
  const effectiveScaleRef = useRef(1);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const activeSpaceIdRef = useRef(activeSpaceId);
  const spacesRef = useRef(spaces);
  const initialZoomGenRef = useRef(zoomGeneration);
  // Phase 35 Plan 03 — closure-safe refs for the per-user delete authority
  // gate inside applyEraserAndCommit (the loop reads via .current to dodge
  // stale closures, matching every other prop ref above).
  const viewerIdRef = useRef(viewerId);
  const documentOwnerIdRef = useRef(documentOwnerId);

  const getSpaceIdForRegion = (regionId) => {
    if (!regionId) return null;
    const currentSpaces = Array.isArray(spacesRef.current) ? spacesRef.current : [];
    for (const space of currentSpaces) {
      const assignedPages = Array.isArray(space?.assignedPages) ? space.assignedPages : [];
      for (const page of assignedPages) {
        const regions = Array.isArray(page?.regions) ? page.regions : [];
        for (const region of regions) {
          if (region?.regionId === regionId) {
            return space.id;
          }
        }
      }
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // Live-preview helpers (visual only — the preview NEVER touches the store)
  //
  // Selective preview (v2): the SVG layer stays the standing visual truth for
  // everything EXCEPT freehand strokes during a partial-mode gesture. Fabric
  // renders compound annotations without their SVG-side dressing (arrows lose
  // arrowheads, counters lose numbers, text re-lays-out), so revealing them
  // mid-gesture visibly changes them — the "click flicker" bug. Instead:
  //   - partial mode: ONLY pen/highlighter strokes swap to the Fabric canvas
  //     (sub-pixel rasterizer delta) so the destination-out trail can carve
  //     their pixels live; their SVG twins hide for the gesture. Strokes the
  //     commit would refuse (permission/space gates) never swap — the trail
  //     cannot show an erase that will not happen.
  //   - whole-object erase targets ghost IN PLACE on the SVG layer
  //     (style.opacity on their [data-annotation-id] group) — arrowheads and
  //     every SVG-only detail stay pixel-identical while fading.
  //   - restore is DATA-DRIVEN: after a commit, swapped strokes stay on the
  //     Fabric canvas until the annotations prop re-renders the SVG with the
  //     post-erase data (fallback timeout 1200ms) — the pre-erase state can
  //     never flash back ("erase comes back" bug).
  // ---------------------------------------------------------------------------
  const gestureSwapTokenRef = useRef(0);
  const strokeSwapsRef = useRef(new Set()); // fabric objs swapped to this canvas
  const ghostedObjsRef = useRef(new Set()); // fabric objs whose SVG twin is ghosted
  const pendingRestoreRef = useRef(null);   // { token, run } awaiting annotations change
  const restoreTimerRef = useRef(null);
  // The exact annotations object the mount-time enliven consumed.
  // __sourceIndex values index THIS array — the data-annotation-index
  // fallback is only trustworthy while the SVG still renders it. Any commit
  // (compaction/reorder) breaks positional addressing for the REST of the
  // mount, so after one the id-less strokes simply stop swapping (no preview
  // is better than a wrong one).
  const enlivenSourceRef = useRef(null);
  // Every SVG element this gesture writes an inline opacity on. React REUSES
  // <g> nodes across re-renders (keyed by id-or-index), so an inline style
  // can outlive its annotation and hide the node's NEXT occupant — the final
  // cleanup clears inline opacity on these exact elements, skipping any that
  // a newer gesture is actively styling.
  const gestureStyledNodesRef = useRef(new Set());

  // The SVG twin of a fabric object: by annotation id when the serialized
  // object carries one, else by source-array index (pen strokes have no
  // top-level id; data-annotation-index uses the same array index that
  // enliven recorded as __sourceIndex).
  const svgNodeForObj = (obj) => {
    if (!obj || typeof document === 'undefined') return null;
    try {
      if (obj.id) {
        const byId = document.querySelector(
          `[data-diag-svg-wrapper="${pageNumber}"] [data-annotation-id="${CSS.escape(String(obj.id))}"]`
        );
        if (byId) return byId;
      }
      // Index addressing is positional — valid ONLY while the SVG still
      // renders the exact array the enliven stamped __sourceIndex from.
      if (
        Number.isInteger(obj.__sourceIndex)
        && annotationsRef.current === enlivenSourceRef.current
      ) {
        return document.querySelector(
          `[data-diag-svg-wrapper="${pageNumber}"] [data-annotation-index="${obj.__sourceIndex}"]`
        );
      }
    } catch (_) { /* fall through */ }
    return null;
  };

  const gestureIdRef = useRef(0);

  const setNodeOpacity = (node, value) => {
    if (!node) return;
    try {
      node.style.opacity = value;
      if (value !== '') {
        gestureStyledNodesRef.current.add(node);
        ERASER_PREVIEW_NODE_OWNERS.set(node, gestureIdRef.current);
      }
    } catch (_) { /* detached */ }
  };

  // Clears inline opacity on a past gesture's styled elements — element-refs,
  // so React node reuse can't strand a hide on the wrong annotation. Only the
  // OWNING gesture may clear (module-scope registry), so this is safe from
  // detached timers, unmounts, remounts, and overlapping gestures.
  const clearStyledNodes = (nodes, ownerId) => {
    nodes.forEach((n) => {
      if (ERASER_PREVIEW_NODE_OWNERS.get(n) !== ownerId) return;
      ERASER_PREVIEW_NODE_OWNERS.delete(n);
      try { n.style.opacity = ''; } catch (_) { /* detached */ }
    });
  };

  const isStrokePathObj = (obj) => obj.type === 'path' && (
    obj.tool === 'pen'
    || obj.tool === 'highlighter'
    || obj.pdfAnnotationType === 'Ink'
    || (!obj.pdfAnnotationType && !obj.annotationId && !obj.moduleId)
  );

  // Mirrors applyEraserAndCommit's permission + space-scope gates so the
  // preview never advertises an erase the commit will refuse.
  const passesEraseGates = (obj) => {
    const _vId = viewerIdRef.current;
    const _oId = documentOwnerIdRef.current;
    if (_vId && _oId && !canModify({
      annotation: { id: obj.id, authorId: obj.authorId, data: obj.data, meta: obj.meta },
      viewerId: _vId,
      documentOwnerId: _oId,
    })) return false;
    const objSpaceId = obj.spaceId || null;
    const objRegionId = obj.regionId || null;
    if (activeSpaceIdRef.current !== null) {
      if (objRegionId !== null) {
        const derivedSpaceId = getSpaceIdForRegion(objRegionId);
        if (derivedSpaceId !== null && derivedSpaceId !== activeSpaceIdRef.current) return false;
      } else if (objSpaceId !== null) {
        if (objSpaceId !== activeSpaceIdRef.current) return false;
      } else {
        return false;
      }
    } else if (selectedSpaceIdRef.current !== null && objSpaceId !== null) {
      if (objSpaceId !== selectedSpaceIdRef.current) return false;
    }
    return true;
  };

  const beginGesturePreview = useRef((canvas) => {
    gestureSwapTokenRef.current += 1; // invalidates any pending deferred restore
    ERASER_PREVIEW_GESTURE_SEQ += 1;
    gestureIdRef.current = ERASER_PREVIEW_GESTURE_SEQ;
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    // A previous gesture's data-driven restore still pending? Run it NOW
    // (full flavor — SVG writes stay guarded inside svgNodeForObj by the
    // mount-time enliven-source identity).
    if (pendingRestoreRef.current) {
      const pending = pendingRestoreRef.current;
      pendingRestoreRef.current = null;
      try { (pending.runFull || pending.run)(); } catch (_) { /* never break a gesture */ }
    }
    if (eraserModeRef.current !== 'entire') {
      canvas.getObjects().forEach((obj) => {
        if (obj.__isEraserTrail || !isStrokePathObj(obj)) return;
        // Legacy fill-ribbons get no live carve (boolean at release only) —
        // swapping them would just show an un-carved fabric copy mid-gesture.
        if ((obj.strokeWidth || 0) === 0) return;
        if (!passesEraseGates(obj)) return;
        const node = svgNodeForObj(obj);
        // No addressable SVG twin -> do NOT swap (revealing the fabric copy
        // would double-render on top of a still-visible SVG twin).
        if (!node) return;
        try { obj.set('opacity', obj.__origOpacity !== undefined ? obj.__origOpacity : obj.opacity); } catch (_) { /* ignore */ }
        setNodeOpacity(node, '0');
        strokeSwapsRef.current.add(obj);
      });
      canvas.requestRenderAll();
    }
  }).current;

  const clearErasePreview = useRef((canvas) => {
    if (eraserTrailRef.current) {
      try { canvas.remove(eraserTrailRef.current); } catch (_) { /* disposed */ }
      eraserTrailRef.current = null;
    }
    lastPreviewIndexRef.current = 0;
  }).current;

  // Restores SVG/fabric visual state after a gesture. Deleted-ness is derived
  // from canvas membership (removed objects = erased) — no id-scheme coupling.
  // committed + !sync => stroke swap-back waits for the annotations prop
  // (data-driven) so the SVG never shows pre-erase data.
  const restorePreview = useRef((canvas, { committed = false, sync = false } = {}) => {
    // Flush any previous gesture's still-pending deferred restore first —
    // its timer must never outlive this call (or the component).
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    if (pendingRestoreRef.current) {
      const stale = pendingRestoreRef.current;
      pendingRestoreRef.current = null;
      try { (stale.runFull || stale.run)(); } catch (_) { /* ignore */ }
    }
    const token = gestureSwapTokenRef.current;
    const ghostEntries = [...ghostedObjsRef.current];
    ghostedObjsRef.current = new Set();
    const strokeEntries = [...strokeSwapsRef.current];
    strokeSwapsRef.current = new Set();
    const ownerId = gestureIdRef.current;
    const styledNodes = [...gestureStyledNodesRef.current];
    gestureStyledNodesRef.current = new Set();
    // Restore-time writes must stay tracked + owned so the final clear
    // covers them too.
    const writeTracked = (node, value) => {
      if (!node) return;
      try {
        node.style.opacity = value;
        if (!styledNodes.includes(node)) styledNodes.push(node);
        ERASER_PREVIEW_NODE_OWNERS.set(node, ownerId);
      } catch (_) { /* detached */ }
    };
    let survivors = new Set();
    try { survivors = new Set(canvas.getObjects()); } catch (_) { /* disposed */ }

    // Ghosts live on SVG nodes. Erased ones go fully hidden until the
    // re-render drops their node; survivors (shouldn't happen — ghosting is
    // gate- and touch-filtered) restore immediately.
    ghostEntries.forEach((obj) => {
      const node = svgNodeForObj(obj);
      if (!node) return;
      writeTracked(node, survivors.has(obj) ? '' : '0');
    });

    // Final element-level cleanup: once the SVG re-renders (or after a grace
    // period on paths with no re-render signal), NO inline opacity from this
    // gesture may remain — React node reuse would otherwise hide whichever
    // annotation inherits the element.
    const scheduleStyledClear = (delayMs) => {
      if (!styledNodes.length) return;
      setTimeout(() => clearStyledNodes(styledNodes, ownerId), delayMs);
    };

    // svgSafe: SVG-side writes are allowed only while the DOM still renders
    // the gesture-time annotations array (svgNodeForObj enforces the same
    // guard). After a committed re-render the fresh nodes carry no inline
    // styles — only the fabric side needs re-hiding.
    const runStrokeRestore = (svgSafe) => {
      strokeEntries.forEach((obj) => {
        try { obj.set('opacity', 0); } catch (_) { /* removed/disposed */ }
        if (!svgSafe) return;
        const node = svgNodeForObj(obj); // identity-guarded re-query
        if (!node) return;
        writeTracked(node, survivors.has(obj) ? '' : '0');
      });
      try { canvas.requestRenderAll(); } catch (_) { /* disposed */ }
    };

    if (!committed) {
      // No data change is coming: restore in place and drop the bookkeeping.
      runStrokeRestore(true);
      // Nothing was erased, so every styled element goes straight back to ''.
      clearStyledNodes(styledNodes, ownerId);
      return;
    }
    if (sync) {
      runStrokeRestore(true);
      // The commit's re-render lands after this tick (or never reaches this
      // unmounted component) — a detached grace-period clear guarantees no
      // stranded inline style on a reused element.
      scheduleStyledClear(600);
      return;
    }
    const pending = {
      token,
      // annotations changed -> SVG re-rendered -> fabric re-hide + clear the
      // exact elements this gesture styled (reused nodes lose the stale hide).
      run: () => {
        runStrokeRestore(false);
        clearStyledNodes(styledNodes, ownerId);
      },
      // timeout with NO annotations change -> old DOM still up -> full
      // restore now, grace-period clear for a late re-render.
      runFull: () => {
        runStrokeRestore(true);
        scheduleStyledClear(600);
      },
    };
    pendingRestoreRef.current = pending;
    restoreTimerRef.current = setTimeout(() => {
      if (pendingRestoreRef.current === pending && gestureSwapTokenRef.current === token) {
        pendingRestoreRef.current = null;
        pending.runFull();
      }
    }, 1200);
  }).current;

  const updateErasePreview = useRef((canvas) => {
    const pathData = eraserPathRef.current;
    if (!pathData || pathData.length === 0) return;
    // Same radius formula as applyEraserAndCommit — the preview swath, the
    // cursor circle, and the committed hit test must all agree.
    const vs = viewerScaleRef.current || 1;
    const es = effectiveScaleRef.current || 1;
    const radius = eraserSizeRef.current * (vs / es);
    const mode = eraserModeRef.current === 'entire' ? 'entire' : 'partial';

    // 1. Ghost newly-touched whole-object erase targets IN PLACE on the SVG
    //    layer. Incremental: only the segment added since the last tick.
    const from = Math.max(0, lastPreviewIndexRef.current - 1);
    const recent = [];
    for (let i = from; i < pathData.length; i += 1) {
      const cmd = pathData[i];
      if (cmd[0] === 'M' || cmd[0] === 'L') recent.push({ x: cmd[1], y: cmd[2] });
    }
    lastPreviewIndexRef.current = pathData.length;
    // An external SVG re-render mid-gesture replaces nodes and drops our
    // inline styles — re-assert them every tick (bounded by swap/ghost counts).
    strokeSwapsRef.current.forEach((obj) => {
      const n = svgNodeForObj(obj);
      if (n && n.style.opacity !== '0') setNodeOpacity(n, '0');
    });
    ghostedObjsRef.current.forEach((obj) => {
      const n = svgNodeForObj(obj);
      if (n && n.style.opacity !== '0.15') setNodeOpacity(n, '0.15');
    });
    const allObjects = canvas.getObjects();
    // ponytail: skip the ghost pass on very heavy pages (12k-stroke imported
    // docs) — O(objects) hit tests per mousemove would hitch; the trail and
    // the commit stay exact.
    if (recent.length > 0 && allObjects.length <= 2000) {
      for (const obj of allObjects) {
        if (obj.__isEraserTrail || ghostedObjsRef.current.has(obj)) continue;
        // Partial mode BITES stroke paths (trail is their live preview);
        // everything else — and everything in entire mode — ghosts whole.
        if (mode === 'partial' && isStrokePathObj(obj)) continue;
        if (!passesEraseGates(obj)) continue;
        let touches = false;
        try {
          touches = eraserStrokeTouchesObject({ eraserPoints: recent, eraserRadius: radius, object: obj });
        } catch (_) { /* preview must never break the gesture */ }
        if (touches) {
          const node = svgNodeForObj(obj);
          if (node) {
            setNodeOpacity(node, '0.15');
            ghostedObjsRef.current.add(obj);
          }
        }
      }
    }

    // (The old destination-out trail is gone: partial mode now REALLY bites
    // strokes live via applyLiveInkErase — the ink itself is the preview.)
    canvas.requestRenderAll();
  }).current;

  // Serialize one canvas object back to its stored-annotation JSON shape.
  // Component-scope: the live erase path needs pre-mutation snapshots.
  const serializeObjectForCommitFn = useRef((obj) => {
    if (obj.type === 'textbox' && obj.__importedJSON) {
      return { ...obj.__importedJSON };
    }
    // fabric 7: toObject(CUSTOM_PROPS) — toJSON() ignores arguments and
    // drops the custom props (id/moduleId/regionId/data...).
    const json = obj.toObject(CUSTOM_PROPS);
    // fabric 7: toObject() emits capitalized type ('Path') — compare against
    // the live instance's lowercase type, not the serialized casing.
    if (obj.type === 'path' && !obj.isPdfImported) {
      json.left = 0;
      json.top = 0;
    }
    if (obj.isPdfImported && obj.__origOpacity !== undefined) {
      json.opacity = obj.__origOpacity;
      const wasConverted = (obj.strokeWidth || 0) === 0 && !!obj.fill && obj.fill !== 'transparent';
      if (!wasConverted) {
        if (obj.__origStroke !== undefined) json.stroke = obj.__origStroke;
        if (obj.__origStrokeWidth !== undefined) json.strokeWidth = obj.__origStrokeWidth;
      }
    } else if (obj.__origOpacity !== undefined) {
      json.opacity = obj.__origOpacity;
    }
    return json;
  }).current;

  // Transform a scene-space capsule step into an object's PATH-DATA space
  // (inverse transform + pathOffset, radius scaled) — the same mapping
  // booleanErasePath uses, shared by the live and commit erase paths.
  const toLocalCapsuleFn = useRef((obj, aScene, bScene, sceneRadius) => {
    const matrix = obj.calcTransformMatrix();
    const pathOffset = obj.pathOffset || { x: 0, y: 0 };
    const scale = Math.sqrt(matrix[0] * matrix[0] + matrix[1] * matrix[1]) || 1;
    const inv = (pt) => {
      const [a, b, c, d, e, f] = matrix;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-10) return { x: pt.x, y: pt.y };
      const px = pt.x - e;
      const py = pt.y - f;
      return {
        x: (d * px - c * py) / det + pathOffset.x,
        y: (-b * px + a * py) / det + pathOffset.y,
      };
    };
    return {
      capsule: { a: inv(aScene), b: inv(bScene) },
      localRadius: sceneRadius / scale,
    };
  }).current;

  // LIVE partial erase: bite the newest pointer segment out of every eligible
  // freehand stroke, exactly as the commit will (same math, incremental).
  const applyLiveInkErase = useRef((canvas) => {
    if (eraserModeRef.current === 'entire') return;
    const pts = eraserPathRef.current;
    if (!pts || pts.length < 2) return;
    // ponytail: no live carve above 2000 objects (matches the ghost-pass
    // guard) — the commit stays exact; heavy imported pages skip preview.
    if (canvas.getObjects().length > 2000) return;
    const n = pts.length;
    const aScene = { x: pts[n - 2][1], y: pts[n - 2][2] };
    const bScene = { x: pts[n - 1][1], y: pts[n - 1][2] };
    const vs = viewerScaleRef.current || 1;
    const es = effectiveScaleRef.current || 1;
    const sceneRadius = eraserSizeRef.current * (vs / es);
    const capMinX = Math.min(aScene.x, bScene.x) - sceneRadius;
    const capMaxX = Math.max(aScene.x, bScene.x) + sceneRadius;
    const capMinY = Math.min(aScene.y, bScene.y) - sceneRadius;
    const capMaxY = Math.max(aScene.y, bScene.y) + sceneRadius;
    let anyChange = false;
    for (const obj of [...canvas.getObjects()]) {
      if (obj.__isEraserTrail || obj.type !== 'path' || !obj.path) continue;
      const isStroke = (obj.strokeWidth || 0) > 0 && (
        obj.tool === 'pen'
        || obj.tool === 'highlighter'
        || obj.pdfAnnotationType === 'Ink'
        || (!obj.pdfAnnotationType && !obj.annotationId && !obj.moduleId)
      );
      if (!isStroke) continue; // legacy fill-ribbons keep the boolean commit path
      if (!passesEraseGates(obj)) continue;
      // Cheap absolute-bbox reject (scene units), inflated by half stroke
      // width. Cached per gesture: strokes only SHRINK during a gesture, so
      // the first-seen bbox stays a valid conservative bound.
      try {
        let br = gestureBBoxCacheRef.current.get(obj);
        if (!br) {
          br = obj.getBoundingRect(true);
          gestureBBoxCacheRef.current.set(obj, br);
        }
        const inflate = (obj.strokeWidth || 0) / 2 + 1;
        if (br.left > capMaxX + inflate || br.left + br.width < capMinX - inflate
          || br.top > capMaxY + inflate || br.top + br.height < capMinY - inflate) continue;
      } catch (_) { /* fall through to exact math */ }
      const { capsule, localRadius } = toLocalCapsuleFn(obj, aScene, bScene, sceneRadius);
      const rEff = localRadius + (obj.strokeWidth || 0) / 2;
      let result;
      try {
        result = erasePathWithCapsules(obj.path, [capsule], rEff);
      } catch (err) {
        console.error('[FabricEraserCanvas] live ink erase failed:', err);
        continue;
      }
      if (!result.changed) continue;
      // First mutation: stash the PRE-gesture serialized state for the commit diff.
      if (!gestureBeforeJsonRef.current.has(obj)) {
        try { gestureBeforeJsonRef.current.set(obj, serializeObjectForCommitFn(obj)); } catch (_) { /* best effort */ }
      }
      if (!result.pathData.length) {
        gestureRemovedRef.current.push(gestureBeforeJsonRef.current.get(obj) || null);
        canvas.remove(obj);
      } else {
        obj.path = result.pathData;
        obj.dirty = true;
      }
      anyChange = true;
    }
    if (anyChange) canvas.requestRenderAll();
  }).current;

  // ---------------------------------------------------------------------------
  // Helper: apply eraser path to canvas objects and commit
  // ---------------------------------------------------------------------------
  const applyEraserAndCommit = useRef((canvas) => {
    const eraserPathData = eraserPathRef.current;
    if (!eraserPathData || eraserPathData.length === 0) {
      return;
    }

    // Single-click (only M, no L): duplicate the point so geometry eraser
    // treats it as a zero-length segment (eraser radius still applies)
    if (eraserPathData.length === 1 && (eraserPathData[0][0] === 'M')) {
      eraserPathData.push(['L', eraserPathData[0][1], eraserPathData[0][2]]);
    }

    // Adjust eraser radius to match the visual cursor overlay.
    // Cursor overlay uses: eraserSize * viewerScale (screen px).
    // Canvas operates at effectiveScale (container-aware), so page-space radius
    // maps to eraserSize * effectiveScale on screen. Compensate for the difference.
    const vs = viewerScaleRef.current || 1;
    const es = effectiveScaleRef.current || 1;
    const currentEraserSize = eraserSizeRef.current * (vs / es);

    // Build eraser path object compatible with geometryEraser.js
    // Both splitPathDataByEraser and booleanErasePath expect:
    //   eraserPath: { points: [{x, y}, ...] }
    //   eraserRadius: number
    const eraserPoints = [];
    for (const cmd of eraserPathData) {
      if (cmd[0] === 'M' || cmd[0] === 'L') {
        eraserPoints.push({ x: cmd[1], y: cmd[2] });
      }
    }
    const eraserPath = { points: eraserPoints };
    const mode = eraserModeRef.current === 'entire' ? 'entire' : 'partial';

    // Belt-and-braces: the live-preview trail is torn down by every caller
    // before this runs, but it must NEVER be treated as an annotation.
    const objects = [...canvas.getObjects()].filter((o) => !o.__isEraserTrail);
    const beforeSerializedObjects = [];
    const candidateAnnotationIds = [];
    const rejectedAnnotations = [];
    const touchedAnnotationIds = [];
    let changed = false;

    const serializeObjectForCommit = serializeObjectForCommitFn;

    for (let objectIndex = 0; objectIndex < objects.length; objectIndex += 1) {
      const obj = objects[objectIndex];
      const candidateId = getEraserCandidateId(obj, objectIndex);
      try {
        beforeSerializedObjects.push(
          gestureBeforeJsonRef.current.get(obj) || serializeObjectForCommit(obj)
        );
      } catch (_) {
        beforeSerializedObjects.push(obj?.__importedJSON ? { ...obj.__importedJSON } : null);
      }

      // Phase 35 Plan 03 — AC #2 eraser gate. canModify reads authorId via
      // its meta > authorId > data.authorId > data.userId chain, so the shim
      // forwards every surface Fabric might carry it on. Owner short-circuits.
      const _vId = viewerIdRef.current;
      const _oId = documentOwnerIdRef.current;
      if (_vId && _oId && !canModify({
        annotation: { id: obj.id, authorId: obj.authorId, data: obj.data, meta: obj.meta },
        viewerId: _vId,
        documentOwnerId: _oId,
      })) {
        rejectedAnnotations.push({ id: candidateId, reason: 'permission' });
        continue;
      }

      const objSpaceId = obj.spaceId || null;
      const objRegionId = obj.regionId || null;
      let shouldSkip = false;

      if (activeSpaceIdRef.current !== null) {
        if (objRegionId !== null) {
          const derivedSpaceId = getSpaceIdForRegion(objRegionId);
          if (derivedSpaceId !== null && derivedSpaceId !== activeSpaceIdRef.current) {
            shouldSkip = true;
          }
        } else if (objSpaceId !== null) {
          shouldSkip = objSpaceId !== activeSpaceIdRef.current;
        } else {
          shouldSkip = true;
        }
      } else if (selectedSpaceIdRef.current !== null && objSpaceId !== null) {
        shouldSkip = objSpaceId !== selectedSpaceIdRef.current;
      }

      if (shouldSkip) {
        rejectedAnnotations.push({ id: candidateId, reason: 'space-scope' });
        continue;
      }

      candidateAnnotationIds.push(candidateId);

      const isTouchingObject = eraserStrokeTouchesObject({
        eraserPoints,
        eraserRadius: currentEraserSize,
        object: obj,
      });

      const liveBitten = gestureBeforeJsonRef.current.has(obj);
      if (!isTouchingObject && !liveBitten) {
        rejectedAnnotations.push({ id: candidateId, reason: 'geometry-miss' });
        continue;
      }
      touchedAnnotationIds.push(candidateId);

      if (obj.type === 'path' && obj.path) {
        const isStrokePath =
          obj.tool === 'pen' ||
          obj.tool === 'highlighter' ||
          obj.pdfAnnotationType === 'Ink' ||
          (!obj.pdfAnnotationType && !obj.annotationId && !obj.moduleId);

        if (mode === 'entire' || !isStrokePath) {
          canvas.remove(obj);
          changed = true;
          continue;
        }

        // STROKED ink (pen/highlighter/imported Ink with strokeWidth > 0):
        // exact swept-capsule centerline splitting (src/utils/inkEraser.js).
        // The stroke STAYS a stroked multi-subpath path — no ribbon
        // conversion, ever. The live handler already applied every capsule
        // incrementally; re-running the FULL chain here is idempotent and
        // also covers flush paths that skipped a final segment.
        // LEGACY fill-ribbons (strokeWidth 0 + fill — output of the old
        // boolean eraser) keep the boolean path, with the eraser DENSIFIED
        // so fast drags can no longer bead/skip.
        const isLegacyRibbon = (obj.strokeWidth || 0) === 0 && !!obj.fill && obj.fill !== 'transparent';
        if (!isLegacyRibbon) {
          let capsuleChanged = gestureBeforeJsonRef.current.has(obj);
          try {
            const localCaps = [];
            let localREff = null;
            for (let pi = 0; pi + 1 < eraserPoints.length; pi += 1) {
              const { capsule, localRadius } = toLocalCapsuleFn(obj, eraserPoints[pi], eraserPoints[pi + 1], currentEraserSize);
              localCaps.push(capsule);
              if (localREff === null) localREff = localRadius + (obj.strokeWidth || 0) / 2;
            }
            if (localCaps.length && localREff !== null) {
              const res = erasePathWithCapsules(obj.path, localCaps, localREff);
              if (res.changed) {
                capsuleChanged = true;
                if (!res.pathData.length) {
                  canvas.remove(obj);
                  changed = true;
                  continue;
                }
                obj.path = res.pathData;
              }
            }
          } catch (err) {
            console.error('[FabricEraserCanvas] capsule erase failed at commit:', err);
          }
          if (!capsuleChanged) {
            // touched by the gate but nothing actually cut (rim graze past
            // rEff after inflation) — leave the stroke byte-identical.
            continue;
          }
          {
            const newPathData = obj.path;

            // Recalculate dimensions and offsets for the new path.
            // Imported pen strokes obey a different storage convention from
            // internal live-drawn strokes: left/top carry the world
            // placement and path data is in LOCAL coords starting at (0, 0).
            // After booleanErasePath the path's local min may have shifted,
            // so we translate the path back to (0, 0) and absorb the shift
            // into left/top. Internal strokes keep the legacy behavior
            // (setPositionByOrigin with new pathOffset) so untouched PAL
            // code paths remain identical.
            if (obj._calcDimensions) {
              const dims = obj._calcDimensions();
              if (obj.isPdfImported) {
                const shiftX = dims.left;
                const shiftY = dims.top;
                if (shiftX !== 0 || shiftY !== 0) {
                  const translated = newPathData.map((cmd) => {
                    const next = cmd.slice();
                    for (let j = 1; j + 1 < next.length; j += 2) {
                      if (typeof next[j] === 'number') next[j] -= shiftX;
                      if (typeof next[j + 1] === 'number') next[j + 1] -= shiftY;
                    }
                    return next;
                  });
                  obj.path = translated;
                }
                // pathOffset MUST equal the local-path geometric center for
                // Fabric's hit-test math to match world clicks to path data.
                // splitPathDataByEraser/booleanErasePath both compute
                // `localEraser = inverseMatrix(worldClick) + pathOffset` —
                // with pathOffset at (0, 0) the eraser lands off the stroke
                // after the first erase, producing the "second click
                // extends the previous gap instead of cutting where I
                // clicked" bug.
                obj.set({
                  width: dims.width,
                  height: dims.height,
                  pathOffset: { x: dims.width / 2, y: dims.height / 2 },
                  left: (obj.left || 0) + shiftX,
                  top: (obj.top || 0) + shiftY,
                });
                obj.setCoords();
              } else {
                const newPathOffsetX = dims.left + dims.width / 2;
                const newPathOffsetY = dims.top + dims.height / 2;
                obj.set({
                  width: dims.width,
                  height: dims.height,
                  pathOffset: { x: newPathOffsetX, y: newPathOffsetY },
                });
                // Use setPositionByOrigin to correctly position the erased path,
                // accounting for strokeWidth and scale (same as PencilBrush internals).
                const newPos = new fabric.Point(newPathOffsetX, newPathOffsetY);
                obj.setPositionByOrigin(newPos, 'center', 'center');
              }
            }

            obj.setCoords();
            obj.dirty = true;
            changed = true;
          }
          continue;
        }

        // Legacy ribbon: boolean cookie-cutter with a DENSIFIED eraser chain
        // (the old per-raw-point circles beaded/skipped on fast drags).
        const densePoints = sampleEraserStroke(eraserPoints, currentEraserSize);
        let result = booleanErasePath(obj, { points: densePoints }, currentEraserSize);
        if (result) {
          let newPathData = Array.isArray(result) ? result : result.pathData;
          if (Array.isArray(result) && result.length === 0) {
            canvas.remove(obj);
            changed = true;
            continue;
          }
          if (newPathData && newPathData.length > 0) {
            obj.path = newPathData;
            if (obj._calcDimensions) {
              const dims = obj._calcDimensions();
              const newPathOffsetX = dims.left + dims.width / 2;
              const newPathOffsetY = dims.top + dims.height / 2;
              obj.set({ width: dims.width, height: dims.height, pathOffset: { x: newPathOffsetX, y: newPathOffsetY } });
              const newPos = new fabric.Point(newPathOffsetX, newPathOffsetY);
              obj.setPositionByOrigin(newPos, 'center', 'center');
            }
            obj.setCoords();
            obj.dirty = true;
            changed = true;
          }
        }
      } else {
        // Non-path objects are erased only when the eraser stroke touches
        // their rendered geometry. Do not use expanded bounding boxes here:
        // they are the source of nearby-but-untouched deletes.
        canvas.remove(obj);
        changed = true;
      }
    }

    const unsupportedAnnotationObjects = Array.isArray(unsupportedAnnotationObjectsRef.current)
      ? unsupportedAnnotationObjectsRef.current
      : [];
    unsupportedAnnotationObjects.forEach((entry, index) => {
      beforeSerializedObjects.push({ ...entry.object });
    });

    // Strokes fully erased LIVE are gone from the canvas — their pre-gesture
    // snapshots must still enter the before-list so they count as deletions.
    // Appended AFTER the unsupported entries so both lists share the
    // [survivors, unsupported] positional prefix (index:N candidate ids of
    // every surviving entry align between before and after).
    for (const removedJson of gestureRemovedRef.current) {
      if (removedJson) {
        beforeSerializedObjects.push(removedJson);
        changed = true;
      }
    }
    let calloutHitIds = [];
    const calloutCallback = onEraseCalloutRef.current;
    if (calloutCallback) {
      try {
        const legacyCallouts = unsupportedAnnotationObjects
          .map((entry) => getLegacyCalloutPayload(entry.object, pageNumber))
          .filter(Boolean);
        calloutHitIds = getCalloutHitIds({
          callouts: [
            ...(Array.isArray(calloutsRef.current) ? calloutsRef.current : []),
            ...legacyCallouts,
          ],
          pageNumber,
          pageWidth,
          pageHeight,
          eraserPoints,
          eraserRadius: currentEraserSize,
        });
        const svgEl = document.querySelector(
          `[data-diag-svg-wrapper="${pageNumber}"] svg`
        );
        if (svgEl) {
          const groups = svgEl.querySelectorAll('[data-callout-id]');
          groups.forEach((g) => {
            const cid = g.getAttribute('data-callout-id');
            if (calloutHitIds.includes(cid)) return;
            try {
              const bbox = g.getBBox();
              const hit = eraserPoints.some(
                (p) =>
                  p.x >= bbox.x - currentEraserSize &&
                  p.x <= bbox.x + bbox.width + currentEraserSize &&
                  p.y >= bbox.y - currentEraserSize &&
                  p.y <= bbox.y + bbox.height + currentEraserSize
              );
              if (hit) calloutHitIds.push(cid);
            } catch (_) {}
          });
        }
      } catch (_) {
        calloutHitIds = [];
      }
    }
    const calloutHitIdSet = new Set(calloutHitIds);

    if (changed) {
      canvas.renderAll();
    }

    // Serialize the entire canvas and commit.
    // Normalize path left/top back to 0 for SVG renderer compatibility.
    // Canvas uses left=pathOffset for display, but SVG expects left=0 with
    // absolute path data (translate(0,0) is a no-op, path coords render directly).
    const canvasObjects = canvas.getObjects().filter((o) => !o.__isEraserTrail);
    const serializedObjects = canvasObjects.map((obj) => serializeObjectForCommit(obj));
    unsupportedAnnotationObjects.forEach((entry) => {
      const legacyCallout = getLegacyCalloutPayload(entry.object, pageNumber);
      if (legacyCallout?.id && calloutHitIdSet.has(legacyCallout.id)) return;
      serializedObjects.push({ ...entry.object });
    });
    const updatedJSON = { objects: serializedObjects };
    const deleteDiagnostics = getEraserDeleteDiagnostics({
      beforeObjects: beforeSerializedObjects,
      afterObjects: serializedObjects,
    });
    const afterById = new Map();
    serializedObjects.forEach((obj, index) => {
      const id = getEraserCandidateId(obj, index);
      if (id) afterById.set(id, obj);
    });
    const beforeById = new Map();
    beforeSerializedObjects.forEach((obj, index) => {
      const id = getEraserCandidateId(obj, index);
      if (id) beforeById.set(id, obj);
    });
    const deletedIdSet = new Set(deleteDiagnostics.finalDeletedAnnotationIds);
    const finalChangedAnnotationIds = touchedAnnotationIds.filter((id, index, list) => {
      if (!id || deletedIdSet.has(id) || list.indexOf(id) !== index) return false;
      const before = beforeById.get(id);
      const after = afterById.get(id);
      if (!before || !after) return false;
      try {
        return JSON.stringify(before) !== JSON.stringify(after);
      } catch (_) {
        return before !== after;
      }
    });
    const eraserDiagnostics = {
      source: 'eraser:commit',
      tool: 'eraser',
      action: 'eraser:apply',
      eraserGestureId: eraserDiagGestureRef.current || null,
      eraserPointerBounds: getEraserStrokeBounds(eraserPoints, currentEraserSize),
      candidateAnnotationIds,
      rejectedAnnotations,
      touchedAnnotationIds,
      finalDeletedAnnotationIds: deleteDiagnostics.finalDeletedAnnotationIds,
      finalChangedAnnotationIds,
      objectDelta: deleteDiagnostics.objectDelta,
      changedObjectsCount: deleteDiagnostics.changedObjectsCount,
    };
    try {
      console.log('[EraserHitTest] ' + JSON.stringify({
        pageNumber,
        gestureId: eraserDiagnostics.eraserGestureId,
        pointerBounds: eraserDiagnostics.eraserPointerBounds,
        candidateAnnotationIds,
        rejectedAnnotations,
        touchedAnnotationIds,
        finalDeletedAnnotationIds: eraserDiagnostics.finalDeletedAnnotationIds,
        finalChangedAnnotationIds: eraserDiagnostics.finalChangedAnnotationIds,
        objectDelta: eraserDiagnostics.objectDelta,
        changedObjectsCount: eraserDiagnostics.changedObjectsCount,
      }));
    } catch (_) {}
    // [InteractionDiag] ERASER outcome: did the swipe actually hit/remove
    // anything? candidates = annotations the stroke overlapped, deleted/changed
    // = what the geometry eraser actually committed. candidates>0 but
    // deleted+changed===0 means the eraser saw targets but removed nothing
    // (the "eraser misbehaves" symptom). rejected = blocked by the per-user
    // delete-authority gate.
    try {
      const deletedN = eraserDiagnostics.finalDeletedAnnotationIds.length;
      const changedN = eraserDiagnostics.finalChangedAnnotationIds.length;
      const candN = candidateAnnotationIds.length;
      const rejN = rejectedAnnotations.length;
      const calloutN = calloutHitIds.length;
      const willCommit = deletedN > 0 || changedN > 0;
      console.log(`[InteractionDiag] eraser-apply @ ${Math.round(performance.now())}ms page=${pageNumber} mode=${mode} candidates=${candN} deleted=${deletedN} changed=${changedN} callouts=${calloutN} rejected=${rejN} ${willCommit ? 'COMMIT' : (candN > 0 || calloutN > 0 ? 'NO-OP (had targets, removed nothing)' : 'NO-OP (empty space)')}`);
    } catch (_e) { /* swallow */ }
    let didCommit = false;
    if (
      eraserDiagnostics.finalDeletedAnnotationIds.length > 0
      || eraserDiagnostics.finalChangedAnnotationIds.length > 0
    ) {
      // Refresh each object's __sourceIndex to its position in the committed
      // array so SVG-twin index addressing stays valid for the NEXT gesture's
      // live preview (repeat bites showed only at release without this).
      canvasObjects.forEach((o, i) => { o.__sourceIndex = i; });
      onEraseCommitRef.current(updatedJSON, eraserDiagnostics);
      didCommit = true;
    }

    if (calloutCallback && calloutHitIds.length > 0) {
      try {
        calloutCallback(calloutHitIds);
      } catch (_) {}
    }

    const textMarkupCallback = onEraseTextMarkupRef.current;
    if (textMarkupCallback) {
      try {
        textMarkupCallback(pageNumber, eraserPoints, currentEraserSize);
      } catch (_) {}
    }
    return didCommit;
  }).current;

  // Pre-dispose callback: flush in-progress erase gesture before canvas.off()/dispose()
  const onBeforeDisposeRef = useRef((canvas) => {
    if (isErasingRef.current) {
      isErasingRef.current = false;
      try {
        clearErasePreview(canvas);
        if (!needsReloadRef.current) {
          applyEraserAndCommit(canvas);
        } else {
          console.warn('[FabricEraserCanvas] dispose gesture dropped: external annotations change mid-gesture');
        }
      } catch (err) {
        console.error('Pre-unmount eraser flush error:', err);
      }
      eraserPathRef.current = [];
    }
    // sync: no SVG node may stay hidden/ghosted after this canvas dies.
    restorePreview(canvas, { committed: true, sync: true });
    mountedRef.current = false;
  });

  // ---------------------------------------------------------------------------
  // Canvas lifecycle (useFabricCanvas hook)
  // ---------------------------------------------------------------------------
  const { fabricRef } = useFabricCanvas({
    canvasElRef,
    onBeforeDisposeRef,
    options: {
      backgroundColor: 'transparent',
      isDrawingMode: false,
      selection: false,
      enableRetinaScaling: true,
      stopContextMenu: true,
      skipTargetFind: true,
    },
  });

  // ---------------------------------------------------------------------------
  // Canvas initialization: sizing, cursors, annotation loading, eraser events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !containerRef.current) return;

    // Container-aware sizing (CLAUDE.md rule)
    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth > 0 && pageWidth > 0) {
      const effectiveScale = containerWidth / pageWidth;
      effectiveScaleRef.current = effectiveScale;
      canvas.setZoom(effectiveScale);
      canvas.setWidth(Math.floor(pageWidth * effectiveScale));
      canvas.setHeight(Math.floor(pageHeight * effectiveScale));
    }

    // Cursors: 'none' so the existing App.jsx eraser circle overlay provides the visual cursor
    canvas.defaultCursor = 'none';
    canvas.hoverCursor = 'none';
    canvas.moveCursor = 'none';

    // -----------------------------------------------------------------------
    // Load annotations via enlivenObjects. Wrapped in a function so the
    // annotations-change effect can RELOAD after an external change (undo,
    // collab) — a stale canvas would hit-test and commit pre-undo state.
    // -----------------------------------------------------------------------
    const loadAnnotations = () => {
    const loadGen = ++loadGenRef.current;
    // Reset any prior canvas + gesture state (reload path).
    try { canvas.getObjects().slice().forEach((o) => canvas.remove(o)); } catch (_) { /* fresh mount */ }
    gestureBeforeJsonRef.current = new Map();
    gestureRemovedRef.current = [];
    setIsLoading(true);
    isLoadingRef.current = true;
    const annotationsToLoad = annotationsRef.current;
    // __sourceIndex positional addressing is anchored to THIS object.
    enlivenSourceRef.current = annotationsToLoad;
    const objectsArray = annotationsToLoad?.objects || [];
    const enlivenableEntries = [];
    const unsupportedEntries = [];
    objectsArray.forEach((object, originalIndex) => {
      if (isFabricEnlivenableObject(object)) {
        enlivenableEntries.push({ object, originalIndex });
      } else {
        unsupportedEntries.push({ object, originalIndex });
      }
    });
    unsupportedAnnotationObjectsRef.current = unsupportedEntries;

    // Diagnostics: snapshot what goes into enlivenObjects so we can compare
    // against what comes out. Any type mismatch / silent drop will show up here.
    const inputTypeHistogram = {};
    const inputDetail = objectsArray.map((o, i) => {
      const t = o?.type || 'null';
      inputTypeHistogram[t] = (inputTypeHistogram[t] || 0) + 1;
      return {
        index: i,
        type: t,
        dataType: o?.data?.type || null,
        isPdfImported: !!o?.isPdfImported,
        hasPath: Array.isArray(o?.path) && o.path.length > 0,
        hasObjects: Array.isArray(o?.objects) && o.objects.length > 0,
        visible: o?.visible !== false,
        layer: o?.layer || 'native',
        spaceId: o?.spaceId ?? null,
        moduleId: o?.moduleId ?? null,
        regionId: o?.regionId ?? null,
      };
    });

    if (enlivenableEntries.length > 0) {
      // fabric 7: Group.fromObject spreads unrecognized props onto the new
      // instance, so the projected callout's `getObjects()` convenience method
      // (calloutAnnotationBridge / calloutEditAdapter) SHADOWS the real
      // Group#getObjects — groupInit then reads undefined and throws, and
      // allSettled silently drops the whole callout group. Strip it here;
      // entry.object keeps the original for metadata pairing below.
      const enlivenableObjects = enlivenableEntries.map((entry) => {
        if (typeof entry.object?.getObjects === 'function') {
          const { getObjects: _getObjects, ...rest } = entry.object;
          return rest;
        }
        return entry.object;
      });
      // fabric 7: enlivenObjects uses Promise.allSettled and silently COMPACTS
      // rejected objects out of the resolved array — which both hides the
      // failure and shifts every later object off its enlivenableEntries[index]
      // pairing. The reviver runs once per input in order, so build an
      // index-aligned array (null = rejected) and log what fabric swallowed.
      const alignedEnlivenedObjects = [];
      const enlivenReviver = (serialized, instance, error) => {
        if (error) {
          console.error(
            `[FabricEraserCanvas p${pageNumber}] enliven rejected type=${serialized?.type || 'null'} dataType=${serialized?.data?.type || 'null'}:`,
            error
          );
          alignedEnlivenedObjects.push(null);
          return;
        }
        alignedEnlivenedObjects.push(instance);
      };
      fabric.util.enlivenObjects(enlivenableObjects, () => {
        // Guard: component unmounted OR a newer reload superseded this one —
        // a stale enliven must never dump old objects onto the new canvas.
        if (!mountedRef.current || loadGen !== loadGenRef.current) return;
        const enlivenedObjects = alignedEnlivenedObjects;

        // Diagnostics: compare input vs enlivened. Any array-length mismatch
        // or null slots means enlivenObjects silently dropped something.
        if (typeof window !== 'undefined') {
          const outputTypeHistogram = {};
          const nullIndexes = [];
          enlivenedObjects.forEach((o, i) => {
            if (!o) {
              nullIndexes.push(i);
              return;
            }
            const t = o.type || 'null';
            outputTypeHistogram[t] = (outputTypeHistogram[t] || 0) + 1;
          });
          if (!window.__diagEraserStats) window.__diagEraserStats = {};
          window.__diagEraserStats[pageNumber] = {
            inputCount: objectsArray.length,
            enlivenableCount: enlivenableEntries.length,
            unsupportedCount: unsupportedEntries.length,
            unsupportedInputDetail: unsupportedEntries.map((entry) => ({
              index: entry.originalIndex,
              keys: Object.keys(entry.object || {}),
              calloutId: entry.object?.callout?.id || null,
              type: entry.object?.type || null,
              dataType: entry.object?.data?.type || null,
            })),
            enlivenedCount: enlivenedObjects.length,
            nullIndexes,
            inputTypeHistogram,
            outputTypeHistogram,
            inputDetail,
          };
          console.log(
            `[FabricEraserCanvas p${pageNumber}] enliven — input=${objectsArray.length} enlivenable=${enlivenableEntries.length} unsupported=${unsupportedEntries.length} output=${enlivenedObjects.length} nulls=${nullIndexes.length} types=${JSON.stringify(inputTypeHistogram)}→${JSON.stringify(outputTypeHistogram)}`
          );
        }

        enlivenedObjects.forEach((obj, index) => {
          if (!obj) return;
          const objData = enlivenableEntries[index]?.object;
          if (!objData) return;

          // Source-array index — the SVG layer stamps the same index as
          // data-annotation-index, which is the live-preview's addressing
          // fallback for objects without a top-level id (pen strokes).
          obj.__sourceIndex = enlivenableEntries[index]?.originalIndex;

          obj.set({
            strokeUniform: true,
            selectable: false,
            evented: false,
          });

          // Copy metadata
          if (objData.spaceId) obj.spaceId = objData.spaceId;
          if (objData.moduleId) obj.moduleId = objData.moduleId;
          if (objData.regionId) obj.regionId = objData.regionId;
          if (objData.layer) obj.layer = objData.layer;
          if (objData.annotationId) obj.annotationId = objData.annotationId;
          if (objData.needsEntity) obj.needsEntity = objData.needsEntity;
          if (objData.data) obj.data = objData.data;
          if (objData.name) obj.name = objData.name;
          if (objData.isPdfImported) obj.isPdfImported = objData.isPdfImported;
          if (objData.pdfAnnotationId) obj.pdfAnnotationId = objData.pdfAnnotationId;
          if (objData.pdfAnnotationType) obj.pdfAnnotationType = objData.pdfAnnotationType;
          if (objData.globalCompositeOperation) {
            obj.set({ globalCompositeOperation: objData.globalCompositeOperation });
          }

          // Enforce multiply blend mode for surveyMarkers
          if (obj.annotationId || obj.needsEntity) {
            obj.set({ globalCompositeOperation: 'multiply' });
          }

          // PDF-imported shape visual parity with the selector-mode SVG render.
          // UX: imported annotations (circle, polygon, line, polyline, path,
          // ellipse, rect, textbox) must look identical in eraser and
          // selector mode. The SVG layer (selector mode) renders each shape
          // via the browser's SVG rasterizer; Fabric.js renders via Canvas2D
          // which anti-aliases sub-pixel coordinates differently — see
          // CLAUDE.md 2026-04-10 rasterizer-mismatch gotcha: Canvas 2D and
          // SVG produce visibly different strokes at non-integer positions
          // and this is NOT fixable in JS. For textboxes, the same applies
          // to glyph rendering (CLAUDE.md 2026-04-08 + 2026-04-10): SVG
          // uses <foreignObject><div> with browser CSS text layout, Fabric
          // measures at CACHE_FONT_SIZE=400 and scales down (fabric.js
          // 26261, 30731-30745).
          //
          // Structural fix (Phase 2 extension of the 2026-04-10 gotcha
          // resolution): keep the Fabric object as an invisible hit zone
          // (opacity: 0) and let the SVG <g> underneath be the single
          // visible truth in eraser mode. The App.jsx SVG wrapper stays
          // visible in eraser mode and SVGAnnotationLayer renders every
          // imported annotation (not just textboxes). Two side effects:
          //   1. Pixel-perfect visual parity on tool switch (no rasterizer
          //      delta, no ~0.16px edge shift).
          //   2. Eraser-mode zoom becomes as smooth as selector-mode zoom:
          //      the user visually sees the SVG viewBox (GPU-composited,
          //      free) and the Fabric canvas's choppy ResizeObserver redraw
          //      happens invisibly behind opacity: 0.
          //
          // Textbox-specific width/height forcing: Fabric Textbox auto-wraps
          // and recalculates width from text content. Fabric's hit-test
          // uses obj.width/obj.height — getting those wrong misaligns the
          // erase target rectangle. __skipDimension + stored-dim forcing
          // preserves the stored bounds.
          //
          // CRITICAL: the opacity/stroke override must NEVER persist to
          // stored annotation state. Fabric's default toJSON serializes
          // opacity, stroke, and strokeWidth — so we stash the originals on
          // __orig* here and restore them in the serialize path inside
          // applyEraserAndCommit so each erase commit emits the real values,
          // not our invisible override.
          // UX 2026-04-25 — Stash originals on every object (imported or
          // internally-drawn) so the opacity:0 invisible-overlay treatment
          // can extend to every annotation in eraser mode. Without this,
          // internally-drawn marks (counter pins, rectangles, ellipses,
          // text) render visibly on the Fabric eraser canvas while ALSO
          // rendering visibly on the SVG layer below — producing the
          // "doubled / thicker / counter numbers missing" eraser appearance.
          // Originals are restored in the serialize path so the override
          // never persists to stored annotation state.
          obj.__origOpacity = obj.opacity;
          obj.__origStroke = obj.stroke;
          obj.__origStrokeWidth = obj.strokeWidth;

          // UX 2026-04-25 — Textboxes (imported AND internally-drawn) get
          // their original JSON stashed so the serialize path can return
          // it verbatim, bypassing Fabric's toJSON which would write back
          // the auto-laid-out width/height. Without this, the eraser
          // commit persists Fabric's recalculated dimensions to storage,
          // making the textbox visibly shrink (vertically) the first time
          // the user clicks the eraser and never recover. Textboxes are
          // never partially erased — they are kept whole or removed
          // entirely (see the for-loop above) — so the stored JSON is
          // always the correct serialization for kept textboxes.
          if (obj.type === 'textbox') {
            obj.__importedJSON = { ...objData };
          }

          if (objData.isPdfImported) {

            // SERIALIZE BYPASS for imported textboxes: Fabric 5.5.2 has a
            // toJSON bug on PDF-imported Textboxes — serialization throws
            // "Cannot read properties of undefined (reading '0')" inside
            // Text.toObject's styles/textLines path. Root cause is a
            // mismatch between the PDF-sourced `styles` object line-indexing
            // and Fabric's post-initDimensions _textLines array after
            // word-wrap at the stored width. The crash aborts the erase
            // commit for the ENTIRE canvas: click polygon → polygon gets
            // removed from Fabric but serialize throws on the still-present
            // textbox → onEraseCommit never fires → SVG never updates.
            // Workaround: for imported textboxes we never mutate the object
            // on the erase canvas (non-path types are either kept or removed
            // whole — see the for-loop above), so we can safely stash the
            // original import JSON here and short-circuit the serialize loop
            // below to return it directly, skipping the crashing toJSON()
            // call. For non-textbox imported shapes toJSON works fine, so
            // we only stash for textbox.
            if (obj.type === 'textbox') {
              obj.__importedJSON = objData;
            }

            // UX: Textboxes also drop stroke/strokeWidth — belt-and-braces
            // against the PDF-import default red border (if opacity ever
            // flips back to visible accidentally we still don't want that
            // border visible). Other imported types keep their stored
            // stroke because Fabric's erase hit-test uses
            // getBoundingRect(true) which inflates bounds by stroke bleed;
            // zeroing it would shrink the erase target slightly, and the
            // bounds contribute to applyEraserAndCommit's touch-test.
            if (obj.type === 'textbox') {
              obj.set({ stroke: null, strokeWidth: 0, opacity: 0 });
            } else {
              obj.set({ opacity: 0 });
            }
            obj.setCoords();

            // 2026-05-03 — Per-object override log silenced. UX: on heavy
            // pages (12k+ imported strokes) this single console.log fired
            // once per object on every eraser-tool mount, dominating the
            // mount cost (4,900 lines on the heavy page = several seconds
            // of pure logging in dev tools). Re-enable per session via
            // window.__DIAG_ERASER_OVERRIDE = true.
            if (typeof window !== 'undefined' && window.__DIAG_ERASER_OVERRIDE) {
              const label =
                obj.type === 'textbox'
                  ? `text="${(objData.text || '').slice(0, 20)}"`
                  : `type=${obj.type}`;
              console.log(
                `[FabricEraserCanvas p${pageNumber}] imported-override idx=${index} ${label} → hit-zone only, SVG renders visual`
              );
            }
          } else {
            // UX 2026-04-25 — Internally-drawn marks (counter pins,
            // rectangles, ellipses, text, etc.) also become invisible
            // hit zones in eraser mode. Stroke/strokeWidth are left
            // untouched for non-imported types because the SVG layer
            // below renders them verbatim from the stored JSON, and
            // restoring stroke at serialize time matches the imported
            // path. The result: SVG below is the single visual truth
            // in eraser mode for every annotation, no rasterizer
            // doubling, no missing counter numbers.
            obj.set({ opacity: 0 });
            obj.setCoords();
          }

          canvas.add(obj);

          // Fix coordinate space for Canvas rendering.
          // INTERNAL live-drawn pen strokes are stored with left=0, top=0 and
          // path data in absolute page-space — Fabric needs setPositionByOrigin
          // (same method PencilBrush uses internally, accounts for strokeWidth,
          // scale, and skew) to place the obj correctly for hit-testing.
          // IMPORTED pen strokes use the opposite convention: left/top carry
          // the world placement (worldMinX/Y) and path data is in LOCAL coords
          // starting at (0, 0). Applying setPositionByOrigin to imported paths
          // would re-anchor their center to ~(width/2, height/2) in world
          // coords — i.e. the top-left of the page — which is exactly the
          // "snap-to-corner on first eraser click" bug. Skip for imported.
          if (obj.type === 'path' && obj.pathOffset && !obj.isPdfImported) {
            const pos = new fabric.Point(obj.pathOffset.x, obj.pathOffset.y);
            obj.setPositionByOrigin(pos, 'center', 'center');
            obj.setCoords();
          }
        });

        canvas.renderAll();

        // CRITICAL: update both state and ref simultaneously so the mouse:down
        // handler (bound in this useEffect) reads the current value via the ref.
        setIsLoading(false);
        isLoadingRef.current = false;
      }, { reviver: enlivenReviver });
    } else {
      // No annotations to load -- immediately ready
      canvas.renderAll();
      setIsLoading(false);
      isLoadingRef.current = false;
    }
    };
    loadAnnotationsRef.current = loadAnnotations;
    loadAnnotations();

    // -----------------------------------------------------------------------
    // Eraser gesture handling: mouse:down, mouse:move, mouse:up
    // -----------------------------------------------------------------------

    // mouse:down
    canvas.on('mouse:down', (opt) => {
      // MUST check the ref, NOT the state variable, because this handler is
      // bound in useEffect([]) and the state value would be stale (always true).
      if (isLoadingRef.current) {
        // [InteractionDiag] erase attempt arrived while the eraser canvas is
        // still loading/hydrating — swallowed. Contributes to the "dead first
        // few seconds" + "eraser misbehaves" reports.
        try { console.log(`[InteractionDiag] eraser-down-blocked @ ${Math.round(performance.now())}ms page=${pageNumber} (eraser canvas still loading, mouse:down ignored)`); } catch (_e) { /* swallow */ }
        return;
      }

      // [InteractionDiag] erase gesture START (mouse:down on the eraser canvas).
      try { console.log(`[InteractionDiag] eraser-down @ ${Math.round(performance.now())}ms page=${pageNumber} mode=${eraserModeRef.current}`); } catch (_e) { /* swallow */ }

      // Known-stale canvas (deferred external change): reload instead of
      // starting a gesture that would hit-test and commit stale state.
      if (needsReloadRef.current && loadAnnotationsRef.current) {
        needsReloadRef.current = false;
        try { loadAnnotationsRef.current(); } catch (err) { console.error('Eraser canvas reload failed:', err); }
        return;
      }
      isErasingRef.current = true;
      gestureBeforeJsonRef.current = new Map();
      gestureRemovedRef.current = [];
      gestureBBoxCacheRef.current = new Map();
      // Safety: a leaked preview from an interrupted gesture must never
      // bleed into this one; begin also flushes any pending deferred restore.
      clearErasePreview(canvas);
      beginGesturePreview(canvas);
      eraserDiagGestureRef.current = beginAnnotationGesture({
        surface: 'FabricEraserCanvas',
        tool: 'eraser',
        type: 'annotation',
        action: 'eraser-stroke',
        pointerDown: true,
        pageNumber,
      });
      const pointer = canvas.getPointer(opt.e);
      eraserPathRef.current = [['M', pointer.x, pointer.y]];
    });

    // Shared gesture finisher: tears the preview down BEFORE computing the
    // durable result (the trail must not be serialized), commits, THEN swaps
    // visual authority back to the SVG layer. finally: a commit throw must
    // NEVER leave the SVG hidden. Idempotent via isErasingRef.
    const finishGesture = () => {
      if (!isErasingRef.current) return;
      isErasingRef.current = false;
      markAnnotationPointerRelease(eraserDiagGestureRef.current, {
        action: 'eraser-stroke',
      });
      clearErasePreview(canvas);
      let committed = false;
      // C-1: an external annotations change landed mid-gesture — this canvas
      // is stale; committing it would overwrite/resurrect the external edit.
      // Drop the gesture (the external edit wins) and reload below.
      const staleCanvas = needsReloadRef.current;
      try {
        if (!staleCanvas) {
          committed = applyEraserAndCommit(canvas) === true;
        } else {
          console.warn('[FabricEraserCanvas] gesture dropped: external annotations change mid-gesture');
        }
      } catch (err) {
        console.error('Eraser commit error:', err);
      } finally {
        restorePreview(canvas, { committed });
        eraserPathRef.current = [];
        gestureBeforeJsonRef.current = new Map();
        gestureRemovedRef.current = [];
        if (needsReloadRef.current && loadAnnotationsRef.current) {
          needsReloadRef.current = false;
          try { loadAnnotationsRef.current(); } catch (err2) { console.error('Eraser canvas reload failed:', err2); }
        }
      }
    };
    finishGestureRef.current = finishGesture;

    // mouse:move
    canvas.on('mouse:move', (opt) => {
      if (!isErasingRef.current) return;
      // Missed mouse:up (released outside the window, alt-tab, OS interrupt):
      // the first hover move with NO buttons down finishes the gesture instead
      // of ghost-erasing under a bare cursor forever.
      if (opt.e && typeof opt.e.buttons === 'number' && opt.e.buttons === 0) {
        finishGesture();
        return;
      }
      markAnnotationPreviewFrame(eraserDiagGestureRef.current, {
        action: 'eraser-stroke',
      });
      const pointer = canvas.getPointer(opt.e);
      eraserPathRef.current.push(['L', pointer.x, pointer.y]);
      // LIVE erase: really bite the newest capsule out of eligible strokes —
      // the drag shows the exact committed result as it happens.
      applyLiveInkErase(canvas);
      // Whole-object targets ghost in place on the SVG layer.
      updateErasePreview(canvas);
    });

    // mouse:up
    canvas.on('mouse:up', () => {
      finishGesture();
    });

    // Pre-unmount flush is handled by onBeforeDisposeRef (runs before canvas.off()).
    // No cleanup needed here.
  }, []); // Mount only

  // ---------------------------------------------------------------------------
  // Sync refs to avoid stale closures
  // ---------------------------------------------------------------------------
  useEffect(() => {
    annotationsRef.current = annotations;
    // Data-driven stroke swap-back: the SVG has re-rendered with the
    // committed (post-erase) data — safe to hand the visuals back.
    if (pendingRestoreRef.current && gestureSwapTokenRef.current === pendingRestoreRef.current.token) {
      const pending = pendingRestoreRef.current;
      pendingRestoreRef.current = null;
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
      try { pending.run(); } catch (_) { /* never throw in an effect */ }
    }
    // EXTERNAL annotations change (undo, collab, another tool's commit):
    // reload the canvas or every later hit-test/commit runs against stale
    // objects — the "eraser dead after undo" / resurrect-on-commit bug.
    // Our OWN commit's echo is recognized by CONTENT EQUIVALENCE with the
    // live canvas (id + path-command-count + first-coordinate per entry) —
    // an undo restoring the SAME ids with DIFFERENT geometry does not match
    // and correctly reloads. False-skip requires a full scalar-fingerprint
    // collision (negligible, and bounded: canvas ≈ store by fingerprint).
    if (annotations !== enlivenSourceRef.current && loadAnnotationsRef.current) {
      // Type-aware scalar fingerprint, computed IDENTICALLY from a stored
      // JSON entry and from a live canvas object:
      //  - paths: command count + first/mid/last rounded coords (+ world
      //    left/top for imported paths — internal paths serialize left/top
      //    as 0 while live objects hold pathOffset-anchored values, so
      //    left/top is only comparable for the imported convention);
      //  - everything else: type + left/top/width/height/angle/strokeWidth.
      // Undo restoring same ids with different geometry mismatches on the
      // coordinate scalars; same-id shape moves mismatch on left/top.
      const entryPrint = (o, i) => {
        const id = o?.data?.id || o?.id || `@${i}`;
        const type = String(o?.type || '').toLowerCase();
        const r = (v) => Math.round(Number(v) || 0);
        const paint = `${o?.stroke || ''}~${o?.fill || ''}`;
        if (type === 'path' && Array.isArray(o?.path) && o.path.length) {
          const pathArr = o.path;
          const coord = (cmd) => cmd ? `${r(cmd[cmd.length - 2])},${r(cmd[cmd.length - 1])}` : '-';
          const base = `${id}:P${pathArr.length}:${coord(pathArr[0])}:${coord(pathArr[pathArr.length >> 1])}:${coord(pathArr[pathArr.length - 1])}:${r(o.strokeWidth)}:${paint}`;
          return o?.isPdfImported ? `${base}:${r(o.left)}:${r(o.top)}` : base;
        }
        return `${id}:${type}:${r(o?.left)}:${r(o?.top)}:${r(o?.width)}:${r(o?.height)}:${r(o?.angle)}:${r(o?.strokeWidth)}:${paint}`;
      };
      const annotationsPrint = (() => {
        const objs = annotations?.objects;
        if (!Array.isArray(objs)) return null;
        return objs.map((o, i) => entryPrint(o, i)).join('|');
      })();
      const canvasPrint = (() => {
        const canvas = fabricRef.current;
        if (!canvas) return undefined;
        try {
          const live = canvas.getObjects()
            .filter((o) => !o.__isEraserTrail)
            .map((o, i) => entryPrint(o, i));
          const liveCount = live.length;
          const unsupported = (unsupportedAnnotationObjectsRef.current || [])
            .map((entry, i) => entryPrint(entry?.object, liveCount + i));
          // Unsupported (callout) entries live at the END of committed
          // arrays; before any commit an external change mismatches anyway.
          return live.concat(unsupported).join('|');
        } catch (_) { return undefined; }
      })();
      const isOwnEcho = annotationsPrint !== null
        && canvasPrint !== undefined
        && annotationsPrint === canvasPrint;
      if (isOwnEcho) {
        enlivenSourceRef.current = annotations; // canvas already IS this content
      } else if (isErasingRef.current) {
        needsReloadRef.current = true; // defer: never yank objects mid-gesture
      } else {
        try { loadAnnotationsRef.current(); } catch (err) { console.error('Eraser canvas reload failed:', err); }
      }
    }
  }, [annotations]);

  useEffect(() => {
    calloutsRef.current = callouts;
  }, [callouts]);

  // Diagnostics: expose this canvas by pageNumber so App.jsx's tool-switch
  // snapshot can dump per-object Fabric state (bounds, strokes, text fields)
  // for side-by-side compare against the SVG selector render. See handleSaveOverlayLagLog.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.__fabricEraserCanvases) window.__fabricEraserCanvases = new Map();
    window.__fabricEraserCanvases.set(pageNumber, fabricRef);
    return () => {
      if (window.__fabricEraserCanvases) {
        window.__fabricEraserCanvases.delete(pageNumber);
      }
    };
  }, [pageNumber, fabricRef]);

  useEffect(() => {
    onEraseCommitRef.current = onEraseCommit;
  }, [onEraseCommit]);

  useEffect(() => {
    onEraseCalloutRef.current = onEraseCallout;
  }, [onEraseCallout]);

  useEffect(() => {
    onEraseTextMarkupRef.current = onEraseTextMarkup;
  }, [onEraseTextMarkup]);

  useEffect(() => {
    eraserModeRef.current = eraserMode;
  }, [eraserMode]);

  useEffect(() => {
    eraserSizeRef.current = eraserSize;
  }, [eraserSize]);

  useEffect(() => {
    viewerScaleRef.current = viewerScale;
  }, [viewerScale]);

  useEffect(() => {
    selectedSpaceIdRef.current = selectedSpaceId;
  }, [selectedSpaceId]);

  useEffect(() => {
    activeSpaceIdRef.current = activeSpaceId;
  }, [activeSpaceId]);

  useEffect(() => {
    spacesRef.current = spaces;
  }, [spaces]);

  // Phase 35 Plan 03 — sync gate refs.
  useEffect(() => { viewerIdRef.current = viewerId; }, [viewerId]);
  useEffect(() => { documentOwnerIdRef.current = documentOwnerId; }, [documentOwnerId]);

  // ---------------------------------------------------------------------------
  // Container-aware resize: keep Canvas sized to container after zoom changes.
  // Without this, the Canvas stays at its initial dimensions when zooming,
  // causing annotations to shift relative to the SVG/page (same pattern as
  // FabricDrawingCanvas).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = fabricRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      const containerWidth = container.offsetWidth;
      if (containerWidth > 0 && pageWidth > 0) {
        const effectiveScale = containerWidth / pageWidth;
        effectiveScaleRef.current = effectiveScale;
        canvas.setZoom(effectiveScale);
        canvas.setWidth(Math.floor(pageWidth * effectiveScale));
        canvas.setHeight(Math.floor(pageHeight * effectiveScale));
        canvas.renderAll();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [pageWidth, pageHeight]);

  // ---------------------------------------------------------------------------
  // Zoom-triggered flush: force-complete in-progress erase gesture on zoom start
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Skip on first render
    if (zoomGeneration === initialZoomGenRef.current) return;

    const canvas = fabricRef.current;
    if (canvas && isErasingRef.current) {
      isErasingRef.current = false;
      try {
        clearErasePreview(canvas);
        if (!needsReloadRef.current) {
          applyEraserAndCommit(canvas);
        } else {
          console.warn('[FabricEraserCanvas] zoom-flush gesture dropped: external annotations change mid-gesture');
        }
      } catch (err) {
        console.error('Zoom-triggered eraser flush error:', err);
      } finally {
        // sync: the container is mid-resize; leave no async restore pending
        // that a fast unmount could orphan.
        restorePreview(canvas, { committed: true, sync: true });
        eraserPathRef.current = [];
        if (needsReloadRef.current && loadAnnotationsRef.current) {
          needsReloadRef.current = false;
          try { loadAnnotationsRef.current(); } catch (err2) { console.error('Eraser canvas reload failed:', err2); }
        }
      }
    }
  }, [zoomGeneration]);

  // Safety net (window blur / OS interruption mid-drag): finish the gesture —
  // commit what was erased and restore visual authority to the SVG layer.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onBlur = () => {
      try { finishGestureRef.current?.(); } catch (_) { /* never throw from a listener */ }
    };
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      // No deferred restore may outlive the component: a surviving timer
      // would mutate a REMOUNTED page's SVG nodes.
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
      pendingRestoreRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      data-diag-eraser-wrapper={pageNumber}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'auto',
        zIndex: 101,
        cursor: isLoading ? 'wait' : 'none',
      }}
    >
      <canvas ref={canvasElRef} />
    </div>
  );
});

FabricEraserCanvas.displayName = 'FabricEraserCanvas';

export default FabricEraserCanvas;
