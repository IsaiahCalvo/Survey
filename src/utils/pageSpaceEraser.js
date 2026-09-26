import {
  boundsOfCommands,
  commandsToPolylines,
  commandsToPolygonSet,
  eraseAnnotations,
  filledOutlineCommandsToPolygonSet,
  intersectSharedOutlinePolygonSets,
  normalizeMultiPolygon,
  polygonSetArea,
  polygonSetToCommands,
  roundCircleStepCount,
} from './paperAnnotationGeometry.js';
import { diff as polygonDifference, union } from './polygonBooleans.js';
import {
  eraserStrokeTouchesObject,
  getEraserCandidateId,
} from './eraserHitTest.js';
import { getEraserOperation } from './eraserPolicy.js';
import {
  getAnnotationStorageKey,
  setAnnotationStorageKey,
} from './annotationStorageIdentity.js';
import { normalizeOperationalInkPath } from './inkPathNormalization.js';
import { createInkPathAffine } from './inkGeometryTransform.js';
import { materializeDashedInkPath } from './paperInkEraser.js';

const numberOr = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const hasVisiblePaint = (value) => {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== ''
    && normalized !== 'none'
    && normalized !== 'transparent'
    && normalized !== 'rgba(0,0,0,0)'
    && normalized !== 'rgba(0, 0, 0, 0)';
};

export const normalizeFabricPath = normalizeOperationalInkPath;

const createPathTransform = (object, commands) => (
  createInkPathAffine(object, commands, {
    polygons: object?.polygons,
    centerline: object?.paperCenterline,
  })
);

function transformCommands(commands, transform) {
  return commands.map((command) => {
    if (command[0] === 'Z') return ['Z'];
    const next = [command[0]];
    for (let index = 1; index + 1 < command.length; index += 2) {
      const point = transform.point({ x: command[index], y: command[index + 1] });
      next.push(point.x, point.y);
    }
    return next;
  });
}

function transformPolygons(polygons, transform) {
  return normalizeMultiPolygon(polygons).map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => {
      const point = transform.point({ x, y });
      return [point.x, point.y];
    })
  )));
}

const multiplyAffineMatrices = (left, right) => {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

const transformPaperSourceStroke = (source, outerMatrix) => {
  if (
    !source
    || !Array.isArray(source.path)
    || source.path.length === 0
    || !Array.isArray(source.matrix)
    || source.matrix.length !== 6
    || !Array.isArray(outerMatrix)
    || outerMatrix.length !== 6
  ) return null;
  return {
    ...source,
    matrix: multiplyAffineMatrices(outerMatrix, source.matrix),
  };
};

const closedRing = (points) => {
  if (!points.length) return [];
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1]
    ? points
    : [...points, [...first]];
};

const ringGeometry = (points) => (
  points.length >= 3 ? [[closedRing(points)]] : []
);

const circleGeometry = (point, radius, tolerance) => {
  if (radius <= 0) return [];
  const steps = roundCircleStepCount(radius, tolerance);
  return ringGeometry(Array.from({ length: steps }, (_unused, index) => {
    const angle = index / steps * 2 * Math.PI;
    return [
      point.x + Math.cos(angle) * radius,
      point.y + Math.sin(angle) * radius,
    ];
  }));
};

const mergePolygonGeometries = (values) => {
  let geometries = values.map(normalizeMultiPolygon).filter((value) => value.length);
  while (geometries.length > 1) {
    const next = [];
    for (let index = 0; index < geometries.length; index += 2) {
      next.push(
        index + 1 < geometries.length
          ? normalizeMultiPolygon(union(geometries[index], geometries[index + 1]))
          : geometries[index],
      );
    }
    geometries = next;
  }
  return geometries[0] || [];
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
  const segmentData = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    segmentData.push({
      a,
      b,
      ux: dx / length,
      uy: dy / length,
      nx: -dy / length,
      ny: dx / length,
    });
  }
  if (!segmentData.length) {
    if (lineCap === 'round') return circleGeometry(points[0], radius, curveTolerance);
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
      return ringGeometry([
        [x + ux * radius + nx * radius, y + uy * radius + ny * radius],
        [x + ux * radius - nx * radius, y + uy * radius - ny * radius],
        [x - ux * radius - nx * radius, y - uy * radius - ny * radius],
        [x - ux * radius + nx * radius, y - uy * radius + ny * radius],
      ]);
    }
    return [];
  }

  const shapes = segmentData.map((segment, index) => {
    const startExtension = !closed && lineCap === 'square' && index === 0 ? radius : 0;
    const endExtension = !closed && lineCap === 'square' && index === segmentData.length - 1
      ? radius
      : 0;
    const ax = segment.a.x - segment.ux * startExtension;
    const ay = segment.a.y - segment.uy * startExtension;
    const bx = segment.b.x + segment.ux * endExtension;
    const by = segment.b.y + segment.uy * endExtension;
    return ringGeometry([
      [ax + segment.nx * radius, ay + segment.ny * radius],
      [bx + segment.nx * radius, by + segment.ny * radius],
      [bx - segment.nx * radius, by - segment.ny * radius],
      [ax - segment.nx * radius, ay - segment.ny * radius],
    ]);
  });

  const joinCount = closed ? segmentData.length : segmentData.length - 1;
  for (let index = 0; index < joinCount; index += 1) {
    const previous = segmentData[index];
    const next = segmentData[(index + 1) % segmentData.length];
    const vertex = previous.b;
    if (lineJoin === 'round') {
      shapes.push(circleGeometry(vertex, radius, curveTolerance));
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
        shapes.push(ringGeometry([
          outer1,
          [vertex.x + unitX * miterLength, vertex.y + unitY * miterLength],
          outer2,
        ]));
        continue;
      }
    }
    shapes.push(ringGeometry([outer1, [vertex.x, vertex.y], outer2]));
  }

  if (!closed && lineCap === 'round') {
    shapes.push(circleGeometry(segmentData[0].a, radius, curveTolerance));
    shapes.push(circleGeometry(segmentData.at(-1).b, radius, curveTolerance));
  }
  return mergePolygonGeometries(shapes);
};

