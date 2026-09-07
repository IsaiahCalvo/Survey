import { diff, intersection, union, xor } from 'martinez-polygon-clipping';
import { erasePathWithCapsules } from './paperInkEraser.js';

const EPS = 1e-7;
const DEFAULT_ARC_STEPS = 18;
// Folded strokes need tighter capsule arcs than ordinary paths so shallow
// turns do not leave a visible chord gap. The recorded defect reaches within
// 0.0024 page units of the true cursor edge, which needs 96 semicircle facets.
const FOLDED_ARC_STEPS = 96;
const ERASER_MAX_RADIAL_ERROR = 0.02;
const ERASER_CLICK_MAX_RADIAL_ERROR = 0.02;

const eraserCurveTolerance = (radius, pointCount) => Math.max(
  pointCount <= 1 ? ERASER_CLICK_MAX_RADIAL_ERROR : ERASER_MAX_RADIAL_ERROR,
  Math.abs(Number(radius) || 0) * 1e-4,
);


const isPoint = (value) => (
  Array.isArray(value)
  && value.length >= 2
  && Number.isFinite(value[0])
  && Number.isFinite(value[1])
);

const samePoint = (a, b) => (
  a[0] === b[0] && a[1] === b[1]
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

export function subtractPolygonSets(left, right) {
  const subject = normalizeMultiPolygon(left);
  const clip = normalizeMultiPolygon(right);
  if (!subject.length) return [];
  if (!clip.length) return subject;
  return normalizeMultiPolygon(diff(subject, clip));
}

const signedRingArea = (ring) => {
  let twiceArea = 0;
  for (let index = 0; index + 1 < (ring?.length || 0); index += 1) {
    twiceArea += ring[index][0] * ring[index + 1][1]
      - ring[index + 1][0] * ring[index][1];
  }
  return twiceArea / 2;
};

export function polygonSetArea(value) {
  return normalizeMultiPolygon(value).reduce((total, polygon) => {
    if (!polygon.length) return total;
    const outer = Math.abs(signedRingArea(polygon[0]));
    const holes = polygon.slice(1).reduce(
      (sum, ring) => sum + Math.abs(signedRingArea(ring)),
      0,
    );
    return total + Math.max(0, outer - holes);
  }, 0);
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
  if (length === 0) return circlePolygon(a, radius, arcSteps * 2);

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
  if (compacted.length && points?.length > 1) {
    const last = points[points.length - 1];
    const keptLast = compacted[compacted.length - 1];
    if (
      last
      && Number.isFinite(last.x)
      && Number.isFinite(last.y)
      && (last.x !== keptLast.x || last.y !== keptLast.y)
    ) {
      compacted.push({ x: last.x, y: last.y });
    }
  }
  return compacted;
}

function perpendicularDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  // The old code compared squared chord length with a linear, absolute EPS.
  // Tight flattening of a tiny imported curve then treated ordinary chords as
  // collapsed and recursed hundreds of thousands of times. Normalize by
  // `hypot` instead; this also avoids squared-distance underflow/overflow.
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const ux = dx / length;
  const uy = dy / length;
  const projection = Math.max(0, Math.min(
    length,
    (point.x - a.x) * ux + (point.y - a.y) * uy,
  ));
  return Math.hypot(
    point.x - (a.x + ux * projection),
    point.y - (a.y + uy * projection),
  );
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

function sweptDiskPolygonByCapsules(points, radius, arcSteps) {
  let geometries = [];
  for (let i = 1; i < points.length; i += 1) {
    geometries.push(capsulePolygon(points[i - 1], points[i], radius, arcSteps));
  }
  // A left-to-right union repeatedly clips a growing outline against one tiny
  // capsule, making curved legacy ink take seconds to erase. A balanced merge
  // keeps both operands similarly sized and produces the identical union with
  // logarithmic growth depth.
  while (geometries.length > 1) {
    const merged = [];
    for (let index = 0; index < geometries.length; index += 2) {
      merged.push(
        index + 1 < geometries.length
          ? union(geometries[index], geometries[index + 1])
          : geometries[index],
      );
    }
    geometries = merged;
  }
  return normalizeMultiPolygon(geometries[0]);
}

const appendDistinctPoint = (output, point) => {
  const last = output[output.length - 1];
  if (!last || last[0] !== point[0] || last[1] !== point[1]) output.push(point);
};

const appendRoundArc = (
  output,
  center,
  radius,
  startAngle,
  endAngle,
  direction,
  semicircleSteps,
) => {
  let delta = endAngle - startAngle;
  if (direction > 0) {
    while (delta < 0) delta += Math.PI * 2;
  } else {
    while (delta > 0) delta -= Math.PI * 2;
  }
  const steps = Math.max(
    1,
    Math.ceil(Math.abs(delta) / Math.PI * semicircleSteps),
  );
  for (let index = 1; index <= steps; index += 1) {
    const angle = startAngle + delta * index / steps;
    appendDistinctPoint(output, [
      center.x + Math.cos(angle) * radius,
      center.y + Math.sin(angle) * radius,
    ]);
  }
};

const segmentIntersection = (
  first,
  second,
  coordinateTolerance,
  crossTolerance,
) => {
  const orientation = (a, b, c) => (
    (b[0] - a[0]) * (c[1] - a[1])
    - (b[1] - a[1]) * (c[0] - a[0])
  );
  const onSegment = (a, b, point) => (
    point[0] >= Math.min(a[0], b[0]) - coordinateTolerance
    && point[0] <= Math.max(a[0], b[0]) + coordinateTolerance
    && point[1] >= Math.min(a[1], b[1]) - coordinateTolerance
    && point[1] <= Math.max(a[1], b[1]) + coordinateTolerance
  );
  const o1 = orientation(first.a, first.b, second.a);
  const o2 = orientation(first.a, first.b, second.b);
  const o3 = orientation(second.a, second.b, first.a);
  const o4 = orientation(second.a, second.b, first.b);
  if (
    ((o1 > crossTolerance && o2 < -crossTolerance)
      || (o1 < -crossTolerance && o2 > crossTolerance))
    && ((o3 > crossTolerance && o4 < -crossTolerance)
      || (o3 < -crossTolerance && o4 > crossTolerance))
  ) {
    return true;
  }
  return (
    (Math.abs(o1) <= crossTolerance && onSegment(first.a, first.b, second.a))
    || (Math.abs(o2) <= crossTolerance && onSegment(first.a, first.b, second.b))
    || (Math.abs(o3) <= crossTolerance && onSegment(second.a, second.b, first.a))
    || (Math.abs(o4) <= crossTolerance && onSegment(second.a, second.b, first.b))
  );
};

/**
 * Fast safety check for the direct offset ring. Most authored curves have
 * only a few neighboring edges in the active sweep set, so this is O(n log n)
 * in the ordinary case. A self-crossing or tightly folded tube is rejected
 * and handled by the capsule-union fallback below.
 */
const ringHasSelfIntersection = (ring) => {
  const edgeCount = ring.length - 1;
  if (edgeCount < 3) return true;
  let xSpan = 0;
  let ySpan = 0;
  for (const point of ring) {
    xSpan = Math.max(xSpan, Math.abs(point[0] - ring[0][0]));
    ySpan = Math.max(ySpan, Math.abs(point[1] - ring[0][1]));
  }
  const primary = xSpan >= ySpan ? 0 : 1;
  const secondary = primary === 0 ? 1 : 0;
  let maximumDelta = 0;
  const edges = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const a = ring[index];
    const b = ring[index + 1];
    maximumDelta = Math.max(
      maximumDelta,
      Math.abs(b[0] - a[0]),
      Math.abs(b[1] - a[1]),
    );
    edges.push({
      index,
      a,
      b,
      minPrimary: Math.min(a[primary], b[primary]),
      maxPrimary: Math.max(a[primary], b[primary]),
      minSecondary: Math.min(a[secondary], b[secondary]),
      maxSecondary: Math.max(a[secondary], b[secondary]),
    });
  }
  const coordinateTolerance = Math.max(
    Number.MIN_VALUE,
    maximumDelta * Number.EPSILON * 64,
  );
  const crossTolerance = Math.max(
    Number.MIN_VALUE,
    maximumDelta * maximumDelta * Number.EPSILON * 64,
  );
  edges.sort((left, right) => (
    left.minPrimary - right.minPrimary || left.index - right.index
  ));
  let active = [];
  for (const edge of edges) {
    active = active.filter((candidate) => (
      candidate.maxPrimary >= edge.minPrimary - coordinateTolerance
    ));
    for (const candidate of active) {
      const distance = Math.abs(candidate.index - edge.index);
      if (distance <= 1 || distance === edgeCount - 1) continue;
      if (
        candidate.maxSecondary < edge.minSecondary - coordinateTolerance
        || edge.maxSecondary < candidate.minSecondary - coordinateTolerance
      ) {
        continue;
      }
      if (segmentIntersection(
        candidate,
        edge,
        coordinateTolerance,
        crossTolerance,
      )) return true;
    }
    active.push(edge);
  }
  return false;
};

