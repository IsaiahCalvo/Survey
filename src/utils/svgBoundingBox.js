/**
 * SVG Bounding Box Utilities
 *
 * Compute bounding boxes from Fabric.js JSON annotation objects,
 * union bounding boxes for multi-select, and handle positions
 * for the selection overlay.
 *
 * Phase 9 Plan 01: Selection foundation utilities.
 */
import { createInkPathAffine } from './inkGeometryTransform.js';

const stableSum = (...values) => {
  if (values.some((value) => Number.isNaN(value))) return NaN;
  if (values.some((value) => !Number.isFinite(value))) {
    return values.reduce((sum, value) => sum + value, 0);
  }
  const direct = values.reduce((sum, value) => sum + value, 0);
  if (Number.isFinite(direct)) return direct;
  const scale = Math.max(0, ...values.map((value) => Math.abs(value)));
  if (scale === 0) return 0;
  return scale * values.reduce((sum, value) => sum + value / scale, 0);
};

const safeMidpoint = (low, high) => stableSum(low / 2, high / 2);

const degreesToRadians = (degrees) => {
  const numeric = Number(degrees) || 0;
  return (numeric % 360) * Math.PI / 180;
};

// UX 2026-04-20 diag: per-object throttle for [LineBboxDiag] console.log
// emission from getLineBBox. Rendering can call getLineBBox dozens of times
// per frame (render loop, hover, selection overlay, hit test), so a naive
// log-on-every-call floods the 5000-line console buffer and pushes the
// signal off the end. Key by obj.id (falls back to a WeakMap for anon
// objects) with a 150ms cadence so each distinct line emits ~6x/second.
const __lineBboxLogState = { idMap: new Map(), refMap: new WeakMap() };
const __lineBboxDiagEnabled = () => Boolean(globalThis?.__LINE_BBOX_DIAG);
function __lineBboxShouldLog(obj) {
  if (!__lineBboxDiagEnabled()) return false;
  const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const id = obj && obj.id;
  if (id != null) {
    const last = __lineBboxLogState.idMap.get(id) || 0;
    if (nowMs - last < 150) return false;
    __lineBboxLogState.idMap.set(id, nowMs);
    return true;
  }
  if (obj) {
    const last = __lineBboxLogState.refMap.get(obj) || 0;
    if (nowMs - last < 150) return false;
    __lineBboxLogState.refMap.set(obj, nowMs);
    return true;
  }
  return false;
}

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

  if (obj?.data?.type === 'text-markup') {
    return {
      left: Number(obj.left) || 0,
      top: Number(obj.top) || 0,
      width: Math.max(0, Number(obj.width) || 0),
      height: Math.max(0, Number(obj.height) || 0),
      angle: 0,
    };
  }

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
 * Compute the on-screen axis-aligned bounding box of an annotation,
 * accounting for rotation stored on the object. getAnnotationBBox returns
 * a LOCAL (pre-rotation) tight bbox + the angle separately — correct for
 * the single-select overlay, which applies rotation via SVG transform.
 * But the multi-select GROUP union needs world-space AABBs so a rotated
 * member's on-screen silhouette actually fits inside the outer dashed
 * frame. Rotating the 4 corners of the local bbox around its geometric
 * center and taking min/max gives the tight world AABB.
 *
 * For lines / arrows with curvature the local bbox returned by
 * getLineBBox already includes curve extrema, so this function works
 * without needing to re-derive them.
 *
 * UX 2026-04-20: added after the multi-select group box visibly missed
 * the visible arc of a rotated curved line/arrow when combined with a
 * non-rotated shape in the same selection.
 *
 * @param {object} obj - Fabric.js JSON annotation object
 * @returns {{ left: number, top: number, width: number, height: number, angle: number }}
 */
export function getAnnotationWorldAABB(obj) {
  const bbox = getAnnotationBBox(obj);
  const angle = Number(bbox.angle) || 0;
  if (!angle) {
    return { left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height, angle: 0 };
  }
  const cx = stableSum(bbox.left, bbox.width / 2);
  const cy = stableSum(bbox.top, bbox.height / 2);
  const rad = degreesToRadians(angle);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { x: bbox.left, y: bbox.top },
    { x: bbox.left + bbox.width, y: bbox.top },
    { x: bbox.left + bbox.width, y: bbox.top + bbox.height },
    { x: bbox.left, y: bbox.top + bbox.height },
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of corners) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const rx = stableSum(cx, dx * cos, -dy * sin);
    const ry = stableSum(cy, dx * sin, dy * cos);
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
  }
  return {
    left: minX,
    top: minY,
    width: maxX - minX,
    height: maxY - minY,
    angle: 0,
  };
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
  return String(obj?.type || '').toLowerCase() === 'path' && obj.left == null && Array.isArray(obj.path);
}

