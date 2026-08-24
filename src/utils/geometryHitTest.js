/**
 * Geometry-based hit testing for Fabric.js objects
 *
 * This module provides precise hit testing based on actual rendered geometry
 * rather than bounding boxes. It handles all annotation types and accounts
 * for transformations (rotation, scaling, translation).
 */
import { getCounterRenderGeometry } from './counterGeometry.js';
import { createInkPathAffine } from './inkGeometryTransform.js';
import { normalizeOperationalInkPath } from './inkPathNormalization.js';
import {
  commandsToPolylines,
  filledOutlineCommandsToPolygonSet,
  normalizeMultiPolygon,
  styledStrokeCommandsToPolygonSet,
} from './paperAnnotationGeometry.js';
import { union } from 'martinez-polygon-clipping';

// Default tolerance for hit testing (in pixels)
const DEFAULT_TOLERANCE = 3;

/**
 * Normalize a Fabric object's type for hit-test dispatch.
 *
 * fabric 7's toObject() serializes CLASS names ('Rect', 'Textbox', 'IText',
 * 'Path', …) while fabric 5 saves and live instances report lowercase
 * ('rect', 'textbox', 'i-text'). Every guard in this module must compare the
 * normalized form or all fabric-7-serialized objects silently become
 * un-hittable — that was the "eraser can't erase text boxes" bug (and it
 * equally broke marquee geometry for newer saves). Note 'IText' lowercases to
 * 'itext', not 'i-text', so the alias is mapped explicitly (CLAUDE.md
 * 2026-07-08 fabric-7 serialize gotcha #3).
 */
export const hitTestType = (obj) => {
  const lower = String(obj?.type || '').toLowerCase();
  return lower === 'itext' ? 'i-text' : lower;
};

const hasVisiblePaint = (value) => {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === 'none' || normalized === 'transparent') return false;
  if (/^rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(normalized)) return false;
  if (/^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(normalized)) {
    return normalized.length === 5
      ? normalized[4] !== '0'
      : normalized.slice(7, 9) !== '00';
  }
  return true;
};

const transformPointWithMatrix = (matrix, point) => {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
  };
};

const getTransformedPoints = (obj) => {
  const points = Array.isArray(obj?.points) ? obj.points : [];
  if (points.length === 0) return [];
  const matrix = getObjectTransformMatrix(obj);
  const pathOffsetX = obj.pathOffset?.x || 0;
  const pathOffsetY = obj.pathOffset?.y || 0;
  return points.map((point) => transformPointWithMatrix(matrix, {
    x: Number(point?.x || 0) - pathOffsetX,
    y: Number(point?.y || 0) - pathOffsetY,
  }));
};

// Live fabric instances carry calcTransformMatrix (center-based transform) and
// their raw geometry is center-relative; plain page-JSON objects have neither.
// The two storage conventions are NOT interchangeable — the 2026-07-19 eraser
// audit traced every "shape immune to the eraser" bug to plain-JSON objects
// being run through matrix math that only fits live instances. Plain-JSON arms
// below therefore mirror the SVG renderers' world geometry (the visual truth)
// exactly: getLineEndpoints center-based endpoints, rotation about the shape's
// visual center, and scaleX/scaleY folded into effective dimensions.
const isLiveFabricObject = (obj) => typeof obj?.calcTransformMatrix === 'function';

// Plain persisted paths must use the same affine truth as SVG rendering,
// page-space erasing, and PDF export. Live Fabric instances already expose
// their exact center-based matrix and still need pathOffset added after the
// inverse transform; createInkPathAffine maps raw path coordinates directly,
// so persisted JSON must not apply pathOffset a second time.
const getPathTransform = (pathObj) => {
  if (isLiveFabricObject(pathObj)) {
    return {
      matrix: getObjectTransformMatrix(pathObj),
      pathOffset: pathObj.pathOffset || { x: 0, y: 0 },
    };
  }
  return {
    matrix: createInkPathAffine(pathObj, pathObj?.path).matrix,
    pathOffset: { x: 0, y: 0 },
  };
};

// Map a world-space probe point into a shape's unrotated frame by rotating it
// -angle about the SAME pivot the renderer rotates the shape around. Testing
// the unrotated probe against unrotated geometry is exactly equivalent to
// testing the raw probe against the rotated shape.
const unrotatePointAbout = (point, angleDeg, pivotX, pivotY) => {
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - pivotX;
  const dy = point.y - pivotY;
  return {
    x: pivotX + dx * cos - dy * sin,
    y: pivotY + dx * sin + dy * cos,
  };
};

/**
 * Calculate the distance from a point to a line segment
 * @param {Object} point - {x, y} point to test
 * @param {Object} lineStart - {x, y} start of line segment
 * @param {Object} lineEnd - {x, y} end of line segment
 * @returns {number} Distance to the line segment
 */
export const distanceToLineSegment = (point, lineStart, lineEnd) => {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;
  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Check if a point is inside an ellipse
 * @param {Object} point - {x, y} point to test
 * @param {number} cx - Center x of ellipse
 * @param {number} cy - Center y of ellipse
 * @param {number} rx - X radius
 * @param {number} ry - Y radius
 * @returns {boolean} True if point is inside ellipse
 */
export const isPointInEllipse = (point, cx, cy, rx, ry) => {
  const dx = point.x - cx;
  const dy = point.y - cy;
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
};

// Exact Euclidean distance to an axis-aligned ellipse boundary. The previous
// average-radius normalization was only accurate for circles and could miss a
// disk touching the thin side of a highly eccentric ellipse by many pixels.
const distanceToEllipseBoundary = (point, cx, cy, rx, ry) => {
  const a = Math.abs(Number(rx) || 0);
  const b = Math.abs(Number(ry) || 0);
  const px = Math.abs(Number(point?.x) - cx);
  const py = Math.abs(Number(point?.y) - cy);

  if (![a, b, px, py].every(Number.isFinite)) return Infinity;

  // Degenerate ellipses render as a point or a line segment.
  if (a === 0 && b === 0) return Math.hypot(px, py);
  if (a === 0) return Math.hypot(px, Math.max(0, py - b));
  if (b === 0) return Math.hypot(Math.max(0, px - a), py);

  if (Math.abs(a - b) <= Number.EPSILON * Math.max(a, b) * 8) {
    return Math.abs(Math.hypot(px, py) - a);
  }

  const a2 = a * a;
  const b2 = b * b;
  const normalized = (px * px) / a2 + (py * py) / b2;
  if (Math.abs(normalized - 1) <= Number.EPSILON * 16) return 0;

  // On an axis and inside the ellipse, the closest boundary point can leave
  // that axis. Evaluate the two vertices plus that possible stationary point.
  const axisEpsilon = Number.EPSILON * Math.max(a, b, 1) * 16;
  if (normalized < 1 && (px <= axisEpsilon || py <= axisEpsilon)) {
    const candidates = [
      Math.hypot(a - px, py),
      Math.hypot(px, b - py),
    ];

    if (py <= axisEpsilon && a2 > b2) {
      const cosTheta = (a * px) / (a2 - b2);
      if (cosTheta >= 0 && cosTheta <= 1) {
        candidates.push(Math.hypot(
          a * cosTheta - px,
          b * Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta)) - py,
        ));
      }
    }
    if (px <= axisEpsilon && b2 > a2) {
      const sinTheta = (b * py) / (b2 - a2);
      if (sinTheta >= 0 && sinTheta <= 1) {
        candidates.push(Math.hypot(
          a * Math.sqrt(Math.max(0, 1 - sinTheta * sinTheta)) - px,
          b * sinTheta - py,
        ));
      }
    }
    return Math.min(...candidates);
  }

  // Lagrange multiplier for the closest point. The constraint function is
  // monotone on the applicable interval, so bisection is deterministic even
  // for extreme aspect ratios where Newton iteration is fragile.
  const constraint = (lambda) => {
    const xTerm = (a * px) / (a2 + lambda);
    const yTerm = (b * py) / (b2 + lambda);
    return xTerm * xTerm + yTerm * yTerm - 1;
  };

  let low;
  let high;
  if (normalized > 1) {
    low = 0;
    high = Math.max(a * px, b * py, a2, b2, 1);
    while (constraint(high) > 0) high *= 2;
  } else {
    const minRadiusSquared = Math.min(a2, b2);
    low = -minRadiusSquared + Math.max(minRadiusSquared * Number.EPSILON * 8, Number.MIN_VALUE);
    high = 0;
  }

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (constraint(midpoint) > 0) low = midpoint;
    else high = midpoint;
  }

  const lambda = (low + high) / 2;
  const closestX = (a2 * px) / (a2 + lambda);
  const closestY = (b2 * py) / (b2 + lambda);
  return Math.hypot(px - closestX, py - closestY);
};

// A live Fabric object's affine transform can turn a circle into a rotated,
// non-uniformly scaled ellipse. Reduce that transformed ellipse to its
// principal axes (the singular values/vectors of its two radius vectors), then
// use the same exact distance calculation in world-space pixels.
const distanceToTransformedEllipseBoundary = (point, matrix, cx, cy, rx, ry) => {
  const center = transformPointWithMatrix(matrix, { x: cx, y: cy });
  const ux = matrix[0] * rx;
  const uy = matrix[1] * rx;
  const vx = matrix[2] * ry;
  const vy = matrix[3] * ry;
  const xx = ux * ux + vx * vx;
  const xy = ux * uy + vx * vy;
  const yy = uy * uy + vy * vy;
  const discriminant = Math.hypot(xx - yy, 2 * xy);
  const majorRadiusSquared = Math.max(0, (xx + yy + discriminant) / 2);
  const determinant = ux * vy - uy * vx;
  // Deriving the small eigenvalue as determinant / large eigenvalue avoids
  // catastrophic cancellation for very thin transformed ellipses.
  const minorRadiusSquared = majorRadiusSquared > 0
    ? (determinant * determinant) / majorRadiusSquared
    : 0;
  const majorRadius = Math.sqrt(majorRadiusSquared);
  const minorRadius = Math.sqrt(minorRadiusSquared);
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return distanceToEllipseBoundary(
    { x: dx * cos + dy * sin, y: -dx * sin + dy * cos },
    0,
    0,
    majorRadius,
    minorRadius,
  );
};

/**
 * Check if a point is near the ellipse stroke (outline only)
 * @param {Object} point - {x, y} point to test
 * @param {number} cx - Center x of ellipse
 * @param {number} cy - Center y of ellipse
 * @param {number} rx - X radius
 * @param {number} ry - Y radius
 * @param {number} strokeWidth - Width of stroke
 * @param {number} tolerance - Additional tolerance
 * @returns {boolean} True if point is near ellipse stroke
 */
export const isPointNearEllipseStroke = (point, cx, cy, rx, ry, strokeWidth, tolerance = DEFAULT_TOLERANCE) => {
  const effectiveStroke = strokeWidth / 2 + tolerance;
  return effectiveStroke >= 0
    && distanceToEllipseBoundary(point, cx, cy, rx, ry) <= effectiveStroke;
};

/**
 * Check if a point is inside a polygon using ray casting
 * @param {Object} point - {x, y} point to test
 * @param {Array} vertices - Array of {x, y} vertices
 * @returns {boolean} True if point is inside polygon
 */
export const isPointInPolygon = (point, vertices) => {
  if (!vertices || vertices.length < 3) return false;

  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;

    if (((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
};

const plainPathPolygonCache = new WeakMap();

const transformPolygonSet = (polygons, affine) => (
  normalizeMultiPolygon(polygons).map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => {
      const point = affine.point(x, y);
      return [point.x, point.y];
    })
  )))
);

/**
 * Fast, exact hit test for the overwhelmingly common imported-ink case:
 * one unfilled, solid, round-capped/round-joined centerline.
 *
 * A local round stroke is the union of a parallelogram and two circles for
 * every flattened segment. An arbitrary affine maps those pieces to a
 * parallelogram and two ellipses. Testing those pieces directly is O(n) and
 * avoids Martinez-unioning thousands of capsules on the first pointer move.
 */
const pointTouchesPlainRoundStroke = (
  point,
  commands,
  affine,
  strokeWidth,
  tolerance,
  localCurveTolerance,
) => {
  const radius = strokeWidth / 2;
  const pageTolerance = Math.max(0, Number(tolerance) || 0);
  const localPoint = affine.inverse(point);

  for (const polyline of commandsToPolylines(commands, localCurveTolerance)) {
    const points = polyline.points || [];
    for (const vertex of points) {
      if (Math.hypot(localPoint.x - vertex.x, localPoint.y - vertex.y) <= radius) {
        return true;
      }
      if (
        pageTolerance > 0
        && distanceToTransformedEllipseBoundary(
          point,
          affine.matrix,
          vertex.x,
          vertex.y,
          radius,
          radius,
        ) <= pageTolerance
      ) {
        return true;
      }
    }

    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length <= Number.EPSILON) continue;
      const nx = -dy / length;
      const ny = dx / length;
      const localQuad = [
        { x: start.x + nx * radius, y: start.y + ny * radius },
        { x: end.x + nx * radius, y: end.y + ny * radius },
        { x: end.x - nx * radius, y: end.y - ny * radius },
        { x: start.x - nx * radius, y: start.y - ny * radius },
      ];
      if (isPointInPolygon(localPoint, localQuad)) return true;
      if (pageTolerance > 0) {
        const pageQuad = localQuad.map((vertex) => affine.point(vertex.x, vertex.y));
        if (
          pageQuad.some((vertex, vertexIndex) => (
            distanceToLineSegment(
              point,
              vertex,
              pageQuad[(vertexIndex + 1) % pageQuad.length],
            ) <= pageTolerance
          ))
        ) {
          return true;
        }
      }
    }
  }
  return false;
};