const pathHasSharpTurn = (points) => {
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const vertex = points[index];
    const next = points[index + 1];
    const firstLength = Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
    const secondLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    if (firstLength === 0 || secondLength === 0) continue;
    const cross = (
      ((vertex.x - previous.x) / firstLength) * ((next.y - vertex.y) / secondLength)
      - ((vertex.y - previous.y) / firstLength) * ((next.x - vertex.x) / secondLength)
    );
    const dot = (
      ((vertex.x - previous.x) / firstLength) * ((next.x - vertex.x) / secondLength)
      + ((vertex.y - previous.y) / firstLength) * ((next.y - vertex.y) / secondLength)
    );
    // A reversal has almost zero cross product, just like a straight line,
    // but is a sharp turn. Do not expand it into smooth-C precision chunks.
    if (dot <= 0 || Math.abs(cross) >= 0.25) return true;
  }
  return false;
};

const pathAccumulatedTurn = (points) => {
  let total = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const vertex = points[index];
    const next = points[index + 1];
    const firstAngle = Math.atan2(vertex.y - previous.y, vertex.x - previous.x);
    const secondAngle = Math.atan2(next.y - vertex.y, next.x - vertex.x);
    let turn = secondAngle - firstAngle;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    total += Math.abs(turn);
  }
  return total;
};

const directSweptDiskRing = (points, radius, semicircleSteps, inkOutline = false) => {
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    segments.push({
      a,
      b,
      length,
      ux: dx / length,
      uy: dy / length,
      nx: -dy / length,
      ny: dx / length,
    });
  }
  if (!segments.length) return null;
  // Eraser masks need local capsule cuts on long or sharp turns. Ink uses
  // the offset checks below: a turn alone does not make its outline unsafe.
  if (!inkOutline) {
    if (pathHasSharpTurn(points)) return null;
    if (pathAccumulatedTurn(points) >= Math.PI / 2) return null;
  }
  // A repeated first point represents a closed path. Its offset may contain
  // holes or multiple components, so leave it to the robust boolean fallback.
  if (
    points.length > 2
    && points[0].x === points.at(-1).x
    && points[0].y === points.at(-1).y
  ) {
    return null;
  }

  // A direct offset is valid only while consecutive inside joins retain a
  // positive interval on every source segment. If the two inset distances
  // meet or cross, neighboring vertex disks overlap beyond the local join
  // topology and a single offset ring can contain a false hole. The capsule
  // union is the robust path for that tight fold.
  const startInsets = [new Array(segments.length).fill(0), new Array(segments.length).fill(0)];
  const endInsets = [new Array(segments.length).fill(0), new Array(segments.length).fill(0)];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const next = segments[index];
    const cross = previous.ux * next.uy - previous.uy * next.ux;
    const dot = previous.ux * next.ux + previous.uy * next.uy;
    const turn = Math.atan2(Math.abs(cross), dot);
    if (turn >= Math.PI - Number.EPSILON * 32) return null;
    const inset = radius * Math.tan(turn / 2);
    if (!Number.isFinite(inset)) return null;
    const insideSide = cross >= 0 ? 0 : 1;
    endInsets[insideSide][index - 1] = inset;
    startInsets[insideSide][index] = inset;
  }
  for (let index = 0; index < segments.length; index += 1) {
    for (let side = 0; side < 2; side += 1) {
      if (
        startInsets[side][index] + endInsets[side][index]
        >= segments[index].length
      ) {
        return null;
      }
    }
  }

  let unsafe = false;
  const buildSide = (side) => {
    const output = [[
      segments[0].a.x + segments[0].nx * radius * side,
      segments[0].a.y + segments[0].ny * radius * side,
    ]];
    for (let index = 1; index < segments.length; index += 1) {
      const previous = segments[index - 1];
      const next = segments[index];
      const vertex = previous.b;
      const cross = previous.ux * next.uy - previous.uy * next.ux;
      const dot = previous.ux * next.ux + previous.uy * next.uy;
      if (Math.abs(cross) <= Number.EPSILON * 32) {
        if (dot < 0) {
          unsafe = true;
          return output;
        }
        appendDistinctPoint(output, [
          vertex.x + next.nx * radius * side,
          vertex.y + next.ny * radius * side,
        ]);
        continue;
      }

      const previousOffset = [
        vertex.x + previous.nx * radius * side,
        vertex.y + previous.ny * radius * side,
      ];
      const nextOffset = [
        vertex.x + next.nx * radius * side,
        vertex.y + next.ny * radius * side,
      ];
      if (cross * side < 0) {
        appendDistinctPoint(output, previousOffset);
        appendRoundArc(
          output,
          vertex,
          radius,
          Math.atan2(previous.ny * side, previous.nx * side),
          Math.atan2(next.ny * side, next.nx * side),
          cross > 0 ? 1 : -1,
          semicircleSteps,
        );
        output[output.length - 1] = nextOffset;
        continue;
      }

      // The inside of a round join is the intersection of the two offset
      // segment lines. Constructing it directly avoids unioning a circle and
      // rectangle for every flattened curve sample.
      const denominator = cross;
      const deltaX = nextOffset[0] - previousOffset[0];
      const deltaY = nextOffset[1] - previousOffset[1];
      const distance = (deltaX * next.uy - deltaY * next.ux) / denominator;
      const intersectionPoint = [
        previousOffset[0] + previous.ux * distance,
        previousOffset[1] + previous.uy * distance,
      ];
      if (!Number.isFinite(intersectionPoint[0]) || !Number.isFinite(intersectionPoint[1])) {
        unsafe = true;
        return output;
      }
      appendDistinctPoint(output, intersectionPoint);
    }
    const last = segments.at(-1);
    appendDistinctPoint(output, [
      last.b.x + last.nx * radius * side,
      last.b.y + last.ny * radius * side,
    ]);
    return output;
  };

  const left = buildSide(1);
  const right = buildSide(-1);
  if (unsafe || left.length < 2 || right.length < 2) return null;

  const first = segments[0];
  const last = segments.at(-1);
  const ring = [...left];
  appendRoundArc(
    ring,
    last.b,
    radius,
    Math.atan2(last.ny, last.nx),
    Math.atan2(-last.ny, -last.nx),
    -1,
    inkOutline ? semicircleSteps : Math.max(semicircleSteps, FOLDED_ARC_STEPS),
  );
  ring[ring.length - 1] = [...right.at(-1)];
  for (let index = right.length - 2; index >= 0; index -= 1) {
    appendDistinctPoint(ring, right[index]);
  }
  appendRoundArc(
    ring,
    first.a,
    radius,
    Math.atan2(-first.ny, -first.nx),
    Math.atan2(first.ny, first.nx),
    -1,
    semicircleSteps,
  );
  ring[ring.length - 1] = [...ring[0]];
  return ringHasSelfIntersection(ring) ? null : ring;
};

const sweptDiskSemicircleSteps = (radius, options) => {
  const requestedArcSteps = Number(options.arcSteps);
  const curveTolerance = Number(options.curveTolerance);
  if (Number.isFinite(requestedArcSteps) && requestedArcSteps > 0) {
    return Math.max(1, Math.ceil(requestedArcSteps));
  }
  if (Number.isFinite(curveTolerance) && curveTolerance > 0) {
    if (curveTolerance >= radius) return DEFAULT_ARC_STEPS;
    const maximumAngle = 2 * Math.acos(
      Math.max(-1, Math.min(1, 1 - curveTolerance / radius)),
    );
    if (Number.isFinite(maximumAngle) && maximumAngle > 0) {
      // Retain the historical 18-facet semicircle as the minimum visual
      // quality, then add facets only when the requested tolerance needs
      // them (for example a very large imported stroke).
      return Math.max(DEFAULT_ARC_STEPS, Math.ceil(Math.PI / maximumAngle));
    }
  }
  return DEFAULT_ARC_STEPS;
};

const compactSweptDiskPoints = (points, radius, options) => {
  // Sampling thresholds are geometry-relative. In particular, do not restore
  // an absolute epsilon here: imported PDF ink can legitimately be many
  // orders of magnitude smaller than one page unit.
  const minDistance = options.minDistance
    ?? Math.max(Number.MIN_VALUE, Math.min(0.35, radius * 0.1));
  return compactPoints(points, minDistance).filter((point, index, values) => (
    index === 0
    || point.x !== values[index - 1].x
    || point.y !== values[index - 1].y
  ));
};