const styledStrokeCommandsToPolygonSet = (commands, {
  strokeWidth,
  curveTolerance,
  lineCap = 'round',
  lineJoin = 'round',
  miterLimit = 10,
  dashArray = null,
  dashOffset = 0,
} = {}) => {
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
  return mergePolygonGeometries(shapes);
};

// The source outline is the same for every bite on a mark, but was rebuilt
// on each one (the cut mask is outline minus survivor): about half of each
// bite's time on imported curve ink (w39 review). A few recent outlines are
// kept, keyed by everything that shapes them. Callers treat the result as
// read-only.
const SOURCE_OUTLINE_CACHE_SIZE = 16;
const sourceOutlineCache = new Map();

const paperSourceStrokeOutlinePolygons = (source) => {
  let key = null;
  try {
    key = JSON.stringify([
      source?.path, source?.operationalPath, source?.matrix, source?.paintMode,
      source?.fillRule, source?.strokeWidth, source?.strokeLineCap, source?.strokeLineJoin,
      source?.strokeMiterLimit, source?.strokeDashArray, source?.strokeDashOffset,
      source?.curveTolerance,
    ]);
  } catch {
    key = null;
  }
  if (key !== null && sourceOutlineCache.has(key)) {
    const cached = sourceOutlineCache.get(key);
    sourceOutlineCache.delete(key);
    sourceOutlineCache.set(key, cached);
    return cached;
  }
  const outline = buildPaperSourceStrokeOutlinePolygons(source);
  if (key !== null) {
    sourceOutlineCache.set(key, outline);
    if (sourceOutlineCache.size > SOURCE_OUTLINE_CACHE_SIZE) {
      sourceOutlineCache.delete(sourceOutlineCache.keys().next().value);
    }
  }
  return outline;
};

const buildPaperSourceStrokeOutlinePolygons = (source) => {
  if (
    !source
    || !Array.isArray(source.path)
    || source.path.length === 0
    || !Array.isArray(source.matrix)
    || source.matrix.length !== 6
    || !source.matrix.every(Number.isFinite)
  ) return [];
  const operationalPath = Array.isArray(source.operationalPath)
    && source.operationalPath.length > 0
    ? source.operationalPath
    : normalizeFabricPath(source.path);
  if (!operationalPath.length) return [];
  const paintMode = source.paintMode === 'fill' ? 'fill' : 'stroke';
  const lineCap = String(source.strokeLineCap || 'round').toLowerCase();
  const lineJoin = String(source.strokeLineJoin || 'round').toLowerCase();
  const dashArray = Array.isArray(source.strokeDashArray)
    ? source.strokeDashArray
    : null;
  const curveTolerance = (
    Number(source.curveTolerance) > 0
      ? Number(source.curveTolerance)
      : 0.05
  );
  const localPolygons = paintMode === 'fill'
    ? filledOutlineCommandsToPolygonSet(operationalPath, {
        curveTolerance,
        fillRule: source.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
      })
    : (
      Number(source.strokeWidth) > 0
      && (lineCap !== 'round' || lineJoin !== 'round' || dashArray?.length)
      ? styledStrokeCommandsToPolygonSet(operationalPath, {
          strokeWidth: Number(source.strokeWidth),
          curveTolerance,
          lineCap,
          lineJoin,
          miterLimit: Math.max(1, numberOr(source.strokeMiterLimit, 10)),
          dashArray,
          dashOffset: numberOr(source.strokeDashOffset),
        })
      : Number(source.strokeWidth) > 0
        ? commandsToPolygonSet(operationalPath, {
            fill: false,
            strokeWidth: Number(source.strokeWidth),
            curveTolerance,
            simplifyTolerance: 0,
          })
        : []
    );
  const [a, b, c, d, e, f] = source.matrix;
  return transformPolygons(localPolygons, {
    point: ({ x, y }) => ({
      x: a * x + c * y + e,
      y: b * x + d * y + f,
    }),
  });
};

