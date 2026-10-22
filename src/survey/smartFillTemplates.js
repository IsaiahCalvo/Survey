/**
 * smartFillTemplates.js — tag shapes the user teaches Smart fill (owner
 * 2026-10-22). Pure, no DOM.
 *
 * Owner: "the user should be able to create a selection of a shape and define
 * a shape that needs to get filled. Then the app learns from that and doesn't
 * make that mistake again." A taught shape is saved in the user's survey
 * template (template.smartFillShapes), so everyone on that template gets it.
 *
 * A shape is its outline, scaled into a unit box, plus its real size:
 *   { id, name, ring: [[0..1, 0..1], ...], width, height, grid, source, createdAt }
 * `grid` is the 24 x 24 fill signature from smartFillEngine.outlineSignature
 * (page units), used to tell a matching vector path from any other.
 *
 * On a tap, Smart fill looks for one of these outlines drawn around the tap:
 *   - vector pages: a closed path with the same signature wins over others;
 *   - pixels (scans, or tags drawn as loose lines): the outline is slid over
 *     the ink near the tap at sizes 90-110% (and turned 90 degrees when it is
 *     not round); it matches where at least MATCH_MIN_SCORE of its edge lies
 *     on ink and its inside is mostly paper. Touching walls, leader lines or
 *     the next tag do not stop this, unlike the flood fill.
 */
import { dilateMask, findTagOutlineTolerant, outlineSignature, signaturesMatch } from './smartFillEngine.js';

export const MAX_TEMPLATE_SHAPES = 24;
const RING_POINTS = 64;
export const MATCH_MIN_SCORE = 0.82;
const MAX_INSIDE_INK = 0.45;

function bboxOf(ring) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Points spaced evenly along a closed ring. */
export function resampleRing(ring, count = RING_POINTS) {
  const n = ring.length;
  if (n < 3) return ring.slice();
  const lens = [];
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const len = Math.hypot(x2 - x1, y2 - y1);
    lens.push(len);
    total += len;
  }
  if (!(total > 0)) return ring.slice();
  const out = [];
  let seg = 0;
  let segStart = 0;
  for (let k = 0; k < count; k += 1) {
    const d = (k / count) * total;
    while (seg < n - 1 && segStart + lens[seg] < d) { segStart += lens[seg]; seg += 1; }
    const t = lens[seg] > 0 ? (d - segStart) / lens[seg] : 0;
    const [x1, y1] = ring[seg];
    const [x2, y2] = ring[(seg + 1) % n];
    out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  return out;
}

