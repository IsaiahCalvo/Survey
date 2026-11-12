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

/**
 * Dense points after moving the corner at dense index `index` to `target`.
 * A hand-shaped curve (`bezier`) carries the corner's two curve handles
 * along with it and keeps every other span as it is (Takeoff).
 */
export function moveSplineCorner(points, step, index, target, bezier = false) {
  const j = index / step;
  if (bezier) {
    const spans = splineSpans(points, step);
    if (!Number.isInteger(j) || j < 0 || j > spans.length) return points;
    const at = j < spans.length ? spans[j].from : spans[j - 1].to;
    const dx = num(target.x) - at.x;
    const dy = num(target.y) - at.y;
    const shift = (p) => ({ x: p.x + dx, y: p.y + dy });
    if (j < spans.length) spans[j] = { ...spans[j], from: copy(target), c1: shift(spans[j].c1) };
    if (j > 0) spans[j - 1] = { ...spans[j - 1], to: copy(target), c2: shift(spans[j - 1].c2) };
    return sampleSplineSpans(spans, step);
  }
  const corners = splineCorners(points, step);
  if (!Number.isInteger(j) || j < 0 || j >= corners.length) return points;
  corners[j] = copy(target);
  return sampleSpline(corners, step);
}

/**
 * Dense points with a new corner after corner `span` at `point`. A
 * hand-shaped curve splits that span where the new corner lands (fraction
 * `t`, default the middle), so the curve keeps its shape.
 */
export function insertSplineCorner(points, step, span, point, bezier = false, t = 0.5) {
  if (bezier) {
    const spans = splineSpans(points, step);
    if (!Number.isInteger(span) || span < 0 || span >= spans.length) return null;
    const [left, right] = splitCubic(spans[span], Math.min(0.95, Math.max(0.05, Number(t) || 0.5)));
    spans.splice(span, 1, left, right);
    const out = sampleSplineSpans(spans, step);
    const at = out[(span + 1) * step];
    const p = copy(point);
    return p.x === at.x && p.y === at.y ? out : moveSplineCorner(out, step, (span + 1) * step, p, true);
  }
  const corners = splineCorners(points, step);
  if (!Number.isInteger(span) || span < 0 || span >= corners.length - 1) return null;
  corners.splice(span + 1, 0, copy(point));
  return sampleSpline(corners, step);
}

/**
 * Dense points without the corner at dense index `index`, or null. A
 * hand-shaped curve joins the two spans either side into one that leaves
 * and arrives along the same handles.
 */
export function removeSplineCorner(points, step, index, bezier = false) {
  const corners = splineCorners(points, step);
  const j = index / step;
  if (!Number.isInteger(j) || j < 0 || j >= corners.length || corners.length <= 2) return null;
  if (bezier) {
    const spans = splineSpans(points, step);
    if (j === 0) spans.shift();
    else if (j === spans.length) spans.pop();
    else spans.splice(j - 1, 2, { from: spans[j - 1].from, c1: spans[j - 1].c1, c2: spans[j].c2, to: spans[j].to });
    return sampleSplineSpans(spans, step);
  }
  corners.splice(j, 1);
  return sampleSpline(corners, step);
}

// ---- Curve handles (owner 2026-11-09, copying Takeoff: select the curve,
// hold Shift, and every span shows its two handles to bend it by hand) ----
//
// Each span between two corners is one cubic Bezier (the centripetal
// Catmull-Rom span is a cubic too), sampled at t = k / step. So the handles
// are never stored: they are read back out of the dense points, which means
// every move, resize, rotate and flip of the mark carries them along for
// free. `data.spline.bezier` marks a curve the user has shaped by hand, so
// corner edits keep its handles instead of drawing a fresh smooth curve.

/** True when the user has bent this curved polyline by its handles. */
export function isBezierSpline(obj) {
  return obj?.data?.spline?.bezier === true;
}

const cubicAt = (s, t) => {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * s.from.x + b * s.c1.x + c * s.c2.x + d * s.to.x,
    y: a * s.from.y + b * s.c1.y + c * s.c2.y + d * s.to.y,
  };
};

