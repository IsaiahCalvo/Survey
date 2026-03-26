/**
 * SVG Bounding Box Utilities
 *
 * Compute bounding boxes from Fabric.js JSON annotation objects,
 * union bounding boxes for multi-select, and handle positions
 * for the selection overlay.
 *
 * Phase 9 Plan 01: Selection foundation utilities.
 */

/**
 * Compute the bounding box of a single Fabric.js JSON annotation object.
 * Handles all annotation types: path, rect, line, group (arrow),
 * circle, ellipse, textbox, i-text, text.
 *
 * @param {object} obj - Fabric.js JSON object
 * @returns {{ left: number, top: number, width: number, height: number, angle: number }}
 */
export function getAnnotationBBox(obj) {
  if (!obj) return { left: 0, top: 0, width: 0, height: 0, angle: 0 };

  const type = String(obj.type || '').toLowerCase();

  switch (type) {
    case 'path':
      return getPathBBox(obj);
    case 'rect':
      return getRectBBox(obj);
    case 'line':
      return getLineBBox(obj);
    case 'group':
      return getGroupArrowBBox(obj);
    case 'circle':
      return getCircleBBox(obj);
    case 'ellipse':
      return getEllipseBBox(obj);
    case 'textbox':
    case 'i-text':
    case 'text':
      return getTextBBox(obj);
    default:
      // Fallback: treat as rect-like
      return getRectBBox(obj);
  }
}

/**
 * Compute the union bounding box of multiple bounding boxes.
 * Used for multi-select group bounding box (Plan 03).
 *
 * @param {Array<{ left: number, top: number, width: number, height: number }>} bboxes
 * @returns {{ left: number, top: number, width: number, height: number, angle: number }}
 */
export function getGroupBBox(bboxes) {
  if (!bboxes || bboxes.length === 0) {
    return { left: 0, top: 0, width: 0, height: 0, angle: 0 };
  }

  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  for (const bbox of bboxes) {
    const l = bbox.left ?? 0;
    const t = bbox.top ?? 0;
    const w = bbox.width ?? 0;
    const h = bbox.height ?? 0;

    if (l < minLeft) minLeft = l;
    if (t < minTop) minTop = t;
    if (l + w > maxRight) maxRight = l + w;
    if (t + h > maxBottom) maxBottom = t + h;
  }

  return {
    left: minLeft,
    top: minTop,
    width: maxRight - minLeft,
    height: maxBottom - minTop,
    angle: 0,
  };
}

/**
 * Compute the 9 handle positions for a selection overlay.
 * Positions include padding offset matching Fabric.js padding: 6.
 *
 * @param {{ left: number, top: number, width: number, height: number }} bbox
 * @param {number} [padding=6] - Padding around the bounding box
 * @returns {Object} Handle positions keyed by handle ID (tl, tr, bl, br, mt, mb, ml, mr, mtr)
 */
export function getHandlePositions(bbox, padding = 6) {
  const { left, top, width, height } = bbox;

  return {
    tl: { x: left - padding, y: top - padding },
    tr: { x: left + width + padding, y: top - padding },
    bl: { x: left - padding, y: top + height + padding },
    br: { x: left + width + padding, y: top + height + padding },
    mt: { x: left + width / 2, y: top - padding },
    mb: { x: left + width / 2, y: top + height + padding },
    ml: { x: left - padding, y: top + height / 2 },
    mr: { x: left + width + padding, y: top + height / 2 },
    mtr: { x: left + width / 2, y: top - padding - 40 }, // 40px above top, matching fabricCustomization.js offsetY: -40
  };
}


// ---------------------------------------------------------------------------
// Imported path detection and coordinate manipulation
// ---------------------------------------------------------------------------

/**
 * Check if an annotation is an imported PDF path (no Fabric.js positioning properties).
 * These annotations have absolute coordinates in path data, not left/top/scaleX/scaleY.
 * Standard Fabric.js paths have left/top/width/height/pathOffset; imported ones don't.
 *
 * @param {object} obj - Fabric.js JSON object
 * @returns {boolean}
 */
export function isImportedPath(obj) {
  return obj?.type === 'path' && obj.left == null && Array.isArray(obj.path);
}

/**
 * Translate all coordinates in path data by (dx, dy).
 * For imported paths that store absolute coordinates.
 *
 * @param {Array} pathData - Fabric.js path array (e.g. [["M", 100, 200], ["L", 300, 400]])
 * @param {number} dx - Horizontal translation
 * @param {number} dy - Vertical translation
 * @returns {Array} New path data with translated coordinates
 */
export function translatePathData(pathData, dx, dy) {
  return pathData.map(seg => {
    const newSeg = [seg[0]]; // keep command letter
    for (let j = 1; j < seg.length; j += 2) {
      newSeg.push(seg[j] + dx);
      if (j + 1 < seg.length) newSeg.push(seg[j + 1] + dy);
    }
    return newSeg;
  });
}

