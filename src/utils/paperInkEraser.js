/**
 * inkEraser.js — exact swept-capsule partial erase for ink strokes.
 *
 * The Drawboard/Xournal++/PDF-InkList model: the eraser removes the parts of
 * a stroke's CENTERLINE covered by the swept circle (a capsule per pointer
 * segment), and the survivors stay ordinary stroked path pieces — same
 * schema, same stroke props, multiple subpaths inside ONE annotation (exactly
 * the PDF /InkList shape). No ribbon conversion, no boolean polygon ops.
 *
 * Guarantees:
 *  - EXACT geometry: per ink segment, erased parameter intervals come from
 *    the circle quadratic (both capsule ends) plus the oriented-rect linear
 *    clip (capsule body) — no sampling gaps, no tunneling at any drag speed.
 *  - Rim counts: callers pass rEff = eraserRadius + strokeWidth/2, and
 *    tangency is accepted with a small epsilon, so a circle whose rim just
 *    touches the visible ink body cuts it.
 *  - Curves stay curves: Q segments are flattened only to FIND the erased
 *    intervals (with parameter mapping), then split exactly by De Casteljau —
 *    surviving pieces are true quadratics with zero fidelity loss.
 *  - Idempotent: intervals merge, so overlapping passes converge.
 *
 * All functions are pure; coordinates are the path's own data space.
 */

// Coordinate-space epsilons are intentionally forbidden here. Ink can arrive
// from a PDF at any page/user-unit scale, so a fixed `1e-9` means "zero" for
// one document and "a large visible distance" for another. Comparisons below
// are either exact degeneracy checks or relative to the normalized operands.
const FLOAT_EPS = Number.EPSILON;
const PARAM_EPS = 32 * FLOAT_EPS;
const MAX_CURVE_DEPTH = 48;
const MAX_FLATTEN_DEPTH = 16;

const parameterTolerance = (...values) => (
  PARAM_EPS * Math.max(1, ...values.map((value) => Math.abs(value)))
);

const relativeTolerance = (...values) => (
  32 * FLOAT_EPS * Math.max(Number.MIN_VALUE, ...values.map((value) => Math.abs(value)))
);

const finiteCoordinateScale = (...values) => {
  let scale = Number.MIN_VALUE;
  for (const value of values) {
    if (Number.isFinite(value)) scale = Math.max(scale, Math.abs(value));
  }
  return scale;
};

const normalizedPoint = (point, scale) => ({
  x: point.x / scale,
  y: point.y / scale,
});

const lerpCoordinate = (a, b, t) => {
  const direct = a + (b - a) * t;
  if (Number.isFinite(direct)) return direct;
  return a * (1 - t) + b * t;
};

const lerpPoint = (a, b, t) => ({
  x: lerpCoordinate(a.x, b.x, t),
  y: lerpCoordinate(a.y, b.y, t),
});

// ---------------------------------------------------------------------------
// Interval helpers (parameter space, t in [0,1] per segment)
// ---------------------------------------------------------------------------

export function mergeIntervals(intervals) {
  if (intervals.length <= 1) return intervals.slice();
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const out = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1] + parameterTolerance(cur[0], last[1])) {
      if (cur[1] > last[1]) last[1] = cur[1];
    } else {
      out.push(cur.slice());
    }
  }
  return out;
}

/** Complement of merged erased intervals within [0,1]: the KEPT runs. */
export function keptRuns(erased) {
  const runs = [];
  let cursor = 0;
  for (const [a, b] of erased) {
    if (a > cursor + parameterTolerance(a, cursor)) runs.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < 1 - parameterTolerance(cursor, 1)) runs.push([cursor, 1]);
  return runs;
}

// ---------------------------------------------------------------------------
// Exact segment-vs-capsule erased interval
// ---------------------------------------------------------------------------

/**
 * Erased t-interval of ink segment P0->P1 against a CIRCLE (center C, radius r).
 * Returns [t0,t1] clamped to [0,1], or null.
 */
