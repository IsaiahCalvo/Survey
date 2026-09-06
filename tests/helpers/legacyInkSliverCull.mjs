// Historical oracle only. Production exact-contact erasing must not cull outside ink.
import { normalizeMultiPolygon } from '../../src/utils/paperAnnotationGeometry.js';

const ringSignedArea = (ring) => {
  let area = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    area += ring[previous][0] * ring[index][1] - ring[index][0] * ring[previous][1];
  }
  return area / 2;
};

const ringPerimeter = (ring) => {
  let length = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    length += Math.hypot(
      ring[index][0] - ring[previous][0],
      ring[index][1] - ring[previous][1],
    );
  }
  return length;
};

/**
 * Sliver cull for polygon-subtraction survivors (2026-07-19 eraser audit).
 * martinez diff legitimately emits arbitrarily thin crescents/ribbons (and,
 * under near-tangent input, zero-area degenerate rings) — real persisted
 * geometry that renders as hairline streaks of ink color where the user just
 * erased. The capsule lane has minPieceLen; this is its polygon counterpart:
 * drop surviving outer rings whose area OR mean thickness (2·area/perimeter)
 * is far below what a piece of ink drawn at `width` could visibly be. A full
 * pen DOT (area ≈ 0.785·width²) always survives both floors.
 */
export function cullInkSliverPolygons(polygons, width) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const numericAreaFloor = safeWidth * safeWidth * 1e-12;
  const minArea = Math.max(
    numericAreaFloor,
    Math.min(0.4 * safeWidth, 0.35 * safeWidth * safeWidth),
  );
  const minMeanWidth = 0.15 * safeWidth;
  // 2·area/perimeter is slightly below the physical width for every finite
  // ribbon because its end caps contribute perimeter. Preserve a component
  // whose real cross-section is at the public floor while still dropping
  // materially thinner debris.
  const meanWidthCullFloor = minMeanWidth * 0.94;
  const kept = [];
  for (const polygon of normalizeMultiPolygon(polygons)) {
    const [outer, ...holes] = polygon;
    if (!Array.isArray(outer) || outer.length < 4) continue;
    const area = Math.abs(ringSignedArea(outer));
    const perimeter = ringPerimeter(outer);
    if (area < minArea || perimeter <= safeWidth * 1e-12) continue;
    if ((2 * area) / perimeter < meanWidthCullFloor) continue;
    const keptHoles = holes.filter((hole) => (
      Array.isArray(hole)
      && hole.length >= 4
      && Math.abs(ringSignedArea(hole)) > numericAreaFloor
    ));
    kept.push([outer, ...keptHoles]);
  }
  return kept;
}

