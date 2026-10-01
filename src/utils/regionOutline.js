/**
 * regionOutline.js - outline geometry for Spaces areas (regions).
 *
 * Owner 2026-10-01: "If I do a subtractive region onto another region and it's
 * a curve, it puts a bunch of points on that curve. That's too much."
 *
 * A region stays a flat [x0, y0, x1, y1, ...] polygon in page units, so every
 * old consumer (hit-testing, visibility rules, CSV, boolean ops) keeps
 * working. Two additions:
 *
 * 1. Thinning. A finished freehand stroke, and the result of an add/subtract,
 *    keeps only the points it needs to stay within a small tolerance of the
 *    drawn line (Ramer-Douglas-Peucker). Points marked as corners (rectangle
 *    corners, straight-edge points, the points where a cut crosses an edge)
 *    are never moved or dropped.
 *
 * 2. `region.smoothVertices` (optional, one 0/1 per vertex). A 1 means the
 *    outline passes through that point as a smooth curve (centripetal
 *    Catmull-Rom, drawn as cubic Beziers); a 0 is a sharp corner. A segment
 *    between two corners is a straight line. Regions without the field (all
 *    regions saved before this change) draw exactly as before: straight lines.
 *
 * Every renderer that needs a plain polygon of the drawn shape (the space
 * overlay, the space PDF export mask, the editor's merged outline) calls
 * getRegionOutlineCoordinates(), which flattens the same curve the editor
 * draws, so what is exported matches what is on screen.
 */

export const REGION_SMOOTH_FLAGS_KEY = 'smoothVertices';

// Below this many page units two points are the same point.
const SAME_POINT_EPS = 1e-6;

/** The region's per-vertex smooth flags, or null when absent / stale. */
export const getRegionSmoothFlags = (region) => {
  const coords = region?.coordinates;
  const flags = region?.[REGION_SMOOTH_FLAGS_KEY];
  if (!Array.isArray(coords) || !Array.isArray(flags)) return null;
  // A flag list that no longer matches the vertex count is stale: draw straight.
  if (flags.length * 2 !== coords.length) return null;
  return flags.some(Boolean) ? flags : null;
};

export const regionHasSmoothOutline = (region) => getRegionSmoothFlags(region) !== null;

const toPoints = (coords) => {
  const pts = [];
  if (!Array.isArray(coords)) return pts;
  for (let i = 0; i + 1 < coords.length; i += 2) {
    const x = coords[i];
    const y = coords[i + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
};

// Centripetal Catmull-Rom (alpha 0.5) tangent handle at p1 for the segment
// p1 -> p2, with p0 the point before p1. Returns the first Bezier control.
const crControl = (p0, p1, p2) => {
  const d1 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y));
  const d2 = Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y));
  if (d1 < 1e-9 || d2 < 1e-9) {
    return { x: p1.x + (p2.x - p1.x) / 3, y: p1.y + (p2.y - p1.y) / 3 };
  }
  const a = d1 * d1;
  const b = d2 * d2;
  const m = 2 * a + 3 * d1 * d2 + b;
  const den = 3 * d1 * (d1 + d2);
  return {
    x: (a * p2.x - b * p0.x + m * p1.x) / den,
    y: (a * p2.y - b * p0.y + m * p1.y) / den,
  };
};

// Bezier controls for the segment p1 -> p2 (p0 before p1, p3 after p2), or
// null when both ends are corners (a straight segment).
const segmentControls = (p0, p1, p2, p3, s1, s2) => {
  if (!s1 && !s2) return null;
  const c1 = s1 ? crControl(p0, p1, p2) : { x: p1.x + (p2.x - p1.x) / 3, y: p1.y + (p2.y - p1.y) / 3 };
  const c2 = s2 ? crControl(p3, p2, p1) : { x: p2.x + (p1.x - p2.x) / 3, y: p2.y + (p1.y - p2.y) / 3 };
  return { c1, c2 };
};

const bezierPoint = (p1, c1, c2, p2, t) => {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * p1.x + w1 * c1.x + w2 * c2.x + w3 * p2.x,
    y: w0 * p1.y + w1 * c1.y + w2 * c2.y + w3 * p2.y,
  };
};

const sqSegDist = (p, a, b) => {
  let x = a.x;
  let y = a.y;
  let dx = b.x - x;
  let dy = b.y - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b.x; y = b.y; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p.x - x;
  dy = p.y - y;
  return dx * dx + dy * dy;
};

