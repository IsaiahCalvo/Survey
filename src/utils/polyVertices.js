// Polygon / polyline vertex removal for a committed shape (Drawboard parity:
// right-click a corner > Delete point, Alt/Option-click, Delete/Backspace on a
// focused corner, long-press on touch). Pure so it can be tested in node.
import { POLY_MIN_POINTS } from './polyDraft.js';

const polyKind = (obj) => {
  const type = String(obj?.type || '').toLowerCase();
  return type === 'polygon' || type === 'polyline' ? type : null;
};

/** Fewest corners the shape may keep: 3 for a polygon, 2 for a polyline. */
export function polyVertexMinimum(obj) {
  const kind = polyKind(obj);
  return kind ? POLY_MIN_POINTS[kind] : Infinity;
}

export function canRemovePolyVertex(obj) {
  return Array.isArray(obj?.points) && obj.points.length > polyVertexMinimum(obj);
}

const centre = (points) => {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    const x = Number(p?.x) || 0;
    const y = Number(p?.y) || 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
};

/**
 * Returns a copy of `obj` without corner `index`, or null when the index is
 * bad or the shape is already at its minimum. Every other corner keeps its
 * world position: the renderer rotates about the point-cloud's bbox centre,
 * so on a rotated shape left/top are shifted to cancel the pivot moving
 * (same compensation as the live vertex drag in useSVGInteraction).
 */
export function removePolyVertex(obj, index) {
  if (!canRemovePolyVertex(obj)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= obj.points.length) return null;
  const oldPoints = obj.points.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }));
  const points = oldPoints.filter((_, i) => i !== index);
  const scaleX = Number(obj.scaleX ?? 1) || 1;
  const scaleY = Number(obj.scaleY ?? 1) || 1;
  const rad = ((Number(obj.angle) || 0) * Math.PI) / 180;
  const before = centre(oldPoints);
  const after = centre(points);
  const dx = scaleX * (after.x - before.x);
  const dy = scaleY * (after.y - before.y);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const next = {
    ...obj,
    points,
    left: (Number(obj.left) || 0) + (dx * cos - dy * sin) - dx,
    top: (Number(obj.top) || 0) + (dx * sin + dy * cos) - dy,
  };
  // A cloud's stored per-vertex arrays are indexed by corner; refit them.
  if (obj.data?.pdfCloudVertexState) {
    const { pdfCloudVertexState, ...data } = obj.data;
    next.data = data;
  }
  return next;
}

/**
 * Where the "Delete point" menu goes and how tall its row is. A touch press
 * gets a 44 px row; the box is kept inside the viewport (a corner near the
 * right or bottom edge of a phone otherwise pushed the row off-screen).
 */
export function polyVertexMenuLayout({ x, y, touch = false, viewportWidth = Infinity, viewportHeight = Infinity, margin = 8 }) {
  const rowHeight = touch ? 44 : 36;
  const width = touch ? 168 : 140;
  const height = rowHeight + 10; // 4 px padding each side + 1 px border each side
  const left = Math.max(margin, Math.min(x, viewportWidth - width - margin));
  const top = Math.max(margin, Math.min(y, viewportHeight - height - margin));
  return { left, top, width, rowHeight };
}

/**
 * Nearest spot on a poly outline (OpenTakeoff / Drawboard "add point on an
 * edge"). `points` and `pt` share one frame; a polygon also tests its closing
 * side. Returns { points, index, segmentIndex, t } with the new corner at
 * `index`, or null when no side lies within `tolerance` of `pt` or the spot
 * sits on an existing corner.
 */
export function insertVertexOnNearestEdge(points, pt, tolerance = Infinity, { closed = true } = {}) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const px = Number(pt?.x);
  const py = Number(pt?.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const pts = points.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }));
  const sides = closed && pts.length > 2 ? pts.length : pts.length - 1;
  let best = null;
  for (let i = 0; i < sides; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    if (len2 === 0) continue;
    const t = Math.min(1, Math.max(0, ((px - a.x) * vx + (py - a.y) * vy) / len2));
    const d = Math.hypot(a.x + t * vx - px, a.y + t * vy - py);
    if (!best || d < best.d) best = { d, i, t, len: Math.sqrt(len2) };
  }
  if (!best || best.d > tolerance) return null;
  if (best.t * best.len < 1e-6 || (1 - best.t) * best.len < 1e-6) return null;
  const a = pts[best.i];
  const b = pts[(best.i + 1) % pts.length];
  const next = pts.slice();
  next.splice(best.i + 1, 0, { x: a.x + best.t * (b.x - a.x), y: a.y + best.t * (b.y - a.y) });
  return { points: next, index: best.i + 1, segmentIndex: best.i, t: best.t };
}

/**
 * Copy of `obj` with a corner inserted on side `segmentIndex` at fraction `t`
 * (found in any affine frame, e.g. world space: the fraction is preserved).
 * The point lies on the outline, so the bbox and rotation pivot do not move.
 */
export function insertPolyVertex(obj, segmentIndex, t) {
  if (!polyKind(obj) || !Array.isArray(obj.points) || obj.points.length < 2) return null;
  const n = obj.points.length;
  const sides = polyKind(obj) === 'polygon' && n > 2 ? n : n - 1;
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= sides) return null;
  if (!(t > 0 && t < 1)) return null;
  const points = obj.points.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }));
  const a = points[segmentIndex];
  const b = points[(segmentIndex + 1) % n];
  points.splice(segmentIndex + 1, 0, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  const next = { ...obj, points };
  if (obj.data?.pdfCloudVertexState) {
    const { pdfCloudVertexState, ...data } = obj.data;
    next.data = data;
  }
  return next;
}

/**
 * How far (page units) a cloud-styled polygon / polyline reaches outside its
 * own corner outline: the gap between the corners' bounding box and the
 * cloud's selection frame (crowns plus stroke), largest side wins. The side
 * long-press band widens by this on pen / touch so a press on the drawn
 * scallops - not only on the straight corner-to-corner side under them -
 * opens "Add point here". `points` and `frame` share the unrotated page frame.
 */
export function cloudPolyEdgeReach(points, frame) {
  if (!Array.isArray(points) || points.length === 0 || !frame) return 0;
  const xs = points.map((p) => Number(p?.x) || 0);
  const ys = points.map((p) => Number(p?.y) || 0);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  const left = Number(frame.left);
  const top = Number(frame.top);
  const right = left + Number(frame.width);
  const bottom = top + Number(frame.height);
  const reach = Math.max(minX - left, right - maxX, minY - top, bottom - maxY, 0);
  return Number.isFinite(reach) ? reach : 0;
}
