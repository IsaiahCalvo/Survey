/**
 * markerShapes.js — the outline a Survey Marker can carry besides its box.
 *
 * Owner 2026-10-13: a Survey Marker is drawn three ways — a Rectangle (the
 * marquee box, as before), a Freehand stroke (a highlighter-like line with a
 * width) and Smart fill (a filled outline worked out from the drawing, plugged
 * in from markerShapeProviders.js). The box stays the marker's geometry of
 * record; a freehand or smart-fill marker adds its outline next to it:
 *
 *   marker.bounds = {
 *     x, y, width, height, angle?,          // the box, exactly as before
 *     shape?: {                             // NEW, optional
 *       type: 'stroke',  v: 1,
 *       frame: { x, y, width, height },     // the box the points were drawn in
 *       width: 12,                          // stroke width, PDF page units
 *       points: [[x, y], ...],              // centreline, PDF page units
 *     } | {
 *       type: 'polygon', v: 1,
 *       frame: { x, y, width, height },
 *       polygons: [ [outerRing, hole, ...], ... ],  // MultiPolygon rings,
 *     }                                             // PDF page units, open rings
 *   }
 *
 * Why inside `bounds`: bounds is the marker's geometry everywhere — the
 * `bounds` JSONB column (no schema change), history snapshots, the clipboard,
 * cross-page moves, the Excel import guard that never touches geometry — so
 * the outline travels with the box for free. Every reader that only knows the
 * box (older app versions, the Excel export, the eraser, the rail) keeps
 * reading x / y / width / height and simply shows the box.
 *
 * Why a `frame`: code that moves or resizes a marker rewrites x / y / width /
 * height and knows nothing about the outline. The points stay as drawn, and
 * every renderer maps them from `frame` onto the CURRENT box
 * (projectMarkerShape), so a moved, resized or pasted marker draws its outline
 * in the right place without any of that code changing.
 *
 * Page units: the SVG overlay's own space — origin top-left, y down, one unit
 * = one PDF point at 100% (the viewBox every page layer uses).
 */

export const MARKER_SHAPE_VERSION = 1;

/** The three ways a marker can be drawn (the tool bar's marker group). */
export const MARKER_DRAW_MODES = Object.freeze(['rectangle', 'freehand', 'smartFill']);

/**
 * Freehand marker stroke width in page units. Owner: "a stroke with a width
 * like a highlighter" — the highlighter's own floor is 8; a marker reads as an
 * area, so it is a little wider. One constant, so it is easy to change.
 */
export const MARKER_STROKE_DEFAULT_WIDTH = 12;

/** The widths the survey bar offers for a freehand marker (page units). */
export const MARKER_STROKE_WIDTHS = Object.freeze([4, 8, 12, 16, 24, 32]);

/** A stored / picked width made safe: a positive number, else the default. */
export function normalizeMarkerStrokeWidth(value) {
  const width = Number(value);
  return Number.isFinite(width) && width > 0 && width <= 200 ? width : MARKER_STROKE_DEFAULT_WIDTH;
}

/** Points kept per freehand stroke / smart-fill outline (storage guard). */
export const MAX_STROKE_POINTS = 600;
export const MAX_POLYGON_POINTS = 6000;

const round2 = (n) => Math.round(n * 100) / 100;
const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

function toXY(point) {
  if (Array.isArray(point)) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  if (point && typeof point === 'object') {
    const x = Number(point.x);
    const y = Number(point.y);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  return null;
}

function distanceToSegmentSq(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx - p[0];
  const cy = a[1] + t * dy - p[1];
  return cx * cx + cy * cy;
}

/** Ramer-Douglas-Peucker on an open polyline (iterative, no recursion). */
export function simplifyPolyline(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 2 || !(tolerance > 0)) return points ? points.slice() : [];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const tolSq = tolerance * tolerance;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSq = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = distanceToSegmentSq(points[i], points[first], points[last]);
      if (d > maxSq) { maxSq = d; index = i; }
    }
    if (index !== -1 && maxSq > tolSq) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function boxOfPoints(pointLists, pad = 0) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const list of pointLists) {
    for (const [x, y] of list) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return {
    x: round2(minX - pad),
    y: round2(minY - pad),
    width: round2(maxX - minX + 2 * pad),
    height: round2(maxY - minY + 2 * pad),
  };
}

