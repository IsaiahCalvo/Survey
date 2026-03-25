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
import React, { memo, useMemo, useEffect, useRef } from 'react';
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
import { getAnnotationBBox, getGroupBBox } from '../utils/svgBoundingBox';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PREVIEW_OBJECTS = 420;
const MAX_PREVIEW_CALLOUTS = 140;

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
  getRegionLightbulbState,
  isRegionOverlayEnabled,
  layerVisibility,
  // Selection / interaction props (Phase 9)
  onSaveAnnotations,   // (updatedJSON, saveContext) => void
  onRequestEditMode,   // (annotationIndex, annotationType) => void
  activeTool,          // string — current tool (e.g., 'pan', 'pen', etc.)
}) => {
  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------
  const svgRef = useRef(null);

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

  // Determine pointer events mode: interactive when not using drawing tools
  const isInteractive = !activeTool || activeTool === 'pan' || activeTool === 'select' || activeTool === 'text-select';

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
      const isSurveyAnnotation = obj.moduleId !== null && obj.moduleId !== undefined;
      const isScopedRegionAnnotation = obj.regionId !== null && obj.regionId !== undefined;
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

      // 4. Background annotation visibility (lightbulb toggle)
      let backgroundAnnotationVisible = true;
      if (!isScopedRegionAnnotation && obj.regionId === null) {
        if (selectedSpaceId !== null && getRegionLightbulbState) {
          backgroundAnnotationVisible = getRegionLightbulbState(selectedSpaceId, pageNumber);
        } else {
          backgroundAnnotationVisible = true;
        }
      }

      // 5. Final visibility
      const isVisible =
        matchesSpace &&
        surveyAnnotationVisible &&
        scopedRegionAnnotationVisible &&
        (isScopedRegionAnnotation ? true : backgroundAnnotationVisible);

      if (!isVisible) continue;

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
        results.push({ obj, index: i, element });
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
    getRegionLightbulbState,
    isRegionOverlayEnabled,
    layerVisibility,
    getSpaceIdForRegion,
  ]);

  // ---------------------------------------------------------------------------
  // Filter and render callout annotations
  // ---------------------------------------------------------------------------
  const filteredCallouts = useMemo(() => {
    if (!Array.isArray(callouts) || callouts.length === 0) return [];

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
  }, [callouts, pageNumber, showSurveyPanel, selectedModuleId, width, height]);

  const objectCount = filteredAnnotations.length;
  const calloutCount = filteredCallouts.length;

  // Log mount/unmount
  useEffect(() => {
    console.log(
      `[SVG p${pageNumber}] MOUNT — ${objectCount} annotations, ${calloutCount} callouts, viewBox=${width}x${height}`
    );
    return () => {
      console.log(`[SVG p${pageNumber}] UNMOUNT`);
    };
  }, [pageNumber, objectCount, calloutCount, width, height]);

  // Log every render (to detect re-renders during zoom)
  console.log(
    `[SVG p${pageNumber}] render — ${objectCount} objs, viewBox=${width}x${height}`
  );

  // ---------------------------------------------------------------------------
  // Render: wrap each annotation with hit-area, hover, and interaction handlers
  // ---------------------------------------------------------------------------
  const wrappedAnnotations = filteredAnnotations.map(({ obj, index: i, element }) => {
    // During resize, create a temporary modified copy for rendering
    let renderObj = obj;
    let renderElement = element;
    if (visualTransform?.resize && visualTransform.id === i) {
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
          // Resize: element is re-rendered at new scale, no transform needed
          return undefined;
        }
        if (visualTransform.rotate) {
          const { angle, cx, cy } = visualTransform.rotate;
          return `rotate(${angle}, ${cx}, ${cy})`;
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

    return (
      <g
        key={`wrapper-${obj.id || i}`}
        data-annotation-index={i}
        data-annotation-id={obj.id || ''}
        style={{
          cursor: annotationIsSelected ? 'move' : (annotationIsHovered ? 'pointer' : undefined),
        }}
        transform={computedTransform}
      >
        {/* Invisible hit-area rect for easier clicking */}
        <rect
          x={bbox.left}
          y={bbox.top}
          width={Math.max(bbox.width, 10)}
          height={Math.max(bbox.height, 10)}
          fill="transparent"
          stroke="none"
          style={{ pointerEvents: isInteractive ? 'fill' : 'none' }}
          onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
          onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
          onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
          onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
        />
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
        {/* Actual annotation render */}
        {renderElement}
      </g>
    );
  });

  return (
    <svg
      ref={svgRef}
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
      onPointerDown={isInteractive ? handleSvgPointerDown : undefined}
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
        const bbox = getAnnotationBBox(obj);
        return (
          <SVGSelectionOverlay
            key={`selection-${selectedIndex}`}
            bbox={bbox}
            inverseScale={inverseScale}
            onHandleDrag={(e, handleId) => handleHandlePointerDown(e, handleId)}
            isGroupSelection={false}
          />
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
            return (
              <SVGSelectionOverlay
                key={`selection-${selectedIndex}`}
                bbox={bbox}
                inverseScale={inverseScale}
                onHandleDrag={() => {}}
                isGroupSelection={true}
              />
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
            return (
              <SVGSelectionOverlay
                key="group-selection"
                bbox={groupBBox}
                inverseScale={inverseScale}
                onHandleDrag={(e, handleId) => handleHandlePointerDown(e, handleId)}
                isGroupSelection={false}
                strokeOpacity={0.6}
              />
            );
          })()}
        </>
      )}
    </svg>
  );
});

SVGAnnotationLayer.displayName = 'SVGAnnotationLayer';

export default SVGAnnotationLayer;
