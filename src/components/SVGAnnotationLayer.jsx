/**
 * SVGAnnotationLayer
 *
 * Display-only SVG annotation layer that renders Fabric.js JSON annotations
 * as SVG elements using viewBox-based auto-scaling. Replaces Canvas-based
 * display when SVG renderer mode is active.
 *
 * Key architecture:
 * - Single <svg viewBox="0 0 pageWidth pageHeight"> per page
 * - All coordinates in unscaled PDF page space
 * - Browser handles zoom scaling automatically via viewBox
 * - vector-effect="non-scaling-stroke" keeps stroke widths constant
 * - mix-blend-mode: multiply for highlight annotations
 * - pathOffset transform chain for correct pen stroke positioning
 *
 * Phase 8 Plan 01: Tier 1 types (paths, rects, lines, arrows) + stubs for tier 2
 * Phase 8 Plan 02: Tier 2 types (ellipse, text, callouts) + full three-layer filtering
 */
import React, { memo, useMemo, useEffect } from 'react';
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
}) => {
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
  // Filter and render annotation objects with full three-layer visibility
  // ---------------------------------------------------------------------------
  const renderedObjects = useMemo(() => {
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

    const elements = [];
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
        // Background annotations pass space filter when regions active
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
        // Base layer: hidden when survey mode active with module selected
        surveyAnnotationVisible = !(showSurveyPanel && selectedModuleId !== null);
      }
      // Region-scoped annotations always pass survey check

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
        // Groups with a line child are arrows
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
        elements.push(element);
        count++;
      }
    }

    return elements;
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

  const objectCount = renderedObjects.length;
  const calloutCount = filteredCallouts.length;

  // Log mount info
  useEffect(() => {
    console.log(
      `[SVGAnnotationLayer] Mounted for page ${pageNumber} with ${objectCount} annotations, ${calloutCount} callouts`
    );
  }, [pageNumber, objectCount, calloutCount]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
      preserveAspectRatio="none"
    >
      {renderedObjects}
      {filteredCallouts}
    </svg>
  );
});

SVGAnnotationLayer.displayName = 'SVGAnnotationLayer';

export default SVGAnnotationLayer;
