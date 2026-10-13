// Import martinez-polygon-clipping for polygon boolean operations
import { union, diff, intersection } from '../vendor/martinezPolygonClipping.js';
import { buildSmoothVertexLookup, regionHasSmoothOutline, thinBooleanResultRing } from './regionOutline.js';

export const REGION_OPERATIONS = {
  ADD: 'add',
  SUBTRACT: 'subtract'
};

const normalizeOperation = (operation) =>
  operation === REGION_OPERATIONS.SUBTRACT ? REGION_OPERATIONS.SUBTRACT : REGION_OPERATIONS.ADD;

export const polygonContainsPoint = (x, y, coords, scaleFactor = 1) => {
  if (!Array.isArray(coords) || coords.length < 6) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = coords.length - 2; i < coords.length; i += 2) {
    const xi = coords[i] * scaleFactor;
    const yi = coords[i + 1] * scaleFactor;
    const xj = coords[j] * scaleFactor;
    const yj = coords[j + 1] * scaleFactor;

    const denominator = (yj - yi) || 1e-6;
    const intersects =
      ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / denominator + xi);

    if (intersects) {
      inside = !inside;
    }

    j = i;
  }

  return inside;
};

export const rectangleContainsPoint = (x, y, coords, scaleFactor = 1) => {
  if (!Array.isArray(coords) || coords.length < 8) {
    return false;
  }

  const xs = [coords[0], coords[2], coords[4], coords[6]].map(val => val * scaleFactor);
  const ys = [coords[1], coords[3], coords[5], coords[7]].map(val => val * scaleFactor);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return x >= minX && x <= maxX && y >= minY && y <= maxY;
};

export const regionContainsPoint = (x, y, region, scaleFactor = 1) => {
  if (!region || !Array.isArray(region.coordinates)) {
    return false;
  }

  if (region.shapeType === 'rectangular') {
    return rectangleContainsPoint(x, y, region.coordinates, scaleFactor);
  }

  return polygonContainsPoint(x, y, region.coordinates, scaleFactor);
};


// Get bounding box of a region
const getRegionBounds = (region) => {
  if (!region || !Array.isArray(region.coordinates) || region.coordinates.length < 4) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < region.coordinates.length; i += 2) {
    const x = region.coordinates[i];
    const y = region.coordinates[i + 1];
    if (typeof x !== 'number' || typeof y !== 'number') {
      continue;
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
};

// Calculate center point of a region from its coordinates
const calculateRegionCenter = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length < 6) {
    return null;
  }

  const bounds = { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, 
                   maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY };
  
  for (let i = 0; i < coordinates.length; i += 2) {
    const x = coordinates[i];
    const y = coordinates[i + 1];
    if (typeof x === 'number' && typeof y === 'number') {
      if (x < bounds.minX) bounds.minX = x;
      if (x > bounds.maxX) bounds.maxX = x;
      if (y < bounds.minY) bounds.minY = y;
      if (y > bounds.maxY) bounds.maxY = y;
    }
  }

  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) || 
      !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)) {
    return null;
  }

  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };
};

// Check if two bounding boxes overlap
const boundsOverlap = (bounds1, bounds2) => {
  if (!bounds1 || !bounds2) return false;
  return !(bounds1.maxX < bounds2.minX || bounds2.maxX < bounds1.minX ||
    bounds1.maxY < bounds2.minY || bounds2.maxY < bounds1.minY);
};

// Check if two regions overlap by testing if they have a non-empty intersection
const regionsOverlap = (region1, region2) => {
  if (!region1 || !region2 || !Array.isArray(region1.coordinates) || !Array.isArray(region2.coordinates)) {
    return false;
  }

  // Quick bounding box check first
  const bounds1 = getRegionBounds(region1);
  const bounds2 = getRegionBounds(region2);
  if (!boundsOverlap(bounds1, bounds2)) {
    return false;
  }

  try {
    const poly1 = regionToPolygon(region1);
    const poly2 = regionToPolygon(region2);

    if (!poly1 || !poly2) {
      return false;
    }

    // Check for actual geometric intersection
    const result = intersection(poly1, poly2);

    // If result is not empty, they overlap
    return result && result.length > 0;
  } catch (error) {
    console.error('Error checking region overlap:', error);
    // Fallback to bounding box check if intersection fails
    return true;
  }
};

