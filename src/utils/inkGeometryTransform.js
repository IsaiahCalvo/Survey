/**
 * Exact affine transforms for ink's parallel geometry carriers.
 *
 * Ink can carry the visible SVG path plus polygon and centerline copies used
 * by erasing and PDF export. Interactive move/resize should prefer the shared
 * object transform fields so those carriers remain byte-stable. When a caller
 * truly must bake page coordinates, applyInkGeometryMatrix transforms every
 * live carrier with one matrix.
 *
 * Matrices use the SVG/Fabric shape [a, b, c, d, e, f]:
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */

import { normalizeOperationalInkPath } from './inkPathNormalization.js';

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const stableSum = (...values) => {
  if (values.some((value) => Number.isNaN(value))) return NaN;
  if (values.some((value) => !Number.isFinite(value))) {
    return values.reduce((sum, value) => sum + value, 0);
  }
  const direct = values.reduce((sum, value) => sum + value, 0);
  if (Number.isFinite(direct)) return direct;
  const scale = Math.max(0, ...values.map((value) => Math.abs(value)));
  if (scale === 0) return 0;
  return scale * values.reduce((sum, value) => sum + value / scale, 0);
};

const safeMidpoint = (low, high) => stableSum(low / 2, high / 2);

const normalizedDegrees = (value, period = 360) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return ((numeric % period) + period) % period;
};

const transformXY = (x, y, matrix) => {
  const [a, b, c, d, e, f] = matrix;
  return [
    stableSum(a * x, c * y, e),
    stableSum(b * x, d * y, f),
  ];
};

const transformCommands = (commands, matrix) => {
  if (!Array.isArray(commands)) return commands;
  return normalizeOperationalInkPath(commands).map((command) => {
    if (!Array.isArray(command) || command.length < 2) return command;
    const next = [command[0]];
    for (let index = 1; index < command.length; index += 2) {
      const x = command[index];
      const y = command[index + 1];
      if (isFiniteNumber(x) && isFiniteNumber(y)) {
        const [nextX, nextY] = transformXY(x, y, matrix);
        next.push(nextX, nextY);
      } else {
        next.push(x);
        if (index + 1 < command.length) next.push(y);
      }
    }
    return next;
  });
};

const transformPolygons = (polygons, matrix) => {
  if (!Array.isArray(polygons)) return polygons;
  return polygons.map((polygon) => (
    Array.isArray(polygon)
      ? polygon.map((ring) => (
          Array.isArray(ring)
            ? ring.map((point) => {
                if (!Array.isArray(point)
                    || !isFiniteNumber(point[0])
                    || !isFiniteNumber(point[1])) {
                  return point;
                }
                return transformXY(point[0], point[1], matrix);
              })
            : ring
        ))
      : polygon
  ));
};

const transformCenterline = (centerline, matrix) => {
  if (!Array.isArray(centerline)) return centerline;
  return centerline.map((point) => {
    if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return point;
    const [x, y] = transformXY(point.x, point.y, matrix);
    return { ...point, x, y };
  });
};

const transformCenterlineRuns = (runs, matrix) => {
  if (!Array.isArray(runs)) return runs;
  return runs.map((run) => transformCenterline(run, matrix));
};

const INK_CENTER_ORIGIN = 'center-v1';

