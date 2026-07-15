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
  if (annotation.polygons?.length) return normalizeMultiPolygon(annotation.polygons);
  const fill = Boolean(annotationFill(annotation)) || annotation.eraseByBounds === true;
  const strokeWidth = annotation.strokeWidth || 0;
  return commandsToPolygonSet(annotation.cmds, { fill, strokeWidth });
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

export function eraseAnnotations(annotations, eraserPoints, radius, mode = 'partial') {
  const eraser = sweptDiskPolygon(eraserPoints, radius, { minDistance: 0.1 });
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
    // Thin centerline marks stay centerlines. Exact capsule interval cutting is
    // dramatically faster than expanding every curve into a polygon, while the
    // filled/thick ink produced by the pen still uses true shape subtraction.
    if (!annotation.forcePolygon && !fillColor && strokeWidth > 0 && strokeWidth <= 4) {
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
    const overlap = normalizeMultiPolygon(intersection(subject, eraser));
    if (!overlap.length) {
      next.push(annotation);
      continue;
    }

    changedIds.push(annotation.id);
    if (annotationEraseMode === 'full') {
      deletedIds.push(annotation.id);
      continue;
    }

    const result = normalizeMultiPolygon(diff(subject, eraser));
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
