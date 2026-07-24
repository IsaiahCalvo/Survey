import { diff, intersection, union } from 'martinez-polygon-clipping';
import { erasePathWithCapsules } from './paperInkEraser.js';

const EPS = 1e-7;
const DEFAULT_ARC_STEPS = 18;
export const PAPER_INK_OUTLINE_MIN_WIDTH = 4;

export function shouldUsePaperInkOutline(strokeWidth) {
  const width = Number(strokeWidth);
  return Number.isFinite(width) && width >= PAPER_INK_OUTLINE_MIN_WIDTH;
}

const isPoint = (value) => (
  Array.isArray(value)
  && value.length >= 2
  && Number.isFinite(value[0])
  && Number.isFinite(value[1])
);

const samePoint = (a, b) => (
  Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS
);

export function normalizeMultiPolygon(value) {
  if (!Array.isArray(value) || value.length === 0) return [];
  if (isPoint(value[0])) return [[[...value]]];
  if (isPoint(value[0]?.[0])) return [[...value]];
  if (isPoint(value[0]?.[0]?.[0])) return value;
  return [];
}

export function intersectPolygonSets(left, right) {
  const a = normalizeMultiPolygon(left);
  const b = normalizeMultiPolygon(right);
  if (!a.length || !b.length) return [];
  return normalizeMultiPolygon(intersection(a, b));
}

function closeRing(ring) {
  if (!ring.length) return ring;
  if (!samePoint(ring[0], ring[ring.length - 1])) ring.push([...ring[0]]);
  return ring;
}

function circlePolygon(point, radius, steps = DEFAULT_ARC_STEPS * 2) {
  const ring = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([
      point.x + Math.cos(angle) * radius,
      point.y + Math.sin(angle) * radius,
    ]);
  }
  return [closeRing(ring)];
}

function capsulePolygon(a, b, radius, arcSteps = DEFAULT_ARC_STEPS) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPS) return circlePolygon(a, radius, arcSteps * 2);

  const directionAngle = Math.atan2(dy, dx);
  const ring = [];
  const startAngle = directionAngle + Math.PI / 2;

  for (let i = 0; i <= arcSteps; i += 1) {
    const angle = startAngle + (i / arcSteps) * Math.PI;
    ring.push([a.x + Math.cos(angle) * radius, a.y + Math.sin(angle) * radius]);
  }
  for (let i = 0; i <= arcSteps; i += 1) {
    const angle = startAngle + Math.PI + (i / arcSteps) * Math.PI;
    ring.push([b.x + Math.cos(angle) * radius, b.y + Math.sin(angle) * radius]);
  }

  return [closeRing(ring)];
}

export function compactPoints(points, minDistance = 0.35) {
  const compacted = [];
  for (const point of points || []) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const last = compacted[compacted.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) {
      compacted.push({ x: point.x, y: point.y });
    }
  }
  if (compacted.length === 1 && points?.length > 1) {
    const last = points[points.length - 1];
    if (last && Math.hypot(last.x - compacted[0].x, last.y - compacted[0].y) > EPS) {
      compacted.push({ x: last.x, y: last.y });
    }
  }
  return compacted;
}

function perpendicularDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= EPS) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function simplifyPoints(points, tolerance) {
  if (points.length <= 2 || tolerance <= EPS) return points;
  let maxDistance = 0;
  let splitIndex = -1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = i;
    }
  }
  if (maxDistance <= tolerance || splitIndex < 0) return [points[0], points[points.length - 1]];
  const left = simplifyPoints(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyPoints(points.slice(splitIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

export function sweptDiskPolygon(points, radius, options = {}) {
  if (!Number.isFinite(radius) || radius <= 0) return [];
  const compacted = compactPoints(points, options.minDistance ?? 0.35);
  if (!compacted.length) return [];
  if (compacted.length === 1) return normalizeMultiPolygon(circlePolygon(compacted[0], radius));

  let geometry = null;
  for (let i = 1; i < compacted.length; i += 1) {
    const capsule = capsulePolygon(compacted[i - 1], compacted[i], radius, options.arcSteps);
    geometry = geometry ? union(geometry, capsule) : capsule;
  }
  return normalizeMultiPolygon(geometry);
}

function sampleCount(points, tolerance, minimum) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return Math.max(minimum, Math.min(96, Math.ceil(length / Math.max(0.5, tolerance))));
}

export function commandsToPolylines(commands, tolerance = 0.75) {
  const polylines = [];
  let points = [];
  let current = null;
  let start = null;
  let closed = false;

  const flush = () => {
    if (points.length) polylines.push({ points, closed });
    points = [];
    current = null;
    start = null;
    closed = false;
  };

  for (const command of commands || []) {
    const op = command?.[0];
    if (op === 'M') {
      flush();
      current = { x: command[1], y: command[2] };
      start = current;
      points.push(current);
      continue;
    }
    if (!current) continue;
    if (op === 'L') {
      current = { x: command[1], y: command[2] };
      points.push(current);
    } else if (op === 'Q') {
      const p0 = current;
      const control = { x: command[1], y: command[2] };
      const p1 = { x: command[3], y: command[4] };
      const steps = sampleCount([p0, control, p1], tolerance, 4);
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const mt = 1 - t;
        points.push({
          x: mt * mt * p0.x + 2 * mt * t * control.x + t * t * p1.x,
          y: mt * mt * p0.y + 2 * mt * t * control.y + t * t * p1.y,
        });
      }
      current = p1;
    } else if (op === 'C') {
      const p0 = current;
      const c1 = { x: command[1], y: command[2] };
      const c2 = { x: command[3], y: command[4] };
      const p1 = { x: command[5], y: command[6] };
      const steps = sampleCount([p0, c1, c2, p1], tolerance, 6);
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const mt = 1 - t;
        points.push({
          x: mt ** 3 * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * p1.x,
          y: mt ** 3 * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * p1.y,
        });
      }
      current = p1;
    } else if (op === 'Z') {
      if (start && Math.hypot(current.x - start.x, current.y - start.y) > EPS) points.push(start);
      closed = true;
      flush();
    }
  }
  flush();
  return polylines;
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(area / 2);
}

