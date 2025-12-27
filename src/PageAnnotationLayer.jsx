import React, { useEffect, useRef, memo, useState, useCallback } from 'react';

// Globally patch getContext BEFORE importing Fabric.js to prevent willReadFrequently warnings
// This must happen before any canvas contexts are created by Fabric
if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype._willReadFrequentlyPatched) {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (contextType, options = {}) {
    if (contextType === '2d') {
      return originalGetContext.call(this, contextType, { ...options, willReadFrequently: true });
    }
    return originalGetContext.call(this, contextType, options);
  };
  HTMLCanvasElement.prototype._willReadFrequentlyPatched = true;
}

import { fabric as fabricLib } from 'fabric';
const { Canvas, Rect, Circle, Line, Triangle, Textbox, PencilBrush, Polyline, Group, Control, util, Path } = fabricLib;
// Note: polygon-clipping removed - using clipPath-based erasing instead
import { regionContainsPoint } from './utils/regionMath';
import {
  isPointOnObject,
  doesRectIntersectObject,
  isObjectFullyInRect,
  getObjectGeometryBounds
} from './utils/geometryHitTest';
import { splitPathDataByEraser, booleanErasePath } from './utils/geometryEraser';
import { configureFabricOverrides } from './utils/fabricCustomization';

// Apply custom Drawboard-style controls and selection visuals
configureFabricOverrides();

// --- Callout Control Helpers ---

const getLocalPoint = (transform, x, y) => {
  const target = transform.target;
  // Use Fabric's inverse transform for accurate conversion
  const invMat = util.invertTransform(target.calcTransformMatrix());
  return util.transformPoint({ x, y }, invMat);
};

// Position Handler: Places the control at a specific relative point of the group
const calloutControlPositionHandler = (pointIndex, object, lineName) => {
  const line = object.getObjects().find(o => o.name === lineName);
  if (!line) return { x: 0, y: 0 };
  // Points in polyline are relative to group center in a standardized group? 
  // Actually in a Group, object.left/top are relative to group center.
  // But Polyline points are internal.
  // We need to transform the internal point to canvas space.

  // Group structure caveats: 
  // When grouped, objects have .group set. their .left/.top are relative to group center (originX/Y center).
  // Polyline points... usually relative to Polyline's bounding box ??
  // No, if passed to Group, they are baked.

  // Simplification: We rely on the objects inside the group being positioned relative to center.
  // The polyline object itself has left/top.
  // And its points are relative to its own center/top-left?
  // Fabric Polyline points are relative to the object's (left, top).

  // Let's rely on the object positions (Head, Knee-virtual, Text).

  // Actually, simpler approach:
  // We update the objects (Head, Text) and the Line connects them.
  // So we track the OBJECTS.
  // Tip = Head position.
  // Text = Textbox position.
  // Knee = The middle point of the polyline.

  return function (dim, finalMatrix, fabricObject) {
    let point;
    if (pointIndex === 'head') {
      const head = fabricObject.getObjects().find(o => o.name === 'calloutHead');
      point = { x: head.left, y: head.top };
    } else if (pointIndex === 'text') {
      const text = fabricObject.getObjects().find(o => o.name === 'calloutText');
      // Control at top-left of text or center? Let's say top-left (origin of text object in group)
      point = { x: text.left, y: text.top };
    } else if (pointIndex === 'knee') {
      const line = fabricObject.getObjects().find(o => o.name === 'calloutLine');
      const pts = line.points;
      // Line points are relative to Line's top/left. 
      // And Line is positioned relative to Group.
      // This is getting nested.

      // Easier Strategy used by Fabric demos:
      // Calculate the matrix transform for the specific child object.
      const matrix = line.calcTransformMatrix();
      const p = util.transformPoint({ x: pts[1].x, y: pts[1].y }, matrix); // Canvas space
      return p;
    }

    // Transform group-relative point to canvas space
    const matrix = fabricObject.calcTransformMatrix();
    return util.transformPoint(point, matrix);
  };
};

// Since the above Position Handler logic for 'knee' uses calcTransformMatrix which returns Canvas Coords,
// we just need to return that directly? 
// Fabric expects positionHandler to return result of transformPoint(point, finalMatrix) generally.
// But if we calculate absolute coords manually, we can return them.
// Let's refine.

const calloutPositionHandler = (type) => {
  return function (dim, finalMatrix, fabricObject) {
    const group = fabricObject;
    const head = group.getObjects().find(o => o.name === 'calloutHead');
    const text = group.getObjects().find(o => o.name === 'calloutText');

    let localPoint;

    if (type === 'tip') {
      localPoint = { x: head.left, y: head.top };
    } else if (type === 'knee') {
      if (group.data?.knee) {
        localPoint = { x: group.data.knee.x, y: group.data.knee.y };
      } else {
        localPoint = {
          x: (head.left + text.left) / 2,
          y: text.top + text.height / 2
        };
      }
    } else if (type.startsWith('text')) {
      // Text corner handles
      const w = text.getScaledWidth();
      const h = text.getScaledHeight();

      let px = text.left;
      let py = text.top;

      if (type.includes('R')) px += w;
      if (type.includes('B')) py += h;

      localPoint = { x: px, y: py };
    }

    // Use Fabric's transform matrix for accurate positioning
    const matrix = group.calcTransformMatrix();
    const canvasPoint = util.transformPoint(localPoint, matrix);

    // Always log for debugging
    console.log('[Position Debug]', {
      type,
      localPoint,
      groupLeft: group.left,
      groupTop: group.top,
      groupWidth: group.width,
      groupHeight: group.height,
      canvasPoint,
      matrix: matrix.slice(0, 6)
    });

    return canvasPoint;
  };
};


// Helper to re-calculate callout line connections
// Uses Path instead of Polyline to avoid coordinate normalization issues
const updateCalloutGroupConnections = (group) => {
  const line = group.getObjects().find(o => o.name === 'calloutLine');
  const head = group.getObjects().find(o => o.name === 'calloutHead');
  const text = group.getObjects().find(o => o.name === 'calloutText');
  const textBorder = group.getObjects().find(o => o.name === 'calloutTextBorder');

  if (!line || !head || !text) return;

  const pTip = { x: head.left, y: head.top };
  const pText = { x: text.left, y: text.top + text.height / 2 };

  // Read knee from data.knee (stored in group-relative coords)
  let pKnee;
  if (group.data?.knee) {
    pKnee = { x: group.data.knee.x, y: group.data.knee.y };
  } else {
    // Fallback: compute from midpoint between tip and text
    pKnee = {
      x: (pTip.x + pText.x) / 2,
      y: pText.y
    };
    if (group.data) {
      group.data.knee = { x: pKnee.x, y: pKnee.y };
    }
  }

  // Update Arrow Angle to point from tip toward knee
  const angle = Math.atan2(pKnee.y - pTip.y, pKnee.x - pTip.x) * 180 / Math.PI;
  head.set({ angle: angle + 270 });

  // Update line as a Path using group-relative coordinates
  // Path format: M x1,y1 L x2,y2 L x3,y3
  const pathString = `M ${pTip.x},${pTip.y} L ${pKnee.x},${pKnee.y} L ${pText.x},${pText.y}`;

  // Parse and set the path
  const newPath = fabric.util.parsePath(pathString);
  line.set({ path: newPath });

  // Recalculate the path's internal dimensions
  if (line._setPositionDimensions) {
    line._setPositionDimensions({});
  }
  line.setCoords();
  line.dirty = true;

  console.log('[Line Update]', {
    pathString,
    lineLeft: line.left,
    lineTop: line.top,
    linePathOffset: line.pathOffset
  });

  // Update text border position and size to match text
  if (textBorder) {
    textBorder.set({
      left: text.left - 2,
      top: text.top - 2,
      width: text.width + 4,
      height: text.height + 4
    });
    textBorder.setCoords();
  }

  // Update group's coordinate cache without recalculating bounds
  // This ensures control positions are updated correctly
  group.setCoords();
  group.dirty = true;
};