export function sweptDiskPolygon(points, radius, options = {}) {
  if (!Number.isFinite(radius) || radius <= 0) return [];
  const compacted = compactSweptDiskPoints(points, radius, options);
  if (!compacted.length) return [];
  const semicircleSteps = sweptDiskSemicircleSteps(radius, options);
  if (compacted.length === 1) {
    const ring = circlePolygon(compacted[0], radius, semicircleSteps * 2)[0];
    if (
      ring[0][0] !== ring.at(-1)[0]
      || ring[0][1] !== ring.at(-1)[1]
    ) {
      ring.push([...ring[0]]);
    }
    return [[ring]];
  }

  const directRing = directSweptDiskRing(
    compacted, radius, semicircleSteps, options.inkOutline,
  );
  if (directRing) return [[directRing]];
  return sweptDiskPolygonByCapsules(
    compacted,
    radius,
    semicircleSteps,
  );
}

function pointTouchesEraserGesture(point, eraserPoints, radius) {
  if (!eraserPoints?.length) return false;
  const limit = Math.abs(Number(radius) || 0) + EPS;
  for (let index = 0; index < eraserPoints.length; index += 1) {
    const end = eraserPoints[index];
    const start = eraserPoints[Math.max(0, index - 1)];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, (
        (point.x - start.x) * dx + (point.y - start.y) * dy
      ) / lengthSquared))
      : 0;
    if (Math.hypot(
      point.x - (start.x + t * dx),
      point.y - (start.y + t * dy),
    ) <= limit) return true;
  }
  return false;
}

function samplePartialEraseChanges(before, after, contact, eraserPoints, radius) {
  const all = normalizeMultiPolygon([...(before || []), ...(after || []), ...(contact || [])]);
  if (!all.length) return {
    cellArea: 0,
    removedOutsideContact: [],
    retainedInsideContact: [],
    addedInk: [],
  };
  const bounds = boundsOfCommands(polygonSetToCommands(all));
  const steps = 96;
  const cellWidth = Math.max(Number.MIN_VALUE, bounds.w / steps);
  const cellHeight = Math.max(Number.MIN_VALUE, bounds.h / steps);
  const samples = {
    cellArea: cellWidth * cellHeight,
    removedOutsideContact: [],
    retainedInsideContact: [],
    addedInk: [],
  };
  const remember = (list, point) => {
    if (list.length < 64) list.push(point);
  };
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const point = {
        x: bounds.x + (column + 0.5) * cellWidth,
        y: bounds.y + (row + 0.5) * cellHeight,
      };
      const wasInk = pointInPolygonSet(point, before);
      const isInk = pointInPolygonSet(point, after);
      // Use the exact swept centerline distance here. The polygon used for
      // display has finite arc facets, so asking it whether a point touched can
      // mislabel a point a few thousandths inside the real round cursor edge.
      const wasContacted = pointTouchesEraserGesture(point, eraserPoints, radius);
      if (wasInk && !isInk && !wasContacted) {
        remember(samples.removedOutsideContact, point);
      }
      if (wasInk && isInk && wasContacted) {
        remember(samples.retainedInsideContact, point);
      }
      if (!wasInk && isInk) remember(samples.addedInk, point);
    }
  }
  return samples;
}

export function auditPartialEraseGeometry({
  before,
  after,
  eraserPoints,
  radius,
  captureLocations = false,
}) {
  const subjectBefore = normalizeMultiPolygon(before);
  const subjectAfter = normalizeMultiPolygon(after);
  const contact = sweptDiskPolygon(eraserPoints, radius, {
    minDistance: Math.max(Number.MIN_VALUE, Math.min(0.1, radius * 0.1)),
    curveTolerance: eraserCurveTolerance(radius, eraserPoints?.length || 0),
  });
  const geometryErrors = {};
  const safeGeometry = (name, operation) => {
    try {
      return operation();
    } catch (error) {
      geometryErrors[name] = String(error?.message || error);
      return [];
    }
  };
  const contactedInk = safeGeometry(
    'contactedInk',
    () => intersectPolygonSets(subjectBefore, contact),
  );
  const beforeArea = polygonSetArea(subjectBefore);
  const afterArea = polygonSetArea(subjectAfter);
  const removed = safeGeometry(
    'removed',
    () => subtractPolygonSets(subjectBefore, subjectAfter),
  );
  const netAddedArea = Math.max(0, afterArea - beforeArea);
  const added = captureLocations || netAddedArea > EPS
    ? safeGeometry(
      'added',
      () => subtractPolygonSets(subjectAfter, subjectBefore),
    )
    : [];
  const afterStayedInsideBefore = (() => {
    try {
      return subtractionStayedInsideSubject(
        subjectAfter,
        subjectBefore,
        Math.max(Number.MIN_VALUE, Math.abs(Number(radius) || 0) * 2),
      );
    } catch (error) {
      geometryErrors.addedInkContainment = String(error?.message || error);
      return false;
    }
  })();
  const violationSamples = captureLocations
    ? samplePartialEraseChanges(subjectBefore, subjectAfter, contact, eraserPoints, radius)
    : {
      cellArea: 0,
      removedOutsideContact: [],
      retainedInsideContact: [],
      addedInk: [],
    };
  const addedArea = captureLocations && !geometryErrors.added
    ? polygonSetArea(added)
    : netAddedArea;
  // Dense boolean output may contain overlapping parts. The page renders all
  // rings with one even-odd fill, so summing those parts can report far more
  // removed ink than exists. Area conservation stays stable; the independent
  // point grid above records the actual locations of forbidden changes.
  const removedArea = Math.max(0, beforeArea + addedArea - afterArea);
  const contactedInkArea = polygonSetArea(contactedInk);
  const removedOutsideContactArea = captureLocations
    ? violationSamples.removedOutsideContact.length * violationSamples.cellArea
    : Math.max(0, removedArea - contactedInkArea);
  const retainedInsideContactArea = captureLocations
    ? violationSamples.retainedInsideContact.length * violationSamples.cellArea
    : Math.max(0, contactedInkArea - removedArea);
  const auditAreaTolerance = Math.max(
    EPS,
    contactedInkArea * 1e-3,
    beforeArea * 1e-7,
  );
  const areas = {
    before: beforeArea,
    contact: polygonSetArea(contact),
    contactedInk: contactedInkArea,
    after: afterArea,
    removed: removedArea,
    added: addedArea,
    removedOutsideContact: removedOutsideContactArea,
    retainedInsideContact: retainedInsideContactArea,
  };
  return {
    before: subjectBefore,
    contact,
    contactedInk,
    after: subjectAfter,
    removed,
    added,
    removedOutsideContact: [],
    retainedInsideContact: [],
    violationSamples,
    geometryErrors,
    metricsIncomplete: Object.keys(geometryErrors).length > 0,
    areas,
    violations: {
      // Martinez can report a large `after - before` polygon when a valid
      // survivor contains touching even-odd holes. Treat that area as a debug
      // metric only. The same fail-closed edge proof used by the commit, plus
      // an independent point scan, decides whether ink was really added.
      addedInk: !afterStayedInsideBefore || violationSamples.addedInk.length > 0,
      removedOutsideContact: captureLocations
        ? violationSamples.removedOutsideContact.length > 0
        : areas.removedOutsideContact > auditAreaTolerance,
      retainedInsideContact: captureLocations
        ? violationSamples.retainedInsideContact.length > 0
        : areas.retainedInsideContact > auditAreaTolerance,
      // The independent point grid still checks all three forbidden outcomes
      // when a polygon metric fails. Keep those metric errors in the record,
      // but do not hide a usable spatial verdict behind "incomplete".
      auditIncomplete: Boolean(
        geometryErrors.contactedInk
        || geometryErrors.addedInkContainment
      ),
    },
  };
}

/**
 * A safe eraser commit representation.
 *
 * A simple swept path stays one direct offset polygon. A folded, closed, or
 * self-overlapping path starts as constant-complexity capsules, then uses a
 * balanced union tree for the ordinary fast path. Sequential fallback is
 * set-equivalent:
 * S \ (C1 ∪ ... ∪ Cn) = (...((S \ C1) \ C2) ... \ Cn).
 * The balanced union tree retains its children. If construction throws, that
 * branch stays split; if later subtraction rejects a merged branch, the same
 * branch is retried through its smaller children. Leaf capsules have a fixed
 * vertex bound, so one pathological merge cannot invalidate the gesture.
 */
