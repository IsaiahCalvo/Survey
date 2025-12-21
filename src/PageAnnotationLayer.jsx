import React, { useEffect, useRef, memo } from 'react';
import { Canvas, Rect, Circle, Line, Triangle, Textbox, PencilBrush, Polyline, Group, util, Path } from 'fabric';
import * as fabric from 'fabric';
// Note: polygon-clipping removed - using clipPath-based erasing instead
import { regionContainsPoint } from './utils/regionMath';
import {
  isPointOnObject,
  doesRectIntersectObject,
  isObjectFullyInRect,
  getObjectGeometryBounds
} from './utils/geometryHitTest';

// Helper function to check if a point is within eraser radius of any point in eraser path
const isPointNearEraserPath = (point, eraserPath, eraserRadius) => {
  return eraserPath.points.some(eraserPoint => {
    const distance = Math.sqrt(
      Math.pow(point.x - eraserPoint.x, 2) +
      Math.pow(point.y - eraserPoint.y, 2)
    );
    return distance < eraserRadius;
  });
};

// Helper function to check if a sample point is within the eraser zone (any point in eraser path)
// Check if a path point (centerline) is erased, accounting for stroke width
// The eraser overlaps if it's within (strokeWidth/2 + eraserRadius) of the centerline
// This allows erasing the edge of wide strokes without touching the centerline
const isPointInEraserZone = (x, y, eraserPath, eraserRadius, strokeWidth = 0) => {
  // Combined radius: half stroke width + eraser radius
  // This accounts for the stroke's visual width, not just the centerline
  const combinedRadius = (strokeWidth / 2) + eraserRadius;
  const combinedRadiusSq = combinedRadius * combinedRadius;

  for (const eraserPoint of eraserPath.points) {
    const dx = x - eraserPoint.x;
    const dy = y - eraserPoint.y;
    const distSq = dx * dx + dy * dy;

    // Check if eraser overlaps with stroke (accounting for stroke width)
    if (distSq < combinedRadiusSq) {
      return true;
    }
  }
  return false;
};

// Douglas-Peucker path simplification with minimum retention to prevent over-simplification
const simplifyPath = (points, tolerance = 2.0) => {
  if (points.length <= 2) return points;

  // SAFEGUARD: Ensure we keep at least 30% of points to preserve curve smoothness
  const MIN_RETENTION_RATIO = 0.30;
  const minPointsToKeep = Math.max(3, Math.ceil(points.length * MIN_RETENTION_RATIO));

  const simplifyRecursive = (pts, tol) => {
    if (pts.length <= 2) return pts;

    // Find the point with maximum distance from line between first and last
    const first = pts[0];
    const last = pts[pts.length - 1];

    let maxDist = 0;
    let maxIndex = 0;

    for (let i = 1; i < pts.length - 1; i++) {
      const point = pts[i];
      // Perpendicular distance from point to line (first->last)
      const dx = last.localX - first.localX;
      const dy = last.localY - first.localY;
      const lineLenSq = dx * dx + dy * dy;

      let dist;
      if (lineLenSq === 0) {
        // First and last are same point
        dist = Math.sqrt(
          Math.pow(point.localX - first.localX, 2) +
          Math.pow(point.localY - first.localY, 2)
        );
      } else {
        // Perpendicular distance
        const t = Math.max(0, Math.min(1,
          ((point.localX - first.localX) * dx + (point.localY - first.localY) * dy) / lineLenSq
        ));
        const projX = first.localX + t * dx;
        const projY = first.localY + t * dy;
        dist = Math.sqrt(
          Math.pow(point.localX - projX, 2) +
          Math.pow(point.localY - projY, 2)
        );
      }

      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    // If max distance is greater than tolerance, recursively simplify
    if (maxDist > tol) {
      const left = simplifyRecursive(pts.slice(0, maxIndex + 1), tol);
      const right = simplifyRecursive(pts.slice(maxIndex), tol);
      return left.slice(0, -1).concat(right);
    } else {
      // All points are within tolerance, keep only endpoints
      return [first, last];
    }
  };

  let result = simplifyRecursive(points, tolerance);

  // If we simplified too aggressively, reduce tolerance and try again
  let currentTolerance = tolerance;
  while (result.length < minPointsToKeep && currentTolerance > 0.1) {
    currentTolerance *= 0.5; // Halve tolerance
    result = simplifyRecursive(points, currentTolerance);
  }

  // Final fallback: if still too few points, sample evenly from original
  if (result.length < minPointsToKeep) {
    const step = Math.max(1, Math.floor(points.length / minPointsToKeep));
    result = [];
    for (let i = 0; i < points.length; i += step) {
      result.push(points[i]);
    }
    // Ensure last point is included
    if (result[result.length - 1] !== points[points.length - 1]) {
      result.push(points[points.length - 1]);
    }
  }

  return result;
};

// Sample a cubic bezier curve at parameter t (0-1)
const sampleCubicBezier = (t, p0x, p0y, cp1x, cp1y, cp2x, cp2y, p1x, p1y) => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * p0x + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * p1x,
    y: mt3 * p0y + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * p1y
  };
};

// Sample a quadratic bezier curve at parameter t (0-1)
const sampleQuadraticBezier = (t, p0x, p0y, cpx, cpy, p1x, p1y) => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * p0x + 2 * mt * t * cpx + t2 * p1x,
    y: mt2 * p0y + 2 * mt * t * cpy + t2 * p1y
  };
};

// Helper function to check if a point is near a path object (for click detection)
const isPointNearPath = (point, pathObj, threshold) => {
  if (pathObj.type !== 'path') return false;

  try {
    // First try using Fabric.js's containsPoint method
    if (pathObj.containsPoint && typeof pathObj.containsPoint === 'function') {
      try {
        // containsPoint checks if point is within the stroke
        const contains = pathObj.containsPoint(point);
        if (contains) return true;
      } catch (e) {
        // Fall through to manual check
      }
    }

    // Get path bounds for quick rejection
    const bounds = pathObj.getBoundingRect();
    const strokeWidth = pathObj.strokeWidth || 3;
    const effectiveThreshold = Math.max(threshold, strokeWidth / 2 + 2); // Add small buffer

    // Quick bounding box check with threshold
    if (point.x < bounds.left - effectiveThreshold ||
      point.x > bounds.left + bounds.width + effectiveThreshold ||
      point.y < bounds.top - effectiveThreshold ||
      point.y > bounds.top + bounds.height + effectiveThreshold) {
      return false;
    }

    // For more precise detection, check distance to path segments
    // Extract points from path data
    const pathData = pathObj.path;
    if (!pathData || pathData.length === 0) return false;

    let minDistance = Infinity;
    let currentX = 0, currentY = 0;

    for (let i = 0; i < pathData.length; i++) {
      const cmd = pathData[i];
      const command = cmd[0];
      let endX, endY;

      if (command === 'M' || command === 'm') {
        endX = command === 'M' ? cmd[1] : currentX + cmd[1];
        endY = command === 'M' ? cmd[2] : currentY + cmd[2];
        currentX = endX;
        currentY = endY;
      } else if (command === 'L' || command === 'l') {
        endX = command === 'L' ? cmd[1] : currentX + cmd[1];
        endY = command === 'L' ? cmd[2] : currentY + cmd[2];

        // Check distance to line segment
        const canvasStartX = currentX + (pathObj.left || 0);
        const canvasStartY = currentY + (pathObj.top || 0);
        const canvasEndX = endX + (pathObj.left || 0);
        const canvasEndY = endY + (pathObj.top || 0);

        // Distance from point to line segment
        const A = point.x - canvasStartX;
        const B = point.y - canvasStartY;
        const C = canvasEndX - canvasStartX;
        const D = canvasEndY - canvasStartY;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;

        if (lenSq !== 0) param = dot / lenSq;

        let xx, yy;
        if (param < 0) {
          xx = canvasStartX;
          yy = canvasStartY;
        } else if (param > 1) {
          xx = canvasEndX;
          yy = canvasEndY;
        } else {
          xx = canvasStartX + param * C;
          yy = canvasStartY + param * D;
        }

        const dx = point.x - xx;
        const dy = point.y - yy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        minDistance = Math.min(minDistance, distance);

        currentX = endX;
        currentY = endY;
      } else if (command === 'C' || command === 'c' || command === 'Q' || command === 'q') {
        // For bezier curves, just check end point
        if (command === 'C' || command === 'c') {
          endX = command === 'C' ? cmd[5] : currentX + cmd[5];
          endY = command === 'C' ? cmd[6] : currentY + cmd[6];
        } else {
          endX = command === 'Q' ? cmd[3] : currentX + cmd[3];
          endY = command === 'Q' ? cmd[4] : currentY + cmd[4];
        }

        const canvasEndX = endX + (pathObj.left || 0);
        const canvasEndY = endY + (pathObj.top || 0);
        const distance = Math.sqrt(
          Math.pow(point.x - canvasEndX, 2) + Math.pow(point.y - canvasEndY, 2)
        );
        minDistance = Math.min(minDistance, distance);

        currentX = endX;
        currentY = endY;
      }
    }

    return minDistance < effectiveThreshold;
  } catch (e) {
    // Fallback: use bounding box check
    const bounds = pathObj.getBoundingRect();
    const strokeWidth = pathObj.strokeWidth || 3;
    const effectiveThreshold = Math.max(threshold, strokeWidth / 2);
    return point.x >= bounds.left - effectiveThreshold &&
      point.x <= bounds.left + bounds.width + effectiveThreshold &&
      point.y >= bounds.top - effectiveThreshold &&
      point.y <= bounds.top + bounds.height + effectiveThreshold;
  }
};

// Helper function to get path points from a Fabric.js path object
const getPathPoints = (pathObj) => {
  const points = [];
  if (pathObj.path) {
    // Convert SVG path to points
    const pathData = pathObj.path;
    for (let i = 0; i < pathData.length; i++) {
      const command = pathData[i];
      if (command[0] === 'M' || command[0] === 'L' || command[0] === 'Q' || command[0] === 'C') {
        // Extract coordinates based on command type
        if (command[0] === 'M' || command[0] === 'L') {
          points.push({ x: command[1], y: command[2] });
        } else if (command[0] === 'Q') {
          // Quadratic bezier - use control and end points
          points.push({ x: command[1], y: command[2] });
          points.push({ x: command[3], y: command[4] });
        } else if (command[0] === 'C') {
          // Cubic bezier - use control and end points
          points.push({ x: command[1], y: command[2] });
          points.push({ x: command[3], y: command[4] });
          points.push({ x: command[5], y: command[6] });
        }
      }
    }
  }
  return points;
};

// ClipPath-based erasing helpers
// This approach uses Fabric.js's native clipPath to hide erased areas
// Much more performant and stable than polygon-clipping boolean operations