// RDP over ring indices first..last (last may exceed n; indices wrap). Marks
// kept indices (mod n) in `keep`.
const rdpRun = (pts, first, last, sqTol, keep) => {
  const n = pts.length;
  const stack = [[first, last]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const pa = pts[a % n];
    const pb = pts[b % n];
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i += 1) {
      const d = sqSegDist(pts[i % n], pa, pb);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sqTol && idx > a) {
      keep[idx % n] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
};

// Distance from p to the polyline q[0..m-1] (open).
const distToPolyline = (p, q) => {
  let best = Infinity;
  for (let k = 0; k + 1 < q.length; k += 1) {
    const d = sqSegDist(p, q[k], q[k + 1]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
};

// Samples of the drawn outline through ring vertices K[a..b] (positions in K,
// cyclic), with smooth flags looked up on the original ring.
const sampleKeptSpan = (pts, smooth, K, a, b) => {
  const m = K.length;
  const P = (j) => pts[K[((j % m) + m) % m]];
  const S = (j) => Boolean(smooth[K[((j % m) + m) % m]]);
  const out = [P(a)];
  for (let j = a; j < b; j += 1) {
    const ctrl = segmentControls(P(j - 1), P(j), P(j + 1), P(j + 2), S(j), S(j + 1));
    if (ctrl) {
      for (let k = 1; k < 24; k += 1) out.push(bezierPoint(P(j), ctrl.c1, ctrl.c2, P(j + 1), k / 24));
    }
    out.push(P(j + 1));
  }
  return out;
};

// After chord thinning, drop smooth points the curve does not need: a point
// goes when the smooth outline drawn without it still passes within
// `tolerance` of every original sample in the affected stretch (and does not
// bulge away from them). Corners are never touched.
const dropUnneededSmoothPoints = (pts, smooth, fixed, kept, tolerance) => {
  const n = pts.length;
  let K = kept.slice();
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    for (let j = 0; j < K.length && K.length > 4;) {
      const i = K[j];
      if (fixed?.[i] || !smooth[i]) { j += 1; continue; }
      const trial = K.slice(0, j).concat(K.slice(j + 1));
      const m = trial.length;
      // In `trial`, the removed point sat between positions j-1 and j.
      const a = j - 2;
      const b = j + 1;
      const curve = sampleKeptSpan(pts, smooth, trial, a, b);
      const startRaw = trial[((a % m) + m) % m];
      const endRaw = trial[((b % m) + m) % m];
      const span = (endRaw - startRaw + n) % n;
      const raw = [];
      for (let r = 0; r <= span; r += 1) raw.push(pts[(startRaw + r) % n]);
      let ok = raw.length >= 2;
      for (let r = 0; ok && r < raw.length; r += 1) {
        if (distToPolyline(raw[r], curve) > tolerance) ok = false;
      }
      for (let c = 0; ok && c < curve.length; c += 1) {
        if (distToPolyline(curve[c], raw) > tolerance) ok = false;
      }
      if (ok) { K = trial; changed = true; } else j += 1;
    }
    if (!changed) break;
  }
  return K;
};

// Final guarantee: wherever the curve through the kept points strays more
// than `tolerance` from the original samples between two kept points, put
// back the sample that strays most. Repeats until the whole outline fits.
const restoreWhereCurveStrays = (pts, smooth, kept, tolerance) => {
  const n = pts.length;
  let K = kept.slice();
  for (let pass = 0; pass < 8; pass += 1) {
    const next = [];
    let inserted = false;
    const m = K.length;
    for (let j = 0; j < m; j += 1) {
      next.push(K[j]);
      const start = K[j];
      const end = K[(j + 1) % m];
      const span = (end - start + n) % n;
      if (span < 2) continue;
      const curve = sampleKeptSpan(pts, smooth, K, j, j + 1);
      let worst = tolerance;
      let worstIdx = -1;
      for (let r = 1; r < span; r += 1) {
        const d = distToPolyline(pts[(start + r) % n], curve);
        if (d > worst) { worst = d; worstIdx = (start + r) % n; }
      }
      if (worstIdx >= 0) { next.push(worstIdx); inserted = true; }
    }
    K = next;
    if (!inserted) break;
  }
  return K;
};

/**
 * Thin a closed ring. `fixed[i]` = never drop vertex i. With `smooth` given,
 * smooth vertices are thinned against the smooth curve drawn through them
 * (fewer points than straight chords need). Returns the kept indices in ring
 * order (at least 3 when the ring has 3+ points).
 */
export const thinClosedRingIndices = (pts, tolerance, fixed = null, smooth = null) => {
  const n = pts.length;
  if (n <= 3) return pts.map((_, i) => i);
  const sqTol = Math.max(tolerance, 0) ** 2;
  const keep = new Array(n).fill(false);
  const anchors = [];
  for (let i = 0; i < n; i += 1) {
    if (fixed?.[i]) { keep[i] = true; anchors.push(i); }
  }
  if (anchors.length === 0) {
    // No corners: split the loop at its two farthest-apart points.
    let far = 0;
    let farD = -1;
    for (let i = 1; i < n; i += 1) {
      const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
      if (d > farD) { farD = d; far = i; }
    }
    anchors.push(0, far);
    keep[0] = true;
    keep[far] = true;
  }
  for (let k = 0; k < anchors.length; k += 1) {
    const a = anchors[k];
    const b = k + 1 < anchors.length ? anchors[k + 1] : anchors[0] + n;
    rdpRun(pts, a, b, sqTol, keep);
  }
  let kept = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) kept.push(i);
  if (kept.length < 3) {
    // Degenerate (near-flat) ring: add the point farthest from the chord.
    const a = pts[kept[0]];
    const b = pts[kept[kept.length - 1]];
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < n; i += 1) {
      if (keep[i]) continue;
      const d = sqSegDist(pts[i], a, b);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) keep[best] = true;
    kept = [];
    for (let i = 0; i < n; i += 1) if (keep[i]) kept.push(i);
  }
  if (smooth && kept.length > 4) {
    return restoreWhereCurveStrays(pts, smooth, dropUnneededSmoothPoints(pts, smooth, fixed, kept, tolerance), tolerance);
  }
  return kept;
};