function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return length;
}

/**
 * A freehand marker from the drawn centreline (page units, {x,y} or [x,y]).
 * Returns the marker's `bounds` (box + shape), or null for a press that never
 * really moved (same rule as the rectangle: a click draws nothing).
 */
export function buildStrokeMarkerBounds(rawPoints, { width = MARKER_STROKE_DEFAULT_WIDTH } = {}) {
  const strokeWidth = Number(width) > 0 ? Number(width) : MARKER_STROKE_DEFAULT_WIDTH;
  const points = [];
  for (const raw of Array.isArray(rawPoints) ? rawPoints : []) {
    const p = toXY(raw);
    if (!p) continue;
    const prev = points[points.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    points.push(p);
  }
  if (points.length < 2 || pathLength(points) <= 2) return null;
  let simplified = simplifyPolyline(points, 0.35);
  let tolerance = 0.35;
  while (simplified.length > MAX_STROKE_POINTS && tolerance < 64) {
    tolerance *= 2;
    simplified = simplifyPolyline(points, tolerance);
  }
  const rounded = simplified.map(([x, y]) => [round2(x), round2(y)]);
  const box = boxOfPoints([rounded], strokeWidth / 2);
  if (!box) return null;
  return {
    ...box,
    shape: {
      type: 'stroke',
      v: MARKER_SHAPE_VERSION,
      frame: { ...box },
      width: round2(strokeWidth),
      points: rounded,
    },
  };
}

/**
 * A freehand marker from a single press (owner 2026-10-22: "I should be able
 * to just click down and that should be considered one"): a round dot of the
 * stroke width centred on the press. Stored as a stroke whose two points sit
 * a hair apart, so every renderer (SVG, canvas, PDF export), the hit test and
 * resize treat it like any other freehand marker; the round caps draw the dot.
 */
export const MARKER_DOT_SPAN = 0.5;

export function buildDotMarkerBounds(rawPoint, { width = MARKER_STROKE_DEFAULT_WIDTH } = {}) {
  const p = toXY(rawPoint);
  if (!p) return null;
  const strokeWidth = normalizeMarkerStrokeWidth(width);
  const half = MARKER_DOT_SPAN / 2;
  const points = [[round2(p[0] - half), round2(p[1])], [round2(p[0] + half), round2(p[1])]];
  const box = boxOfPoints([points], strokeWidth / 2);
  if (!box) return null;
  return {
    ...box,
    shape: {
      type: 'stroke',
      v: MARKER_SHAPE_VERSION,
      frame: { ...box },
      width: round2(strokeWidth),
      points,
    },
  };
}

// --- Smart fill polygons ----------------------------------------------------

function depthOf(value) {
  let depth = 0;
  let cursor = value;
  while (Array.isArray(cursor)) {
    depth += 1;
    cursor = cursor[0];
  }
  // {x, y} point objects count as one level, like [x, y].
  if (cursor && typeof cursor === 'object' && 'x' in cursor) depth += 1;
  return depth;
}

function cleanRing(ring) {
  if (!Array.isArray(ring)) return null;
  const out = [];
  for (const raw of ring) {
    const p = toXY(raw);
    if (!p) continue;
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push(p);
  }
  // GeoJSON rings repeat the first point at the end; we store open rings.
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
  }
  return out.length >= 3 ? out : null;
}

/**
 * Normalise what a smart-fill provider hands back into MultiPolygon rings:
 * [ [outerRing, hole, ...], ... ], each ring an open list of [x, y].
 * Accepts a GeoJSON-like { type: 'Polygon' | 'MultiPolygon', coordinates },
 * a Feature / { geometry }, { polygons: <any of these> }, or the bare
 * coordinate arrays (a ring, a Polygon's rings or a MultiPolygon's).
 * Points may be [x, y] or { x, y }. Returns null when nothing usable is left.
 */
