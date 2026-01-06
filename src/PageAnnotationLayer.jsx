import React, { useEffect, useRef, memo, useState, useCallback } from 'react';
import CalloutOverlay from './components/Callout';
import Icon from './Icons';

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
import { calculateViewportSafePosition } from './utils/menuPositioning';

// Apply custom Drawboard-style controls and selection visuals
configureFabricOverrides();

/**
 * Sanitizes a single text object to prevent stylesToArray errors
 * @param {fabric.Object} obj - The Fabric.js object to sanitize
 */
const sanitizeTextObject = (obj) => {
  if (!obj) return;
  if (obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'text') {
    // Clean up malformed styles - ensure styles is a proper object
    if (obj.styles) {
      const cleanStyles = {};
      Object.keys(obj.styles).forEach(lineIndex => {
        if (obj.styles[lineIndex] && typeof obj.styles[lineIndex] === 'object') {
          cleanStyles[lineIndex] = {};
          Object.keys(obj.styles[lineIndex]).forEach(charIndex => {
            if (obj.styles[lineIndex][charIndex] !== undefined) {
              cleanStyles[lineIndex][charIndex] = obj.styles[lineIndex][charIndex];
            }
          });
          // Remove empty line style objects
          if (Object.keys(cleanStyles[lineIndex]).length === 0) {
            delete cleanStyles[lineIndex];
          }
        }
      });
      obj.styles = cleanStyles;
    }
    // Ensure styles exists even if empty (prevents undefined errors)
    if (!obj.styles) {
      obj.styles = {};
    }
  }
};

/**
 * Sanitizes text objects on a Fabric.js canvas to prevent stylesToArray errors
 * This fixes "Cannot read properties of undefined (reading '0')" errors when serializing
 * Handles both top-level objects and text objects inside Groups (like callouts)
 * @param {fabric.Canvas} canvas - The Fabric.js canvas instance
 */
const sanitizeTextStyles = (canvas) => {
  if (!canvas) return;
  canvas.getObjects().forEach(obj => {
    // Handle text objects directly on canvas
    sanitizeTextObject(obj);

    // Handle text objects inside Groups (callouts, arrows with text, etc.)
    if (obj.type === 'group' && obj.getObjects) {
      obj.getObjects().forEach(child => {
        sanitizeTextObject(child);
        // Handle nested groups (rare but possible)
        if (child.type === 'group' && child.getObjects) {
          child.getObjects().forEach(grandchild => {
            sanitizeTextObject(grandchild);
          });
        }
      });
    }
  });
};

// --- Arrowhead Style Constants ---
export const ARROWHEAD_STYLES = {
  NONE: 'none',
  SOLID_TRIANGLE: 'solidTriangle',
  V_SHAPE: 'vShape',
  OPEN_CIRCLE: 'openCircle',
  OPEN_TRIANGLE: 'openTriangle',
  HORIZONTAL_LINE: 'horizontalLine'
};

export const ARROWHEAD_STYLE_LABELS = {
  [ARROWHEAD_STYLES.NONE]: 'None',
  [ARROWHEAD_STYLES.SOLID_TRIANGLE]: 'Solid Triangle',
  [ARROWHEAD_STYLES.V_SHAPE]: 'V-Shape',
  [ARROWHEAD_STYLES.OPEN_CIRCLE]: 'Open Circle',
  [ARROWHEAD_STYLES.OPEN_TRIANGLE]: 'Open Triangle',
  [ARROWHEAD_STYLES.HORIZONTAL_LINE]: 'Horizontal Line'
};

/**
 * Creates an arrowhead shape based on the specified style
 * @param {number} x - X position of the arrow tip
 * @param {number} y - Y position of the arrow tip
 * @param {number} angle - Angle in radians from line start to end
 * @param {string} color - Stroke/fill color
 * @param {number} strokeWidth - Line stroke width
 * @param {string} style - One of ARROWHEAD_STYLES
 * @returns {fabric.Object|null} The arrowhead object or null for NONE style
 */
const createArrowhead = (x, y, angle, color, strokeWidth, style = ARROWHEAD_STYLES.SOLID_TRIANGLE) => {
  // Scale arrowhead size based on stroke width
  const baseSize = Math.max(12, strokeWidth * 3);
  const angleDeg = (angle * 180) / Math.PI;

  switch (style) {
    case ARROWHEAD_STYLES.NONE:
      return null;

    case ARROWHEAD_STYLES.SOLID_TRIANGLE:
      return new Triangle({
        left: x,
        top: y,
        originX: 'center',
        originY: 'center',
        width: baseSize,
        height: baseSize,
        fill: color,
        stroke: color,
        strokeWidth: 0,
        angle: angleDeg + 90,
        name: 'arrowHead',
        selectable: false,
        evented: false
      });

    case ARROWHEAD_STYLES.V_SHAPE: {
      // V-shape: two lines forming a V pointing in the arrow direction
      const armLength = baseSize;
      const armAngle = Math.PI / 6; // 30 degrees spread

      // Calculate the two arm endpoints
      const arm1X = x - armLength * Math.cos(angle - armAngle);
      const arm1Y = y - armLength * Math.sin(angle - armAngle);
      const arm2X = x - armLength * Math.cos(angle + armAngle);
      const arm2Y = y - armLength * Math.sin(angle + armAngle);

      // Create a polyline for the V shape
      return new Polyline([
        { x: arm1X, y: arm1Y },
        { x: x, y: y },
        { x: arm2X, y: arm2Y }
      ], {
        fill: 'transparent',
        stroke: color,
        strokeWidth: Math.max(2, strokeWidth),
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        originX: 'center',
        originY: 'center',
        name: 'arrowHead',
        selectable: false,
        evented: false
      });
    }

    case ARROWHEAD_STYLES.OPEN_CIRCLE: {
      const radius = baseSize / 2;
      return new Circle({
        left: x,
        top: y,
        originX: 'center',
        originY: 'center',
        radius: radius,
        fill: 'transparent',
        stroke: color,
        strokeWidth: Math.max(2, strokeWidth),
        name: 'arrowHead',
        selectable: false,
        evented: false
      });
    }

    case ARROWHEAD_STYLES.OPEN_TRIANGLE:
      return new Triangle({
        left: x,
        top: y,
        originX: 'center',
        originY: 'center',
        width: baseSize,
        height: baseSize,
        fill: 'transparent',
        stroke: color,
        strokeWidth: Math.max(2, strokeWidth),
        angle: angleDeg + 90,
        name: 'arrowHead',
        selectable: false,
        evented: false
      });

    case ARROWHEAD_STYLES.HORIZONTAL_LINE: {
      // Perpendicular line at the end of the arrow
      const halfLength = baseSize / 2;
      const perpAngle = angle + Math.PI / 2; // Perpendicular to arrow direction

      const lineX1 = x + halfLength * Math.cos(perpAngle);
      const lineY1 = y + halfLength * Math.sin(perpAngle);
      const lineX2 = x - halfLength * Math.cos(perpAngle);
      const lineY2 = y - halfLength * Math.sin(perpAngle);

      return new Line([lineX1, lineY1, lineX2, lineY2], {
        stroke: color,
        strokeWidth: Math.max(2, strokeWidth),
        strokeLineCap: 'round',
        originX: 'center',
        originY: 'center',
        name: 'arrowHead',
        selectable: false,
        evented: false
      });
    }

    default:
      // Default to solid triangle
      return new Triangle({
        left: x,
        top: y,
        originX: 'center',
        originY: 'center',
        width: baseSize,
        height: baseSize,
        fill: color,
        stroke: color,
        strokeWidth: 0,
        angle: angleDeg + 90,
        name: 'arrowHead',
        selectable: false,
        evented: false
      });
  }
};

/**
 * Check if an object is an arrow (Line + arrowhead group, not a callout)
 * @param {fabric.Object} obj
 * @returns {boolean}
 */
const isArrowObject = (obj) => {
  if (obj.type !== 'group') return false;
  if (obj.data?.type === 'callout') return false;

  const objects = obj.getObjects();
  const hasLine = objects.some(o => o.type === 'line');
  const hasArrowHead = objects.some(o => o.name === 'arrowHead' || o.type === 'triangle');

  return hasLine && (hasArrowHead || objects.length === 1);
};

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

    return canvasPoint;
  };
};


// Helper to re-calculate callout line connections
// Uses Polyline for simpler coordinate handling inside groups
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

  // Update line points - use group-relative coordinates directly
  // Let Fabric.js calculate position/dimensions via _setPositionDimensions
  line.points = [
    { x: pTip.x, y: pTip.y },
    { x: pKnee.x, y: pKnee.y },
    { x: pText.x, y: pText.y }
  ];

  // Let Fabric recalculate left, top, width, height, pathOffset from points
  if (line._setPositionDimensions) {
    line._setPositionDimensions({});
  }

  line.setCoords();
  line.dirty = true;

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

  // Create line as a Polyline - we'll update its points after group creation
  // when all positions have been converted to group-relative coordinates
  // Don't set originX/originY - let Fabric use default 'center' for proper positioning
  const line = new Polyline([{ x: 0, y: 0 }, { x: 1, y: 1 }], {
    stroke: strokeColor,
    strokeWidth: strokeWidth,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    objectCaching: false,
    name: 'calloutLine'
  });

  // Mark child objects as non-selectable to prevent individual selection
  head.set({ selectable: false, evented: true }); // evented: true so clicks still register on the group
  line.set({ selectable: false, evented: true });
  text.set({ selectable: false, evented: true });
  textBorder.set({ selectable: false, evented: true });

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

    if (type === 'tip') {
      head.set({ left: localPoint.x, top: localPoint.y });
      // Line will be updated by updateCalloutGroupConnections at the end
    } else if (type === 'knee') {
      // Just update the stored knee position - line will be updated by updateCalloutGroupConnections
      target.data.knee = { x: localPoint.x, y: localPoint.y };
    }
    // Text Resize Logic - Standard corner resize behavior
    // Fabric.js Textbox height is auto-calculated from content, so we only resize width
    // Each corner anchors the opposite corner and resizes toward the drag point
    else if (type.startsWith('text')) {
      const textBorder = target.getObjects().find(o => o.name === 'calloutTextBorder');
      const minWidth = 40;

      const currentLeft = text.left;
      const currentWidth = text.width;
      const currentRight = currentLeft + currentWidth;

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

// --- Line & Arrow Control Helpers ---

// Reusable render function for control handles (shared with callout)
// Fabric.js Control render signature: (ctx, left, top, styleOverride, fabricObject)
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

// Check if midpoint is within snap threshold of the linear path between start and end
const checkSnapZone = (midpoint, start, end, threshold = 8) => {
  const distance = distanceToLineSegment(midpoint, start, end);
  const isSnapping = distance < threshold;
  // #region agent log
  fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:659',message:'checkSnapZone result',data:{distance,threshold,isSnapping,midpointX:midpoint.x,midpointY:midpoint.y},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  return isSnapping;
};

// Convert Line object to Polyline with 3 points (start, midpoint, end)
const convertLineToPolyline = (line, midpoint, canvas) => {
  const { x1, y1, x2, y2 } = line;
  const stroke = line.stroke;
  const strokeWidth = line.strokeWidth;
  const strokeUniform = line.strokeUniform;
  const opacity = line.opacity;
  const moduleId = line.moduleId;
  const regionId = line.regionId;
  const spaceId = line.spaceId;

  const polyline = new Polyline([
    { x: x1, y: y1 },
    { x: midpoint.x, y: midpoint.y },
    { x: x2, y: y2 }
  ], {
    stroke,
    strokeWidth,
    strokeUniform,
    fill: 'transparent',
    opacity,
    selectable: line.selectable,
    evented: line.evented,
    originX: line.originX,
    originY: line.originY,
    left: line.left,
    top: line.top,
    angle: line.angle,
    scaleX: line.scaleX,
    scaleY: line.scaleY
  });

  // Copy custom properties
  if (moduleId) polyline.moduleId = moduleId;
  if (regionId) polyline.regionId = regionId;
  if (spaceId) polyline.spaceId = spaceId;
  if (line.data) polyline.data = { ...line.data, isCurved: true };

  return polyline;
};

// Convert Polyline object back to Line when snapped straight
const convertPolylineToLine = (polyline) => {
  if (polyline.points.length !== 3) {
    // If not a 3-point polyline, calculate endpoints
    const first = polyline.points[0];
    const last = polyline.points[polyline.points.length - 1];
    return { x1: first.x, y1: first.y, x2: last.x, y2: last.y };
  }

  const [start, , end] = polyline.points;
  return {
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y
  };
};

// Calculate tangent angle at start or end of a curved polyline for arrowhead positioning
const calculateCurveTangent = (polyline, atEnd = true) => {
  if (!polyline || !polyline.points || polyline.points.length < 2) {
    return 0;
  }

  const points = polyline.points;
  let p1, p2;

  if (atEnd) {
    // Calculate tangent at the end point
    if (points.length >= 2) {
      p1 = points[points.length - 2];
      p2 = points[points.length - 1];
    } else {
      return 0;
    }
  } else {
    // Calculate tangent at the start point
    if (points.length >= 2) {
      p1 = points[0];
      p2 = points[1];
    } else {
      return 0;
    }
  }

  // Return angle in radians
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
};

// Position handler for line controls (for direct Line/Polyline objects)
const linePositionHandler = (type) => {
  return function (dim, finalMatrix, fabricObject) {
    // #region agent log
    fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:761',message:'linePositionHandler called',data:{type,fabricObjectType:fabricObject.type,hasFinalMatrix:!!finalMatrix},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    if (fabricObject.type === 'polyline') {
      // Handle Polyline (curved)
      const points = fabricObject.points || [];
      if (points.length < 2) return { x: 0, y: 0 };

      let point;
      if (type === 'start') {
        point = { x: points[0].x, y: points[0].y };
      } else if (type === 'midpoint') {
        if (fabricObject.data?.midpoint) {
          point = { x: fabricObject.data.midpoint.x, y: fabricObject.data.midpoint.y };
        } else if (points.length >= 3) {
          point = { x: points[1].x, y: points[1].y };
        } else {
          const mid = {
            x: (points[0].x + points[points.length - 1].x) / 2,
            y: (points[0].y + points[points.length - 1].y) / 2
          };
          point = mid;
        }
      } else if (type === 'end') {
        point = { x: points[points.length - 1].x, y: points[points.length - 1].y };
      }

      // Transform point to canvas space
      // Use finalMatrix if provided (Fabric.js passes it), otherwise calculate
      const matrix = finalMatrix || fabricObject.calcTransformMatrix();
      const result = finalMatrix 
        ? util.transformPoint(point, finalMatrix)
        : util.transformPoint(point, matrix);
      // #region agent log
      fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:790',message:'linePositionHandler polyline result',data:{type,localX:point.x,localY:point.y,canvasX:result.x,canvasY:result.y,usingFinalMatrix:!!finalMatrix},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      return result;
    } else if (fabricObject.type === 'line') {
      // Handle Line (straight)
      // For Line objects, return object-relative coordinates
      // Fabric.js will transform them using finalMatrix
      let point;
      if (type === 'start') {
        point = { x: fabricObject.x1, y: fabricObject.y1 };
      } else if (type === 'midpoint') {
        // Calculate geometric midpoint
        point = {
          x: (fabricObject.x1 + fabricObject.x2) / 2,
          y: (fabricObject.y1 + fabricObject.y2) / 2
        };
      } else if (type === 'end') {
        point = { x: fabricObject.x2, y: fabricObject.y2 };
      }

      // For Line objects, return object-relative coordinates
      // Fabric.js will apply finalMatrix transformation
      // #region agent log
      fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:812',message:'linePositionHandler line returning object-relative',data:{type,localX:point.x,localY:point.y,hasFinalMatrix:!!finalMatrix},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      return point;
    }

    return { x: 0, y: 0 };
  };
};