const dropRepeats = (pts, flags) => {
  const outP = [];
  const outF = [];
  for (let i = 0; i < pts.length; i += 1) {
    const prev = outP[outP.length - 1];
    if (prev && Math.abs(prev.x - pts[i].x) < SAME_POINT_EPS && Math.abs(prev.y - pts[i].y) < SAME_POINT_EPS) {
      // Keep the stricter flag (a corner wins over a smooth point).
      if (flags && !flags[i]) outF[outF.length - 1] = false;
      continue;
    }
    outP.push(pts[i]);
    outF.push(flags ? Boolean(flags[i]) : true);
  }
  while (outP.length > 1) {
    const a = outP[0];
    const z = outP[outP.length - 1];
    if (Math.abs(a.x - z.x) < SAME_POINT_EPS && Math.abs(a.y - z.y) < SAME_POINT_EPS) {
      if (!outF[outF.length - 1]) outF[0] = false;
      outP.pop();
      outF.pop();
    } else break;
  }
  return { pts: outP, flags: outF };
};

const pack = (pts, idx, flags) => {
  const coordinates = [];
  const smooth = [];
  for (const i of idx) {
    coordinates.push(pts[i].x, pts[i].y);
    smooth.push(flags[i] ? 1 : 0);
  }
  return { coordinates, smoothVertices: smooth.some(Boolean) ? smooth : undefined };
};

/**
 * A finished freehand stroke (flat coords, page units) -> the fewest points
 * that keep the outline within `tolerance` page units of the stroke. Every
 * kept point is smooth.
 */
export const thinFreehandStroke = (coords, tolerance) => {
  const { pts, flags } = dropRepeats(toPoints(coords), null);
  if (pts.length < 3) {
    return { coordinates: pts.flatMap((p) => [p.x, p.y]), smoothVertices: undefined };
  }
  const idx = thinClosedRingIndices(pts, tolerance, null, flags);
  return pack(pts, idx, flags);
};

const pointKey = (x, y) => `${x},${y}`;

/**
 * Smooth-flag lookup for the vertices of one or more regions, keyed by exact
 * coordinates. Martinez copies input vertices into its output unchanged, so a
 * boolean result's vertex that equals an input vertex inherits its flag;
 * anything else (a point where two outlines cross) is a corner.
 */
export const buildSmoothVertexLookup = (regions) => {
  const map = new Map();
  for (const region of regions || []) {
    const coords = region?.coordinates;
    if (!Array.isArray(coords)) continue;
    const flags = getRegionSmoothFlags(region);
    for (let i = 0, v = 0; i + 1 < coords.length; i += 2, v += 1) {
      const key = pointKey(coords[i], coords[i + 1]);
      const smooth = Boolean(flags?.[v]);
      // Shared by two inputs: a corner in either one stays a corner.
      map.set(key, map.has(key) ? map.get(key) && smooth : smooth);
    }
  }
  return map;
};

/**
 * A boolean result ring (flat coords) -> thinned coords + smooth flags.
 * Only smooth runs are thinned; corners are kept exactly. When no vertex is
 * smooth the ring is returned untouched (old straight-edged behaviour).
 */