const subtractPolygonGeometries = (subjectValue, clipValue) => {
  const subject = normalizeMultiPolygon(subjectValue);
  const clip = normalizeMultiPolygon(clipValue);
  if (!subject.length) return [];
  if (!clip.length) return subject;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of subject) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return [];
  const scale = Math.max(
    Number.MIN_VALUE,
    maxX - minX,
    maxY - minY,
  );
  if (!Number.isFinite(scale)) return [];
  const originX = minX / 2 + maxX / 2;
  const originY = minY / 2 + maxY / 2;
  const toWorking = (polygons) => polygons.map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => [
      (x - originX) / scale,
      (y - originY) / scale,
    ])
  )));
  const fromWorking = (polygons) => normalizeMultiPolygon(polygons).map((polygon) => (
    polygon.map((ring) => ring.map(([x, y]) => [
      x * scale + originX,
      y * scale + originY,
    ]))
  ));
  try {
    // Match eraseAnnotations: keep ordinary page coordinates unchanged.
    // Reframing coincident source/survivor edges can round them differently
    // and wedge Martinez while rebuilding a direct round outline's cut clip.
    const magnitude = Math.max(
      Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY),
    );
    if (
      scale >= 1e-6 && scale <= 1e6
      && magnitude <= 1e12 && magnitude / scale <= 1e8
    ) {
      return normalizeMultiPolygon(polygonDifference(subject, clip));
    }
    return fromWorking(polygonDifference(
      toWorking(subject),
      toWorking(clip),
    ));
  } catch (error) {
    console.warn('Paper eraser cut-mask construction failed; polygon rendering retained:', error);
    return [];
  }
};

