// Nightly 'hatch-fill' (Drawboard PDF: shape fill > Hatch): a rectangle,
// ellipse, polygon or cloud can carry a line pattern inside it, over its fill
// colour. The pattern is stored as data.hatch = { pattern } and drawn in the
// shape's border colour.
//
// The lines are worked out here once, in page space, already cut to the
// shape's outline, so the page (SVG), the print and the PDF export all draw
// the very same segments. They turn with the shape and stay put as it moves
// (they are laid out from the shape's centre).

export const HATCH_PATTERNS = Object.freeze([
  { id: 'diagonal', label: 'Diagonal lines', icon: 'hatchDiagonal', angles: [-45] },
  { id: 'back-diagonal', label: 'Back diagonal lines', icon: 'hatchBackDiagonal', angles: [45] },
  { id: 'crosshatch', label: 'Crosshatch', icon: 'hatchCross', angles: [-45, 45] },
  { id: 'horizontal', label: 'Horizontal lines', icon: 'hatchHorizontal', angles: [0] },
  { id: 'vertical', label: 'Vertical lines', icon: 'hatchVertical', angles: [90] },
  { id: 'grid', label: 'Grid', icon: 'hatchGrid', angles: [0, 90] },
]);
export const HATCH_SPACING = 6; // page units (pt) between lines
export const HATCH_LINE_WIDTH = 0.75;
export const HATCH_MAX_LINES = 1500; // per direction, so a page-size shape stays cheap

const BY_ID = new Map(HATCH_PATTERNS.map((p) => [p.id, p]));
const n = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** 'rect' | 'ellipse' | 'polygon' when this mark can hold a hatch, else null. */
export function hatchShapeKind(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const data = obj.data || {};
  if (data.type === 'note' || data.type === 'counter' || data.type === 'text-markup' || data.measure?.kind) return null;
  if (data.link || data.type === 'link') return null;
  if (obj.globalCompositeOperation === 'multiply') return null; // highlight boxes
  const type = String(obj.type || '').toLowerCase();
  if (type === 'rect') return 'rect';
  if (type === 'ellipse' || type === 'circle') return 'ellipse';
  if (type === 'polygon') return 'polygon';
  return null;
}

/** The mark's pattern id, or null. */
export function hatchPatternOf(obj) {
  const id = obj?.data?.hatch?.pattern;
  return hatchShapeKind(obj) && BY_ID.has(id) ? id : null;
}

/** The mark with this pattern (null / unknown clears it). A new object. */
export function applyHatch(obj, pattern) {
  if (!hatchShapeKind(obj)) return obj;
  const data = { ...(obj.data || {}) };
  if (BY_ID.has(pattern)) data.hatch = { pattern };
  else delete data.hatch;
  return { ...obj, data };
}

const rotateAbout = (point, center, deg) => {
  if (!deg) return point;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
};

/** The shape's outline in page space (a closed point list), as the page draws it. */
export function hatchOutline(obj) {
  const kind = hatchShapeKind(obj);
  const angle = n(obj?.angle);
  if (kind === 'rect') {
    const w = Math.abs(n(obj.width) * n(obj.scaleX, 1));
    const h = Math.abs(n(obj.height) * n(obj.scaleY, 1));
    const left = n(obj.left);
    const top = n(obj.top);
    const center = { x: left + w / 2, y: top + h / 2 };
    return [
      { x: left, y: top }, { x: left + w, y: top }, { x: left + w, y: top + h }, { x: left, y: top + h },
    ].map((p) => rotateAbout(p, center, angle));
  }
  if (kind === 'ellipse') {
    const round = obj.type === 'circle' || obj.radius != null;
    const rx = Math.abs(n(round ? obj.radius : obj.rx) * n(obj.scaleX, 1));
    const ry = Math.abs(n(round ? obj.radius : obj.ry) * n(obj.scaleY, 1));
    const center = { x: n(obj.left) + rx, y: n(obj.top) + ry };
    return Array.from({ length: 72 }, (_, i) => {
      const t = (i / 72) * Math.PI * 2;
      return rotateAbout({ x: center.x + Math.cos(t) * rx, y: center.y + Math.sin(t) * ry }, center, angle);
    });
  }
  if (kind === 'polygon') {
    const points = Array.isArray(obj.points) ? obj.points : [];
    if (points.length < 3) return [];
    const sx = n(obj.scaleX, 1);
    const sy = n(obj.scaleY, 1);
    const ox = n(obj.pathOffset?.x);
    const oy = n(obj.pathOffset?.y);
    const xs = points.map((p) => n(p?.x));
    const ys = points.map((p) => n(p?.y));
    const rc = {
      x: sx * ((Math.min(...xs) + Math.max(...xs)) / 2 - ox),
      y: sy * ((Math.min(...ys) + Math.max(...ys)) / 2 - oy),
    };
    const left = n(obj.left);
    const top = n(obj.top);
    return points.map((p) => {
      const local = rotateAbout({ x: sx * (n(p?.x) - ox), y: sy * (n(p?.y) - oy) }, rc, angle);
      return { x: local.x + left, y: local.y + top };
    });
  }
  return [];
}