function sweptDiskPolygonRecords(points, radius, options = {}) {
  if (!Number.isFinite(radius) || radius <= 0) return [];
  const compacted = compactSweptDiskPoints(points, radius, options);
  if (!compacted.length) return [];
  const semicircleSteps = sweptDiskSemicircleSteps(radius, options);
  if (compacted.length === 1) {
    return [{
      geometry: normalizeMultiPolygon(
        circlePolygon(compacted[0], radius, semicircleSteps * 2),
      ),
      children: null,
    }];
  }
  const directRing = directSweptDiskRing(compacted, radius, semicircleSteps);
  if (directRing) return [{ geometry: [[directRing]], children: null }];

  const sharpTurn = pathHasSharpTurn(compacted);
  const smoothLongTurn = !sharpTurn && pathAccumulatedTurn(compacted) >= Math.PI / 2;
  // Inscribed arcs stay within contact. Use a radius-based chord error
  // instead of charging tiny erasers for 96 facets on every sharp bite.
  // Smooth long turns retain their proven seam precision.
  const capsuleArcSteps = options.robust ? DEFAULT_ARC_STEPS
    : smoothLongTurn
      ? Math.max(semicircleSteps, Math.ceil(FOLDED_ARC_STEPS * 1.125))
      : Math.max(semicircleSteps, sweptDiskSemicircleSteps(radius, { curveTolerance: 0.002 }));
  const leaves = compacted.slice(1).map((point, index) => ({
    geometry: normalizeMultiPolygon(capsulePolygon(
      compacted[index],
      point,
      radius,
      capsuleArcSteps,
    )),
    children: null,
    fallback: normalizeMultiPolygon(capsulePolygon(compacted[index], point, radius, 18)),
  }));
  // Keep sharp bends as exact local cuts. A merged mask can produce a weakly
  // simple concave join that leaves a small contacted island after one diff.
  if (!options.robust && compacted.length <= 32 && sharpTurn) return leaves;
  const mergeRange = (start, end) => {
    if (end - start === 1) return [leaves[start]];
    const middle = start + Math.floor((end - start) / 2);
    const left = mergeRange(start, middle);
    const right = mergeRange(middle, end);
    if (left.length !== 1 || right.length !== 1) return [...left, ...right];
    try {
      return [{
        geometry: normalizeMultiPolygon(union(
          left[0].geometry,
          right[0].geometry,
        )),
        children: [left[0], right[0]],
      }];
    } catch {
      return [...left, ...right];
    }
  };
  if (smoothLongTurn) {
    const records = [];
    const chunkSize = 16;
    for (let start = 0; start < leaves.length; start += chunkSize) {
      records.push(...mergeRange(start, Math.min(leaves.length, start + chunkSize)));
    }
    return records;
  }
  return mergeRange(0, leaves.length);
}

const midpointCoordinate = (a, b) => {
  const sum = a + b;
  return Number.isFinite(sum) ? sum / 2 : a / 2 + b / 2;
};

const midpoint = (a, b) => ({
  x: midpointCoordinate(a.x, b.x),
  y: midpointCoordinate(a.y, b.y),
});

function flattenQuadratic(p0, control, p1, tolerance, output, depth = 0) {
  if (
    depth >= 18
    || perpendicularDistance(control, p0, p1)
      <= tolerance * (1 + Number.EPSILON * 64)
  ) {
    output.push(p1);
    return;
  }
  const p01 = midpoint(p0, control);
  const p12 = midpoint(control, p1);
  const split = midpoint(p01, p12);
  flattenQuadratic(p0, p01, split, tolerance, output, depth + 1);
  flattenQuadratic(split, p12, p1, tolerance, output, depth + 1);
}

function flattenCubic(p0, c1, c2, p1, tolerance, output, depth = 0) {
  const flatness = Math.max(
    perpendicularDistance(c1, p0, p1),
    perpendicularDistance(c2, p0, p1),
  );
  if (
    depth >= 18
    || flatness <= tolerance * (1 + Number.EPSILON * 64)
  ) {
    output.push(p1);
    return;
  }
  const p01 = midpoint(p0, c1);
  const p12 = midpoint(c1, c2);
  const p23 = midpoint(c2, p1);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const split = midpoint(p012, p123);
  flattenCubic(p0, p01, p012, split, tolerance, output, depth + 1);
  flattenCubic(split, p123, p23, p1, tolerance, output, depth + 1);
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
      flattenQuadratic(
        p0,
        control,
        p1,
        Number.isFinite(tolerance) && tolerance > 0 ? tolerance : Number.MIN_VALUE,
        points,
      );
      current = p1;
    } else if (op === 'C') {
      const p0 = current;
      const c1 = { x: command[1], y: command[2] };
      const c2 = { x: command[3], y: command[4] };
      const p1 = { x: command[5], y: command[6] };
      flattenCubic(
        p0,
        c1,
        c2,
        p1,
        Number.isFinite(tolerance) && tolerance > 0 ? tolerance : Number.MIN_VALUE,
        points,
      );
      current = p1;
    } else if (op === 'Z') {
      if (start && (current.x !== start.x || current.y !== start.y)) points.push(start);
      closed = true;
      flush();
    }
  }
  flush();
  return polylines;
}

function ringAreaMetrics(ring) {
  if (!ring.length) return { area: 0, logArea: -Infinity };
  const originX = ring[0][0];
  const originY = ring[0][1];
  let coordinateScale = 0;
  const translated = ring.map(([x, y]) => {
    const point = [x - originX, y - originY];
    coordinateScale = Math.max(
      coordinateScale,
      Math.abs(point[0]),
      Math.abs(point[1]),
    );
    return point;
  });
  if (!(coordinateScale > 0) || !Number.isFinite(coordinateScale)) {
    return { area: 0, logArea: -Infinity };
  }

  // Preserve the old arithmetic exactly while it is representable. Imported
  // geometry near 1e155 needs a normalized fallback because its perfectly
  // finite coordinate differences produce 1e310 cross-products; those used
  // to become Infinity-Infinity => NaN and made the valid ring disappear.
  let directTwiceArea = 0;
  let directIsFinite = true;
  for (let i = 0, j = translated.length - 1; i < translated.length; j = i, i += 1) {
    const cross = (
      translated[j][0] * translated[i][1]
      - translated[i][0] * translated[j][1]
    );
    directTwiceArea += cross;
    if (!Number.isFinite(cross) || !Number.isFinite(directTwiceArea)) {
      directIsFinite = false;
      break;
    }
  }
  if (directIsFinite) {
    const area = Math.abs(directTwiceArea / 2);
    if (area > 0) {
      return {
        area,
        logArea: Math.log(area),
      };
    }
    // A zero direct result can also be underflow, not collinearity. The
    // normalized pass below distinguishes those cases.
  }

  let normalizedTwiceArea = 0;
  let compensation = 0;
  for (let i = 0, j = translated.length - 1; i < translated.length; j = i, i += 1) {
    const cross = (
      (translated[j][0] / coordinateScale) * (translated[i][1] / coordinateScale)
      - (translated[i][0] / coordinateScale) * (translated[j][1] / coordinateScale)
    );
    const corrected = cross - compensation;
    const next = normalizedTwiceArea + corrected;
    compensation = (next - normalizedTwiceArea) - corrected;
    normalizedTwiceArea = next;
  }
  const normalizedArea = Math.abs(normalizedTwiceArea) / 2;
  if (!(normalizedArea > 0) || !Number.isFinite(normalizedArea)) {
    return { area: 0, logArea: -Infinity };
  }
  const logArea = Math.log(normalizedArea) + 2 * Math.log(coordinateScale);
  return {
    area: logArea >= Math.log(Number.MAX_VALUE)
      ? Number.MAX_VALUE
      : Math.max(Number.MIN_VALUE, Math.exp(logArea)),
    logArea,
  };
}

function ringArea(ring) {
  return ringAreaMetrics(ring).area;
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
    const midpoint = [
      midpointCoordinate(point[0], next[0]),
      midpointCoordinate(point[1], next[1]),
    ];
    if (ringContains(outer, midpoint)) score += 2;
    else if (pointOnRing(outer, midpoint)) score += 1;
  }
  return score;
}

function ringFullyContained(outer, candidate) {
  if (!candidate.length) return false;
  for (let index = 0; index < candidate.length; index += 1) {
    const point = candidate[index];
    if (!ringContains(outer, point) && !pointOnRing(outer, point)) return false;
    const next = candidate[(index + 1) % candidate.length];
    const midpoint = [
      midpointCoordinate(point[0], next[0]),
      midpointCoordinate(point[1], next[1]),
    ];
    if (!ringContains(outer, midpoint) && !pointOnRing(outer, midpoint)) return false;
  }
  return true;
}