function pathToPageAnnotation(
  object,
  internalId,
  { forcePolygon = false, eraserRadius = null } = {},
) {
  const persistedPolygons = normalizeMultiPolygon(object?.polygons);
  let exactAuthoredPath = null;
  let localCommands = [];
  for (const candidate of [object?.path, object?.cmds]) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    const normalized = normalizeFabricPath(candidate);
    if (!normalized.length) continue;
    exactAuthoredPath = candidate.map((command) => (
      Array.isArray(command) ? [...command] : command
    ));
    localCommands = normalized;
    break;
  }
  if (!localCommands.length && persistedPolygons.length) {
    localCommands = polygonSetToCommands(persistedPolygons);
  }
  if (!localCommands.length) return null;
  const transformBasisCommands = localCommands;
  const rawStrokeWidth = Math.max(0, numberOr(object?.strokeWidth));
  const visibleFill = hasVisiblePaint(object?.fill) ? object.fill : null;
  const visibleStroke = hasVisiblePaint(object?.stroke) ? object.stroke : null;
  const isPdfHairline = object?.pdfStrokeHairline === true
    || object?.data?.pdfStrokeHairline === true;
  const lineCap = String(object?.strokeLineCap || 'round').toLowerCase();
  const lineJoin = String(object?.strokeLineJoin || 'round').toLowerCase();
  const dashArray = Array.isArray(object?.strokeDashArray)
    ? object.strokeDashArray
    : null;
  let dashMaterialized = false;
  if (
    isPdfHairline
    && visibleStroke
    && dashArray?.length
  ) {
    const materialized = materializeDashedInkPath(localCommands, {
      dashArray,
      dashOffset: numberOr(object?.strokeDashOffset),
      lineCap,
    });
    if (materialized.materialized) {
      localCommands = materialized.pathData;
      dashMaterialized = true;
    }
    // An all-gap dash pattern paints no hairline and therefore cannot be
    // touched by either eraser mode.
    if (!localCommands.length) return null;
  }
  const transform = createPathTransform(object, transformBasisCommands);
  const commands = transformCommands(localCommands, transform);
  const cleanupScale = transform.minScale;
  const worldStrokeWidth = rawStrokeWidth * transform.strokeScale;
  const sourceWidth = Math.max(
    rawStrokeWidth * cleanupScale,
    numberOr(object?.sourceWidth) * cleanupScale,
  );
  const mustBakeStrokeOutline = Boolean(
    visibleStroke
    && rawStrokeWidth > 0
    && !transform.conformal,
  );
  const worldCurveTolerance = Math.max(
    Number.MIN_VALUE,
    Math.min(
      0.05,
      Number.isFinite(Number(eraserRadius)) && Number(eraserRadius) > 0
        ? Number(eraserRadius) * 0.05
        : 0.05,
      sourceWidth > 0 ? sourceWidth * 0.05 : 0.05,
    ),
  );
  const localCurveTolerance = worldCurveTolerance / (
    Number.isFinite(transform.maxScale) && transform.maxScale > 0
      ? transform.maxScale
      : 1
  );
  const customStrokeOutline = lineCap !== 'round'
    || lineJoin !== 'round'
    || (dashArray && dashArray.length > 0);
  const createLocalStrokeOutline = () => (
    customStrokeOutline
      ? styledStrokeCommandsToPolygonSet(localCommands, {
          strokeWidth: rawStrokeWidth,
          curveTolerance: localCurveTolerance,
          lineCap,
          lineJoin,
          miterLimit: Math.max(1, numberOr(object?.strokeMiterLimit, 10)),
          dashArray,
          dashOffset: numberOr(object?.strokeDashOffset),
        })
      : commandsToPolygonSet(localCommands, {
          fill: false,
          strokeWidth: rawStrokeWidth,
          curveTolerance: localCurveTolerance,
          simplifyTolerance: 0,
      })
  );
  const operationalPathDiffers = Boolean(
    exactAuthoredPath
    && (
      exactAuthoredPath.length !== localCommands.length
      || exactAuthoredPath.some((command, commandIndex) => (
        !Array.isArray(command)
        || command.length !== localCommands[commandIndex]?.length
        || command.some((value, valueIndex) => (
          value !== localCommands[commandIndex]?.[valueIndex]
        ))
      ))
    )
  );
  const createPaperSourceStroke = () => (
    visibleStroke && rawStrokeWidth > 0
      ? {
          path: exactAuthoredPath || localCommands,
          ...(operationalPathDiffers ? { operationalPath: localCommands } : {}),
          matrix: Array.from(transform.matrix),
          paintMode: 'stroke',
          stroke: visibleStroke,
          strokeWidth: rawStrokeWidth,
          strokeLineCap: lineCap,
          strokeLineJoin: lineJoin,
          strokeMiterLimit: Math.max(1, numberOr(object?.strokeMiterLimit, 10)),
          strokeDashArray: dashArray ? Array.from(dashArray, Number) : null,
          strokeDashOffset: numberOr(object?.strokeDashOffset),
          curveTolerance: localCurveTolerance,
        }
      : null
  );
  const createPaperSourceFill = () => (
    visibleFill
      ? {
          path: exactAuthoredPath || localCommands,
          ...(operationalPathDiffers ? { operationalPath: localCommands } : {}),
          matrix: Array.from(transform.matrix),
          paintMode: 'fill',
          fill: visibleFill,
          fillRule: object?.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
          curveTolerance: localCurveTolerance,
        }
      : null
  );

  if (mustBakeStrokeOutline) {
    // This outline becomes permanent after the first bite. Keep it below the
    // visual-fidelity threshold and retain the authored cap/join/dash style.
    const localPolygons = createLocalStrokeOutline();
    const polygons = transformPolygons(localPolygons, transform);
    const polygonCommands = polygonSetToCommands(polygons);
    return {
      id: internalId,
      type: 'ink',
      cmds: polygonCommands,
      polygons,
      fill: visibleStroke,
      stroke: null,
      strokeWidth: 0,
      sourceWidth,
      forceWorkingFrame: true,
      paperSourceStroke: createPaperSourceStroke(),
      bounds: boundsOfCommands(polygonCommands),
      locked: object?.locked === true,
    };
  }

  // The stored width is geometry truth for native and imported ink alike.
  // Interaction affordances may be wider, but partial erase must outline the
  // exact rendered width with no provenance-specific floor.
  // PDF `0 w` is a visible device hairline, not an empty path. Give the
  // operational centerline the smallest positive width so eraser geometry
  // can intersect it while persisted/exported width remains exactly zero.
  const geometryStrokeWidth = isPdfHairline && visibleStroke
    ? Number.MIN_VALUE
    : worldStrokeWidth;
  const pristineFilledPath = Boolean(
    visibleFill
    && rawStrokeWidth === 0
    && object?.paperEraserGeometry !== 'v1'
    && localCommands.length,
  );
  if (pristineFilledPath) {
    const hasAnalyticFillBoundary = localCommands.some((command) => (
      command?.[0] === 'Q' || command?.[0] === 'C'
    ));
    const localPolygons = filledOutlineCommandsToPolygonSet(localCommands, {
      curveTolerance: localCurveTolerance,
      fillRule: object?.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    });
    const polygons = transformPolygons(localPolygons, transform);
    const polygonCommands = polygonSetToCommands(polygons);
    return {
      id: internalId,
      type: 'ink',
      cmds: polygonCommands,
      polygons,
      fill: visibleFill,
      stroke: null,
      strokeWidth: 0,
      sourceWidth,
      ...(hasAnalyticFillBoundary ? {
        paperSourceStroke: createPaperSourceFill(),
      } : {}),
      bounds: boundsOfCommands(polygonCommands),
      locked: object?.locked === true,
    };
  }
  if (persistedPolygons.length) {
    const polygons = transformPolygons(persistedPolygons, transform);
    const polygonCommands = polygonSetToCommands(polygons);
    const paperSourceStroke = transformPaperSourceStroke(
      object?.paperSourceStroke,
      transform.matrix,
    );
    return {
      id: internalId,
      type: 'ink',
      cmds: polygonCommands,
      polygons,
      fill: visibleFill || visibleStroke,
      stroke: null,
      strokeWidth: 0,
      sourceWidth,
      ...(paperSourceStroke ? { paperSourceStroke } : {}),
      bounds: boundsOfCommands(polygonCommands),
      locked: object?.locked === true,
    };
  }
  if (forcePolygon && !isPdfHairline && visibleStroke && geometryStrokeWidth > 0) {
    // Partial erase must not globally reshape the untouched curve. Legacy
    // butt/square caps, bevel/miter joins, and dash gaps are promoted from
    // their exact visible stroke style instead of silently becoming round.
    const localPolygons = createLocalStrokeOutline();
    const polygons = transformPolygons(localPolygons, transform);
    const polygonCommands = polygonSetToCommands(polygons);
    return {
      id: internalId,
      type: 'ink',
      cmds: polygonCommands,
      polygons,
      fill: visibleStroke,
      stroke: null,
      strokeWidth: 0,
      sourceWidth: sourceWidth || geometryStrokeWidth,
      paperSourceStroke: createPaperSourceStroke(),
      bounds: boundsOfCommands(polygonCommands),
      locked: object?.locked === true,
    };
  }
  return {
    id: internalId,
    type: 'ink',
    cmds: commands,
    fill: visibleFill,
    stroke: visibleStroke,
    strokeWidth: geometryStrokeWidth,
    sourceWidth,
    forcePolygon: isPdfHairline ? false : forcePolygon,
    dashMaterialized,
    bounds: boundsOfCommands(commands),
    locked: object?.locked === true,
  };
}

export function pathObjectToPagePolygons(object, eraserRadius = null) {
  return normalizeMultiPolygon(pathToPageAnnotation(
    object,
    'erase-audit',
    { forcePolygon: true, eraserRadius },
  )?.polygons);
}

