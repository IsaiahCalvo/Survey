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

const EPS = 1e-9;
const TANGENT_EPS = 1e-6; // treat exact rim tangency as touching
const MERGE_EPS = 1e-4;   // parameter-space interval merge tolerance

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
    if (cur[0] <= last[1] + MERGE_EPS) {
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
    if (a > cursor + MERGE_EPS) runs.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < 1 - MERGE_EPS) runs.push([cursor, 1]);
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
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const fx = p0.x - c.x;
  const fy = p0.y - c.y;
  const a = dx * dx + dy * dy;
  if (a < EPS) {
    // Degenerate point segment: erased iff within r.
    return (fx * fx + fy * fy) <= r * r + TANGENT_EPS ? [0, 1] : null;
  }
  const b = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < -TANGENT_EPS) return null;
  const sq = Math.sqrt(Math.max(0, disc));
  let t0 = (-b - sq) / (2 * a);
  let t1 = (-b + sq) / (2 * a);
  if (t1 < 0 || t0 > 1) return null;
  t0 = Math.max(0, t0);
  t1 = Math.min(1, t1);
  return t1 > t0 - MERGE_EPS ? [t0, t1] : null;
}

/**
 * Erased t-interval of ink segment P0->P1 against the ORIENTED RECT part of
 * the capsule E0->E1 with half-width r. Returns [t0,t1] or null.
 */
function segmentRectInterval(p0, p1, e0, e1, r) {
  const ux = e1.x - e0.x;
  const uy = e1.y - e0.y;
  const L = Math.hypot(ux, uy);
  if (L < EPS) return null; // no body — the two end circles cover it
  const nx = ux / L;
  const ny = uy / L;
  // s(t) = (X(t)-E0)·u  in [0, L];  q(t) = (X(t)-E0)·v  in [-r, r]
  const s0 = (p0.x - e0.x) * nx + (p0.y - e0.y) * ny;
  const s1 = (p1.x - e0.x) * nx + (p1.y - e0.y) * ny;
  const q0 = -(p0.x - e0.x) * ny + (p0.y - e0.y) * nx;
  const q1 = -(p1.x - e0.x) * ny + (p1.y - e0.y) * nx;
  // Each condition is linear in t: value(t) = v0 + t*(v1-v0). Clip [0,1].
  let lo = 0;
  let hi = 1;
  const clipLinear = (v0, v1, min, max) => {
    const dv = v1 - v0;
    if (Math.abs(dv) < EPS) {
      return v0 >= min - TANGENT_EPS && v0 <= max + TANGENT_EPS;
    }
    let tA = (min - v0) / dv;
    let tB = (max - v0) / dv;
    if (tA > tB) { const tmp = tA; tA = tB; tB = tmp; }
    if (tA > lo) lo = tA;
    if (tB < hi) hi = tB;
    return lo <= hi + MERGE_EPS;
  };
  if (!clipLinear(s0, s1, 0, L)) return null;
  if (!clipLinear(q0, q1, -r, r)) return null;
  if (hi <= lo - MERGE_EPS) return null;
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
      if (start && (Math.abs(cur.x - start.x) > EPS || Math.abs(cur.y - start.y) > EPS)) {
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
    return { x: seg.p0.x + t * (seg.p1.x - seg.p0.x), y: seg.p0.y + t * (seg.p1.y - seg.p0.y) };
  }
  if (seg.kind === 'Q') {
    return {
      x: mt * mt * seg.p0.x + 2 * mt * t * seg.c.x + t * t * seg.p1.x,
      y: mt * mt * seg.p0.y + 2 * mt * t * seg.c.y + t * t * seg.p1.y,
    };
  }
  const mt2 = mt * mt;
  return {
    x: mt2 * mt * seg.p0.x + 3 * mt2 * t * seg.c1.x + 3 * mt * t * t * seg.c2.x + t * t * t * seg.p1.x,
    y: mt2 * mt * seg.p0.y + 3 * mt2 * t * seg.c1.y + 3 * mt * t * t * seg.c2.y + t * t * t * seg.p1.y,
  };
}

/** Exact De Casteljau sub-curve of seg over [t0,t1] — same kind out. */
export function subSegment(seg, t0, t1) {
  if (seg.kind === 'L') {
    return { kind: 'L', p0: segPoint(seg, t0), p1: segPoint(seg, t1) };
  }
  if (seg.kind === 'Q') {
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    // De Casteljau right piece of [p0,c,p1] at t0: [B(t0), lerp(c,p1,t0), p1]
    const right = { kind: 'Q', p0: segPoint(seg, t0), c: lerp(seg.c, seg.p1, t0), p1: seg.p1 };
    const denom = 1 - t0;
    const u = denom < EPS ? 1 : (t1 - t0) / denom;
    if (u >= 1 - EPS) return right;
    // Left piece of `right` at u: [p0, lerp(p0,c,u), B_right(u)]
    return { kind: 'Q', p0: right.p0, c: lerp(right.p0, right.c, u), p1: segPoint(right, u) };
  }
  // Cubic: two-stage De Casteljau (right split at t0, then left split at u).
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
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
  return u >= 1 - EPS ? right : splitLeft(right, u);
}

/**
 * Flatten one segment to chords for interval-finding, each chord carrying its
 * source parameter range. L segments are a single chord.
 */
export function flattenSegment(seg, tolerance = 0.25) {
  if (seg.kind === 'L') {
    return [{ p0: seg.p0, p1: seg.p1, tA: 0, tB: 1 }];
  }
  // Adaptive subdivision: enough steps that chord error < tolerance.
  // Chord-length heuristic (same spirit as geometryEraser's carve flattening).
  const approxLen = seg.kind === 'Q'
    ? Math.hypot(seg.c.x - seg.p0.x, seg.c.y - seg.p0.y) + Math.hypot(seg.p1.x - seg.c.x, seg.p1.y - seg.c.y)
    : Math.hypot(seg.c1.x - seg.p0.x, seg.c1.y - seg.p0.y)
      + Math.hypot(seg.c2.x - seg.c1.x, seg.c2.y - seg.c1.y)
      + Math.hypot(seg.p1.x - seg.c2.x, seg.p1.y - seg.c2.y);
  const steps = Math.max(2, Math.min(64, Math.ceil(approxLen / Math.max(0.5, tolerance * 8))));
  const chords = [];
  let prev = seg.p0;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const p = segPoint(seg, t);
    chords.push({ p0: prev, p1: p, tA: (i - 1) / steps, tB: t });
    prev = p;
  }
  return chords;
}

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
      const chords = seg.kind === 'L' ? null : flattenSegment(seg);
      for (const cap of capsules) {
        if (seg.kind === 'L') {
          const ivs = segmentCapsuleIntervals(seg.p0, seg.p1, cap.a, cap.b, rEff);
          for (const iv of ivs) erased.push(iv);
        } else {
          for (const ch of chords) {
            const ivs = segmentCapsuleIntervals(ch.p0, ch.p1, cap.a, cap.b, rEff);
            for (const iv of ivs) {
              // map chord-local t back to curve parameter
              erased.push([
                ch.tA + iv[0] * (ch.tB - ch.tA),
                ch.tA + iv[1] * (ch.tB - ch.tA),
              ]);
            }
          }
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
        if (i > 0 || a > MERGE_EPS) flushRun();
        current.push(subSegment(seg, a, b));
      });
      // Trailing gap: the next segment starts a fresh run.
      if (kept[kept.length - 1][1] < 1 - MERGE_EPS) flushRun();
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