export function getInkCommandBounds(commands) {
  const normalized = normalizeOperationalInkPath(commands);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const command of normalized || []) {
    const op = String(command?.[0] || '').toUpperCase();
    if (!['M', 'L', 'Q', 'C'].includes(op)) continue;
    for (let index = 1; index + 1 < command.length; index += 2) {
      const x = Number(command[index]);
      const y = Number(command[index + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

const multiplyMatrices = (left, right) => {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    stableSum(a1 * a2, c1 * b2),
    stableSum(b1 * a2, d1 * b2),
    stableSum(a1 * c2, c1 * d2),
    stableSum(b1 * c2, d1 * d2),
    stableSum(a1 * e2, c1 * f2, e1),
    stableSum(b1 * e2, d1 * f2, f1),
  ];
};

const translation = (x, y) => [1, 0, 0, 1, x, y];

const rotation = (degrees) => {
  const degreesModulo360 = normalizedDegrees(degrees);
  const quarterTurns = degreesModulo360 / 90;
  if (Number.isInteger(quarterTurns)) {
    switch (((quarterTurns % 4) + 4) % 4) {
      case 0: return [1, 0, 0, 1, 0, 0];
      case 1: return [0, 1, -1, 0, 0, 0];
      case 2: return [-1, 0, 0, -1, 0, 0];
      case 3: return [0, -1, 1, 0, 0, 0];
      default: break;
    }
  }
  const radians = degreesModulo360 * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine, sine, -sine, cosine, 0, 0];
};

const dimensionsMatrix = (object, { includeFlip = true } = {}) => {
  const rawScaleX = Number.isFinite(Number(object?.scaleX)) ? Number(object.scaleX) : 1;
  const rawScaleY = Number.isFinite(Number(object?.scaleY)) ? Number(object.scaleY) : 1;
  const scaleX = rawScaleX * (includeFlip && object?.flipX === true ? -1 : 1);
  const scaleY = rawScaleY * (includeFlip && object?.flipY === true ? -1 : 1);
  const tangentX = Math.tan(normalizedDegrees(object?.skewX, 180) * Math.PI / 180);
  const tangentY = Math.tan(normalizedDegrees(object?.skewY, 180) * Math.PI / 180);
  // Fabric 7.4 calcDimensionsMatrix:
  // Scale(signed) · SkewX · SkewY.
  return [
    scaleX * (1 + tangentX * tangentY),
    scaleY * tangentY,
    scaleX * tangentX,
    scaleY,
    0,
    0,
  ];
};

const originOffset = (value, low, high) => {
  // Fabric numeric origins are normalized positions: 0 = low edge,
  // 0.5 = center, 1 = high edge. Our matrix math uses center-relative
  // offsets, so translate that range by -0.5.
  if (typeof value === 'number' && Number.isFinite(value)) return value - 0.5;
  const normalized = String(value || '').toLowerCase();
  if (normalized === high) return 0.5;
  if (normalized === 'center') return 0;
  return normalized === low ? -0.5 : 0;
};

const fallbackGeometryBounds = (polygons, centerline) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x, y) => {
    const numericX = Number(x);
    const numericY = Number(y);
    if (!Number.isFinite(numericX) || !Number.isFinite(numericY)) return;
    minX = Math.min(minX, numericX);
    minY = Math.min(minY, numericY);
    maxX = Math.max(maxX, numericX);
    maxY = Math.max(maxY, numericY);
  };
  for (const polygon of polygons || []) {
    for (const ring of polygon || []) {
      for (const point of ring || []) include(point?.[0], point?.[1]);
    }
  }
  if (!Number.isFinite(minX)) {
    for (const point of centerline || []) include(point?.x, point?.y);
  }
  return Number.isFinite(minX)
    ? {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
      }
    : null;
};

/**
 * One affine truth for SVG rendering, page-space erasing, and PDF export.
 *
 * Explicit Fabric origins reproduce Fabric 7.4's calcOwnMatrix, including
 * left/top origin translation, signed flips, and Scale·SkewX·SkewY ordering.
 * Unmarked historical rows keep Survey's established placement/rotation
 * convention so merely loading them cannot shift their visible geometry.
 */