export function normalizeMarkerPolygons(input) {
  let value = input;
  for (let guard = 0; guard < 4 && value && !Array.isArray(value) && typeof value === 'object'; guard += 1) {
    if (value.polygons !== undefined) value = value.polygons;
    else if (value.geometry !== undefined) value = value.geometry;
    else if (value.coordinates !== undefined) value = value.coordinates;
    else break;
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const depth = depthOf(value);
  let multi;
  if (depth === 2) multi = [[value]];
  else if (depth === 3) multi = [value];
  else if (depth === 4) multi = value;
  else return null;
  const polygons = [];
  for (const polygon of multi) {
    if (!Array.isArray(polygon)) continue;
    const [outer, ...holes] = polygon.map(cleanRing);
    if (!outer) continue;
    polygons.push([outer, ...holes.filter(Boolean)]);
  }
  if (polygons.length === 0) return null;
  // Storage guard: thin dense outlines (vector geometry can be very fine).
  const count = () => polygons.reduce((sum, poly) => sum + poly.reduce((s, r) => s + r.length, 0), 0);
  let tolerance = 0.25;
  while (count() > MAX_POLYGON_POINTS && tolerance < 64) {
    for (let i = 0; i < polygons.length; i += 1) {
      const [outer, ...holes] = polygons[i].map((ring) => {
        const closed = [...ring, ring[0]];
        const slim = simplifyPolyline(closed, tolerance);
        slim.pop();
        return slim.length >= 3 ? slim : null;
      });
      // A hole thinned below three points is dropped; an outline that
      // collapses takes its polygon (and its holes) with it.
      polygons[i] = outer ? [outer, ...holes.filter(Boolean)] : null;
    }
    for (let i = polygons.length - 1; i >= 0; i -= 1) if (!polygons[i]) polygons.splice(i, 1);
    if (polygons.length === 0) return null;
    tolerance *= 2;
  }
  return polygons.map((poly) => poly.map((ring) => ring.map(([x, y]) => [round2(x), round2(y)])));
}

/** A polygon (smart-fill) marker's `bounds` (box + shape), or null. */
export function buildPolygonMarkerBounds(input) {
  const polygons = normalizeMarkerPolygons(input);
  if (!polygons) return null;
  const box = boxOfPoints(polygons.map((poly) => poly[0]));
  if (!box || box.width <= 1 || box.height <= 1) return null;
  return {
    ...box,
    shape: {
      type: 'polygon',
      v: MARKER_SHAPE_VERSION,
      frame: { ...box },
      polygons,
    },
  };
}

// --- Reading ------------------------------------------------------------------

function validFrame(frame) {
  return frame
    && isFiniteNumber(frame.x) && isFiniteNumber(frame.y)
    && isFiniteNumber(frame.width) && isFiniteNumber(frame.height)
    && frame.width > 0 && frame.height > 0;
}

/**
 * The marker's outline, or null for a plain box. Takes a marker record
 * ({ bounds }), a bounds object, or a canvas render entry (whose bounds are
 * spread onto it, so `shape` sits at the top). Anything malformed — or from a
 * newer version this build does not know — reads as "no outline", so the
 * marker still draws as its box.
 */
export function getMarkerShape(source) {
  const shape = source?.shape ?? source?.bounds?.shape ?? null;
  if (!shape || typeof shape !== 'object' || shape.v !== MARKER_SHAPE_VERSION) return null;
  if (!validFrame(shape.frame)) return null;
  if (shape.type === 'stroke') {
    return Array.isArray(shape.points) && shape.points.length >= 2 && Number(shape.width) > 0 ? shape : null;
  }
  if (shape.type === 'polygon') {
    return Array.isArray(shape.polygons) && shape.polygons.length > 0 ? shape : null;
  }
  return null;
}

/** 'rectangle' | 'freehand' | 'smartFill' — how the marker was drawn. */
export function getMarkerDrawKind(source) {
  const shape = getMarkerShape(source);
  if (!shape) return 'rectangle';
  return shape.type === 'stroke' ? 'freehand' : 'smartFill';
}

/**
 * The outline mapped onto the marker's CURRENT box (x / y / width / height,
 * page units; rotation is applied by the renderer around the box centre).
 * Returns { type, width?, points?, polygons? } in page units, or null.
 */
export function projectMarkerShape(shape, box) {
  const valid = getMarkerShape({ shape });
  if (!valid || !box) return null;
  const bx = Number(box.x ?? box.left);
  const by = Number(box.y ?? box.top);
  const bw = Number(box.width);
  const bh = Number(box.height);
  if (![bx, by, bw, bh].every(Number.isFinite) || bw <= 0 || bh <= 0) return null;
  const { frame } = valid;
  const sx = bw / frame.width;
  const sy = bh / frame.height;
  const map = ([x, y]) => [bx + (x - frame.x) * sx, by + (y - frame.y) * sy];
  if (valid.type === 'stroke') {
    return {
      type: 'stroke',
      width: Number(valid.width) * Math.sqrt(Math.abs(sx * sy)),
      points: valid.points.map(map),
    };
  }
  return {
    type: 'polygon',
    polygons: valid.polygons.map((poly) => poly.map((ring) => ring.map(map))),
  };
}

const fmt = (n) => String(Math.round(n * 100) / 100);

/** SVG path data for a projected outline (polygons use fill-rule evenodd). */
export function markerShapePathData(projected) {
  if (!projected) return '';
  if (projected.type === 'stroke') {
    return projected.points
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`)
      .join(' ');
  }
  const parts = [];
  for (const poly of projected.polygons) {
    for (const ring of poly) {
      parts.push(`${ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`).join(' ')} Z`);
    }
  }
  return parts.join(' ');
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > point[1]) !== (yj > point[1]))
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Whether a page point lands on a projected outline: within the stroke (plus
 * `tolerance`), or inside a polygon (holes excluded, even-odd) or within
 * `tolerance` of its edge.
 */
