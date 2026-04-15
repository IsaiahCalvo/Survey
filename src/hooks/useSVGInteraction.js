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
import { getAnnotationBBox, getLineEndpoints, isImportedPath, translatePathData, scalePathData } from '../utils/svgBoundingBox';

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
}) {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [hoveredId, setHoveredId] = useState(null);
  const [inverseScale, setInverseScale] = useState(1);
  const [interactionState, setInteractionState] = useState('idle'); // 'idle' | 'dragging' | 'resizing' | 'rotating'

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
  });
  const interactionStateRef = useRef('idle');

  // Keep interactionStateRef in sync
  useEffect(() => {
    interactionStateRef.current = interactionState;
  }, [interactionState]);

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
      dragStateRef.current = {
        ...dragStateRef.current,
        active: true,
        mode: 'callout-part',
        partType,
        calloutId,
        startSVGPoint: svgPoint,
        ctmInverse,
        originalCalloutPositions: {
          arrowTip: { ...callout.arrowTip },
          knee: { ...callout.knee },
          textBoxPosition: { ...callout.textBoxPosition },
        },
      };
      try { e.target.setPointerCapture?.(e.pointerId); } catch (_) { /* pointer capture optional */ }
      e.stopPropagation();
      setInteractionState('dragging');
      return;
    }

    // Not a callout — existing empty-space deselect behavior.
    if (e.target === svgRef.current) {
      deselectAll();
    }
  }, [svgRef, deselectAll, callouts, onSelectedCalloutIdsChange]);

  /**
   * Pointer move on root SVG: update visual transform during drag.
   * Uses CACHED ctmInverse from drag start (per RESEARCH.md Pitfall 1).
   */
  const handlePointerMove = useCallback((e) => {
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
      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'endpoint-move',
        checkpointPolicy: 'skip',
      });
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
      setVisualTransform({
        id: ds.annotationIndex,
        dx: 0, dy: 0,
        resize: { scaleX: newScaleX, scaleY: newScaleY, left: newLeft, top: newTop, anchorX: ds.anchorX, anchorY: ds.anchorY },
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

      let patch = null;
      switch (ds.partType) {
        case 'arrowTip':
          patch = {
            arrowTip: {
              x: original.arrowTip.x + dxNorm,
              y: original.arrowTip.y + dyNorm,
            },
          };
          break;
        case 'knee':
          patch = {
            knee: {
              x: original.knee.x + dxNorm,
              y: original.knee.y + dyNorm,
            },
          };
          break;
        case 'textBox':
          patch = {
            textBoxPosition: {
              x: original.textBoxPosition.x + dxNorm,
              y: original.textBoxPosition.y + dyNorm,
            },
          };
          break;
        case 'whole':
          patch = {
            arrowTip: {
              x: original.arrowTip.x + dxNorm,
              y: original.arrowTip.y + dyNorm,
            },
            knee: {
              x: original.knee.x + dxNorm,
              y: original.knee.y + dyNorm,
            },
            textBoxPosition: {
              x: original.textBoxPosition.x + dxNorm,
              y: original.textBoxPosition.y + dyNorm,
            },
          };
          break;
        default:
          // Unknown partType — bail defensively.
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
  }, [svgRef, annotations, onSaveAnnotations, pageWidth, pageHeight, onUpdateCalloutLive]);

  /**
   * Pointer up on root SVG: commit drag changes to annotation data.
   */
  const handlePointerUp = useCallback((e) => {
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
          const newLeft = ds.originalProps.left + dx;
          const newTop = ds.originalProps.top + dy;

          // Constrain to page bounds
          const constrained = constrainToPage(newLeft, newTop, bbox.width, bbox.height, pageWidth, pageHeight);

          // Deep clone annotations and apply position update
          const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
          const targetObj = updatedAnnotations.objects[ds.annotationIndex];

          if (isImportedPath(obj)) {
            // Imported paths: translate all path coordinates by the constrained delta
            const actualDx = constrained.left - ds.originalProps.left;
            const actualDy = constrained.top - ds.originalProps.top;
            targetObj.path = translatePathData(targetObj.path, actualDx, actualDy);
          } else {
            targetObj.left = constrained.left;
            targetObj.top = constrained.top;
          }

          // Save through existing pipeline
          onSaveAnnotations(updatedAnnotations, {
            source: 'object:modified',
            action: 'move',
            checkpointPolicy: 'normal',
          });
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

      onSaveAnnotations(updatedAnnotations, {
        source: 'object:modified',
        action: 'endpoint-move',
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
          // Constrain each annotation individually to page bounds
          const constrained = constrainToPage(
            orig.left + dx, orig.top + dy,
            bbox.width, bbox.height, pageWidth, pageHeight
          );

          if (isImportedPath(obj)) {
            // Imported paths: translate path coordinates by constrained delta
            const actualDx = constrained.left - orig.left;
            const actualDy = constrained.top - orig.top;
            obj.path = translatePathData(obj.path, actualDx, actualDy);
          } else {
            obj.left = constrained.left;
            obj.top = constrained.top;
          }
        }

        onSaveAnnotations(updatedAnnotations, {
          source: 'object:modified',
          action: 'group-move',
          checkpointPolicy: 'normal',
        });
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
      if (onUpdateCallout) {
        onUpdateCallout(ds.calloutId, {});
      }
      try { e.target?.releasePointerCapture?.(e.pointerId); } catch (_) { /* optional */ }
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
    };
    setVisualTransform(null);
    setInteractionState('idle');
  }, [annotations, pageWidth, pageHeight, onSaveAnnotations, svgRef, onUpdateCallout]);

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
        annotationIndex: selectedIndex,
        ctmInverse,
        currentEndpoint: null,
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

    // Raw unscaled dimensions — the value that, multiplied by newScaleX, gives
    // the new rendered width. Must match how the SVG renderer treats "raw" for
    // each type: rect/text use obj.width, circle uses radius*2, ellipse uses
    // rx*2. Without this, circle/ellipse fall through to obj.width ?? 0 and
    // the resize math collapses the shape to its anchor corner on first drag.
    let rawWidth, rawHeight;
    if (imported) {
      rawWidth = bbox.width;
      rawHeight = bbox.height;
    } else {
      const type = String(obj.type || '').toLowerCase();
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
        left: imported ? bbox.left : (obj.left ?? 0),
        top: imported ? bbox.top : (obj.top ?? 0),
        scaleX: imported ? 1 : (obj.scaleX ?? 1),
        scaleY: imported ? 1 : (obj.scaleY ?? 1),
        angle: obj.angle ?? 0,
        width: rawWidth,
        height: rawHeight,
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
    inverseScale,
    interactionState,
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
  };
}