export function createInkPathAffine(
  object,
  commands,
  { polygons = [], centerline = [] } = {},
) {
  const bounds = getInkCommandBounds(commands)
    || fallbackGeometryBounds(polygons, centerline)
    || {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
  };
  const rawCenterX = safeMidpoint(bounds.minX, bounds.maxX);
  const rawCenterY = safeMidpoint(bounds.minY, bounds.maxY);
  const geometryOrigin = object?.inkGeometryOrigin || object?.data?.inkGeometryOrigin;
  // An explicit page-space declaration outranks any Fabric origin found on the
  // same row: `inkGeometrySpace: 'page'` means the commands already hold page
  // coordinates, so applying Fabric's origin offset on top of them would place
  // the stroke by its own half-size (left/top 0 parks its centre on the page
  // origin — the top-left corner). Rows saved with that stale pair, by an
  // eraser survivor bake before 2026-09-22, therefore keep rendering where
  // their commands say they are.
  const declaredPageSpace = (
    object?.inkGeometrySpace === 'page' || object?.data?.inkGeometrySpace === 'page'
  );
  const hasExplicitFabricOrigin = !declaredPageSpace
    && (object?.originX != null || object?.originY != null);
  const centerOrigin = geometryOrigin === INK_CENTER_ORIGIN;
  const pathOffsetX = Number.isFinite(Number(object?.pathOffset?.x))
    ? Number(object.pathOffset.x)
    : (centerOrigin || hasExplicitFabricOrigin ? rawCenterX : 0);
  const pathOffsetY = Number.isFinite(Number(object?.pathOffset?.y))
    ? Number(object.pathOffset.y)
    : (centerOrigin || hasExplicitFabricOrigin ? rawCenterY : 0);
  const left = Number.isFinite(Number(object?.left)) ? Number(object.left) : 0;
  const top = Number.isFinite(Number(object?.top)) ? Number(object.top) : 0;
  const angle = Number.isFinite(Number(object?.angle)) ? Number(object.angle) : 0;
  const dimensions = dimensionsMatrix(object);
  const rotate = rotation(angle);

  let centerX;
  let centerY;
  if (centerOrigin) {
    // Survey's explicit center-v1 contract supersedes stale Fabric origin
    // fields that may survive serialization/localization.
    centerX = left;
    centerY = top;
  } else if (hasExplicitFabricOrigin) {
    const strokeWidth = Math.max(0, Number(object?.strokeWidth) || 0);
    const strokeUniform = object?.strokeUniform === true;
    const width = Number.isFinite(Number(object?.width))
      ? Number(object.width)
      : bounds.width;
    const height = Number.isFinite(Number(object?.height))
      ? Number(object.height)
      : bounds.height;
    const preStroke = strokeUniform ? 0 : strokeWidth;
    const postStroke = strokeUniform ? strokeWidth : 0;
    const unsignedDimensions = dimensionsMatrix(object, { includeFlip: false });
    const transformedWidth = stableSum(
      Math.abs(unsignedDimensions[0]) * (width + preStroke),
      Math.abs(unsignedDimensions[2]) * (height + preStroke),
      postStroke,
    );
    const transformedHeight = stableSum(
      Math.abs(unsignedDimensions[1]) * (width + preStroke),
      Math.abs(unsignedDimensions[3]) * (height + preStroke),
      postStroke,
    );
    const deltaX = -originOffset(object?.originX, 'left', 'right') * transformedWidth;
    const deltaY = -originOffset(object?.originY, 'top', 'bottom') * transformedHeight;
    const rotatedDeltaX = stableSum(rotate[0] * deltaX, rotate[2] * deltaY);
    const rotatedDeltaY = stableSum(rotate[1] * deltaX, rotate[3] * deltaY);
    centerX = stableSum(left, rotatedDeltaX);
    centerY = stableSum(top, rotatedDeltaY);
  } else {
    // Historical SVG/page-space convention: rotate around the scaled path
    // bounds center while `left/top` translate the unrotated carrier.
    const centerDeltaX = rawCenterX - pathOffsetX;
    const centerDeltaY = rawCenterY - pathOffsetY;
    centerX = stableSum(
      left,
      dimensions[0] * centerDeltaX,
      dimensions[2] * centerDeltaY,
    );
    centerY = stableSum(
      top,
      dimensions[1] * centerDeltaX,
      dimensions[3] * centerDeltaY,
    );
  }

  let matrix = multiplyMatrices(translation(centerX, centerY), rotate);
  matrix = multiplyMatrices(matrix, dimensions);
  matrix = multiplyMatrices(
    matrix,
    translation(
      centerOrigin || hasExplicitFabricOrigin ? -pathOffsetX : -rawCenterX,
      centerOrigin || hasExplicitFabricOrigin ? -pathOffsetY : -rawCenterY,
    ),
  );

  const [a, b, c, d, e, f] = matrix;
  const metricScale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  const normalizedA = metricScale > 0 ? a / metricScale : 0;
  const normalizedB = metricScale > 0 ? b / metricScale : 0;
  const normalizedC = metricScale > 0 ? c / metricScale : 0;
  const normalizedD = metricScale > 0 ? d / metricScale : 0;
  const normalizedDeterminant = (
    normalizedA * normalizedD - normalizedB * normalizedC
  );
  const determinantLogMagnitude = normalizedDeterminant === 0 || metricScale === 0
    ? -Infinity
    : Math.log(Math.abs(normalizedDeterminant)) + 2 * Math.log(metricScale);
  const determinant = normalizedDeterminant === 0
    ? 0
    : Math.sign(normalizedDeterminant) * Math.exp(determinantLogMagnitude);
  // Stable closed form for the singular values of [[a,c],[b,d]]:
  // sigma1,2 = (hypot(a+d,b-c) +/- hypot(a-d,b+c)) / 2.
  // Normalize first so neither squaring nor the final sum can overflow.
  const sumNorm = Math.hypot(
    normalizedA + normalizedD,
    normalizedB - normalizedC,
  );
  const differenceNorm = Math.hypot(
    normalizedA - normalizedD,
    normalizedB + normalizedC,
  );
  const maxScaleNorm = (sumNorm + differenceNorm) / 2;
  const cleanMetric = (value) => (
    Number.isFinite(value) && value !== 0 ? Number(value.toPrecision(14)) : value
  );
  const maxScale = cleanMetric(metricScale * maxScaleNorm);
  // sigmaMin = |det| / sigmaMax is substantially more stable than the
  // subtractive eigenvalue formula for extreme nonuniform scales.
  const minScaleNorm = maxScaleNorm > 0
    ? Math.abs(normalizedDeterminant) / maxScaleNorm
    : 0;
  const minScale = cleanMetric(metricScale * minScaleNorm);
  const strokeScale = cleanMetric(
    metricScale * Math.sqrt(Math.abs(normalizedDeterminant)),
  );
  const conformalTolerance = Number.EPSILON * 64 * Math.max(
    maxScaleNorm,
    minScaleNorm,
    Number.MIN_VALUE,
  );
  const conformal = Math.abs(maxScaleNorm - minScaleNorm) <= conformalTolerance;

  const point = (value, maybeY) => {
    const x = typeof value === 'object' ? Number(value?.x) : Number(value);
    const y = typeof value === 'object' ? Number(value?.y) : Number(maybeY);
    return {
      x: stableSum(a * x, c * y, e),
      y: stableSum(b * x, d * y, f),
    };
  };
  const inverse = (value, maybeY) => {
    const x = typeof value === 'object' ? Number(value?.x) : Number(value);
    const y = typeof value === 'object' ? Number(value?.y) : Number(maybeY);
    if (
      metricScale === 0
      || !Number.isFinite(metricScale)
      || normalizedDeterminant === 0
      || !Number.isFinite(normalizedDeterminant)
    ) {
      return { x: NaN, y: NaN };
    }
    const pageX = x - e;
    const pageY = y - f;
    const scaledPageX = pageX / metricScale;
    const scaledPageY = pageY / metricScale;
    return {
      x: stableSum(
        normalizedD * scaledPageX,
        -normalizedC * scaledPageY,
      ) / normalizedDeterminant,
      y: stableSum(
        -normalizedB * scaledPageX,
        normalizedA * scaledPageY,
      ) / normalizedDeterminant,
    };
  };

  return {
    matrix,
    bounds,
    determinant,
    maxScale,
    minScale,
    strokeScale,
    conformal,
    point,
    inverse,
  };
}