function bakePagePathResult(object, result) {
  const {
    left: _left,
    top: _top,
    width: _width,
    height: _height,
    pathOffset: _pathOffset,
    // A page-space survivor's commands ARE page coordinates, so it must not
    // carry a Fabric origin — exactly why createProductionPaperInk strips
    // originX/originY (see PEN_FABRIC_RESIDUE in annotationCreationCommit).
    // Before this, a stroke that had been MOVED (the move stamps
    // originX/originY 'center') leaked that pair back through `...metadata`,
    // and createInkPathAffine applied the centre offset a second time: the
    // survivor's own centre landed on the page origin, parking the stroke in
    // the top-left corner. 2026-09-22.
    originX: _originX,
    originY: _originY,
    scaleX: _scaleX,
    scaleY: _scaleY,
    angle: _angle,
    skewX: _skewX,
    skewY: _skewY,
    flipX: _flipX,
    flipY: _flipY,
    inkGeometryOrigin: _inkGeometryOrigin,
    path: _path,
    cmds: _cmds,
    polygons: _polygons,
    paperCenterline: _paperCenterline,
    paperCenterlineRuns: _paperCenterlineRuns,
    paperSourceStroke: _paperSourceStroke,
    paperEraserCuts: _paperEraserCuts,
    ...metadata
  } = object;
  const bounds = boundsOfCommands(result.cmds);
  const filled = hasVisiblePaint(result.fill) && numberOr(result.strokeWidth) === 0;
  const paperSourceStroke = result.paperSourceStroke || object?.paperSourceStroke || null;
  let paperEraserCuts = [];
  if (paperSourceStroke) {
    try {
      paperEraserCuts = subtractPolygonGeometries(
        paperSourceStrokeOutlinePolygons(paperSourceStroke),
        result.polygons,
      );
    } catch (error) {
      // The source outline itself could not be built (w39: an unverifiable
      // round-stroke union throws). The survivor polygon is still exact; it
      // renders as its own polygon, like a failed cut subtraction.
      console.warn('Paper eraser cut-mask construction failed; polygon rendering retained:', error);
      paperEraserCuts = [];
    }
  }

  const baked = {
    ...metadata,
    type: 'path',
    path: result.cmds,
    left: 0,
    top: 0,
    width: bounds.w,
    height: bounds.h,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    inkGeometrySpace: 'page',
    stroke: filled ? 'transparent' : result.stroke,
    strokeWidth: filled ? 0 : result.sourceWidth ?? result.strokeWidth,
    fill: filled ? result.fill : null,
    ...(filled ? {
      fillRule: 'evenodd',
      paperInkGeometry: metadata.paperInkGeometry || 'v1',
      paperEraserGeometry: 'v1',
      polygons: normalizeMultiPolygon(result.polygons),
      sourceWidth: result.sourceWidth,
      // The renderers and the exporter clip the exact source to the survivor
      // polygons (w38), so the source rides along whenever a survivor
      // exists. It used to depend on the cut mask being non-empty, so a
      // failed cut boolean silently switched the mark to polygon rendering
      // (w38 review). The cuts are kept only as stored data for old readers.
      ...(paperSourceStroke && normalizeMultiPolygon(result.polygons).length > 0 ? {
        paperSourceStroke,
        ...(paperEraserCuts.length > 0 ? { paperEraserCuts } : {}),
      } : {}),
    } : {}),
  };
  // Preserve ordinary annotation metadata byte-for-byte. Imported/local ink
  // already carries the duplicate data marker, so only replace it when it
  // exists; the canonical top-level marker above covers native ink.
  if (metadata.data && (
    Object.prototype.hasOwnProperty.call(metadata.data, 'inkGeometrySpace')
    || Object.prototype.hasOwnProperty.call(metadata.data, 'inkGeometryOrigin')
  )) {
    const {
      inkGeometryOrigin: _dataInkGeometryOrigin,
      ...data
    } = metadata.data;
    baked.data = { ...data, inkGeometrySpace: 'page' };
  }
  if (result.dashMaterialized === true) {
    // The survivor already contains only the painted dash runs. Retaining the
    // source pattern would restart its phase at every new M and visibly
    // redraw erased gaps/dashes after pointer-up.
    delete baked.strokeDashArray;
    delete baked.strokeDashOffset;
  }
  const storageKey = getAnnotationStorageKey(object);
  if (storageKey != null) setAnnotationStorageKey(baked, storageKey);
  return baked;
}

/**
 * Compose independently-authored partial-erase survivors. Every survivor is a
 * subset of the same stable base object, so their intersection is exactly
 * "apply every bite". One survivor is returned byte-for-byte; only concurrent
 * writer lanes require a polygon boolean operation.
 * w38 (2026-09-25): those survivors share most edges bit for bit, so the
 * intersection nudges one operand off the shared vertices first — a plain
 * Martinez intersection painted erased dabs back in and dropped blocks of ink
 * on the owner's Package 2 page-1 strokes
 * (tests/eraserLaneCompositionRealData.test.mjs).
 */
