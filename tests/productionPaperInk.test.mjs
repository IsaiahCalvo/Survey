import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { polygonSetToCommands } from '../src/utils/paperAnnotationGeometry.js';
import {
  applyPdfAppAnnotationMetadata,
  buildPdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';

test('a production pen stroke is persisted as the demo native filled geometry', () => {
  const object = createProductionPaperInk({
    id: 'pen-1',
    tool: 'pen',
    points: [{ x: 10, y: 20 }, { x: 110, y: 20 }],
    color: 'rgba(209, 27, 45, 0.8)',
    width: 3,
    data: { custom: 'preserved' },
    moduleId: 'module-1',
    pathOffset: { x: 60, y: 20 },
  });

  assert.equal(object.type, 'path');
  assert.equal(object.id, 'pen-1');
  assert.equal(object.annotationId, undefined);
  assert.equal(object.tool, 'pen');
  assert.equal(object.paperInkGeometry, 'v1');
  assert.equal(object.fillRule, 'evenodd');
  assert.equal(object.fill, 'rgba(209, 27, 45, 0.8)');
  assert.equal(object.stroke, 'transparent');
  assert.equal(object.strokeWidth, 0);
  assert.equal(object.sourceWidth, 3);
  assert.equal(object.left, 0);
  assert.equal(object.top, 0);
  assert.equal(object.pathOffset, undefined);
  assert.equal(object.moduleId, 'module-1');
  assert.deepEqual(object.data, { custom: 'preserved', id: 'pen-1', tool: 'pen' });
  assert.deepEqual(object.path, polygonSetToCommands(object.polygons));
  assert.equal(object.polygons.length, 1);
  assert.equal(object.polygons[0].length, 1);
});

test('a production highlighter uses the same geometry with multiply compositing', () => {
  const object = createProductionPaperInk({
    id: 'highlight-1',
    tool: 'highlighter',
    points: [{ x: 0, y: 0 }, { x: 50, y: 10 }],
    color: 'rgba(255, 235, 59, 0.45)',
    width: 12,
  });

  assert.equal(object.tool, 'highlighter');
  assert.equal(object.globalCompositeOperation, 'multiply');
  assert.equal(object.fill, 'rgba(255, 235, 59, 0.45)');
  assert.equal(object.sourceWidth, 12);
  assert.ok(object.paperCenterline.length >= 2);
});

test('the production drawing surface commits captured pointer points through paper geometry', () => {
  const source = readFileSync(
    new URL('../src/components/FabricDrawingCanvas.jsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /createProductionPaperInk\s*\(/);
  assert.match(source, /rawInkGestureRef\.current\.points/);
  assert.doesNotMatch(source, /const pathJSON = e\.path\.toObject\(CUSTOM_PROPS\)/);
});

test('app PDF metadata round-trips editable paper geometry without flattening topology', () => {
  const object = createProductionPaperInk({
    id: 'round-trip-ink',
    tool: 'pen',
    points: [{ x: 10, y: 20 }, { x: 110, y: 25 }],
    color: '#d11b2d',
    width: 14,
  });
  object.paperEraserGeometry = 'v1';
  const metadata = buildPdfAppAnnotationMetadata(object, {
    id: object.id,
    type: 'path',
    pageNumber: 1,
  });
  const restored = applyPdfAppAnnotationMetadata(
    { type: 'path', path: [['M', 0, 0], ['L', 1, 1]], stroke: '#000', data: {} },
    metadata,
  );

  assert.deepEqual(restored.path, object.path);
  assert.deepEqual(restored.polygons, object.polygons);
  assert.deepEqual(restored.paperCenterline, object.paperCenterline);
  assert.equal(restored.paperInkGeometry, 'v1');
  assert.equal(restored.paperEraserGeometry, 'v1');
  assert.equal(restored.sourceWidth, 14);
});

test('Fabric edit and collaboration serialization include paper geometry fields', () => {
  const editSource = readFileSync(
    new URL('../src/components/FabricEditCanvas.jsx', import.meta.url),
    'utf8',
  );
  const collabSource = readFileSync(
    new URL('../src/lib/collab/crdtAnnotationBridge.js', import.meta.url),
    'utf8',
  );
  for (const property of [
    'tool',
    'paperInkGeometry',
    'paperEraserGeometry',
    'polygons',
    'paperCenterline',
    'sourceWidth',
    'fillRule',
  ]) {
    assert.match(editSource, new RegExp(`['\"]${property}['\"]`));
    assert.match(collabSource, new RegExp(`['\"]${property}['\"]`));
  }
});

test('app PDF metadata does not truncate a long erased polygon ring', () => {
  const ring = Array.from({ length: 700 }, (_, index) => {
    const angle = (index / 699) * Math.PI * 2;
    return [100 + Math.cos(angle) * 50, 100 + Math.sin(angle) * 50];
  });
  ring.push([...ring[0]]);
  const object = {
    id: 'long-erased-ring',
    type: 'path',
    tool: 'pen',
    path: polygonSetToCommands([[ring]]),
    polygons: [[ring]],
    fill: '#d11b2d',
    stroke: 'transparent',
    strokeWidth: 0,
    sourceWidth: 20,
    paperInkGeometry: 'v1',
    paperEraserGeometry: 'v1',
  };

  const metadata = buildPdfAppAnnotationMetadata(object, {
    id: object.id,
    type: 'path',
    pageNumber: 1,
  });

  assert.equal(metadata.geometry.polygons[0][0].length, ring.length);
  assert.equal(metadata.geometry.path.length, object.path.length);
});