export function isCenterOriginInkGeometry(object) {
  return (object?.inkGeometryOrigin || object?.data?.inkGeometryOrigin) === INK_CENTER_ORIGIN;
}

function localizePageInkGeometry(object) {
  if (!isAbsoluteInkGeometry(object)) return object;
  const bounds = getInkCommandBounds(object.path);
  if (!bounds) return object;
  const scaleX = Number.isFinite(object.scaleX) ? object.scaleX : 1;
  const scaleY = Number.isFinite(object.scaleY) ? object.scaleY : 1;
  const centerX = safeMidpoint(bounds.minX, bounds.maxX);
  const centerY = safeMidpoint(bounds.minY, bounds.maxY);
  const previousAffine = createInkPathAffine(object, object.path);
  const pageCenter = previousAffine.point(centerX, centerY);
  return {
    ...object,
    // Interactive transforms live in object fields. The authored legacy path
    // (including relative commands and A/a arc parameters) remains immutable.
    path: object.path,
    left: pageCenter.x,
    top: pageCenter.y,
    width: bounds.width,
    height: bounds.height,
    scaleX,
    scaleY,
    pathOffset: { x: centerX, y: centerY },
    originX: 'center',
    originY: 'center',
    inkGeometrySpace: 'local',
    inkGeometryOrigin: INK_CENTER_ORIGIN,
    data: {
      ...(object.data || {}),
      inkGeometrySpace: 'local',
      inkGeometryOrigin: INK_CENTER_ORIGIN,
    },
  };
}

