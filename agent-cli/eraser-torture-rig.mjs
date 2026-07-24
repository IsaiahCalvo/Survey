#!/usr/bin/env node
// agent-cli/eraser-torture-rig.mjs — parameterized eraser torture-test rig.
//
// Hammers the production partial/full eraser against every seedable annotation
// type and checks TWO truths after every swipe:
//
//   DATA truth
//     D1 engine-consistency — the page JSON the app persisted must deep-equal
//        what the shared erase engine (src/utils/pageSpaceEraser.js
//        erasePageAnnotations) predicts for the same PRE state + pointer trace
//        + radius/mode (canErase = allow-all, i.e. product intent).
//     D2 semantic truth    — an INDEPENDENT, correct-geometry hit model
//        (rotation about center, center-relative line endpoints, real image
//        bounds) says which objects the sweep MUST have touched / MUST NOT
//        have touched. Must-touch objects must be deleted-or-changed;
//        must-not-touch objects must stay canonically byte-identical.
//        This tier catches hit-test bugs that live INSIDE the shared engine
//        (where D1 alone would agree with the app about the wrong answer).
//     D3 sliver scan       — changed ink survivors are scanned for degenerate
//        sliver geometry (tiny-area / hairline-width rings or micro subpaths).
//     D4 durability        — the backend cold-read (fresh Y.Doc load from
//        annotation_snapshots + annotation_updates) must match the in-app JSON.
//
//   PIXEL truth (screenshots of the page wrapper before / during / after)
//     P1 live feedback     — when a hit happened, the swiped object's region
//        must visibly change MID-DRAG (carve or ghost), not only at release.
//     P2 post-release stability — two frames taken after commit+settle must be
//        identical (no lingering painted streaks that later clear, no
//        oscillation).
//     P3 commit repaint    — after release, must-touch regions differ from
//        BEFORE and must-not-touch regions match BEFORE (no phantom erase, no
//        leftover streak on untouched marks).
//     P4 mid-drag composite stability — a far-away control object's region
//        must stay stable in every mid-drag frame (no transient blank /
//        double-composite frames).
//
// Failures are saved as REPLAYABLE JSON cases (seed objects + pointer trace in
// page units + mode/size) so a fix can be re-verified with SEED=<replay file>.
//
// Usage (run from the worktree root):
//   node agent-cli/eraser-torture-rig.mjs                       # known 7-bug set + baseline
//   SEED='fuzz 10 1234' node agent-cli/eraser-torture-rig.mjs   # 10 fuzz cases, rng seed 1234
//   SEED=debug/eraser-rig/<ts>/cases/K1-line-slash.replay.json node agent-cli/eraser-torture-rig.mjs
//   MODE=entire RADIUS=30 PAGE_URL=http://localhost:5230 node agent-cli/eraser-torture-rig.mjs
//
// Env:
//   SEED     'known' (default) | 'fuzz N [rngSeed]' | path to a .replay.json
//   MODE     partial | entire            (default partial)
//   RADIUS   eraser size = DIAMETER in page units, the same number shown in
//            the toolbar Width box (default 20 → page-space radius 10)
//   PAGE_URL dev server (default http://localhost:5230)
//   OUT_DIR  output root (default debug/eraser-rig/<timestamp>)
//   KEEP=1   keep the throwaway document + storage object after the run
//   HEADFUL=1 run with a visible browser
//
// Design notes:
// - Auth: Node-side supabase password login is captcha-blocked, so the rig
//   harvests the browser's dev auto-login session (VITE_DEV_AUTO_LOGIN_* via
//   .env.local) from localStorage and runs the Node client with setSession.
// - Seeding uses the app's own commit-JSON builders (annotationCreationCommit,
//   textEditCommit) so seeded objects are byte-identical to app-drawn ones,
//   written through openAnnotationDoc.applyByPage (the real durable path).
// - No src/ changes: the rig only reads app state through window.__diagState
//   (the existing eraser/selector diag harness) and the DOM.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, rgb } from 'pdf-lib';
import { PNG } from 'pngjs';

import { loadEnv } from './lib/env.mjs';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  buildBoundaryShapeCommitJSON,
  buildLineCommitJSON,
  buildFreehandCommitJSON,
} from '../src/utils/annotationCreationCommit.js';
import { buildNewTextCommitJSON } from '../src/utils/textEditCommit.js';

loadEnv();

// ─── parameters ──────────────────────────────────────────────────────────────
const PAGE_URL = process.env.PAGE_URL || 'http://localhost:5230';
const MODE = process.env.MODE === 'entire' ? 'entire' : 'partial';
const ERASER_SIZE = Math.max(2, Number(process.env.RADIUS) || 20); // toolbar diameter
const PAGE_RADIUS = ERASER_SIZE / 2;                               // page-space radius
const SEED_SPEC = process.env.SEED || 'known';
const KEEP = process.env.KEEP === '1';
const HEADLESS = process.env.HEADFUL ? false : true;
const PAGE_W = 612;
const PAGE_H = 792;
const RIG_SPACE_ID = 'sp-rig';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = path.resolve(process.env.OUT_DIR || path.join(ROOT, 'debug', 'eraser-rig', STAMP));
fs.mkdirSync(path.join(OUT_DIR, 'shots'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'cases'), { recursive: true });

const log = (...a) => console.log(...a);

// ─── small utils ─────────────────────────────────────────────────────────────
const canon = (value) => JSON.stringify(sortKeys(value));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = sortKeys(v[k]); return acc; }, {});
  }
  return v;
}
// Numeric-tolerant deep equality (guards against V8 float-repr noise between
// the browser-side commit and the Node-side oracle running the same engine).
function deepEqualNumeric(a, b, tol = 1e-6) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!deepEqualNumeric(a[i], b[i], tol)) return false;
    return true;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined).sort();
    const kb = Object.keys(b).filter((k) => b[k] !== undefined).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] !== kb[i] || !deepEqualNumeric(a[ka[i]], b[kb[i]], tol)) return false;
    }
    return true;
  }
  return false;
}
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const objId = (o, i) => o?.data?.id || o?.id || o?.annotationId || `index:${i}`;

// The app strips transient interaction keys when persisting page JSON
// (src/utils/historyHelpers.js normalizeCanvasJsonForHistory). Mirror that
// strip before any data-truth comparison so a benign, deliberate normalize
// step is never reported as an erase divergence.
const TRANSIENT_KEYS = new Set([
  '_originalHasControls', '_originalHasBorders', '_lastLeft', '_lastTop', '_dragSessionId',
  'hasBorders', 'hasControls', 'lockMovementX', 'lockMovementY', 'lockScalingFlip',
  'perPixelTargetFind', 'targetFindTolerance', 'hoverCursor', 'moveCursor',
  'selectable', 'evented', 'dirty', 'cacheKey', 'isMoving',
]);
function stripTransient(node) {
  if (Array.isArray(node)) return node.map(stripTransient);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (TRANSIENT_KEYS.has(k)) continue;
    out[k] = stripTransient(v);
  }
  return out;
}