// Convert region coordinates to polygon format for martinez library
export const regionToPolygon = (region) => {
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

  if (polygon.length < 4) return null;

  // Ensure Counter-Clockwise (CCW) winding for outer ring
  // Shoelace formula for signed area
  let area = 0;
  for (let i = 0; i < polygon.length - 1; i++) {
    area += (polygon[i + 1][0] - polygon[i][0]) * (polygon[i + 1][1] + polygon[i][1]);
  }

  // Martinez expects CCW. So we want Positive area (in screen coords where y is down, CCW is positive sum).
  if (area < 0) {
    polygon.reverse();
  }

  return [polygon];
};

// Convert polygon from martinez format back to region coordinates
export const polygonToRegionCoords = (polygon) => {
  if (!polygon || !Array.isArray(polygon) || polygon.length === 0) {
    return null;
  }

  const firstRing = polygon[0];
  if (!Array.isArray(firstRing) || firstRing.length < 3) {
    return null;
  }

  const coords = [];
  for (const point of firstRing) {
    if (Array.isArray(point) && point.length >= 2) {
      coords.push(point[0], point[1]);
    }
  }

  // Remove duplicate last point if it's the same as first
  if (coords.length >= 4 &&
    coords[0] === coords[coords.length - 2] &&
    coords[1] === coords[coords.length - 1]) {
    coords.pop();
    coords.pop();
  }

  return coords.length >= 6 ? coords : null;
};

// Merge two regions of the same operation type
export const mergeRegions = (region1, region2) => {
  if (!region1 || !region2) {
    return null;
  }

  // Only merge regions with the same operation
  const op1 = normalizeOperation(region1.operation);
  const op2 = normalizeOperation(region2.operation);
  if (op1 !== op2) {
    return null;
  }

  // Check if regions overlap
  if (!regionsOverlap(region1, region2)) {
    return null;
  }

  try {
    const poly1 = regionToPolygon(region1);
    const poly2 = regionToPolygon(region2);

    if (!poly1 || !poly2) {
      return null;
    }

    // Perform union operation
    const result = union(poly1, poly2);

    if (!result || result.length === 0) {
      return null;
    }

    // If the result contains more than one polygon, it means they didn't merge into a single shape
    // (e.g. they are disjoint or just touching at a point/line).
    // In this case, we should NOT merge them, to preserve both original shapes.
    if (result.length > 1) {
      return null;
    }

    // Take the first (largest) polygon from the result
    const mergedCoords = polygonToRegionCoords(result[0]);
    if (!mergedCoords || mergedCoords.length < 6) {
      return null;
    }

    // Determine the shape type - if both are rectangular and result is simple, keep as rectangular
    // Otherwise use polygon
    const isRectangular = region1.shapeType === 'rectangular' && region2.shapeType === 'rectangular';
    const shapeType = isRectangular && result[0].length === 5 ? 'rectangular' : 'polygon';

    // Generate a new regionId for the merged region
    const newRegionId = crypto.randomUUID();

    // Calculate center for origin tracking
    const originCenter = calculateRegionCenter(mergedCoords);

    // Preserve merge history by collecting sourceRegions from both regions
    // If a region doesn't have sourceRegions, it's an original region, so include it directly
    const sourceRegions = [
      ...(Array.isArray(region1.sourceRegions) && region1.sourceRegions.length > 0 
        ? region1.sourceRegions 
        : [{
            regionId: region1.regionId,
            pageId: region1.pageId,
            shapeType: region1.shapeType,
            operation: region1.operation,
            coordinates: region1.coordinates
          }]),
      ...(Array.isArray(region2.sourceRegions) && region2.sourceRegions.length > 0 
        ? region2.sourceRegions 
        : [{
            regionId: region2.regionId,
            pageId: region2.pageId,
            shapeType: region2.shapeType,
            operation: region2.operation,
            coordinates: region2.coordinates
          }])
    ];

    return {
      regionId: newRegionId,
      pageId: region1.pageId || region2.pageId,
      shapeType: shapeType,
      operation: op1,
      coordinates: mergedCoords,
      sourceRegions: sourceRegions,
      originCenter: originCenter
    };
  } catch (error) {
    console.error('Error merging regions:', error);
    return null;
  }
};