function ringContains(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1])
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointOnRing(ring, point) {
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[previous];
    const b = ring[index];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= EPS) {
      if (Math.hypot(point[0] - a[0], point[1] - a[1]) <= EPS) return true;
      continue;
    }
    const cross = (point[0] - a[0]) * dy - (point[1] - a[1]) * dx;
    if (Math.abs(cross) > EPS * Math.sqrt(lengthSquared)) continue;
    const projection = (point[0] - a[0]) * dx + (point[1] - a[1]) * dy;
    if (projection >= -EPS && projection <= lengthSquared + EPS) return true;
  }
  return false;
}

function ringCoverageScore(outer, candidate) {
  let score = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    const point = candidate[index];
    if (ringContains(outer, point)) score += 2;
    else if (pointOnRing(outer, point)) score += 1;
    const next = candidate[(index + 1) % candidate.length];
    const midpoint = [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2];
    if (ringContains(outer, midpoint)) score += 2;
    else if (pointOnRing(outer, midpoint)) score += 1;
  }
  return score;
}

function groupRings(rings) {
  const entries = rings
    .map((ring) => ({ ring: closeRing(ring), area: ringArea(ring) }))
    .filter((entry) => entry.ring.length >= 4 && entry.area > EPS)
    .sort((a, b) => b.area - a.area);
  const polygons = [];
  const placed = [];

  for (const entry of entries) {
    const point = entry.ring[0];
    const containers = placed.filter((candidate) => ringContains(candidate.entry.ring, point));
    const depth = containers.length;
    if (depth % 2 === 0) {
      polygons.push([entry.ring]);
      placed.push({ entry, depth, polygonIndex: polygons.length - 1 });
    } else {
      containers.sort((a, b) => a.entry.area - b.entry.area);
      const parent = containers[0];
      polygons[parent.polygonIndex].push(entry.ring);
      placed.push({ entry, depth, polygonIndex: parent.polygonIndex });
    }
  }
  return polygons;
}

function splitWeaklySimpleRing(rawRing) {
  let ring = (rawRing || [])
    .filter(isPoint)
    .map((point) => [point[0], point[1]]);
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) {
    ring = ring.slice(0, -1);
  }

  // Consecutive duplicate vertices carry no edge and can make a later split
  // produce a zero-length loop.
  ring = ring.filter((point, index) => (
    index === 0 || !samePoint(point, ring[index - 1])
  ));
  if (ring.length < 3) return [];

  // Martinez can emit a "weakly simple" ring when two otherwise-disjoint
  // lobes touch at one vertex: A…P…A. SVG evenodd renders that correctly, but
  // feeding the ring back into a later boolean can attach the new eraser
  // boundary to the wrong lobe and manufacture a long streak outside the
  // source. Split each repeated-vertex ring into ordinary simple rings first.
  const firstIndexByPoint = new Map();
  let repeatedPair = null;
  for (let index = 0; index < ring.length; index += 1) {
    const point = ring[index];
    const key = `${Math.round(point[0] / EPS)}:${Math.round(point[1] / EPS)}`;
    const previousIndex = firstIndexByPoint.get(key);
    if (
      previousIndex != null
      && index - previousIndex > 1
      && samePoint(ring[previousIndex], point)
    ) {
      repeatedPair = [previousIndex, index];
      break;
    }
    firstIndexByPoint.set(key, index);
  }

  if (!repeatedPair) {
    const closed = closeRing(ring);
    return closed.length >= 4 && ringArea(closed) > EPS ? [closed] : [];
  }

  const [start, end] = repeatedPair;
  const firstLoop = ring.slice(start, end + 1);
  const secondLoop = [...ring.slice(end), ...ring.slice(0, start + 1)];
  return [
    ...splitWeaklySimpleRing(firstLoop),
    ...splitWeaklySimpleRing(secondLoop),
  ];
}

/**
 * Convert weakly-simple Martinez/SVG rings into ordinary polygon components.
 * Existing outer/hole roles are preserved while lobes that merely share a
 * vertex become separate outer components.
 */
export function normalizeWeaklySimplePolygonSet(value) {
  const normalized = [];
  for (const polygon of normalizeMultiPolygon(value)) {
    const [outer, ...holes] = polygon;
    const outerPieces = splitWeaklySimpleRing(outer);
    if (!outerPieces.length) continue;
    const rebuilt = outerPieces.map((ring) => [ring]);

    for (const hole of holes) {
      for (const holePiece of splitWeaklySimpleRing(hole)) {
        // Preserve the source ring's semantic role. Reclassifying every ring
        // solely by containment turns a boundary-touching evenodd hole into a
        // brand-new filled polygon. When a weak outer ring splits into lobes,
        // attach each hole to the lobe covering the most of its vertices/edges.
        let bestIndex = 0;
        let bestScore = -1;
        for (let index = 0; index < outerPieces.length; index += 1) {
          const score = ringCoverageScore(outerPieces[index], holePiece);
          if (score > bestScore) {
            bestIndex = index;
            bestScore = score;
          }
        }
        rebuilt[bestIndex].push(holePiece);
      }
    }
    normalized.push(...rebuilt);
  }
  return normalized;
}

