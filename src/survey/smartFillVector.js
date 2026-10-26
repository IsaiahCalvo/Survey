/**
 * smartFillVector.js — Smart fill from the PDF's own drawing (owner 2026-10-22).
 *
 * Shop drawings like Schneider Electric's are vector PDFs: every tag is a real
 * closed path (a circle made of four curves, a box, a hexagon). Reading those
 * paths gives the exact tag outline no matter how the tag touches walls,
 * leader lines or the next tag, which is where the pixel engine
 * (smartFillEngine.js) fails: its flood leaks through anything the tag touches.
 *
 * So a tap first asks: which closed path drawn on this page holds the tap?
 * Only when the page has none that fits (scans, flattened images, tags drawn
 * as loose line pieces) does the caller fall back to the pixel engine.
 *
 * Pure (no DOM). Works on a pdf.js operator list; output is in page units
 * (the overlay's viewBox: origin top-left, y down, 1 unit = 1 PDF point).
 */

// pdf.js DrawOPS codes inside a constructPath's path data.
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;
const CURVE_STEPS = 8;

// A tag is roughly 5-120 page units across; smaller closed paths are glyphs
// or dots, larger ones are rooms, sheet borders and title blocks.
export const VECTOR_TAG_MIN_SIZE = 5;
export const VECTOR_TAG_MAX_SIZE = 120;

function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let fillOpsCache = null;
function FILL_OPS(OPS) {
  if (!fillOpsCache) {
    fillOpsCache = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  }
  return fillOpsCache;
}

function isWhite(args) {
  const v = args?.[0];
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
    return [1, 3, 5].every((i) => parseInt(v.slice(i, i + 2), 16) >= 245);
  }
  if (typeof v === 'number' && args.length >= 3) return args[0] >= 245 && args[1] >= 245 && args[2] >= 245;
  return false;
}

// The box of a path that fills its box (straight sides only: a rectangle, or
// one drawn as two triangles), else null.
function rectBox(data, tx) {
  const rings = [];
  let ring = null;
  for (let k = 0; k < data.length;) {
    const code = data[k];
    if (code === MOVE) { ring = [tx(data[k + 1], data[k + 2])]; rings.push(ring); k += 3; }
    else if (code === LINE) { if (!ring) return null; ring.push(tx(data[k + 1], data[k + 2])); k += 3; }
    else if (code === CLOSE) k += 1;
    else return null;
  }
  if (!rings.length || rings.reduce((n, r) => n + r.length, 0) > 16) return null;
  const box = pathBox(data, tx);
  if (!box) return null;
  const area = rings.reduce((sum, r) => sum + (r.length >= 3 ? ringArea(r) : 0), 0);
  return area >= 0.9 * (box[2] - box[0]) * (box[3] - box[1]) ? box : null;
}

// Bounding box (page units) of every point of a path, or null.
function pathBox(data, tx) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const see = (x, y) => {
    const [px, py] = tx(x, y);
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  };
  for (let k = 0; k < data.length;) {
    const code = data[k];
    if (code === MOVE || code === LINE) { see(data[k + 1], data[k + 2]); k += 3; }
    else if (code === CURVE) { see(data[k + 1], data[k + 2]); see(data[k + 3], data[k + 4]); see(data[k + 5], data[k + 6]); k += 7; }
    else if (code === QUAD) { see(data[k + 1], data[k + 2]); see(data[k + 3], data[k + 4]); k += 5; }
    else if (code === CLOSE) k += 1;
    else break;
  }
  return minX <= maxX ? [minX, minY, maxX, maxY] : null;
}

function finishSubpath(out, pts, curved, closedFlag, opts) {
  if (pts.length < 3) return;
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (Math.max(w, h) < opts.minSize || Math.max(w, h) > opts.maxSize || Math.min(w, h) < opts.minSize * 0.5) return;
  // Closed by a close-path, or by ending where it started.
  const gap = Math.hypot(lx - fx, ly - fy);
  if (!closedFlag && gap > Math.max(0.5, 0.02 * Math.max(w, h))) return;
  const ring = gap < 1e-6 ? pts.slice(0, -1) : pts.slice();
  const area = ringArea(ring);
  if (!(area > 0)) return;
  out.push({ ring, minX, minY, maxX, maxY, width: w, height: h, area, curved });
}

/**
 * Every closed, tag-sized path the page draws (stroked or filled; clip-only
 * paths are skipped), flattened to rings in page units. `viewportTransform`
 * is pdfPage.getViewport({ scale: 1 }).transform.
 */