export function commitInkObjectMove(object, dx, dy) {
  const localized = localizePageInkGeometry(object);
  return {
    ...localized,
    left: stableSum(Number(localized?.left || 0), Number(dx || 0)),
    top: stableSum(Number(localized?.top || 0), Number(dy || 0)),
  };
}

export function commitInkObjectResize(object, {
  scaleX,
  scaleY,
  visibleLeft,
  visibleTop,
} = {}) {
  const localized = localizePageInkGeometry(object);
  if (!isCenterOriginInkGeometry(localized)) return localized;
  const numericScaleX = Number(scaleX);
  const numericScaleY = Number(scaleY);
  const nextScaleX = Math.max(
    0.01,
    Math.abs(Number.isFinite(numericScaleX) ? numericScaleX : 1),
  );
  const nextScaleY = Math.max(
    0.01,
    Math.abs(Number.isFinite(numericScaleY) ? numericScaleY : 1),
  );
  const width = Number(localized.width || 0);
  const height = Number(localized.height || 0);
  return {
    ...localized,
    left: stableSum(Number(visibleLeft || 0), width * nextScaleX / 2),
    top: stableSum(Number(visibleTop || 0), height * nextScaleY / 2),
    scaleX: nextScaleX,
    scaleY: nextScaleY,
  };
}

/**
 * Preserve a real visible path dimension exactly during pointer-resize
 * capture. A fixed epsilon changes the scale denominator for legitimately
 * microscopic or huge imported geometry.
 */
