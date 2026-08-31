/**
 * useSVGInteraction
 *
 * Custom hook that manages SVG annotation selection state and returns
 * pointer event handlers for SVGAnnotationLayer.
 *
 * Phase 9 Plan 01: Click-to-select, hover feedback, deselect-on-empty-space.
 * Phase 9 Plan 02: Drag-to-move, resize-by-handle, rotation.
 * Phase 9 Plan 03: Multi-select group ops (group-move, group-delete), double-click edit trigger.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { screenToSVG, normalizeAngle, getInverseScale, constrainToPage, snapAngleToNearest45, clampInverseScale } from '../utils/svgTransformMath';
import { getAnnotationBBox, getGroupBBox, getLineEndpoints, computeLineBboxCenter, isImportedPath, isAbsoluteCoordPath } from '../utils/svgBoundingBox';
import {
  applyPageAffineToInkObject,
  commitInkObjectMove,
  commitInkObjectResize,
  getExactInkResizeDimension,
  isAbsoluteInkGeometry,
  isCenterOriginInkGeometry,
  scaleInRotatedFrameAroundMatrix,
} from '../utils/inkGeometryTransform.js';
import { deepClone } from '../utils/deepClone.js';
// Phase 15 LINE-01/02/03 + ARROW-01/02/03 — midpoint drag mode + endpoint
// auto-revert on collinear geometry. Pure-math from lineGeometry, drag
// helpers from lineDragMath (unit-tested in tests/lineDragMath.test.mjs).
import { shouldSnapToLinear, getMidpoint } from '../utils/lineGeometry.js';
// UX: 2026-04-20 — Group / Ungroup. Auto-expand-on-click reads each clicked
// annotation's / callout's groupId and, if present, expands selection to
// every member of that group on the page. Same helper module powers App's
// Group / Ungroup actions; storage model documented at the top of the file.
import { getAnnotationGroupId, getCalloutGroupId, findGroupMembers } from '../utils/annotationGroups.js';
import { shouldRevertEndpointCurve, applyMidpointToAnnotation, clearMidpointFromAnnotation } from '../utils/lineDragMath.js';
// Phase 19 — AutoCAD Window + Crossing marquee selection.
// Pure math lives in marqueeSelection.js (unit-tested in
// tests/marqueeSelection.test.mjs). This hook owns the React state,
// pointer wiring, and Escape cancel plumbing.
import {
  MIN_DRAG_PX as MARQUEE_MIN_DRAG_PX,
  getMarqueeDirection,
  getMarqueeRect,
  resolveMarqueeHits,
  filterMarqueeHits,
} from '../utils/marqueeSelection.js';
import {
  getLassoPolygonValidation,
  getLassoModeFromTrail,
  getLassoPointerSamples,
  cycleLassoMode,
  LASSO_SIMPLIFY_PX,
  resolveLassoHits,
  shouldSampleLassoPoint,
  simplifyLassoPoints,
} from '../utils/lassoSelection.js';
import { showToast } from '../utils/toast.js';
// Phase 35 Plan 03 — click hit-test gate, updated 2026-07-17 for the LOCKED
// permissions model (contributors AND owners have full add/edit/delete on
// everything; viewers look-only). Selection now gates on canDelete (any
// authenticated write-capable session may select ANY annotation — the viewer
// role wall is ReadOnlyGate: body[data-readonly] CSS kills pointer events on
// this layer's SVG root and a capture-phase keydown listener swallows
// Delete/Backspace, so viewers never reach these handlers). canModify is
// retained for the DELETE-time partition: own deletes may direct-fire, but
// cross-author deletes must ALWAYS route through the bulk-delete planner so
// the collaborator-cross-author confirm modal fires (matches the callout
// precedent landed in 9d8df592).
import { canDelete, canModify } from '../lib/collab/permissionScope.js';
// Phase 15 UAT-3 Issue 3 (2026-04-17) — distance rules for callout-part drag.
// Values match combined-tools FabricPDFCanvas collision logic (reference at
// ~/Desktop/combined-tools/src/lib/calloutGeometry.ts). See isCalloutDragSafe
// helper below for rule set + rationale.
import { calculateCalloutConnection } from '../utils/calloutGeometry.js';
import { HANDLE_RADIUS } from '../utils/handleStyle.js';
import {
  beginAnnotationGesture,
  isAnnotationPreviewDiagEnabled,
  markAnnotationPointerRelease,
  markAnnotationPreviewFrame,
} from '../utils/annotationPreviewDiag.js';
import { isTransformLockedAnnotation } from '../utils/annotationSelectionEligibility.js';
import { resizeTextMarkupHorizontalEdge } from '../utils/pdfTextMarkup.js';

const cloneAnnotations = (annotations) => deepClone(annotations);

const diagLog = (...args) => {
  if (!isAnnotationPreviewDiagEnabled()) return;
  console.log(...args);
};

const buildPreviewObjects = (updatedAnnotations, originals) => {
  const previewObjects = {};
  const sourceObjects = updatedAnnotations?.objects || [];
  for (const idx of Object.keys(originals || {})) {
    const numericIdx = Number(idx);
    if (sourceObjects[numericIdx]) {
      previewObjects[numericIdx] = sourceObjects[numericIdx];
    }
  }
  return previewObjects;
};

/**
 * @param {object} options
 * @param {React.RefObject<SVGSVGElement>} options.svgRef - Ref to root <svg> element
 * @param {{ objects: Array }} options.annotations - Fabric.js JSON annotations
 * @param {number} options.pageWidth - Unscaled page width (viewBox width)
 * @param {number} options.pageHeight - Unscaled page height (viewBox height)
 * @param {Function} options.onSaveAnnotations - (updatedJSON, saveContext) => void
 * @param {Function} options.onRequestEditMode - (annotationIndex, annotationType) => void
 * @param {Array} [options.callouts] - Phase 14 CALL-10 — array of React callouts
 *   (normalized 0-1 coords) from App.jsx. Used to look up the original callout
 *   by id for drag-start snapshots and whole-move delta math.
 * @param {Function} [options.onSelectedCalloutIdsChange] - Phase 14 CALL-10 —
 *   callback (ids: Set<string>) => void fired when a callout is clicked to
 *   select. Plan 14-03 Task 1 wires this to App.jsx setSelectedCalloutIds.
 * @param {Function} [options.onUpdateCalloutLive] - Phase 14 CALL-10 — live
 *   paint callback (calloutId, patch) => void fired on every pointermove
 *   during callout-part drag. NO undo checkpoint — matches Phase 12 optimistic
 *   rotation paint pattern.
 * @param {Function} [options.onUpdateCallout] - Phase 14 CALL-10 — commit
 *   callback (calloutId, patch) => void fired once on pointerup to capture
 *   the undo checkpoint (live paint already updated the store).
 */
