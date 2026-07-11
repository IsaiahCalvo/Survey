import {
  boundsOfCommands,
  commandsToPolygonSet,
  eraseAnnotations,
  normalizeMultiPolygon,
  polygonSetToCommands,
} from './paperAnnotationGeometry.js';
import {
  eraserStrokeTouchesObject,
  getEraserCandidateId,
} from './eraserHitTest.js';
import { getEraserOperation } from './eraserPolicy.js';

const EPSILON = 1e-7;
const IMPORTED_INK_MIN_WIDTH = 2.5;

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

const commandEndpoint = (command) => {
  if (!Array.isArray(command) || command.length < 3) return null;
  return {
    x: numberOr(command[command.length - 2]),
    y: numberOr(command[command.length - 1]),
  };
};

function normalizeFabricPath(path) {
  const normalized = [];
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };

  for (const raw of path || []) {
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const sourceOp = String(raw[0]);
    const op = sourceOp.toUpperCase();
    const relative = sourceOp !== op;
    const x = (index) => numberOr(raw[index]) + (relative ? current.x : 0);
    const y = (index) => numberOr(raw[index]) + (relative ? current.y : 0);

    if (op === 'M' || op === 'L') {
      current = { x: x(1), y: y(2) };
      if (op === 'M') start = current;
      normalized.push([op, current.x, current.y]);
    } else if (op === 'H') {
      current = { x: x(1), y: current.y };
      normalized.push(['L', current.x, current.y]);
    } else if (op === 'V') {
      current = { x: current.x, y: y(1) };
      normalized.push(['L', current.x, current.y]);
    } else if (op === 'Q') {
      const control = { x: x(1), y: y(2) };
      current = { x: x(3), y: y(4) };
      normalized.push(['Q', control.x, control.y, current.x, current.y]);
    } else if (op === 'C') {
      const c1 = { x: x(1), y: y(2) };
      const c2 = { x: x(3), y: y(4) };
      current = { x: x(5), y: y(6) };
      normalized.push(['C', c1.x, c1.y, c2.x, c2.y, current.x, current.y]);
    } else if (op === 'Z') {
      current = start;
      normalized.push(['Z']);
    } else {
      const endpoint = commandEndpoint(raw);
      if (!endpoint) continue;
      current = relative
        ? { x: current.x + endpoint.x, y: current.y + endpoint.y }
        : endpoint;
      normalized.push(['L', current.x, current.y]);
    }
  }
  return normalized;
}

function commandCoordinateBounds(commands) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const command of commands || []) {
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
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function createPathTransform(object, commands) {
  const left = numberOr(object?.left);
  const top = numberOr(object?.top);
  const scaleX = numberOr(object?.scaleX, 1) || 1;
  const scaleY = numberOr(object?.scaleY, 1) || 1;
  const pathOffsetX = numberOr(object?.pathOffset?.x);
  const pathOffsetY = numberOr(object?.pathOffset?.y);
  const angle = numberOr(object?.angle) * Math.PI / 180;
  const bounds = commandCoordinateBounds(commands);
  const centerX = bounds
    ? scaleX * ((bounds.minX + bounds.maxX) / 2 - pathOffsetX)
    : 0;
  const centerY = bounds
    ? scaleY * ((bounds.minY + bounds.maxY) / 2 - pathOffsetY)
    : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    scaleX,
    scaleY,
    point(point) {
      const scaledX = scaleX * (point.x - pathOffsetX);
      const scaledY = scaleY * (point.y - pathOffsetY);
      const dx = scaledX - centerX;
      const dy = scaledY - centerY;
      return {
        x: left + centerX + dx * cos - dy * sin,
        y: top + centerY + dx * sin + dy * cos,
      };
    },
  };
}

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

