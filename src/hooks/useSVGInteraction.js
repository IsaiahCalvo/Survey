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
import { screenToSVG, normalizeAngle, getInverseScale, constrainToPage, snapAngleToNearest45 } from '../utils/svgTransformMath';
import { getAnnotationBBox, getGroupBBox, getLineEndpoints, isImportedPath, translatePathData, scalePathData } from '../utils/svgBoundingBox';
// Phase 15 LINE-01/02/03 + ARROW-01/02/03 — midpoint drag mode + endpoint
// auto-revert on collinear geometry. Pure-math from lineGeometry, drag
// helpers from lineDragMath (unit-tested in tests/lineDragMath.test.mjs).
import { shouldSnapToLinear, getMidpoint } from '../utils/lineGeometry.js';
import {
  deriveMidpointFromPointer,
  shouldRevertEndpointCurve,
  applyMidpointToAnnotation,
  clearMidpointFromAnnotation,
} from '../utils/lineDragMath.js';
// Phase 19 — AutoCAD Window + Crossing marquee selection.
// Pure math lives in marqueeSelection.js (unit-tested in
// tests/marqueeSelection.test.mjs). This hook owns the React state,
// pointer wiring, and Escape cancel plumbing.
import {
  MIN_DRAG_PX as MARQUEE_MIN_DRAG_PX,
  getMarqueeDirection,
  getMarqueeRect,
  resolveMarqueeHits,
} from '../utils/marqueeSelection.js';
// Phase 15 UAT-3 Issue 3 (2026-04-17) — distance rules for callout-part drag.
// Values match combined-tools FabricPDFCanvas collision logic (reference at
// ~/Desktop/combined-tools/src/lib/calloutGeometry.ts). See isCalloutDragSafe
// helper below for rule set + rationale.
import {
  MIN_KNEE_TO_ARROW_DISTANCE,
  MIN_KNEE_TO_BOX_EDGE_DISTANCE,
  MIN_TEXTBOX_TO_ARROW_DISTANCE,
} from '../utils/calloutGeometry.js';

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
  onUpdateCalloutLive,
  onUpdateCallout,
  // Phase 19 — current tool. Marquee only activates when tool === 'select'.
  activeTool,
}) {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [hoveredId, setHoveredId] = useState(null);
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
    mode: null,      // 'move' | 'resize' | 'rotate' | 'group-move' | 'callout-part'
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
    groupOriginals: null, // group-move: { [idx]: { left, top } } for all selected annotations
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
  });
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

  // UX: Phase 19 — Escape cancels an in-progress marquee without
  // changing the existing selection. Mirrors AutoCAD's behavior where
  // Esc mid-drag drops the rubber-band box silently. Listener is only
  // attached while a marquee is tracking, so it does not compete with
  // the Escape handler for text-edit or shape-edit modes.
  useEffect(() => {
    if (!marqueeState) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        applyMarqueeState(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [marqueeState, applyMarqueeState]);

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

  const isSelected = useCallback((index) => {
    return selectedIds.has(index);
  }, [selectedIds]);

  // ---------------------------------------------------------------------------
  // Pointer event handlers
  // ---------------------------------------------------------------------------

  /**
   * Click on an annotation to select it.
   * Shift-click toggles in/out of selection (for multi-select in Plan 03).
   */
  const handleAnnotationPointerDown = useCallback((e, index) => {
    e.stopPropagation();

    if (e.shiftKey) {
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

    // Select if not already selected
    if (!selectedIds.has(index)) {
      selectAnnotation(index, false);
    }

    // Initiate drag-to-move
    const obj = annotations?.objects?.[index];
    if (obj) {
      e.target.setPointerCapture(e.pointerId);
      const ctm = svgRef.current?.getScreenCTM();
      const ctmInverse = ctm ? ctm.inverse() : null;
      const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);

      // Group drag: when multiple annotations are selected and clicking
      // on one that's already selected, initiate group-move (Plan 03).
      // CRITICAL per RESEARCH.md Pitfall 6: record ALL selected annotations'
      // original positions so we compute position as original + totalDelta
      // (not current + frameDelta) to prevent floating-point drift.
      if (selectedIds.size > 1 && selectedIds.has(index)) {
        const originals = {};
        for (const selIdx of selectedIds) {
          const selObj = annotations?.objects?.[selIdx];
          if (selObj) {
            // Imported paths: use bbox position (from path data), not obj.left/top
            if (isImportedPath(selObj)) {
              const selBBox = getAnnotationBBox(selObj);
              originals[selIdx] = { left: selBBox.left, top: selBBox.top };
            } else {
              originals[selIdx] = { left: selObj.left ?? 0, top: selObj.top ?? 0 };
            }
          }
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
    if (onRequestEditMode && annotations?.objects?.[index]) {
      onRequestEditMode(index, annotations.objects[index].type);
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

      // UX: mutual exclusivity — selecting a callout clears annotation
      // selection so the existing selection machinery (delete, edit pill,
      // etc.) doesn't fire on a stale annotation id.
      if (onSelectedCalloutIdsChange) {
        onSelectedCalloutIdsChange(new Set([calloutId]));
      }
      deselectAll();

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
  }, [svgRef, deselectAll, callouts, onSelectedCalloutIdsChange, activeTool, applyMarqueeState, selectedIds, annotations]);

  /**
   * Pointer move on root SVG: update visual transform during drag.
   * Uses CACHED ctmInverse from drag start (per RESEARCH.md Pitfall 1).
   */
  const handlePointerMove = useCallback((e) => {
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

    // Convert current pointer position to SVG coords using CACHED ctmInverse
    const pt = new DOMPoint(e.clientX, e.clientY);
    const svgPoint = ds.ctmInverse
      ? pt.matrixTransform(ds.ctmInverse)
      : screenToSVG(svgRef.current, e.clientX, e.clientY);

    if (ds.mode === 'move') {
      const dx = svgPoint.x - ds.startSVGPoint.x;
      const dy = svgPoint.y - ds.startSVGPoint.y;
      // Visual-only update via state (no annotation data mutation during drag)
      setVisualTransform({ id: ds.annotationIndex, dx, dy });
      setInteractionState('dragging');
    } else if (ds.mode === 'group-move') {
      // Group drag: compute totalDelta from start (not frameDelta) to prevent drift
      const dx = svgPoint.x - ds.startSVGPoint.x;
      const dy = svgPoint.y - ds.startSVGPoint.y;
      setVisualTransform({
        id: 'group', // special sentinel for group drag
        dx, dy,
        affectedIds: new Set(Object.keys(ds.groupOriginals).map(Number)),
      });
      setInteractionState('dragging');
    } else if (ds.mode === 'endpoint') {
      // Line/arrow endpoint drag — compute new absolute position for the dragged endpoint
      const ep = ds.originalEndpoints;
      const movingP1 = ds.handleId === 'p1';
      const newX = movingP1 ? ep.x1 + (svgPoint.x - ds.startSVGPoint.x) : ep.x2 + (svgPoint.x - ds.startSVGPoint.x);
      const newY = movingP1 ? ep.y1 + (svgPoint.y - ds.startSVGPoint.y) : ep.y2 + (svgPoint.y - ds.startSVGPoint.y);
      const fixedX = movingP1 ? ep.x2 : ep.x1;
      const fixedY = movingP1 ? ep.y2 : ep.y1;

      // Recalculate bounding box from two absolute endpoints
      const minX = Math.min(newX, fixedX);
      const minY = Math.min(newY, fixedY);
      const maxX = Math.max(newX, fixedX);
      const maxY = Math.max(newY, fixedY);
      const newWidth = maxX - minX;
      const newHeight = maxY - minY;
      const newCenterX = minX + newWidth / 2;
      const newCenterY = minY + newHeight / 2;

      // LINE-03 / ARROW-03: data.midpoint stays at its absolute page coords
      // during endpoint drag. Do NOT translate it with the pointer delta —
      // the curve reshapes around the fixed midpoint (15-RESEARCH.md Pitfall 2).
      // The explicit applyMidpointToAnnotation call below the commit guarantees
      // preservation even if a future refactor to this branch rebuilds
      // targetObj.data wholesale.
      const endpointData = {
        left: minX,
        top: minY,
        width: newWidth,
        height: newHeight,
        x1: (movingP1 ? newX : fixedX) - newCenterX,
        y1: (movingP1 ? newY : fixedY) - newCenterY,
        x2: (movingP1 ? fixedX : newX) - newCenterX,
        y2: (movingP1 ? fixedY : newY) - newCenterY,
      };
      ds.currentEndpoint = endpointData;

      // Live commit: update annotation data on every move for immediate visual feedback
      const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
      const targetObj = updatedAnnotations.objects[ds.annotationIndex];
      Object.assign(targetObj, endpointData);
      // Phase 15 LINE-03 / ARROW-03 — belt-and-suspenders: re-apply the original
      // midpoint from ds.originalMidpoint onto the cloned targetObj so it
      // survives any data-object reassignment earlier in this branch. No-op
      // when the line was straight at drag-start (ds.originalMidpoint is null).
      if (ds.originalMidpoint) {
        applyMidpointToAnnotation(targetObj, ds.originalMidpoint);
      }
      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'endpoint-move',
        checkpointPolicy: 'skip',
      });
      setInteractionState('dragging');
    } else if (ds.mode === 'midpoint') {
      // Phase 15 LINE-01 / ARROW-01 — live-paint midpoint translate.
      // Snap-to-straight happens LIVE during drag (not on pointerup) so the
      // user sees the line go straight as soon as the handle enters the 10px
      // threshold zone. Dragging back out re-curves it instantly.
      // Endpoint drags keep their snap-on-release-only behavior since the user
      // may be passing through collinear on the way to a new position.
      const newMidpoint = deriveMidpointFromPointer(
        ds.startSVGPoint,
        svgPoint,
        ds.originalMidpoint,
      );
      const ep = ds.originalEndpoints;
      const start = { x: ep.x1, y: ep.y1 };
      const end = { x: ep.x2, y: ep.y2 };
      const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
      const targetObj = updatedAnnotations.objects[ds.annotationIndex];
      // Live snap: clear midpoint when within threshold, re-apply when outside
      if (shouldSnapToLinear(newMidpoint, start, end, 10)) {
        clearMidpointFromAnnotation(targetObj);
      } else {
        applyMidpointToAnnotation(targetObj, newMidpoint);
      }
      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'midpoint-move',
        checkpointPolicy: 'skip',
      });
      ds.currentMidpoint = newMidpoint;
      setInteractionState('dragging');
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

      let newScaleX = ds.originalProps.scaleX;
      let newScaleY = ds.originalProps.scaleY;

      if (affectsX && ds.originalProps.width !== 0) {
        const signedDeltaX = isLeftHandle
          ? (ds.anchorX - svgPoint.x)   // left handle: anchor = right edge, drag LEFT grows
          : (svgPoint.x - ds.anchorX);  // right handle: anchor = left edge, drag RIGHT grows
        newScaleX = signedDeltaX / ds.originalProps.width;
      }
      if (affectsY && ds.originalProps.height !== 0) {
        const signedDeltaY = isTopHandle
          ? (ds.anchorY - svgPoint.y)   // top handle: anchor = bottom edge, drag UP grows
          : (svgPoint.y - ds.anchorY);  // bottom handle: anchor = top edge, drag DOWN grows
        newScaleY = signedDeltaY / ds.originalProps.height;
      }

      // Shift-lock aspect ratio (per CONTEXT.md: free resize default, Shift
      // locks). Preserve per-axis sign so diagonal drags through the anchor
      // still flip on the axis that crossed — `sign * average magnitude`.
      if (e.shiftKey) {
        const avgMag = (Math.abs(newScaleX) + Math.abs(newScaleY)) / 2;
        newScaleX = (newScaleX < 0 ? -1 : 1) * avgMag;
        newScaleY = (newScaleY < 0 ? -1 : 1) * avgMag;
      }

      // Flip support is scoped to symmetric shapes (rect/circle/ellipse)
      // where a mirror is visually identical to a non-flipped shape at a
      // different position. For line/arrow (endpoint-driven), path (pen
      // strokes), and text (orientation matters), we clamp to positive to
      // preserve prior behavior until those shape types need real flip
      // semantics. See FEATURE-BACKLOG.md if the user ever asks for it.
      const objForFlip = annotations?.objects?.[ds.annotationIndex];
      const typeForFlip = String(objForFlip?.type || '').toLowerCase();
      const supportsFlip = typeForFlip === 'rect' || typeForFlip === 'circle' || typeForFlip === 'ellipse';
      if (!supportsFlip) {
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

      // Compute new left/top. When scale is positive (normal), the formula
      // below matches the original behavior. When scale is negative (flipped),
      // the shape has mirrored across the anchor and its visible left/top
      // edge snaps to the anchor side; the opposite edge extends PAST the
      // anchor in the direction the user dragged.
      //
      // Renderers (renderRect/renderEllipse in svgAnnotationRenderers.jsx)
      // and getAnnotationBBox already `Math.abs()` the scale, so a flipped
      // rect/circle renders correctly using the normalized `newLeft`/`newTop`
      // as its actual visible top-left corner.
      let newLeft = ds.originalProps.left;
      let newTop = ds.originalProps.top;

      if (isLeftHandle) {
        // Left-side handle: anchor is RIGHT edge. Normal: shape extends LEFT
        // from anchor. Flipped: shape extends RIGHT from anchor.
        if (newScaleX >= 0) {
          newLeft = ds.anchorX - (ds.originalProps.width * newScaleX);
        } else {
          newLeft = ds.anchorX;
        }
      } else if (['tr', 'mr', 'br'].includes(ds.handleId) && newScaleX < 0) {
        // Right-side handle flipped: original-left was the anchor; new right
        // edge is to the LEFT of it. Visible left edge = original left minus
        // |scale| * original width.
        newLeft = ds.originalProps.left + (ds.originalProps.width * newScaleX);
      }

      if (isTopHandle) {
        if (newScaleY >= 0) {
          newTop = ds.anchorY - (ds.originalProps.height * newScaleY);
        } else {
          newTop = ds.anchorY;
        }
      } else if (['bl', 'mb', 'br'].includes(ds.handleId) && newScaleY < 0) {
        newTop = ds.originalProps.top + (ds.originalProps.height * newScaleY);
      }

      // Store resize state for commit on pointerup
      dragStateRef.current.currentResize = { newScaleX, newScaleY, newLeft, newTop };
      setInteractionState('resizing');

      // UX: polygon/polyline live preview. SVGAnnotationLayer re-renders the
      // shape by applying these `left`/`top` values through the renderer's
      // transform chain `translate(left, top) scale(sx, sy) translate(-pathOffset)`
      // — i.e. OBJECT-space. The resize formula above produced `newLeft`/`newTop`
      // in visible-bbox space (since originalProps.left was set to bbox.left at
      // pointer-down). Translate here so the live preview tracks the cursor
      // instead of drifting off the page.
      let visualLeft = newLeft;
      let visualTop = newTop;
      if (ds.originalProps.isPointsShape) {
        const sxAbs = Math.abs(newScaleX);
        const syAbs = Math.abs(newScaleY);
        visualLeft = newLeft - sxAbs * (ds.originalProps.pointsLocalMinX - ds.originalProps.pointsPathOffsetX);
        visualTop = newTop - syAbs * (ds.originalProps.pointsLocalMinY - ds.originalProps.pointsPathOffsetY);
      }
      setVisualTransform({
        id: ds.annotationIndex,
        dx: 0, dy: 0,
        resize: { scaleX: newScaleX, scaleY: newScaleY, left: visualLeft, top: visualTop, anchorX: ds.anchorX, anchorY: ds.anchorY },
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
          // Emit the resize patch directly — no distance-rule validation
          // on resize (textbox can shrink/grow freely; rollback handles
          // dropping the box onto the arrow/knee on release).
          if (onUpdateCalloutLive && ds.calloutId) {
            onUpdateCalloutLive(ds.calloutId, {
              textBoxPosition: { x: newLeft, y: newTop },
              textBoxWidth: newWidth,
              textBoxHeight: newHeight,
            });
          }
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
      const boxRightPx = boxLeftPx + boxWPx;
      const boxBottomPx = boxTopPx + boxHPx;

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

      let frameSafe;
      if (ds.partType === 'whole') {
        frameSafe = true;
      } else if (ds.partType === 'knee') {
        // Knee-drag frameSafe mirrors the release-time rule: the frame
        // counts as "safe" only when the knee is outside the textbox AND
        // the knee→arrow line doesn't cut through it. Unsafe frames do
        // not advance lastSafe, so a rollback on invalid release lands
        // on the last genuinely-valid spot the user swept through.
        frameSafe = !kneeInsideBox
          && !segmentCrossesRect(kneePx, atPx, boxLeftPx, boxTopPx, boxRightPx, boxBottomPx);
      } else {
        frameSafe = !arrowInsideBox
          && arrowToBoxDist >= MIN_TEXTBOX_TO_ARROW_DISTANCE
          && kneeToArrowDist >= MIN_KNEE_TO_ARROW_DISTANCE
          && !kneeInsideBox
          && kneeToBoxDist >= MIN_KNEE_TO_BOX_EDGE_DISTANCE;
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

      // UX: live paint during drag — onUpdateCalloutLive updates React
      // state without a checkpoint (checkpoint fires once on pointerup
      // via onUpdateCallout). Mirrors the Phase 12 optimistic rotation
      // paint pattern for smooth drag without bloating the undo stack.
      if (patch && onUpdateCalloutLive && ds.calloutId) {
        onUpdateCalloutLive(ds.calloutId, patch);
      }
      setInteractionState('dragging');
    }
  }, [svgRef, annotations, onSaveAnnotations, pageWidth, pageHeight, onUpdateCalloutLive, applyMarqueeState]);

  /**
   * Pointer up on root SVG: commit drag changes to annotation data.
   */
  const handlePointerUp = useCallback((e) => {
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
      const { annotationIndices, calloutIds } = resolveMarqueeHits({
        marqueeRect,
        direction,
        annotations,
        callouts,
        pageWidth,
        pageHeight,
      });

      if (mq.altHeld) {
        // Subtract: remove marquee hits from the existing selection.
        // Alt wins over Shift if both held. Empty result is a no-op.
        if (annotationIndices.length > 0) {
          setSelectedIds((prev) => {
            const nextSet = new Set(prev);
            for (const i of annotationIndices) nextSet.delete(i);
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
          const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
          const targetObj = updatedAnnotations.objects[ds.annotationIndex];

          // Absolute-coord path (imported OR user-drawn from FabricDrawingCanvas
          // which zeroes left/top + omits pathOffset): translate the path data
          // itself. Using obj.left as an offset on top of absolute path data
          // made the SVG renderer and Fabric eraser canvas disagree on
          // position (Fabric auto-computes pathOffset from path data and
          // doesn't honor our zero convention), producing a ghost stroke at
          // the original position during eraser mode.
          const isAbsolutePath = obj.type === 'path' && Array.isArray(obj.path) &&
            (!obj.pathOffset || (obj.pathOffset.x === 0 && obj.pathOffset.y === 0));

          if (isAbsolutePath) {
            targetObj.path = translatePathData(targetObj.path, actualDx, actualDy);
            // For user-drawn paths reset left/top to zero so path data alone
            // carries position. For imported paths left/top are already null
            // (the isImportedPath convention) — don't stomp those.
            if (!isImportedPath(obj)) {
              targetObj.left = 0;
              targetObj.top = 0;
            }
          } else {
            // Standard types (rect/circle/ellipse/line/text): accumulate delta
            // onto originalProps.left/top. Equivalent to the previous
            // `targetObj.left = constrained.left` for all these types since
            // bbox.left === obj.left for rect/circle/ellipse/line/text.
            targetObj.left = ds.originalProps.left + actualDx;
            targetObj.top = ds.originalProps.top + actualDy;
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
    } else if (ds.mode === 'endpoint' && ds.currentEndpoint) {
      // Commit line/arrow endpoint drag
      const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
      const targetObj = updatedAnnotations.objects[ds.annotationIndex];
      const ep = ds.currentEndpoint;
      targetObj.left = ep.left;
      targetObj.top = ep.top;
      targetObj.width = ep.width;
      targetObj.height = ep.height;
      targetObj.x1 = ep.x1;
      targetObj.y1 = ep.y1;
      targetObj.x2 = ep.x2;
      targetObj.y2 = ep.y2;

      // Phase 15 LINE-03 / ARROW-03 — preserve + maybe-auto-revert the midpoint.
      // During the drag, data.midpoint was re-applied on every pointermove
      // (Pitfall-2 defensive write above), but the live-paint clones didn't
      // carry it here. Re-apply from ds.originalMidpoint, then check whether
      // the new endpoint geometry is naturally collinear within 10px — if so,
      // clear it silently so the line re-enters the straight <line> render
      // branch. Use getLineEndpoints(targetObj) for the canonical endpoint
      // derivation — do NOT re-derive from left/top/width/x1/x2 inline
      // (bbox reads may be stale right after mutation).
      if (ds.originalMidpoint) {
        applyMidpointToAnnotation(targetObj, ds.originalMidpoint);
        const { x1, y1, x2, y2 } = getLineEndpoints(targetObj);
        const newStart = { x: x1, y: y1 };
        const newEnd = { x: x2, y: y2 };
        if (shouldRevertEndpointCurve(targetObj.data?.midpoint, newStart, newEnd, 10)) {
          clearMidpointFromAnnotation(targetObj);
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
      const ep = ds.originalEndpoints;
      const start = { x: ep.x1, y: ep.y1 };
      const end = { x: ep.x2, y: ep.y2 };
      const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
      const targetObj = updatedAnnotations.objects[ds.annotationIndex];
      if (shouldSnapToLinear(ds.currentMidpoint, start, end, 10)) {
        clearMidpointFromAnnotation(targetObj);
      } else {
        applyMidpointToAnnotation(targetObj, ds.currentMidpoint);
      }
      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'midpoint-move',
        checkpointPolicy: 'normal',
      });
    } else if (ds.mode === 'group-move' && ds.groupOriginals) {
      // Group drag commit: apply totalDelta from ORIGINAL positions (prevents drift)
      const pt = new DOMPoint(e.clientX, e.clientY);
      const svgPoint = ds.ctmInverse
        ? pt.matrixTransform(ds.ctmInverse)
        : screenToSVG(svgRef.current, e.clientX, e.clientY);

      const dx = svgPoint.x - ds.startSVGPoint.x;
      const dy = svgPoint.y - ds.startSVGPoint.y;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        const updatedAnnotations = JSON.parse(JSON.stringify(annotations));

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

          // Same dual-convention handling as the single-move branch above.
          const isAbsolutePath = obj.type === 'path' && Array.isArray(obj.path) &&
            (!obj.pathOffset || (obj.pathOffset.x === 0 && obj.pathOffset.y === 0));

          if (isAbsolutePath) {
            obj.path = translatePathData(obj.path, actualDx, actualDy);
            if (!isImportedPath(obj)) {
              obj.left = 0;
              obj.top = 0;
            }
          } else {
            obj.left = orig.left + actualDx;
            obj.top = orig.top + actualDy;
          }
        }

        onSaveAnnotations(updatedAnnotations, {
          source: 'object:modified',
          action: 'group-move',
          checkpointPolicy: 'normal',
        });

        // UX: see move-branch comment — same spurious-dblclick guard.
        justDraggedAtRef.current = Date.now();
      }
    } else if (ds.mode === 'resize' && ds.currentResize) {
      const { newScaleX, newScaleY, newLeft, newTop } = ds.currentResize;

      const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
      const obj = updatedAnnotations.objects[ds.annotationIndex];

      if (isImportedPath(obj)) {
        // Imported paths: scale path coordinates around the anchor point
        // newScaleX/newScaleY are ratios of new size to original bbox size (originalProps.scaleX was 1)
        obj.path = scalePathData(obj.path, newScaleX, newScaleY, ds.anchorX, ds.anchorY);
      } else {
        const objType = String(obj.type || '').toLowerCase();
        if (objType === 'textbox' || objType === 'i-text' || objType === 'text') {
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
    } else if (ds.mode === 'rotate' && ds.currentAngle !== undefined) {
      const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
      updatedAnnotations.objects[ds.annotationIndex].angle = ds.currentAngle;

      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'rotate',
        checkpointPolicy: 'normal',
      });
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
      if (onUpdateCalloutLive && ds.lastSafeCalloutPositions && ds.partType !== 'whole' && ds.partType !== 'textBoxResize') {
        const W = pageWidth || 1;
        const H = pageHeight || 1;
        const last = ds.lastSafeCalloutPositions;
        const original = ds.originalCalloutPositions;
        // Look up the final committed-during-drag position from the
        // callouts array — onUpdateCalloutLive has already landed the raw
        // proposed patch there each frame.
        const calloutArr = Array.isArray(callouts) ? callouts : [];
        const current = calloutArr.find((c) => c && c.id === ds.calloutId);
        if (current && original) {
          const at = { x: (current.arrowTip?.x ?? 0) * W, y: (current.arrowTip?.y ?? 0) * H };
          const kn = { x: (current.knee?.x ?? 0) * W, y: (current.knee?.y ?? 0) * H };
          const bl = (current.textBoxPosition?.x ?? 0) * W;
          const bt = (current.textBoxPosition?.y ?? 0) * H;
          const bw = (original.textBoxWidth || 0) * W;
          const bh = (original.textBoxHeight || 0) * H;
          const br = bl + bw;
          const bb = bt + bh;
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

          let dropSafe = true;
          if (ds.partType === 'knee') {
            // UX: Phase 15 UAT-3 (2026-04-18) — knee drag is free during
            // mouse-down; release checks the final spot. Invalid if the
            // knee lands inside the textbox, OR if the knee→arrow line
            // would cut through the textbox interior (knee dropped on
            // the opposite side of the textbox from the arrow). Line1
            // starts on the textbox edge by construction so it can't
            // cross. Rollback restores the last valid frame from the
            // drag so the knee + both lines return to their previous
            // safe positions.
            const kneeInside = pointInsideRect(kn, bl, bt, br, bb);
            const line2Cuts = segmentCrossesRect(kn, at, bl, bt, br, bb);
            dropSafe = !kneeInside && !line2Cuts;
          } else {
            // Fallback: prior distance-rule set for arrow + textbox
            // drags. Replaced per partType as we tackle each in turn.
            const outside = (p, l, t, r, b) => !pointInsideRect(p, l, t, r, b);
            const dRect = (pp, l, t, r, b) => {
              const ddx = Math.max(0, Math.max(l - pp.x, pp.x - r));
              const ddy = Math.max(0, Math.max(t - pp.y, pp.y - b));
              return Math.sqrt(ddx * ddx + ddy * ddy);
            };
            dropSafe =
              outside(at, bl, bt, br, bb)
              && dRect(at, bl, bt, br, bb) >= MIN_TEXTBOX_TO_ARROW_DISTANCE
              && Math.hypot(kn.x - at.x, kn.y - at.y) >= MIN_KNEE_TO_ARROW_DISTANCE
              && outside(kn, bl, bt, br, bb)
              && dRect(kn, bl, bt, br, bb) >= MIN_KNEE_TO_BOX_EDGE_DISTANCE;
          }
          if (!dropSafe) {
            // UX: Phase 15 UAT-3 (2026-04-18) — rollback target is the
            // pre-drag snapshot (the callout's state BEFORE the user
            // clicked the handle), not an intermediate safe frame from
            // the drag. Matches user intent: invalid drop → return to
            // where we started this drag.
            onUpdateCalloutLive(ds.calloutId, {
              arrowTip: original.arrowTip,
              knee: original.knee,
              textBoxPosition: original.textBoxPosition,
            });
          }
        }
      }
      if (onUpdateCallout) {
        onUpdateCallout(ds.calloutId, {});
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
      // UX: Phase 14 CALL-10 — four-place invariant: reset callout-part
      // fields alongside the rest of the drag state so the next drag
      // starts with a clean slate. Miss one and the drag gets stuck.
      partType: null, calloutId: null, originalCalloutPositions: null,
      lastSafeCalloutPositions: null, textBoxCorner: null,
      // Phase 15 LINE-01/02/03 — four-place invariant for the 'midpoint'
      // drag mode. originalMidpoint is SET at pointerdown (both 'midpoint'
      // AND 'endpoint' dispatch branches set it), READ at pointermove AND
      // pointerup (both modes), and RESET here. Miss this reset and a
      // subsequent straight-line drag would re-apply a stale midpoint.
      originalMidpoint: null, currentMidpoint: null,
    };
    setVisualTransform(null);
    setInteractionState('idle');
  }, [annotations, pageWidth, pageHeight, onSaveAnnotations, svgRef, onUpdateCallout, onUpdateCalloutLive, callouts, applyMarqueeState, deselectAll, onSelectedCalloutIdsChange]);

  /**
   * Handle pointer down on a selection handle (resize/rotate).
   * Sets up drag state for resize (corner/edge handles) or rotation (mtr handle).
   */
  const handleHandlePointerDown = useCallback((e, handleId) => {
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);

    const selectedIndex = Array.from(selectedIds)[0]; // Single-select resize only
    if (selectedIndex === undefined) return;
    const obj = annotations?.objects?.[selectedIndex];
    if (!obj) return;

    const ctm = svgRef.current?.getScreenCTM();
    const ctmInverse = ctm ? ctm.inverse() : null;
    const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
    const bbox = getAnnotationBBox(obj);

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
      };
      return;
    }

    // Line/arrow endpoint drag: p1 or p2
    if (handleId === 'p1' || handleId === 'p2') {
      const ep = getLineEndpoints(obj);
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
    const cx = bbox.left + bbox.width / 2;
    const cy = bbox.top + bbox.height / 2;

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
    if (imported) {
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
      if (type === 'circle') {
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
        // Imported + points-based shapes: use visible-bbox left/top so the
        // resize formula (which produces a new left/top in visible-space)
        // has a matching reference point. Commit branch translates back to
        // object-space for polygon/polyline.
        left: (imported || isPointsShape) ? bbox.left : (obj.left ?? 0),
        top: (imported || isPointsShape) ? bbox.top : (obj.top ?? 0),
        scaleX: imported ? 1 : (obj.scaleX ?? 1),
        scaleY: imported ? 1 : (obj.scaleY ?? 1),
        angle: obj.angle ?? 0,
        width: rawWidth,
        height: rawHeight,
        // Points-based shapes need these at commit time to convert the
        // visible-space newLeft/newTop back to object-space obj.left/top.
        isPointsShape,
        pointsLocalMinX,
        pointsLocalMinY,
        pointsPathOffsetX,
        pointsPathOffsetY,
      },
      annotationIndex: selectedIndex,
      ctmInverse,
      anchorX: anchor.x,
      anchorY: anchor.y,
      centerX: cx,
      centerY: cy,
      currentResize: null,
      currentAngle: undefined,
    };
  }, [selectedIds, annotations, svgRef]);

  // ---------------------------------------------------------------------------
  // Group delete (Plan 03): remove all selected annotations
  // ---------------------------------------------------------------------------
  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;

    const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
    // Iterate indices in reverse (highest first) to avoid index shifting during splice
    const indicesToDelete = Array.from(selectedIds).sort((a, b) => b - a);
    for (const idx of indicesToDelete) {
      updatedAnnotations.objects.splice(idx, 1);
    }

    onSaveAnnotations(updatedAnnotations, {
      source: 'object:modified',
      action: 'delete',
      checkpointPolicy: 'normal',
    });

    deselectAll();
  }, [selectedIds, annotations, onSaveAnnotations, deselectAll]);

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
    handleAnnotationDoubleClick,
    handleSvgPointerDown,
    handleHandlePointerDown,
    handlePointerMove,
    handlePointerUp,
    // EDIT-12 Gap 1 fix (Plan 12-03): optimistic rotation paint for typed commits
    applyOptimisticRotation,
    clearOptimisticRotation,

    // Selection manipulation
    selectAnnotation,
    deselectAll,
    isSelected,

    // Group operations (Plan 03)
    deleteSelected,

    // UX: Phase 19 — AutoCAD marquee render state consumed by
    // SVGAnnotationLayer. Both are null when no marquee is active or
    // while the drag is still under the 5 px threshold.
    marqueeRect: marqueeState && marqueeState.active ? getMarqueeRect(marqueeState) : null,
    marqueeDirection: marqueeState && marqueeState.active ? getMarqueeDirection(marqueeState) : null,
  };
}
