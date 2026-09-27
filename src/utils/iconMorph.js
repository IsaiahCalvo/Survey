/**
 * Morphing tool icons (w49, 2026-09-27).
 *
 * RULED 2026-09-27 owner: morphing icons + one motion language. Owner: when
 * switching between tool groups, the loadout slots should MORPH icon-to-icon
 * in place — slot 1 is pen (Draw) / rectangle (Shapes) / text box (Text) /
 * Box (Select), slot 2 highlighter / ellipse / callout / Lasso, slot 3 eraser
 * / polygon / Text select. Reference: morphicons.com (stroke icons as data,
 * one shared animation frame loop, sharp at rest).
 *
 * How it works (in-house, no dependency — flubber is built for filled rings
 * and would close our open strokes):
 *   1. Each morphable glyph is kept here as DATA: the very path strings its
 *      SVG draws (tests/iconMorph.test.mjs fails if Icons.jsx or an asset SVG
 *      is redrawn without updating this copy), with the glyph's transforms
 *      baked onto the 24-unit box the icon is drawn in.
 *   2. A glyph flattens to a few polylines (one per stroke piece). Two glyphs
 *      with different numbers of pieces are evened up by splitting the longest
 *      pieces in half, so ink flows from piece to piece instead of popping in.
 *   3. Pieces are paired greedily by how far their points would travel, and
 *      each pair's points are put in the order (and, for a closed outline, the
 *      starting point and direction) that travels least.
 *   4. Each frame draws every pair's points part-way between the two glyphs,
 *      stroked at the house weight with round caps and joins. At rest the
 *      REAL icon is shown, so resting icons stay exactly as crisp as before.
 *
 * Only the glyphs that can share a slot with another group's glyph are kept
 * here; anything else (the counter, a line) grows in / shrinks out instead.
 */

export const MORPH_SAMPLES = 40;

// ---------------------------------------------------------------------------
// The glyphs, as data. Strings are verbatim from src/Icons.jsx or the asset
// SVG named beside each (the sync test checks this).
// ---------------------------------------------------------------------------

