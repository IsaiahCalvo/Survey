/**
 * SpaceRegionOverlay.jsx — SVG dimming mask that highlights a space's selected regions on a page.
 *
 * Default-export component that unions/subtracts a page's region polygons (via
 * martinez-polygon-clipping) into a cutout path, then renders a semi-opaque
 * grey + hatch overlay everywhere EXCEPT inside those regions. Uses an SVG
 * `viewBox="0 0 width height"` so the overlay scales with zoom; pointer-events
 * are disabled (visual only). Rendered per page when a space is active.
 */
import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import { union, diff } from './vendor/martinezPolygonClipping.js';
import { regionToPolygon } from './utils/regionMath';
import { withRegionOutlineCoordinates } from './utils/regionOutline';

const spaceRegionDebug = (...args) => {
  if (typeof window === 'undefined' || window.__SPACE_REGION_DEBUG !== true) return;
  try { console.debug(...args); } catch { /* ignore debug logging failures */ }
};

// Helper to convert polygon back to path string
const polygonToPath = (polygon) => {
  if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return '';

  // Handle multipolygons (array of polygons) or single polygon (array of rings)
  // Martinez returns multipolygons: [[[x,y], [x,y]...], [[x,y]...]]
  // But sometimes we might be dealing with a single polygon structure depending on how we iterate.
  // Let's assume input is a single polygon (array of rings), where ring 0 is outer.

  const rings = polygon;
  let path = '';

  rings.forEach(ring => {
    if (!Array.isArray(ring) || ring.length < 2) return;

    path += `M ${ring[0][0]} ${ring[0][1]}`;
    for (let i = 1; i < ring.length; i++) {
      path += ` L ${ring[i][0]} ${ring[i][1]}`;
    }
    path += ' Z ';
  });

  return path;
};

// Helper function to check if a region has valid coordinates/areas
const hasValidAreas = (region) => {
  if (!region || !Array.isArray(region.coordinates)) {
    return false;
  }
  const coords = region.coordinates;
  // Check if region has enough coordinates for its shape type
  if (region.shapeType === 'rectangular' && coords.length >= 8) {
    return true;
  }
  if (region.shapeType === 'polygon' && coords.length >= 6) {
    return true;
  }
  return false;
};