function compactCollinearRing(rawRing) {
  let points = (rawRing || []).map((point) => [...point]);
  const first = points[0];
  const last = points[points.length - 1];
  if (
    points.length > 1
    && first[0] === last[0]
    && first[1] === last[1]
  ) {
    points.pop();
  }
  if (points.length < 4) {
    return points.length ? [...points, [...points[0]]] : [];
  }

  let changed = true;
  while (changed && points.length >= 4) {
    changed = false;
    const next = [];
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index - 1 + points.length) % points.length];
      const current = points[index];
      const following = points[(index + 1) % points.length];
      const abX = current[0] - previous[0];
      const abY = current[1] - previous[1];
      const bcX = following[0] - current[0];
      const bcY = following[1] - current[1];
      const exactlyCollinear = abX * bcY - abY * bcX === 0;
      const liesBetween = (
        (current[0] - previous[0]) * (current[0] - following[0])
        + (current[1] - previous[1]) * (current[1] - following[1])
      ) <= 0;
      if (exactlyCollinear && liesBetween) {
        changed = true;
        continue;
      }
      next.push(current);
    }
    points = next;
  }
  return points.length ? [...points, [...points[0]]] : [];
}

/**
 * Remove only exactly redundant vertices from straight polygon edges.
 * No tolerance is used: curved bite coverage and near-collinear authored
 * geometry remain represented at tiny and huge coordinate scales.
 */
export function compactCollinearPolygonSet(value) {
  return normalizeMultiPolygon(value)
    .map((polygon) => polygon
      .map(compactCollinearRing)
      .filter((ring) => ring.length >= 4))
    .filter((polygon) => polygon.length > 0);
}

export function commandsToPolygonSet(commands, {
  fill = false,
  strokeWidth = 0,
  curveTolerance = 0.75,
  simplifyTolerance = 0,
} = {}) {
  const polylines = commandsToPolylines(commands, curveTolerance);
  if (!polylines.length) return [];

  if (fill) {
    const rings = polylines
      .filter((polyline) => polyline.points.length >= 3)
      .map((polyline) => closeRing(polyline.points.map((point) => [point.x, point.y])));
    return groupRings(rings);
  }

  if (strokeWidth <= 0) return [];
  let geometry = null;
  for (const polyline of polylines) {
    const points = simplifyTolerance > EPS
      ? simplifyPoints(polyline.points, simplifyTolerance)
      : polyline.points;
    const outlined = sweptDiskPolygon(points, strokeWidth / 2);
    if (!outlined.length) continue;
    geometry = geometry ? union(geometry, outlined) : outlined;
  }
  return normalizeMultiPolygon(geometry);
}

/**
 * Convert an already-closed FILLED outline path (imported-PDF pressure ink /
 * marker dots) into the native paper-ink polygon representation.
 *
 * Unlike the plain `fill: true` mode of commandsToPolygonSet (which only
 * groups rings by containment for evenodd nesting), this also UNIONS separate
 * top-level polygons. Imported outlines are authored for the NONZERO fill
 * rule, where two partially-overlapping subpaths with the same winding stay
 * solid; under the evenodd rule native paper ink renders with, that overlap
 * would become a hole. The union removes overlaps so the evenodd result is
 * identical to the nonzero source. Nested rings (letter counters like "o")
 * survive as genuine holes either way.
 *
 * curveTolerance defaults tighter than the eraser's 0.75 because this bakes
 * the PERMANENT visual geometry at import time — one sample per 0.25 page
 * units keeps flattened cubics visually identical to the source curves even
 * at deep zoom.
 *
 * @returns {Array} multipolygon (possibly empty when the path is degenerate).
 */
export function filledOutlineCommandsToPolygonSet(commands, { curveTolerance = 0.25 } = {}) {
  const grouped = commandsToPolygonSet(commands, { fill: true, curveTolerance });
  if (grouped.length <= 1) return grouped;
  try {
    let geometry = null;
    for (const polygon of grouped) {
      geometry = geometry ? union(geometry, [polygon]) : [polygon];
    }
    const unioned = normalizeMultiPolygon(geometry);
    return unioned.length ? unioned : grouped;
  } catch {
    // martinez can reject degenerate self-touching rings; the grouped set is
    // still a faithful evenodd rendering for non-overlapping subpaths.
    return grouped;
  }
}

export function polygonSetToCommands(value) {
  const commands = [];
  for (const polygon of normalizeMultiPolygon(value)) {
    for (const ring of polygon) {
      if (!ring?.length) continue;
      commands.push(['M', ring[0][0], ring[0][1]]);
      for (let i = 1; i < ring.length; i += 1) commands.push(['L', ring[i][0], ring[i][1]]);
      commands.push(['Z']);
    }
  }
  return commands;
}