/**
 * Scale all coordinates in path data around an anchor point.
 * For imported paths during resize.
 *
 * @param {Array} pathData - Fabric.js path array
 * @param {number} scaleX - Horizontal scale factor
 * @param {number} scaleY - Vertical scale factor
 * @param {number} anchorX - Anchor X (fixed point during scale)
 * @param {number} anchorY - Anchor Y (fixed point during scale)
 * @returns {Array} New path data with scaled coordinates
 */
export function scalePathData(pathData, scaleX, scaleY, anchorX, anchorY) {
  return pathData.map(seg => {
    const newSeg = [seg[0]]; // keep command letter
    for (let j = 1; j < seg.length; j += 2) {
      newSeg.push(anchorX + (seg[j] - anchorX) * scaleX);
      if (j + 1 < seg.length) newSeg.push(anchorY + (seg[j + 1] - anchorY) * scaleY);
    }
    return newSeg;
  });
}

// ---------------------------------------------------------------------------
// Internal bbox helpers per annotation type
// ---------------------------------------------------------------------------

function getPathBBox(obj) {
  const left = obj.left;
  const top = obj.top;
  const w = obj.width;
  const h = obj.height;

  // If standard Fabric.js properties exist, use them (center-origin for pathOffset paths)
  if (left != null && top != null && w != null && h != null) {
    const sw = w * Math.abs(obj.scaleX ?? 1);
    const sh = h * Math.abs(obj.scaleY ?? 1);
    return {
      left: left - sw / 2,
      top: top - sh / 2,
      width: sw,
      height: sh,
      angle: obj.angle ?? 0,
    };
  }

  // Imported PDF paths: no left/top/width/height — compute bbox from path commands
  if (Array.isArray(obj.path) && obj.path.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const seg of obj.path) {
      // Extract all numeric pairs (skip command letter at index 0)
      for (let j = 1; j < seg.length; j += 2) {
        const x = seg[j];
        const y = seg[j + 1];
        if (typeof x === 'number' && typeof y === 'number') {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minX !== Infinity) {
      return { left: minX, top: minY, width: maxX - minX, height: maxY - minY, angle: 0 };
    }
  }

  return { left: 0, top: 0, width: 0, height: 0, angle: 0 };
}

function getRectBBox(obj) {
  return {
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: Math.abs((obj.width ?? 0) * (obj.scaleX ?? 1)),
    height: Math.abs((obj.height ?? 0) * (obj.scaleY ?? 1)),
    angle: obj.angle ?? 0,
  };
}

function getLineBBox(obj) {
  const objLeft = obj.left ?? 0;
  const objTop = obj.top ?? 0;
  const x1 = objLeft + (obj.x1 ?? 0);
  const y1 = objTop + (obj.y1 ?? 0);
  const x2 = objLeft + (obj.x2 ?? 0);
  const y2 = objTop + (obj.y2 ?? 0);

  let width = Math.abs(x2 - x1);
  let height = Math.abs(y2 - y1);

  // Ensure minimum hittable area for thin lines
  if (width < 10) width = 10;
  if (height < 10) height = 10;

  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width,
    height,
    angle: 0,
  };
}

function getGroupArrowBBox(obj) {
  // Arrow groups contain a line child; compute bbox from group's children
  const objLeft = obj.left ?? 0;
  const objTop = obj.top ?? 0;

  if (!Array.isArray(obj.objects) || obj.objects.length === 0) {
    return { left: objLeft, top: objTop, width: 10, height: 10, angle: 0 };
  }

  // Find the line child to compute endpoints
  const lineChild = obj.objects.find(
    (o) => o && (o.type === 'line' || o.type === 'polyline' || o.type === 'path')
  );

  if (lineChild && lineChild.type === 'line') {
    const x1 = objLeft + (lineChild.x1 ?? 0);
    const y1 = objTop + (lineChild.y1 ?? 0);
    const x2 = objLeft + (lineChild.x2 ?? 0);
    const y2 = objTop + (lineChild.y2 ?? 0);

    let width = Math.abs(x2 - x1);
    let height = Math.abs(y2 - y1);

    if (width < 10) width = 10;
    if (height < 10) height = 10;

    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width,
      height,
      angle: 0,
    };
  }

  // Fallback: use group bounds
  return {
    left: objLeft,
    top: objTop,
    width: Math.abs((obj.width ?? 10) * (obj.scaleX ?? 1)),
    height: Math.abs((obj.height ?? 10) * (obj.scaleY ?? 1)),
    angle: obj.angle ?? 0,
  };
}

function getCircleBBox(obj) {
  const radius = obj.radius ?? 0;
  const diameter = radius * 2 * Math.abs(obj.scaleX ?? 1);
  return {
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: diameter,
    height: diameter,
    angle: obj.angle ?? 0,
  };
}

function getEllipseBBox(obj) {
  return {
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: (obj.rx ?? 0) * 2 * Math.abs(obj.scaleX ?? 1),
    height: (obj.ry ?? 0) * 2 * Math.abs(obj.scaleY ?? 1),
    angle: obj.angle ?? 0,
  };
}

function getTextBBox(obj) {
  return {
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: Math.abs((obj.width ?? 100) * (obj.scaleX ?? 1)),
    height: Math.abs((obj.height ?? 30) * (obj.scaleY ?? 1)),
    angle: obj.angle ?? 0,
  };
}