export function useSVGInteraction({
  svgRef,
  annotations,
  pageWidth,
  pageHeight,
  onSaveAnnotations,
  onRequestEditMode,
  callouts,
  onSelectedCalloutIdsChange,
  // UX 2026-04-20: current callout selection set (Set<string> or array).
  // Read at callout pointerdown so Shift-click can toggle this callout
  // in / out without wiping the rest. Previously the hook only called
  // onSelectedCalloutIdsChange with the new full Set, which meant
  // shift-click had no way to preserve existing callouts.
  selectedCalloutIds,
  onUpdateCalloutLive,
  onUpdateCallout,
  // Phase 19 — current tool. Marquee only activates when tool === 'select'.
  activeTool,
  selectionMode = 'rectangle',
  // Phase 35 Plan 03 — per-user delete authority. Threads the current Supabase
  // auth user id and the active document's owner id through to canModify at
  // every selection-resolve site (marquee post-filter + click hit-test gates).
  // Both are optional — when either is null/undefined the legacy behavior is
  // preserved (the click-hit gate returns true / the marquee filter returns
  // the input reference unchanged). This keeps boot-time renders and legacy
  // mount sites byte-identical until App.jsx threads the new props.
  viewerId,
  documentOwnerId,
  // Phase 35 Plan 04 — page number for the bulk-delete interceptor's
  // snapshot (so App.jsx's onUndo can restore on the right page). Optional;
  // when missing, deleteSelected still fires the existing onSaveAnnotations
  // unchanged. SVGAnnotationLayer already passes its own pageNumber prop
  // through but does not currently forward it into useSVGInteraction —
  // Plan 35-04 forwards it via SVGAnnotationLayer's prop pass-through.
  pageNumber,
  getSelectableAnnotationIndices,
  // Phase 35 Plan 04 — bulk-delete interceptor. Optional callback. When
  // App.jsx provides it, deleteSelected invokes it with
  // ({ candidateIds, snapshotObjects, pageNumber, runDelete }) BEFORE
  // firing the existing onSaveAnnotations. App.jsx decides modal vs
  // direct-fire and invokes runDelete (the existing delete code path) when
  // ready. When the prop is absent (e.g. boot, test harness without
  // App.jsx's mount), deleteSelected falls through to runDelete unconditionally
  // — preserves legacy behavior byte-identical.
  onRequestBulkDelete,
}) {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [hoveredId, setHoveredId] = useState(null);
  // UX: Phase 19 follow-up — callouts now get a cursor-hover indicator
  // and participate in the multi-select hover-glow style. Separate from
  // hoveredId (annotations) because callout ids are strings and live in
  // App.jsx state, so mixing the two would require namespaced keys.
  const [hoveredCalloutId, setHoveredCalloutId] = useState(null);
  const [inverseScale, setInverseScale] = useState(1);
  const [interactionState, setInteractionState] = useState('idle'); // 'idle' | 'dragging' | 'resizing' | 'rotating'
  // UX: Phase 15 UAT-3 (2026-04-18) — which callout part (if any) is being
  // actively dragged right now. Set at pointerdown, cleared at pointerup.
  // Consumed by SVGAnnotationLayer's callout chrome so the knee handle
  // tracks the user's cursor during 'knee' drag instead of snapping to
  // the renderer's auto-routed midpoint.
  const [activeCalloutDrag, setActiveCalloutDrag] = useState(null); // { id, partType } | null

  // Visual-only transform during drag (Plan 02 populates)
  const [visualTransform, setVisualTransform] = useState(null);

  // Mutable refs for drag state
  const dragStateRef = useRef({
    active: false,
    mode: null,      // 'move' | 'resize' | 'rotate' | 'text-markup-horizontal' | group/callout modes
    handleId: null,
    startSVGPoint: null,  // { x, y } in viewBox coords at drag start
    originalProps: null,  // { left, top, scaleX, scaleY, angle, width, height } snapshot
    annotationIndex: null,
    ctmInverse: null,     // cached CTM inverse for the entire drag
    anchorX: null,        // resize: opposite corner X
    anchorY: null,        // resize: opposite corner Y
    centerX: null,        // rotate: annotation center X
    centerY: null,        // rotate: annotation center Y
    currentResize: null,  // resize: { newScaleX, newScaleY, newLeft, newTop } during drag
    currentAngle: undefined, // rotate: current angle during drag
    originalTextMarkup: null,
    currentTextMarkup: null,
    fixedTextOffset: null,
    groupOriginals: null, // group-move: { [idx]: { left, top } } for all selected annotations
    // UX: 2026-04-20 — callout originals captured alongside annotation
    // originals when the multi-selection includes callouts. Live-painted
    // each frame via onUpdateCalloutLive so callouts ride the group-move
    // drag with the shapes; committed once on pointerup via
    // onUpdateCallout for a single undo entry per callout.
    groupCalloutOriginals: null,
    // UX: 2026-04-20 — Group rotate/resize state (set on group handle
    // pointerdown, read in pointermove + pointerup, reset on pointerup).
    groupMemberOriginals: null, // { [idx]: { objType, dataType, left, top, ... } }
    groupUnionOriginal: null,   // { left, top, right, bottom, cx, cy, width, height }
    groupStartAngle: 0,         // angle (deg) from union center to start pointer (rotate)
    lastGroupRotLogAt: 0,       // diag throttle timestamps (ms)
    lastGroupResLogAt: 0,
    // UX: Phase 14 CALL-10 — callout-part drag state. Populated only when
    // mode === 'callout-part'. See 14-CONTEXT.md Area 3 (Phase 14 drag MVP).
    // Four-place invariant: these fields are initialized here, SET at
    // pointerdown, READ at pointermove, and RESET at pointerup.
    partType: null,                 // 'arrowTip' | 'knee' | 'textBox' | 'whole'
    calloutId: null,
    originalCalloutPositions: null, // snapshot of arrowTip/knee/textBoxPosition at drag-start
    // UX: Phase 15 UAT-3 Issue 3 — tracks the most recent callout state that
    // passed all distance rules. When a frame's proposed positions violate a
    // rule (arrow entering textbox, knee too close to arrow, knee entering
    // textbox, etc.) we re-emit this safe snapshot so the visible handles
    // freeze in place rather than tunneling through the constraint. Updated
    // each safe frame; seeded from originalCalloutPositions at pointerdown.
    lastSafeCalloutPositions: null,
    diagGestureId: null,
  });
  const textMarkupCycleRef = useRef(null);
  const interactionStateRef = useRef('idle');

  // UX: Phase 19 — AutoCAD marquee state. Separate from dragStateRef so
  // the marquee rect can drive SVG render without racing annotation
  // drag / resize / rotate state. Shape when active:
  //   { startX, startY, endX, endY, shiftHeld, active, pointerId }
  // `active` flips true once the pointer crosses the 5 px min-drag
  // threshold (matches dormant reference at
  // PageAnnotationLayer.jsx:7411-7854). Sub-threshold releases fall
  // through to plain-click semantics — no rect ever drawn.
  const [marqueeState, setMarqueeState] = useState(null);
  const marqueeStateRef = useRef(null);
  const applyMarqueeState = useCallback((next) => {
    marqueeStateRef.current = next;
    setMarqueeState(next);
  }, []);
  // The lasso trail stays in page/viewBox coordinates and never enters the
  // annotation model or history. Shape: { points, shiftHeld, pointerId }.
  const [lassoState, setLassoState] = useState(null);
  const lassoStateRef = useRef(null);
  const applyLassoState = useCallback((next) => {
    lassoStateRef.current = next;
    setLassoState(next);
  }, []);

  const cancelLasso = useCallback((pointerId) => {
    const current = lassoStateRef.current;
    if (!current) return false;
    try { svgRef.current?.releasePointerCapture?.(pointerId ?? current.pointerId); } catch (_) { /* optional */ }
    applyLassoState(null);
    return true;
  }, [applyLassoState, svgRef]);

  const shouldHandoffLassoPointer = useCallback((pointerId) => {
    const current = lassoStateRef.current;
    return !!current && current.pointerId !== pointerId;
  }, []);

  const shouldIgnoreLassoPointer = useCallback((pointerId, pointerType) => {
    const current = lassoStateRef.current;
    return !!current
      && current.pointerId !== pointerId
      && current.pointerType === 'pen'
      && pointerType === 'touch';
  }, []);

  // UX: when a drag commits (move or group-move with > 2px delta), stamp
  // this ref with `Date.now()`. The browser's native `dblclick` event fires
  // when two pointerdowns land on the same target within ~300-500ms — a
  // click-to-select followed by a click-and-drag-to-move hits that timing,
  // causing the drag's pointerup to emit a spurious dblclick that enters
  // edit mode. `handleAnnotationDoubleClick` consults this ref and bails
  // if a drag just ended within a 400ms window. Mirrors the 300ms
  // `editModeCooldownRef` pattern in App.jsx:26690.
  const justDraggedAtRef = useRef(0);

  // Keep interactionStateRef in sync
  useEffect(() => {
    interactionStateRef.current = interactionState;
  }, [interactionState]);

  // UX: 2026-04-21 — Persisted group rotation. After a group-rotate
  // commit, the multi-selection's outer dashed bbox should KEEP the
  // tilted angle (matching single-shape behavior — single shapes store
  // angle on obj.angle and the bbox renders tilted). Without this,
  // releasing the rotate handle made the bbox snap back to axis-aligned
  // because the renderer recomputes the bbox from the union of each
  // member's rotated world AABB.
  // Shape:
  //   {
  //     selectionSig: string,        // hash of selected ann + callout ids
  //     snapshotBbox: { left, top, width, height },  // un-rotated frame
  //     angle: number,               // accumulated rotation (deg)
  //     dx: number, dy: number,      // accumulated translation since snapshot
  //   }
  // Cleared whenever the selection set changes. Resize commits also
  // clear it (resize fundamentally re-shapes the frame; persisted
  // rotation no longer applies).
  const [persistedGroupTransform, setPersistedGroupTransform] = useState(null);
  const persistedGroupTransformRef = useRef(null);
  useEffect(() => { persistedGroupTransformRef.current = persistedGroupTransform; }, [persistedGroupTransform]);

  // UX: Phase 19 — Escape cancels an in-progress marquee without
  // changing the existing selection. Mirrors AutoCAD's behavior where
  // Esc mid-drag drops the rubber-band box silently. Listener is only
  // attached while a marquee is tracking, so it does not compete with
  // the Escape handler for text-edit or shape-edit modes.
  useEffect(() => {
    if (!marqueeState && !lassoState) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        applyMarqueeState(null);
        cancelLasso();
      } else if ((e.code === 'Space' || e.key === ' ') && lassoStateRef.current) {
        e.preventDefault();
        const current = lassoStateRef.current;
        const activeMode = current.modeOverride || current.mode || getLassoModeFromTrail(current.points) || 'window';
        const nextMode = cycleLassoMode(activeMode);
        applyLassoState({ ...current, modeOverride: nextMode });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [marqueeState, lassoState, applyMarqueeState, applyLassoState, cancelLasso]);

  // PdfjsViewerContainer owns the mobile two-finger gesture and emits this
  // event before live pinch zoom starts. Drop the transient trail so the PDF
  // can take over without committing a selection.
  useEffect(() => {
    const onPinchStart = () => cancelLasso();
    window.addEventListener('survey-pdfjs-pinch-start', onPinchStart);
    return () => window.removeEventListener('survey-pdfjs-pinch-start', onPinchStart);
  }, [cancelLasso]);

  // ---------------------------------------------------------------------------
  // Inverse scale via ResizeObserver (container-aware, NOT zoom percentage)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !pageWidth) return;

    // Initial computation
    setInverseScale(getInverseScale(svgEl, pageWidth));

    const observer = new ResizeObserver(() => {
      setInverseScale(getInverseScale(svgEl, pageWidth));
    });

    observer.observe(svgEl);

    return () => {
      observer.disconnect();
    };
  }, [svgRef, pageWidth]);

  // UX: 2026-04-21 — Helper: stable string signature of the current multi-
  // selection. Used to detect when the user has changed selection so the
  // persisted group rotation can be cleared automatically. Sorting both
  // sides keeps the signature deterministic regardless of insertion order.
  const computeSelectionSig = useCallback((annIds, calIds) => {
    const a = (annIds instanceof Set ? Array.from(annIds) : Array.isArray(annIds) ? annIds : [])
      .slice().sort((x, y) => x - y).join(',');
    const c = (calIds instanceof Set ? Array.from(calIds) : Array.isArray(calIds) ? calIds : [])
      .slice().sort().join(',');
    return `${a}|${c}`;
  }, []);

  // UX: 2026-04-21 v2 — Keep persisted group rotation alive across empty
  // deselects so the user can click empty space, then click any group
  // member, and see the tilted bbox restored. Only clear when the new
  // selection is NON-EMPTY and DIFFERENT from the persisted one (a true
  // selection change to a different group). Empty selection is treated as
  // a transient state — don't drop the rotation just because the user
  // momentarily clicked the page background.
  useEffect(() => {
    const sig = computeSelectionSig(selectedIds, selectedCalloutIds);
    const persisted = persistedGroupTransformRef.current;
    if (!persisted) return;
    // Empty new selection — keep persisted (transient deselect).
    if (sig === '|') return;
    // Non-empty + matches persisted — keep (restored selection).
    if (persisted.selectionSig === sig) return;
    // Non-empty + differs from persisted — true selection change → clear.
    setPersistedGroupTransform(null);
  }, [selectedIds, selectedCalloutIds, computeSelectionSig]);

  // Phase 35 Plan 06 test seam — read-only mirror of selectedIds for e2e
  // assertion. Mirrors the per-page selection by resolving each index to the
  // stable annotation.id at write time (Sets of indices are unstable across
  // re-renders; ids stay stable). Production-stripped via the
  // import.meta.env.MODE check so the production bundle drops the seam via
  // Vite tree-shake. Colocated here because useSVGInteraction owns the
  // selectedIds state — bubbling it up to App.jsx via a callback prop would
  // be more code for the same observable surface.
  useEffect(() => {
    if (import.meta.env.MODE === 'production') return undefined;
    if (typeof window === 'undefined') return undefined;
    const ids = Array.from(selectedIds || []).map((idx) => {
      const obj = annotations?.objects?.[idx];
      return obj?.id || null;
    }).filter(Boolean);
    window.__selectedAnnotationIds = ids;
    return undefined;
  }, [selectedIds, annotations]);

  // ---------------------------------------------------------------------------
  // Clear selection when annotations prop identity changes
  // (new page loaded or external edit) — but NOT during active drag
  // (endpoint drag does live commits which change annotations on every move).
  // Also preserve selection on post-commit updates: if every selected index
  // still points to a valid annotation, keep the selection. Drop it only when
  // the array shrinks past a selected index (deletion) or the page swaps.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (dragStateRef.current?.active) return;
    const maxIdx = (annotations?.objects?.length ?? 0) - 1;
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      for (const i of prev) {
        if (i > maxIdx || i < 0) return new Set();
      }
      return prev;
    });
    setHoveredId(null);
  }, [annotations]);

  // ---------------------------------------------------------------------------
  // Selection manipulation
  // ---------------------------------------------------------------------------
  const selectAnnotation = useCallback((index, addToSelection = false) => {
    setSelectedIds((prev) => {
      if (addToSelection) {
        const next = new Set(prev);
        next.add(index);
        return next;
      }
      return new Set([index]);
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
    setHoveredId(null);
  }, []);

  // UX: 2026-04-20 — multi-index selection setter. Used by App.jsx via the
  // pendingSvgSelection.annotationIndices broadcast after Ungroup so the
  // freed members stay selected as a multi-selection. Replaces the entire
  // selection (not additive) to match the post-ungroup contract.
  const selectAnnotations = useCallback((indices) => {
    if (!Array.isArray(indices) && !(indices instanceof Set)) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(indices));
  }, []);

  const isSelected = useCallback((index) => {
    return selectedIds.has(index);
  }, [selectedIds]);

  // Per-user delete authority click hit-test gate — LOCKED permissions model
  // (2026-07-17): contributors and owners can select/move/edit/delete ANY
  // annotation, so this gate now runs canDelete (authenticated write-capable
  // pair passes for every annotation) instead of canModify (author-or-owner
  // only). Cross-author capability is safe to open at selection time because:
  //   - viewers never reach this handler (ReadOnlyGate CSS blocks pointer
  //     events on the SVG root + capture-phase keydown swallows Delete), and
  //   - cross-author DELETES are re-partitioned in deleteSelected below and
  //     always routed through the parent's bulk-delete planner, which shows
  //     the collaborator-cross-author confirm modal (never direct-fires).
  // Cross-author MOVES/EDITS commit through the normal save paths with no
  // modal — matches the callout precedent (9d8df592) and the modal's
  // delete-only copy. Original authorship survives foreign edits: the
  // serializer treats meta.authorId as write-once-on-create
  // (annotationTypeSerializers.js).
  //
  // Boot guard: when either viewerId or documentOwnerId is missing (App.jsx
  // not yet threaded the new props, or the user signed out mid-session) the
  // gate returns true so legacy behavior is byte-identical. The gate engages
  // once both props resolve.
  const canSelectAnnotationByIndex = useCallback((index) => {
    const a = annotations?.objects?.[index];
    if (!a) return false;
    if (!viewerId || !documentOwnerId) return true;
    return canDelete({ annotation: a, viewerId, documentOwnerId });
  }, [annotations, viewerId, documentOwnerId]);

  // ---------------------------------------------------------------------------
  // Pointer event handlers
  // ---------------------------------------------------------------------------

  /**
   * Click on an annotation to select it.
   * Shift-click toggles in/out of selection (for multi-select in Plan 03).
   */
  const handleAnnotationPointerDown = useCallback((e, index) => {
    e.stopPropagation();
    if (dragStateRef.current?.active && dragStateRef.current.annotationIndex === index) {
      return;
    }
    if (typeof window !== 'undefined' && window.__LINE_BBOX_DIAG) try {
      const obj = annotations?.objects?.[index];
      diagLog('[BboxScaleDiag] annotation-pointerdown ' + JSON.stringify({
        ts: new Date().toISOString(), annotationIndex: index,
        objType: obj?.type, objTool: obj?.tool,
        shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        alreadySelected: selectedIds?.has?.(index),
        objSnapshot: obj ? { left: obj.left, top: obj.top, width: obj.width, height: obj.height, angle: obj.angle, scaleX: obj.scaleX, scaleY: obj.scaleY, x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2 } : null,
      }));
    } catch (err) { /* swallow log errors */ }

    // Per-user delete authority click hit-test gate (2026-07-17 locked
    // model): any authenticated contributor/owner may select any annotation
    // (see canSelectAnnotationByIndex). The early-return now only fires for
    // missing objects — kept as the single entry gate so any future
    // tightening happens in ONE place. Viewers never reach this handler
    // (ReadOnlyGate blocks pointer events at the SVG root).
    if (!canSelectAnnotationByIndex(index)) {
      return;
    }

    // UX 2026-04-20: Shift + pointerdown on a single-selected committed
    // counter enters orbit mode BEFORE the multi-select Shift-click toggle
    // branch below. Without this, Shift-click always took the toggle path
    // and the orbit drag never fired. A tiny-movement threshold in the
    // pointerup branch still lets a pure Shift-click act as a multi-select
    // toggle; anything past ~3 px commits as an orbit rotation.
    const _obj_precheck = annotations?.objects?.[index];
    if (
      e.shiftKey
      && _obj_precheck?.data?.type === 'counter'
      && !(selectedIds.size > 1 && selectedIds.has(index))
    ) {
      const ctm = svgRef.current?.getScreenCTM();
      const ctmInverse = ctm ? ctm.inverse() : null;
      const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
      const radius = (_obj_precheck.radius || 14) * Math.abs(_obj_precheck.scaleX || 1);
      const bodyX = (_obj_precheck.left || 0) + radius;
      const bodyY = (_obj_precheck.top || 0) + radius;
      const pointerAngleDeg = _obj_precheck.data.pointerAngle != null ? _obj_precheck.data.pointerAngle : 225;
      const rad = (pointerAngleDeg * Math.PI) / 180;
      const tipExtension = radius * 0.5;
      const tipDistance = radius + tipExtension;
      const tipX = bodyX + Math.cos(rad) * tipDistance;
      const tipY = bodyY + Math.sin(rad) * tipDistance;
      try { e.target.setPointerCapture?.(e.pointerId); } catch (_) { /* optional */ }
      dragStateRef.current = {
        active: true,
        mode: 'counter-orbit',
        handleId: null,
        startSVGPoint: svgPoint,
        originalProps: null,
        annotationIndex: index,
        ctmInverse,
        anchorX: tipX,
        anchorY: tipY,
        centerX: null,
        centerY: null,
        currentResize: null,
        currentAngle: undefined,
        groupOriginals: null,
        counterRadius: radius,
        counterTipDistance: tipDistance,
      };
      e.preventDefault();
      return;
    }

    if (e.shiftKey) {
      // Phase 35 Plan 03 — explicit per-user delete authority gate at the
      // Shift-click toggle add site. The handler-entry gate above already
      // covers this path; this redundant check is a defense-in-depth marker
      // that documents the boundary at the actual setSelectedIds call site
      // (CONTEXT.md AC #3: non-owner Shift-click on foreign mark must not
      // add the index to the selection set). canModify short-circuits to
      // true for the document owner so this branch is byte-identical for
      // owner-role sessions.
      if (!canSelectAnnotationByIndex(index)) {
        return;
      }
      // Toggle in selection set (multi-select, Plan 03)
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
      return; // Don't initiate drag on shift-click toggle
    }

    const clickedTextMarkup = annotations?.objects?.[index];
    if (clickedTextMarkup?.data?.type === 'text-markup') {
      const rangeKey = JSON.stringify({
        pageNumber: clickedTextMarkup.data.pageNumber,
        textRange: clickedTextMarkup.data.textRange || null,
        quads: clickedTextMarkup.data.quads || [],
      });
      const candidates = (annotations?.objects || [])
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate }) => candidate?.data?.type === 'text-markup')
        .filter(({ candidate }) => JSON.stringify({
          pageNumber: candidate.data.pageNumber,
          textRange: candidate.data.textRange || null,
          quads: candidate.data.quads || [],
        }) === rangeKey)
        .map(({ candidateIndex }) => candidateIndex);
      const previous = textMarkupCycleRef.current;
      const samePoint = previous
        && previous.rangeKey === rangeKey
        && Math.hypot(Number(e.clientX) - previous.clientX, Number(e.clientY) - previous.clientY) <= 4;
      const currentPosition = samePoint
        ? Math.max(0, candidates.indexOf(previous.selectedIndex))
        : Math.max(0, candidates.indexOf(index));
      const targetIndex = samePoint && candidates.length > 1
        ? candidates[(currentPosition + 1) % candidates.length]
        : index;
      textMarkupCycleRef.current = {
        rangeKey,
        clientX: Number(e.clientX),
        clientY: Number(e.clientY),
        selectedIndex: targetIndex,
      };
      selectAnnotation(targetIndex, false);
      onSelectedCalloutIdsChange?.(new Set());
      dragStateRef.current = { ...dragStateRef.current, active: false };
      setVisualTransform(null);
      e.preventDefault();
      return;
    }

    const wasAlreadySelected = selectedIds.has(index);

    // UX: 2026-04-20 — Group auto-expand-on-click (Stage 1 of the Group /
    // Ungroup design). When a plain (non-Shift) click lands on an
    // annotation that carries data.groupId AND it isn't already part of
    // the current selection, replace the selection with EVERY member of
    // that group on this page (annotations + callouts). The existing
    // multi-select chrome (outer dashed blue box with handles + per-member
    // hover-glow) then paints automatically without any new render path.
    // Skipped when the clicked annotation is already in selectedIds —
    // that path is reserved for group-move drag (handled below).
    const _clickedObj = annotations?.objects?.[index];
    const _clickedGid = getAnnotationGroupId(_clickedObj);
    if (!wasAlreadySelected && _clickedGid) {
      const pageCallouts = (callouts || []); // already page-scoped per layer mount
      const members = findGroupMembers(annotations, pageCallouts, [_clickedGid]);
      if (members.annotationIndices.length > 0 || members.calloutIds.length > 0) {
        // Per-user delete authority filter on group expand (2026-07-17
        // locked model): the gate now admits foreign-author members too —
        // contributors select and operate on everyone's marks. The filter is
        // kept (rather than deleted) so missing/stale indices still drop and
        // so any future re-tightening lives at the shared gate.
        const ownAnnotationIndices = members.annotationIndices.filter((mi) =>
          canSelectAnnotationByIndex(mi),
        );
        setSelectedIds(new Set(ownAnnotationIndices));
        if (typeof onSelectedCalloutIdsChange === 'function') {
          onSelectedCalloutIdsChange(new Set(members.calloutIds));
        }
        return; // group selected — no drag, no further per-shape branches.
      }
    }

    // Select if not already selected
    if (!wasAlreadySelected) {
      selectAnnotation(index, false);
    }

    // UX: Phase 19 follow-up — plain click on a NEW annotation must
    // also clear any selected callouts. Without this, a user who had
    // a shape + a callout group-selected would click a new shape and
    // see the callout remain in the selection (outer dashed box
    // spanning shape + callout). Callout pointerdown already calls
    // deselectAll() to clear annotations; this is the symmetric side.
    // Skip when clicking an already-selected annotation — that's a
    // drag-to-move, not a selection switch (group move stays intact).
    if (!wasAlreadySelected && onSelectedCalloutIdsChange) {
      onSelectedCalloutIdsChange(new Set());
    }

    // Initiate drag-to-move
    const obj = annotations?.objects?.[index];
    if (obj) {
      // Text markup is a range anchored to PDF text. It can change via its
      // two endpoint handles, but a body drag must never move the quads.
      if (obj?.data?.type === 'text-markup') {
        dragStateRef.current = { ...dragStateRef.current, active: false };
        setVisualTransform(null);
        e.preventDefault();
        return;
      }
      if (isTransformLockedAnnotation(obj)) {
        e.preventDefault();
        return;
      }
      if (e.pointerId != null) {
        try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* optional */ }
      }
      const ctm = svgRef.current?.getScreenCTM();
      const ctmInverse = ctm ? ctm.inverse() : null;
      const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);

      // (Counter Shift-drag orbit branch is handled at the top of this
      // callback, before the multi-select toggle early-return.)

      // Group drag: when multiple annotations are selected and clicking
      // on one that's already selected, initiate group-move (Plan 03).
      // CRITICAL per RESEARCH.md Pitfall 6: record ALL selected annotations'
      // original positions so we compute position as original + totalDelta
      // (not current + frameDelta) to prevent floating-point drift.
      // UX: 2026-04-20 v2 — also count callouts in the multi-selection so
      // the group-move trigger fires when the user has shape+callout
      // selected (previously the gate ignored callouts and shape-only
      // selections of size 1 would fall through to single-shape drag).
      const calSize = (selectedCalloutIds instanceof Set)
        ? selectedCalloutIds.size
        : (Array.isArray(selectedCalloutIds) ? selectedCalloutIds.length : 0);
      const totalSel = selectedIds.size + calSize;
      if (totalSel > 1 && selectedIds.has(index)) {
        const originals = {};
        for (const selIdx of selectedIds) {
          const selObj = annotations?.objects?.[selIdx];
          if (selObj && selObj?.data?.type !== 'text-markup' && !isTransformLockedAnnotation(selObj)) {
            // Imported paths: use bbox position (from path data), not obj.left/top
            if (isImportedPath(selObj)) {
              const selBBox = getAnnotationBBox(selObj);
              originals[selIdx] = { left: selBBox.left, top: selBBox.top };
            } else {
              originals[selIdx] = { left: selObj.left ?? 0, top: selObj.top ?? 0 };
            }
          }
        }
        // UX: 2026-04-20 — callouts in the multi-selection ride the same
        // group-move drag. Capture their normalized {arrowTip, knee,
        // textBoxPosition} at start, then live-paint + commit per-callout
        // in pointermove + pointerup (callouts use the existing
        // onUpdateCalloutLive / onUpdateCallout pipeline rather than the
        // annotation save path).
        const calloutOriginals = {};
        const calIdsArr = (selectedCalloutIds instanceof Set)
          ? Array.from(selectedCalloutIds)
          : (Array.isArray(selectedCalloutIds) ? selectedCalloutIds : []);
        for (const cid of calIdsArr) {
          const c = (callouts || []).find((cc) => cc && cc.id === cid);
          if (!c) continue;
          calloutOriginals[cid] = {
            arrowTip: { x: c.arrowTip?.x ?? 0, y: c.arrowTip?.y ?? 0 },
            knee: { x: c.knee?.x ?? 0, y: c.knee?.y ?? 0 },
            textBoxPosition: { x: c.textBoxPosition?.x ?? 0, y: c.textBoxPosition?.y ?? 0 },
          };
        }
        dragStateRef.current = {
          active: true,
          mode: 'group-move',
          handleId: null,
          startSVGPoint: svgPoint,
          originalProps: null,
          annotationIndex: index,
          ctmInverse,
          anchorX: null,
          anchorY: null,
          centerX: null,
          centerY: null,
          currentResize: null,
          currentAngle: undefined,
          groupOriginals: originals,
          // UX: 2026-04-20 — callout originals for group-move ride-along.
          groupCalloutOriginals: calloutOriginals,
        };
      } else {
        // Single annotation drag
        // Imported paths: derive position/size from path data bbox
        const imported = isImportedPath(obj);
        const bbox = imported ? getAnnotationBBox(obj) : null;
        dragStateRef.current = {
          active: true,
          mode: 'move',
          handleId: null,
          startSVGPoint: svgPoint,
          originalProps: {
            left: imported ? bbox.left : (obj.left ?? 0),
            top: imported ? bbox.top : (obj.top ?? 0),
            scaleX: imported ? 1 : (obj.scaleX ?? 1),
            scaleY: imported ? 1 : (obj.scaleY ?? 1),
            angle: obj.angle ?? 0,
            width: imported ? bbox.width : (obj.width ?? 0),
            height: imported ? bbox.height : (obj.height ?? 0),
          },
          annotationIndex: index,
          ctmInverse,
          anchorX: null,
          anchorY: null,
          centerX: null,
          centerY: null,
          currentResize: null,
          currentAngle: undefined,
          groupOriginals: null,
        };
      }
    }
  }, [selectedIds, selectAnnotation, annotations, svgRef]);

  /**
   * Hover enter: show blue outline preview.
   */
  const handleAnnotationPointerEnter = useCallback((e, index) => {
    setHoveredId(index);
  }, []);

  /**
   * Hover leave: clear hover state (only if still matching to prevent race).
   */
  const handleAnnotationPointerLeave = useCallback((e, index) => {
    setHoveredId((prev) => (prev === index ? null : prev));
  }, []);

  /**
   * Phase 19 follow-up — callout hover enter / leave. Same contract as
   * the annotation handlers but keyed by callout id (string). Wired on
   * the outer data-callout-id group in SVGAnnotationLayer so the whole
   * callout (textbox + connector + handles) counts as one hover zone.
   */
  const handleCalloutPointerEnter = useCallback((id) => {
    setHoveredCalloutId(id);
  }, []);
  const handleCalloutPointerLeave = useCallback((id) => {
    setHoveredCalloutId((prev) => (prev === id ? null : prev));
  }, []);

  /**
   * Double-click: request edit mode (Phase 10/11 mounts Canvas for editing).
   *
   * Phase 14 CALL-10: extended to hit-test data-callout-id on the event target
   * chain and fire onRequestEditMode(calloutId, 'callout') BEFORE the
   * annotation double-click logic. Callers disambiguate by checking the
   * second arg === 'callout' and route to the FabricEditCanvas callout
   * adapter path (Plan 14-03 Task 3 in App.jsx).
   */
  const handleAnnotationDoubleClick = useCallback((e, index) => {
    // UX: suppress the browser's native dblclick when a drag just ended.
    // Repro: click polygon to select, then click-and-drag to move — the
    // two pointerdowns fall inside the browser's ~300-500ms dblclick
    // window, so pointerup fires dblclick and enters edit mode on the
    // dragged shape. For a polyline, `editType` falls through to
    // 'callout' in App.jsx:26717, FabricEditCanvas mounts with a broken
    // callout adapter, and every annotation appears to vanish until the
    // user clicks away to exit edit mode. 400ms is larger than the
    // browser's dblclick window so we catch the spurious dblclick, but
    // short enough that an intentional dblclick (deliberate, after the
    // user has stopped dragging for a moment) still works.
    if (Date.now() - justDraggedAtRef.current < 400) {
      e.stopPropagation();
      return;
    }
    // UX: Phase 14 CALL-10 — callout double-click enters edit mode via
    // FabricEditCanvas + calloutEditAdapter (see Plan 14-03 Task 3 in App.jsx).
    // Uses event-delegation via data-callout-id (same pattern as v2.2 EDIT-13
    // rotation-handle delegation) so the hit-test works even when the
    // event target is a descendant of the callout <g>.
    const calloutEl = e.target?.closest?.('[data-callout-id]');
    if (calloutEl) {
      const calloutId = calloutEl.getAttribute('data-callout-id');
      if (calloutId && onRequestEditMode) {
        e.stopPropagation();
        // UX: fire the dispatch with 'callout' type — App.jsx disambiguates
        // by checking type === 'callout' and routes to the calloutEditAdapter
        // pipeline via handleRequestCalloutEditMode.
        onRequestEditMode(calloutId, 'callout');
        return;
      }
    }
    e.stopPropagation();
    const annotation = annotations?.objects?.[index];
    if (isTransformLockedAnnotation(annotation)) {
      e.preventDefault();
      return;
    }
    if (onRequestEditMode && annotation) {
      onRequestEditMode(index, annotation.type);
    }
  }, [onRequestEditMode, annotations]);

  /**
   * Click on empty SVG background: deselect all.
   * Only fires when clicking the SVG element itself, not a child annotation.
   *
   * Phase 14 CALL-10: extended to hit-test data-callout-id and enter the
   * new 'callout-part' drag mode. Callout clicks take precedence over empty-
   * space deselection because callouts may render across the full SVG area
   * and the SVG root catches clicks anywhere inside them.
   */
  const handleSvgPointerDown = useCallback((e) => {
    // Lasso Select owns the page gesture, even when the press starts on a
    // rendered annotation or callout. Dispatch this before object drag/select
    // hit testing so a real freehand loop can start anywhere on the page.
    if (activeTool === 'select' && selectionMode === 'lasso') {
      if (e.button != null && e.button !== 0) return;
      const current = lassoStateRef.current;
      if (current && current.pointerId !== e.pointerId) {
        // A pen keeps ownership when a stray palm touch lands. Two touch
        // pointers still hand off to the viewer's pinch gesture.
        if (current.pointerType === 'pen' && (e.pointerType || 'mouse') === 'touch') {
          e.preventDefault();
          return 'pen-owned';
        }
        cancelLasso();
        return 'pinch-handoff';
      }
      const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
      applyLassoState({
        points: [{
          x: Math.max(0, Math.min(pageWidth, svgPoint.x)),
          y: Math.max(0, Math.min(pageHeight, svgPoint.y)),
        }],
        shiftHeld: !!e.shiftKey,
        altHeld: !!e.altKey,
        modeOverride: null,
        mode: null,
        pointerId: e.pointerId,
        pointerType: e.pointerType || 'mouse',
      });
      try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch (_) { /* optional */ }
      e.preventDefault();
      return 'lasso-started';
    }

    // UX: Phase 14 CALL-10 — callout hit-test via data-attribute delegation.
    // Same pattern as v2.2 Phase 13 rotation-handle delegation
    // (SVGAnnotationLayer.jsx:225-340). The data-callout-* namespace is
    // distinct from data-rotation-handle so they don't collide.
    const calloutEl = e.target?.closest?.('[data-callout-id]');
    if (calloutEl) {
      const calloutId = calloutEl.getAttribute('data-callout-id');
      const partEl = e.target?.closest?.('[data-callout-part]');
      // UX: default to 'whole' if the click lands on the outer <g> without
      // an explicit part marker. Defensive — every visible callout child
      // emits data-callout-part per Plan 14-01's renderCallout contract.
      let partType = partEl ? partEl.getAttribute('data-callout-part') : 'whole';

      // UX: Phase 14 whole-move triggers — (1) connector-line drag = whole,
      // (2) Cmd/Ctrl + any part = whole. Matches combined-tools
      // FabricPDFCanvas.tsx:2569-2603 dispatch-on-partType pattern and the
      // 14-CONTEXT.md Area 3 drag MVP decision.
      if (partType === 'line1' || partType === 'line2') partType = 'whole';
      if (e.metaKey || e.ctrlKey) partType = 'whole';
      // UX: Phase 15 UAT-3 (2026-04-17) — callout textbox corner handles
      // route to a dedicated resize mode. Normalize the data-callout-part
      // values textBox-tl / tr / bl / br into a single 'textBoxResize' mode
      // with the corner id captured in dragStateRef.textBoxCorner.
      let textBoxCorner = null;
      if (partType && partType.startsWith('textBox-')) {
        textBoxCorner = partType.slice('textBox-'.length);
        partType = 'textBoxResize';
      }
      // UX: clicking the inline text foreignObject is a select action, not a
      // drag — route it to 'textBox' so drag grabs the box frame but a bare
      // click still selects the callout. (Double-click edit entry runs via
      // handleAnnotationDoubleClick, not this handler.)
      if (partType === 'text') partType = 'textBox';

      // Look up the original callout by id for the drag-start snapshot
      const calloutArr = Array.isArray(callouts) ? callouts : [];
      const callout = calloutArr.find((c) => c && c.id === calloutId);
      if (!callout) {
        // Callout id not in the prop array — defensive bail-out. Don't
        // deselect — the click still belongs to the callout even if the
        // data hasn't propagated yet.
        return;
      }

      // UX: 2026-04-20 — Group-move precedence check (FIRST inside the
      // callout branch, BEFORE any selection mutation). When the clicked
      // callout is already part of a multi-selection of size ≥ 2 and Shift
      // isn't held, route the click into group-move so every member rides
      // along. This must run BEFORE the Shift / non-Shift selection
      // branches below — otherwise the non-Shift else-branch's deselectAll
      // + onSelectedCalloutIdsChange(new Set([calloutId])) wipes the
      // multi-selection's other members and the outer dashed bbox vanishes
      // mid-drag (visible symptom: shapes appear to move but the callout
      // stays put because the chrome thinks it's a solo callout drag now).
      const _calCount = (selectedCalloutIds instanceof Set)
        ? selectedCalloutIds.size
        : (Array.isArray(selectedCalloutIds) ? selectedCalloutIds.length : 0);
      const _calAlreadyIn = (selectedCalloutIds instanceof Set)
        ? selectedCalloutIds.has(calloutId)
        : (Array.isArray(selectedCalloutIds) && selectedCalloutIds.indexOf(calloutId) >= 0);
      if (!e.shiftKey && _calAlreadyIn && (selectedIds.size + _calCount) > 1) {
        const ctmA = svgRef.current?.getScreenCTM();
        const ctmInverseA = ctmA ? ctmA.inverse() : null;
        const svgPointA = screenToSVG(svgRef.current, e.clientX, e.clientY);

        const annotationOriginalsCO = {};
        for (const selIdx of selectedIds) {
          const selObj = annotations?.objects?.[selIdx];
          if (!selObj || selObj?.data?.type === 'text-markup' || isTransformLockedAnnotation(selObj)) continue;
          if (isImportedPath(selObj)) {
            const selBBox = getAnnotationBBox(selObj);
            annotationOriginalsCO[selIdx] = { left: selBBox.left, top: selBBox.top };
          } else {
            annotationOriginalsCO[selIdx] = { left: selObj.left ?? 0, top: selObj.top ?? 0 };
          }
        }
        const calloutOriginalsCO = {};
        const calIdsArrCO = (selectedCalloutIds instanceof Set)
          ? Array.from(selectedCalloutIds)
          : (Array.isArray(selectedCalloutIds) ? selectedCalloutIds : []);
        for (const cid of calIdsArrCO) {
          const c = (callouts || []).find((cc) => cc && cc.id === cid);
          if (!c) continue;
          calloutOriginalsCO[cid] = {
            arrowTip: { x: c.arrowTip?.x ?? 0, y: c.arrowTip?.y ?? 0 },
            knee: { x: c.knee?.x ?? 0, y: c.knee?.y ?? 0 },
            textBoxPosition: { x: c.textBoxPosition?.x ?? 0, y: c.textBoxPosition?.y ?? 0 },
          };
        }
        dragStateRef.current = {
          ...dragStateRef.current,
          active: true,
          mode: 'group-move',
          handleId: null,
          startSVGPoint: svgPointA,
          originalProps: null,
          annotationIndex: null,
          ctmInverse: ctmInverseA,
          anchorX: null, anchorY: null, centerX: null, centerY: null,
          currentResize: null, currentAngle: undefined,
          groupOriginals: annotationOriginalsCO,
          groupCalloutOriginals: calloutOriginalsCO,
        };
        try {
          diagLog('[GroupTransformDiag] callout-pointerdown-group-move ' + JSON.stringify({
            ts: new Date().toISOString(),
            calloutId,
            selectedAnnotationIds: Array.from(selectedIds || []),
            selectedCalloutIds: calIdsArrCO,
            startPointerSVG: { x: svgPointA?.x, y: svgPointA?.y },
            calloutOriginalsKeys: Object.keys(calloutOriginalsCO),
          }));
        } catch (_) {}
        try { e.target.setPointerCapture?.(e.pointerId); } catch (_) {}
        e.stopPropagation();
        setInteractionState('dragging');
        return;
      }

      // UX 2026-04-20: respect Shift-click so shape + callout can be
      // multi-selected in EITHER order. Previously clicking any callout
      // wiped the shape selection and replaced the callout set with just
      // this one, making it impossible to start with a shape and add a
      // callout via Shift-click — you always had to start with the
      // callout. Shift held now: toggle this callout into the existing
      // callout set, keep shapes. No Shift: replace (previous behavior).
      if (e.shiftKey) {
        if (onSelectedCalloutIdsChange) {
          const nextCallouts = new Set(selectedCalloutIds || []);
          if (nextCallouts.has(calloutId)) nextCallouts.delete(calloutId);
          else nextCallouts.add(calloutId);
          onSelectedCalloutIdsChange(nextCallouts);
        }
      } else {
        // UX: 2026-04-20 — Group auto-expand-on-click for callouts (callout
        // half of the same Stage 1 behavior wired into the annotation
        // pointerdown handler above). Plain (non-Shift) click on a callout
        // that already has a groupId AND is not already in the current
        // callout selection replaces both selections with every member of
        // that group on this page (annotations + callouts). This is what
        // makes clicking any one member of a group light up the whole group
        // automatically — the existing multi-select chrome paints the rest.
        const _calGid = getCalloutGroupId(callout);
        const _alreadySel = (selectedCalloutIds instanceof Set)
          ? selectedCalloutIds.has(calloutId)
          : Array.isArray(selectedCalloutIds) && selectedCalloutIds.indexOf(calloutId) >= 0;
        if (_calGid && !_alreadySel) {
          const members = findGroupMembers(annotations, callouts || [], [_calGid]);
          if (members.annotationIndices.length > 0 || members.calloutIds.length > 0) {
            setSelectedIds(new Set(members.annotationIndices));
            if (onSelectedCalloutIdsChange) {
              onSelectedCalloutIdsChange(new Set(members.calloutIds));
            }
            // Skip the normal single-callout select path below; group is
            // already selected. Drag still arms because the rest of this
            // branch executes (callout-part dragstate, etc.).
          } else if (onSelectedCalloutIdsChange) {
            // Defensive: groupId set but no other members found (orphan).
            // Fall through to normal single-callout select.
            onSelectedCalloutIdsChange(new Set([calloutId]));
            deselectAll();
          }
        } else {
          if (onSelectedCalloutIdsChange) {
            onSelectedCalloutIdsChange(new Set([calloutId]));
          }
          deselectAll();
        }
      }

      // UX: cache ctm inverse + start pointer for the pointermove branch.
      // Mirrors handleAnnotationPointerDown's pattern.
      const ctm = svgRef.current?.getScreenCTM();
      const ctmInverse = ctm ? ctm.inverse() : null;
      const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);

      // Snapshot the callout's normalized coords for whole-move delta math.
      // Integer-clean copy (spread) so downstream pointermove math reads
      // the original positions, not a mutable reference into React state.
      //
      // UX: Phase 15 UAT-3 — snapshot also captures textBoxWidth/Height so
      // the distance-rule validator on pointermove can compute the textbox
      // rect without a callout array lookup (onUpdateCalloutLive has mutated
      // React state by then; lookups would drift).
      const originalSnapshot = {
        arrowTip: { ...callout.arrowTip },
        knee: { ...callout.knee },
        textBoxPosition: { ...callout.textBoxPosition },
        textBoxWidth: callout.textBoxWidth,
        textBoxHeight: callout.textBoxHeight,
        // UX: 2026-05-18 — capture fontSize so the distance-rule validator can
        // extend the textbox rect by the descender buffer (fontSize * 0.35)
        // the renderer adds. Without it the bottom edge the rules measure
        // against is shorter than the box the user sees.
        fontSize: callout.style?.fontSize,
      };
      dragStateRef.current = {
        ...dragStateRef.current,
        active: true,
        mode: 'callout-part',
        partType,
        textBoxCorner,           // 'tl' | 'tr' | 'bl' | 'br' | null
        calloutId,
        startSVGPoint: svgPoint,
        ctmInverse,
        originalCalloutPositions: originalSnapshot,
        // UX: seed the last-safe snapshot with the drag-start positions so
        // the first frame that violates a rule rolls back to the known-good
        // starting state instead of an undefined fallback.
        lastSafeCalloutPositions: {
          arrowTip: { ...callout.arrowTip },
          knee: { ...callout.knee },
          textBoxPosition: { ...callout.textBoxPosition },
        },
      };
      try { e.target.setPointerCapture?.(e.pointerId); } catch (_) { /* pointer capture optional */ }
      e.stopPropagation();
      setInteractionState('dragging');
      setActiveCalloutDrag({ id: calloutId, partType });
      return;
    }

    // Not a callout — empty-space branch.
    //
    // UX: Phase 19 follow-up — when there is a multi-selection and the
    // empty-space click lands INSIDE the group union bbox, start a
    // group-move drag instead of arming a marquee. Users expect to be
    // able to grab the group from anywhere inside its outer dashed box,
    // not only by clicking a specific member. Shift-click on empty space
    // keeps marquee semantics (union-adding a new region). Clicks outside
    // the union bbox fall through to the marquee branch below.
    if (
      e.target === svgRef.current &&
      activeTool === 'select' &&
      !e.shiftKey &&
      selectedIds.size > 1 &&
      annotations?.objects
    ) {
      const bboxes = [];
      for (const selIdx of selectedIds) {
        const selObj = annotations.objects[selIdx];
        if (selObj) bboxes.push(getAnnotationBBox(selObj));
      }
      if (bboxes.length > 0) {
        const groupBBox = getGroupBBox(bboxes);
        const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
        const insideGroup =
          svgPoint.x >= groupBBox.left &&
          svgPoint.x <= groupBBox.left + groupBBox.width &&
          svgPoint.y >= groupBBox.top &&
          svgPoint.y <= groupBBox.top + groupBBox.height;
        if (insideGroup) {
          const ctm = svgRef.current?.getScreenCTM();
          const ctmInverse = ctm ? ctm.inverse() : null;
          const originals = {};
          for (const selIdx of selectedIds) {
            const selObj = annotations.objects[selIdx];
            if (!selObj) continue;
            if (isImportedPath(selObj)) {
              const selBBox = getAnnotationBBox(selObj);
              originals[selIdx] = { left: selBBox.left, top: selBBox.top };
            } else {
              originals[selIdx] = { left: selObj.left ?? 0, top: selObj.top ?? 0 };
            }
          }
          dragStateRef.current = {
            active: true,
            mode: 'group-move',
            handleId: null,
            startSVGPoint: svgPoint,
            originalProps: null,
            annotationIndex: null,
            ctmInverse,
            anchorX: null,
            anchorY: null,
            centerX: null,
            centerY: null,
            currentResize: null,
            currentAngle: undefined,
            groupOriginals: originals,
          };
          try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch (_) { /* pointer capture optional */ }
          setInteractionState('dragging');
          e.stopPropagation();
          return;
        }
      }
    }

    // UX: Phase 19 — AutoCAD marquee. When the Select tool is active and
    // the click originated on the SVG root itself (truly empty space),
    // start tracking a potential marquee. The rect is NOT drawn until the
    // pointer crosses the 5 px min-drag threshold in handlePointerMove, so
    // sub-threshold clicks still behave like plain empty-space clicks and
    // fall through to the existing deselect-on-release path. Shift is
    // captured here so the release handler can decide replace vs union.
    if (e.target === svgRef.current && activeTool === 'select') {
      const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
      applyMarqueeState({
        startX: svgPoint.x,
        startY: svgPoint.y,
        endX: svgPoint.x,
        endY: svgPoint.y,
        shiftHeld: !!e.shiftKey,
        // UX: Phase 19 follow-up — Alt held while dragging the marquee
        // removes hits from the current selection (subtract mode). If
        // both Shift and Alt are held, Alt wins; the release handler
        // below decides replace vs union vs subtract.
        altHeld: !!e.altKey,
        active: false,
        pointerId: e.pointerId,
      });
      try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch (_) { /* pointer capture optional */ }
      // Intentionally no deselectAll() here. If the user releases under
      // the threshold, handlePointerUp runs the click-style deselect.
      return;
    }

    // Not select tool (or tool didn't match) — existing deselect behavior.
    if (e.target === svgRef.current) {
      deselectAll();
    }
  }, [svgRef, deselectAll, callouts, onSelectedCalloutIdsChange, selectedCalloutIds, activeTool, selectionMode, applyMarqueeState, applyLassoState, cancelLasso, pageWidth, pageHeight, selectedIds, annotations]);

  /**
   * Pointer move on root SVG: update visual transform during drag.
   * Uses CACHED ctmInverse from drag start (per RESEARCH.md Pitfall 1).
   */
  const handlePointerMove = useCallback((e) => {
    const lasso = lassoStateRef.current;
    if (lasso) {
      if (e.pointerId !== lasso.pointerId) return;
      const sourceEvents = getLassoPointerSamples(e);
      const nextPoints = [...lasso.points];
      for (const sourceEvent of sourceEvents) {
        const raw = screenToSVG(svgRef.current, sourceEvent.clientX, sourceEvent.clientY);
        const point = {
          x: Math.max(0, Math.min(pageWidth, raw.x)),
          y: Math.max(0, Math.min(pageHeight, raw.y)),
        };
        if (shouldSampleLassoPoint(nextPoints.at(-1), point, inverseScale)) nextPoints.push(point);
        if (nextPoints.length >= 2048) break;
      }
      if (nextPoints.length === lasso.points.length) return;
      applyLassoState({
        ...lasso,
        points: nextPoints,
        mode: lasso.mode || getLassoModeFromTrail(nextPoints),
      });
      e.preventDefault();
      return;
    }
    // UX: Phase 19 — marquee update path. When a marquee is tracking,
    // update the end point, clamp to the page's viewBox (so the rect
    // can't escape the page), and flip `active` once we cross the 5 px
    // min-drag threshold. Short-circuits before annotation drag math.
    const mq = marqueeStateRef.current;
    if (mq) {
      const pt = screenToSVG(svgRef.current, e.clientX, e.clientY);
      const clampedX = Math.max(0, Math.min(pageWidth, pt.x));
      const clampedY = Math.max(0, Math.min(pageHeight, pt.y));
      const dx = Math.abs(clampedX - mq.startX);
      const dy = Math.abs(clampedY - mq.startY);
      const next = {
        ...mq,
        endX: clampedX,
        endY: clampedY,
        active: mq.active || dx >= MARQUEE_MIN_DRAG_PX || dy >= MARQUEE_MIN_DRAG_PX,
      };
      applyMarqueeState(next);
      return;
    }

    const ds = dragStateRef.current;
    if (!ds.active) return;
    if (ds.mode === 'text-markup-horizontal' && e.pointerId !== ds.pointerId) return;

    // KAL-75 (G4): locked/read-only documents — a drag gesture must never
    // mutate geometry. Disarm in place: pointer-up then takes its non-drag
    // (click-style) path and commits nothing. Selection itself stays live
    // (copy is a read affordance).
    if (document.body.getAttribute('data-readonly') === 'true') {
      dragStateRef.current.active = false;
      return;
    }
    if (!ds.diagGestureId) {
      const targetObj = annotations?.objects?.[ds.annotationIndex];
      ds.diagGestureId = beginAnnotationGesture({
        surface: 'SVGAnnotationLayer',
        tool: activeTool || targetObj?.tool || targetObj?.data?.type || targetObj?.type || null,
        type: targetObj?.data?.type || targetObj?.type || (ds.calloutId ? 'callout' : 'annotation'),
        action: ds.mode,
        annotationId: ds.calloutId || targetObj?.id || targetObj?.data?.id || ds.annotationIndex,
        pointerDown: true,
      });
    }
    markAnnotationPreviewFrame(ds.diagGestureId, {
      action: ds.mode,
      handleId: ds.handleId || null,
      partType: ds.partType || null,
    });

    // Convert current pointer position to SVG coords using CACHED ctmInverse
    const pt = new DOMPoint(e.clientX, e.clientY);
    const svgPoint = ds.ctmInverse
      ? pt.matrixTransform(ds.ctmInverse)
      : screenToSVG(svgRef.current, e.clientX, e.clientY);

    if (ds.mode === 'move') {
      const dx = svgPoint.x - ds.startSVGPoint.x;
      const dy = svgPoint.y - ds.startSVGPoint.y;
      // UX 2026-04-20: mid-drag Shift on a counter swaps to orbit mode,
      // matching the creation-time "slide → Shift-twist → slide" pattern.
      // Commit the accumulated move as a 'skip' checkpoint so the counter
      // snaps to the dragged-to spot (no visible jump) and compute the tip
      // from the new body center as the orbit anchor.
      const mvObj = annotations?.objects?.[ds.annotationIndex];
      if (e.shiftKey && mvObj?.data?.type === 'counter') {
        const radius = (mvObj.radius || 14) * Math.abs(mvObj.scaleX || 1);
        const newLeft = (ds.originalProps?.left ?? mvObj.left ?? 0) + dx;
        const newTop = (ds.originalProps?.top ?? mvObj.top ?? 0) + dy;
        const bodyX = newLeft + radius;
        const bodyY = newTop + radius;
        const pointerAngleDeg = mvObj.data.pointerAngle != null ? mvObj.data.pointerAngle : 225;
        const rad = (pointerAngleDeg * Math.PI) / 180;
        const tipExtension = radius * 0.5;
        const tipDistance = radius + tipExtension;
        const tipX = bodyX + Math.cos(rad) * tipDistance;
        const tipY = bodyY + Math.sin(rad) * tipDistance;
        const updatedAnnotations = cloneAnnotations(annotations);
        const targetObj = updatedAnnotations.objects?.[ds.annotationIndex];
        if (targetObj) {
          targetObj.left = newLeft;
          targetObj.top = newTop;
          ds.currentAnnotations = updatedAnnotations;
          setVisualTransform({
            id: ds.annotationIndex,
            dx: 0,
            dy: 0,
            previewObjects: { [ds.annotationIndex]: targetObj },
          });
        }
        ds.mode = 'counter-orbit';
        ds.anchorX = tipX;
        ds.anchorY = tipY;
        ds.counterRadius = radius;
        ds.counterTipDistance = tipDistance;
        setVisualTransform(null);
        setInteractionState('rotating');
        return;
      }
      // Visual-only update via state (no annotation data mutation during drag)
      setVisualTransform({ id: ds.annotationIndex, dx, dy });
      setInteractionState('dragging');
    } else if (ds.mode === 'counter-orbit') {
      // UX 2026-04-20: releasing Shift mid-orbit swaps back to move mode.
      // Commit the current orbit pose as 'skip' so obj.left/top reflect
      // the swung body, then start a fresh move drag from here — no jump.
      if (!e.shiftKey) {
        const orbObj = ds.currentAnnotations?.objects?.[ds.annotationIndex]
          || annotations?.objects?.[ds.annotationIndex];
        if (orbObj?.data?.type === 'counter') {
          ds.mode = 'move';
          ds.startSVGPoint = { x: svgPoint.x, y: svgPoint.y };
          ds.originalProps = {
            left: orbObj.left ?? 0,
            top: orbObj.top ?? 0,
            scaleX: orbObj.scaleX ?? 1,
            scaleY: orbObj.scaleY ?? 1,
            angle: orbObj.angle ?? 0,
            width: orbObj.width ?? 0,
            height: orbObj.height ?? 0,
          };
          setVisualTransform({ id: ds.annotationIndex, dx: 0, dy: 0 });
          setInteractionState('dragging');
          return;
        }
      }
      // Shift is still held — run the orbit math.
      const odx = svgPoint.x - ds.anchorX;
      const ody = svgPoint.y - ds.anchorY;
      const odist = Math.hypot(odx, ody);
      if (odist < 0.001) {
        setInteractionState('rotating');
        return;
      }
      const dirX = odx / odist;
      const dirY = ody / odist;
      const newBodyX = ds.anchorX + ds.counterTipDistance * dirX;
      const newBodyY = ds.anchorY + ds.counterTipDistance * dirY;
      const newAngleDeg = ((Math.atan2(-dirY, -dirX) * 180 / Math.PI) + 360) % 360;
      const updatedAnnotations = cloneAnnotations(ds.currentAnnotations || annotations);
      const targetObj = updatedAnnotations.objects?.[ds.annotationIndex];
      if (targetObj) {
        targetObj.left = newBodyX - ds.counterRadius;
        targetObj.top = newBodyY - ds.counterRadius;
        targetObj.data = { ...(targetObj.data || {}), pointerAngle: newAngleDeg };
        ds.currentAnnotations = updatedAnnotations;
        setVisualTransform({
          id: ds.annotationIndex,
          dx: 0,
          dy: 0,
          previewObjects: { [ds.annotationIndex]: targetObj },
        });
      }
      setInteractionState('rotating');
    } else if (ds.mode === 'group-move') {
      // Group drag: compute totalDelta from start (not frameDelta) to prevent drift
      const dx = svgPoint.x - ds.startSVGPoint.x;
      const dy = svgPoint.y - ds.startSVGPoint.y;
      // UX: 2026-04-20 v2 — callouts now ride the same render-time
      // translate as annotations via affectedCalloutIds. This kills the
      // visible lag where callouts trailed behind shapes because their
      // setCallouts-driven live updates had to round-trip through App.jsx
      // every frame. Now the renderer wraps each affected callout in a
      // translate transform synchronously, identical to annotations.
      // Commit happens once on pointerup.
      const affectedCalloutIdsSet = ds.groupCalloutOriginals
        ? new Set(Object.keys(ds.groupCalloutOriginals))
        : null;
      setVisualTransform({
        id: 'group', // special sentinel for group drag
        dx, dy,
        affectedIds: new Set(Object.keys(ds.groupOriginals).map(Number)),
        affectedCalloutIds: affectedCalloutIdsSet,
      });
      // Throttled diag — same 120ms cadence as group rotate/resize.
      const nowMs3 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const lastLog3 = ds.lastGroupMoveLogAt || 0;
      if (!lastLog3 || nowMs3 - lastLog3 >= 120) {
        ds.lastGroupMoveLogAt = nowMs3;
        try {
          diagLog('[GroupTransformDiag] move ' + JSON.stringify({
            ts: new Date().toISOString(),
            pointerSVG: { x: svgPoint.x, y: svgPoint.y },
            pageDelta: { x: dx, y: dy },
            annotationIds: Object.keys(ds.groupOriginals || {}),
            calloutIds: ds.groupCalloutOriginals ? Object.keys(ds.groupCalloutOriginals) : [],
          }));
        } catch (_) {}
      }
      setInteractionState('dragging');
    } else if (ds.mode === 'group-rotate' && ds.groupMemberOriginals && ds.groupUnionOriginal) {
      // UX: 2026-04-20 — Group rotation. Each member's CENTER orbits around
      // the union bbox center by the live deltaAngle, AND each member's own
      // angle picks up the same delta so the whole group rotates as a rigid
      // frame. Counter pin: data.pointerAngle also picks up the delta so
      // the nub rotates with the group exactly like a regular shape (per
      // user spec 2026-04-20). Lines: endpoints + curvature midpoint
      // rotated around the same pivot.
      const cur = normalizeAngle(Math.atan2(svgPoint.y - ds.centerY, svgPoint.x - ds.centerX));
      let delta = cur - (ds.groupStartAngle || 0);
      // Soft Shift snap to nearest 15° within 3° threshold (gentler than
      // single-shape's 45° because group rotations are usually finer).
      if (e.shiftKey) {
        const snapped = Math.round(delta / 15) * 15;
        if (Math.abs(delta - snapped) <= 3) delta = snapped;
      }
      const rad = (delta * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const pivotX = ds.centerX;
      const pivotY = ds.centerY;

      const updatedAnnotations = cloneAnnotations(annotations);
      for (const idxStr of Object.keys(ds.groupMemberOriginals)) {
        const idx = Number(idxStr);
        const orig = ds.groupMemberOriginals[idxStr];
        const target = updatedAnnotations.objects?.[idx];
        if (!target || !orig) continue;
        const objType = orig.objType;

        // Helper: rotate a single point around (pivotX, pivotY) by delta.
        const rotPt = (x, y) => {
          const dx_ = x - pivotX;
          const dy_ = y - pivotY;
          return { x: pivotX + dx_ * cos - dy_ * sin, y: pivotY + dx_ * sin + dy_ * cos };
        };

        if (objType === 'line') {
          // UX: 2026-04-21 — Line rotation needs WORLD endpoints, not the
          // raw stored values. The line renderer paints at
          // (obj.x1 + obj.left, obj.y1 + obj.top), so after a prior group-
          // move bumps obj.left/top, the raw x1/y1 numbers no longer match
          // the visible world position. Rotating the raw values around the
          // group pivot would land the line in a wrong spot (visible bug:
          // after rotate-then-move, the second rotate flings the line out
          // of alignment with the rest of the group).
          // Fix: convert to world before rotating, then bake the rotated
          // world endpoints back as raw values with obj.left/top reset to
          // zero. The line's curvature midpoint is already absolute world
          // coords, so it rotates directly.
          if (orig.x1 != null && orig.y1 != null && orig.x2 != null && orig.y2 != null) {
            const wx1 = orig.x1 + (orig.left || 0);
            const wy1 = orig.y1 + (orig.top || 0);
            const wx2 = orig.x2 + (orig.left || 0);
            const wy2 = orig.y2 + (orig.top || 0);
            const p1 = rotPt(wx1, wy1);
            const p2 = rotPt(wx2, wy2);
            target.left = 0;
            target.top = 0;
            target.x1 = p1.x; target.y1 = p1.y;
            target.x2 = p2.x; target.y2 = p2.y;
          }
          if (orig.midpoint) {
            const m = rotPt(orig.midpoint.x, orig.midpoint.y);
            target.data = { ...(target.data || {}), midpoint: { x: m.x, y: m.y } };
          }
          // For arrows + curved lines the rendered tangent reads from the
          // endpoints, so no separate angle update needed for line/arrow.
        } else if (orig.dataType === 'counter') {
          // Counter pin: bubble center is at (left + radius, top + radius).
          const r = (orig.radius || 14) * Math.abs(orig.scaleX || 1);
          const ctrX = orig.left + r;
          const ctrY = orig.top + r;
          const newCtr = rotPt(ctrX, ctrY);
          target.left = newCtr.x - r;
          target.top = newCtr.y - r;
          // Nub rotates with the group — add delta to data.pointerAngle.
          // pointerAngle is in 3-o'clock-based degrees (0 = right, 90 = down).
          // Group delta is in same units, just add and normalize.
          const basePa = orig.pointerAngle != null ? orig.pointerAngle : 225;
          target.data = { ...(target.data || {}), pointerAngle: ((basePa + delta) % 360 + 360) % 360 };
        } else {
          // Generic shape (rect, ellipse, circle, text, image, polygon,
          // imported path, etc.): orbit each shape's RENDERER rotation
          // pivot around the union center by delta, then translate the
          // shape by (newPivot - origPivot). The renderer rotation pivot
          // (captured as rotPivotX/Y) is what the shape spins around when
          // obj.angle changes, so making the orbit math use that exact
          // point keeps the rigid-frame motion clean for already-rotated
          // shapes (where the visible AABB center and the renderer pivot
          // differ). obj.angle picks up the delta the same way a single-
          // shape rotate would.
          const newPiv = rotPt(orig.rotPivotX, orig.rotPivotY);
          const dx = newPiv.x - orig.rotPivotX;
          const dy = newPiv.y - orig.rotPivotY;
          target.left = orig.left + dx;
          target.top = orig.top + dy;
          target.angle = ((orig.angle || 0) + delta);
        }
      }

      ds.currentAnnotations = updatedAnnotations;
      ds.currentAngle = delta;
      // UX: 2026-04-20 v2 — broadcast group-rotate state so the multi-
      // select chrome can render its outer dashed bbox as a RIGID FRAME
      // rotating with the shapes. Without this, the bbox kept being
      // recomputed each render from the union of member world AABBs —
      // which grows as shapes rotate — making the bbox stretch instead
      // of rotate. Now the renderer reads visualTransform.groupRotate
      // and applies a single rotate transform to the snapshot bbox
      // (same trick as single-shape rotate via SVGSelectionOverlay).
      setVisualTransform({
        id: 'group',
        dx: 0, dy: 0,
        groupRotate: {
          angle: delta,
          pivotX,
          pivotY,
          snapshotBbox: ds.groupUnionOriginal,
        },
        previewObjects: buildPreviewObjects(updatedAnnotations, ds.groupMemberOriginals),
      });
      setInteractionState('rotating');

      // Throttled diag — 120ms cadence so user gets a few snapshots per drag
      // without flooding the log buffer.
      const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const lastLog = ds.lastGroupRotLogAt || 0;
      if (!lastLog || nowMs - lastLog >= 120) {
        ds.lastGroupRotLogAt = nowMs;
        try {
          diagLog('[GroupTransformDiag] rotate-move ' + JSON.stringify({
            ts: new Date().toISOString(),
            pointerSVG: { x: svgPoint.x, y: svgPoint.y },
            currentAngleDeg: cur,
            startAngleDeg: ds.groupStartAngle,
            deltaDeg: delta,
            pivot: { x: pivotX, y: pivotY },
            shiftSnap: !!e.shiftKey,
            memberSnapshots: Object.keys(ds.groupMemberOriginals).reduce((acc, idxStr) => {
              const idx = Number(idxStr);
              const t = updatedAnnotations.objects?.[idx];
              if (!t) return acc;
              acc[idx] = {
                left: t.left, top: t.top, angle: t.angle,
                x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2,
                pointerAngle: t.data?.pointerAngle,
              };
              return acc;
            }, {}),
          }));
        } catch (_) {}
      }
    } else if (ds.mode === 'group-resize' && ds.groupMemberOriginals && ds.groupUnionOriginal) {
      // UX: 2026-04-20 — Group resize. Anchor at the opposite corner/edge
      // from the dragged handle. Compute (sx, sy) by comparing the live
      // pointer-to-anchor distance against the original handle-to-anchor
      // distance along each axis. Each member's center scales relative to
      // the anchor, and each member's geometry (width/height/scale) scales
      // by the same factor so the layout stays consistent — exactly like
      // each shape had its own bbox getting the same stretch.
      //
      // UX: 2026-04-21 v7 — When the group has a persisted rotation, do
      // all scale math in the ROTATED FRAME'S LOCAL axes, not the world
      // axes. Otherwise dragging the tilted "middle-right" handle would
      // scale the shapes along world X, which visually looks like the
      // group gets dragged sideways while stretching. We rotate the
      // pointer + anchor + each shape's captured center into the frame's
      // local (un-rotated) space, compute the scale there, then rotate
      // the resulting center back to world. Shape scaleX/Y multipliers
      // ride along as before — correct when each shape rotated with the
      // group, imperfect but tolerable when a member had its own pre-
      // rotation relative to the group.
      const persist = ds.groupResizePersist || null;
      const hasPersistRot = !!(persist && persist.angle);
      const rad = hasPersistRot ? (persist.angle * Math.PI) / 180 : 0;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      const toLocal = (px, py) => {
        if (!hasPersistRot) return { x: px, y: py };
        const dx = px - persist.pivotX;
        const dy = py - persist.pivotY;
        return {
          x: persist.pivotX + dx * cosR + dy * sinR,
          y: persist.pivotY - dx * sinR + dy * cosR,
        };
      };
      const toWorld = (lx, ly) => {
        if (!hasPersistRot) return { x: lx, y: ly };
        const dx = lx - persist.pivotX;
        const dy = ly - persist.pivotY;
        return {
          x: persist.pivotX + dx * cosR - dy * sinR,
          y: persist.pivotY + dx * sinR + dy * cosR,
        };
      };

      const ax = ds.anchorX;
      const ay = ds.anchorY;
      const u = ds.groupUnionOriginal;

      // Reference frame for computing sx/sy. When a persisted rotation
      // exists, the "original handle" + "anchor" live on the tilted frame
      // in world coords; their LOCAL positions are the un-rotated frame's
      // edges. Compute in local so the ratio is axis-aligned in that
      // frame.
      const anchorLocal = toLocal(ax, ay);
      const pointerLocal = toLocal(svgPoint.x, svgPoint.y);

      // Original handle position relative to anchor along each local axis.
      // For a persisted-rotation resize, rebuild the un-rotated frame's
      // edges from the captured snapshot (centered on pivot, snap dims).
      let origHx;
      let origHy;
      if (hasPersistRot) {
        const halfW = persist.snapW / 2;
        const halfH = persist.snapH / 2;
        const handleOffset = {
          tl: { x: -halfW, y: -halfH }, tr: { x: halfW, y: -halfH },
          bl: { x: -halfW, y: halfH },  br: { x: halfW, y: halfH },
          ml: { x: -halfW, y: 0 },      mr: { x: halfW, y: 0 },
          mt: { x: 0, y: -halfH },      mb: { x: 0, y: halfH },
        }[ds.handleId] || { x: halfW, y: 0 };
        origHx = persist.pivotX + handleOffset.x;
        origHy = persist.pivotY + handleOffset.y;
      } else {
        // Un-rotated path: original handle lives at the world-axis edge.
        const handleWorld = {
          tl: { x: u.left, y: u.top },     tr: { x: u.right, y: u.top },
          bl: { x: u.left, y: u.bottom },  br: { x: u.right, y: u.bottom },
          ml: { x: u.left, y: (u.top + u.bottom) / 2 },
          mr: { x: u.right, y: (u.top + u.bottom) / 2 },
          mt: { x: (u.left + u.right) / 2, y: u.top },
          mb: { x: (u.left + u.right) / 2, y: u.bottom },
        }[ds.handleId] || { x: u.right, y: (u.top + u.bottom) / 2 };
        origHx = handleWorld.x;
        origHy = handleWorld.y;
      }
      const origDx = (origHx - anchorLocal.x) || 1;
      const origDy = (origHy - anchorLocal.y) || 1;
      // Affected axes per handle ID.
      const affectsX = !['mt', 'mb'].includes(ds.handleId);
      const affectsY = !['ml', 'mr'].includes(ds.handleId);
      // Live pointer offsets in LOCAL coords (sign preserves drag direction).
      const liveDx = pointerLocal.x - anchorLocal.x;
      const liveDy = pointerLocal.y - anchorLocal.y;
      // Compute scale factors. For uniform corners, optionally Shift-lock
      // to uniform scale by averaging |sx| and |sy|.
      let sx = affectsX ? (origDx === 0 ? 1 : liveDx / origDx) : 1;
      let sy = affectsY ? (origDy === 0 ? 1 : liveDy / origDy) : 1;
      const groupContainsPath = Object.values(ds.groupMemberOriginals).some(
        (member) => member?.objType === 'path',
      );
      // Imported/legacy paths preserve the exact requested page affine,
      // including signed sub-0.05 scales. A group containing one must use
      // that same affine for every member or the group tears apart.
      if (!groupContainsPath) {
        if (Math.abs(sx) < 0.05) sx = (sx < 0 ? -0.05 : 0.05);
        if (Math.abs(sy) < 0.05) sy = (sy < 0 ? -0.05 : 0.05);
      }
      // Shift = uniform scale on corner handles.
      if (e.shiftKey && affectsX && affectsY) {
        const avg = (Math.abs(sx) + Math.abs(sy)) / 2;
        sx = avg * (sx < 0 ? -1 : 1);
        sy = avg * (sy < 0 ? -1 : 1);
      }
      if (groupContainsPath) {
        if (sx === 0) sx = Number.MIN_VALUE;
        if (sy === 0) sy = Number.MIN_VALUE;
      }

      // Helper: take a WORLD point (wx, wy), rotate into local frame, scale
      // around the LOCAL anchor by (sx, sy), then rotate back to world.
      // For un-rotated groups this collapses to the pre-v7 world-axis math.
      const scalePoint = (wx, wy) => {
        const loc = toLocal(wx, wy);
        const scaledX = anchorLocal.x + (loc.x - anchorLocal.x) * sx;
        const scaledY = anchorLocal.y + (loc.y - anchorLocal.y) * sy;
        return toWorld(scaledX, scaledY);
      };
      const transformedOrigin = scalePoint(0, 0);
      const transformedUnitX = scalePoint(1, 0);
      const transformedUnitY = scalePoint(0, 1);
      const groupPageMatrix = [
        transformedUnitX.x - transformedOrigin.x,
        transformedUnitX.y - transformedOrigin.y,
        transformedUnitY.x - transformedOrigin.x,
        transformedUnitY.y - transformedOrigin.y,
        transformedOrigin.x,
        transformedOrigin.y,
      ];

      const updatedAnnotations = cloneAnnotations(annotations);
      for (const idxStr of Object.keys(ds.groupMemberOriginals)) {
        const idx = Number(idxStr);
        const orig = ds.groupMemberOriginals[idxStr];
        const target = updatedAnnotations.objects?.[idx];
        if (!target || !orig) continue;
        const objType = orig.objType;

        if (objType === 'path' && Array.isArray(target.path)) {
          Object.assign(
            target,
            applyPageAffineToInkObject(
              annotations?.objects?.[idx] || target,
              groupPageMatrix,
            ),
          );
        } else if (objType === 'line') {
          // UX: 2026-04-21 — Same world-vs-local-endpoint fix as group-
          // rotate. Lines render at (x1 + left, y1 + top); rescaling the
          // raw values around the anchor breaks if obj.left/top is non-
          // zero. Convert to world, scale (in local rotated frame when a
          // persisted rotation exists), then write back with left/top
          // reset to zero.
          if (orig.x1 != null && orig.y1 != null && orig.x2 != null && orig.y2 != null) {
            const wx1 = orig.x1 + (orig.left || 0);
            const wy1 = orig.y1 + (orig.top || 0);
            const wx2 = orig.x2 + (orig.left || 0);
            const wy2 = orig.y2 + (orig.top || 0);
            const p1 = scalePoint(wx1, wy1);
            const p2 = scalePoint(wx2, wy2);
            target.left = 0;
            target.top = 0;
            target.x1 = p1.x; target.y1 = p1.y;
            target.x2 = p2.x; target.y2 = p2.y;
          }
          if (orig.midpoint) {
            const mp = scalePoint(orig.midpoint.x, orig.midpoint.y);
            target.data = { ...(target.data || {}), midpoint: { x: mp.x, y: mp.y } };
          }
        } else if (orig.dataType === 'counter') {
          // Counter pin: scale center position; scale radius by uniform avg
          // (counter is circular, so non-uniform scale would break the
          // bubble). Nub direction unchanged.
          const r = (orig.radius || 14) * Math.abs(orig.scaleX || 1);
          const ctrX = orig.left + r;
          const ctrY = orig.top + r;
          const newCtr = scalePoint(ctrX, ctrY);
          const radScale = Math.max(0.05, (Math.abs(sx) + Math.abs(sy)) / 2);
          const newR = (orig.radius || 14) * Math.abs(orig.scaleX || 1) * radScale;
          target.left = newCtr.x - newR;
          target.top = newCtr.y - newR;
          target.scaleX = 1;
          target.scaleY = 1;
          target.radius = newR;
        } else {
          // UX: 2026-04-21 v9 — scale the shape's VISIBLE CENTER in world
          // (not its origin directly). Then back out the new origin so
          // that `origin + rotate(offset) = visible_center_new`. This
          // handles rotated individual shapes: simply scaling the origin
          // in world leaves a residue equal to the rotation-scale
          // commutator, which the user saw as "shapes colliding at
          // intermediate angles" — the residue is zero at 0°/180° but
          // grows as the shape's angle moves off those. For un-rotated
          // shapes this reduces to the v8 origin-scale formula.
          const orig_offset_x = orig.aabbCenterX - orig.left;
          const orig_offset_y = orig.aabbCenterY - orig.top;
          const angleRad = ((orig.angle || 0) * Math.PI) / 180;
          const cA = Math.cos(angleRad);
          const sA = Math.sin(angleRad);
          // Un-rotate offset into shape's local bbox frame.
          const localOffX = cA * orig_offset_x + sA * orig_offset_y;
          const localOffY = -sA * orig_offset_x + cA * orig_offset_y;
          // Scale local offset by (sx, sy) — this matches the
          // scaleX/scaleY multipliers we're about to apply to the shape.
          const scaledLocalOffX = localOffX * sx;
          const scaledLocalOffY = localOffY * sy;
          // Rotate scaled local offset back to world.
          const newOffsetX = cA * scaledLocalOffX - sA * scaledLocalOffY;
          const newOffsetY = sA * scaledLocalOffX + cA * scaledLocalOffY;
          // Scale the visible center in world, then derive the new
          // origin so the shape's `origin + rotated(offset)` formula
          // reproduces the expected new visible center.
          const newVisible = scalePoint(orig.aabbCenterX, orig.aabbCenterY);
          target.left = newVisible.x - newOffsetX;
          target.top = newVisible.y - newOffsetY;
          target.scaleX = (orig.scaleX || 1) * Math.abs(sx);
          target.scaleY = (orig.scaleY || 1) * Math.abs(sy);
        }
      }

      ds.currentAnnotations = updatedAnnotations;
      ds.currentResize = { sx, sy, ax, ay };

      // UX: 2026-04-21 v7 — broadcast groupResize so the renderer can
      // redraw the outer dashed frame (a) with the current scaled
      // dimensions and (b) at the correct new center, while keeping the
      // persisted rotation angle applied. Without this, during a resize
      // on a rotated group the frame would stay stuck at the pre-resize
      // snapshot (because we deliberately DON'T clear persisted rotation
      // on resize start — the user wants the tilt to hold).
      if (hasPersistRot) {
        const newCenterLocalX = anchorLocal.x + (persist.pivotX - anchorLocal.x) * sx;
        const newCenterLocalY = anchorLocal.y + (persist.pivotY - anchorLocal.y) * sy;
        const newCenterWorld = toWorld(newCenterLocalX, newCenterLocalY);
        setVisualTransform({
          id: 'group',
          dx: 0, dy: 0,
          groupResize: {
            angle: persist.angle,
            pivotX: persist.pivotX,
            pivotY: persist.pivotY,
            centerX: newCenterWorld.x,
            centerY: newCenterWorld.y,
            width: Math.abs(persist.snapW * sx),
            height: Math.abs(persist.snapH * sy),
          },
          previewObjects: buildPreviewObjects(updatedAnnotations, ds.groupMemberOriginals),
        });
      } else {
        setVisualTransform({
          id: 'group',
          dx: 0,
          dy: 0,
          previewObjects: buildPreviewObjects(updatedAnnotations, ds.groupMemberOriginals),
        });
      }

      setInteractionState('resizing');

      const nowMs2 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const lastLog2 = ds.lastGroupResLogAt || 0;
      if (!lastLog2 || nowMs2 - lastLog2 >= 120) {
        ds.lastGroupResLogAt = nowMs2;
        try {
          // Compute live frame corners (where the outer dashed box is
          // drawing) and live shape visible centers (where Fabric will
          // paint each shape) so a post-mortem log can tell us whether
          // shape and frame drift apart mid-drag or only at commit.
          const frameCenter = hasPersistRot ? (() => {
            const ncLX = anchorLocal.x + (persist.pivotX - anchorLocal.x) * sx;
            const ncLY = anchorLocal.y + (persist.pivotY - anchorLocal.y) * sy;
            return toWorld(ncLX, ncLY);
          })() : null;
          diagLog('[GroupTransformDiag] resize-move ' + JSON.stringify({
            ts: new Date().toISOString(),
            handleId: ds.handleId,
            hasPersistRot,
            persistAngle: hasPersistRot ? persist.angle : null,
            persistPivot: hasPersistRot ? { x: persist.pivotX, y: persist.pivotY } : null,
            anchor: { x: ax, y: ay },
            anchorLocal: hasPersistRot ? anchorLocal : null,
            pointerSVG: { x: svgPoint.x, y: svgPoint.y },
            pointerLocal: hasPersistRot ? pointerLocal : null,
            scaleFactors: { sx, sy },
            shiftUniform: !!(e.shiftKey && affectsX && affectsY),
            frameCenter,
            frameDims: hasPersistRot ? { w: Math.abs(persist.snapW * sx), h: Math.abs(persist.snapH * sy) } : null,
            memberSnapshots: Object.keys(ds.groupMemberOriginals).reduce((acc, idxStr) => {
              const idx = Number(idxStr);
              const orig = ds.groupMemberOriginals[idxStr];
              const t = updatedAnnotations.objects?.[idx];
              if (!t) return acc;
              const visCx = t.left + ((orig?.aabbWidth || 0) * (t.scaleX || 1)) / 2;
              const visCy = t.top + ((orig?.aabbHeight || 0) * (t.scaleY || 1)) / 2;
              acc[idx] = {
                type: t.type, angle: t.angle,
                left: t.left, top: t.top,
                scaleX: t.scaleX, scaleY: t.scaleY,
                x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2,
                radius: t.radius,
                estVisibleCenter: { x: visCx, y: visCy },
                origLeft: orig?.left, origTop: orig?.top,
                origAabbCenterX: orig?.aabbCenterX, origAabbCenterY: orig?.aabbCenterY,
              };
              return acc;
            }, {}),
          }));
        } catch (_) {}
      }
    } else if (ds.mode === 'vertex') {
      // UX 2026-04-20: polygon / polyline per-vertex drag. Invert the
      // polygon's transform chain (translate → rotate → scale → pathOffset)
      // so the pointer's world position maps back to the local-space point
      // we store in obj.points. Only the one point being dragged is
      // rewritten; the others stay frozen at their captured values.
      const { left, top, angle, scaleX, scaleY, pathOffsetX, pathOffsetY } = ds.originalProps;
      const pxs = ds.originalPoints.map((p) => p.x);
      const pys = ds.originalPoints.map((p) => p.y);
      const oldRawCx = (Math.min(...pxs) + Math.max(...pxs)) / 2;
      const oldRawCy = (Math.min(...pys) + Math.max(...pys)) / 2;
      const oldRotCx = scaleX * (oldRawCx - pathOffsetX);
      const oldRotCy = scaleY * (oldRawCy - pathOffsetY);
      const rad = (angle * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      // Step 1: subtract translate(left, top)
      const w1x = svgPoint.x - left;
      const w1y = svgPoint.y - top;
      // Step 2: un-rotate around old rotation center by -angle
      const ox = w1x - oldRotCx;
      const oy = w1y - oldRotCy;
      const w2x = oldRotCx + ox * cosA + oy * sinA;
      const w2y = oldRotCy - ox * sinA + oy * cosA;
      // Step 3: un-scale
      const sxSafe = scaleX || 1;
      const sySafe = scaleY || 1;
      const w3x = w2x / sxSafe;
      const w3y = w2y / sySafe;
      // Step 4: re-apply pathOffset to get local point coord
      const localX = w3x + pathOffsetX;
      const localY = w3y + pathOffsetY;

      const newPoints = ds.originalPoints.map((p) => ({ x: p.x, y: p.y }));
      newPoints[ds.vertexIndex] = { x: localX, y: localY };

      // UX 2026-04-20: keep the world rotation pivot anchored when a vertex
      // moves on a ROTATED polygon. The renderer re-derives rotCenter from
      // obj.points on every render, so moving one vertex shifts the shape's
      // bbox centroid — which pulls the rotation pivot with it and drifts
      // the un-moved vertices. Compensate obj.left / obj.top so the world
      // rotation pivot stays fixed: delta_t = R(angle)*delta_rc - delta_rc.
      // At angle=0 this reduces to no shift (R is identity). For rotated
      // shapes it cancels out the pivot drift.
      const nxs = newPoints.map((p) => p.x);
      const nys = newPoints.map((p) => p.y);
      const newRawCx = (Math.min(...nxs) + Math.max(...nxs)) / 2;
      const newRawCy = (Math.min(...nys) + Math.max(...nys)) / 2;
      const newRotCx = scaleX * (newRawCx - pathOffsetX);
      const newRotCy = scaleY * (newRawCy - pathOffsetY);
      const drcX = newRotCx - oldRotCx;
      const drcY = newRotCy - oldRotCy;
      const rotatedDrcX = drcX * cosA - drcY * sinA;
      const rotatedDrcY = drcX * sinA + drcY * cosA;
      const newLeft = left + rotatedDrcX - drcX;
      const newTop = top + rotatedDrcY - drcY;

      const updatedAnnotations = cloneAnnotations(annotations);
      const targetObj = updatedAnnotations.objects[ds.annotationIndex];
      targetObj.points = newPoints;
      targetObj.left = newLeft;
      targetObj.top = newTop;
      ds.currentAnnotations = updatedAnnotations;
      setVisualTransform({
        id: ds.annotationIndex,
        dx: 0,
        dy: 0,
        previewObjects: { [ds.annotationIndex]: targetObj },
      });
      setInteractionState('dragging');
    } else if (ds.mode === 'endpoint') {
      // UX 2026-04-20: rotation + bbox-center-pivot endpoint drag with
      // Δ-pivot compensation so the non-dragged endpoint AND the curve
      // midpoint stay pinned in world even on a rotated curved line.
      //
      // Naming convention (every position is 2D):
      //   L*  = LOCAL (un-rotated) stored coords.
      //   W*  = WORLD (rendered) coords = rotate(L*, pivot, angle).
      //   pivotOld = curve-inclusive bbox center of the ORIGINAL shape.
      //   pivotNaive = same bbox formula applied to the naive new local
      //                points (before compensation); it drifts off
      //                pivotOld when endpoints change, and that drift
      //                is what rotates the un-dragged points off their
      //                world positions on a rotated curved line.
      //   shift = (R - I) · (pivotNaive - pivotOld): the in-place
      //           translation applied to ALL three local control
      //           points so that, after the bbox recomputes a second
      //           time and the renderer rotates around THAT new
      //           pivot, every un-dragged point renders back at its
      //           pre-drag world position. Formal derivation:
      //   rotate(p + shift, pivotNaive + shift, angle)
      //     = (pivotNaive + shift) + R·(p - pivotNaive)
      //     = pivotOld + R·(p - pivotOld)  [target world]
      //   solving for shift yields shift = (R - I)·(pivotNaive - pivotOld),
      //   matching the polygon-vertex compensation pattern.
      const ep = ds.originalEndpoints;
      const movingP1 = ds.handleId === 'p1';
      const endpointAngle = ds.originalProps?.angle || 0;
      const epRad = (endpointAngle * Math.PI) / 180;
      const epCosA = Math.cos(epRad);
      const epSinA = Math.sin(epRad);
      const pivotOld = computeLineBboxCenter(
        { x1: ep.x1, y1: ep.y1, x2: ep.x2, y2: ep.y2 },
        ds.originalMidpoint || null,
      );
      const rotAround = (px, py, cx, cy, cA, sA) => ({
        x: cx + (px - cx) * cA - (py - cy) * sA,
        y: cy + (px - cx) * sA + (py - cy) * cA,
      });
      // Old world positions of both endpoints (around pivotOld).
      const W1old = rotAround(ep.x1, ep.y1, pivotOld.x, pivotOld.y, epCosA, epSinA);
      const W2old = rotAround(ep.x2, ep.y2, pivotOld.x, pivotOld.y, epCosA, epSinA);
      const WMold = ds.originalMidpoint
        ? rotAround(ds.originalMidpoint.x, ds.originalMidpoint.y, pivotOld.x, pivotOld.y, epCosA, epSinA)
        : null;
      // Target world positions: dragged endpoint follows pointer; the
      // other endpoint + the curve midpoint stay exactly where the
      // user last saw them.
      const dxW_ep = svgPoint.x - ds.startSVGPoint.x;
      const dyW_ep = svgPoint.y - ds.startSVGPoint.y;
      const W1target = movingP1 ? { x: W1old.x + dxW_ep, y: W1old.y + dyW_ep } : W1old;
      const W2target = movingP1 ? W2old : { x: W2old.x + dxW_ep, y: W2old.y + dyW_ep };
      // Step 1: un-rotate targets around pivotOld to get NAIVE local
      // coords (before the pivot has re-landed on the new bbox center).
      const naiveP1 = rotAround(W1target.x, W1target.y, pivotOld.x, pivotOld.y, epCosA, -epSinA);
      const naiveP2 = rotAround(W2target.x, W2target.y, pivotOld.x, pivotOld.y, epCosA, -epSinA);
      const naiveMid = WMold
        ? rotAround(WMold.x, WMold.y, pivotOld.x, pivotOld.y, epCosA, -epSinA)
        : null;
      // Step 2: compute the new bbox center of the naive shape (this
      // is where the RENDERER will actually rotate around after the
      // live-save).
      const pivotNaive = computeLineBboxCenter(
        { x1: naiveP1.x, y1: naiveP1.y, x2: naiveP2.x, y2: naiveP2.y },
        naiveMid,
      );
      // Step 3: compensation shift = (R - I) · Δ where Δ = pivotNaive - pivotOld.
      const dX = pivotNaive.x - pivotOld.x;
      const dY = pivotNaive.y - pivotOld.y;
      const shiftX = (epCosA - 1) * dX - epSinA * dY;
      const shiftY = epSinA * dX + (epCosA - 1) * dY;
      // Step 4: apply shift to all three local control points.
      const finalP1 = { x: naiveP1.x + shiftX, y: naiveP1.y + shiftY };
      const finalP2 = { x: naiveP2.x + shiftX, y: naiveP2.y + shiftY };
      const finalMid = naiveMid ? { x: naiveMid.x + shiftX, y: naiveMid.y + shiftY } : null;
      // Step 5: pack new endpoints into Fabric convention (bbox of the
      // straight chord, x1..y2 as offsets from bbox center). Curve
      // extrema are NOT baked into obj.width/height here — the
      // renderer uses obj.data.midpoint alongside endpoints; getLineBBox
      // re-derives the curve-inclusive bbox from the stored midpoint on
      // every read. Keeping obj.width/height as the chord bbox matches
      // the storage shape for a straight line.
      const minX = Math.min(finalP1.x, finalP2.x);
      const minY = Math.min(finalP1.y, finalP2.y);
      const maxX = Math.max(finalP1.x, finalP2.x);
      const maxY = Math.max(finalP1.y, finalP2.y);
      const newWidth = maxX - minX;
      const newHeight = maxY - minY;
      const newCenterX = minX + newWidth / 2;
      const newCenterY = minY + newHeight / 2;
      const endpointData = {
        left: minX,
        top: minY,
        width: newWidth,
        height: newHeight,
        x1: finalP1.x - newCenterX,
        y1: finalP1.y - newCenterY,
        x2: finalP2.x - newCenterX,
        y2: finalP2.y - newCenterY,
      };
      ds.currentEndpoint = endpointData;

      // UX 2026-04-20 diag: throttled endpoint-move log so the user can
      // share a log when the non-moving endpoint looks like it drifts.
      const epNowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const epLastLog = dragStateRef.current.lastEndpointLogAt || 0;
      if (typeof window !== 'undefined' && window.__LINE_BBOX_DIAG && (!epLastLog || epNowMs - epLastLog >= 120)) {
        dragStateRef.current.lastEndpointLogAt = epNowMs;
        try {
          const payload = {
            ts: new Date().toISOString(),
            handleId: ds.handleId,
            annotationIndex: ds.annotationIndex,
            angleDeg: endpointAngle,
            startPointerSVG: ds.startSVGPoint,
            pointerSVG: { x: svgPoint.x, y: svgPoint.y },
            pointerDelta: { dx: dxW_ep, dy: dyW_ep },
            oldLocalEndpoints: { x1: ep.x1, y1: ep.y1, x2: ep.x2, y2: ep.y2 },
            oldWorldEndpoints: { W1: W1old, W2: W2old, WM: WMold },
            targetWorld: { W1: W1target, W2: W2target, WM: WMold },
            pivotOld,
            naivePoints: { p1: naiveP1, p2: naiveP2, mid: naiveMid },
            pivotNaive,
            pivotDelta: { dx: dX, dy: dY },
            compensationShift: { sx: shiftX, sy: shiftY },
            finalLocalPoints: { p1: finalP1, p2: finalP2, mid: finalMid },
            previewEndpointData: endpointData,
          };
          diagLog('[BboxScaleDiag] endpoint-move ' + JSON.stringify(payload));
        } catch (err) { console.warn('[BboxScaleDiag] endpoint-move log failed', err); }
      }

      ds.currentEndpoint = { ...endpointData, midpoint: finalMid };
      setVisualTransform({
        id: ds.annotationIndex,
        dx: 0,
        dy: 0,
        lineEdit: { ...endpointData, midpoint: finalMid, hasMidpoint: !!finalMid },
      });
      setInteractionState('dragging');
    } else if (ds.mode === 'midpoint') {
      // Phase 15 LINE-01 / ARROW-01 — live-paint midpoint translate.
      // Snap-to-straight happens LIVE during drag (not on pointerup) so the
      // user sees the line go straight as soon as the handle enters the 10px
      // threshold zone. Dragging back out re-curves it instantly.
      // Endpoint drags keep their snap-on-release-only behavior since the user
      // may be passing through collinear on the way to a new position.
      //
      // UX 2026-04-20: bbox-center pivot + Δ-compensation. Moving only
      // the midpoint changes the curve extrema → changes the bbox
      // center → moves the renderer's rotation pivot → would drag the
      // endpoints off their world positions on a rotated curved line.
      // Apply the same (R - I) · (pivotNaive - pivotOld) shift used
      // by the endpoint-drag branch so the endpoints stay pinned in
      // world while only the midpoint's visible position tracks the
      // pointer. Snap-to-straight still fires when the naive new
      // midpoint is within 10 px of the chord.
      const mpAngle = ds.originalProps?.angle || 0;
      const mpRad = (mpAngle * Math.PI) / 180;
      const mpCosA = Math.cos(mpRad);
      const mpSinA = Math.sin(mpRad);
      const ep = ds.originalEndpoints;
      const pivotOldM = computeLineBboxCenter(
        { x1: ep.x1, y1: ep.y1, x2: ep.x2, y2: ep.y2 },
        ds.originalMidpoint || null,
      );
      const rotAroundM = (px, py, cx, cy, cA, sA) => ({
        x: cx + (px - cx) * cA - (py - cy) * sA,
        y: cy + (px - cx) * sA + (py - cy) * cA,
      });
      // Old world positions of both endpoints + the midpoint (around pivotOldM).
      const W1oldM = rotAroundM(ep.x1, ep.y1, pivotOldM.x, pivotOldM.y, mpCosA, mpSinA);
      const W2oldM = rotAroundM(ep.x2, ep.y2, pivotOldM.x, pivotOldM.y, mpCosA, mpSinA);
      const WMoldM = ds.originalMidpoint
        ? rotAroundM(ds.originalMidpoint.x, ds.originalMidpoint.y, pivotOldM.x, pivotOldM.y, mpCosA, mpSinA)
        // Straight-line drag: the "midpoint" handle visually sits on
        // the chord midpoint, so treat the chord midpoint as the old
        // world midpoint when obj.data.midpoint hasn't been set yet.
        : { x: (W1oldM.x + W2oldM.x) / 2, y: (W1oldM.y + W2oldM.y) / 2 };
      // Target world midpoint: pointer delta applied; endpoints stay put.
      const mpDxW = svgPoint.x - ds.startSVGPoint.x;
      const mpDyW = svgPoint.y - ds.startSVGPoint.y;
      const WMtarget = { x: WMoldM.x + mpDxW, y: WMoldM.y + mpDyW };
      // Step 1: un-rotate around pivotOldM to get naive local points.
      const naiveP1M = rotAroundM(W1oldM.x, W1oldM.y, pivotOldM.x, pivotOldM.y, mpCosA, -mpSinA);
      const naiveP2M = rotAroundM(W2oldM.x, W2oldM.y, pivotOldM.x, pivotOldM.y, mpCosA, -mpSinA);
      const naiveMidM = rotAroundM(WMtarget.x, WMtarget.y, pivotOldM.x, pivotOldM.y, mpCosA, -mpSinA);
      // Step 2: naive new bbox center.
      const pivotNaiveM = computeLineBboxCenter(
        { x1: naiveP1M.x, y1: naiveP1M.y, x2: naiveP2M.x, y2: naiveP2M.y },
        naiveMidM,
      );
      // Step 3: compensation shift.
      const dXm = pivotNaiveM.x - pivotOldM.x;
      const dYm = pivotNaiveM.y - pivotOldM.y;
      const shiftXm = (mpCosA - 1) * dXm - mpSinA * dYm;
      const shiftYm = mpSinA * dXm + (mpCosA - 1) * dYm;
      // Step 4: apply shift to all three local points.
      const finalP1M = { x: naiveP1M.x + shiftXm, y: naiveP1M.y + shiftYm };
      const finalP2M = { x: naiveP2M.x + shiftXm, y: naiveP2M.y + shiftYm };
      const finalMidM = { x: naiveMidM.x + shiftXm, y: naiveMidM.y + shiftYm };
      // Pack endpoints into Fabric convention.
      const minXm = Math.min(finalP1M.x, finalP2M.x);
      const minYm = Math.min(finalP1M.y, finalP2M.y);
      const maxXm = Math.max(finalP1M.x, finalP2M.x);
      const maxYm = Math.max(finalP1M.y, finalP2M.y);
      const newWm = maxXm - minXm;
      const newHm = maxYm - minYm;
      const newCxM = minXm + newWm / 2;
      const newCyM = minYm + newHm / 2;
      const midpointData = {
        left: minXm,
        top: minYm,
        width: newWm,
        height: newHm,
        x1: finalP1M.x - newCxM,
        y1: finalP1M.y - newCyM,
        x2: finalP2M.x - newCxM,
        y2: finalP2M.y - newCyM,
      };
      // Live snap: clear midpoint when within threshold, re-apply when outside.
      // Use the SHIFTED final midpoint + endpoints so the snap threshold
      // is evaluated in the same frame the renderer will consume.
      const startPM = { x: finalP1M.x, y: finalP1M.y };
      const endPM = { x: finalP2M.x, y: finalP2M.y };
      const snappedToLinear = shouldSnapToLinear(finalMidM, startPM, endPM, 10);
      ds.currentMidpoint = { ...midpointData, midpoint: snappedToLinear ? null : finalMidM };
      setVisualTransform({
        id: ds.annotationIndex,
        dx: 0,
        dy: 0,
        lineEdit: {
          ...midpointData,
          midpoint: snappedToLinear ? null : finalMidM,
          hasMidpoint: !snappedToLinear,
        },
      });
      setInteractionState('dragging');
    } else if (ds.mode === 'text-markup-horizontal') {
      const preview = resizeTextMarkupHorizontalEdge(
        ds.originalTextMarkup,
        ds.handleId,
        svgPoint,
        pageWidth,
        pageHeight,
        ds.fixedTextOffset,
      );
      ds.currentTextMarkup = preview;
      setVisualTransform({
        id: ds.annotationIndex,
        previewObjects: { [ds.annotationIndex]: preview },
      });
      setInteractionState('resizing');
    } else if (ds.mode === 'resize') {
      // Determine which axes this handle affects
      const affectsX = !['mt', 'mb'].includes(ds.handleId);
      const affectsY = !['ml', 'mr'].includes(ds.handleId);

      // Bug #8: SIGNED scale, per-handle direction. The original code used
      // `Math.abs(svgPoint.x - anchorX)` which collapsed the drag direction
      // and prevented flipping — dragging a handle past its opposite would
      // just bounce back instead of mirroring the shape as Fabric edit mode
      // does. We now compute a signed delta from the handle's "growth"
      // direction (left-handles grow when dragging LEFT, right-handles grow
      // when dragging RIGHT) and allow scale to go negative, which represents
      // the flipped state.
      const isLeftHandle = ['tl', 'ml', 'bl'].includes(ds.handleId);
      const isTopHandle = ['tl', 'mt', 'tr'].includes(ds.handleId);

      // UX 2026-04-20: rotation-aware resize. For rotated shapes the pointer
      // must be projected into the shape's LOCAL (un-rotated) frame before
      // computing the scale, otherwise dragging a side handle on a tilted
      // shape stretches it along the world X/Y axis instead of along the
      // shape's own tilted axis — visible as the shape skidding sideways as
      // it grows. Un-rotate the pointer around the shape's original center
      // by -angle, then feed the local pointer into the same signed-scale
      // math. angle=0 reduces to the pre-existing world-aligned behavior.
      const origAngleDeg = ds.originalProps.angle || 0;
      const origAngleRad = (origAngleDeg * Math.PI) / 180;
      const cosA = Math.cos(origAngleRad);
      const sinA = Math.sin(origAngleRad);
      // World anchor: stored anchor is in local (un-rotated) frame; rotate it
      // around the shape's center by angle to get its rendered position.
      const anchorLocalDx = ds.anchorX - ds.centerX;
      const anchorLocalDy = ds.anchorY - ds.centerY;
      const worldAnchorX = ds.centerX + anchorLocalDx * cosA - anchorLocalDy * sinA;
      const worldAnchorY = ds.centerY + anchorLocalDx * sinA + anchorLocalDy * cosA;
      // Un-rotate pointer relative to world anchor, into shape's local frame.
      const ptrDxWorld = svgPoint.x - worldAnchorX;
      const ptrDyWorld = svgPoint.y - worldAnchorY;
      const ptrDxLocal = ptrDxWorld * cosA + ptrDyWorld * sinA;
      const ptrDyLocal = -ptrDxWorld * sinA + ptrDyWorld * cosA;

      let newScaleX = ds.originalProps.scaleX;
      let newScaleY = ds.originalProps.scaleY;

      if (affectsX && ds.originalProps.width !== 0) {
        const signedLocalDx = isLeftHandle ? -ptrDxLocal : ptrDxLocal;
        newScaleX = signedLocalDx / ds.originalProps.width;
      }
      if (affectsY && ds.originalProps.height !== 0) {
        const signedLocalDy = isTopHandle ? -ptrDyLocal : ptrDyLocal;
        newScaleY = signedLocalDy / ds.originalProps.height;
      }

      // Shift-lock aspect ratio (per CONTEXT.md: free resize default, Shift
      // locks). Preserve per-axis sign so diagonal drags through the anchor
      // still flip on the axis that crossed — `sign * average magnitude`.
      if (e.shiftKey) {
        const avgMag = (Math.abs(newScaleX) + Math.abs(newScaleY)) / 2;
        newScaleX = (newScaleX < 0 ? -1 : 1) * avgMag;
        newScaleY = (newScaleY < 0 ? -1 : 1) * avgMag;
      }

      const objForFlip = annotations?.objects?.[ds.annotationIndex];
      const isCounterResize = !!(ds.originalProps?.isCounterPin || objForFlip?.data?.type === 'counter');
      if (isCounterResize) {
        const uniformScale = affectsX && affectsY
          ? Math.max(Math.abs(newScaleX), Math.abs(newScaleY))
          : affectsX
            ? Math.abs(newScaleX)
            : Math.abs(newScaleY);
        const safeUniformScale = Math.max(0.1, uniformScale || 1);
        newScaleX = safeUniformScale;
        newScaleY = safeUniformScale;
      }

      // Paths use a page-affine resize and therefore preserve signed scale
      // exactly, including flips. The authored commands remain byte-stable;
      // only the object's transform changes. Other orientation-sensitive
      // types retain the historical positive-scale behavior.
      const typeForFlip = String(objForFlip?.type || '').toLowerCase();
      const isExactPathResize = typeForFlip === 'path';
      const supportsFlip = !isCounterResize && (
        typeForFlip === 'rect'
        || typeForFlip === 'circle'
        || typeForFlip === 'ellipse'
        || isExactPathResize
      );
      if (isExactPathResize) {
        // Zero is the only singular affine. Do not impose a visible-size
        // floor: imported microscopic geometry and legitimate 0.001-scale
        // resizes must not snap to 10% of their previous size.
        if (newScaleX === 0) {
          newScaleX = ds.originalProps.scaleX < 0 ? -Number.MIN_VALUE : Number.MIN_VALUE;
        }
        if (newScaleY === 0) {
          newScaleY = ds.originalProps.scaleY < 0 ? -Number.MIN_VALUE : Number.MIN_VALUE;
        }
      } else if (!supportsFlip) {
        newScaleX = Math.max(0.1, newScaleX);
        newScaleY = Math.max(0.1, newScaleY);
      } else {
        // Minimum MAGNITUDE (signed) to prevent zero-size while preserving
        // flip direction. 0.01 mirrors the old 0.1 floor scaled down so a
        // mid-flip zero-crossing doesn't snap-jump — visually the shape
        // passes through a 1px sliver at the anchor.
        if (Math.abs(newScaleX) < 0.01) newScaleX = (newScaleX < 0 ? -1 : 1) * 0.01;
        if (Math.abs(newScaleY) < 0.01) newScaleY = (newScaleY < 0 ? -1 : 1) * 0.01;
      }

      // UX 2026-04-20: unified newLeft/newTop formula that pins the WORLD
      // anchor (the rendered position of the opposite handle) in place at
      // every rotation angle. Compute the new center by adding a locally-
      // directed center-from-anchor offset, rotated into world, to the world
      // anchor. Then newLeft/newTop derive from the center minus new half-
      // dims. At angle=0 this reduces to the prior axis-aligned formula
      // (verified per handle for positive + flipped scale cases). Renderers
      // (renderRect/renderEllipse) still `Math.abs()` the scale and rotate
      // around (newLeft + newWidth/2, newTop + newHeight/2), so a flipped
      // rect/circle at any angle still lands at the right pivot.
      const newWidth = ds.originalProps.width * Math.abs(newScaleX);
      const newHeight = ds.originalProps.height * Math.abs(newScaleY);
      let offsetFromAnchorX = 0;
      let offsetFromAnchorY = 0;
      if (affectsX) {
        // Left-handle drag: right edge is the anchor, so the center sits to
        // the LEFT of the anchor in local frame (-newWidth/2). Right-handle
        // drag: left edge is the anchor, center sits to the RIGHT (+newWidth/2).
        offsetFromAnchorX = isLeftHandle ? -newWidth / 2 : +newWidth / 2;
        // Flipped scale mirrors the shape across the anchor, so the center
        // jumps to the other side.
        if (newScaleX < 0) offsetFromAnchorX = -offsetFromAnchorX;
      }
      if (affectsY) {
        offsetFromAnchorY = isTopHandle ? -newHeight / 2 : +newHeight / 2;
        if (newScaleY < 0) offsetFromAnchorY = -offsetFromAnchorY;
      }
      // Rotate the local center-from-anchor offset into world frame, then
      // land the new center relative to the fixed world anchor.
      const worldOffsetX = offsetFromAnchorX * cosA - offsetFromAnchorY * sinA;
      const worldOffsetY = offsetFromAnchorX * sinA + offsetFromAnchorY * cosA;
      const newCenterX = worldAnchorX + worldOffsetX;
      const newCenterY = worldAnchorY + worldOffsetY;
      const newLeft = newCenterX - newWidth / 2;
      const newTop = newCenterY - newHeight / 2;
      const pathResizePageMatrix = typeForFlip === 'path'
        ? scaleInRotatedFrameAroundMatrix(
            newScaleX,
            newScaleY,
            origAngleDeg,
            worldAnchorX,
            worldAnchorY,
          )
        : null;

      let resizeCommitLeft = newLeft;
      let resizeCommitTop = newTop;
      let counterNewRadius = null;
      if (isCounterResize) {
        const baseRadius = ds.originalProps?.counterBaseRadius || objForFlip?.radius || 14;
        counterNewRadius = baseRadius * Math.abs(newScaleX);
        const counterTipExtension = counterNewRadius * 0.5;
        resizeCommitTop = newTop + counterTipExtension;
      }

      // Store resize state for commit on pointerup
      dragStateRef.current.currentResize = {
        newScaleX,
        newScaleY,
        newLeft: resizeCommitLeft,
        newTop: resizeCommitTop,
        counterNewRadius,
        pathResizePageMatrix,
      };
      setInteractionState('resizing');

      // UX 2026-04-19 diag: throttle-logged pointermove during resize so
      // future-Claude can see scale deltas vs pointer position over time
      // without flooding the console. Logs first tick + every ~120ms.
      const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const lastLog = dragStateRef.current.lastMoveLogAt || 0;
      if (!lastLog || nowMs - lastLog >= 120) {
        dragStateRef.current.lastMoveLogAt = nowMs;
        try {
          const curObj = annotations?.objects?.[ds.annotationIndex];
          const movePayload = {
            ts: new Date().toISOString(),
            handleId: ds.handleId,
            annotationIndex: ds.annotationIndex,
            pointerSVG: { x: svgPoint?.x, y: svgPoint?.y },
            pointerDelta: { dx: (svgPoint?.x || 0) - (ds.startSVGPoint?.x || 0), dy: (svgPoint?.y || 0) - (ds.startSVGPoint?.y || 0) },
            computedScale: { newScaleX, newScaleY },
            computedPos: { newLeft: resizeCommitLeft, newTop: resizeCommitTop },
            originalProps: ds.originalProps,
            anchor: { x: ds.anchorX, y: ds.anchorY },
            liveBboxGuess: curObj ? getAnnotationBBox({ ...curObj, scaleX: newScaleX, scaleY: newScaleY, left: newLeft, top: newTop }) : null,
            curObjSnapshot: curObj ? {
              objType: curObj.type, tool: curObj.tool,
              left: curObj.left, top: curObj.top,
              width: curObj.width, height: curObj.height,
              scaleX: curObj.scaleX, scaleY: curObj.scaleY,
              x1: curObj.x1, y1: curObj.y1, x2: curObj.x2, y2: curObj.y2,
            } : null,
          };
          diagLog('[BboxScaleDiag] move ' + JSON.stringify(movePayload));
        } catch (err) { console.warn('[BboxScaleDiag] move log failed', err); }
      }

      // UX: polygon/polyline live preview. SVGAnnotationLayer re-renders the
      // shape by applying these `left`/`top` values through the renderer's
      // transform chain `translate(left, top) scale(sx, sy) translate(-pathOffset)`
      // — i.e. OBJECT-space. The resize formula above produced `newLeft`/`newTop`
      // in visible-bbox space (since originalProps.left was set to bbox.left at
      // pointer-down). Translate here so the live preview tracks the cursor
      // instead of drifting off the page.
      let visualLeft = newLeft;
      let visualTop = newTop;
      if (isCounterResize) {
        visualLeft = resizeCommitLeft;
        visualTop = resizeCommitTop;
      }
      if (ds.originalProps.isPointsShape) {
        const sxAbs = Math.abs(newScaleX);
        const syAbs = Math.abs(newScaleY);
        visualLeft = newLeft - sxAbs * (ds.originalProps.pointsLocalMinX - ds.originalProps.pointsPathOffsetX);
        visualTop = newTop - syAbs * (ds.originalProps.pointsLocalMinY - ds.originalProps.pointsPathOffsetY);
      }
      setVisualTransform({
        id: ds.annotationIndex,
        dx: 0, dy: 0,
        resize: {
          scaleX: newScaleX,
          scaleY: newScaleY,
          left: visualLeft,
          top: visualTop,
          anchorX: ds.anchorX,
          anchorY: ds.anchorY,
          pageMatrix: pathResizePageMatrix,
        },
      });
    } else if (ds.mode === 'rotate') {
      // Compute angle from center of annotation to current pointer position
      const dx = svgPoint.x - ds.centerX;
      const dy = svgPoint.y - ds.centerY;
      const radians = Math.atan2(dy, dx);
      let newAngle = normalizeAngle(radians);

      // EDIT-11: soft Shift-snap to nearest 45° within 3° threshold (CONTEXT.md locked decision)
      if (e.shiftKey) {
        newAngle = snapAngleToNearest45(newAngle, 3);
      }

      // UX 2026-04-20: counters don't rotate their bubble or number — the
      // rotation handle and angle pill drive the nub direction only. Map
      // the handle's Fabric-convention angle (0 = up, 90 = right) to the
      // nub's 3-o'clock-based pointerAngle (0 = right, 90 = down). The
      // -90° offset ties "handle at top" → "nub points up" so the first
      // pointermove doesn't snap the pin 90° away from the cursor.
      const rotObj = annotations?.objects?.[ds.annotationIndex];
      if (rotObj?.data?.type === 'counter') {
        const counterPointerAngle = ((newAngle - 90) % 360 + 360) % 360;
        dragStateRef.current.currentAngle = counterPointerAngle;
        setVisualTransform({
          id: ds.annotationIndex,
          dx: 0,
          dy: 0,
          counterPointerAngle,
        });
        setInteractionState('rotating');
        return;
      }

      // Delta from original angle — the wrapper <g> already renders the committed angle,
      // so the visual transform must only apply the change to avoid double-rotation.
      const deltaAngle = newAngle - (ds.originalProps.angle || 0);

      dragStateRef.current.currentAngle = newAngle;
      setInteractionState('rotating');
      setVisualTransform({
        id: ds.annotationIndex,
        dx: 0, dy: 0,
        rotate: { angle: newAngle, deltaAngle, cx: ds.centerX, cy: ds.centerY },
      });

      // UX 2026-04-19 diag: throttled rotate move log — lets future-Claude
      // compare how rect/circle rotate (renderer honors obj.angle) against
      // how line/arrow rotate (renderer ignores obj.angle) so the asymmetry
      // shows up directly in the transcript. 120ms throttle mirrors resize.
      const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const lastLog = dragStateRef.current.lastRotateLogAt || 0;
      if (!lastLog || nowMs - lastLog >= 120) {
        dragStateRef.current.lastRotateLogAt = nowMs;
        try {
          const curObj = annotations?.objects?.[ds.annotationIndex];
          const rotPayload = {
            ts: new Date().toISOString(),
            handleId: ds.handleId,
            annotationIndex: ds.annotationIndex,
            pointerSVG: { x: svgPoint?.x, y: svgPoint?.y },
            center: { x: ds.centerX, y: ds.centerY },
            newAngleDeg: newAngle,
            deltaAngleDeg: deltaAngle,
            originalAngleDeg: ds.originalProps.angle || 0,
            visualTransformApplied: { angle: newAngle, deltaAngle, cx: ds.centerX, cy: ds.centerY },
            curObjSnapshot: curObj ? {
              objType: curObj.type, tool: curObj.tool,
              left: curObj.left, top: curObj.top,
              width: curObj.width, height: curObj.height,
              scaleX: curObj.scaleX, scaleY: curObj.scaleY,
              angle: curObj.angle,
              x1: curObj.x1, y1: curObj.y1, x2: curObj.x2, y2: curObj.y2,
              radius: curObj.radius, rx: curObj.rx, ry: curObj.ry,
              points: Array.isArray(curObj.points) ? curObj.points.length : undefined,
            } : null,
          };
          diagLog('[BboxScaleDiag] rotate-move ' + JSON.stringify(rotPayload));
        } catch (err) { console.warn('[BboxScaleDiag] rotate-move log failed', err); }
      }
    } else if (ds.mode === 'callout-part') {
      // UX: Phase 14 CALL-10 — per-drag update of one or more callout
      // positions. Uses cached ctmInverse for consistent screen→page
      // conversion. Delta math is integer-clean: capture the original
      // normalized coords at pointerdown, apply delta-in-page-coords /
      // pageSize each frame. See 14-CONTEXT.md Area 3 drag MVP.
      const dxPage = svgPoint.x - ds.startSVGPoint.x;
      const dyPage = svgPoint.y - ds.startSVGPoint.y;
      // UX: normalize delta by page dimensions so the callout's stored
      // 0-1 coords stay in page-relative space regardless of zoom level.
      const W = pageWidth || 1;
      const H = pageHeight || 1;
      const dxNorm = dxPage / W;
      const dyNorm = dyPage / H;

      const original = ds.originalCalloutPositions;
      if (!original) return;

      // UX: Phase 15 UAT-3 Issue 3 — compute the FULL proposed callout state
      // (all three positions) for every partType so the distance-rule
      // validator sees a consistent world. Non-dragged positions stay at
      // their drag-start values; 'whole' translates everything together.
      const proposed = {
        arrowTip: { ...original.arrowTip },
        knee: { ...original.knee },
        textBoxPosition: { ...original.textBoxPosition },
      };
      switch (ds.partType) {
        case 'arrowTip':
          proposed.arrowTip = {
            x: original.arrowTip.x + dxNorm,
            y: original.arrowTip.y + dyNorm,
          };
          break;
        case 'knee':
          proposed.knee = {
            x: original.knee.x + dxNorm,
            y: original.knee.y + dyNorm,
          };
          break;
        case 'textBox':
          proposed.textBoxPosition = {
            x: original.textBoxPosition.x + dxNorm,
            y: original.textBoxPosition.y + dyNorm,
          };
          break;
        case 'whole':
          proposed.arrowTip = {
            x: original.arrowTip.x + dxNorm,
            y: original.arrowTip.y + dyNorm,
          };
          proposed.knee = {
            x: original.knee.x + dxNorm,
            y: original.knee.y + dyNorm,
          };
          proposed.textBoxPosition = {
            x: original.textBoxPosition.x + dxNorm,
            y: original.textBoxPosition.y + dyNorm,
          };
          break;
        case 'textBoxResize': {
          // UX: Phase 15 UAT-3 (2026-04-17) — corner-drag resize of the
          // callout textbox. Fixed-anchor math: the corner OPPOSITE the
          // grabbed corner stays put, the grabbed corner follows the
          // pointer. New rect dims fall out of that. Minimum size floor
          // (20px on each axis) matches the renderCallout min textBox dims.
          const corner = ds.textBoxCorner || 'br';
          const origLeft = original.textBoxPosition.x;
          const origTop = original.textBoxPosition.y;
          const origRight = origLeft + (original.textBoxWidth || 0);
          const origBottom = origTop + (original.textBoxHeight || 0);
          // Anchor point (opposite corner) in normalized coords.
          let anchorX, anchorY;
          if (corner === 'tl') { anchorX = origRight;  anchorY = origBottom; }
          else if (corner === 'tr') { anchorX = origLeft;  anchorY = origBottom; }
          else if (corner === 'bl') { anchorX = origRight; anchorY = origTop; }
          else                      { anchorX = origLeft;  anchorY = origTop; }
          // Moving corner = original corner + drag delta (in normalized).
          let mvX, mvY;
          if (corner === 'tl')      { mvX = origLeft + dxNorm;  mvY = origTop + dyNorm; }
          else if (corner === 'tr') { mvX = origRight + dxNorm; mvY = origTop + dyNorm; }
          else if (corner === 'bl') { mvX = origLeft + dxNorm;  mvY = origBottom + dyNorm; }
          else                      { mvX = origRight + dxNorm; mvY = origBottom + dyNorm; }
          const minW = 20 / W;
          const minH = 20 / H;
          const newLeft = Math.min(anchorX, mvX);
          const newTop = Math.min(anchorY, mvY);
          const newRight = Math.max(anchorX, mvX);
          const newBottom = Math.max(anchorY, mvY);
          const newWidth = Math.max(minW, newRight - newLeft);
          const newHeight = Math.max(minH, newBottom - newTop);
          const resizePatch = {
            textBoxPosition: { x: newLeft, y: newTop },
            textBoxWidth: newWidth,
            textBoxHeight: newHeight,
          };
          ds.currentCalloutPatch = resizePatch;
          setVisualTransform({
            id: 'callout',
            calloutPreviews: { [ds.calloutId]: resizePatch },
          });
          setInteractionState('dragging');
          return;
        }
        default:
          return;
      }

      // UX: Phase 15 UAT-3 (2026-04-17) — free-drag model. During a drag
      // the user sees raw pointer-follow on the handle they grabbed — no
      // mid-drag pin, no mid-drag reroute. The combined-tools reference
      // behaves the same way: cheap, responsive drag while the mouse is
      // down, discipline on release. Each frame we also validate the
      // proposed positions against the four distance rules and stash the
      // most recent rule-compliant snapshot in lastSafeCalloutPositions —
      // handlePointerUp uses it to roll back if the drop-point itself fails
      // the rule check.
      const atPx = { x: proposed.arrowTip.x * W, y: proposed.arrowTip.y * H };
      const kneePx = { x: proposed.knee.x * W, y: proposed.knee.y * H };
      const boxLeftPx = proposed.textBoxPosition.x * W;
      const boxTopPx = proposed.textBoxPosition.y * H;
      const boxWPx = (original.textBoxWidth || 0) * W;
      const boxHPx = (original.textBoxHeight || 0) * H;
      // UX: 2026-05-18 — extend the rule rect's bottom by the descender buffer
      // the renderer adds (fontSize * 0.35) so the validator measures against
      // the box the user actually sees (matches renderCallout + calloutGeometry).
      const calloutDescBuffer = Number(original.fontSize || 12) * 0.35;
      const boxRightPx = boxLeftPx + boxWPx;
      const boxBottomPx = boxTopPx + boxHPx + calloutDescBuffer;

      const distPointToRect = (p, l, t, r, b) => {
        const dx = Math.max(0, Math.max(l - p.x, p.x - r));
        const dy = Math.max(0, Math.max(t - p.y, p.y - b));
        return Math.sqrt(dx * dx + dy * dy);
      };
      const pointInsideRect = (p, l, t, r, b) =>
        p.x >= l && p.x <= r && p.y >= t && p.y <= b;

      // 'whole' drag preserves all relative distances by construction, so
      // its proposed frame is trivially safe — always refresh lastSafe.
      const arrowToBoxDist = distPointToRect(atPx, boxLeftPx, boxTopPx, boxRightPx, boxBottomPx);
      const arrowInsideBox = pointInsideRect(atPx, boxLeftPx, boxTopPx, boxRightPx, boxBottomPx);
      const kneeToArrowDist = Math.hypot(kneePx.x - atPx.x, kneePx.y - atPx.y);
      const kneeToBoxDist = distPointToRect(kneePx, boxLeftPx, boxTopPx, boxRightPx, boxBottomPx);
      const kneeInsideBox = pointInsideRect(kneePx, boxLeftPx, boxTopPx, boxRightPx, boxBottomPx);

      // UX: Phase 15 UAT-3 (2026-04-18) — Liang-Barsky segment-through-rect
      // check used by the knee-drag rule set. Returns true when the
      // knee→arrow segment cuts through the textbox interior.
      const segmentCrossesRect = (p1, p2, l, t, r, b) => {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        let t0 = 0, t1 = 1;
        const pp = [-dx, dx, -dy, dy];
        const qq = [p1.x - l, r - p1.x, p1.y - t, b - p1.y];
        for (let i = 0; i < 4; i++) {
          if (pp[i] === 0) {
            if (qq[i] < 0) return false;
          } else {
            const rr = qq[i] / pp[i];
            if (pp[i] < 0) {
              if (rr > t1) return false;
              if (rr > t0) t0 = rr;
            } else {
              if (rr < t0) return false;
              if (rr < t1) t1 = rr;
            }
          }
        }
        return t0 < t1 && t1 > 0.0001 && t0 < 0.9999;
      };

      // Collision distances must match the handle the user actually sees.
      // Handles render at HANDLE_RADIUS * sqrt(clampInverseScale(inverseScale))
      // in page units (the clamp is the zoom-out balloon fix), so the rule uses
      // that same clamped effective radius — a static radius only lines up at
      // 100% zoom and otherwise leaves a gap that can never be closed.
      const effHandleR = HANDLE_RADIUS * Math.sqrt(clampInverseScale(inverseScale));
      const minHandleToBox = effHandleR;        // handle edge meets the border
      const minHandleToHandle = effHandleR * 2; // two handle circles edge-to-edge
      // Knee / arrow handles must also clear the four textbox CORNER handles.
      // Those handle circles sit on the box corners and stick out past the
      // border, so the box-border distance alone misses them (user report
      // 2026-05-18: knee/arrow handles still collide with corner handles).
      const frameBoxCorners = [
        { x: boxLeftPx, y: boxTopPx }, { x: boxRightPx, y: boxTopPx },
        { x: boxLeftPx, y: boxBottomPx }, { x: boxRightPx, y: boxBottomPx },
      ];
      const frameClearsCorners = (p) =>
        frameBoxCorners.every((c) => Math.hypot(p.x - c.x, p.y - c.y) >= minHandleToHandle);
      let frameSafe;
      if (ds.partType === 'whole') {
        frameSafe = true;
      } else if (
        ds.partType === 'knee'
        || ds.partType === 'textBox'
        || ds.partType === 'textBoxResize'
      ) {
        // UX: 2026-05-18 — knee / textbox / resize drags count as "safe" only
        // when nothing overlaps: knee and arrow stay outside the box, each
        // handle circle may touch the border but not cross it, the two handle
        // circles may touch but not overlap, and line2 doesn't cut the box.
        // Unsafe frames do not advance lastSafe.
        frameSafe = !kneeInsideBox
          && !arrowInsideBox
          && kneeToBoxDist >= minHandleToBox
          && arrowToBoxDist >= minHandleToBox
          && kneeToArrowDist >= minHandleToHandle
          && frameClearsCorners(kneePx)
          && frameClearsCorners(atPx)
          && !segmentCrossesRect(kneePx, atPx, boxLeftPx, boxTopPx, boxRightPx, boxBottomPx);
      } else {
        // Arrow drag. The knee stays put, so an arrow position that makes the
        // knee→arrow line cut through the textbox is rejected here — the arrow
        // shows red and snaps back; the user moves the knee aside instead.
        frameSafe = !arrowInsideBox
          && arrowToBoxDist >= minHandleToBox
          && kneeToArrowDist >= minHandleToHandle
          && !kneeInsideBox
          && kneeToBoxDist >= minHandleToBox
          && frameClearsCorners(kneePx)
          && frameClearsCorners(atPx)
          && !segmentCrossesRect(kneePx, atPx, boxLeftPx, boxTopPx, boxRightPx, boxBottomPx);
      }
      if (frameSafe) {
        ds.lastSafeCalloutPositions = {
          arrowTip: { ...proposed.arrowTip },
          knee: { ...proposed.knee },
          textBoxPosition: { ...proposed.textBoxPosition },
        };
      }

      // Emit the raw proposed patch every frame — handle follows pointer
      // 1:1. Release-time rollback happens in handlePointerUp.
      let patch;
      switch (ds.partType) {
        case 'arrowTip':
          patch = { arrowTip: proposed.arrowTip };
          break;
        case 'knee':
          patch = { knee: proposed.knee };
          break;
        case 'textBox':
          patch = { textBoxPosition: proposed.textBoxPosition };
          break;
        case 'whole':
          patch = {
            arrowTip: proposed.arrowTip,
            knee: proposed.knee,
            textBoxPosition: proposed.textBoxPosition,
          };
          break;
        default:
          return;
      }

      if (patch && ds.calloutId) {
        ds.currentCalloutPatch = patch;
        setVisualTransform({
          id: 'callout',
          calloutPreviews: { [ds.calloutId]: patch },
          // UX: 2026-05-18 — surface this frame's rule check so the renderer
          // can paint the dragged handle's ring red when the current spot
          // would be rejected on release. `frameSafe` is the same predicate
          // the release-time rollback uses; red === "this won't be accepted".
          calloutDragInvalid: !frameSafe,
        });
      }
      setInteractionState('dragging');
    }
  }, [svgRef, annotations, onSaveAnnotations, pageWidth, pageHeight, onUpdateCalloutLive, applyMarqueeState, applyLassoState, inverseScale]);

  /**
   * Pointer up on root SVG: commit drag changes to annotation data.
   */
  const handlePointerUp = useCallback((e) => {
    const lasso = lassoStateRef.current;
    if (lasso) {
      if (e.pointerId !== lasso.pointerId) return;
      const raw = screenToSVG(svgRef.current, e.clientX, e.clientY);
      const finalPoint = {
        x: Math.max(0, Math.min(pageWidth, raw.x)),
        y: Math.max(0, Math.min(pageHeight, raw.y)),
      };
      const sampled = shouldSampleLassoPoint(lasso.points.at(-1), finalPoint, inverseScale, 0.5)
        ? [...lasso.points, finalPoint]
        : lasso.points;
      const simplified = simplifyLassoPoints(sampled, LASSO_SIMPLIFY_PX * inverseScale);
      const mode = lasso.modeOverride || lasso.mode || getLassoModeFromTrail(sampled) || 'window';
      const validation = mode === 'fence'
        ? { polygon: simplified.filter((point, index, list) => (
            Number.isFinite(point?.x) && Number.isFinite(point?.y)
            && (index === 0 || point.x !== list[index - 1]?.x || point.y !== list[index - 1]?.y)
          )), issue: null }
        : getLassoPolygonValidation(simplified);
      const polygon = validation.polygon?.length >= (mode === 'fence' ? 2 : 3) ? validation.polygon : null;
      cancelLasso(e.pointerId);
      if (!polygon) {
        if (validation.issue === 'self-intersection') {
          showToast('Lasso cancelled because the path crossed itself.', 'info');
          return;
        }
        if (!lasso.shiftHeld) {
          deselectAll();
          onSelectedCalloutIdsChange?.(new Set());
        }
        return;
      }
      const rawHits = resolveLassoHits({
        lassoPolygon: polygon,
        mode,
        annotations,
        callouts,
        pageWidth,
        pageHeight,
        pageNumber,
        selectableAnnotationIndices: typeof getSelectableAnnotationIndices === 'function'
          ? getSelectableAnnotationIndices()
          : undefined,
      });
      const annotationIndices = filterMarqueeHits(
        rawHits.annotationIndices,
        annotations,
        viewerId,
        documentOwnerId,
      );
      if (lasso.altHeld) {
        if (annotationIndices.length) {
          setSelectedIds((previous) => {
            const next = new Set(previous);
            annotationIndices.forEach((index) => next.delete(index));
            return next;
          });
        }
        if (rawHits.calloutIds.length && onSelectedCalloutIdsChange) {
          const nextCallouts = new Set(
            selectedCalloutIds instanceof Set ? selectedCalloutIds : selectedCalloutIds || [],
          );
          rawHits.calloutIds.forEach((id) => nextCallouts.delete(id));
          onSelectedCalloutIdsChange(nextCallouts);
        }
      } else if (lasso.shiftHeld) {
        if (annotationIndices.length) {
          setSelectedIds((previous) => new Set([...previous, ...annotationIndices]));
        }
        if (rawHits.calloutIds.length && onSelectedCalloutIdsChange) {
          onSelectedCalloutIdsChange(new Set([
            ...(selectedCalloutIds instanceof Set ? selectedCalloutIds : selectedCalloutIds || []),
            ...rawHits.calloutIds,
          ]));
        }
      } else {
        setSelectedIds(new Set(annotationIndices));
        onSelectedCalloutIdsChange?.(new Set(rawHits.calloutIds));
      }
      return;
    }
    // UX: Phase 19 — marquee release path. Runs BEFORE annotation drag
    // release so the marquee owns pointerup whenever it's tracking.
    //   - Sub-threshold release (no `active` flag set): treat as empty-
    //     space click; deselect on unmodified click, no-op with Shift.
    //   - Above-threshold release: resolve hits, apply selection per
    //     modifier rules, clear marquee state.
    const mq = marqueeStateRef.current;
    if (mq) {
      const wasActive = mq.active;
      applyMarqueeState(null);
      try { svgRef.current?.releasePointerCapture?.(mq.pointerId ?? e.pointerId); } catch (_) { /* optional */ }

      if (!wasActive) {
        if (!mq.shiftHeld) {
          deselectAll();
          if (onSelectedCalloutIdsChange) onSelectedCalloutIdsChange(new Set());
        }
        return;
      }

      const marqueeRect = getMarqueeRect(mq);
      const direction = getMarqueeDirection(mq);
      const rawHits = resolveMarqueeHits({
        marqueeRect,
        direction,
        annotations,
        callouts,
        pageWidth,
        pageHeight,
        pageNumber,
        selectableAnnotationIndices: typeof getSelectableAnnotationIndices === 'function'
          ? getSelectableAnnotationIndices()
          : undefined,
        onCandidateDiagnostic: (entry) => {
          if (typeof window === 'undefined') return;
          if (!window.__marqueeHitDiagnostics) window.__marqueeHitDiagnostics = [];
          const obj = entry?.obj || null;
          window.__marqueeHitDiagnostics.push({
            at: new Date().toISOString(),
            pageNumber,
            index: entry?.index,
            included: entry?.included,
            reason: entry?.reason,
            bbox: entry?.bbox || null,
            id: obj?.id || null,
            fabricId: obj?.data?.fabricId || null,
            annotationId: obj?.annotationId || obj?.data?.annotationId || null,
            type: obj?.type || null,
            tool: obj?.tool || null,
            dataType: obj?.data?.type || null,
            fill: obj?.fill ?? null,
            stroke: obj?.stroke ?? null,
            strokeWidth: obj?.strokeWidth ?? null,
            opacity: obj?.opacity ?? null,
            visible: obj?.visible ?? null,
            moduleId: obj?.moduleId || null,
            regionId: obj?.regionId || null,
            spaceId: obj?.spaceId || null,
          });
        },
      });
      // Phase 35 Plan 03 — owner-aware marquee post-filter. CONTEXT.md AC #1:
      // a non-owner marquee across mixed-author content only catches the
      // viewer's own annotations — foreign-author marks are dropped before
      // selection state updates. Owner-mode is a same-reference passthrough
      // inside filterMarqueeHits (canModify short-circuits to true for the
      // document owner), so the owner hot path stays React-memoization-clean.
      // Callout hits are not filtered here — callout ownership semantics live
      // in App.jsx's callout pipeline; the marquee passes the raw callout ids
      // through unchanged for now.
      const annotationIndices = filterMarqueeHits(
        rawHits.annotationIndices,
        annotations,
        viewerId,
        documentOwnerId,
      );
      const calloutIds = rawHits.calloutIds;

      if (mq.altHeld) {
        // Subtract: remove marquee hits from the existing selection.
        // Alt wins over Shift if both held. Empty result is a no-op.
        // Phase 35 Plan 03 — defense-in-depth gate at the Alt subtract site.
        // annotationIndices is already filtered by filterMarqueeHits above,
        // so for the document owner this is a same-reference passthrough.
        // Each remaining hit is re-checked through the click-hit gate so a
        // stale annotation lookup (e.g. annotation deleted between marquee
        // resolve and pointerup commit) cannot leave a foreign-author index
        // in the subtract set. CONTEXT.md AC: collaborator alt-marquee never
        // touches foreign-author selection state.
        const ownAltHits = annotationIndices.filter((i) => canSelectAnnotationByIndex(i));
        if (ownAltHits.length > 0) {
          setSelectedIds((prev) => {
            const nextSet = new Set(prev);
            for (const i of ownAltHits) nextSet.delete(i);
            return nextSet;
          });
        }
        // Callout subtract: no-op for now — callouts live in App.jsx
        // state and the hook doesn't hold the current Set to mutate.
        // Revisit when callout subtract becomes a user-visible need.
      } else if (mq.shiftHeld) {
        // Union: add marquee hits to the existing selection. Empty result
        // + Shift held is a no-op per 19-CONTEXT.md acceptance criteria.
        if (annotationIndices.length > 0) {
          setSelectedIds((prev) => {
            const nextSet = new Set(prev);
            for (const i of annotationIndices) nextSet.add(i);
            return nextSet;
          });
        }
        if (calloutIds.length > 0 && onSelectedCalloutIdsChange) {
          // NOTE: callouts live in App.jsx state; the hook doesn't hold
          // the current selected-callout Set. Union against the latest
          // hits only — App.jsx's setSelectedCalloutIds callback receives
          // the full next Set. If App.jsx needs true union semantics
          // across calls, it can do the merge itself in the callback.
          onSelectedCalloutIdsChange(new Set(calloutIds));
        }
      } else {
        // Replace: marquee hits become the entire selection, including
        // the "clear everything" case when the result is empty.
        setSelectedIds(new Set(annotationIndices));
        if (onSelectedCalloutIdsChange) {
          onSelectedCalloutIdsChange(new Set(calloutIds));
        }
      }
      return;
    }

    const ds = dragStateRef.current;
    if (!ds.active) return;
    if (ds.mode === 'text-markup-horizontal' && e.pointerId !== ds.pointerId) return;
    markAnnotationPointerRelease(ds.diagGestureId, {
      action: ds.mode,
      handleId: ds.handleId || null,
      partType: ds.partType || null,
    });

    if (ds.mode === 'move') {
      const pt = new DOMPoint(e.clientX, e.clientY);
      const svgPoint = ds.ctmInverse
        ? pt.matrixTransform(ds.ctmInverse)
        : screenToSVG(svgRef.current, e.clientX, e.clientY);

      const dx = svgPoint.x - ds.startSVGPoint.x;
      const dy = svgPoint.y - ds.startSVGPoint.y;

      // Only commit if there was actual movement (> 2px threshold to avoid accidental micro-drags)
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        const obj = annotations?.objects?.[ds.annotationIndex];
        if (obj) {
          const bbox = getAnnotationBBox(obj);
          // Constrain against the ABSOLUTE bbox. getAnnotationBBox returns world
          // coords for every type — including user-drawn pen paths where obj.left
          // is a move offset on top of absolute-coord path data. Feeding the raw
          // offset (originalProps.left + dx) into constrainToPage produced
          // spurious clamps to (0,0) for pen strokes drawn in the middle of the
          // page, causing drag-left/up to snap back to origin.
          const newAbsLeft = bbox.left + dx;
          const newAbsTop = bbox.top + dy;
          const constrained = constrainToPage(newAbsLeft, newAbsTop, bbox.width, bbox.height, pageWidth, pageHeight);
          const actualDx = constrained.left - bbox.left;
          const actualDy = constrained.top - bbox.top;

          // Deep clone annotations and apply position update
          const updatedAnnotations = deepClone(annotations);
          const targetObj = updatedAnnotations.objects[ds.annotationIndex];

          // Absolute-coord path (user-drawn from FabricDrawingCanvas which
          // leaves left/top at zero + omits pathOffset): translate the path
          // data itself so the SVG renderer and Fabric eraser canvas agree
          // on position. Imported paths that have been normalized (Chunk 2)
          // now carry left/top as their world position with path data in
          // LOCAL coords starting at (0, 0) — those must NOT hit this
          // branch, or first-touch rebakes them back to world coords and
          // zeroes left/top, which then breaks every subsequent
          // resize/rotate. Requiring left/top to be null-or-zero keeps the
          // old behavior for internal live-drawn strokes while letting
          // normalized imports take the standard translate branch.
          const isAbsolutePath = isAbsoluteInkGeometry(obj);

          if (isAbsolutePath) {
            Object.assign(
              targetObj,
              commitInkObjectMove(
                targetObj,
                actualDx,
                actualDy,
              ),
            );
          } else {
            // Standard types (rect/circle/ellipse/line/text): accumulate delta
            // onto originalProps.left/top. Equivalent to the previous
            // `targetObj.left = constrained.left` for all these types since
            // bbox.left === obj.left for rect/circle/ellipse/line/text.
            targetObj.left = ds.originalProps.left + actualDx;
            targetObj.top = ds.originalProps.top + actualDy;
            // UX 2026-04-20: the line's curve midpoint (obj.data.midpoint)
            // is stored in ABSOLUTE page coords, not as an offset from
            // obj.left/top like the endpoints are. A plain-move drag
            // translates obj.left/top (moving the endpoints with them)
            // but leaves an absolute-coord midpoint anchored to its
            // original world position — the curve reshapes on release
            // because the midpoint's offset from the new endpoint
            // midpoint is now different from what the user saw mid-drag.
            // Translate the midpoint by the same delta to keep the
            // bezier rigid.
            if (String(targetObj.type || '').toLowerCase() === 'line' && targetObj.data?.midpoint) {
              targetObj.data = {
                ...targetObj.data,
                midpoint: {
                  x: targetObj.data.midpoint.x + actualDx,
                  y: targetObj.data.midpoint.y + actualDy,
                },
              };
            }
          }

          // Save through existing pipeline
          onSaveAnnotations(updatedAnnotations, {
            source: 'object:modified',
            action: 'move',
            checkpointPolicy: 'normal',
          });

          // UX: the browser will emit a native `dblclick` if this pointerup
          // closes a click sequence that matches the double-click timing
          // window (click-to-select → click-drag-to-move fits it). Stamp
          // the drag-end time so `handleAnnotationDoubleClick` can suppress
          // that spurious dblclick and prevent the "everything vanishes"
          // edit-mode entry bug (see justDraggedAtRef declaration).
          justDraggedAtRef.current = Date.now();
        }
      }
    } else if (ds.mode === 'counter-orbit') {
      // UX 2026-04-20: if the pointer barely moved, treat this as a plain
      // Shift-click (multi-select toggle), not a rotation. Pointermove has
      // only been live-saving with 'skip' checkpoints so no undo entry
      // exists yet — bailing out here leaves the annotation state pristine.
      const pt = new DOMPoint(e.clientX, e.clientY);
      const endPoint = ds.ctmInverse
        ? pt.matrixTransform(ds.ctmInverse)
        : screenToSVG(svgRef.current, e.clientX, e.clientY);
      const moveDx = endPoint.x - ds.startSVGPoint.x;
      const moveDy = endPoint.y - ds.startSVGPoint.y;
      const movedFar = (moveDx * moveDx + moveDy * moveDy) > 9; // ~3px threshold
      if (movedFar) {
        const finalAnnotations = ds.currentAnnotations || annotations;
        if (finalAnnotations?.objects?.[ds.annotationIndex]) {
          onSaveAnnotations(finalAnnotations, {
            source: 'counter:orbit-commit',
            action: 'counter-rotate',
            checkpointPolicy: 'normal',
          });
        }
        justDraggedAtRef.current = Date.now();
      } else {
        // Phase 35 Plan 03 — per-user delete authority gate at the
        // counter-orbit Shift-click toggle alternate path. The handler-entry
        // gate in handleAnnotationPointerDown already covered the click that
        // initiated this drag, but the dragstate persists across the move so
        // the toggle commit needs an explicit re-check at pointerup. AC #3:
        // a sub-threshold release on a foreign-author counter must NOT add
        // the index to the selection set. Owner-mode short-circuits inside
        // canModify so this is byte-identical for owner sessions.
        if (!canSelectAnnotationByIndex(ds.annotationIndex)) {
          return;
        }
        // Treat as Shift-click selection toggle.
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(ds.annotationIndex)) next.delete(ds.annotationIndex);
          else next.add(ds.annotationIndex);
          return next;
        });
      }
    } else if (ds.mode === 'vertex') {
      const finalAnnotations = ds.currentAnnotations || annotations;
      if (finalAnnotations?.objects?.[ds.annotationIndex]) {
        onSaveAnnotations(finalAnnotations, {
          source: 'object:modified',
          action: 'vertex-move',
          checkpointPolicy: 'normal',
        });
      }
    } else if (ds.mode === 'endpoint' && ds.currentEndpoint) {
      // Pointermove is preview-only for lines/arrows; commit the real
      // annotation once here so sync + undo see one change per drag.
      const updatedAnnotations = deepClone(annotations);
      const targetObj = updatedAnnotations.objects[ds.annotationIndex];
      const { midpoint, ...endpointData } = ds.currentEndpoint;
      Object.assign(targetObj, endpointData);
      const newEpC = getLineEndpoints(targetObj);
      if (midpoint) {
        const newStart = { x: newEpC.x1, y: newEpC.y1 };
        const newEnd = { x: newEpC.x2, y: newEpC.y2 };
        if (shouldRevertEndpointCurve(midpoint, newStart, newEnd, 10)) {
          clearMidpointFromAnnotation(targetObj);
        } else {
          applyMidpointToAnnotation(targetObj, midpoint);
        }
      }
      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'endpoint-move',
        checkpointPolicy: 'normal',
      });
    } else if (ds.mode === 'midpoint' && ds.currentMidpoint) {
      // Phase 15 LINE-02 / ARROW-02 — silent snap-to-straight at pointerup.
      // If the user released the midpoint within 10px of the baseline, clear
      // data.midpoint so the line re-enters the straight <line> render branch.
      // No visual indicator during drag (combined-tools behavior, 15-UI-SPEC §E).
      // Checkpoint policy 'normal' so this drag produces one undo entry.
      const updatedAnnotations = deepClone(annotations);
      const targetObj = updatedAnnotations.objects[ds.annotationIndex];
      const { midpoint, ...midpointData } = ds.currentMidpoint;
      Object.assign(targetObj, midpointData);
      if (!midpoint) {
        clearMidpointFromAnnotation(targetObj);
      } else {
        applyMidpointToAnnotation(targetObj, midpoint);
      }
      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'midpoint-move',
        checkpointPolicy: 'normal',
      });
    } else if ((ds.mode === 'group-rotate' || ds.mode === 'group-resize')
               && ds.groupMemberOriginals) {
      const finalAnnotations = ds.currentAnnotations || annotations;
      onSaveAnnotations(finalAnnotations, {
        source: 'object:modified',
        action: ds.mode,
        checkpointPolicy: 'normal',
      });
      // UX: 2026-04-21 v11 — PowerPoint approach for rotate too: the
      // tilted frame is a live-preview during the drag, but on pointerup
      // the outer dashed box snaps back to axis-aligned around the (now
      // individually rotated) shapes. Shapes keep their own `angle`
      // values; only the group-level tilt state is cleared. This matches
      // the resize behavior — the group bbox is always axis-aligned at
      // rest.
      if (ds.mode === 'group-rotate') {
        setPersistedGroupTransform(null);
        setVisualTransform(null);
      } else if (ds.mode === 'group-resize') {
        // UX: 2026-04-21 v11 — PowerPoint approach: after resize, the
        // group stays axis-aligned. Shapes keep their individual angles
        // intact. If the user wants a tilt back, they rotate again.
        setPersistedGroupTransform(null);
        setVisualTransform(null);
      }
      try {
        diagLog('[GroupTransformDiag] commit ' + JSON.stringify({
          ts: new Date().toISOString(),
          mode: ds.mode,
          handleId: ds.handleId,
          finalAngleDeg: ds.currentAngle,
          finalScale: ds.currentResize,
          memberFinal: Object.keys(ds.groupMemberOriginals).reduce((acc, idxStr) => {
            const idx = Number(idxStr);
            const t = finalAnnotations.objects?.[idx];
            if (!t) return acc;
            acc[idx] = {
              type: t.type, dataType: t.data?.type,
              left: t.left, top: t.top, angle: t.angle,
              scaleX: t.scaleX, scaleY: t.scaleY, radius: t.radius,
              x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2,
              pointerAngle: t.data?.pointerAngle,
              midpoint: t.data?.midpoint,
            };
            return acc;
          }, {}),
        }));
      } catch (_) {}
      // UX: see move-branch comment — same spurious-dblclick guard.
      justDraggedAtRef.current = Date.now();
    } else if (ds.mode === 'group-move' && ds.groupOriginals) {
      // Group drag commit: apply totalDelta from ORIGINAL positions (prevents drift)
      const pt = new DOMPoint(e.clientX, e.clientY);
      const svgPoint = ds.ctmInverse
        ? pt.matrixTransform(ds.ctmInverse)
        : screenToSVG(svgRef.current, e.clientX, e.clientY);

      const dx = svgPoint.x - ds.startSVGPoint.x;
      const dy = svgPoint.y - ds.startSVGPoint.y;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        const updatedAnnotations = deepClone(annotations);

        for (const [idxStr, orig] of Object.entries(ds.groupOriginals)) {
          const idx = Number(idxStr);
          const obj = updatedAnnotations.objects[idx];
          if (!obj) continue;
          const bbox = getAnnotationBBox(obj);
          // Constrain against the ABSOLUTE bbox per-annotation (same reasoning
          // as the single-move branch above — user-drawn pen paths carry an
          // offset in obj.left that is not a world coord, so feeding the raw
          // offset into constrainToPage would snap them to (0,0) on left/up
          // drags).
          const newAbsLeft = bbox.left + dx;
          const newAbsTop = bbox.top + dy;
          const constrained = constrainToPage(
            newAbsLeft, newAbsTop,
            bbox.width, bbox.height, pageWidth, pageHeight
          );
          const actualDx = constrained.left - bbox.left;
          const actualDy = constrained.top - bbox.top;

          // Same dual-convention handling as the single-move branch above —
          // require left/top be null-or-zero so normalized imported paths
          // (world-positioned, local path data) take the standard
          // translate-by-delta branch instead of being rebaked.
          const isAbsolutePath = isAbsoluteInkGeometry(obj);

          if (isAbsolutePath) {
            Object.assign(
              obj,
              commitInkObjectMove(
                obj,
                actualDx,
                actualDy,
              ),
            );
          } else {
            obj.left = orig.left + actualDx;
            obj.top = orig.top + actualDy;
            // UX 2026-04-20: mirror the single-move branch — a
            // multi-select drag of a curved line/arrow must translate
            // its absolute-coord midpoint alongside the endpoints so
            // the bezier stays rigid on release.
            if (String(obj.type || '').toLowerCase() === 'line' && obj.data?.midpoint) {
              obj.data = {
                ...obj.data,
                midpoint: {
                  x: obj.data.midpoint.x + actualDx,
                  y: obj.data.midpoint.y + actualDy,
                },
              };
            }
          }
        }

        onSaveAnnotations(updatedAnnotations, {
          source: 'object:modified',
          action: 'group-move',
          checkpointPolicy: 'normal',
        });

        // UX: see move-branch comment — same spurious-dblclick guard.
        justDraggedAtRef.current = Date.now();
        // UX: 2026-04-21 — if persisted group rotation is active for this
        // selection, accumulate the move delta into its dx/dy so the
        // tilted bbox shifts along with the shapes instead of staying
        // anchored at its original spot.
        const sigMove = computeSelectionSig(selectedIds, selectedCalloutIds);
        const prevMove = persistedGroupTransformRef.current;
        if (prevMove && prevMove.selectionSig === sigMove) {
          setPersistedGroupTransform({
            ...prevMove,
            dx: (prevMove.dx || 0) + dx,
            dy: (prevMove.dy || 0) + dy,
          });
        }
      }
      // UX: 2026-04-20 v2 — callout commit for group-move. Live drag now
      // uses render-time translate via affectedCalloutIds (no setCallouts
      // round-trip per frame). On pointerup we compute the final delta
      // and call onUpdateCalloutLive to write each callout's actual new
      // position, then onUpdateCallout for the undo checkpoint.
      if (ds.groupCalloutOriginals) {
        const ptUp = new DOMPoint(e.clientX, e.clientY);
        const svgPtUp = ds.ctmInverse
          ? ptUp.matrixTransform(ds.ctmInverse)
          : screenToSVG(svgRef.current, e.clientX, e.clientY);
        const dxUp = svgPtUp.x - ds.startSVGPoint.x;
        const dyUp = svgPtUp.y - ds.startSVGPoint.y;
        const W = pageWidth || 1;
        const H = pageHeight || 1;
        const dxNorm = dxUp / W;
        const dyNorm = dyUp / H;
        for (const [cid, orig] of Object.entries(ds.groupCalloutOriginals)) {
          if (typeof onUpdateCalloutLive === 'function') {
            onUpdateCalloutLive(cid, {
              arrowTip: { x: orig.arrowTip.x + dxNorm, y: orig.arrowTip.y + dyNorm },
              knee: { x: orig.knee.x + dxNorm, y: orig.knee.y + dyNorm },
              textBoxPosition: { x: orig.textBoxPosition.x + dxNorm, y: orig.textBoxPosition.y + dyNorm },
            });
          }
          if (typeof onUpdateCallout === 'function') {
            onUpdateCallout(cid, {});
          }
        }
      }
    } else if (ds.mode === 'text-markup-horizontal' && ds.currentTextMarkup) {
      const updatedAnnotations = deepClone(annotations);
      updatedAnnotations.objects[ds.annotationIndex] = ds.currentTextMarkup;
      onSaveAnnotations(updatedAnnotations, {
        source: 'text-markup:range-resize',
        action: 'text-range-resize',
        checkpointPolicy: 'normal',
      });
    } else if (ds.mode === 'resize' && ds.currentResize) {
      const {
        newScaleX,
        newScaleY,
        newLeft,
        newTop,
        counterNewRadius,
        pathResizePageMatrix,
      } = ds.currentResize;

      const updatedAnnotations = deepClone(annotations);
      const obj = updatedAnnotations.objects[ds.annotationIndex];

      if (
        String(obj?.type || '').toLowerCase() === 'path'
        && Array.isArray(pathResizePageMatrix)
      ) {
        Object.assign(obj, applyPageAffineToInkObject(obj, pathResizePageMatrix));
      } else if (isAbsoluteInkGeometry(obj) || isCenterOriginInkGeometry(obj)) {
        // Page-space ink is first represented through object transform fields
        // (center origin + scale) so Q/C curves and parallel eraser/export
        // carriers remain byte-stable. This also scales open-stroke width with
        // the object, including non-uniform resize.
        Object.assign(
          obj,
          commitInkObjectResize(
            obj,
            {
              scaleX: newScaleX,
              scaleY: newScaleY,
              visibleLeft: newLeft,
              visibleTop: newTop,
            },
          ),
        );
      } else {
        const objType = String(obj.type || '').toLowerCase();
        if (objType === 'line') {
          // UX 2026-04-19 / 20: line / arrow resize commit with
          // bbox-center-pivot Δ-compensation. Works for both
          // Fabric-native lines (x1/x2 = offsets from bbox center)
          // and PDF-imported lines (x1/x2 = absolute page coords,
          // obj.left/width both zero). getLineEndpoints resolves to
          // absolute endpoints for either convention. Three steps:
          //   1. Scale endpoints + stored midpoint around the LOCAL
          //      anchor in pre-rotation frame → naive new points.
          //   2. Compute Δ = naive curve-inclusive bbox center -
          //      original, and derive (R - I)·Δ shift. At angle=0
          //      this collapses to zero; at any other angle it
          //      compensates for the pivot drift so the WORLD
          //      anchor (the edge the user pulled AGAINST) stays
          //      pinned — matches the rectangle-style anchor pin.
          //   3. Shift all three points by the compensation, pack
          //      back into Fabric convention (bbox of chord +
          //      offset-from-center endpoints + absolute midpoint).
          const ep = getLineEndpoints(obj);
          const sx = Math.max(0.01, Math.abs(newScaleX));
          const sy = Math.max(0.01, Math.abs(newScaleY));
          const naiveP1 = { x: ds.anchorX + (ep.x1 - ds.anchorX) * sx, y: ds.anchorY + (ep.y1 - ds.anchorY) * sy };
          const naiveP2 = { x: ds.anchorX + (ep.x2 - ds.anchorX) * sx, y: ds.anchorY + (ep.y2 - ds.anchorY) * sy };
          const oldMidR = obj?.data?.midpoint || null;
          const naiveMidR = oldMidR
            ? { x: ds.anchorX + (oldMidR.x - ds.anchorX) * sx, y: ds.anchorY + (oldMidR.y - ds.anchorY) * sy }
            : null;
          const pivotOldR = computeLineBboxCenter(
            { x1: ep.x1, y1: ep.y1, x2: ep.x2, y2: ep.y2 },
            oldMidR,
          );
          const pivotNaiveR = computeLineBboxCenter(
            { x1: naiveP1.x, y1: naiveP1.y, x2: naiveP2.x, y2: naiveP2.y },
            naiveMidR,
          );
          const angleRadR = ((obj.angle ?? 0) * Math.PI) / 180;
          const cosR = Math.cos(angleRadR);
          const sinR = Math.sin(angleRadR);
          const dXR = pivotNaiveR.x - pivotOldR.x;
          const dYR = pivotNaiveR.y - pivotOldR.y;
          const shiftXR = (cosR - 1) * dXR - sinR * dYR;
          const shiftYR = sinR * dXR + (cosR - 1) * dYR;
          const finalP1R = { x: naiveP1.x + shiftXR, y: naiveP1.y + shiftYR };
          const finalP2R = { x: naiveP2.x + shiftXR, y: naiveP2.y + shiftYR };
          const finalMidR = naiveMidR
            ? { x: naiveMidR.x + shiftXR, y: naiveMidR.y + shiftYR }
            : null;
          const newBoxLeft = Math.min(finalP1R.x, finalP2R.x);
          const newBoxTop = Math.min(finalP1R.y, finalP2R.y);
          const newBoxW = Math.max(1, Math.abs(finalP2R.x - finalP1R.x));
          const newBoxH = Math.max(1, Math.abs(finalP2R.y - finalP1R.y));
          const newCx = newBoxLeft + newBoxW / 2;
          const newCy = newBoxTop + newBoxH / 2;
          obj.left = newBoxLeft;
          obj.top = newBoxTop;
          obj.width = newBoxW;
          obj.height = newBoxH;
          obj.x1 = finalP1R.x - newCx;
          obj.y1 = finalP1R.y - newCy;
          obj.x2 = finalP2R.x - newCx;
          obj.y2 = finalP2R.y - newCy;
          obj.scaleX = 1;
          obj.scaleY = 1;
          if (finalMidR) {
            obj.data = { ...obj.data, midpoint: finalMidR };
          }
        } else if (obj?.data?.type === 'counter') {
          obj.radius = Math.max(4, counterNewRadius || (obj.radius || 14) * Math.abs(newScaleX));
          obj.scaleX = 1;
          obj.scaleY = 1;
          obj.left = newLeft;
          obj.top = newTop;
        } else if (objType === 'textbox' || objType === 'i-text' || objType === 'text') {
          // Text: absorb scale into width/height so text reflows instead of stretching.
          // Honor the user's chosen size — do NOT re-tighten to fit current text.
          // If the user resized the box oversized, that was deliberate. A future
          // per-annotation "auto-fit on commit" setting will reintroduce tightening
          // as an opt-in behavior (see FEATURE-BACKLOG.md).
          // Note: text does not support flip (scale is clamped positive upstream)
          // so the ratio below is always positive.
          obj.width = (obj.width || 100) * (newScaleX / (ds.originalProps.scaleX || 1));
          if (obj.height) {
            obj.height = obj.height * (newScaleY / (ds.originalProps.scaleY || 1));
          }
          obj.scaleX = 1;
          obj.scaleY = 1;
          obj.left = newLeft;
          obj.top = newTop;
        } else if (ds.originalProps.isPointsShape) {
          // UX: polygon/polyline. `newLeft`/`newTop` are in visible-bbox space
          // (the resize formula used bbox.left/top as the reference). Convert
          // back to object-space so obj.left/top — through the SVG transform
          // chain `translate(obj.left, obj.top) scale(sx, sy) translate(-pathOffset)`
          // — lands the visible bbox at the target position. Derivation:
          //   visibleLeft = obj.left + sx*(localMinX - pathOffsetX)
          //   ⇒ obj.left = visibleLeft - sx*(localMinX - pathOffsetX)
          // Scale is already clamped positive upstream (polygon does not
          // support flip), so |newScaleX| === newScaleX here.
          const sx = Math.abs(newScaleX);
          const sy = Math.abs(newScaleY);
          obj.scaleX = sx;
          obj.scaleY = sy;
          obj.left = newLeft - sx * (ds.originalProps.pointsLocalMinX - ds.originalProps.pointsPathOffsetX);
          obj.top = newTop - sy * (ds.originalProps.pointsLocalMinY - ds.originalProps.pointsPathOffsetY);
        } else {
          // Bug #8: normalize flip to positive scale on commit. For rect/
          // circle/ellipse a mirrored shape is visually identical to a non-
          // flipped shape at a different (x, y), and `newLeft`/`newTop`
          // already point to the visible top-left corner (the handler
          // normalized them above). Storing |scale| keeps the JSON clean —
          // renderers and bbox math all Math.abs anyway, so we just drop
          // the sign at commit instead of letting negative scale leak into
          // persisted annotations.
          obj.scaleX = Math.abs(newScaleX);
          obj.scaleY = Math.abs(newScaleY);
          obj.left = newLeft;
          obj.top = newTop;
        }
      }

      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'scale',
        checkpointPolicy: 'normal',
      });
      // UX 2026-04-19 diag: final state on resize commit — what actually
      // got saved vs what the handler computed. Pair with the [start] and
      // [move] logs above to reconstruct the full drag in one transcript.
      try {
        const committedObj = updatedAnnotations.objects[ds.annotationIndex];
        const commitPayload = {
          ts: new Date().toISOString(),
          handleId: ds.handleId,
          annotationIndex: ds.annotationIndex,
          finalScale: { newScaleX, newScaleY },
          finalPos: { newLeft, newTop },
          committedObj: {
            type: committedObj?.type, tool: committedObj?.tool,
            left: committedObj?.left, top: committedObj?.top,
            width: committedObj?.width, height: committedObj?.height,
            scaleX: committedObj?.scaleX, scaleY: committedObj?.scaleY,
            angle: committedObj?.angle,
            x1: committedObj?.x1, y1: committedObj?.y1, x2: committedObj?.x2, y2: committedObj?.y2,
            radius: committedObj?.radius, rx: committedObj?.rx, ry: committedObj?.ry,
            points: Array.isArray(committedObj?.points) ? committedObj.points.length : undefined,
            data: committedObj?.data,
          },
          committedBbox: committedObj ? getAnnotationBBox(committedObj) : null,
          originalPropsAtStart: ds.originalProps,
        };
        diagLog('[BboxScaleDiag] commit resize ' + JSON.stringify(commitPayload));
      } catch (err) { console.warn('[BboxScaleDiag] commit log failed', err); }
    } else if (ds.mode === 'rotate' && ds.currentAngle !== undefined) {
      const updatedAnnotations = deepClone(annotations);
      const rotObj = updatedAnnotations.objects[ds.annotationIndex];
      const rotObjType = String(rotObj?.type || '').toLowerCase();
      // Counter handle rotation previews through visualTransform during
      // pointermove; commit the final pointerAngle once on release.
      if (rotObj?.data?.type === 'counter') {
        rotObj.data = { ...(rotObj.data || {}), pointerAngle: ds.currentAngle };
        onSaveAnnotations(updatedAnnotations, {
          source: 'counter:handle-rotate-commit',
          action: 'counter-rotate',
          checkpointPolicy: 'normal',
        });
        justDraggedAtRef.current = Date.now();
        dragStateRef.current.active = false;
        dragStateRef.current.mode = null;
        setVisualTransform(null);
        setInteractionState('idle');
        return;
      }
      // UX 2026-04-20: every rotatable shape keeps its tilted frame after
      // release, matching the polygon/polyline behavior the user asked for.
      // That means we must NOT bake rotation into the shape's geometry on
      // commit — store obj.angle and let the renderer + selection overlay
      // read it as a live rotation. The line-specific endpoint-bake branch
      // that used to live here was reverted on 2026-04-20 after the user
      // called out that it snapped the selection frame back to vertical.
      rotObj.angle = ds.currentAngle;

      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'rotate',
        checkpointPolicy: 'normal',
      });
      // UX 2026-04-19 diag: rotate commit snapshot. Shows whether the
      // commit stored the new angle on obj.angle (rect / circle / ellipse
      // path) or baked it into endpoints (line path). Pair with the [start]
      // and [rotate-move] entries to see the full rotation transcript.
      try {
        const committedRot = updatedAnnotations.objects[ds.annotationIndex];
        const rotCommitPayload = {
          ts: new Date().toISOString(),
          handleId: ds.handleId,
          annotationIndex: ds.annotationIndex,
          committedAngleDeg: ds.currentAngle,
          committedObj: {
            type: committedRot?.type, tool: committedRot?.tool,
            left: committedRot?.left, top: committedRot?.top,
            width: committedRot?.width, height: committedRot?.height,
            scaleX: committedRot?.scaleX, scaleY: committedRot?.scaleY,
            angle: committedRot?.angle,
            x1: committedRot?.x1, y1: committedRot?.y1, x2: committedRot?.x2, y2: committedRot?.y2,
            radius: committedRot?.radius, rx: committedRot?.rx, ry: committedRot?.ry,
            points: Array.isArray(committedRot?.points) ? committedRot.points.length : undefined,
            data: committedRot?.data,
          },
          committedBbox: committedRot ? getAnnotationBBox(committedRot) : null,
          originalPropsAtStart: ds.originalProps,
          center: { x: ds.centerX, y: ds.centerY },
        };
        diagLog('[BboxScaleDiag] commit rotate ' + JSON.stringify(rotCommitPayload));
      } catch (err) { console.warn('[BboxScaleDiag] rotate commit log failed', err); }
    } else if (ds.mode === 'callout-part' && ds.calloutId) {
      // UX: Phase 14 CALL-10 — commit the callout drag. The live-paint
      // branch in handlePointerMove already wrote the final state to the
      // React store via onUpdateCalloutLive; pointerup just captures the
      // undo checkpoint via onUpdateCallout (which calls addHistoryCheckpoint
      // and does NOT mutate state). One undo entry per drag, matching the
      // Phase 9 per-action undo convention.
      //
      // Phase 15 UAT-3 (2026-04-17) — release-time rollback. During drag
      // the handle follows the pointer freely (no mid-drag pin, matching
      // combined-tools). Here we check the final-drop state against the
      // distance rules. If the drop position fails ANY rule we re-emit
      // lastSafeCalloutPositions (the most recent rule-compliant frame
      // captured during the drag) so the callout visibly snaps back to
      // the last good spot. 'whole' drags are trivially safe and skip
      // the check.
      const commitCalloutPatch = ds.currentCalloutPatch || null;
      let finalCalloutPatch = commitCalloutPatch;
      const currentCalloutFromPreview = (() => {
        const calloutArr = Array.isArray(callouts) ? callouts : [];
        const base = calloutArr.find((c) => c && c.id === ds.calloutId);
        return base && commitCalloutPatch ? { ...base, ...commitCalloutPatch } : base;
      })();

      if (ds.lastSafeCalloutPositions && ds.partType !== 'whole') {
        const W = pageWidth || 1;
        const H = pageHeight || 1;
        const last = ds.lastSafeCalloutPositions;
        const original = ds.originalCalloutPositions;
        const current = currentCalloutFromPreview;
        if (current && original) {
          const at = { x: (current.arrowTip?.x ?? 0) * W, y: (current.arrowTip?.y ?? 0) * H };
          const kn = { x: (current.knee?.x ?? 0) * W, y: (current.knee?.y ?? 0) * H };
          const bl = (current.textBoxPosition?.x ?? 0) * W;
          const bt = (current.textBoxPosition?.y ?? 0) * H;
          // UX: resize drag mutates width/height during the drag — read
          // the current dims from React state so the release-time rect
          // matches what the user sees. Position-only drags leave dims
          // untouched, so the original falls through cleanly.
          const bw = ((current.textBoxWidth ?? original.textBoxWidth) || 0) * W;
          const bh = ((current.textBoxHeight ?? original.textBoxHeight) || 0) * H;
          // UX: 2026-05-18 — extend the rect bottom by the renderer's descender
          // buffer (fontSize * 0.35) so the release rules measure against the
          // box the user sees, not the shorter stored rect.
          const calloutDescBuffer = Number(
            current.style?.fontSize ?? original.fontSize ?? 12
          ) * 0.35;
          const br = bl + bw;
          const bb = bt + bh + calloutDescBuffer;
          const pointInsideRect = (p, l, t, r, b) =>
            p.x >= l && p.x <= r && p.y >= t && p.y <= b;
          // UX: Phase 15 UAT-3 (2026-04-18) — segment-rect intersection via
          // Liang-Barsky. Returns true when the open line segment p1→p2
          // cuts through the interior of the rect. Endpoints exactly on
          // the border don't count (line naturally ends there).
          const segmentCrossesRect = (p1, p2, l, t, r, b) => {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            let t0 = 0, t1 = 1;
            const pp = [-dx, dx, -dy, dy];
            const qq = [p1.x - l, r - p1.x, p1.y - t, b - p1.y];
            for (let i = 0; i < 4; i++) {
              if (pp[i] === 0) {
                if (qq[i] < 0) return false;
              } else {
                const rr = qq[i] / pp[i];
                if (pp[i] < 0) {
                  if (rr > t1) return false;
                  if (rr > t0) t0 = rr;
                } else {
                  if (rr < t0) return false;
                  if (rr < t1) t1 = rr;
                }
              }
            }
            return t0 < t1 && t1 > 0.0001 && t0 < 0.9999;
          };

          // Same zoom-aware (clamped) effective handle radius the live drag check uses.
          const effHandleR = HANDLE_RADIUS * Math.sqrt(clampInverseScale(inverseScale));
          const minHandleToBox = effHandleR;
          const minHandleToHandle = effHandleR * 2;
          // Knee / arrow handles must also clear the four textbox corner
          // handle circles (which stick out past the border).
          const dropBoxCorners = [
            { x: bl, y: bt }, { x: br, y: bt }, { x: bl, y: bb }, { x: br, y: bb },
          ];
          const dropClearsCorners = (p) =>
            dropBoxCorners.every((c) => Math.hypot(p.x - c.x, p.y - c.y) >= minHandleToHandle);
          let dropSafe = true;
          if (ds.partType === 'knee' || ds.partType === 'textBox' || ds.partType === 'textBoxResize') {
            // UX: free drag during mouse-down, release checks the final spot.
            // Invalid if the knee or arrow lands inside the textbox, OR the
            // knee→arrow line cuts through the textbox, OR any handle touches
            // another handle / the textbox border. Line1 starts on the
            // textbox edge by construction so it can't cross.
            // 2026-05-18 — handle-collision rules added: the knee handle and
            // arrow handle must each clear the border, and clear each other,
            // by distances derived from the handle radius (calloutGeometry
            // HANDLE_RADIUS). Knee drags previously enforced no gap at all, so
            // the knee handle could be dropped flush against the border or
            // the arrow. On an invalid release we roll back to the pre-drag
            // snapshot: knee, arrow, textbox, both lines all return together.
            const kneeInside = pointInsideRect(kn, bl, bt, br, bb);
            const arrowInside = pointInsideRect(at, bl, bt, br, bb);
            const line2Cuts = segmentCrossesRect(kn, at, bl, bt, br, bb);
            const dRectUp = (pp, l, t, r, b) => {
              const ddx = Math.max(0, Math.max(l - pp.x, pp.x - r));
              const ddy = Math.max(0, Math.max(t - pp.y, pp.y - b));
              return Math.sqrt(ddx * ddx + ddy * ddy);
            };
            const kneeToBox = dRectUp(kn, bl, bt, br, bb);
            const arrowToBox = dRectUp(at, bl, bt, br, bb);
            const kneeToArrow = Math.hypot(kn.x - at.x, kn.y - at.y);
            dropSafe = !kneeInside && !arrowInside && !line2Cuts
              && kneeToBox >= minHandleToBox
              && arrowToBox >= minHandleToBox
              && kneeToArrow >= minHandleToHandle
              && dropClearsCorners(kn)
              && dropClearsCorners(at);
          } else {
            // Fallback: prior distance-rule set for arrow drag. Replaced
            // per partType as we tackle each in turn.
            const outside = (p, l, t, r, b) => !pointInsideRect(p, l, t, r, b);
            const dRect = (pp, l, t, r, b) => {
              const ddx = Math.max(0, Math.max(l - pp.x, pp.x - r));
              const ddy = Math.max(0, Math.max(t - pp.y, pp.y - b));
              return Math.sqrt(ddx * ddx + ddy * ddy);
            };
            dropSafe =
              outside(at, bl, bt, br, bb)
              && dRect(at, bl, bt, br, bb) >= minHandleToBox
              && Math.hypot(kn.x - at.x, kn.y - at.y) >= minHandleToHandle
              && outside(kn, bl, bt, br, bb)
              && dRect(kn, bl, bt, br, bb) >= minHandleToBox
              && dropClearsCorners(at)
              && dropClearsCorners(kn)
              // 2026-05-18 — knee stays put on an arrow drag; reject an arrow
              // drop that leaves the knee→arrow line cutting through the box.
              && !segmentCrossesRect(kn, at, bl, bt, br, bb);
          }
          if (!dropSafe) {
            // UX: Phase 15 UAT-3 (2026-04-18) — rollback target is the
            // pre-drag snapshot (the callout's state BEFORE the user
            // clicked the handle), not an intermediate safe frame from
            // the drag. Matches user intent: invalid drop → return to
            // where we started this drag.
            finalCalloutPatch = {
              arrowTip: original.arrowTip,
              knee: original.knee,
              textBoxPosition: original.textBoxPosition,
              // UX: resize drags also mutate width/height — restore both
              // so the textbox returns to its pre-drag size, not just
              // its pre-drag position.
              textBoxWidth: original.textBoxWidth,
              textBoxHeight: original.textBoxHeight,
            };
          } else {
            if (
              ds.partType === 'arrowTip'
              || ds.partType === 'textBox'
              || ds.partType === 'textBoxResize'
            ) {
              // UX: Phase 15 UAT-3 (2026-04-18) — when the final state is
              // valid but required auto-routing (stored knee sits inside
              // the new textbox, or the stored knee→arrow line crosses
              // the new textbox), persist the routed midpoint as the new
              // stored knee so a subsequent click on the visible knee
              // grabs where the user sees it — not where it used to be.
              const conn = calculateCalloutConnection(
                bl, bt, bw, bh, kn, at, 0
              );
              const routedX = conn.effectiveKnee.x;
              const routedY = conn.effectiveKnee.y;
              const drift = Math.hypot(routedX - kn.x, routedY - kn.y);
              if (drift > 0.5) {
                finalCalloutPatch = {
                  ...(finalCalloutPatch || {}),
                  knee: { x: routedX / W, y: routedY / H },
                };
              }
            }
          }
        }
      }
      const hasFinalCalloutPatch = finalCalloutPatch
        && typeof finalCalloutPatch === 'object'
        && Object.keys(finalCalloutPatch).length > 0;
      if (onUpdateCallout && hasFinalCalloutPatch) {
        onUpdateCallout(ds.calloutId, finalCalloutPatch || {});
      }
      try { e.target?.releasePointerCapture?.(e.pointerId); } catch (_) { /* optional */ }
      setActiveCalloutDrag(null);
    }

    // Reset drag state
    dragStateRef.current = {
      active: false, mode: null, handleId: null, startSVGPoint: null,
      originalProps: null, annotationIndex: null, ctmInverse: null,
      anchorX: null, anchorY: null, centerX: null, centerY: null,
      currentResize: null, currentAngle: undefined, groupOriginals: null,
      originalEndpoints: null, currentEndpoint: null,
      // UX: 2026-04-20 — Group transform fields. Same four-place invariant:
      // declared at top, set on group handle pointerdown, read in
      // pointermove + pointerup, reset here for clean next-drag.
      groupMemberOriginals: null, groupUnionOriginal: null,
      groupStartAngle: 0, lastGroupRotLogAt: 0, lastGroupResLogAt: 0,
      groupCalloutOriginals: null,
      // UX: Phase 14 CALL-10 — four-place invariant: reset callout-part
      // fields alongside the rest of the drag state so the next drag
      // starts with a clean slate. Miss one and the drag gets stuck.
      partType: null, calloutId: null, originalCalloutPositions: null,
      lastSafeCalloutPositions: null, textBoxCorner: null, currentCalloutPatch: null,
      // Phase 15 LINE-01/02/03 — four-place invariant for the 'midpoint'
      // drag mode. originalMidpoint is SET at pointerdown (both 'midpoint'
      // AND 'endpoint' dispatch branches set it), READ at pointermove AND
      // pointerup (both modes), and RESET here. Miss this reset and a
      // subsequent straight-line drag would re-apply a stale midpoint.
      originalMidpoint: null, currentMidpoint: null,
      // UX 2026-04-20: vertex-drag fields (polygon/polyline per-point drag).
      // Reset alongside the rest so the next drag starts clean.
      originalPoints: null, vertexIndex: null,
      originalTextMarkup: null, currentTextMarkup: null, fixedTextOffset: null,
      currentAnnotations: null,
      diagGestureId: null,
    };
    setVisualTransform(null);
    setInteractionState('idle');
  }, [annotations, pageWidth, pageHeight, onSaveAnnotations, svgRef, onUpdateCallout, onUpdateCalloutLive, callouts, applyMarqueeState, cancelLasso, deselectAll, onSelectedCalloutIdsChange, selectedCalloutIds, activeTool, viewerId, documentOwnerId, pageNumber, getSelectableAnnotationIndices, inverseScale]);

  const handlePointerCancel = useCallback((e) => {
    const ds = dragStateRef.current;
    if (!ds.active || ds.mode !== 'text-markup-horizontal') return;
    if (ds.pointerId != null && e.pointerId != null && ds.pointerId !== e.pointerId) return;
    try { e.target?.releasePointerCapture?.(e.pointerId); } catch (_) { /* optional */ }
    dragStateRef.current = {
      ...ds,
      active: false,
      mode: null,
      originalTextMarkup: null,
      currentTextMarkup: null,
      fixedTextOffset: null,
    };
    setVisualTransform(null);
    setInteractionState('idle');
  }, []);

  /**
   * Handle pointer down on a selection handle (resize/rotate).
   * Sets up drag state for resize (corner/edge handles) or rotation (mtr handle).
   */
  const handleHandlePointerDown = useCallback((e, handleId) => {
    e.stopPropagation();
    // KAL-75 (G4): locked/read-only documents — resize/rotate handles are a
    // pure transform surface; never arm the gesture. (Whole-shape move is
    // guarded in handlePointerMove, which all drag modes flow through.)
    if (document.body.getAttribute('data-readonly') === 'true') return;
    e.target.setPointerCapture(e.pointerId);

    // UX: 2026-04-20 — Group transform branch. When 2+ items are selected
    // (annotations + callouts combined), the multi-selection's outer dashed
    // bbox owns the rotate handle ('mtr') and the 8 resize handles. Drag
    // here = transform the WHOLE group as one rigid frame:
    //   - Rotation pivots every member around the union bbox center.
    //   - Resize anchors at the opposite corner/edge and scales every
    //     member's position + size by the same factor.
    //   - Per-shape special cases:
    //       Counter pin  — bubble center orbits AND data.pointerAngle
    //                      rotates with the group, so the nub follows like
    //                      a regular shape (per user spec 2026-04-20).
    //       Line/arrow   — endpoints + curvature midpoint rotate or scale
    //                      around the same pivot/anchor as everything else.
    //       Callout      — should NEVER reach here because the moveOnly
    //                      branch in SVGSelectionOverlay hides every handle
    //                      whenever a callout is in the multi-selection.
    //                      Defensive guard below short-circuits anyway.
    // Live commits use checkpointPolicy: 'skip' so each frame writes to the
    // store without spamming the undo stack; pointerup commits with 'normal'
    // for one undo entry per drag (matches counter-orbit pattern).
    const selSize = (selectedIds?.size || 0) + (
      selectedCalloutIds instanceof Set ? selectedCalloutIds.size :
      Array.isArray(selectedCalloutIds) ? selectedCalloutIds.length : 0
    );
    if (selSize > 1 && (handleId === 'mtr' || ['tl','tr','bl','br','mt','mb','ml','mr'].includes(handleId))) {
      // Defensive: callouts in selection → handles should be hidden, but if
      // a stale render somehow let one through, bail out so the user can't
      // accidentally scale/rotate a callout in a group.
      const hasCallout = (() => {
        const set = selectedCalloutIds;
        if (!set) return false;
        const arr = set instanceof Set ? Array.from(set) : (Array.isArray(set) ? set : []);
        return arr.length > 0;
      })();
      if (hasCallout) {
        try {
          diagLog('[GroupTransformDiag] blocked-by-callout ' + JSON.stringify({
            ts: new Date().toISOString(), handleId,
            selectedIds: Array.from(selectedIds || []),
            selectedCalloutIds: (selectedCalloutIds instanceof Set ? Array.from(selectedCalloutIds) : selectedCalloutIds || []),
          }));
        } catch (_) {}
        return;
      }

      const ctm = svgRef.current?.getScreenCTM();
      const ctmInverse = ctm ? ctm.inverse() : null;
      const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);

      // Snapshot every selected annotation's geometry. We capture LOTS so
      // the move handler can replay deterministic transforms from a known
      // baseline (matches Pitfall 6 from the original group-move research).
      //
      // UX: 2026-04-20 v3 — for each member capture BOTH:
      //   (a) `worldAABB` — axis-aligned wrap that already includes the
      //       member's existing rotation. Sum these to get the union outer
      //       frame center, which is the orbit pivot for every member.
      //   (b) `rotPivotX/Y` — the member's OWN rotation center. This is
      //       what the renderer spins the shape around when obj.angle
      //       changes, so it must be the point we orbit AND the point we
      //       translate the shape by. Computed via getAnnotationBBox (per-
      //       shape-aware local bbox) for most types, with a counter-pin
      //       override to the bubble center.
      //
      // Earlier v2 used the worldAABB center as the per-member rotation
      // pivot — that was wrong for already-rotated polygons because the
      // worldAABB center sits where the polygon LOOKS centered visually,
      // not where the renderer actually rotates around. Using the local
      // bbox center now fixes the "shape spins around its own center while
      // also orbiting" visual: orbit point = renderer's actual pivot.
      const memberOriginals = {};
      const memberWorldAABBs = [];
      for (const idx of selectedIds) {
        const obj = annotations?.objects?.[idx];
        if (!obj) continue;
        let aabb = null;
        try { aabb = getAnnotationWorldAABB(obj); } catch { aabb = null; }
        if (!aabb) {
          try { aabb = getAnnotationBBox(obj); } catch { aabb = null; }
        }
        // Local bbox center = renderer's rotation pivot for this shape.
        let localBBox = null;
        try { localBBox = getAnnotationBBox(obj); } catch { localBBox = null; }
        let rotPivotX = localBBox ? localBBox.left + localBBox.width / 2 : (obj.left || 0);
        let rotPivotY = localBBox ? localBBox.top + localBBox.height / 2 : (obj.top || 0);
        // Counter pin: renderer rotates around the bubble center, not the
        // local bbox center (which sits offset toward the nub side).
        if (obj?.data?.type === 'counter') {
          const cr = (obj.radius || 14) * Math.abs(obj.scaleX || 1);
          rotPivotX = (obj.left || 0) + cr;
          rotPivotY = (obj.top || 0) + cr;
        }
        memberOriginals[idx] = {
          objType: String(obj.type || '').toLowerCase(),
          dataType: obj?.data?.type || null,
          left: typeof obj.left === 'number' ? obj.left : 0,
          top: typeof obj.top === 'number' ? obj.top : 0,
          width: typeof obj.width === 'number' ? obj.width : 0,
          height: typeof obj.height === 'number' ? obj.height : 0,
          scaleX: typeof obj.scaleX === 'number' ? obj.scaleX : 1,
          scaleY: typeof obj.scaleY === 'number' ? obj.scaleY : 1,
          angle: typeof obj.angle === 'number' ? obj.angle : 0,
          radius: typeof obj.radius === 'number' ? obj.radius : null,
          rx: typeof obj.rx === 'number' ? obj.rx : null,
          ry: typeof obj.ry === 'number' ? obj.ry : null,
          x1: typeof obj.x1 === 'number' ? obj.x1 : null,
          y1: typeof obj.y1 === 'number' ? obj.y1 : null,
          x2: typeof obj.x2 === 'number' ? obj.x2 : null,
          y2: typeof obj.y2 === 'number' ? obj.y2 : null,
          midpoint: obj?.data?.midpoint ? { x: obj.data.midpoint.x, y: obj.data.midpoint.y } : null,
          pointerAngle: typeof obj?.data?.pointerAngle === 'number' ? obj.data.pointerAngle : null,
          // Member's renderer rotation pivot — used by group-rotate as
          // both the orbit point (orbit it around union center by delta)
          // AND the translation reference (move shape so its pivot lands
          // at the orbited location). For non-rotated shapes this equals
          // the worldAABB center; for already-rotated shapes they differ
          // and the local-bbox version is the correct one.
          rotPivotX, rotPivotY,
          // World AABB center — used by group-resize as the orbit-around
          // point for the visible bbox center (resize translates the
          // visible center, not the rotation pivot).
          aabbCenterX: aabb ? aabb.left + aabb.width / 2 : rotPivotX,
          aabbCenterY: aabb ? aabb.top + aabb.height / 2 : rotPivotY,
          aabbLeft: aabb ? aabb.left : (obj.left || 0),
          aabbTop: aabb ? aabb.top : (obj.top || 0),
          aabbWidth: aabb ? aabb.width : (obj.width || 0),
          aabbHeight: aabb ? aabb.height : (obj.height || 0),
        };
        if (aabb) memberWorldAABBs.push(aabb);
      }

      if (memberWorldAABBs.length === 0) return;
      const unionLeft = Math.min(...memberWorldAABBs.map((b) => b.left));
      const unionTop = Math.min(...memberWorldAABBs.map((b) => b.top));
      const unionRight = Math.max(...memberWorldAABBs.map((b) => b.left + b.width));
      const unionBottom = Math.max(...memberWorldAABBs.map((b) => b.top + b.height));
      const unionCx = (unionLeft + unionRight) / 2;
      const unionCy = (unionTop + unionBottom) / 2;
      const unionW = Math.max(1, unionRight - unionLeft);
      const unionH = Math.max(1, unionBottom - unionTop);

      // For resize: anchor = opposite corner/edge from the dragged handle.
      const anchorMap = {
        tl: { x: unionRight, y: unionBottom },
        tr: { x: unionLeft,  y: unionBottom },
        bl: { x: unionRight, y: unionTop    },
        br: { x: unionLeft,  y: unionTop    },
        mt: { x: unionCx,    y: unionBottom },
        mb: { x: unionCx,    y: unionTop    },
        ml: { x: unionRight, y: unionCy     },
        mr: { x: unionLeft,  y: unionCy     },
        mtr:{ x: unionCx,    y: unionCy     },
      };

      const isRotate = handleId === 'mtr';

      // UX: 2026-04-21 v6 — SECOND-ROTATION pivot lock. On subsequent
      // rotations of the same group, re-use the persisted frame center as
      // the rotation pivot instead of recomputing from the current world
      // AABB union. Rotated shapes have bigger axis-aligned boxes, so the
      // union center drifts away from the original group pivot after the
      // first rotation — spinning the shapes around that drifted point
      // breaks the rigid-frame illusion (shapes walk off the bbox on every
      // subsequent rotation). Lock to the original pivot (shifted by any
      // persisted group-moves) so every rotation of the same group uses
      // the same axis, just like a single-shape rotate keeps the same
      // pivot no matter how many times you spin it.
      let pivotCx = unionCx;
      let pivotCy = unionCy;
      let lockedFrameW = unionW;
      let lockedFrameH = unionH;
      let pivotSource = 'unionAABB';
      const selSig = computeSelectionSig(selectedIds, selectedCalloutIds);
      const persPrev = persistedGroupTransformRef.current;
      if (isRotate && persPrev && persPrev.selectionSig === selSig && persPrev.snapshotBbox) {
        const s = persPrev.snapshotBbox;
        pivotCx = s.left + s.width / 2 + (persPrev.dx || 0);
        pivotCy = s.top + s.height / 2 + (persPrev.dy || 0);
        lockedFrameW = s.width;
        lockedFrameH = s.height;
        pivotSource = 'persistedSnapshotCenter';
      }

      const startAngle = isRotate
        ? normalizeAngle(Math.atan2(svgPoint.y - pivotCy, svgPoint.x - pivotCx))
        : 0;

      dragStateRef.current = {
        active: true,
        mode: isRotate ? 'group-rotate' : 'group-resize',
        handleId,
        startSVGPoint: svgPoint,
        annotationIndex: null,
        ctmInverse,
        anchorX: anchorMap[handleId]?.x ?? unionCx,
        anchorY: anchorMap[handleId]?.y ?? unionCy,
        centerX: isRotate ? pivotCx : unionCx,
        centerY: isRotate ? pivotCy : unionCy,
        currentResize: null,
        currentAngle: undefined,
        groupOriginals: null,
        // Group-specific snapshot. For rotation we broadcast the persisted
        // frozen frame so the outer dashed box stays the same un-rotated
        // frame across N rotations; resize uses the actual current union
        // AABB since it reshapes the frame anyway.
        groupMemberOriginals: memberOriginals,
        groupUnionOriginal: isRotate
          ? {
              left: pivotCx - lockedFrameW / 2,
              top: pivotCy - lockedFrameH / 2,
              right: pivotCx + lockedFrameW / 2,
              bottom: pivotCy + lockedFrameH / 2,
              cx: pivotCx, cy: pivotCy,
              width: lockedFrameW, height: lockedFrameH,
            }
          : {
              left: unionLeft, top: unionTop, right: unionRight, bottom: unionBottom,
              cx: unionCx, cy: unionCy, width: unionW, height: unionH,
            },
        groupStartAngle: startAngle,
        pivotSource,
      };

      try {
        diagLog('[GroupTransformDiag] start ' + JSON.stringify({
          ts: new Date().toISOString(),
          mode: isRotate ? 'group-rotate' : 'group-resize',
          handleId,
          startPointerSVG: { x: svgPoint?.x, y: svgPoint?.y },
          unionBbox: { left: unionLeft, top: unionTop, right: unionRight, bottom: unionBottom, width: unionW, height: unionH, cx: unionCx, cy: unionCy },
          pivotUsed: { x: dragStateRef.current.centerX, y: dragStateRef.current.centerY, source: pivotSource },
          lockedFrame: isRotate ? { w: lockedFrameW, h: lockedFrameH, left: pivotCx - lockedFrameW / 2, top: pivotCy - lockedFrameH / 2 } : null,
          persistedPrev: persPrev ? {
            selectionSig: persPrev.selectionSig, matches: persPrev.selectionSig === selSig,
            angle: persPrev.angle, dx: persPrev.dx, dy: persPrev.dy,
            snapshotBbox: persPrev.snapshotBbox,
          } : null,
          anchor: { x: anchorMap[handleId]?.x, y: anchorMap[handleId]?.y },
          startAngleDeg: isRotate ? startAngle : null,
          memberCount: Object.keys(memberOriginals).length,
          memberOriginals,
        }));
      } catch (err) { console.warn('[GroupTransformDiag] start log failed', err); }
      // UX: 2026-04-21 v11 — PowerPoint approach: when resize starts on
      // any group (tilted or not), drop the persisted group tilt so the
      // outer frame snaps to a clean axis-aligned rectangle for the
      // whole drag. World-axis scaling is unambiguous — no shear in
      // spacing, no weird tilted handle math. Shapes keep their own
      // individual rotations intact (those live on each shape's own
      // `angle` and aren't touched). After release, the frame stays
      // axis-aligned; if the user wants a tilt back, they rotate again.
      if (!isRotate) {
        setPersistedGroupTransform(null);
      }
      setInteractionState(isRotate ? 'rotating' : 'resizing');
      return;
    }

    const selectedIndex = Array.from(selectedIds)[0]; // Single-select resize only
    if (selectedIndex === undefined) return;
    const obj = annotations?.objects?.[selectedIndex];
    if (!obj) return;

    const ctm = svgRef.current?.getScreenCTM();
    const ctmInverse = ctm ? ctm.inverse() : null;
    const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
    let bbox = getAnnotationBBox(obj);
    const isCounterPin = obj?.data?.type === 'counter';
    let counterBaseRadius = null;
    let counterBaseTipExtension = null;
    if (isCounterPin) {
      counterBaseRadius = (obj.radius || 14) * Math.abs(obj.scaleX || 1);
      const bodyX = (obj.left || 0) + counterBaseRadius;
      const bodyY = (obj.top || 0) + counterBaseRadius;
      counterBaseTipExtension = counterBaseRadius * 0.5;
      const pointerAngleDeg = obj.data?.pointerAngle != null ? obj.data.pointerAngle : 225;
      bbox = {
        left: bodyX - counterBaseRadius,
        top: bodyY - counterBaseRadius - counterBaseTipExtension,
        width: 2 * counterBaseRadius,
        height: 2 * counterBaseRadius + counterBaseTipExtension,
        angle: ((pointerAngleDeg + 90) % 360 + 360) % 360,
      };
    }

    if (obj?.data?.type === 'text-markup' && ['ml', 'mr'].includes(handleId)) {
      dragStateRef.current = {
        active: true,
        mode: 'text-markup-horizontal',
        handleId,
        startSVGPoint: svgPoint,
        annotationIndex: selectedIndex,
        ctmInverse,
        pointerId: e.pointerId,
        originalTextMarkup: deepClone(obj),
        currentTextMarkup: null,
        fixedTextOffset: handleId === 'ml' ? obj.data?.textRange?.end : obj.data?.textRange?.start,
      };
      setInteractionState('resizing');
      return;
    }

    // Phase 15 LINE-01 / ARROW-01 — midpoint curvature drag.
    // Capture the ORIGINAL midpoint (either data.midpoint if the line was
    // already curved, or the geometric midpoint if straight). On pointermove
    // we translate this by the pointer delta (see deriveMidpointFromPointer).
    // On pointerup we snap to straight when within 10px of the baseline
    // (silent snap — no visual indicator during drag per 15-UI-SPEC §E).
    if (handleId === 'midpoint') {
      const ep = getLineEndpoints(obj);
      const start = { x: ep.x1, y: ep.y1 };
      const end = { x: ep.x2, y: ep.y2 };
      const originalMidpoint = obj.data?.midpoint
        ? { x: obj.data.midpoint.x, y: obj.data.midpoint.y }
        : getMidpoint(start, end);
      dragStateRef.current = {
        active: true,
        mode: 'midpoint',
        handleId: 'midpoint',
        startSVGPoint: svgPoint,
        originalEndpoints: ep,
        originalMidpoint,
        currentMidpoint: null,
        annotationIndex: selectedIndex,
        ctmInverse,
        // UX 2026-04-20: capture rotation so pointermove can un-rotate the
        // world drag delta into local frame before adding it to the local-
        // coord midpoint (stored in obj.data.midpoint).
        originalProps: { angle: obj.angle || 0 },
      };
      if (typeof window !== 'undefined' && window.__LINE_BBOX_DIAG) try {
        diagLog('[BboxScaleDiag] start ' + JSON.stringify({
          ts: new Date().toISOString(), mode: 'midpoint', handleId, annotationIndex: selectedIndex,
          objType: obj.type, objTool: obj.tool, startPointerSVG: { x: svgPoint?.x, y: svgPoint?.y },
          originalEndpoints: ep, originalMidpoint,
          objSnapshot: { left: obj.left, top: obj.top, width: obj.width, height: obj.height, x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2, angle: obj.angle, data: obj.data },
        }));
      } catch (err) { console.warn('[BboxScaleDiag] midpoint start log failed', err); }
      return;
    }

    // Polygon / polyline per-vertex drag: handleId is `vertex-N`. Captures
    // the shape's full transform chain so pointermove can map world pointer
    // coords back into the shape's local-points frame and rewrite just the
    // one point being dragged. All other points stay where they were.
    if (typeof handleId === 'string' && handleId.startsWith('vertex-')) {
      const vertexIndex = parseInt(handleId.slice('vertex-'.length), 10);
      if (Number.isFinite(vertexIndex) && Array.isArray(obj.points) && obj.points[vertexIndex]) {
        dragStateRef.current = {
          active: true,
          mode: 'vertex',
          handleId,
          startSVGPoint: svgPoint,
          annotationIndex: selectedIndex,
          ctmInverse,
          vertexIndex,
          // Snapshot the full transform chain so the move handler can invert
          // it on each tick. We copy obj.points so we don't mutate the real
          // annotation until pointerup.
          originalPoints: obj.points.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 })),
          originalProps: {
            left: obj.left ?? 0,
            top: obj.top ?? 0,
            angle: obj.angle ?? 0,
            scaleX: obj.scaleX ?? 1,
            scaleY: obj.scaleY ?? 1,
            pathOffsetX: obj.pathOffset?.x || 0,
            pathOffsetY: obj.pathOffset?.y || 0,
          },
        };
      }
      return;
    }

    // Line/arrow endpoint drag: p1 or p2
    if (handleId === 'p1' || handleId === 'p2') {
      const ep = getLineEndpoints(obj);
      if (typeof window !== 'undefined' && window.__LINE_BBOX_DIAG) try {
        diagLog('[BboxScaleDiag] start ' + JSON.stringify({
          ts: new Date().toISOString(), mode: 'endpoint', handleId, annotationIndex: selectedIndex,
          objType: obj.type, objTool: obj.tool, startPointerSVG: { x: svgPoint?.x, y: svgPoint?.y },
          originalEndpoints: ep,
          objSnapshot: { left: obj.left, top: obj.top, width: obj.width, height: obj.height, x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2, angle: obj.angle, data: obj.data },
        }));
      } catch (err) { console.warn('[BboxScaleDiag] endpoint start log failed', err); }
      dragStateRef.current = {
        active: true,
        mode: 'endpoint',
        handleId,
        startSVGPoint: svgPoint,
        originalProps: {
          left: obj.left ?? 0,
          top: obj.top ?? 0,
          width: obj.width ?? 0,
          height: obj.height ?? 0,
          x1: obj.x1 ?? 0,
          y1: obj.y1 ?? 0,
          x2: obj.x2 ?? 0,
          y2: obj.y2 ?? 0,
          // UX 2026-04-20: capture obj.angle so the pointermove branch can
          // rotate the endpoints forward to world, apply the drag delta
          // there, then un-rotate back. Without this, rotated-line endpoint
          // drags fell back to straight-line math and drifted the non-
          // moving endpoint.
          angle: obj.angle || 0,
        },
        originalEndpoints: ep,
        // Phase 15 LINE-03 / ARROW-03 — capture the current data.midpoint at
        // drag-start so the pointermove branch can re-apply it defensively on
        // every tick (belt-and-suspenders — see the pointermove branch for
        // the full Pitfall-2 comment). Null when the line was straight at
        // drag-start; the preserve-write then no-ops.
        originalMidpoint: obj.data?.midpoint
          ? { x: obj.data.midpoint.x, y: obj.data.midpoint.y }
          : null,
        annotationIndex: selectedIndex,
        ctmInverse,
        currentEndpoint: null,
        currentMidpoint: null,
      };
      return;
    }

    const mode = handleId === 'mtr' ? 'rotate' : 'resize';
    // UX 2026-04-20: bbox center is the universal rotation pivot for
    // every shape type — rect/ellipse/textbox/line alike. For lines the
    // bbox is curve-inclusive (getLineBBox wraps endpoints + bezier
    // extrema with a 10-px minimum), so this center equals the
    // renderer's pivot + the overlay's pivot. Match = no jump on
    // rotation commit, handles stay flush with the visible shape, and
    // the rotation-aware resize math projects anchors to the correct
    // world positions.
    let cx = bbox.left + bbox.width / 2;
    let cy = bbox.top + bbox.height / 2;
    let rotationCx = cx;
    let rotationCy = cy;

    // UX 2026-04-20: counters rotate around the bubble center (not the
    // bbox center, which is offset toward the nub side). The visible pin
    // pivots in place while the nub swings.
    if (isCounterPin) {
      rotationCx = (obj.left || 0) + counterBaseRadius;
      rotationCy = (obj.top || 0) + counterBaseRadius;
    }

    // Anchor: opposite corner/edge from the dragged handle
    const anchorMap = {
      tl: { x: bbox.left + bbox.width, y: bbox.top + bbox.height },
      tr: { x: bbox.left, y: bbox.top + bbox.height },
      bl: { x: bbox.left + bbox.width, y: bbox.top },
      br: { x: bbox.left, y: bbox.top },
      mt: { x: cx, y: bbox.top + bbox.height },
      mb: { x: cx, y: bbox.top },
      ml: { x: bbox.left + bbox.width, y: cy },
      mr: { x: bbox.left, y: cy },
      mtr: { x: cx, y: cy }, // not used for rotation, but set for completeness
    };
    const anchor = anchorMap[handleId] || { x: cx, y: cy };

    // Imported paths: derive position/size from bbox
    const imported = isImportedPath(obj);
    const absolutePath = isAbsoluteCoordPath(obj);

    // UX: polygon/polyline are treated like imported paths for resize purposes.
    // Fabric doesn't reliably populate obj.width/height after a JSON round-trip
    // (it computes them at construct-time but drops them during persistence),
    // so rawWidth/height falls through to 0 and the resize formula's
    // `originalProps.width !== 0` guard silently skips all scale updates —
    // the visible symptom is the "resize handle does nothing" no-op bug.
    // Also, obj.left for polygon is NOT the visible-bbox top-left; the SVG
    // transform chain is `translate(obj.left, obj.top) scale(sx, sy)
    // translate(-pathOffsetX, -pathOffsetY)`, so the visible bbox sits at
    // `obj.left + sx*(minX - pathOffsetX)`. We scan the points once here to
    // capture (a) the unscaled bbox size and (b) the local-space min corner
    // + pathOffset so the commit branch can translate back to object-space.
    const objType = String(obj.type || '').toLowerCase();
    const isInkPath = objType === 'path' && Array.isArray(obj.path) && obj.path.length > 0;
    const isPointsShape = (objType === 'polygon' || objType === 'polyline')
      && Array.isArray(obj.points) && obj.points.length > 0;
    let pointsLocalMinX = 0, pointsLocalMinY = 0;
    let pointsPathOffsetX = 0, pointsPathOffsetY = 0;
    if (isPointsShape) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of obj.points) {
        const px = typeof p?.x === 'number' ? p.x : 0;
        const py = typeof p?.y === 'number' ? p.y : 0;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      pointsLocalMinX = minX;
      pointsLocalMinY = minY;
      pointsPathOffsetX = obj.pathOffset?.x ?? 0;
      pointsPathOffsetY = obj.pathOffset?.y ?? 0;
    }

    // Raw unscaled dimensions — the value that, multiplied by newScaleX, gives
    // the new rendered width. Must match how the SVG renderer treats "raw" for
    // each type: rect/text use obj.width, circle uses radius*2, ellipse uses
    // rx*2. Without this, circle/ellipse fall through to obj.width ?? 0 and
    // the resize math collapses the shape to its anchor corner on first drag.
    let rawWidth, rawHeight;
    // UX 2026-04-19: PDF-imported lines arrive with obj.width=0 / height=0
    // and x1..y2 already in absolute page coordinates, so the generic
    // `obj.width ?? 0` raw-dims fallback produced rawWidth=0 and the resize
    // formula's `width !== 0` guard silently skipped every scale update —
    // visible symptom: the line jumps to the anchor because newLeft uses
    // the raw width as its zero factor. Always use the computed visible
    // bbox for line/arrow so scale math actually runs.
    const objTypeForRaw = String(obj.type || '').toLowerCase();
    if (objTypeForRaw === 'line') {
      rawWidth = Math.max(1, bbox.width || 0);
      rawHeight = Math.max(1, bbox.height || 0);
    } else if (isInkPath) {
      // The path bbox already includes its existing scale/flip/skew in the
      // pre-rotation frame. Resize handles apply a new page affine to that
      // visible hull, then QR-decompose it back into object fields.
      rawWidth = getExactInkResizeDimension(bbox.width);
      rawHeight = getExactInkResizeDimension(bbox.height);
    } else if (imported || absolutePath) {
      rawWidth = bbox.width;
      rawHeight = bbox.height;
    } else if (isPointsShape) {
      // Points-based shapes: bbox is already scaled (see getPointsBBox), so
      // divide out the current scale to get the unscaled raw dimensions. If
      // scale is zero for any reason, fall back to the points-scan delta.
      const curSx = Math.abs(obj.scaleX ?? 1) || 1;
      const curSy = Math.abs(obj.scaleY ?? 1) || 1;
      rawWidth = bbox.width / curSx;
      rawHeight = bbox.height / curSy;
    } else {
      const type = objType;
      if (isCounterPin) {
        rawWidth = bbox.width;
        rawHeight = bbox.height;
      } else if (type === 'circle') {
        rawWidth = (obj.radius ?? 0) * 2;
        rawHeight = (obj.radius ?? 0) * 2;
      } else if (type === 'ellipse') {
        rawWidth = (obj.rx ?? 0) * 2;
        rawHeight = (obj.ry ?? 0) * 2;
      } else {
        rawWidth = obj.width ?? 0;
        rawHeight = obj.height ?? 0;
      }
    }

    dragStateRef.current = {
      active: true,
      mode,
      handleId,
      startSVGPoint: svgPoint,
      originalProps: {
        // Imported + points-based + line shapes: use visible-bbox left/top so
        // the resize formula (which produces a new left/top in visible-space)
        // has a matching reference point. Commit branch translates back to
        // object-space for polygon/polyline. For line, commit rewrites
        // endpoints directly, so visible-bbox left/top is what we want.
        left: (imported || absolutePath || isInkPath || isPointsShape || objTypeForRaw === 'line') ? bbox.left : (obj.left ?? 0),
        top: (imported || absolutePath || isInkPath || isPointsShape || objTypeForRaw === 'line') ? bbox.top : (obj.top ?? 0),
        scaleX: (imported || absolutePath || isInkPath) ? 1 : (obj.scaleX ?? 1),
        scaleY: (imported || absolutePath || isInkPath) ? 1 : (obj.scaleY ?? 1),
        angle: isCounterPin ? (bbox.angle ?? 0) : (obj.angle ?? 0),
        width: rawWidth,
        height: rawHeight,
        isCounterPin,
        counterBaseRadius,
        counterBaseTipExtension,
        // Points-based shapes need these at commit time to convert the
        // visible-space newLeft/newTop back to object-space obj.left/top.
        isPointsShape,
        isInkPath,
        pointsLocalMinX,
        pointsLocalMinY,
        pointsPathOffsetX,
        pointsPathOffsetY,
      },
      annotationIndex: selectedIndex,
      ctmInverse,
      anchorX: anchor.x,
      anchorY: anchor.y,
      centerX: rotationCx,
      centerY: rotationCy,
      currentResize: null,
      currentAngle: undefined,
    };
    // UX 2026-04-19 diag: full state dump on resize/rotate start. Lets
    // future-Claude see (a) which handle was grabbed, (b) the exact shape
    // JSON at start, (c) the anchor + center + raw dims used for the scale
    // formula. Used together with the pointermove and commit logs below.
    try {
      // UX 2026-04-19: serialize with JSON.stringify so the browser's
      // "Save as" console export captures the real values (plain console.log
      // writes "{…}" for object refs, which made the first log pass
      // useless). 2-space indent keeps the file human-readable.
      const startPayload = {
        ts: new Date().toISOString(),
        mode,
        handleId,
        annotationIndex: selectedIndex,
        objType: obj.type,
        objTool: obj.tool,
        isCounter: obj.data?.type === 'counter',
        isImportedPath: imported,
        isPointsShape,
        bboxAtStart: { left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height, angle: bbox.angle },
        startPointerSVG: { x: svgPoint?.x, y: svgPoint?.y },
        anchor,
        center: { x: rotationCx, y: rotationCy },
        rawWidth,
        rawHeight,
        objSnapshot: {
          left: obj.left, top: obj.top,
          width: obj.width, height: obj.height,
          scaleX: obj.scaleX, scaleY: obj.scaleY,
          angle: obj.angle,
          radius: obj.radius, rx: obj.rx, ry: obj.ry,
          x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2,
          points: Array.isArray(obj.points) ? obj.points.length : undefined,
          pathLen: Array.isArray(obj.path) ? obj.path.length : undefined,
          pathOffset: obj.pathOffset,
          data: obj.data,
        },
      };
      diagLog('[BboxScaleDiag] start ' + JSON.stringify(startPayload));
    } catch (err) { console.warn('[BboxScaleDiag] start log failed', err); }
  }, [selectedIds, annotations, svgRef]);

  // ---------------------------------------------------------------------------
  // Group delete (Plan 03): remove all selected annotations
  //
  // Phase 35 Plan 04 per-user delete authority — the parent (App.jsx) can
  // intercept the bulk-delete fire by providing an onRequestBulkDelete prop.
  // When provided, deleteSelected:
  //   1. Captures a closure-bound snapshot of the deleted objects + the
  //      current page number at request time (so an Undo click 5-6 seconds
  //      later restores exactly what was deleted regardless of state changes
  //      in the interim — modal/toast keeps the user from making competing
  //      edits during that window).
  //   2. Builds runDelete as a closure capturing indicesToDelete + the
  //      same snapshot (saveContext fields propagate snapshot/count/page so
  //      App.jsx's handleSaveAnnotations can layer the single-delete toast
  //      and onUndo restoration cleanly).
  //   3. Calls onRequestBulkDelete({ candidateIds, snapshotObjects,
  //      pageNumber, runDelete }). The parent (App.jsx) builds the
  //      BulkDeletePlan in scope of viewerId/documentOwnerId, decides
  //      modal vs direct-fire, and invokes runDelete when ready.
  //
  // When onRequestBulkDelete is absent, deleteSelected runs runDelete
  // unconditionally — legacy behavior byte-identical for boot-time and test
  // harnesses that don't mount App.jsx.
  // ---------------------------------------------------------------------------
  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;

    // Phase 35 hardening 2026-05-01, re-partitioned 2026-07-17 for the LOCKED
    // permissions model — defense-in-depth delete-time gate. Selection now
    // admits foreign-author shapes (canSelectAnnotationByIndex runs canDelete),
    // so this filter is the wall that decides HOW each id may be deleted:
    //   - own marks (canModify: author or document owner) — eligible on every
    //     path, including the legacy direct-fire fallbacks below.
    //   - foreign marks (canDelete but not canModify) — eligible ONLY when
    //     they can route through the parent's bulk-delete planner
    //     (onRequestBulkDelete present AND the object carries a stable id the
    //     planner is keyed by). The planner's collaborator-cross-author mode
    //     then ALWAYS shows the confirm modal — a foreign mark must never be
    //     deleted by a direct-fire fallback, so id-less foreign marks and the
    //     planner-absent mount (boot / test harness) drop foreign ids here.
    const plannerAvailable = typeof onRequestBulkDelete === 'function';
    const indicesToDelete = Array.from(selectedIds)
      .filter((idx) => {
        const obj = annotations?.objects?.[idx];
        if (!obj) return false;
        // Boot guard: mirror canSelectAnnotationByIndex's permissive
        // behavior during the brief window where viewerId / documentOwnerId
        // aren't resolved yet. Once both populate, the strict partition
        // below engages and is the single source of truth.
        if (!viewerId || !documentOwnerId) return true;
        if (canModify({ annotation: obj, viewerId, documentOwnerId })) return true;
        // Foreign-author: only deletable behind the planner's confirm modal.
        return plannerAvailable
          && obj.id != null
          && canDelete({ annotation: obj, viewerId, documentOwnerId });
      })
      .sort((a, b) => b - a);

    if (indicesToDelete.length === 0) return;

    // Capture snapshot at request time — closure over CURRENT state. The
    // bulk-delete planner reads from snapshotObjects (NOT from a ref in
    // App.jsx) which dodges the stale-closure bug from prior revisions
    // (Plan 35-04 frontmatter checker I13).
    const snapshotObjects = indicesToDelete
      .map((idx) => {
        const obj = annotations?.objects?.[idx];
        return obj ? deepClone(obj) : null;
      })
      .filter(Boolean);

    // Build runDelete closure — this is the existing delete code path,
    // with three new saveContext fields so App.jsx's handleSaveAnnotations
    // can layer the single-delete toast (deletedCount===1) and the
    // bulk-delete onUndo restoration (deletedSnapshot + deletedPageNumber).
    const runDelete = () => {
      const updatedAnnotations = deepClone(annotations);
      for (const idx of indicesToDelete) {
        updatedAnnotations.objects.splice(idx, 1);
      }
      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'delete',
        deletedCount: snapshotObjects.length,
        deletedSnapshot: snapshotObjects,
        deletedPageNumber: pageNumber,
        checkpointPolicy: 'normal',
      });
      deselectAll();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('betasafe:clear-text-markup-selection'));
      }
    };

    // Phase 35 Plan 04: route through the parent's bulk-delete planner when
    // it provides one. When absent (legacy / boot / test harness), fall
    // through to runDelete unconditionally — preserves prior behavior.
    if (typeof onRequestBulkDelete !== 'function') {
      runDelete();
      return;
    }

    // Build candidate ids from the snapshot so the parent receives a
    // fully-resolved id list (consistent between what the modal shows and
    // what runDelete will actually remove). Parent owns viewerId +
    // documentOwnerId — it builds the BulkDeletePlan and decides modal vs
    // direct-fire.
    const candidateIds = snapshotObjects.map((o) => o?.id).filter(Boolean);
    // Phase 35 regression fix 2026-05-01: the bulk-delete planner is keyed
    // by stable annotation id, but legacy / freshly-loaded / not-yet-synced
    // annotations have no id locally (data.id is stamped only on the first
    // cloud upload via serializeFabricObjectToRow). When EVERY snapshot
    // lacks an id the planner returns mode='no-op' and Delete becomes a
    // silent dead key. Safe to fall through here because the delete-time
    // partition above only admits id-less objects when they pass canModify
    // (own/boot) — a foreign-author mark requires obj.id, so an all-id-less
    // set is structurally own-only and may direct-fire without the modal.
    if (candidateIds.length === 0) {
      runDelete();
      return;
    }
    onRequestBulkDelete({
      candidateIds,
      snapshotObjects,
      pageNumber,
      runDelete,
    });
  }, [selectedIds, annotations, onSaveAnnotations, deselectAll, onRequestBulkDelete, pageNumber, viewerId, documentOwnerId]);

  // ---------------------------------------------------------------------------
  // EDIT-12 Gap 1 fix (Plan 12-03): optimistic rotation paint
  //
  // The RotationInputField commit path (typed value on Enter, ±1° Arrow nudge,
  // blur commit) calls onSaveAnnotations directly, which routes through
  // App.jsx:handleSaveAnnotations — a heavy pipeline (history fingerprinting,
  // deep compare, reducer, renumberCounters) that takes multiple frames
  // before React re-renders the shape at the new angle. During that window
  // the user sees the old angle and perceives a visible lag.
  //
  // Drag-rotate avoids this by painting the new angle via a cheap SVG
  // <g transform="rotate(delta, cx, cy)"> wrapper driven by visualTransform.rotate
  // (see handlePointerMove rotate branch at ~line 469) BEFORE onSaveAnnotations
  // fires on pointerup. By the time the heavy pipeline runs, the user has
  // already seen the final frame.
  //
  // This helper exposes the same optimistic-paint pattern to the typed-commit
  // path. SVGAnnotationLayer.handleRotationInputCommit calls this FIRST (cheap,
  // synchronous visualTransform set), then calls onSaveAnnotations (heavy,
  // runs on subsequent frames). Cleanup happens in the consumer via a
  // useEffect that clears visualTransform when the persisted annotation
  // angle catches up to the optimistic angle — same pattern as the drag-end
  // cleanup at line 654 (`setVisualTransform(null)`), just triggered by
  // prop change instead of pointerup.
  //
  // The helper does NOT set interactionState to 'rotating' — that's
  // reserved for active drag and would break cursor/grace-timer semantics
  // in the parent. Optimistic paint is a one-shot visual override, not a
  // drag session.
  //
  // SIDE EFFECT (drag-wins invariant — read before refactoring):
  // Setting visualTransform.rotate causes SVGAnnotationLayer.jsx:319's
  // derived `isRotating = !!(visualTransform?.rotate)` to become true, which
  // makes RotationInputField.jsx:312-320's drag-wins sync useEffect overwrite
  // `input.value = String(Math.round(angle))`. This is currently a no-op
  // because `liveRotationAngle` (SVGAnnotationLayer.jsx:330) reads from
  // `visualTransform.rotate.angle`, so the overwrite value equals the
  // committed value. Do NOT decouple `liveRotationAngle` from
  // `visualTransform.rotate` without revisiting RotationInputField's sync
  // useEffect at lines 312-320 — the no-op becomes a destructive overwrite
  // the moment those two values diverge.
  // ---------------------------------------------------------------------------
  const applyOptimisticRotation = useCallback((annotationIndex, newAngle) => {
    if (annotationIndex === null || annotationIndex === undefined) return;
    const obj = annotations?.objects?.[annotationIndex];
    if (!obj) return;
    const bbox = getAnnotationBBox(obj);
    const cx = bbox.left + bbox.width / 2;
    const cy = bbox.top + bbox.height / 2;
    const originalAngle = obj.angle || 0;
    const deltaAngle = newAngle - originalAngle;
    // UX: same payload shape as the drag-rotate path at handlePointerMove
    // line ~469. The renderer at SVGAnnotationLayer.jsx:755-760 reads
    // `rotate.deltaAngle` for the wrapper <g> and the selection overlay
    // at lines 1103-1105 reads `rotate.angle` for bbox.angle. Both must
    // be present or the paint is inconsistent.
    setVisualTransform({
      id: annotationIndex,
      dx: 0,
      dy: 0,
      rotate: { angle: newAngle, deltaAngle, cx, cy },
    });
  }, [annotations]);

  // Clear the optimistic visualTransform that `applyOptimisticRotation` set
  // (called by the consumer after the persisted annotation angle catches up
  // to the optimistic angle, or on cancel). Exported because React state
  // setters inside the hook are not otherwise reachable from the parent.
  const clearOptimisticRotation = useCallback(() => {
    setVisualTransform(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Return API
  // ---------------------------------------------------------------------------
  return {
    // Selection state
    selectedIds,
    hoveredId,
    // UX: exposed so App.jsx can drive pan-mode hover glow via pendingHover
    // prop. Mirrors the selectAnnotation/pendingSelection pattern — App.jsx
    // owns the document-level mousemove + resolveAnnotationAt hit-test, this
    // layer just renders the glow when told. Select-mode hover still uses
    // the internal onPointerEnter/Leave path.
    setHoveredId,
    inverseScale,
    interactionState,
    activeCalloutDrag,
    visualTransform,
    dragState: dragStateRef,

    // Event handlers
    handleAnnotationPointerDown,
    handleAnnotationPointerEnter,
    handleAnnotationPointerLeave,
    handleCalloutPointerEnter,
    handleCalloutPointerLeave,
    hoveredCalloutId,
    handleAnnotationDoubleClick,
    handleSvgPointerDown,
    handleHandlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    // EDIT-12 Gap 1 fix (Plan 12-03): optimistic rotation paint for typed commits
    applyOptimisticRotation,
    clearOptimisticRotation,

    // Selection manipulation
    selectAnnotation,
    selectAnnotations,
    deselectAll,
    isSelected,

    // Group operations (Plan 03)
    deleteSelected,
    // UX: 2026-04-21 — persisted group rotation. Renderer reads this to
    // keep the multi-select bbox tilted after a group-rotate commit.
    persistedGroupTransform,

    // UX: Phase 19 — AutoCAD marquee render state consumed by
    // SVGAnnotationLayer. Both are null when no marquee is active or
    // while the drag is still under the 5 px threshold.
    marqueeRect: marqueeState && marqueeState.active ? getMarqueeRect(marqueeState) : null,
    marqueeDirection: marqueeState && marqueeState.active ? getMarqueeDirection(marqueeState) : null,
    lassoPoints: lassoState?.points || null,
    lassoMode: lassoState?.points?.length
      ? (lassoState.modeOverride || lassoState.mode || getLassoModeFromTrail(lassoState.points) || 'window')
      : null,
    cancelLasso,
    shouldHandoffLassoPointer,
    shouldIgnoreLassoPointer,
  };
}