export function intersectErasedPathSurvivors(survivors, { outlineArea = null } = {}) {
  const values = (survivors || []).filter((object) => (
    object
    && String(object.type || '').toLowerCase() === 'path'
    && normalizeMultiPolygon(object.polygons).length > 0
  ));
  if (!values.length) return null;
  if (values.length === 1) return values[0];

  let polygons = normalizeMultiPolygon(values[0].polygons);
  for (let index = 1; index < values.length; index += 1) {
    const next = intersectSharedOutlinePolygonSets(polygons, values[index].polygons, { outlineArea });
    if (next === null) {
      // Every attempt threw (w38 review): that is not "fully erased". Show
      // the lane with the least ink left, never hide the whole mark.
      return values.reduce((smallest, value) => (
        polygonSetArea(value.polygons) < polygonSetArea(smallest.polygons) ? value : smallest
      ));
    }
    polygons = next;
    if (!polygons.length) return null;
  }
  const cmds = polygonSetToCommands(polygons);
  return bakePagePathResult(values[0], {
    cmds,
    polygons,
    fill: values[0].fill,
    stroke: null,
    strokeWidth: 0,
    sourceWidth: values[0].sourceWidth,
  });
}

const eraserBaseGeometrySignature = (object) => JSON.stringify({
  type: String(object?.type || '').toLowerCase(),
  path: object?.path || null,
  cmds: object?.cmds || null,
  polygons: normalizeMultiPolygon(object?.polygons),
  paperCenterline: object?.paperCenterline || null,
  paperCenterlineRuns: object?.paperCenterlineRuns || null,
  paperInkGeometry: object?.paperInkGeometry || null,
  paperEraserGeometry: object?.paperEraserGeometry || null,
  paperSourceStroke: object?.paperSourceStroke || null,
  sourceWidth: numberOr(object?.sourceWidth),
  strokeWidth: numberOr(object?.strokeWidth),
  strokeLineCap: object?.strokeLineCap || null,
  strokeLineJoin: object?.strokeLineJoin || null,
  strokeMiterLimit: numberOr(object?.strokeMiterLimit, 10),
  strokeDashArray: object?.strokeDashArray || null,
  strokeDashOffset: numberOr(object?.strokeDashOffset),
  fillRule: object?.fillRule || null,
});

const eraserBaseTransformSnapshot = (object) => ({
  left: numberOr(object?.left),
  top: numberOr(object?.top),
  scaleX: numberOr(object?.scaleX, 1) || 1,
  scaleY: numberOr(object?.scaleY, 1) || 1,
  angle: numberOr(object?.angle),
  pathOffset: object?.pathOffset
    ? {
        x: numberOr(object.pathOffset.x),
        y: numberOr(object.pathOffset.y),
      }
    : null,
  skewX: numberOr(object?.skewX),
  skewY: numberOr(object?.skewY),
  flipX: object?.flipX === true,
  flipY: object?.flipY === true,
  originX: object?.originX ?? null,
  originY: object?.originY ?? null,
});

function rebasePolygonSet(polygons, capturedObject, currentObject, commands) {
  const capturedTransform = createPathTransform(capturedObject, commands);
  const currentTransform = createPathTransform(currentObject, commands);
  return normalizeMultiPolygon(polygons).map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => {
      const local = capturedTransform.inverse({ x, y });
      const page = currentTransform.point(local);
      return [page.x, page.y];
    })
  )));
}

function canonicalSurvivorPolygons(object, geometryBase) {
  const polygons = normalizeMultiPolygon(object?.polygons);
  const snapshot = object?.paperEraserBaseTransform;
  if (!polygons.length || !snapshot || !geometryBase) return null;
  let commands = normalizeFabricPath(geometryBase.path);
  if (!commands.length) commands = normalizeFabricPath(geometryBase.cmds);
  if (!commands.length && normalizeMultiPolygon(geometryBase.polygons).length) {
    commands = polygonSetToCommands(geometryBase.polygons);
  }
  if (!commands.length) return null;
  const transform = createPathTransform({ ...geometryBase, ...snapshot }, commands);
  return polygons.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => {
    const local = transform.inverse({ x, y });
    return [
      Math.round(local.x * 1e7) / 1e7,
      Math.round(local.y * 1e7) / 1e7,
    ];
  })));
}

export function erasedPathSurvivorsShareGeometry(left, right, geometryBase) {
  if (
    left?.paperEraserGeometry !== 'v1'
    || right?.paperEraserGeometry !== 'v1'
  ) return false;
  const leftCanonical = canonicalSurvivorPolygons(left, geometryBase);
  const rightCanonical = canonicalSurvivorPolygons(right, geometryBase);
  return Boolean(
    leftCanonical
    && rightCanonical
    && JSON.stringify(leftCanonical) === JSON.stringify(rightCanonical),
  );
}

/**
 * Rebase one bounded partial-erase survivor onto the current durable base.
 * Compatible affine edits transform the accumulated cut. Incompatible path or
 * stroke geometry makes this lane a no-op, so the collaborator's current base
 * wins instead of stale geometry.
 * Re-baking from currentBase preserves collaborator style/metadata.
 */