export function boundsOfCommands(commands) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const command of commands || []) {
    for (let i = 1; i + 1 < command.length; i += 2) {
      minX = Math.min(minX, command[i]);
      minY = Math.min(minY, command[i + 1]);
      maxX = Math.max(maxX, command[i]);
      maxY = Math.max(maxY, command[i + 1]);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function translateCommands(commands, dx, dy) {
  return (commands || []).map((command) => {
    if (command[0] === 'Z') return command;
    const translated = [command[0]];
    for (let i = 1; i + 1 < command.length; i += 2) {
      translated.push(command[i] + dx, command[i + 1] + dy);
    }
    return translated;
  });
}

export function translatePolygonSet(value, dx, dy) {
  return normalizeMultiPolygon(value).map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => [x + dx, y + dy])
  )));
}

function boundsIntersect(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function annotationFill(annotation) {
  const fill = annotation.fill ?? (annotation.filled ? annotation.paint : null);
  return fill && fill !== 'none' ? fill : null;
}

function annotationPolygonSet(annotation) {
  if (annotation.polygons?.length) {
    return compactCollinearPolygonSet(
      normalizeWeaklySimplePolygonSet(annotation.polygons),
    );
  }
  const fill = Boolean(annotationFill(annotation)) || annotation.eraseByBounds === true;
  const strokeWidth = annotation.strokeWidth || 0;
  return compactCollinearPolygonSet(
    normalizeWeaklySimplePolygonSet(
      commandsToPolygonSet(annotation.cmds, { fill, strokeWidth }),
    ),
  );
}

export function createInkAnnotation(points, { id, color = '#151a18', width = 12, sloppiness = 0 } = {}) {
  const normalizedSloppiness = Math.max(0, Math.min(100, Number(sloppiness) || 0)) / 100;
  const minDistance = 0.35 + width * 0.12 * normalizedSloppiness;
  const compacted = compactPoints(points, minDistance);
  const simplified = simplifyPoints(compacted, width * 0.06 * normalizedSloppiness);
  const polygons = sweptDiskPolygon(simplified, Math.max(0.5, width / 2), { minDistance: 0.01 });
  const cmds = polygonSetToCommands(polygons);
  return {
    id,
    type: 'ink',
    source: 'drawn',
    cmds,
    polygons,
    fill: color,
    stroke: null,
    strokeWidth: 0,
    sourceWidth: width,
  };
}

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
  const minArea = Math.max(0.05, Math.min(0.4 * safeWidth, 0.35 * safeWidth * safeWidth));
  const minMeanWidth = Math.max(0.08, 0.15 * safeWidth);
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
    if (area < minArea || perimeter <= 1e-9) continue;
    if ((2 * area) / perimeter < meanWidthCullFloor) continue;
    const keptHoles = holes.filter((hole) => (
      Array.isArray(hole) && hole.length >= 4 && Math.abs(ringSignedArea(hole)) > 1e-9
    ));
    kept.push([outer, ...keptHoles]);
  }
  return kept;
}

/**
 * Boolean subtraction has a non-negotiable postcondition: it may remove ink,
 * but it may never create ink outside the source. Invalid legacy rings once
 * made Martinez return a long eraser-shaped streak. Check both bounds (catches
 * even near-zero-area needles) and set difference (catches spill inside a
 * concave source's overall bounds). Any failure degrades to a no-op.
 */
