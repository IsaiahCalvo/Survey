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