const getPlainPathPagePolygons = (pathObj, interactionRadius = 0) => {
  if (!pathObj || typeof pathObj !== 'object') return [];
  const radius = Math.max(0, Number(interactionRadius) || 0);
  const cacheKey = radius.toExponential(6);
  let objectCache = plainPathPolygonCache.get(pathObj);
  if (objectCache?.has(cacheKey)) return objectCache.get(cacheKey);

  const commands = normalizeOperationalInkPath(pathObj.path);
  if (!commands.length) return [];
  const affine = createInkPathAffine(pathObj, commands, {
    polygons: pathObj.polygons,
    centerline: pathObj.paperCenterline,
  });
  const rawStrokeWidth = Math.max(0, Number(pathObj.strokeWidth) || 0);
  const localSourceWidth = Math.max(
    rawStrokeWidth,
    Math.max(0, Number(pathObj.sourceWidth) || 0),
  );
  const worldSourceWidth = localSourceWidth * affine.minScale;
  const worldCurveTolerance = Math.max(
    Number.MIN_VALUE,
    Math.min(
      0.05,
      radius > 0 ? radius * 0.05 : 0.05,
      worldSourceWidth > 0 ? worldSourceWidth * 0.05 : 0.05,
    ),
  );
  const localCurveTolerance = worldCurveTolerance / (
    affine.maxScale > 0 ? affine.maxScale : 1
  );
  const persisted = normalizeMultiPolygon(pathObj.polygons);
  const hasFill = hasVisiblePaint(pathObj.fill);
  const hasStroke = rawStrokeWidth > 0 && hasVisiblePaint(pathObj.stroke);
  let fillPolygons = persisted;
  let strokePolygons = [];
  if (!fillPolygons.length && hasFill) {
    fillPolygons = filledOutlineCommandsToPolygonSet(commands, {
      curveTolerance: localCurveTolerance,
      fillRule: pathObj.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    });
  }
  // `polygons` is a fill carrier, not proof that the same path has no visible
  // stroke. Mixed PDF appearance streams need their stroke fringe too.
  if (hasStroke) {
    strokePolygons = styledStrokeCommandsToPolygonSet(commands, {
      strokeWidth: rawStrokeWidth,
      curveTolerance: localCurveTolerance,
      lineCap: String(pathObj.strokeLineCap || 'round').toLowerCase(),
      lineJoin: String(pathObj.strokeLineJoin || 'round').toLowerCase(),
      miterLimit: Math.max(1, Number(pathObj.strokeMiterLimit) || 10),
      dashArray: Array.isArray(pathObj.strokeDashArray) ? pathObj.strokeDashArray : null,
      dashOffset: Number(pathObj.strokeDashOffset) || 0,
    });
  }
  let localPolygons;
  if (fillPolygons.length && strokePolygons.length) {
    localPolygons = normalizeMultiPolygon(union(fillPolygons, strokePolygons));
  } else {
    localPolygons = fillPolygons.length ? fillPolygons : strokePolygons;
  }

  const result = transformPolygonSet(localPolygons, affine);
  if (!objectCache) {
    objectCache = new Map();
    plainPathPolygonCache.set(pathObj, objectCache);
  }
  objectCache.set(cacheKey, result);
  return result;
};

const pointTouchesPolygonSet = (point, polygons, tolerance = 0) => {
  const radius = Math.max(0, Number(tolerance) || 0);
  for (const polygon of normalizeMultiPolygon(polygons)) {
    const rings = polygon.map((ring) => ring.map(([x, y]) => ({ x, y })));
    if (rings.length > 0) {
      const inOuter = isPointInPolygon(point, rings[0]);
      const inHole = rings.slice(1).some((ring) => isPointInPolygon(point, ring));
      if (inOuter && !inHole) return true;
    }
    for (const ring of rings) {
      for (let index = 1; index < ring.length; index += 1) {
        if (distanceToLineSegment(point, ring[index - 1], ring[index]) <= radius) {
          return true;
        }
      }
    }
  }
  return false;
};

const rectIntersectsPolygonSet = (rect, polygons) => {
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  for (const corner of corners) {
    if (pointTouchesPolygonSet(corner, polygons, 0)) return true;
  }
  for (const polygon of normalizeMultiPolygon(polygons)) {
    for (const ring of polygon) {
      for (const point of ring) {
        if (
          point[0] >= rect.left
          && point[0] <= rect.right
          && point[1] >= rect.top
          && point[1] <= rect.bottom
        ) return true;
      }
      for (let index = 1; index < ring.length; index += 1) {
        if (doesRectIntersectLineSegment(
          rect,
          { x: ring[index - 1][0], y: ring[index - 1][1] },
          { x: ring[index][0], y: ring[index][1] },
          0,
        )) return true;
      }
    }
  }
  return false;
};

export const getCounterHitGeometry = (counterObj) => {
  const radius = (Number(counterObj?.radius) || 14)
    * Math.abs(Number(counterObj?.scaleX) || 1);
  const centerX = (Number(counterObj?.left) || 0) + radius;
  const centerY = (Number(counterObj?.top) || 0) + radius;
  const pointerAngle = counterObj?.data?.pointerAngle != null
    ? Number(counterObj.data.pointerAngle)
    : 225;
  return getCounterRenderGeometry(
    centerX,
    centerY,
    radius,
    Number.isFinite(pointerAngle) ? pointerAngle : 225,
  );
};

export const isPointOnCounter = (
  point,
  counterObj,
  tolerance = DEFAULT_TOLERANCE,
) => {
  if (counterObj?.data?.type !== 'counter') return false;
  const geometry = getCounterHitGeometry(counterObj);
  const effectiveTolerance = Math.max(0, Number(tolerance) || 0);
  if (
    Math.hypot(
      Number(point?.x) - geometry.center.x,
      Number(point?.y) - geometry.center.y,
    ) <= geometry.radius + effectiveTolerance
  ) return true;

  const nub = [geometry.tip, geometry.tangent1, geometry.tangent2];
  return isPointInPolygon(point, nub)
    || nub.some((vertex, index) => (
      distanceToLineSegment(point, vertex, nub[(index + 1) % nub.length])
      <= effectiveTolerance
    ));
};

/**
 * Check if a point is near a polygon edge (stroke only)
 * @param {Object} point - {x, y} point to test
 * @param {Array} vertices - Array of {x, y} vertices
 * @param {number} strokeWidth - Width of stroke
 * @param {number} tolerance - Additional tolerance
 * @returns {boolean} True if point is near any polygon edge
 */
export const isPointNearPolygonStroke = (point, vertices, strokeWidth, tolerance = DEFAULT_TOLERANCE) => {
  if (!vertices || vertices.length < 2) return false;

  const effectiveDistance = strokeWidth / 2 + tolerance;

  for (let i = 0; i < vertices.length; i++) {
    const nextI = (i + 1) % vertices.length;
    const dist = distanceToLineSegment(point, vertices[i], vertices[nextI]);
    if (dist <= effectiveDistance) {
      return true;
    }
  }
  return false;
};

/**
 * Transform a point using an inverse transformation matrix
 * @param {Object} point - {x, y} point to transform
 * @param {Array} matrix - 6-element transformation matrix [a, b, c, d, e, f]
 * @returns {Object} Transformed point
 */
export const transformPointInverse = (point, matrix) => {
  if (!matrix) return point;

  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;

  if (!Number.isFinite(det) || det === 0) return { x: NaN, y: NaN };

  const invDet = 1 / det;
  const px = point.x - e;
  const py = point.y - f;

  return {
    x: (d * px - c * py) * invDet,
    y: (-b * px + a * py) * invDet
  };
};

/**
 * Get the transformation matrix from a Fabric.js object
 * @param {Object} obj - Fabric.js object
 * @returns {Array} Transformation matrix
 */
export const getObjectTransformMatrix = (obj) => {
  try {
    if (obj.calcTransformMatrix && typeof obj.calcTransformMatrix === 'function') {
      const matrix = obj.calcTransformMatrix();
      // Fabric.js v6 returns a 6-element array [a, b, c, d, e, f]
      if (Array.isArray(matrix) && matrix.length >= 6) {
        return matrix;
      }
    }
  } catch (e) {
    // Fall through to manual calculation
  }

  // Fallback: construct matrix from properties
  const angle = (obj.angle || 0) * Math.PI / 180;
  const scaleX = obj.scaleX || 1;
  const scaleY = obj.scaleY || 1;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const left = obj.left || 0;
  const top = obj.top || 0;

  return [
    cos * scaleX,
    sin * scaleX,
    -sin * scaleY,
    cos * scaleY,
    left,
    top
  ];
};

/**
 * Check if a point intersects a Path object's actual stroke geometry
 * @param {Object} point - {x, y} point in canvas coordinates
 * @param {Object} pathObj - Fabric.js Path object
 * @param {number} tolerance - Hit tolerance in pixels
 * @returns {boolean} True if point intersects path geometry
 */