export function rebaseErasedPathSurvivor(
  currentBase,
  capturedBase,
  survivor,
  { geometryBase = capturedBase } = {},
) {
  if (!currentBase || !survivor) return null;
  const survivorPolygons = normalizeMultiPolygon(survivor.polygons);
  if (!survivorPolygons.length) return null;
  if (
    geometryBase
    && eraserBaseGeometrySignature(currentBase) !== eraserBaseGeometrySignature(geometryBase)
  ) {
    return null;
  }

  let currentCommands = normalizeFabricPath(currentBase.path);
  if (!currentCommands.length) currentCommands = normalizeFabricPath(currentBase.cmds);
  if (!currentCommands.length && normalizeMultiPolygon(currentBase.polygons).length) {
    currentCommands = polygonSetToCommands(currentBase.polygons);
  }
  if (!currentCommands.length) return null;
  const capturedSnapshot = capturedBase?.paperEraserBaseTransform;
  const capturedTransformObject = capturedSnapshot
    ? { ...currentBase, ...capturedSnapshot }
    : capturedBase;
  const canTransform = capturedTransformObject && (
    capturedSnapshot
    || eraserBaseGeometrySignature(currentBase) === eraserBaseGeometrySignature(capturedBase)
  );
  const polygons = canTransform
    ? rebasePolygonSet(
        survivorPolygons,
        capturedTransformObject,
        currentBase,
        currentCommands,
      )
    : survivorPolygons;
  const currentGeometry = pathToPageAnnotation(currentBase, 'eraser-rebase', {
    forcePolygon: true,
  });
  if (!currentGeometry) return null;

  const rebased = {
    ...bakePagePathResult(currentBase, {
      cmds: polygonSetToCommands(polygons),
      polygons,
      fill: currentGeometry.fill,
      stroke: null,
      strokeWidth: 0,
      sourceWidth: currentGeometry.sourceWidth,
      paperSourceStroke: currentGeometry.paperSourceStroke,
    }),
    paperEraserBaseTransform: eraserBaseTransformSnapshot(currentBase),
  };
  for (const key of [
    'pdfImportedEditState',
    'pdfImportedEditedAt',
    'pdfImportedEditedBy',
    'pdfImportedEditSource',
  ]) {
    if (Object.prototype.hasOwnProperty.call(survivor, key)) {
      rebased[key] = survivor[key];
    }
  }
  if (survivor.data?.pdfImportedEditState) {
    rebased.data = {
      ...(rebased.data || {}),
      pdfImportedEditState: survivor.data.pdfImportedEditState,
    };
  }
  return rebased;
}

const unique = (values) => values.filter((value, index) => value && values.indexOf(value) === index);

const getPdfAppearanceCompositeId = (object) => (
  object?.data?.pdfAppearanceCompositeId || null
);

/**
 * Applies one eraser gesture directly to the latest persisted page model.
 * Untouched objects retain their exact references and ordering.
 */
// A mark whose geometry the polygon engine cannot process (it throws, or
// hits the vendored engine's hard iteration bound) stays exactly as it was.
// One eraser tap must never freeze the page or corrupt a mark (w39,
// 2026-09-25: a self-crossing stroked curve spun Martinez forever).
function skipMarkForFailedGeometry(object, index, stage, error) {
  const annotationId = object ? getEraserCandidateId(object, index) : null;
  console.warn('[EraserSkippedMark]', JSON.stringify({
    annotationId,
    stage,
    error: error?.name === 'MartinezNonConvergenceError'
      ? `${error.name}: ${error.stage}`
      : String(error?.message || error),
  }));
  return { annotationId, failedStages: { [stage]: 1 }, recovered: false, skipped: true };
}

// Erase a group in one pass (the eraser mask is built once); if any mark's
// geometry throws, redo the group one mark at a time so only that mark is
// left unchanged.
function eraseAnnotationsIsolatingFailures(annotations, points, radius, operation, onFailed) {
  try {
    return eraseAnnotations(annotations, points, radius, operation);
  } catch {
    const merged = { annotations: [], changedIds: [], deletedIds: [], failures: [] };
    for (const annotation of annotations) {
      let result;
      try {
        result = eraseAnnotations([annotation], points, radius, operation);
      } catch (error) {
        onFailed(annotation, error);
        merged.annotations.push(annotation);
        continue;
      }
      merged.annotations.push(...result.annotations);
      merged.changedIds.push(...result.changedIds);
      merged.deletedIds.push(...result.deletedIds);
      merged.failures.push(...(result.failures || []));
    }
    return merged;
  }
}