// Subtract a region from another region.
// options.thinTolerance (page units, default 1): when either outline has
// smooth (freehand) points, the result is thinned along its curved parts so a
// curved bite keeps few points; rectangle corners and the points where the cut
// crosses an edge are kept exactly. Straight-only inputs come out as before.
export const subtractRegionFromRegion = (subjectRegion, subtractRegion, options = {}) => {
  if (!subjectRegion || !subtractRegion) {
    return null;
  }

  // Check if regions overlap
  if (!regionsOverlap(subjectRegion, subtractRegion)) {
    return [subjectRegion]; // Return original region if no overlap
  }

  try {
    const subjectPoly = regionToPolygon(subjectRegion);
    const subtractPoly = regionToPolygon(subtractRegion);

    if (!subjectPoly || !subtractPoly) {
      return [subjectRegion];
    }

    // Perform difference operation (subject - subtract)
    const result = diff(subjectPoly, subtractPoly);

    if (!result || result.length === 0) {
      // Region was completely subtracted
      return [];
    }

    // Convert result back to regions
    // Note: When a region is subtracted, we preserve the sourceRegions from the subject
    // but create new region IDs since the geometry has changed
    const resultRegions = [];
    const hasSmooth = regionHasSmoothOutline(subjectRegion) || regionHasSmoothOutline(subtractRegion);
    const smoothLookup = hasSmooth ? buildSmoothVertexLookup([subjectRegion, subtractRegion]) : null;
    const thinTolerance = Number.isFinite(options?.thinTolerance) && options.thinTolerance > 0 ? options.thinTolerance : 1;
    for (const polygon of result) {
      let coords = polygonToRegionCoords(polygon);
      let smoothVertices;
      if (smoothLookup && coords) {
        const thinned = thinBooleanResultRing(coords, smoothLookup, thinTolerance);
        coords = thinned.coordinates;
        smoothVertices = thinned.smoothVertices;
      }
      if (coords && coords.length >= 6) {
        const isRectangular = subjectRegion.shapeType === 'rectangular' && polygon.length === 5;
        const originCenter = calculateRegionCenter(coords);
        resultRegions.push({
          regionId: crypto.randomUUID(),
          pageId: subjectRegion.pageId,
          shapeType: isRectangular ? 'rectangular' : 'polygon',
          operation: subjectRegion.operation,
          coordinates: coords,
          ...(smoothVertices ? { smoothVertices } : {}),
          // Preserve sourceRegions if the subject had them (for unmerge capability)
          // If the subject was already a merged region, preserve that history
          sourceRegions: subjectRegion.sourceRegions || undefined,
          originCenter: originCenter || subjectRegion.originCenter || undefined
        });
      }
    }

    return resultRegions.length > 0 ? resultRegions : [];
  } catch (error) {
    console.error('Error subtracting regions:', error);
    return [subjectRegion];
  }
};


// Ramer-Douglas-Peucker algorithm for polygon simplification
const getSqDist = (p1, p2) => {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return dx * dx + dy * dy;
};

const getSqSegDist = (p, p1, p2) => {
  let x = p1.x;
  let y = p1.y;
  let dx = p2.x - x;
  let dy = p2.y - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.x;
      y = p2.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p.x - x;
  dy = p.y - y;

  return dx * dx + dy * dy;
};