// ─── independent ground-truth hit model (correct geometry, rig-owned) ────────
// Deliberately NOT the app's hit test: rotation is about the object CENTER
// (matching the SVG renderer's rotate(angle, cx, cy)), line endpoints are
// CENTER-relative (fabric calcLinePoints contract), images use their box.
const visiblePaint = (v) => {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== 'none' && s !== 'transparent' && !/^rgba\([^)]*,\s*0(\.0+)?\s*\)$/.test(s);
};
const distToSeg = (p, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const rotAbout = (p, c, deg) => {
  const a = (deg * Math.PI) / 180; const cos = Math.cos(a); const sin = Math.sin(a);
  const dx = p.x - c.x; const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
};
const pointInPoly = (p, verts) => {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x; const yi = verts[i].y; const xj = verts[j].x; const yj = verts[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};
function densify(points, step = 2) {
  if (points.length <= 1) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]; const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}
// Flatten a fabric-style path command list to absolute polyline subpaths.
function pathToSubpaths(cmds) {
  const subs = [];
  let cur = null; let pos = { x: 0, y: 0 }; let start = { x: 0, y: 0 };
  const push = (pt) => { if (cur) cur.push(pt); pos = pt; };
  for (const raw of cmds || []) {
    if (!Array.isArray(raw) || !raw.length) continue;
    const op = String(raw[0]).toUpperCase();
    if (op === 'M') { cur = [{ x: raw[1], y: raw[2] }]; subs.push(cur); pos = { x: raw[1], y: raw[2] }; start = pos; continue; }
    if (op === 'L') { push({ x: raw[1], y: raw[2] }); continue; }
    if (op === 'Q') {
      for (let t = 1; t <= 8; t += 1) {
        const tt = t / 8; const mt = 1 - tt;
        push({ x: mt * mt * pos.x + 2 * mt * tt * raw[1] + tt * tt * raw[3], y: mt * mt * pos.y + 2 * mt * tt * raw[2] + tt * tt * raw[4] });
      }
      continue;
    }
    if (op === 'C') {
      const p0 = pos;
      for (let t = 1; t <= 10; t += 1) {
        const tt = t / 10; const mt = 1 - tt;
        push({
          x: mt ** 3 * p0.x + 3 * mt * mt * tt * raw[1] + 3 * mt * tt * tt * raw[3] + tt ** 3 * raw[5],
          y: mt ** 3 * p0.y + 3 * mt * mt * tt * raw[2] + 3 * mt * tt * tt * raw[4] + tt ** 3 * raw[6],
        });
      }
      continue;
    }
    if (op === 'Z') { if (cur && cur.length) cur.push({ ...start }); continue; }
  }
  return subs.filter((s) => s.length >= 2);
}
// True if the sweep (points, radius r) touches the object under CORRECT geometry.
function groundTruthHit(object, sweep, r) {
  const type = String(object?.type || '').toLowerCase();
  const samples = densify(sweep, Math.max(1.5, Math.min(r / 2, 6)));
  const sw = Number(object?.strokeWidth) || 0;
  const left = Number(object?.left) || 0;
  const top = Number(object?.top) || 0;
  const w = (Number(object?.width) || 0) * (Number(object?.scaleX) || 1);
  const h = (Number(object?.height) || 0) * (Number(object?.scaleY) || 1);
  const angle = Number(object?.angle) || 0;
  const center = { x: left + w / 2, y: top + h / 2 };
  const toLocal = (p) => rotAbout(p, center, -angle);
  const hasFill = visiblePaint(object?.fill);
  const hasStroke = visiblePaint(object?.stroke) && sw > 0;

  if (type === 'line') {
    const a = { x: center.x + (Number(object.x1) || 0), y: center.y + (Number(object.y1) || 0) };
    const b = { x: center.x + (Number(object.x2) || 0), y: center.y + (Number(object.y2) || 0) };
    const lim = r + sw / 2;
    return samples.some((p) => distToSeg(p, rotAbout(a, center, angle), rotAbout(b, center, angle)) <= lim);
  }
  if (type === 'rect' || type === 'textbox' || type === 'text' || type === 'i-text' || type === 'image') {
    const isBoxLike = type !== 'rect';
    return samples.some((p) => {
      const q = toLocal(p);
      const inX = q.x >= left && q.x <= left + w;
      const inY = q.y >= top && q.y <= top + h;
      if (isBoxLike || hasFill) {
        // box-like (text/image) or filled rect: interior + r band around it
        const dx = Math.max(left - q.x, 0, q.x - (left + w));
        const dy = Math.max(top - q.y, 0, q.y - (top + h));
        return Math.hypot(dx, dy) <= r + (hasStroke ? sw / 2 : 0);
      }
      // stroke-only rect: edge band only
      const edges = [
        [{ x: left, y: top }, { x: left + w, y: top }],
        [{ x: left + w, y: top }, { x: left + w, y: top + h }],
        [{ x: left + w, y: top + h }, { x: left, y: top + h }],
        [{ x: left, y: top + h }, { x: left, y: top }],
      ];
      return inX === inX && edges.some(([a, b]) => distToSeg(q, a, b) <= r + sw / 2);
    });
  }
  if (type === 'ellipse' || type === 'circle') {
    const rx = type === 'circle' ? Number(object.radius) || 0 : (Number(object.rx) || w / 2);
    const ry = type === 'circle' ? Number(object.radius) || 0 : (Number(object.ry) || h / 2);
    return samples.some((p) => {
      const q = toLocal(p);
      const nd = Math.hypot((q.x - center.x) / (rx || 1e-6), (q.y - center.y) / (ry || 1e-6));
      const band = (r + sw / 2) / Math.max(1e-6, (rx + ry) / 2);
      if (hasFill) return nd <= 1 + band;
      return Math.abs(nd - 1) <= band;
    });
  }
  if (type === 'path') {
    // Seeded paths in this rig are absolute page-space (left/top 0, no offset,
    // angle 0) — production ink and the star fixture both qualify.
    const subs = pathToSubpaths(object.path);
    const strokeReach = r + Math.max(sw, Number(object.sourceWidth) || 0) / 2;
    for (const p of samples) {
      for (const sub of subs) {
        for (let i = 1; i < sub.length; i += 1) {
          if (distToSeg(p, sub[i - 1], sub[i]) <= (hasFill && !sw ? r : strokeReach)) return true;
        }
        if (hasFill && sub.length >= 3 && pointInPoly(p, sub)) return true;
      }
    }
    return false;
  }
  return false; // unknown types: no ground-truth claim
}
// Margin-classified verdict: 'must-touch' | 'must-not-touch' | 'ambiguous'.
function groundTruthVerdict(object, sweep, r, margin = 2.5) {
  const hitShrunk = groundTruthHit(object, sweep, Math.max(0.5, r - margin));
  const hitGrown = groundTruthHit(object, sweep, r + margin);
  if (hitShrunk) return 'must-touch';
  if (!hitGrown) return 'must-not-touch';
  return 'ambiguous';
}

// ─── sliver scan ─────────────────────────────────────────────────────────────
function ringMetrics(ring) {
  let area = 0; let perim = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    perim += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
  }
  return { area: Math.abs(area / 2), perim };
}
// Returns a list of sliver descriptors found in a changed ink survivor.
function findSlivers(object) {
  const out = [];
  const srcW = Math.max(1, Number(object?.sourceWidth) || Number(object?.strokeWidth) || 1);
  if (Array.isArray(object?.polygons)) {
    object.polygons.forEach((poly, pi) => {
      (Array.isArray(poly) ? poly : []).forEach((ring, ri) => {
        if (!Array.isArray(ring) || ring.length < 3) return;
        const { area, perim } = ringMetrics(ring);
        if (perim <= 0) return;
        // featureWidth = 2A/P ≈ the ribbon's effective width. Healthy survivor
        // outlines of a w-wide stroke sit near w/2..w; sliver crescents and
        // hairline ribbons sit far below 1 page unit. Calibrated offline
        // against the real engine: edge-graze hairline → fw 0.30 / area 91;
        // graze+cross crescent → fw 0.68 / area 3.9; healthy stubs ≥ fw 1.0.
        const featureWidth = (2 * area) / perim;
        if (area < 1.0 || featureWidth < 0.32 || (featureWidth < 1.0 && area < 40)) {
          out.push({ kind: 'polygon-ring', polygon: pi, ring: ri, area: +area.toFixed(3), featureWidth: +featureWidth.toFixed(3), points: ring.length, sourceWidth: srcW });
        }
      });
    });
  } else if (Array.isArray(object?.path)) {
    // stroked-centerline survivor: micro subpaths are the sliver analogue
    pathToSubpaths(object.path).forEach((sub, si) => {
      let len = 0;
      for (let i = 1; i < sub.length; i += 1) len += Math.hypot(sub[i].x - sub[i - 1].x, sub[i].y - sub[i - 1].y);
      if (len > 0 && len < 0.6) out.push({ kind: 'micro-subpath', subpath: si, length: +len.toFixed(3) });
    });
  }
  return out;
}

