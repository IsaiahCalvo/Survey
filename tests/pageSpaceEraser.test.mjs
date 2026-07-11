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

test('partial erase replaces only the touched stroke and preserves all metadata', () => {
  const touched = nativeInk('ink-a');
  const untouched = nativeInk('ink-b', 100);
  const page = { version: '5.3.0', objects: [touched, untouched] };

  const result = erase(page, [{ x: 50, y: 38 }]);

  assert.equal(result.didChange, true);
  assert.deepEqual(result.changedIds, ['ink-a']);
  assert.deepEqual(result.deletedIds, []);
  assert.equal(result.pageAnnotations.objects.length, 2);
  assert.notEqual(result.pageAnnotations.objects[0], touched);
  assert.equal(result.pageAnnotations.objects[1], untouched);
  assert.equal(result.pageAnnotations.version, page.version);
  assert.equal(result.pageAnnotations.objects[0].id, touched.id);
  assert.equal(result.pageAnnotations.objects[0].annotationId, touched.annotationId);
  assert.deepEqual(result.pageAnnotations.objects[0].data, touched.data);
  assert.equal(result.pageAnnotations.objects[0].authorId, touched.authorId);
  assert.deepEqual(result.pageAnnotations.objects[0].meta, touched.meta);
  assert.equal(result.pageAnnotations.objects[0].fill, touched.stroke);
  assert.equal(result.pageAnnotations.objects[0].strokeWidth, 0);
  assert.equal(result.pageAnnotations.objects[0].fillRule, 'evenodd');
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

test('thin imported Ink gets a true outline bite at its visible page position', () => {
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
  assert.equal(survivor.fill, imported.stroke);
  assert.equal(survivor.strokeWidth, 0);
  assert.equal(survivor.fillRule, 'evenodd');
  assert.equal(survivor.paperEraserGeometry, 'v1');
  assert.ok(points.some((point) => point.x < 245));
  assert.ok(points.some((point) => point.x > 255));
  assert.ok(points.some((point) => point.y < 100));
  assert.ok(points.some((point) => point.y > 100));
});

test('a previously converted thick stroke accepts another clean side bite', () => {
  const original = nativeInk('repeat');
  const first = erase({ objects: [original] }, [{ x: 35, y: 38 }]);
  const firstStroke = first.pageAnnotations.objects[0];
  const second = erase(first.pageAnnotations, [{ x: 70, y: 62 }]);

  assert.equal(first.didChange, true);
  assert.equal(second.didChange, true);
  assert.deepEqual(second.changedIds, ['repeat']);
  assert.notDeepEqual(second.pageAnnotations.objects[0].path, firstStroke.path);
  assert.equal(second.pageAnnotations.objects[0].fillRule, 'evenodd');
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

test('a thin Fabric curve becomes one clean outline before its first partial erase', () => {
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
  const polygons = normalizeMultiPolygon(survivor.polygons);
  const rings = polygons.flat();

  assert.equal(result.didChange, true);
  assert.equal(polygons.length, 1);
  assert.equal(rings.length, 1);
  assert.ok(survivor.path.length < 200, `expected compact geometry, got ${survivor.path.length} commands`);
  assert.ok(rings.every((ring) => ringArea(ring) > 0.01));
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

test('full mode removes a touched pen stroke without rewriting its neighbors', () => {
  const touched = nativeInk('full-a');
  const neighbor = nativeInk('full-b', 100);
  const result = erase(
    { objects: [touched, neighbor] },
    [{ x: 50, y: 50 }],
    { mode: 'entire' },
  );

  assert.deepEqual(result.deletedIds, ['full-a']);
  assert.deepEqual(result.changedIds, []);
  assert.deepEqual(result.pageAnnotations.objects, [neighbor]);
  assert.equal(result.pageAnnotations.objects[0], neighbor);
});

test('thin imported curves use filled outline subtraction after a partial cut', () => {
  const curve = nativeInk('curve', 0, {
    path: [['M', 0, 0], ['Q', 50, 50, 100, 0]],
    strokeWidth: 2,
    tool: undefined,
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
  });
  const result = erase({ objects: [curve] }, [{ x: 50, y: 25 }], { eraserRadius: 4 });

  assert.equal(result.didChange, true);
  assert.ok(result.pageAnnotations.objects[0].path.some((command) => command[0] === 'Z'));
  assert.equal(result.pageAnnotations.objects[0].fill, curve.stroke);
  assert.equal(result.pageAnnotations.objects[0].strokeWidth, 0);
  assert.equal(result.pageAnnotations.objects[0].fillRule, 'evenodd');
});

test('thin native ink gets the same rounded outline bite as the demo', () => {
  const thin = nativeInk('thin-native', 50, { strokeWidth: 2.5 });
  const result = erase({ objects: [thin] }, [{ x: 50, y: 46 }], { eraserRadius: 4 });
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.equal(survivor.fill, thin.stroke);
  assert.equal(survivor.strokeWidth, 0);
  assert.equal(survivor.fillRule, 'evenodd');
  assert.equal(survivor.paperEraserGeometry, 'v1');
  assert.ok(survivor.path.some((command) => command[0] === 'Z'));
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
