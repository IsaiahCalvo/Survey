// Smart ink (Drawboard "hold to straighten", Nightly flag 'smart-ink'): end a
// pen stroke by holding still for half a second and it snaps to the shape it
// looks like - a straight line, a rectangle or an ellipse - drawn as a real,
// editable Line / Rectangle / Ellipse in the pen's colour and width. A stroke
// that looks like none of them stays ink. Pure geometry here; the drawing layer
// (src/components/SVGAnnotationLayer.jsx) owns the timer and the commit.

/** How long the pen must rest at the end of a stroke. */
export const SMART_INK_HOLD_MS = 500;
/** How far (screen px) the pen may drift while resting. */
export const SMART_INK_STILL_PX = 3;

const MIN_LINE_LENGTH = 20; // page units
const MIN_BOX_SIDE = 12;
const ELLIPSE_STEPS = 64;

function bounds(points) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function strokeLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

// Mean distance from the points to the box outline.
function rectError(points, b) {
  let sum = 0;
  for (const p of points) {
    const inside = p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
    const toEdge = inside
      ? Math.min(p.x - b.minX, b.maxX - p.x, p.y - b.minY, b.maxY - p.y)
      : Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minY - p.y, 0, p.y - b.maxY));
    sum += toEdge;
  }
  return sum / points.length;
}

// Mean distance from the points to the ellipse inside the box (radial guess).
function ellipseError(points, b) {
  const a = b.width / 2;
  const c = b.height / 2;
  const cx = b.minX + a;
  const cy = b.minY + c;
  let sum = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const r = Math.hypot(dx / a, dy / c);
    if (!r) { sum += Math.min(a, c); continue; }
    // Where the ray through p meets the ellipse, and how far p is from it.
    sum += Math.hypot(dx, dy) * Math.abs(1 - 1 / r);
  }
  return sum / points.length;
}

/**
 * The shape a stroke looks like, or null to keep it as ink.
 * Returns { kind: 'line' | 'rect' | 'ellipse', start, end } in page units:
 * a line's two ends, or the two corners of the shape's box.
 */
export function fitStroke(points, { lineOnly = false } = {}) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  const length = strokeLength(points);
  if (length < MIN_LINE_LENGTH) return null;

  // Straight: every point near the start-end chord, and the stroke not much
  // longer than the chord (a back-and-forth scribble is not a line).
  if (chord >= MIN_LINE_LENGTH && length <= chord * 1.25) {
    const tolerance = Math.max(4, chord * 0.06);
    if (points.every((p) => distanceToSegment(p, first, last) <= tolerance)) {
      return { kind: 'line', start: { x: first.x, y: first.y }, end: { x: last.x, y: last.y } };
    }
  }
  if (lineOnly) return null;

  // Closed: the stroke comes back near where it began and goes round.
  const b = bounds(points);
  const size = Math.max(b.width, b.height);
  if (Math.min(b.width, b.height) < MIN_BOX_SIDE) return null;
  if (chord > size * 0.3 || length < (b.width + b.height) * 1.5) return null;
  const rectErr = rectError(points, b);
  const ellipseErr = ellipseError(points, b);
  const best = Math.min(rectErr, ellipseErr);
  // A messy loop that fits neither well stays ink.
  if (best > Math.min(b.width, b.height) * 0.12) return null;
  return {
    kind: rectErr <= ellipseErr ? 'rect' : 'ellipse',
    start: { x: b.minX, y: b.minY },
    end: { x: b.maxX, y: b.maxY },
  };
}

/** Outline points for the snapped preview, drawn by the live stroke's polyline. */
export function fittedPreviewPoints(fit) {
  if (!fit) return null;
  const { start: s, end: e } = fit;
  if (fit.kind === 'line') return [s, e];
  if (fit.kind === 'rect') return [s, { x: e.x, y: s.y }, e, { x: s.x, y: e.y }, s];
  const cx = (s.x + e.x) / 2;
  const cy = (s.y + e.y) / 2;
  const a = Math.abs(e.x - s.x) / 2;
  const c = Math.abs(e.y - s.y) / 2;
  const out = [];
  for (let i = 0; i <= ELLIPSE_STEPS; i += 1) {
    const t = (i / ELLIPSE_STEPS) * Math.PI * 2;
    out.push({ x: cx + a * Math.cos(t), y: cy + c * Math.sin(t) });
  }
  return out;
}