// ─── PNG helpers ─────────────────────────────────────────────────────────────
function cropPng(png, x, y, w, h) {
  const cx = Math.max(0, Math.round(x)); const cy = Math.max(0, Math.round(y));
  const cw = Math.max(1, Math.min(Math.round(w), png.width - cx));
  const ch = Math.max(1, Math.min(Math.round(h), png.height - cy));
  const out = new PNG({ width: cw, height: ch });
  PNG.bitblt(png, out, cx, cy, cw, ch, 0, 0);
  return out;
}
function diffRatio(a, b, channelTol = 14) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return 1;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > channelTol
      || Math.abs(a.data[i + 1] - b.data[i + 1]) > channelTol
      || Math.abs(a.data[i + 2] - b.data[i + 2]) > channelTol
    ) n += 1;
  }
  return n / (a.width * a.height);
}
const CHANGED = 0.004;   // ≥0.4% pixels different → region visibly changed
const STABLE = 0.0035;   // ≤0.35% → treated as identical (AA/compositor noise)

// ─── page-space bboxes for screenshot regions ────────────────────────────────
function objectBBox(object) {
  const type = String(object?.type || '').toLowerCase();
  const sw = (Number(object?.strokeWidth) || 0) / 2 + 4;
  if (type === 'line') {
    const cx = (Number(object.left) || 0) + (Number(object.width) || 0) / 2;
    const cy = (Number(object.top) || 0) + (Number(object.height) || 0) / 2;
    const pts = [
      { x: cx + (+object.x1 || 0), y: cy + (+object.y1 || 0) },
      { x: cx + (+object.x2 || 0), y: cy + (+object.y2 || 0) },
    ];
    return padBox(aabb(pts), sw + 4);
  }
  if (type === 'path') {
    const pts = pathToSubpaths(object.path).flat();
    return padBox(aabb(pts), (Number(object.sourceWidth) || Number(object.strokeWidth) || 2) / 2 + 4);
  }
  const left = Number(object.left) || 0; const top = Number(object.top) || 0;
  const w = (Number(object.width) || 0) * (Number(object.scaleX) || 1);
  const h = (Number(object.height) || 0) * (Number(object.scaleY) || 1);
  const c = { x: left + w / 2, y: top + h / 2 };
  const corners = [
    { x: left, y: top }, { x: left + w, y: top }, { x: left + w, y: top + h }, { x: left, y: top + h },
  ].map((p) => rotAbout(p, c, Number(object.angle) || 0));
  return padBox(aabb(corners), sw);
}
function aabb(pts) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}
const padBox = (b, pad) => ({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad });
const clampBox = (b) => ({
  minX: Math.max(0, b.minX), minY: Math.max(0, b.minY),
  maxX: Math.min(PAGE_W, b.maxX), maxY: Math.min(PAGE_H, b.maxY),
});

// ─── seed object factories (byte-identical to app-drawn commits) ─────────────
let seedSeq = 0;
const sid = (tag) => `rig-${tag}-${(seedSeq += 1)}`;
const STAMP_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVR4nGNgYGD4Twzu6en5TwxmYqAyGDVw1MBRA0cNHDVw1MCRYyAAG4NB98RRl2sAAAAASUVORK5CYII=';
const F = {
  rect: ({ id = sid('rect'), x = 100, y = 100, w = 120, h = 80, angle = 0, fill = 'transparent', spaceId } = {}) => {
    const o = buildBoundaryShapeCommitJSON({
      tool: 'rect', id, start: { x, y }, end: { x: x + w, y: y + h },
      strokeColor: '#d11b2d', strokeOpacity: 100, fillColor: fill === 'transparent' ? 'transparent' : fill, fillOpacity: 45, strokeWidth: 4,
    });
    if (angle) o.angle = angle;
    if (spaceId) o.spaceId = spaceId;
    return o;
  },
  ellipse: ({ id = sid('ellipse'), x = 100, y = 100, w = 120, h = 80, angle = 0, fill = 'transparent' } = {}) => {
    const o = buildBoundaryShapeCommitJSON({
      tool: 'ellipse', id, start: { x, y }, end: { x: x + w, y: y + h },
      strokeColor: '#2d8a3e', strokeOpacity: 100, fillColor: fill, fillOpacity: 45, strokeWidth: 4,
    });
    if (angle) o.angle = angle;
    return o;
  },
  line: ({ id = sid('line'), x1, y1, x2, y2, tool = 'line' } = {}) => buildLineCommitJSON({
    tool, id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 },
    strokeColor: '#1b2dd1', strokeOpacity: 100, strokeWidth: 4,
    arrowheadStyle: tool === 'arrow' ? 'solid-triangle' : undefined,
  }),
  ink: ({ id = sid('ink'), points, width = 6, tool = 'pen' } = {}) => buildFreehandCommitJSON({
    tool, id, points, strokeColor: '#111111', highlightColor: 'rgba(255, 214, 0, 0.4)', strokeWidth: width,
  }),
  text: ({ id = sid('text'), x = 100, y = 100, text = 'RIG TEXT', angle = 0 } = {}) => {
    const o = buildNewTextCommitJSON({
      text, left: x, top: y, innerWrapWidth: 90, maxLineWidth: 78, lineCount: 1, naturalInnerHeight: 20,
      fill: '#0f172a', stroke: 'transparent', strokeWidth: 0,
    });
    o.id = id; o.data = { ...(o.data || {}), id };
    if (angle) o.angle = angle;
    return o;
  },
  image: ({ id = sid('stamp'), x = 100, y = 100, w = 120, h = 90 } = {}) => ({
    type: 'image', left: x, top: y, width: w, height: h, scaleX: 1, scaleY: 1, angle: 0,
    src: STAMP_PNG, id, data: { id },
  }),
  // Filled star: a PATH-typed whole-delete object (not partial-eligible — no
  // tool, visible fill, closed with Z → eraserPolicy routes it to 'entire').
  starPath: ({ id = sid('star'), cx = 380, cy = 350, r = 35 } = {}) => {
    const pts = [];
    for (let i = 0; i < 10; i += 1) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
    const cmds = [['M', ...pts[0]], ...pts.slice(1).map((p) => ['L', ...p]), ['Z']];
    return {
      type: 'path', path: cmds, left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0,
      fill: 'rgba(51, 85, 255, 0.55)', stroke: '#3355ff', strokeWidth: 2,
      strokeLineCap: 'butt', strokeLineJoin: 'miter', id, data: { id },
    };
  },
};
const straightInk = (id, x1, y1, x2, y2, width = 8, n = 26, tool = 'pen') => F.ink({
  id,
  width,
  tool,
  points: Array.from({ length: n }, (_, i) => ({ x: x1 + ((x2 - x1) * i) / (n - 1), y: y1 + ((y2 - y1) * i) / (n - 1) })),
});

// Control object present in every case (P4 composite-stability sentinel) —
// parked top-left, far from all swipes.
const CONTROL = () => F.rect({ id: 'rig-control', x: 40, y: 40, w: 70, h: 45 });

