/**
 * Draw / corner-drag snapping for lines, arrows, polylines, polygons and
 * measures (Drawboard parity):
 *  - Shift locks the segment from its anchor to 45° steps (0/45/90/...).
 *  - The point is pulled onto an existing line end or polygon/polyline corner
 *    on the same page within DRAW_SNAP_SCREEN_PX screen pixels. Endpoint snap
 *    wins over the angle lock (a corner you aim at is the stronger intent).
 * Alt (or the device "snap to marks" preference off) disables the endpoint
 * pull; Shift still locks the angle. Pure page-unit math, no DOM.
 */
import { computeLineBboxCenter, getLineEndpoints } from './svgBoundingBox.js';

export const DRAW_SNAP_SCREEN_PX = 8;
// Touch / pen (no Shift, a fingertip covers the target): a wider endpoint
// pull, and a Drawboard-style angle assist that locks the segment to the
// nearest 45° step when it is already within TOUCH_ANGLE_ASSIST_DEG of it.
export const DRAW_SNAP_TOUCH_SCREEN_PX = 14;
export const TOUCH_ANGLE_ASSIST_DEG = 5;

/** True for a finger or pen pointer (mouse keeps the Shift-only behaviour). */
export function isCoarseSnapPointer(e) {
  const t = e?.pointerType;
  return t === 'touch' || t === 'pen';
}

/** Endpoint-snap radius in screen px for this pointer. */
export function drawSnapScreenPx(e) {
  return isCoarseSnapPointer(e) ? DRAW_SNAP_TOUCH_SCREEN_PX : DRAW_SNAP_SCREEN_PX;
}

const finite = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Rotate `to` about `from` onto the nearest multiple of stepDeg, keeping length. */
export function snapAngle(from, to, stepDeg = 45) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !(stepDeg > 0)) return { x: to.x, y: to.y };
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  // Exact axis values for 0/90/180/270 so locked segments are truly straight.
  const c = Math.round(Math.cos(angle) * 1e12) / 1e12;
  const s = Math.round(Math.sin(angle) * 1e12) / 1e12;
  return { x: from.x + c * length, y: from.y + s * length };
}

/**
 * Angle assist: `to` locked to the nearest stepDeg multiple about `from` when
 * the segment is within tolDeg of it, else null (left free).
 */
export function assistAngle(from, to, { stepDeg = 45, tolDeg = TOUCH_ANGLE_ASSIST_DEG } = {}) {
  if (!from || !to || !(stepDeg > 0) || !(tolDeg > 0)) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!(Math.hypot(dx, dy) > 0)) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const off = Math.abs(deg - Math.round(deg / stepDeg) * stepDeg);
  return off <= tolDeg ? snapAngle(from, to, stepDeg) : null;
}

/** Closest candidate within tolPage (inclusive), or null. */
export function nearestEndpoint(pt, candidates, tolPage) {
  if (!pt || !Array.isArray(candidates) || !(tolPage > 0)) return null;
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const d = Math.hypot(c.x - pt.x, c.y - pt.y);
    if (d <= tolPage && d < bestD) { best = c; bestD = d; }
  }
  return best ? { x: best.x, y: best.y, distance: bestD } : null;
}

function rotateAbout(p, c, deg) {
  if (!deg) return { x: p.x, y: p.y };
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos };
}

/** World positions of a polygon/polyline's stored points (renderer transform chain). */
export function polyWorldPoints(obj) {
  if (!Array.isArray(obj?.points)) return [];
  const pts = obj.points.map((p) => ({ x: finite(p?.x), y: finite(p?.y) }));
  if (!pts.length) return [];
  const left = finite(obj.left);
  const top = finite(obj.top);
  const sx = finite(obj.scaleX, 1) || 1;
  const sy = finite(obj.scaleY, 1) || 1;
  const pox = finite(obj.pathOffset?.x);
  const poy = finite(obj.pathOffset?.y);
  const angle = finite(obj.angle);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const x of xs) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  for (const y of ys) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const rc = { x: sx * ((minX + maxX) / 2 - pox), y: sy * ((minY + maxY) / 2 - poy) };
  return pts.map((p) => {
    const w = rotateAbout({ x: sx * (p.x - pox), y: sy * (p.y - poy) }, rc, angle);
    return { x: w.x + left, y: w.y + top };
  });
}

/** World endpoints of a line/arrow (rotated about its curve-inclusive bbox center). */
export function lineWorldEndpoints(obj) {
  const ep = getLineEndpoints(obj);
  const mid = obj?.data?.midpoint || null;
  const angle = finite(obj?.angle);
  const pivot = computeLineBboxCenter(ep, mid);
  return [rotateAbout({ x: ep.x1, y: ep.y1 }, pivot, angle), rotateAbout({ x: ep.x2, y: ep.y2 }, pivot, angle)];
}

/**
 * Snap targets on a page: every line/arrow end and polygon/polyline corner.
 * `exclude(obj, index)` drops marks (e.g. the one being edited); for the mark
 * being edited, pass `own: { index, skip: Set<pointIndex> }` to keep its other
 * corners as targets but not the dragged one. `include` (a Set of indices)
 * limits targets to marks the user can see (hidden layers, other scopes).
 */
export function collectEndpointCandidates(objects, { excludeIndex = -1, own = null, include = null } = {}) {
  const out = [];
  if (!Array.isArray(objects)) return out;
  objects.forEach((obj, index) => {
    if (!obj || index === excludeIndex) return;
    if (include && !include.has(index) && !(own && own.index === index)) return;
    const type = String(obj.type || '').toLowerCase();
    let pts = null;
    if (type === 'line') pts = lineWorldEndpoints(obj);
    else if (type === 'polygon' || type === 'polyline') pts = polyWorldPoints(obj);
    if (!pts) return;
    pts.forEach((p, i) => {
      if (own && own.index === index && own.skip?.has(i)) return;
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) out.push(p);
    });
  });
  return out;
}

/**
 * resolveDrawSnap options for a live pointer event: Shift on any pointer;
 * on touch / pen the wider radius and the ±5° angle assist. `endpoint.coarse`
 * tells the indicator to draw the larger ring.
 */
export function drawSnapEventOptions(e, inverseScale) {
  const coarse = isCoarseSnapPointer(e);
  const inv = Number(inverseScale);
  return {
    shiftKey: !!e?.shiftKey,
    tolPage: drawSnapScreenPx(e) * (Number.isFinite(inv) && inv > 0 ? inv : 1),
    angleAssistDeg: coarse ? TOUCH_ANGLE_ASSIST_DEG : 0,
    coarse,
  };
}

/**
 * Resolve the final point. Returns { point, endpoint } where endpoint is the
 * snapped target (for the indicator) or null.
 */
export function resolveDrawSnap(anchor, point, {
  shiftKey = false, endpointSnap = true, candidates = [], tolPage = 0, stepDeg = 45, angleAssistDeg = 0, coarse = false,
} = {}) {
  if (!point) return { point, endpoint: null };
  if (endpointSnap) {
    const hit = nearestEndpoint(point, candidates, tolPage);
    if (hit) return { point: { x: hit.x, y: hit.y }, endpoint: { x: hit.x, y: hit.y, ...(coarse ? { coarse: true } : {}) } };
  }
  if (shiftKey && anchor) return { point: snapAngle(anchor, point, stepDeg), endpoint: null };
  if (angleAssistDeg > 0 && anchor) {
    const locked = assistAngle(anchor, point, { stepDeg, tolDeg: angleAssistDeg });
    if (locked) return { point: locked, endpoint: null };
  }
  return { point: { x: point.x, y: point.y }, endpoint: null };
}
