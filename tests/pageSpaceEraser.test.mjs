import test from 'node:test';
import assert from 'node:assert/strict';

import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  createInkAnnotation,
  normalizeMultiPolygon,
  polygonSetToCommands,
} from '../src/utils/paperAnnotationGeometry.js';

const nativeInk = (id, y = 50, overrides = {}) => ({
  type: 'path',
  id,
  annotationId: id,
  tool: 'pen',
  path: [['M', 0, y], ['L', 100, y]],
  left: 0,
  top: 0,
  stroke: '#d11b2d',
  strokeWidth: 20,
  fill: null,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  data: { id, tool: 'pen', custom: 'keep-me' },
  authorId: 'author-1',
  meta: { authorId: 'author-1', audit: 'keep-me' },
  ...overrides,
});

const erase = (pageAnnotations, points, overrides = {}) => erasePageAnnotations({
  pageAnnotations,
  eraserPoints: points,
  eraserRadius: 7,
  mode: 'partial',
  ...overrides,
});

function pathEndpoints(path) {
  return path
    .filter((command) => command[0] === 'M' || command[0] === 'L')
    .map((command) => ({ x: command[command.length - 2], y: command[command.length - 1] }));
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    area += ring[previous][0] * ring[index][1] - ring[index][0] * ring[previous][1];
  }
  return Math.abs(area / 2);
}