// ─── known case set ──────────────────────────────────────────────────────────
function knownCases() {
  const cases = [];

  // K0 — baseline sanity: MUST PASS (validates the rig itself).
  cases.push({
    id: 'K0-baseline', bug: null,
    note: 'Sanity: partial-erase pen ink; untouched rect + text stay identical. Must PASS.',
    objects: [CONTROL(), straightInk('rig-k0-ink', 160, 300, 420, 300, 8), F.rect({ id: 'rig-k0-rect', x: 150, y: 420, w: 120, h: 70 }), F.text({ id: 'rig-k0-text', x: 380, y: 430 })],
    swipes: [seg(290, 260, 290, 340, 14)],
    midAt: [0.5, 0.8],
  });

  // K1 — slash-orientation line + arrow immune (bug 1).
  cases.push({
    id: 'K1-line-slash', bug: 1,
    note: 'Slash ("/") line + arrow: sweep crosses both centers — correct geometry says hit, engine misses.',
    objects: [CONTROL(), F.line({ id: 'rig-k1-line', x1: 150, y1: 400, x2: 300, y2: 250 }), F.line({ id: 'rig-k1-arrow', x1: 350, y1: 400, x2: 500, y2: 250, tool: 'arrow' })],
    swipes: [seg(180, 325, 470, 325, 22)],
    midAt: [0.5, 0.85],
  });

  // K2 — backslash line: near half erases, far half immune (bug 1).
  cases.push({
    id: 'K2-line-backslash-far-half', bug: 1,
    note: 'Backslash ("\\") line: sweep crosses only the bottom-right half — immune (hit test reads center-relative endpoints as corner-relative).',
    objects: [CONTROL(), F.line({ id: 'rig-k2-line', x1: 150, y1: 250, x2: 330, y2: 430 })],
    swipes: [seg(255, 400, 345, 355, 12)],
    midAt: [0.6],
  });

  // K3 — rotated rect + rotated text hit region about the wrong pivot (bug 2).
  cases.push({
    id: 'K3-rotated-rect-text', bug: 2,
    note: '45°-rotated filled rect + 30°-rotated text: sweep crosses the RENDERED (center-pivot) footprint, outside the corner-pivot footprint the hit test uses.',
    objects: [CONTROL(), F.rect({ id: 'rig-k3-rect', x: 180, y: 260, w: 200, h: 120, angle: 45, fill: '#88c0d0' }), F.text({ id: 'rig-k3-text', x: 420, y: 470, angle: 90, text: 'ROTATED' })],
    swipes: [seg(355, 335, 385, 360, 8), seg(465, 447, 465, 520, 10)],
    midAt: [0.6],
  });

  // K4 — stamps (type 'image') always immune (bug 3).
  cases.push({
    id: 'K4-stamp-image', bug: 3,
    note: "Stamp (type 'image'): sweep straight across its center — hit test falls to a dead default.",
    objects: [CONTROL(), F.image({ id: 'rig-k4-stamp', x: 240, y: 300, w: 120, h: 90 })],
    swipes: [seg(220, 345, 380, 345, 14)],
    midAt: [0.6],
    pixelSkipIds: ['rig-k4-stamp'], // stamps do not render in the SVG layer — pixel truth n/a
  });

  // K5 — sliver crescents from the polygon-subtraction lane (bug 4).
  // Calibrated offline against the engine: the edge graze leaves a ~0.3-unit
  // hairline ribbon on ink A; graze+shallow-cross leaves a small crescent
  // fragment (area ~3.9, width ~0.68) on ink B. Both are real persisted junk.
  cases.push({
    id: 'K5-ink-slivers', bug: 4,
    note: 'Edge graze (hairline ribbon) + graze-then-shallow-cross (crescent fragment) — scan survivors for sliver geometry.',
    objects: [CONTROL(), straightInk('rig-k5-inkA', 150, 500, 450, 500, 9, 40), straightInk('rig-k5-inkB', 150, 545, 440, 545, 9, 40)],
    swipes: [
      seg(150, 494.2, 450, 494.2, 34),
      seg(150, 538.5, 450, 538, 34),
      seg(160, 554, 440, 537, 30),
    ],
    midAt: [0.5],
  });

  // K6 — path-typed whole-delete crossed AFTER carving starts: no live feedback (bug 6).
  cases.push({
    id: 'K6-late-path-ghost', bug: 6,
    note: 'Sweep carves pen ink first, then crosses a filled star path (whole-delete). Star must ghost live — bug: nothing until release.',
    objects: [CONTROL(), straightInk('rig-k6-ink', 150, 350, 280, 350, 6), F.starPath({ id: 'rig-k6-star', cx: 390, cy: 350, r: 35 })],
    swipes: [seg(140, 350, 470, 350, 26)],
    midAt: [0.96], // pointer past the star (cursor ring clear of its bbox), pre-release
    liveMustGhostIds: ['rig-k6-star'],
  });

  // K7 — mid-gesture cancellation discards the whole erase (bug 7).
  cases.push({
    id: 'K7-cancel-discards', bug: 7,
    note: 'pointercancel mid-swipe after crossing ink: erase-so-far must COMMIT (product intent) — bug: everything is thrown away.',
    objects: [CONTROL(), straightInk('rig-k7-ink', 160, 300, 420, 300, 8)],
    swipes: [seg(290, 250, 290, 345, 14)],
    cancelAtFraction: 0.9,
    midAt: [0.6],
  });

  // K8 — active space scoping contract (decided 2026-07-20). Background
  // (unassigned) annotations under an active space are PROTECTED — visible but
  // not editable, matching SVGAnnotationLayer's interaction rules — so the
  // eraser must delete the in-space rect and leave the unassigned rect
  // byte-identical and pixel-untouched. Runs LAST (space mode is activated via
  // the sidebar UI and turned off afterwards).
  cases.push({
    id: 'K8-space-scoping-contract', bug: 5,
    note: 'Space active: sweep crosses a space-assigned rect (must erase) AND an unassigned background rect (protected: must stay untouched).',
    objects: [CONTROL(), F.rect({ id: 'rig-k8-inspace', x: 150, y: 280, w: 110, h: 70, spaceId: RIG_SPACE_ID }), F.rect({ id: 'rig-k8-nospace', x: 340, y: 280, w: 110, h: 70 })],
    swipes: [seg(160, 315, 480, 315, 24)],
    midAt: [0.5],
    activateSpace: RIG_SPACE_ID,
    // Policy-blocked ids: verdicts forced to must-not-touch and the Node
    // oracle's canErase mirrors the app's space rule for them.
    blockedIds: ['rig-k8-nospace'],
  });

  return cases;
}
function seg(x1, y1, x2, y2, steps = 16) {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: x1 + ((x2 - x1) * i) / steps,
    y: y1 + ((y2 - y1) * i) / steps,
  }));
}

// ─── fuzz case generator ─────────────────────────────────────────────────────
function fuzzCases(count, rngSeed) {
  const rnd = mulberry32(rngSeed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => a + rnd() * (b - a);
  const cases = [];
  for (let c = 0; c < count; c += 1) {
    const objects = [CONTROL()];
    const nObj = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nObj; i += 1) {
      const kind = pick(['ink', 'rect', 'ellipse', 'line', 'arrow', 'text', 'image', 'star']);
      const x = between(140, 430); const y = between(220, 520);
      if (kind === 'ink') {
        objects.push(straightInk(sid('fz-ink'), x, y, x + between(80, 180), y + between(-30, 30), pick([4, 6, 9])));
      } else if (kind === 'rect') {
        objects.push(F.rect({ id: sid('fz-rect'), x, y, w: between(60, 160), h: between(40, 110), angle: pick([0, 0, 15, 45, 90]), fill: pick(['transparent', '#88c0d0']) }));
      } else if (kind === 'ellipse') {
        objects.push(F.ellipse({ id: sid('fz-ell'), x, y, w: between(60, 140), h: between(40, 100), fill: pick(['transparent', '#e6b422']) }));
      } else if (kind === 'line' || kind === 'arrow') {
        const dx = between(60, 170) * pick([1, -1]); const dy = between(60, 170) * pick([1, -1]);
        objects.push(F.line({ id: sid(`fz-${kind}`), x1: x, y1: y, x2: Math.min(560, Math.max(60, x + dx)), y2: Math.min(560, Math.max(210, y + dy)), tool: kind }));
      } else if (kind === 'text') {
        objects.push(F.text({ id: sid('fz-text'), x, y, angle: pick([0, 0, 30]) }));
      } else if (kind === 'image') {
        objects.push(F.image({ id: sid('fz-img'), x, y, w: between(70, 130), h: between(50, 100) }));
      } else {
        objects.push(F.starPath({ id: sid('fz-star'), cx: x, cy: y, r: between(24, 40) }));
      }
    }
    // 1-2 swipes aimed at random object centers
    const swipes = [];
    const nSw = 1 + (rnd() < 0.35 ? 1 : 0);
    for (let s = 0; s < nSw; s += 1) {
      const target = objects[1 + Math.floor(rnd() * (objects.length - 1))];
      const bb = objectBBox(target);
      const cx = (bb.minX + bb.maxX) / 2; const cy = (bb.minY + bb.maxY) / 2;
      const ang = rnd() * Math.PI;
      const len = between(90, 220);
      swipes.push(seg(
        Math.max(20, Math.min(PAGE_W - 20, cx - (Math.cos(ang) * len) / 2)),
        Math.max(210, Math.min(560, cy - (Math.sin(ang) * len) / 2)),
        Math.max(20, Math.min(PAGE_W - 20, cx + (Math.cos(ang) * len) / 2)),
        Math.max(210, Math.min(560, cy + (Math.sin(ang) * len) / 2)),
        12 + Math.floor(rnd() * 14),
      ));
    }
    cases.push({
      id: `FZ${String(c + 1).padStart(2, '0')}-seed${rngSeed}`,
      bug: null,
      note: `fuzz case (rng ${rngSeed})`,
      objects,
      swipes,
      midAt: [0.6],
      pixelSkipIds: objects.filter((o) => String(o.type).toLowerCase() === 'image').map((o) => objId(o)),
    });
  }
  return cases;
}