export function subtractionStayedInsideSubject(result, subject, sourceWidth) {
  if (!result.length) return true;
  const tolerance = Math.max(1e-6, (Number(sourceWidth) || 1) * 1e-6);
  const subjectBounds = boundsOfCommands(polygonSetToCommands(subject));
  const resultBounds = boundsOfCommands(polygonSetToCommands(result));
  if (
    resultBounds.x < subjectBounds.x - tolerance
    || resultBounds.y < subjectBounds.y - tolerance
    || resultBounds.x + resultBounds.w > subjectBounds.x + subjectBounds.w + tolerance
    || resultBounds.y + resultBounds.h > subjectBounds.y + subjectBounds.h + tolerance
  ) {
    return false;
  }

  const sourcePolygons = normalizeMultiPolygon(subject);
  const resultPolygons = normalizeMultiPolygon(result);
  const validationVertexCount = [...sourcePolygons, ...resultPolygons].reduce(
    (total, polygon) => total + polygon.reduce(
      (sum, ring) => sum + Math.max(0, ring.length - 1),
      0,
    ),
    0,
  );
  if (validationVertexCount >= 512) {
    try {
      // The exact set proof scales substantially better than the edge-by-edge
      // audit below once repeated bites create hundreds of vertices. Inputs
      // are already split into ordinary simple rings, so Martinez no longer
      // receives the weakly-simple legacy topology that caused the historical
      // outside-subject streak. Any engine failure still fails closed.
      return normalizeMultiPolygon(diff(resultPolygons, sourcePolygons)).length === 0;
    } catch {
      return false;
    }
  }
  const sourceEdges = [];
  const coordinateKey = (value) => String(Object.is(value, -0) ? 0 : value);
  const pointKey = (point) => `${coordinateKey(point[0])},${coordinateKey(point[1])}`;
  const edgeKey = (a, b) => {
    const firstKey = pointKey(a);
    const secondKey = pointKey(b);
    return firstKey < secondKey
      ? `${firstKey}|${secondKey}`
      : `${secondKey}|${firstKey}`;
  };
  const sourceVertexKeys = new Set();
  const sourceEdgeKeys = new Set();
  for (const polygon of sourcePolygons) {
    for (const ring of polygon) {
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
        const a = ring[previous];
        const b = ring[index];
        sourceVertexKeys.add(pointKey(a));
        sourceVertexKeys.add(pointKey(b));
        sourceEdgeKeys.add(edgeKey(a, b));
        sourceEdges.push({
          a,
          b,
          minX: Math.min(a[0], b[0]),
          minY: Math.min(a[1], b[1]),
          maxX: Math.max(a[0], b[0]),
          maxY: Math.max(a[1], b[1]),
        });
      }
    }
  }

  const pointIsInsideOrOnSource = (point) => (
    sourceVertexKeys.has(pointKey(point))
    || sourceEdges.some((edge) => (
      point[0] >= edge.minX - tolerance
      && point[0] <= edge.maxX + tolerance
      && point[1] >= edge.minY - tolerance
      && point[1] <= edge.maxY + tolerance
      && pointOnRingEdge({ x: point[0], y: point[1] }, edge.a, edge.b, tolerance)
    ))
    || pointInPolygonSet({ x: point[0], y: point[1] }, sourcePolygons)
  );

  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const intersectionParameters = (a, b, c, d) => {
    const r = [b[0] - a[0], b[1] - a[1]];
    const s = [d[0] - c[0], d[1] - c[1]];
    const denominator = cross(r, s);
    const fromA = [c[0] - a[0], c[1] - a[1]];
    if (Math.abs(denominator) > EPS) {
      const t = cross(fromA, s) / denominator;
      const u = cross(fromA, r) / denominator;
      return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS
        ? [Math.max(0, Math.min(1, t))]
        : [];
    }
    if (Math.abs(cross(fromA, r)) > tolerance) return [];
    const lengthSquared = r[0] * r[0] + r[1] * r[1];
    if (lengthSquared <= EPS) return [0];
    return [c, d]
      .map((point) => (
        ((point[0] - a[0]) * r[0] + (point[1] - a[1]) * r[1]) / lengthSquared
      ))
      .filter((t) => t >= -EPS && t <= 1 + EPS)
      .map((t) => Math.max(0, Math.min(1, t)));
  };

  // Split every result edge at every source-boundary crossing, then inspect
  // each interval. This catches additions in concave gaps even when all result
  // vertices and overall bounds happen to sit inside the source bounds.
  for (const polygon of resultPolygons) {
    for (const ring of polygon) {
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
        const a = ring[previous];
        const b = ring[index];
        // Repeated subtraction preserves nearly every prior boundary edge
        // byte-for-byte. An identical source edge is already a complete
        // containment proof; avoid quadratic point/edge rescans for it.
        if (sourceEdgeKeys.has(edgeKey(a, b))) continue;
        if (!pointIsInsideOrOnSource(a) || !pointIsInsideOrOnSource(b)) return false;
        const parameters = [0, 1];
        const minX = Math.min(a[0], b[0]) - tolerance;
        const minY = Math.min(a[1], b[1]) - tolerance;
        const maxX = Math.max(a[0], b[0]) + tolerance;
        const maxY = Math.max(a[1], b[1]) + tolerance;
        for (const edge of sourceEdges) {
          if (
            edge.maxX < minX
            || edge.minX > maxX
            || edge.maxY < minY
            || edge.minY > maxY
          ) {
            continue;
          }
          parameters.push(...intersectionParameters(a, b, edge.a, edge.b));
        }
        parameters.sort((left, right) => left - right);
        for (let part = 1; part < parameters.length; part += 1) {
          if (parameters[part] - parameters[part - 1] <= EPS) continue;
          const t = (parameters[part] + parameters[part - 1]) / 2;
          const midpoint = [
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
          ];
          if (!pointIsInsideOrOnSource(midpoint)) return false;
        }
      }
    }
  }

  // An omitted source hole has no new result edge to inspect. Sample a point
  // strictly inside each hole so silently filling an entire notch/hole is also
  // rejected.
  for (const [, ...holes] of sourcePolygons) {
    for (const hole of holes) {
      const ys = [...new Set(hole.map((point) => point[1]))].sort((a, b) => a - b);
      let sample = null;
      let widest = -Infinity;
      for (let index = 1; index < ys.length; index += 1) {
        const y = (ys[index - 1] + ys[index]) / 2;
        const crossings = [];
        for (let edge = 0, previous = hole.length - 1; edge < hole.length; previous = edge, edge += 1) {
          const a = hole[previous];
          const b = hole[edge];
          if ((a[1] > y) === (b[1] > y)) continue;
          crossings.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
        crossings.sort((a, b) => a - b);
        for (let pair = 1; pair < crossings.length; pair += 2) {
          const width = crossings[pair] - crossings[pair - 1];
          if (width > widest) {
            widest = width;
            sample = [(crossings[pair] + crossings[pair - 1]) / 2, y];
          }
        }
      }
      if (
        sample
        && pointInPolygonSet({ x: sample[0], y: sample[1] }, resultPolygons)
      ) {
        return false;
      }
    }
  }
  return true;
}