function groupRings(rings) {
  const entries = rings
    .map((ring) => {
      const closedRing = closeRing(ring);
      return { ring: closedRing, ...ringAreaMetrics(closedRing) };
    })
    .filter((entry) => entry.ring.length >= 4 && entry.area > 0)
    .sort((a, b) => b.logArea - a.logArea);
  const polygons = [];
  const placed = [];

  for (const entry of entries) {
    const containers = placed.filter((candidate) => (
      ringFullyContained(candidate.entry.ring, entry.ring)
    ));
    const depth = containers.length;
    if (depth % 2 === 0) {
      polygons.push([entry.ring]);
      placed.push({ entry, depth, polygonIndex: polygons.length - 1 });
    } else {
      containers.sort((a, b) => a.entry.logArea - b.entry.logArea);
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
    return closed.length >= 4 && ringArea(closed) > 0 ? [closed] : [];
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
  // A page-space floor from an upstream renderer must not flatten a tiny
  // curved stroke into its endpoint chord. For stroked paths, cap curve error
  // by a fraction of the actual width; filled outlines keep the caller's
  // explicit tolerance because they have no trustworthy width.
  const outlineCurveTolerance = (
    !fill
    && Number.isFinite(strokeWidth)
    && strokeWidth > 0
    && Number.isFinite(curveTolerance)
    && curveTolerance > 0
  )
    ? Math.min(curveTolerance, strokeWidth * 0.05)
    : curveTolerance;
  const polylines = commandsToPolylines(commands, outlineCurveTolerance);
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
    const outlined = sweptDiskPolygon(
      points,
      strokeWidth / 2,
      { curveTolerance: outlineCurveTolerance, inkOutline: true },
    );
    if (!outlined.length) continue;
    geometry = geometry ? union(geometry, outlined) : outlined;
  }
  return normalizeMultiPolygon(geometry);
}

const styledRingGeometry = (points) => {
  if (points.length < 3) return [];
  const ring = points.map((point) => [...point]);
  closeRing(ring);
  return [[ring]];
};

export function roundCircleStepCount(radius, tolerance, minimum = 24) {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  const safeMinimum = Math.max(3, Math.ceil(Number(minimum) || 0));
  if (!Number.isFinite(tolerance) || tolerance <= 0) return safeMinimum;
  const ratio = Math.min(1, tolerance / radius);
  if (ratio >= 1) return safeMinimum;
  // acos(1-ratio) loses the ratio entirely below machine epsilon. Its small
  // angle limit is sqrt(2*ratio), which keeps tessellation proportional down
  // to microscopic authored units without a facet ceiling.
  const halfAngle = ratio < 1e-8
    ? Math.sqrt(2 * ratio)
    : Math.acos(1 - ratio);
  if (!Number.isFinite(halfAngle) || halfAngle <= 0) return safeMinimum;
  return Math.max(safeMinimum, Math.ceil(Math.PI / halfAngle));
}

const styledCircleGeometry = (point, radius, tolerance) => {
  if (radius <= 0) return [];
  const steps = roundCircleStepCount(radius, tolerance);
  return styledRingGeometry(Array.from({ length: steps }, (_unused, index) => {
    const angle = index / steps * 2 * Math.PI;
    return [
      point.x + Math.cos(angle) * radius,
      point.y + Math.sin(angle) * radius,
    ];
  }));
};

const mergeStyledStrokeGeometries = (values) => {
  let groups = values
    .map(normalizeMultiPolygon)
    .filter((value) => value.length)
    .map((geometry) => ({ geometry, mergeable: true }));
  while (groups.length > 1) {
    const next = [];
    for (let index = 0; index < groups.length; index += 2) {
      const left = groups[index];
      const right = groups[index + 1];
      if (!right) {
        next.push(left);
        continue;
      }
      if (!left.mergeable || !right.mergeable) {
        next.push({
          geometry: [...left.geometry, ...right.geometry],
          mergeable: false,
        });
        continue;
      }
      try {
        const joined = normalizeMultiPolygon(union(left.geometry, right.geometry));
        if (joined.length === 0) {
          next.push({
            geometry: [...left.geometry, ...right.geometry],
            mergeable: false,
          });
          continue;
        }
        next.push({
          geometry: joined,
          mergeable: true,
        });
      } catch {
        // Martinez can fail on valid, near-collinear rings that share an edge.
        // Keep those raw outline parts and do not send them back into Martinez.
        next.push({
          geometry: [...left.geometry, ...right.geometry],
          mergeable: false,
        });
      }
    }
    groups = next;
  }
  return groups[0]?.geometry || [];
};

const splitPolylineByDash = (points, dashArray, dashOffset = 0) => {
  let pattern = (dashArray || [])
    .map((value) => Math.max(0, Number(value) || 0));
  if (!pattern.length || pattern.every((value) => value === 0)) return [points];
  if (pattern.length % 2 === 1) pattern = [...pattern, ...pattern];
  const total = pattern.reduce((sum, value) => sum + value, 0);
  let phase = ((Number(dashOffset) || 0) % total + total) % total;
  let patternIndex = 0;
  let remaining = pattern[patternIndex];
  let phaseGuard = 0;
  while (phase > 0 && phaseGuard < pattern.length * 2) {
    const entryLength = pattern[patternIndex];
    if (entryLength > 0 && phase < entryLength) {
      remaining = entryLength - phase;
      phase = 0;
      break;
    }
    if (entryLength > 0) phase -= entryLength;
    patternIndex = (patternIndex + 1) % pattern.length;
    remaining = pattern[patternIndex];
    phaseGuard += 1;
  }
  let currentRun = patternIndex % 2 === 0 && remaining > 0 ? [points[0]] : null;
  const runs = [];
  const advanceCompletedEntries = (point, tangent = null) => {
    let guard = 0;
    while (remaining === 0 && guard < pattern.length) {
      if (patternIndex % 2 === 0) {
        if (currentRun?.length > 1) {
          runs.push(currentRun);
        } else if (pattern[patternIndex] === 0) {
          // A zero-length painted dash is real geometry with round/square
          // caps (PDF `[0 gap]` is the standard dotted-line idiom).
          const zeroRun = [{ ...point }, { ...point }];
          zeroRun.zeroDashTangent = tangent;
          runs.push(zeroRun);
        }
      }
      currentRun = null;
      patternIndex = (patternIndex + 1) % pattern.length;
      remaining = pattern[patternIndex];
      if (patternIndex % 2 === 0 && remaining > 0) currentRun = [{ ...point }];
      guard += 1;
    }
  };

  for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
    const a = points[segmentIndex - 1];
    const b = points[segmentIndex];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const tangent = { ux: dx / length, uy: dy / length };
    let consumed = 0;
    advanceCompletedEntries(a, tangent);
    while (consumed < length) {
      const step = Math.min(remaining, length - consumed);
      const endDistance = consumed + step;
      if (endDistance === consumed) break;
      const end = {
        x: a.x + dx * endDistance / length,
        y: a.y + dy * endDistance / length,
      };
      if (patternIndex % 2 === 0) {
        if (!currentRun) {
          currentRun = [{
            x: a.x + dx * consumed / length,
            y: a.y + dy * consumed / length,
          }];
        }
        currentRun.push(end);
      }
      consumed = endDistance;
      remaining = step === remaining ? 0 : remaining - step;
      advanceCompletedEntries(end, tangent);
    }
  }
  if (currentRun?.length > 1) runs.push(currentRun);
  return runs;
};