const createCalloutGroup = (start, end, strokeColor, strokeWidth, canvas) => {
  // --- 1. L-Shape Logic ---
  // Default Knee: Horizontal from text, Vertical from Tip? or Horizontal from Tip?
  // User image usually implies: Tip -> Line -> Horizontal Segment -> Text.
  // So Knee Y = Text Y (roughly). Knee X = Somewhere.
  // Or Knee Y = Tip Y? 
  // Let's use the midpoint X, but align Y to Text center.
  // Actually, standard is: Tip -> (diagonal) -> Knee -> (horizontal) -> Text.
  // So Knee.y == Text.y + offset?
  // Let's set Knee to mimic the Text's connection point (middle-left).

  // Let's try: Knee X is half-way. Knee Y is same as Text Y (middle).
  const textHeight = 24; // approx
  const knee = {
    x: (start.x + end.x) / 2,
    y: end.y + textHeight / 2
  };

  // Correction: If user drags strictly, end.y is top-left of text box.
  // Text center-left is roughly (end.x, end.y + 12).

  // --- 2. Create Objects ---

  // Triangle Arrow Head
  // Initial angle pointing to knee
  const angle = Math.atan2(knee.y - start.y, knee.x - start.x) * 180 / Math.PI;

  const head = new Triangle({
    left: start.x,
    top: start.y,
    width: 12 + strokeWidth,
    height: 12 + strokeWidth,
    fill: strokeColor,
    originX: 'center',
    originY: 'center',
    angle: angle + 270,
    name: 'calloutHead'
  });

  const text = new Textbox('Text', {
    left: end.x,
    top: end.y,
    fontSize: 16,
    fill: strokeColor,           // Text color
    width: 100,
    backgroundColor: 'rgba(255,255,255,0.9)',  // White fill (default)
    name: 'calloutText',
    originX: 'left',
    originY: 'top',
    fontFamily: 'Arial',         // Default font
    // Note: Textbox stroke applies to text characters, not box border
    // We'll use a separate rect for the border
    padding: 5,
    styles: {}  // Initialize styles to prevent serialization error
  });

  // Create a border rect for the text box
  const textBorder = new Rect({
    left: end.x - 2,
    top: end.y - 2,
    width: text.width + 4,
    height: 24, // Will be updated dynamically
    fill: 'transparent',
    stroke: strokeColor,
    strokeWidth: strokeWidth,
    name: 'calloutTextBorder',
    originX: 'left',
    originY: 'top'
  });

  console.log('[Callout Debug] Creating callout', {
    strokeColor,
    strokeWidth,
    textPos: { left: end.x, top: end.y },
    textBorderPos: { left: end.x - 2, top: end.y - 2 }
  });

  // Create line as a simple Path - we'll set its path data after group creation
  // when all positions have been converted to group-relative coordinates
  const line = new Path('M 0,0 L 1,1', {
    stroke: strokeColor,
    strokeWidth: strokeWidth,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    objectCaching: false,
    name: 'calloutLine',
    originX: 'center',
    originY: 'center'
  });

  const group = new Group([line, head, textBorder, text], {
    subTargetCheck: false, // Force group selection always (prevents individual object selection)
    objectCaching: false,
    hasControls: true,
    hasBorders: false, // No bounding box - use Cmd/Ctrl+drag to move entire callout
    selectable: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    lockMovementX: true, // Prevent normal drag - require Cmd/Ctrl to move entire callout
    lockMovementY: true,
    data: { type: 'callout' }
  });

  // After group creation, Fabric.js has converted all positions to group-relative
  // Calculate knee in group coords based on head/text positions (which are now group-relative)
  // The knee should be midway horizontally between head and text, at text's vertical center
  group.data.knee = {
    x: (head.left + text.left) / 2,
    y: text.top + text.height / 2
  };

  // Now update the line path to connect the points in group-relative coordinates
  updateCalloutGroupConnections(group);

  console.log('[Callout Debug] Group created', {
    groupCenter: { left: group.left, top: group.top },
    groupWidth: group.width,
    groupHeight: group.height,
    kneeGroupRelative: group.data.knee,
    headPos: { left: head.left, top: head.top },
    textPos: { left: text.left, top: text.top }
  });

  // --- 3. Custom Controls ---

  // Clear default controls
  group.controls = {};

  // Define Reusable Render Function (Circle with shadow)
  const renderControl = (ctx, left, top, styleOverride, fabricObject) => {
    const size = 12;
    ctx.save();
    ctx.translate(left, top);
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#4a90e2';
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 3;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  // -- Action Handler: Common Update Logic --
  // We need to update all 3 objects (Head, Line, Text) based on which handle moves.
  // AND `group.addWithUpdate()` to keep group bounds correct.

  const updateGeometry = (transform, x, y, type) => {
    const target = transform.target; // The Group
    const localPoint = getLocalPoint(transform, x, y); // Mouse pos in Group coords

    const line = target.getObjects().find(o => o.name === 'calloutLine');
    const head = target.getObjects().find(o => o.name === 'calloutHead');
    const text = target.getObjects().find(o => o.name === 'calloutText');
    if (!line || !head || !text) return false;

    console.log('[Callout Debug] updateGeometry called', {
      type,
      localPoint,
      headPos: { left: head.left, top: head.top },
      textPos: { left: text.left, top: text.top, width: text.width, height: text.height },
      linePos: { left: line.left, top: line.top },
      linePoints: line.points,
      textStroke: text.stroke,
      textStrokeWidth: text.strokeWidth,
      textBackgroundColor: text.backgroundColor
    });

    if (type === 'tip') {
      console.log('[Callout Debug] Moving TIP to', localPoint);
      head.set({ left: localPoint.x, top: localPoint.y });
      // Line will be updated by updateCalloutGroupConnections at the end
    } else if (type === 'knee') {
      // Just update the stored knee position - line will be updated by updateCalloutGroupConnections
      const newKnee = { x: localPoint.x, y: localPoint.y };
      console.log('[Callout Debug] Moving KNEE to', newKnee);
      target.data.knee = { x: newKnee.x, y: newKnee.y };
    }
    // Text Resize Logic - Standard corner resize behavior
    // Fabric.js Textbox height is auto-calculated from content, so we only resize width
    // Each corner anchors the opposite corner and resizes toward the drag point
    else if (type.startsWith('text')) {
      const textBorder = target.getObjects().find(o => o.name === 'calloutTextBorder');
      const minWidth = 40;

      const currentLeft = text.left;
      const currentTop = text.top;
      const currentWidth = text.width;
      const currentRight = currentLeft + currentWidth;

      console.log('[Callout Debug] Text resize', {
        type,
        localPoint,
        currentLeft,
        currentTop,
        currentWidth,
        currentRight
      });

      // BR (Bottom-Right): Anchor TL, resize width to the right
      if (type === 'textBR') {
        const newWidth = Math.max(minWidth, localPoint.x - currentLeft);
        text.set({ width: newWidth });
      }
      // TR (Top-Right): Anchor BL, resize width to the right
      else if (type === 'textTR') {
        const newWidth = Math.max(minWidth, localPoint.x - currentLeft);
        text.set({ width: newWidth });
      }
      // BL (Bottom-Left): Anchor TR, resize by moving left edge
      else if (type === 'textBL') {
        const newLeft = Math.min(currentRight - minWidth, localPoint.x);
        const newWidth = currentRight - newLeft;
        text.set({ left: newLeft, width: newWidth });
      }
      // TL (Top-Left): Anchor BR, resize by moving left edge
      else if (type === 'textTL') {
        const newLeft = Math.min(currentRight - minWidth, localPoint.x);
        const newWidth = currentRight - newLeft;
        text.set({ left: newLeft, width: newWidth });
      }

      // Update border to match text
      if (textBorder) {
        textBorder.set({
          left: text.left - 2,
          top: text.top - 2,
          width: text.width + 4,
          height: text.height + 4
        });
      }
    }

    // Calculate connection points and line update
    // Use shared helper
    updateCalloutGroupConnections(target);

    return true; // render request
  };

  // Tip Control
  group.controls.tip = new Control({
    x: -0.5, y: -0.5, // Ignored by custom positionHandler
    cursorStyle: 'crosshair',
    actionHandler: (e, t, x, y) => updateGeometry(t, x, y, 'tip'),
    positionHandler: calloutPositionHandler('tip'),
    render: renderControl
  });

  // Knee Control
  group.controls.knee = new Control({
    x: 0, y: 0,
    cursorStyle: 'crosshair',
    actionHandler: (e, t, x, y) => updateGeometry(t, x, y, 'knee'),
    positionHandler: calloutPositionHandler('knee'),
    render: renderControl
  });

  // Text Corners (Resize)
  const textControls = [
    { name: 'textTL', cursor: 'nwse-resize' },
    { name: 'textTR', cursor: 'nesw-resize' },
    { name: 'textBL', cursor: 'nesw-resize' },
    { name: 'textBR', cursor: 'nwse-resize' }
  ];

  textControls.forEach(ctrl => {
    group.controls[ctrl.name] = new Control({
      x: 0, y: 0,
      cursorStyle: ctrl.cursor,
      actionHandler: (e, t, x, y) => updateGeometry(t, x, y, ctrl.name),
      positionHandler: calloutPositionHandler(ctrl.name),
      render: renderControl
    });
  });

  return group;
};

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
  if (!pathObj || !pathObj.path || !eraserPath || !eraserPath.points.length) return false;

  // Use destructive path fragmentation (splitting) instead of masking
  // UPDATED: Use boolean subtraction for "cookie cutter" effect
  const result = booleanErasePath(pathObj, eraserPath, eraserRadius);

  // result can be null (no change), empty array (fully erased), or object { pathData, isConvertedToOutline }
  if (result) {
    let newPathData = null;
    let isConverted = false;

    if (Array.isArray(result)) {
      // Legacy or direct array return (fully erased or simplistic split)
      newPathData = result;
    } else {
      newPathData = result.pathData;
      isConverted = result.isConvertedToOutline;
    }

    // Check if path actually changed
    // if (JSON.stringify(newPathData) === JSON.stringify(pathObj.path)) {
    //   return false;
    // }

    // Update the path data
    pathObj.path = newPathData;

    // If converted to outline, swap stroke and fill
    if (isConverted) {
      // If it was already a filled path (from previous erase), we keep it as is.
      // If it was a stroke, we essentially "bake" the stroke into the fill.
      const originalStroke = pathObj.stroke; // Keep original color

      // Ensure we don't double-convert if it's already converted?
      // Note: booleanErasePath assumes input is a stroke. If input is already filled (strokeWidth=0), 
      // booleanErasePath handles it (ideally). 
      // My implementation of booleanErasePath currently assumes stroke -> outline.
      // If re-erasing an already converted path, we should handle that in booleanErasePath or here.
      // For now, let's assume booleanErasePath converts stroke->outline polygon.

      // Only convert if it has a stroke width (implies it was a stroke)
      if (pathObj.strokeWidth > 0) {
        pathObj.set({
          stroke: 'transparent',
          strokeWidth: 0,
          fill: originalStroke || pathObj.fill
        });
      }
    }

    // Recalculate dimensions and offsets for the new path
    if (pathObj._calcDimensions) {
      const dims = pathObj._calcDimensions();
      pathObj.set({
        width: dims.width,
        height: dims.height,
        pathOffset: {
          x: dims.left + dims.width / 2,
          y: dims.top + dims.height / 2
        }
      });
    }

    // Resetting coords is crucial for correct hit box reflow
    pathObj.setCoords();

    // Remove legacy masking if present
    if (pathObj.clipPath) {
      pathObj.set('clipPath', null);
    }
    if (pathObj.eraserCircles) {
      delete pathObj.eraserCircles;
    }

    pathObj.dirty = true;

    return true; // indicated change occurred
  }

  return false;
};