/**
 * Lines of `pattern` inside the closed outline: [{ x1, y1, x2, y2 }] in page
 * space. `turn` (degrees) turns the pattern with the shape.
 */
export function hatchSegments(outline, pattern, { turn = 0, spacing = HATCH_SPACING } = {}) {
  const spec = BY_ID.get(pattern);
  if (!spec || !Array.isArray(outline) || outline.length < 3 || !(spacing > 0)) return [];
  const cx = outline.reduce((sum, p) => sum + p.x, 0) / outline.length;
  const cy = outline.reduce((sum, p) => sum + p.y, 0) / outline.length;
  const out = [];
  for (const base of spec.angles) {
    const r = ((base + turn) * Math.PI) / 180;
    const d = { x: Math.cos(r), y: Math.sin(r) };
    const nn = { x: -d.y, y: d.x };
    const proj = outline.map((p) => (p.x - cx) * nn.x + (p.y - cy) * nn.y);
    const lo = Math.min(...proj);
    const hi = Math.max(...proj);
    let k = Math.ceil(lo / spacing);
    const last = Math.floor(hi / spacing);
    if (last - k > HATCH_MAX_LINES) k = last - HATCH_MAX_LINES;
    for (; k <= last; k += 1) {
      // Half a step off the centre, so a line never runs along an edge or
      // through a vertex of an axis-aligned shape.
      const t = (k + 0.5) * spacing;
      if (t <= lo || t >= hi) continue;
      const hits = [];
      for (let i = 0; i < outline.length; i += 1) {
        const a = outline[i];
        const b = outline[(i + 1) % outline.length];
        const na = proj[i] - t;
        const nb = proj[(i + 1) % outline.length] - t;
        if ((na < 0 && nb >= 0) || (nb < 0 && na >= 0)) {
          const u = na / (na - nb);
          hits.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
        }
      }
      hits.sort((p, q) => (p.x * d.x + p.y * d.y) - (q.x * d.x + q.y * d.y));
      for (let i = 0; i + 1 < hits.length; i += 2) {
        const p = hits[i];
        const q = hits[i + 1];
        if (Math.hypot(q.x - p.x, q.y - p.y) < 0.01) continue;
        out.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
      }
    }
  }
  return out;
}

/** The colour the lines are drawn in: the border's, or black when it has none. */
export function hatchColor(obj) {
  const raw = typeof obj?.stroke === 'string' ? obj.stroke.trim() : '';
  const clear = !raw || raw === 'transparent' || /^rgba\([^)]*,\s*0(\.0+)?\s*\)$/i.test(raw);
  return clear ? '#000000' : raw;
}

/** Everything a renderer needs: { segments, color, width, opacity } or null. */
export function hatchPaint(obj) {
  const pattern = hatchPatternOf(obj);
  if (!pattern) return null;
  const segments = hatchSegments(hatchOutline(obj), pattern, { turn: n(obj.angle) });
  if (segments.length === 0) return null;
  return {
    segments,
    color: hatchColor(obj),
    width: HATCH_LINE_WIDTH,
    opacity: Math.max(0, Math.min(1, n(obj.opacity, 1))),
  };
}

/** SVG path data for the segments. */
export const hatchPathData = (segments) => segments
  .map((s) => `M${s.x1.toFixed(2)} ${s.y1.toFixed(2)}L${s.x2.toFixed(2)} ${s.y2.toFixed(2)}`)
  .join('');