// ─── backend/session plumbing ────────────────────────────────────────────────
async function harvestSession(page) {
  await page.goto(`${PAGE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    () => Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)),
    { timeout: 45000 },
  );
  return page.evaluate(() => {
    const k = Object.keys(localStorage).find((key) => /^sb-.*-auth-token$/.test(key));
    return JSON.parse(localStorage.getItem(k));
  });
}
async function makeNodeClient(session) {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw new Error(`setSession failed: ${error.message}`);
  return supabase;
}
async function createThrowawayDoc(supabase, userId) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  page.drawText('ERASER TORTURE RIG', { x: 40, y: PAGE_H - 28, size: 12, color: rgb(0.78, 0.78, 0.78) });
  for (let x = 0; x <= PAGE_W; x += 100) page.drawLine({ start: { x, y: 0 }, end: { x, y: PAGE_H }, thickness: 0.5, color: rgb(0.95, 0.95, 0.95) });
  for (let y = 0; y <= PAGE_H; y += 100) page.drawLine({ start: { x: 0, y }, end: { x: PAGE_W, y }, thickness: 0.5, color: rgb(0.95, 0.95, 0.95) });
  const bytes = await pdf.save();
  const runTag = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const docName = `_rig-eraser-${runTag}.pdf`;
  const filePath = `${userId}/eraser-rig/${runTag}.pdf`;
  const { error: upErr } = await supabase.storage.from('documents').upload(filePath, bytes, { contentType: 'application/pdf' });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);
  const { data, error: insErr } = await supabase
    .from('documents')
    .insert({ user_id: userId, name: docName, file_path: filePath, file_size: bytes.length, page_count: 1, archived: false })
    .select('id').single();
  if (insErr) throw new Error(`documents insert failed: ${insErr.message}`);
  return { documentId: data.id, docName, filePath };
}
// Fresh cold handle per operation → always reconciled with the app's edits.
async function withColdHandle(supabase, documentId, actorUserId, fn) {
  const handle = await openAnnotationDoc({
    documentId, supabase, clientId: `rig-${randomUUID().slice(0, 8)}`, actorUserId, enableLocal: false, enableRealtime: false, doc: new Y.Doc(),
  });
  try {
    return await fn(handle);
  } finally {
    await handle.drain().catch(() => {});
    await handle.destroy().catch(() => {});
  }
}
const seedPage = (supabase, documentId, actorUserId, objects) => withColdHandle(supabase, documentId, actorUserId, async (h) => {
  // syncByPageToDoc deletes every map key not in byPage → this fully replaces
  // the previous case's objects (cold handle = reconciled with app edits).
  h.applyByPage({ 1: { objects } });
  await h.drain();
});
const coldReadPage = (supabase, documentId, actorUserId) => withColdHandle(supabase, documentId, actorUserId, async (h) => (h.getByPage()?.[1]?.objects) || []);
const seedSpacesMeta = (supabase, documentId, actorUserId, spaces) => withColdHandle(supabase, documentId, actorUserId, async (h) => {
  h.setMeta('spaces', spaces);
  await h.drain();
});

// ─── browser driving ─────────────────────────────────────────────────────────
async function openDocInApp(page, docName) {
  await page.goto(`${PAGE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const tile = page.getByText(docName, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 });
  await tile.click();
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.waitForFunction(() => {
    const c = [...document.querySelectorAll('.survey-pdfjs-viewer canvas, .pdf-engine-host canvas')]
      .find((el) => el.clientWidth > 80 && el.clientHeight > 80);
    return !!c;
  }, { timeout: 45000 });
  await page.waitForTimeout(1200);
}
const appPageJSON = (page) => page.evaluate(() => {
  const p1 = window.__diagState?.annotationsByPage?.[1] || window.__diagState?.annotationsByPage?.['1'];
  return p1 ? JSON.parse(JSON.stringify(p1)) : { objects: [] };
});
async function waitForAppIds(page, wantIds, timeoutMs = 15000) {
  const want = JSON.stringify([...wantIds].sort());
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const got = await page.evaluate(() => {
      const p1 = window.__diagState?.annotationsByPage?.[1] || window.__diagState?.annotationsByPage?.['1'];
      return (p1?.objects || []).map((o, i) => o?.data?.id || o?.id || o?.annotationId || `index:${i}`).sort();
    });
    if (JSON.stringify(got) === want) return true;
    await page.waitForTimeout(300);
  }
  return false;
}
async function activateEraser(page) {
  await page.keyboard.press('e');
  await page.waitForSelector('[data-diag-eraser-wrapper="1"]', { timeout: 10000 });
  if (ERASER_SIZE !== 20) {
    const input = page.locator('input[title="Width"]').first();
    await input.waitFor({ state: 'visible', timeout: 8000 });
    await input.click({ clickCount: 3 });
    await input.fill(String(ERASER_SIZE));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const val = await input.inputValue();
    if (val !== String(ERASER_SIZE)) throw new Error(`eraser size input rejected value (${val} != ${ERASER_SIZE})`);
  }
}
const wrapperRect = (page) => page.evaluate(() => {
  const w = document.querySelector('[data-diag-eraser-wrapper="1"]');
  if (!w) return null;
  const r = w.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
async function shootWrapper(page, rect, file) {
  const buf = await page.screenshot({ clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } });
  if (file) fs.writeFileSync(file, buf);
  return PNG.sync.read(buf);
}
// page units → PNG pixel box inside a wrapper shot (deviceScaleFactor 2)
function pngBox(bbox, rect) {
  const sx = (rect.w / PAGE_W) * 2; const sy = (rect.h / PAGE_H) * 2;
  const b = clampBox(bbox);
  return { x: b.minX * sx, y: b.minY * sy, w: Math.max(2, (b.maxX - b.minX) * sx), h: Math.max(2, (b.maxY - b.minY) * sy) };
}
const toScreen = (p, rect) => ({ x: rect.x + (p.x / PAGE_W) * rect.w, y: rect.y + (p.y / PAGE_H) * rect.h });

async function performSwipe(page, rect, points, { midAt = [], cancelAtFraction = null, cancelAtEnd = false, shotBase = null } = {}) {
  const midShots = [];
  const first = toScreen(points[0], rect);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  const cancelIndex = cancelAtFraction != null ? Math.max(1, Math.floor(points.length * cancelAtFraction)) : null;
  const midIndexSet = new Map(midAt.map((f, i) => [Math.max(1, Math.min(points.length - 1, Math.floor(points.length * f))), i]));
  let sentPoints = [points[0]];
  let cancelled = false;
  for (let i = 1; i < points.length; i += 1) {
    if (cancelIndex != null && i >= cancelIndex) { cancelled = true; break; }
    const s = toScreen(points[i], rect);
    await page.mouse.move(s.x, s.y);
    sentPoints.push(points[i]);
    await page.waitForTimeout(16);
    if (midIndexSet.has(i)) {
      const shot = await shootWrapper(page, rect, shotBase ? `${shotBase}-mid${midIndexSet.get(i) + 1}.png` : null);
      midShots.push(shot);
    }
  }
  if (cancelAtEnd) cancelled = true;
  if (cancelled) {
    // Mid-gesture cancellation: dispatch a real pointercancel at the current
    // pointer position (the app's wrapper handler must see the SAME pointerId).
    const cur = toScreen(sentPoints[sentPoints.length - 1], rect);
    await page.evaluate(({ x, y }) => {
      const w = document.querySelector('[data-diag-eraser-wrapper="1"]');
      const pid = window.__rigPointerId ?? 1;
      w?.dispatchEvent(new PointerEvent('pointercancel', {
        pointerId: pid, bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse',
      }));
    }, { x: cur.x, y: cur.y });
    await page.waitForTimeout(120);
    await page.mouse.up(); // release Playwright's button state (app pointer already gone)
  } else {
    await page.mouse.up();
  }
  // Prefer the RECORDED trace (the exact page points the app computed from the
  // real events) over the intended points — the oracle must eat the same doubles.
  const recorded = await page.evaluate(() => {
    const traces = window.__rigTraces || [];
    const last = traces.length ? traces[traces.length - 1] : null;
    traces.length = 0;
    return last && last.length ? last : null;
  });
  return { midShots, sentPoints: recorded || sentPoints, cancelled };
}

async function setSpaceActive(page, on) {
  // Open the Spaces tab in the left sidebar, then flip the space's toggle
  // (a DIV with title "Turn on space"/"Turn off space", not a button).
  const already = await page.evaluate(() => window.__diagState?.activeSpaceId ?? null);
  if ((on && already === RIG_SPACE_ID) || (!on && already === null)) return;
  const tab = page.locator('button[title="Spaces"]').first();
  await tab.waitFor({ state: 'visible', timeout: 8000 });
  await tab.click();
  await page.waitForTimeout(600);
  const toggle = page.locator(`[title="${on ? 'Turn on space' : 'Turn off space'}"]`).first();
  try {
    await toggle.waitFor({ state: 'visible', timeout: 8000 });
  } catch (err) {
    const spaces = await page.evaluate(() => (window.__diagState?.spaces || []).map((s) => ({ id: s?.id, name: s?.name })));
    throw new Error(`space toggle not found (loaded spaces: ${JSON.stringify(spaces)}) — ${err.message.split('\n')[0]}`);
  }
  await toggle.click();
  await page.waitForTimeout(500);
  const active = await page.evaluate(() => window.__diagState?.activeSpaceId ?? null);
  if (on && active !== RIG_SPACE_ID) throw new Error(`space activation failed (activeSpaceId=${active})`);
  if (!on && active !== null) throw new Error(`space deactivation failed (activeSpaceId=${active})`);
}

// ─── truth evaluation ────────────────────────────────────────────────────────
function evaluateCase({ testCase, pre, post, coldPost, oracle, verdicts, shots, rect, consoleTail }) {
  const failures = [];
  const details = { verdicts: {}, checks: {} };
  // Mirror the app's persistence-time transient-key strip on every side so a
  // deliberate normalize step never reads as an erase divergence.
  const preObjs = stripTransient(pre.objects || []);
  const postObjs = stripTransient(post.objects || []);
  const preById = new Map(preObjs.map((o, i) => [objId(o, i), o]));
  const postById = new Map(postObjs.map((o, i) => [objId(o, i), o]));

  // D1 — engine consistency (oracle strips the presentation-revision field)
  const oracleObjs = stripTransient(oracle.pageAnnotations.objects || []);
  const engineMatch = deepEqualNumeric(
    postObjs.map((o) => sortKeys(o)),
    oracleObjs.map((o) => sortKeys(o)),
    1e-4,
  );
  details.checks.engineConsistency = engineMatch;
  if (!engineMatch) {
    const oracleIds = oracleObjs.map((o, i) => objId(o, i));
    const postIds = postObjs.map((o, i) => objId(o, i));
    failures.push({
      truth: 'data', check: 'D1-engine-consistency',
      message: `persisted page JSON != engine prediction (persisted ids: [${postIds.join(', ')}] vs predicted: [${oracleIds.join(', ')}])`,
    });
  }

  // D2 — semantic ground truth
  for (const [id, verdict] of Object.entries(verdicts)) {
    details.verdicts[id] = verdict;
    if (id === 'rig-control') continue;
    const preObj = preById.get(id);
    const postObj = postById.get(id);
    if (verdict === 'must-touch') {
      const untouched = postObj && canon(postObj) === canon(preObj);
      if (untouched || (postObj && deepEqualNumeric(postObj, preObj, 1e-9))) {
        failures.push({ truth: 'data', check: 'D2-semantic', id, message: `sweep clearly crossed "${id}" (correct geometry) but it survived byte-identical` });
      }
    } else if (verdict === 'must-not-touch') {
      if (!postObj) {
        failures.push({ truth: 'data', check: 'D2-semantic', id, message: `"${id}" was clearly outside the sweep but got deleted` });
      } else if (canon(postObj) !== canon(preObj) && !deepEqualNumeric(postObj, preObj, 1e-9)) {
        failures.push({ truth: 'data', check: 'D2-semantic', id, message: `"${id}" was clearly outside the sweep but its geometry changed` });
      }
    }
  }

  // D3 — sliver scan on changed ink survivors
  const slivers = {};
  for (const [id, postObj] of postById) {
    const preObj = preById.get(id);
    if (!preObj || canon(preObj) === canon(postObj)) continue;
    if (String(postObj?.type || '').toLowerCase() !== 'path') continue;
    const found = findSlivers(postObj);
    if (found.length) {
      slivers[id] = found;
      failures.push({ truth: 'data', check: 'D3-slivers', id, message: `${found.length} sliver fragment(s) persisted in "${id}": ${JSON.stringify(found.slice(0, 3))}` });
    }
  }
  details.checks.slivers = slivers;

  // D4 — durability (backend cold read == in-app state, PER ID). Deliberately
  // order-insensitive: the Y.Map cold-read iteration order can differ from the
  // in-app array order (verified content-identical) — that z-order quirk is
  // out of eraser scope and recorded informationally instead.
  const cold = stripTransient(coldPost || []);
  const coldById = new Map(cold.map((o, i) => [objId(o, i), o]));
  const durabilityProblems = [];
  for (const [id, postObj] of postById) {
    const coldObj = coldById.get(id);
    if (!coldObj) { durabilityProblems.push(`"${id}" missing from backend`); continue; }
    if (!deepEqualNumeric(sortKeys(coldObj), sortKeys(postObj), 1e-9)) {
      const key = Object.keys({ ...coldObj, ...postObj }).find((k) => !deepEqualNumeric(coldObj[k], postObj[k], 1e-9));
      durabilityProblems.push(`"${id}" differs at key "${key}"`);
    }
  }
  for (const [id] of coldById) if (!postById.has(id)) durabilityProblems.push(`extra "${id}" on backend`);
  details.checks.durability = durabilityProblems.length === 0;
  details.checks.coldOrderMatchesInApp = deepEqualNumeric(cold.map(sortKeys), postObjs.map(sortKeys), 1e-9);
  if (durabilityProblems.length) {
    failures.push({ truth: 'data', check: 'D4-durability', message: `backend cold read != in-app state after 12s (${durabilityProblems.slice(0, 3).join('; ')})` });
  }

  // PIXEL truths
  const pixelSkip = new Set(testCase.pixelSkipIds || []);
  const changedIds = new Set();
  for (const [id, preObj] of preById) {
    const postObj = postById.get(id);
    if (!postObj || canon(postObj) !== canon(preObj)) changedIds.add(id);
  }

  if (shots.before && shots.after) {
    const boxesOverlap = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
    const changedBoxes = [...preById.entries()]
      .filter(([id]) => changedIds.has(id))
      .map(([, o]) => objectBBox(o));
    for (const [id, preObj] of preById) {
      if (pixelSkip.has(id)) continue;
      const bbox = objectBBox(preObj);
      const box = pngBox(bbox, rect);
      const b = cropPng(shots.before, box.x, box.y, box.w, box.h);
      const a = cropPng(shots.after, box.x, box.y, box.w, box.h);
      const ratio = diffRatio(b, a);
      const changed = changedIds.has(id);
      if (changed && ratio < CHANGED) {
        failures.push({ truth: 'pixel', check: 'P3-commit-repaint', id, message: `"${id}" changed in data but its pixels are identical after commit (diff ${(ratio * 100).toFixed(2)}%)` });
      }
      // Untouched-region streak check: only meaningful when no data-changed
      // object's bbox overlaps this region (an erased neighbor legitimately
      // changes pixels inside an overlapping bbox).
      const contaminated = changedBoxes.some((cb) => boxesOverlap(bbox, cb));
      if (!changed && !contaminated && id !== 'rig-control' && ratio > CHANGED * 3) {
        failures.push({ truth: 'pixel', check: 'P3-commit-repaint', id, message: `"${id}" untouched in data but its pixels changed after commit (diff ${(ratio * 100).toFixed(2)}%) — lingering streak/phantom` });
      }
    }
  }

  // P1 — live feedback for objects the engine says were hit (plus explicit ghost expectations)
  const liveIds = new Set([...(oracle.touchedIdsLive || []), ...(testCase.liveMustGhostIds || [])]);
  if (shots.mids?.length && shots.before) {
    for (const id of liveIds) {
      if (pixelSkip.has(id)) continue;
      const preObj = preById.get(id);
      if (!preObj) continue;
      const box = pngBox(objectBBox(preObj), rect);
      const b = cropPng(shots.before, box.x, box.y, box.w, box.h);
      const best = Math.max(...shots.mids.map((m) => diffRatio(b, cropPng(m, box.x, box.y, box.w, box.h))));
      if (best < CHANGED) {
        failures.push({ truth: 'pixel', check: 'P1-live-feedback', id, message: `"${id}" was hit but showed ZERO live change mid-drag (best mid diff ${(best * 100).toFixed(2)}%)` });
      }
    }
    // P4 — control sentinel must stay rock stable in every mid frame
    const ctl = preById.get('rig-control');
    if (ctl) {
      const box = pngBox(objectBBox(ctl), rect);
      const b = cropPng(shots.before, box.x, box.y, box.w, box.h);
      shots.mids.forEach((m, i) => {
        const ratio = diffRatio(b, cropPng(m, box.x, box.y, box.w, box.h));
        if (ratio > STABLE * 4) {
          failures.push({ truth: 'pixel', check: 'P4-composite-stability', message: `control object shimmered mid-drag frame ${i + 1} (diff ${(ratio * 100).toFixed(2)}%) — transient blank/double composite` });
        }
      });
    }
  }

  // P2 — post-release stability across the whole wrapper
  if (shots.after && shots.stable) {
    const ratio = diffRatio(shots.after, shots.stable);
    details.checks.postReleaseStability = ratio;
    if (ratio > STABLE) {
      failures.push({ truth: 'pixel', check: 'P2-post-stability', message: `frame kept changing after commit settle (diff ${(ratio * 100).toFixed(3)}% between t+1.1s and t+1.9s) — lingering artifacts` });
    }
  }

  return { failures, details, consoleTail };
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  log(`# eraser-torture-rig — MODE=${MODE} SIZE=${ERASER_SIZE} (page radius ${PAGE_RADIUS}) SEED=${SEED_SPEC}`);
  log(`# out: ${OUT_DIR}\n`);

  // Build the case list
  let cases;
  let rngSeed = null;
  if (/^fuzz\s+\d+/i.test(SEED_SPEC)) {
    const m = SEED_SPEC.trim().split(/\s+/);
    rngSeed = Number(m[2]) || 42;
    cases = fuzzCases(Number(m[1]), rngSeed);
  } else if (SEED_SPEC !== 'known' && fs.existsSync(SEED_SPEC)) {
    const replay = JSON.parse(fs.readFileSync(SEED_SPEC, 'utf8'));
    cases = [replay.case || replay];
    log(`replaying case ${cases[0].id} from ${SEED_SPEC}\n`);
  } else {
    cases = knownCases();
  }
  const needsSpace = cases.some((c) => c.activateSpace);

  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((mode) => {
    try { localStorage.setItem('eraserMode', mode); } catch { /* */ }
    // Pointer-trace recorder: mirrors FabricEraserCanvas.pagePoint exactly
    // (same clientX floats, same live wrapper rect, same coalesced-event walk,
    // same 0.2 page-unit dedupe) so the Node-side oracle consumes the SAME
    // doubles the app's commit consumed. Reconstructing the trace from the
    // intended mouse coordinates is NOT enough: CDP mouse moves quantize to
    // device pixels, and near-tangent sweeps flip boolean topology on that.
    const PAGE_W = 612; const PAGE_H = 792;
    window.__rigTraces = [];
    let curPoints = null; let curWrap = null;
    const pagePointOf = (ev, wrap) => {
      const r = wrap.getBoundingClientRect();
      if (!r || r.width <= 0 || r.height <= 0) return null;
      return { x: ((ev.clientX - r.left) / r.width) * PAGE_W, y: ((ev.clientY - r.top) / r.height) * PAGE_H };
    };
    window.addEventListener('pointerdown', (e) => {
      window.__rigPointerId = e.pointerId;
      curWrap = e.target?.closest?.('[data-diag-eraser-wrapper]') || null;
      if (!curWrap) { curPoints = null; return; }
      const p = pagePointOf(e, curWrap);
      curPoints = p ? [p] : [];
      window.__rigTraces.push(curPoints);
    }, true);
    window.addEventListener('pointermove', (e) => {
      if (!curPoints || !curWrap || e.buttons === 0) return;
      const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const events = coalesced.length ? coalesced : [e];
      for (const ev of events) {
        const p = pagePointOf(ev, curWrap);
        const last = curPoints[curPoints.length - 1];
        if (p && (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.2)) curPoints.push(p);
      }
    }, true);
    window.addEventListener('pointerup', (e) => {
      if (!curPoints || !curWrap) { curPoints = null; curWrap = null; return; }
      const p = pagePointOf(e, curWrap);
      const last = curPoints[curPoints.length - 1];
      if (p && (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.2)) curPoints.push(p);
      curPoints = null; curWrap = null;
    }, true);
    window.addEventListener('pointercancel', () => { curPoints = null; curWrap = null; }, true);
  }, MODE);
  const page = await ctx.newPage();
  const consoleRing = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('EraserCarveDiag') || t.includes('[annotationDocSync]')) {
      consoleRing.push(t.slice(0, 300));
      if (consoleRing.length > 60) consoleRing.shift();
    }
  });

  let supabase = null; let documentId = null; let filePath = null;
  const summary = {
    startedAt: new Date().toISOString(),
    pageUrl: PAGE_URL, mode: MODE, eraserSize: ERASER_SIZE, pageRadius: PAGE_RADIUS,
    seedSpec: SEED_SPEC, rngSeed, cases: [],
  };

  try {
    log('[setup] harvesting dev auto-login session from the browser…');
    const session = await harvestSession(page);
    supabase = await makeNodeClient(session);
    const userId = session.user.id;
    log(`[setup] signed in as ${session.user.email}`);

    log('[setup] creating throwaway document…');
    const doc = await createThrowawayDoc(supabase, userId);
    documentId = doc.documentId; filePath = doc.filePath;
    summary.documentId = documentId; summary.docName = doc.docName;
    log(`[setup] document ${doc.docName} (${documentId})`);

    if (needsSpace) {
      await seedSpacesMeta(supabase, documentId, userId, [{
        id: RIG_SPACE_ID,
        name: 'Rig Space',
        assignedPages: [{
          pageId: 1, label: 'Rig Space – Page 1', wholePageIncluded: true,
          showCanvasAnnotations: true, showSurveyAnnotations: true, showBackgroundAnnotations: true,
          regions: [],
        }],
      }]);
      log('[setup] seeded spaces meta (Rig Space)');
    }

    log('[setup] opening document in the app…');
    await openDocInApp(page, doc.docName);
    await activateEraser(page);
    log(`[setup] eraser active (mode=${MODE}, size=${ERASER_SIZE})\n`);

    for (const testCase of cases) {
      const caseStart = Date.now();
      const record = {
        id: testCase.id, bug: testCase.bug ?? null, note: testCase.note,
        // 2026-07-20: the known bugs are FIXED — every case is now a hard
        // gate. A red row here is a regression, never "expected".
        pass: false, expectedToFail: false,
        failures: [], durationMs: 0,
      };
      consoleRing.length = 0;
      log(`── ${testCase.id}${testCase.bug ? ` (known bug #${testCase.bug})` : ''}`);
      try {
        // 1. reseed page 1 and wait for the app to reflect it
        await seedPage(supabase, documentId, userId, testCase.objects);
        const wantIds = testCase.objects.map((o, i) => objId(o, i));
        const synced = await waitForAppIds(page, wantIds, 15000);
        if (!synced) {
          // realtime hiccup → reload fallback
          log('   (realtime lag — reloading document)');
          await openDocInApp(page, summary.docName);
          await activateEraser(page);
          if (!(await waitForAppIds(page, wantIds, 15000))) throw new Error('app never hydrated the seeded objects');
        }
        if (testCase.activateSpace) await setSpaceActive(page, true);
        await page.waitForTimeout(500);

        // 2. PRE state (post-hydration canonical) + before shot
        const rect = await wrapperRect(page);
        if (!rect) throw new Error('eraser wrapper missing');
        const park = toScreen({ x: 585, y: 30 }, rect);
        await page.mouse.move(park.x, park.y);
        await page.waitForTimeout(350);
        const pre = await appPageJSON(page);
        const shotBase = path.join(OUT_DIR, 'shots', testCase.id);
        const before = await shootWrapper(page, rect, `${shotBase}-before.png`);

        // 3. swipes
        const allMids = [];
        const traces = [];
        let cancelledAny = false;
        for (let s = 0; s < testCase.swipes.length; s += 1) {
          const isLast = s === testCase.swipes.length - 1;
          const res = await performSwipe(page, rect, testCase.swipes[s], {
            midAt: testCase.midAt || [],
            cancelAtFraction: isLast ? (testCase.cancelAtFraction ?? null) : null,
            cancelAtEnd: isLast && testCase.cancelAtEnd === true,
            shotBase: `${shotBase}-s${s + 1}`,
          });
          allMids.push(...res.midShots);
          traces.push(res.sentPoints);
          cancelledAny = cancelledAny || res.cancelled;
          await page.waitForTimeout(650); // commit + repaint window between swipes
        }
        await page.mouse.move(park.x, park.y);
        await page.waitForTimeout(1100);
        const after = await shootWrapper(page, rect, `${shotBase}-after.png`);
        await page.waitForTimeout(800);
        const stable = await shootWrapper(page, rect, `${shotBase}-stable.png`);

        // 4. oracle: sequentially apply each swipe's trace to the PRE state.
        // canErase mirrors the app's policy blocks for this case (e.g. the
        // space-scoping contract protecting unassigned background objects).
        const blockedIds = new Set(testCase.blockedIds || []);
        let oracleState = pre;
        const touchedIdsLive = new Set();
        for (const trace of traces) {
          const r = erasePageAnnotations({
            pageAnnotations: oracleState,
            eraserPoints: trace,
            eraserRadius: PAGE_RADIUS,
            mode: MODE,
            canErase: (o, i) => !blockedIds.has(objId(o, i)),
          });
          r.touchedIds.forEach((id) => touchedIdsLive.add(id));
          oracleState = r.pageAnnotations;
        }
        const oracle = { pageAnnotations: { ...oracleState }, touchedIdsLive: [...touchedIdsLive] };
        delete oracle.pageAnnotations.eraserPresentationRevision;

        // 5. ground-truth verdicts (all swipes merged per object)
        const verdicts = {};
        for (const [i, o] of pre.objects.entries()) {
          const id = objId(o, i);
          let v = 'must-not-touch';
          for (const trace of traces) {
            const tv = groundTruthVerdict(o, trace, PAGE_RADIUS);
            if (tv === 'must-touch') { v = 'must-touch'; break; }
            if (tv === 'ambiguous') v = 'ambiguous';
          }
          // Policy-blocked objects are protected regardless of geometry.
          verdicts[id] = blockedIds.has(id) ? 'must-not-touch' : v;
        }

        // 6. post state: in-app + durable cold read (poll until stable/matching)
        await page.waitForTimeout(400);
        const post = await appPageJSON(page);
        delete post.eraserPresentationRevision;
        let coldPost = null;
        const t0 = Date.now();
        const byIdCanon = (objs) => canon(Object.fromEntries(stripTransient(objs).map((o, i) => [objId(o, i), sortKeys(o)])));
        while (Date.now() - t0 < 12000) {
          coldPost = await coldReadPage(supabase, documentId, userId);
          if (byIdCanon(coldPost) === byIdCanon(post.objects || [])) break;
          await new Promise((r) => setTimeout(r, 900));
        }

        // 7. evaluate
        const { failures, details } = evaluateCase({
          testCase, pre, post, coldPost, oracle, verdicts,
          shots: { before, after, stable, mids: allMids }, rect,
          consoleTail: consoleRing.slice(-12),
        });
        record.failures = failures;
        record.details = details;
        record.cancelled = cancelledAny;
        record.pass = failures.length === 0;

        // 8. replay file for failures
        if (!record.pass) {
          const replayFile = path.join(OUT_DIR, 'cases', `${testCase.id}.replay.json`);
          fs.writeFileSync(replayFile, JSON.stringify({
            rig: 'eraser-torture-rig', savedAt: new Date().toISOString(),
            howToReplay: `SEED=${path.relative(ROOT, replayFile)} MODE=${MODE} RADIUS=${ERASER_SIZE} PAGE_URL=${PAGE_URL} node agent-cli/eraser-torture-rig.mjs`,
            case: {
              ...testCase,
              // exact traces as executed (incl. the pre-cancel prefix); a
              // cancelled gesture replays as move-through-all-points → pointercancel
              swipes: traces,
              cancelAtFraction: null,
              cancelAtEnd: cancelledAny || undefined,
            },
            preState: pre, postState: post, coldPostState: coldPost, oraclePrediction: oracle.pageAnnotations,
            verdicts, failures, consoleTail: consoleRing.slice(-12),
          }, null, 2));
          record.replayFile = path.relative(ROOT, replayFile);
        }
        if (testCase.activateSpace) await setSpaceActive(page, false).catch((e) => log(`   (space off failed: ${e.message})`));
      } catch (err) {
        record.error = err.message;
        record.failures.push({ truth: 'rig', check: 'error', message: err.message });
        log(`   ERROR: ${err.message}`);
        if (testCase.activateSpace) await setSpaceActive(page, false).catch(() => {});
      }
      record.durationMs = Date.now() - caseStart;
      summary.cases.push(record);
      const verdictLabel = record.pass
        ? 'PASS'
        : (record.expectedToFail ? 'FAIL (expected — bug reproduced)' : 'FAIL');
      log(`   ${verdictLabel} — ${record.failures.length} finding(s), ${record.durationMs}ms`);
      for (const f of record.failures.slice(0, 6)) log(`     · [${f.check}] ${f.message}`);
      log('');
    }
  } finally {
    await browser.close().catch(() => {});
    if (supabase && documentId && !KEEP) {
      await supabase.from('documents').delete().eq('id', documentId).then(() => {}, () => {});
      if (filePath) await supabase.storage.from('documents').remove([filePath]).then(() => {}, () => {});
      log(`[cleanup] removed throwaway document ${documentId}`);
    } else if (documentId) {
      log(`[cleanup] KEEP=1 — document left in place: ${documentId}`);
    }
  }

  // ── summary ────────────────────────────────────────────────────────────────
  summary.finishedAt = new Date().toISOString();
  const reproduced = summary.cases.filter((c) => c.bug != null && !c.pass && !c.error).map((c) => c.bug);
  const missed = summary.cases.filter((c) => c.bug != null && c.pass).map((c) => c.bug);
  const newFailures = summary.cases.filter((c) => c.bug == null && !c.pass && c.id !== 'K0-baseline');
  const baseline = summary.cases.find((c) => c.id === 'K0-baseline');
  summary.knownBugsReproduced = [...new Set(reproduced)].sort();
  summary.knownBugsMissed = [...new Set(missed)].sort();
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  log('════════════════════════════════════════════════════════');
  log('CASE                              RESULT');
  for (const c of summary.cases) {
    const label = c.error ? 'ERROR' : c.pass ? 'PASS' : (c.expectedToFail ? 'FAIL*' : 'FAIL');
    log(`${c.id.padEnd(34)}${label}${c.bug ? `  (bug #${c.bug})` : ''}`);
  }
  log('  (* = expected failure: known bug reproduced)');
  if (baseline) log(`baseline sanity: ${baseline.pass ? 'PASS — rig measurements trustworthy' : 'FAIL — RIG OR APP BASELINE BROKEN, inspect first'}`);
  log(`known bugs reproduced: ${summary.knownBugsReproduced.join(', ') || 'none'}`);
  if (summary.knownBugsMissed.length) log(`known bugs NOT reproduced: ${summary.knownBugsMissed.join(', ')}`);
  if (newFailures.length) log(`NEW failures beyond the known set: ${newFailures.map((c) => c.id).join(', ')}`);
  log(`summary: ${path.join(OUT_DIR, 'summary.json')}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\nRIG FATAL:', err.stack || err.message);
  process.exit(1);
});
