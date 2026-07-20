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

test('partial erase splits the touched stroke, keeps it stroked ink, and preserves all metadata', () => {
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
  // Root-fix contract (2026-07-19): a partially erased pen stroke STAYS a
  // stroked centerline — same stroke color and width, no filled-outline
  // conversion — split into multiple subpaths of the one annotation.
  assert.equal(survivor.stroke, touched.stroke);
  assert.equal(survivor.strokeWidth, touched.strokeWidth);
  assert.equal(survivor.fill, null);
  assert.equal(survivor.fillRule, undefined);
  assert.equal(survivor.path.filter((command) => command[0] === 'M').length, 2);
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

test('thin stroked imported Ink splits at its visible page position and stays stroked', () => {
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
  // Stroked /InkList-style imports ride the exact capsule splitter too —
  // survivors keep the stroke paint at world position, split around the bite.
  assert.equal(survivor.stroke, imported.stroke);
  assert.equal(survivor.strokeWidth, imported.strokeWidth);
  assert.equal(survivor.fill, null);
  assert.equal(survivor.path.filter((command) => command[0] === 'M').length, 2);
  assert.ok(points.some((point) => point.x < 245));
  assert.ok(points.some((point) => point.x > 255));
  assert.ok(points.every((point) => Math.abs(point.y - 100) < 0.001));
});

test('a thick stroke splits cleanly across repeated erase passes and never converts form', () => {
  const original = nativeInk('repeat');
  const first = erase({ objects: [original] }, [{ x: 35, y: 38 }]);
  const firstStroke = first.pageAnnotations.objects[0];
  const second = erase(first.pageAnnotations, [{ x: 70, y: 62 }]);
  const secondStroke = second.pageAnnotations.objects[0];

  assert.equal(first.didChange, true);
  assert.equal(second.didChange, true);
  assert.deepEqual(second.changedIds, ['repeat']);
  assert.notDeepEqual(secondStroke.path, firstStroke.path);
  // Idempotent model: every pass cuts intervals out of the same centerline;
  // the annotation stays stroked ink forever (no polygon conversion, ever).
  assert.equal(firstStroke.strokeWidth, original.strokeWidth);
  assert.equal(secondStroke.strokeWidth, original.strokeWidth);
  assert.equal(secondStroke.fill, null);
  assert.equal(secondStroke.fillRule, undefined);
  assert.equal(secondStroke.path.filter((command) => command[0] === 'M').length, 3);
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

test('a thin Fabric curve splits exactly and its survivors stay true curves', () => {
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
  // De Casteljau splitting keeps survivors as genuine quadratic curves inside
  // one stroked annotation — no polygon expansion, no filled conversion.
  assert.equal(survivor.polygons, undefined);
  assert.equal(survivor.stroke, legacy.stroke);
  assert.equal(survivor.strokeWidth, legacy.strokeWidth);
  assert.equal(survivor.path.filter((command) => command[0] === 'M').length, 2);
  assert.ok(survivor.path.some((command) => command[0] === 'Q'));
  assert.ok(survivor.path.length < 60, `expected compact geometry, got ${survivor.path.length} commands`);
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

test('thin stroked imported curves split exactly and keep their curve form', () => {
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
  assert.equal(survivor.stroke, curve.stroke);
  assert.equal(survivor.strokeWidth, curve.strokeWidth);
  assert.equal(survivor.fill, null);
  assert.ok(survivor.path.every((command) => command[0] !== 'Z'));
  assert.equal(survivor.path.filter((command) => command[0] === 'M').length, 2);
  assert.ok(survivor.path.some((command) => command[0] === 'Q'));
});

test('thin native ink splits into stroked segments (Drawboard/InkList model)', () => {
  const thin = nativeInk('thin-native', 50, { strokeWidth: 2.5 });
  const result = erase({ objects: [thin] }, [{ x: 50, y: 46 }], { eraserRadius: 4 });
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.equal(survivor.stroke, thin.stroke);
  assert.equal(survivor.strokeWidth, thin.strokeWidth);
  assert.equal(survivor.fill, null);
  assert.equal(survivor.fillRule, undefined);
  assert.ok(survivor.path.every((command) => command[0] !== 'Z'));
  assert.equal(survivor.path.filter((command) => command[0] === 'M').length, 2);
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