export function segmentCircleInterval(p0, p1, c, r) {
  if (![p0.x, p0.y, p1.x, p1.y, c.x, c.y, r].every(Number.isFinite) || r < 0) {
    return null;
  }
  const scale = finiteCoordinateScale(p0.x, p0.y, p1.x, p1.y, c.x, c.y, r);
  const p0n = normalizedPoint(p0, scale);
  const p1n = normalizedPoint(p1, scale);
  const cn = normalizedPoint(c, scale);
  const rn = r / scale;
  const dx = p1n.x - p0n.x;
  const dy = p1n.y - p0n.y;
  const fx = p0n.x - cn.x;
  const fy = p0n.y - cn.y;
  const endFx = p1n.x - cn.x;
  const endFy = p1n.y - cn.y;

  const startDistance = Math.hypot(fx, fy);
  const endDistance = Math.hypot(endFx, endFy);
  const startInside = startDistance <= rn + relativeTolerance(startDistance, rn);
  const endInside = endDistance <= rn + relativeTolerance(endDistance, rn);
  if (startInside && endInside) return [0, 1];

  const a = dx * dx + dy * dy;
  if (dx === 0 && dy === 0) {
    // Degenerate point segment: erased iff within r.
    return startInside ? [0, 1] : null;
  }
  // Squaring a segment that is vanishingly small relative to a containing
  // circle can underflow. Endpoint containment above already handled the only
  // possible hit in that case.
  if (a === 0 || !Number.isFinite(a)) {
    return null;
  }
  // Closest-approach form avoids the catastrophic `b² - 4ac` cancellation
  // of the textbook quadratic. Example: a radius 1e140 circle centered on a
  // 1e150 line has two valid roots, while b² and 4ac round to the same number.
  const closestT = -(fx * dx + fy * dy) / a;
  const closestFx = fx + closestT * dx;
  const closestFy = fy + closestT * dy;
  const closestDistance = Math.hypot(closestFx, closestFy);
  const distanceTolerance = relativeTolerance(closestDistance, rn);
  if (closestDistance > rn + distanceTolerance) return null;
  const radialSquared = Math.max(
    0,
    (rn - closestDistance) * (rn + closestDistance),
  );
  const halfSpan = Math.sqrt(radialSquared / a);
  let t0 = closestT - halfSpan;
  let t1 = closestT + halfSpan;
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  if (t1 < 0 || t0 > 1) return null;
  t0 = Math.max(0, t0);
  t1 = Math.min(1, t1);
  return t1 >= t0 - PARAM_EPS ? [t0, t1] : null;
}

/**
 * Erased t-interval of ink segment P0->P1 against the ORIENTED RECT part of
 * the capsule E0->E1 with half-width r. Returns [t0,t1] or null.
 */
function segmentRectInterval(p0, p1, e0, e1, r) {
  if (![p0.x, p0.y, p1.x, p1.y, e0.x, e0.y, e1.x, e1.y, r].every(Number.isFinite) || r < 0) {
    return null;
  }
  const scale = finiteCoordinateScale(
    p0.x, p0.y, p1.x, p1.y,
    e0.x, e0.y, e1.x, e1.y,
    r,
  );
  const p0n = normalizedPoint(p0, scale);
  const p1n = normalizedPoint(p1, scale);
  const e0n = normalizedPoint(e0, scale);
  const e1n = normalizedPoint(e1, scale);
  const rn = r / scale;
  const ux = e1n.x - e0n.x;
  const uy = e1n.y - e0n.y;
  const L = Math.hypot(ux, uy);
  if (ux === 0 && uy === 0) return null; // no body — end circles cover it
  const nx = ux / L;
  const ny = uy / L;
  // s(t) = (X(t)-E0)·u  in [0, L];  q(t) = (X(t)-E0)·v  in [-r, r]
  const s0 = (p0n.x - e0n.x) * nx + (p0n.y - e0n.y) * ny;
  const s1 = (p1n.x - e0n.x) * nx + (p1n.y - e0n.y) * ny;
  const q0 = -(p0n.x - e0n.x) * ny + (p0n.y - e0n.y) * nx;
  const q1 = -(p1n.x - e0n.x) * ny + (p1n.y - e0n.y) * nx;
  // Each condition is linear in t: value(t) = v0 + t*(v1-v0). Clip [0,1].
  let lo = 0;
  let hi = 1;
  const clipLinear = (v0, v1, min, max) => {
    const dv = v1 - v0;
    const valueTolerance = relativeTolerance(v0, v1, min, max);
    if (dv === 0) {
      return v0 >= min - valueTolerance && v0 <= max + valueTolerance;
    }
    let tA = (min - valueTolerance - v0) / dv;
    let tB = (max + valueTolerance - v0) / dv;
    if (tA > tB) { const tmp = tA; tA = tB; tB = tmp; }
    if (tA > lo) lo = tA;
    if (tB < hi) hi = tB;
    return lo <= hi + PARAM_EPS;
  };
  if (!clipLinear(s0, s1, 0, L)) return null;
  if (!clipLinear(q0, q1, -rn, rn)) return null;
  if (hi < lo - PARAM_EPS) return null;
  return [Math.max(0, lo), Math.min(1, hi)];
}

/**
 * Erased t-intervals (merged) of ink segment P0->P1 against a capsule
 * (swept circle) E0->E1 of radius r. Exact — union of end circles + body.
 */
export function segmentCapsuleIntervals(p0, p1, e0, e1, r) {
  const parts = [];
  const c0 = segmentCircleInterval(p0, p1, e0, r);
  if (c0) parts.push(c0);
  const c1 = segmentCircleInterval(p0, p1, e1, r);
  if (c1) parts.push(c1);
  const body = segmentRectInterval(p0, p1, e0, e1, r);
  if (body) parts.push(body);
  return parts.length ? mergeIntervals(parts) : [];
}

