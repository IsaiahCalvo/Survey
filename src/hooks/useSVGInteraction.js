/**
 * useSVGInteraction
 *
 * Custom hook that manages SVG annotation selection state and returns
 * pointer event handlers for SVGAnnotationLayer.
 *
 * Phase 9 Plan 01: Click-to-select, hover feedback, deselect-on-empty-space.
 * Phase 9 Plan 02: Drag-to-move, resize-by-handle, rotation.
 * Phase 9 Plan 03 will add multi-select (shift-click, rubber-band).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { screenToSVG, getInverseScale, constrainToPage } from '../utils/svgTransformMath';
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
    mode: null,      // 'move' | 'resize' | 'rotate'
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
    }
    // resize and rotate modes handled in Task 2
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
    }
    // resize and rotate commit handled in Task 2

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
   * Stub -- Task 2 implements resize and rotation logic.
   */
  const handleHandlePointerDown = useCallback((e, handleId) => {
    // Task 2 will implement this
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

    // Selection manipulation
    selectAnnotation,
    deselectAll,
    isSelected,
  };
}