/**
 * True when a path stores page-space coordinates directly in `path`, with no
 * meaningful object-space origin. User-drawn pen/highlighter strokes use this
 * shape after FabricDrawingCanvas commits them with left/top reset to zero.
 */
export function isAbsoluteCoordPath(obj) {
  const leftZero = obj?.left == null || obj.left === 0;
  const topZero = obj?.top == null || obj.top === 0;
  return String(obj?.type || '').toLowerCase() === 'path'
    && Array.isArray(obj.path)
    && leftZero
    && topZero
    && (!obj.pathOffset || (obj.pathOffset.x === 0 && obj.pathOffset.y === 0));
}



/**
 * Get the absolute SVG endpoints for a line-type annotation.
 * Uses the same center-based formula as renderLine in svgAnnotationRenderers.jsx.
 *
 * @param {object} obj - Fabric.js line JSON object
 * @returns {{ x1: number, y1: number, x2: number, y2: number }}
 */
export function getLineEndpoints(obj) {
  const centerX = stableSum((obj.left ?? 0), (obj.width ?? 0) / 2);
  const centerY = stableSum((obj.top ?? 0), (obj.height ?? 0) / 2);
  return {
    x1: centerX + (obj.x1 ?? 0),
    y1: centerY + (obj.y1 ?? 0),
    x2: centerX + (obj.x2 ?? 0),
    y2: centerY + (obj.y2 ?? 0),
  };
}

/**
 * UX 2026-04-20: curve-inclusive bbox center for lines/arrows. This is
 * the shared rotation pivot used by renderLine's rotation wrapper, the
 * SVGSelectionOverlay's default rotate transform, the hit area + hover
 * glow wrapper, the single-click handle wrapper, and the endpoint +
 * midpoint drag compensation in useSVGInteraction. Pass absolute
 * endpoint coords (from getLineEndpoints) and the absolute midpoint
 * from obj.data.midpoint (or null for straight lines). Returns {x, y}.
 * Matches the min/max logic in getLineBBox exactly — if you edit one,
 * edit the other.
 */
export function computeLineBboxCenter(ep, midpoint) {
  const xs = [ep.x1, ep.x2];
  const ys = [ep.y1, ep.y2];
  if (midpoint) {
    const Cx = 2 * midpoint.x - 0.5 * ep.x1 - 0.5 * ep.x2;
    const Cy = 2 * midpoint.y - 0.5 * ep.y1 - 0.5 * ep.y2;
    const denomX = ep.x1 - 2 * Cx + ep.x2;
    const denomY = ep.y1 - 2 * Cy + ep.y2;
    if (Math.abs(denomX) > 1e-9) {
      const tx = (ep.x1 - Cx) / denomX;
      if (tx > 0 && tx < 1) {
        const o = 1 - tx;
        xs.push(o * o * ep.x1 + 2 * o * tx * Cx + tx * tx * ep.x2);
      }
    }
    if (Math.abs(denomY) > 1e-9) {
      const ty = (ep.y1 - Cy) / denomY;
      if (ty > 0 && ty < 1) {
        const o = 1 - ty;
        ys.push(o * o * ep.y1 + 2 * o * ty * Cy + ty * ty * ep.y2);
      }
    }
  }
  return {
    x: safeMidpoint(Math.min(...xs), Math.max(...xs)),
    y: safeMidpoint(Math.min(...ys), Math.max(...ys)),
  };
}

// ---------------------------------------------------------------------------
// Internal bbox helpers per annotation type
// ---------------------------------------------------------------------------

