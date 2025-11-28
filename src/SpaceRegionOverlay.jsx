import React, { useMemo } from 'react';
import { union, diff } from 'martinez-polygon-clipping';

// Helper to convert region to polygon for martinez
const regionToPolygon = (region) => {
  if (!region || !Array.isArray(region.coordinates)) {
    return null;
  }

  const coords = region.coordinates;
  const polygon = [];

  for (let i = 0; i < coords.length; i += 2) {
    if (i + 1 < coords.length) {
      polygon.push([coords[i], coords[i + 1]]);
    }
  }

  // Close the polygon if not already closed
  if (polygon.length > 0 &&
    (polygon[0][0] !== polygon[polygon.length - 1][0] ||
      polygon[0][1] !== polygon[polygon.length - 1][1])) {
    polygon.push([polygon[0][0], polygon[0][1]]);
  }

  if (polygon.length < 4) return null; // Need at least 3 points + closing point

  // Ensure Counter-Clockwise (CCW) winding for outer ring
  // Shoelace formula for signed area
  let area = 0;
  for (let i = 0; i < polygon.length - 1; i++) {
    area += (polygon[i + 1][0] - polygon[i][0]) * (polygon[i + 1][1] + polygon[i][1]);
  }
  // If area is positive, it's Clockwise (assuming y-down screen coords? Wait.)
  // Standard shoelace (x2-x1)(y2+y1) gives 2*Area.
  // For (0,0)->(10,0)->(10,10)->(0,0):
  // (10-0)(0+0) + (10-10)(10+0) + (0-10)(0+10) + (0-0)(0+0)
  // 0 + 0 + -100 + 0 = -100.
  // This is CW (Right-Down-Left-Up). Area is negative.
  // So CW is Negative?
  // Let's re-check my previous calculation.
  // Previous: (x2-x1)(y2+y1)
  // (0,0)->(10,0) -> (10,0)-(0,0) -> 10*0 = 0.
  // (10,0)->(10,10) -> (10-10)*(10+0) = 0.
  // (10,10)->(0,10) -> (0-10)*(10+10) = -200.
  // (0,10)->(0,0) -> (0-0)*(0+10) = 0.
  // Sum = -200.
  // So CW is Negative.

  // CCW: (0,0)->(0,10)->(10,10)->(10,0).
  // (0-0)(10+0) = 0.
  // (10-0)(10+10) = 200.
  // (10-10)(0+10) = 0.
  // (0-10)(0+0) = 0.
  // Sum = 200.
  // So CCW is Positive.

  // Martinez expects CCW. So we want Positive area.
  if (area < 0) {
    polygon.reverse();
  }

  return [polygon];
};

// Helper to convert polygon back to path string
const polygonToPath = (polygon, scale) => {
  if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return '';

  // Handle multipolygons (array of polygons) or single polygon (array of rings)
  // Martinez returns multipolygons: [[[x,y], [x,y]...], [[x,y]...]]
  // But sometimes we might be dealing with a single polygon structure depending on how we iterate.
  // Let's assume input is a single polygon (array of rings), where ring 0 is outer.

  const rings = polygon;
  let path = '';

  rings.forEach(ring => {
    if (!Array.isArray(ring) || ring.length < 2) return;

    path += `M ${ring[0][0] * scale} ${ring[0][1] * scale}`;
    for (let i = 1; i < ring.length; i++) {
      path += ` L ${ring[i][0] * scale} ${ring[i][1] * scale}`;
    }
    path += ' Z ';
  });

  return path;
};

// Component that overlays a dimming effect on pages, keeping only selected regions visible
const SpaceRegionOverlay = ({
  pageNumber,
  regions,
  width,
  height,
  scale = 1
}) => {
  const buildRegionPath = (region) => {
    if (!region || !Array.isArray(region.coordinates)) {
      return null;
    }

    const coords = region.coordinates;
    if (region.shapeType === 'rectangular' && coords.length >= 8) {
      const scaled = coords.map((value) => value * scale);
      return `M ${scaled[0]} ${scaled[1]} L ${scaled[2]} ${scaled[3]} L ${scaled[4]} ${scaled[5]} L ${scaled[6]} ${scaled[7]} Z`;
    }

    if (region.shapeType === 'polygon' && coords.length >= 6) {
      let path = `M ${coords[0] * scale} ${coords[1] * scale}`;
      for (let i = 2; i < coords.length; i += 2) {
        const x = coords[i] * scale;
        const y = coords[i + 1] * scale;
        path += ` L ${x} ${y}`;
      }
      path += ' Z';
      return path;
    }

    return null;
  };



  const overlayPath = useMemo(() => {
    if (!regions || regions.length === 0) {
      return null;
    }

    const outerWidth = width * scale;
    const outerHeight = height * scale;
    const basePath = `M 0 0 H ${outerWidth} V ${outerHeight} H 0 Z`;

    // Union all regions to handle overlaps correctly
    let mergedPolygons = [];

    // Separate additive and subtractive regions if needed, but for the overlay
    // we generally just want to show "selected areas".
    // Assuming all regions passed here are "selected" (additive).

    for (const region of regions) {
      const poly = regionToPolygon(region);
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
        regionPaths += polygonToPath(polygon, scale);
      });
    }

    if (!regionPaths) {
      return null;
    }

    return `${basePath} ${regionPaths}`;
  }, [regions, width, height, scale]);

  const hatchId = useMemo(() => `space-hatch-${pageNumber}`, [pageNumber]);

  if (!overlayPath) {
    return null;
  }

  const scaledWidth = width * scale;
  const scaledHeight = height * scale;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${scaledWidth}px`,
        height: `${scaledHeight}px`,
        pointerEvents: 'auto',
        zIndex: 20
      }}
    >
      <svg
        width={scaledWidth}
        height={scaledHeight}
        style={{
          position: 'absolute',
          top: 0,
          left: 0
        }}
      >
        <defs>
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
        <path
          d={overlayPath}
          fill="rgba(40, 40, 40, 0.55)"
          fillRule="evenodd"
          pointerEvents="auto"
        />
        <path
          d={overlayPath}
          fill={`url(#${hatchId})`}
          fillRule="evenodd"
          opacity={0.3}
          pointerEvents="auto"
        />
      </svg>
    </div>
  );
};

export default SpaceRegionOverlay;