function pointOnRingEdge(point, a, b, tolerance = 1e-7) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPS) {
    return Math.hypot(point.x - a[0], point.y - a[1]) <= tolerance;
  }
  const cross = (point.x - a[0]) * dy - (point.y - a[1]) * dx;
  if (Math.abs(cross) > tolerance * Math.sqrt(lengthSquared)) return false;
  const projection = (point.x - a[0]) * dx + (point.y - a[1]) * dy;
  return projection >= -tolerance && projection <= lengthSquared + tolerance;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[previous];
    const b = ring[index];
    if (pointOnRingEdge(point, a, b)) return true;
    const crosses = (a[1] > point.y) !== (b[1] > point.y);
    if (
      crosses
      && point.x < ((b[0] - a[0]) * (point.y - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonSet(point, polygons) {
  return normalizeMultiPolygon(polygons).some(([outer, ...holes]) => (
    Array.isArray(outer)
    && pointInRing(point, outer)
    && !holes.some((hole) => pointInRing(point, hole))
  ));
}

function outwardNormalForBoundaryEdge(a, b, ringArea, isHole) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPS) return null;
  const left = { x: -dy / length, y: dx / length };
  // Positive signed area means the ring interior is on the left. The eraser
  // exterior is outside an outer ring but inside a hole ring.
  const leftIsRingInterior = ringArea > 0;
  const outwardIsLeft = isHole ? leftIsRingInterior : !leftIsRingInterior;
  return outwardIsLeft ? left : { x: -left.x, y: -left.y };
}

const cross2d = (a, b) => a.x * b.y - a.y * b.x;

function raySegmentDistance(origin, direction, a, b) {
  const segment = { x: b[0] - a[0], y: b[1] - a[1] };
  const denominator = cross2d(direction, segment);
  if (Math.abs(denominator) <= EPS) return null;
  const fromOrigin = { x: a[0] - origin.x, y: a[1] - origin.y };
  const distance = cross2d(fromOrigin, segment) / denominator;
  const segmentPosition = cross2d(fromOrigin, direction) / denominator;
  if (
    distance < 0
    || segmentPosition < -EPS
    || segmentPosition > 1 + EPS
  ) {
    return null;
  }
  return distance;
}

function firstRayMaterialInterval(origin, direction, result, maximumDistance) {
  const epsilon = Math.max(1e-7, maximumDistance * 1e-5);
  const justOutside = {
    x: origin.x + direction.x * epsilon,
    y: origin.y + direction.y * epsilon,
  };
  if (!pointInPolygonSet(justOutside, result)) return null;

  const distances = [];
  for (const polygon of normalizeMultiPolygon(result)) {
    for (const ring of polygon) {
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
        const distance = raySegmentDistance(origin, direction, ring[previous], ring[index]);
        if (
          distance != null
          && distance > epsilon * 4
          && distance <= maximumDistance + epsilon
        ) {
          distances.push(distance);
        }
      }
    }
  }
  distances.sort((a, b) => a - b);
  const verificationStep = Math.max(epsilon * 8, maximumDistance * 1e-5);
  let previous = -Infinity;
  let exitDistance = null;
  for (const distance of distances) {
    if (Math.abs(distance - previous) <= verificationStep) continue;
    previous = distance;
    const afterPoint = {
      x: origin.x + direction.x * (distance + verificationStep),
      y: origin.y + direction.y * (distance + verificationStep),
    };
    const insideAfter = pointInPolygonSet(afterPoint, result);
    if (exitDistance == null && !insideAfter) {
      exitDistance = distance;
    } else if (exitDistance != null && insideAfter) {
      return { exitDistance, nextEntryDistance: distance };
    }
  }
  return exitDistance == null
    ? { exitDistance: Infinity, nextEntryDistance: Infinity }
    : { exitDistance, nextEntryDistance: Infinity };
}

function thinRibbonCleanupDepth(midpoint, normal, result, ribbonWidth) {
  const cleanupSeam = Math.max(0.005, ribbonWidth * 0.025);
  const interval = firstRayMaterialInterval(
    midpoint,
    normal,
    result,
    ribbonWidth + cleanupSeam,
  );
  if (!interval) return null;
  // Curved polygon approximations can move an analytical threshold-width band
  // inward by a few hundredths. Bias the decision toward preserving ink at
  // the floor; obvious hairlines remain far below this tolerance.
  const classificationTolerance = Math.max(0.0005, ribbonWidth * 0.001);
  if (
    !Number.isFinite(interval.exitDistance)
    || interval.exitDistance >= ribbonWidth - classificationTolerance
  ) {
    return null;
  }
  const seamDepth = interval.exitDistance + cleanupSeam;
  if (!Number.isFinite(interval.nextEntryDistance)) return seamDepth;
  return Math.min(
    seamDepth,
    interval.exitDistance
      + Math.max(0, (interval.nextEntryDistance - interval.exitDistance) / 2),
  );
}