const simplifyDPStep = (points, first, last, sqTolerance, simplified) => {
  let maxSqDist = sqTolerance;
  let index = -1;

  for (let i = first + 1; i < last; i++) {
    const sqDist = getSqSegDist(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }

  if (maxSqDist > sqTolerance) {
    if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
};

export const simplifyPolygon = (coordinates, tolerance = 2) => {
  if (!Array.isArray(coordinates) || coordinates.length < 6) {
    return coordinates;
  }

  // Convert flat array to points
  const points = [];
  for (let i = 0; i < coordinates.length; i += 2) {
    points.push({ x: coordinates[i], y: coordinates[i + 1] });
  }

  if (points.length <= 2) return coordinates;

  const sqTolerance = tolerance * tolerance;
  const simplified = [points[0]];

  simplifyDPStep(points, 0, points.length - 1, sqTolerance, simplified);
  simplified.push(points[points.length - 1]);

  // Convert back to flat array
  const result = [];
  for (const p of simplified) {
    result.push(p.x, p.y);
  }

  return result;
};

// ---------------------------------------------------------------------------
// KAL-301 follow-up — persisted region rotation (selection-chrome display).
//
// Regions BAKE rotation into their coordinates at drag release (so hit-testing,
// boolean ops, the space overlay mask, and print/export all keep consuming
// plain polygon coords with zero changes). The `rotation` field on a region is
// pure display metadata: the angle the selection chrome (bounding box +
// grabbers + mtr handle) should render at — exactly how standard annotations
// persist `angle` and SVGSelectionOverlay renders a rotated <g>.
// ---------------------------------------------------------------------------

/** Bring an angle into [0, 360). */
export const normalizeRegionRotation = (deg) => {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
};

/** Read a region's persisted chrome rotation (0 when absent/invalid). */
export const getRegionRotation = (region) => normalizeRegionRotation(region?.rotation ?? 0);

/**
 * Rotate a flat [x0,y0,x1,y1,...] coord array around (cx, cy) by angleDeg
 * (degrees, clockwise in screen space — the same direction as the SVG
 * rotate() transform used for chrome rendering and live previews).
 */
export const rotateCoordsAroundPoint = (coords, cx, cy, angleDeg) => {
  const rad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const rotated = new Array(coords.length);
  for (let i = 0; i < coords.length; i += 2) {
    const dx = coords[i] - cx;
    const dy = coords[i + 1] - cy;
    rotated[i] = cx + dx * cosA - dy * sinA;
    rotated[i + 1] = cy + dx * sinA + dy * cosA;
  }
  return rotated;
};

/**
 * Derive the tilted selection-chrome geometry for a region whose coords have
 * rotation baked in and whose `rotation` field remembers the display angle.
 *
 * Returns { center: {cx, cy}, bounds: {minX, minY, maxX, maxY}, rotation,
 * unrotatedCoords } where:
 *  - center is the axis-aligned bbox center of the CURRENT (baked) coords —
 *    the rotation pivot for chrome rendering;
 *  - unrotatedCoords are the coords counter-rotated by -rotation around
 *    center (a pure translation of the original pre-rotation polygon);
 *  - bounds is the axis-aligned bbox of unrotatedCoords.
 *
 * Rendering `bounds` (+ handles at unrotatedCoords) inside a
 * rotate(rotation, center) transform reproduces the baked coords exactly:
 * R(θ,c)·unrotatedCoords === coords, so the tilted box hugs the shape the
 * same way the upright box hugged it before the rotation was baked.
 */
export const deriveRegionChromeGeometry = (coordinates, rotationDeg) => {
  if (!Array.isArray(coordinates) || coordinates.length < 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < coordinates.length; i += 2) {
    const x = coordinates[i];
    const y = coordinates[i + 1];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  const rotation = normalizeRegionRotation(rotationDeg);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  if (rotation === 0) {
    return {
      center: { cx, cy },
      bounds: { minX, minY, maxX, maxY },
      rotation: 0,
      unrotatedCoords: coordinates
    };
  }
  const unrotatedCoords = rotateCoordsAroundPoint(coordinates, cx, cy, -rotation);
  let uMinX = Infinity;
  let uMinY = Infinity;
  let uMaxX = -Infinity;
  let uMaxY = -Infinity;
  for (let i = 0; i < unrotatedCoords.length; i += 2) {
    const x = unrotatedCoords[i];
    const y = unrotatedCoords[i + 1];
    if (x < uMinX) uMinX = x;
    if (x > uMaxX) uMaxX = x;
    if (y < uMinY) uMinY = y;
    if (y > uMaxY) uMaxY = y;
  }
  return {
    center: { cx, cy },
    bounds: { minX: uMinX, minY: uMinY, maxX: uMaxX, maxY: uMaxY },
    rotation,
    unrotatedCoords
  };
};