function getPathBBox(obj) {
  if (!Array.isArray(obj.path) || obj.path.length === 0) {
    return { left: 0, top: 0, width: 0, height: 0, angle: 0 };
  }

  // Use the exact affine consumed by SVG rendering and erasing. The
  // operational normalizer inside createInkPathAffine also understands
  // legacy relative/H/V/S/T/A commands, so arc flags can never be mistaken
  // for coordinates. Transforming the normalized control hull is a safe
  // world-space superset of every line/Bezier segment.
  // Preserve the established bbox contract: return an unrotated box plus
  // `angle`, because selection handles and resize math apply that rotation
  // separately. Flip/skew/scale are included in this pre-rotation hull.
  const affine = createInkPathAffine({ ...obj, angle: 0 }, obj.path);
  const { minX, minY, maxX, maxY } = affine.bounds;
  const corners = [
    affine.point(minX, minY),
    affine.point(maxX, minY),
    affine.point(maxX, maxY),
    affine.point(minX, maxY),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  let left = Math.min(...xs);
  let top = Math.min(...ys);
  let right = Math.max(...xs);
  let bottom = Math.max(...ys);

  const strokeValue = String(obj?.stroke || '').trim().toLowerCase();
  const hasVisibleStroke = Number(obj?.strokeWidth) > 0
    && strokeValue !== ''
    && strokeValue !== 'none'
    && strokeValue !== 'transparent';
  if (hasVisibleStroke) {
    const radius = Number(obj.strokeWidth) / 2;
    const [a, b, c, d] = affine.matrix;
    const padX = obj?.strokeUniform === true
      ? radius
      : radius * Math.hypot(a, c);
    const padY = obj?.strokeUniform === true
      ? radius
      : radius * Math.hypot(b, d);
    left -= padX;
    right += padX;
    top -= padY;
    bottom += padY;
  }

  // SVGSelectionOverlay rotates a bbox around its own center. Fabric paths
  // rotate around pathOffset (or the operational bounds center for old
  // absolute-coordinate rows), which need not equal the control-hull center
  // for asymmetric curves/arcs. Symmetrize the safe hull around that real
  // pivot so applying `angle` cannot clip or shift the visible path.
  const hasFabricOrigin = obj?.inkGeometryOrigin === 'center-v1'
    || obj?.data?.inkGeometryOrigin === 'center-v1'
    || obj?.originX != null
    || obj?.originY != null;
  const pivotLocalX = hasFabricOrigin && Number.isFinite(Number(obj?.pathOffset?.x))
    ? Number(obj.pathOffset.x)
    : safeMidpoint(minX, maxX);
  const pivotLocalY = hasFabricOrigin && Number.isFinite(Number(obj?.pathOffset?.y))
    ? Number(obj.pathOffset.y)
    : safeMidpoint(minY, maxY);
  const pivot = affine.point(pivotLocalX, pivotLocalY);
  const halfWidth = Math.max(pivot.x - left, right - pivot.x);
  const halfHeight = Math.max(pivot.y - top, bottom - pivot.y);
  left = pivot.x - halfWidth;
  right = pivot.x + halfWidth;
  top = pivot.y - halfHeight;
  bottom = pivot.y + halfHeight;
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    angle: obj.angle ?? 0,
  };
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
  const centerX = stableSum((obj.left ?? 0), (obj.width ?? 0) / 2);
  const centerY = stableSum((obj.top ?? 0), (obj.height ?? 0) / 2);
  const x1 = centerX + (obj.x1 ?? 0);
  const y1 = centerY + (obj.y1 ?? 0);
  const x2 = centerX + (obj.x2 ?? 0);
  const y2 = centerY + (obj.y2 ?? 0);

  // UX 2026-04-20: include the curve's true extent when the line is bent.
  // A quadratic bezier through start/midpoint/end has control C =
  // 2·midpoint - 0.5·start - 0.5·end. The curve's axis-aligned extrema in
  // X and Y are at t = (S - C) / (S - 2C + E) when that ratio lies in
  // (0, 1); evaluate B(t) there to get the extremum coordinate. Including
  // those alongside start/end gives a tight bbox that wraps the arc. Using
  // the pass-through midpoint alone misses the case where the curve bulges
  // past it before reaching the end.
  const mid = obj.data?.midpoint;
  const xs = [x1, x2];
  const ys = [y1, y2];
  // UX 2026-04-20 diag: capture the full curve-extrema derivation so the
  // user can share a log and we can see exactly which inputs produced the
  // frame's oversize. Populated only when the line is curved; left null
  // otherwise so the log payload stays compact for straight-line calls.
  let curveDiag = null;
  if (mid) {
    const Cx = 2 * mid.x - 0.5 * x1 - 0.5 * x2;
    const Cy = 2 * mid.y - 0.5 * y1 - 0.5 * y2;
    const denomX = x1 - 2 * Cx + x2;
    const denomY = y1 - 2 * Cy + y2;
    let txVal = null, tyVal = null, extremumXVal = null, extremumYVal = null;
    let txInRange = false, tyInRange = false;
    if (Number.isFinite(denomX) && denomX !== 0) {
      const tx = (x1 - Cx) / denomX;
      txVal = tx;
      if (tx > 0 && tx < 1) {
        const one = 1 - tx;
        extremumXVal = one * one * x1 + 2 * one * tx * Cx + tx * tx * x2;
        xs.push(extremumXVal);
        txInRange = true;
      }
    }
    if (Number.isFinite(denomY) && denomY !== 0) {
      const ty = (y1 - Cy) / denomY;
      tyVal = ty;
      if (ty > 0 && ty < 1) {
        const one = 1 - ty;
        extremumYVal = one * one * y1 + 2 * one * ty * Cy + ty * ty * y2;
        ys.push(extremumYVal);
        tyInRange = true;
      }
    }
    curveDiag = {
      midpoint: { x: mid.x, y: mid.y },
      controlPoint: { Cx, Cy },
      denomX, denomY,
      tx: txVal, ty: tyVal,
      txInRange, tyInRange,
      extremumX: extremumXVal, extremumY: extremumYVal,
    };
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // UX 2026-04-20: TIGHT min..max bbox that hugs the real geometry (end-
  // points + curve extrema). The selection frame stays glued to the
  // visible shape through rotation via a SEPARATE rotation-pivot prop
  // passed to SVGSelectionOverlay — see SVGAnnotationLayer.overlayMount
  // where the line overlay receives rotationCenter = endpoint midpoint.
  // Earlier symmetric-padding revision (2026-04-20 19:15) centered the
  // bbox on the endpoint midpoint so the overlay's built-in pivot
  // (bbox.left+bbox.width/2, bbox.top+bbox.height/2) happened to match,
  // but it produced ~75 px of empty space on the side opposite a curve
  // bulge (log evidence: hasMidpoint=true case had bottomSideHalfH=27 vs
  // topSideHalfH=103, adding 75 px of bottom padding). Tight wrap + an
  // explicit pivot override gives both: frame hugs geometry AND rotates
  // around the same point as the visible shape.
  const midX = safeMidpoint(x1, x2);
  const midY = safeMidpoint(y1, y2);
  // Enforce a 10-px minimum on the tight bounds themselves so near-
  // horizontal / near-vertical straight lines still have a grabbable
  // resize handle strip. Symmetric expansion around the endpoint
  // midpoint keeps the frame centered on its rotation pivot for the
  // (common) straight-line case; curved cases rely on the external
  // rotationCenter prop.
  let resultLeft = minX;
  let resultTop = minY;
  let resultWidth = Math.max(maxX - minX, 0);
  let resultHeight = Math.max(maxY - minY, 0);
  if (resultWidth < 10) {
    resultLeft = midX - 5;
    resultWidth = 10;
  }
  if (resultHeight < 10) {
    resultTop = midY - 5;
    resultHeight = 10;
  }

  const result = {
    left: resultLeft,
    top: resultTop,
    width: resultWidth,
    height: resultHeight,
    angle: obj.angle ?? 0,
  };

  // UX 2026-04-20 diag: dump every input and every intermediate that
  // affects the returned bbox. Use a single JSON.stringify so the Save
  // Log + grep-one-prefix workflow lands all fields on one line per
  // event. Emission is throttled per-object (~6x/sec) to keep the 5000-
  // line buffer from overflowing under live drag. Fields chosen so the
  // user can paste one log entry back and we can tell (a) whether the
  // frame is visually oversized because the raw curve extrema push it
  // out, (b) because the endpoint-midpoint symmetry pad inflates it on
  // the non-bulge side, or (c) because midpoint storage is unexpected.
  if (__lineBboxShouldLog(obj)) {
    try {
      const tightLeft = minX;
      const tightTop = minY;
      const tightWidth = Math.max(1, maxX - minX);
      const tightHeight = Math.max(1, maxY - minY);
      const payload = {
        ts: new Date().toISOString(),
        objId: obj.id ?? null,
        objType: obj.type ?? null,
        tool: obj.tool ?? null,
        objSnapshot: {
          left: obj.left ?? null,
          top: obj.top ?? null,
          width: obj.width ?? null,
          height: obj.height ?? null,
          x1: obj.x1 ?? null,
          y1: obj.y1 ?? null,
          x2: obj.x2 ?? null,
          y2: obj.y2 ?? null,
          angle: obj.angle ?? 0,
          hasMidpoint: !!mid,
          dataMidpoint: mid ? { x: mid.x, y: mid.y } : null,
        },
        centerFromStorage: { x: centerX, y: centerY },
        absoluteEndpoints: { x1, y1, x2, y2 },
        endpointMidpoint: { x: midX, y: midY },
        chordLength: Math.hypot(x2 - x1, y2 - y1),
        curveDiag,
        extremaPool: { xs: xs.slice(), ys: ys.slice() },
        tightBounds: { minX, maxX, minY, maxY },
        tightBBox: { left: tightLeft, top: tightTop, width: tightWidth, height: tightHeight },
        tightCenter: { x: tightLeft + tightWidth / 2, y: tightTop + tightHeight / 2 },
        symmetricHalfExtents: { halfW, halfH },
        symmetricHalfComponents: {
          leftSideHalfW: midX - minX,
          rightSideHalfW: maxX - midX,
          topSideHalfH: midY - minY,
          bottomSideHalfH: maxY - midY,
        },
        returnedBBox: result,
        returnedCenter: { x: result.left + result.width / 2, y: result.top + result.height / 2 },
        oversizeVsTight: {
          extraWidth: result.width - tightWidth,
          extraHeight: result.height - tightHeight,
          leftPadAdded: tightLeft - result.left,
          rightPadAdded: (result.left + result.width) - (tightLeft + tightWidth),
          topPadAdded: tightTop - result.top,
          bottomPadAdded: (result.top + result.height) - (tightTop + tightHeight),
        },
        pivotsMatch: {
          tightCenterEqualsEndpointMid:
            Math.abs(tightLeft + tightWidth / 2 - midX) < 0.01
            && Math.abs(tightTop + tightHeight / 2 - midY) < 0.01,
          returnedCenterEqualsEndpointMid:
            Math.abs(result.left + result.width / 2 - midX) < 0.01
            && Math.abs(result.top + result.height / 2 - midY) < 0.01,
        },
      };
      console.log('[LineBboxDiag] getLineBBox ' + JSON.stringify(payload));
    } catch (err) {
      console.warn('[LineBboxDiag] getLineBBox log failed', err);
    }
  }

  // UX 2026-04-20: pass through obj.angle so the selection overlay rotates
  // its dashed frame + handles around the line's center. Rotation is stored
  // live on the object (not baked into endpoints) so the tilted frame stays
  // tilted after release — matches polygon/polyline behavior.
  return result;
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

    // UX 2026-04-20: arrow groups pass through angle, same reasoning as
    // getLineBBox — keeps the selection frame tilted after rotation.
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width,
      height,
      angle: obj.angle ?? 0,
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
  const scaleX = Math.abs(obj.scaleX ?? 1);
  const scaleY = Math.abs(obj.scaleY ?? 1);
  const base = {
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: radius * 2 * scaleX,
    height: radius * 2 * scaleY,
    angle: obj.angle ?? 0,
  };

  // UX 2026-04-20: counter pins render a nub that sticks out past the
  // circle body by tipExtension = radius * 0.5 in the direction
  // of data.pointerAngle. The plain circle bbox cut off the nub tip, so
  // the dashed selection frame visibly clipped the pointer on the side
  // opposite the bubble. Counter body stays circular (renderCounter uses
  // scaleX only for radius) — match that here so the bbox doesn't become
  // an ellipse under free-resize. Extend the bbox toward the tip so the
  // whole pin, including the nub, sits inside the frame.
  if (obj?.data?.type === 'counter') {
    const r = radius * scaleX;
    const centerX = (obj.left ?? 0) + r;
    const centerY = (obj.top ?? 0) + r;
    const bodyLeft = centerX - r;
    const bodyTop = centerY - r;
    const bodyRight = centerX + r;
    const bodyBottom = centerY + r;
    const tipExtension = r * 0.5;
    const tipDistance = r + tipExtension;
    const pointerAngleDeg = (obj.data.pointerAngle != null) ? obj.data.pointerAngle : 225;
    const rad = degreesToRadians(pointerAngleDeg);
    const tipX = centerX + Math.cos(rad) * tipDistance;
    const tipY = centerY + Math.sin(rad) * tipDistance;
    const minX = Math.min(bodyLeft, tipX);
    const maxX = Math.max(bodyRight, tipX);
    const minY = Math.min(bodyTop, tipY);
    const maxY = Math.max(bodyBottom, tipY);
    return {
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
      angle: base.angle,
    };
  }
  return base;
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
 * Exported so annotationCanvasPainter's dimensionless-text fallback counts
 * lines with the SAME walk (a ceil(width/container) approximation drifts by
 * a line and the text block jumps when the canvas presentation swaps in).
 */
export function countWrappedLines(ctx, line, maxWidth) {
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