const styledStrokeRunPolygon = (
  points,
  {
    radius,
    lineCap,
    lineJoin,
    miterLimit,
    curveTolerance,
    closed,
  },
) => {
  if (!Array.isArray(points) || points.length < 2 || radius <= 0) return [];
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    segments.push({
      a,
      b,
      ux: dx / length,
      uy: dy / length,
      nx: -dy / length,
      ny: dx / length,
    });
  }
  if (!segments.length) {
    if (lineCap === 'round') {
      return styledCircleGeometry(points[0], radius, curveTolerance);
    }
    if (lineCap === 'square') {
      const { x, y } = points[0];
      const ux = Number.isFinite(points.zeroDashTangent?.ux)
        ? points.zeroDashTangent.ux
        : 1;
      const uy = Number.isFinite(points.zeroDashTangent?.uy)
        ? points.zeroDashTangent.uy
        : 0;
      const nx = -uy;
      const ny = ux;
      return styledRingGeometry([
        [x + ux * radius + nx * radius, y + uy * radius + ny * radius],
        [x + ux * radius - nx * radius, y + uy * radius - ny * radius],
        [x - ux * radius - nx * radius, y - uy * radius - ny * radius],
        [x - ux * radius + nx * radius, y - uy * radius + ny * radius],
      ]);
    }
    return [];
  }

  const shapes = segments.map((segment, index) => {
    const startExtension = !closed && lineCap === 'square' && index === 0 ? radius : 0;
    const endExtension = !closed && lineCap === 'square' && index === segments.length - 1
      ? radius
      : 0;
    const ax = segment.a.x - segment.ux * startExtension;
    const ay = segment.a.y - segment.uy * startExtension;
    const bx = segment.b.x + segment.ux * endExtension;
    const by = segment.b.y + segment.uy * endExtension;
    return styledRingGeometry([
      [ax + segment.nx * radius, ay + segment.ny * radius],
      [bx + segment.nx * radius, by + segment.ny * radius],
      [bx - segment.nx * radius, by - segment.ny * radius],
      [ax - segment.nx * radius, ay - segment.ny * radius],
    ]);
  });

  const joinCount = closed ? segments.length : segments.length - 1;
  for (let index = 0; index < joinCount; index += 1) {
    const previous = segments[index];
    const next = segments[(index + 1) % segments.length];
    const vertex = previous.b;
    if (lineJoin === 'round') {
      shapes.push(styledCircleGeometry(vertex, radius, curveTolerance));
      continue;
    }
    const cross = previous.ux * next.uy - previous.uy * next.ux;
    if (Math.abs(cross) <= Number.EPSILON * 64) continue;
    const side = cross > 0 ? -1 : 1;
    const outer1 = [
      vertex.x + previous.nx * radius * side,
      vertex.y + previous.ny * radius * side,
    ];
    const outer2 = [
      vertex.x + next.nx * radius * side,
      vertex.y + next.ny * radius * side,
    ];
    if (lineJoin === 'miter') {
      const mx = (previous.nx + next.nx) * side;
      const my = (previous.ny + next.ny) * side;
      const magnitude = Math.hypot(mx, my);
      const unitX = magnitude > Number.EPSILON * 64 ? mx / magnitude : 0;
      const unitY = magnitude > Number.EPSILON * 64 ? my / magnitude : 0;
      const denominator = unitX * next.nx * side + unitY * next.ny * side;
      const miterLength = Math.abs(denominator) > Number.EPSILON * 64
        ? radius / denominator
        : Infinity;
      if (Number.isFinite(miterLength) && miterLength <= miterLimit * radius) {
        shapes.push(styledRingGeometry([
          outer1,
          [vertex.x + unitX * miterLength, vertex.y + unitY * miterLength],
          outer2,
        ]));
        continue;
      }
    }
    shapes.push(styledRingGeometry([outer1, [vertex.x, vertex.y], outer2]));
  }

  if (!closed && lineCap === 'round') {
    shapes.push(styledCircleGeometry(segments[0].a, radius, curveTolerance));
    shapes.push(styledCircleGeometry(segments.at(-1).b, radius, curveTolerance));
  }
  return mergeStyledStrokeGeometries(shapes);
};

/**
 * Convert stroked path commands to their exact styled local-space outline.
 * Supports SVG/PDF cap, join, miter, and dash semantics and is shared by
 * partial erase and page-space hit testing.
 */
export function styledStrokeCommandsToPolygonSet(commands, {
  strokeWidth,
  curveTolerance,
  lineCap = 'round',
  lineJoin = 'round',
  miterLimit = 10,
  dashArray = null,
  dashOffset = 0,
} = {}) {
  const radius = strokeWidth / 2;
  const shapes = [];
  for (const polyline of commandsToPolylines(commands, curveTolerance)) {
    let points = polyline.points;
    if (
      polyline.closed
      && points.length > 1
      && points[0].x === points.at(-1).x
      && points[0].y === points.at(-1).y
    ) {
      points = points.slice(0, -1);
    }
    const dashed = Array.isArray(dashArray) && dashArray.length > 0;
    if (!dashed) {
      const solidPoints = polyline.closed ? [...points, points[0]] : points;
      shapes.push(styledStrokeRunPolygon(solidPoints, {
        radius,
        lineCap,
        lineJoin,
        miterLimit,
        curveTolerance,
        closed: polyline.closed,
      }));
      continue;
    }
    const dashPoints = polyline.closed ? [...points, points[0]] : points;
    for (const run of splitPolylineByDash(dashPoints, dashArray, dashOffset)) {
      shapes.push(styledStrokeRunPolygon(run, {
        radius,
        lineCap,
        lineJoin,
        miterLimit,
        curveTolerance,
        closed: false,
      }));
    }
  }
  return mergeStyledStrokeGeometries(shapes);
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
 * curveTolerance defaults tighter than the generic eraser conversion because
 * this clipping geometry may later become the persisted visual after a bite.
 * Keep its maximum local deviation below ordinary render tolerances; callers
 * that know an object transform should tighten it further by that scale.
 *
 * @returns {Array} multipolygon (possibly empty when the path is degenerate).
 */
export function filledOutlineCommandsToPolygonSet(commands, {
  curveTolerance = 0.05,
  fillRule = 'nonzero',
} = {}) {
  const rings = commandsToPolylines(commands, curveTolerance)
    .filter((polyline) => polyline.points.length >= 3)
    .map((polyline) => closeRing(
      polyline.points.map((point) => [point.x, point.y]),
    ))
    .filter((ring) => ring.length >= 4 && ringArea(ring) > 0);
  if (rings.length === 0) return [];
  if (rings.length === 1) return [[rings[0]]];

  try {
    if (fillRule === 'evenodd') {
      let geometry = null;
      for (const ring of rings) {
        const ringGeometry = [[ring]];
        geometry = geometry ? xor(geometry, ringGeometry) : ringGeometry;
      }
      return normalizeMultiPolygon(geometry);
    }

    // Model the PDF/SVG nonzero winding rule exactly for ordinary simple
    // rings. Keep disjoint regions bucketed by their integer winding count;
    // each new clockwise/counter-clockwise subpath increments/decrements the
    // covered region. Any final nonzero bucket is painted.
    let windingRegions = new Map();
    const mergeRegion = (regions, winding, geometry) => {
      if (winding === 0) return;
      const normalized = normalizeMultiPolygon(geometry);
      if (!normalized.length) return;
      const existing = regions.get(winding);
      regions.set(
        winding,
        existing ? normalizeMultiPolygon(union(existing, normalized)) : normalized,
      );
    };

    for (const ring of rings) {
      const ringGeometry = [[ring]];
      const windingDelta = (() => {
        let signedArea = 0;
        for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
          signedArea += ring[previous][0] * ring[index][1]
            - ring[index][0] * ring[previous][1];
        }
        return signedArea < 0 ? -1 : 1;
      })();
      const nextRegions = new Map();
      let priorCoverage = null;

      for (const [winding, geometry] of windingRegions) {
        const coveredByRing = normalizeMultiPolygon(intersection(geometry, ringGeometry));
        const outsideRing = normalizeMultiPolygon(diff(geometry, ringGeometry));
        mergeRegion(nextRegions, winding, outsideRing);
        mergeRegion(nextRegions, winding + windingDelta, coveredByRing);
        priorCoverage = priorCoverage
          ? normalizeMultiPolygon(union(priorCoverage, geometry))
          : geometry;
      }

      const newlyCovered = priorCoverage
        ? normalizeMultiPolygon(diff(ringGeometry, priorCoverage))
        : ringGeometry;
      mergeRegion(nextRegions, windingDelta, newlyCovered);
      windingRegions = nextRegions;
    }

    let painted = null;
    for (const geometry of windingRegions.values()) {
      painted = painted ? union(painted, geometry) : geometry;
    }
    return normalizeMultiPolygon(painted);
  } catch {
    // Martinez can reject degenerate self-touching rings. Fall back to the
    // prior containment grouping, which remains faithful for non-overlapping
    // subpaths and never blocks import.
    return groupRings(rings);
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

const mapPolygonSetCoordinates = (value, mapPoint) => (
  normalizeMultiPolygon(value).map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => mapPoint(x, y))
  )))
);

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
  const polygons = sweptDiskPolygon(simplified, Math.max(0.5, width / 2), {
    minDistance: 0.01, inkOutline: true,
  });
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

/**
 * Boolean subtraction has a non-negotiable postcondition: it may remove ink,
 * but it may never create ink outside the source. Invalid legacy rings once
 * made Martinez return a long eraser-shaped streak. Check both bounds (catches
 * even near-zero-area needles) and every result-edge interval against the
 * source (catches spill inside a concave source's overall bounds). Do not ask
 * the polygon engine to validate its own dense subtraction output: on accurate
 * curve meshes that second boolean can invent a tiny outside fragment or throw
 * even when the original result is contained.
 */