export function extractClosedShapes(operatorList, OPS, viewportTransform, {
  minSize = VECTOR_TAG_MIN_SIZE,
  maxSize = VECTOR_TAG_MAX_SIZE,
  maxShapes = 20000,
} = {}) {
  const shapes = [];
  if (!operatorList?.fnArray || !OPS) return shapes;
  const opts = { minSize, maxSize };
  const { fnArray, argsArray } = operatorList;
  // Graphics state: the transform and the clip box (page units). A path
  // outside the clip is not on the sheet (CAD sheets clip one big floor plan
  // to each sheet's frame), so it must not be filled.
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let clip = null;
  let pendingClip = false;
  // Big white boxes painted later cover what is under them (a sheet's notes
  // and title block are painted over the plan): those paths are hidden too.
  let fillWhite = false;
  const covers = [];
  const base = viewportTransform || [1, 0, 0, 1, 0, 0];
  for (let i = 0; i < fnArray.length && shapes.length < maxShapes; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) { stack.push({ ctm, clip }); continue; }
    if (fn === OPS.restore) { const st = stack.pop(); if (st) ({ ctm, clip } = st); continue; }
    if (fn === OPS.transform) { ctm = multiply(ctm, args); continue; }
    if (fn === OPS.clip || fn === OPS.eoClip) { pendingClip = true; continue; }
    if (fn === OPS.setFillRGBColor) { fillWhite = isWhite(args); continue; }
    if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm, clip });
      if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = multiply(ctm, Array.from(args[0]));
      continue;
    }
    if (fn === OPS.paintFormXObjectEnd) { const st = stack.pop(); if (st) ({ ctm, clip } = st); continue; }
    if (fn !== OPS.constructPath) continue;
    const paintOp = args?.[0];
    const data = args?.[1]?.[0];
    if (!data || typeof data.length !== 'number') { pendingClip = false; continue; }
    const m = multiply(base, ctm);
    const tx = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    if (pendingClip) {
      pendingClip = false;
      const b = pathBox(data, tx);
      if (b) clip = clip ? [Math.max(clip[0], b[0]), Math.max(clip[1], b[1]), Math.min(clip[2], b[2]), Math.min(clip[3], b[3])] : b;
    }
    if (paintOp === OPS.endPath) continue; // a clip, not drawn
    if (fillWhite && FILL_OPS(OPS).has(paintOp)) {
      const cover = rectBox(data, tx);
      if (cover && (cover[2] - cover[0]) * (cover[3] - cover[1]) > 4 * maxSize * maxSize) covers.push({ box: cover, at: shapes.length });
    }
    const before = shapes.length;
    let pts = [];
    let curved = false;
    let cx = 0; let cy = 0;
    for (let k = 0; k < data.length;) {
      const code = data[k];
      if (code === MOVE) {
        finishSubpath(shapes, pts, curved, false, opts);
        cx = data[k + 1]; cy = data[k + 2];
        pts = [tx(cx, cy)];
        curved = false;
        k += 3;
      } else if (code === LINE) {
        cx = data[k + 1]; cy = data[k + 2];
        pts.push(tx(cx, cy));
        k += 3;
      } else if (code === CURVE) {
        const [x1, y1, x2, y2, x3, y3] = [data[k + 1], data[k + 2], data[k + 3], data[k + 4], data[k + 5], data[k + 6]];
        for (let s = 1; s <= CURVE_STEPS; s += 1) {
          const t = s / CURVE_STEPS; const u = 1 - t;
          const x = u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
          const y = u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
          pts.push(tx(x, y));
        }
        cx = x3; cy = y3; curved = true;
        k += 7;
      } else if (code === QUAD) {
        const [x1, y1, x2, y2] = [data[k + 1], data[k + 2], data[k + 3], data[k + 4]];
        for (let s = 1; s <= CURVE_STEPS; s += 1) {
          const t = s / CURVE_STEPS; const u = 1 - t;
          pts.push(tx(u * u * cx + 2 * u * t * x1 + t * t * x2, u * u * cy + 2 * u * t * y1 + t * t * y2));
        }
        cx = x2; cy = y2; curved = true;
        k += 5;
      } else if (code === CLOSE) {
        finishSubpath(shapes, pts, curved, true, opts);
        pts = pts.length ? [pts[0]] : [];
        curved = false;
        k += 1;
      } else {
        break; // unknown code: stop reading this path
      }
    }
    finishSubpath(shapes, pts, curved, false, opts);
    // Drop what the clip hides (mostly outside it).
    if (clip && shapes.length > before) {
      for (let k = shapes.length - 1; k >= before; k -= 1) {
        const sh = shapes[k];
        const ix = Math.max(0, Math.min(sh.maxX, clip[2]) - Math.max(sh.minX, clip[0]));
        const iy = Math.max(0, Math.min(sh.maxY, clip[3]) - Math.max(sh.minY, clip[1]));
        if (ix * iy < 0.8 * sh.width * sh.height) shapes.splice(k, 1);
      }
    }
  }
  const visible = covers.length
    ? shapes.filter((sh, index) => !covers.some(({ box, at }) => at > index
      && sh.minX >= box[0] - 0.5 && sh.maxX <= box[2] + 0.5 && sh.minY >= box[1] - 0.5 && sh.maxY <= box[3] + 0.5))
    : shapes;
  return dedupeShapes(visible);
}