/** Make a template shape from an outline ring in page units. */
export function makeTemplateShape(ring, { id = null, name = 'Tag shape', source = 'vector', now = Date.now() } = {}) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const b = bboxOf(ring);
  if (!(b.width > 0 && b.height > 0)) return null;
  const unit = resampleRing(ring, RING_POINTS).map(([x, y]) => [
    Math.round(((x - b.minX) / b.width) * 1000) / 1000,
    Math.round(((y - b.minY) / b.height) * 1000) / 1000,
  ]);
  const sig = outlineSignature(ring);
  return {
    id: id || `sfs-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    ring: unit,
    width: Math.round(b.width * 100) / 100,
    height: Math.round(b.height * 100) / 100,
    grid: sig.grid,
    source,
    createdAt: new Date(now).toISOString(),
  };
}

/** True when a value looks like a saved template shape. */
export function isTemplateShape(shape) {
  return Boolean(shape && Array.isArray(shape.ring) && shape.ring.length >= 3
    && shape.width > 0 && shape.height > 0 && Array.isArray(shape.grid));
}

/** The shape's outline placed in a box (any units). */
export function placeTemplateRing(shape, left, top, width, height) {
  return shape.ring.map(([u, v]) => [left + u * width, top + v * height]);
}

/** Does a vector path (smartFillVector shape, page units) match a template shape? */
export function vectorShapeMatchesTemplate(vectorShape, templateShapes) {
  if (!templateShapes?.length) return false;
  const sig = vectorShape.signature || (vectorShape.signature = outlineSignature(vectorShape.ring));
  return templateShapes.some((t) => signaturesMatch(sig, t) || signaturesMatch(sig, { ...t, width: t.height, height: t.width, grid: turnGrid(t.grid) }));
}

function turnGrid(grid) {
  const n = Math.round(Math.sqrt(grid.length));
  const out = new Array(grid.length).fill(0);
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) out[x * n + (n - 1 - y)] = grid[y * n + x];
  return out;
}

function turnRing(ring) {
  // 90 degrees clockwise inside the unit box.
  return ring.map(([u, v]) => [1 - v, u]);
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Inside sample points of a unit ring (pulled in from the edge), for the
// "mostly paper inside" check.
function insidePoints(unitRing) {
  const pts = [];
  for (let gy = 1; gy < 10; gy += 1) {
    for (let gx = 1; gx < 10; gx += 1) {
      const u = gx / 10; const v = gy / 10;
      // Keep points well inside: the 4 neighbours a 10th away are inside too.
      if (pointInRing(u, v, unitRing) && pointInRing(u + 0.1, v, unitRing) && pointInRing(u - 0.1, v, unitRing)
        && pointInRing(u, v + 0.1, unitRing) && pointInRing(u, v - 0.1, unitRing)) pts.push([u, v]);
    }
  }
  return pts;
}

/**
 * Find a template outline drawn around (seedX, seedY) in an ink mask.
 * `templates` carry their size in page units; `pxPerUnit` maps them onto the
 * mask. `near` is the ink mask grown by ~2 px (edge tolerance). Returns
 * { ok:true, ring (mask px), score, shapeId } or { ok:false, reason:'no-template-match' }.
 */
export function matchTemplatesAt(mask, near, width, height, seedX, seedY, templates, pxPerUnit, {
  tight = null,
  scales = [0.9, 0.95, 1, 1.05, 1.1],
  minScore = MATCH_MIN_SCORE,
} = {}) {
  let best = null;
  for (const shape of templates || []) {
    if (!isTemplateShape(shape)) continue;
    const round = Math.abs(shape.width - shape.height) <= 0.08 * Math.max(shape.width, shape.height);
    const poses = round ? [{ ring: shape.ring, w: shape.width, h: shape.height }]
      : [{ ring: shape.ring, w: shape.width, h: shape.height }, { ring: turnRing(shape.ring), w: shape.height, h: shape.width }];
    for (const pose of poses) {
      const edge = resampleRing(pose.ring, RING_POINTS);
      const inner = insidePoints(pose.ring);
      for (const s of scales) {
        const w = pose.w * pxPerUnit * s;
        const h = pose.h * pxPerUnit * s;
        if (w < 6 || h < 6 || w > width || h > height) continue;
        const ex = edge.map(([u, v]) => [u * w, v * h]);
        const ix = inner.map(([u, v]) => [u * w, v * h]);
        const x0 = Math.max(0, Math.floor(seedX - w)); const x1 = Math.min(width - w, Math.ceil(seedX));
        const y0 = Math.max(0, Math.floor(seedY - h)); const y1 = Math.min(height - h, Math.ceil(seedY));
        // Big outlines step 2+ px; the edge tolerance covers the gap.
        const step = Math.max(1, Math.round(Math.max(w, h) / 80));
        for (let top = y0; top <= y1; top += step) {
          for (let left = x0; left <= x1; left += step) {
            // The tap must fall inside the placed outline.
            if (!pointInRing((seedX - left) / w, (seedY - top) / h, pose.ring)) continue;
            let on = 0;
            let miss = 0;
            const allowedMiss = Math.floor(ex.length * (1 - minScore));
            for (let k = 0; k < ex.length; k += 1) {
              const px = Math.round(left + ex[k][0]); const py = Math.round(top + ex[k][1]);
              if (px >= 0 && py >= 0 && px < width && py < height && near[py * width + px]) on += 1;
              else if (++miss > allowedMiss) break;
            }
            if (miss > allowedMiss) continue;
            // The loose edge test finds the tag; the tight one (1 px) centres
            // the outline on the drawn line instead of up to 2 px off it.
            let onTight = 0;
            if (tight) {
              for (let k = 0; k < ex.length; k += 1) {
                const px = Math.round(left + ex[k][0]); const py = Math.round(top + ex[k][1]);
                if (px >= 0 && py >= 0 && px < width && py < height && tight[py * width + px]) onTight += 1;
              }
            }
            const score = (on + onTight) / ex.length;
            if (best && score < best.score) continue;
            let inkInside = 0;
            for (const [ux, uy] of ix) {
              const px = Math.round(left + ux); const py = Math.round(top + uy);
              if (mask[py * width + px]) inkInside += 1;
            }
            if (ix.length && inkInside / ix.length > MAX_INSIDE_INK) continue;
            const cx = left + w / 2; const cy = top + h / 2;
            const dist = Math.hypot(cx - seedX, cy - seedY);
            // Higher score wins; on a tie the outline centred nearest the tap.
            if (!best || score > best.score + 1e-9 || dist < best.dist) {
              best = { score, dist, left, top, w, h, ring: pose.ring, shapeId: shape.id };
            }
          }
        }
      }
    }
  }
  if (!best) return { ok: false, reason: 'no-template-match' };
  return { ok: true, ring: placeTemplateRing({ ring: best.ring }, best.left, best.top, best.w, best.h), score: tight ? best.score / 2 : best.score, shapeId: best.shapeId };
}

/**
 * The outline of what the user boxed, from the ink inside the box (pixels).
 * `mask` covers exactly the box. Fills everything the ink encloses (the box
 * edge counts as outside), keeps the biggest piece, and snaps a round blob to
 * a true ellipse. Returns a ring in mask px, or the box itself when the box
 * holds no closed ink (the user's box is then the shape).
 */
export function outlineFromBox(mask, width, height, traceOuterLoop) {
  const outside = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0; let tail = 0;
  const push = (p) => { if (!outside[p] && !mask[p]) { outside[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < width; x += 1) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { push(y * width); push(y * width + width - 1); }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p + width < outside.length) push(p + width);
  }
  const region = new Uint8Array(width * height);
  let area = 0;
  for (let p = 0; p < region.length; p += 1) if (!outside[p]) { region[p] = 1; area += 1; }
  const boxRing = [[0, 0], [width, 0], [width, height], [0, height]];
  if (area < 0.15 * width * height) return { ring: boxRing, kind: 'box' };
  const ring = traceOuterLoop(region, width, height);
  if (!ring) return { ring: boxRing, kind: 'box' };
  const b = bboxOf(ring);
  // A filled circle covers pi/4 of its square.
  let ringArea = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) ringArea += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  ringArea = Math.abs(ringArea) / 2;
  const fill = ringArea / Math.max(1, b.width * b.height);
  if (Math.abs(fill - Math.PI / 4) < 0.05) {
    const cx = b.minX + b.width / 2; const cy = b.minY + b.height / 2;
    const ellipse = [];
    for (let k = 0; k < RING_POINTS; k += 1) {
      const a = (k / RING_POINTS) * Math.PI * 2;
      ellipse.push([cx + (b.width / 2) * Math.cos(a), cy + (b.height / 2) * Math.sin(a)]);
    }
    return { ring: ellipse, kind: 'ellipse' };
  }
  return { ring, kind: fill > 0.97 ? 'box' : 'outline' };
}

/**
 * One tap on pixels: a taught shape around the tap first, then the plain
 * flood fill (smartFillEngine). Same answer shape as findTagOutlineTolerant,
 * plus `shapeId` when a taught shape matched.
 */
export function findOutlineWithTemplates(mask, width, height, seedX, seedY, templates, pxPerUnit) {
  if (templates?.length && pxPerUnit > 0) {
    const tight = dilateMask(mask, width, height, 1);
    const near = dilateMask(tight, width, height, 1);
    const hit = matchTemplatesAt(mask, near, width, height, seedX, seedY, templates, pxPerUnit, { tight });
    if (hit.ok) {
      const xs = hit.ring.map((p) => p[0]);
      const ys = hit.ring.map((p) => p[1]);
      const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      return { ok: true, ring: hit.ring, area, shapeId: hit.shapeId, score: hit.score };
    }
  }
  return findTagOutlineTolerant(mask, width, height, seedX, seedY);
}