function pointInRing({ x, y }, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonSet(point, polygons) {
  return (polygons || []).some((polygon) => (
    polygon.reduce((inside, ring) => (pointInRing(point, ring) ? !inside : inside), false)
  ));
}

test('partial erase converts thick native pen ink to true shape geometry, preserves metadata, and takes only an edge bite', () => {
  const touched = nativeInk('ink-a');
  const untouched = nativeInk('ink-b', 100);
  const page = { version: '5.3.0', objects: [touched, untouched] };

  const result = erase(page, [{ x: 50, y: 38 }]);
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.deepEqual(result.changedIds, ['ink-a']);
  assert.deepEqual(result.deletedIds, []);
  assert.equal(result.pageAnnotations.objects.length, 2);
  assert.notEqual(survivor, touched);
  assert.equal(result.pageAnnotations.objects[1], untouched);
  assert.equal(result.pageAnnotations.version, page.version);
  assert.equal(survivor.id, touched.id);
  assert.equal(survivor.annotationId, touched.annotationId);
  assert.deepEqual(survivor.data, touched.data);
  assert.equal(survivor.authorId, touched.authorId);
  assert.deepEqual(survivor.meta, touched.meta);
  assert.equal(survivor.strokeWidth, 0);
  assert.equal(survivor.fill, touched.stroke);
  assert.equal(survivor.fillRule, 'evenodd');
  assert.ok(Array.isArray(survivor.polygons) && survivor.polygons.length > 0);
  assert.equal(pointInPolygonSet({ x: 50, y: 41 }, survivor.polygons), false, 'upper edge is erased');
  assert.equal(pointInPolygonSet({ x: 50, y: 50 }, survivor.polygons), true, 'center survives');
  assert.equal(pointInPolygonSet({ x: 20, y: 41 }, survivor.polygons), true, 'untouched edge survives');
});

test('each gesture rebases on the latest page state instead of a mounted canvas snapshot', () => {
  const a = nativeInk('a', 30);
  const b = nativeInk('b', 70);
  const first = erase({ objects: [a, b] }, [{ x: 50, y: 18 }]);
  assert.equal(first.didChange, true);

  const restoredA = nativeInk('a', 30, { data: { id: 'a', remote: 'restored' } });
  const remoteC = nativeInk('c', 110, { data: { id: 'c', remote: true } });
  const latestPage = { objects: [restoredA, b, remoteC] };
  const second = erase(latestPage, [{ x: 50, y: 58 }]);

  assert.equal(second.didChange, true);
  assert.equal(second.pageAnnotations.objects[0], restoredA);
  assert.equal(second.pageAnnotations.objects[2], remoteC);
  assert.deepEqual(second.pageAnnotations.objects.map((object) => object.id), ['a', 'b', 'c']);
});

test('thin stroked imported Ink is outlined and subtracts at its visible page position', () => {
  const imported = nativeInk('pdf-ink', 0, {
    path: [['M', 0, 0], ['L', 100, 0]],
    left: 200,
    top: 100,
    width: 100,
    height: 0,
    strokeWidth: 2,
    tool: undefined,
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    pdfAnnotationId: 'pdf-source-1',
    layer: 'pdf-annotations',
  });

  const result = erase({ objects: [imported] }, [{ x: 250, y: 100 }], { eraserRadius: 5 });
  const survivor = result.pageAnnotations.objects[0];
  const points = pathEndpoints(survivor.path);

  assert.equal(result.didChange, true);
  assert.equal(survivor.id, imported.id);
  assert.equal(survivor.pdfAnnotationId, imported.pdfAnnotationId);
  assert.equal(survivor.left, 0);
  assert.equal(survivor.top, 0);
  assert.equal(survivor.stroke, 'transparent');
  assert.equal(survivor.strokeWidth, 0);
  assert.equal(survivor.fill, imported.stroke);
  assert.equal(survivor.fillRule, 'evenodd');
  assert.ok(Array.isArray(survivor.polygons) && survivor.polygons.length > 0);
  assert.ok(points.some((point) => point.x < 245));
  assert.ok(points.some((point) => point.x > 255));
  assert.ok(points.every((point) => Math.abs(point.y - 100) <= imported.strokeWidth / 2 + 0.001));
});

test('a thick stroke keeps both shallow edge bites across repeated erase passes', () => {
  const original = nativeInk('repeat');
  const first = erase({ objects: [original] }, [{ x: 35, y: 38 }]);
  const firstStroke = first.pageAnnotations.objects[0];
  const second = erase(first.pageAnnotations, [{ x: 70, y: 62 }]);
  const secondStroke = second.pageAnnotations.objects[0];

  assert.equal(first.didChange, true);
  assert.equal(second.didChange, true);
  assert.deepEqual(second.changedIds, ['repeat']);
  assert.notDeepEqual(secondStroke.path, firstStroke.path);
  assert.equal(firstStroke.strokeWidth, 0);
  assert.equal(secondStroke.strokeWidth, 0);
  assert.equal(secondStroke.fill, original.stroke);
  assert.equal(secondStroke.fillRule, 'evenodd');
  assert.equal(pointInPolygonSet({ x: 35, y: 41 }, secondStroke.polygons), false, 'first bite persists');
  assert.equal(pointInPolygonSet({ x: 70, y: 59 }, secondStroke.polygons), false, 'second bite persists');
  assert.equal(pointInPolygonSet({ x: 35, y: 50 }, secondStroke.polygons), true, 'first center survives');
  assert.equal(pointInPolygonSet({ x: 70, y: 50 }, secondStroke.polygons), true, 'second center survives');
});

test('a native filled stroke preserves its polygon topology after every bite', () => {
  const ink = createInkAnnotation([{ x: 0, y: 50 }, { x: 100, y: 50 }], {
    id: 'canonical',
    color: '#d11b2d',
    width: 20,
  });
  const original = nativeInk('canonical', 50, {
    path: ink.cmds,
    polygons: ink.polygons,
    fill: ink.fill,
    stroke: 'transparent',
    strokeWidth: 0,
    sourceWidth: 20,
    paperInkGeometry: 'v1',
  });

  const first = erase({ objects: [original] }, [{ x: 35, y: 38 }]);
  const firstStroke = first.pageAnnotations.objects[0];
  const second = erase(first.pageAnnotations, [{ x: 70, y: 62 }]);
  const secondStroke = second.pageAnnotations.objects[0];

  assert.equal(first.didChange, true);
  assert.equal(second.didChange, true);
  assert.deepEqual(polygonSetToCommands(firstStroke.polygons), firstStroke.path);
  assert.deepEqual(polygonSetToCommands(secondStroke.polygons), secondStroke.path);
  assert.notDeepEqual(secondStroke.polygons, firstStroke.polygons);
});

test('a native Fabric pen curve is promoted to filled geometry before partial erase', () => {
  const path = [['M', 0, 50]];
  for (let index = 1; index <= 24; index += 1) {
    const previousX = (index - 1) * 5;
    const x = index * 5;
    path.push(['Q', previousX + 2.5, 50 + Math.sin(index / 3) * 0.4, x, 50]);
  }
  const legacy = nativeInk('legacy-fabric-curve', 50, {
    path,
    strokeWidth: 3,
  });

  const result = erase({ objects: [legacy] }, [{ x: 60, y: 46 }], { eraserRadius: 4 });
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.ok(Array.isArray(survivor.polygons) && survivor.polygons.length > 0);
  assert.equal(survivor.strokeWidth, 0);
  assert.equal(survivor.fill, legacy.stroke);
  assert.equal(survivor.fillRule, 'evenodd');
});

test('a pre-tool-tag Fabric PencilBrush save still takes a partial side bite', () => {
  const legacyInk = {
    type: 'path',
    id: 'legacy-pencil-brush',
    path: [['M', 0, 50], ['Q', 50, 50, 100, 50], ['L', 120, 50]],
    left: 0,
    top: 0,
    fill: null,
    stroke: '#e11d48',
    strokeWidth: 20,
    strokeUniform: true,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeMiterLimit: 10,
    strokeDashArray: null,
    perPixelTargetFind: true,
    uniformScaling: false,
    centeredRotation: true,
  };

  const result = erase({ objects: [legacyInk] }, [{ x: 60, y: 38 }], { eraserRadius: 7 });
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.deepEqual(result.deletedIds, []);
  assert.deepEqual(result.changedIds, ['legacy-pencil-brush']);
  assert.equal(survivor.fillRule, 'evenodd');
  assert.equal(pointInPolygonSet({ x: 60, y: 41 }, survivor.polygons), false);
  assert.equal(pointInPolygonSet({ x: 60, y: 50 }, survivor.polygons), true);
});

test('a geometric miss is a byte-stable identity no-op', () => {
  const stroke = nativeInk('miss');
  const shape = { type: 'rect', id: 'rect', left: 200, top: 200, width: 30, height: 30 };
  const page = { objects: [stroke, shape] };
  const before = JSON.stringify(page);

  const result = erase(page, [{ x: 500, y: 500 }]);

  assert.equal(result.didChange, false);
  assert.equal(result.pageAnnotations, page);
  assert.equal(result.pageAnnotations.objects[0], stroke);
  assert.equal(result.pageAnnotations.objects[1], shape);
  assert.equal(JSON.stringify(result.pageAnnotations), before);
});

test('partial mode still removes a touched non-ink annotation atomically', () => {
  const rect = {
    type: 'rect',
    id: 'rect',
    annotationId: 'rect',
    left: 20,
    top: 20,
    width: 40,
    height: 30,
    fill: '#22aa55',
    stroke: '#111111',
    strokeWidth: 1,
  };
  const result = erase({ objects: [rect] }, [{ x: 30, y: 30 }]);

  assert.equal(result.didChange, true);
  assert.deepEqual(result.deletedIds, ['rect']);
  assert.deepEqual(result.pageAnnotations.objects, []);
});

test('partial mode whole-deletes every atomic path instead of carving its geometry', () => {
  const squarePath = [['M', 20, 20], ['L', 60, 20], ['L', 60, 60], ['L', 20, 60], ['Z']];
  const specs = [
    ['generic-path', {}],
    ['line-path', { tool: 'line' }],
    ['arrow-path', { tool: 'arrow' }],
    ['shape-path', { tool: 'rect' }],
    ['polygon-path', { tool: 'polygon' }],
    ['text-path', { tool: 'text' }],
    ['callout-path', { tool: 'callout' }],
    ['stamp-path', { tool: 'stamp' }],
    ['pdf-line', { pdfAnnotationType: 'Line' }],
    ['pdf-text', { pdfAnnotationType: 'FreeText' }],
    ['pdf-highlight', { pdfAnnotationType: 'Highlight', tool: 'highlighter' }],
  ];
  const objects = specs.map(([id, overrides]) => ({
    type: 'path',
    id,
    path: squarePath,
    left: 0,
    top: 0,
    fill: '#228855',
    stroke: 'transparent',
    strokeWidth: 0,
    ...overrides,
  }));

  const result = erase({ objects }, [{ x: 40, y: 40 }]);

  assert.equal(result.didChange, true);
  assert.deepEqual(result.changedIds, []);
  assert.deepEqual(result.deletedIds, specs.map(([id]) => id));
  assert.deepEqual(result.pageAnnotations.objects, []);
});

test('partial mode whole-deletes non-path shapes, text, and stamps', () => {
  const objects = [
    { type: 'rect', id: 'rect', left: 20, top: 20, width: 40, height: 40, fill: '#228855' },
    { type: 'ellipse', id: 'ellipse', left: 20, top: 20, rx: 20, ry: 20, fill: '#228855' },
    {
      type: 'line', id: 'line', tool: 'arrow', left: 20, top: 40, width: 40, height: 0,
      x1: -20, y1: 0, x2: 20, y2: 0, stroke: '#228855', strokeWidth: 3,
    },
    { type: 'textbox', id: 'text', left: 20, top: 20, width: 40, height: 40, text: 'Note' },
    { type: 'image', id: 'stamp', left: 20, top: 20, width: 40, height: 40 },
  ];

  const result = erase({ objects }, [{ x: 40, y: 40 }]);

  assert.equal(result.didChange, true);
  assert.deepEqual(result.changedIds, []);
  assert.deepEqual(result.deletedIds, ['rect', 'ellipse', 'line', 'text', 'stamp']);
  assert.deepEqual(result.pageAnnotations.objects, []);
});

test('full mode whole-deletes pen, highlighter, and imported PDF Ink without rewriting neighbors', () => {
  const pen = nativeInk('full-pen');
  const highlighter = nativeInk('full-highlighter', 50, {
    tool: 'highlighter',
    data: { id: 'full-highlighter', tool: 'highlighter' },
  });
  const importedInk = nativeInk('full-pdf-ink', 50, {
    tool: undefined,
    data: { id: 'full-pdf-ink' },
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
  });
  const neighbor = nativeInk('full-neighbor', 100);
  const result = erase(
    { objects: [pen, highlighter, importedInk, neighbor] },
    [{ x: 50, y: 50 }],
    { mode: 'full' },
  );

  assert.deepEqual(result.deletedIds, ['full-pen', 'full-highlighter', 'full-pdf-ink']);
  assert.deepEqual(result.changedIds, []);
  assert.deepEqual(result.pageAnnotations.objects, [neighbor]);
  assert.equal(result.pageAnnotations.objects[0], neighbor);
});

test('thin stroked imported curves become filled shape geometry before subtraction', () => {
  const curve = nativeInk('curve', 0, {
    path: [['M', 0, 0], ['Q', 50, 50, 100, 0]],
    strokeWidth: 2,
    tool: undefined,
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
  });
  const result = erase({ objects: [curve] }, [{ x: 50, y: 25 }], { eraserRadius: 4 });
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.equal(survivor.stroke, 'transparent');
  assert.equal(survivor.strokeWidth, 0);
  assert.equal(survivor.fill, curve.stroke);
  assert.equal(survivor.fillRule, 'evenodd');
  assert.ok(Array.isArray(survivor.polygons) && survivor.polygons.length > 0);
});

test('thin native pen ink still uses filled shape subtraction', () => {
  const thin = nativeInk('thin-native', 50, { strokeWidth: 2.5 });
  const result = erase({ objects: [thin] }, [{ x: 50, y: 46 }], { eraserRadius: 4 });
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.ok(Array.isArray(survivor.polygons) && survivor.polygons.length > 0);
  assert.equal(survivor.strokeWidth, 0);
  assert.equal(survivor.fill, thin.stroke);
  assert.equal(survivor.fillRule, 'evenodd');
});

test('rotation and non-uniform scale are baked before erasing in page space', () => {
  const transformed = nativeInk('transformed', 0, {
    path: [['M', 0, 0], ['L', 100, 0]],
    left: 200,
    top: 100,
    width: 100,
    height: 0,
    scaleX: 2,
    scaleY: 1,
    angle: 90,
    strokeWidth: 4,
    tool: undefined,
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
  });
  const result = erase(
    { objects: [transformed] },
    [{ x: 300, y: 100 }],
    { eraserRadius: 6 },
  );
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.equal(survivor.left, 0);
  assert.equal(survivor.top, 0);
  assert.equal(survivor.scaleX, 1);
  assert.equal(survivor.scaleY, 1);
  assert.equal(survivor.angle, 0);
  assert.equal(survivor.fillRule, 'evenodd');
  const points = pathEndpoints(survivor.path);
  assert.ok(points.every((point) => point.y >= -5 && point.y <= 205));
  assert.ok(points.every((point) => point.x >= 297 && point.x <= 303));
});

test('converged imported filled ink (item-4 native representation) takes a clean partial carve', () => {
  // Shape emitted by convertInkToFabricPath for filled pressure ink since the
  // 2026-07-17 item-4 convergence: evenodd polygons + ring path, left/top
  // world placement, no centerline. Must ride the SAME polygon-subtraction
  // branch as native paper ink.
  const ink = createInkAnnotation([{ x: 0, y: 10 }, { x: 100, y: 10 }], {
    id: 'imported-converged',
    color: 'rgba(255, 0, 0, 1)',
    width: 8,
  });
  const imported = {
    type: 'path',
    id: 'imported-converged',
    path: ink.cmds,
    polygons: ink.polygons,
    left: 200,
    top: 90,
    width: 100,
    height: 20,
    fill: 'rgba(255, 0, 0, 1)',
    stroke: 'transparent',
    strokeWidth: 0,
    fillRule: 'evenodd',
    paperInkGeometry: 'v1',
    isPdfImported: true,
    pdfAnnotationId: 'pdf-src-9',
    pdfAnnotationType: 'Ink',
    pdfInkRenderMode: 'filled-outline',
    layer: 'pdf-annotations',
  };

  const result = erase({ objects: [imported] }, [{ x: 250, y: 100 }], { eraserRadius: 5 });
  assert.equal(result.didChange, true);
  const survivor = result.pageAnnotations.objects[0];
  assert.equal(survivor.pdfAnnotationId, 'pdf-src-9');
  assert.equal(survivor.fillRule, 'evenodd');
  assert.equal(survivor.paperEraserGeometry, 'v1');
  assert.equal(survivor.fill, imported.fill);
  assert.equal(survivor.strokeWidth, 0);
  const points = pathEndpoints(survivor.path);
  // The stroke spans world x 200→300 at y≈100; the bite at x=250 must leave
  // geometry on BOTH sides — a partial carve, not a whole-stroke delete.
  assert.ok(points.some((point) => point.x < 245), 'geometry survives left of the bite');
  assert.ok(points.some((point) => point.x > 255), 'geometry survives right of the bite');
  assert.equal(result.deletedIds.length, 0);
});