// ---------------------------------------------------------------------------
// Path parsing (absolute M/L/Q/C/Z) into typed segments with exact re-emit
// ---------------------------------------------------------------------------

/**
 * Parse fabric path commands into subpaths of typed segments.
 * Each segment: { kind:'L'|'Q'|'C', p0, p1, c?  (Q control), c1?, c2? (C controls) }.
 * Z closes with an L back to the subpath start.
 *
 * parseInkPath.lastUnsafe is set true when the data contains anything this
 * parser cannot faithfully re-emit (unsupported/relative ops, drawing after
 * Z without a fresh M) — callers must then leave the path UNTOUCHED rather
 * than silently dropping geometry.
 */
export function parseInkPath(pathData) {
  parseInkPath.lastUnsafe = false;
  const subpaths = [];
  let segs = null;
  let cur = null;
  let start = null;
  const flush = () => {
    if (segs && segs.length) subpaths.push(segs);
    segs = null;
  };
  for (const cmd of pathData || []) {
    const op = cmd[0];
    if (op === 'M') {
      flush();
      cur = { x: cmd[1], y: cmd[2] };
      start = cur;
      segs = [];
    } else if (!segs || !cur) {
      // drawing command without a current subpath (before any M, or after Z)
      // — we cannot re-emit this faithfully.
      parseInkPath.lastUnsafe = true;
      continue;
    } else if (op === 'L') {
      const p1 = { x: cmd[1], y: cmd[2] };
      segs.push({ kind: 'L', p0: cur, p1 });
      cur = p1;
    } else if (op === 'Q') {
      const c = { x: cmd[1], y: cmd[2] };
      const p1 = { x: cmd[3], y: cmd[4] };
      segs.push({ kind: 'Q', p0: cur, c, p1 });
      cur = p1;
    } else if (op === 'C') {
      const c1 = { x: cmd[1], y: cmd[2] };
      const c2 = { x: cmd[3], y: cmd[4] };
      const p1 = { x: cmd[5], y: cmd[6] };
      segs.push({ kind: 'C', p0: cur, c1, c2, p1 });
      cur = p1;
    } else if (op === 'Z') {
      if (start && (cur.x !== start.x || cur.y !== start.y)) {
        segs.push({ kind: 'L', p0: cur, p1: start });
      }
      cur = start; // SVG: current point returns to subpath start after Z
      flush();
    } else {
      // relative/H/V/S/T/A — outside this parser's contract; flag so the
      // caller leaves the path untouched instead of dropping segments.
      parseInkPath.lastUnsafe = true;
    }
  }
  flush();
  return subpaths;
}

/** Point on a segment at parameter t. */
export function segPoint(seg, t) {
  const mt = 1 - t;
  if (seg.kind === 'L') {
    return lerpPoint(seg.p0, seg.p1, t);
  }
  if (seg.kind === 'Q') {
    const direct = {
      x: mt * mt * seg.p0.x + 2 * mt * t * seg.c.x + t * t * seg.p1.x,
      y: mt * mt * seg.p0.y + 2 * mt * t * seg.c.y + t * t * seg.p1.y,
    };
    if (Number.isFinite(direct.x) && Number.isFinite(direct.y)) return direct;
    return lerpPoint(
      lerpPoint(seg.p0, seg.c, t),
      lerpPoint(seg.c, seg.p1, t),
      t,
    );
  }
  const mt2 = mt * mt;
  const direct = {
    x: mt2 * mt * seg.p0.x + 3 * mt2 * t * seg.c1.x + 3 * mt * t * t * seg.c2.x + t * t * t * seg.p1.x,
    y: mt2 * mt * seg.p0.y + 3 * mt2 * t * seg.c1.y + 3 * mt * t * t * seg.c2.y + t * t * t * seg.p1.y,
  };
  if (Number.isFinite(direct.x) && Number.isFinite(direct.y)) return direct;
  const p01 = lerpPoint(seg.p0, seg.c1, t);
  const p12 = lerpPoint(seg.c1, seg.c2, t);
  const p23 = lerpPoint(seg.c2, seg.p1, t);
  return lerpPoint(
    lerpPoint(p01, p12, t),
    lerpPoint(p12, p23, t),
    t,
  );
}