export function subtractionStayedInsideSubject(
  result,
  subject,
  sourceWidth,
) {
  if (!result.length) return true;
  const reject = (reason, detail = null) => {
    if (
      typeof process !== 'undefined'
      && process?.env?.ERASER_TRACE_CONTAINMENT === '1'
    ) {
      console.error('[EraserContainmentReject]', JSON.stringify({ reason, detail }));
    }
    return false;
  };
  const subjectBounds = boundsOfCommands(polygonSetToCommands(subject));
  const resultBounds = boundsOfCommands(polygonSetToCommands(result));
  // This is a fail-closed proof, not a visual comparison. Derive numerical
  // allowances from the subject extent: a fixed page-unit epsilon both hid
  // needles in tiny ink and rejected valid proportional subtraction output.
  const geometryScale = Math.max(
    Number.MIN_VALUE,
    subjectBounds.w,
    subjectBounds.h,
    Number(sourceWidth) || 0,
  );
  const coordinateMagnitude = Math.max(
    Math.abs(subjectBounds.x),
    Math.abs(subjectBounds.y),
    Math.abs(subjectBounds.x + subjectBounds.w),
    Math.abs(subjectBounds.y + subjectBounds.h),
  );
  const tolerance = Math.max(
    Number.MIN_VALUE,
    geometryScale * Number.EPSILON * 128,
    coordinateMagnitude * Number.EPSILON * 16,
  );
  const crossTolerance = Math.max(
    Number.MIN_VALUE,
    geometryScale * geometryScale * Number.EPSILON * 128,
  );
  const parameterTolerance = Number.EPSILON * 128;
  if (
    resultBounds.x < subjectBounds.x - tolerance
    || resultBounds.y < subjectBounds.y - tolerance
    || resultBounds.x + resultBounds.w > subjectBounds.x + subjectBounds.w + tolerance
    || resultBounds.y + resultBounds.h > subjectBounds.y + subjectBounds.h + tolerance
  ) {
    return reject('bounds', { subjectBounds, resultBounds, tolerance });
  }

  const sourcePolygons = normalizeMultiPolygon(subject);
  const resultPolygons = normalizeMultiPolygon(result);
  // Do not prove containment by feeding the dense survivor back through the
  // polygon engine. Repeated cuts can make that redundant `result - subject`
  // check allocate gigabytes before it returns an empty set. The edge proof
  // below is bounded by the actual stored rings and does not create another
  // polygon graph.
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
    if (Math.abs(denominator) > crossTolerance) {
      const t = cross(fromA, s) / denominator;
      const u = cross(fromA, r) / denominator;
      return (
        t >= -parameterTolerance
        && t <= 1 + parameterTolerance
        && u >= -parameterTolerance
        && u <= 1 + parameterTolerance
      )
        ? [Math.max(0, Math.min(1, t))]
        : [];
    }
    if (Math.abs(cross(fromA, r)) > crossTolerance) return [];
    const length = Math.hypot(r[0], r[1]);
    if (length === 0) return [0];
    const unitX = r[0] / length;
    const unitY = r[1] / length;
    return [c, d]
      .map((point) => (
        ((point[0] - a[0]) * unitX + (point[1] - a[1]) * unitY) / length
      ))
      .filter((t) => t >= -parameterTolerance && t <= 1 + parameterTolerance)
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
        if (!pointIsInsideOrOnSource(a) || !pointIsInsideOrOnSource(b)) {
          return reject('edge-endpoint', { a, b, tolerance });
        }
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
          if (
            parameters[part] - parameters[part - 1]
            <= parameterTolerance
          ) continue;
          const t = (parameters[part] + parameters[part - 1]) / 2;
          const midpoint = [
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
          ];
          if (!pointIsInsideOrOnSource(midpoint)) {
            return reject('edge-midpoint', { a, b, midpoint, tolerance });
          }
        }
      }
    }
  }

  // Do not validate stored holes or summed component area here. The renderer
  // applies one even-odd fill across all rings, while Martinez may return
  // overlapping parts. Treating those parts as disjoint reports false hole
  // fills and false area growth, rejects a valid cut, and leaves ink behind.
  // Bounds plus every result-edge interval above still reject any new region;
  // a subtraction cannot fill a source hole without malformed new boundaries.
  return true;
}

function sourceHasBoundaryTouchingHole(subject, sourceWidth) {
  const polygons = normalizeMultiPolygon(subject);
  if (!polygons.some((polygon) => polygon.length > 1)) return false;
  const bounds = boundsOfCommands(polygonSetToCommands(polygons));
  const scale = Math.max(Number.MIN_VALUE, bounds.w, bounds.h, Number(sourceWidth) || 0);
  const magnitude = Math.max(
    Math.abs(bounds.x),
    Math.abs(bounds.y),
    Math.abs(bounds.x + bounds.w),
    Math.abs(bounds.y + bounds.h),
  );
  const tolerance = Math.max(
    Number.MIN_VALUE,
    scale * Number.EPSILON * 128,
    magnitude * Number.EPSILON * 16,
  );
  for (const [outer, ...holes] of polygons) {
    for (const hole of holes) {
      for (const point of hole) {
        for (let index = 0, previous = outer.length - 1; index < outer.length; previous = index, index += 1) {
          if (pointOnRingEdge(
            { x: point[0], y: point[1] },
            outer[previous],
            outer[index],
            tolerance,
          )) return true;
        }
      }
    }
  }
  return false;
}

function pointOnRingEdge(point, a, b, tolerance = null) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const safeTolerance = Number.isFinite(tolerance) && tolerance >= 0
    ? tolerance
    : Math.max(Number.MIN_VALUE, length * Number.EPSILON * 64);
  if (length === 0) {
    return Math.hypot(point.x - a[0], point.y - a[1]) <= safeTolerance;
  }
  const ux = dx / length;
  const uy = dy / length;
  const perpendicular = Math.abs(
    (point.x - a[0]) * uy - (point.y - a[1]) * ux,
  );
  if (perpendicular > safeTolerance) return false;
  const projection = (point.x - a[0]) * ux + (point.y - a[1]) * uy;
  return projection >= -safeTolerance && projection <= length + safeTolerance;
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
  if (length === 0) return null;
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
  const segmentLength = Math.hypot(segment.x, segment.y);
  if (segmentLength === 0) return null;
  if (Math.abs(denominator) <= segmentLength * Number.EPSILON * 64) return null;
  const fromOrigin = { x: a[0] - origin.x, y: a[1] - origin.y };
  const distance = cross2d(fromOrigin, segment) / denominator;
  const segmentPosition = cross2d(fromOrigin, direction) / denominator;
  if (
    distance < 0
    || segmentPosition < -Number.EPSILON * 64
    || segmentPosition > 1 + Number.EPSILON * 64
  ) {
    return null;
  }
  return distance;
}

