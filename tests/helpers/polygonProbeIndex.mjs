// Fast exact point probes against polygon sets, for tests that sample a dense
// grid of points (2026-10-04, test-reliability pass).
//
// The brute-force probes those tests used visit EVERY edge of EVERY ring for
// EVERY sample point. On a 0.05-unit grid that is ~1.7 million points times
// ~1,000 edges, and it pushed tests/eraserLaneReviewFixes past the runner's
// 120 s per-file limit — the app work being checked took about a second.
//
// These indexes answer the same two questions with the same per-edge
// arithmetic, visiting only the edges that can possibly change the answer:
//
//   * evenOdd(x, y) — the even-odd ray-crossing parity. An edge can only flip
//     the parity at height y when one end is above y and the other is not, so
//     it can only matter when min(yi, yj) <= y <= max(yi, yj). Edges are
//     filed under every integer row their y-range touches and only the row
//     floor(y) is visited. Same edge order within a ring, same formula, so the
//     result is bit-for-bit the brute-force result.
//   * isNearEdge(x, y, tolerance) — "is the point closer than `tolerance` to
//     any edge?". An edge closer than the tolerance has the point inside its
//     bounding box grown by the tolerance, so edges are filed under every cell
//     of that grown box and only the point's cell is visited. The distance is
//     the brute-force segment distance, unchanged.
//
// Both return exactly what the brute-force loops return; the tests that use
// them also re-check a sample of points against the brute-force versions so a
// mistake here cannot quietly turn an assertion into a no-op.

const CELL = 1;

function cellOf(value) {
  return Math.floor(value / CELL);
}

function pushTo(map, key, value) {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

export function segmentDistance(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y; const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Brute-force reference versions (the original test helpers), kept here so the
// fast index can be spot-checked against them.
export function bruteEvenOdd(polygons, x, y) {
  let inside = false;
  for (const polygon of polygons || []) for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function bruteRingEdgeDistance(p, polygons) {
  let best = Infinity;
  for (const polygon of polygons) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i += 1) {
      best = Math.min(best, segmentDistance(p, { x: ring[i - 1][0], y: ring[i - 1][1] }, { x: ring[i][0], y: ring[i][1] }));
    }
  }
  return best;
}

/**
 * @param {number[][][][]} polygons  polygon set: polygons -> rings -> [x, y]
 * @param {{ nearTolerance?: number }} [options]  the largest tolerance that
 *   isNearEdge will be asked about (edges are filed with this margin).
 */
export function createPolygonProbeIndex(polygons, { nearTolerance = 0 } = {}) {
  // Parity edges: (ring[i], ring[j]) with the wrap-around edge, as bruteEvenOdd.
  const rows = new Map();
  // Distance edges: (ring[i - 1], ring[i]) without the wrap, as bruteRingEdgeDistance.
  const cells = new Map();

  for (const polygon of polygons || []) for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      const edge = [xi, yi, xj, yj];
      for (let row = cellOf(Math.min(yi, yj)), last = cellOf(Math.max(yi, yj)); row <= last; row += 1) {
        pushTo(rows, row, edge);
      }
    }
    for (let i = 1; i < ring.length; i += 1) {
      const a = { x: ring[i - 1][0], y: ring[i - 1][1] };
      const b = { x: ring[i][0], y: ring[i][1] };
      const edge = [a, b];
      const x0 = cellOf(Math.min(a.x, b.x) - nearTolerance);
      const x1 = cellOf(Math.max(a.x, b.x) + nearTolerance);
      const y0 = cellOf(Math.min(a.y, b.y) - nearTolerance);
      const y1 = cellOf(Math.max(a.y, b.y) + nearTolerance);
      for (let cy = y0; cy <= y1; cy += 1) {
        for (let cx = x0; cx <= x1; cx += 1) pushTo(cells, `${cx},${cy}`, edge);
      }
    }
  }

  return {
    evenOdd(x, y) {
      let inside = false;
      for (const [xi, yi, xj, yj] of rows.get(cellOf(y)) || []) {
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    isNearEdge(x, y, tolerance) {
      if (tolerance > nearTolerance) {
        throw new Error(`isNearEdge(${tolerance}) asked beyond the indexed tolerance ${nearTolerance}`);
      }
      const p = { x, y };
      for (const [a, b] of cells.get(`${cellOf(x)},${cellOf(y)}`) || []) {
        if (segmentDistance(p, a, b) < tolerance) return true;
      }
      return false;
    },
  };
}