// Create an inverted clip path that hides eraser circles
// Uses a Group of circles with inverted=true so overlapping circles accumulate properly
const createEraserClipPath = (eraserCircles, bounds, padding = 50) => {
  if (!eraserCircles || eraserCircles.length === 0) return null;

  // Create circle objects for each eraser position
  const circleObjects = eraserCircles.map(circle => {
    return new Circle({
      left: circle.cx - circle.r,
      top: circle.cy - circle.r,
      radius: circle.r,
      fill: 'black',
      originX: 'left',
      originY: 'top'
    });
  });

  // Create a Group containing all eraser circles
  // With inverted=true, the clipPath shows everything EXCEPT what's inside the circles
  const clipGroup = new Group(circleObjects, {
    absolutePositioned: true,
    inverted: true  // This is the key - inverts the clipping so circles become holes
  });

  return clipGroup;
};

// Helper function to erase part of a path using CLIP PATH approach
// The eraser circles become holes in a clip mask - much more performant than polygon boolean ops
const erasePathSegment = (pathObj, eraserPath, eraserRadius, canvas) => {
  // #region agent log
  const eraseStartTime = performance.now();
  // #endregion
  console.log('[erasePathSegment] ClipPath mode');

  if (pathObj.type !== 'path') {
    console.log('[erasePathSegment] Not a path, returning false');
    return false;
  }

  try {
    const strokeWidth = pathObj.strokeWidth || 3;
    const effectiveRadius = eraserRadius + (strokeWidth / 2); // Account for stroke width

    // Get the path's bounding box
    const boundsStartTime = performance.now();
    const pathBounds = pathObj.getBoundingRect ? pathObj.getBoundingRect() : null;
    const boundsTime = performance.now() - boundsStartTime;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:355',message:'Bounding rect calculation',data:{boundsTime:boundsTime.toFixed(2)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (!pathBounds) {
      console.log('[erasePathSegment] Could not get bounding rect');
      return false;
    }

    // OPTIMIZATION: Quick bounding box rejection check
    const bboxCheckStart = performance.now();
    let eraserIntersects = false;
    for (const eraserPoint of eraserPath.points) {
      if (eraserPoint.x >= pathBounds.left - effectiveRadius &&
          eraserPoint.x <= pathBounds.left + pathBounds.width + effectiveRadius &&
          eraserPoint.y >= pathBounds.top - effectiveRadius &&
          eraserPoint.y <= pathBounds.top + pathBounds.height + effectiveRadius) {
        eraserIntersects = true;
        break;
      }
    }
    const bboxCheckTime = performance.now() - bboxCheckStart;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:371',message:'Bounding box check',data:{bboxCheckTime:bboxCheckTime.toFixed(2),pointsChecked:eraserPath.points.length,intersects:eraserIntersects},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    if (!eraserIntersects) {
      console.log('[erasePathSegment] Bounding box check failed');
      return false;
    }

    // Check if eraser actually touches the path (not just bounding box)
    // Use geometry hit testing for accuracy
    const hitTestStart = performance.now();
    let touchesPath = false;
    let hitTestCount = 0;
    for (const point of eraserPath.points) {
      hitTestCount++;
      const singleHitStart = performance.now();
      const hit = isPointOnObject(point, pathObj, eraserRadius);
      const singleHitTime = performance.now() - singleHitStart;
      // #region agent log
      if (hitTestCount <= 5 || hit) { // Log first 5 and any hits
        fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:382',message:'Geometry hit test',data:{hitTestIndex:hitTestCount,singleHitTime:singleHitTime.toFixed(2),hit:hit},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      }
      // #endregion
      if (hit) {
        touchesPath = true;
        break;
      }
    }
    const hitTestTime = performance.now() - hitTestStart;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:391',message:'Total geometry hit test time',data:{hitTestTime:hitTestTime.toFixed(2),testsPerformed:hitTestCount,touchesPath:touchesPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    if (!touchesPath) {
      console.log('[erasePathSegment] Eraser does not touch path geometry');
      return false;
    }

    // Get or create the eraser circles array stored on the object
    const existingEraserCircles = pathObj.eraserCircles || [];

    // OPTIMIZATION: Sample eraser path points to limit circle count
    // Too many circles (100+) cause expensive clipPath creation (2-7ms)
    // Sample points to keep circle count reasonable while maintaining visual quality
    const MAX_CIRCLES_PER_STROKE = 50; // Limit new circles per stroke
    const samplePoints = eraserPath.points.length > MAX_CIRCLES_PER_STROKE
      ? (() => {
          // Uniform sampling: take evenly spaced points
          const step = eraserPath.points.length / MAX_CIRCLES_PER_STROKE;
          const sampled = [];
          for (let i = 0; i < eraserPath.points.length; i += step) {
            sampled.push(eraserPath.points[Math.floor(i)]);
          }
          // Always include the last point
          if (sampled[sampled.length - 1] !== eraserPath.points[eraserPath.points.length - 1]) {
            sampled.push(eraserPath.points[eraserPath.points.length - 1]);
          }
          return sampled;
        })()
      : eraserPath.points;

    // Add new eraser circles from this stroke
    const circleCreateStart = performance.now();
    const newCircles = samplePoints.map(point => ({
      cx: point.x,
      cy: point.y,
      r: eraserRadius
    }));
    const circleCreateTime = performance.now() - circleCreateStart;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:420',message:'Eraser circles creation',data:{circleCreateTime:circleCreateTime.toFixed(2),newCircles:newCircles.length,existingCircles:existingEraserCircles.length,originalPoints:eraserPath.points.length,sampledPoints:samplePoints.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion

    // Merge with existing circles
    const allEraserCircles = [...existingEraserCircles, ...newCircles];

    // Store the eraser circles on the object for future reference/serialization
    pathObj.eraserCircles = allEraserCircles;

    // Create the clip path that shows everything EXCEPT the erased areas
    const clipPathStart = performance.now();
    const clipPath = createEraserClipPath(allEraserCircles, pathBounds, 100);
    const clipPathTime = performance.now() - clipPathStart;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:410',message:'ClipPath creation',data:{clipPathTime:clipPathTime.toFixed(2),totalCircles:allEraserCircles.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});

    if (clipPath) {
      const setClipStart = performance.now();
      pathObj.set({
        clipPath: clipPath,
        dirty: true
      });
      const setClipTime = performance.now() - setClipStart;
      fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:414',message:'ClipPath set operation',data:{setClipTime:setClipTime.toFixed(2)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      console.log('[erasePathSegment] Applied clipPath with', allEraserCircles.length, 'eraser circles');
    }

    // Check if the entire path is covered by eraser circles
    // If so, remove the object entirely
    const totalEraserArea = allEraserCircles.reduce((sum, c) => sum + Math.PI * c.r * c.r, 0);
    const pathArea = pathBounds.width * pathBounds.height;
    if (totalEraserArea > pathArea * 3) {
      // Eraser circles cover more than 3x the bounding box area - likely fully erased
      // Do a more thorough check: sample points on the path
      let visiblePoints = 0;
      const sampleCount = 10;

      // Sample along the path centerline
      const pathData = pathObj.path;
      if (pathData && pathData.length > 0) {
        const pathOffset = pathObj.pathOffset || { x: 0, y: 0 };
        const matrix = pathObj.calcTransformMatrix ? pathObj.calcTransformMatrix() : null;

        const toCanvasCoords = (localX, localY) => {
          const x = localX - pathOffset.x;
          const y = localY - pathOffset.y;
          if (matrix && matrix.length >= 6) {
            const [a, b, c, d, e, f] = matrix;
            return { x: a * x + c * y + e, y: b * x + d * y + f };
          }
          return { x: x + (pathObj.left || 0), y: y + (pathObj.top || 0) };
        };

        let currentX = 0, currentY = 0;
        const samplePoints = [];

        for (const cmd of pathData) {
          const command = cmd[0];
          if (command === 'M' || command === 'm') {
            currentX = command === 'M' ? cmd[1] : currentX + cmd[1];
            currentY = command === 'M' ? cmd[2] : currentY + cmd[2];
            samplePoints.push(toCanvasCoords(currentX, currentY));
          } else if (command === 'L' || command === 'l') {
            currentX = command === 'L' ? cmd[1] : currentX + cmd[1];
            currentY = command === 'L' ? cmd[2] : currentY + cmd[2];
            samplePoints.push(toCanvasCoords(currentX, currentY));
          } else if (command === 'C' || command === 'c') {
            currentX = command === 'C' ? cmd[5] : currentX + cmd[5];
            currentY = command === 'C' ? cmd[6] : currentY + cmd[6];
            samplePoints.push(toCanvasCoords(currentX, currentY));
          } else if (command === 'Q' || command === 'q') {
            currentX = command === 'Q' ? cmd[3] : currentX + cmd[3];
            currentY = command === 'Q' ? cmd[4] : currentY + cmd[4];
            samplePoints.push(toCanvasCoords(currentX, currentY));
          }
        }

        // Check how many sample points are NOT covered by eraser circles
        for (const point of samplePoints) {
          let isCovered = false;
          for (const circle of allEraserCircles) {
            const dx = point.x - circle.cx;
            const dy = point.y - circle.cy;
            if (dx * dx + dy * dy <= circle.r * circle.r) {
              isCovered = true;
              break;
            }
          }
          if (!isCovered) {
            visiblePoints++;
          }
        }

        // If all sample points are covered, remove the path
        if (visiblePoints === 0 && samplePoints.length > 0) {
          console.log('[erasePathSegment] All sample points covered, removing path');
          canvas.remove(pathObj);
          return true;
        }
      }
    }

    // #region agent log
    const totalEraseTime = performance.now() - eraseStartTime;
    fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:495',message:'Total erasePathSegment time',data:{totalEraseTime:totalEraseTime.toFixed(2),totalCircles:allEraserCircles.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return true;
  } catch (e) {
    console.error('Error in clipPath erasePathSegment:', e);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:497',message:'erasePathSegment error',data:{error:e.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return false;
  }
};

