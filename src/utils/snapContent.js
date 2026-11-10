/**
 * snapContent.js — the lookup behind Snap to content (Nightly 'snap-content',
 * Drawboard PDF Pro trial 2026-11-10: a 40' wall measured exactly 40' because
 * the ends landed on the drawing's own corners).
 *
 * A grid of the page's straight pieces (smartFillVector.js
 * createStraightSegmentReader), in page units. `query` answers, within a
 * tolerance, in this order: a piece's end, a piece's midpoint, the nearest
 * point along a piece. Ends win over midpoints and midpoints over the line
 * itself, whatever is nearer: the corner you aim at is the stronger intent.
 * Pure (no DOM, no pdf.js) so the Node test runner can import it.
 */

export const SNAP_CONTENT_CELL = 16;
// A piece longer than this crosses many cells; past it the grid walk stops
// (a sheet border is still found near its ends and along its first stretch).
const MAX_CELLS_PER_SEGMENT = 4096;
const KEY_OFFSET = 1 << 20;
const KEY_SPAN = 1 << 21;

const cellKey = (cx, cy) => (cy + KEY_OFFSET) * KEY_SPAN + (cx + KEY_OFFSET);

/**
 * An empty index. `add(x1, y1, x2, y2)` one piece at a time (a zero-length
 * piece is a point: an end target only), then `query(x, y, tol)`.
 */
export function createSnapContentIndex({ cellSize = SNAP_CONTENT_CELL } = {}) {
  const cell = cellSize > 0 ? cellSize : SNAP_CONTENT_CELL;
  let coords = new Float64Array(4 * 1024);
  let count = 0;
  const cells = new Map();
  let stamps = new Uint32Array(1024);
  let stamp = 0;

  const put = (cx, cy, id) => {
    const key = cellKey(cx, cy);
    const list = cells.get(key);
    if (list) { if (list[list.length - 1] !== id) list.push(id); } else cells.set(key, [id]);
  };

  function add(x1, y1, x2, y2) {
    if (!Number.isFinite(x1 + y1 + x2 + y2)) return -1;
    if (4 * (count + 1) > coords.length) {
      const grown = new Float64Array(coords.length * 2);
      grown.set(coords);
      coords = grown;
      const s = new Uint32Array(stamps.length * 2);
      s.set(stamps);
      stamps = s;
    }
    const id = count;
    coords[4 * id] = x1; coords[4 * id + 1] = y1; coords[4 * id + 2] = x2; coords[4 * id + 3] = y2;
    count += 1;
    // Every cell the piece passes through (Amanatides-Woo grid walk), so the
    // nearest point of any piece within `tol` sits in a cell `query` visits.
    let cx = Math.floor(x1 / cell);
    let cy = Math.floor(y1 / cell);
    const ex = Math.floor(x2 / cell);
    const ey = Math.floor(y2 / cell);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? cell / Math.abs(dx) : Infinity;
    const tDeltaY = dy !== 0 ? cell / Math.abs(dy) : Infinity;
    let tMaxX = dx !== 0 ? (stepX > 0 ? (cx + 1) * cell - x1 : x1 - cx * cell) / Math.abs(dx) : Infinity;
    let tMaxY = dy !== 0 ? (stepY > 0 ? (cy + 1) * cell - y1 : y1 - cy * cell) / Math.abs(dy) : Infinity;
    const steps = Math.min(MAX_CELLS_PER_SEGMENT, Math.abs(ex - cx) + Math.abs(ey - cy));
    put(cx, cy, id);
    for (let n = 0; n < steps; n += 1) {
      if (tMaxX < tMaxY) { tMaxX += tDeltaX; cx += stepX; } else { tMaxY += tDeltaY; cy += stepY; }
      put(cx, cy, id);
    }
    if (cx !== ex || cy !== ey) put(ex, ey, id); // float drift or the cell cap: keep the far end findable
    return id;
  }

  /**
   * The snap target for (x, y) within `tol` page units, or null:
   * { x, y, kind: 'end' | 'mid' | 'on', distance, segment: [x1, y1, x2, y2] }.
   * `onSegment: false` skips the along-the-line answer (Shift's angle lock).
   */
  function query(x, y, tol, { onSegment = true } = {}) {
    if (!count || !(tol > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const pad = tol + 1e-6;
    const cx0 = Math.floor((x - pad) / cell);
    const cx1 = Math.floor((x + pad) / cell);
    const cy0 = Math.floor((y - pad) / cell);
    const cy1 = Math.floor((y + pad) / cell);
    stamp += 1;
    if (stamp === 0xffffffff) { stamps.fill(0); stamp = 1; }
    let end = null; let endD = Infinity;
    let mid = null; let midD = Infinity;
    let on = null; let onD = Infinity;
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const list = cells.get(cellKey(cx, cy));
        if (!list) continue;
        for (let li = 0; li < list.length; li += 1) {
          const id = list[li];
          if (stamps[id] === stamp) continue;
          stamps[id] = stamp;
          const ax = coords[4 * id]; const ay = coords[4 * id + 1];
          const bx = coords[4 * id + 2]; const by = coords[4 * id + 3];
          const da = Math.hypot(ax - x, ay - y);
          if (da <= tol && da < endD) { endD = da; end = [ax, ay, id]; }
          const vx = bx - ax; const vy = by - ay;
          const len2 = vx * vx + vy * vy;
          if (!(len2 > 0)) continue;
          const db = Math.hypot(bx - x, by - y);
          if (db <= tol && db < endD) { endD = db; end = [bx, by, id]; }
          if (end) continue; // an end already won: midpoints and lines cannot beat it
          const mx = (ax + bx) / 2; const my = (ay + by) / 2;
          const dm = Math.hypot(mx - x, my - y);
          if (dm <= tol && dm < midD) { midD = dm; mid = [mx, my, id]; }
          if (!onSegment || mid) continue;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
          const px = ax + t * vx; const py = ay + t * vy;
          const dp = Math.hypot(px - x, py - y);
          if (dp <= tol && dp < onD) { onD = dp; on = [px, py, id]; }
        }
      }
    }
    const hit = end ? { p: end, kind: 'end', d: endD } : mid ? { p: mid, kind: 'mid', d: midD } : on ? { p: on, kind: 'on', d: onD } : null;
    if (!hit) return null;
    const id = hit.p[2];
    return {
      x: hit.p[0],
      y: hit.p[1],
      kind: hit.kind,
      distance: hit.d,
      segment: [coords[4 * id], coords[4 * id + 1], coords[4 * id + 2], coords[4 * id + 3]],
    };
  }

  return {
    add,
    query,
    get size() { return count; },
    get cellCount() { return cells.size; },
  };
}