export function erasePageAnnotations({
  pageAnnotations,
  eraserPoints,
  eraserRadius,
  mode = 'partial',
  canErase = () => true,
} = {}) {
  const objects = Array.isArray(pageAnnotations?.objects) ? pageAnnotations.objects : [];
  const points = Array.isArray(eraserPoints) ? eraserPoints : [];
  const radius = Number(eraserRadius);
  if (!objects.length || !points.length || !Number.isFinite(radius) || radius <= 0) {
    return {
      pageAnnotations,
      didChange: false,
      changedIds: [],
      deletedIds: [],
      touchedIds: [],
      objectMutations: [],
    };
  }

  const requestedMode = mode === 'entire' || mode === 'full' ? 'full' : 'partial';
  const pathGroups = { partial: [], full: [] };
  const pathRecords = new Map();
  const replacementByIndex = new Map();
  const deletedIndexes = new Set();
  const fullyDeletedAppearanceGroups = new Set();
  const changedIds = [];
  const deletedIds = [];
  const touchedIds = [];
  const failedStages = [];

  objects.forEach((object, index) => {
    if (!canErase(object, index)) return;
    if (String(object?.type || '').toLowerCase() !== 'path') return;
    const internalId = `page-object:${index}`;
    const operation = requestedMode === 'full'
      ? 'full'
      : (getEraserOperation(object, 'partial') === 'partial' ? 'partial' : 'full');
    let annotation;
    try {
      annotation = pathToPageAnnotation(object, internalId, {
        // Both modes hit-test the stroke's actual painted outline. Solid round
        // strokes remain their authored centerlines because a radius-expanded
        // capsule is their exact outline; styled strokes promote to polygons so
        // dash gaps and butt/square/bevel/miter geometry remain exact.
        forcePolygon: true,
        eraserRadius: radius,
      });
    } catch (error) {
      const failure = skipMarkForFailedGeometry(object, index, 'outline', error);
      failedStages.push(failure);
      // Whole-mark erase needs only "did the eraser touch it", not an exact
      // outline, so a mark whose outline cannot be built is still erasable.
      // Partial erase leaves the mark exactly as it was.
      if (operation === 'full') {
        let touched = false;
        try {
          touched = eraserStrokeTouchesObject({ eraserPoints: points, eraserRadius: radius, object });
        } catch {
          touched = false;
        }
        if (touched) {
          const objectId = getEraserCandidateId(object, index);
          touchedIds.push(objectId);
          deletedIds.push(objectId);
          deletedIndexes.add(index);
          const compositeId = getPdfAppearanceCompositeId(object);
          if (compositeId) fullyDeletedAppearanceGroups.add(compositeId);
          failure.recovered = true;
          failure.skipped = false;
        }
      }
      return;
    }
    if (!annotation) return;
    pathGroups[operation].push(annotation);
    pathRecords.set(internalId, { object, index });
  });

  for (const operation of ['partial', 'full']) {
    const annotations = pathGroups[operation];
    if (!annotations.length) continue;
    const result = eraseAnnotationsIsolatingFailures(
      annotations,
      points,
      radius,
      operation,
      (annotation, error) => {
        const record = pathRecords.get(annotation.id);
        failedStages.push(skipMarkForFailedGeometry(
          record?.object, record?.index, `${operation}-erase`, error,
        ));
      },
    );
    failedStages.push(...(result.failures || []));
    if (!result.changedIds.length) continue;
    const survivorById = new Map(result.annotations.map((annotation) => [annotation.id, annotation]));
    const deletedInternalIds = new Set(result.deletedIds);

    for (const internalId of result.changedIds) {
      const record = pathRecords.get(internalId);
      if (!record) continue;
      const objectId = getEraserCandidateId(record.object, record.index);
      touchedIds.push(objectId);
      if (deletedInternalIds.has(internalId)) {
        deletedIndexes.add(record.index);
        deletedIds.push(objectId);
        if (operation === 'full') {
          const compositeId = getPdfAppearanceCompositeId(record.object);
          if (compositeId) fullyDeletedAppearanceGroups.add(compositeId);
        }
        continue;
      }
      const survivor = survivorById.get(internalId);
      const originalGeometry = annotations.find((annotation) => annotation.id === internalId);
      if (!survivor || JSON.stringify(survivor.cmds) === JSON.stringify(originalGeometry?.cmds)) continue;
      let replacement;
      try {
        replacement = bakePagePathResult(record.object, survivor);
      } catch (error) {
        failedStages.push(skipMarkForFailedGeometry(record.object, record.index, 'bake', error));
        continue;
      }
      replacementByIndex.set(record.index, replacement);
      changedIds.push(objectId);
    }
  }

  objects.forEach((object, index) => {
    if (String(object?.type || '').toLowerCase() === 'path' || !canErase(object, index)) return;
    if (!eraserStrokeTouchesObject({ eraserPoints: points, eraserRadius: radius, object })) return;
    const objectId = getEraserCandidateId(object, index);
    touchedIds.push(objectId);
    deletedIds.push(objectId);
    deletedIndexes.add(index);
  });

  // One PDF annotation can paint several disjoint companion layers from its
  // appearance stream. Full erase is annotation-atomic: touching any layer
  // removes every authorized companion. Partial erase remains geometric and
  // only clips companions actually crossed by the eraser disk.
  if (fullyDeletedAppearanceGroups.size > 0) {
    objects.forEach((object, index) => {
      const compositeId = getPdfAppearanceCompositeId(object);
      if (
        !compositeId
        || !fullyDeletedAppearanceGroups.has(compositeId)
        || deletedIndexes.has(index)
        || !canErase(object, index)
      ) return;
      const objectId = getEraserCandidateId(object, index);
      replacementByIndex.delete(index);
      deletedIndexes.add(index);
      touchedIds.push(objectId);
      deletedIds.push(objectId);
    });
  }

  if (!replacementByIndex.size && !deletedIndexes.size) {
    return {
      pageAnnotations,
      didChange: false,
      changedIds: [],
      deletedIds: [],
      failedStages,
      touchedIds: unique(touchedIds),
      objectMutations: [],
    };
  }

  const nextObjects = [];
  objects.forEach((object, index) => {
    if (deletedIndexes.has(index)) return;
    nextObjects.push(replacementByIndex.get(index) || object);
  });

  return {
    pageAnnotations: { ...pageAnnotations, objects: nextObjects },
    didChange: true,
    changedIds: unique(changedIds),
    deletedIds: unique(deletedIds),
    failedStages,
    touchedIds: unique(touchedIds),
    objectMutations: [...new Set([...replacementByIndex.keys(), ...deletedIndexes])]
      .sort((a, b) => a - b)
      .map((index) => ({
        index,
        storageKey: getAnnotationStorageKey(objects[index]),
        annotationId: getEraserCandidateId(objects[index], index),
        base: objects[index],
        deleted: deletedIndexes.has(index),
        survivor: deletedIndexes.has(index) ? null : replacementByIndex.get(index),
      })),
  };
}