const erasePathSegment_Deprecated = (pathObj, eraserPath, eraserRadius, canvas) => {
  console.log('[erasePathSegment] ClipPath mode');

  if (pathObj.type !== 'path') {
    console.log('[erasePathSegment] Not a path, returning false');
    return false;
  }

  try {
    const strokeWidth = pathObj.strokeWidth || 3;
    const effectiveRadius = eraserRadius + (strokeWidth / 2); // Account for stroke width

    // Ensure object coordinates are calculated (important for imported paths)
    if (pathObj.setCoords) {
      pathObj.setCoords();
    }

    // Get the path's bounding box
    const boundsStartTime = performance.now();
    const pathBounds = pathObj.getBoundingRect ? pathObj.getBoundingRect(true) : null; // true = force recalculation
    const boundsTime = performance.now() - boundsStartTime;
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
      if (hit) {
        touchesPath = true;
        break;
      }
    }
    const hitTestTime = performance.now() - hitTestStart;

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

    // Merge with existing circles
    const allEraserCircles = [...existingEraserCircles, ...newCircles];

    // Store the eraser circles on the object for future reference/serialization
    pathObj.eraserCircles = allEraserCircles;

    // Create the clip path that shows everything EXCEPT the erased areas
    const clipPathStart = performance.now();
    const clipPath = createEraserClipPath(allEraserCircles, pathBounds, 100);
    const clipPathTime = performance.now() - clipPathStart;

    if (clipPath) {
      const setClipStart = performance.now();
      pathObj.set({
        clipPath: clipPath,
        dirty: true
      });
      const setClipTime = performance.now() - setClipStart;
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

    const totalEraseTime = performance.now() - eraseStartTime;
    return true;
  } catch (e) {
    console.error('Error in clipPath erasePathSegment:', e);
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
      const result = `rgba(${r}, ${g}, ${b}, ${clampedOpacity})`;
      return result;
    }
    const result = `rgba(${r}, ${g}, ${b}, ${fallbackOpacity})`;
    return result;
  }

  if (trimmed.startsWith('#')) {
    const result = ensureRgbaOpacity(trimmed, fallbackOpacity);
    return result;
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
  onToolChange = () => { },
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
  showSurveyPanel = false, // Whether survey mode is active
  layerVisibility = { 'native': true, 'pdf-annotations': true } // Layer visibility toggles
}) => {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const processedHighlightsRef = useRef(new Set());
  const isInitializedRef = useRef(false);
  const drawingStateRef = useRef({ isDrawingShape: false, startX: 0, startY: 0, tempObj: null });
  const toolRef = useRef(tool);
  const strokeColorRef = useRef(strokeColor);

  // Keep refs in sync with props
  useEffect(() => {
    toolRef.current = tool;
    strokeColorRef.current = strokeColor;
    strokeWidthRef.current = strokeWidth;
  }, [tool, strokeColor, strokeWidth]);
  const strokeWidthRef = useRef(strokeWidth);
  const justCreatedCalloutRef = useRef(false);
  const onHighlightCreatedRef = useRef(onHighlightCreated);
  const onHighlightDeletedRef = useRef(onHighlightDeleted);
  const onHighlightClickedRef = useRef(onHighlightClicked);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const showSurveyPanelRef = useRef(showSurveyPanel);
  const eraserModeRef = useRef(eraserMode);
  const eraserSizeRef = useRef(eraserSize);
  const lastPartialEraseTimeRef = useRef(0); // Throttle timestamp for partial erasing
  const layerVisibilityRef = useRef(layerVisibility);
  // Selection rect tracks start position and direction for AutoCAD-style selection
  const selectionRectRef = useRef(null);
  const selectionRectObjRef = useRef(null); // Temporary rectangle object for visual feedback
  const isErasingRef = useRef(false);
  const eraserPathRef = useRef(null);
  const eraserStrokeVisualRef = useRef(null); // Visual overlay for eraser stroke
  // Rotation tracking for select tool
  const selectRotationStateRef = useRef(null); // { object, startAngle, startPointer, center }
  // Pan tool drag tracking for Drawboard PDF-style behavior
  const panDragStartRef = useRef(null);
  const panDragDistanceRef = useRef(0);
  const panInteractionTypeRef = useRef(null); // 'transform' | 'move' | 'select' | 'pan' | 'rotate' | null
  const isFabricTransformingRef = useRef(false); // Track if Fabric.js is currently transforming an object
  // Rotation tracking for modifier-based rotation
  const rotationStateRef = useRef(null); // { object, startAngle, startPointer, center }
  const lastSavedAnnotationsRef = useRef(null); // Track last saved annotations to detect external updates (Undo/Redo)

  // Context Menu State
  const [contextMenu, setContextMenu] = useState(null); // { x, y, type: 'annotation' | 'canvas', target: object }
  // Clipboard for Cut/Copy/Paste - using Ref to persist across renders without triggering them
  const clipboardRef = useRef(null);
  // Edit Modal State
  const [editModal, setEditModal] = useState(null); // { x, y, object }
  const [editValues, setEditValues] = useState({ stroke: '#000000', strokeWidth: 1, opacity: 1 });
  const editModalRef = useRef(null);



  // Callout Text Drag State
  const isDraggingCalloutTextRef = useRef(false);
  const dragStartPointerRef = useRef(null);
  const isMovingEntireCalloutRef = useRef(false); // Track Cmd/Ctrl+drag for moving entire callout

  // Helper to re-calculate callout line connections
  const updateCalloutConnections = useCallback((group) => {
    const line = group.getObjects().find(o => o.name === 'calloutLine');
    const head = group.getObjects().find(o => o.name === 'calloutHead');
    const text = group.getObjects().find(o => o.name === 'calloutText');

    if (!line || !head || !text) return;

    const pTip = { x: head.left, y: head.top };
    const pText = { x: text.left, y: text.top + text.height / 2 };

    const pts = line.points;
    const kneeIdx = 1;

    // We assume knee is at pts[1] relative to current line position. 
    // But if line moved, pts[1] is relative.
    // Stable approach: Calculate Knee in Group Space using line.left/top
    const pKnee = {
      x: line.left + pts[kneeIdx].x,
      y: line.top + pts[kneeIdx].y
    };

    // Update Arrow Angle
    const angle = Math.atan2(pKnee.y - pTip.y, pKnee.x - pTip.x) * 180 / Math.PI;
    head.set({ angle: angle + 270 });

    // Re-construct line points (un-normalized)
    const allPts = [pTip, pKnee, pText];
    const minX = Math.min(pTip.x, pKnee.x, pText.x);
    const minY = Math.min(pTip.y, pKnee.y, pText.y);

    line.set({
      left: minX,
      top: minY,
      points: allPts.map(p => ({ x: p.x - minX, y: p.y - minY }))
    });

    group.addWithUpdate();
  }, []);

  // Helper to trigger save
  const triggerSave = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'data', 'name', 'highlightId', 'needsBIC', 'globalCompositeOperation', 'layer', 'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType']);
    onSaveAnnotations(pageNumber, canvasJSON);
  }, [pageNumber, onSaveAnnotations]);

  // Context Menu Handlers
  const handleContextMenu = useCallback((e) => {
    // Only show context menu if not in drawing mode or other active interaction
    if (drawingStateRef.current.isDrawingShape || panInteractionTypeRef.current) {
      return;
    }

    e.preventDefault();
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Get pointer position relative to canvas
    const target = canvas.findTarget(e, false);

    // If we clicked on an object, select it (if not already selected)
    if (target) {
      if (!canvas.getActiveObjects().includes(target)) {
        canvas.setActiveObject(target);
        canvas.requestRenderAll();
      }

      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        type: 'annotation',
        target: target
      });
    } else {
      // Empty space click - check if we have something to paste
      if (clipboardRef.current) {
        setContextMenu({
          visible: true,
          x: e.clientX,
          y: e.clientY,
          type: 'canvas',
          target: null
        });
      }
    }
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const closeEditModal = useCallback(() => {
    setEditModal(null);
  }, []);

  // Action Handlers
  const handleCut = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const activeObject = canvas.getActiveObject();
    if (activeObject) {
      activeObject.clone((cloned) => {
        clipboardRef.current = cloned;
      });
      canvas.remove(...canvas.getActiveObjects());
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      triggerSave();
    }
    closeContextMenu();
  }, [triggerSave, closeContextMenu]);

  const handleCopy = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const activeObject = canvas.getActiveObject();
    if (activeObject) {
      activeObject.clone((cloned) => {
        clipboardRef.current = cloned;
      });
    }
    closeContextMenu();
  }, [closeContextMenu]);

  const handlePaste = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !clipboardRef.current) return;

    clipboardRef.current.clone((cloned) => {
      canvas.discardActiveObject();
      cloned.set({
        left: cloned.left + 10,
        top: cloned.top + 10,
        evented: true,
      });
      if (cloned.type === 'activeSelection') {
        // Active selection needs special handling
        cloned.canvas = canvas;
        cloned.forEachObject((obj) => {
          canvas.add(obj);
        });
        cloned.setCoords();
      } else {
        canvas.add(cloned);
      }

      // Select the pasted object
      if (cloned.type === 'activeSelection') {
        canvas.setActiveObject(cloned);
      } else {
        canvas.setActiveObject(cloned);
      }

      canvas.requestRenderAll();
      triggerSave();
    });
    closeContextMenu();
  }, [triggerSave, closeContextMenu]);

  const handleGroup = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const activeObject = canvas.getActiveObject();
    if (activeObject && activeObject.type === 'activeSelection') {
      activeObject.toGroup();
      canvas.requestRenderAll();
      triggerSave();
    }
    closeContextMenu();
  }, [triggerSave, closeContextMenu]);

  const handleUngroup = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const activeObject = canvas.getActiveObject();
    if (activeObject && activeObject.type === 'group') {
      activeObject.toActiveSelection();
      canvas.requestRenderAll();
      triggerSave();
    }
    closeContextMenu();
  }, [triggerSave, closeContextMenu]);

  const handleEdit = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const activeObject = canvas.getActiveObject();

    if (activeObject) {
      // Get initial values from first object if selection
      const target = activeObject.type === 'activeSelection' ? activeObject.getObjects()[0] : activeObject;

      setEditValues({
        stroke: target.stroke || '#000000',
        strokeWidth: target.strokeWidth || 1,
        opacity: target.opacity !== undefined ? target.opacity : 1,
        // Callout specific props
        fill: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.fill || '#000000') : (target.fill || 'transparent'),
        fontSize: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.fontSize || 16) : 16,
        fontWeight: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.fontWeight || 'normal') : 'normal',
        fontStyle: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.fontStyle || 'normal') : 'normal',
        textAlign: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.textAlign || 'left') : 'left',
        fontFamily: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.fontFamily || 'Arial') : 'Arial',
        fillColor: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.backgroundColor || 'rgba(255,255,255,0.9)') : '#ffffff'
      });

      // Capture initial state for revert
      const objects = activeObject.type === 'activeSelection' ? activeObject.getObjects() : [activeObject];
      const initialStates = objects.map(obj => ({
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
        opacity: obj.opacity
      }));

      setEditModal({
        visible: true,
        x: contextMenu.x,
        y: contextMenu.y,
        object: activeObject,
        initialStates: initialStates
      });
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  const saveEdit = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !editModal) return;

    const objects = editModal.object.type === 'activeSelection'
      ? editModal.object.getObjects()
      : [editModal.object];

    objects.forEach(obj => {
      if (obj.data?.type === 'callout') {
        // Apply to Callout parts
        const line = obj.getObjects().find(o => o.name === 'calloutLine');
        const head = obj.getObjects().find(o => o.name === 'calloutHead');
        const text = obj.getObjects().find(o => o.name === 'calloutText');
        const textBorder = obj.getObjects().find(o => o.name === 'calloutTextBorder');

        if (line) {
          line.set({ stroke: editValues.stroke, strokeWidth: parseInt(editValues.strokeWidth, 10) });
        }
        if (head) {
          head.set({ fill: editValues.stroke }); // Arrow head matches line color
        }
        if (text) {
          text.set({
            fill: editValues.fill, // Text color
            fontSize: parseInt(editValues.fontSize, 10),
            fontWeight: editValues.fontWeight,
            fontStyle: editValues.fontStyle,
            textAlign: editValues.textAlign,
            fontFamily: editValues.fontFamily || 'Arial',
            backgroundColor: editValues.fillColor === 'transparent' ? '' : (editValues.fillColor || 'rgba(255,255,255,0.9)')
          });
        }
        if (textBorder) {
          textBorder.set({
            stroke: editValues.stroke,        // Border matches line color
            strokeWidth: parseInt(editValues.strokeWidth, 10)
          });
        }
        obj.set({ opacity: parseFloat(editValues.opacity) });
      } else {
        obj.set({
          stroke: editValues.stroke,
          strokeWidth: parseInt(editValues.strokeWidth, 10),
          opacity: parseFloat(editValues.opacity)
        });
      }
    });

    canvas.requestRenderAll();
    triggerSave();
    closeEditModal();
  }, [editModal, editValues, triggerSave, closeEditModal]);

  // Live preview effect
  useEffect(() => {
    if (!editModal || !editModal.object) return;

    const canvas = fabricRef.current;
    if (!canvas) return;

    const objects = editModal.object.type === 'activeSelection'
      ? editModal.object.getObjects()
      : [editModal.object];

    // Apply changes in real-time
    objects.forEach(obj => {
      // Don't modify if values are not valid numbers
      if (editValues.opacity >= 0 && editValues.opacity <= 1) {
        if (obj.data?.type === 'callout') {
          const line = obj.getObjects().find(o => o.name === 'calloutLine');
          const head = obj.getObjects().find(o => o.name === 'calloutHead');
          const text = obj.getObjects().find(o => o.name === 'calloutText');
          const textBorder = obj.getObjects().find(o => o.name === 'calloutTextBorder');
          if (line) line.set({ stroke: editValues.stroke, strokeWidth: parseInt(editValues.strokeWidth, 10) });
          if (head) head.set({ fill: editValues.stroke });
          if (text) text.set({
            fill: editValues.fill,
            fontSize: parseInt(editValues.fontSize, 10),
            fontWeight: editValues.fontWeight,
            fontStyle: editValues.fontStyle,
            textAlign: editValues.textAlign,
            fontFamily: editValues.fontFamily || 'Arial',
            backgroundColor: editValues.fillColor === 'transparent' ? '' : (editValues.fillColor || 'rgba(255,255,255,0.9)')
          });
          if (textBorder) textBorder.set({
            stroke: editValues.stroke,
            strokeWidth: parseInt(editValues.strokeWidth, 10)
          });
          obj.set({ opacity: parseFloat(editValues.opacity) });
        } else {
          obj.set({
            stroke: editValues.stroke,
            strokeWidth: parseInt(editValues.strokeWidth, 10),
            opacity: parseFloat(editValues.opacity)
          });
        }
      }
    });

    canvas.requestRenderAll();
  }, [editValues, editModal]);

  const cancelEdit = useCallback(() => {
    if (!editModal) return;
    const canvas = fabricRef.current;

    const objects = editModal.object.type === 'activeSelection'
      ? editModal.object.getObjects()
      : [editModal.object];

    // Revert to initial states
    objects.forEach((obj, index) => {
      const state = editModal.initialStates ? editModal.initialStates[index] : null;
      if (state) {
        obj.set(state);
      }
    });

    if (canvas) canvas.requestRenderAll();
    if (canvas) canvas.requestRenderAll();
    setEditModal(null);
  }, [editModal]);

  // Click outside listener for Edit Modal
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Check if click is outside the modal
      // We check for both mousedown (left/right start) and contextmenu
      if (editModal && editModalRef.current && !editModalRef.current.contains(event.target)) {
        // Also ensure we're not clicking on an annotation that might have triggered the context menu
        // But generally, any click outside should dismiss
        cancelEdit();
      }
    };

    if (editModal) {
      // Use capture phase to handle it before other handlers might swallow it
      document.addEventListener('mousedown', handleClickOutside, true);
      document.addEventListener('contextmenu', handleClickOutside, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('contextmenu', handleClickOutside, true);
    };
  }, [editModal, cancelEdit]);


  // Click outside listener for Edit Modal
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Check if click is outside the modal
      if (editModal && editModalRef.current && !editModalRef.current.contains(event.target)) {
        // Prevent context menu from opening if we are just dismissing the modal
        event.stopPropagation();
        // If it's a right click, we also want to prevent the default context menu
        if (event.type === 'contextmenu') {
          event.preventDefault();
        }
        cancelEdit();
      }
    };

    if (editModal) {
      // Use capture phase to handle it before other handlers might swallow it
      document.addEventListener('mousedown', handleClickOutside, true);
      document.addEventListener('contextmenu', handleClickOutside, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('contextmenu', handleClickOutside, true);
    };
  }, [editModal, cancelEdit]);


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

  // Keep layerVisibility ref in sync
  useEffect(() => {
    layerVisibilityRef.current = layerVisibility;
    // Update object visibility when layer visibility changes
    if (fabricRef.current) {
      fabricRef.current.getObjects().forEach(obj => {
        const objLayer = obj.layer || 'native'; // Default to 'native' for objects without layer
        const layerVisible = layerVisibilityRef.current[objLayer] !== false;
        if (!layerVisible) {
          obj.set({ visible: false, selectable: false, evented: false });
        } else {
          // Re-check other visibility conditions (space, module)
          const objSpaceId = obj.spaceId || null;
          const objModuleId = obj.moduleId || null;
          const currentSpaceId = selectedSpaceIdRef.current;
          const currentModuleId = selectedModuleIdRef.current;
          const matchesSpace = currentSpaceId === null || objSpaceId === currentSpaceId;
          const matchesModule = currentModuleId === null || objModuleId === currentModuleId;
          const isVisible = matchesSpace && matchesModule;
          obj.set({ visible: isVisible, selectable: isVisible, evented: isVisible });
        }
      });
      fabricRef.current.renderAll();
    }
  }, [layerVisibility]);

  useEffect(() => {
    eraserSizeRef.current = eraserSize;
  }, [eraserSize]);

  // Update canvas properties when tool or styles change
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = tool === 'pen' || tool === 'highlighter';

    // Disable Fabric.js built-in selection for Pan tool (we want drag-to-pan)
    // Also disable for Select tool.
    canvas.selection = false;

    // Prevent Fabric.js from finding targets for eraser tool
    canvas.skipTargetFind = tool === 'eraser';

    // Update cursors
    // Set cursor based on tool (Using 'none' for eraser to hide native cursor)
    const shapeTools = ['rect', 'ellipse', 'line', 'arrow', 'callout', 'highlight', 'squiggly'];
    canvas.defaultCursor = (tool === 'eraser' ? 'none' : (tool === 'select' ? 'default' : (tool === 'text' ? 'text' : (shapeTools.includes(tool) ? 'crosshair' : (canvas.isDrawingMode ? 'crosshair' : 'default')))));
    canvas.hoverCursor = tool === 'eraser' ? 'none' : (tool === 'select' ? 'move' : (tool === 'pan' ? 'grab' : 'move'));
    canvas.moveCursor = tool === 'eraser' ? 'none' : 'move';
    canvas.hoverCursor = canvas.defaultCursor;

    // Update brush properties
    if (canvas.freeDrawingBrush) {
      const c = tool === 'highlighter' ? highlightColor : strokeColor;
      const w = tool === 'highlighter' ? Math.max(strokeWidth, 8) : strokeWidth;
      canvas.freeDrawingBrush.color = c;
      canvas.freeDrawingBrush.width = w;
    }

    canvas.requestRenderAll();
  }, [tool, strokeColor, strokeWidth, highlightColor]);

  // Helper to load annotations into canvas
  const loadAnnotations = (annotationsData) => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.clear();
    canvas.setBackgroundColor('transparent', () => { });

    if (annotationsData && annotationsData.objects && annotationsData.objects.length > 0) {
      util.enlivenObjects(annotationsData.objects, (enlivenedObjects) => {
        enlivenedObjects.forEach((obj, index) => {
          const objData = annotationsData.objects[index];

          obj.set({
            strokeUniform: true,
            uniformScaling: false,
            lockUniScaling: false,
            centeredRotation: true
          });

          // Restore space/module association
          if (!obj.spaceId) obj.spaceId = objData.spaceId || null;
          if (!obj.moduleId) obj.moduleId = objData.moduleId || null;

          // Preserve imported PDF annotation properties
          if (objData.isPdfImported) {
            obj.isPdfImported = true;
            obj.pdfAnnotationId = objData.pdfAnnotationId;
            obj.pdfAnnotationType = objData.pdfAnnotationType;
            obj.layer = objData.layer || 'pdf-annotations';
            obj.set({
              selectable: true, evented: true, hasControls: true, hasBorders: true,
              perPixelTargetFind: true, targetFindTolerance: 5
            });
          }

          // Preserve layer property
          if (objData.layer) obj.layer = objData.layer;

          // Enforce multiply blend mode for highlights
          if (obj.highlightId || obj.needsBIC) {
            obj.set({ globalCompositeOperation: 'multiply' });
          }

          // Apply visibility filter
          const objLayer = obj.layer || 'native';
          const layerVisible = layerVisibilityRef.current[objLayer] !== false;

          const objSpaceId = obj.spaceId || null;
          const objModuleId = obj.moduleId || null;
          const currentSpaceId = selectedSpaceIdRef.current;
          const currentModuleId = selectedModuleIdRef.current;
          const matchesSpace = currentSpaceId === null || objSpaceId === currentSpaceId;
          const matchesModule = currentModuleId === null || objModuleId === currentModuleId;

          const isVisible = matchesSpace && matchesModule && layerVisible;
          obj.set({ visible: isVisible, selectable: isVisible, evented: isVisible });

          canvas.add(obj);
          obj.setCoords();
        });
        canvas.renderAll();
      });
    }
  };

  // Sync canvas with annotations prop (handles Undo/Redo)
  useEffect(() => {
    if (!fabricRef.current || !annotations) return;

    // Skip reload if the update originated from us (internal save)
    if (lastSavedAnnotationsRef.current === annotations) {
      return;
    }

    // External update (Undo/Redo or initial load from parent), reload canvas
    loadAnnotations(annotations);

    // Mark this version as "seen" to prevent echo
    lastSavedAnnotationsRef.current = annotations;
  }, [annotations]);

  // Initialize canvas only once
  useEffect(() => {
    if (!canvasRef.current || !width || !height || isInitializedRef.current) return;

    // console.log(`[Page ${pageNumber}] Initializing canvas`);
    isInitializedRef.current = true;

    // Detect platform for modifier key handling
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
      navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

    // Event listener for finishing text editing (Callout workflow)
    const handleTextEditingExited = (e) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      // If we were in callout tool mode and finished editing, switch to select
      if (justCreatedCalloutRef.current || toolRef.current === 'callout') {
        onToolChange('select');
        justCreatedCalloutRef.current = false;
        // Force proper deselection to clear focus
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
    };

    // Event listener for selection cleared (clicking outside)
    const handleSelectionCleared = (e) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      // Force deep cleanup of editing state for ALL callouts
      // Note: activeObject is likely null due to 'selection:cleared', but the IText might still be in edit mode internally
      canvas.getObjects().forEach(obj => {
        if (obj.data?.type === 'callout') {
          const textObj = obj.getObjects().find(o => o.name === 'calloutText');
          if (textObj && textObj.isEditing) {
            textObj.exitEditing();
          }
        }
      });

      // If we were in callout tool mode, switch to select
      if (justCreatedCalloutRef.current || toolRef.current === 'callout') {
        onToolChange('select');
        justCreatedCalloutRef.current = false;
      }

      canvas.requestRenderAll();
    };

    // Global Keydown
    const handleKeyDown = (e) => {
      // Escape Key
      if (e.key === 'Escape') {
        const canvas = fabricRef.current;
        if (!canvas) return;

        // Exit any active text editing in callouts
        const activeObj = canvas.getActiveObject();
        if (activeObj?.data?.type === 'callout') {
          const textObj = activeObj.getObjects().find(o => o.name === 'calloutText');
          if (textObj?.isEditing) {
            textObj.exitEditing();
          }
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }

        // Also check all callouts on canvas for editing state
        canvas.getObjects().forEach(obj => {
          if (obj.data?.type === 'callout') {
            const textObj = obj.getObjects().find(o => o.name === 'calloutText');
            if (textObj?.isEditing) {
              textObj.exitEditing();
            }
          }
        });

        // Switch to select tool
        if (toolRef.current === 'callout') {
          onToolChange('select');
          justCreatedCalloutRef.current = false;
        }
        return;
      }

      // Delete / Backspace Key
      if (e.key === 'Backspace' || e.key === 'Delete') {
        // Ignore if typing in an input field external to canvas or contentEditable
        const activeEl = document.activeElement;
        if (activeEl && (['INPUT', 'TEXTAREA'].includes(activeEl.tagName) || activeEl.isContentEditable)) return;

        const canvas = fabricRef.current;
        if (!canvas) return;
        const activeObj = canvas.getActiveObject();

        if (activeObj) {
          console.log('[Callout Debug] Delete Pressed', {
            activeObjType: activeObj.type,
            dataType: activeObj.data?.type,
            hasCustomData: !!activeObj.data,
            objects: activeObj.getObjects ? activeObj.getObjects().length : 0
          });
        }

        // Check for Callout (Checking data.type OR internal structure as fallback)
        const isCallout = (activeObj?.data?.type === 'callout') ||
          (activeObj?.type === 'group' && activeObj.getObjects().some(o => o.name === 'calloutText'));

        if (isCallout) {
          // Ensure we are not editing the text inside the callout
          const isEditing = activeObj.isEditing || (activeObj.getObjects && activeObj.getObjects().some(o => o.isEditing));

          if (!isEditing) {
            canvas.remove(activeObj);
            canvas.requestRenderAll();
            triggerSave();
            e.preventDefault();
          } else {
            console.log('[Callout Debug] Deletion blocked: text is editing');
          }
        }
      }
    };

    const canvas = new Canvas(canvasRef.current, {
      width: Math.floor(width * scale),
      height: Math.floor(height * scale),
      backgroundColor: 'transparent',
      // Disable Fabric.js built-in selection for Pan tool (we use drag-to-pan)
      // Also disable for Select tool as we use custom selection handlers
      selection: tool !== 'pan', // Add selection: false when pan is active
      preserveObjectStacking: true,
      perPixelTargetFind: false, // Don't require clicking exactly on pixels (bounding box is enough)
      targetFindTolerance: 4,     // Increase tolerance slightly
      // renderOnAddRemove: false, // Performance optimization
      enableRetinaScaling: true, // Crisper rendering
      stopContextMenu: true, // Prevent default browser context menu
      fireRightClick: true, // Enable right-click events
      // Ensure canvas is interactive to receive mouse events
      interactive: true,
      // AutoCAD-style selection: mode determined dynamically by drag direction
      // Default to window selection (L→R) styling - solid blue
      selectionColor: 'rgba(0, 100, 255, 0.15)',
      selectionBorderColor: 'rgba(0, 100, 255, 0.8)',
      selectionLineWidth: 1,
      selectionDashArray: null,
      selectionFullyContained: true, // Will be toggled based on drag direction
      // Allow free scaling by default (aspect ratio unlocked)
      uniformScaling: false
      // Note: We don't set uniScaleKey because we handle modifier keys manually
      // in handleObjectScaling to ensure platform-specific behavior (Command on Mac, Control on Windows)
    });

    canvas.on('text:editing:exited', handleTextEditingExited);
    canvas.on('selection:cleared', handleSelectionCleared);
    window.addEventListener('keydown', handleKeyDown);

    const brush = new PencilBrush(canvas);
    brush.color = strokeColor;
    brush.width = strokeWidth;
    canvas.freeDrawingBrush = brush;

    fabricRef.current = canvas;
    // Load initial annotations
    loadAnnotations(annotations);

    const saveCanvas = () => {
      if (!fabricRef.current) return;
      try {
        // Include spaceId in the saved JSON to preserve space associations
        const canvasJSON = fabricRef.current.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'data', 'name', 'highlightId', 'needsBIC', 'globalCompositeOperation', 'layer', 'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType']);
        lastSavedAnnotationsRef.current = canvasJSON; // Update last saved ref
        onSaveAnnotations(pageNumber, canvasJSON);
        onSaveAnnotations(pageNumber, canvasJSON);
      } catch (e) {
        console.error(`[Page ${pageNumber}] Save error:`, e);
      }
    };

    // Handle selection state changes to toggle perPixelTargetFind
    // When selected: disable per-pixel find to allow clicking anywhere in bounding box
    // When deselected: enable per-pixel find for precise selection
    const setPerPixelTargetFind = (objects, value) => {
      if (!objects) return;
      objects.forEach(obj => {
        // Apply to all interactive objects (exclude utility objects like selection rects if they are not selectable)
        if (obj.selectable !== false && obj.evented !== false) {
          obj.perPixelTargetFind = value;
          // Ensure coordinates are updated for hit testing
          if (!value) {
            obj.setCoords();
          }
        }
      });
      canvas.requestRenderAll();
    };

    canvas.on('selection:created', (e) => {
      setPerPixelTargetFind(e.selected, false);
    });

    canvas.on('selection:updated', (e) => {
      setPerPixelTargetFind(e.deselected, true);
      setPerPixelTargetFind(e.selected, false);
    });

    canvas.on('selection:cleared', (e) => {
      setPerPixelTargetFind(e.deselected, true);
    });

    const handlePathCreated = (e) => {
      if (e.path) {
        e.path.set({
          strokeUniform: true,
          perPixelTargetFind: true, // Enable pixel-perfect hit detection for selection
          targetFindTolerance: 5, // Add small tolerance for easier selection
          uniformScaling: false,  // Allow free scaling by default
          lockUniScaling: false,   // Allow free scaling on corner handles
          centeredRotation: true  // Ensure rotation happens around center point
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

    // Track when Fabric.js starts transforming (scaling/rotating) an object
    // Helper function to hide controls on active object
    const hideControls = () => {
      const activeObject = canvas.getActiveObject();
      if (activeObject) {
        // Store original hasControls state if not already stored
        if (activeObject._originalHasControls === undefined) {
          activeObject._originalHasControls = activeObject.hasControls;
        }
        activeObject.set('hasControls', false);
        canvas.requestRenderAll();
      }
    };

    // Helper function to show controls on active object
    const showControls = () => {
      const activeObject = canvas.getActiveObject();
      if (activeObject && activeObject._originalHasControls !== undefined) {
        activeObject.set('hasControls', activeObject._originalHasControls);
        delete activeObject._originalHasControls;
        canvas.requestRenderAll();
      }
    };

    const handleObjectScaling = (e) => {
      isFabricTransformingRef.current = true;

      // Hide controls immediately when scaling starts
      hideControls();

      // Check modifier key: Command on macOS, Control on Windows
      const originalEvent = e.e;
      if (!originalEvent) return;

      // Detect platform
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
        navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

      // Use Command on macOS, Control on Windows - STRICTLY one or the other, not both
      const isModifierPressed = isMac
        ? originalEvent.metaKey && !originalEvent.ctrlKey  // Mac: ONLY Command, ignore Control
        : originalEvent.ctrlKey && !originalEvent.metaKey; // Windows: ONLY Control, ignore Command

      // Get the object being scaled
      const obj = e.target;
      if (!obj) return;

      // Set uniformScaling dynamically based on modifier key
      if (isModifierPressed) {
        // Temporarily enable uniform scaling when modifier is pressed
        canvas.uniformScaling = true;
      } else {
        // Ensure uniform scaling is disabled for free scaling
        canvas.uniformScaling = false;
      }
    };

    const handleObjectRotating = (e) => {
      isFabricTransformingRef.current = true;

      // Hide controls immediately when rotating starts
      hideControls();
    };

    // Handle object moving event
    const handleObjectMoving = (e) => {
      isFabricTransformingRef.current = true;

      // Hide controls immediately when moving starts
      hideControls();
    };

    // Track when Fabric.js stops transforming - reset flag when modification completes
    const handleObjectModifiedEnd = (e) => {
      isFabricTransformingRef.current = false;

      // Show controls again when transformation ends
      showControls();

      // Reset canvas uniformScaling to default (false) after scaling ends
      if (canvas) {
        canvas.uniformScaling = false;
      }
    };

    // Helper function to check if a point is within an object's bounding box
    const isPointInBoundingBox = (point, obj) => {
      if (!obj) return false;

      // Get bounding box accounting for transformations
      const bounds = obj.getBoundingRect(true);

      const isInside = (
        point.x >= bounds.left &&
        point.x <= bounds.left + bounds.width &&
        point.y >= bounds.top &&
        point.y <= bounds.top + bounds.height
      );

      return isInside;
    };

    // Helper function to check if modifier key is pressed (Command on Mac, Control on Windows)
    const isModifierPressed = (event) => {
      // Check for Command (Mac) or Control (Windows/Linux)
      const result = event.metaKey || event.ctrlKey;

      return result;
    };

    // Helper function to check if point is in proximity to corner handles (15-20px buffer)
    // Returns the corner handle key if in proximity, null otherwise
    const getCornerHandleInProximity = (point, obj, buffer = 17.5) => {
      if (!obj || !obj.oCoords) {
        return null;
      }

      // Ensure coordinates are up to date
      try {
        obj.setCoords();
      } catch (e) {
        return null;
      }

      const corners = ['tl', 'tr', 'bl', 'br'];
      const handleSize = (obj.cornerSize || 12) / 2; // Half the handle size
      const totalRadius = handleSize + buffer; // Handle radius + buffer zone

      for (const cornerKey of corners) {
        const corner = obj.oCoords[cornerKey];
        if (!corner) continue;

        // Calculate distance from point to corner handle center
        const dx = point.x - corner.x;
        const dy = point.y - corner.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Check if point is in the buffer zone (outside handle but within buffer)
        if (distance > handleSize && distance <= totalRadius) {
          return cornerKey;
        }
      }

      return null;
    };

    // Helper function to check if point is directly on a corner handle
    const isPointOnCornerHandle = (point, obj) => {
      if (!obj || !obj.oCoords) return false;

      try {
        obj.setCoords();
      } catch (e) {
        return false;
      }

      const handleSize = (obj.cornerSize || 12) / 2;
      const corners = ['tl', 'tr', 'bl', 'br'];

      for (const cornerKey of corners) {
        const corner = obj.oCoords[cornerKey];
        if (!corner) continue;

        const dx = point.x - corner.x;
        const dy = point.y - corner.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= handleSize) {
          return true;
        }
      }

      return false;
    };

    // Helper function to check if point is on an edge handle (ml, mr, mt, mb)
    const isPointOnEdgeHandle = (point, obj) => {
      if (!obj || !obj.oCoords) return false;

      try {
        obj.setCoords();
      } catch (e) {
        return false;
      }

      const handleSize = 12; // Edge handle half-width/height
      const edges = ['ml', 'mr', 'mt', 'mb'];

      for (const edgeKey of edges) {
        const edge = obj.oCoords[edgeKey];
        if (!edge) continue;

        const dx = point.x - edge.x;
        const dy = point.y - edge.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= handleSize) {
          return true;
        }
      }

      return false;
    };

    // Helper function to check if point is on ANY control handle (corner or edge)
    const isPointOnAnyHandle = (point, obj) => {
      return isPointOnCornerHandle(point, obj) || isPointOnEdgeHandle(point, obj);
    };

    // Override Fabric.js findTarget to use pixel-perfect selection but allow bounding box manipulation
    const originalFindTarget = canvas.findTarget.bind(canvas);
    canvas.findTarget = function (e, skipGroup) {
      // CRITICAL: First check for control points (rotation handles, scaling handles)
      // This must happen BEFORE our custom logic to ensure control points work
      const activeObject = this.getActiveObject();
      if (activeObject && activeObject._findTargetCorner) {
        // Ensure control points are calculated before checking
        if (!activeObject.oCoords) {
          try {
            activeObject.setCoords();
          } catch (err) {
            // Silently ignore - object may not be fully initialized
          }
        }
        // Check if click is on a control point (only if oCoords exists and has valid data)
        if (activeObject.oCoords && activeObject.oCoords.tl) {
          try {
            const control = activeObject._findTargetCorner(e.e, true);
            if (control) {
              // Click is on a control point - use original findTarget to let Fabric.js handle it
              return originalFindTarget(e, skipGroup);
            }
          } catch (err) {
            // Silently ignore control point check errors
          }
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

    // Handle mouse down for pan tool with Drawboard PDF-style behavior
    const handleMouseDownForPan = (opt) => {
      const currentTool = toolRef.current;

      // Only handle pan tool (select tool has its own handler)
      if (currentTool !== 'pan') {
        return;
      }

      // No isTrusted check needed - we are not dispatching synthetic events anymore

      const pointer = canvas.getPointer(opt.e);
      const activeObject = canvas.getActiveObject();
      const nativeEvent = opt.e;

      // Reset drag tracking with CLIENT coordinates for stable panning
      panDragStartRef.current = {
        x: pointer.x, // Keep for object geometry checks
        y: pointer.y,
        clientX: nativeEvent.clientX,
        clientY: nativeEvent.clientY,
        lastClientX: nativeEvent.clientX, // Track last frame for delta scrolling
        lastClientY: nativeEvent.clientY
      };
      panDragDistanceRef.current = 0;
      panInteractionTypeRef.current = null;

      // PRIORITY 1: Check if click is on a Transform Handle (Grabber) of CURRENTLY SELECTED item
      // If we hit a handle, we want to Resize/Rotate, NOT Pan or Move body
      if (activeObject && activeObject._findTargetCorner) {
        // Ensure control points are calculated
        if (!activeObject.oCoords) {
          try { activeObject.setCoords(); } catch (e) { }
        }
        // Check if click is on a control point
        if (activeObject.oCoords) {
          const corner = activeObject._findTargetCorner(opt.e, true);

          if (corner) {
            // Hit a handle!
            panInteractionTypeRef.current = 'transform';
            // Fabric.js will handle the actual transform interaction automatically
            return;
          }
        }
      }

      // PRIORITY 2: Check for modifier-based rotation on selected item
      if (activeObject && isModifierPressed(nativeEvent)) {
        const isOnSelectedBody = isPointInBoundingBox(pointer, activeObject);
        const isOnHandle = isPointOnCornerHandle(pointer, activeObject);
        const isOutsideBody = !isOnSelectedBody;

        // If modifier is pressed and clicking OUTSIDE the object body (not on a handle), start rotation
        // Clicking INSIDE should allow normal move behavior (handled by PRIORITY 4)
        // Clicking ON handles should allow normal resize behavior (handled by PRIORITY 1)
        if (isOutsideBody && !isOnHandle) {
          panInteractionTypeRef.current = 'rotate';
          rotationStateRef.current = {
            object: activeObject,
            startAngle: activeObject.angle || 0,
            startPointer: { x: pointer.x, y: pointer.y },
            center: activeObject.getCenterPoint()
          };
          opt.e.preventDefault();
          opt.e.stopPropagation();
          return;
        }
        // If modifier is held but clicking inside, let it fall through to normal move behavior
      }

      // PRIORITY 3: Check for proximity-based rotation on selected item
      if (activeObject) {
        const proximityCorner = getCornerHandleInProximity(pointer, activeObject);
        const isOnHandle = isPointOnCornerHandle(pointer, activeObject);

        // If in proximity zone (but not directly on handle), allow rotation
        if (proximityCorner && !isOnHandle) {
          panInteractionTypeRef.current = 'rotate';
          rotationStateRef.current = {
            object: activeObject,
            startAngle: activeObject.angle || 0,
            startPointer: { x: pointer.x, y: pointer.y },
            center: activeObject.getCenterPoint()
          };
          opt.e.preventDefault();
          opt.e.stopPropagation();
          return;
        }
      }

      // PRIORITY 4: Check for body of currently selected item
      if (activeObject) {
        // Use Bounding Box hit testing for easier selection as requested
        const isOnSelectedBody = isPointInBoundingBox(pointer, activeObject);

        if (isOnSelectedBody) {
          // Click is on selected item body - allow move
          panInteractionTypeRef.current = 'move';
          // Prevent default to stop native browser behaviors
          opt.e.preventDefault();
          opt.e.stopPropagation();
          // Fabric.js will handle the drag automatically
          return;
        }
      }

      // PRIORITY 5: Check for body of unselected item
      const allObjects = canvas.getObjects();
      let hitUnselectedObject = null;

      // Find topmost unselected object whose geometry contains the click point
      for (let i = allObjects.length - 1; i >= 0; i--) {
        const obj = allObjects[i];
        if (!obj.selectable || !obj.visible) continue;
        if (obj === activeObject) continue; // Skip selected object (already checked)

        // USE BOUNDING BOX CHECK as requested by user
        if (isPointInBoundingBox(pointer, obj)) {
          hitUnselectedObject = obj;
          break;
        }
      }

      if (hitUnselectedObject) {
        // Click is on unselected item - track drag distance
        // If drag > 5px: pan the canvas
        // If drag < 5px: select the item
        panInteractionTypeRef.current = 'select-or-pan';
        // Store reference to the hit object
        panDragStartRef.current.hitObject = hitUnselectedObject;
        // Prevent default
        opt.e.preventDefault();
        opt.e.stopPropagation();
        return;
      }

      // PRIORITY 6: Empty space / Canvas
      // If there's an active object, check if Fabric is handling a transform
      if (activeObject) {
        // FIX: If click is inside bounding box, keep selection and allow move
        // This handles cases where PRIORITY 4 didn't catch it (e.g., boundary box visual area)
        const isOnSelectedBody = isPointInBoundingBox(pointer, activeObject);
        if (isOnSelectedBody) {
          // Click is on selected item body - allow move
          panInteractionTypeRef.current = 'move';
          opt.e.preventDefault();
          opt.e.stopPropagation();
          return;
        }

        // Set interaction type to 'wait-for-transform'
        panInteractionTypeRef.current = 'wait-for-transform';
        opt.e.preventDefault();
        opt.e.stopPropagation();
        return;
      }

      // Allow panning the canvas
      panInteractionTypeRef.current = 'pan';

      // If there's an active object, deselect it (user clicked empty space)
      if (activeObject) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }

      // We don't dispatch synthetic events anymore.
      // Panning will happen in mouseMove by updating container.scrollLeft/Top
    };

    // Handle mouse move for pan tool drag distance tracking and panning
    const handleMouseMoveForPan = (opt) => {
      const currentTool = toolRef.current;

      if (currentTool !== 'pan') {
        return;
      }

      const nativeEvent = opt.e;
      const pointer = canvas.getPointer(opt.e);

      if (!panDragStartRef.current) {
        return;
      }

      const start = panDragStartRef.current;

      // Handle rotation
      if (panInteractionTypeRef.current === 'rotate' && rotationStateRef.current) {
        const rotationState = rotationStateRef.current;
        const obj = rotationState.object;

        // Calculate angle from center to current pointer
        const center = rotationState.center;
        const currentAngle = Math.atan2(
          pointer.y - center.y,
          pointer.x - center.x
        ) * 180 / Math.PI;

        // Calculate angle from center to start pointer
        const startAngle = Math.atan2(
          rotationState.startPointer.y - center.y,
          rotationState.startPointer.x - center.x
        ) * 180 / Math.PI;

        // Calculate rotation delta
        const deltaAngle = currentAngle - startAngle;

        // Apply rotation
        const newAngle = rotationState.startAngle + deltaAngle;
        obj.set({
          angle: newAngle,
          dirty: true
        });
        obj.setCoords();
        canvas.requestRenderAll();

        opt.e.preventDefault();
        opt.e.stopPropagation();
        return;
      }

      // Calculate drag distance using CLIENT coordinates (stable during scroll)
      const dx = nativeEvent.clientX - start.clientX;
      const dy = nativeEvent.clientY - start.clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      panDragDistanceRef.current = distance;

      // Handle 'select-or-pan' -> switch to 'pan' if dragged far enough
      if (panInteractionTypeRef.current === 'select-or-pan' && distance > 5) {
        panInteractionTypeRef.current = 'pan';
        // Don't select the object, start panning instead
        panDragStartRef.current.hitObject = null;
      }

      // Check if Fabric.js is transforming
      const activeObject = canvas.getActiveObject();
      const isTransforming = isFabricTransformingRef.current ||
        (activeObject && (activeObject.isScaling || activeObject.isRotating));

      // Handle 'wait-for-transform' check
      if (panInteractionTypeRef.current === 'wait-for-transform') {
        if (isTransforming) {
          panInteractionTypeRef.current = 'transform';
        } else if (distance > 5) {
          // Not transforming and moved > 5px -> empty space panning
          panInteractionTypeRef.current = 'pan';
        }
      }

      // PERFORM PANNING
      if (panInteractionTypeRef.current === 'pan' && !isTransforming) {
        // Calculate delta since last frame
        const deltaX = nativeEvent.clientX - start.lastClientX;
        const deltaY = nativeEvent.clientY - start.lastClientY;

        // Find container and scroll it
        const canvasElement = canvasRef.current;
        let containerElement = document.querySelector('[data-testid="pdf-container"]');
        if (!containerElement && canvasElement) {
          let parent = canvasElement.parentElement;
          while (parent && parent !== document.body) {
            const style = window.getComputedStyle(parent);
            if (style.overflow === 'auto' || style.overflowY === 'auto' || style.overflowX === 'auto') {
              containerElement = parent;
              break;
            }
            parent = parent.parentElement;
          }
        }

        if (containerElement) {
          // Scroll in the opposite direction of drag (drag view)
          containerElement.scrollLeft -= deltaX;
          containerElement.scrollTop -= deltaY;
        }

        opt.e.preventDefault();
        opt.e.stopPropagation();
      }

      // Update last client position for next frame
      start.lastClientX = nativeEvent.clientX;
      start.lastClientY = nativeEvent.clientY;
    };

    // Handle mouse up for pan tool click selection
    const handleMouseUpForPan = (opt) => {
      const currentTool = toolRef.current;

      if (currentTool !== 'pan' || !panDragStartRef.current) {
        return;
      }

      // Save canvas after rotation (before resetting interaction type)
      const wasRotating = panInteractionTypeRef.current === 'rotate';

      // If we were tracking an unselected item and drag was < 5px, select it
      if (panInteractionTypeRef.current === 'select-or-pan' && panDragDistanceRef.current <= 5) {
        const hitObject = panDragStartRef.current.hitObject;
        if (hitObject && canvas.getObjects().includes(hitObject)) {
          canvas.setActiveObject(hitObject);
          canvas.requestRenderAll();
        }
      } else if (panInteractionTypeRef.current === 'pan') {
        // If we were panning and stopped, just reset.
        // No need to dispatch mouseup to container since we manually scrolled.
      } else if (panInteractionTypeRef.current === 'wait-for-transform') {
        // Clicked on object but didn't drag or transform -> deselect
        if (panDragDistanceRef.current <= 5 && !isFabricTransformingRef.current) {
          const activeObject = canvas.getActiveObject();
          if (activeObject) {
            canvas.discardActiveObject();
            canvas.requestRenderAll();
          }
        }
      }

      // Reset tracking
      panDragStartRef.current = null;
      panDragDistanceRef.current = 0;
      panInteractionTypeRef.current = null;
      rotationStateRef.current = null;

      // Save canvas after rotation
      if (wasRotating) {
        saveCanvas();
      }
    };

    const handleMouseDown = (opt) => {
      const currentTool = toolRef.current;
      const currentStrokeColor = strokeColorRef.current;
      const currentStrokeWidth = strokeWidthRef.current;
      const currentEraserMode = eraserModeRef.current;
      const { x, y } = canvas.getPointer(opt.e);
      const pointer = { x, y }; // Ensure pointer object exists

      // --- Callout Drag Handling ---
      const target = opt.target;
      // Use _currentTransform for Fabric.js v5 compatibility (getActiveTransform is v6+)
      if (target && target.data?.type === 'callout' && !canvas._currentTransform) {
        const isOverHandle = isPointOnAnyHandle ? isPointOnAnyHandle(pointer, target) : false;
        const isCmdCtrlHeld = opt.e.metaKey || opt.e.ctrlKey; // Cmd on Mac, Ctrl on Windows

        // If Cmd/Ctrl is held, allow moving the entire callout
        if (isCmdCtrlHeld && !isOverHandle) {
          isMovingEntireCalloutRef.current = true;
          target.lockMovementX = false;
          target.lockMovementY = false;
          canvas.setActiveObject(target);
          return; // Let Fabric handle the drag
        }

        if (!isOverHandle) {
          const textObj = target.getObjects().find(o => o.name === 'calloutText');
          const textBorder = target.getObjects().find(o => o.name === 'calloutTextBorder');
          if (textObj) {
            const groupMatrix = target.calcTransformMatrix();
            const invertedMatrix = fabric.util.invertTransform(groupMatrix);
            const localPointer = fabric.util.transformPoint(pointer, invertedMatrix);

            // Use border bounds if available (slightly larger than text), otherwise use text bounds
            const hitBox = textBorder || textObj;
            const hitLeft = hitBox.left;
            const hitTop = hitBox.top;
            const hitWidth = hitBox.width || hitBox.getScaledWidth();
            const hitHeight = hitBox.height || hitBox.getScaledHeight();

            if (
              localPointer.x >= hitLeft &&
              localPointer.x <= hitLeft + hitWidth &&
              localPointer.y >= hitTop &&
              localPointer.y <= hitTop + hitHeight
            ) {
              isDraggingCalloutTextRef.current = true;
              dragStartPointerRef.current = pointer;
              target.lockMovementX = true;
              target.lockMovementY = true;
            }
          }
        }
      }

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
        // Start erasing mode for drag-to-erase (both partial and entire modes)
        // We defer the actual erasure or splitting to mouseUp to allow the user to see the stroke
        const eraserRadius = eraserSizeRef.current || 20;
        isErasingRef.current = true;
        eraserPathRef.current = {
          startX: x,
          startY: y,
          points: [{ x, y }]
        };

        // Create visual eraser stroke overlay
        const eraserStroke = new Polyline([[x, y]], {
          stroke: 'rgba(74, 144, 226, 0.3)', // Light blue, semi-translucent
          strokeWidth: eraserRadius * 2,
          fill: 'transparent',
          selectable: false,
          evented: false,
          excludeFromExport: true,
          strokeUniform: true,
          strokeLineCap: 'round', // Round cap for smoother start
          strokeLineJoin: 'round' // Round join for smoother corners
        });

        canvas.add(eraserStroke);
        // Bring eraser stroke to front so it's visible above other objects
        canvas.bringToFront(eraserStroke);
        eraserStrokeVisualRef.current = eraserStroke;
        canvas.requestRenderAll();
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
          evented: false,
          uniformScaling: false,
          lockUniScaling: false   // Allow free scaling on corner handles
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
        temp = new Rect({ left: x, top: y, width: 1, height: 1, fill: 'rgba(0,0,0,0)', stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true, uniformScaling: false, lockUniScaling: false });
      } else if (currentTool === 'ellipse') {
        temp = new Circle({ left: x, top: y, radius: 1, fill: 'rgba(0,0,0,0)', stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true, originX: 'left', originY: 'top', uniformScaling: false, lockUniScaling: false });
      } else if (currentTool === 'line' || currentTool === 'underline' || currentTool === 'strikeout') {
        temp = new Line([x, y, x, y], { stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true, uniformScaling: false, lockUniScaling: false });
      } else if (currentTool === 'arrow') {
        temp = new Line([x, y, x, y], { stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true, uniformScaling: false, lockUniScaling: false });
      } else if (currentTool === 'callout') {
        // Use a temporary Line for visual feedback during drag (same as arrow)
        temp = new Line([x, y, x, y], { stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true, uniformScaling: false, lockUniScaling: false });
      } else if (currentTool === 'squiggly') {
        temp = new Polyline([[x, y]], { stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, fill: 'transparent', strokeUniform: true, uniformScaling: false, lockUniScaling: false });
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
      // --- Callout Text Drag Update ---
      if (isDraggingCalloutTextRef.current) {
        const pointer = canvas.getPointer(opt.e);
        const lastPointer = dragStartPointerRef.current;
        if (lastPointer) {
          const deltaX = pointer.x - lastPointer.x;
          const deltaY = pointer.y - lastPointer.y;

          const group = canvas.getActiveObject();
          if (group && group.data?.type === 'callout') {
            const text = group.getObjects().find(o => o.name === 'calloutText');
            const textBorder = group.getObjects().find(o => o.name === 'calloutTextBorder');
            if (text) {
              // Update Text Position
              text.set({
                left: text.left + deltaX,
                top: text.top + deltaY
              });

              // Update border to follow text
              if (textBorder) {
                textBorder.set({
                  left: text.left - 2,
                  top: text.top - 2
                });
              }

              // Reflow Line
              updateCalloutGroupConnections(group);

              dragStartPointerRef.current = pointer;
              canvas.requestRenderAll();
            }
          }
        }
        return;
      }

      const currentTool = toolRef.current;
      const currentEraserMode = eraserModeRef.current;

      // Handle eraser drag: collect points and update visual
      if (currentTool === 'eraser' && isErasingRef.current && eraserPathRef.current) {
        const { x, y } = canvas.getPointer(opt.e);
        const eraserPath = eraserPathRef.current;

        // Check minimum movement before adding point to avoid excess points
        const lastPoint = eraserPath.points.length > 0 ? eraserPath.points[eraserPath.points.length - 1] : null;
        const MIN_MOVE_DIST = 2;
        if (lastPoint) {
          const dx = x - lastPoint.x;
          const dy = y - lastPoint.y;
          if (dx * dx + dy * dy < MIN_MOVE_DIST * MIN_MOVE_DIST) {
            return; // Mouse barely moved, skip
          }
        }

        // Add point
        eraserPath.points.push({ x, y });

        // Update visual eraser stroke overlay
        if (eraserStrokeVisualRef.current) {
          const points = eraserStrokeVisualRef.current.get('points') || [];
          points.push([x, y]);
          eraserStrokeVisualRef.current.set({ points });
          // Ensure eraser stroke stays on top
          canvas.bringToFront(eraserStrokeVisualRef.current);
          eraserStrokeVisualRef.current.setCoords();
        }

        // Just render to show the stroke; do NOT erase yet
        canvas.requestRenderAll();
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
      // --- Callout Entire Movement End (Cmd/Ctrl+drag) ---
      if (isMovingEntireCalloutRef.current) {
        isMovingEntireCalloutRef.current = false;
        const group = canvas.getActiveObject();
        if (group && group.data?.type === 'callout') {
          // Re-lock movement - require Cmd/Ctrl for next move
          group.lockMovementX = true;
          group.lockMovementY = true;
          group.setCoords();
          triggerSave();
        }
        return;
      }

      // --- Callout Text Drag End ---
      if (isDraggingCalloutTextRef.current) {
        isDraggingCalloutTextRef.current = false;
        dragStartPointerRef.current = null;

        const group = canvas.getActiveObject();
        if (group && group.data?.type === 'callout') {
          // Keep movement locked - require Cmd/Ctrl to move entire callout
          group.lockMovementX = true;
          group.lockMovementY = true;
          group.addWithUpdate();
          triggerSave();
        }
        return;
      }

      const currentTool = toolRef.current;
      const currentEraserMode = eraserModeRef.current;

      // Handle erasing end (both partial and entire modes)
      if (currentTool === 'eraser' && isErasingRef.current) {
        const eraserPath = eraserPathRef.current;

        // Apply deletion on mouse up
        if (eraserPath && eraserPath.points.length > 0) {
          const eraserRadius = eraserSizeRef.current || 20;
          const objects = [...canvas.getObjects()];
          let needsRenderAndSave = false;

          for (const obj of objects) {
            // Skip eraser stroke itself
            if (obj === eraserStrokeVisualRef.current) continue;

            // Skip if not from current space
            const objSpaceId = obj.spaceId || null;
            if (selectedSpaceIdRef.current !== null && objSpaceId !== selectedSpaceIdRef.current) {
              continue;
            }

            // Skip highlights from partial logic if you want (or handle them if you want consistency)
            // Original logic handled highlights separately. We can keep that or unify.
            // For now, let's process them.

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

            // Highlights are special: they are always fully deleted if touched
            if (isHighlight) {
              // Check if eraser touched it
              const isTouching = eraserPath.points.some(point => isPointOnObject(point, obj, eraserRadius));

              if (isTouching) {
                // Delete highlight
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
                  needsRenderAndSave = true;

                  onHighlightDeletedRef.current(pageNumber, bounds, highlightId);
                } else {
                  canvas.remove(obj);
                  needsRenderAndSave = true;
                }
              }
              continue;
            }

            if (currentEraserMode === 'partial') {
              if (obj.type === 'path') {
                const wasErased = erasePathSegment(obj, eraserPath, eraserRadius, canvas);
                if (wasErased) needsRenderAndSave = true;
              } else {
                // Non-paths in partial mode: remove if touched (fallback)
                // Or should we ignore? Usually partial eraser on infinite objects (images/text) 
                // might behave like eraser or be ignored. Let's assume remove-if-touched for now to match consistency.
                const isTouching = eraserPath.points.some(point => isPointOnObject(point, obj, eraserRadius));
                if (isTouching) {
                  canvas.remove(obj);
                  needsRenderAndSave = true;
                }
              }
            } else {
              // Entire mode: Remove object if touched
              const isTouching = eraserPath.points.some(point => isPointOnObject(point, obj, eraserRadius));
              if (isTouching) {
                canvas.remove(obj);
                needsRenderAndSave = true;
              }
            }
          }

          if (needsRenderAndSave) {
            saveCanvas();
          }
        }

        // Remove visual eraser stroke overlay
        if (eraserStrokeVisualRef.current) {
          canvas.remove(eraserStrokeVisualRef.current);
          eraserStrokeVisualRef.current = null;
        }

        isErasingRef.current = false;
        eraserPathRef.current = null;
        canvas.requestRenderAll();
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
      } else if (currentTool === 'callout' && ds.tempObj.type === 'line') {
        const { x1, y1, x2, y2 } = ds.tempObj;

        // Remove temp line
        canvas.remove(ds.tempObj);

        // Create the complex Callout Group
        const group = createCalloutGroup(
          { x: x1, y: y1 },
          { x: x2, y: y2 },
          currentStrokeColor,
          strokeWidthRef.current,
          canvas
        );

        // Store current selectedSpaceId on the group
        if (selectedSpaceIdRef.current) {
          group.set({ spaceId: selectedSpaceIdRef.current });
        }
        if (selectedModuleIdRef.current) {
          group.set({ moduleId: selectedModuleIdRef.current });
        }

        canvas.add(group);
        canvas.setActiveObject(group);

        // Auto-focus the textbox
        // Find the textbox inside the group
        const textObj = group.getObjects().find(o => o.name === 'calloutText');
        if (textObj) {
          // Delay slightly to allow mouse event to settle and prevent focus theft
          setTimeout(() => {
            if (textObj.enterEditing) {
              textObj.enterEditing();
              textObj.selectAll();
              // Flag that we are in the post-creation phase
              justCreatedCalloutRef.current = true;
            }
            canvas.requestRenderAll();
          }, 50);
        }

        canvas.requestRenderAll();
      }
      ds.isDrawingShape = false;
      ds.tempObj = null;
      saveCanvas();
    };

    const handleDblClick = (opt) => {
      const target = opt.target;
      if (!target) return;

      // Handle Callout Text Editing (since subTargetCheck is false)
      if (target.data?.type === 'callout') {
        const textObj = target.getObjects().find(o => o.name === 'calloutText');
        if (textObj) {
          // We must enter editing mode on the IText, even if it's inside a group
          textObj.enterEditing();
          textObj.selectAll();
          canvas.requestRenderAll();
        }
      }

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

      const pointer = canvas.getPointer(e.e);

      // Only track if not clicking on an object (i.e., doing a drag selection)
      // In Fabric.js, e.target is the canvas when clicking empty space, or an object when clicking on one
      // We want to allow selection when clicking on empty canvas (e.target === canvas or e.target is canvas-like)
      // Only skip if clicking on an actual object (not canvas/background)
      // e.target will be an object with a type property when clicking on a Fabric object
      // Allow single-click selection of objects - we'll handle that in mouseUp
      // Only skip if this is clearly an object click (not a drag start)
      // Only skip if clicking on an actual object (not canvas/background)
      // e.target will be an object with a type property when clicking on a Fabric object
      // Allow single-click selection of objects - we'll handle that in mouseUp
      // Only skip if this is clearly an object click (not a drag start)
      const isObjectClick = e.target && e.target !== canvas && e.target.type !== undefined;

      // Sticky Selection: If clicking inside the bounding box of the CURRENTLY selected object,
      // keep it selected even if Fabric didn't detect a target (e.g. clicking empty space inside box).
      const activeObject = canvas.getActiveObject();
      if (!isObjectClick && activeObject) {
        // Check if point is inside the object's Oriented Bounding Box (aCoords)
        // Use pointerAbsolute which matches the coordinate system of aCoords
        const ptr = canvas.getPointer(e.e, true);
        const aCoords = activeObject.aCoords;

        if (aCoords) {
          const points = [aCoords.tl, aCoords.tr, aCoords.br, aCoords.bl];
          // fabricLib is the imported 'fabric' object
          const isInside = fabricLib.util.isPointInPolygon(ptr, points);

          if (isInside) {
            // It's a sticky hit! Prevent deselection.
            // We re-select the object in the next tick to override Fabric's native deselection
            setTimeout(() => {
              if (canvas.getActiveObject() !== activeObject) {
                canvas.setActiveObject(activeObject);
                canvas.renderAll();
              }
            }, 0);
            return; // Stop selection rectangle from appearing
          }
        }
      }

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
      // Note: pointer is already declared above (line 2164), so we reuse it
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
          // FIX: Before deselecting, check if click is inside the bounding box of the currently selected object
          const activeObject = canvas.getActiveObject();
          if (activeObject) {
            // Check if click is inside the bounding box (not just the geometry)
            const isOnSelectedBody = isPointInBoundingBox(pointer, activeObject);

            if (isOnSelectedBody) {
              // Click is inside bounding box - keep selection
              return; // Don't deselect
            }
          }

          // Clicked on empty space (outside bounding box) - deselect all
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }
        return;
      }

      // Handle selection rectangle case (drag selection)
      // Add null check to prevent errors if selectionRectRef was cleared elsewhere
      if (!selectionRectRef.current) {
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
    canvas.on('object:modified', (e) => {
      handleObjectModified(e);
      handleObjectModifiedEnd(e); // Also reset transform flag
    });
    canvas.on('object:scaling', handleObjectScaling);
    canvas.on('object:rotating', handleObjectRotating);
    canvas.on('object:moving', handleObjectMoving);
    canvas.on('path:created', handlePathCreated);
    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('mouse:dblclick', handleDblClick);

    // Global cursor update handler (works for both pan and select tools)
    const handleMouseMoveForCursor = (opt) => {
      const currentTool = toolRef.current;
      if (currentTool !== 'pan' && currentTool !== 'select') {
        return;
      }

      const nativeEvent = opt.e;
      const pointer = canvas.getPointer(opt.e);
      const activeObject = canvas.getActiveObject();

      // Only update cursor when not dragging
      if (panDragStartRef.current || selectionRectRef.current) {
        return;
      }

      // Context Menu Handlers - MOVED TO COMPONENT SCOPE
      // (Lines removed from here to fix ReferenceError)


      if (activeObject) {
        const proximityCorner = getCornerHandleInProximity(pointer, activeObject);
        const isOnAnyHandle = isPointOnAnyHandle(pointer, activeObject);
        const isOnCornerHandle = isPointOnCornerHandle(pointer, activeObject);
        const isOnEdgeHandle = isPointOnEdgeHandle(pointer, activeObject);
        const isModifierHeld = isModifierPressed(nativeEvent);
        const isOnBody = isPointInBoundingBox(pointer, activeObject);
        const isOutsideBody = !isOnBody;

        // STRICT CURSOR HIERARCHY - Show rotate cursor ONLY in Outer Zone:
        // 1. In proximity zone (outside body, near corners, but not on any handle), OR
        // 2. Modifier is held AND cursor is OUTSIDE the bounding box (not on any handle)
        // Priority: Handles > Inside Body (Move) > Outside Body (Rotate)
        if ((proximityCorner && !isOnAnyHandle) || (isModifierHeld && isOutsideBody && !isOnAnyHandle)) {
          // Use 'alias' cursor for rotation (circular arrow)
          canvas.defaultCursor = 'alias';
          canvas.hoverCursor = 'alias';
        } else {
          canvas.defaultCursor = 'default';
          canvas.hoverCursor = currentTool === 'pan' ? 'move' : 'default';
        }
        canvas.renderAll();
      } else {
        canvas.defaultCursor = 'default';
        canvas.hoverCursor = currentTool === 'pan' ? 'move' : 'default';
        canvas.renderAll();
      }
    };

    // Register pan tool handlers for Drawboard PDF-style behavior
    canvas.on('mouse:down', handleMouseDownForPan);
    canvas.on('mouse:move', handleMouseMoveForPan);
    canvas.on('mouse:up', handleMouseUpForPan);

    // Register selection tracking handlers LAST so they run FIRST (Fabric.js calls handlers in reverse order)
    canvas.on('mouse:down', handleMouseDownForSelection);
    canvas.on('mouse:move', handleMouseMoveForSelection);
    canvas.on('mouse:up', handleMouseUpForSelection);

    // Global cursor update (runs for both pan and select tools)
    canvas.on('mouse:move', handleMouseMoveForCursor);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
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
    canvas.selection = false;
    // Prevent Fabric.js from finding targets for eraser tool - we handle it ourselves with geometry checks
    canvas.skipTargetFind = tool === 'eraser';
    // Set cursor based on tool (Using 'none' for eraser to hide native cursor)
    const shapeToolsForCursor = ['rect', 'ellipse', 'line', 'arrow', 'callout', 'highlight', 'squiggly'];
    canvas.defaultCursor = (tool === 'eraser' ? 'none' : (tool === 'select' ? 'default' : (tool === 'text' ? 'text' : (shapeToolsForCursor.includes(tool) ? 'crosshair' : (canvas.isDrawingMode ? 'crosshair' : 'default')))));
    canvas.hoverCursor = tool === 'eraser' ? 'none' : (tool === 'select' ? 'move' : (tool === 'pan' ? 'grab' : 'move'));
    canvas.moveCursor = tool === 'eraser' ? 'none' : 'move';
    canvas.freeDrawingCursor = tool === 'eraser' ? 'none' : 'crosshair';

    // Force DOM usage to completely hide it if Fabric overrides
    if (tool === 'eraser') {
      canvas.upperCanvasEl.style.cursor = 'none';
      canvas.lowerCanvasEl.style.cursor = 'none';
    } else {
      // Reset to empty to let Fabric handle it
      canvas.upperCanvasEl.style.cursor = '';
      canvas.lowerCanvasEl.style.cursor = '';
    }
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
      const alreadyProcessed = processedHighlightsRef.current.has(highlightKey);
      if (!alreadyProcessed) {
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
            globalCompositeOperation: 'multiply',
            uniformScaling: false,
            lockUniScaling: false   // Allow free scaling on corner handles
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
            globalCompositeOperation: 'multiply',
            uniformScaling: false,
            lockUniScaling: false   // Allow free scaling on corner handles
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
        const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'data', 'name', 'highlightId', 'needsBIC', 'layer', 'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType']);
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
        const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'data', 'name', 'layer', 'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType']);
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

  // Keyboard handler for deleting selected annotations
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check if Backspace or Delete key is pressed
      if (e.key !== 'Backspace' && e.key !== 'Delete') {
        return;
      }

      // Check if user is typing in an input field, textarea, or contenteditable element
      const activeElement = document.activeElement;
      const isInputFocused = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable ||
        activeElement.contentEditable === 'true'
      );

      if (isInputFocused) {
        return; // Don't delete annotation if user is typing
      }

      const canvas = fabricRef.current;
      if (!canvas) return;

      // Get the active object (selected annotation)
      const activeObject = canvas.getActiveObject();
      if (!activeObject) return;

      // Prevent default browser behavior (e.g., going back in history)
      e.preventDefault();
      e.stopPropagation();

      // Check if this is a highlight that needs special handling
      const isHighlight = activeObject.highlightId != null;

      if (isHighlight && onHighlightDeletedRef.current) {
        // Get bounds for highlight deletion callback
        const bounds = activeObject.getBoundingRect(true);
        const highlightId = activeObject.highlightId;

        // Remove from canvas first
        canvas.remove(activeObject);
        canvas.discardActiveObject();
        canvas.requestRenderAll();

        // Clean up refs
        renderedHighlightsRef.current.delete(highlightId);
        const key = highlightId || `${activeObject.left}-${activeObject.top}-${activeObject.width}-${activeObject.height}`;
        processedHighlightsRef.current.delete(key);

        // Call highlight deletion callback
        onHighlightDeletedRef.current(pageNumber, bounds, highlightId);
      } else {
        // Regular annotation deletion
        canvas.remove(activeObject);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }

      // Save the canvas state
      try {
        const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'data', 'name', 'highlightId', 'needsBIC', 'globalCompositeOperation', 'layer', 'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType']);
        onSaveAnnotations(pageNumber, canvasJSON);
      } catch (error) {
        console.error(`[Page ${pageNumber}] Error saving after deletion:`, error);
      }
    };

    // Add event listener to document
    document.addEventListener('keydown', handleKeyDown, { capture: true });

    // Cleanup on unmount
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [pageNumber, onSaveAnnotations]);

  return (
    <div
      onContextMenu={handleContextMenu}
      onClick={() => {
        if (contextMenu) closeContextMenu();
        if (editModal) closeEditModal();
      }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: (tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'select' || tool === 'pan' || tool === 'text' || tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' || tool === 'callout' || tool === 'underline' || tool === 'strikeout' || tool === 'squiggly' || tool === 'note' || tool === 'highlight') ? 'auto' : 'none',
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

      {/* Context Menu */}
      {contextMenu && contextMenu.visible && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#ffffff',
            border: '1px solid #e0e0e0',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 10000,
            padding: '4px 0',
            minWidth: '140px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"'
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {contextMenu.type === 'annotation' && (
            <>
              <div
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', display: 'flex', alignItems: 'center' }}
                onClick={handleCut}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Cut
              </div>
              <div
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', display: 'flex', alignItems: 'center' }}
                onClick={handleCopy}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Copy
              </div>
            </>
          )}

          {/* Paste is available if clipboard has something */}
          {clipboardRef.current && (
            <div
              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', display: 'flex', alignItems: 'center' }}
              onClick={handlePaste}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              Paste
            </div>
          )}

          {contextMenu.type === 'annotation' && (
            <>
              <div style={{ height: '1px', background: '#e0e0e0', margin: '4px 0' }} />

              {/* Group/Ungroup */}
              {contextMenu.target && contextMenu.target.type === 'activeSelection' && (
                <div
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', display: 'flex', alignItems: 'center' }}
                  onClick={handleGroup}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  Group
                </div>
              )}
              {contextMenu.target && contextMenu.target.type === 'group' && (
                <div
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', display: 'flex', alignItems: 'center' }}
                  onClick={handleUngroup}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  Ungroup
                </div>
              )}

              <div
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', display: 'flex', alignItems: 'center' }}
                onClick={handleEdit}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Edit...
              </div>
            </>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editModal && editModal.visible && (
        <div
          ref={editModalRef}
          style={{
            position: 'fixed',
            top: editModal.y,
            left: editModal.x,
            background: '#ffffff',
            border: '1px solid #e0e0e0',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 10001,
            padding: '12px',
            minWidth: '200px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ marginBottom: '12px', fontSize: '14px', fontWeight: '500', color: '#333' }}>Edit Property</div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>Color</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="color"
                value={editValues.stroke}
                onChange={(e) => setEditValues(prev => ({ ...prev, stroke: e.target.value }))}
                style={{ width: '30px', height: '30px', borderRadius: '4px', border: '1px solid #ddd', padding: 0, cursor: 'pointer' }}
              />
              <input
                type="text"
                value={editValues.stroke}
                onChange={(e) => setEditValues(prev => ({ ...prev, stroke: e.target.value }))}
                style={{
                  width: '80px',
                  height: '30px',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  padding: '0 8px',
                  fontSize: '12px',
                  fontFamily: 'monospace'
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>Line Weight</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min="1"
                max="50"
                step="1"
                value={editValues.strokeWidth}
                onChange={(e) => setEditValues(prev => ({ ...prev, strokeWidth: parseInt(e.target.value, 10) || 1 }))}
                style={{ flex: 1, cursor: 'pointer' }}
              />
              <input
                type="number"
                min="1"
                max="50"
                value={editValues.strokeWidth}
                onChange={(e) => setEditValues(prev => ({ ...prev, strokeWidth: parseInt(e.target.value, 10) || 1 }))}
                style={{
                  width: '50px',
                  height: '30px',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  padding: '0 4px',
                  fontSize: '12px',
                  textAlign: 'center'
                }}
              />
              <span style={{ fontSize: '12px', color: '#666' }}>px</span>
            </div>
          </div>

          {editModal.object.data?.type === 'callout' && (
            <>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>Text Style</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                  {/* Text Color */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="color"
                      value={editValues.fill || '#000000'}
                      onChange={(e) => setEditValues(prev => ({ ...prev, fill: e.target.value }))}
                      style={{ width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #ddd', padding: 0, cursor: 'pointer' }}
                      title="Text Color"
                    />
                  </div>

                  {/* Font Family */}
                  <select
                    value={editValues.fontFamily || 'Arial'}
                    onChange={(e) => setEditValues(prev => ({ ...prev, fontFamily: e.target.value }))}
                    style={{ height: '24px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '12px', cursor: 'pointer' }}
                    title="Font Family"
                  >
                    <option value="Arial">Arial</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Courier New">Courier New</option>
                    <option value="Verdana">Verdana</option>
                  </select>

                  {/* Font Size */}
                  <input
                    type="number"
                    min="8"
                    max="72"
                    value={editValues.fontSize || 16}
                    onChange={(e) => setEditValues(prev => ({ ...prev, fontSize: parseInt(e.target.value, 10) }))}
                    style={{ width: '50px', height: '24px', borderRadius: '4px', border: '1px solid #ddd', padding: '0 4px', fontSize: '12px' }}
                    title="Font Size"
                  />

                  {/* Bold */}
                  <button
                    onClick={() => setEditValues(prev => ({ ...prev, fontWeight: prev.fontWeight === 'bold' ? 'normal' : 'bold' }))}
                    style={{
                      padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd',
                      background: editValues.fontWeight === 'bold' ? '#e6f7ff' : 'white',
                      fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                    }}
                  >B</button>

                  {/* Italic */}
                  <button
                    onClick={() => setEditValues(prev => ({ ...prev, fontStyle: prev.fontStyle === 'italic' ? 'normal' : 'italic' }))}
                    style={{
                      padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd',
                      background: editValues.fontStyle === 'italic' ? '#e6f7ff' : 'white',
                      fontStyle: 'italic', cursor: 'pointer', fontSize: '12px'
                    }}
                  >I</button>
                </div>

                {/* Alignment */}
                <div style={{ marginTop: '8px', display: 'flex', gap: '4px' }}>
                  {['left', 'center', 'right'].map(align => (
                    <button
                      key={align}
                      onClick={() => setEditValues(prev => ({ ...prev, textAlign: align }))}
                      style={{
                        flex: 1, padding: '4px', borderRadius: '4px', border: '1px solid #ddd',
                        background: editValues.textAlign === align ? '#e6f7ff' : 'white',
                        cursor: 'pointer', fontSize: '10px', textTransform: 'capitalize'
                      }}
                    >
                      {align}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fill Color (Background) */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>Fill Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="color"
                    value={editValues.fillColor === 'transparent' || !editValues.fillColor ? '#ffffff' : editValues.fillColor}
                    onChange={(e) => setEditValues(prev => ({ ...prev, fillColor: e.target.value }))}
                    style={{ width: '30px', height: '30px', borderRadius: '4px', border: '1px solid #ddd', padding: 0, cursor: 'pointer' }}
                    disabled={editValues.fillColor === 'transparent'}
                  />
                  <input
                    type="text"
                    value={editValues.fillColor === 'transparent' ? 'No Fill' : (editValues.fillColor || '#ffffff')}
                    onChange={(e) => {
                      if (e.target.value.toLowerCase() === 'no fill') {
                        setEditValues(prev => ({ ...prev, fillColor: 'transparent' }));
                      } else {
                        setEditValues(prev => ({ ...prev, fillColor: e.target.value }));
                      }
                    }}
                    style={{
                      width: '80px',
                      height: '30px',
                      borderRadius: '4px',
                      border: '1px solid #ddd',
                      padding: '0 8px',
                      fontSize: '12px',
                      fontFamily: 'monospace'
                    }}
                  />
                  <button
                    onClick={() => setEditValues(prev => ({ ...prev, fillColor: 'transparent' }))}
                    style={{
                      padding: '4px 8px', borderRadius: '4px', border: '1px solid #ddd',
                      background: editValues.fillColor === 'transparent' ? '#e6f7ff' : 'white',
                      cursor: 'pointer', fontSize: '11px'
                    }}
                  >No Fill</button>
                </div>
              </div>
            </>
          )}

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>Opacity</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round((editValues.opacity !== undefined ? editValues.opacity : 1) * 100)}
                onChange={(e) => setEditValues(prev => ({ ...prev, opacity: parseFloat(e.target.value) / 100 }))}
                style={{ flex: 1, cursor: 'pointer' }}
              />
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round((editValues.opacity !== undefined ? editValues.opacity : 1) * 100)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    setEditValues(prev => ({ ...prev, opacity: Math.min(100, Math.max(0, val)) / 100 }));
                  }
                }}
                style={{
                  width: '50px',
                  height: '30px',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  padding: '0 4px',
                  fontSize: '12px',
                  textAlign: 'center'
                }}
              />
              <span style={{ fontSize: '12px', color: '#666' }}>%</span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              onClick={cancelEdit}
              style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #ddd', background: 'white', cursor: 'pointer', fontSize: '12px' }}
            >
              Cancel
            </button>
            <button
              onClick={saveEdit}
              style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: '#007bff', color: 'white', cursor: 'pointer', fontSize: '12px' }}
            >
              Save
            </button>
          </div>
        </div>
      )}
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