// Position handler for arrow controls (for Group objects containing Line/Polyline + arrowhead)
const arrowPositionHandler = (type) => {
  return function (dim, finalMatrix, fabricObject) {
    // #region agent log
    fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:818',message:'arrowPositionHandler called',data:{type,hasFinalMatrix:!!finalMatrix},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    const group = fabricObject;
    const line = group.getObjects().find(o => o.type === 'line' || o.type === 'polyline');
    if (!line) return { x: 0, y: 0 };

    let localPoint;

    if (line.type === 'polyline') {
      // Handle curved arrow (Polyline)
      const points = line.points || [];
      if (points.length < 2) return { x: 0, y: 0 };

      if (type === 'start') {
        localPoint = { x: points[0].x, y: points[0].y };
      } else if (type === 'midpoint') {
        if (group.data?.midpoint) {
          localPoint = { x: group.data.midpoint.x, y: group.data.midpoint.y };
        } else if (points.length >= 3) {
          localPoint = { x: points[1].x, y: points[1].y };
        } else {
          localPoint = {
            x: (points[0].x + points[points.length - 1].x) / 2,
            y: (points[0].y + points[points.length - 1].y) / 2
          };
        }
      } else if (type === 'end') {
        localPoint = { x: points[points.length - 1].x, y: points[points.length - 1].y };
      }
    } else {
      // Handle straight arrow (Line)
      if (type === 'start') {
        localPoint = { x: line.x1, y: line.y1 };
      } else if (type === 'midpoint') {
        if (group.data?.midpoint) {
          localPoint = { x: group.data.midpoint.x, y: group.data.midpoint.y };
        } else {
          localPoint = {
            x: (line.x1 + line.x2) / 2,
            y: (line.y1 + line.y2) / 2
          };
        }
      } else if (type === 'end') {
        localPoint = { x: line.x2, y: line.y2 };
      }
    }

    // Transform group-relative point to canvas space
    // Use finalMatrix if provided (Fabric.js passes it), otherwise calculate
    const matrix = finalMatrix || group.calcTransformMatrix();
    const result = finalMatrix
      ? util.transformPoint(localPoint, finalMatrix)
      : util.transformPoint(localPoint, matrix);
    // #region agent log
    fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:870',message:'arrowPositionHandler result',data:{type,localX:localPoint.x,localY:localPoint.y,canvasX:result.x,canvasY:result.y,usingFinalMatrix:!!finalMatrix},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    return result;
  };
};

// Setup custom 3-handle controls for Line objects
const setupLineControls = (line, canvas) => {
  // #region agent log
  fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:864',message:'setupLineControls called',data:{type:line.type,hasData:!!line.data,midpoint:line.data?.midpoint},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  // Disable default controls
  line.controls = {};
  // Note: Callout uses hasBorders: false but controls still work. However, for Line objects,
  // we might need borders enabled for controls to render. Let's try with borders enabled.
  line.set({ 
    hasControls: true, 
    hasBorders: true,
    selectable: true,
    evented: true
  });
  
  // #region agent log
  fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:905',message:'Line object properties after setup',data:{hasControls:line.hasControls,hasBorders:line.hasBorders,selectable:line.selectable,evented:line.evented,type:line.type,controlKeys:Object.keys(line.controls||{})},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
  // #endregion

  // Update line geometry handler
  const updateLineGeometry = (transform, x, y, handleType) => {
    // #region agent log
    fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:870',message:'updateLineGeometry called',data:{handleType,canvasX:x,canvasY:y,targetType:transform.target.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    const target = transform.target;
    const localPoint = getLocalPoint(transform, x, y);
    // #region agent log
    fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:873',message:'localPoint calculated',data:{localX:localPoint.x,localY:localPoint.y,handleType},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    if (handleType === 'start') {
      if (target.type === 'line') {
        target.set({ x1: localPoint.x, y1: localPoint.y });
      } else if (target.type === 'polyline' && target.points.length >= 3) {
        target.points[0] = { x: localPoint.x, y: localPoint.y };
        target.set({ points: target.points });
      }
    } else if (handleType === 'end') {
      if (target.type === 'line') {
        target.set({ x2: localPoint.x, y2: localPoint.y });
      } else if (target.type === 'polyline' && target.points.length >= 3) {
        target.points[target.points.length - 1] = { x: localPoint.x, y: localPoint.y };
        target.set({ points: target.points });
      }
    } else if (handleType === 'midpoint') {
      // Get current start and end points
      let startPoint, endPoint;
      if (target.type === 'line') {
        startPoint = { x: target.x1, y: target.y1 };
        endPoint = { x: target.x2, y: target.y2 };
      } else if (target.type === 'polyline' && target.points.length >= 2) {
        startPoint = { x: target.points[0].x, y: target.points[0].y };
        endPoint = { x: target.points[target.points.length - 1].x, y: target.points[target.points.length - 1].y };
      } else {
        return false;
      }

      // Check snap zone
      const geometricMidpoint = {
        x: (startPoint.x + endPoint.x) / 2,
        y: (startPoint.y + endPoint.y) / 2
      };

      const isSnapping = checkSnapZone(localPoint, startPoint, endPoint, 8);
      // #region agent log
      fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:907',message:'snap zone check',data:{isSnapping,midpointX:localPoint.x,midpointY:localPoint.y,startX:startPoint.x,startY:startPoint.y,endX:endPoint.x,endY:endPoint.y},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      if (isSnapping) {
        // Snap to straight line - convert Polyline back to Line if needed
        if (target.type === 'polyline') {
          const lineData = convertPolylineToLine(target);
          const stroke = target.stroke;
          const strokeWidth = target.strokeWidth;
          const strokeUniform = target.strokeUniform;
          const opacity = target.opacity;
          const moduleId = target.moduleId;
          const regionId = target.regionId;
          const spaceId = target.spaceId;

          // Create new Line object
          const newLine = new Line([lineData.x1, lineData.y1, lineData.x2, lineData.y2], {
            stroke,
            strokeWidth,
            strokeUniform,
            opacity,
            selectable: target.selectable,
            evented: target.evented,
            originX: target.originX,
            originY: target.originY,
            left: target.left,
            top: target.top,
            angle: target.angle,
            scaleX: target.scaleX,
            scaleY: target.scaleY
          });

          if (moduleId) newLine.moduleId = moduleId;
          if (regionId) newLine.regionId = regionId;
          if (spaceId) newLine.spaceId = spaceId;
          if (target.data) newLine.data = { ...target.data, isCurved: false };

          // Replace polyline with line in canvas
          const objects = canvas.getObjects();
          const index = objects.indexOf(target);
          if (index !== -1) {
            canvas.remove(target);
            canvas.insertAt(newLine, index);
            canvas.setActiveObject(newLine);
            
            // Re-setup controls on new line
            setupLineControls(newLine, canvas);
          }
        } else {
          // Already a line, just ensure midpoint is at geometric center
          // No need to update, it's already straight
        }
      } else {
        // Not snapping - update midpoint (curved state)
        if (target.type === 'line') {
          // Convert Line to Polyline
          const polyline = convertLineToPolyline(target, localPoint, canvas);
          
          // Replace line with polyline in canvas
          const objects = canvas.getObjects();
          const index = objects.indexOf(target);
          if (index !== -1) {
            canvas.remove(target);
            canvas.insertAt(polyline, index);
            canvas.setActiveObject(polyline);
            
            // Store midpoint in data
            if (!polyline.data) polyline.data = {};
            polyline.data.midpoint = { x: localPoint.x, y: localPoint.y };
            
            // Re-setup controls on new polyline
            setupLineControls(polyline, canvas);
          }
        } else if (target.type === 'polyline' && target.points.length >= 3) {
          // Update midpoint in polyline
          target.points[1] = { x: localPoint.x, y: localPoint.y };
          target.set({ points: target.points });
          
          // Store midpoint in data
          if (!target.data) target.data = {};
          target.data.midpoint = { x: localPoint.x, y: localPoint.y };
        }
      }
    }

    target.setCoords();
    return true;
  };

  // Define render function for controls (must be local, not global reference)
  // IMPORTANT: left/top are already in the correct coordinate space - use translate like callout
  const renderControlHandle = (ctx, left, top, styleOverride, fabricObject) => {
    // #region agent log
    fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1030',message:'renderControlHandle LINE called',data:{left,top,hasCtx:!!ctx,canvasWidth:ctx?.canvas?.width,canvasHeight:ctx?.canvas?.height},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
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

  // Start handle
  line.controls.start = new Control({
    x: -0.5, y: -0.5,
    cursorStyle: 'crosshair',
    actionHandler: (e, t, x, y) => updateLineGeometry(t, x, y, 'start'),
    positionHandler: linePositionHandler('start'),
    render: renderControlHandle,
    visible: true
  });

  // Midpoint handle
  line.controls.midpoint = new Control({
    x: 0, y: 0,
    cursorStyle: 'crosshair',
    actionHandler: (e, t, x, y) => updateLineGeometry(t, x, y, 'midpoint'),
    positionHandler: linePositionHandler('midpoint'),
    render: renderControlHandle,
    visible: true
  });

  // End handle
  line.controls.end = new Control({
    x: 0.5, y: 0.5,
    cursorStyle: 'crosshair',
    actionHandler: (e, t, x, y) => updateLineGeometry(t, x, y, 'end'),
    positionHandler: linePositionHandler('end'),
    render: renderControlHandle,
    visible: true
  });
  // #region agent log
  fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1015',message:'setupLineControls completed',data:{controlCount:Object.keys(line.controls).length,hasStart:!!line.controls.start,hasMidpoint:!!line.controls.midpoint,hasEnd:!!line.controls.end,startVisible:line.controls.start?.visible,midpointVisible:line.controls.midpoint?.visible,endVisible:line.controls.end?.visible},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
  // #endregion
};