/** Exact De Casteljau sub-curve of seg over [t0,t1] — same kind out. */
export function subSegment(seg, t0, t1) {
  if (seg.kind === 'L') {
    return { kind: 'L', p0: segPoint(seg, t0), p1: segPoint(seg, t1) };
  }
  if (seg.kind === 'Q') {
    const lerp = lerpPoint;
    // De Casteljau right piece of [p0,c,p1] at t0: [B(t0), lerp(c,p1,t0), p1]
    const right = { kind: 'Q', p0: segPoint(seg, t0), c: lerp(seg.c, seg.p1, t0), p1: seg.p1 };
    const denom = 1 - t0;
    const u = denom === 0 ? 1 : (t1 - t0) / denom;
    if (u >= 1) return right;
    // Left piece of `right` at u: [p0, lerp(p0,c,u), B_right(u)]
    return { kind: 'Q', p0: right.p0, c: lerp(right.p0, right.c, u), p1: segPoint(right, u) };
  }
  // Cubic: two-stage De Casteljau (right split at t0, then left split at u).
  const lerp = lerpPoint;
  const splitRight = (s, t) => {
    const p01 = lerp(s.p0, s.c1, t);
    const p12 = lerp(s.c1, s.c2, t);
    const p23 = lerp(s.c2, s.p1, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    const p = lerp(p012, p123, t);
    return { kind: 'C', p0: p, c1: p123, c2: p23, p1: s.p1 };
  };
  const splitLeft = (s, t) => {
    const p01 = lerp(s.p0, s.c1, t);
    const p12 = lerp(s.c1, s.c2, t);
    const p23 = lerp(s.c2, s.p1, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    const p = lerp(p012, p123, t);
    void p23;
    return { kind: 'C', p0: s.p0, c1: p01, c2: p012, p1: p };
  };
  const right = splitRight(seg, t0);
  const u = (t1 - t0) / (1 - t0 || 1);
  return u >= 1 ? right : splitLeft(right, u);
}

const segmentControlPoints = (seg) => (
  seg.kind === 'Q'
    ? [seg.p0, seg.c, seg.p1]
    : seg.kind === 'C'
      ? [seg.p0, seg.c1, seg.c2, seg.p1]
      : [seg.p0, seg.p1]
);

const splitSegmentHalf = (seg) => {
  const midpoint = (a, b) => lerpPoint(a, b, 0.5);
  if (seg.kind === 'Q') {
    const p01 = midpoint(seg.p0, seg.c);
    const p12 = midpoint(seg.c, seg.p1);
    const split = midpoint(p01, p12);
    return [
      { kind: 'Q', p0: seg.p0, c: p01, p1: split },
      { kind: 'Q', p0: split, c: p12, p1: seg.p1 },
    ];
  }
  const p01 = midpoint(seg.p0, seg.c1);
  const p12 = midpoint(seg.c1, seg.c2);
  const p23 = midpoint(seg.c2, seg.p1);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const split = midpoint(p012, p123);
  return [
    { kind: 'C', p0: seg.p0, c1: p01, c2: p012, p1: split },
    { kind: 'C', p0: split, c1: p123, c2: p23, p1: seg.p1 },
  ];
};

const pointLineDistance = (point, p0, p1) => {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const px = point.x - p0.x;
  const py = point.y - p0.y;
  const scale = finiteCoordinateScale(dx, dy, px, py);
  const ndx = dx / scale;
  const ndy = dy / scale;
  const npx = px / scale;
  const npy = py / scale;
  const chordLength = Math.hypot(ndx, ndy);
  if (chordLength === 0) return Math.hypot(npx, npy) * scale;
  return (Math.abs(npx * ndy - npy * ndx) / chordLength) * scale;
};

const segmentFlatness = (seg) => {
  if (seg.kind === 'L') return 0;
  const controls = seg.kind === 'Q' ? [seg.c] : [seg.c1, seg.c2];
  return Math.max(...controls.map((point) => pointLineDistance(point, seg.p0, seg.p1)));
};

/**
 * Flatten one segment to chords for callers that need a complete polyline.
 * Subdivision is driven by geometric flatness, not a fixed chord-count cap.
 */
export function flattenSegment(seg, tolerance = 0.25) {
  if (seg.kind === 'L') {
    return [{ p0: seg.p0, p1: seg.p1, tA: 0, tB: 1 }];
  }
  const safeTolerance = Number.isFinite(tolerance) && tolerance > 0
    ? tolerance
    : Number.MIN_VALUE;
  const chords = [];
  const visit = (piece, tA, tB, depth) => {
    if (depth >= MAX_FLATTEN_DEPTH || segmentFlatness(piece) <= safeTolerance) {
      chords.push({ p0: piece.p0, p1: piece.p1, tA, tB });
      return;
    }
    const [left, right] = splitSegmentHalf(piece);
    const tMid = tA + (tB - tA) * 0.5;
    visit(left, tA, tMid, depth + 1);
    visit(right, tMid, tB, depth + 1);
  };
  visit(seg, 0, 1, 0);
  return chords;
}

const segmentTangent = (seg, t) => {
  let dx;
  let dy;
  if (seg.kind === 'L') {
    dx = seg.p1.x - seg.p0.x;
    dy = seg.p1.y - seg.p0.y;
  } else if (seg.kind === 'Q') {
    dx = 2 * (
      (1 - t) * (seg.c.x - seg.p0.x)
      + t * (seg.p1.x - seg.c.x)
    );
    dy = 2 * (
      (1 - t) * (seg.c.y - seg.p0.y)
      + t * (seg.p1.y - seg.c.y)
    );
  } else {
    const mt = 1 - t;
    dx = 3 * (
      mt * mt * (seg.c1.x - seg.p0.x)
      + 2 * mt * t * (seg.c2.x - seg.c1.x)
      + t * t * (seg.p1.x - seg.c2.x)
    );
    dy = 3 * (
      mt * mt * (seg.c1.y - seg.p0.y)
      + 2 * mt * t * (seg.c2.y - seg.c1.y)
      + t * t * (seg.p1.y - seg.c2.y)
    );
  }
  const length = Math.hypot(dx, dy);
  return length > 0 && Number.isFinite(length)
    ? { ux: dx / length, uy: dy / length }
    : { ux: 1, uy: 0 };
};

const zeroDashSegment = (point, tangent, lineCap) => {
  if (lineCap === 'butt') return null;
  if (lineCap !== 'square') {
    return { kind: 'L', p0: { ...point }, p1: { ...point } };
  }
  // A materialized zero-length square dash still needs its path tangent.
  // Encode the smallest representable directed segment so SVG/Canvas retain
  // the authored cap orientation after the dash attributes are cleared.
  const coordinateScale = Math.max(1, Math.abs(point.x), Math.abs(point.y));
  const epsilon = coordinateScale * Number.EPSILON * 8;
  let p1 = {
    x: point.x + tangent.ux * epsilon,
    y: point.y + tangent.uy * epsilon,
  };
  if (p1.x === point.x && p1.y === point.y) {
    p1 = {
      x: point.x - tangent.ux * epsilon,
      y: point.y - tangent.uy * epsilon,
    };
  }
  return { kind: 'L', p0: { ...point }, p1 };
};

/**
 * Expand a dashed M/L/Q/C path into explicit painted subpaths.
 *
 * Dash placement uses an adaptive arc-length map, while each visible curve
 * piece is emitted with exact De Casteljau sub-segments. The authored carrier
 * remains untouched. Callers clear dash attributes only after a real edit;
 * otherwise the original object/path stays byte-identical.
 */
export function materializeDashedInkPath(pathData, {
  dashArray,
  dashOffset = 0,
  lineCap = 'round',
  tolerance = null,
} = {}) {
  let pattern = (dashArray || [])
    .map((value) => Math.max(0, Number(value) || 0));
  if (!pattern.length || pattern.every((value) => value === 0)) {
    return { pathData, materialized: false };
  }
  if (pattern.length % 2 === 1) pattern = [...pattern, ...pattern];
  const total = pattern.reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    return { pathData, materialized: false };
  }

  const parsed = parseInkPath(pathData);
  if (parseInkPath.lastUnsafe) return { pathData, materialized: false };
  const positiveEntries = pattern.filter((value) => value > 0);
  const minimumPositive = Math.min(...positiveEntries);
  const flattenTolerance = Math.max(
    Number.MIN_VALUE,
    Math.min(
      Number.isFinite(tolerance) && tolerance > 0 ? tolerance : Infinity,
      minimumPositive * 1e-5,
    ),
  );
  const paintedSubpaths = [];

  for (const segments of parsed) {
    let phase = ((Number(dashOffset) || 0) % total + total) % total;
    let patternIndex = 0;
    let remaining = pattern[0];
    let phaseGuard = 0;
    while (phase > 0 && phaseGuard < pattern.length * 2) {
      const entryLength = pattern[patternIndex];
      if (entryLength > 0 && phase < entryLength) {
        remaining = entryLength - phase;
        phase = 0;
        break;
      }
      if (entryLength > 0) phase -= entryLength;
      patternIndex = (patternIndex + 1) % pattern.length;
      remaining = pattern[patternIndex];
      phaseGuard += 1;
    }

    let currentRun = [];
    let continuityBroken = true;
    const flushRun = () => {
      if (currentRun.length) paintedSubpaths.push(currentRun);
      currentRun = [];
    };
    const appendPiece = (piece) => {
      if (continuityBroken) flushRun();
      currentRun.push(piece);
      continuityBroken = false;
    };
    const emitCompletedZeroEntries = (point, tangent) => {
      let guard = 0;
      while (remaining === 0 && guard < pattern.length) {
        if (patternIndex % 2 === 0 && pattern[patternIndex] === 0) {
          flushRun();
          const dot = zeroDashSegment(point, tangent, lineCap);
          if (dot) paintedSubpaths.push([dot]);
          continuityBroken = true;
        }
        patternIndex = (patternIndex + 1) % pattern.length;
        remaining = pattern[patternIndex];
        if (patternIndex % 2 === 1) continuityBroken = true;
        guard += 1;
      }
    };

    for (const segment of segments) {
      const chords = flattenSegment(segment, flattenTolerance);
      for (const chord of chords) {
        const dx = chord.p1.x - chord.p0.x;
        const dy = chord.p1.y - chord.p0.y;
        const chordLength = Math.hypot(dx, dy);
        if (!(chordLength > 0) || !Number.isFinite(chordLength)) continue;
        let consumed = 0;
        emitCompletedZeroEntries(
          chord.p0,
          segmentTangent(segment, chord.tA),
        );
        while (consumed < chordLength) {
          const step = Math.min(remaining, chordLength - consumed);
          if (!(step > 0)) break;
          const startFraction = consumed / chordLength;
          const endFraction = (consumed + step) / chordLength;
          const t0 = chord.tA + (chord.tB - chord.tA) * startFraction;
          const t1 = chord.tA + (chord.tB - chord.tA) * endFraction;
          if (patternIndex % 2 === 0) {
            appendPiece(subSegment(segment, t0, t1));
          } else {
            continuityBroken = true;
          }
          consumed += step;
          remaining = step === remaining ? 0 : remaining - step;
          emitCompletedZeroEntries(
            segPoint(segment, t1),
            segmentTangent(segment, t1),
          );
        }
      }
    }
    flushRun();
  }

  return {
    pathData: subpathsToPathData(paintedSubpaths),
    materialized: true,
  };
}

const pointInCapsule = (point, e0, e1, r) => {
  const scale = finiteCoordinateScale(point.x, point.y, e0.x, e0.y, e1.x, e1.y, r);
  const pn = normalizedPoint(point, scale);
  const e0n = normalizedPoint(e0, scale);
  const e1n = normalizedPoint(e1, scale);
  const rn = r / scale;
  const ux = e1n.x - e0n.x;
  const uy = e1n.y - e0n.y;
  const lengthSquared = ux * ux + uy * uy;
  let closestX = e0n.x;
  let closestY = e0n.y;
  if (lengthSquared > 0) {
    const projection = (
      (pn.x - e0n.x) * ux + (pn.y - e0n.y) * uy
    ) / lengthSquared;
    const t = Math.max(0, Math.min(1, projection));
    closestX += ux * t;
    closestY += uy * t;
  }
  const distance = Math.hypot(pn.x - closestX, pn.y - closestY);
  return distance <= rn + relativeTolerance(distance, rn);
};

const crossProduct = (a, b, c) => (
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
);

const convexHull = (points) => {
  const sorted = points
    .map((point) => ({ x: point.x, y: point.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((point, index, all) => (
      index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y
    ));
  if (sorted.length <= 2) return sorted;
  const half = (input) => {
    const output = [];
    for (const point of input) {
      while (
        output.length >= 2
        && crossProduct(output[output.length - 2], output[output.length - 1], point) <= 0
      ) {
        output.pop();
      }
      output.push(point);
    }
    return output;
  };
  const lower = half(sorted);
  const upper = half(sorted.slice().reverse());
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

const pointSegmentDistance = (point, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(
    1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
  ));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
};

const orientation = (a, b, c) => {
  const first = (b.x - a.x) * (c.y - a.y);
  const second = (b.y - a.y) * (c.x - a.x);
  return {
    value: first - second,
    tolerance: relativeTolerance(first, second),
  };
};

const pointOnSegment = (point, a, b) => {
  const { value, tolerance } = orientation(a, b, point);
  if (Math.abs(value) > tolerance) return false;
  const coordinateTolerance = relativeTolerance(point.x, point.y, a.x, a.y, b.x, b.y);
  return (
    point.x >= Math.min(a.x, b.x) - coordinateTolerance
    && point.x <= Math.max(a.x, b.x) + coordinateTolerance
    && point.y >= Math.min(a.y, b.y) - coordinateTolerance
    && point.y <= Math.max(a.y, b.y) + coordinateTolerance
  );
};

const segmentsIntersect = (a0, a1, b0, b1) => {
  const oa0 = orientation(a0, a1, b0);
  const oa1 = orientation(a0, a1, b1);
  const ob0 = orientation(b0, b1, a0);
  const ob1 = orientation(b0, b1, a1);
  const oppositeA = (
    (oa0.value > oa0.tolerance && oa1.value < -oa1.tolerance)
    || (oa0.value < -oa0.tolerance && oa1.value > oa1.tolerance)
  );
  const oppositeB = (
    (ob0.value > ob0.tolerance && ob1.value < -ob1.tolerance)
    || (ob0.value < -ob0.tolerance && ob1.value > ob1.tolerance)
  );
  if (oppositeA && oppositeB) return true;
  return (
    pointOnSegment(b0, a0, a1)
    || pointOnSegment(b1, a0, a1)
    || pointOnSegment(a0, b0, b1)
    || pointOnSegment(a1, b0, b1)
  );
};

const pointInConvexHull = (point, hull) => {
  if (hull.length === 0) return false;
  if (hull.length === 1) {
    return point.x === hull[0].x && point.y === hull[0].y;
  }
  if (hull.length === 2) return pointOnSegment(point, hull[0], hull[1]);
  let sign = 0;
  for (let index = 0; index < hull.length; index += 1) {
    const a = hull[index];
    const b = hull[(index + 1) % hull.length];
    const { value, tolerance } = orientation(a, b, point);
    if (Math.abs(value) <= tolerance) continue;
    const nextSign = Math.sign(value);
    if (sign && nextSign !== sign) return false;
    sign = nextSign;
  }
  return true;
};

const segmentToConvexHullDistance = (a, b, hull) => {
  if (!hull.length) return Infinity;
  if (hull.length === 1) return pointSegmentDistance(hull[0], a, b);
  if (pointInConvexHull(a, hull) || pointInConvexHull(b, hull)) return 0;
  let distance = Infinity;
  const edgeCount = hull.length === 2 ? 1 : hull.length;
  for (let index = 0; index < edgeCount; index += 1) {
    const edgeA = hull[index];
    const edgeB = hull[(index + 1) % hull.length];
    if (segmentsIntersect(a, b, edgeA, edgeB)) return 0;
    distance = Math.min(
      distance,
      pointSegmentDistance(a, edgeA, edgeB),
      pointSegmentDistance(b, edgeA, edgeB),
      pointSegmentDistance(edgeA, a, b),
      pointSegmentDistance(edgeB, a, b),
    );
  }
  return distance;
};

const controlHullMayReachCapsule = (seg, e0, e1, r) => {
  const points = segmentControlPoints(seg);
  const scale = finiteCoordinateScale(
    ...points.flatMap((point) => [point.x, point.y]),
    e0.x, e0.y, e1.x, e1.y,
    r,
  );
  const normalized = points.map((point) => normalizedPoint(point, scale));
  const e0n = normalizedPoint(e0, scale);
  const e1n = normalizedPoint(e1, scale);
  const rn = r / scale;
  const minX = Math.min(...normalized.map((point) => point.x));
  const maxX = Math.max(...normalized.map((point) => point.x));
  const minY = Math.min(...normalized.map((point) => point.y));
  const maxY = Math.max(...normalized.map((point) => point.y));
  const capsuleMinX = Math.min(e0n.x, e1n.x) - rn;
  const capsuleMaxX = Math.max(e0n.x, e1n.x) + rn;
  const capsuleMinY = Math.min(e0n.y, e1n.y) - rn;
  const capsuleMaxY = Math.max(e0n.y, e1n.y) + rn;
  const tolerance = relativeTolerance(
    minX, maxX, minY, maxY,
    capsuleMinX, capsuleMaxX, capsuleMinY, capsuleMaxY,
  );
  if (!(
    maxX >= capsuleMinX - tolerance
    && minX <= capsuleMaxX + tolerance
    && maxY >= capsuleMinY - tolerance
    && minY <= capsuleMaxY + tolerance
  )) return false;

  const hull = convexHull(normalized);
  const centerlineDistance = segmentToConvexHullDistance(e0n, e1n, hull);
  return centerlineDistance <= rn + relativeTolerance(centerlineDistance, rn);
};

/**
 * Find curve/capsule hit intervals without flattening the entire curve at an
 * arbitrary global resolution. Convex-hull pruning follows only branches the
 * capsule can reach; accepted survivors are still split from the authored
 * Q/C with exact De Casteljau geometry.
 */
const curveCapsuleIntervals = (seg, e0, e1, r) => {
  const intervals = [];

  const visit = (piece, tA, tB, depth) => {
    if (!controlHullMayReachCapsule(piece, e0, e1, r)) return;

    const controls = segmentControlPoints(piece);
    if (controls.every((point) => pointInCapsule(point, e0, e1, r))) {
      intervals.push([tA, tB]);
      return;
    }

    if (depth >= MAX_CURVE_DEPTH) {
      const midpoint = segPoint(piece, 0.5);
      // At machine-precision depth, accept only an evaluated point on the
      // authored curve. All nonzero interior spans are accepted earlier only
      // when their entire Bezier control hull is inside the convex capsule.
      if (pointInCapsule(midpoint, e0, e1, r)) {
        const tMid = tA + (tB - tA) * 0.5;
        intervals.push([tMid, tMid]);
      }
      return;
    }

    const [left, right] = splitSegmentHalf(piece);
    const tMid = tA + (tB - tA) * 0.5;
    visit(left, tA, tMid, depth + 1);
    visit(right, tMid, tB, depth + 1);
  };

  visit(seg, 0, 1, 0);
  return mergeIntervals(intervals);
};

/** Approximate length of a segment (for the crumb filter). */
function segLength(seg) {
  if (seg.kind === 'L') return Math.hypot(seg.p1.x - seg.p0.x, seg.p1.y - seg.p0.y);
  let len = 0;
  let prev = seg.p0;
  for (let i = 1; i <= 8; i += 1) {
    const p = segPoint(seg, i / 8);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

// ---------------------------------------------------------------------------
// The eraser: capsules -> per-segment erased intervals -> rebuilt path
// ---------------------------------------------------------------------------

/**
 * Erase capsules from parsed subpaths. Mutates nothing; returns
 * { subpaths, changed } where subpaths is the parsed representation with
 * per-segment erased intervals APPLIED (segments replaced by kept
 * sub-segments, subpaths split at gaps).
 *
 * @param {Array} subpaths - parseInkPath output
 * @param {Array<{a:{x,y}, b:{x,y}}>} capsules - swept-circle steps, path space
 * @param {number} rEff - eraser radius + strokeWidth/2, path space
 * @param {number} minPieceLen - drop kept pieces shorter than this
 */
export function eraseSubpaths(subpaths, capsules, rEff, minPieceLen = 0.75) {
  let changed = false;
  const outSubpaths = [];
  for (const segs of subpaths) {
    // Pre-scan: erased intervals per segment. A subpath NO capsule touches
    // passes through VERBATIM — the crumb filter must never delete a tiny
    // untouched dot subpath, and an untouched subpath must never set
    // `changed` (phantom edits).
    const perSegErased = segs.map((seg) => {
      const erased = [];
      for (const cap of capsules) {
        if (seg.kind === 'L') {
          const ivs = segmentCapsuleIntervals(seg.p0, seg.p1, cap.a, cap.b, rEff);
          for (const iv of ivs) erased.push(iv);
        } else {
          erased.push(...curveCapsuleIntervals(seg, cap.a, cap.b, rEff));
        }
      }
      return erased;
    });
    if (perSegErased.every((e) => e.length === 0)) {
      outSubpaths.push(segs);
      continue;
    }
    let current = []; // growing run of kept segments
    const flushRun = () => {
      if (!current.length) return;
      const total = current.reduce((s, g) => s + segLength(g), 0);
      if (total >= minPieceLen) outSubpaths.push(current);
      else changed = true; // crumb dropped (cut-adjacent by construction)
      current = [];
    };
    for (let si = 0; si < segs.length; si += 1) {
      const seg = segs[si];
      const erased = perSegErased[si];
      if (!erased.length) {
        current.push(seg);
        continue;
      }
      changed = true;
      const kept = keptRuns(mergeIntervals(erased));
      if (!kept.length) {
        flushRun(); // whole segment gone -> gap
        continue;
      }
      kept.forEach(([a, b], i) => {
        // A gap precedes this piece (interior gaps always; a leading gap when
        // the first kept run starts past 0) -> the current run ends here.
        if (i > 0 || a > parameterTolerance(a, 0)) flushRun();
        current.push(subSegment(seg, a, b));
      });
      // Trailing gap: the next segment starts a fresh run.
      const lastKeptEnd = kept[kept.length - 1][1];
      if (lastKeptEnd < 1 - parameterTolerance(lastKeptEnd, 1)) flushRun();
    }
    flushRun();
  }
  return { subpaths: outSubpaths, changed };
}

/** Serialize parsed subpaths back to fabric path commands. */
export function subpathsToPathData(subpaths) {
  const out = [];
  for (const segs of subpaths) {
    if (!segs.length) continue;
    out.push(['M', segs[0].p0.x, segs[0].p0.y]);
    for (const seg of segs) {
      if (seg.kind === 'L') out.push(['L', seg.p1.x, seg.p1.y]);
      else if (seg.kind === 'Q') out.push(['Q', seg.c.x, seg.c.y, seg.p1.x, seg.p1.y]);
      else out.push(['C', seg.c1.x, seg.c1.y, seg.c2.x, seg.c2.y, seg.p1.x, seg.p1.y]);
    }
  }
  return out;
}

/**
 * One-shot convenience: erase capsules from fabric path data.
 * Returns { pathData, changed } — pathData [] means fully erased.
 */
export function erasePathWithCapsules(pathData, capsules, rEff, minPieceLen = 0.75) {
  const parsed = parseInkPath(pathData);
  if (parseInkPath.lastUnsafe) {
    // Data outside the parser's contract: NEVER risk silent geometry loss.
    return { pathData, changed: false };
  }
  const { subpaths, changed } = eraseSubpaths(parsed, capsules, rEff, minPieceLen);
  if (!changed) return { pathData, changed: false };
  return { pathData: subpathsToPathData(subpaths), changed: true };
}