export const thinBooleanResultRing = (coords, lookup, tolerance) => {
  const raw = toPoints(coords);
  const rawFlags = raw.map((p) => lookup?.get(pointKey(p.x, p.y)) === true);
  if (!rawFlags.some(Boolean)) {
    return { coordinates: Array.isArray(coords) ? [...coords] : [], smoothVertices: undefined };
  }
  const { pts, flags } = dropRepeats(raw, rawFlags);
  if (pts.length < 3) {
    return { coordinates: pts.flatMap((p) => [p.x, p.y]), smoothVertices: undefined };
  }
  const fixed = flags.map((f) => !f);
  const idx = thinClosedRingIndices(pts, tolerance, fixed, flags);
  return pack(pts, idx, flags);
};

/**
 * The outline as segments: [{ from, to, c1, c2 }] where c1/c2 are null for a
 * straight segment. Points are in page units.
 */
export const getOutlineSegments = (coords, flags) => {
  const pts = toPoints(coords);
  const n = pts.length;
  const segs = [];
  if (n < 2) return segs;
  const smoothAt = (i) => Boolean(flags?.[((i % n) + n) % n]);
  const at = (i) => pts[((i % n) + n) % n];
  for (let i = 0; i < n; i += 1) {
    const p1 = at(i);
    const p2 = at(i + 1);
    const s1 = n > 2 && smoothAt(i);
    const s2 = n > 2 && smoothAt(i + 1);
    const ctrl = segmentControls(at(i - 1), p1, p2, at(i + 2), s1, s2);
    segs.push({ from: p1, to: p2, c1: ctrl?.c1 || null, c2: ctrl?.c2 || null });
  }
  return segs;
};

const fmt = (v) => (Math.round(v * 1000) / 1000);

/**
 * SVG path data for a closed region outline, mapped with scaleX/scaleY
 * (page units -> drawing units). Straight-only outlines produce the same
 * M/L/Z string as before.
 */
export const buildRegionOutlinePathD = (coords, flags, scaleX = 1, scaleY = 1) => {
  const pts = toPoints(coords);
  if (pts.length < 2) return null;
  const X = (v) => v * scaleX;
  const Y = (v) => v * scaleY;
  if (!flags || !flags.some(Boolean) || pts.length < 3) {
    let d = `M ${X(pts[0].x)} ${Y(pts[0].y)}`;
    for (let i = 1; i < pts.length; i += 1) d += ` L ${X(pts[i].x)} ${Y(pts[i].y)}`;
    if (pts.length > 2) d += ' Z';
    return d;
  }
  const segs = getOutlineSegments(coords, flags);
  let d = `M ${fmt(X(pts[0].x))} ${fmt(Y(pts[0].y))}`;
  for (const s of segs) {
    if (!s.c1) d += ` L ${fmt(X(s.to.x))} ${fmt(Y(s.to.y))}`;
    else d += ` C ${fmt(X(s.c1.x))} ${fmt(Y(s.c1.y))} ${fmt(X(s.c2.x))} ${fmt(Y(s.c2.y))} ${fmt(X(s.to.x))} ${fmt(Y(s.to.y))}`;
  }
  return `${d} Z`;
};

/**
 * Flatten a (possibly curved) outline to a plain polygon (flat coords, page
 * units). `step` is the target spacing between samples on a curve.
 */
export const flattenRegionOutline = (coords, flags, step = 2) => {
  if (!flags || !flags.some(Boolean)) return Array.isArray(coords) ? [...coords] : [];
  const out = [];
  for (const s of getOutlineSegments(coords, flags)) {
    out.push(s.from.x, s.from.y);
    if (!s.c1) continue;
    const len = Math.hypot(s.c1.x - s.from.x, s.c1.y - s.from.y)
      + Math.hypot(s.c2.x - s.c1.x, s.c2.y - s.c1.y)
      + Math.hypot(s.to.x - s.c2.x, s.to.y - s.c2.y);
    const steps = Math.max(2, Math.min(24, Math.ceil(len / Math.max(step, 0.25))));
    for (let k = 1; k < steps; k += 1) {
      const q = bezierPoint(s.from, s.c1, s.c2, s.to, k / steps);
      out.push(q.x, q.y);
    }
  }
  return out;
};

/**
 * The polygon a renderer should fill for this region: the flattened curve
 * for a smooth region, the stored coordinates (unchanged) otherwise.
 */
export const getRegionOutlineCoordinates = (region) => {
  const flags = getRegionSmoothFlags(region);
  if (!flags) return region?.coordinates;
  return flattenRegionOutline(region.coordinates, flags);
};

/** The same region with its coordinates swapped for the drawn outline. */
export const withRegionOutlineCoordinates = (region) => {
  if (!regionHasSmoothOutline(region)) return region;
  return { ...region, coordinates: getRegionOutlineCoordinates(region) };
};