// Ensure color is in rgba format with specified opacity (default 0.2, but highlights use 1.0)
const ensureRgbaOpacity = (color, opacity = 0.2) => {
  if (!color) return `rgba(255, 193, 7, ${opacity})`; // Default yellow

  // If already rgba, ensure opacity is correct
  if (color.startsWith('rgba')) {
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgbaMatch) {
      return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${opacity})`;
    }
  }

  // If hex, convert to rgba
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  // Fallback
  return color;
};

const DEFAULT_SURVEY_HIGHLIGHT_OPACITY = 0.4;

const normalizeHighlightColor = (color, fallbackOpacity = DEFAULT_SURVEY_HIGHLIGHT_OPACITY) => {
  if (!color || typeof color !== 'string') {
    return null;
  }

  const trimmed = color.trim();
  const rgbaMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);

  if (rgbaMatch) {
    const [, r, g, b, opacityStr] = rgbaMatch;
    if (opacityStr !== undefined) {
      const parsedOpacity = parseFloat(opacityStr);
      const clampedOpacity = Number.isFinite(parsedOpacity)
        ? Math.min(1, Math.max(0, parsedOpacity))
        : fallbackOpacity;
      return `rgba(${r}, ${g}, ${b}, ${clampedOpacity})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${fallbackOpacity})`;
  }

  if (trimmed.startsWith('#')) {
    return ensureRgbaOpacity(trimmed, fallbackOpacity);
  }

  return trimmed;
};

const PageAnnotationLayer = memo(({
  pageNumber,
  width,
  height,
  scale,
  tool = 'pan', // 'pen' | 'highlighter' | 'eraser' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'underline' | 'strikeout' | 'squiggly' | 'note' | 'highlight'
  strokeColor = '#DC3545',
  strokeWidth = 3,
  annotations = null,
  onSaveAnnotations = () => { },
  highlightColor = 'rgba(255, 193, 7, 0.3)',
  newHighlights = null, // Array of {x, y, width, height} to add
  highlightsToRemove = null, // Array of {x, y, width, height} to remove
  onHighlightCreated = null, // Callback for when highlight tool creates a rectangle
  onHighlightDeleted = null, // Callback for when highlight is deleted via eraser
  onHighlightClicked = null, // Callback for when a highlight is clicked (reverse navigation)
  selectedSpaceId = null, // Space ID to filter annotations by
  selectedModuleId = null, // Module ID to filter annotations by
  selectedCategoryId = null, // Category ID to keep highlights visible when panel is hidden
  activeRegions = null,
  eraserMode = 'partial', // 'partial' | 'entire'
  eraserSize = 20, // Eraser radius in pixels
  showSurveyPanel = false // Whether survey mode is active
}) => {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const processedHighlightsRef = useRef(new Set());
  const isInitializedRef = useRef(false);
  const drawingStateRef = useRef({ isDrawingShape: false, startX: 0, startY: 0, tempObj: null });
  const toolRef = useRef(tool);
  const strokeColorRef = useRef(strokeColor);
  const strokeWidthRef = useRef(strokeWidth);
  const onHighlightCreatedRef = useRef(onHighlightCreated);
  const onHighlightDeletedRef = useRef(onHighlightDeleted);
  const onHighlightClickedRef = useRef(onHighlightClicked);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const showSurveyPanelRef = useRef(showSurveyPanel);
  const eraserModeRef = useRef(eraserMode);
  const eraserSizeRef = useRef(eraserSize);
  const lastPartialEraseTimeRef = useRef(0); // Throttle timestamp for partial erasing
  // Selection rect tracks start position and direction for AutoCAD-style selection
  const selectionRectRef = useRef(null);
  const selectionRectObjRef = useRef(null); // Temporary rectangle object for visual feedback
  const isErasingRef = useRef(false);
  const eraserPathRef = useRef(null);

  // Keep highlight callback refs in sync
  useEffect(() => {
    onHighlightCreatedRef.current = onHighlightCreated;
  }, [onHighlightCreated]);

  useEffect(() => {
    onHighlightDeletedRef.current = onHighlightDeleted;
  }, [onHighlightDeleted]);

  useEffect(() => {
    onHighlightClickedRef.current = onHighlightClicked;
  }, [onHighlightClicked]);

  // Keep selectedSpaceId ref in sync
  useEffect(() => {
    selectedSpaceIdRef.current = selectedSpaceId;
  }, [selectedSpaceId]);

  useEffect(() => {
    selectedModuleIdRef.current = selectedModuleId;
  }, [selectedModuleId]);

  // Keep showSurveyPanel ref in sync
  useEffect(() => {
    showSurveyPanelRef.current = showSurveyPanel;
  }, [showSurveyPanel]);

  useEffect(() => {
    eraserModeRef.current = eraserMode;
  }, [eraserMode]);

  useEffect(() => {
    eraserSizeRef.current = eraserSize;
  }, [eraserSize]);

  // Initialize canvas only once
  useEffect(() => {
    if (!canvasRef.current || !width || !height || isInitializedRef.current) return;

    // console.log(`[Page ${pageNumber}] Initializing canvas`);
    isInitializedRef.current = true;

    const canvas = new Canvas(canvasRef.current, {
      width: width * scale,
      height: height * scale,
      backgroundColor: 'transparent',
      // Disable Fabric.js built-in selection for select tool - we use custom selection handlers
      // Only enable built-in selection for pan tool (for object manipulation)
      selection: tool === 'pan',
      isDrawingMode: tool === 'pen' || tool === 'highlighter',
      // Ensure canvas is interactive to receive mouse events
      interactive: true,
      // AutoCAD-style selection: mode determined dynamically by drag direction
      // Default to window selection (L→R) styling - solid blue
      selectionColor: 'rgba(0, 100, 255, 0.15)',
      selectionBorderColor: 'rgba(0, 100, 255, 0.8)',
      selectionLineWidth: 1,
      selectionDashArray: null,
      selectionFullyContained: true, // Will be toggled based on drag direction
    });

    const brush = new PencilBrush(canvas);
    brush.color = strokeColor;
    brush.width = strokeWidth;
    canvas.freeDrawingBrush = brush;

    fabricRef.current = canvas;

    if (annotations && annotations.objects && annotations.objects.length > 0) {
      annotations.objects.forEach(objData => {
        util.enlivenObjects([objData], (enlivenedObjects) => {
          enlivenedObjects.forEach(obj => {
            obj.set({ strokeUniform: true });
            // Store spaceId on object if not already set (for backward compatibility)
            if (!obj.spaceId) {
              obj.spaceId = objData.spaceId || null;
            }
            if (!obj.moduleId) {
              obj.moduleId = objData.moduleId || null;
            }
            // Enforce multiply blend mode for highlights
            if (obj.highlightId || obj.needsBIC) {
              obj.set({ globalCompositeOperation: 'multiply' });
            }
            canvas.add(obj);
          });
          // After loading, filter by selectedSpaceId
          canvas.getObjects().forEach(obj => {
            const objSpaceId = obj.spaceId || null;
            const objModuleId = obj.moduleId || null;
            const currentSpaceId = selectedSpaceIdRef.current;
            const currentModuleId = selectedModuleIdRef.current;
            const matchesSpace = currentSpaceId === null || objSpaceId === currentSpaceId;
            const matchesModule = currentModuleId === null || objModuleId === currentModuleId;
            const isVisible = matchesSpace && matchesModule;
            obj.set({ visible: isVisible });
            if (!isVisible) {
              obj.set({ selectable: false, evented: false });
            }
          });
          canvas.renderAll();
        });
      });
    } else {
      // no-op; start with empty canvas
    }

    const saveCanvas = () => {
      if (!fabricRef.current) return;
      try {
        // Include spaceId in the saved JSON to preserve space associations
        const canvasJSON = fabricRef.current.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'highlightId', 'needsBIC', 'globalCompositeOperation']);
        onSaveAnnotations(pageNumber, canvasJSON);
      } catch (e) {
        console.error(`[Page ${pageNumber}] Save error:`, e);
      }
    };

    const setBrushForTool = () => {
      canvas.isDrawingMode = tool === 'pen' || tool === 'highlighter';
      // Disable Fabric.js built-in selection for select tool - we use custom selection handlers
      // Only enable built-in selection for pan tool (for object manipulation)
      canvas.selection = tool === 'pan';
      // Prevent Fabric.js from finding targets for eraser tool - we handle it ourselves with geometry checks
      // This prevents bounding-box based selection when clicking in empty space
      canvas.skipTargetFind = tool === 'eraser';
      canvas.defaultCursor = (tool === 'eraser' ? 'crosshair' : (tool === 'select' ? 'default' : (tool === 'text' ? 'text' : (tool === 'highlight' ? 'crosshair' : (canvas.isDrawingMode ? 'crosshair' : 'default')))));
      canvas.hoverCursor = canvas.defaultCursor;
      const c = tool === 'highlighter' ? highlightColor : strokeColor;
      const w = tool === 'highlighter' ? Math.max(strokeWidth, 8) : strokeWidth;
      canvas.freeDrawingBrush.color = c;
      canvas.freeDrawingBrush.width = w;
    };

    setBrushForTool();

    const handlePathCreated = (e) => {
      if (e.path) {
        e.path.set({
          strokeUniform: true,
          perPixelTargetFind: true, // Enable pixel-perfect hit detection for selection
          targetFindTolerance: 5 // Add small tolerance for easier selection
        });
        // Store current selectedSpaceId on the path
        if (selectedSpaceIdRef.current) {
          e.path.set({ spaceId: selectedSpaceIdRef.current });
        }
        if (selectedModuleIdRef.current) {
          e.path.set({ moduleId: selectedModuleIdRef.current });
        }
      }
      saveCanvas();
    };

    const handleObjectModified = (e) => {
      // Ensure the modified object stays selected after transformation
      // This prevents deselection that can occur when Fabric.js re-checks findTarget after modification
      const activeObject = fabricRef.current?.getActiveObject();
      if (e?.target && activeObject === e.target) {
        // The modified object is still the active object - ensure it stays selected
        // Use setTimeout to ensure this runs after Fabric.js's internal selection checks
        setTimeout(() => {
          if (canvas.getActiveObject() !== e.target && canvas.getObjects().includes(e.target)) {
            canvas.setActiveObject(e.target);
            canvas.requestRenderAll();
          }
        }, 0);
      }
      
      saveCanvas();
    };

    // Helper function to check if a point is within an object's bounding box
    const isPointInBoundingBox = (point, obj) => {
      if (!obj) return false;
      
      // Get bounding box accounting for transformations
      const bounds = obj.getBoundingRect(true);
      
      return (
        point.x >= bounds.left &&
        point.x <= bounds.left + bounds.width &&
        point.y >= bounds.top &&
        point.y <= bounds.top + bounds.height
      );
    };

    // Override Fabric.js findTarget to use pixel-perfect selection but allow bounding box manipulation
    const originalFindTarget = canvas.findTarget.bind(canvas);
    canvas.findTarget = function(e, skipGroup) {
      // CRITICAL: First check for control points (rotation handles, scaling handles)
      // This must happen BEFORE our custom logic to ensure control points work
      const activeObject = this.getActiveObject();
      if (activeObject) {
        // Check if click is on a control point
        const control = activeObject._findTargetCorner ? activeObject._findTargetCorner(e.e, true) : null;
        if (control) {
          // Click is on a control point - use original findTarget to let Fabric.js handle it
          return originalFindTarget(e, skipGroup);
        }
      }
      
      // Apply custom logic for pan and select tools (both allow object manipulation)
      const shouldUseCustomLogic = toolRef.current === 'pan' || toolRef.current === 'select';
      
      if (!shouldUseCustomLogic) {
        return originalFindTarget(e, skipGroup);
      }

      const pointer = this.getPointer(e);

      // Use pixel-perfect detection first for selection
      const pixelPerfectResult = originalFindTarget(e, skipGroup);

      // If pixel-perfect hit found something, return it (for selection)
      if (pixelPerfectResult) {
        return pixelPerfectResult;
      }

      // No pixel-perfect hit - if there's an active object and click is within its bounding box,
      // return it to allow dragging/manipulation from anywhere in bounding box
      if (activeObject && isPointInBoundingBox(pointer, activeObject)) {
        return activeObject;
      }

      // No hit - return null (will deselect)
      return null;
    };

    // Handle mouse down for pan/select tools to prevent deselection when clicking within bounding box
    const handleMouseDownForPan = (opt) => {
      const currentTool = toolRef.current;
      
      // Handle pan and select tools (both allow object manipulation)
      if (currentTool !== 'pan' && currentTool !== 'select') {
        return;
      }

      const pointer = canvas.getPointer(opt.e);
      const activeObject = canvas.getActiveObject();

      // If there's an active object, check if click is within its bounding box
      if (activeObject && isPointInBoundingBox(pointer, activeObject)) {
        // Click is within bounding box - prevent deselection
        // Fabric.js will handle the drag/transform automatically
        return;
      }

      // If clicking outside, allow normal deselection behavior
      // The findTarget override will handle selecting new objects
    };

    const handleMouseDown = (opt) => {
      const currentTool = toolRef.current;
      const currentStrokeColor = strokeColorRef.current;
      const currentStrokeWidth = strokeWidthRef.current;
      const currentEraserMode = eraserModeRef.current;
      const { x, y } = canvas.getPointer(opt.e);
      
      // Early return for select tool to avoid interfering with selection handlers
      if (currentTool === 'select') {
        return;
      }

      // Handle highlight clicks for reverse navigation (non-eraser tools)
      if (currentTool !== 'eraser' && currentTool !== 'highlight') {
        const pointer = canvas.getPointer(opt.e);
        const objects = canvas.getObjects();

        for (const obj of objects) {
          // Check if this is a highlight with a highlightId
          const hasHighlightId = obj.highlightId != null;
          const isColoredHighlight = obj.type === 'rect' && (
            (obj.fill && typeof obj.fill === 'string' && obj.fill.includes('rgba')) ||
            (obj.fill && typeof obj.fill === 'string' && obj.fill.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/))
          );

          if ((hasHighlightId || isColoredHighlight) && obj.highlightId) {
            // Use geometry-based hit testing for highlight click detection
            // For filled highlights, check if point is inside the filled rect
            // For stroke-only highlights, check if point is near the stroke
            if (isPointOnObject(pointer, obj, 2)) {
              // Call the reverse navigation callback
              if (onHighlightClickedRef.current) {
                onHighlightClickedRef.current(obj.highlightId);
              }
              return; // Don't continue with other click handling
            }
          }
        }
      }

      if (currentTool === 'eraser') {
        // For eraser, use geometry-based hit testing for all object types
        const pointer = canvas.getPointer(opt.e);
        const eraserRadius = eraserSizeRef.current || 20;
        console.log('[Eraser] MouseDown - pointer:', pointer, 'radius:', eraserRadius, 'mode:', currentEraserMode);

        // Find the closest object whose geometry is actually under the cursor
        let target = null;
        let minDistance = Infinity;

        const objects = canvas.getObjects();
        console.log('[Eraser] Objects on canvas:', objects.length, objects.map(o => ({ type: o.type, spaceId: o.spaceId })));
        for (const obj of objects) {
          // Only check objects from current space
          const objSpaceId = obj.spaceId || null;
          if (selectedSpaceIdRef.current !== null && objSpaceId !== selectedSpaceIdRef.current) {
            continue;
          }

          // Skip invisible objects
          if (!obj.visible) continue;

          // Check if this is a highlight (always delete entirely)
          const hasHighlightId = obj.highlightId != null;
          const hasNeedsBICFlag = obj.needsBIC === true;
          const isColoredHighlight = obj.type === 'rect' && (
            (obj.fill && typeof obj.fill === 'string' && obj.fill.includes('rgba')) ||
            (obj.fill && typeof obj.fill === 'string' && obj.fill.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/))
          );
          const fillIsTransparent = !obj.fill || obj.fill === 'transparent' ||
            (typeof obj.fill === 'string' && obj.fill === 'transparent');
          const hasStroke = obj.stroke && typeof obj.stroke === 'string' && obj.stroke !== 'transparent';
          const isNeedsBICHighlight = obj.type === 'rect' && fillIsTransparent && hasStroke;
          const isHighlight = hasHighlightId || hasNeedsBICFlag || isColoredHighlight || isNeedsBICHighlight;

          // Use geometry-based hit testing for all object types
          const hitTest = isPointOnObject(pointer, obj, eraserRadius);
          console.log('[Eraser] Hit test for', obj.type, ':', hitTest);
          if (hitTest) {
            if (isHighlight) {
              // Highlights take priority - select immediately
              target = obj;
              break;
            } else {
              // For non-highlights, track the closest one
              const bounds = obj.getBoundingRect();
              const centerX = bounds.left + bounds.width / 2;
              const centerY = bounds.top + bounds.height / 2;
              const distance = Math.sqrt(
                Math.pow(pointer.x - centerX, 2) + Math.pow(pointer.y - centerY, 2)
              );
              if (distance < minDistance) {
                minDistance = distance;
                target = obj;
              }
            }
          }
        }

        console.log('[Eraser] Target found:', target ? target.type : 'none');
        if (target) {
          // Check if this is a highlight
          const hasHighlightId = target.highlightId != null;
          const hasNeedsBICFlag = target.needsBIC === true;
          const isColoredHighlight = target.type === 'rect' && (
            (target.fill && typeof target.fill === 'string' && target.fill.includes('rgba')) ||
            (target.fill && typeof target.fill === 'string' && target.fill.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/))
          );
          const fillIsTransparent = !target.fill || target.fill === 'transparent' ||
            (typeof target.fill === 'string' && target.fill === 'transparent');
          const hasStroke = target.stroke && typeof target.stroke === 'string' && target.stroke !== 'transparent';
          const isNeedsBICHighlight = target.type === 'rect' && fillIsTransparent && hasStroke;
          const isHighlight = hasHighlightId || hasNeedsBICFlag || isColoredHighlight || isNeedsBICHighlight;

          // Survey Highlights must always be deleted entirely regardless of mode
          if (isHighlight) {
            // Always delete highlights entirely
            if (onHighlightDeletedRef.current) {
              const currentZoom = canvas.getZoom ? canvas.getZoom() : scale;
              const bounds = {
                x: target.left / currentZoom,
                y: target.top / currentZoom,
                width: target.width / currentZoom,
                height: target.height / currentZoom,
                pageNumber
              };
              const highlightId = target.highlightId || null;

              if (highlightId && renderedHighlightsRef.current.has(highlightId)) {
                renderedHighlightsRef.current.delete(highlightId);
              }

              const highlightKey = highlightId || `${bounds.x}-${bounds.y}-${bounds.width}-${bounds.height}`;
              processedHighlightsRef.current.delete(highlightKey);

              canvas.discardActiveObject();
              canvas.remove(target);
              canvas.requestRenderAll();
              saveCanvas();

              if (onHighlightDeletedRef.current) {
                onHighlightDeletedRef.current(pageNumber, bounds, highlightId);
              }
            }
            return;
          }

          // For non-highlight objects, check eraser mode
          if (currentEraserMode === 'entire') {
            // Entire mode: Remove object immediately on touch and set up for continuous drag erasing
            canvas.remove(target);
            canvas.discardActiveObject();
            canvas.requestRenderAll();
            saveCanvas();
            // Enable continuous erasing during drag
            isErasingRef.current = true;
            eraserPathRef.current = {
              target: null,
              startX: x,
              startY: y,
              points: [{ x, y }]
            };
          } else {
            // Partial mode: Set up erasing state for drag-based erasing
            isErasingRef.current = true;
            canvas.discardActiveObject();
            eraserPathRef.current = {
              target: target,
              startX: x,
              startY: y,
              points: [{ x, y }]
            };

            // FEATURE: Single-click partial erase - immediately erase if clicking on a path
            if (target.type === 'path') {
              console.log('[Eraser] Calling erasePathSegment for single-click partial erase');
              const wasErased = erasePathSegment(target, eraserPathRef.current, eraserSizeRef.current || 20, canvas);
              console.log('[Eraser] erasePathSegment result:', wasErased);
              if (wasErased) {
                canvas.requestRenderAll();
                saveCanvas();
              }
            }
          }
        } else {
          // No target found, start erasing mode for drag-to-erase (both partial and entire modes)
          isErasingRef.current = true;
          eraserPathRef.current = {
            target: null,
            startX: x,
            startY: y,
            points: [{ x, y }]
          };
        }
        return;
      }
      if (currentTool === 'text') {
        const tb = new Textbox('Text', {
          left: x,
          top: y,
          fontSize: 16,
          fill: currentStrokeColor,
          editable: true,
          backgroundColor: 'transparent'
        });
        // Store current selectedSpaceId on the textbox
        if (selectedSpaceIdRef.current) {
          tb.set({ spaceId: selectedSpaceIdRef.current });
        }
        if (selectedModuleIdRef.current) {
          tb.set({ moduleId: selectedModuleIdRef.current });
        }
        canvas.add(tb);
        canvas.setActiveObject(tb);
        canvas.requestRenderAll();
        saveCanvas();
        return;
      }
      // Shape tools
      const ds = drawingStateRef.current;
      ds.isDrawingShape = false;
      let temp = null;
      if (currentTool === 'highlight') {
        // Highlight tool: create a clear selection rectangle (transparent fill, visible border)
        temp = new Rect({
          left: x,
          top: y,
          width: 1,
          height: 1,
          fill: 'transparent',
          stroke: '#4A90E2',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          strokeUniform: true,
          selectable: false,
          evented: false
        });
        ds.isDrawingShape = true;
        ds.startX = x;
        ds.startY = y;
        ds.tempObj = temp;
        if (selectedModuleIdRef.current) {
          temp.set({ moduleId: selectedModuleIdRef.current });
        }
        canvas.add(temp);
        return;
      } else if (currentTool === 'rect') {
        temp = new Rect({ left: x, top: y, width: 1, height: 1, fill: 'rgba(0,0,0,0)', stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true });
      } else if (currentTool === 'ellipse') {
        temp = new Circle({ left: x, top: y, radius: 1, fill: 'rgba(0,0,0,0)', stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true, originX: 'left', originY: 'top' });
      } else if (currentTool === 'line' || currentTool === 'underline' || currentTool === 'strikeout') {
        temp = new Line([x, y, x, y], { stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true });
      } else if (currentTool === 'arrow') {
        temp = new Line([x, y, x, y], { stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true });
      } else if (currentTool === 'squiggly') {
        temp = new Polyline([[x, y]], { stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, fill: 'transparent', strokeUniform: true });
      } else if (currentTool === 'note') {
        const note = new Group([
          new Rect({ width: 18, height: 18, fill: '#ffeb3b', rx: 4, ry: 4 }),
          new Line([4, 9, 14, 9], { stroke: '#333', strokeWidth: 2 })
        ], { left: x, top: y, hasControls: false, hasBorders: false });
        note.set('noteText', '');
        // Store current selectedSpaceId on the note
        if (selectedSpaceIdRef.current) {
          note.set({ spaceId: selectedSpaceIdRef.current });
        }
        if (selectedModuleIdRef.current) {
          note.set({ moduleId: selectedModuleIdRef.current });
        }
        note.on('mousedblclick', () => {
          const text = window.prompt('Note:', note.get('noteText') || '');
          if (text !== null) {
            note.set('noteText', text);
            saveCanvas();
          }
        });
        canvas.add(note);
        canvas.requestRenderAll();
        saveCanvas();
        return;
      }
      if (temp) {
        // Store current selectedSpaceId on the shape
        if (selectedSpaceIdRef.current) {
          temp.set({ spaceId: selectedSpaceIdRef.current });
        }
        if (selectedModuleIdRef.current) {
          temp.set({ moduleId: selectedModuleIdRef.current });
        }
        ds.isDrawingShape = true;
        ds.startX = x;
        ds.startY = y;
        ds.tempObj = temp;
        canvas.add(temp);
      }
    };

    const handleMouseMove = (opt) => {
      const currentTool = toolRef.current;
      const currentEraserMode = eraserModeRef.current;

      // Handle continuous erasing in "entire" mode (remove any object touched during drag)
      if (currentTool === 'eraser' && currentEraserMode === 'entire' && isErasingRef.current && eraserPathRef.current) {
        const { x, y } = canvas.getPointer(opt.e);
        const eraserRadius = eraserSizeRef.current || 20;
        const pointer = { x, y };

        // Find and remove any objects touched by the eraser
        const objects = canvas.getObjects();
        for (const obj of objects) {
          // Skip if not from current space
          const objSpaceId = obj.spaceId || null;
          if (selectedSpaceIdRef.current !== null && objSpaceId !== selectedSpaceIdRef.current) {
            continue;
          }

          // Skip invisible objects
          if (!obj.visible) continue;

          // Check if this is a highlight (handled separately)
          const hasHighlightId = obj.highlightId != null;
          const hasNeedsBICFlag = obj.needsBIC === true;
          const isColoredHighlight = obj.type === 'rect' && (
            (obj.fill && typeof obj.fill === 'string' && obj.fill.includes('rgba')) ||
            (obj.fill && typeof obj.fill === 'string' && obj.fill.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/))
          );
          const fillIsTransparent = !obj.fill || obj.fill === 'transparent' ||
            (typeof obj.fill === 'string' && obj.fill === 'transparent');
          const hasStroke = obj.stroke && typeof obj.stroke === 'string' && obj.stroke !== 'transparent';
          const isNeedsBICHighlight = obj.type === 'rect' && fillIsTransparent && hasStroke;
          const isHighlight = hasHighlightId || hasNeedsBICFlag || isColoredHighlight || isNeedsBICHighlight;

          // Use geometry-based hit testing to check if eraser touches this object
          if (isPointOnObject(pointer, obj, eraserRadius)) {
            if (isHighlight) {
              // Handle highlight deletion (same logic as mousedown)
              if (onHighlightDeletedRef.current) {
                const currentZoom = canvas.getZoom ? canvas.getZoom() : scale;
                const bounds = {
                  x: obj.left / currentZoom,
                  y: obj.top / currentZoom,
                  width: obj.width / currentZoom,
                  height: obj.height / currentZoom,
                  pageNumber
                };
                const highlightId = obj.highlightId || null;

                if (highlightId && renderedHighlightsRef.current.has(highlightId)) {
                  renderedHighlightsRef.current.delete(highlightId);
                }

                const highlightKey = highlightId || `${bounds.x}-${bounds.y}-${bounds.width}-${bounds.height}`;
                processedHighlightsRef.current.delete(highlightKey);

                canvas.remove(obj);
                canvas.requestRenderAll();
                saveCanvas();

                if (onHighlightDeletedRef.current) {
                  onHighlightDeletedRef.current(pageNumber, bounds, highlightId);
                }
              }
            } else {
              // Remove entire object
              canvas.remove(obj);
              canvas.requestRenderAll();
              saveCanvas();
            }
          }
        }
        return;
      }

      // Handle partial erasing - OPTIMIZED: collect points during drag, apply on mouse up
      if (currentTool === 'eraser' && currentEraserMode === 'partial' && isErasingRef.current && eraserPathRef.current) {
        // #region agent log
        const moveStartTime = performance.now();
        // #endregion
        const { x, y } = canvas.getPointer(opt.e);
        const eraserPath = eraserPathRef.current;

        // Check minimum movement before adding point
        const lastPoint = eraserPath.points.length > 0 ? eraserPath.points[eraserPath.points.length - 1] : null;
        const MIN_MOVE_DIST = 2;
        if (lastPoint) {
          const dx = x - lastPoint.x;
          const dy = y - lastPoint.y;
          if (dx * dx + dy * dy < MIN_MOVE_DIST * MIN_MOVE_DIST) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1240',message:'Mouse move skipped - too small',data:{pointsCount:eraserPath.points.length,dx:dx.toFixed(2),dy:dy.toFixed(2)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            return; // Mouse barely moved, skip
          }
        }

        // Collect ALL points during drag (no sliding window - we need all for final clipPath)
        eraserPath.points.push({ x, y });
        // #region agent log
        const pointAddTime = performance.now();
        const timeSinceLastMove = lastPoint ? (pointAddTime - (eraserPath.lastMoveTime || pointAddTime)) : 0;
        eraserPath.lastMoveTime = pointAddTime;
        fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1245',message:'Point collected',data:{pointsCount:eraserPath.points.length,x:x.toFixed(1),y:y.toFixed(1),timeSinceLastMove:timeSinceLastMove.toFixed(2)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        console.log('[Eraser:Move] Point added, total:', eraserPath.points.length, 'pos:', {x: x.toFixed(1), y: y.toFixed(1)});

        // Just request render to update eraser overlay visual - DON'T apply clipPath yet
        const renderStart = performance.now();
        canvas.requestRenderAll();
        const renderTime = performance.now() - renderStart;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1250',message:'Canvas render time',data:{renderTime:renderTime.toFixed(2),pointsCount:eraserPath.points.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        console.log('[Eraser:Move] requestRenderAll took:', renderTime.toFixed(2), 'ms');
        // #region agent log
        const totalMoveTime = performance.now() - moveStartTime;
        fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1252',message:'Total mouse move handler time',data:{totalTime:totalMoveTime.toFixed(2),pointsCount:eraserPath.points.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        return;
      }

      // Handle shape drawing
      const ds = drawingStateRef.current;
      if (!ds.isDrawingShape || !ds.tempObj) return;
      const { x, y } = canvas.getPointer(opt.e);
      const sx = ds.startX;
      const sy = ds.startY;
      if (ds.tempObj.type === 'rect') {
        ds.tempObj.set({ left: Math.min(sx, x), top: Math.min(sy, y), width: Math.abs(x - sx), height: Math.abs(y - sy) });
      } else if (ds.tempObj.type === 'circle') {
        ds.tempObj.set({ left: Math.min(sx, x), top: Math.min(sy, y), radius: Math.max(Math.abs(x - sx), Math.abs(y - sy)) / 2 });
      } else if (ds.tempObj.type === 'line') {
        ds.tempObj.set({ x2: x, y2: y });
      } else if (ds.tempObj.type === 'polyline') {
        const points = ds.tempObj.get('points') || [];
        points.push({ x, y });
        ds.tempObj.set({ points });
      }
      canvas.requestRenderAll();
    };

    const handleMouseUp = (opt) => {
      const currentTool = toolRef.current;
      const currentEraserMode = eraserModeRef.current;

      // Handle erasing end (both partial and entire modes)
      if (currentTool === 'eraser' && isErasingRef.current) {
        const eraserPath = eraserPathRef.current;

        // Apply partial erasing on mouse up (optimized: only process once at end of stroke)
        if (currentEraserMode === 'partial' && eraserPath && eraserPath.points.length > 0) {
          // #region agent log
          const mouseUpStartTime = performance.now();
          // #endregion
          const eraserRadius = eraserSizeRef.current || 20;
          const objects = [...canvas.getObjects()];
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1354',message:'Mouse up - starting partial erase',data:{totalObjects:objects.length,eraserPoints:eraserPath.points.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          let needsRenderAndSave = false;
          let objectsChecked = 0;
          let pathsProcessed = 0;
          let nonPathsProcessed = 0;

          for (const obj of objects) {
            objectsChecked++;
            // Skip if not from current space
            const objSpaceId = obj.spaceId || null;
            if (selectedSpaceIdRef.current !== null && objSpaceId !== selectedSpaceIdRef.current) {
              continue;
            }

            // Skip highlights
            const hasHighlightId = obj.highlightId != null;
            const hasNeedsBICFlag = obj.needsBIC === true;
            const isColoredHighlight = obj.type === 'rect' && (
              (obj.fill && typeof obj.fill === 'string' && obj.fill.includes('rgba')) ||
              (obj.fill && typeof obj.fill === 'string' && obj.fill.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/))
            );
            const fillIsTransparent = !obj.fill || obj.fill === 'transparent' ||
              (typeof obj.fill === 'string' && obj.fill === 'transparent');
            const hasStroke = obj.stroke && typeof obj.stroke === 'string' && obj.stroke !== 'transparent';
            const isNeedsBICHighlight = obj.type === 'rect' && fillIsTransparent && hasStroke;
            const isHighlight = hasHighlightId || hasNeedsBICFlag || isColoredHighlight || isNeedsBICHighlight;

            if (isHighlight) continue;

            if (obj.type === 'path') {
              pathsProcessed++;
              const wasErased = erasePathSegment(obj, eraserPath, eraserRadius, canvas);
              if (wasErased) needsRenderAndSave = true;
            } else {
              // For non-path objects, check if eraser touched them
              nonPathsProcessed++;
              const touchCheckStart = performance.now();
              const isTouching = eraserPath.points.some(point => isPointOnObject(point, obj, eraserRadius));
              const touchCheckTime = performance.now() - touchCheckStart;
              // #region agent log
              if (touchCheckTime > 1) { // Log slow checks
                fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1384',message:'Non-path touch check',data:{touchCheckTime:touchCheckTime.toFixed(2),objType:obj.type,isTouching:isTouching,pointsChecked:eraserPath.points.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
              }
              // #endregion
              if (isTouching) {
                canvas.remove(obj);
                needsRenderAndSave = true;
              }
            }
          }

          // #region agent log
          const mouseUpTime = performance.now() - mouseUpStartTime;
          fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1392',message:'Mouse up - partial erase complete',data:{mouseUpTime:mouseUpTime.toFixed(2),objectsChecked:objectsChecked,pathsProcessed:pathsProcessed,nonPathsProcessed:nonPathsProcessed,needsRenderAndSave:needsRenderAndSave},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion

          if (needsRenderAndSave) {
            const saveStart = performance.now();
            saveCanvas();
            const saveTime = performance.now() - saveStart;
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1393',message:'Save canvas time',data:{saveTime:saveTime.toFixed(2)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
          }
        }

        isErasingRef.current = false;
        eraserPathRef.current = null;
        // #region agent log
        const finalRenderStart = performance.now();
        // #endregion
        canvas.requestRenderAll();
        // #region agent log
        const finalRenderTime = performance.now() - finalRenderStart;
        fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1331',message:'Final canvas render after erase',data:{finalRenderTime:finalRenderTime.toFixed(2)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        return;
      }

      const currentStrokeColor = strokeColorRef.current;
      const ds = drawingStateRef.current;
      if (!ds.isDrawingShape || !ds.tempObj) return;

      // Handle highlight tool: create rectangle and call callback
      if (currentTool === 'highlight' && ds.tempObj.type === 'rect') {
        const rect = ds.tempObj;
        const rectLeft = rect.left;
        const rectTop = rect.top;
        const rectWidth = rect.width;
        const rectHeight = rect.height;
        const currentZoom = canvas.getZoom ? canvas.getZoom() : scale;
        /* console.log('[Survey Debug] Highlight drag capture', {
          pageNumber,
          rectLeft,
          rectTop,
          rectWidth,
          rectHeight,
          scale,
          canvasZoom: currentZoom,
          viewportTransform: canvas.viewportTransform,
          selectedModuleId: selectedModuleIdRef.current,
          selectedSpaceId: selectedSpaceIdRef.current
        }); */

        // Remove the temporary selection rectangle from canvas
        canvas.remove(ds.tempObj);

        // Only call callback if rectangle has meaningful size (user actually dragged)
        if (rectWidth > 5 && rectHeight > 5 && onHighlightCreatedRef.current) {
          // Canvas has zoom applied via setZoom(), so coordinates are in canvas space
          // Need to divide by currentZoom to convert to PDF coordinates
          // This matches the rendering logic which multiplies by renderScale (lines 667-670)
          onHighlightCreatedRef.current(pageNumber, {
            x: rectLeft / currentZoom,
            y: rectTop / currentZoom,
            width: rectWidth / currentZoom,
            height: rectHeight / currentZoom
          });
        }
      } else if (currentTool === 'arrow' && ds.tempObj.type === 'line') {
        const { x1, y1, x2, y2 } = ds.tempObj;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = new Triangle({
          left: x2,
          top: y2,
          originX: 'center',
          originY: 'center',
          width: 12,
          height: 12,
          fill: currentStrokeColor,
          angle: (angle * 180) / Math.PI + 90
        });
        const group = new Group([ds.tempObj, head], { selectable: true });
        // Store current selectedSpaceId on the arrow group
        if (selectedSpaceIdRef.current) {
          group.set({ spaceId: selectedSpaceIdRef.current });
        }
        if (selectedModuleIdRef.current) {
          group.set({ moduleId: selectedModuleIdRef.current });
        }
        canvas.add(group);
        canvas.remove(ds.tempObj);
      }
      ds.isDrawingShape = false;
      ds.tempObj = null;
      saveCanvas();
    };

    const handleDblClick = (opt) => {
      if (toolRef.current !== 'note') return;
      // handled in creation; keep stub for future
    };

    // Get actual geometric bounds of an object (not bounding box)
    // This function is kept for potential future use with more precise path geometry
    // Currently we use aCoords in the selection handler for consistent coordinate space
    const getActualObjectBounds = (obj) => {
      // For paths (pen strokes), get the actual path point extremes
      if (obj.type === 'path' && obj.path) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        obj.path.forEach(pathCmd => {
          // Path commands are arrays: ['M', x, y] or ['L', x, y] or ['Q', x1, y1, x2, y2], etc.
          for (let i = 1; i < pathCmd.length; i += 2) {
            const x = pathCmd[i];
            const y = pathCmd[i + 1];
            if (typeof x === 'number' && typeof y === 'number') {
              // Transform each point to canvas coordinates
              const transformed = fabric.util.transformPoint({ x, y }, obj.calcTransformMatrix());
              minX = Math.min(minX, transformed.x);
              maxX = Math.max(maxX, transformed.x);
              minY = Math.min(minY, transformed.y);
              maxY = Math.max(maxY, transformed.y);
            }
          }
        });

        return { left: minX, top: minY, right: maxX, bottom: maxY };
      }

      // For other objects (rectangles, circles, text, etc.), use corner coordinates
      const coords = obj.getCoords();
      const xs = coords.map(c => c.x);
      const ys = coords.map(c => c.y);

      return {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys)
      };
    };

    // Track mouse down for selection rectangle
    // AutoCAD/Bluebeam-style: direction determines selection mode
    const handleMouseDownForSelection = (e) => {
      if (toolRef.current !== 'select') {
        return;
      }

      // Only track if not clicking on an object (i.e., doing a drag selection)
      // In Fabric.js, e.target is the canvas when clicking empty space, or an object when clicking on one
      // We want to allow selection when clicking on empty canvas (e.target === canvas or e.target is canvas-like)
      // Only skip if clicking on an actual object (not canvas/background)
      // e.target will be an object with a type property when clicking on a Fabric object
      // Allow single-click selection of objects - we'll handle that in mouseUp
      // Only skip if this is clearly an object click (not a drag start)
      const isObjectClick = e.target && e.target !== canvas && e.target.type !== undefined;
      if (isObjectClick) {
        // Don't initialize selection rect - allow single-click object selection to work normally
        // But also don't prevent the object from being selected
        return;
      }

      // Disable canvas.selection to prevent Fabric.js from interfering with our custom drag selection
      // We'll re-enable it after selection completes to show visual feedback
      canvas.selection = false;
      
      // Get pointer coordinates - use viewport-transformed coordinates for visual rectangle
      // to match Fabric.js object coordinate system (same as other Rect objects in the codebase)
      const pointer = canvas.getPointer(e.e, false);
      // Also get absolute coordinates for selection logic (to match object.aCoords)
      const pointerAbsolute = canvas.getPointer(e.e, true);

      // Initialize selection rect with start position
      // Store both viewport-transformed (for visual) and absolute (for selection logic)
      // isWindowSelection will be determined by drag direction
      selectionRectRef.current = {
        startX: pointer.x, // Viewport-transformed for visual rectangle
        startY: pointer.y,
        startXAbsolute: pointerAbsolute.x, // Absolute for selection logic
        startYAbsolute: pointerAbsolute.y,
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        isWindowSelection: true // Default to window (L→R), updated during drag
      };

      // Create temporary rectangle for visual feedback using viewport-transformed coordinates
      // This ensures the rectangle aligns exactly with the cursor position
      const selectionRect = new Rect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        fill: 'rgba(0, 100, 255, 0.15)',
        stroke: 'rgba(0, 100, 255, 0.8)',
        strokeWidth: 1,
        strokeDashArray: null,
        selectable: false,
        evented: false,
        excludeFromExport: true
      });
      canvas.add(selectionRect);
      selectionRectObjRef.current = selectionRect;
      canvas.renderAll();
    };

    // Track mouse move to update selection rectangle and visual style based on direction
    const handleMouseMoveForSelection = (e) => {
      if (!selectionRectRef.current) return;

      // Get viewport-transformed coordinates for visual rectangle (to match cursor position)
      const pointer = canvas.getPointer(e.e, false);
      // Get absolute coordinates for selection logic (to match object.aCoords)
      const pointerAbsolute = canvas.getPointer(e.e, true);
      
      const startX = selectionRectRef.current.startX; // Viewport-transformed
      const startY = selectionRectRef.current.startY;
      const startXAbsolute = selectionRectRef.current.startXAbsolute; // Absolute
      const startYAbsolute = selectionRectRef.current.startYAbsolute;

      // Determine drag direction: L→R = Window (contain), R→L = Crossing (touch)
      // Use viewport-transformed coordinates for direction (matches visual)
      const isWindowSelection = pointer.x >= startX;
      const prevIsWindowSelection = selectionRectRef.current.isWindowSelection;

      // Update selection rect (viewport-transformed for visual rectangle)
      const selLeft = Math.min(startX, pointer.x);
      const selTop = Math.min(startY, pointer.y);
      const selWidth = Math.abs(pointer.x - startX);
      const selHeight = Math.abs(pointer.y - startY);
      
      selectionRectRef.current = {
        startX: startX,
        startY: startY,
        startXAbsolute: startXAbsolute,
        startYAbsolute: startYAbsolute,
        left: selLeft,
        top: selTop,
        width: selWidth,
        height: selHeight,
        isWindowSelection: isWindowSelection
      };

      // Update visual rectangle using viewport-transformed coordinates
      if (selectionRectObjRef.current) {
        const needsStyleUpdate = isWindowSelection !== prevIsWindowSelection;
        if (needsStyleUpdate) {
          if (isWindowSelection) {
            // Window Selection (L→R): Solid Blue
            selectionRectObjRef.current.set({
              fill: 'rgba(0, 100, 255, 0.15)',
              stroke: 'rgba(0, 100, 255, 0.8)',
              strokeDashArray: null
            });
          } else {
            // Crossing Selection (R→L): Dashed Green
            selectionRectObjRef.current.set({
              fill: 'rgba(0, 200, 100, 0.15)',
              stroke: 'rgba(0, 200, 100, 0.8)',
              strokeDashArray: [5, 5]
            });
          }
        }
        // Use viewport-transformed coordinates for visual rectangle (matches cursor)
        selectionRectObjRef.current.set({
          left: selLeft,
          top: selTop,
          width: selWidth,
          height: selHeight
        });
        canvas.renderAll();
      }
    };

    // Track mouse up to perform AutoCAD-style selection based on drag direction
    const handleMouseUpForSelection = (e) => {
      if (toolRef.current !== 'select') {
        selectionRectRef.current = null;
        return;
      }

      // Handle single-click object selection (no drag)
      if (!selectionRectRef.current) {
        // Use geometry-based hit testing for single-click selection
        const pointer = canvas.getPointer(e.e);
        const allObjects = canvas.getObjects();
        let hitObject = null;
        const HIT_TOLERANCE = 5;

        // Find topmost object whose geometry contains the click point
        // Iterate in reverse order (top to bottom) since last added is on top
        for (let i = allObjects.length - 1; i >= 0; i--) {
          const obj = allObjects[i];
          if (!obj.selectable || !obj.visible) continue;

          // Use geometry-based hit testing
          if (isPointOnObject(pointer, obj, HIT_TOLERANCE)) {
            hitObject = obj;
            break;
          }
        }

        if (hitObject) {
          canvas.setActiveObject(hitObject);
          canvas.requestRenderAll();
        } else {
          // Clicked on empty space - deselect all
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }
        return;
      }

      // Get pointer in virtual canvas coordinates (accounting for zoom/pan)
      // This matches the coordinate space of object transforms and calcTransformMatrix()
      const pointer = canvas.getPointer(e.e, false);
      const startX = selectionRectRef.current.startX;
      const startY = selectionRectRef.current.startY;

      // Final direction determination (based on screen direction)
      const isWindowSelection = pointer.x >= startX;

      // Selection rectangle in virtual canvas coordinates
      // Use non-absolute coordinates to match object transform coordinate space
      const selLeft = Math.min(startX, pointer.x);
      const selTop = Math.min(startY, pointer.y);
      const selWidth = Math.abs(pointer.x - startX);
      const selHeight = Math.abs(pointer.y - startY);

      // Only perform selection if there was meaningful drag (more than 5px in either direction)
      if (selWidth > 5 || selHeight > 5) {
        const selRight = selLeft + selWidth;
        const selBottom = selTop + selHeight;

        // Selection rectangle for hit testing
        const selRect = { left: selLeft, top: selTop, right: selRight, bottom: selBottom };

        // Collect objects based on direction-determined selection mode
        const allObjects = canvas.getObjects();

        const objectsToSelect = [];
        allObjects.forEach((obj) => {
          // Skip non-selectable or non-visible objects
          if (!obj.selectable || !obj.visible) {
            return;
          }

          // Get object bounds in logical canvas coordinates (ignoring viewport transform)
          // This matches the coordinate space used by calcTransformMatrix() in geometry functions
          const bounds = obj.getBoundingRect(true);
          const objRect = {
            left: bounds.left,
            top: bounds.top,
            right: bounds.left + bounds.width,
            bottom: bounds.top + bounds.height
          };

          if (isWindowSelection) {
            // Window Selection (L→R): Object must be FULLY inside the selection box
            // For window selection, bounding box containment is correct -
            // if bounding box is inside, geometry is definitely inside
            const isFullyContained =
              objRect.left >= selRect.left &&
              objRect.top >= selRect.top &&
              objRect.right <= selRect.right &&
              objRect.bottom <= selRect.bottom;

            if (isFullyContained) {
              objectsToSelect.push(obj);
            }
          } else {
            // Crossing Selection (R→L): Object geometry must INTERSECT with the selection box
            // First, quick bounding box check for rejection
            const boundingBoxIntersects = !(
              objRect.right < selRect.left ||
              objRect.left > selRect.right ||
              objRect.bottom < selRect.top ||
              objRect.top > selRect.bottom
            );

            if (boundingBoxIntersects) {
              // Bounding boxes intersect, now check if actual geometry intersects
              // Use geometry-based intersection for precise selection
              try {
                const geoIntersects = doesRectIntersectObject(selRect, obj);
                if (geoIntersects) {
                  objectsToSelect.push(obj);
                }
                // If geometry doesn't intersect, don't select (this is the desired behavior)
              } catch (e) {
                // If geometry check fails, fall back to bounding box intersection
                console.warn('Geometry check failed, using bounding box:', e.message);
                objectsToSelect.push(obj);
              }
            }
          }
        });

        // Apply our custom selection
        // Enable canvas.selection to show selection handles/outline for selected objects
        canvas.selection = true;

        canvas.discardActiveObject();
        if (objectsToSelect.length === 1) {
          canvas.setActiveObject(objectsToSelect[0]);
        } else if (objectsToSelect.length > 1) {
          const activeSelection = new fabric.ActiveSelection(objectsToSelect, { canvas });
          canvas.setActiveObject(activeSelection);
        }
        canvas.requestRenderAll();
      }

      // Clear selection rect and remove visual rectangle
      if (selectionRectObjRef.current) {
        canvas.remove(selectionRectObjRef.current);
        selectionRectObjRef.current = null;
        canvas.renderAll();
      }
      selectionRectRef.current = null;
    };

    // Register main handlers first (they'll be called last due to LIFO)
    canvas.on('object:modified', handleObjectModified);
    canvas.on('path:created', handlePathCreated);
    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('mouse:dblclick', handleDblClick);

    // Register pan tool handler for bounding box selection
    canvas.on('mouse:down', handleMouseDownForPan);


    // Register selection tracking handlers LAST so they run FIRST (Fabric.js calls handlers in reverse order)
    canvas.on('mouse:down', handleMouseDownForSelection);
    canvas.on('mouse:move', handleMouseMoveForSelection);
    canvas.on('mouse:up', handleMouseUpForSelection);

    return () => {
      // console.log(`[Page ${pageNumber}] Cleanup`);
      isInitializedRef.current = false;
      if (fabricRef.current) {
        fabricRef.current.off();
        try {
          fabricRef.current.dispose();
        } catch (e) {
          console.error(`[Page ${pageNumber}] Disposal error:`, e);
        }
        fabricRef.current = null;
      }
    };
  }, [pageNumber, width, height]); // Only depend on essential props

  // Handle scale changes with throttling to avoid excessive renders
  const scaleUpdateTimerRef = useRef(null);
  useEffect(() => {
    if (!fabricRef.current || !width || !height) return;

    // Clear any pending scale update
    if (scaleUpdateTimerRef.current) {
      clearTimeout(scaleUpdateTimerRef.current);
    }

    // Throttle scale updates to avoid excessive renders during zoom
    scaleUpdateTimerRef.current = setTimeout(() => {
      if (fabricRef.current) {
        fabricRef.current.setWidth(width * scale);
        fabricRef.current.setHeight(height * scale);
        fabricRef.current.setZoom(scale);
        fabricRef.current.renderAll();
      }
      scaleUpdateTimerRef.current = null;
    }, 50); // Wait 50ms after last scale change

    return () => {
      if (scaleUpdateTimerRef.current) {
        clearTimeout(scaleUpdateTimerRef.current);
      }
    };
  }, [scale, width, height]);

  // Handle drawing mode changes
  useEffect(() => {
    // Update refs with current prop values
    toolRef.current = tool;
    strokeColorRef.current = strokeColor;
    strokeWidthRef.current = strokeWidth;

    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    canvas.isDrawingMode = tool === 'pen' || tool === 'highlighter';
    // Disable Fabric.js built-in selection for select tool - we use custom selection handlers
    // Only enable built-in selection for pan tool (for object manipulation)
    canvas.selection = tool === 'pan';
    // Prevent Fabric.js from finding targets for eraser tool - we handle it ourselves with geometry checks
    canvas.skipTargetFind = tool === 'eraser';
    canvas.defaultCursor = (tool === 'eraser' ? 'crosshair' : (tool === 'select' ? 'default' : (tool === 'text' ? 'text' : (tool === 'highlight' ? 'crosshair' : (canvas.isDrawingMode ? 'crosshair' : 'default')))));
    canvas.hoverCursor = canvas.defaultCursor;
    const c = tool === 'highlighter' ? 'rgba(255, 235, 59, 0.35)' : strokeColor;
    const w = tool === 'highlighter' ? Math.max(strokeWidth, 8) : strokeWidth;
    if (canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = c;
      canvas.freeDrawingBrush.width = w;
    }
    canvas.getObjects().forEach((obj, idx) => {
      // Respect space/module filtering - only make objects interactive if they're visible
      const objSpaceId = obj.spaceId || null;
      const objModuleId = obj.moduleId || null;
      const matchesSpace = selectedSpaceIdRef.current === null || objSpaceId === selectedSpaceIdRef.current;
      const matchesModule = selectedModuleIdRef.current === null || objModuleId === selectedModuleIdRef.current;
      const isVisible = matchesSpace && matchesModule;

      if (isVisible) {
        // Only make visible objects interactive based on tool
        const isSelectable = tool !== 'pen' && tool !== 'highlighter' && tool !== 'highlight';
        obj.set({
          visible: true,
          selectable: isSelectable,
          evented: isSelectable,
          // Enable pixel-perfect hit detection for selection (our findTarget override handles the logic)
          // This ensures we can detect actual annotation content, not just bounding box
          perPixelTargetFind: true,
          targetFindTolerance: (tool === 'pan' || tool === 'select') ? 5 : 0
        });
      } else {
        // Keep hidden objects non-interactive and invisible
        obj.set({ visible: false, selectable: false, evented: false });
      }
    });
    canvas.renderAll();
  }, [tool, strokeColor, strokeWidth, selectedModuleId, selectedSpaceId]);

  // Track rendered highlight objects by highlightId for updates
  const renderedHighlightsRef = useRef(new Map()); // Map<highlightId, fabric.Rect>

  // Add highlights when newHighlights prop changes
  useEffect(() => {
    if (!fabricRef.current || !newHighlights || newHighlights.length === 0) return;

    const canvas = fabricRef.current;
    const currentZoom = canvas.getZoom();
    let addedAny = false;

    newHighlights.forEach((highlight, index) => {
      // Create a unique key for this highlight to avoid duplicates
      // Use highlightId if available, otherwise use coordinates
      const highlightKey = highlight.highlightId || `${highlight.x}-${highlight.y}-${highlight.width}-${highlight.height}`;

      // Check if we already have this highlight rendered
      if (highlight.highlightId && renderedHighlightsRef.current.has(highlight.highlightId)) {
        const existingRect = renderedHighlightsRef.current.get(highlight.highlightId);

        // Verify it's still on the canvas
        if (canvas.getObjects().includes(existingRect)) {
          // Check if properties match (color, needsBIC, bounds)
          const rawColor = highlight.color || highlightColor;
          const color = normalizeHighlightColor(rawColor) || highlightColor;
          const renderScale = currentZoom || scale;

          // Check bounds
          const currentLeft = existingRect.left;
          const currentTop = existingRect.top;
          const currentWidth = existingRect.width;
          const currentHeight = existingRect.height;

          const targetLeft = highlight.x * renderScale;
          const targetTop = highlight.y * renderScale;
          const targetWidth = highlight.width * renderScale;
          const targetHeight = highlight.height * renderScale;

          const tolerance = 1.0;
          const boundsMatch =
            Math.abs(currentLeft - targetLeft) < tolerance &&
            Math.abs(currentTop - targetTop) < tolerance &&
            Math.abs(currentWidth - targetWidth) < tolerance &&
            Math.abs(currentHeight - targetHeight) < tolerance;

          // Check visual style
          const needsBIC = !!highlight.needsBIC;
          const existingNeedsBIC = !!existingRect.needsBIC;

          // If everything matches, skip update
          if (boundsMatch && needsBIC === existingNeedsBIC) {
            // For solid highlights, check color
            if (!needsBIC) {
              if (existingRect.fill === color) {
                return; // Skip, already rendered correctly
              }
            } else {
              return; // Skip, already rendered correctly (BIC style is constant)
            }
          }

          // If we get here, something changed. Remove the old one and let it be re-added.
          canvas.remove(existingRect);
          renderedHighlightsRef.current.delete(highlight.highlightId);
          processedHighlightsRef.current.delete(highlightKey);
        } else {
          // Reference exists but object not on canvas (weird), clean up
          renderedHighlightsRef.current.delete(highlight.highlightId);
          processedHighlightsRef.current.delete(highlightKey);
        }
      }

      // Also remove any existing highlights with matching bounds (regardless of highlightId)
      // This ensures old colors are removed when ball in court changes
      const tolerance = 1.0; // Tolerance for floating point precision and coordinate system differences
      // Convert PDF coordinates to canvas coordinates for comparison
      // Use actual canvas zoom for consistency
      const renderScale = currentZoom || scale;
      const highlightCanvasX = highlight.x * renderScale;
      const highlightCanvasY = highlight.y * renderScale;
      const highlightCanvasWidth = highlight.width * renderScale;
      const highlightCanvasHeight = highlight.height * renderScale;

      const matchingRects = canvas.getObjects('rect').filter(obj => {
        // Don't match the object we just verified as correct above (if any)
        if (highlight.highlightId && obj.highlightId === highlight.highlightId) return false;

        // Check if this is a highlight rectangle (has fill with rgba or transparent with stroke)
        const isHighlight = (obj.fill && typeof obj.fill === 'string' &&
          (obj.fill.includes('rgba') || obj.fill.includes('transparent'))) ||
          (obj.stroke && typeof obj.stroke === 'string' && obj.stroke !== 'transparent');

        if (!isHighlight) return false;

        // Match by bounds with tolerance
        // Compare canvas coordinates (obj is in canvas coords, highlight converted to canvas coords)
        const boundsMatch =
          Math.abs(obj.left - highlightCanvasX) < tolerance &&
          Math.abs(obj.top - highlightCanvasY) < tolerance &&
          Math.abs(obj.width - highlightCanvasWidth) < tolerance &&
          Math.abs(obj.height - highlightCanvasHeight) < tolerance;

        return boundsMatch;
      });

      // Remove matching highlights
      matchingRects.forEach(rect => {
        // Remove the old highlight
        canvas.remove(rect);
        // Clean up refs if it had a highlightId
        if (rect.highlightId) {
          renderedHighlightsRef.current.delete(rect.highlightId);
        }
        // Remove from processedHighlightsRef using the old key
        const oldKey = rect.highlightId || `${rect.left}-${rect.top}-${rect.width}-${rect.height}`;
        processedHighlightsRef.current.delete(oldKey);
      });

      // Check if we've already processed this highlight (by coordinates if no ID)
      if (!processedHighlightsRef.current.has(highlightKey)) {
        // Check if this highlight needs BIC assignment (transparent with dashed outline)
        if (highlight.needsBIC) {
          // Render as transparent with dashed outline (indicating it needs BIC)
          // Convert PDF coordinates to canvas coordinates (multiply by actual zoom)
          const renderScale = currentZoom || scale;
          const rect = new Rect({
            left: highlight.x * renderScale,
            top: highlight.y * renderScale,
            width: highlight.width * renderScale,
            height: highlight.height * renderScale,
            fill: 'transparent',
            stroke: '#4A90E2',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            selectable: toolRef.current !== 'pen' && toolRef.current !== 'highlighter' && toolRef.current !== 'highlight',
            evented: toolRef.current !== 'pen' && toolRef.current !== 'highlighter' && toolRef.current !== 'highlight',
            excludeFromExport: false,
            strokeUniform: true,
            globalCompositeOperation: 'multiply'
          });
          // Store the highlightId and needsBIC flag on the object for later reference
          rect.set({ highlightId: highlight.highlightId, needsBIC: true });
          // Store current selectedSpaceId on the highlight
          if (selectedSpaceIdRef.current) {
            rect.set({ spaceId: selectedSpaceIdRef.current });
          }
          if (highlight.moduleId || selectedModuleIdRef.current) {
            rect.set({ moduleId: highlight.moduleId || selectedModuleIdRef.current });
          }
          canvas.add(rect);
          if (highlight.highlightId) {
            renderedHighlightsRef.current.set(highlight.highlightId, rect);
          }
          processedHighlightsRef.current.add(highlightKey);
          addedAny = true;
        } else {
          // Use color from highlight data if provided, otherwise use default, and preserve stored opacity
          const rawColor = highlight.color || highlightColor;
          const color = normalizeHighlightColor(rawColor) || highlightColor;
          // Convert PDF coordinates to canvas coordinates (multiply by actual zoom)
          const renderScale = currentZoom || scale;
          const rect = new Rect({
            left: highlight.x * renderScale,
            top: highlight.y * renderScale,
            width: highlight.width * renderScale,
            height: highlight.height * renderScale,
            fill: color,
            stroke: 'transparent',
            selectable: toolRef.current !== 'pen' && toolRef.current !== 'highlighter' && toolRef.current !== 'highlight',
            evented: toolRef.current !== 'pen' && toolRef.current !== 'highlighter' && toolRef.current !== 'highlight',
            excludeFromExport: false,
            strokeUniform: true,
            globalCompositeOperation: 'multiply'
          });
          // Store the highlightId if available
          if (highlight.highlightId) {
            rect.set({ highlightId: highlight.highlightId });
            renderedHighlightsRef.current.set(highlight.highlightId, rect);
          }
          // Store current selectedSpaceId on the highlight
          if (selectedSpaceIdRef.current) {
            rect.set({ spaceId: selectedSpaceIdRef.current });
          }
          if (highlight.moduleId || selectedModuleIdRef.current) {
            rect.set({ moduleId: highlight.moduleId || selectedModuleIdRef.current });
          }
          canvas.add(rect);
          processedHighlightsRef.current.add(highlightKey);
          addedAny = true;
        }
      }
    });

    if (addedAny) {
      canvas.renderAll();

      // Save annotations
      try {
        const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'highlightId', 'needsBIC']);
        onSaveAnnotations(pageNumber, canvasJSON);
      } catch (e) {
        console.error(`[Page ${pageNumber}] Save error:`, e);
      }
    }
  }, [newHighlights, highlightColor, pageNumber, onSaveAnnotations, scale]);

  // Remove highlights when highlightsToRemove prop changes
  const processedRemovalsRef = useRef(new Set());
  useEffect(() => {
    if (!fabricRef.current || !highlightsToRemove || highlightsToRemove.length === 0) return;

    const canvas = fabricRef.current;
    let removedAny = false;

    highlightsToRemove.forEach((boundsToRemove) => {
      // Create a unique key for this removal to avoid processing twice
      const removalKey = `${boundsToRemove.x}-${boundsToRemove.y}-${boundsToRemove.width}-${boundsToRemove.height}`;

      // Check if we've already processed this removal
      if (processedRemovalsRef.current.has(removalKey)) {
        return;
      }

      // Find and remove all rectangles matching these bounds
      // Convert PDF coordinates to canvas coordinates for comparison
      const boundsCanvasX = boundsToRemove.x * scale;
      const boundsCanvasY = boundsToRemove.y * scale;
      const boundsCanvasWidth = boundsToRemove.width * scale;
      const boundsCanvasHeight = boundsToRemove.height * scale;
      const objectsToRemove = [];
      canvas.getObjects('rect').forEach(obj => {
        // Check if this is a highlight rectangle (has fill with rgba)
        const isHighlight = obj.fill && typeof obj.fill === 'string' &&
          (obj.fill.includes('rgba') || obj.fill.startsWith('#'));

        if (isHighlight) {
          // Match by bounds with tolerance for floating point and scaling
          const tolerance = 1.0; // Increased tolerance for scaled coordinates
          // Compare canvas coordinates (obj is in canvas coords, boundsToRemove converted to canvas coords)
          const boundsMatch =
            Math.abs(obj.left - boundsCanvasX) < tolerance &&
            Math.abs(obj.top - boundsCanvasY) < tolerance &&
            Math.abs(obj.width - boundsCanvasWidth) < tolerance &&
            Math.abs(obj.height - boundsCanvasHeight) < tolerance;

          if (boundsMatch) {
            objectsToRemove.push(obj);
          }
        }
      });

      // Remove the matched objects
      objectsToRemove.forEach(obj => {
        canvas.remove(obj);
        removedAny = true;

        // Clean up refs
        if (obj.highlightId) {
          renderedHighlightsRef.current.delete(obj.highlightId);
        }
        // Remove from processedHighlightsRef
        const key = obj.highlightId || `${obj.left}-${obj.top}-${obj.width}-${obj.height}`;
        processedHighlightsRef.current.delete(key);
      });

      processedRemovalsRef.current.add(removalKey);
    });

    if (removedAny) {
      canvas.requestRenderAll();

      // Save annotations
      try {
        const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId']);
        onSaveAnnotations(pageNumber, canvasJSON);
      } catch (e) {
        console.error(`[Page ${pageNumber}] Save error after removal:`, e);
      }
    }
  }, [highlightsToRemove, pageNumber, onSaveAnnotations, scale]);

  // Filter objects by selected space and regions
  useEffect(() => {
    if (!canvasRef.current || !fabric) return;

    const canvas = fabricRef.current;
    const objects = canvas.getObjects();
    const regions = Array.isArray(activeRegions) && activeRegions.length > 0 ? activeRegions : null;

    let visibleCount = 0;
    let hiddenCount = 0;
    objects.forEach(obj => {
      const objSpaceId = obj.spaceId || null;
      const objModuleId = obj.moduleId || null;

      // Check if this is a survey highlight (has moduleId)
      const isSurveyHighlight = objModuleId !== null;

      // Filter by space: if selectedSpaceId is set, object must match
      const matchesSpace = selectedSpaceId === null || objSpaceId === selectedSpaceId;

      // Filter by module: if selectedModuleId is set, object must match
      const matchesModule = selectedModuleId === null || objModuleId === selectedModuleId;

      // Survey highlights should only be visible when survey mode is active AND a module is selected
      // Also keep them visible if a category is selected (even if panel is hidden)
      const surveyHighlightVisible = !isSurveyHighlight || ((showSurveyPanel || selectedCategoryId !== null) && selectedModuleId !== null);

      let withinRegions = true;
      if (regions) {
        const bounds = obj.getBoundingRect(true, true);
        const centerX = bounds.left + (bounds.width || 0) / 2;
        const centerY = bounds.top + (bounds.height || 0) / 2;
        withinRegions = regions.some(region => regionContainsPoint(centerX, centerY, region, scale));
      }

      // Object is visible only if it matches BOTH space and module filters (and regions if applicable)
      // AND survey highlights are only visible when survey mode is active with a module selected
      const isVisible = matchesSpace && matchesModule && withinRegions && surveyHighlightVisible;
      const isInteractive = isVisible && (selectedSpaceId === null || objSpaceId === selectedSpaceId) && (selectedModuleId === null || objModuleId === selectedModuleId);

      obj.set({
        visible: isVisible,
        selectable: isInteractive,
        evented: isInteractive
      });
      if (isVisible) {
        visibleCount += 1;
      } else {
        hiddenCount += 1;
      }
    });

    /* console.log('[Survey Debug] Canvas visibility update', {
      pageNumber,
      selectedSpaceId,
      selectedModuleId,
      showSurveyPanel,
      regionCount: regions ? regions.length : 0,
      totalObjects: objects.length,
      visibleObjects: visibleCount,
      hiddenObjects: hiddenCount,
      objectBreakdown: objects.map(obj => ({
        type: obj.type,
        spaceId: obj.spaceId || null,
        moduleId: obj.moduleId || null,
        visible: obj.visible,
        selectable: obj.selectable
      }))
    }); */

    canvas.renderAll();
  }, [selectedSpaceId, selectedModuleId, selectedCategoryId, showSurveyPanel, activeRegions, scale]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: (tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'select' || tool === 'text' || tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' || tool === 'underline' || tool === 'strikeout' || tool === 'squiggly' || tool === 'note' || tool === 'highlight') ? 'auto' : 'none',
        zIndex: 10,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          cursor: (tool === 'pen' || tool === 'highlighter' || tool === 'highlight') ? 'crosshair' : 'default'
        }}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  // Only re-render if actually relevant props changed
  return (
    prevProps.pageNumber === nextProps.pageNumber &&
    prevProps.width === nextProps.width &&
    prevProps.height === nextProps.height &&
    Math.abs(prevProps.scale - nextProps.scale) < 0.01 && // Only re-render on significant scale change
    prevProps.tool === nextProps.tool &&
    prevProps.strokeColor === nextProps.strokeColor &&
    prevProps.strokeWidth === nextProps.strokeWidth &&
    prevProps.annotations === nextProps.annotations &&
    prevProps.newHighlights === nextProps.newHighlights &&
    prevProps.highlightsToRemove === nextProps.highlightsToRemove &&
    prevProps.onHighlightCreated === nextProps.onHighlightCreated &&
    prevProps.selectedSpaceId === nextProps.selectedSpaceId &&
    prevProps.activeRegions === nextProps.activeRegions
  );
});

PageAnnotationLayer.displayName = 'PageAnnotationLayer';

export default PageAnnotationLayer;