// Component that overlays a dimming effect on pages, keeping only selected regions visible
const SpaceRegionOverlay = ({
  pageNumber,
  regions,
  width,
  height,
  displayWidth,
  displayHeight,
  scale = 1,
  fillContainer = false,
}) => {
  const rootRef = useRef(null);
  const svgRef = useRef(null);
  const instanceId = useId().replace(/:/g, '-');
  const screenWidth = Number.isFinite(displayWidth) && displayWidth > 0
    ? displayWidth
    : width * scale;
  const screenHeight = Number.isFinite(displayHeight) && displayHeight > 0
    ? displayHeight
    : height * scale;

  const regionCutoutPath = useMemo(() => {
    if (!regions || regions.length === 0) {
      return null;
    }

    // Requirement: "When a user enters a space and no area has been defined for a region on a page 
    // → the entire page is fully visible with no grey hashed overlay."
    // Check if any region has valid areas/coordinates
    const hasAnyValidAreas = regions.some(region => hasValidAreas(region));
    if (!hasAnyValidAreas) {
      return null; // No valid areas defined, don't show overlay
    }

    // Union all regions to handle overlaps correctly
    let mergedPolygons = [];

    // Separate additive and subtractive regions if needed, but for the overlay
    // we generally just want to show "selected areas".
    // Assuming all regions passed here are "selected" (additive).

    for (const region of regions) {
      // Skip regions without valid areas
      if (!hasValidAreas(region)) {
        continue;
      }
      // Curved (freehand) areas: fill the same smooth outline the editor draws.
      const poly = regionToPolygon(withRegionOutlineCoordinates(region));
      if (!poly) continue;

      if (mergedPolygons.length === 0) {
        // Can't subtract from nothing, so only add if it's not subtractive
        // Or if it is subtractive, we just ignore it as it has no effect on empty set
        if (region.operation === 'subtract') continue;
        mergedPolygons = [poly];
      } else {
        try {
          // Martinez union/diff expects MultiPolygons.
          // mergedPolygons is a MultiPolygon (Array of Polygons).
          // poly is a Polygon (Array of Rings) wrapped in array -> [Polygon] -> MultiPolygon.

          let resultMerged;
          if (region.operation === 'subtract') {
            // Ensure both are MultiPolygons (arrays of polygons)
            // mergedPolygons is already MultiPolygon
            // poly is [Polygon] which is MultiPolygon
            resultMerged = diff(mergedPolygons, poly);
          } else {
            resultMerged = union(mergedPolygons, poly);
          }

          if (resultMerged) {
            // resultMerged can be empty array if everything is subtracted
            mergedPolygons = resultMerged;
          } else {
            // If null/undefined returned (shouldn't happen with valid inputs but safety check)
            console.warn('Boolean operation returned invalid result in overlay', resultMerged);
            if (region.operation !== 'subtract') {
              mergedPolygons.push(poly[0]);
            }
          }
        } catch (e) {
          console.error('Error combining regions for overlay:', e);
          if (region.operation !== 'subtract') {
            mergedPolygons.push(poly[0]); // Fallback: just add it
          }
        }
      }
    }

    // Generate path from merged polygons
    let regionPaths = '';
    if (mergedPolygons.length > 0) {
      mergedPolygons.forEach(polygon => {
        regionPaths += polygonToPath(polygon);
      });
    }

    if (!regionPaths) {
      return null;
    }

    return regionPaths;
  }, [height, regions, width]);

  const hatchId = `space-hatch-${pageNumber}-${instanceId}`;
  const maskId = `space-mask-${pageNumber}-${instanceId}`;

  const canRender =
    !!regionCutoutPath &&
    Number.isFinite(width) && width > 0 &&
    Number.isFinite(height) && height > 0 &&
    Number.isFinite(screenWidth) && screenWidth > 0 &&
    Number.isFinite(screenHeight) && screenHeight > 0;

  useLayoutEffect(() => {
    if (!canRender) return;
    const rootRect = rootRef.current?.getBoundingClientRect?.();
    const svgRect = svgRef.current?.getBoundingClientRect?.();
    spaceRegionDebug(
      `[SpaceRegionOverlay p${pageNumber}] mounted — ` +
      `root=${rootRect ? `${Math.round(rootRect.width)}x${Math.round(rootRect.height)}` : 'none'}, ` +
      `svg=${svgRect ? `${Math.round(svgRect.width)}x${Math.round(svgRect.height)}` : 'none'}, ` +
      `fillContainer=${fillContainer}, maskId=${maskId}`
    );
  }, [canRender, fillContainer, maskId, pageNumber, regionCutoutPath]);

  if (!canRender) {
    return null;
  }

  spaceRegionDebug(
    `[SpaceRegionOverlay p${pageNumber}] render — ` +
    `regions=${regions.length}, screen=${Math.round(screenWidth)}x${Math.round(screenHeight)}, ` +
    `cutoutPathLength=${regionCutoutPath.length}, maskId=${maskId}`
  );

  return (
    <div
      ref={rootRef}
      data-space-region-overlay-root={pageNumber}
      data-space-region-overlay-screen-width={String(Math.round(screenWidth * 1000) / 1000)}
      data-space-region-overlay-screen-height={String(Math.round(screenHeight * 1000) / 1000)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: fillContainer ? '100%' : `${screenWidth}px`,
        height: fillContainer ? '100%' : `${screenHeight}px`,
        pointerEvents: 'none', // FIX: Don't block mouse events - overlay is visual only
        // Sit above the base annotation renderers so canvas-scoped content is dimmed.
        zIndex: 101
      }}
    >
      <svg
        ref={svgRef}
        data-space-region-overlay-svg={pageNumber}
        width={fillContainer ? '100%' : screenWidth}
        height={fillContainer ? '100%' : screenHeight}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: fillContainer ? '100%' : undefined,
          height: fillContainer ? '100%' : undefined,
          pointerEvents: 'none' // FIX: Don't block mouse events
        }}
      >
        <defs>
          <mask
            id={maskId}
            x="0"
            y="0"
            width={width}
            height={height}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
          >
            <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
            <path
              d={regionCutoutPath}
              fill="#000000"
              fillRule="evenodd"
            />
          </mask>
          <pattern
            id={hatchId}
            x="0"
            y="0"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <path d="M -2 2 L 2 -2" stroke="#000" strokeWidth="1" />
            <path d="M 0 10 L 10 0" stroke="#000" strokeWidth="1" />
            <path d="M 8 12 L 12 8" stroke="#000" strokeWidth="1" />
          </pattern>
        </defs>
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          fill="var(--surface-2)"
          fillOpacity="0.55"
          mask={`url(#${maskId})`}
          pointerEvents="none"
        />
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          fill={`url(#${hatchId})`}
          opacity={0.3}
          mask={`url(#${maskId})`}
          pointerEvents="none"
        />
      </svg>
    </div>
  );
};

export default SpaceRegionOverlay;