export const isPointOnPath = (point, pathObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!pathObj || hitTestType(pathObj) !== 'path' || !pathObj.path) return false;

  if (!isLiveFabricObject(pathObj)) {
    const commands = normalizeOperationalInkPath(pathObj.path);
    const rawStrokeWidth = Math.max(0, Number(pathObj.strokeWidth) || 0);
    const dashArray = Array.isArray(pathObj.strokeDashArray)
      ? pathObj.strokeDashArray.filter((value) => Number(value) > 0)
      : [];
    const isPlainRoundStroke = (
      normalizeMultiPolygon(pathObj.polygons).length === 0
      && !hasVisiblePaint(pathObj.fill)
      && rawStrokeWidth > 0
      && hasVisiblePaint(pathObj.stroke)
      && String(pathObj.strokeLineCap || 'round').toLowerCase() === 'round'
      && String(pathObj.strokeLineJoin || 'round').toLowerCase() === 'round'
      && dashArray.length === 0
    );
    if (isPlainRoundStroke && commands.length > 0) {
      const affine = createInkPathAffine(pathObj, commands);
      const worldSourceWidth = rawStrokeWidth * affine.minScale;
      const pageTolerance = Math.max(0, Number(tolerance) || 0);
      const worldCurveTolerance = Math.max(
        Number.MIN_VALUE,
        Math.min(
          0.05,
          pageTolerance > 0 ? pageTolerance * 0.05 : 0.05,
          worldSourceWidth > 0 ? worldSourceWidth * 0.05 : 0.05,
        ),
      );
      return pointTouchesPlainRoundStroke(
        point,
        commands,
        affine,
        rawStrokeWidth,
        pageTolerance,
        worldCurveTolerance / (affine.maxScale > 0 ? affine.maxScale : 1),
      );
    }
    const pagePolygons = getPlainPathPagePolygons(pathObj, tolerance);
    if (pagePolygons.length > 0) {
      return pointTouchesPolygonSet(point, pagePolygons, tolerance);
    }
  }

  const pathData = normalizeOperationalInkPath(pathObj.path);
  if (!pathData || pathData.length === 0) return false;

  const strokeWidth = pathObj.strokeWidth || 0;
  const hasStroke = strokeWidth > 0 && hasVisiblePaint(pathObj.stroke);
  const hasFill = hasVisiblePaint(pathObj.fill);
  const effectiveDistance = (strokeWidth / 2) + tolerance;

  // Get object's transform matrix and calculate inverse to transform point to local space
  const { matrix, pathOffset } = getPathTransform(pathObj);
  const localPoint = transformPointInverse(point, matrix);

  // Fabric.js paths have a pathOffset - add it back to get path data coordinates
  const pathLocalPoint = {
    x: localPoint.x + pathOffset.x,
    y: localPoint.y + pathOffset.y
  };

  // For filled paths, also collect vertices to check if point is inside
  const vertices = [];
  let currentX = 0, currentY = 0;
  let startX = 0, startY = 0;
  let minDistance = Infinity;

  for (let i = 0; i < pathData.length; i++) {
    const cmd = pathData[i];
    const command = cmd[0];

    if (command === 'M' || command === 'm') {
      const endX = command === 'M' ? cmd[1] : currentX + cmd[1];
      const endY = command === 'M' ? cmd[2] : currentY + cmd[2];
      currentX = endX;
      currentY = endY;
      startX = endX;
      startY = endY;
      if (hasFill) vertices.push({ x: endX, y: endY });
    } else if (command === 'L' || command === 'l') {
      const endX = command === 'L' ? cmd[1] : currentX + cmd[1];
      const endY = command === 'L' ? cmd[2] : currentY + cmd[2];

      {
        const dist = distanceToLineSegment(pathLocalPoint,
          { x: currentX, y: currentY },
          { x: endX, y: endY }
        );
        minDistance = Math.min(minDistance, dist);
      }

      if (hasFill) vertices.push({ x: endX, y: endY });
      currentX = endX;
      currentY = endY;
    } else if (command === 'C' || command === 'c') {
      // Cubic Bezier - approximate with line segments
      const cp1x = command === 'C' ? cmd[1] : currentX + cmd[1];
      const cp1y = command === 'C' ? cmd[2] : currentY + cmd[2];
      const cp2x = command === 'C' ? cmd[3] : currentX + cmd[3];
      const cp2y = command === 'C' ? cmd[4] : currentY + cmd[4];
      const endX = command === 'C' ? cmd[5] : currentX + cmd[5];
      const endY = command === 'C' ? cmd[6] : currentY + cmd[6];

      // Sample bezier curve at multiple points
      const samples = 10;
      let prevX = currentX, prevY = currentY;
      for (let t = 1; t <= samples; t++) {
        const tt = t / samples;
        const mt = 1 - tt;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const tt2 = tt * tt;
        const tt3 = tt2 * tt;

        const x = mt3 * currentX + 3 * mt2 * tt * cp1x + 3 * mt * tt2 * cp2x + tt3 * endX;
        const y = mt3 * currentY + 3 * mt2 * tt * cp1y + 3 * mt * tt2 * cp2y + tt3 * endY;

        {
          const dist = distanceToLineSegment(pathLocalPoint, { x: prevX, y: prevY }, { x, y });
          minDistance = Math.min(minDistance, dist);
        }

        if (hasFill) vertices.push({ x, y });
        prevX = x;
        prevY = y;
      }

      currentX = endX;
      currentY = endY;
    } else if (command === 'Q' || command === 'q') {
      // Quadratic Bezier - approximate with line segments
      const cpx = command === 'Q' ? cmd[1] : currentX + cmd[1];
      const cpy = command === 'Q' ? cmd[2] : currentY + cmd[2];
      const endX = command === 'Q' ? cmd[3] : currentX + cmd[3];
      const endY = command === 'Q' ? cmd[4] : currentY + cmd[4];

      // Sample bezier curve
      const samples = 8;
      let prevX = currentX, prevY = currentY;
      for (let t = 1; t <= samples; t++) {
        const tt = t / samples;
        const mt = 1 - tt;

        const x = mt * mt * currentX + 2 * mt * tt * cpx + tt * tt * endX;
        const y = mt * mt * currentY + 2 * mt * tt * cpy + tt * tt * endY;

        {
          const dist = distanceToLineSegment(pathLocalPoint, { x: prevX, y: prevY }, { x, y });
          minDistance = Math.min(minDistance, dist);
        }

        if (hasFill) vertices.push({ x, y });
        prevX = x;
        prevY = y;
      }

      currentX = endX;
      currentY = endY;
    } else if (command === 'Z' || command === 'z') {
      // Close path - add line back to start for stroke distance calculation
      if (currentX !== startX || currentY !== startY) {
        const dist = distanceToLineSegment(pathLocalPoint,
          { x: currentX, y: currentY },
          { x: startX, y: startY }
        );
        minDistance = Math.min(minDistance, dist);
      }
      currentX = startX;
      currentY = startY;
    }
  }

  // Check if point is on stroke
  if (hasStroke && minDistance <= effectiveDistance) {
    return true;
  }

  // Check if point is inside filled area using ray casting
  if (hasFill && vertices.length >= 3) {
    if (isPointInPolygon(pathLocalPoint, vertices)) {
      return true;
    }
  }

  // Filled paths must also count EDGE contact within tolerance. Production
  // pen/highlighter ink is stored as a filled outline (fill set, strokeWidth 0),
  // and the eraser passes its radius as `tolerance` — without this, only the
  // eraser's CENTER entering the fill registered, so rim grazes never showed
  // live while the commit engine still subtracted the full disk (the live/commit
  // disagreement the 2026-07-19 eraser audit confirmed).
  if (hasFill && minDistance <= effectiveDistance) {
    return true;
  }

  // For paths with only stroke (no fill), check stroke distance with default tolerance
  if (!hasFill && minDistance <= (tolerance + (strokeWidth > 0 ? strokeWidth / 2 : 3))) {
    return true;
  }

  return false;
};

/**
 * Check if a point intersects a Rect object's geometry
 * @param {Object} point - {x, y} point in canvas coordinates
 * @param {Object} rectObj - Fabric.js Rect object
 * @param {number} tolerance - Hit tolerance in pixels
 * @returns {boolean} True if point intersects rect geometry
 */
export const isPointOnRect = (point, rectObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!rectObj || hitTestType(rectObj) !== 'rect') return false;

  if (!isLiveFabricObject(rectObj)) {
    // Plain page-JSON: renderRect draws at translate(left, top) with effective
    // (scale-folded) dimensions and rotates about the LOCAL CENTER
    // (effW/2, effH/2) — the old fallback matrix rotated about (left, top),
    // displacing every rotated rect's hit region off the visible shape.
    const effW = Math.abs((rectObj.width || 0) * (rectObj.scaleX || 1));
    const effH = Math.abs((rectObj.height || 0) * (rectObj.scaleY || 1));
    const left = rectObj.left ?? 0;
    const top = rectObj.top ?? 0;
    const probe = rectObj.angle
      ? unrotatePointAbout(point, rectObj.angle, left + effW / 2, top + effH / 2)
      : point;
    const localPoint = { x: probe.x - left, y: probe.y - top };
    const strokeWidth = rectObj.strokeWidth || 0;
    const hasFill = hasVisiblePaint(rectObj.fill);
    const hasStroke = hasVisiblePaint(rectObj.stroke);
    if (hasFill) {
      const dx = Math.max(0, -localPoint.x, localPoint.x - effW);
      const dy = Math.max(0, -localPoint.y, localPoint.y - effH);
      if (Math.hypot(dx, dy) <= tolerance) return true;
    }
    if (hasStroke) {
      const vertices = [
        { x: 0, y: 0 },
        { x: effW, y: 0 },
        { x: effW, y: effH },
        { x: 0, y: effH },
      ];
      if (isPointNearPolygonStroke(localPoint, vertices, strokeWidth, tolerance)) {
        return true;
      }
    }
    if (!hasFill && !hasStroke) {
      return localPoint.x >= -tolerance && localPoint.x <= effW + tolerance
        && localPoint.y >= -tolerance && localPoint.y <= effH + tolerance;
    }
    return false;
  }

  const matrix = getObjectTransformMatrix(rectObj);
  const localPoint = transformPointInverse(point, matrix);

  const width = rectObj.width || 0;
  const height = rectObj.height || 0;
  const strokeWidth = rectObj.strokeWidth || 0;
  const hasFill = hasVisiblePaint(rectObj.fill);
  const hasStroke = hasVisiblePaint(rectObj.stroke);

  // Account for origin
  const originX = rectObj.originX === 'center' ? -width / 2 : 0;
  const originY = rectObj.originY === 'center' ? -height / 2 : 0;

  // Check if point is inside the filled area
  if (hasFill) {
    const dx = Math.max(0, originX - localPoint.x, localPoint.x - (originX + width));
    const dy = Math.max(0, originY - localPoint.y, localPoint.y - (originY + height));
    if (Math.hypot(dx, dy) <= tolerance) return true;
  }

  // Check if point is near the stroke
  if (hasStroke) {
    const effectiveDistance = strokeWidth / 2 + tolerance;
    const vertices = [
      { x: originX, y: originY },
      { x: originX + width, y: originY },
      { x: originX + width, y: originY + height },
      { x: originX, y: originY + height }
    ];

    if (isPointNearPolygonStroke(localPoint, vertices, strokeWidth, tolerance)) {
      return true;
    }
  }

  // If no fill and no stroke, check with tolerance
  if (!hasFill && !hasStroke) {
    const effectiveDistance = tolerance;
    if (localPoint.x >= originX - effectiveDistance && localPoint.x <= originX + width + effectiveDistance &&
      localPoint.y >= originY - effectiveDistance && localPoint.y <= originY + height + effectiveDistance) {
      return true;
    }
  }

  return false;
};

/**
 * Check if a point intersects a Circle/Ellipse object's geometry
 * @param {Object} point - {x, y} point in canvas coordinates
 * @param {Object} circleObj - Fabric.js Circle object
 * @param {number} tolerance - Hit tolerance in pixels
 * @returns {boolean} True if point intersects circle geometry
 */
export const isPointOnCircle = (point, circleObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!circleObj || (hitTestType(circleObj) !== 'circle' && hitTestType(circleObj) !== 'ellipse')) return false;

  if (!isLiveFabricObject(circleObj)) {
    // Plain page-JSON: renderEllipse draws at center (left + rx, top + ry)
    // with scale-folded radii and rotates about that center.
    let rx;
    let ry;
    if (hitTestType(circleObj) === 'ellipse') {
      rx = (circleObj.rx || 0) * Math.abs(circleObj.scaleX || 1);
      ry = (circleObj.ry || 0) * Math.abs(circleObj.scaleY || 1);
    } else {
      rx = (circleObj.radius || 0) * Math.abs(circleObj.scaleX || 1);
      ry = (circleObj.radius || 0) * Math.abs(circleObj.scaleY || 1);
    }
    const cx = (circleObj.left || 0) + rx;
    const cy = (circleObj.top || 0) + ry;
    const probe = circleObj.angle
      ? unrotatePointAbout(point, circleObj.angle, cx, cy)
      : point;
    const strokeWidth = circleObj.strokeWidth || 0;
    const hasFill = hasVisiblePaint(circleObj.fill);
    const hasStroke = hasVisiblePaint(circleObj.stroke);
    if (hasFill && (
      isPointInEllipse(probe, cx, cy, rx, ry)
      || isPointNearEllipseStroke(probe, cx, cy, rx, ry, 0, tolerance)
    )) return true;
    if (hasStroke && isPointNearEllipseStroke(probe, cx, cy, rx, ry, strokeWidth, tolerance)) {
      return true;
    }
    if (!hasFill && !hasStroke) {
      return isPointInEllipse(probe, cx, cy, rx + tolerance, ry + tolerance);
    }
    return false;
  }

  const matrix = getObjectTransformMatrix(circleObj);
  const localPoint = transformPointInverse(point, matrix);

  // For Circle, radius is the same in both directions
  // For Ellipse, use rx and ry
  let rx, ry;
  if (hitTestType(circleObj) === 'ellipse') {
    rx = circleObj.rx || 0;
    ry = circleObj.ry || 0;
  } else {
    rx = ry = circleObj.radius || 0;
  }

  const strokeWidth = circleObj.strokeWidth || 0;
  const hasFill = hasVisiblePaint(circleObj.fill);
  const hasStroke = hasVisiblePaint(circleObj.stroke);

  const cx = circleObj.originX === 'center' ? 0 : rx;
  const cy = circleObj.originY === 'center' ? 0 : ry;
  const worldBoundaryDistance = distanceToTransformedEllipseBoundary(
    point,
    matrix,
    cx,
    cy,
    rx,
    ry,
  );

  // Check if point is inside the filled area
  if (hasFill) {
    if (
      isPointInEllipse(localPoint, cx, cy, rx, ry)
      || worldBoundaryDistance <= tolerance
    ) return true;
  }

  // Check if point is near the stroke
  if (hasStroke) {
    if (isPointNearEllipseStroke(localPoint, cx, cy, rx, ry, strokeWidth, tolerance)) {
      return true;
    }
  }

  // If no fill and no stroke, check with tolerance
  if (!hasFill && !hasStroke) {
    if (isPointInEllipse(localPoint, cx, cy, rx + tolerance, ry + tolerance)) {
      return true;
    }
  }

  return false;
};

/**
 * Check if a point intersects a Line object's geometry
 * @param {Object} point - {x, y} point in canvas coordinates
 * @param {Object} lineObj - Fabric.js Line object
 * @param {number} tolerance - Hit tolerance in pixels
 * @returns {boolean} True if point intersects line geometry
 */
