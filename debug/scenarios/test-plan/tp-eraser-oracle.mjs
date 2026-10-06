// Exactness checks for erased ink, shared by the Part 10 walkthrough.
//
// compareWithExact is the same oracle as tests/eraserLaneCompositionRealData
// .test.mjs: on a fine grid around every eraser gesture it compares the ink
// that is SHOWN with the exact answer (the original stroke minus every
// gesture's swept disk). Two numbers come back, in square page units:
//   paintedInsideEraserArea — ink shown where an eraser went (old dabs back,
//                             slivers, hairlines)
//   missingOutsideEraserArea — ink missing where no eraser went (lost blocks)
import { PNG } from 'pngjs';

export function pathRings(path, curveSteps = 24) {
  const rings = [];
  let current = null;
  for (const command of path || []) {
    if (command[0] === 'M') {
      current = [[command[1], command[2]]];
      rings.push(current);
    } else if (command[0] === 'L') {
      current.push([command[1], command[2]]);
    } else if (command[0] === 'Q' || command[0] === 'C') {
      // Curved outlines (imported PDF ink): flatten finely.
      const [x0, y0] = current[current.length - 1];
      for (let k = 1; k <= curveSteps; k += 1) {
        const t = k / curveSteps;
        const u = 1 - t;
        if (command[0] === 'Q') {
          const [, cx, cy, x, y] = command;
          current.push([u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y]);
        } else {
          const [, c1x, c1y, c2x, c2y, x, y] = command;
          current.push([
            u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
            u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
          ]);
        }
      }
    }
  }
  return rings;
}

const evenOdd = (rings, x, y) => {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
};

const segmentDistance = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

export const eraserDistance = (p, gestures) => {
  let best = Infinity;
  for (const { points, radius } of gestures) {
    let d = Math.hypot(p.x - points[0].x, p.y - points[0].y);
    for (let i = 1; i < points.length; i += 1) d = Math.min(d, segmentDistance(p, points[i - 1], points[i]));
    best = Math.min(best, d - radius);
  }
  return best;
};

export function compareWithExact({ basePath, shownPath, gestures, step = 0.25, tolerance = 0.1, margin = 30 }) {
  const baseRings = pathRings(basePath);
  const shownRings = pathRings(shownPath);
  const points = gestures.flatMap((g) => g.points);
  const near = (x, y) => points.some((pt) => Math.abs(pt.x - x) <= margin && Math.abs(pt.y - y) <= margin);
  const minX = Math.min(...points.map((pt) => pt.x)) - margin;
  const maxX = Math.max(...points.map((pt) => pt.x)) + margin;
  const minY = Math.min(...points.map((pt) => pt.y)) - margin;
  const maxY = Math.max(...points.map((pt) => pt.y)) + margin;
  let painted = 0;
  let missing = 0;
  for (let row = Math.floor(minY / step); row * step <= maxY; row += 1) {
    const y = row * step;
    for (let col = Math.floor(minX / step); col * step <= maxX; col += 1) {
      const x = col * step;
      if (!near(x, y)) continue;
      const inBase = evenOdd(baseRings, x, y);
      const shown = evenOdd(shownRings, x, y);
      if (!inBase && !shown) continue;
      if (shown && !inBase) { painted += 1; continue; }
      const d = eraserDistance({ x, y }, gestures);
      if (shown && d < -tolerance) painted += 1;
      if (!shown && d > tolerance) missing += 1;
    }
  }
  return { paintedInsideEraserArea: painted * step * step, missingOutsideEraserArea: missing * step * step };
}

/** All eraser lanes on one stored mark, from a { laneKey: lane } object. */
export function lanesFor(lanes, storageKey) {
  return Object.entries(lanes || {})
    .filter(([key, lane]) => String(key).endsWith(` ${storageKey}`) || lane?.storageKey === storageKey || lane?.annotationId === storageKey)
    .map(([key, lane]) => ({ key, ...lane }));
}

const isInk = (png, i, ink) => ink(png.data[i], png.data[i + 1], png.data[i + 2]);
export const isRed = (r, g, b) => r > 170 && g < 90 && b < 90;
export const isDark = (r, g, b) => r + g + b < 3 * 110;

/**
 * Pixel comparison of two screenshots of the same page area. `inArea(x, y)`
 * gives the eraser's signed distance in screen px (negative inside).
 */
export function pixelDiff(beforeBuf, afterBuf, { inArea, ink = isRed, edge = 2.5 }) {
  const a = PNG.sync.read(beforeBuf);
  const b = PNG.sync.read(afterBuf);
  let inkInsideAfter = 0;
  let lostOutside = 0;
  let addedOutside = 0;
  let removed = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (a.width * y + x) * 4;
      const was = isInk(a, i, ink);
      const now = isInk(b, i, ink);
      const d = inArea(x + 0.5, y + 0.5);
      if (was && !now) removed += 1;
      if (d < -edge && now) inkInsideAfter += 1;
      if (d > edge && was && !now) lostOutside += 1;
      if (d > edge && !was && now) addedOutside += 1;
    }
  }
  return { removed, inkInsideAfter, lostOutside, addedOutside };
}