function splitCubic(s, t) {
  const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const ab = lerp(s.from, s.c1);
  const bc = lerp(s.c1, s.c2);
  const cd = lerp(s.c2, s.to);
  const abc = lerp(ab, bc);
  const bcd = lerp(bc, cd);
  const mid = lerp(abc, bcd);
  return [{ from: s.from, c1: ab, c2: abc, to: mid }, { from: mid, c1: bcd, c2: cd, to: s.to }];
}

/**
 * The cubic spans { from, c1, c2, to } of a curved polyline's dense points.
 * Least squares over every sample of the span (ends fixed), so the 0.01
 * rounding a save applies to points barely moves a handle.
 */
export function splineSpans(points, step) {
  if (!Array.isArray(points) || !(step >= 2) || (points.length - 1) % step !== 0) return [];
  const spans = [];
  for (let i = 0; i + step < points.length; i += step) {
    const from = copy(points[i]);
    const to = copy(points[i + step]);
    let s11 = 0; let s12 = 0; let s22 = 0;
    let rx1 = 0; let ry1 = 0; let rx2 = 0; let ry2 = 0;
    for (let k = 1; k < step; k += 1) {
      const t = k / step;
      const mt = 1 - t;
      const b1 = 3 * mt * mt * t;
      const b2 = 3 * mt * t * t;
      const p = copy(points[i + k]);
      const rx = p.x - mt * mt * mt * from.x - t * t * t * to.x;
      const ry = p.y - mt * mt * mt * from.y - t * t * t * to.y;
      s11 += b1 * b1; s12 += b1 * b2; s22 += b2 * b2;
      rx1 += b1 * rx; ry1 += b1 * ry; rx2 += b2 * rx; ry2 += b2 * ry;
    }
    const det = s11 * s22 - s12 * s12;
    const c1 = { x: (rx1 * s22 - rx2 * s12) / det, y: (ry1 * s22 - ry2 * s12) / det };
    const c2 = { x: (rx2 * s11 - rx1 * s12) / det, y: (ry2 * s11 - ry1 * s12) / det };
    spans.push({ from, c1, c2, to });
  }
  return spans;
}

/** Dense points of cubic spans, `step` samples each; corner j at j * step. */
export function sampleSplineSpans(spans, step = SPLINE_STEP) {
  if (!Array.isArray(spans) || !spans.length) return [];
  const out = [];
  spans.forEach((s, i) => {
    out.push(i === 0 ? copy(s.from) : copy(spans[i - 1].to));
    for (let k = 1; k < step; k += 1) out.push(cubicAt(s, k / step));
  });
  out.push(copy(spans[spans.length - 1].to));
  return out;
}

// Handles at a corner count as "in line" (a smooth corner) within ~5 degrees.
const SMOOTH_CORNER_COS = Math.cos((5 * Math.PI) / 180);

/**
 * Dense points after dragging handle `which` ('c1' leaves corner `span`,
 * 'c2' arrives at corner `span + 1`) to `target`.
 *
 * A smooth corner stays smooth (owner 2026-11-12, "truly smooth"): the
 * corner's other handle turns to stay in line, keeping its own length, the
 * way a pen tool's smooth point works. `breakCorner` (Alt held) moves this
 * handle alone and leaves a sharp corner; a corner already sharp stays so.
 */
export function moveSplineHandle(points, step, span, which, target, breakCorner = false) {
  const spans = splineSpans(points, step);
  if (!spans[span] || (which !== 'c1' && which !== 'c2')) return points;
  const before = spans[span][which];
  spans[span] = { ...spans[span], [which]: copy(target) };
  const otherSpan = which === 'c1' ? span - 1 : span + 1;
  const otherKey = which === 'c1' ? 'c2' : 'c1';
  if (!breakCorner && spans[otherSpan]) {
    const corner = which === 'c1' ? spans[span].from : spans[span].to;
    const other = spans[otherSpan][otherKey];
    const ax = before.x - corner.x; const ay = before.y - corner.y;
    const bx = other.x - corner.x; const by = other.y - corner.y;
    const al = Math.hypot(ax, ay); const bl = Math.hypot(bx, by);
    const tx = corner.x - num(target.x); const ty = corner.y - num(target.y);
    const tl = Math.hypot(tx, ty);
    // In line = pointing opposite ways from the corner.
    if (al > 1e-6 && bl > 1e-6 && tl > 1e-6 && -(ax * bx + ay * by) / (al * bl) >= SMOOTH_CORNER_COS) {
      spans[otherSpan] = {
        ...spans[otherSpan],
        [otherKey]: { x: corner.x + (tx / tl) * bl, y: corner.y + (ty / tl) * bl },
      };
    }
  }
  return sampleSplineSpans(spans, step);
}