export const isPointOnLine = (point, lineObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!lineObj || hitTestType(lineObj) !== 'line') return false;

  const strokeWidth = lineObj.strokeWidth || 1;
  const effectiveDistance = strokeWidth / 2 + tolerance;

  if (isLiveFabricObject(lineObj)) {
    // Live fabric Line: x1..y2 are center-relative and calcTransformMatrix is
    // center-based, so inverse-transform + raw compare is self-consistent.
    const matrix = getObjectTransformMatrix(lineObj);
    const localPoint = transformPointInverse(point, matrix);
    const dist = distanceToLineSegment(
      localPoint,
      { x: lineObj.x1 || 0, y: lineObj.y1 || 0 },
      { x: lineObj.x2 || 0, y: lineObj.y2 || 0 },
    );
    return dist <= effectiveDistance;
  }

  // Plain page-JSON: x1..y2 are offsets from the BBOX CENTER (left + width/2,
  // top + height/2) — the same convention getLineEndpoints/renderLine use. The
  // old code inverse-transformed by a (left, top) matrix and compared raw
  // endpoints, displacing the hit segment by (-width/2, -height/2): "/" lines
  // were fully eraser-immune, "\" lines only responded on half their length
  // (2026-07-19 eraser audit, critical finding). Arrows are lines with
  // tool 'arrow' and shared the bug.
  const centerX = (lineObj.left ?? 0) + (lineObj.width ?? 0) / 2;
  const centerY = (lineObj.top ?? 0) + (lineObj.height ?? 0) / 2;
  const x1 = centerX + (lineObj.x1 ?? 0);
  const y1 = centerY + (lineObj.y1 ?? 0);
  const x2 = centerX + (lineObj.x2 ?? 0);
  const y2 = centerY + (lineObj.y2 ?? 0);
  const midPt = lineObj.data?.midpoint || null;
  const quadControl = midPt
    ? {
      x: 2 * midPt.x - 0.5 * x1 - 0.5 * x2,
      y: 2 * midPt.y - 0.5 * y1 - 0.5 * y2,
    }
    : null;

  let probe = point;
  const angle = lineObj.angle || 0;
  if (angle) {
    // renderLine rotates about the CURVE-INCLUSIVE bbox center: endpoints
    // plus any in-range quadratic extremum per axis. Mirror it exactly.
    const xs = [x1, x2];
    const ys = [y1, y2];
    if (quadControl) {
      const denomX = x1 - 2 * quadControl.x + x2;
      const denomY = y1 - 2 * quadControl.y + y2;
      if (Number.isFinite(denomX) && denomX !== 0) {
        const tx = (x1 - quadControl.x) / denomX;
        if (tx > 0 && tx < 1) {
          const o = 1 - tx;
          xs.push(o * o * x1 + 2 * o * tx * quadControl.x + tx * tx * x2);
        }
      }
      if (Number.isFinite(denomY) && denomY !== 0) {
        const ty = (y1 - quadControl.y) / denomY;
        if (ty > 0 && ty < 1) {
          const o = 1 - ty;
          ys.push(o * o * y1 + 2 * o * ty * quadControl.y + ty * ty * y2);
        }
      }
    }
    probe = unrotatePointAbout(
      point,
      angle,
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    );
  }

  if (quadControl) {
    // Curved line: sample the same quadratic the renderer draws.
    const SAMPLES = 24;
    let prevX = x1;
    let prevY = y1;
    for (let i = 1; i <= SAMPLES; i += 1) {
      const t = i / SAMPLES;
      const mt = 1 - t;
      const qx = mt * mt * x1 + 2 * mt * t * quadControl.x + t * t * x2;
      const qy = mt * mt * y1 + 2 * mt * t * quadControl.y + t * t * y2;
      if (distanceToLineSegment(probe, { x: prevX, y: prevY }, { x: qx, y: qy }) <= effectiveDistance) {
        return true;
      }
      prevX = qx;
      prevY = qy;
    }
    return false;
  }

  return distanceToLineSegment(probe, { x: x1, y: y1 }, { x: x2, y: y2 }) <= effectiveDistance;
};

/**
 * Check if a point intersects a Triangle object's geometry
 * @param {Object} point - {x, y} point in canvas coordinates
 * @param {Object} triangleObj - Fabric.js Triangle object
 * @param {number} tolerance - Hit tolerance in pixels
 * @returns {boolean} True if point intersects triangle geometry
 */
export const isPointOnTriangle = (point, triangleObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!triangleObj || hitTestType(triangleObj) !== 'triangle') return false;

  const matrix = getObjectTransformMatrix(triangleObj);
  const localPoint = transformPointInverse(point, matrix);

  const width = triangleObj.width || 0;
  const height = triangleObj.height || 0;
  const strokeWidth = triangleObj.strokeWidth || 0;
  const hasFill = hasVisiblePaint(triangleObj.fill);
  const hasStroke = hasVisiblePaint(triangleObj.stroke);

  // Triangle vertices (default Fabric.js triangle is isoceles, pointing up)
  const vertices = [
    { x: 0, y: -height / 2 },           // Top
    { x: -width / 2, y: height / 2 },   // Bottom left
    { x: width / 2, y: height / 2 }     // Bottom right
  ];

  // Check if point is inside the filled area
  if (hasFill) {
    if (
      isPointInPolygon(localPoint, vertices)
      || isPointNearPolygonStroke(localPoint, vertices, 0, tolerance)
    ) return true;
  }

  // Check if point is near the stroke
  if (hasStroke) {
    if (isPointNearPolygonStroke(localPoint, vertices, strokeWidth, tolerance)) {
      return true;
    }
  }

  // If no fill and no stroke, check with tolerance
  if (!hasFill && !hasStroke) {
    // Expand vertices by tolerance
    const expandedVertices = vertices.map(v => ({
      x: v.x * (1 + tolerance / Math.max(width, height)),
      y: v.y * (1 + tolerance / Math.max(width, height))
    }));
    if (isPointInPolygon(localPoint, expandedVertices)) {
      return true;
    }
  }

  return false;
};

/**
 * Check if a point intersects a Textbox object's geometry
 * @param {Object} point - {x, y} point in canvas coordinates
 * @param {Object} textObj - Fabric.js Textbox object
 * @param {number} tolerance - Hit tolerance in pixels
 * @returns {boolean} True if point intersects text geometry
 */
export const isPointOnTextbox = (point, textObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!textObj || (hitTestType(textObj) !== 'textbox' && hitTestType(textObj) !== 'text' && hitTestType(textObj) !== 'i-text')) {
    return false;
  }

  if (!isLiveFabricObject(textObj)) {
    // Plain page-JSON: renderText positions via translate(left, top) with
    // scale-folded dimensions and rotates about the local logical center.
    const effW = Math.abs((textObj.width || 0) * (textObj.scaleX || 1));
    const effH = Math.abs((textObj.height || 0) * (textObj.scaleY || 1));
    const left = textObj.left ?? 0;
    const top = textObj.top ?? 0;
    const probe = textObj.angle
      ? unrotatePointAbout(point, textObj.angle, left + effW / 2, top + effH / 2)
      : point;
    return probe.x >= left - tolerance && probe.x <= left + effW + tolerance
      && probe.y >= top - tolerance && probe.y <= top + effH + tolerance;
  }

  const matrix = getObjectTransformMatrix(textObj);
  const localPoint = transformPointInverse(point, matrix);

  const width = textObj.width || 0;
  const height = textObj.height || 0;

  // Account for origin
  const originX = textObj.originX === 'center' ? -width / 2 : 0;
  const originY = textObj.originY === 'center' ? -height / 2 : 0;

  // For text, we check the bounding area with tolerance
  // More precise per-glyph detection would require accessing text metrics
  return localPoint.x >= originX - tolerance &&
    localPoint.x <= originX + width + tolerance &&
    localPoint.y >= originY - tolerance &&
    localPoint.y <= originY + height + tolerance;
};

/**
 * Check if a point intersects a Polyline object's geometry
 * @param {Object} point - {x, y} point in canvas coordinates
 * @param {Object} polylineObj - Fabric.js Polyline object
 * @param {number} tolerance - Hit tolerance in pixels
 * @returns {boolean} True if point intersects polyline geometry
 */
export const isPointOnPolyline = (point, polylineObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!polylineObj || hitTestType(polylineObj) !== 'polyline') return false;

  const points = getTransformedPoints(polylineObj);
  if (points.length < 2) return false;

  const strokeWidth = polylineObj.strokeWidth || 1;
  const effectiveDistance = strokeWidth / 2 + tolerance;

  for (let i = 0; i < points.length - 1; i++) {
    const dist = distanceToLineSegment(point, points[i], points[i + 1]);
    if (dist <= effectiveDistance) {
      return true;
    }
  }

  return false;
};

export const isPointOnPolygon = (point, polygonObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!polygonObj || hitTestType(polygonObj) !== 'polygon') return false;

  const points = getTransformedPoints(polygonObj);
  if (points.length < 3) return false;

  const strokeWidth = polygonObj.strokeWidth || 0;
  const hasFill = hasVisiblePaint(polygonObj.fill);
  const hasStroke = hasVisiblePaint(polygonObj.stroke) && strokeWidth > 0;

  if (hasFill && (
    isPointInPolygon(point, points)
    || isPointNearPolygonStroke(point, points, 0, tolerance)
  )) return true;

  if (hasStroke && isPointNearPolygonStroke(point, points, strokeWidth, tolerance)) {
    return true;
  }

  return false;
};

/**
 * Check if a point intersects a Group object's geometry
 * @param {Object} point - {x, y} point in canvas coordinates
 * @param {Object} groupObj - Fabric.js Group object
 * @param {number} tolerance - Hit tolerance in pixels
 * @returns {boolean} True if point intersects any child geometry
 */
export const isPointOnGroup = (point, groupObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!groupObj || hitTestType(groupObj) !== 'group') return false;

  const objects = groupObj._objects || groupObj.objects || groupObj.getObjects?.() || [];
  if (objects.length === 0) {
    // Old counter fixtures/saves used an empty Fabric Group carrier while the
    // SVG layer rendered the counter directly from data.type. Match that
    // visible circle so legacy counters are not eraser-immune.
    if (groupObj?.data?.type === 'counter') {
      return isPointOnCounter(point, groupObj, tolerance);
    }
    return false;
  }

  // Get group's transform matrix
  const groupMatrix = getObjectTransformMatrix(groupObj);

  // Check each child object by combining group + child transforms.
  // This keeps point coordinates in canvas space and avoids double-inverting transforms.
  for (const child of objects) {
    const childWithGroupTransform = Object.create(Object.getPrototypeOf(child));
    Object.assign(childWithGroupTransform, child);
    childWithGroupTransform.calcTransformMatrix = function () {
      const childMatrix = getObjectTransformMatrix(child);
      return multiplyMatrices(groupMatrix, childMatrix);
    };
    if (!childWithGroupTransform.type) {
      childWithGroupTransform.type = child.type;
    }

    try {
      if (isPointOnObject(point, childWithGroupTransform, tolerance)) {
        return true;
      }
    } catch (e) {
      continue;
    }
  }

  return false;
};

/**
 * Check if a point intersects any Fabric.js object's geometry
 * This is the main entry point for point-based hit testing
 * @param {Object} point - {x, y} point in canvas coordinates
 * @param {Object} obj - Fabric.js object
 * @param {number} tolerance - Hit tolerance in pixels
 * @returns {boolean} True if point intersects object geometry
 */
/**
 * Check if a point intersects an Image (stamp) annotation. Stamps are stored
 * as plain boxes (left/top + width/height with scale); before this arm existed
 * they fell to the default branch, where plain page-JSON has neither
 * containsPoint nor getBoundingRect — the hit test unconditionally returned
 * false and stamps were 100% eraser-immune (2026-07-19 eraser audit).
 */
export const isPointOnImage = (point, imageObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!imageObj || hitTestType(imageObj) !== 'image') return false;
  const effW = Math.abs((imageObj.width || 0) * (imageObj.scaleX || 1));
  const effH = Math.abs((imageObj.height || 0) * (imageObj.scaleY || 1));
  if (effW <= 0 || effH <= 0) return false;
  const left = imageObj.left ?? 0;
  const top = imageObj.top ?? 0;
  const probe = imageObj.angle
    ? unrotatePointAbout(point, imageObj.angle, left + effW / 2, top + effH / 2)
    : point;
  return probe.x >= left - tolerance && probe.x <= left + effW + tolerance
    && probe.y >= top - tolerance && probe.y <= top + effH + tolerance;
};

export const isPointOnObject = (point, obj, tolerance = DEFAULT_TOLERANCE) => {
  if (!obj || !obj.type) return false;
  if (obj?.data?.type === 'text-markup') {
    return (obj.data.quads || []).some((quad) => {
      const xs = [quad.x1, quad.x2, quad.x3, quad.x4];
      const ys = [quad.y1, quad.y2, quad.y3, quad.y4];
      return point.x >= Math.min(...xs) - tolerance
        && point.x <= Math.max(...xs) + tolerance
        && point.y >= Math.min(...ys) - tolerance
        && point.y <= Math.max(...ys) + tolerance;
    });
  }
  if (obj?.data?.type === 'counter') {
    return isPointOnCounter(point, obj, tolerance);
  }

  switch (hitTestType(obj)) {
    case 'path':
      return isPointOnPath(point, obj, tolerance);
    case 'rect':
      return isPointOnRect(point, obj, tolerance);
    case 'circle':
    case 'ellipse':
      return isPointOnCircle(point, obj, tolerance);
    case 'line':
      return isPointOnLine(point, obj, tolerance);
    case 'image':
      return isPointOnImage(point, obj, tolerance);
    case 'triangle':
      return isPointOnTriangle(point, obj, tolerance);
    case 'textbox':
    case 'text':
    case 'i-text':
      return isPointOnTextbox(point, obj, tolerance);
    case 'polyline':
      return isPointOnPolyline(point, obj, tolerance);
    case 'polygon':
      return isPointOnPolygon(point, obj, tolerance);
    case 'group':
      return isPointOnGroup(point, obj, tolerance);
    default:
      // Fallback: use containsPoint if available
      if (obj.containsPoint && typeof obj.containsPoint === 'function') {
        try {
          return obj.containsPoint(point);
        } catch (e) {
          // Fall through to bounding box
        }
      }
      // Ultimate fallback: bounding box with tolerance
      const bounds = obj.getBoundingRect ? obj.getBoundingRect() : null;
      if (bounds) {
        return point.x >= bounds.left - tolerance &&
          point.x <= bounds.left + bounds.width + tolerance &&
          point.y >= bounds.top - tolerance &&
          point.y <= bounds.top + bounds.height + tolerance;
      }
      return false;
  }
};