function pathToPageAnnotation(object, internalId, { forcePolygon = false } = {}) {
  const localCommands = normalizeFabricPath(object?.path);
  if (!localCommands.length) return null;
  const transform = createPathTransform(object, localCommands);
  const commands = transformCommands(localCommands, transform);
  const rawStrokeWidth = Math.max(0, numberOr(object?.strokeWidth));
  const scaleMagnitude = Math.sqrt(Math.abs(transform.scaleX * transform.scaleY));
  const worldStrokeWidth = rawStrokeWidth * scaleMagnitude;
  const sourceWidth = Math.max(
    worldStrokeWidth,
    numberOr(object?.sourceWidth) * scaleMagnitude,
  );
  const visibleFill = hasVisiblePaint(object?.fill) ? object.fill : null;
  const visibleStroke = hasVisiblePaint(object?.stroke) ? object.stroke : null;
  const nonUniformTransform = Math.abs(Math.abs(transform.scaleX) - Math.abs(transform.scaleY)) > EPSILON;
  const mustBakeStrokeOutline = Boolean(
    visibleStroke
    && rawStrokeWidth > 0
    && nonUniformTransform,
  );

  if (mustBakeStrokeOutline) {
    const localPolygons = commandsToPolygonSet(localCommands, {
      fill: false,
      strokeWidth: rawStrokeWidth,
      simplifyTolerance: Math.max(0.1, rawStrokeWidth * 0.25),
    });
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
      bounds: boundsOfCommands(polygonCommands),
      locked: object?.locked === true,
    };
  }

  const importedInk = object?.isPdfImported
    || String(object?.pdfAnnotationType ?? object?.data?.pdfAnnotationType ?? '')
      .trim().toLowerCase().replace(/^\//, '') === 'ink';
  const geometryStrokeWidth = importedInk && visibleStroke
    ? Math.max(IMPORTED_INK_MIN_WIDTH, worldStrokeWidth)
    : worldStrokeWidth;
  const persistedPolygons = normalizeMultiPolygon(object?.polygons);
  if (persistedPolygons.length) {
    const polygons = transformPolygons(persistedPolygons, transform);
    const polygonCommands = polygonSetToCommands(polygons);
    return {
      id: internalId,
      type: 'ink',
      cmds: polygonCommands,
      polygons,
      fill: visibleFill || visibleStroke,
      stroke: null,
      strokeWidth: 0,
      sourceWidth,
      bounds: boundsOfCommands(polygonCommands),
      locked: object?.locked === true,
    };
  }
  if (forcePolygon && visibleStroke && geometryStrokeWidth > 0) {
    const localPolygons = commandsToPolygonSet(localCommands, {
      fill: false,
      strokeWidth: importedInk
        ? Math.max(IMPORTED_INK_MIN_WIDTH / Math.max(scaleMagnitude, EPSILON), rawStrokeWidth)
        : rawStrokeWidth,
      simplifyTolerance: Math.max(0.1, rawStrokeWidth * 0.25),
    });
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
    forcePolygon,
    bounds: boundsOfCommands(commands),
    locked: object?.locked === true,
  };
}

function bakePagePathResult(object, result) {
  const {
    left: _left,
    top: _top,
    width: _width,
    height: _height,
    pathOffset: _pathOffset,
    scaleX: _scaleX,
    scaleY: _scaleY,
    angle: _angle,
    skewX: _skewX,
    skewY: _skewY,
    flipX: _flipX,
    flipY: _flipY,
    path: _path,
    polygons: _polygons,
    ...metadata
  } = object;
  const bounds = boundsOfCommands(result.cmds);
  const filled = hasVisiblePaint(result.fill) && numberOr(result.strokeWidth) === 0;

  return {
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
    stroke: filled ? 'transparent' : result.stroke,
    strokeWidth: filled ? 0 : result.sourceWidth ?? result.strokeWidth,
    fill: filled ? result.fill : null,
    ...(filled ? {
      fillRule: 'evenodd',
      paperInkGeometry: metadata.paperInkGeometry || 'v1',
      paperEraserGeometry: 'v1',
      polygons: normalizeMultiPolygon(result.polygons),
      sourceWidth: result.sourceWidth,
    } : {}),
  };
}

const unique = (values) => values.filter((value, index) => value && values.indexOf(value) === index);

/**
 * Applies one eraser gesture directly to the latest persisted page model.
 * Untouched objects retain their exact references and ordering.
 */
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
    };
  }

  const requestedMode = mode === 'entire' || mode === 'full' ? 'full' : 'partial';
  const pathGroups = { partial: [], full: [] };
  const pathRecords = new Map();
  const replacementByIndex = new Map();
  const deletedIndexes = new Set();
  const changedIds = [];
  const deletedIds = [];
  const touchedIds = [];

  objects.forEach((object, index) => {
    if (!canErase(object, index)) return;
    if (String(object?.type || '').toLowerCase() !== 'path' || !Array.isArray(object?.path)) return;
    const internalId = `page-object:${index}`;
    const operation = requestedMode === 'full'
      ? 'full'
      : (getEraserOperation(object, 'partial') === 'partial' ? 'partial' : 'full');
    const annotation = pathToPageAnnotation(object, internalId, {
      // Demo-drawn ink is a filled swept outline at every width. Expanding every
      // partial-eligible production Ink path before subtraction gives imported,
      // legacy, and native thin strokes the same rounded side-bite contract.
      forcePolygon: operation === 'partial',
    });
    if (!annotation) return;
    pathGroups[operation].push(annotation);
    pathRecords.set(internalId, { object, index });
  });

  for (const operation of ['partial', 'full']) {
    const annotations = pathGroups[operation];
    if (!annotations.length) continue;
    const result = eraseAnnotations(annotations, points, radius, operation);
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
        continue;
      }
      const survivor = survivorById.get(internalId);
      const originalGeometry = annotations.find((annotation) => annotation.id === internalId);
      if (!survivor || JSON.stringify(survivor.cmds) === JSON.stringify(originalGeometry?.cmds)) continue;
      replacementByIndex.set(record.index, bakePagePathResult(record.object, survivor));
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

  if (!replacementByIndex.size && !deletedIndexes.size) {
    return {
      pageAnnotations,
      didChange: false,
      changedIds: [],
      deletedIds: [],
      touchedIds: unique(touchedIds),
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
    touchedIds: unique(touchedIds),
  };
}