const rectPath = (x, y, w, h, r) => (
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`
  + `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
);
const circlePath = (cx, cy, r) => `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;

const CURSOR = 'M9.80282 4.62973L15.8364 6.99069C19.3164 8.35243 21.0564 9.03329 20.9987 10.1133C20.941 11.1934 19.1251 11.6886 15.4933 12.6791C14.412 12.974 13.8713 13.1215 13.4964 13.4963C13.1215 13.8712 12.9741 14.4119 12.6791 15.4933C11.6887 19.125 11.1934 20.9409 10.1134 20.9986C9.03335 21.0563 8.35249 19.3163 6.99075 15.8363L4.62979 9.80276C3.20411 6.15934 2.49127 4.33764 3.41448 3.41442C4.3377 2.49121 6.15941 3.20405 9.80282 4.62973Z';

const POLYGON_NODES = [[14.71, 4.92], [5.91, 7.13], [4.77, 16.73], [13.59, 19.08], [19.23, 12.83]];

/**
 * name → { source, transform?, offsetPx?, paths: [{ d, transform?, dash? }] }.
 * `source` names where the strings come from; `offsetPx` is a CSS-pixel
 * nudge the icon's own style adds (textSelect's translateY(2px)).
 */
export const MORPH_ICONS = Object.freeze({
  pen: {
    source: 'src/Icons.jsx',
    transform: 'translate(12 12) scale(0.93) translate(-11.9 -12.2)',
    paths: [
      { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' },
      { d: 'm15 5 4 4' },
    ],
  },
  highlighter: {
    source: 'src/assets/icons/highlighter-tool.svg',
    transform: 'scale(0.1875)', // 128-unit viewBox → 24
    paths: [
      { d: 'M93 16.8 Q94.8 16.8 96.6 18.6 L112.5 34.5 Q116.2 38.2 112.8 42.3 L63.3 102.1 Q60.3 105.7 55.9 103 L52 100.6 Q46 96.9 37 103 L31 110 Q30 110 29.2 109.7 L15.5 102.8 L27 92 Q34 85 29.2 77.2 L27.1 73.9 Q24.5 69.2 29 65.4 L90.1 17.7 Q91.6 16.7 93 16.8Z' },
      { d: 'M40.7 55.5L70.4 90.1' },
      { d: 'M27 92L37 103' },
    ],
  },
  eraser: {
    source: 'src/Icons.jsx',
    // The svg's own style rotate(270deg), then its group's rotate(-45 12 12).
    transform: 'rotate(270 12 12) rotate(-45 12 12)',
    paths: [
      { d: rectPath(7, 4, 10, 16, 1.11), rect: [7, 4, 10, 16, 1.11] },
      { d: 'M7 10L17 10', line: [7, 10, 17, 10] },
    ],
  },
  rect: {
    source: 'src/Icons.jsx',
    paths: [{ d: rectPath(3, 3, 18, 18, 2), rect: [3, 3, 18, 18, 2] }],
  },
  ellipse: {
    source: 'src/Icons.jsx',
    paths: [{ d: circlePath(12, 12, 9.3), circle: [12, 12, 9.3] }],
  },
  polygon: {
    source: 'src/Icons.jsx',
    paths: [
      { d: 'M12.77 5.41 7.85 6.64' },
      { d: 'M5.67 9.12 5.01 14.74' },
      { d: 'M6.7 17.25 11.66 18.57' },
      { d: 'M14.93 17.6 17.89 14.32' },
      { d: 'M18.24 11.09 15.7 6.66' },
      ...POLYGON_NODES.map(([cx, cy]) => ({ d: circlePath(cx, cy, 2), node: [cx, cy] })),
    ],
  },
  textBox: {
    source: 'src/assets/icons/text-box-selection.svg',
    paths: [
      { d: 'M9 9H15' },
      { d: 'M12 15L12 9' },
      { d: 'M6 4C6 5.10457 5.10457 6 4 6C2.89543 6 2 5.10457 2 4C2 2.89543 2.89543 2 4 2C5.10457 2 6 2.89543 6 4Z' },
      { d: 'M6 20C6 21.1046 5.10457 22 4 22C2.89543 22 2 21.1046 2 20C2 18.8954 2.89543 18 4 18C5.10457 18 6 18.8954 6 20Z' },
      { d: 'M22 4C22 5.10457 21.1046 6 20 6C18.8954 6 18 5.10457 18 4C18 2.89543 18.8954 2 20 2C21.1046 2 22 2.89543 22 4Z' },
      { d: 'M22 20C22 21.1046 21.1046 22 20 22C18.8954 22 18 21.1046 18 20C18 18.8954 18.8954 18 20 18C21.1046 18 22 18.8954 22 20Z' },
      { d: 'M6 20H18' },
      { d: 'M18 4H6' },
      { d: 'M20 18L20 6' },
      { d: 'M4 6L4 18' },
    ],
  },
  callout: {
    source: 'src/assets/icons/callout-arrow-outline.svg',
    paths: [
      { d: rectPath(6.75, 2.95, 14.5, 11, 1.22), rect: [6.75, 2.95, 14.5, 11, 1.22] },
      { d: 'M11.9375 6.3875H16.0625' },
      { d: 'M14 6.3875V10.5125' },
      { d: 'M9.6 13.95 2.95 21.05' },
      { d: 'M7.95 20.89 2.95 21.05 2.79 16.05' },
    ],
  },
  selectCursor: {
    source: 'src/assets/icons/selection-cursor-rounded.svg',
    paths: [{ d: CURSOR }],
  },
  lassoSelect: {
    source: 'src/assets/icons/lasso-select-rounded.svg',
    transform: 'translate(12 12) scale(.9828 .9901) translate(-12.1 -12.225)',
    paths: [
      { d: 'M8.75 19.08C5.18 18.65 2.51 17.51 2.5 15.46c-.01-1.7 1.75-2.81 2.45-4.68.45-1.2.38-2.29.58-3.12C6.28 4.52 8.78 2.7 12.3 2.7c4.48 0 7.77 3.64 8.72 9.12', dash: [1.5, 2.1] },
      { d: CURSOR, transform: 'translate(8.1 8.15) scale(.65)' },
    ],
  },
  textSelect: {
    source: 'src/assets/icons/text-select-rounded.svg',
    offsetPx: [0, 2],
    transform: 'translate(12 12.6) scale(1 1.0025) translate(-11.525 -12.65)',
    paths: [
      { d: 'M9 6V18M9 6C9 4.89543 9.89543 4 11 4M9 6C9 4.89543 8.10457 4 7 4M9 18C9 19.1046 9.89543 20 11 20M9 18C9 19.1046 8.10457 20 7 20', transform: 'translate(.55 .2) scale(.75)' },
      { d: 'M12 8H18C19.8856 8 20.8284 8 21.4142 8.58579C22 9.17157 22 10.1144 22 12C22 13.8856 22 14.8284 21.4142 15.4142C20.8284 16 19.8856 16 18 16H12M6 16C4.11438 16 3.17157 16 2.58579 15.4142C2 14.8284 2 13.8856 2 12C2 10.1144 2 9.17157 2.58579 8.58579C3.17157 8 4.11438 8 6 8', transform: 'translate(.55 .2) scale(.75)' },
      { d: CURSOR, transform: 'translate(14.5 15.45) scale(.3)' },
    ],
  },
});

export const isMorphableIcon = (name) => Object.prototype.hasOwnProperty.call(MORPH_ICONS, name || '');

// ---------------------------------------------------------------------------
// Geometry: transforms, path parsing, flattening.
// ---------------------------------------------------------------------------

const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** An SVG transform list (translate / scale / rotate / matrix) as a matrix. */
export function parseTransform(text = '') {
  let m = IDENTITY;
  for (const [, fn, args] of String(text).matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let n = IDENTITY;
    if (fn === 'translate') n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (fn === 'scale') n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (fn === 'rotate') {
      const r = (a[0] * Math.PI) / 180;
      const [c, s] = [Math.cos(r), Math.sin(r)];
      n = [c, s, -s, c, 0, 0];
      if (a.length >= 3) n = multiply(multiply([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (fn === 'matrix') n = a.slice(0, 6);
    m = multiply(m, n);
  }
  return m;
}

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Point on the arc from endpoint parameters (SVG spec F.6.5), as a sampler. */
function arcPoints(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
  if ((x1 === x2 && y1 === y2)) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [[x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const [cp, sp] = [Math.cos(phi), Math.sin(phi)];
  const dx = (x1 - x2) / 2; const dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy; const y1p = -sp * dx + cp * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry; const cyp = (-coef * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2; const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 16)));
  const out = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = t1 + (dt * i) / steps;
    out.push([cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp]);
  }
  out[out.length - 1] = [x2, y2];
  return out;
}

/**
 * Flatten a path `d` into polylines: [{ pts: [[x, y]…], closed }]. Curves are
 * cut finely enough that resampling can not tell them from the real curve at
 * a 16px glyph.
 */
export function flattenPath(d) {
  const tokens = String(d).match(TOKEN) || [];
  const subpaths = [];
  let current = null;
  let [x, y] = [0, 0];
  let [sx, sy] = [0, 0];
  let prevCtrl = null; // [x, y, kind]
  let cmd = null;
  let i = 0;
  const num = () => Number(tokens[i++]);
  const push = (p) => current.pts.push(p);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) break;
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    if (upper === 'Z') {
      if (current) { current.pts.push([sx, sy]); current.closed = true; }
      [x, y] = [sx, sy];
      current = null;
      prevCtrl = null;
      continue;
    }
    if (i + ARGS[upper] > tokens.length) break;
    const ox = rel ? x : 0; const oy = rel ? y : 0;
    if (upper === 'M') {
      x = ox + num(); y = oy + num();
      [sx, sy] = [x, y];
      current = { pts: [[x, y]], closed: false };
      subpaths.push(current);
      cmd = rel ? 'l' : 'L';
      prevCtrl = null;
      continue;
    }
    if (!current) { current = { pts: [[x, y]], closed: false }; subpaths.push(current); [sx, sy] = [x, y]; }
    if (upper === 'L') { x = ox + num(); y = oy + num(); push([x, y]); prevCtrl = null; }
    else if (upper === 'H') { x = (rel ? x : 0) + num(); push([x, y]); prevCtrl = null; }
    else if (upper === 'V') { y = (rel ? y : 0) + num(); push([x, y]); prevCtrl = null; }
    else if (upper === 'C' || upper === 'S') {
      let c1;
      if (upper === 'C') c1 = [ox + num(), oy + num()];
      else c1 = prevCtrl?.[2] === 'C' ? [2 * x - prevCtrl[0], 2 * y - prevCtrl[1]] : [x, y];
      const c2 = [ox + num(), oy + num()];
      const end = [ox + num(), oy + num()];
      for (let k = 1; k <= 16; k += 1) {
        const t = k / 16; const u = 1 - t;
        push([
          u * u * u * x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
          u * u * u * y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
        ]);
      }
      prevCtrl = [c2[0], c2[1], 'C'];
      [x, y] = end;
    } else if (upper === 'Q' || upper === 'T') {
      let c;
      if (upper === 'Q') c = [ox + num(), oy + num()];
      else c = prevCtrl?.[2] === 'Q' ? [2 * x - prevCtrl[0], 2 * y - prevCtrl[1]] : [x, y];
      const end = [ox + num(), oy + num()];
      for (let k = 1; k <= 12; k += 1) {
        const t = k / 12; const u = 1 - t;
        push([u * u * x + 2 * u * t * c[0] + t * t * end[0], u * u * y + 2 * u * t * c[1] + t * t * end[1]]);
      }
      prevCtrl = [c[0], c[1], 'Q'];
      [x, y] = end;
    } else if (upper === 'A') {
      const [rx, ry, rot, large, sweep] = [num(), num(), num(), num(), num()];
      const end = [ox + num(), oy + num()];
      for (const p of arcPoints(x, y, rx, ry, rot, large, sweep, end[0], end[1])) push(p);
      [x, y] = end;
      prevCtrl = null;
    }
  }
  return subpaths.filter((s) => s.pts.length >= 1);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const polyLength = (pts) => pts.reduce((sum, p, k) => (k ? sum + dist(pts[k - 1], p) : 0), 0);

/** A glyph as polylines on the 24-unit box: [{ pts, closed, dash, length }]. */
export function iconPolylines(name, { glyphPx = 16 } = {}) {
  const icon = MORPH_ICONS[name];
  if (!icon) return null;
  const base = parseTransform(icon.transform || '');
  const [ox, oy] = icon.offsetPx || [0, 0];
  const nudge = [1, 0, 0, 1, (ox * 24) / glyphPx, (oy * 24) / glyphPx];
  const out = [];
  for (const path of icon.paths) {
    const m = multiply(nudge, multiply(base, parseTransform(path.transform || '')));
    for (const sub of flattenPath(path.d)) {
      const pts = sub.pts.map((p) => apply(m, p));
      out.push({ pts, closed: sub.closed, dash: path.dash || null, length: polyLength(pts) });
    }
  }
  return out;
}

/** `n` points evenly spaced along a polyline (its first and last included). */
export function resample(pts, n) {
  if (pts.length === 1) return Array.from({ length: n }, () => [...pts[0]]);
  const cum = [0];
  for (let k = 1; k < pts.length; k += 1) cum.push(cum[k - 1] + dist(pts[k - 1], pts[k]));
  const total = cum[cum.length - 1];
  if (total === 0) return Array.from({ length: n }, () => [...pts[0]]);
  const out = [];
  let seg = 1;
  for (let k = 0; k < n; k += 1) {
    const target = (total * k) / (n - 1);
    while (seg < pts.length - 1 && cum[seg] < target) seg += 1;
    const span = cum[seg] - cum[seg - 1] || 1;
    const f = Math.min(1, Math.max(0, (target - cum[seg - 1]) / span));
    out.push([pts[seg - 1][0] + (pts[seg][0] - pts[seg - 1][0]) * f, pts[seg - 1][1] + (pts[seg][1] - pts[seg - 1][1]) * f]);
  }
  return out;
}

/** Cut a polyline in two at half its length (a closed outline opens up). */
function splitHalf(piece) {
  const pts = resample(piece.pts, 2 * MORPH_SAMPLES + 1);
  const a = pts.slice(0, MORPH_SAMPLES + 1);
  const b = pts.slice(MORPH_SAMPLES);
  return [a, b].map((p) => ({ pts: p, closed: false, dash: piece.dash, length: piece.length / 2 }));
}

function evenUp(pieces, count) {
  const list = pieces.slice();
  while (list.length < count) {
    let longest = 0;
    for (let k = 1; k < list.length; k += 1) if (list[k].length > list[longest].length) longest = k;
    list.splice(longest, 1, ...splitHalf(list[longest]));
  }
  return list;
}

const travel = (a, b) => { let s = 0; for (let k = 0; k < a.length; k += 1) s += (a[k][0] - b[k][0]) ** 2 + (a[k][1] - b[k][1]) ** 2; return s; };

/**
 * `to`'s points reordered to travel least from `from`'s: a closed outline may
 * start anywhere and run either way; an open stroke may run either way.
 * Both come back with MORPH_SAMPLES points; a closed one repeats its start.
 */
function align(from, to) {
  const n = MORPH_SAMPLES;
  const loop = (piece) => resample(piece.pts, n); // closed: last == first
  const A = loop(from);
  const B = loop(to);
  if (!from.closed && !to.closed) {
    const rev = B.slice().reverse();
    return { a: A, b: travel(A, rev) < travel(A, B) ? rev : B };
  }
  // At least one is a loop: rotate the loop(s) against the other.
  const rotations = (P, closed) => {
    if (!closed) return [P, P.slice().reverse()];
    const ring = P.slice(0, n - 1);
    const out = [];
    for (let r = 0; r < n - 1; r += 1) {
      const fwd = ring.slice(r).concat(ring.slice(0, r));
      out.push(fwd.concat([fwd[0]]));
      const back = fwd.slice().reverse();
      out.push([back[back.length - 1], ...back]);
    }
    return out;
  };
  let best = null;
  if (to.closed) {
    for (const cand of rotations(B, true)) {
      const cost = travel(A, cand);
      if (!best || cost < best.cost) best = { cost, a: A, b: cand };
    }
  } else {
    for (const cand of rotations(A, true)) {
      for (const b of [B, B.slice().reverse()]) {
        const cost = travel(cand, b);
        if (!best || cost < best.cost) best = { cost, a: cand, b };
      }
    }
  }
  return { a: best.a, b: best.b };
}

const planCache = new Map();

/**
 * Plan a morph between two glyphs (names, or polylines from a morph caught
 * mid-way). Returns pairs [{ a, b, dashA, dashB }] with equal point counts.
 */
export function planMorph(from, to, { glyphPx = 16 } = {}) {
  const key = typeof from === 'string' && typeof to === 'string' ? `${from}>${to}@${glyphPx}` : null;
  if (key && planCache.has(key)) return planCache.get(key);
  const A0 = typeof from === 'string' ? iconPolylines(from, { glyphPx }) : from;
  const B0 = typeof to === 'string' ? iconPolylines(to, { glyphPx }) : to;
  if (!A0?.length || !B0?.length) return null;
  const count = Math.max(A0.length, B0.length);
  const A = evenUp(A0, count);
  const B = evenUp(B0, count);
  // Greedy pairing by least travel.
  const costs = [];
  const aligned = new Map();
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < count; j += 1) {
      const pair = align(A[i], B[j]);
      aligned.set(`${i}:${j}`, pair);
      costs.push([travel(pair.a, pair.b), i, j]);
    }
  }
  costs.sort((p, q) => p[0] - q[0]);
  const usedA = new Set(); const usedB = new Set();
  const pairs = [];
  for (const [, i, j] of costs) {
    if (usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i); usedB.add(j);
    const { a, b } = aligned.get(`${i}:${j}`);
    pairs.push({ a, b, dashA: A[i].dash, dashB: B[j].dash });
    if (pairs.length === count) break;
  }
  if (key) planCache.set(key, pairs);
  return pairs;
}

const round = (v) => Math.round(v * 100) / 100;

/**
 * The glyph `t` of the way through a planned morph (0 = from, 1 = to):
 * [{ d, pts, dash }] — `dash` is a stroke-dasharray or null. A dashed piece
 * opens its gaps from nothing (gap 0 with round caps reads as solid), so the
 * lasso's dashes never pop.
 */
export function morphFrame(pairs, t) {
  return pairs.map(({ a, b, dashA, dashB }) => {
    const pts = a.map((p, k) => [p[0] + (b[k][0] - p[0]) * t, p[1] + (b[k][1] - p[1]) * t]);
    const d = `M${pts.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}`;
    let dash = null;
    if (dashA || dashB) {
      const on = (dashB || dashA)[0];
      const gap = (dashA ? dashA[1] : 0) * (1 - t) + (dashB ? dashB[1] : 0) * t;
      dash = gap < 0.01 ? null : `${on} ${round(gap)}`;
    }
    return { d, pts, dash };
  });
}

/** A frame's points as polylines, to start a new morph from mid-way. */
export function frameAsPolylines(frame, pairs, t) {
  return frame.map((piece, k) => {
    const { dashA, dashB } = pairs[k];
    const dash = t < 0.5 ? (dashA || null) : (dashB || null);
    return { pts: piece.pts, closed: false, dash, length: polyLength(piece.pts) };
  });
}

/** CSS cubic-bezier as a function (for the frame-driven morph). */
export function cubicBezier(x1, y1, x2, y2) {
  const bx = (t) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0; let hi = 1; let t = x;
    for (let k = 0; k < 30; k += 1) {
      t = (lo + hi) / 2;
      if (bx(t) < x) lo = t; else hi = t;
    }
    return by(t);
  };
}

/** Parse `rgb(…)` / `rgba(…)` into [r, g, b, a], or null. */
export function parseColour(text) {
  const m = String(text || '').match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/);
  if (!m) return null;
  const alpha = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]));
  return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
}

export function mixColour(from, to, t) {
  const a = parseColour(from); const b = parseColour(to);
  if (!a || !b) return t < 0.5 ? (from || to) : (to || from);
  const c = a.map((v, k) => v + (b[k] - v) * t);
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${round(c[3])})`;
}