function firstRayMaterialInterval(origin, direction, result, maximumDistance) {
  const epsilon = Math.max(Number.MIN_VALUE, maximumDistance * 1e-5);
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
  const cleanupSeam = ribbonWidth * 0.025;
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
  const classificationTolerance = ribbonWidth * 0.001;
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
  const startLength = Math.hypot(
    first.b.x - first.a.x,
    first.b.y - first.a.y,
  );
  const endLength = Math.hypot(
    last.b.x - last.a.x,
    last.b.y - last.a.y,
  );
  if (startLength === 0 || endLength === 0) return [];
  const overlap = ribbonWidth * 0.015;
  const inward = ribbonWidth * 0.01;
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

function subtractPolygonPart(subject, eraser, sourceWidth) {
  let overlap;
  try {
    overlap = normalizeMultiPolygon(intersection(subject, eraser));
  } catch (error) {
    return { status: 'failed', stage: 'intersection', error };
  }
  if (!overlap.length) return { status: 'unchanged', result: subject };

  let rawResult;
  try {
    rawResult = normalizeWeaklySimplePolygonSet(diff(subject, eraser));
  } catch (error) {
    return { status: 'failed', stage: 'subtraction', error };
  }

  const finish = (value) => {
    const finished = compactCollinearPolygonSet(
      normalizeWeaklySimplePolygonSet(value),
    );
    return finished;
  };

  // Partial erase is an exact boolean cut. Do not widen it to remove thin
  // bridges or crumbs: those pixels are outside the swept eraser and must
  // remain, even when the survivor is narrow.
  try {
    const baseResult = finish(rawResult);
    if (!subtractionStayedInsideSubject(baseResult, subject, sourceWidth)) {
      return { status: 'failed', stage: 'containment' };
    }
    // Check suspect holes per subtraction, not per annotation: ordinary pen
    // curves can have touching holes and still yield a valid exact cut.
    if (sourceHasBoundaryTouchingHole(subject, sourceWidth)) {
      for (const [, ...holes] of normalizeMultiPolygon(subject)) {
        for (const hole of holes) {
          const overlapArea = baseResult.reduce((area, polygon) => (
            area + polygonSetArea(intersection([polygon], [[hole]]))
          ), 0);
          const originalOverlap = normalizeMultiPolygon(intersection(subject, [[hole]]));
          const holeArea = Math.abs(signedRingArea(hole));
          if (overlapArea - polygonSetArea(originalOverlap) > holeArea * Number.EPSILON * 128) {
            return { status: 'failed', stage: 'hole-containment' };
          }
        }
      }
    }
    return { status: 'changed', result: baseResult };
  } catch (error) {
    return { status: 'failed', stage: 'containment', error };
  }
}

function subtractPolygonRecord(subject, record, sourceWidth) {
  const subtraction = subtractPolygonPart(
    subject,
    record.geometry,
    sourceWidth,
  );
  if (subtraction.status !== 'failed') {
    return { ...subtraction, failedLeaves: 0, failedStages: {} };
  }
  if (!record.children?.length) {
    if (record.fallback) {
      const retry = subtractPolygonPart(subject, record.fallback, sourceWidth);
      if (retry.status !== 'failed') return {
        ...retry, failedLeaves: 0,
        failedStages: { [subtraction.stage || 'unknown']: 1 },
      };
    }
    return {
      status: 'unchanged',
      result: subject,
      failedLeaves: 1,
      failedStages: { [subtraction.stage || 'unknown']: 1 },
    };
  }

  let result = subject;
  let changed = false;
  let failedLeaves = 0;
  const failedStages = {};
  for (const child of record.children) {
    const childResult = subtractPolygonRecord(result, child, sourceWidth);
    result = childResult.result;
    failedLeaves += childResult.failedLeaves;
    for (const [stage, count] of Object.entries(childResult.failedStages)) {
      failedStages[stage] = (failedStages[stage] || 0) + count;
    }
    changed ||= childResult.status === 'changed';
    if (!result.length) break;
  }
  return {
    status: changed ? 'changed' : 'unchanged',
    result,
    failedLeaves,
    failedStages,
  };
}

function polygonRecordTouches(subject, record) {
  try {
    return {
      touched: normalizeMultiPolygon(
        intersection(subject, record.geometry),
      ).length > 0,
      failedLeaves: 0,
    };
  } catch {
    if (!record.children?.length) {
      return { touched: false, failedLeaves: 1 };
    }
    let failedLeaves = 0;
    for (const child of record.children) {
      const result = polygonRecordTouches(subject, child);
      failedLeaves += result.failedLeaves;
      if (result.touched) return { touched: true, failedLeaves };
    }
    return { touched: false, failedLeaves };
  }
}

const mapEraserRecordCoordinates = (record, mapper) => ({
  geometry: mapPolygonSetCoordinates(record.geometry, mapper),
  fallback: record.fallback ? mapPolygonSetCoordinates(record.fallback, mapper) : null,
  children: record.children?.map((child) => (
    mapEraserRecordCoordinates(child, mapper)
  )) || null,
});

export function eraseAnnotations(annotations, eraserPoints, radius, mode = 'partial') {
  const eraserSampleDistance = Math.max(
    Number.MIN_VALUE,
    Math.min(0.1, radius * 0.1),
  );
  const eraserRecords = sweptDiskPolygonRecords(
    eraserPoints,
    radius,
    {
      minDistance: eraserSampleDistance,
      curveTolerance: eraserCurveTolerance(radius, eraserPoints.length),
    },
  );
  if (!eraserRecords.length) {
    return { annotations, changedIds: [], deletedIds: [] };
  }
  const eraserBounds = boundsOfCommands(polygonSetToCommands(
    eraserRecords.flatMap((record) => record.geometry),
  ));
  const centerlinePoints = compactPoints(eraserPoints, eraserSampleDistance);
  const capsules = centerlinePoints.length <= 1
    ? [{ a: centerlinePoints[0], b: centerlinePoints[0] }]
    : centerlinePoints.slice(1).map((point, index) => ({ a: centerlinePoints[index], b: point }));
  const next = [];
  const changedIds = [];
  const deletedIds = [];
  const failures = [];

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
    const sourceWidth = (Number(annotation.sourceWidth) > 0 && Number(annotation.sourceWidth))
      || (Number(annotation.strokeWidth) > 0 && Number(annotation.strokeWidth))
      || null;
    const subjectBounds = boundsOfCommands(polygonSetToCommands(subject));
    const workingScale = Math.max(
      Number.MIN_VALUE,
      subjectBounds.w,
      subjectBounds.h,
      sourceWidth || 0,
      radius * 2,
    );
    const coordinateMagnitude = Math.max(
      Math.abs(subjectBounds.x),
      Math.abs(subjectBounds.y),
      Math.abs(subjectBounds.x + subjectBounds.w),
      Math.abs(subjectBounds.y + subjectBounds.h),
    );
    const useWorkingFrame = (
      annotation.forceWorkingFrame === true
      || workingScale < 1e-6
      || workingScale > 1e6
      || coordinateMagnitude > 1e12
      || coordinateMagnitude / workingScale > 1e8
    );
    const originX = subjectBounds.x + subjectBounds.w / 2;
    const originY = subjectBounds.y + subjectBounds.h / 2;
    const toWorking = (x, y) => [
      (x - originX) / workingScale,
      (y - originY) / workingScale,
    ];
    const fromWorking = (x, y) => [
      x * workingScale + originX,
      y * workingScale + originY,
    ];
    // Extreme or badly translated coordinates need one O(1) local frame.
    // Ordinary page geometry stays in place: cloning every accumulated vertex
    // on every bite creates avoidable GC pauses in long annotation sessions.
    const workingSubject = useWorkingFrame
      ? mapPolygonSetCoordinates(subject, toWorking)
      : subject;
    const workingEraserRecords = useWorkingFrame
      ? eraserRecords.map((record) => (
        mapEraserRecordCoordinates(record, toWorking)
      ))
      : eraserRecords;
    const workingSourceWidth = sourceWidth == null
      ? null
      : (useWorkingFrame ? sourceWidth / workingScale : sourceWidth);
    if (annotationEraseMode === 'full') {
      let touched = false;
      let failedParts = 0;
      for (const record of workingEraserRecords) {
        const hit = polygonRecordTouches(workingSubject, record);
        failedParts += hit.failedLeaves;
        if (hit.touched) {
          touched = true;
          break;
        }
      }
      if (failedParts) {
        console.warn(
          `Eraser polygon hit-test skipped ${failedParts} invalid bounded part(s):`,
          annotation.id,
        );
      }
      if (touched) {
        changedIds.push(annotation.id);
        deletedIds.push(annotation.id);
      } else {
        next.push(annotation);
      }
      continue;
    }

    let result = workingSubject;
    let changed = false;
    let failedParts = 0;
    const failedStages = {};
    for (const record of workingEraserRecords) {
      const subtraction = subtractPolygonRecord(
        result,
        record,
        workingSourceWidth,
      );
      failedParts += subtraction.failedLeaves;
      for (const [stage, count] of Object.entries(subtraction.failedStages)) {
        failedStages[stage] = (failedStages[stage] || 0) + count;
      }
      if (subtraction.status === 'changed') {
        result = subtraction.result;
        changed = true;
        if (!result.length) break;
      }
    }
    if (failedParts) {
      // Retry the whole original subject: a failed later bite can be caused
      // by a dense survivor from an earlier bite, not just the current leaf.
      const robustRecords = sweptDiskPolygonRecords(eraserPoints, radius, {
        minDistance: eraserSampleDistance, robust: true,
      });
      result = workingSubject;
      changed = false;
      failedParts = 0;
      for (const record of robustRecords) {
        const retry = subtractPolygonRecord(result,
          useWorkingFrame ? mapEraserRecordCoordinates(record, toWorking) : record,
          workingSourceWidth);
        failedParts += retry.failedLeaves;
        for (const [stage, count] of Object.entries(retry.failedStages)) {
          failedStages[stage] = (failedStages[stage] || 0) + count;
        }
        result = retry.result;
        changed ||= retry.status === 'changed';
        if (!result.length) break;
      }
    }
    if (Object.keys(failedStages).length) failures.push({
      annotationId: annotation.id, failedStages, recovered: failedParts === 0,
    });
    if (failedParts) {
      // Never publish a cut with missing bites. Keep this annotation intact
      // and report the rejected plan, including the failed polygon stage.
      console.warn('Eraser polygon subtraction rejected:', annotation.id, failedStages);
      next.push(annotation);
      continue;
    }
    if (!changed) {
      next.push(annotation);
      continue;
    }
    if (useWorkingFrame) {
      result = mapPolygonSetCoordinates(result, fromWorking);
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

  return { annotations: next, changedIds, deletedIds, failures };
}