function splitWrappedRuns(segments) {
  const runs = [];
  let current = [];
  for (const segment of segments) {
    if (segment?.thin) {
      current.push(segment);
    } else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  if (
    runs.length > 1
    && segments[0]?.thin
    && segments[segments.length - 1]?.thin
  ) {
    const first = runs.shift();
    const last = runs.pop();
    runs.unshift([...last, ...first]);
  }
  if (runs.length === 1 && runs[0].length === segments.length && segments.length > 1) {
    const middle = Math.ceil(segments.length / 2);
    return [runs[0].slice(0, middle), runs[0].slice(middle)];
  }
  return runs;
}

function coalesceRibbonRun(run) {
  const chunks = [];
  let current = [];
  let firstNormal = null;
  const minimumDot = Math.cos((10 * Math.PI) / 180);
  for (const segment of run) {
    const staysStraight = (
      !firstNormal
      || (
        firstNormal.x * segment.normal.x + firstNormal.y * segment.normal.y
      ) >= minimumDot
    );
    if (!staysStraight && current.length) {
      chunks.push(current);
      current = [];
      firstNormal = null;
    }
    if (!firstNormal) firstNormal = segment.normal;
    current.push(segment);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function ribbonPatch(chunk, ribbonWidth) {
  if (!chunk.length) return [];
  const first = chunk[0];
  const last = chunk[chunk.length - 1];
  const startLength = Math.max(EPS, Math.hypot(
    first.b.x - first.a.x,
    first.b.y - first.a.y,
  ));
  const endLength = Math.max(EPS, Math.hypot(
    last.b.x - last.a.x,
    last.b.y - last.a.y,
  ));
  const overlap = Math.max(1e-4, ribbonWidth * 0.015);
  const inward = Math.max(1e-4, ribbonWidth * 0.01);
  const start = {
    x: first.a.x - ((first.b.x - first.a.x) / startLength) * overlap,
    y: first.a.y - ((first.b.y - first.a.y) / startLength) * overlap,
  };
  const end = {
    x: last.b.x + ((last.b.x - last.a.x) / endLength) * overlap,
    y: last.b.y + ((last.b.y - last.a.y) / endLength) * overlap,
  };
  const inner = [];
  const outer = [];
  for (let index = 0; index < chunk.length; index += 1) {
    const segment = chunk[index];
    const segmentStart = index === 0 ? start : segment.a;
    const segmentEnd = index === chunk.length - 1 ? end : segment.b;
    inner.push(
      [
        segmentStart.x - segment.normal.x * inward,
        segmentStart.y - segment.normal.y * inward,
      ],
      [
        segmentEnd.x - segment.normal.x * inward,
        segmentEnd.y - segment.normal.y * inward,
      ],
    );
    outer.push(
      [
        segmentStart.x + segment.normal.x * segment.cleanupDepth,
        segmentStart.y + segment.normal.y * segment.cleanupDepth,
      ],
      [
        segmentEnd.x + segment.normal.x * segment.cleanupDepth,
        segmentEnd.y + segment.normal.y * segment.cleanupDepth,
      ],
    );
  }
  const ring = closeRing([...inner, ...outer.reverse()]);
  return normalizeMultiPolygon([ring]);
}

/**
 * Remove connected hairline ribbons only beside the actual eraser cut.
 *
 * A global eraser-radius increase is unsafe: one shallow bridge can otherwise
 * widen an unrelated deep part of a bent gesture, and symmetric expansion can
 * create a new thin ribbon on the opposite side. Instead, inspect the already
 * built eraser boundary. For each local edge, probe only the first contiguous
 * survivor interval immediately outside the cut. Sustained intervals thinner
 * than the source-width floor become one-sided ribbon patches; opposite sides,
 * distant gesture sections, and disconnected specks never participate.
 */
function removeAttachedBridge({
  result,
  eraser,
  sourceWidth,
}) {
  const safeWidth = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1;
  const minRibbonWidth = Math.max(0.08, 0.15 * safeWidth);
  const maximumEdgeLength = Math.max(0.08, Math.min(4, minRibbonWidth * 2));
  const minimumRunLength = Math.max(0.01, minRibbonWidth * 0.1);
  const patches = [];

  for (const polygon of normalizeMultiPolygon(eraser)) {
    for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
      const rawRing = polygon[ringIndex];
      const area = ringSignedArea(rawRing);
      const ring = rawRing.slice();
      if (
        ring.length > 1
        && samePoint(ring[0], ring[ring.length - 1])
      ) {
        ring.pop();
      }
      if (ring.length < 2) continue;
      const segments = [];
      for (let index = 0; index < ring.length; index += 1) {
        const start = ring[index];
        const end = ring[(index + 1) % ring.length];
        const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
        const pieces = Math.max(1, Math.ceil(length / maximumEdgeLength));
        for (let piece = 0; piece < pieces; piece += 1) {
          const t0 = piece / pieces;
          const t1 = (piece + 1) / pieces;
          const a = {
            x: start[0] + (end[0] - start[0]) * t0,
            y: start[1] + (end[1] - start[1]) * t0,
          };
          const b = {
            x: start[0] + (end[0] - start[0]) * t1,
            y: start[1] + (end[1] - start[1]) * t1,
          };
          const normal = outwardNormalForBoundaryEdge(a, b, area, ringIndex > 0);
          const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const cleanupDepth = normal
            ? thinRibbonCleanupDepth(midpoint, normal, result, minRibbonWidth)
            : null;
          segments.push({
            a,
            b,
            normal,
            length: Math.hypot(b.x - a.x, b.y - a.y),
            cleanupDepth,
            thin: Number.isFinite(cleanupDepth),
          });
        }
      }

      for (const run of splitWrappedRuns(segments)) {
        const runLength = run.reduce((total, segment) => total + segment.length, 0);
        if (runLength < minimumRunLength) continue;
        for (const chunk of coalesceRibbonRun(run)) {
          const patch = ribbonPatch(chunk, minRibbonWidth);
          if (patch.length) patches.push(patch);
        }
      }
    }
  }
  if (!patches.length) return result;

  let cleaned = result;
  for (const patch of patches) {
    cleaned = normalizeMultiPolygon(diff(cleaned, patch));
    if (!cleaned.length) break;
  }
  return cleaned;
}

export function eraseAnnotations(annotations, eraserPoints, radius, mode = 'partial') {
  // Same safety net as the per-annotation ops below: a union throw while
  // building the swept eraser disk must degrade to "nothing erased", not an
  // exception escaping into the pointer-up handler.
  let eraser;
  try {
    eraser = sweptDiskPolygon(eraserPoints, radius, { minDistance: 0.1 });
  } catch (error) {
    console.warn('Eraser disk construction failed; gesture erased nothing:', error);
    return { annotations, changedIds: [], deletedIds: [] };
  }
  if (!eraser.length) return { annotations, changedIds: [], deletedIds: [] };
  const eraserBounds = boundsOfCommands(polygonSetToCommands(eraser));
  const centerlinePoints = compactPoints(eraserPoints, 0.1);
  const capsules = centerlinePoints.length <= 1
    ? [{ a: centerlinePoints[0], b: centerlinePoints[0] }]
    : centerlinePoints.slice(1).map((point, index) => ({ a: centerlinePoints[index], b: point }));
  const next = [];
  const changedIds = [];
  const deletedIds = [];

  for (const annotation of annotations || []) {
    if (annotation.locked) {
      next.push(annotation);
      continue;
    }
    const bounds = annotation.bounds || boundsOfCommands(annotation.cmds);
    const pad = (annotation.strokeWidth || 0) / 2;
    const padded = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 };
    if (!boundsIntersect(padded, eraserBounds)) {
      next.push(annotation);
      continue;
    }

    const fillColor = annotationFill(annotation);
    const strokeWidth = annotation.strokeWidth || 0;
    const annotationEraseMode = mode === 'partial' && annotation.atomicErase ? 'full' : mode;
    // Centerline marks stay centerlines — at EVERY width (2026-07-19 root
    // fix, Drawboard/Microsoft/PDF-InkList model). Exact capsule interval
    // cutting splits the stroke where the eraser's swept circle reaches the
    // visible ink body (rEff = radius + strokeWidth/2); survivors remain
    // ordinary stroked subpaths of the SAME annotation, so stroked ink never
    // converts to filled-outline form and never touches boolean polygon ops.
    // Polygon subtraction remains ONLY for geometry that is already a filled
    // shape (imported outline ink, baked non-uniform transforms).
    if (!annotation.forcePolygon && !fillColor && strokeWidth > 0) {
      const result = erasePathWithCapsules(
        annotation.cmds,
        capsules,
        radius + strokeWidth / 2,
        0.5,
      );
      if (!result.changed) {
        next.push(annotation);
        continue;
      }
      changedIds.push(annotation.id);
      if (annotationEraseMode === 'full' || !result.pathData.length) {
        deletedIds.push(annotation.id);
        continue;
      }
      next.push({
        ...annotation,
        cmds: result.pathData,
        bounds: boundsOfCommands(result.pathData),
      });
      continue;
    }

    const subject = annotationPolygonSet(annotation);
    if (!subject.length) {
      next.push(annotation);
      continue;
    }
    // Boolean-op safety net (2026-07-19 eraser audit): martinez can throw on
    // degenerate self-touching input (e.g. "Cannot read properties of
    // undefined (reading 'holeOf')") — previously that escaped and failed the
    // whole erase. On any throw, keep this annotation unchanged (skip, never
    // delete-on-error) and let the rest of the gesture proceed.
    let overlap;
    try {
      overlap = normalizeMultiPolygon(intersection(subject, eraser));
    } catch (error) {
      console.warn('Eraser polygon intersection failed; annotation left unchanged:', annotation.id, error);
      next.push(annotation);
      continue;
    }
    if (!overlap.length) {
      next.push(annotation);
      continue;
    }

    if (annotationEraseMode === 'full') {
      changedIds.push(annotation.id);
      deletedIds.push(annotation.id);
      continue;
    }

    let result;
    try {
      result = normalizeWeaklySimplePolygonSet(diff(subject, eraser));
    } catch (error) {
      console.warn('Eraser polygon subtraction failed; annotation left unchanged:', annotation.id, error);
      next.push(annotation);
      continue;
    }
    const sourceWidth = (Number(annotation.sourceWidth) > 0 && Number(annotation.sourceWidth))
      || (Number(annotation.strokeWidth) > 0 && Number(annotation.strokeWidth))
      || 1;
    try {
      result = removeAttachedBridge({
        result,
        eraser,
        sourceWidth,
      });
      result = compactCollinearPolygonSet(
        normalizeWeaklySimplePolygonSet(result),
      );
    } catch (error) {
      // Cleanup is a quality refinement. Boolean/pathological input must not
      // turn a successful ordinary subtraction into a failed erase.
      console.warn('Attached ink bridge cleanup failed; base subtraction kept:', annotation.id, error);
    }
    result = cullInkSliverPolygons(
      result,
      sourceWidth,
    );
    try {
      if (!subtractionStayedInsideSubject(result, subject, sourceWidth)) {
        console.warn(
          'Eraser polygon subtraction tried to create ink outside its source; annotation left unchanged:',
          annotation.id,
        );
        next.push(annotation);
        continue;
      }
    } catch (error) {
      // Validation uses the same polygon engine. If malformed geometry makes
      // the proof unavailable, fail closed: preserve the old mark instead of
      // ever persisting newly-created streak geometry.
      console.warn(
        'Eraser polygon subtraction could not prove its result is contained; annotation left unchanged:',
        annotation.id,
        error,
      );
      next.push(annotation);
      continue;
    }
    changedIds.push(annotation.id);
    if (!result.length) {
      deletedIds.push(annotation.id);
      continue;
    }
    const color = fillColor
      ? fillColor
      : annotation.stroke || annotation.paint || '#151a18';
    const cmds = polygonSetToCommands(result);
    next.push({
      ...annotation,
      cmds,
      polygons: result,
      fill: color,
      stroke: null,
      strokeWidth: 0,
      filled: true,
      paint: color,
      bounds: boundsOfCommands(cmds),
    });
  }

  return { annotations: next, changedIds, deletedIds };
}
