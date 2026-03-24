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
 */
import React, { memo, useMemo, useEffect } from 'react';
import {
  renderPath,
  renderRect,
  renderLine,
  renderArrow,
  renderEllipse,
  renderText,
} from '../utils/svgAnnotationRenderers';

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
  // Basic filtering (used in Plan 01)
  selectedModuleId,
  showSurveyPanel,
  // Full filtering (wired in Plan 02)
  selectedSpaceId,
  activeSpaceId,
  activeRegions,
  activeRegionId,
  spaces,
  getRegionLightbulbState,
  isRegionOverlayEnabled,
  layerVisibility,
}) => {
  // Render annotation objects with filtering and type dispatch
  const renderedObjects = useMemo(() => {
    const objects = Array.isArray(annotations?.objects)
      ? annotations.objects
      : [];

    if (objects.length === 0) return [];

    const elements = [];
    let count = 0;

    for (let i = 0; i < objects.length; i++) {
      if (count >= MAX_PREVIEW_OBJECTS) break;

      const obj = objects[i];
      if (!obj || obj.visible === false) continue;

      // --- Filtering ---

      // Layer visibility check
      const layer = obj.layer || 'native';
      if (layerVisibility && layerVisibility[layer] === false) continue;

      // Module/survey filtering (matching LightweightAnnotationOverlay pattern)
      const isSurveyScoped = obj.moduleId !== null && obj.moduleId !== undefined;
      if (showSurveyPanel && selectedModuleId) {
        // Survey-scoped objects: skip if moduleId does not match
        if (isSurveyScoped && obj.moduleId !== selectedModuleId) continue;
        // Non-survey, non-region objects: hidden when survey mode active
        if (!isSurveyScoped && !obj.regionId) continue;
      }

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
  }, [annotations, selectedModuleId, showSurveyPanel, layerVisibility]);

  const objectCount = renderedObjects.length;

  // Log mount info
  useEffect(() => {
    console.log(
      `[SVGAnnotationLayer] Mounted for page ${pageNumber} with ${objectCount} annotations`
    );
  }, [pageNumber, objectCount]);

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
    </svg>
  );
});

SVGAnnotationLayer.displayName = 'SVGAnnotationLayer';

export default SVGAnnotationLayer;