// ============================================================================
// Rectangle-to-Object Intersection (for drag selection)
// ============================================================================

/**
 * Check if a selection rectangle intersects with a line segment
 * @param {Object} selRect - {left, top, right, bottom} selection rectangle
 * @param {Object} lineStart - {x, y} start of line
 * @param {Object} lineEnd - {x, y} end of line
 * @param {number} strokeWidth - Width of line stroke
 * @returns {boolean} True if selection rectangle intersects line
 */
export const doesRectIntersectLineSegment = (selRect, lineStart, lineEnd, strokeWidth = 1) => {
  const halfStroke = strokeWidth / 2;

  // Expand selection rect to account for stroke width
  const rect = {
    left: selRect.left - halfStroke,
    top: selRect.top - halfStroke,
    right: selRect.right + halfStroke,
    bottom: selRect.bottom + halfStroke
  };

  // Quick check if line bounding box intersects rect
  const lineBounds = {
    left: Math.min(lineStart.x, lineEnd.x) - halfStroke,
    top: Math.min(lineStart.y, lineEnd.y) - halfStroke,
    right: Math.max(lineStart.x, lineEnd.x) + halfStroke,
    bottom: Math.max(lineStart.y, lineEnd.y) + halfStroke
  };

  if (rect.right < lineBounds.left || rect.left > lineBounds.right ||
    rect.bottom < lineBounds.top || rect.top > lineBounds.bottom) {
    return false;
  }

  // Check if either endpoint is inside the rect
  if (lineStart.x >= rect.left && lineStart.x <= rect.right &&
    lineStart.y >= rect.top && lineStart.y <= rect.bottom) {
    return true;
  }
  if (lineEnd.x >= rect.left && lineEnd.x <= rect.right &&
    lineEnd.y >= rect.top && lineEnd.y <= rect.bottom) {
    return true;
  }

  // Check if line midpoint is inside the rect (catches cases where line is fully contained)
  const midPoint = {
    x: (lineStart.x + lineEnd.x) / 2,
    y: (lineStart.y + lineEnd.y) / 2
  };
  if (midPoint.x >= rect.left && midPoint.x <= rect.right &&
    midPoint.y >= rect.top && midPoint.y <= rect.bottom) {
    return true;
  }

  // Check if line crosses any edge of the rect
  const rectEdges = [
    [{ x: rect.left, y: rect.top }, { x: rect.right, y: rect.top }],     // Top
    [{ x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom }], // Right
    [{ x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom }], // Bottom
    [{ x: rect.left, y: rect.bottom }, { x: rect.left, y: rect.top }]    // Left
  ];

  for (const [edgeStart, edgeEnd] of rectEdges) {
    if (doLineSegmentsIntersect(lineStart, lineEnd, edgeStart, edgeEnd)) {
      return true;
    }
  }

  // Additional check: sample points along the line to catch cases where the line
  // passes through the rect but doesn't intersect edges (e.g., line fully inside)
  const lineLength = Math.sqrt(
    Math.pow(lineEnd.x - lineStart.x, 2) + Math.pow(lineEnd.y - lineStart.y, 2)
  );
  if (lineLength > 0) {
    // Increased sampling density: sample every ~5px instead of ~10px for better detection
    const numSamples = Math.max(4, Math.ceil(lineLength / 5)); // Changed from /10 to /5, min from 3 to 4
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const samplePoint = {
        x: lineStart.x + t * (lineEnd.x - lineStart.x),
        y: lineStart.y + t * (lineEnd.y - lineStart.y)
      };

      // Check if this point is inside the expanded rect
      if (samplePoint.x >= rect.left && samplePoint.x <= rect.right &&
        samplePoint.y >= rect.top && samplePoint.y <= rect.bottom) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Check if two line segments intersect
 */
const doLineSegmentsIntersect = (p1, p2, p3, p4) => {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;

  return false;
};

const direction = (p1, p2, p3) => {
  return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
};

const onSegment = (p1, p2, p) => {
  return p.x <= Math.max(p1.x, p2.x) && p.x >= Math.min(p1.x, p2.x) &&
    p.y <= Math.max(p1.y, p2.y) && p.y >= Math.min(p1.y, p2.y);
};

/**
 * Check if a selection rectangle intersects with an ellipse
 * @param {Object} selRect - {left, top, right, bottom} selection rectangle
 * @param {number} cx - Center x of ellipse
 * @param {number} cy - Center y of ellipse
 * @param {number} rx - X radius
 * @param {number} ry - Y radius
 * @param {boolean} hasFill - Whether ellipse is filled
 * @param {number} strokeWidth - Width of stroke
 * @returns {boolean} True if selection rectangle intersects ellipse
 */
export const doesRectIntersectEllipse = (selRect, cx, cy, rx, ry, hasFill, strokeWidth = 0) => {
  const halfStroke = strokeWidth / 2;
  const outerRx = rx + halfStroke;
  const outerRy = ry + halfStroke;

  // Check if rect corners are inside ellipse (for filled) or near edge (for stroke-only)
  const corners = [
    { x: selRect.left, y: selRect.top },
    { x: selRect.right, y: selRect.top },
    { x: selRect.right, y: selRect.bottom },
    { x: selRect.left, y: selRect.bottom }
  ];

  if (hasFill) {
    // Check if any corner is inside ellipse
    for (const corner of corners) {
      if (isPointInEllipse(corner, cx, cy, outerRx, outerRy)) {
        return true;
      }
    }

    // Check if all corners are inside ellipse (selection rect fully inside ellipse)
    let allCornersInside = true;
    for (const corner of corners) {
      if (!isPointInEllipse(corner, cx, cy, outerRx, outerRy)) {
        allCornersInside = false;
        break;
      }
    }
    if (allCornersInside) {
      return true;
    }
  } else if (strokeWidth > 0) {
    const innerRx = Math.max(0, rx - halfStroke);
    const innerRy = Math.max(0, ry - halfStroke);
    for (const corner of corners) {
      if (isPointInEllipse(corner, cx, cy, outerRx, outerRy) &&
        !isPointInEllipse(corner, cx, cy, innerRx, innerRy)) {
        return true;
      }
    }
  }

  // Filled ellipses are selectable by their interior. Stroke-only ellipses
  // must not select from blank center space.
  if (hasFill && cx >= selRect.left && cx <= selRect.right &&
    cy >= selRect.top && cy <= selRect.bottom) {
    return true;
  }

  // Check if rect edges intersect ellipse
  // Sample points along ellipse and check if any fall within rect
  // Increased from 32 to 64 samples for better coverage (matches path segment density)
  const samples = 64;
  for (let i = 0; i < samples; i++) {
    const angle = (2 * Math.PI * i) / samples;
    const x = cx + outerRx * Math.cos(angle);
    const y = cy + outerRy * Math.sin(angle);

    if (x >= selRect.left && x <= selRect.right &&
      y >= selRect.top && y <= selRect.bottom) {
      return true;
    }
  }

  // Check if selection rect edges intersect ellipse boundary
  // This catches cases where edges cross without corners/center being inside
  const selRectEdges = [
    [{ x: selRect.left, y: selRect.top }, { x: selRect.right, y: selRect.top }],
    [{ x: selRect.right, y: selRect.top }, { x: selRect.right, y: selRect.bottom }],
    [{ x: selRect.right, y: selRect.bottom }, { x: selRect.left, y: selRect.bottom }],
    [{ x: selRect.left, y: selRect.bottom }, { x: selRect.left, y: selRect.top }]
  ];

  // For each edge, check if it intersects the ellipse
  // Sample the edge and check distance to ellipse boundary
  for (const [edgeStart, edgeEnd] of selRectEdges) {
    const edgeLength = Math.sqrt(
      Math.pow(edgeEnd.x - edgeStart.x, 2) + Math.pow(edgeEnd.y - edgeStart.y, 2)
    );
    const samplesPerEdge = Math.max(8, Math.ceil(edgeLength / 5)); // Sample every ~5px

    for (let i = 0; i <= samplesPerEdge; i++) {
      const t = i / samplesPerEdge;
      const point = {
        x: edgeStart.x + t * (edgeEnd.x - edgeStart.x),
        y: edgeStart.y + t * (edgeEnd.y - edgeStart.y)
      };

      // Check if this point on the edge is on or inside the ellipse
      if (hasFill) {
        if (isPointInEllipse(point, cx, cy, outerRx, outerRy)) {
          return true;
        }
      } else if (strokeWidth > 0) {
        const innerRx = Math.max(0, rx - halfStroke);
        const innerRy = Math.max(0, ry - halfStroke);
        // For stroke-only, check if point is on the stroke (between inner and outer)
        const distSq = Math.pow(point.x - cx, 2) / (outerRx * outerRx) +
          Math.pow(point.y - cy, 2) / (outerRy * outerRy);
        if (distSq >= Math.pow(innerRx / outerRx, 2) && distSq <= 1) {
          return true;
        }
      }
    }
  }

  return false;
};

/**
 * Check if a selection rectangle intersects a Path object
 * @param {Object} selRect - {left, top, right, bottom} in canvas coordinates
 * @param {Object} pathObj - Fabric.js Path object
 * @returns {boolean} True if intersects
 */
export const doesRectIntersectPath = (selRect, pathObj) => {
  if (!pathObj || hitTestType(pathObj) !== 'path' || !pathObj.path) return false;

  if (!isLiveFabricObject(pathObj)) {
    const pagePolygons = getPlainPathPagePolygons(pathObj, 0.25);
    if (pagePolygons.length > 0) {
      return rectIntersectsPolygonSet(selRect, pagePolygons);
    }
  }

  const pathData = normalizeOperationalInkPath(pathObj.path);
  if (!pathData || pathData.length === 0) return false;

  const strokeWidth = pathObj.strokeWidth || 1;
  const { matrix, pathOffset } = getPathTransform(pathObj);

  // Fabric.js paths have a pathOffset that centers the path data
  // We need to subtract this offset from path coordinates before transforming
  // Transform points to canvas space using the matrix
  // Path coordinates need to be adjusted by pathOffset first
  const transformPoint = (x, y) => {
    // Subtract pathOffset to center the path at origin
    const localX = x - pathOffset.x;
    const localY = y - pathOffset.y;
    // Then apply the transform matrix
    const [a, b, c, d, e, f] = matrix;
    return {
      x: a * localX + c * localY + e,
      y: b * localX + d * localY + f
    };
  };

  let currentX = 0, currentY = 0;
  let segmentCount = 0;
  let transformedPoints = [];

  for (let i = 0; i < pathData.length; i++) {
    const cmd = pathData[i];
    const command = cmd[0];

    if (command === 'M' || command === 'm') {
      currentX = command === 'M' ? cmd[1] : currentX + cmd[1];
      currentY = command === 'M' ? cmd[2] : currentY + cmd[2];
      const tp = transformPoint(currentX, currentY);
      transformedPoints.push({ type: 'M', local: { x: currentX, y: currentY }, canvas: tp });
    } else if (command === 'L' || command === 'l') {
      const startX = currentX, startY = currentY;
      const endX = command === 'L' ? cmd[1] : currentX + cmd[1];
      const endY = command === 'L' ? cmd[2] : currentY + cmd[2];

      const start = transformPoint(startX, startY);
      const end = transformPoint(endX, endY);
      transformedPoints.push({ type: 'L', localEnd: { x: endX, y: endY }, canvasStart: start, canvasEnd: end });

      segmentCount++;
      if (doesRectIntersectLineSegment(selRect, start, end, strokeWidth)) {
        return true;
      }

      currentX = endX;
      currentY = endY;
    } else if (command === 'C' || command === 'c') {
      // Cubic Bezier - sample and check segments
      const cp1x = command === 'C' ? cmd[1] : currentX + cmd[1];
      const cp1y = command === 'C' ? cmd[2] : currentY + cmd[2];
      const cp2x = command === 'C' ? cmd[3] : currentX + cmd[3];
      const cp2y = command === 'C' ? cmd[4] : currentY + cmd[4];
      const endX = command === 'C' ? cmd[5] : currentX + cmd[5];
      const endY = command === 'C' ? cmd[6] : currentY + cmd[6];

      const samples = 8;
      let prevX = currentX, prevY = currentY;
      for (let t = 1; t <= samples; t++) {
        const tt = t / samples;
        const mt = 1 - tt;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const tt2 = tt * tt;
        const tt3 = tt2 * tt;

        const x = mt3 * currentX + 3 * mt2 * tt * cp1x + 3 * mt * tt2 * cp2x + tt3 * endX;
        const y = mt3 * currentY + 3 * mt2 * tt * cp1y + 3 * mt * tt2 * cp2y + tt3 * endY;

        const start = transformPoint(prevX, prevY);
        const end = transformPoint(x, y);

        if (doesRectIntersectLineSegment(selRect, start, end, strokeWidth)) {
          return true;
        }

        prevX = x;
        prevY = y;
      }

      currentX = endX;
      currentY = endY;
    } else if (command === 'Q' || command === 'q') {
      // Quadratic Bezier
      const cpx = command === 'Q' ? cmd[1] : currentX + cmd[1];
      const cpy = command === 'Q' ? cmd[2] : currentY + cmd[2];
      const endX = command === 'Q' ? cmd[3] : currentX + cmd[3];
      const endY = command === 'Q' ? cmd[4] : currentY + cmd[4];

      const samples = 6;
      let prevX = currentX, prevY = currentY;
      for (let t = 1; t <= samples; t++) {
        const tt = t / samples;
        const mt = 1 - tt;

        const x = mt * mt * currentX + 2 * mt * tt * cpx + tt * tt * endX;
        const y = mt * mt * currentY + 2 * mt * tt * cpy + tt * tt * endY;

        const start = transformPoint(prevX, prevY);
        const end = transformPoint(x, y);

        if (doesRectIntersectLineSegment(selRect, start, end, strokeWidth)) {
          return true;
        }

        prevX = x;
        prevY = y;
      }

      currentX = endX;
      currentY = endY;
    }
  }

  return false;
};

/**
 * Check if a selection rectangle intersects a Rect object
 */
export const doesRectIntersectRect = (selRect, rectObj) => {
  if (!rectObj || hitTestType(rectObj) !== 'rect') return false;

  if (!isLiveFabricObject(rectObj)) {
    const width = Math.abs((rectObj.width || 0) * (rectObj.scaleX || 1));
    const height = Math.abs((rectObj.height || 0) * (rectObj.scaleY || 1));
    const left = rectObj.left ?? 0;
    const top = rectObj.top ?? 0;
    const cx = left + width / 2;
    const cy = top + height / 2;
    const angle = (Number(rectObj.angle) || 0) * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotate = (point) => {
      const dx = point.x - cx;
      const dy = point.y - cy;
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    };
    const vertices = [
      { x: left, y: top }, { x: left + width, y: top },
      { x: left + width, y: top + height }, { x: left, y: top + height },
    ].map(rotate);
    if (vertices.some((point) => point.x >= selRect.left && point.x <= selRect.right
      && point.y >= selRect.top && point.y <= selRect.bottom)) return true;
    for (let index = 0; index < vertices.length; index += 1) {
      if (doesRectIntersectLineSegment(selRect, vertices[index], vertices[(index + 1) % vertices.length], 0)) return true;
    }
    const selectionCorners = [
      { x: selRect.left, y: selRect.top }, { x: selRect.right, y: selRect.top },
      { x: selRect.right, y: selRect.bottom }, { x: selRect.left, y: selRect.bottom },
    ];
    return selectionCorners.some((point) => isPointOnRect(point, rectObj, 0.001));
  }



  const matrix = getObjectTransformMatrix(rectObj);
  const width = rectObj.width || 0;
  const height = rectObj.height || 0;
  const strokeWidth = rectObj.strokeWidth || 0;
  const hasFill = hasVisiblePaint(rectObj.fill);
  const hasStroke = hasVisiblePaint(rectObj.stroke);

  // Account for origin
  const originX = rectObj.originX === 'center' ? -width / 2 : 0;
  const originY = rectObj.originY === 'center' ? -height / 2 : 0;

  // Get corner vertices in local space
  const localVertices = [
    { x: originX, y: originY },
    { x: originX + width, y: originY },
    { x: originX + width, y: originY + height },
    { x: originX, y: originY + height }
  ];

  // Transform vertices to canvas space
  const transformPoint = (p) => {
    const [a, b, c, d, e, f] = matrix;
    return {
      x: a * p.x + c * p.y + e,
      y: b * p.x + d * p.y + f
    };
  };

  const canvasVertices = localVertices.map(transformPoint);



  if (hasFill) {
    // Check if any vertex is inside selection rect
    for (const v of canvasVertices) {
      if (v.x >= selRect.left && v.x <= selRect.right &&
        v.y >= selRect.top && v.y <= selRect.bottom) {
        return true;
      }
    }

    // Check if selection rect center is inside the filled rect
    const center = { x: (selRect.left + selRect.right) / 2, y: (selRect.top + selRect.bottom) / 2 };
    if (isPointInPolygon(center, canvasVertices)) {
      return true;
    }

    // Check if selection rect is completely inside the object (all 4 corners of selRect inside object)
    const selRectCorners = [
      { x: selRect.left, y: selRect.top },
      { x: selRect.right, y: selRect.top },
      { x: selRect.right, y: selRect.bottom },
      { x: selRect.left, y: selRect.bottom }
    ];
    let allCornersInside = true;
    for (const corner of selRectCorners) {
      if (!isPointInPolygon(corner, canvasVertices)) {
        allCornersInside = false;
        break;
      }
    }
    if (allCornersInside) {
      return true;
    }

    // Check if object is completely inside selection rect (all 4 corners of object inside selRect)
    let allVerticesInside = true;
    for (const v of canvasVertices) {
      if (v.x < selRect.left || v.x > selRect.right ||
        v.y < selRect.top || v.y > selRect.bottom) {
        allVerticesInside = false;
        break;
      }
    }
    if (allVerticesInside) {
      return true;
    }

    // Check if any edge intersects
    for (let i = 0; i < canvasVertices.length; i++) {
      const next = (i + 1) % canvasVertices.length;
      if (doesRectIntersectLineSegment(selRect, canvasVertices[i], canvasVertices[next], 0)) {
        return true;
      }
    }

    // Sample points along rectangle edges to catch partial overlaps
    // This matches the approach used for paths and ellipses - more thorough detection
    for (let i = 0; i < canvasVertices.length; i++) {
      const next = (i + 1) % canvasVertices.length;
      const edgeStart = canvasVertices[i];
      const edgeEnd = canvasVertices[next];

      const edgeLength = Math.sqrt(
        Math.pow(edgeEnd.x - edgeStart.x, 2) + Math.pow(edgeEnd.y - edgeStart.y, 2)
      );

      // Sample every ~5px, minimum 4 samples per edge
      const samplesPerEdge = Math.max(4, Math.ceil(edgeLength / 5));

      for (let s = 0; s <= samplesPerEdge; s++) {
        const t = s / samplesPerEdge;
        const point = {
          x: edgeStart.x + t * (edgeEnd.x - edgeStart.x),
          y: edgeStart.y + t * (edgeEnd.y - edgeStart.y)
        };

        // Check if this point on the rectangle edge is inside the selection rect
        if (point.x >= selRect.left && point.x <= selRect.right &&
          point.y >= selRect.top && point.y <= selRect.bottom) {
          return true;
        }
      }
    }

    // Also check if selection rect edges intersect object edges (bidirectional)
    const selRectEdges = [
      [{ x: selRect.left, y: selRect.top }, { x: selRect.right, y: selRect.top }],
      [{ x: selRect.right, y: selRect.top }, { x: selRect.right, y: selRect.bottom }],
      [{ x: selRect.right, y: selRect.bottom }, { x: selRect.left, y: selRect.bottom }],
      [{ x: selRect.left, y: selRect.bottom }, { x: selRect.left, y: selRect.top }]
    ];
    for (const [selStart, selEnd] of selRectEdges) {
      for (let i = 0; i < canvasVertices.length; i++) {
        const next = (i + 1) % canvasVertices.length;
        if (doLineSegmentsIntersect(selStart, selEnd, canvasVertices[i], canvasVertices[next])) {
          return true;
        }
      }
    }
  }

  if (hasStroke && !hasFill) {
    // Stroke-only rectangle: check if selection rect intersects the stroke outline

    // Check if any vertex is inside selection rect
    for (const v of canvasVertices) {
      if (v.x >= selRect.left && v.x <= selRect.right &&
        v.y >= selRect.top && v.y <= selRect.bottom) {
        return true;
      }
    }

    // Check if selection rect center is near any stroke edge
    const center = { x: (selRect.left + selRect.right) / 2, y: (selRect.top + selRect.bottom) / 2 };
    for (let i = 0; i < canvasVertices.length; i++) {
      const next = (i + 1) % canvasVertices.length;
      const dist = distanceToLineSegment(center, canvasVertices[i], canvasVertices[next]);
      if (dist <= strokeWidth / 2) {
        return true;
      }
    }

    // Check if object stroke edges intersect selection rect (with stroke width)
    for (let i = 0; i < canvasVertices.length; i++) {
      const next = (i + 1) % canvasVertices.length;
      if (doesRectIntersectLineSegment(selRect, canvasVertices[i], canvasVertices[next], strokeWidth)) {
        return true;
      }
    }

    // Check if selection rect edges intersect object stroke edges (bidirectional)
    // Sample points along selection rect edges and check distance to object stroke edges
    const selRectEdges = [
      [{ x: selRect.left, y: selRect.top }, { x: selRect.right, y: selRect.top }],
      [{ x: selRect.right, y: selRect.top }, { x: selRect.right, y: selRect.bottom }],
      [{ x: selRect.right, y: selRect.bottom }, { x: selRect.left, y: selRect.bottom }],
      [{ x: selRect.left, y: selRect.bottom }, { x: selRect.left, y: selRect.top }]
    ];
    for (const [selStart, selEnd] of selRectEdges) {
      const edgeLength = Math.sqrt(
        Math.pow(selEnd.x - selStart.x, 2) + Math.pow(selEnd.y - selStart.y, 2)
      );
      const samples = Math.max(4, Math.ceil(edgeLength / 10)); // Sample every ~10px

      for (let s = 0; s <= samples; s++) {
        const t = s / samples;
        const point = {
          x: selStart.x + t * (selEnd.x - selStart.x),
          y: selStart.y + t * (selEnd.y - selStart.y)
        };

        // Check if this point on selection rect edge is near any object stroke edge
        for (let i = 0; i < canvasVertices.length; i++) {
          const next = (i + 1) % canvasVertices.length;
          const dist = distanceToLineSegment(point, canvasVertices[i], canvasVertices[next]);
          if (dist <= strokeWidth / 2) {
            return true;
          }
        }
      }
    }
  } else if (hasStroke) {
    // Rectangle with both fill and stroke: stroke edges should be checked
    // (fill was already checked above, but if fill check didn't match, check stroke)
    for (let i = 0; i < canvasVertices.length; i++) {
      const next = (i + 1) % canvasVertices.length;
      if (doesRectIntersectLineSegment(selRect, canvasVertices[i], canvasVertices[next], strokeWidth)) {
        return true;
      }
    }
  }

  if (!hasFill && !hasStroke) {
    // No fill and no stroke: check edges with small tolerance

    // Check if any vertex is inside selection rect
    for (const v of canvasVertices) {
      if (v.x >= selRect.left && v.x <= selRect.right &&
        v.y >= selRect.top && v.y <= selRect.bottom) {
        return true;
      }
    }

    // Check if selection rect center is inside the rect (using polygon check)
    const center = { x: (selRect.left + selRect.right) / 2, y: (selRect.top + selRect.bottom) / 2 };
    if (isPointInPolygon(center, canvasVertices)) {
      return true;
    }

    // Check edges with small tolerance
    for (let i = 0; i < canvasVertices.length; i++) {
      const next = (i + 1) % canvasVertices.length;
      if (doesRectIntersectLineSegment(selRect, canvasVertices[i], canvasVertices[next], 2)) {
        return true;
      }
    }

    // Sample points along rectangle edges to catch partial overlaps
    for (let i = 0; i < canvasVertices.length; i++) {
      const next = (i + 1) % canvasVertices.length;
      const edgeStart = canvasVertices[i];
      const edgeEnd = canvasVertices[next];

      const edgeLength = Math.sqrt(
        Math.pow(edgeEnd.x - edgeStart.x, 2) + Math.pow(edgeEnd.y - edgeStart.y, 2)
      );

      // Sample every ~5px, minimum 4 samples per edge
      const samplesPerEdge = Math.max(4, Math.ceil(edgeLength / 5));

      for (let s = 0; s <= samplesPerEdge; s++) {
        const t = s / samplesPerEdge;
        const point = {
          x: edgeStart.x + t * (edgeEnd.x - edgeStart.x),
          y: edgeStart.y + t * (edgeEnd.y - edgeStart.y)
        };

        // Check if this point on the rectangle edge is inside the selection rect
        if (point.x >= selRect.left && point.x <= selRect.right &&
          point.y >= selRect.top && point.y <= selRect.bottom) {
          return true;
        }
      }
    }

    // Check if selection rect edges intersect object edges (bidirectional)
    const selRectEdges = [
      [{ x: selRect.left, y: selRect.top }, { x: selRect.right, y: selRect.top }],
      [{ x: selRect.right, y: selRect.top }, { x: selRect.right, y: selRect.bottom }],
      [{ x: selRect.right, y: selRect.bottom }, { x: selRect.left, y: selRect.bottom }],
      [{ x: selRect.left, y: selRect.bottom }, { x: selRect.left, y: selRect.top }]
    ];
    for (const [selStart, selEnd] of selRectEdges) {
      for (let i = 0; i < canvasVertices.length; i++) {
        const next = (i + 1) % canvasVertices.length;
        if (doLineSegmentsIntersect(selStart, selEnd, canvasVertices[i], canvasVertices[next])) {
          return true;
        }
      }
    }
  }

  // Final fallback: check basic bounding box intersection if we reach here
  // This handles edge cases where the above checks might have missed an intersection
  try {
    const bounds = rectObj.getBoundingRect ? rectObj.getBoundingRect() : null;
    if (bounds) {
      // Basic bounding box intersection check
      return !(selRect.right < bounds.left || selRect.left > bounds.left + bounds.width ||
        selRect.bottom < bounds.top || selRect.top > bounds.top + bounds.height);
    }
  } catch (e) {
    // If getBoundingRect fails, fall through to false
  }

  return false;
};

/**
 * Check if a selection rectangle intersects a Circle object
 */
export const doesRectIntersectCircle = (selRect, circleObj) => {
  if (!circleObj || (hitTestType(circleObj) !== 'circle' && hitTestType(circleObj) !== 'ellipse')) return false;

  const matrix = getObjectTransformMatrix(circleObj);

  let rx, ry;
  if (hitTestType(circleObj) === 'ellipse') {
    rx = circleObj.rx || 0;
    ry = circleObj.ry || 0;
  } else {
    rx = ry = circleObj.radius || 0;
  }

  const localCenter = {
    x: circleObj.originX === 'center' ? 0 : rx,
    y: circleObj.originY === 'center' ? 0 : ry,
  };
  const center = transformPointWithMatrix(matrix, localCenter);
  const [a, b, c, d] = matrix;
  const cx = center.x;
  const cy = center.y;

  // Account for scale in the transform
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);
  const scaledRx = rx * scaleX;
  const scaledRy = ry * scaleY;

  const strokeWidth = circleObj.strokeWidth || 0;
  const hasFill = hasVisiblePaint(circleObj.fill);

  return doesRectIntersectEllipse(selRect, cx, cy, scaledRx, scaledRy, hasFill, strokeWidth);
};

export const doesRectIntersectCounter = (selRect, counterObj) => {
  if (counterObj?.data?.type !== 'counter') return false;
  const geometry = getCounterHitGeometry(counterObj);
  const closestX = Math.max(selRect.left, Math.min(geometry.center.x, selRect.right));
  const closestY = Math.max(selRect.top, Math.min(geometry.center.y, selRect.bottom));
  if (
    Math.hypot(closestX - geometry.center.x, closestY - geometry.center.y)
    <= geometry.radius
  ) return true;

  const nub = [geometry.tip, geometry.tangent1, geometry.tangent2];
  if (nub.some((point) => (
    point.x >= selRect.left
    && point.x <= selRect.right
    && point.y >= selRect.top
    && point.y <= selRect.bottom
  ))) return true;
  const corners = [
    { x: selRect.left, y: selRect.top },
    { x: selRect.right, y: selRect.top },
    { x: selRect.right, y: selRect.bottom },
    { x: selRect.left, y: selRect.bottom },
  ];
  if (corners.some((point) => isPointInPolygon(point, nub))) return true;
  return nub.some((point, index) => (
    doesRectIntersectLineSegment(
      selRect,
      point,
      nub[(index + 1) % nub.length],
      0,
    )
  ));
};

/**
 * Check if a selection rectangle intersects a Line object
 */
export const doesRectIntersectLine = (selRect, lineObj) => {
  if (!lineObj || hitTestType(lineObj) !== 'line') return false;

  const matrix = getObjectTransformMatrix(lineObj);
  const strokeWidth = lineObj.strokeWidth || 1;

  // Get line coordinates - Fabric.js Line objects store endpoints as x1, y1, x2, y2
  // These are relative to the line's origin (left, top)
  let x1 = lineObj.x1;
  let y1 = lineObj.y1;
  let x2 = lineObj.x2;
  let y2 = lineObj.y2;

  // If coordinates are not directly available, try to get them from the line's path
  // or calculate from bounding box
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    // Try to get from path if it exists (some Fabric.js versions store it there)
    if (lineObj.path && Array.isArray(lineObj.path) && lineObj.path.length >= 2) {
      const path = lineObj.path;
      if (path[0] && Array.isArray(path[0]) && path[0].length >= 3) {
        x1 = path[0][1] || 0;
        y1 = path[0][2] || 0;
      }
      if (path[1] && Array.isArray(path[1]) && path[1].length >= 3) {
        x2 = path[1][1] || 0;
        y2 = path[1][2] || 0;
      }
    }

    // Fallback: calculate from bounding box if coordinates still not available
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
      try {
        const bounds = lineObj.getBoundingRect ? lineObj.getBoundingRect() : null;
        if (bounds) {
          // For a line, we can approximate endpoints from the bounding box
          // This is a fallback - not perfect but better than nothing
          x1 = 0;
          y1 = 0;
          x2 = bounds.width || 0;
          y2 = bounds.height || 0;
        } else {
          // Ultimate fallback: use 0,0 to 0,0 (will be transformed by matrix)
          x1 = 0;
          y1 = 0;
          x2 = 0;
          y2 = 0;
        }
      } catch (e) {
        // If all else fails, use defaults
        x1 = 0;
        y1 = 0;
        x2 = 0;
        y2 = 0;
      }
    }
  }

  // Ensure we have valid numbers (0 is a valid coordinate, so check for undefined/null/NaN)
  x1 = (x1 === undefined || x1 === null || isNaN(x1)) ? 0 : x1;
  y1 = (y1 === undefined || y1 === null || isNaN(y1)) ? 0 : y1;
  x2 = (x2 === undefined || x2 === null || isNaN(x2)) ? 0 : x2;
  y2 = (y2 === undefined || y2 === null || isNaN(y2)) ? 0 : y2;

  // Transform endpoints to canvas space
  // The transform matrix already accounts for the line's position (left, top)
  const [a, b, c, d, e, f] = matrix;
  const start = {
    x: a * x1 + c * y1 + e,
    y: b * x1 + d * y1 + f
  };
  const end = {
    x: a * x2 + c * y2 + e,
    y: b * x2 + d * y2 + f
  };

  // Check intersection with the line segment
  const intersects = doesRectIntersectLineSegment(selRect, start, end, strokeWidth);

  // If the detailed check didn't find an intersection, do a fallback bounding box check
  // This ensures we catch edge cases
  if (!intersects) {
    try {
      const bounds = lineObj.getBoundingRect ? lineObj.getBoundingRect() : null;
      if (bounds) {
        // Basic bounding box intersection check
        return !(selRect.right < bounds.left || selRect.left > bounds.left + bounds.width ||
          selRect.bottom < bounds.top || selRect.top > bounds.top + bounds.height);
      }
    } catch (e) {
      // Ignore errors in fallback
    }
  }

  return intersects;
};