/** `data` with the hand-shaped mark on its spline. */
export function markBezierSpline(data) {
  const spline = data?.spline || {};
  return spline.bezier === true ? data : { ...(data || {}), spline: { ...spline, bezier: true } };
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

// ---- Drawing the curve smooth (owner 2026-11-12: "as I curve it, it
// becomes angular ... not using the correct curve, beziers, or whatever
// Takeoff uses") ----
//
// The stored points hold only `step` samples per span, so drawing them as
// straight pieces shows corners on a long or tightly bent span, worse when
// zoomed in. Takeoff draws each span as the cubic itself (SVG `C`), which is
// smooth at every zoom; the screen does the same here from splineSpans. What
// can only hold straight pieces (PDF /Vertices and its appearance, XFDF)
// gets the same cubics cut finely enough that no corner shows.

/** Largest gap, in page points, between the cubic and its straight pieces. */
export const SPLINE_FLAT_TOLERANCE = 0.01;
/** Coarser cut for hit tests and pick bands: still well inside any hit band. */
export const SPLINE_HIT_TOLERANCE = 0.05;

const spanCache = new WeakMap();
// splineSpans of a points array, kept while the array lives (marks swap in a
// new array on every edit, so a cached entry never goes stale).
function cachedSpans(points, step) {
  let entry = spanCache.get(points);
  if (!entry || entry.step !== step) {
    entry = { step, spans: splineSpans(points, step), smooth: new Map() };
    spanCache.set(points, entry);
  }
  return entry;
}

const spanLength = (s) => {
  let run = 0;
  let prev = s.from;
  for (let k = 1; k <= 64; k += 1) {
    const p = cubicAt(s, k / 64);
    run += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return run;
};

// Parameter t at which the span has run `distance` along itself (from its
// start). Sampled about every half point so the cut lands where the fine cut
// of the export puts it.
function tAtLength(s, distance) {
  if (!(distance > 0)) return 0;
  const net = Math.hypot(s.c1.x - s.from.x, s.c1.y - s.from.y)
    + Math.hypot(s.c2.x - s.c1.x, s.c2.y - s.c1.y)
    + Math.hypot(s.to.x - s.c2.x, s.to.y - s.c2.y);
  const samples = Math.min(4096, Math.max(64, Math.ceil(net * 2)));
  let run = 0;
  let prev = s.from;
  for (let k = 1; k <= samples; k += 1) {
    const t = k / samples;
    const p = cubicAt(s, t);
    const piece = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (run + piece >= distance) {
      const back = piece > 0 ? (run + piece - distance) / piece : 0;
      return t - back / samples;
    }
    run += piece;
    prev = p;
  }
  return 1;
}

const reverseSpan = (s) => ({ from: s.to, c1: s.c2, c2: s.c1, to: s.from });

// Cut `inset` of length off the front of `spans`, walking past whole spans
// shorter than what is left to cut, as trimPointsByLength does for the fine
// cut. A line shorter than the inset keeps its last span's far half.
function trimFront(spans, inset) {
  if (!(inset > 0) || !spans.length) return spans;
  let left = inset;
  let i = 0;
  while (i < spans.length - 1) {
    const len = spanLength(spans[i]);
    if (len > left) break;
    left -= len;
    i += 1;
  }
  const rest = spans.slice(i);
  const t = tAtLength(rest[0], left);
  // Past the end of the whole line: keep the far half, never cut it all away.
  rest[0] = splitCubic(rest[0], t >= 1 ? 0.5 : Math.max(0, t))[1];
  return rest;
}

// Spans with the first `startInset` and last `endInset` of length cut off
// (the body stops short of a hollow line ending, as insetOpenPolylinePoints
// does for straight sides).
function trimSpans(spans, startInset, endInset) {
  if (!spans.length) return spans;
  const front = trimFront(spans.slice(), startInset);
  return trimFront(front.map(reverseSpan).reverse(), endInset).map(reverseSpan).reverse();
}

const fmt = (v) => Math.round(v * 1000) / 1000;

/**
 * SVG path data drawing a curved polyline's spans as true cubics, or null
 * when `points` / `step` do not make a curve. Optional insets trim the ends.
 */
export function splinePathD(points, step, startInset = 0, endInset = 0) {
  if (!Array.isArray(points) || !(step >= 2)) return null;
  const { spans: all } = cachedSpans(points, step);
  if (!all.length) return null;
  const spans = (startInset > 0 || endInset > 0) ? trimSpans(all, startInset, endInset) : all;
  let d = `M ${fmt(spans[0].from.x)} ${fmt(spans[0].from.y)}`;
  for (const s of spans) {
    d += ` C ${fmt(s.c1.x)} ${fmt(s.c1.y)} ${fmt(s.c2.x)} ${fmt(s.c2.y)} ${fmt(s.to.x)} ${fmt(s.to.y)}`;
  }
  return d;
}

/** The cubic spans of a curved polyline (cached), or [] for any other mark. */
export function polySplineSpans(obj) {
  const step = polySplineStep(obj);
  return step ? cachedSpans(obj.points, step).spans : [];
}

const flatness = (s) => {
  const dx = s.to.x - s.from.x;
  const dy = s.to.y - s.from.y;
  const len = Math.hypot(dx, dy);
  const off = (p) => (len > 0
    ? Math.abs(dx * (p.y - s.from.y) - dy * (p.x - s.from.x)) / len
    : Math.hypot(p.x - s.from.x, p.y - s.from.y));
  return Math.max(off(s.c1), off(s.c2));
};

function flattenSpan(out, s, tolerance, depth) {
  if (depth <= 0 || flatness(s) <= tolerance) {
    out.push({ x: s.to.x, y: s.to.y });
    return;
  }
  const [left, right] = splitCubic(s, 0.5);
  flattenSpan(out, left, tolerance, depth - 1);
  flattenSpan(out, right, tolerance, depth - 1);
}

/**
 * A curved polyline's spans cut into straight pieces no further than
 * `tolerance` from the true curve, every clicked corner kept. Plain
 * polylines (and anything else) get their own points back.
 */
export function smoothPolylinePoints(obj, tolerance = SPLINE_FLAT_TOLERANCE) {
  const step = polySplineStep(obj);
  if (!step) return Array.isArray(obj?.points) ? obj.points : [];
  const entry = cachedSpans(obj.points, step);
  if (!entry.spans.length) return obj.points;
  const hit = entry.smooth.get(tolerance);
  if (hit) return hit;
  const out = [{ x: entry.spans[0].from.x, y: entry.spans[0].from.y }];
  for (const s of entry.spans) flattenSpan(out, s, Math.max(1e-4, tolerance), 12);
  entry.smooth.set(tolerance, out);
  return out;
}

/**
 * `points` with the first `startInset` and last `endInset` of their length
 * cut off. Unlike insetOpenPolylinePoints this walks past short pieces, which
 * a finely cut curve is made of.
 */
export function trimPointsByLength(points, startInset = 0, endInset = 0) {
  if (!Array.isArray(points) || points.length < 2) return Array.isArray(points) ? points.slice() : [];
  const cut = (list, inset) => {
    if (!(inset > 0)) return list;
    let run = 0;
    for (let i = 1; i < list.length; i += 1) {
      const a = list[i - 1];
      const b = list[i];
      const piece = Math.hypot(b.x - a.x, b.y - a.y);
      if (run + piece > inset) {
        const k = (inset - run) / piece;
        return [{ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, ...list.slice(i)];
      }
      run += piece;
    }
    // Shorter than the inset: never cut the whole line away.
    const a = list[list.length - 2];
    const b = list[list.length - 1];
    return [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b];
  };
  const pts = points.map(copy);
  return cut(cut(pts, startInset).reverse(), endInset).reverse();
}
