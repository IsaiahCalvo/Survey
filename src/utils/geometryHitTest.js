/**
 * Geometry-based hit testing for Fabric.js objects
 *
 * This module provides precise hit testing based on actual rendered geometry
 * rather than bounding boxes. It handles all annotation types and accounts
 * for transformations (rotation, scaling, translation).
 */

// Default tolerance for hit testing (in pixels)
const DEFAULT_TOLERANCE = 3;

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
  const dx = point.x - cx;
  const dy = point.y - cy;
  const normalizedDist = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);

  // Calculate how far the point is from being on the ellipse (1.0 = exactly on edge)
  const effectiveStroke = strokeWidth / 2 + tolerance;

  // For an ellipse, we need to estimate tolerance in normalized space
  // Use average radius for approximation
  const avgRadius = (rx + ry) / 2;
  const normalizedTolerance = effectiveStroke / avgRadius;

  // Point is near stroke if normalized distance is close to 1
  return normalizedDist >= Math.pow(1 - normalizedTolerance, 2) &&
         normalizedDist <= Math.pow(1 + normalizedTolerance, 2);
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

  if (Math.abs(det) < 1e-10) return point;

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
  if (!pathObj || pathObj.type !== 'path' || !pathObj.path) return false;

  const pathData = pathObj.path;
  if (!pathData || pathData.length === 0) return false;

  const strokeWidth = pathObj.strokeWidth || 0;
  const hasStroke = strokeWidth > 0 && pathObj.stroke && pathObj.stroke !== 'transparent';
  const hasFill = pathObj.fill && pathObj.fill !== 'transparent' && pathObj.fill !== null;
  const effectiveDistance = (strokeWidth / 2) + tolerance;

  // Get object's transform matrix and calculate inverse to transform point to local space
  const matrix = getObjectTransformMatrix(pathObj);
  const localPoint = transformPointInverse(point, matrix);

  // Fabric.js paths have a pathOffset - add it back to get path data coordinates
  const pathOffset = pathObj.pathOffset || { x: 0, y: 0 };
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

      if (hasStroke || !hasFill) {
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

        if (hasStroke || !hasFill) {
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

        if (hasStroke || !hasFill) {
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
      if ((hasStroke || !hasFill) && (currentX !== startX || currentY !== startY)) {
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
  if (!rectObj || rectObj.type !== 'rect') return false;

  const matrix = getObjectTransformMatrix(rectObj);
  const localPoint = transformPointInverse(point, matrix);

  const width = rectObj.width || 0;
  const height = rectObj.height || 0;
  const strokeWidth = rectObj.strokeWidth || 0;
  const hasFill = rectObj.fill && rectObj.fill !== 'transparent' && rectObj.fill !== '';
  const hasStroke = rectObj.stroke && rectObj.stroke !== 'transparent' && rectObj.stroke !== '';

  // Account for origin
  const originX = rectObj.originX === 'center' ? -width / 2 : 0;
  const originY = rectObj.originY === 'center' ? -height / 2 : 0;

  // Check if point is inside the filled area
  if (hasFill) {
    if (localPoint.x >= originX && localPoint.x <= originX + width &&
        localPoint.y >= originY && localPoint.y <= originY + height) {
      return true;
    }
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
  if (!circleObj || (circleObj.type !== 'circle' && circleObj.type !== 'ellipse')) return false;

  const matrix = getObjectTransformMatrix(circleObj);
  const localPoint = transformPointInverse(point, matrix);

  // For Circle, radius is the same in both directions
  // For Ellipse, use rx and ry
  let rx, ry;
  if (circleObj.type === 'ellipse') {
    rx = circleObj.rx || 0;
    ry = circleObj.ry || 0;
  } else {
    rx = ry = circleObj.radius || 0;
  }

  const strokeWidth = circleObj.strokeWidth || 0;
  const hasFill = circleObj.fill && circleObj.fill !== 'transparent' && circleObj.fill !== '';
  const hasStroke = circleObj.stroke && circleObj.stroke !== 'transparent' && circleObj.stroke !== '';

  // Circle center is at origin in local space (Fabric.js uses center origin by default for circles)
  const cx = 0;
  const cy = 0;

  // Check if point is inside the filled area
  if (hasFill) {
    if (isPointInEllipse(localPoint, cx, cy, rx, ry)) {
      return true;
    }
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
  if (!lineObj || lineObj.type !== 'line') return false;

  const matrix = getObjectTransformMatrix(lineObj);
  const localPoint = transformPointInverse(point, matrix);

  // Line coordinates are relative to object origin
  const x1 = lineObj.x1 || 0;
  const y1 = lineObj.y1 || 0;
  const x2 = lineObj.x2 || 0;
  const y2 = lineObj.y2 || 0;

  const strokeWidth = lineObj.strokeWidth || 1;
  const effectiveDistance = strokeWidth / 2 + tolerance;

  const dist = distanceToLineSegment(localPoint, { x: x1, y: y1 }, { x: x2, y: y2 });
  return dist <= effectiveDistance;
};

/**
 * Check if a point intersects a Triangle object's geometry
 * @param {Object} point - {x, y} point in canvas coordinates
 * @param {Object} triangleObj - Fabric.js Triangle object
 * @param {number} tolerance - Hit tolerance in pixels
 * @returns {boolean} True if point intersects triangle geometry
 */
export const isPointOnTriangle = (point, triangleObj, tolerance = DEFAULT_TOLERANCE) => {
  if (!triangleObj || triangleObj.type !== 'triangle') return false;

  const matrix = getObjectTransformMatrix(triangleObj);
  const localPoint = transformPointInverse(point, matrix);

  const width = triangleObj.width || 0;
  const height = triangleObj.height || 0;
  const strokeWidth = triangleObj.strokeWidth || 0;
  const hasFill = triangleObj.fill && triangleObj.fill !== 'transparent' && triangleObj.fill !== '';
  const hasStroke = triangleObj.stroke && triangleObj.stroke !== 'transparent' && triangleObj.stroke !== '';

  // Triangle vertices (default Fabric.js triangle is isoceles, pointing up)
  const vertices = [
    { x: 0, y: -height / 2 },           // Top
    { x: -width / 2, y: height / 2 },   // Bottom left
    { x: width / 2, y: height / 2 }     // Bottom right
  ];

  // Check if point is inside the filled area
  if (hasFill) {
    if (isPointInPolygon(localPoint, vertices)) {
      return true;
    }
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
  if (!textObj || (textObj.type !== 'textbox' && textObj.type !== 'text' && textObj.type !== 'i-text')) {
    return false;
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
  if (!polylineObj || polylineObj.type !== 'polyline') return false;

  const points = polylineObj.points || [];
  if (points.length < 2) return false;

  const matrix = getObjectTransformMatrix(polylineObj);
  const localPoint = transformPointInverse(point, matrix);

  const strokeWidth = polylineObj.strokeWidth || 1;
  const effectiveDistance = strokeWidth / 2 + tolerance;

  for (let i = 0; i < points.length - 1; i++) {
    const dist = distanceToLineSegment(localPoint, points[i], points[i + 1]);
    if (dist <= effectiveDistance) {
      return true;
    }
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
  if (!groupObj || groupObj.type !== 'group') return false;

  // Get group's transform matrix
  const groupMatrix = getObjectTransformMatrix(groupObj);

  // Transform point to group's local coordinate space
  const localPoint = transformPointInverse(point, groupMatrix);

  // Check each child object
  const objects = groupObj._objects || groupObj.getObjects?.() || [];
  for (const child of objects) {
    if (isPointOnObject(localPoint, child, tolerance)) {
      return true;
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
export const isPointOnObject = (point, obj, tolerance = DEFAULT_TOLERANCE) => {
  if (!obj || !obj.type) return false;

  switch (obj.type) {
    case 'path':
      return isPointOnPath(point, obj, tolerance);
    case 'rect':
      return isPointOnRect(point, obj, tolerance);
    case 'circle':
    case 'ellipse':
      return isPointOnCircle(point, obj, tolerance);
    case 'line':
      return isPointOnLine(point, obj, tolerance);
    case 'triangle':
      return isPointOnTriangle(point, obj, tolerance);
    case 'textbox':
    case 'text':
    case 'i-text':
      return isPointOnTextbox(point, obj, tolerance);
    case 'polyline':
      return isPointOnPolyline(point, obj, tolerance);
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

  for (const corner of corners) {
    if (hasFill) {
      if (isPointInEllipse(corner, cx, cy, outerRx, outerRy)) {
        return true;
      }
    } else if (strokeWidth > 0) {
      const innerRx = Math.max(0, rx - halfStroke);
      const innerRy = Math.max(0, ry - halfStroke);
      if (isPointInEllipse(corner, cx, cy, outerRx, outerRy) &&
          !isPointInEllipse(corner, cx, cy, innerRx, innerRy)) {
        return true;
      }
    }
  }

  // Check if ellipse center is inside rect
  if (cx >= selRect.left && cx <= selRect.right &&
      cy >= selRect.top && cy <= selRect.bottom) {
    return true;
  }

  // Check if rect edges intersect ellipse
  // Sample points along ellipse and check if any fall within rect
  const samples = 32;
  for (let i = 0; i < samples; i++) {
    const angle = (2 * Math.PI * i) / samples;
    const x = cx + outerRx * Math.cos(angle);
    const y = cy + outerRy * Math.sin(angle);

    if (x >= selRect.left && x <= selRect.right &&
        y >= selRect.top && y <= selRect.bottom) {
      return true;
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
  if (!pathObj || pathObj.type !== 'path' || !pathObj.path) return false;

  const pathData = pathObj.path;
  if (!pathData || pathData.length === 0) return false;

  const strokeWidth = pathObj.strokeWidth || 1;
  const matrix = getObjectTransformMatrix(pathObj);

  // Fabric.js paths have a pathOffset that centers the path data
  // We need to subtract this offset from path coordinates before transforming
  const pathOffset = pathObj.pathOffset || { x: 0, y: 0 };


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
      transformedPoints.push({ type: 'M', local: {x: currentX, y: currentY}, canvas: tp });
    } else if (command === 'L' || command === 'l') {
      const startX = currentX, startY = currentY;
      const endX = command === 'L' ? cmd[1] : currentX + cmd[1];
      const endY = command === 'L' ? cmd[2] : currentY + cmd[2];

      const start = transformPoint(startX, startY);
      const end = transformPoint(endX, endY);
      transformedPoints.push({ type: 'L', localEnd: {x: endX, y: endY}, canvasStart: start, canvasEnd: end });

      segmentCount++;
      if (doesRectIntersectLineSegment(selRect, start, end, strokeWidth)) {
        console.log('[GEO DEBUG] Found intersecting segment:', { start, end, selRect });
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
  if (!rectObj || rectObj.type !== 'rect') return false;

  const matrix = getObjectTransformMatrix(rectObj);
  const width = rectObj.width || 0;
  const height = rectObj.height || 0;
  const strokeWidth = rectObj.strokeWidth || 0;
  const hasFill = rectObj.fill && rectObj.fill !== 'transparent' && rectObj.fill !== '';
  const hasStroke = rectObj.stroke && rectObj.stroke !== 'transparent' && rectObj.stroke !== '';

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

    // Check if any edge intersects
    for (let i = 0; i < canvasVertices.length; i++) {
      const next = (i + 1) % canvasVertices.length;
      if (doesRectIntersectLineSegment(selRect, canvasVertices[i], canvasVertices[next], 0)) {
        return true;
      }
    }
  }

  if (hasStroke) {
    // Check edges with stroke width
    for (let i = 0; i < canvasVertices.length; i++) {
      const next = (i + 1) % canvasVertices.length;
      if (doesRectIntersectLineSegment(selRect, canvasVertices[i], canvasVertices[next], strokeWidth)) {
        return true;
      }
    }
  }

  if (!hasFill && !hasStroke) {
    // Check with small tolerance
    for (let i = 0; i < canvasVertices.length; i++) {
      const next = (i + 1) % canvasVertices.length;
      if (doesRectIntersectLineSegment(selRect, canvasVertices[i], canvasVertices[next], 2)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Check if a selection rectangle intersects a Circle object
 */
export const doesRectIntersectCircle = (selRect, circleObj) => {
  if (!circleObj || (circleObj.type !== 'circle' && circleObj.type !== 'ellipse')) return false;

  const matrix = getObjectTransformMatrix(circleObj);

  let rx, ry;
  if (circleObj.type === 'ellipse') {
    rx = circleObj.rx || 0;
    ry = circleObj.ry || 0;
  } else {
    rx = ry = circleObj.radius || 0;
  }

  // Transform center to canvas space
  const [a, b, c, d, e, f] = matrix;
  const cx = e;
  const cy = f;

  // Account for scale in the transform
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);
  const scaledRx = rx * scaleX;
  const scaledRy = ry * scaleY;

  const strokeWidth = circleObj.strokeWidth || 0;
  const hasFill = circleObj.fill && circleObj.fill !== 'transparent' && circleObj.fill !== '';

  return doesRectIntersectEllipse(selRect, cx, cy, scaledRx, scaledRy, hasFill, strokeWidth);
};

/**
 * Check if a selection rectangle intersects a Line object
 */
export const doesRectIntersectLine = (selRect, lineObj) => {
  if (!lineObj || lineObj.type !== 'line') return false;

  const matrix = getObjectTransformMatrix(lineObj);
  const x1 = lineObj.x1 || 0;
  const y1 = lineObj.y1 || 0;
  const x2 = lineObj.x2 || 0;
  const y2 = lineObj.y2 || 0;
  const strokeWidth = lineObj.strokeWidth || 1;

  // Transform endpoints to canvas space
  const [a, b, c, d, e, f] = matrix;
  const start = {
    x: a * x1 + c * y1 + e,
    y: b * x1 + d * y1 + f
  };
  const end = {
    x: a * x2 + c * y2 + e,
    y: b * x2 + d * y2 + f
  };

  return doesRectIntersectLineSegment(selRect, start, end, strokeWidth);
};

/**
 * Check if a selection rectangle intersects a Textbox object
 */
export const doesRectIntersectTextbox = (selRect, textObj) => {
  if (!textObj || (textObj.type !== 'textbox' && textObj.type !== 'text' && textObj.type !== 'i-text')) {
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

  return false;
};

/**
 * Check if a selection rectangle intersects a Group object
 */
export const doesRectIntersectGroup = (selRect, groupObj) => {
  if (!groupObj || groupObj.type !== 'group') return false;

  const objects = groupObj._objects || groupObj.getObjects?.() || [];

  // Get group's transform matrix
  const groupMatrix = getObjectTransformMatrix(groupObj);

  // For each child, combine its transform with group transform and check
  for (const child of objects) {
    // Create a wrapper that includes the group transform
    const childWithGroupTransform = {
      ...child,
      calcTransformMatrix: () => {
        const childMatrix = getObjectTransformMatrix(child);
        // Multiply group matrix by child matrix
        return multiplyMatrices(groupMatrix, childMatrix);
      }
    };

    if (doesRectIntersectObject(selRect, childWithGroupTransform)) {
      return true;
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

  switch (obj.type) {
    case 'path':
      return doesRectIntersectPath(selRect, obj);
    case 'rect':
      return doesRectIntersectRect(selRect, obj);
    case 'circle':
    case 'ellipse':
      return doesRectIntersectCircle(selRect, obj);
    case 'line':
      return doesRectIntersectLine(selRect, obj);
    case 'textbox':
    case 'text':
    case 'i-text':
      return doesRectIntersectTextbox(selRect, obj);
    case 'group':
      return doesRectIntersectGroup(selRect, obj);
    case 'polyline':
      // Similar to path, check each segment
      const points = obj.points || [];
      if (points.length < 2) return false;
      const matrix = getObjectTransformMatrix(obj);
      const [a, b, c, d, e, f] = matrix;
      const strokeWidth = obj.strokeWidth || 1;

      for (let i = 0; i < points.length - 1; i++) {
        const start = {
          x: a * points[i].x + c * points[i].y + e,
          y: b * points[i].x + d * points[i].y + f
        };
        const end = {
          x: a * points[i + 1].x + c * points[i + 1].y + e,
          y: b * points[i + 1].x + d * points[i + 1].y + f
        };
        if (doesRectIntersectLineSegment(selRect, start, end, strokeWidth)) {
          return true;
        }
      }
      return false;
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

      const triHasFill = obj.fill && obj.fill !== 'transparent' && obj.fill !== '';
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
      return false;
    default:
      // Fallback: use bounding box
      const bounds = obj.getBoundingRect ? obj.getBoundingRect() : null;
      if (bounds) {
        return !(selRect.right < bounds.left || selRect.left > bounds.left + bounds.width ||
                 selRect.bottom < bounds.top || selRect.top > bounds.top + bounds.height);
      }
      return false;
  }
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

  switch (obj.type) {
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
      if (obj.type === 'ellipse') {
        rx = obj.rx || 0;
        ry = obj.ry || 0;
      } else {
        rx = ry = obj.radius || 0;
      }
      const strokeWidth = (obj.strokeWidth || 0) / 2;

      // Sample ellipse boundary
      for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 16) {
        const x = (rx + strokeWidth) * Math.cos(angle);
        const y = (ry + strokeWidth) * Math.sin(angle);
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
      const objects = obj._objects || obj.getObjects?.() || [];
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