/**
 * Check if a selection rectangle intersects a Textbox object
 */
export const doesRectIntersectTextbox = (selRect, textObj) => {
  if (!textObj || (hitTestType(textObj) !== 'textbox' && hitTestType(textObj) !== 'text' && hitTestType(textObj) !== 'i-text')) {
    return false;
  }

  const matrix = getObjectTransformMatrix(textObj);
  const width = textObj.width || 0;
  const height = textObj.height || 0;

  // Account for origin
  const originX = textObj.originX === 'center' ? -width / 2 : 0;
  const originY = textObj.originY === 'center' ? -height / 2 : 0;

  // Get corner vertices
  const localVertices = [
    { x: originX, y: originY },
    { x: originX + width, y: originY },
    { x: originX + width, y: originY + height },
    { x: originX, y: originY + height }
  ];

  // Transform to canvas space
  const [a, b, c, d, e, f] = matrix;
  const canvasVertices = localVertices.map(p => ({
    x: a * p.x + c * p.y + e,
    y: b * p.x + d * p.y + f
  }));

  // Check if any vertex is inside selection rect
  for (const v of canvasVertices) {
    if (v.x >= selRect.left && v.x <= selRect.right &&
      v.y >= selRect.top && v.y <= selRect.bottom) {
      return true;
    }
  }

  // Check if selection rect overlaps with text bounds
  const center = { x: (selRect.left + selRect.right) / 2, y: (selRect.top + selRect.bottom) / 2 };
  if (isPointInPolygon(center, canvasVertices)) {
    return true;
  }

  // Check edge intersections
  for (let i = 0; i < canvasVertices.length; i++) {
    const next = (i + 1) % canvasVertices.length;
    if (doesRectIntersectLineSegment(selRect, canvasVertices[i], canvasVertices[next], 0)) {
      return true;
    }
  }

  // Sample points along textbox edges to catch partial overlaps
  for (let i = 0; i < canvasVertices.length; i++) {
    const next = (i + 1) % canvasVertices.length;
    const edgeStart = canvasVertices[i];
    const edgeEnd = canvasVertices[next];

    const edgeLength = Math.sqrt(
      Math.pow(edgeEnd.x - edgeStart.x, 2) + Math.pow(edgeEnd.y - edgeStart.y, 2)
    );

    // Sample every ~5px, minimum 4 samples per edge
    const samplesPerEdge = Math.max(4, Math.ceil(edgeLength / 5));

    for (let s = 0; s <= samplesPerEdge; s++) {
      const t = s / samplesPerEdge;
      const point = {
        x: edgeStart.x + t * (edgeEnd.x - edgeStart.x),
        y: edgeStart.y + t * (edgeEnd.y - edgeStart.y)
      };

      // Check if this point on the textbox edge is inside the selection rect
      if (point.x >= selRect.left && point.x <= selRect.right &&
        point.y >= selRect.top && point.y <= selRect.bottom) {
        return true;
      }
    }
  }

  return false;
};

