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
import { screenToSVG, normalizeAngle, getInverseScale, constrainToPage } from '../utils/svgTransformMath';
import { getAnnotationBBox } from '../utils/svgBoundingBox';

/**
 * @param {object} options
 * @param {React.RefObject<SVGSVGElement>} options.svgRef - Ref to root <svg> element
 * @param {{ objects: Array }} options.annotations - Fabric.js JSON annotations
 * @param {number} options.pageWidth - Unscaled page width (viewBox width)
 * @param {number} options.pageHeight - Unscaled page height (viewBox height)
 * @param {Function} options.onSaveAnnotations - (updatedJSON, saveContext) => void
 * @param {Function} options.onRequestEditMode - (annotationIndex, annotationType) => void
 */
export function useSVGInteraction({
  svgRef,
  annotations,
  pageWidth,
  pageHeight,
  onSaveAnnotations,
  onRequestEditMode,
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
    mode: null,      // 'move' | 'resize' | 'rotate' | 'group-move'
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
  // (new page loaded or external edit)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setSelectedIds(new Set());
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

      dragStateRef.current = {
        active: true,
        mode: 'move',
        handleId: null,
        startSVGPoint: svgPoint,
        originalProps: {
          left: obj.left ?? 0,
          top: obj.top ?? 0,
          scaleX: obj.scaleX ?? 1,
          scaleY: obj.scaleY ?? 1,
          angle: obj.angle ?? 0,
          width: obj.width ?? 0,
          height: obj.height ?? 0,
        },
        annotationIndex: index,
        ctmInverse,
        anchorX: null,
        anchorY: null,
        centerX: null,
        centerY: null,
        currentResize: null,
        currentAngle: undefined,
      };
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
   */
  const handleAnnotationDoubleClick = useCallback((e, index) => {
    e.stopPropagation();
    if (onRequestEditMode && annotations?.objects?.[index]) {
      onRequestEditMode(index, annotations.objects[index].type);
    }
  }, [onRequestEditMode, annotations]);

  /**
   * Click on empty SVG background: deselect all.
   * Only fires when clicking the SVG element itself, not a child annotation.
   */
  const handleSvgPointerDown = useCallback((e) => {
    if (e.target === svgRef.current) {
      deselectAll();
    }
  }, [svgRef, deselectAll]);

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
    } else if (ds.mode === 'resize') {
      // Determine which axes this handle affects
      const affectsX = !['mt', 'mb'].includes(ds.handleId);
      const affectsY = !['ml', 'mr'].includes(ds.handleId);

      let newScaleX = ds.originalProps.scaleX;
      let newScaleY = ds.originalProps.scaleY;

      if (affectsX && ds.originalProps.width !== 0) {
        const currentWidth = Math.abs(svgPoint.x - ds.anchorX);
        newScaleX = currentWidth / ds.originalProps.width;
      }
      if (affectsY && ds.originalProps.height !== 0) {
        const currentHeight = Math.abs(svgPoint.y - ds.anchorY);
        newScaleY = currentHeight / ds.originalProps.height;
      }

      // Shift-lock aspect ratio (per CONTEXT.md: free resize default, Shift locks)
      if (e.shiftKey) {
        const avgScale = (newScaleX + newScaleY) / 2;
        newScaleX = avgScale;
        newScaleY = avgScale;
      }

      // Minimum scale to prevent zero-size
      newScaleX = Math.max(0.1, newScaleX);
      newScaleY = Math.max(0.1, newScaleY);

      // Compute new left/top based on anchor and new dimensions
      let newLeft = ds.originalProps.left;
      let newTop = ds.originalProps.top;

      // For handles that resize from left/top side, adjust position
      if (['tl', 'ml', 'bl'].includes(ds.handleId)) {
        newLeft = ds.anchorX - (ds.originalProps.width * newScaleX);
      }
      if (['tl', 'mt', 'tr'].includes(ds.handleId)) {
        newTop = ds.anchorY - (ds.originalProps.height * newScaleY);
      }

      // Store resize state for commit on pointerup
      dragStateRef.current.currentResize = { newScaleX, newScaleY, newLeft, newTop };
      setInteractionState('resizing');
      setVisualTransform({
        id: ds.annotationIndex,
        dx: 0, dy: 0,
        resize: { scaleX: newScaleX, scaleY: newScaleY, left: newLeft, top: newTop },
      });
    } else if (ds.mode === 'rotate') {
      // Compute angle from center of annotation to current pointer position
      const dx = svgPoint.x - ds.centerX;
      const dy = svgPoint.y - ds.centerY;
      const radians = Math.atan2(dy, dx);
      const newAngle = normalizeAngle(radians);

      dragStateRef.current.currentAngle = newAngle;
      setInteractionState('rotating');
      setVisualTransform({
        id: ds.annotationIndex,
        dx: 0, dy: 0,
        rotate: { angle: newAngle, cx: ds.centerX, cy: ds.centerY },
      });
    }
  }, [svgRef]);

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
          updatedAnnotations.objects[ds.annotationIndex].left = constrained.left;
          updatedAnnotations.objects[ds.annotationIndex].top = constrained.top;

          // Save through existing pipeline
          onSaveAnnotations(updatedAnnotations, {
            source: 'object:modified',
            action: 'move',
            checkpointPolicy: 'normal',
          });
        }
      }
    } else if (ds.mode === 'resize' && ds.currentResize) {
      const { newScaleX, newScaleY, newLeft, newTop } = ds.currentResize;

      const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
      const obj = updatedAnnotations.objects[ds.annotationIndex];
      obj.scaleX = newScaleX;
      obj.scaleY = newScaleY;
      obj.left = newLeft;
      obj.top = newTop;

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
    }

    // Reset drag state
    dragStateRef.current = {
      active: false, mode: null, handleId: null, startSVGPoint: null,
      originalProps: null, annotationIndex: null, ctmInverse: null,
      anchorX: null, anchorY: null, centerX: null, centerY: null,
      currentResize: null, currentAngle: undefined,
    };
    setVisualTransform(null);
    setInteractionState('idle');
  }, [annotations, pageWidth, pageHeight, onSaveAnnotations, svgRef]);

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

    dragStateRef.current = {
      active: true,
      mode,
      handleId,
      startSVGPoint: svgPoint,
      originalProps: {
        left: obj.left ?? 0,
        top: obj.top ?? 0,
        scaleX: obj.scaleX ?? 1,
        scaleY: obj.scaleY ?? 1,
        angle: obj.angle ?? 0,
        width: obj.width ?? 0,
        height: obj.height ?? 0,
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

    // Selection manipulation
    selectAnnotation,
    deselectAll,
    isSelected,
  };
}
