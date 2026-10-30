// Curved polyline (Nightly, flag 'spline-polyline'; owner 2026-10-26, copying
// the Takeoff repo's freehand polyline): the user clicks corners as usual and
// the line bends smoothly through every one of them.
//
// The shape stores the drawn curve itself as dense `points` plus
// `data.spline = { step }`: clicked corner j sits at points[j * step]. Every
// renderer, export, hit test, measure and eraser keeps reading plain points;
// only corner editing (drag, add, delete) goes through the helpers below,
// which edit the corners and draw the curve again.
//
// The curve is a centripetal Catmull-Rom spline (alpha 0.5): it passes
// through each corner and, unlike the uniform kind, never loops or overshoots
// where corners bunch up.

export const SPLINE_STEP = 12;

/** The toolbar's Curve switch on a picked polyline: detail { curved }. */
export const POLYLINE_CURVE_SET_EVENT = 'survey-polyline-curve-set';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const copy = (p) => ({ x: num(p?.x), y: num(p?.y) });

/** `step` when `obj` is a curved polyline whose points fit it, else 0. */
export function polySplineStep(obj) {
  const step = Number(obj?.data?.spline?.step);
  if (!Number.isInteger(step) || step < 2) return 0;
  if (String(obj?.type || '').toLowerCase() !== 'polyline') return 0;
  const n = Array.isArray(obj.points) ? obj.points.length : 0;
  if (n < step + 1 || (n - 1) % step !== 0) return 0;
  return step;
}

/** The clicked corners of a curved polyline's dense points. */
export function splineCorners(points, step) {
  if (!Array.isArray(points) || !(step > 0)) return [];
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(copy(points[i]));
  return out;
}

const knot = (t, a, b) => {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return t + Math.max(Math.sqrt(d), 1e-6);
};

// Point at fraction u (0..1) of the span p1 -> p2 (Barry-Goldman pyramid).
function catmullRomPoint(p0, p1, p2, p3, u) {
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a, b, ta, tb) => {
    const w = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Dense curve through `corners` (open), `step` samples per span. Corner j is
 * returned unchanged at index j * step. Two corners give a straight line.
 */
export function sampleSpline(corners, step = SPLINE_STEP) {
  const pts = Array.isArray(corners) ? corners.map(copy) : [];
  if (pts.length < 2 || !(step >= 1)) return pts;
  const n = pts.length;
  // Mirrored end points so the first and last spans leave their corner
  // heading toward the next one.
  const at = (i) => {
    if (i < 0) return { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y };
    if (i >= n) return { x: 2 * pts[n - 1].x - pts[n - 2].x, y: 2 * pts[n - 1].y - pts[n - 2].y };
    return pts[i];
  };
  const out = [];
  for (let i = 0; i < n - 1; i += 1) {
    out.push(pts[i]);
    const p0 = at(i - 1);
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = at(i + 2);
    const same = p1.x === p2.x && p1.y === p2.y;
    for (let k = 1; k < step; k += 1) {
      out.push(same ? { ...p1 } : catmullRomPoint(p0, p1, p2, p3, k / step));
    }
  }
  out.push(pts[n - 1]);
  return out;
}

/** Dense points after moving the corner at dense index `index` to `target`. */
export function moveSplineCorner(points, step, index, target) {
  const corners = splineCorners(points, step);
  const j = index / step;
  if (!Number.isInteger(j) || j < 0 || j >= corners.length) return points;
  corners[j] = copy(target);
  return sampleSpline(corners, step);
}

/** Dense points with a new corner after corner `span` at `point`. */
export function insertSplineCorner(points, step, span, point) {
  const corners = splineCorners(points, step);
  if (!Number.isInteger(span) || span < 0 || span >= corners.length - 1) return null;
  corners.splice(span + 1, 0, copy(point));
  return sampleSpline(corners, step);
}

/** Dense points without the corner at dense index `index`, or null. */
export function removeSplineCorner(points, step, index) {
  const corners = splineCorners(points, step);
  const j = index / step;
  if (!Number.isInteger(j) || j < 0 || j >= corners.length || corners.length <= 2) return null;
  corners.splice(j, 1);
  return sampleSpline(corners, step);
}

/** Middle of the curve between corner `span` and the next (for the "+" handle). */
export function splineSpanMidpoint(points, step, span) {
  const i = span * step;
  if (!Array.isArray(points) || i < 0 || i + step >= points.length) return null;
  const half = step / 2;
  if (Number.isInteger(half)) return copy(points[i + half]);
  const a = points[i + Math.floor(half)];
  const b = points[i + Math.ceil(half)];
  return { x: (num(a.x) + num(b.x)) / 2, y: (num(a.y) + num(b.y)) / 2 };
}

/**
 * Turn a polyline into a curve through its current corners, or a curve back
 * into straight sides through its clicked corners. Returns a copy, or null
 * when there is nothing to change. Corners keep their place on the page: the
 * renderer rotates about the point cloud's box centre, so on a rotated line
 * left/top shift to cancel that centre moving.
 */
export function setPolylineCurve(obj, curved, step = SPLINE_STEP) {
  if (String(obj?.type || '').toLowerCase() !== 'polyline' || !Array.isArray(obj.points)) return null;
  const current = polySplineStep(obj);
  if (curved ? current : !current) return null;
  // A cloud's scallops follow corners; a cloud polyline stays straight.
  if (curved && obj.data?.pdfCloudIntensity) return null;
  const oldPoints = obj.points.map(copy);
  const points = curved
    ? (oldPoints.length >= 2 ? sampleSpline(oldPoints, step) : null)
    : splineCorners(oldPoints, current);
  if (!points) return null;
  const next = keepPivot(obj, oldPoints, points);
  const { spline: _spline, pdfCloudVertexState: _cloud, ...data } = obj.data || {};
  next.data = curved ? { ...data, spline: { step } } : data;
  return next;
}

const boxCentre = (points) => {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
};

/** Copy of `obj` with new `points`, left/top moved so a rotated shape's corners stay put. */
export function keepPivot(obj, oldPoints, points) {
  const scaleX = Number(obj.scaleX ?? 1) || 1;
  const scaleY = Number(obj.scaleY ?? 1) || 1;
  const rad = ((Number(obj.angle) || 0) * Math.PI) / 180;
  const before = boxCentre(oldPoints);
  const after = boxCentre(points);
  const dx = scaleX * (after.x - before.x);
  const dy = scaleY * (after.y - before.y);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    ...obj,
    points,
    left: (Number(obj.left) || 0) + (dx * cos - dy * sin) - dx,
    top: (Number(obj.top) || 0) + (dx * sin + dy * cos) - dy,
  };
}
