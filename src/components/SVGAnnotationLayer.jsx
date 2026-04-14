/**
 * SVGAnnotationLayer
 *
 * SVG annotation layer that renders Fabric.js JSON annotations
 * as SVG elements using viewBox-based auto-scaling. Supports click-to-select,
 * hover feedback, and selection overlays (bounding box + handles).
 *
 * Key architecture:
 * - Single <svg viewBox="0 0 pageWidth pageHeight"> per page
 * - All coordinates in unscaled PDF page space
 * - Browser handles zoom scaling automatically via viewBox
 * - vector-effect="non-scaling-stroke" keeps stroke widths constant
 * - mix-blend-mode: multiply for highlight annotations
 * - pathOffset transform chain for correct pen stroke positioning
 * - Selection handles use inverseScale for constant visual pixel size
 *
 * Phase 8 Plan 01: Tier 1 types (paths, rects, lines, arrows) + stubs for tier 2
 * Phase 8 Plan 02: Tier 2 types (ellipse, text, callouts) + full three-layer filtering
 * Phase 9 Plan 01: Click-to-select, hover feedback, selection overlay with handles
 * Phase 9 Plan 02: Drag-to-move, resize-by-handle, rotation visual + pointer wiring
 * Phase 9 Plan 03: Multi-select group ops (group-move visual, group bbox, delete)
 */
import React, { memo, useMemo, useEffect, useRef, useState, useCallback } from 'react';
import {
  renderPath,
  renderRect,
  renderLine,
  renderArrow,
  renderEllipse,
  renderText,
  renderCallout,
} from '../utils/svgAnnotationRenderers';
import { calculateCalloutConnection } from '../utils/calloutGeometry';
import { useSVGInteraction } from '../hooks/useSVGInteraction';
import SVGSelectionOverlay from './SVGSelectionOverlay';
import RotationInputField from './RotationInputField';
import { getAnnotationBBox, getGroupBBox, isImportedPath, getLineEndpoints } from '../utils/svgBoundingBox';
import {
  ANNOTATION_VISIBILITY_SCOPE,
  getAnnotationVisibilityScope,
  isAnnotationVisibleByPageControl
} from '../utils/annotationVisibilityRules';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PREVIEW_OBJECTS = 420;
const MAX_PREVIEW_CALLOUTS = 140;


const formatDashArrayForDebug = (dashArray) => {
  if (!Array.isArray(dashArray) || dashArray.length === 0) return 'none';
  return dashArray
    .map((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : value;
    })
    .join(',');
};