// Setup custom 3-handle controls for Arrow Group objects
const setupArrowControls = (group, canvas) => {
  // #region agent log
  const lineObj = group.getObjects().find(o => o.type === 'line' || o.type === 'polyline');
  fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1018',message:'setupArrowControls called',data:{lineType:lineObj?.type,hasData:!!group.data,midpoint:group.data?.midpoint,arrowheadStyle:group.data?.arrowheadStyle},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  // Disable default controls
  group.controls = {};
  // Note: Callout uses hasBorders: false but controls still work for Groups.
  // For arrows (which are Groups), we can try with borders disabled like callout.
  group.set({ hasControls: true, hasBorders: false });

  // Initialize midpoint if not present
  if (!group.data) group.data = {};
  if (!group.data.midpoint) {
    const line = group.getObjects().find(o => o.type === 'line' || o.type === 'polyline');
    if (line && line.type === 'line') {
      group.data.midpoint = null; // Will be calculated on-demand when straight
      group.data.isCurved = false;
    }
  }

  // Update arrow geometry handler
  const updateArrowGeometry = (transform, x, y, handleType) => {
    // #region agent log
    fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1035',message:'updateArrowGeometry called',data:{handleType,canvasX:x,canvasY:y},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    const target = transform.target; // The Group
    const localPoint = getLocalPoint(transform, x, y); // Mouse pos in Group coords
    // #region agent log
    fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1038',message:'arrow localPoint calculated',data:{localX:localPoint.x,localY:localPoint.y,handleType},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    const line = target.getObjects().find(o => o.type === 'line' || o.type === 'polyline');
    const head = target.getObjects().find(o => o.name === 'arrowHead' || (o.type === 'triangle' && !o.name));
    if (!line) return false;

    if (handleType === 'start') {
      if (line.type === 'line') {
        line.set({ x1: localPoint.x, y1: localPoint.y });
      } else if (line.type === 'polyline' && line.points.length >= 3) {
        line.points[0] = { x: localPoint.x, y: localPoint.y };
        line.set({ points: line.points });
      }
    } else if (handleType === 'end') {
      if (line.type === 'line') {
        line.set({ x2: localPoint.x, y2: localPoint.y });
      } else if (line.type === 'polyline' && line.points.length >= 3) {
        const lastIndex = line.points.length - 1;
        line.points[lastIndex] = { x: localPoint.x, y: localPoint.y };
        line.set({ points: line.points });
      }
      
      // Update arrowhead position and angle
      if (head) {
        head.set({ left: localPoint.x, top: localPoint.y });
        let angle;
        if (line.type === 'polyline') {
          angle = calculateCurveTangent(line, true); // Calculate tangent at end
        } else {
          const { x1, y1, x2, y2 } = line;
          angle = Math.atan2(y2 - y1, x2 - x1);
        }
        const angleDeg = (angle * 180) / Math.PI;
        head.set({ angle: angleDeg + 90 });
      }
    } else if (handleType === 'midpoint') {
      // Get current start and end points
      let startPoint, endPoint;
      if (line.type === 'line') {
        startPoint = { x: line.x1, y: line.y1 };
        endPoint = { x: line.x2, y: line.y2 };
      } else if (line.type === 'polyline' && line.points.length >= 2) {
        startPoint = { x: line.points[0].x, y: line.points[0].y };
        endPoint = { x: line.points[line.points.length - 1].x, y: line.points[line.points.length - 1].y };
      } else {
        return false;
      }

      // Check snap zone
      const geometricMidpoint = {
        x: (startPoint.x + endPoint.x) / 2,
        y: (startPoint.y + endPoint.y) / 2
      };

      const isSnapping = checkSnapZone(localPoint, startPoint, endPoint, 8);
      // #region agent log
      fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1096',message:'arrow snap zone check',data:{isSnapping,midpointX:localPoint.x,midpointY:localPoint.y,startX:startPoint.x,startY:startPoint.y,endX:endPoint.x,endY:endPoint.y},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      if (isSnapping) {
        // Snap to straight line - convert Polyline back to Line if needed
        if (line.type === 'polyline') {
          const lineData = convertPolylineToLine(line);
          const stroke = line.stroke;
          const strokeWidth = line.strokeWidth;
          const strokeUniform = line.strokeUniform;
          const opacity = line.opacity;

          // Create new Line object
          const newLine = new Line([lineData.x1, lineData.y1, lineData.x2, lineData.y2], {
            stroke,
            strokeWidth,
            strokeUniform,
            fill: 'transparent',
            opacity,
            selectable: false,
            evented: true,
            originX: 'center',
            originY: 'center'
          });

          // Remove old line and add new one
          target.remove(line);
          target.add(newLine);

          // Update arrowhead angle for straight line
          if (head) {
            const angle = Math.atan2(lineData.y2 - lineData.y1, lineData.x2 - lineData.x1);
            const angleDeg = (angle * 180) / Math.PI;
            head.set({ angle: angleDeg + 90 });
          }

          // Update data
          target.data.midpoint = null;
          target.data.isCurved = false;
        } else {
          // Already a line, midpoint is at geometric center
          target.data.midpoint = null;
        }
      } else {
        // Not snapping - update midpoint (curved state)
        if (line.type === 'line') {
          // Convert Line to Polyline
          const stroke = line.stroke;
          const strokeWidth = line.strokeWidth;
          const strokeUniform = line.strokeUniform;
          const opacity = line.opacity;

          const newPolyline = new Polyline([
            { x: line.x1, y: line.y1 },
            { x: localPoint.x, y: localPoint.y },
            { x: line.x2, y: line.y2 }
          ], {
            stroke,
            strokeWidth,
            strokeUniform,
            fill: 'transparent',
            opacity,
            selectable: false,
            evented: true,
            originX: 'center',
            originY: 'center'
          });

          // Remove old line and add new polyline
          target.remove(line);
          target.add(newPolyline);

          // Update arrowhead angle for curved line
          if (head) {
            const angle = calculateCurveTangent(newPolyline, true);
            const angleDeg = (angle * 180) / Math.PI;
            head.set({ angle: angleDeg + 90 });
          }

          // Update data
          target.data.midpoint = { x: localPoint.x, y: localPoint.y };
          target.data.isCurved = true;
        } else if (line.type === 'polyline' && line.points.length >= 3) {
          // Update midpoint in polyline
          line.points[1] = { x: localPoint.x, y: localPoint.y };
          line.set({ points: line.points });

          // Update arrowhead angle
          if (head) {
            const angle = calculateCurveTangent(line, true);
            const angleDeg = (angle * 180) / Math.PI;
            head.set({ angle: angleDeg + 90 });
          }

          // Update data
          target.data.midpoint = { x: localPoint.x, y: localPoint.y };
          target.data.isCurved = true;
        }
      }

      // Update group
      target.addWithUpdate();
    }

    target.setCoords();
    return true;
  };

  // Define render function for controls (must be local, not global reference)
  // IMPORTANT: left/top are already in the correct coordinate space - use translate like callout
  const renderControlHandle = (ctx, left, top, styleOverride, fabricObject) => {
    // #region agent log
    fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1271',message:'renderControlHandle ARROW called',data:{left,top,hasCtx:!!ctx,canvasWidth:ctx?.canvas?.width,canvasHeight:ctx?.canvas?.height},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
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

  // Start handle
  group.controls.start = new Control({
    x: -0.5, y: -0.5,
    cursorStyle: 'crosshair',
    actionHandler: (e, t, x, y) => updateArrowGeometry(t, x, y, 'start'),
    positionHandler: arrowPositionHandler('start'),
    render: renderControlHandle,
    visible: true
  });

  // Midpoint handle
  group.controls.midpoint = new Control({
    x: 0, y: 0,
    cursorStyle: 'crosshair',
    actionHandler: (e, t, x, y) => updateArrowGeometry(t, x, y, 'midpoint'),
    positionHandler: arrowPositionHandler('midpoint'),
    render: renderControlHandle,
    visible: true
  });

  // End handle
  group.controls.end = new Control({
    x: 0.5, y: 0.5,
    cursorStyle: 'crosshair',
    actionHandler: (e, t, x, y) => updateArrowGeometry(t, x, y, 'end'),
    positionHandler: arrowPositionHandler('end'),
    render: renderControlHandle,
    visible: true
  });
  // #region agent log
  fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:1214',message:'setupArrowControls completed',data:{controlCount:Object.keys(group.controls).length,hasStart:!!group.controls.start,hasMidpoint:!!group.controls.midpoint,hasEnd:!!group.controls.end},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
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

// Helper function to calculate distance from a point to a line segment
const distanceToLineSegment = (point, lineStart, lineEnd) => {
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

  if (pathObj.type !== 'path') {
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
  arrowheadStyle = ARROWHEAD_STYLES.SOLID_TRIANGLE,
  annotations = null,
  onSaveAnnotations = () => { },
  onToolChange = () => { },
  highlightColor = 'rgba(255, 193, 7, 0.3)',
  newHighlights = null, // Array of {x, y, width, height} to add
  highlightsToRemove = null, // Array of {x, y, width, height} to remove
  onHighlightCreated = null, // Callback for when highlight tool creates a rectangle
  onHighlightDeleted = null, // Callback for when highlight is deleted via eraser
  onHighlightClicked = null, // Callback for when a highlight is clicked (reverse navigation)
  selectedSpaceId = null, // Space ID to filter annotations by (used for background annotation lightbulb)
  activeSpaceId = null, // Active space ID - region-scoped annotations only visible when this is not null
  selectedModuleId = null, // Module ID to filter annotations by
  selectedCategoryId = null, // Category ID to keep highlights visible when panel is hidden
  activeRegions = null,
  spaces = [], // Array of spaces to look up region-to-space relationships
  getRegionLightbulbState = null, // Function to get lightbulb state for a region: (spaceId, pageId) => boolean
  activeRegionId = null, // NEW: ID of currently active region for scoping
  isRegionSelectionActive = false, // NEW: Whether region selection/editing is currently active
  eraserMode = 'partial', // 'partial' | 'entire'
  eraserSize = 20, // Eraser radius in pixels
  showSurveyPanel = false, // Whether survey mode is active
  isRegionOverlayEnabled = null, // Function to check if overlay is enabled: (spaceId, pageId, page) => boolean
  layerVisibility = { 'native': true, 'pdf-annotations': true }, // Layer visibility toggles
  // Callout overlay props
  callouts = [], // Array of all callout objects
  setCallouts = () => { }, // Update callouts callback
  selectedCalloutId = null, // Currently selected callout ID
  setSelectedCalloutId = () => { }, // Set selected callout callback
  clipboardCallout = null, // Clipboard callout for cut/copy/paste
  clipboardCalloutType = null, // 'cut' | 'copy'
  onCutCallout = () => { }, // Cut callout handler
  onCopyCallout = () => { }, // Copy callout handler
  onPasteCallout = () => { }, // Paste callout handler
  // Properties panel positioning props
  middleAreaBounds = { top: 0, height: 500 }, // Bounds of the middle area ({top, height})
  surveyPanelWidth = 0, // Width of survey panel (0 when closed, 320 when open, 48 when collapsed)
  // Note: selectedSpaceId, selectedModuleId, and showSurveyPanel are already defined above
  // Page operation props for context menu
  onDuplicatePage = () => { },
  onRotatePageCW = () => { },
  onRotatePageCCW = () => { },
  onInsertBlankPage = () => { },
  pageClipboard = null, // { pageNumber, type: 'cut' | 'copy' } | null
  onPastePageHere = () => { },
}) => {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const processedHighlightsRef = useRef(new Set());
  const isInitializedRef = useRef(false);
  const drawingStateRef = useRef({ isDrawingShape: false, startX: 0, startY: 0, tempObj: null });
  const justFinishedDrawingRef = useRef(false);
  const toolRef = useRef(tool);
  const strokeColorRef = useRef(strokeColor);
  const arrowheadStyleRef = useRef(arrowheadStyle);

  // Keep refs in sync with props
  useEffect(() => {
    toolRef.current = tool;
    strokeColorRef.current = strokeColor;
    strokeWidthRef.current = strokeWidth;
    arrowheadStyleRef.current = arrowheadStyle;
  }, [tool, strokeColor, strokeWidth, arrowheadStyle]);

  useEffect(() => {
    calloutsRef.current = callouts;
    setCalloutsRef.current = setCallouts;
    selectedSpaceIdRef.current = selectedSpaceId;
    activeSpaceIdRef.current = activeSpaceId;
    selectedModuleIdRef.current = selectedModuleId;
    showSurveyPanelRef.current = showSurveyPanel;
    activeRegionIdRef.current = activeRegionId;
    spacesRef.current = spaces;
    getRegionLightbulbStateRef.current = getRegionLightbulbState;
    isRegionOverlayEnabledRef.current = isRegionOverlayEnabled;
  }, [callouts, setCallouts, selectedSpaceId, activeSpaceId, selectedModuleId, showSurveyPanel, activeRegionId, spaces, getRegionLightbulbState, isRegionOverlayEnabled, pageNumber]);
  const strokeWidthRef = useRef(strokeWidth);
  const justCreatedCalloutRef = useRef(false);
  const onHighlightCreatedRef = useRef(onHighlightCreated);
  const onHighlightDeletedRef = useRef(onHighlightDeleted);
  const onHighlightClickedRef = useRef(onHighlightClicked);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const activeSpaceIdRef = useRef(activeSpaceId);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const showSurveyPanelRef = useRef(showSurveyPanel);
  const activeRegionIdRef = useRef(activeRegionId);
  const spacesRef = useRef(spaces);
  const getRegionLightbulbStateRef = useRef(getRegionLightbulbState);
  const isRegionOverlayEnabledRef = useRef(isRegionOverlayEnabled);

  // Helper function to determine if regionId should be assigned to new annotations
  // Only assign regionId if ALL of the following are true:
  // 1. A space is active
  // 2. The CURRENT PAGE is assigned to that space
  // 3. The current page HAS a region
  // 4. The OVERLAY toggle is ON (isRegionOverlayEnabled returns true)
  // This ensures annotations created on pages without regions, or with overlay OFF, remain "global"
  const shouldAssignRegionId = useCallback(() => {
    const spaceId = selectedSpaceIdRef.current;
    if (!spaceId) return false;

    const space = spacesRef.current?.find(s => s.id === spaceId);
    if (!space) return false;

    const assignedPage = space.assignedPages?.find(p => p.pageId === pageNumber);
    if (!assignedPage) return false;

    const region = assignedPage.regions?.[0];
    if (!region) return false;

    // Check if the OVERLAY toggle is ON (this is what determines regionId assignment)
    const isOverlayEnabled = isRegionOverlayEnabledRef.current;
    if (isOverlayEnabled) {
      const isOverlayOn = isOverlayEnabled(spaceId, pageNumber, assignedPage);
      if (!isOverlayOn) return false;
    }

    if (!activeRegionIdRef.current) return false;

    return true;
  }, [pageNumber]);
  const calloutsRef = useRef(callouts);
  const setCalloutsRef = useRef(setCallouts);
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
  const contextMenuJustOpenedRef = useRef(false); // Track if context menu was just opened to prevent immediate closing
  const contextMenuRef = useRef(null); // Ref for the context menu element
  const contextMenuPositionAdjustedRef = useRef(false); // Track if context menu position has been adjusted
  // Clipboard for Cut/Copy/Paste - using Ref to persist across renders without triggering them
  const clipboardRef = useRef(null);
  // Edit Modal State
  const [editModal, setEditModal] = useState(null); // { x, y, object }
  // Callout selection rect for drag selection
  const [calloutSelectionRect, setCalloutSelectionRect] = useState(null);
  const [editValues, setEditValues] = useState({ stroke: '#000000', strokeWidth: 1, opacity: 1, arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE });
  const editModalRef = useRef(null);
  const editModalPositionAdjustedRef = useRef(false); // Track if edit modal position has been adjusted
  // Edit Modal Drag State
  const isDraggingModalRef = useRef(false);
  const modalDragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });



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
    sanitizeTextStyles(canvas);
    const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'regionId', 'data', 'name', 'highlightId', 'needsBIC', 'globalCompositeOperation', 'layer', 'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType']);
    onSaveAnnotations(pageNumber, canvasJSON);
  }, [pageNumber, onSaveAnnotations]);

  // Helper to calculate distance from point to line segment
  const distanceToLineSegment = useCallback((point, lineStart, lineEnd) => {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

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
  }, []);

  // Helper to detect if a point is on a callout (for context menu)
  const isPointOnCallout = useCallback((clickPos, callout, pageWidth, pageHeight) => {
    const toPixels = (pt) => ({ x: pt.x * pageWidth, y: pt.y * pageHeight });

    // Check text box bounds
    const tbLeft = callout.textBoxPosition.x * pageWidth;
    const tbTop = callout.textBoxPosition.y * pageHeight;
    const tbRight = tbLeft + callout.textBoxWidth * pageWidth;
    const tbBottom = tbTop + callout.textBoxHeight * pageHeight;
    if (clickPos.x >= tbLeft && clickPos.x <= tbRight &&
      clickPos.y >= tbTop && clickPos.y <= tbBottom) {
      return true;
    }

    // Check arrow tip (20px radius)
    const tip = toPixels(callout.arrowTip);
    if (Math.hypot(clickPos.x - tip.x, clickPos.y - tip.y) < 20) {
      return true;
    }

    // Check knee (20px radius)
    const knee = toPixels(callout.knee);
    if (Math.hypot(clickPos.x - knee.x, clickPos.y - knee.y) < 20) {
      return true;
    }

    // Check line segments (10px threshold)
    // Line from text box edge to knee
    const textBoxCenter = {
      x: (tbLeft + tbRight) / 2,
      y: (tbTop + tbBottom) / 2
    };
    if (distanceToLineSegment(clickPos, textBoxCenter, knee) < 10) {
      return true;
    }

    // Line from knee to arrow tip
    if (distanceToLineSegment(clickPos, knee, tip) < 10) {
      return true;
    }

    return false;
  }, [distanceToLineSegment]);

  // Context Menu Handlers
  const handleContextMenu = useCallback((e, fabricTarget = null) => {
    // Only show context menu if not in drawing mode or other active interaction
    if (drawingStateRef.current.isDrawingShape || panInteractionTypeRef.current) {
      return;
    }

    if (e && e.preventDefault) {
      e.preventDefault();
    }
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Get pointer position relative to canvas
    // If fabricTarget is provided (from Fabric.js event), use it directly
    // Otherwise, try to find target using the event
    let target = fabricTarget || (e ? canvas.findTarget(e, false) : null);

    // If target is a child of a callout group, use the parent group instead
    if (target && !target.data?.type && target.group && target.group.data?.type === 'callout') {
      target = target.group;
    }

    // 1. Check if we clicked on a Fabric annotation
    if (target) {
      if (!canvas.getActiveObjects().includes(target)) {
        canvas.setActiveObject(target);
        canvas.requestRenderAll();
      }

      const safePosition = calculateViewportSafePosition(e.clientX, e.clientY, {
        estimatedWidth: 200,
        estimatedHeight: 300
      });
      setContextMenu({
        visible: true,
        x: safePosition.x,
        y: safePosition.y,
        type: 'annotation',
        target: target
      });
      // Mark that context menu was just opened to prevent immediate closing
      contextMenuJustOpenedRef.current = true;
      setTimeout(() => {
        contextMenuJustOpenedRef.current = false;
      }, 100); // Allow clicks after 100ms
      return;
    }

    // 2. Check if we clicked on a React callout
    const canvasElement = canvasRef.current;
    if (canvasElement) {
      const rect = canvasElement.getBoundingClientRect();
      const clickPos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };

      // Get page dimensions at current scale
      const pageWidth = width * scale;
      const pageHeight = height * scale;

      // Filter callouts for this page
      const pageCallouts = calloutsRef.current.filter(c => c.pageNumber === pageNumber);

      for (const callout of pageCallouts) {
        if (isPointOnCallout(clickPos, callout, pageWidth, pageHeight)) {
          // Select the callout
          setSelectedCalloutId(callout.id);
          const safePosition = calculateViewportSafePosition(e.clientX, e.clientY, {
            estimatedWidth: 200,
            estimatedHeight: 300
          });
          setContextMenu({
            visible: true,
            x: safePosition.x,
            y: safePosition.y,
            type: 'callout',
            target: null,
            calloutId: callout.id
          });
          // Mark that context menu was just opened to prevent immediate closing
          contextMenuJustOpenedRef.current = true;
          setTimeout(() => {
            contextMenuJustOpenedRef.current = false;
          }, 100); // Allow clicks after 100ms
          return;
        }
      }
    }

    // 3. Page background click - always show page operations menu
    const safePosition = calculateViewportSafePosition(e.clientX, e.clientY, {
      estimatedWidth: 200,
      estimatedHeight: 450
    });
    setContextMenu({
      visible: true,
      x: safePosition.x,
      y: safePosition.y,
      type: 'page',
      target: null
    });
    // Mark that context menu was just opened to prevent immediate closing
    contextMenuJustOpenedRef.current = true;
    setTimeout(() => {
      contextMenuJustOpenedRef.current = false;
    }, 100); // Allow clicks after 100ms
  }, [pageNumber, width, height, scale, isPointOnCallout, setSelectedCalloutId]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    contextMenuPositionAdjustedRef.current = false;
  }, []);

  const closeEditModal = useCallback(() => {
    setEditModal(null);
    editModalPositionAdjustedRef.current = false;
  }, []);

  // Reset position adjustment flag when context menu becomes visible
  useEffect(() => {
    if (contextMenu?.visible) {
      contextMenuPositionAdjustedRef.current = false;
    }
  }, [contextMenu?.visible]);

  // Reset position adjustment flag when edit modal becomes visible
  useEffect(() => {
    if (editModal?.visible) {
      editModalPositionAdjustedRef.current = false;
    }
  }, [editModal?.visible]);

  // Fine-tune context menu position after render using actual dimensions
  useEffect(() => {
    if (!contextMenu?.visible || !contextMenuRef.current || contextMenuPositionAdjustedRef.current) return;

    // Use requestAnimationFrame to ensure the element is fully rendered
    const frameId = requestAnimationFrame(() => {
      if (!contextMenuRef.current) return;

      const element = contextMenuRef.current;
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 10;

      let adjustedX = contextMenu.x;
      let adjustedY = contextMenu.y;
      let needsUpdate = false;

      // Check right edge overflow
      if (rect.right + padding > viewportWidth) {
        adjustedX = viewportWidth - rect.width - padding;
        needsUpdate = true;
      }

      // Check left edge overflow
      if (rect.left < padding) {
        adjustedX = padding;
        needsUpdate = true;
      }

      // Check bottom edge overflow
      if (rect.bottom + padding > viewportHeight) {
        adjustedY = viewportHeight - rect.height - padding;
        needsUpdate = true;
      }

      // Check top edge overflow
      if (rect.top < padding) {
        adjustedY = padding;
        needsUpdate = true;
      }

      if (needsUpdate) {
        setContextMenu(prev => prev ? { ...prev, x: adjustedX, y: adjustedY } : null);
      }
      contextMenuPositionAdjustedRef.current = true;
    });

    return () => cancelAnimationFrame(frameId);
  }, [contextMenu?.visible]);

  // Fine-tune edit modal position after render using actual dimensions
  useEffect(() => {
    if (!editModal?.visible || !editModalRef.current || editModalPositionAdjustedRef.current) return;

    // Use requestAnimationFrame to ensure the element is fully rendered
    const frameId = requestAnimationFrame(() => {
      if (!editModalRef.current) return;

      const element = editModalRef.current;
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 10;

      let adjustedX = editModal.x;
      let adjustedY = editModal.y;
      let needsUpdate = false;

      // Check right edge overflow
      if (rect.right + padding > viewportWidth) {
        adjustedX = viewportWidth - rect.width - padding;
        needsUpdate = true;
      }

      // Check left edge overflow
      if (rect.left < padding) {
        adjustedX = padding;
        needsUpdate = true;
      }

      // Check bottom edge overflow
      if (rect.bottom + padding > viewportHeight) {
        adjustedY = viewportHeight - rect.height - padding;
        needsUpdate = true;
      }

      // Check top edge overflow
      if (rect.top < padding) {
        adjustedY = padding;
        needsUpdate = true;
      }

      if (needsUpdate) {
        setEditModal(prev => prev ? { ...prev, x: adjustedX, y: adjustedY } : null);
      }
      editModalPositionAdjustedRef.current = true;
    });

    return () => cancelAnimationFrame(frameId);
  }, [editModal?.visible]);

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

  // Delete annotation handler
  const handleDeleteAnnotation = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length > 0) {
      canvas.remove(...activeObjects);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      triggerSave();
    }
    closeContextMenu();
  }, [triggerSave, closeContextMenu]);

  // Callout context menu handlers (using existing props)
  const handleCutCalloutFromMenu = useCallback(() => {
    if (contextMenu?.calloutId) {
      onCutCallout(contextMenu.calloutId);
    }
    closeContextMenu();
  }, [contextMenu, onCutCallout, closeContextMenu]);

  const handleCopyCalloutFromMenu = useCallback(() => {
    if (contextMenu?.calloutId) {
      onCopyCallout(contextMenu.calloutId);
    }
    closeContextMenu();
  }, [contextMenu, onCopyCallout, closeContextMenu]);

  const handlePasteCalloutFromMenu = useCallback(() => {
    if (clipboardCallout) {
      onPasteCallout(pageNumber);
    }
    closeContextMenu();
  }, [clipboardCallout, onPasteCallout, pageNumber, closeContextMenu]);

  const handleDeleteCalloutFromMenu = useCallback(() => {
    if (contextMenu?.calloutId) {
      setCallouts(prev => prev.filter(c => c.id !== contextMenu.calloutId));
      setSelectedCalloutId(null);
    }
    closeContextMenu();
  }, [contextMenu, setCallouts, setSelectedCalloutId, closeContextMenu]);

  const handleEditCalloutFromMenu = useCallback(() => {
    // For callouts, we'll open the edit modal with callout-specific values
    if (contextMenu?.calloutId) {
      const callout = calloutsRef.current.find(c => c.id === contextMenu.calloutId);
      if (callout) {
        setEditValues({
          stroke: callout.style?.borderColor || '#000000',
          strokeWidth: callout.style?.lineThickness || 1,
          opacity: callout.style?.borderOpacity !== undefined ? callout.style.borderOpacity : 1,
          arrowheadStyle: callout.style?.arrowheadStyle || ARROWHEAD_STYLES.SOLID_TRIANGLE,
          fill: callout.style?.fontColor || '#000000',
          fontSize: callout.style?.fontSize || 16,
          fontWeight: callout.style?.bold ? 'bold' : 'normal',
          fontStyle: callout.style?.italic ? 'italic' : 'normal',
          textAlign: callout.style?.textAlign || 'left',
          fontFamily: callout.style?.fontFamily || 'Arial',
          fillColor: callout.style?.fillColor || 'rgba(255,255,255,0.9)'
        });
        setEditModal({
          visible: true,
          x: contextMenu.x,
          y: contextMenu.y,
          object: { data: { type: 'callout', calloutId: contextMenu.calloutId } }
        });
      }
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  const handleEdit = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    let activeObject = canvas.getActiveObject();

    // Fallback: use context menu target if no active object (e.g. selection lost)
    if (!activeObject && contextMenu?.target) {
      activeObject = contextMenu.target;
    }

    if (activeObject) {
      // Get initial values from first object if selection
      const target = activeObject.type === 'activeSelection' ? activeObject.getObjects()[0] : activeObject;

      // Handle React callouts (synthetic objects)
      if (target.data?.reactCalloutId) {
        const reactCallout = calloutsRef.current.find(c => c.id === target.data.reactCalloutId);
        if (reactCallout) {
          setEditValues({
            stroke: reactCallout.style?.borderColor || '#000000',
            strokeWidth: reactCallout.style?.lineThickness || 1,
            opacity: reactCallout.style?.opacity !== undefined ? reactCallout.style.opacity : 1,
            arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
            fill: reactCallout.style?.textColor || '#000000',
            fontSize: reactCallout.style?.fontSize || 16,
            fontWeight: reactCallout.style?.fontWeight || 'normal',
            fontStyle: reactCallout.style?.fontStyle || 'normal',
            textAlign: reactCallout.style?.textAlign || 'left',
            fontFamily: reactCallout.style?.fontFamily || 'Arial',
            fillColor: reactCallout.style?.fillColor || 'rgba(255,255,255,0.9)'
          });
        }
      } else {
        // Get stroke values from the line within a group if applicable
        let strokeVal = target.stroke || '#000000';
        let strokeWidthVal = target.strokeWidth || 1;

        // For arrow groups, get stroke from the line object
        if (target.data?.type === 'arrow' && target.type === 'group') {
          const lineObj = target.getObjects().find(o => o.type === 'line');
          if (lineObj) {
            strokeVal = lineObj.stroke || strokeVal;
            strokeWidthVal = lineObj.strokeWidth || strokeWidthVal;
          }
        }

        setEditValues({
          stroke: strokeVal,
          strokeWidth: strokeWidthVal,
          opacity: target.opacity !== undefined ? target.opacity : 1,
          // Arrow specific props
          arrowheadStyle: target.data?.type === 'arrow' ? (target.data?.arrowheadStyle || ARROWHEAD_STYLES.SOLID_TRIANGLE) : ARROWHEAD_STYLES.SOLID_TRIANGLE,
          // Callout specific props
          fill: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.fill || '#000000') : (target.fill || 'transparent'),
          fontSize: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.fontSize || 16) : 16,
          fontWeight: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.fontWeight || 'normal') : 'normal',
          fontStyle: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.fontStyle || 'normal') : 'normal',
          textAlign: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.textAlign || 'left') : 'left',
          fontFamily: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.fontFamily || 'Arial') : 'Arial',
          fillColor: target.data?.type === 'callout' ? (target.getObjects().find(o => o.name === 'calloutText')?.backgroundColor || 'rgba(255,255,255,0.9)') : '#ffffff'
        });
      }

      // Capture initial state for revert
      const objects = activeObject.type === 'activeSelection' ? activeObject.getObjects() : [activeObject];
      const initialStates = objects.map(obj => ({
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
        opacity: obj.opacity
      }));

      const safePosition = calculateViewportSafePosition(contextMenu.x, contextMenu.y, {
        estimatedWidth: 300,
        estimatedHeight: 400
      });
      setEditModal({
        visible: true,
        x: safePosition.x,
        y: safePosition.y,
        object: activeObject,
        initialStates: initialStates
      });
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu, calloutsRef]);

  const saveEdit = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !editModal) return;

    const objects = editModal.object.type === 'activeSelection'
      ? editModal.object.getObjects()
      : [editModal.object];

    objects.forEach(obj => {
      // Handle React callouts (synthetic objects)
      if (obj.data?.reactCalloutId) {
        const reactCalloutId = obj.data.reactCalloutId;
        if (setCalloutsRef.current) {
          setCalloutsRef.current(prev => prev.map(c =>
            c.id === reactCalloutId
              ? {
                ...c,
                style: {
                  ...c.style,
                  borderColor: editValues.stroke,
                  lineThickness: parseInt(editValues.strokeWidth, 10),
                  opacity: parseFloat(editValues.opacity),
                  textColor: editValues.fill,
                  fontSize: parseInt(editValues.fontSize, 10),
                  fontWeight: editValues.fontWeight,
                  fontStyle: editValues.fontStyle,
                  textAlign: editValues.textAlign,
                  fontFamily: editValues.fontFamily || 'Arial',
                  fillColor: editValues.fillColor === 'transparent' ? '' : (editValues.fillColor || 'rgba(255,255,255,0.9)')
                }
              }
              : c
          ));
        }
      } else if (obj.data?.type === 'callout') {
        // Apply to Fabric.js Callout parts
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
      } else if (obj.data?.type === 'arrow') {
        // Handle arrow objects - need to recreate arrowhead if style changed
        const lineObj = obj.getObjects().find(o => o.type === 'line');
        const oldHead = obj.getObjects().find(o => o.name === 'arrowHead' || o.type === 'triangle');
        const currentStyle = obj.data?.arrowheadStyle || ARROWHEAD_STYLES.SOLID_TRIANGLE;
        const newStyle = editValues.arrowheadStyle || ARROWHEAD_STYLES.SOLID_TRIANGLE;

        if (lineObj) {
          // Update line properties
          lineObj.set({
            stroke: editValues.stroke,
            strokeWidth: parseInt(editValues.strokeWidth, 10)
          });

          // If arrowhead style changed, recreate the arrowhead
          if (currentStyle !== newStyle) {
            // Get line endpoints in group-local coordinates
            const { x1, y1, x2, y2 } = lineObj;
            const groupMatrix = obj.calcTransformMatrix();
            const invMatrix = util.invertTransform(groupMatrix);

            // Calculate angle from line endpoints
            const angle = Math.atan2(y2 - y1, x2 - x1);

            // Remove old arrowhead if exists
            if (oldHead) {
              obj.remove(oldHead);
            }

            // Create new arrowhead
            const newHead = createArrowhead(
              x2, y2, angle,
              editValues.stroke,
              parseInt(editValues.strokeWidth, 10),
              newStyle
            );

            if (newHead) {
              obj.add(newHead);
            }

            // Update stored arrowhead style
            obj.set({
              data: { ...obj.data, arrowheadStyle: newStyle }
            });
          } else if (oldHead) {
            // Just update arrowhead color/size if style didn't change
            const isFilled = newStyle === ARROWHEAD_STYLES.SOLID_TRIANGLE;
            oldHead.set({
              stroke: editValues.stroke,
              fill: isFilled ? editValues.stroke : 'transparent',
              strokeWidth: isFilled ? 0 : Math.max(2, parseInt(editValues.strokeWidth, 10))
            });
          }
        }
        obj.set({ opacity: parseFloat(editValues.opacity) });
        // Recalculate group bounds
        obj.setCoords();
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
        } else if (obj.data?.type === 'arrow') {
          // Arrow object: update line and arrowhead colors
          const lineObj = obj.getObjects().find(o => o.type === 'line');
          const headObj = obj.getObjects().find(o => o.name === 'arrowHead' || o.type === 'triangle');
          if (lineObj) {
            lineObj.set({
              stroke: editValues.stroke,
              strokeWidth: parseInt(editValues.strokeWidth, 10)
            });
          }
          if (headObj) {
            const currentStyle = obj.data?.arrowheadStyle || ARROWHEAD_STYLES.SOLID_TRIANGLE;
            const isFilled = currentStyle === ARROWHEAD_STYLES.SOLID_TRIANGLE;
            headObj.set({
              stroke: editValues.stroke,
              fill: isFilled ? editValues.stroke : 'transparent',
              strokeWidth: isFilled ? 0 : Math.max(2, parseInt(editValues.strokeWidth, 10))
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
      // Don't close if we're dragging the modal
      if (isDraggingModalRef.current) return;
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
      // Don't close if we're dragging the modal
      if (isDraggingModalRef.current) return;
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

  // Edit Modal Drag Handlers
  useEffect(() => {
    if (!editModal) return;

    const handleMouseMove = (e) => {
      if (!isDraggingModalRef.current) return;

      const deltaX = e.clientX - modalDragStartRef.current.startX;
      const deltaY = e.clientY - modalDragStartRef.current.startY;

      setEditModal(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          x: modalDragStartRef.current.x + deltaX,
          y: modalDragStartRef.current.y + deltaY
        };
      });
    };

    const handleMouseUp = () => {
      isDraggingModalRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [editModal]);

  // Click outside handler for context menu and selected annotations
  useEffect(() => {
    const handleClickOutside = (event) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      // Skip if context menu was just opened (prevent immediate closing)
      if (contextMenuJustOpenedRef.current) return;

      // Skip if it's a right-click (context menu)
      if (event.button === 2 || event.which === 3) return;

      const canvasElement = canvasRef.current;
      if (!canvasElement) return;

      // Check if click is outside the context menu element
      const isOutsideContextMenu = contextMenuRef.current &&
        !contextMenuRef.current.contains(event.target);

      // Check if click is on the canvas or its container
      const containerElement = canvasElement.parentElement;
      const isOnCanvasArea = canvasElement.contains(event.target) ||
        (containerElement && containerElement.contains(event.target));

      // Check if there's a selected annotation (use != null to catch both null and undefined)
      const activeObject = canvas.getActiveObject();
      const hasSelectedAnnotation = activeObject != null;

      // If click is outside canvas area
      if (!isOnCanvasArea) {
        // If context menu is open and click is outside it, close it
        if (contextMenu && isOutsideContextMenu) {
          closeContextMenu();
        }
        // If there's a selected annotation and we're clicking outside canvas, deselect
        if (hasSelectedAnnotation) {
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }
        return;
      }

      // For clicks on canvas area, check if click is on an annotation
      // Find what object (if any) is at the click position
      // Use the event directly - Fabric.js will extract what it needs
      const target = canvas.findTarget(event, false);

      // If context menu is open and click is outside it
      if (contextMenu && isOutsideContextMenu) {
        // If click is not on an annotation, also deselect
        if (!target && hasSelectedAnnotation) {
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }
        closeContextMenu();
      }
      // If no context menu but there's a selected annotation, deselect if clicking outside annotation
      else if (!contextMenu && hasSelectedAnnotation && activeObject) {
        // Check if click is on the selected annotation itself
        const isOnSelectedAnnotation = target && (
          target === activeObject ||
          (activeObject.type === 'activeSelection' && activeObject.getObjects?.().includes(target)) ||
          (activeObject.type === 'group' && activeObject.getObjects?.().includes(target))
        );

        // If click is not on the selected annotation, deselect
        if (!isOnSelectedAnnotation) {
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }
      }
    };

    // Add event listener for mousedown (works for all tools)
    document.addEventListener('mousedown', handleClickOutside, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [contextMenu, closeContextMenu]);

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

  // Keep selectedSpaceId and activeSpaceId refs in sync
  useEffect(() => {
    selectedSpaceIdRef.current = selectedSpaceId;
    activeSpaceIdRef.current = activeSpaceId;
  }, [selectedSpaceId, activeSpaceId]);

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
  // FIX: This effect should NOT override the main visibility filter - it should only update the ref
  // The main visibility filter (lines 4836+) handles everything including layer visibility
  useEffect(() => {
    layerVisibilityRef.current = layerVisibility;
    // Don't set visibility here - let the main filter handle it
    // The main filter will re-run when layerVisibility changes (it's in the dependency array)
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
    // Enable selection for Select tool (we have custom selection handler but need Fabric's selection enabled for it to work)
    canvas.selection = tool === 'select';

    // Deselect active object when switching away from select tool to prevent interference
    if (tool !== 'select') {
      const activeObject = canvas.getActiveObject();
      if (activeObject) {
        canvas.discardActiveObject();
        // Don't call requestRenderAll here - let the visibility filter handle rendering
        // canvas.requestRenderAll();
      }
    }

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

    // FIX: Don't call requestRenderAll here - let the visibility filter handle rendering
    // The visibility filter will run when tool changes (it's in the dependency array)
    // and will call renderAll() at the end, ensuring visibility is correct
    // canvas.requestRenderAll();
  }, [tool, strokeColor, strokeWidth, highlightColor]);

  // Keep arrowheadStyleRef in sync
  useEffect(() => {
    arrowheadStyleRef.current = arrowheadStyle;
  }, [arrowheadStyle]);

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

          // Restore space/module/region association
          if (!obj.spaceId) obj.spaceId = objData.spaceId || null;
          if (!obj.moduleId) obj.moduleId = objData.moduleId || null;
          if (!obj.regionId) obj.regionId = objData.regionId || null;

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

          // Migrate old Line/Arrow objects to new 3-handle control system
          // Check if this is a Line object that needs custom controls
          if (obj.type === 'line' && !obj.data?.midpoint && obj.controls && Object.keys(obj.controls).length > 3) {
            // Old line with default Fabric controls - migrate to custom controls
            if (!obj.data) obj.data = {};
            obj.data.midpoint = null;
            obj.data.isCurved = false;
            setupLineControls(obj, canvas);
          }
          
          // Check if this is an Arrow Group that needs custom controls
          if (obj.type === 'group' && obj.data?.type === 'arrow') {
            const lineObj = obj.getObjects().find(o => o.type === 'line' || o.type === 'polyline');
            if (lineObj && (!obj.data.midpoint || obj.controls && Object.keys(obj.controls).length > 3)) {
              // Old arrow with default Fabric controls - migrate to custom controls
              if (!obj.data.midpoint) obj.data.midpoint = null;
              if (obj.data.isCurved === undefined) {
                obj.data.isCurved = lineObj.type === 'polyline';
              }
              setupArrowControls(obj, canvas);
            }
          }

          // Apply visibility filter using the same three-layer logic as the main visibility useEffect
          const objLayer = obj.layer || 'native';
          const layerVisible = layerVisibilityRef.current[objLayer] !== false;
          if (!layerVisible) {
            obj.set({ visible: false, selectable: false, evented: false });
            canvas.add(obj);
            obj.setCoords();
            return; // Skip to next object
          }

          const objModuleId = obj.moduleId || null;
          const objRegionId = obj.regionId || null;
          const currentSpaceId = selectedSpaceIdRef.current;
          const currentActiveSpaceId = activeSpaceIdRef.current;
          const currentModuleId = selectedModuleIdRef.current;

          // Check if this is a survey annotation (has moduleId)
          const isSurveyAnnotation = objModuleId !== null;
          // Check if this is a region-scoped annotation (has regionId)
          const isRegionScoped = objRegionId !== null;

          let isVisible = true;
          let isInteractive = true;

          // Three-layer visibility logic:
          // - Base layer (no moduleId, no regionId): hidden when survey mode is active with a module selected
          // - Middle layer (has moduleId, no regionId): visible only when survey mode is active AND module matches
          // - Top layer (has regionId): visible when space is active
          if (isSurveyAnnotation) {
            // Survey annotation: visible only when survey panel is open AND module matches
            if (!showSurveyPanelRef.current || currentModuleId !== objModuleId) {
              isVisible = false;
            }
          } else if (!isRegionScoped) {
            // Regular annotation (base layer): hidden when survey mode is active with a module selected
            if (showSurveyPanelRef.current && currentModuleId !== null) {
              isVisible = false;
            }
          }
          // Region-scoped annotations (top layer) always pass the survey check

          // Region-scoped annotations: only visible when their space is active
          if (isRegionScoped && isVisible) {
            // Get space for this regionId (simplified check - rely on main useEffect for full logic)
            if (!currentActiveSpaceId) {
              isVisible = false;
            }
          }

          // Lightbulb check for non-region-scoped annotations (survey highlights without regionId, and background annotations)
          // when a space is active
          if (!isRegionScoped && isVisible && currentSpaceId && getRegionLightbulbStateRef?.current) {
            const lightbulbOn = getRegionLightbulbStateRef.current(currentSpaceId, pageNumber) !== false;
            if (!lightbulbOn) {
              isVisible = false;
            }
          }

          // Interactivity: survey annotations without regionId are non-interactive when space is active
          // Survey annotations WITH regionId (top layer) can be interactive
          if (isSurveyAnnotation && !isRegionScoped && currentActiveSpaceId) {
            isInteractive = false;
          }

          obj.set({ visible: isVisible, selectable: isVisible && isInteractive, evented: isVisible && isInteractive });

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

        // Get all active objects to support multiple selection
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length === 0) return;

        // Filter to only callouts and check if any are being edited
        const callouts = activeObjects.filter(activeObj => {
          const isCallout = (activeObj?.data?.type === 'callout') ||
            (activeObj?.type === 'group' && activeObj.getObjects().some(o => o.name === 'calloutText'));
          return isCallout;
        });

        if (callouts.length > 0) {
          // Check if any callout is being edited
          const isEditing = callouts.some(callout =>
            callout.isEditing || (callout.getObjects && callout.getObjects().some(o => o.isEditing))
          );

          if (!isEditing) {
            // Remove all selected callouts
            canvas.remove(...callouts);
            canvas.discardActiveObject();
            canvas.requestRenderAll();
            triggerSave();
            e.preventDefault();
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
        // Sanitize text objects to prevent Fabric.js stylesToArray errors
        sanitizeTextStyles(fabricRef.current);

        // Include spaceId in the saved JSON to preserve space associations
        const canvasJSON = fabricRef.current.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'regionId', 'data', 'name', 'highlightId', 'needsBIC', 'globalCompositeOperation', 'layer', 'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType']);
        lastSavedAnnotationsRef.current = canvasJSON; // Update last saved ref
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
      // If a child object of a callout group is selected, select the parent group instead
      if (e.selected && e.selected.group && e.selected.group.data?.type === 'callout') {
        // Deselect the child and select the parent group
        const parentGroup = e.selected.group;
        canvas.setActiveObject(parentGroup);
        // Ensure controls are enabled for callout groups
        // In Fabric.js, controls may require hasBorders to be true to render properly
        if (parentGroup._originalHasBorders === undefined) {
          parentGroup._originalHasBorders = parentGroup.hasBorders;
        }
        parentGroup.set({ hasControls: true, hasBorders: true });
        parentGroup.setCoords();
        canvas.requestRenderAll();
        return;
      }

      // Ensure callout groups have controls enabled when selected
      if (e.selected && e.selected.data?.type === 'callout') {
        // Enable controls and borders (borders may be needed for controls to render in Fabric.js)
        if (e.selected._originalHasBorders === undefined) {
          e.selected._originalHasBorders = e.selected.hasBorders;
        }
        e.selected.set({ hasControls: true, hasBorders: true });
        e.selected.setCoords();
        // Force a render to ensure controls are visible
        setTimeout(() => {
          canvas.requestRenderAll();
        }, 0);
      }

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
        // Store current moduleId on the path
        if (selectedModuleIdRef.current) {
          e.path.set({ moduleId: selectedModuleIdRef.current });
        }
        // Store current activeRegionId on the path if a region is active AND toggle is ON
        if (shouldAssignRegionId()) {
          e.path.set({ regionId: activeRegionIdRef.current });
        }
        // NOTE: Do NOT auto-select pen strokes or highlighter paths
        // Users should manually select them if they want to resize
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


      // Handle Fabric callout objects when select, pan, or callout tool is active
      // Note: React callouts (via CalloutOverlay) handle their own events separately
      // IMPORTANT: For select tool, we should NOT return early here - let the custom selection handler work
      // Only handle Fabric callout drag interactions if clicking on a Fabric callout object
      if (currentTool === 'select' || currentTool === 'pan' || currentTool === 'callout') {
        // Only handle Fabric callout objects (if they exist) for drag interactions
        const target = opt.target;
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
                return; // Handled callout text drag, let Fabric continue
              }
            }
          }
        }
        // For select tool, don't return early - let the custom selection handler (handleMouseDownForSelection) work
        // This allows clicking/dragging to select Fabric objects
        // The custom handler is registered on 'mouse:down' event and will handle selection
      }

      // For other tools, ignore callout clicks so they don't interfere with annotation tools
      // Only process callout interactions when select, pan, or callout tool is active (handled above)

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
        // Use getPointer with false to get viewport-transformed coordinates (matches canvas object coordinates)
        // This ensures eraser points are in the same coordinate space as callout positions
        const pointer = canvas.getPointer(opt.e, false);
        eraserPathRef.current = {
          startX: pointer.x,
          startY: pointer.y,
          points: [{ x: pointer.x, y: pointer.y }]
        };

        // Create visual eraser stroke overlay
        // Use the same pointer coordinates for the visual stroke
        const eraserStroke = new Polyline([[pointer.x, pointer.y]], {
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
        // Check if user is clicking on an existing textbox or its control handles
        // If so, don't create a new textbox - let Fabric handle resize/move
        const target = opt.target;
        const activeObject = canvas.getActiveObject();

        // Check if clicking on an existing textbox
        const isClickingTextbox = target && (target.type === 'textbox' || target.type === 'i-text' || target.type === 'text');

        // Check if active object is a textbox
        const isActiveTextbox = activeObject && (activeObject.type === 'textbox' || activeObject.type === 'i-text' || activeObject.type === 'text');

        // Check if clicking on a control handle of an active textbox
        let isClickingControl = false;
        if (isActiveTextbox && activeObject._findTargetCorner) {
          // Ensure control points are calculated
          if (!activeObject.oCoords) {
            try { activeObject.setCoords(); } catch (e) { }
          }
          if (activeObject.oCoords) {
            const corner = activeObject._findTargetCorner(opt.e, true);
            isClickingControl = corner !== undefined && corner !== '';
          }
        }

        // If clicking on a textbox or its control handle, don't create new one
        // Let Fabric.js handle the interaction (resize, move, etc.)
        if (isClickingTextbox || isClickingControl || (isActiveTextbox && target === activeObject)) {
          return;
        }

        const tb = new Textbox('Text', {
          left: x,
          top: y,
          fontSize: 16,
          fill: currentStrokeColor,
          editable: true,
          backgroundColor: 'transparent'
        });
        // Store current moduleId on the textbox
        if (selectedModuleIdRef.current) {
          tb.set({ moduleId: selectedModuleIdRef.current });
        }
        // Store current activeRegionId on the textbox if a region is active AND toggle is ON
        if (shouldAssignRegionId()) {
          tb.set({ regionId: activeRegionIdRef.current });
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
        // Store current activeRegionId on the shape if a region is active AND toggle is ON
        if (shouldAssignRegionId()) {
          temp.set({ regionId: activeRegionIdRef.current });
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
        if (selectedModuleIdRef.current) {
          note.set({ moduleId: selectedModuleIdRef.current });
        }
        // Store current activeRegionId on the note if a region is active AND toggle is ON
        if (shouldAssignRegionId()) {
          note.set({ regionId: activeRegionIdRef.current });
        }
        note.on('mousedblclick', () => {
          const text = window.prompt('Note:', note.get('noteText') || '');
          if (text !== null) {
            note.set('noteText', text);
            saveCanvas();
          }
        });
        canvas.add(note);
        // Set flag to prevent deselection in handleMouseUpForSelection
        justFinishedDrawingRef.current = true;
        // Automatically select the note so handles appear
        canvas.setActiveObject(note);
        canvas.requestRenderAll();
        // Clear flag after a brief delay
        setTimeout(() => {
          justFinishedDrawingRef.current = false;
        }, 100);
        saveCanvas();
        return;
      }
      if (temp) {
        // Store current moduleId on the shape
        if (selectedModuleIdRef.current) {
          temp.set({ moduleId: selectedModuleIdRef.current });
        }
        // Store current activeRegionId on the shape if a region is active AND toggle is ON
        if (shouldAssignRegionId()) {
          temp.set({ regionId: activeRegionIdRef.current });
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

      // Handle shape drawing safety check: if mouse is not pressed but we are drawing, force finish
      // This handles cases where mouseup happened outside canvas or was missed
      if (drawingStateRef.current.isDrawingShape && opt.e.buttons === 0) {
        handleMouseUp(opt);
        return;
      }

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

        // Add point - use getPointer with false to get viewport-transformed coordinates
        // This ensures eraser points are in the same coordinate space as callout positions
        const pointer = canvas.getPointer(opt.e, false);
        eraserPath.points.push({ x: pointer.x, y: pointer.y });

        // Update visual eraser stroke overlay
        if (eraserStrokeVisualRef.current) {
          const points = eraserStrokeVisualRef.current.get('points') || [];
          // Use the same pointer coordinates for the visual stroke
          points.push([pointer.x, pointer.y]);
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
      // CRITICAL: Check if tempObj is inside a group (Fabric.js sets .group property)
      // This prevents updates to objects that have been moved into groups
      if (ds.tempObj.group) {
        return;
      }
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
            // Requirement: When a space is active, background annotations cannot be erased
            // Check both old spaceId (backward compatibility) and new regionId-based space relationship
            const objSpaceId = obj.spaceId || null; // Old annotations may still have spaceId
            const objRegionId = obj.regionId || null;
            let shouldSkip = false;

            // When a space is active (activeSpaceIdRef.current !== null):
            // - Background annotations (objRegionId === null) should NOT be erasable
            // - Region-scoped annotations (objRegionId !== null) SHOULD be erasable if they belong to the active space
            if (activeSpaceIdRef.current !== null) {
              if (objRegionId !== null) {
                // Region-scoped annotation - check if it belongs to the active space
                // Look up the space directly from the spaces ref
                let derivedSpaceId = null;
                const currentSpaces = spacesRef.current;
                if (currentSpaces && currentSpaces.length > 0) {
                  for (const space of currentSpaces) {
                    const assignedPages = space.assignedPages || [];
                    for (const page of assignedPages) {
                      const regions = page.regions || [];
                      for (const region of regions) {
                        if (region.regionId === objRegionId) {
                          derivedSpaceId = space.id;
                          break;
                        }
                      }
                      if (derivedSpaceId) break;
                    }
                    if (derivedSpaceId) break;
                  }
                }
                // If we found the space and it matches the active space, allow erasing
                // If lookup failed (derivedSpaceId is null), default to allowing erasing for region-scoped annotations
                // since they are visible and interactive when a space is active
                if (derivedSpaceId !== null && derivedSpaceId !== activeSpaceIdRef.current) {
                  // Region-scoped annotation from a different space - skip
                  shouldSkip = true;
                } else {
                  // Region-scoped annotation from the active space (or lookup failed) - allow erasing
                  shouldSkip = false;
                }
              } else if (objSpaceId !== null) {
                // Old annotation with spaceId - check if it matches active space
                shouldSkip = objSpaceId !== activeSpaceIdRef.current;
              } else {
                // Background annotation (no regionId, no spaceId) - NOT erasable when space is active
                shouldSkip = true;
              }
            } else {
              // No space active - all annotations can be erased (normal behavior)
              if (selectedSpaceIdRef.current !== null) {
                // Legacy check for selectedSpaceId (backward compatibility)
                if (objSpaceId !== null) {
                  shouldSkip = objSpaceId !== selectedSpaceIdRef.current;
                } else {
                  // No spaceId - allow erasing
                  shouldSkip = false;
                }
              }
            }

            if (shouldSkip) {
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

          // Handle React callouts (not Fabric objects)
          // Check if eraser path intersects with any callout on this page
          if (calloutsRef.current && calloutsRef.current.length > 0 && setCalloutsRef.current) {
            // Get canvas zoom/scale - eraser points are in canvas coordinates which may include zoom
            const canvasZoom = canvas.getZoom ? canvas.getZoom() : 1;
            const pageCallouts = calloutsRef.current.filter(c => c.pageNumber === pageNumber);
            const calloutsToDelete = [];

            for (const callout of pageCallouts) {
              // Convert callout positions from percentages to canvas pixels
              // Note: width/height are the page dimensions at current scale, so this should match canvas coordinates
              const arrowTipPx = {
                x: callout.arrowTip.x * width,
                y: callout.arrowTip.y * height
              };
              const kneePx = {
                x: callout.knee.x * width,
                y: callout.knee.y * height
              };
              const textBoxPx = {
                x: callout.textBoxPosition.x * width,
                y: callout.textBoxPosition.y * height
              };
              const textBoxWidthPx = callout.textBoxWidth * width;
              const textBoxHeightPx = callout.textBoxHeight * height;


              // Check if any eraser point is within eraser radius of:
              // 1. Arrow tip
              // 2. Knee point
              // 3. Text box bounds
              // 4. Line segments (arrow tip -> knee -> text box)
              const isTouching = eraserPath.points.some(point => {
                // Check arrow tip
                const distToTip = Math.sqrt(
                  Math.pow(point.x - arrowTipPx.x, 2) + Math.pow(point.y - arrowTipPx.y, 2)
                );
                if (distToTip < eraserRadius) return true;

                // Check knee
                const distToKnee = Math.sqrt(
                  Math.pow(point.x - kneePx.x, 2) + Math.pow(point.y - kneePx.y, 2)
                );
                if (distToKnee < eraserRadius) return true;

                // Check text box bounds (expand bounds by eraser radius)
                const inTextBox =
                  point.x >= textBoxPx.x - eraserRadius &&
                  point.x <= textBoxPx.x + textBoxWidthPx + eraserRadius &&
                  point.y >= textBoxPx.y - eraserRadius &&
                  point.y <= textBoxPx.y + textBoxHeightPx + eraserRadius;
                if (inTextBox) return true;

                // Check line segment from arrow tip to knee
                const distToTipKneeLine = distanceToLineSegment(point, arrowTipPx, kneePx);
                if (distToTipKneeLine < eraserRadius) return true;

                // Check line segment from knee to text box center-left
                const textBoxCenterLeft = {
                  x: textBoxPx.x,
                  y: textBoxPx.y + textBoxHeightPx / 2
                };
                const distToKneeTextLine = distanceToLineSegment(point, kneePx, textBoxCenterLeft);
                if (distToKneeTextLine < eraserRadius) return true;

                return false;
              });

              if (isTouching) {
                calloutsToDelete.push(callout.id);
              }
            }

            // Delete touched callouts
            if (calloutsToDelete.length > 0) {
              setCalloutsRef.current(prev => {
                const filtered = prev.filter(c => !calloutsToDelete.includes(c.id));
                return filtered;
              });
              needsRenderAndSave = true;
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
      const currentStrokeWidth = strokeWidthRef.current;
      const ds = drawingStateRef.current;
      if (!ds.isDrawingShape || !ds.tempObj) {
        return;
      }

      // Handle highlight tool: create rectangle and call callback
      if (currentTool === 'highlight' && ds.tempObj.type === 'rect') {
        const rect = ds.tempObj;
        const rectLeft = rect.left;
        const rectTop = rect.top;
        const rectWidth = rect.width;
        const rectHeight = rect.height;
        const currentZoom = canvas.getZoom ? canvas.getZoom() : scale;

        // Remove the temporary selection rectangle from canvas
        canvas.remove(ds.tempObj);

        // Only call callback if rectangle has meaningful size (user actually dragged)
        if (rectWidth > 5 && rectHeight > 5 && onHighlightCreatedRef.current) {
          // Canvas has zoom applied via setZoom(), so coordinates are in canvas space
          // Need to divide by currentZoom to convert to PDF coordinates
          // This matches the rendering logic which multiplies by renderScale (lines 667-670)
          onHighlightCreatedRef.current(pageNumber, {
            x: rectLeft,
            y: rectTop,
            width: rectWidth,
            height: rectHeight
          });
        }
      } else if (currentTool === 'arrow' && ds.tempObj.type === 'line') {
        // CRITICAL: Save tempObj reference and clear state IMMEDIATELY
        const tempObjRef = ds.tempObj;
        ds.isDrawingShape = false;
        ds.tempObj = null;

        // Extract properties from the temporary line
        const { x1, y1, x2, y2 } = tempObjRef;
        const lineOptions = {
          stroke: tempObjRef.stroke,
          strokeWidth: tempObjRef.strokeWidth,
          strokeUniform: tempObjRef.strokeUniform,
          // Copy any other relevant properties if needed
        };

        // Remove the temporary line from the canvas explicitly
        canvas.remove(tempObjRef);

        // Recreate the line for the group
        const newLine = new Line([x1, y1, x2, y2], lineOptions);

        const angle = Math.atan2(y2 - y1, x2 - x1);
        // Use the arrowhead style from toolbar settings
        // Ensure we have a valid style, defaulting to SOLID_TRIANGLE
        const selectedArrowheadStyle = arrowheadStyleRef.current || ARROWHEAD_STYLES.SOLID_TRIANGLE;

        const head = createArrowhead(x2, y2, angle, currentStrokeColor, currentStrokeWidth, selectedArrowheadStyle);

        // Create group with new line and arrowhead
        const groupObjects = head ? [newLine, head] : [newLine];
        const group = new Group(groupObjects, { selectable: true });

        // Store arrowhead style and mark as arrow type on the group
        group.set({
          data: { type: 'arrow', arrowheadStyle: selectedArrowheadStyle, midpoint: null, isCurved: false }
        });

        // Store current moduleId on the arrow group
        if (selectedModuleIdRef.current) {
          group.set({ moduleId: selectedModuleIdRef.current });
        }
        // Store current activeRegionId on the arrow group if a region is active AND toggle is ON
        if (shouldAssignRegionId()) {
          group.set({ regionId: activeRegionIdRef.current });
        }

        // Add group to canvas
        canvas.add(group);

        // #region agent log
        fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:4575',message:'Arrow tool: setting up controls',data:{x1,y1,x2,y2,arrowheadStyle:selectedArrowheadStyle},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        // Set up custom 3-handle controls for arrow
        setupArrowControls(group, canvas);
        // Ensure coordinates are set for controls to render properly
        group.setCoords();
        // Force control coordinates update
        if (group._setCornerCoords) {
          group._setCornerCoords();
        }
        // #region agent log
        fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:4592',message:'After setupArrowControls check',data:{hasControls:group.hasControls,controlCount:Object.keys(group.controls||{}).length,selectable:group.selectable,hasSetCornerCoords:typeof group._setCornerCoords==='function'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion

        // Set flag to prevent deselection in handleMouseUpForSelection
        justFinishedDrawingRef.current = true;

        // Automatically select the arrow group so handles appear
        canvas.setActiveObject(group);
        // #region agent log
        fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:4595',message:'After setActiveObject arrow',data:{isActive:canvas.getActiveObject()===group,activeHasControls:canvas.getActiveObject()?.hasControls,activeControlCount:Object.keys(canvas.getActiveObject()?.controls||{}).length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        canvas.requestRenderAll();

        // Clear flag after a brief delay
        setTimeout(() => {
          justFinishedDrawingRef.current = false;
        }, 100);

        saveCanvas();

        return;
      } else if (currentTool === 'callout' && ds.tempObj.type === 'line') {
        const { x1, y1, x2, y2 } = ds.tempObj;
        const calloutGroup = createCalloutGroup(
          { x: x1, y: y1 },
          { x: x2, y: y2 },
          currentStrokeColor,
          currentStrokeWidth,
          canvas
        );
        // Store current moduleId on the callout group
        if (selectedModuleIdRef.current) {
          calloutGroup.set({ moduleId: selectedModuleIdRef.current });
        }
        // Store current activeRegionId on the callout group if a region is active AND toggle is ON
        if (shouldAssignRegionId()) {
          calloutGroup.set({ regionId: activeRegionIdRef.current });
        }
        canvas.add(calloutGroup);
        canvas.remove(ds.tempObj);
        // Set flag to prevent deselection in handleMouseUpForSelection
        justFinishedDrawingRef.current = true;
        canvas.setActiveObject(calloutGroup);
        // Enter text editing mode
        const textObj = calloutGroup.getObjects().find(o => o.name === 'calloutText');
        if (textObj) {
          textObj.enterEditing();
          textObj.selectAll();
        }
        canvas.requestRenderAll();
        // Clear flag after a brief delay
        setTimeout(() => {
          justFinishedDrawingRef.current = false;
        }, 100);
      } else if (ds.tempObj) {
        // For other shapes (rect, ellipse, line, squiggly), the temp object is the final object
        // Automatically select it so handles appear
        const tempObj = ds.tempObj; // Store reference before clearing
        
        // Special handling for line tool - set up custom 3-handle controls
        if (currentTool === 'line' && tempObj.type === 'line') {
          // #region agent log
          fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:4820',message:'Line tool: setting up controls',data:{x1:tempObj.x1,y1:tempObj.y1,x2:tempObj.x2,y2:tempObj.y2},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          tempObj.set({
            selectable: true,
            hasControls: true,
            hasBorders: true  // Try with borders enabled for Line objects
          });
          // Initialize data for midpoint tracking
          if (!tempObj.data) tempObj.data = {};
          tempObj.data.midpoint = null; // Will be calculated on-demand when straight
          tempObj.data.isCurved = false;
          // Set up custom controls
          setupLineControls(tempObj, canvas);
          // Ensure coordinates are set for controls to render properly
          tempObj.setCoords();
          // Force control coordinates update
          if (tempObj._setCornerCoords) {
            tempObj._setCornerCoords();
          }
          // #region agent log
          fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:4845',message:'After setupLineControls check',data:{hasControls:tempObj.hasControls,controlCount:Object.keys(tempObj.controls||{}).length,selectable:tempObj.selectable,isActive:canvas.getActiveObject()===tempObj,hasSetCornerCoords:typeof tempObj._setCornerCoords==='function'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
        } else {
          // For other shapes, use default controls
          tempObj.set({
            selectable: true,
            hasControls: true,
            hasBorders: true
          });
        }
        
        tempObj.setCoords(); // Ensure coordinates are updated

        // Set flag to prevent deselection in handleMouseUpForSelection
        justFinishedDrawingRef.current = true;

        // Select immediately so handles appear right away
        canvas.setActiveObject(tempObj);
        // #region agent log
        fetch('http://127.0.0.1:9006/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PageAnnotationLayer.jsx:4860',message:'After setActiveObject line',data:{isActive:canvas.getActiveObject()===tempObj,activeHasControls:canvas.getActiveObject()?.hasControls,activeControlCount:Object.keys(canvas.getActiveObject()?.controls||{}).length,activeType:canvas.getActiveObject()?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        canvas.requestRenderAll();

        // Clear flag after a brief delay to allow other handlers to see it
        setTimeout(() => {
          justFinishedDrawingRef.current = false;
        }, 100);
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

      // Ensure canvas.selection is enabled for select tool
      if (!canvas.selection) {
        canvas.selection = true;
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
        // If clicking on a child object of a callout group, select the parent group instead
        if (e.target && e.target.group && e.target.group.data?.type === 'callout') {
          // Select the parent group instead of the child
          const parentGroup = e.target.group;
          canvas.setActiveObject(parentGroup);
          // Ensure controls are enabled - enable borders too
          if (parentGroup._originalHasBorders === undefined) {
            parentGroup._originalHasBorders = parentGroup.hasBorders;
          }
          parentGroup.set({ hasControls: true, hasBorders: true });
          parentGroup.setCoords();
          canvas.requestRenderAll();
          return;
        }

        // If clicking directly on a callout group, ensure controls are enabled
        if (e.target && e.target.data?.type === 'callout') {
          if (e.target._originalHasBorders === undefined) {
            e.target._originalHasBorders = e.target.hasBorders;
          }
          e.target.set({ hasControls: true, hasBorders: true });
          e.target.setCoords();
          // Force a render after a brief delay to ensure controls are visible
          setTimeout(() => {
            canvas.requestRenderAll();
          }, 0);
        }

        // Don't initialize selection rect - allow single-click object selection to work normally
        // But also don't prevent the object from being selected
        // Return early so Fabric.js can handle the object selection
        // Keep canvas.selection enabled so Fabric.js can select the object
        return;
      }

      // For drag selection, initialize the selection rectangle
      // Keep canvas.selection enabled so Fabric.js can still handle object clicks
      // We'll only disable it during the actual drag (in mouseMove) if needed

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

      // Disable Fabric's default selection visual to prevent double overlay
      canvas.selection = false;

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

      // During drag selection, we disable canvas.selection to avoid double overlay
      // We handle the selection logic manually in mouseUp

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
      // CRITICAL: Don't interfere if we're currently drawing a shape or just finished drawing
      // This handler runs BEFORE handleMouseUp (due to LIFO event order), so we need to check
      // the drawing state to avoid deselecting shapes that are about to be selected in handleMouseUp
      if (drawingStateRef.current.isDrawingShape || justFinishedDrawingRef.current) {
        return;
      }

      if (toolRef.current !== 'select') {
        selectionRectRef.current = null;
        return;
      }

      // Handle single-click object selection (no drag)
      if (!selectionRectRef.current) {
        // Ensure canvas.selection is enabled for single-click selection
        canvas.selection = true;

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
          // If the hit object is a child of a callout group, select the parent group instead
          if (hitObject.group && hitObject.group.data?.type === 'callout') {
            const parentGroup = hitObject.group;
            canvas.setActiveObject(parentGroup);
            // Ensure controls are enabled and coordinates are updated - enable borders too
            if (parentGroup._originalHasBorders === undefined) {
              parentGroup._originalHasBorders = parentGroup.hasBorders;
            }
            parentGroup.set({ hasControls: true, hasBorders: true });
            parentGroup.setCoords();
          } else {
            canvas.setActiveObject(hitObject);
            // If it's a callout group, ensure controls are enabled
            if (hitObject.data?.type === 'callout') {
              if (hitObject._originalHasBorders === undefined) {
                hitObject._originalHasBorders = hitObject.hasBorders;
              }
              hitObject.set({ hasControls: true, hasBorders: true });
              hitObject.setCoords();
            }
          }
          canvas.requestRenderAll();
        } else {
          // Don't deselect if we just finished drawing a shape
          if (justFinishedDrawingRef.current) {
            return;
          }

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
      // If there was no meaningful drag, treat it as a single click and handle accordingly
      if (selWidth <= 5 && selHeight <= 5) {
        // No meaningful drag - clear selection rectangle and handle as single click
        selectionRectRef.current = null;
        if (selectionRectObjRef.current) {
          canvas.remove(selectionRectObjRef.current);
          selectionRectObjRef.current = null;
          canvas.renderAll();
        }

        // Handle single-click deselection (clicked on empty space)
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
      }

      // There was a meaningful drag - perform drag selection
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
            } else {

            }
          }
        });

        // Apply our custom selection
        // Re-enable canvas.selection to show selection handles/outline for selected objects
        // This was disabled during drag selection to prevent interference
        canvas.selection = true;

        canvas.discardActiveObject();
        if (objectsToSelect.length === 1) {
          canvas.setActiveObject(objectsToSelect[0]);
        } else if (objectsToSelect.length > 1) {
          const activeSelection = new fabric.ActiveSelection(objectsToSelect, { canvas });
          canvas.setActiveObject(activeSelection);
        }
        canvas.requestRenderAll();

        // Also update callout selection rect for CalloutOverlay to handle
        setCalloutSelectionRect({
          left: selLeft,
          top: selTop,
          right: selRight,
          bottom: selBottom,
          isWindowSelection
        });
        // Clear callout selection rect after a tick so the effect can process it
        setTimeout(() => setCalloutSelectionRect(null), 0);
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
    canvas.on('mouse:down', (opt) => {
      // Detect right-click: actual right button, or Ctrl+click (Windows/Linux), or Command+click (Mac)
      const isRightClick = opt.e.button === 2 || opt.e.which === 3 || (opt.e.ctrlKey && opt.e.button === 0) || (opt.e.metaKey && opt.e.button === 0);

      // Handle right-click for context menu directly from Fabric.js event
      if (isRightClick) {
        opt.e.preventDefault(); // Prevent default browser context menu
        // Create a synthetic event object that matches what handleContextMenu expects
        const syntheticEvent = {
          preventDefault: () => opt.e.preventDefault(),
          clientX: opt.e.clientX || opt.e.pageX || (opt.e.touches && opt.e.touches[0] ? opt.e.touches[0].clientX : 0),
          clientY: opt.e.clientY || opt.e.pageY || (opt.e.touches && opt.e.touches[0] ? opt.e.touches[0].clientY : 0),
          button: opt.e.button,
          which: opt.e.which
        };
        // Pass the Fabric.js target directly to avoid needing to call findTarget again
        handleContextMenu(syntheticEvent, opt.target);
        return; // Don't process as regular mouse down
      }

      handleMouseDown(opt);
    });
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
  }, [pageNumber, width, height]);

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
    // Ensure survey panel ref is current when this effect runs
    showSurveyPanelRef.current = showSurveyPanel;
    selectedModuleIdRef.current = selectedModuleId;
    selectedSpaceIdRef.current = selectedSpaceId;

    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    canvas.isDrawingMode = tool === 'pen' || tool === 'highlighter';
    // Disable Fabric.js built-in selection for select tool - we use custom selection handlers
    // Only enable built-in selection for pan tool (for object manipulation)
    // Set canvas.selection based on tool - enable for select tool, disable for others
    canvas.selection = tool === 'select';
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
    // FIX: This effect should ONLY handle interactivity (selectable/evented), NOT visibility
    // The main visibility filter (lines 4817+) handles all visibility logic including regions/toggle
    // Don't set visible here - let the main filter handle it
    canvas.getObjects().forEach((obj, idx) => {
      // Only update interactivity based on tool - don't touch visibility
      // The main visibility filter will have already set visibility correctly
      const isSelectable = tool !== 'pen' && tool !== 'highlighter' && tool !== 'highlight';
      // Callouts should only be evented when using select, pan, or callout tool to prevent blocking other annotation tools
      const isCallout = obj.data?.type === 'callout';
      const shouldBeEvented = isSelectable && (!isCallout || tool === 'select' || tool === 'pan' || tool === 'callout');

      // Only update interactivity properties, preserve visibility from main filter
      obj.set({
        selectable: obj.visible && isSelectable, // Only selectable if visible AND tool allows it
        evented: obj.visible && shouldBeEvented, // Only evented if visible AND tool allows it
        // Enable pixel-perfect hit detection for selection (our findTarget override handles the logic)
        // This ensures we can detect actual annotation content, not just bounding box
        perPixelTargetFind: true,
        targetFindTolerance: (tool === 'pan' || tool === 'select') ? 5 : 0
      });
    });
    // Don't call renderAll here - let the main visibility filter handle rendering
    // canvas.renderAll();
  }, [tool, strokeColor, strokeWidth, selectedModuleId, selectedSpaceId, showSurveyPanel]);

  // Track rendered highlight objects by highlightId for updates
  const renderedHighlightsRef = useRef(new Map()); // Map<highlightId, fabric.Rect>

  // Add highlights when newHighlights prop changes
  useEffect(() => {
    console.log('[PageAnnotationLayer DEBUG] newHighlights useEffect triggered for page', pageNumber, '- newHighlights:', newHighlights);
    if (!fabricRef.current || !newHighlights || newHighlights.length === 0) {
      console.log('[PageAnnotationLayer DEBUG] Early return - fabricRef:', !!fabricRef.current, 'newHighlights:', newHighlights);
      return;
    }

    const canvas = fabricRef.current;
    const currentZoom = canvas.getZoom();
    let addedAny = false;

    newHighlights.forEach((highlight, index) => {
      console.log('[PageAnnotationLayer DEBUG] Processing highlight', index, ':', highlight);
      // Create a unique key for this highlight to avoid duplicates
      // Use highlightId if available, otherwise use coordinates
      const highlightKey = highlight.highlightId || `${highlight.x}-${highlight.y}-${highlight.width}-${highlight.height}`;

      // Track the existing regionId to preserve when re-adding
      // This prevents highlights created outside a region from getting regionId when re-rendered
      // IMPORTANT: undefined means "not captured yet", null means "explicitly no regionId"
      let preservedRegionId; // undefined by default

      // Check if we already have this highlight rendered
      if (highlight.highlightId && renderedHighlightsRef.current.has(highlight.highlightId)) {
        const existingRect = renderedHighlightsRef.current.get(highlight.highlightId);

        // Verify it's still on the canvas
        if (canvas.getObjects().includes(existingRect)) {
          // Capture the existing regionId BEFORE any removal
          // Keep the exact value: could be null (no regionId), undefined, or a real ID
          preservedRegionId = existingRect.regionId !== undefined ? existingRect.regionId : null;

          // Check if properties match (color, needsBIC, bounds)
          const rawColor = highlight.color || highlightColor;
          const color = normalizeHighlightColor(rawColor) || highlightColor;
          const renderScale = currentZoom || scale;

          // Check bounds
          const currentLeft = existingRect.left;
          const currentTop = existingRect.top;
          const currentWidth = existingRect.width;
          const currentHeight = existingRect.height;

          const targetLeft = highlight.x;
          const targetTop = highlight.y;
          const targetWidth = highlight.width;
          const targetHeight = highlight.height;

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
          console.log('[PageAnnotationLayer DEBUG] Checking if update needed - boundsMatch:', boundsMatch, 'needsBIC:', needsBIC, 'existingNeedsBIC:', existingNeedsBIC, 'existingFill:', existingRect.fill, 'targetColor:', color);
          if (boundsMatch && needsBIC === existingNeedsBIC) {
            // For solid highlights, check color
            if (!needsBIC) {
              if (existingRect.fill === color) {
                console.log('[PageAnnotationLayer DEBUG] Skipping - already rendered correctly with same color');
                return; // Skip, already rendered correctly
              } else {
                console.log('[PageAnnotationLayer DEBUG] Color mismatch! existingFill:', existingRect.fill, 'targetColor:', color);
              }
            } else {
              console.log('[PageAnnotationLayer DEBUG] Skipping - needsBIC style is constant');
              return; // Skip, already rendered correctly (BIC style is constant)
            }
          }

          // If we get here, something changed. Remove the old one and let it be re-added.
          console.log('[PageAnnotationLayer DEBUG] Removing old highlight to re-add with new properties');
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
      const highlightCanvasX = highlight.x;
      const highlightCanvasY = highlight.y;
      const highlightCanvasWidth = highlight.width;
      const highlightCanvasHeight = highlight.height;

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

      // Remove matching highlights, but capture regionId if we haven't already
      // This ensures highlights retain their regionId even when re-rendered via bounds match
      matchingRects.forEach(rect => {
        // CRITICAL FIX: Capture regionId from bounds-matched rect if we haven't captured one yet
        // This handles the case where the highlightId-based check didn't find the highlight
        // (e.g., when a different highlight's bounds-based removal already deleted it from renderedHighlightsRef)
        if (preservedRegionId === undefined) {
          // Capture the regionId - could be null (explicitly no regionId) or a real ID
          preservedRegionId = rect.regionId !== undefined ? rect.regionId : null;
        }
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
            left: highlight.x,
            top: highlight.y,
            width: highlight.width,
            height: highlight.height,
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
          // Store current moduleId on the highlight
          const objModuleId = highlight.moduleId || selectedModuleIdRef.current;
          if (objModuleId) {
            rect.set({ moduleId: objModuleId });
          }
          // Preserve existing regionId from canvas object, or assign new one if appropriate
          // This ensures highlights created outside a region don't get regionId when re-rendered
          // CRITICAL: preservedRegionId === null means "explicitly no regionId" (different from undefined)
          if (preservedRegionId !== undefined) {
            // We captured the regionId from the existing canvas object (could be null or a real ID)
            // null means the highlight was INTENTIONALLY created without regionId - preserve that
            rect.set({ regionId: preservedRegionId });
          } else if (highlight.regionId) {
            // Use regionId from highlight data if available
            rect.set({ regionId: highlight.regionId });
          } else if (shouldAssignRegionId()) {
            // Only assign new regionId if nothing was preserved and conditions are met
            rect.set({ regionId: activeRegionIdRef.current });
          } else {
            // Explicitly no regionId
            rect.set({ regionId: null });
          }
          // Set proper visibility - survey annotations should only be visible when survey panel is open
          const isSurveyAnnotation = objModuleId !== null;
          const surveyAnnotationVisible = !isSurveyAnnotation || (showSurveyPanelRef.current && selectedModuleIdRef.current !== null && objModuleId === selectedModuleIdRef.current);
          rect.set({ visible: surveyAnnotationVisible });
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
            left: highlight.x,
            top: highlight.y,
            width: highlight.width,
            height: highlight.height,
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
          // Store current moduleId on the highlight
          const objModuleId = highlight.moduleId || selectedModuleIdRef.current;
          if (objModuleId) {
            rect.set({ moduleId: objModuleId });
          }
          // Preserve existing regionId from canvas object, or assign new one if appropriate
          // This ensures highlights created outside a region don't get regionId when re-rendered
          // CRITICAL: preservedRegionId === null means "explicitly no regionId" (different from undefined)
          if (preservedRegionId !== undefined) {
            // We captured the regionId from the existing canvas object (could be null or a real ID)
            // null means the highlight was INTENTIONALLY created without regionId - preserve that
            rect.set({ regionId: preservedRegionId });
          } else if (highlight.regionId) {
            // Use regionId from highlight data if available
            rect.set({ regionId: highlight.regionId });
          } else if (shouldAssignRegionId()) {
            // Only assign new regionId if nothing was preserved and conditions are met
            rect.set({ regionId: activeRegionIdRef.current });
          } else {
            // Explicitly no regionId
            rect.set({ regionId: null });
          }
          // Set proper visibility - survey annotations should only be visible when survey panel is open
          const isSurveyAnnotation = objModuleId !== null;
          const surveyAnnotationVisible = !isSurveyAnnotation || (showSurveyPanelRef.current && selectedModuleIdRef.current !== null && objModuleId === selectedModuleIdRef.current);
          rect.set({ visible: surveyAnnotationVisible });
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
        sanitizeTextStyles(canvas);
        const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'regionId', 'data', 'name', 'highlightId', 'needsBIC', 'layer', 'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType']);
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
      // Compare canvas coordinates (obj is in canvas coords, boundsToRemove converted to canvas coords)
      // NOTE: Objects are stored in PDF coordinates (logical), so we match directly without scaling
      const boundsCanvasX = boundsToRemove.x;
      const boundsCanvasY = boundsToRemove.y;
      const boundsCanvasWidth = boundsToRemove.width;
      const boundsCanvasHeight = boundsToRemove.height;
      const objectsToRemove = [];
      canvas.getObjects('rect').forEach(obj => {
        // Check if this is a highlight rectangle
        // All highlights have a highlightId property (normal highlights and needsBIC dashed outlines)
        // The needsBIC highlights have fill: 'transparent', so we need to check for highlightId
        // instead of just checking fill color
        const isHighlight = obj.highlightId !== undefined;

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
        sanitizeTextStyles(canvas);
        const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'regionId', 'data', 'name', 'layer', 'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType']);
        onSaveAnnotations(pageNumber, canvasJSON);
      } catch (e) {
        console.error(`[Page ${pageNumber}] Save error after removal:`, e);
      }
    }
  }, [highlightsToRemove, pageNumber, onSaveAnnotations, scale]);

  // Helper function to get spaceId from regionId
  const getSpaceIdForRegion = useCallback((regionId) => {
    if (!regionId || !spaces || spaces.length === 0) return null;

    for (const space of spaces) {
      const assignedPages = space.assignedPages || [];
      for (const page of assignedPages) {
        const regions = page.regions || [];
        for (const region of regions) {
          if (region.regionId === regionId) {
            return space.id;
          }
        }
      }
    }
    return null;
  }, [spaces]);

  // Filter objects by selected space and regions
  useEffect(() => {
    if (!canvasRef.current || !fabric) return;

    const canvas = fabricRef.current;
    const objects = canvas.getObjects();
    // FIX: When region selection is active, preserve regions even if activeRegions is null temporarily
    // This ensures annotations remain visible during region editing
    // Use empty array to represent "regions mode active but no regions yet" vs null = "no regions mode"
    const regions = (Array.isArray(activeRegions) && activeRegions.length > 0)
      ? activeRegions
      : (isRegionSelectionActive ? [] : null);
    const hasActiveRegions = regions !== null; // null = no regions mode, [] or [...] = regions mode active

    let visibleCount = 0;
    let hiddenCount = 0;
    objects.forEach(obj => {
      // FIX: Check layer visibility FIRST - if layer is hidden, object is hidden regardless of other conditions
      const objLayer = obj.layer || 'native';
      const layerVisible = layerVisibilityRef.current[objLayer] !== false;
      if (!layerVisible) {
        obj.set({ visible: false, selectable: false, evented: false });
        hiddenCount += 1;
        return; // Skip further visibility checks
      }

      const objModuleId = obj.moduleId || null;
      const objRegionId = obj.regionId || null; // Get region ID from annotation

      // Check if this is a survey annotation (has moduleId) - applies to highlights, callouts, and other annotations
      const isSurveyAnnotation = objModuleId !== null;

      // Check if this is a scoped region annotation
      const isScopedRegionAnnotation = objRegionId !== null;

      // Derive spaceId from regionId for region-scoped annotations
      let derivedSpaceId = null;
      if (isScopedRegionAnnotation && objRegionId !== null) {
        derivedSpaceId = getSpaceIdForRegion(objRegionId);
      }

      // Filter by space:
      // - Region-scoped annotations: derive spaceId from regionId and check if that space is ACTIVE (activeSpaceId)
      // - Background annotations (objRegionId === null): always pass space filter and be controlled by per-region lightbulb
      let matchesSpace = true;
      if (hasActiveRegions && !isScopedRegionAnnotation) {
        // When regions are active, don't filter background annotations by space
        matchesSpace = true;
      } else {
        // For region-scoped annotations: only visible when their derived space is ACTIVE (activeSpaceId, not selectedSpaceId)
        // Requirement: "When no space is active: Region-scoped annotations: Hidden (no regions are active)"
        if (isScopedRegionAnnotation && derivedSpaceId !== null) {
          matchesSpace = activeSpaceId !== null && derivedSpaceId === activeSpaceId;
        } else {
          // Background annotations (objRegionId === null): always pass space filter check
          // Visibility will be controlled by per-region lightbulb toggle
          matchesSpace = true;
        }
      }

      // Filter by module: if selectedModuleId is set, object must match
      const matchesModule = selectedModuleId === null || objModuleId === selectedModuleId;

      // Three-layer visibility logic:
      // - Base layer (no moduleId, no regionId): hidden when survey mode is active with a module selected
      // - Middle layer (has moduleId, no regionId): visible only when survey mode is active AND module matches
      // - Top layer (has regionId): handled by scopedRegionAnnotationVisible below
      let surveyAnnotationVisible = true;
      if (isSurveyAnnotation) {
        // Survey annotation: visible only when survey panel is open AND module matches
        surveyAnnotationVisible = showSurveyPanel && selectedModuleId !== null && objModuleId === selectedModuleId;
      } else if (!isScopedRegionAnnotation) {
        // Regular annotation (base layer): hidden when survey mode is active with a module selected
        surveyAnnotationVisible = !(showSurveyPanel && selectedModuleId !== null);
      }
      // Region-scoped annotations (top layer) always pass this check - visibility controlled by scopedRegionAnnotationVisible

      // Scoped region annotations should only be visible when their region is active
      // Annotations created while a region is active should persist after region edits,
      // regardless of whether they remain within the updated region geometry
      // Requirement: "When no space is active: Region-scoped annotations: Hidden (no regions are active)"
      let scopedRegionAnnotationVisible = true;
      if (isScopedRegionAnnotation && objRegionId !== null) {
        // First check: if no space is active, hide all region-scoped annotations
        if (activeSpaceId === null) {
          scopedRegionAnnotationVisible = false;
        } else if (hasActiveRegions) {
          // If there are active regions and a space is active, always show annotations that were created while a region was active
          // This ensures they persist even after region boundaries are modified
          scopedRegionAnnotationVisible = true;
        } else if (activeRegionId !== null) {
          // Fallback: if only activeRegionId is set (backward compatibility)
          scopedRegionAnnotationVisible = objRegionId === activeRegionId;
        } else {
          // No active regions, hide scoped annotations
          scopedRegionAnnotationVisible = false;
        }
      }

      // Background annotations visibility logic
      // Background annotations (objRegionId === null) should respect the per-region lightbulb toggle
      // when a space is active, or be visible when no space is active
      let backgroundAnnotationVisible = true;

      // Only apply to background annotations (not scoped region annotations)
      if (!isScopedRegionAnnotation && objRegionId === null) {
        // This is a background annotation (made outside any space/region)
        if (selectedSpaceId !== null && getRegionLightbulbState) {
          // A space is active: check the per-region lightbulb state for this page
          const lightbulbResult = getRegionLightbulbState(selectedSpaceId, pageNumber);
          backgroundAnnotationVisible = lightbulbResult;

        } else {
          // No space is active: background annotations should always be visible
          backgroundAnnotationVisible = true;
        }
      }

      // Object is visible if:
      // 1. It matches space and module filters
      // 2. Survey annotations are visible (if applicable)
      // 3. Scoped region annotations are visible (if applicable)
      // 4. Background annotations respect the per-region lightbulb toggle
      const isVisible = matchesSpace &&
        matchesModule &&
        surveyAnnotationVisible &&
        scopedRegionAnnotationVisible &&
        (isScopedRegionAnnotation ? true : backgroundAnnotationVisible);

      // Interaction logic:
      // - When a space is active (activeSpaceId !== null), background annotations (objRegionId === null) 
      //   should NOT be interactive, regardless of visibility
      // - Region-scoped annotations can be interactive when their space is active
      // - Background annotations can only be interactive when no space is active
      let isInteractive = false;
      if (isVisible) {
        if (activeSpaceId !== null) {
          // Space is active: only region-scoped annotations can be interactive
          // Background annotations (objRegionId === null) are NOT interactive
          if (isScopedRegionAnnotation && derivedSpaceId === activeSpaceId) {
            // Region-scoped annotation in the active space - can be interactive
            isInteractive = (selectedModuleId === null || objModuleId === selectedModuleId);
          } else {
            // Background annotation or wrong space - not interactive
            isInteractive = false;
          }
        } else {
          // No space active: all visible annotations can be interactive
          isInteractive = (selectedModuleId === null || objModuleId === selectedModuleId);
        }
      }

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

    canvas.renderAll();
  }, [selectedSpaceId, activeSpaceId, selectedModuleId, selectedCategoryId, showSurveyPanel, activeRegions, scale, activeRegionId, isRegionSelectionActive, layerVisibility, tool, pageNumber, spaces, getSpaceIdForRegion, getRegionLightbulbState]);

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

      // Get all active objects (supports both single and multiple selections)
      const activeObjects = canvas.getActiveObjects();
      if (activeObjects.length === 0) return;

      // Prevent default browser behavior (e.g., going back in history)
      e.preventDefault();
      e.stopPropagation();

      // Process each selected object for deletion
      const highlightsToDelete = [];

      activeObjects.forEach(activeObject => {
        // Check if this is a highlight that needs special handling
        const isHighlight = activeObject.highlightId != null;

        if (isHighlight && onHighlightDeletedRef.current) {
          // Collect highlight info for callback after removal
          const bounds = activeObject.getBoundingRect(true);
          const highlightId = activeObject.highlightId;
          highlightsToDelete.push({ pageNumber, bounds, highlightId, object: activeObject });
        }
      });

      // Remove all selected objects from canvas
      canvas.remove(...activeObjects);
      canvas.discardActiveObject();
      canvas.requestRenderAll();

      // Clean up highlight refs and call callbacks
      highlightsToDelete.forEach(({ bounds, highlightId, object }) => {
        // Clean up refs
        renderedHighlightsRef.current.delete(highlightId);
        const key = highlightId || `${object.left}-${object.top}-${object.width}-${object.height}`;
        processedHighlightsRef.current.delete(key);

        // Call highlight deletion callback
        if (onHighlightDeletedRef.current) {
          onHighlightDeletedRef.current(pageNumber, bounds, highlightId);
        }
      });

      // Save the canvas state
      try {
        sanitizeTextStyles(canvas);
        const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'regionId', 'data', 'name', 'highlightId', 'needsBIC', 'globalCompositeOperation', 'layer', 'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType']);
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
      onContextMenu={(e) => {
        handleContextMenu(e);
      }}
      onMouseDown={(e) => {
        // Detect Command+Click (Mac) or Control+Click (Windows) as context menu trigger
        // This should fire before Fabric.js processes the event
        const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
        const isModifierContextClick = e.button === 0 && (
          isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey)
        );

        if (isModifierContextClick) {
          e.preventDefault();
          e.stopPropagation();
          handleContextMenu(e);
        }
      }}
      onClick={(e) => {
        // Don't close context menu if:
        // 1. It's a right-click or Command/Ctrl+click
        // 2. The context menu was just opened (prevent immediate closing)
        const isRightClick = e.button === 2 || e.which === 3 || e.ctrlKey || e.metaKey;
        if (!isRightClick && !contextMenuJustOpenedRef.current) {
          if (contextMenu) closeContextMenu();
          if (editModal) closeEditModal();
        }
      }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        marginTop: '0px',
        paddingTop: '12px',
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

      {/* Callout Overlay - rendered on top of Fabric canvas */}
      <CalloutOverlay
        callouts={callouts}
        setCallouts={setCallouts}
        selectedCalloutId={selectedCalloutId}
        setSelectedCalloutId={setSelectedCalloutId}
        isCalloutToolActive={tool === 'callout'}
        activeTool={tool}
        pageNumber={pageNumber}
        pageWidth={width}
        pageHeight={height}
        defaultStyle={{
          borderColor: strokeColor,
          lineThickness: strokeWidth,
        }}
        selectionRect={calloutSelectionRect}
        selectedSpaceId={selectedSpaceId}
        selectedModuleId={selectedModuleId}
        showSurveyPanel={showSurveyPanel}
        clipboardCallout={clipboardCallout}
        clipboardCalloutType={clipboardCalloutType}
        onCutCallout={onCutCallout}
        onCopyCallout={onCopyCallout}
        onPasteCallout={onPasteCallout}
        middleAreaBounds={middleAreaBounds}
        surveyPanelWidth={surveyPanelWidth}
      />

      {/* Context Menu */}
      {contextMenu && contextMenu.visible && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#333',
            border: '1px solid #444',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            zIndex: 10000,
            padding: '4px',
            minWidth: '180px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif'
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Annotation Menu */}
          {contextMenu.type === 'annotation' && (
            <>
              <button
                onClick={handleCut}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Cut
              </button>
              <button
                onClick={handleCopy}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Copy
              </button>
              {clipboardRef.current && (
                <button
                  onClick={handlePaste}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#ddd',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  Paste
                </button>
              )}
              <div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
              {contextMenu.target && contextMenu.target.type === 'activeSelection' && (
                <button
                  onClick={handleGroup}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#ddd',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  Group
                </button>
              )}
              {contextMenu.target && contextMenu.target.type === 'group' && (
                <button
                  onClick={handleUngroup}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#ddd',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  Ungroup
                </button>
              )}
              <button
                onClick={handleEdit}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Properties
              </button>
              <div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
              <button
                onClick={handleDeleteAnnotation}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ff6b6b',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Delete
              </button>
            </>
          )}

          {/* Callout Menu */}
          {contextMenu.type === 'callout' && (
            <>
              <button
                onClick={handleCutCalloutFromMenu}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Cut
              </button>
              <button
                onClick={handleCopyCalloutFromMenu}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Copy
              </button>
              {clipboardCallout && (
                <button
                  onClick={handlePasteCalloutFromMenu}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#ddd',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  Paste
                </button>
              )}
              <div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
              <button
                onClick={handleEditCalloutFromMenu}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Properties
              </button>
              <div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
              <button
                onClick={handleDeleteCalloutFromMenu}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ff6b6b',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Delete
              </button>
            </>
          )}

          {/* Page Menu */}
          {contextMenu.type === 'page' && (
            <>
              {(clipboardRef.current || clipboardCallout) && (
                <>
                  <button
                    onClick={clipboardRef.current ? handlePaste : handlePasteCalloutFromMenu}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '13px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: '#ddd',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    Paste
                  </button>
                  <div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
                </>
              )}
              {pageClipboard && (
                <>
                  <button
                    onClick={() => { onPastePageHere(pageNumber); closeContextMenu(); }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '13px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: '#ddd',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    Paste Page
                  </button>
                  <div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
                </>
              )}
              <button
                onClick={() => { onDuplicatePage(pageNumber); closeContextMenu(); }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Duplicate Page
              </button>
              <div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
              <button
                onClick={() => { onRotatePageCW(pageNumber); closeContextMenu(); }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Rotate Clockwise
              </button>
              <button
                onClick={() => { onRotatePageCCW(pageNumber); closeContextMenu(); }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Rotate Counter-Clockwise
              </button>
              <div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
              <button
                onClick={() => { onInsertBlankPage(pageNumber); closeContextMenu(); }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Insert Blank Page
              </button>
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
            background: '#2b2b2b',
            border: '1px solid #444',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 10001,
            minWidth: '200px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            onMouseDown={(e) => {
              // Don't start drag if clicking on the close button
              if (e.target.closest('button')) {
                return;
              }
              if (!editModal) return;
              e.stopPropagation();
              isDraggingModalRef.current = true;
              modalDragStartRef.current = {
                x: editModal.x,
                y: editModal.y,
                startX: e.clientX,
                startY: e.clientY
              };
            }}
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#252525',
              cursor: 'move',
              userSelect: 'none'
            }}
          >
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#ddd' }}>Edit Property</h3>
            <button
              onClick={cancelEdit}
              onMouseDown={(e) => {
                // Stop propagation to prevent drag from starting when clicking close button
                e.stopPropagation();
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                fontSize: 18,
                color: '#999',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#ddd'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#999'}
            >
              ×
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: '12px', background: '#2b2b2b' }}>

            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: '500', color: '#999', textTransform: 'uppercase', marginBottom: '6px' }}>Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="color"
                  value={editValues.stroke}
                  onChange={(e) => setEditValues(prev => ({ ...prev, stroke: e.target.value }))}
                  style={{ width: '30px', height: '30px', borderRadius: '4px', border: '1px solid #555', padding: 0, cursor: 'pointer' }}
                />
                <input
                  type="text"
                  value={editValues.stroke}
                  onChange={(e) => setEditValues(prev => ({ ...prev, stroke: e.target.value }))}
                  style={{
                    width: '80px',
                    height: '30px',
                    borderRadius: '4px',
                    border: '1px solid #555',
                    padding: '0 8px',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    background: '#333',
                    color: '#ddd'
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: '500', color: '#999', textTransform: 'uppercase', marginBottom: '6px' }}>Line Weight</label>
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
                    border: '1px solid #555',
                    padding: '0 4px',
                    fontSize: '12px',
                    textAlign: 'center',
                    background: '#333',
                    color: '#ddd'
                  }}
                />
                <span style={{ fontSize: '12px', color: '#999' }}>px</span>
              </div>
            </div>

            {/* Arrowhead Style - only show for arrow objects */}
            {editModal.object.data?.type === 'arrow' && (
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '10px', fontWeight: '500', color: '#999', textTransform: 'uppercase', marginBottom: '6px' }}>Arrowhead Style</label>
                <select
                  value={editValues.arrowheadStyle || ARROWHEAD_STYLES.SOLID_TRIANGLE}
                  onChange={(e) => setEditValues(prev => ({ ...prev, arrowheadStyle: e.target.value }))}
                  style={{
                    width: '100%',
                    height: '32px',
                    borderRadius: '4px',
                    border: '1px solid #555',
                    padding: '0 8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    backgroundColor: '#333',
                    color: '#ddd'
                  }}
                >
                  {Object.entries(ARROWHEAD_STYLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            {(editModal.object.data?.type === 'callout' || editModal.object.data?.reactCalloutId) && (
              <>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '10px', fontWeight: '500', color: '#999', textTransform: 'uppercase', marginBottom: '6px' }}>Text Style</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                    {/* Text Color */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="color"
                        value={editValues.fill || '#000000'}
                        onChange={(e) => setEditValues(prev => ({ ...prev, fill: e.target.value }))}
                        style={{ width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #555', padding: 0, cursor: 'pointer' }}
                        title="Text Color"
                      />
                    </div>

                    {/* Font Family */}
                    <select
                      value={editValues.fontFamily || 'Arial'}
                      onChange={(e) => setEditValues(prev => ({ ...prev, fontFamily: e.target.value }))}
                      style={{ height: '24px', borderRadius: '4px', border: '1px solid #555', fontSize: '12px', cursor: 'pointer', background: '#333', color: '#ddd' }}
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
                      style={{ width: '50px', height: '24px', borderRadius: '4px', border: '1px solid #555', padding: '0 4px', fontSize: '12px', background: '#333', color: '#ddd' }}
                      title="Font Size"
                    />

                    {/* Bold */}
                    <button
                      onClick={() => setEditValues(prev => ({ ...prev, fontWeight: prev.fontWeight === 'bold' ? 'normal' : 'bold' }))}
                      style={{
                        padding: '6px 10px', borderRadius: '4px', border: editValues.fontWeight === 'bold' ? '1px solid #4A90E2' : '1px solid #555',
                        background: editValues.fontWeight === 'bold' ? '#4A90E2' : '#333',
                        color: editValues.fontWeight === 'bold' ? 'white' : '#ddd',
                        fontWeight: 'bold', cursor: 'pointer', fontSize: '14px'
                      }}
                    >B</button>

                    {/* Italic */}
                    <button
                      onClick={() => setEditValues(prev => ({ ...prev, fontStyle: prev.fontStyle === 'italic' ? 'normal' : 'italic' }))}
                      style={{
                        padding: '6px 10px', borderRadius: '4px', border: editValues.fontStyle === 'italic' ? '1px solid #4A90E2' : '1px solid #555',
                        background: editValues.fontStyle === 'italic' ? '#4A90E2' : '#333',
                        color: editValues.fontStyle === 'italic' ? 'white' : '#ddd',
                        fontStyle: 'italic', cursor: 'pointer', fontSize: '14px'
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
                          flex: 1, padding: '6px 12px', borderRadius: '4px', border: editValues.textAlign === align ? '1px solid #4A90E2' : '1px solid #555',
                          background: editValues.textAlign === align ? '#4A90E2' : '#333',
                          color: editValues.textAlign === align ? 'white' : '#ddd',
                          cursor: 'pointer', fontSize: '12px', textTransform: 'capitalize'
                        }}
                      >
                        {align}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fill Color (Background) */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '10px', fontWeight: '500', color: '#999', textTransform: 'uppercase', marginBottom: '6px' }}>Fill Color</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="color"
                      value={editValues.fillColor === 'transparent' || !editValues.fillColor ? '#ffffff' : editValues.fillColor}
                      onChange={(e) => setEditValues(prev => ({ ...prev, fillColor: e.target.value }))}
                      style={{ width: '30px', height: '30px', borderRadius: '4px', border: '1px solid #555', padding: 0, cursor: 'pointer' }}
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
                        border: '1px solid #555',
                        padding: '0 8px',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        background: '#333',
                        color: '#ddd'
                      }}
                    />
                    <button
                      onClick={() => setEditValues(prev => ({ ...prev, fillColor: 'transparent' }))}
                      style={{
                        padding: '4px 8px', borderRadius: '4px', border: editValues.fillColor === 'transparent' ? '1px solid #4A90E2' : '1px solid #555',
                        background: editValues.fillColor === 'transparent' ? '#4A90E2' : '#333',
                        color: editValues.fillColor === 'transparent' ? 'white' : '#ddd',
                        cursor: 'pointer', fontSize: '11px'
                      }}
                    >No Fill</button>
                  </div>
                </div>
              </>
            )}

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: '500', color: '#999', textTransform: 'uppercase', marginBottom: '6px' }}>Opacity</label>
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
                    border: '1px solid #555',
                    padding: '0 4px',
                    fontSize: '12px',
                    textAlign: 'center',
                    background: '#333',
                    color: '#ddd'
                  }}
                />
                <span style={{ fontSize: '12px', color: '#999' }}>%</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={cancelEdit}
                style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #555', background: '#333', color: '#ddd', cursor: 'pointer', fontSize: '12px' }}
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', background: '#4A90E2', color: 'white', cursor: 'pointer', fontSize: '12px' }}
              >
                Save
              </button>
            </div>
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
    prevProps.activeSpaceId === nextProps.activeSpaceId &&
    prevProps.selectedModuleId === nextProps.selectedModuleId &&
    prevProps.selectedCategoryId === nextProps.selectedCategoryId &&
    prevProps.activeRegions === nextProps.activeRegions &&
    prevProps.getRegionLightbulbState === nextProps.getRegionLightbulbState &&
    prevProps.spaces === nextProps.spaces &&
    prevProps.activeRegionId === nextProps.activeRegionId &&
    prevProps.isRegionSelectionActive === nextProps.isRegionSelectionActive &&
    prevProps.showSurveyPanel === nextProps.showSurveyPanel &&
    prevProps.layerVisibility === nextProps.layerVisibility &&
    prevProps.callouts === nextProps.callouts &&
    prevProps.selectedCalloutId === nextProps.selectedCalloutId
  );
});

PageAnnotationLayer.displayName = 'PageAnnotationLayer';

export default PageAnnotationLayer;