export function markerShapeHitTest(projected, point, tolerance = 0) {
  const p = toXY(point);
  if (!projected || !p) return false;
  if (projected.type === 'stroke') {
    const reach = projected.width / 2 + Math.max(0, tolerance);
    const reachSq = reach * reach;
    for (let i = 1; i < projected.points.length; i += 1) {
      if (distanceToSegmentSq(p, projected.points[i - 1], projected.points[i]) <= reachSq) return true;
    }
    return false;
  }
  const tolSq = Math.max(0, tolerance) ** 2;
  for (const poly of projected.polygons) {
    let inside = false;
    for (const ring of poly) if (pointInRing(p, ring)) inside = !inside;
    if (inside) return true;
    if (tolSq > 0) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i += 1) {
          if (distanceToSegmentSq(p, ring[i], ring[(i + 1) % ring.length]) <= tolSq) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Keep the outline when code that only knows the box rebuilds `bounds`
 * (the move / resize / rotate handler builds a fresh { x, y, width, height }).
 */
/**
 * A freehand marker's bounds redrawn at a new stroke width (page units), the
 * stroke kept where it is on the page: the box grows or shrinks by the width
 * change around the same centre, so a rotated marker stays put. Null for a
 * marker with no stroke.
 */
export function restyleStrokeMarkerBounds(bounds, width) {
  const projected = projectMarkerShape(getMarkerShape(bounds), bounds);
  if (!projected || projected.type !== 'stroke') return null;
  const strokeWidth = normalizeMarkerStrokeWidth(width);
  const points = projected.points.map(([x, y]) => [round2(x), round2(y)]);
  const box = boxOfPoints([points], strokeWidth / 2);
  if (!box) return null;
  return {
    ...box,
    ...(bounds.angle !== undefined ? { angle: bounds.angle } : {}),
    shape: {
      type: 'stroke',
      v: MARKER_SHAPE_VERSION,
      frame: { ...box },
      width: round2(strokeWidth),
      points,
    },
  };
}

/** A freehand marker's stroke width as drawn now (page units), or null. */
export function strokeMarkerWidth(bounds) {
  const projected = projectMarkerShape(getMarkerShape(bounds), bounds);
  return projected?.type === 'stroke' ? round2(projected.width) : null;
}

export function carryMarkerShape(nextBounds, previousBounds) {
  if (!nextBounds || typeof nextBounds !== 'object') return nextBounds;
  if (nextBounds.shape !== undefined) return nextBounds;
  const shape = previousBounds?.shape;
  return shape ? { ...nextBounds, shape } : nextBounds;
}
