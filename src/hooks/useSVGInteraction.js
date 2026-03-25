/**
 * useSVGInteraction
 *
 * Custom hook that manages SVG annotation selection state and returns
 * pointer event handlers for SVGAnnotationLayer.
 *
 * Phase 9 Plan 01: Click-to-select, hover feedback, deselect-on-empty-space.
 * Phase 9 Plan 02 will add drag/resize/rotate logic.
 * Phase 9 Plan 03 will add multi-select (shift-click, rubber-band).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { getInverseScale } from '../utils/svgTransformMath';

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

  // Mutable refs for drag state (Plan 02 reads/writes these)
  const dragStateRef = useRef(null);
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
      // Toggle in selection set
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
    } else {
      // If already selected, do nothing (allows subsequent drag in Plan 02)
      if (!selectedIds.has(index)) {
        selectAnnotation(index, false);
      }
    }
  }, [selectedIds, selectAnnotation]);

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
   * Handle pointer down on a selection handle (resize/rotate).
   * Stub in Plan 01 -- Plan 02 implements drag/resize/rotate logic.
   */
  const handleHandlePointerDown = useCallback((e, handleId) => {
    // Plan 02 will implement this
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

    // Selection manipulation
    selectAnnotation,
    deselectAll,
    isSelected,
  };
}