const formatPdfLineEndingsForDebug = (lineEndings) => {
  if (!Array.isArray(lineEndings) || lineEndings.length === 0) return 'none';
  return lineEndings
    .map((value) => (typeof value === 'string' ? value.replace(/^\//, '') : 'None'))
    .join('>');
};

const summarizeImportedSvgAnnotationForDebug = (obj, index) => ({
  id: obj?.pdfAnnotationId || `idx-${index}`,
  pdfType: obj?.pdfAnnotationType || 'unknown',
  renderType: obj?.type || 'unknown',
  renderPartType: obj?.data?.type || null,
  renderTool: obj?.tool || null,
  dash: formatDashArrayForDebug(obj?.strokeDashArray),
  lineEndings: formatPdfLineEndingsForDebug(obj?.data?.pdfLineEndings),
  isImportedPath: isImportedPath(obj),
  spaceId: obj?.spaceId || null,
  regionId: obj?.regionId || null,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SVGAnnotationLayer = memo(({
  pageNumber,
  width,          // unscaled PDF page width (e.g., 612)
  height,         // unscaled PDF page height (e.g., 792)
  annotations,    // Fabric.js JSON { objects: [...] }
  callouts,       // array of callout objects
  // Filtering props
  selectedModuleId,
  showSurveyPanel,
  selectedSpaceId,
  activeSpaceId,
  activeRegions,
  activeRegionId,
  spaces,
  getCanvasAnnotationVisibilityState,
  getSurveyAnnotationVisibilityState,
  isRegionOverlayEnabled,
  layerVisibility,
  // Selection / interaction props (Phase 9)
  onSaveAnnotations,   // (updatedJSON, saveContext) => void
  onRequestEditMode,   // (annotationIndex, annotationType) => void
  activeTool,          // string — current tool (e.g., 'pan', 'pen', etc.)
  editingAnnotationIndex, // number | null — index of annotation currently being edited in FabricEditCanvas (hidden in SVG)
}) => {
  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------
  const svgRef = useRef(null);
  const importedDebugRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Interaction hook (Phase 9)
  // ---------------------------------------------------------------------------
  const {
    selectedIds, hoveredId, inverseScale, interactionState, visualTransform,
    handleAnnotationPointerDown, handleAnnotationPointerEnter,
    handleAnnotationPointerLeave, handleAnnotationDoubleClick,
    handleSvgPointerDown, handleHandlePointerDown,
    handlePointerMove, handlePointerUp,
    isSelected, deleteSelected,
  } = useSVGInteraction({
    svgRef, annotations, pageWidth: width, pageHeight: height,
    onSaveAnnotations, onRequestEditMode,
  });

  // Determine pointer events mode: interactive when select tool active AND not in edit mode
  // When editingAnnotationIndex is set, FabricEditCanvas + MiniToolbar need to receive clicks
  const isInteractive = (activeTool === 'select' || activeTool === 'text-select') && editingAnnotationIndex == null;

  // ---------------------------------------------------------------------------
  // EDIT-12: RotationInputField visibility state machine (Phase 12 Plan 02)
  // ---------------------------------------------------------------------------
  // 3-state machine: hidden / visible / closing(grace).
  // - Visible after 150ms hover-intent on the mtr handle, OR immediately on
  //   active rotation drag.
  // - 500ms grace period after cursor leaves the handle so the user can
  //   travel to the input pill and click into it.
  // - Hidden when no shape is selected, or after grace expiry without re-entry.
  // Drag overrides everything (computed below as `showRotationInput`).
  const [rotInputVisible, setRotInputVisible] = useState(false);
  const rotInputHoverTimerRef = useRef(null);
  const rotInputCloseTimerRef = useRef(null);
  // UX: rotInputHoveredRef tracks whether the cursor is currently over EITHER
  // the mtr handle OR the input pill. The 500ms close timer only fires when
  // both are false. This bridges the gap between the SVG handle (DOM-level
  // pointerenter listener) and the HTML input portal (React onPointerEnter).
  const rotInputHoveredRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Delete key handler — delete selected annotations on Delete/Backspace
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const handleKeyDown = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      // Don't delete if user is typing in a form field
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.contentEditable === 'true')) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, deleteSelected]);

  // ---------------------------------------------------------------------------
  // EDIT-12: Hover-intent listeners on the mtr handle (Phase 12 Plan 02)
  // ---------------------------------------------------------------------------
  // Attaches DOM-level pointerenter / pointerleave handlers to the SVG mtr
  // group via the `data-rotation-handle="mtr"` attribute (added in Task 2).
  // Uses DOM listeners (not React) because the handle is rendered inside an
  // SVG `<g>` and the parent doesn't directly own it — we query it after mount.
  useEffect(() => {
    // UX: only show input when exactly one shape is selected. Multi-select and
    // empty selection clear timers and hide the pill (visibility gate).
    if (!selectedIds || selectedIds.size !== 1) {
      setRotInputVisible(false);
      if (rotInputHoverTimerRef.current) {
        clearTimeout(rotInputHoverTimerRef.current);
        rotInputHoverTimerRef.current = null;
      }
      if (rotInputCloseTimerRef.current) {
        clearTimeout(rotInputCloseTimerRef.current);
        rotInputCloseTimerRef.current = null;
      }
      return;
    }

    const handleEl = svgRef.current?.querySelector('[data-rotation-handle="mtr"]');
    if (!handleEl) return;

    const onEnter = () => {
      rotInputHoveredRef.current = true;
      // Cancel any pending close timer — user came back to the handle
      if (rotInputCloseTimerRef.current) {
        clearTimeout(rotInputCloseTimerRef.current);
        rotInputCloseTimerRef.current = null;
      }
      // UX: 150ms hover-intent open delay matches tooltip conventions —
      // prevents flicker when the cursor crosses the handle without intent.
      if (!rotInputVisible && !rotInputHoverTimerRef.current) {
        rotInputHoverTimerRef.current = setTimeout(() => {
          setRotInputVisible(true);
          rotInputHoverTimerRef.current = null;
        }, 150);
      }
    };

    const onLeave = () => {
      rotInputHoveredRef.current = false;
      // Cancel pending open timer if user left before 150ms elapsed
      if (rotInputHoverTimerRef.current) {
        clearTimeout(rotInputHoverTimerRef.current);
        rotInputHoverTimerRef.current = null;
      }
      // UX: 500ms grace close gives the user time to travel ~100px from the
      // handle to the input pill and click into it. Only fires the actual
      // hide if the cursor still isn't over the input or handle when the
      // timer expires.
      if (rotInputVisible && !rotInputCloseTimerRef.current) {
        rotInputCloseTimerRef.current = setTimeout(() => {
          if (!rotInputHoveredRef.current) {
            setRotInputVisible(false);
          }
          rotInputCloseTimerRef.current = null;
        }, 500);
      }
    };

    handleEl.addEventListener('pointerenter', onEnter);
    handleEl.addEventListener('pointerleave', onLeave);

    return () => {
      handleEl.removeEventListener('pointerenter', onEnter);
      handleEl.removeEventListener('pointerleave', onLeave);
      if (rotInputHoverTimerRef.current) clearTimeout(rotInputHoverTimerRef.current);
      if (rotInputCloseTimerRef.current) clearTimeout(rotInputCloseTimerRef.current);
    };
  }, [selectedIds, rotInputVisible]);

  // ---------------------------------------------------------------------------
  // EDIT-12: Derived state for RotationInputField props
  // ---------------------------------------------------------------------------
  // UX: active rotation drag forces the input visible regardless of hover
  // state — the input live-updates with the integer-rounded angle as the
  // shape rotates. This is the "drag wins" rule from CONTEXT.md.
  const isRotating = !!(visualTransform?.rotate);
  const showRotationInput = isRotating || rotInputVisible;

  const selectedAnnotationIndex = (selectedIds && selectedIds.size === 1)
    ? Array.from(selectedIds)[0]
    : null;
  // Live angle source: read from visualTransform during drag (single source
  // of truth — Pitfall 9), otherwise from the persisted obj.angle.
  const persistedAngle = (selectedAnnotationIndex !== null)
    ? (annotations?.objects?.[selectedAnnotationIndex]?.angle || 0)
    : 0;
  const liveRotationAngle = isRotating ? visualTransform.rotate.angle : persistedAngle;

  const handleRotationInputCommit = useCallback((annotationIndex, newAngle) => {
    if (annotationIndex === null || annotationIndex === undefined) return;
    const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
    if (!updatedAnnotations.objects?.[annotationIndex]) return;
    updatedAnnotations.objects[annotationIndex].angle = newAngle;
    onSaveAnnotations(updatedAnnotations, {
      source: 'rotation-input',
      action: 'rotate',
      checkpointPolicy: 'normal',
    });
  }, [annotations, onSaveAnnotations]);

  const handleRotationInputCancel = useCallback(() => {
    // No-op — input handles its own state revert. Parent doesn't track
    // typed value. Escape simply blurs the input and the displayed angle
    // snaps back to props.angle (the persisted value).
  }, []);

  const handleRotationInputHoverChange = useCallback((hovered) => {
    rotInputHoveredRef.current = hovered;
    if (hovered) {
      // Cancel grace timer if cursor entered the input itself — keeps the
      // pill open while the user is interacting with it.
      if (rotInputCloseTimerRef.current) {
        clearTimeout(rotInputCloseTimerRef.current);
        rotInputCloseTimerRef.current = null;
      }
    } else {
      // UX: cursor left the input — start the same 500ms grace timer so
      // the user can travel back to the handle without dismissing the pill.
      // Suppressed during active rotation drag (drag overrides visibility).
      if (rotInputVisible && !rotInputCloseTimerRef.current && !isRotating) {
        rotInputCloseTimerRef.current = setTimeout(() => {
          if (!rotInputHoveredRef.current) {
            setRotInputVisible(false);
          }
          rotInputCloseTimerRef.current = null;
        }, 500);
      }
    }
  }, [rotInputVisible, isRotating]);

  // ---------------------------------------------------------------------------
  // Helper: derive spaceId from regionId by searching through spaces data
  // ---------------------------------------------------------------------------
  const getSpaceIdForRegion = useMemo(() => {
    return (regionId) => {
      if (!regionId || !spaces || spaces.length === 0) return null;
      for (const space of spaces) {
        for (const page of (space.assignedPages || [])) {
          for (const region of (page.regions || [])) {
            if (region.regionId === regionId) return space.id;
          }
        }
      }
      return null;
    };
  }, [spaces]);

  // ---------------------------------------------------------------------------
  // Filter annotation objects — returns { obj, index, element }[] for wrapping
  // (Selection wrapping happens in render body to avoid useMemo invalidation
  //  on every selection/hover change)
  // ---------------------------------------------------------------------------
  const filteredAnnotations = useMemo(() => {
    const objects = Array.isArray(annotations?.objects)
      ? annotations.objects
      : [];

    if (objects.length === 0) return [];

    // Compute region overlay state for this page
    let isOverlayEnabledForThisPage = false;
    if (activeRegions !== null && selectedSpaceId && isRegionOverlayEnabled) {
      const space = spaces?.find((s) => s.id === selectedSpaceId);
      if (space) {
        const page = space.assignedPages?.find((p) => p.pageId === pageNumber);
        if (page) {
          isOverlayEnabledForThisPage = isRegionOverlayEnabled(selectedSpaceId, pageNumber, page);
        }
      }
    }
    const hasActiveRegions =
      activeRegions !== null &&
      Array.isArray(activeRegions) &&
      activeRegions.length > 0 &&
      isOverlayEnabledForThisPage;

    const results = [];
    let count = 0;

    for (let i = 0; i < objects.length; i++) {
      if (count >= MAX_PREVIEW_OBJECTS) break;

      const obj = objects[i];
      if (!obj || obj.visible === false) continue;

      // --- Layer visibility check ---
      const layer = obj.layer || 'native';
      if (layerVisibility && layerVisibility[layer] === false) continue;

      // --- Three-layer filtering (ported from PAL lines 8625-8840) ---
      const visibilityScope = getAnnotationVisibilityScope({
        moduleId: obj.moduleId,
        regionId: obj.regionId
      });
      const isSurveyAnnotation =
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY ||
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;
      const isScopedRegionAnnotation =
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.REGION ||
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;
      const derivedSpaceId = isScopedRegionAnnotation ? getSpaceIdForRegion(obj.regionId) : null;

      // 1. Space matching
      let matchesSpace = true;
      if (hasActiveRegions && !isScopedRegionAnnotation) {
        matchesSpace = true;
      } else if (isScopedRegionAnnotation && derivedSpaceId !== null) {
        matchesSpace = activeSpaceId !== null && derivedSpaceId === activeSpaceId;
      } else {
        matchesSpace = true;
      }

      // 2. Survey visibility
      let surveyAnnotationVisible = true;
      if (isSurveyAnnotation) {
        surveyAnnotationVisible =
          showSurveyPanel && selectedModuleId !== null && obj.moduleId === selectedModuleId;
      } else if (!isScopedRegionAnnotation) {
        surveyAnnotationVisible = !(showSurveyPanel && selectedModuleId !== null);
      }

      // 3. Scoped region visibility
      let scopedRegionAnnotationVisible = true;
      if (isScopedRegionAnnotation) {
        if (activeSpaceId === null) {
          scopedRegionAnnotationVisible = false;
        } else if (hasActiveRegions) {
          scopedRegionAnnotationVisible = true;
        } else if (activeRegionId !== null) {
          scopedRegionAnnotationVisible = obj.regionId === activeRegionId;
        } else {
          scopedRegionAnnotationVisible = false;
        }
      }

      // 4. Page-level visibility controls for canvas-scoped vs survey-scoped annotations.
      let pageScopedAnnotationVisible = true;
      if (!isScopedRegionAnnotation && selectedSpaceId !== null) {
        pageScopedAnnotationVisible = isAnnotationVisibleByPageControl({
          scope: visibilityScope,
          canvasVisible: getCanvasAnnotationVisibilityState
            ? getCanvasAnnotationVisibilityState(selectedSpaceId, pageNumber)
            : true,
          surveyVisible: getSurveyAnnotationVisibilityState
            ? getSurveyAnnotationVisibilityState(selectedSpaceId, pageNumber)
            : true
        });
      }

      // 5. Final visibility
      const isVisible =
        matchesSpace &&
        surveyAnnotationVisible &&
        scopedRegionAnnotationVisible &&
        pageScopedAnnotationVisible;

      if (!isVisible) continue;

      // Match PAL interaction rules:
      // - Background annotations stay visible in a space when the lightbulb is on,
      //   but they are not selectable/editable.
      // - Region-scoped annotations remain interactive only inside the active space.
      const isObjectInteractive = (() => {
        if (activeSpaceId !== null) {
          return isScopedRegionAnnotation && derivedSpaceId === activeSpaceId;
        }
        return true;
      })();

      // --- Type dispatch ---
      const objectType = String(obj.type || '').toLowerCase();
      let element = null;

      if (objectType === 'path' && Array.isArray(obj.path) && obj.path.length > 0) {
        element = renderPath(obj, i);
      } else if (objectType === 'rect') {
        element = renderRect(obj, i);
      } else if (objectType === 'line') {
        element = renderLine(obj, i);
      } else if (
        objectType === 'group' &&
        Array.isArray(obj.objects) &&
        obj.objects.length > 0
      ) {
        const hasLineChild = obj.objects.some(
          (o) => o && (o.type === 'line' || o.type === 'polyline' || o.type === 'path')
        );
        if (hasLineChild) {
          element = renderArrow(obj, i);
        }
      } else if (objectType === 'circle' || objectType === 'ellipse') {
        element = renderEllipse(obj, i);
      } else if (
        objectType === 'textbox' ||
        objectType === 'i-text' ||
        objectType === 'text'
      ) {
        element = renderText(obj, i);
      }

      if (element) {
        results.push({ obj, index: i, element, isObjectInteractive });
        count++;
      }
    }

    return results;
  }, [
    annotations?.objects,
    pageNumber,
    selectedModuleId,
    showSurveyPanel,
    selectedSpaceId,
    activeSpaceId,
    activeRegions,
    activeRegionId,
    spaces,
    getCanvasAnnotationVisibilityState,
    getSurveyAnnotationVisibilityState,
    isRegionOverlayEnabled,
    layerVisibility,
    getSpaceIdForRegion,
  ]);

  // ---------------------------------------------------------------------------
  // Filter and render callout annotations
  // ---------------------------------------------------------------------------
  const filteredCallouts = useMemo(() => {
    if (!Array.isArray(callouts) || callouts.length === 0) return [];
    // CalloutOverlay (in PageAnnotationLayer) handles ALL callout rendering and interaction
    // across all tool modes (callout, select, pan). SVG layer must never render callouts
    // to avoid doubled visuals.
    return [];

    const elements = [];
    let count = 0;

    for (let i = 0; i < callouts.length; i++) {
      if (count >= MAX_PREVIEW_CALLOUTS) break;

      const callout = callouts[i];
      if (!callout) continue;

      // Page filter
      if (callout.pageNumber !== pageNumber) continue;

      // Module filtering: when survey panel open with module selected,
      // only show callouts matching that module
      if (showSurveyPanel && selectedModuleId) {
        if (callout.moduleId !== selectedModuleId) continue;
      }

      const element = renderCallout(callout, i, width, height, calculateCalloutConnection);
      if (element) {
        elements.push(element);
        count++;
      }
    }

    return elements;
  }, [callouts, pageNumber, showSurveyPanel, selectedModuleId, width, height, activeTool]);

  const objectCount = filteredAnnotations.length;
  const calloutCount = filteredCallouts.length;
  const importedDebugRows = useMemo(() => (
    filteredAnnotations
      .filter(({ obj }) => obj?.isPdfImported)
      .map(({ obj, index }) => summarizeImportedSvgAnnotationForDebug(obj, index))
  ), [filteredAnnotations]);
  const importedDebugSignature = useMemo(
    () => JSON.stringify(importedDebugRows),
    [importedDebugRows]
  );

  // Log mount/unmount
  useEffect(() => {
    console.log(
      `[SVG p${pageNumber}] MOUNT — ${objectCount} annotations, ${calloutCount} callouts, viewBox=${width}x${height}`
    );
    return () => {
      // Cleanup on unmount
    };
  }, [pageNumber, objectCount, calloutCount, width, height]);

  useEffect(() => {
    if (importedDebugRows.length === 0) {
      importedDebugRef.current = importedDebugSignature;
      return;
    }
    if (importedDebugRef.current !== importedDebugSignature) {
      console.log(
        `[SVG-Imported p${pageNumber}] renderSummary — imported=${importedDebugRows.length}, activeSpaceId=${activeSpaceId}, selectedSpaceId=${selectedSpaceId}, activeRegionId=${activeRegionId}, showSurveyPanel=${showSurveyPanel}, rows=${JSON.stringify(importedDebugRows.slice(0, 12))}`
      );
      importedDebugRef.current = importedDebugSignature;
    }
  }, [
    activeRegionId,
    activeSpaceId,
    importedDebugRows,
    importedDebugSignature,
    pageNumber,
    selectedSpaceId,
    showSurveyPanel
  ]);

  // Log every render (to detect re-renders during zoom)
  console.log(
    `[SVG p${pageNumber}] render — ${objectCount} objs, viewBox=${width}x${height}`
  );

  // ---------------------------------------------------------------------------
  // Render: wrap each annotation with hit-area, hover, and interaction handlers
  // ---------------------------------------------------------------------------
  const wrappedAnnotations = filteredAnnotations
    .map(({ obj, index: i, element, isObjectInteractive }) => {
    // During resize, create a temporary modified copy for rendering
    // (Imported paths use SVG transform instead — handled in computedTransform below)
    let renderObj = obj;
    let renderElement = element;
    if (visualTransform?.resize && visualTransform.id === i && !isImportedPath(obj)) {
      renderObj = {
        ...obj,
        scaleX: visualTransform.resize.scaleX,
        scaleY: visualTransform.resize.scaleY,
        left: visualTransform.resize.left,
        top: visualTransform.resize.top,
      };
      // Re-render the element with modified props
      const objectType = String(renderObj.type || '').toLowerCase();
      if (objectType === 'path' && Array.isArray(renderObj.path) && renderObj.path.length > 0) {
        renderElement = renderPath(renderObj, i);
      } else if (objectType === 'rect') {
        renderElement = renderRect(renderObj, i);
      } else if (objectType === 'line') {
        renderElement = renderLine(renderObj, i);
      } else if (objectType === 'group' && Array.isArray(renderObj.objects) && renderObj.objects.length > 0) {
        renderElement = renderArrow(renderObj, i);
      } else if (objectType === 'circle' || objectType === 'ellipse') {
        renderElement = renderEllipse(renderObj, i);
      } else if (objectType === 'textbox' || objectType === 'i-text' || objectType === 'text') {
        renderElement = renderText(renderObj, i);
      }
    }

    const bbox = getAnnotationBBox(renderObj);
    const annotationIsSelected = selectedIds.has(i);
    const annotationIsHovered = hoveredId === i && !annotationIsSelected;

    // Compute transform attribute based on interaction mode
    const computedTransform = (() => {
      if (!visualTransform) return undefined;
      // Single annotation visual transform (from Plan 02)
      if (typeof visualTransform.id === 'number' && visualTransform.id === i) {
        if (visualTransform.resize) {
          // Imported paths: use SVG transform to scale around anchor point
          if (isImportedPath(obj)) {
            const { scaleX, scaleY, anchorX, anchorY } = visualTransform.resize;
            return `translate(${anchorX}, ${anchorY}) scale(${scaleX}, ${scaleY}) translate(${-anchorX}, ${-anchorY})`;
          }
          // Standard objects: element is re-rendered at new scale, no transform needed
          return undefined;
        }
        if (visualTransform.rotate) {
          // Use deltaAngle for the wrapper — the annotation renderer already applies
          // its committed angle internally, so we only add the change to avoid double-rotation.
          const { deltaAngle, cx, cy } = visualTransform.rotate;
          return `rotate(${deltaAngle}, ${cx}, ${cy})`;
        }
        // Move: simple translate
        return `translate(${visualTransform.dx}, ${visualTransform.dy})`;
      }
      // Group visual transform (Plan 03)
      if (visualTransform.id === 'group' && visualTransform.affectedIds?.has(i)) {
        return `translate(${visualTransform.dx}, ${visualTransform.dy})`;
      }
      return undefined;
    })();

    const isBeingEdited = editingAnnotationIndex != null && i === editingAnnotationIndex;
    // Shape edit: SVG stays visible as the visual truth while Fabric provides an
    // invisible hit-zone + handles. This sidesteps the Canvas 2D vs SVG rasterizer
    // stroke difference documented in CLAUDE.md 2026-04-10. Text/callout still hide
    // SVG so Fabric can render live content.
    const objTypeForEdit = String(obj.type || '').toLowerCase();
    const isShapeEdit = isBeingEdited && ['rect', 'circle', 'ellipse', 'triangle'].includes(objTypeForEdit);
    const hideForEdit = isBeingEdited && !isShapeEdit;

    return (
      <g
        key={`wrapper-${obj.id || i}`}
        data-annotation-index={i}
        data-annotation-id={obj.id || ''}
        style={{
          cursor: annotationIsSelected ? 'move' : (annotationIsHovered ? 'pointer' : undefined),
          opacity: hideForEdit ? 0 : undefined,
          pointerEvents: isBeingEdited ? 'none' : undefined,
        }}
        transform={computedTransform}
      >
        {/* Actual annotation render — pointerEvents none so clicks pass to hit rect */}
        <g style={{ pointerEvents: 'none' }}>
          {renderElement}
        </g>
        {/* Hover outline + hit area — line-type uses line-shaped hit, others use rect */}
        {String(renderObj.type || '').toLowerCase() === 'line' ? (() => {
          const ep = getLineEndpoints(renderObj);
          return (
            <g>
              {/* Hover highlight along the line */}
              {annotationIsHovered && (
                <line
                  x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2}
                  stroke="#4a90e2"
                  strokeOpacity={0.4}
                  strokeWidth={Math.max(6, (renderObj.strokeWidth || 2) + 4)}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {/* Invisible thick line hit area */}
              <line
                x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2}
                stroke="transparent"
                strokeWidth={Math.max(12, (renderObj.strokeWidth || 2) + 10)}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pointerEvents={isInteractive && isObjectInteractive ? 'stroke' : 'none'}
                onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
              />
            </g>
          );
        })() : (
        <g transform={bbox.angle ? `rotate(${bbox.angle}, ${bbox.left + bbox.width / 2}, ${bbox.top + bbox.height / 2})` : undefined}>
          {/* Hover outline (shown before click, not when already selected) */}
          {annotationIsHovered && (
            <rect
              x={bbox.left}
              y={bbox.top}
              width={bbox.width}
              height={bbox.height}
              fill="none"
              stroke="#4a90e2"
              strokeOpacity={0.4}
              strokeWidth={2 * inverseScale}
              style={{ pointerEvents: 'none' }}
            />
          )}
          {/* Invisible hit-area rect ON TOP for easier clicking */}
          <rect
            x={bbox.left}
            y={bbox.top}
            width={Math.max(bbox.width, 10)}
            height={Math.max(bbox.height, 10)}
            fill="transparent"
            stroke="none"
            pointerEvents={isInteractive && isObjectInteractive ? 'all' : 'none'}
            onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
            onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
            onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
            onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
          />
        </g>
        )}
      </g>
    );
  });

  return (
    <>
    <svg
      ref={svgRef}
      data-svg-annotation-layer={pageNumber}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: isInteractive ? 'auto' : 'none',
        overflow: 'hidden',
        cursor: interactionState === 'dragging' ? 'grabbing'
              : interactionState === 'rotating' ? 'crosshair'
              : undefined,
      }}
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        if (isInteractive) {
          e.stopPropagation(); // Prevent Syncfusion from seeing SVG events (SVGAnimatedString crash)
          handleSvgPointerDown(e);
        }
      }}
      onPointerMove={isInteractive ? handlePointerMove : undefined}
      onPointerUp={isInteractive ? handlePointerUp : undefined}
    >
      {wrappedAnnotations}
      {filteredCallouts}
      {/* Selection overlays — rendered on top of all annotations */}
      {/* Single selection: individual bounding box with handles */}
      {selectedIds.size === 1 && Array.from(selectedIds).map((selectedIndex) => {
        const obj = annotations?.objects?.[selectedIndex];
        if (!obj) return null;

        // During edit: FabricEditCanvas provides its own handles. For border-flush types
        // (rect, text) there's no dashed bbox to preserve, so hide the overlay entirely.
        // For non-border-flush types (circle, ellipse, triangle), keep the dashed bbox
        // visible but strip the handles (Fabric provides those).
        const editObjType = String(obj.type || '').toLowerCase();
        const editIsBorderFlush = editObjType === 'text' || editObjType === 'textbox' || editObjType === 'i-text' || editObjType === 'rect';
        const isBeingEditedNow = editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex;
        if (isBeingEditedNow && editIsBorderFlush) return null;

        // Apply visualTransform to bbox so overlay follows annotation live during drag/resize/rotate
        let bbox = getAnnotationBBox(obj);
        let overlayTransform;
        if (visualTransform && typeof visualTransform.id === 'number' && visualTransform.id === selectedIndex) {
          if (visualTransform.resize) {
            // During resize: recompute bbox from a transformed copy of the object so
            // type-specific bbox math (e.g. textbox descender buffer) is applied fresh
            // instead of being scaled along with the stored bbox height.
            const transformedObj = {
              ...obj,
              scaleX: visualTransform.resize.scaleX,
              scaleY: visualTransform.resize.scaleY,
              left: visualTransform.resize.left,
              top: visualTransform.resize.top,
            };
            bbox = getAnnotationBBox(transformedObj);
          } else if (visualTransform.rotate) {
            // During rotate: update angle on bbox
            bbox = { ...bbox, angle: visualTransform.rotate.angle };
          } else {
            // During move: apply translate to the overlay group
            overlayTransform = `translate(${visualTransform.dx}, ${visualTransform.dy})`;
          }
        }

        // Line-type annotations: endpoint handles only (no bbox, no dashed outline)
        const isLineType = String(obj.type || '').toLowerCase() === 'line';
        if (isLineType) {
          const ep = getLineEndpoints(obj);
          const dx = overlayTransform ? (visualTransform?.dx || 0) : 0;
          const dy = overlayTransform ? (visualTransform?.dy || 0) : 0;
          const isArrow = obj.tool === 'arrow';
          // Arrow: handle at arrowhead tip (ep2) and line start (ep1)
          // Line: handles at both endpoints
          // Dampened inverse scale (sqrt) to match SVGSelectionOverlay handle sizing
          const handleIs = Math.sqrt(inverseScale);
          const handleR = 7 * handleIs;
          const handleStyle = {
            filter: `drop-shadow(0 ${1 * handleIs}px ${3 * handleIs}px rgba(0,0,0,0.15))`,
            cursor: 'grab',
            pointerEvents: 'auto',
          };
          return (
            <g key={`selection-wrapper-${selectedIndex}`}>
              {/* Start handle (line start / arrow tail) */}
              <circle
                cx={ep.x1 + dx} cy={ep.y1 + dy}
                r={handleR}
                fill="#ffffff"
                stroke="#4a90e2"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={handleStyle}
                onPointerDown={(e) => { e.stopPropagation(); handleHandlePointerDown(e, 'p1'); }}
              />
              {/* End handle — same style as start handle, centered on arrowhead */}
              <circle
                cx={ep.x2 + dx} cy={ep.y2 + dy}
                r={handleR}
                fill="#ffffff"
                stroke="#4a90e2"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={handleStyle}
                onPointerDown={(e) => { e.stopPropagation(); handleHandlePointerDown(e, 'p2'); }}
              />
            </g>
          );
        }

        // Border-flush types: handles sit directly on the shape's own stroke, no dashed bbox
        const objType = String(obj.type || '').toLowerCase();
        const isBorderFlush = objType === 'text' || objType === 'textbox' || objType === 'i-text' || objType === 'rect';

        return (
          <g key={`selection-wrapper-${selectedIndex}`} transform={overlayTransform}>
            <SVGSelectionOverlay
              key={`selection-${selectedIndex}`}
              bbox={bbox}
              inverseScale={inverseScale}
              onHandleDrag={(e, handleId) => handleHandlePointerDown(e, handleId)}
              isGroupSelection={isBeingEditedNow}
              hideBoundingBox={isBorderFlush}
              padding={isBorderFlush ? 0 : 2}
            />
          </g>
        );
      })}
      {/* Multi-select: individual dashed boxes (no handles) + group union box with handles */}
      {selectedIds.size > 1 && (
        <>
          {/* Individual dashed boxes for each selected annotation (no handles) */}
          {Array.from(selectedIds).map((selectedIndex) => {
            const obj = annotations?.objects?.[selectedIndex];
            if (!obj) return null;
            const bbox = getAnnotationBBox(obj);
            // Apply group drag transform
            const groupDragTransform = (visualTransform?.id === 'group' && visualTransform.affectedIds?.has(selectedIndex))
              ? `translate(${visualTransform.dx}, ${visualTransform.dy})`
              : undefined;
            return (
              <g key={`selection-wrapper-${selectedIndex}`} transform={groupDragTransform}>
                <SVGSelectionOverlay
                  key={`selection-${selectedIndex}`}
                  bbox={bbox}
                  inverseScale={inverseScale}
                  onHandleDrag={() => {}}
                  isGroupSelection={true}
                />
              </g>
            );
          })}
          {/* Group union bounding box with handles */}
          {(() => {
            const bboxes = Array.from(selectedIds)
              .map(idx => annotations?.objects?.[idx])
              .filter(Boolean)
              .map(obj => getAnnotationBBox(obj));
            if (bboxes.length === 0) return null;
            const groupBBox = getGroupBBox(bboxes);
            // Apply group drag transform to union box
            const groupDragTransform = (visualTransform?.id === 'group')
              ? `translate(${visualTransform.dx}, ${visualTransform.dy})`
              : undefined;
            return (
              <g key="group-selection-wrapper" transform={groupDragTransform}>
                <SVGSelectionOverlay
                  key="group-selection"
                  bbox={groupBBox}
                  inverseScale={inverseScale}
                  onHandleDrag={(e, handleId) => handleHandlePointerDown(e, handleId)}
                  isGroupSelection={false}
                  strokeOpacity={0.6}
                />
              </g>
            );
          })()}
        </>
      )}
    </svg>
    {/* EDIT-12 (Phase 12 Plan 02): RotationInputField portals into the
        overlay div that hosts SVGAnnotationLayer. Sits as a sibling to the
        <svg> in the React tree so it can co-receive parent state updates,
        but renders into svgRef.current.parentElement (resolved at runtime
        because the ref isn't attached on the very first render — the
        component early-returns null when hostEl is null, so safe). */}
    <RotationInputField
      svgRef={svgRef}
      hostEl={svgRef.current?.parentElement || null}
      angle={liveRotationAngle}
      annotationIndex={selectedAnnotationIndex}
      isRotating={isRotating}
      isVisible={showRotationInput && selectedAnnotationIndex !== null}
      onCommit={handleRotationInputCommit}
      onCancel={handleRotationInputCancel}
      onHoverChange={handleRotationInputHoverChange}
    />
    </>
  );
});

SVGAnnotationLayer.displayName = 'SVGAnnotationLayer';

export default SVGAnnotationLayer;