// The same outline is often drawn twice (a white fill, then the stroke).
function dedupeShapes(shapes) {
  const seen = new Map();
  const out = [];
  for (const s of shapes) {
    const key = [s.minX, s.minY, s.maxX, s.maxY].map((v) => Math.round(v * 4)).join(',');
    if (seen.has(key)) continue;
    seen.set(key, true);
    out.push(s);
  }
  return out;
}

function bboxContains(outer, inner, slack) {
  return inner.minX >= outer.minX - slack && inner.maxX <= outer.maxX + slack
    && inner.minY >= outer.minY - slack && inner.maxY <= outer.maxY + slack;
}

/**
 * The tag outline that holds `point`: the smallest closed path around the
 * tap; when that path is one cell of a bigger tag (it shares the tag's edge,
 * like the lower half of a divided circle drawn as its own loop), the whole
 * tag. Overlapping tags of the same size go to the one whose middle is
 * nearest the tap. `prefer(shape)` (optional) returns true for shapes that
 * match the user's saved template shapes; those win over the rest.
 * Returns the shape or null.
 */
export function pickShapeAtPoint(shapes, point, { prefer = null } = {}) {
  const { x, y } = point;
  const holding = [];
  for (const s of shapes) {
    if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY) continue;
    if (pointInRing(x, y, s.ring)) holding.push(s);
  }
  if (!holding.length) return null;
  const pool = prefer ? (holding.filter((s) => prefer(s)).length ? holding.filter((s) => prefer(s)) : holding) : holding;
  const dist = (s) => Math.hypot((s.minX + s.maxX) / 2 - x, (s.minY + s.maxY) / 2 - y);
  pool.sort((a, b) => {
    const ratio = a.area / b.area;
    if (ratio > 0.9 && ratio < 1.1) return dist(a) - dist(b);
    return a.area - b.area;
  });
  let best = pool[0];
  // Climb from a cell to the tag that holds it.
  for (let guard = 0; guard < 4; guard += 1) {
    const parent = holding.find((s) => s !== best && s.area > best.area * 1.15 && s.area <= best.area * 6
      && bboxContains(s, best, 0.5)
      && (Math.abs(s.minX - best.minX) < 1 || Math.abs(s.maxX - best.maxX) < 1
        || Math.abs(s.minY - best.minY) < 1 || Math.abs(s.maxY - best.maxY) < 1));
    if (!parent) break;
    best = parent;
  }
  return best;
}

/** GeoJSON Polygon for a shape (page units). */
export function shapeToPolygon(shape) {
  return { type: 'Polygon', coordinates: [shape.ring.map(([px, py]) => [px, py])] };
}

// A vector answer this big may be a small room around a tag drawn as loose
// lines; the pixels then get a say.
export const VECTOR_CHECK_SIZE = 40;

/** Is the vector answer small enough to trust without asking the pixels? */
export function vectorAnswerIsTagSized(shape) {
  return Boolean(shape) && Math.max(shape.width, shape.height) <= VECTOR_CHECK_SIZE;
}

/**
 * The pixel answer wins over a big vector answer when it is a clearly
 * smaller outline inside it (the tag inside the room).
 */
export function pixelsBeatVector(shape, ring) {
  if (!shape || !Array.isArray(ring) || ring.length < 3) return false;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const inside = minX >= shape.minX - 1 && maxX <= shape.maxX + 1 && minY >= shape.minY - 1 && maxY <= shape.maxY + 1;
  return inside && (maxX - minX) * (maxY - minY) < 0.6 * shape.width * shape.height;
}
