import {
  boundsOfCommands,
  commandsToPolygonSet,
  eraseAnnotations,
  intersectPolygonSets,
  normalizeMultiPolygon,
  polygonSetToCommands,
} from './paperAnnotationGeometry.js';
import {
  eraserStrokeTouchesObject,
  getEraserCandidateId,
} from './eraserHitTest.js';
import { getEraserOperation } from './eraserPolicy.js';
import {
  getAnnotationStorageKey,
  setAnnotationStorageKey,
} from './annotationStorageIdentity.js';

const EPSILON = 1e-7;

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
  const localCenterX = bounds ? (bounds.minX + bounds.maxX) / 2 : pathOffsetX;
  const localCenterY = bounds ? (bounds.minY + bounds.maxY) / 2 : pathOffsetY;
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
    inverse(point) {
      const pageX = numberOr(point?.x) - (left + centerX);
      const pageY = numberOr(point?.y) - (top + centerY);
      const unrotatedX = pageX * cos + pageY * sin;
      const unrotatedY = -pageX * sin + pageY * cos;
      return {
        x: localCenterX + unrotatedX / scaleX,
        y: localCenterY + unrotatedY / scaleY,
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

  // UX 2026-07-17 (import-normalization item 5b): the imported-ink minimum
  // width derivation that used to live here (IMPORTED_INK_MIN_WIDTH 2.5 on
  // both polygon paths below) is retired. It existed to keep erase geometry
  // in sync with the RENDER-time imported width clamp; item 5a moved that
  // clamp into the STORED value at import, so the stored width the eraser
  // reads here already IS the rendered width — for native and imported ink
  // alike, with no provenance branch.
  const geometryStrokeWidth = worldStrokeWidth;
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
    paperCenterline: _paperCenterline,
    paperCenterlineRuns: _paperCenterlineRuns,
    ...metadata
  } = object;
  const bounds = boundsOfCommands(result.cmds);
  const filled = hasVisiblePaint(result.fill) && numberOr(result.strokeWidth) === 0;

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
  const storageKey = getAnnotationStorageKey(object);
  if (storageKey != null) setAnnotationStorageKey(baked, storageKey);
  return baked;
}

/**
 * Compose independently-authored partial-erase survivors. Every survivor is a
 * subset of the same stable base object, so their intersection is exactly
 * "apply every bite". One survivor is returned byte-for-byte; only concurrent
 * writer lanes require a polygon boolean operation.
 */
export function intersectErasedPathSurvivors(survivors) {
  const values = (survivors || []).filter((object) => (
    object
    && String(object.type || '').toLowerCase() === 'path'
    && normalizeMultiPolygon(object.polygons).length > 0
  ));
  if (!values.length) return null;
  if (values.length === 1) return values[0];

  let polygons = normalizeMultiPolygon(values[0].polygons);
  for (let index = 1; index < values.length; index += 1) {
    polygons = intersectPolygonSets(polygons, values[index].polygons);
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
  polygons: normalizeMultiPolygon(object?.polygons),
  paperCenterline: object?.paperCenterline || null,
  paperCenterlineRuns: object?.paperCenterlineRuns || null,
  paperInkGeometry: object?.paperInkGeometry || null,
  paperEraserGeometry: object?.paperEraserGeometry || null,
  sourceWidth: numberOr(object?.sourceWidth),
  strokeWidth: numberOr(object?.strokeWidth),
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

/**
 * Rebase one bounded partial-erase survivor onto the current durable base.
 *
 * The survivor polygon is already accumulated, so this stays O(1) in gesture
 * count. Compatible move/scale/rotation edits apply the base's relative affine
 * transform to the accumulated cut. An incompatible path/polygon edit makes
 * this lane a no-op so the remote base—and any newer compatible writer
 * lanes—win instead of reviving old geometry.
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

  const currentCommands = normalizeFabricPath(currentBase.path);
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

  return {
    ...bakePagePathResult(currentBase, {
      cmds: polygonSetToCommands(polygons),
      polygons,
      fill: currentGeometry.fill,
      stroke: null,
      strokeWidth: 0,
      sourceWidth: currentGeometry.sourceWidth,
    }),
    paperEraserBaseTransform: eraserBaseTransformSnapshot(currentBase),
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
      objectMutations: [],
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
      // The feature-spike contract: partial ink erase subtracts the round
      // eraser shape from the stroke's actual filled outline. This preserves
      // the center when the eraser only bites an edge.
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
      const replacement = bakePagePathResult(record.object, survivor);
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

  if (!replacementByIndex.size && !deletedIndexes.size) {
    return {
      pageAnnotations,
      didChange: false,
      changedIds: [],
      deletedIds: [],
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