export function getExactInkResizeDimension(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function isAbsoluteInkGeometry(object) {
  const isPath = String(object?.type || '').toLowerCase() === 'path'
    && Array.isArray(object?.path);
  if (!isPath) return false;
  const coordinateSpace = object?.inkGeometrySpace || object?.data?.inkGeometrySpace;
  if (coordinateSpace === 'page') return true;
  if (coordinateSpace === 'local') return false;

  const leftIsOrigin = object?.left == null || object.left === 0;
  const topIsOrigin = object?.top == null || object.top === 0;
  const pathOffsetIsOrigin = !object?.pathOffset
    || (object.pathOffset.x === 0 && object.pathOffset.y === 0);

  // Normalized PDF imports use local coordinates even when their world
  // origin happens to be (0,0). Provenance plus persisted dimensions is the
  // safe legacy discriminator until every producer stamps inkGeometrySpace.
  const normalizedPdfImport = object?.isPdfImported === true
    && object.left != null
    && object.top != null
    && isFiniteNumber(object.width)
    && isFiniteNumber(object.height);
  if (normalizedPdfImport) return false;

  return leftIsOrigin
    && topIsOrigin
    && pathOffsetIsOrigin;
}

export function applyInkGeometryMatrix(object, matrix) {
  if (!object || !Array.isArray(matrix) || matrix.length !== 6) return object;
  const next = { ...object };
  if (Array.isArray(object.path)) next.path = transformCommands(object.path, matrix);
  if (Array.isArray(object.cmds)) next.cmds = transformCommands(object.cmds, matrix);
  if (Array.isArray(object.polygons)) next.polygons = transformPolygons(object.polygons, matrix);
  if (Array.isArray(object.paperEraserCuts)) {
    next.paperEraserCuts = transformPolygons(object.paperEraserCuts, matrix);
  }
  if (
    object.paperSourceStroke
    && Array.isArray(object.paperSourceStroke.matrix)
    && object.paperSourceStroke.matrix.length === 6
  ) {
    next.paperSourceStroke = {
      ...object.paperSourceStroke,
      matrix: multiplyMatrices(matrix, object.paperSourceStroke.matrix),
    };
  }
  if (Array.isArray(object.paperCenterline)) {
    next.paperCenterline = transformCenterline(object.paperCenterline, matrix);
  }
  if (Array.isArray(object.paperCenterlineRuns)) {
    next.paperCenterlineRuns = transformCenterlineRuns(object.paperCenterlineRuns, matrix);
  }
  const presentation = object.data?.pdfInkPresentationGeometry;
  if (presentation && typeof presentation === 'object') {
    next.data = {
      ...object.data,
      pdfInkPresentationGeometry: {
        ...presentation,
        ...(Array.isArray(presentation.path)
          ? { path: transformCommands(presentation.path, matrix) }
          : {}),
        ...(Array.isArray(presentation.polygons)
          ? { polygons: transformPolygons(presentation.polygons, matrix) }
          : {}),
      },
    };
  }
  return next;
}

/**
 * Compose a page-space affine onto an ink object without rewriting any
 * authored geometry carrier. The resulting Fabric fields are a QR
 * decomposition of pageMatrix · currentObjectMatrix:
 *   Rotate · Scale(+sx, signed sy via flipY) · SkewX
 */
export function applyPageAffineToInkObject(object, pageMatrix) {
  if (!object || !Array.isArray(pageMatrix) || pageMatrix.length !== 6) return object;
  if (!pageMatrix.every((value) => Number.isFinite(Number(value)))) return object;
  const commands = Array.isArray(object.path) && object.path.length
    ? object.path
    : object.cmds;
  const bounds = getInkCommandBounds(commands);
  if (!bounds) return object;

  const current = createInkPathAffine(object, commands, {
    polygons: object.polygons,
    centerline: object.paperCenterline,
  });
  const composed = multiplyMatrices(
    pageMatrix.map(Number),
    current.matrix,
  );
  const [a, b, c, d, e, f] = composed;
  const qrScale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  const normalizedA = qrScale > 0 ? a / qrScale : 0;
  const normalizedB = qrScale > 0 ? b / qrScale : 0;
  const normalizedC = qrScale > 0 ? c / qrScale : 0;
  const normalizedD = qrScale > 0 ? d / qrScale : 0;
  const normalizedDeterminant = (
    normalizedA * normalizedD - normalizedB * normalizedC
  );
  const scaleXNorm = Math.hypot(normalizedA, normalizedB);
  const scaleX = qrScale * scaleXNorm;
  if (
    !Number.isFinite(qrScale)
    || qrScale === 0
    || normalizedDeterminant === 0
    || !Number.isFinite(scaleX)
    || scaleX === 0
  ) {
    return object;
  }

  const cosine = normalizedA / scaleXNorm;
  const sine = normalizedB / scaleXNorm;
  const signedScaleY = qrScale * normalizedDeterminant / scaleXNorm;
  const skewTangent = (
    cosine * normalizedC + sine * normalizedD
  ) / scaleXNorm;
  const angle = Math.atan2(sine, cosine) * 180 / Math.PI;
  const skewX = Math.atan(skewTangent) * 180 / Math.PI;
  const centerX = safeMidpoint(bounds.minX, bounds.maxX);
  const centerY = safeMidpoint(bounds.minY, bounds.maxY);
  const left = stableSum(a * centerX, c * centerY, e);
  const top = stableSum(b * centerX, d * centerY, f);

  return {
    ...object,
    left,
    top,
    width: bounds.width,
    height: bounds.height,
    pathOffset: { x: centerX, y: centerY },
    originX: 'center',
    originY: 'center',
    angle,
    scaleX,
    scaleY: Math.abs(signedScaleY),
    flipX: false,
    flipY: signedScaleY < 0,
    skewX,
    skewY: 0,
    inkGeometrySpace: 'local',
    inkGeometryOrigin: INK_CENTER_ORIGIN,
    data: {
      ...(object.data || {}),
      inkGeometrySpace: 'local',
      inkGeometryOrigin: INK_CENTER_ORIGIN,
    },
  };
}



export function scaleInRotatedFrameAroundMatrix(
  scaleX,
  scaleY,
  angleDegrees,
  anchorX,
  anchorY,
) {
  let matrix = translation(Number(anchorX) || 0, Number(anchorY) || 0);
  matrix = multiplyMatrices(matrix, rotation(Number(angleDegrees) || 0));
  matrix = multiplyMatrices(matrix, [
    Number(scaleX),
    0,
    0,
    Number(scaleY),
    0,
    0,
  ]);
  matrix = multiplyMatrices(matrix, rotation(-(Number(angleDegrees) || 0)));
  return multiplyMatrices(
    matrix,
    translation(-(Number(anchorX) || 0), -(Number(anchorY) || 0)),
  );
}