export const doesRectIntersectPolygon = (selRect, polygonObj) => {
  if (!polygonObj || hitTestType(polygonObj) !== 'polygon') return false;
  const points = getTransformedPoints(polygonObj);
  if (points.length < 3) return false;

  const strokeWidth = polygonObj.strokeWidth || 0;
  const hasFill = hasVisiblePaint(polygonObj.fill);
  const hasStroke = hasVisiblePaint(polygonObj.stroke) && strokeWidth > 0;

  if (hasFill) {
    for (const point of points) {
      if (
        point.x >= selRect.left && point.x <= selRect.right &&
        point.y >= selRect.top && point.y <= selRect.bottom
      ) {
        return true;
      }
    }

    const rectCorners = [
      { x: selRect.left, y: selRect.top },
      { x: selRect.right, y: selRect.top },
      { x: selRect.right, y: selRect.bottom },
      { x: selRect.left, y: selRect.bottom },
    ];
    if (rectCorners.some((corner) => isPointInPolygon(corner, points))) {
      return true;
    }
  }

  if (hasStroke || hasFill) {
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      if (doesRectIntersectLineSegment(selRect, points[i], points[next], hasStroke ? strokeWidth : 0)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Check if a selection rectangle intersects a Group object
 */
export const doesRectIntersectGroup = (selRect, groupObj) => {
  if (!groupObj || hitTestType(groupObj) !== 'group') return false;

  const objects = groupObj._objects || groupObj.objects || groupObj.getObjects?.() || [];
  if (objects.length === 0) {
    if (groupObj?.data?.type === 'counter') {
      return doesRectIntersectCounter(selRect, groupObj);
    }
    return false;
  }

  // Get group's transform matrix
  const groupMatrix = getObjectTransformMatrix(groupObj);

  // For each child, combine its transform with group transform and check
  for (const child of objects) {
    // Create a wrapper that includes the group transform
    // We need to preserve all properties and methods that geometry functions might access
    const childWithGroupTransform = Object.create(Object.getPrototypeOf(child));
    
    // Copy all enumerable properties
    Object.assign(childWithGroupTransform, child);
    
    // Override calcTransformMatrix to combine group and child transforms
    childWithGroupTransform.calcTransformMatrix = function() {
      const childMatrix = getObjectTransformMatrix(child);
      // Multiply group matrix by child matrix (group transform applied first, then child)
      return multiplyMatrices(groupMatrix, childMatrix);
    };
    
    // Ensure type and other critical properties are preserved
    if (!childWithGroupTransform.type) {
      childWithGroupTransform.type = child.type;
    }

    try {
      if (doesRectIntersectObject(selRect, childWithGroupTransform)) {
        return true;
      }
    } catch (e) {
      // If geometry check fails for a child, continue to next child
      // This prevents one problematic child from breaking the entire group check
      console.warn('Error checking group child intersection:', e);
      continue;
    }
  }

  return false;
};

/**
 * Multiply two 6-element transformation matrices
 */
const multiplyMatrices = (m1, m2) => {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;

  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1
  ];
};

/**
 * Check if a selection rectangle intersects any Fabric.js object's geometry
 * This is the main entry point for rectangle-based selection
 * @param {Object} selRect - {left, top, right, bottom} in canvas coordinates
 * @param {Object} obj - Fabric.js object
 * @returns {boolean} True if selection rectangle intersects object geometry
 */
export const doesRectIntersectObject = (selRect, obj) => {
  if (!obj || !obj.type) return false;
  if (obj?.data?.type === 'counter') {
    return doesRectIntersectCounter(selRect, obj);
  }



  let result;
  switch (hitTestType(obj)) {
    case 'path':
      result = doesRectIntersectPath(selRect, obj);
      break;
    case 'rect':
      result = doesRectIntersectRect(selRect, obj);
      break;
    case 'circle':
    case 'ellipse':
      result = doesRectIntersectCircle(selRect, obj);
      break;
    case 'line':
      result = doesRectIntersectLine(selRect, obj);
      break;
    case 'textbox':
    case 'text':
    case 'i-text':
      result = doesRectIntersectTextbox(selRect, obj);
      break;
    case 'group':
      result = doesRectIntersectGroup(selRect, obj);
      break;
    case 'polyline':
      // Similar to path, check each segment
      const points = getTransformedPoints(obj);
      if (points.length < 2) {
        result = false;
        break;
      }
      const strokeWidth = obj.strokeWidth || 1;

      result = false;
      for (let i = 0; i < points.length - 1; i++) {
        if (doesRectIntersectLineSegment(selRect, points[i], points[i + 1], strokeWidth)) {
          result = true;
          break;
        }
      }
      break;
    case 'polygon':
      result = doesRectIntersectPolygon(selRect, obj);
      break;
    case 'triangle':
      // Get triangle vertices and check
      const triMatrix = getObjectTransformMatrix(obj);
      const triWidth = obj.width || 0;
      const triHeight = obj.height || 0;
      const triVertices = [
        { x: 0, y: -triHeight / 2 },
        { x: -triWidth / 2, y: triHeight / 2 },
        { x: triWidth / 2, y: triHeight / 2 }
      ];
      const [ta, tb, tc, td, te, tf] = triMatrix;
      const canvasTriVertices = triVertices.map(p => ({
        x: ta * p.x + tc * p.y + te,
        y: tb * p.x + td * p.y + tf
      }));

      const triHasFill = hasVisiblePaint(obj.fill);
      const triStrokeWidth = obj.strokeWidth || 0;

      // Check vertices inside selection
      for (const v of canvasTriVertices) {
        if (v.x >= selRect.left && v.x <= selRect.right &&
          v.y >= selRect.top && v.y <= selRect.bottom) {
          return true;
        }
      }

      // Check if selection center is inside triangle
      if (triHasFill) {
        const center = { x: (selRect.left + selRect.right) / 2, y: (selRect.top + selRect.bottom) / 2 };
        if (isPointInPolygon(center, canvasTriVertices)) {
          return true;
        }
      }

      // Check edge intersections
      for (let i = 0; i < canvasTriVertices.length; i++) {
        const next = (i + 1) % canvasTriVertices.length;
        if (doesRectIntersectLineSegment(selRect, canvasTriVertices[i], canvasTriVertices[next], triStrokeWidth)) {
          return true;
        }
      }

      // Sample points along triangle edges to catch partial overlaps
      for (let i = 0; i < canvasTriVertices.length; i++) {
        const next = (i + 1) % canvasTriVertices.length;
        const edgeStart = canvasTriVertices[i];
        const edgeEnd = canvasTriVertices[next];

        const edgeLength = Math.sqrt(
          Math.pow(edgeEnd.x - edgeStart.x, 2) + Math.pow(edgeEnd.y - edgeStart.y, 2)
        );

        // Sample every ~5px, minimum 4 samples per edge
        const samplesPerEdge = Math.max(4, Math.ceil(edgeLength / 5));

        for (let s = 0; s <= samplesPerEdge; s++) {
          const t = s / samplesPerEdge;
          const point = {
            x: edgeStart.x + t * (edgeEnd.x - edgeStart.x),
            y: edgeStart.y + t * (edgeEnd.y - edgeStart.y)
          };

          // Check if this point on the triangle edge is inside the selection rect
          if (point.x >= selRect.left && point.x <= selRect.right &&
            point.y >= selRect.top && point.y <= selRect.bottom) {
            result = true;
            break;
          }
        }
        if (result) break;
      }
      break;
    default:
      // Fallback: use bounding box
      const bounds = obj.getBoundingRect ? obj.getBoundingRect() : null;
      if (bounds) {
        result = !(selRect.right < bounds.left || selRect.left > bounds.left + bounds.width ||
          selRect.bottom < bounds.top || selRect.top > bounds.top + bounds.height);
      } else {
        result = false;
      }
      break;
  }

  return result;
};

/**
 * Check if object geometry is fully contained within selection rectangle
 * Used for Window Selection (L→R drag)
 * @param {Object} selRect - {left, top, right, bottom} in canvas coordinates
 * @param {Object} obj - Fabric.js object
 * @returns {boolean} True if object geometry is fully inside selection rectangle
 */
export const isObjectFullyInRect = (selRect, obj) => {
  if (!obj || !obj.type) return false;

  // Get the object's actual geometry bounds
  const bounds = getObjectGeometryBounds(obj);
  if (!bounds) return false;

  // Check if all bounds are within selection rect
  return bounds.left >= selRect.left &&
    bounds.right <= selRect.right &&
    bounds.top >= selRect.top &&
    bounds.bottom <= selRect.bottom;
};

/**
 * Get the actual geometry bounds of an object (not bounding box)
 * For paths, this traces the actual stroke. For shapes, uses transformed vertices.
 * @param {Object} obj - Fabric.js object
 * @returns {Object|null} {left, top, right, bottom} or null
 */
export const getObjectGeometryBounds = (obj) => {
  if (!obj || !obj.type) return null;

  // Helper to get fallback bounds from Fabric.js
  const getFallbackBounds = () => {
    try {
      const bounds = obj.getBoundingRect ? obj.getBoundingRect() : null;
      if (bounds) {
        return {
          left: bounds.left,
          top: bounds.top,
          right: bounds.left + bounds.width,
          bottom: bounds.top + bounds.height
        };
      }
    } catch (e) {
      // Ignore
    }
    return null;
  };

  try {
    const matrix = getObjectTransformMatrix(obj);
    if (!matrix || matrix.length < 6) {
      return getFallbackBounds();
    }

    const [a, b, c, d, e, f] = matrix;

    const transformPoint = (x, y) => ({
      x: a * x + c * y + e,
      y: b * x + d * y + f
    });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const updateBounds = (x, y) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };

    switch (hitTestType(obj)) {
      case 'path': {
        if (!obj.path) return null;
        const strokeWidth = (obj.strokeWidth || 1) / 2;
        let currentX = 0, currentY = 0;

        for (const cmd of obj.path) {
          const command = cmd[0];
          if (command === 'M' || command === 'm') {
            currentX = command === 'M' ? cmd[1] : currentX + cmd[1];
            currentY = command === 'M' ? cmd[2] : currentY + cmd[2];
            const p = transformPoint(currentX, currentY);
            updateBounds(p.x - strokeWidth, p.y - strokeWidth);
            updateBounds(p.x + strokeWidth, p.y + strokeWidth);
          } else if (command === 'L' || command === 'l') {
            currentX = command === 'L' ? cmd[1] : currentX + cmd[1];
            currentY = command === 'L' ? cmd[2] : currentY + cmd[2];
            const p = transformPoint(currentX, currentY);
            updateBounds(p.x - strokeWidth, p.y - strokeWidth);
            updateBounds(p.x + strokeWidth, p.y + strokeWidth);
          } else if (command === 'C' || command === 'c') {
            // Sample bezier curve
            const cp1x = command === 'C' ? cmd[1] : currentX + cmd[1];
            const cp1y = command === 'C' ? cmd[2] : currentY + cmd[2];
            const cp2x = command === 'C' ? cmd[3] : currentX + cmd[3];
            const cp2y = command === 'C' ? cmd[4] : currentY + cmd[4];
            const endX = command === 'C' ? cmd[5] : currentX + cmd[5];
            const endY = command === 'C' ? cmd[6] : currentY + cmd[6];

            for (let t = 0; t <= 1; t += 0.1) {
              const mt = 1 - t;
              const x = mt * mt * mt * currentX + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * endX;
              const y = mt * mt * mt * currentY + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * endY;
              const p = transformPoint(x, y);
              updateBounds(p.x - strokeWidth, p.y - strokeWidth);
              updateBounds(p.x + strokeWidth, p.y + strokeWidth);
            }
            currentX = endX;
            currentY = endY;
          } else if (command === 'Q' || command === 'q') {
            const cpx = command === 'Q' ? cmd[1] : currentX + cmd[1];
            const cpy = command === 'Q' ? cmd[2] : currentY + cmd[2];
            const endX = command === 'Q' ? cmd[3] : currentX + cmd[3];
            const endY = command === 'Q' ? cmd[4] : currentY + cmd[4];

            for (let t = 0; t <= 1; t += 0.1) {
              const mt = 1 - t;
              const x = mt * mt * currentX + 2 * mt * t * cpx + t * t * endX;
              const y = mt * mt * currentY + 2 * mt * t * cpy + t * t * endY;
              const p = transformPoint(x, y);
              updateBounds(p.x - strokeWidth, p.y - strokeWidth);
              updateBounds(p.x + strokeWidth, p.y + strokeWidth);
            }
            currentX = endX;
            currentY = endY;
          }
        }
        break;
      }
      case 'rect': {
        const width = obj.width || 0;
        const height = obj.height || 0;
        const strokeWidth = (obj.strokeWidth || 0) / 2;
        const originX = obj.originX === 'center' ? -width / 2 : 0;
        const originY = obj.originY === 'center' ? -height / 2 : 0;

        const vertices = [
          transformPoint(originX - strokeWidth, originY - strokeWidth),
          transformPoint(originX + width + strokeWidth, originY - strokeWidth),
          transformPoint(originX + width + strokeWidth, originY + height + strokeWidth),
          transformPoint(originX - strokeWidth, originY + height + strokeWidth)
        ];
        vertices.forEach(v => updateBounds(v.x, v.y));
        break;
      }
      case 'circle':
      case 'ellipse': {
        let rx, ry;
        if (hitTestType(obj) === 'ellipse') {
          rx = obj.rx || 0;
          ry = obj.ry || 0;
        } else {
          rx = ry = obj.radius || 0;
        }
        const strokeWidth = (obj.strokeWidth || 0) / 2;
        const cx = obj.originX === 'center' ? 0 : rx;
        const cy = obj.originY === 'center' ? 0 : ry;

        // Sample ellipse boundary
        for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 16) {
          const x = cx + (rx + strokeWidth) * Math.cos(angle);
          const y = cy + (ry + strokeWidth) * Math.sin(angle);
          const p = transformPoint(x, y);
          updateBounds(p.x, p.y);
        }
        break;
      }
      case 'line': {
        const x1 = obj.x1 || 0;
        const y1 = obj.y1 || 0;
        const x2 = obj.x2 || 0;
        const y2 = obj.y2 || 0;
        const strokeWidth = (obj.strokeWidth || 1) / 2;

        const p1 = transformPoint(x1, y1);
        const p2 = transformPoint(x2, y2);
        updateBounds(p1.x - strokeWidth, p1.y - strokeWidth);
        updateBounds(p1.x + strokeWidth, p1.y + strokeWidth);
        updateBounds(p2.x - strokeWidth, p2.y - strokeWidth);
        updateBounds(p2.x + strokeWidth, p2.y + strokeWidth);
        break;
      }
      case 'polyline':
      case 'polygon': {
        const points = getTransformedPoints(obj);
        if (points.length === 0) return null;
        const strokePad = hasVisiblePaint(obj.stroke) ? (obj.strokeWidth || 1) / 2 : 0;
        for (const point of points) {
          updateBounds(point.x - strokePad, point.y - strokePad);
          updateBounds(point.x + strokePad, point.y + strokePad);
        }
        break;
      }
      case 'textbox':
      case 'text':
      case 'i-text': {
        const width = obj.width || 0;
        const height = obj.height || 0;
        const originX = obj.originX === 'center' ? -width / 2 : 0;
        const originY = obj.originY === 'center' ? -height / 2 : 0;

        const vertices = [
          transformPoint(originX, originY),
          transformPoint(originX + width, originY),
          transformPoint(originX + width, originY + height),
          transformPoint(originX, originY + height)
        ];
        vertices.forEach(v => updateBounds(v.x, v.y));
        break;
      }
      case 'group': {
        const objects = obj._objects || obj.objects || obj.getObjects?.() || [];
        for (const child of objects) {
          const childBounds = getObjectGeometryBounds(child);
          if (childBounds) {
            // Transform child bounds through group matrix
            const corners = [
              transformPoint(childBounds.left, childBounds.top),
              transformPoint(childBounds.right, childBounds.top),
              transformPoint(childBounds.right, childBounds.bottom),
              transformPoint(childBounds.left, childBounds.bottom)
            ];
            corners.forEach(c => updateBounds(c.x, c.y));
          }
        }
        break;
      }
      default:
        return getFallbackBounds();
    }

    if (minX === Infinity) return getFallbackBounds();

    return { left: minX, top: minY, right: maxX, bottom: maxY };
  } catch (e) {
    // If geometry calculation fails, fall back to bounding box
    return getFallbackBounds();
  }
};
