// Nightly 'pen-types': the outline of a pen stroke whose width changes along
// it (Pro and Calligraphy). Same shape contract as the fixed-width ink
// (sweptDiskPolygon): a polygon set of closed rings in page units.
//
// First try one direct ring: the two sides offset by each point's own radius
// (turned by the slope of the radius, so the side stays tangent to the
// circles), joined by round caps. A tight fold makes that ring cross itself;
// then the stroke is the union of tapered capsules (the hull of two circles
// for each step), which is always right but slower.
import { union } from './polygonBooleans.js';
import { normalizeMultiPolygon, ringHasSelfIntersection } from './paperAnnotationGeometry.js';

const CAP_STEPS = 18;

function closeRing(ring) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]]);
  return ring;
}

function circleRing(c, r, steps = CAP_STEPS * 2) {
  const ring = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([c.x + Math.cos(a) * r, c.y + Math.sin(a) * r]);
  }
  return closeRing(ring);
}

function arc(output, c, r, from, to, steps) {
  for (let i = 1; i < steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    output.push([c.x + Math.cos(a) * r, c.y + Math.sin(a) * r]);
  }
}

/** Drop points closer than `min` to the last kept one, keeping each radius. */
export function compactWithRadii(points, radii, min = 0.05) {
  const pts = [];
  const rs = [];
  points.forEach((p, i) => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= min) {
      pts.push({ x: p.x, y: p.y });
      rs.push(radii[i]);
    } else {
      rs[rs.length - 1] = Math.max(rs[rs.length - 1], radii[i]);
    }
  });
  return { points: pts, radii: rs };
}

/** The direct ring, or null when it would cross itself. */
export function directVariableRing(points, radii, { check = true } = {}) {
  const n = points.length;
  if (n < 2) return null;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i += 1) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty);
    if (len === 0) return null;
    tx /= len; ty /= len;
    const nx = -ty;
    const ny = tx;
    // The side touches each circle where the radius' slope tilts it.
    const dr = radii[Math.min(n - 1, i + 1)] - radii[Math.max(0, i - 1)];
    const s = Math.max(-0.9, Math.min(0.9, dr / len));
    const c = Math.sqrt(1 - s * s);
    const r = radii[i];
    const p = points[i];
    left.push([p.x + r * (c * nx - s * tx), p.y + r * (c * ny - s * ty)]);
    right.push([p.x + r * (-c * nx - s * tx), p.y + r * (-c * ny - s * ty)]);
  }
  const ring = [...left];
  const end = points[n - 1];
  const start = points[0];
  const angle = (pt, c) => Math.atan2(pt[1] - c.y, pt[0] - c.x);
  // End cap: from the left side round the front to the right side.
  let a0 = angle(left[n - 1], end);
  let a1 = angle(right[n - 1], end);
  while (a1 > a0) a1 -= Math.PI * 2;
  arc(ring, end, radii[n - 1], a0, a1, CAP_STEPS);
  for (let i = n - 1; i >= 0; i -= 1) ring.push(right[i]);
  // Start cap: from the right side round the back to the left side.
  a0 = angle(right[0], start);
  a1 = angle(left[0], start);
  while (a1 > a0) a1 -= Math.PI * 2;
  arc(ring, start, radii[0], a0, a1, CAP_STEPS);
  closeRing(ring);
  if (check && ringHasSelfIntersection(ring)) return null;
  return ring;
}

/** The hull of two circles: a tapered capsule. */
function taperedCapsule(a, ra, b, rb) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= Math.abs(ra - rb)) return ra >= rb ? circleRing(a, ra) : circleRing(b, rb);
  const theta = Math.atan2(dy, dx);
  const phi = Math.acos((ra - rb) / d);
  const ring = [];
  // Far circle: from theta - phi through theta to theta + phi.
  ring.push([b.x + Math.cos(theta - phi) * rb, b.y + Math.sin(theta - phi) * rb]);
  arc(ring, b, rb, theta - phi, theta + phi, CAP_STEPS);
  ring.push([b.x + Math.cos(theta + phi) * rb, b.y + Math.sin(theta + phi) * rb]);
  // Near circle: from theta + phi round the back to theta - phi + 2 pi.
  ring.push([a.x + Math.cos(theta + phi) * ra, a.y + Math.sin(theta + phi) * ra]);
  arc(ring, a, ra, theta + phi, theta - phi + Math.PI * 2, CAP_STEPS);
  ring.push([a.x + Math.cos(theta - phi) * ra, a.y + Math.sin(theta - phi) * ra]);
  return closeRing(ring);
}

function capsuleUnion(points, radii) {
  let parts = [];
  for (let i = 1; i < points.length; i += 1) {
    parts.push([[taperedCapsule(points[i - 1], radii[i - 1], points[i], radii[i])]]);
  }
  if (!parts.length) return [[circleRing(points[0], radii[0])]];
  // Balanced merge, as the fixed-width fallback does.
  while (parts.length > 1) {
    const merged = [];
    for (let i = 0; i < parts.length; i += 2) {
      merged.push(i + 1 < parts.length ? union(parts[i], parts[i + 1]) : parts[i]);
    }
    parts = merged;
  }
  return normalizeMultiPolygon(parts[0]);
}

/** Polygon set for a stroke with a radius per point. */
export function variableWidthPolygon(points, radii) {
  const compact = compactWithRadii(points, radii);
  if (!compact.points.length) return [];
  if (compact.points.length === 1) return [[circleRing(compact.points[0], compact.radii[0])]];
  const ring = directVariableRing(compact.points, compact.radii);
  return ring ? [[ring]] : capsuleUnion(compact.points, compact.radii);
}

/** SVG path data for the live drawing (no crossing check; filled nonzero). */
export function variableWidthPreviewD(points, radii) {
  const compact = compactWithRadii(points, radii, 0.2);
  if (!compact.points.length) return '';
  const ring = compact.points.length === 1
    ? circleRing(compact.points[0], compact.radii[0])
    : directVariableRing(compact.points, compact.radii, { check: false });
  if (!ring) return '';
  return `M ${ring.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
}
