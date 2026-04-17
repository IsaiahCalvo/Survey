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
    case 'polygon':
    case 'polyline':
      return getPointsBBox(obj);
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

/**
 * Get the absolute SVG endpoints for a line-type annotation.
 * Uses the same center-based formula as renderLine in svgAnnotationRenderers.jsx.
 *
 * @param {object} obj - Fabric.js line JSON object
 * @returns {{ x1: number, y1: number, x2: number, y2: number }}
 */
export function getLineEndpoints(obj) {
  const centerX = (obj.left ?? 0) + (obj.width ?? 0) / 2;
  const centerY = (obj.top ?? 0) + (obj.height ?? 0) / 2;
  return {
    x1: centerX + (obj.x1 ?? 0),
    y1: centerY + (obj.y1 ?? 0),
    x2: centerX + (obj.x2 ?? 0),
    y2: centerY + (obj.y2 ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Internal bbox helpers per annotation type
// ---------------------------------------------------------------------------

function getPathBBox(obj) {
  const left = obj.left;
  const top = obj.top;
  const w = obj.width;
  const h = obj.height;

  // pathOffset presence is the discriminator between two path storage shapes:
  //  1) Fabric center-origin path (raw PencilBrush output + serialized pathOffset):
  //     path data is in local coords, left/top = bbox CENTER, width/height = bbox size.
  //  2) Absolute-coord path (user-drawn strokes committed via FabricDrawingCanvas,
  //     which explicitly zeroes left/top; or imported PDF paths with null left/top):
  //     path data already carries world coords, left/top (if any) is a move offset.
  //
  // FabricDrawingCanvas.jsx path:created handler doesn't include pathOffset in
  // CUSTOM_PROPS, so toJSON() omits it — that absence is our signal that the
  // stored path data is absolute. Use path-command scan + left/top as offset.
  const hasPathOffset =
    obj.pathOffset && (obj.pathOffset.x !== 0 || obj.pathOffset.y !== 0);

  // Case 1 — Fabric center-origin path with serialized pathOffset.
  if (hasPathOffset && left != null && top != null && w != null && h != null) {
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

  // Case 2 — absolute-coord path (user-drawn pen strokes + imported PDF paths).
  // Scan path commands for true bounds; apply left/top as a translation offset
  // (0 for freshly-drawn, nonzero after drag), and scaleX/scaleY for resize.
  if (Array.isArray(obj.path) && obj.path.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const seg of obj.path) {
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
      const sx = Math.abs(obj.scaleX ?? 1);
      const sy = Math.abs(obj.scaleY ?? 1);
      const offsetX = left ?? 0;
      const offsetY = top ?? 0;
      return {
        left: offsetX + minX * sx,
        top: offsetY + minY * sy,
        width: (maxX - minX) * sx,
        height: (maxY - minY) * sy,
        angle: obj.angle ?? 0,
      };
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
  // Fabric.js Line toJSON(): left/top = bounding box top-left corner,
  // x1/y1/x2/y2 = offsets from bounding box CENTER.
  // Must compute center first, then add offsets to get absolute coords.
  // (Same formula as renderLine in svgAnnotationRenderers.jsx)
  const centerX = (obj.left ?? 0) + (obj.width ?? 0) / 2;
  const centerY = (obj.top ?? 0) + (obj.height ?? 0) / 2;
  const x1 = centerX + (obj.x1 ?? 0);
  const y1 = centerY + (obj.y1 ?? 0);
  const x2 = centerX + (obj.x2 ?? 0);
  const y2 = centerY + (obj.y2 ?? 0);

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

// Polygon + polyline share the same SVG transform chain as renderPolygon /
// renderPolyline in svgAnnotationRenderers.jsx: for each stored point (p.x, p.y),
// world position = (left + scaleX*(p.x - pathOffsetX), top + scaleY*(p.y - pathOffsetY)).
// We scan obj.points[] for local-space min/max, then apply left/top as translation
// + scaleX/scaleY as magnification. Without this, polygons/polylines fell through to
// getRectBBox which uses {obj.left, obj.top, obj.width, obj.height} — that rect
// can sit far from where SVG actually draws the shape (left/top are a translation
// offset, not the drawn bbox corner), producing hit-test zones that don't match
// the visible shape and missed clicks entirely.
function getPointsBBox(obj) {
  if (!Array.isArray(obj.points) || obj.points.length === 0) {
    return { left: 0, top: 0, width: 0, height: 0, angle: 0 };
  }

  const pathOffsetX = obj.pathOffset?.x || 0;
  const pathOffsetY = obj.pathOffset?.y || 0;
  const sx = Math.abs(obj.scaleX ?? 1);
  const sy = Math.abs(obj.scaleY ?? 1);
  const left = obj.left ?? 0;
  const top = obj.top ?? 0;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of obj.points) {
    const px = typeof p?.x === 'number' ? p.x : 0;
    const py = typeof p?.y === 'number' ? p.y : 0;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  if (minX === Infinity) {
    return { left: 0, top: 0, width: 0, height: 0, angle: 0 };
  }

  return {
    left: left + sx * (minX - pathOffsetX),
    top: top + sy * (minY - pathOffsetY),
    width: (maxX - minX) * sx,
    height: (maxY - minY) * sy,
    angle: obj.angle ?? 0,
  };
}

function getCircleBBox(obj) {
  const radius = obj.radius ?? 0;
  return {
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: radius * 2 * Math.abs(obj.scaleX ?? 1),
    height: radius * 2 * Math.abs(obj.scaleY ?? 1),
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
  const scaleX = Math.abs(obj.scaleX ?? 1);
  const scaleY = Math.abs(obj.scaleY ?? 1);
  const objType = String(obj.type || '').toLowerCase();

  // Textbox sizing: trust stored width/height. PDF-imported textboxes now carry
  // Fabric-measured dims (see pdfAnnotationImporter convertFreeTextToFabricTextbox),
  // so the SVG hit-test rect matches what Fabric actually draws. No descender
  // buffer — Fabric's stored height already covers g/j/p/q/y glyphs (the
  // border rect in renderText hugs descenders cleanly), so the prior
  // `+ fontSize * 0.35` padding added a visible overhang to the hover glow
  // and pushed the bottom selection handles below the true border.
  if (objType === 'textbox' && obj.width && obj.height) {
    return {
      left: obj.left ?? 0,
      top: obj.top ?? 0,
      width: obj.width * scaleX,
      height: obj.height * scaleY,
      angle: obj.angle ?? 0,
    };
  }

  // i-text / text (no stored dims): measure tight bounds with Canvas2D.
  const measured = measureTextBounds(obj);
  return {
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: measured.width,
    height: measured.height,
    angle: obj.angle ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Text measurement utility — tight bounds from actual content
// ---------------------------------------------------------------------------

// Shared offscreen canvas for text width measurement (created once, reused)
let _measureCtx = null;
function getMeasureCtx() {
  if (!_measureCtx) {
    const c = document.createElement('canvas');
    _measureCtx = c.getContext('2d');
  }
  return _measureCtx;
}

/**
 * Count how many visual lines a single explicit line produces when word-wrapped
 * at a given max width. Uses word-boundary splitting for accuracy.
 */
function countWrappedLines(ctx, line, maxWidth) {
  if (!line) return 1;
  const words = line.split(/\s+/);
  if (words.length === 0) return 1;

  let currentWidth = 0;
  let lineCount = 1;
  const spaceWidth = ctx.measureText(' ').width;

  for (let i = 0; i < words.length; i++) {
    const wordWidth = ctx.measureText(words[i]).width;
    const added = i === 0 ? wordWidth : spaceWidth + wordWidth;

    if (currentWidth + added > maxWidth && currentWidth > 0) {
      lineCount++;
      currentWidth = wordWidth; // word moves to next line
    } else {
      currentWidth += added;
    }
  }
  return lineCount;
}

/**
 * Measure tight width and height for a text annotation object.
 * Uses Canvas 2D measureText with word-level wrapping simulation.
 *
 * @param {object} obj - Fabric.js JSON text/textbox/i-text object
 * @returns {{ width: number, height: number }} Tight bounds (already scaled by scaleX/scaleY)
 */
export function measureTextBounds(obj) {
  const text = obj.text || '';
  const fontSize = obj.fontSize || 16;
  const fontFamily = obj.fontFamily || 'sans-serif';
  const fontWeight = obj.fontWeight || 'normal';
  const fontStyle = obj.fontStyle || 'normal';
  const lineHeight = obj.lineHeight || 1.16;
  const scaleX = Math.abs(obj.scaleX ?? 1);
  const scaleY = Math.abs(obj.scaleY ?? 1);
  const containerWidth = obj.width || 100; // base width (before scale)
  const singleLineH = fontSize * lineHeight;

  // Empty text: minimal box
  if (!text.trim()) {
    return { width: 20 * scaleX, height: singleLineH * scaleY };
  }

  const ctx = getMeasureCtx();
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

  const explicitLines = text.split('\n');
  let maxLineWidth = 0;
  let totalVisualLines = 0;

  for (const line of explicitLines) {
    if (line === '') {
      totalVisualLines += 1;
      continue;
    }
    const naturalWidth = ctx.measureText(line).width;

    if (naturalWidth <= containerWidth) {
      // Fits in one line
      maxLineWidth = Math.max(maxLineWidth, naturalWidth);
      totalVisualLines += 1;
    } else {
      // Line wraps — use container width, count wrapped lines
      maxLineWidth = containerWidth;
      totalVisualLines += countWrappedLines(ctx, line, containerWidth);
    }
  }

  // +4px padding to avoid subpixel clipping
  const tightWidth = Math.max(maxLineWidth + 4, 20) * scaleX;
  const tightHeight = Math.max(totalVisualLines * singleLineH + 4, singleLineH) * scaleY;

  return { width: tightWidth, height: tightHeight };
}
